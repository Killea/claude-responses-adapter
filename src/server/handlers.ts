import { FastifyReply, FastifyRequest } from 'fastify';
import { AnthropicMessageRequest } from '../types/anthropic';
import { AdapterConfig } from '../types/config';
import { convertRequestToResponses, summarizeResponsesRequest } from '../converters/request';
import { convertResponseToAnthropic, createErrorResponse } from '../converters/response';
import { streamResponsesToAnthropic } from '../converters/streaming';
import { streamXmlOpenAIToAnthropic } from '../converters/xmlStreaming';
import { formatValidationErrors, validateAnthropicRequest } from '../utils/validation';
import { logger } from '../utils/logger';
import { recordError } from '../utils/errorLog';
import { recordUsage } from '../utils/tokenUsage';
import { ResponsesErrorResponse, ResponsesInputItem, ResponsesMessageInput, ResponsesMultimodalMessageInput, ResponsesResponse } from '../types/responses';

let requestIdCounter = 0;

function generateRequestId(): string {
    requestIdCounter += 1;
    const timestamp = Date.now().toString(36);
    const counter = requestIdCounter.toString(36).padStart(4, '0');
    return `req_${timestamp}_${counter}`;
}

function buildUpstreamUrls(baseUrl: string): string[] {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    if (normalized.endsWith('/responses')) {
        return [normalized];
    }

    if (normalized.endsWith('/v1')) {
        return [`${normalized}/responses`];
    }

    return [`${normalized}/v1/responses`, `${normalized}/responses`];
}

function getToolFormat(config: AdapterConfig): 'native' | 'xml' {
    return config.toolFormat ?? 'native';
}

function isXmlMode(config: AdapterConfig): boolean {
    return getToolFormat(config) === 'xml';
}

function resolveTargetModel(model: string, config: AdapterConfig): string {
    if (model === config.models.opus || model === config.models.sonnet || model === config.models.haiku) {
        return model;
    }

    const normalized = model.toLowerCase();

    if (normalized.includes('haiku')) {
        return config.models.haiku;
    }

    if (normalized.includes('sonnet')) {
        return config.models.sonnet;
    }

    if (normalized.includes('opus')) {
        return config.models.opus;
    }

    return model;
}

function validateUnsupportedFeatures(anthropicRequest: AnthropicMessageRequest, config: AdapterConfig): string[] {
    const errors: string[] = [];
    const xmlMode = isXmlMode(config);

    if (xmlMode && anthropicRequest.tool_choice?.type === 'tool') {
        errors.push('tool_choice.type=tool is not supported in xml mode');
    }

    for (const [messageIndex, message] of anthropicRequest.messages.entries()) {
        if (typeof message.content === 'string') {
            continue;
        }

        for (const [blockIndex, block] of message.content.entries()) {
            if (block.type === 'text' || block.type === 'tool_result' || block.type === 'image') {
                continue;
            }

            if (block.type === 'tool_use') {
                if (xmlMode) {
                    errors.push(`messages[${messageIndex}].content[${blockIndex}]: tool_use blocks are not supported in xml mode`);
                }
                continue;
            }

            errors.push(`messages[${messageIndex}].content[${blockIndex}]: unsupported block type ${(block as { type?: string }).type ?? 'unknown'}`);
        }
    }

    return errors;
}

function createStatusError(message: string, statusCode: number): Error {
    const error = new Error(message) as Error & { status?: number };
    error.status = statusCode;
    return error;
}

async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
    try {
        return await response.json() as Record<string, unknown>;
    } catch {
        return {};
    }
}

async function readTextSafely(response: Response): Promise<string> {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

function parseRetryAfter(response: Response): string | null {
    return response.headers.get('retry-after');
}

async function fetchResponses(
    config: AdapterConfig,
    requestBody: Record<string, unknown>
): Promise<Response> {
    const upstreamUrls = buildUpstreamUrls(config.baseUrl);
    let lastResponse: Response | null = null;

    for (const url of upstreamUrls) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (response.status !== 404) {
            return response;
        }

        lastResponse = response;
    }

    if (lastResponse) {
        return lastResponse;
    }

    throw createStatusError('No upstream Responses endpoint candidates were available', 502);
}

async function streamUpstreamToAnthropic(
    upstreamResponse: Response,
    reply: FastifyReply,
    originalModel: string,
    config: AdapterConfig
): Promise<void> {
    if (isXmlMode(config)) {
        if (!upstreamResponse.body) {
            throw createStatusError('Upstream XML stream body is empty', 502);
        }

        const stream = upstreamResponse.body as unknown as AsyncIterable<unknown>;
        await streamXmlOpenAIToAnthropic(stream as any, reply, originalModel, config.baseUrl);
        return;
    }

    await streamResponsesToAnthropic(upstreamResponse, reply, originalModel, config.baseUrl);
}

function normalizeResponseForAnthropic(
    data: ResponsesResponse,
    anthropicRequest: AnthropicMessageRequest,
    targetModel: string
): ResponsesResponse {
    return {
        ...data,
        id: data.id || `resp_${Date.now().toString(36)}`,
        model: data.model || targetModel || anthropicRequest.model,
        output: data.output ?? [],
        usage: data.usage ?? {
            input_tokens: 0,
            output_tokens: 0,
        },
    };
}

function createTextFallbackResponse(text: string, anthropicRequest: AnthropicMessageRequest, targetModel: string): ResponsesResponse {
    return {
        id: `resp_${Date.now().toString(36)}`,
        model: targetModel || anthropicRequest.model,
        output: text
            ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]
            : [],
        usage: {
            input_tokens: 0,
            output_tokens: 0,
        },
    };
}

async function parseSuccessfulResponse(
    upstreamResponse: Response,
    anthropicRequest: AnthropicMessageRequest,
    targetModel: string
): Promise<ResponsesResponse> {
    const contentType = upstreamResponse.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        const data = await upstreamResponse.json() as ResponsesResponse;
        return normalizeResponseForAnthropic(data, anthropicRequest, targetModel);
    }

    const text = await readTextSafely(upstreamResponse);
    return createTextFallbackResponse(text, anthropicRequest, targetModel);
}

async function handleUpstreamFailure(reply: FastifyReply, upstreamResponse: Response): Promise<void> {
    const jsonPayload = await readJsonSafely(upstreamResponse.clone()) as ResponsesErrorResponse;
    const rawText = await readTextSafely(upstreamResponse);
    const compactRawText = rawText.trim();
    const message =
        jsonPayload.error?.message ||
        (compactRawText ? compactRawText.slice(0, 2000) : '') ||
        `Upstream request failed with status ${upstreamResponse.status}`;
    const retryAfter = parseRetryAfter(upstreamResponse);
    if (retryAfter) {
        reply.header('Retry-After', retryAfter);
    }

    logger.error('Upstream rejected request', undefined, {
        statusCode: upstreamResponse.status,
        retryAfter: retryAfter ?? undefined,
        upstreamErrorType: jsonPayload.error?.type,
        upstreamBody: compactRawText || undefined,
    });

    const errorResponse = createErrorResponse(new Error(message), upstreamResponse.status || 502);
    reply.code(errorResponse.status).send({ error: errorResponse.error });
}

function recordNonStreamingUsage(data: ResponsesResponse, anthropicRequest: AnthropicMessageRequest, config: AdapterConfig): void {
    recordUsage({
        provider: config.baseUrl,
        modelName: anthropicRequest.model,
        model: data.model,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cachedInputTokens: data.usage?.input_tokens_details?.cached_tokens,
        streaming: false,
    });
}

function isMessageInputItem(item: ResponsesInputItem): item is ResponsesMessageInput | ResponsesMultimodalMessageInput {
    return 'role' in item;
}

function stripToLastUserTurn(input: ResponsesInputItem[]): ResponsesInputItem[] {
    let lastUserIndex = -1;

    for (let index = input.length - 1; index >= 0; index -= 1) {
        const item = input[index];
        if (isMessageInputItem(item) && item.role === 'user') {
            lastUserIndex = index;
            break;
        }
    }

    if (lastUserIndex === -1) {
        return input;
    }

    let startIndex = lastUserIndex;
    while (startIndex > 0) {
        const previousItem = input[startIndex - 1];
        if (!isMessageInputItem(previousItem) || previousItem.role !== 'user') {
            break;
        }
        startIndex -= 1;
    }

    return input.slice(startIndex, lastUserIndex + 1);
}

export function createMessagesHandler(config: AdapterConfig) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const requestId = generateRequestId();
        const log = logger.withRequestId(requestId);
        reply.header('X-Request-Id', requestId);

        try {
            const validation = validateAnthropicRequest(request.body);
            if (!validation.valid) {
                const errorResponse = createErrorResponse(
                    new Error(formatValidationErrors(validation.errors)),
                    400
                );
                reply.code(400).send({ error: errorResponse.error });
                return;
            }

            const anthropicRequest = request.body as AnthropicMessageRequest;
            const unsupported = validateUnsupportedFeatures(anthropicRequest, config);
            if (unsupported.length > 0) {
                throw createStatusError(unsupported.join('; '), 400);
            }

            const targetModel = resolveTargetModel(anthropicRequest.model, config);
            const responsesRequest = convertRequestToResponses(anthropicRequest, targetModel, getToolFormat(config));

            if (config.disableTools) {
                delete responsesRequest.tools;
                delete responsesRequest.tool_choice;
                log.info('experimental mode: tools disabled');
            }

            if (config.disableHistory) {
                const originalInputCount = responsesRequest.input.length;
                responsesRequest.input = stripToLastUserTurn(responsesRequest.input);
                log.info('experimental mode: history disabled', {
                    removedInputItems: originalInputCount - responsesRequest.input.length,
                });
            }

            const requestSummary = summarizeResponsesRequest(responsesRequest);

            log.info(`tool mode=${isXmlMode(config) ? 'xml' : 'native'}`);
            log.info(`→ ${targetModel} [responses]`);
            log.debug('responses payload summary', requestSummary as unknown as Record<string, unknown>);

            const upstreamResponse = await fetchResponses(
                config,
                responsesRequest as unknown as Record<string, unknown>
            );

            if (!upstreamResponse.ok) {
                await handleUpstreamFailure(reply, upstreamResponse);
                return;
            }

            if (anthropicRequest.stream) {
                await streamUpstreamToAnthropic(upstreamResponse, reply, anthropicRequest.model, config);
                log.info(`← ${targetModel} [stream completed]`);
                return;
            }

            const data = await parseSuccessfulResponse(upstreamResponse, anthropicRequest, targetModel);
            if (!data.output || data.output.length === 0) {
                throw createStatusError('Upstream returned an empty non-streaming response', 502);
            }

            recordNonStreamingUsage(data, anthropicRequest, config);
            reply.send(convertResponseToAnthropic(data, anthropicRequest.model));
            log.info(`← ${targetModel} [received]`);
        } catch (error) {
            let statusCode = 500;

            if ('status' in (error as Error & { status?: number }) && typeof (error as { status?: number }).status === 'number') {
                statusCode = (error as { status: number }).status;
            }

            log.error('Request failed', error as Error, { statusCode });
            recordError(error as Error, {
                requestId,
                provider: config.baseUrl,
                modelName: (request.body as AnthropicMessageRequest | undefined)?.model ?? 'unknown',
                streaming: (request.body as AnthropicMessageRequest | undefined)?.stream ?? false,
            });

            const errorResponse = createErrorResponse(error as Error, statusCode);
            reply.code(errorResponse.status).send({ error: errorResponse.error });
        }
    };
}
