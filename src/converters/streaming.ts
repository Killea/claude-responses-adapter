import { FastifyReply } from 'fastify';
import { recordError } from '../utils/errorLog';
import { recordUsage } from '../utils/tokenUsage';
import { ResponsesResponse, ResponsesStreamEvent } from '../types/responses';

interface StreamingToolState {
    index: number;
    callId: string;
    name: string;
}

interface StreamingState {
    messageId: string;
    model: string;
    provider: string;
    responseModel?: string;
    contentBlockIndex: number;
    textBlockOpen: boolean;
    started: boolean;
    sawToolUse: boolean;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
    };
    toolsByKey: Map<string, StreamingToolState>;
    toolsByCallId: Map<string, StreamingToolState>;
}

function sendSse(raw: FastifyReply['raw'], data: Record<string, unknown>): void {
    raw.write(`event: ${data.type}\n`);
    raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendMessageStart(state: StreamingState, raw: FastifyReply['raw']): void {
    sendSse(raw, {
        type: 'message_start',
        message: {
            id: state.messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: state.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: state.usage.inputTokens,
                output_tokens: state.usage.outputTokens,
                cache_read_input_tokens: state.usage.cachedInputTokens,
            },
        },
    });
}

function ensureMessageStart(state: StreamingState, raw: FastifyReply['raw']): void {
    if (!state.started) {
        sendMessageStart(state, raw);
        state.started = true;
    }
}

function ensureTextBlock(state: StreamingState, raw: FastifyReply['raw']): number {
    ensureMessageStart(state, raw);

    if (!state.textBlockOpen) {
        sendSse(raw, {
            type: 'content_block_start',
            index: state.contentBlockIndex,
            content_block: {
                type: 'text',
                text: '',
            },
        });
        state.textBlockOpen = true;
    }

    return state.contentBlockIndex;
}

function closeTextBlock(state: StreamingState, raw: FastifyReply['raw']): void {
    if (!state.textBlockOpen) {
        return;
    }

    sendSse(raw, {
        type: 'content_block_stop',
        index: state.contentBlockIndex,
    });
    state.textBlockOpen = false;
    state.contentBlockIndex += 1;
}

function registerToolBlock(
    state: StreamingState,
    raw: FastifyReply['raw'],
    key: string,
    callId: string,
    name: string
): StreamingToolState {
    const existing = state.toolsByKey.get(key) || state.toolsByCallId.get(callId);
    if (existing) {
        state.toolsByKey.set(key, existing);
        state.toolsByCallId.set(callId, existing);
        return existing;
    }

    ensureMessageStart(state, raw);
    closeTextBlock(state, raw);

    const index = state.contentBlockIndex;
    state.contentBlockIndex += 1;
    state.sawToolUse = true;

    const tool: StreamingToolState = { index, callId, name };
    state.toolsByKey.set(key, tool);
    state.toolsByCallId.set(callId, tool);

    sendSse(raw, {
        type: 'content_block_start',
        index,
        content_block: {
            type: 'tool_use',
            id: callId,
            name,
            input: {},
        },
    });

    return tool;
}

function resolveTool(state: StreamingState, event: ResponsesStreamEvent): StreamingToolState | undefined {
    const possibleKeys = [
        event.item_id,
        event.item?.id,
        event.item?.call_id,
        event.output_index !== undefined ? String(event.output_index) : undefined,
    ].filter((value): value is string => Boolean(value));

    for (const key of possibleKeys) {
        const tool = state.toolsByKey.get(key) || state.toolsByCallId.get(key);
        if (tool) {
            return tool;
        }
    }

    return undefined;
}

function responseStopReason(state: StreamingState, response?: ResponsesResponse): 'tool_use' | 'max_tokens' | 'stop_sequence' | 'end_turn' {
    if (state.sawToolUse) {
        return 'tool_use';
    }

    if (response?.incomplete_details?.reason === 'max_output_tokens') {
        return 'max_tokens';
    }

    if (response?.incomplete_details?.stop_sequence) {
        return 'stop_sequence';
    }

    return 'end_turn';
}

function responseStopSequence(response?: ResponsesResponse): string | null {
    return response?.incomplete_details?.stop_sequence ?? null;
}

function updateUsageFromResponse(state: StreamingState, response?: ResponsesResponse): void {
    if (!response?.usage) {
        return;
    }

    state.responseModel = response.model || state.responseModel;
    state.usage.inputTokens = response.usage.input_tokens ?? state.usage.inputTokens;
    state.usage.outputTokens = response.usage.output_tokens ?? state.usage.outputTokens;
    state.usage.cachedInputTokens = response.usage.input_tokens_details?.cached_tokens ?? state.usage.cachedInputTokens;
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ResponsesStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
            const boundary = buffer.indexOf('\n\n');
            if (boundary === -1) {
                break;
            }

            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const lines = rawEvent.split(/\r?\n/);
            let eventType = '';
            const dataLines: string[] = [];

            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventType = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trim());
                }
            }

            const payload = dataLines.join('\n');
            if (!payload || payload === '[DONE]') {
                continue;
            }

            const parsed = JSON.parse(payload) as Record<string, unknown>;
            yield {
                ...(parsed as unknown as ResponsesStreamEvent),
                type: eventType || String(parsed.type || ''),
            };
        }
    }
}

function finishStream(state: StreamingState, raw: FastifyReply['raw'], response?: ResponsesResponse): void {
    closeTextBlock(state, raw);

    const closed = new Set<number>();
    for (const tool of state.toolsByKey.values()) {
        if (closed.has(tool.index)) {
            continue;
        }

        sendSse(raw, {
            type: 'content_block_stop',
            index: tool.index,
        });
        closed.add(tool.index);
    }

    sendSse(raw, {
        type: 'message_delta',
        delta: {
            stop_reason: responseStopReason(state, response),
            stop_sequence: responseStopSequence(response),
        },
        usage: {
            output_tokens: state.usage.outputTokens,
            cache_read_input_tokens: state.usage.cachedInputTokens,
        },
    });

    sendSse(raw, { type: 'message_stop' });

    recordUsage({
        provider: state.provider,
        modelName: state.model,
        model: state.responseModel,
        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens,
        cachedInputTokens: state.usage.cachedInputTokens || undefined,
        streaming: true,
    });

    raw.end();
}

function failStream(state: StreamingState, raw: FastifyReply['raw'], error: Error): void {
    recordError(error, {
        requestId: state.messageId,
        provider: state.provider,
        modelName: state.model,
        streaming: true,
    });

    sendSse(raw, {
        type: 'error',
        error: {
            type: 'api_error',
            message: error.message,
        },
    });

    raw.end();
}

export async function streamResponsesToAnthropic(
    upstreamResponse: Response,
    reply: FastifyReply,
    originalModel: string,
    provider: string = ''
): Promise<void> {
    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');

    const state: StreamingState = {
        messageId: `msg_${Date.now().toString(36)}`,
        model: originalModel,
        provider,
        responseModel: undefined,
        contentBlockIndex: 0,
        textBlockOpen: false,
        started: false,
        sawToolUse: false,
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
        },
        toolsByKey: new Map(),
        toolsByCallId: new Map(),
    };

    if (!upstreamResponse.body) {
        failStream(state, raw, new Error('Upstream stream body is empty'));
        return;
    }

    let completedResponse: ResponsesResponse | undefined;

    try {
        for await (const event of parseSseStream(upstreamResponse.body)) {
            if (!event.type) {
                continue;
            }

            if (event.response) {
                updateUsageFromResponse(state, event.response);
            }

            if (event.type === 'response.created') {
                ensureMessageStart(state, raw);
                continue;
            }

            if (event.type === 'response.output_text.delta') {
                const index = ensureTextBlock(state, raw);
                sendSse(raw, {
                    type: 'content_block_delta',
                    index,
                    delta: {
                        type: 'text_delta',
                        text: event.delta ?? '',
                    },
                });
                continue;
            }

            if (event.type === 'response.output_text.done') {
                closeTextBlock(state, raw);
                continue;
            }

            if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
                const key = event.item.id || event.item.call_id || String(event.output_index ?? state.toolsByKey.size);
                registerToolBlock(state, raw, key, event.item.call_id, event.item.name);
                continue;
            }

            if (event.type === 'response.function_call_arguments.delta') {
                let tool = resolveTool(state, event);
                if (!tool && event.item?.type === 'function_call') {
                    const key = event.item.id || event.item.call_id || String(event.output_index ?? state.toolsByKey.size);
                    tool = registerToolBlock(state, raw, key, event.item.call_id, event.item.name);
                }

                if (!tool) {
                    continue;
                }

                sendSse(raw, {
                    type: 'content_block_delta',
                    index: tool.index,
                    delta: {
                        type: 'input_json_delta',
                        partial_json: event.delta ?? '',
                    },
                });
                continue;
            }

            if (event.type === 'response.output_item.done') {
                continue;
            }

            if (event.type === 'response.completed') {
                completedResponse = event.response;
                updateUsageFromResponse(state, completedResponse);
                break;
            }

            if (event.type === 'response.failed') {
                throw new Error(event.response?.error?.message || 'Responses API request failed');
            }

            if (event.type === 'error') {
                throw new Error(event.error?.message || 'Responses API stream error');
            }
        }

        finishStream(state, raw, completedResponse);
    } catch (error) {
        failStream(state, raw, error as Error);
    }
}

export async function streamOpenAIToAnthropic(
    upstreamResponse: Response,
    reply: FastifyReply,
    originalModel: string,
    provider: string = ''
): Promise<void> {
    await streamResponsesToAnthropic(upstreamResponse, reply, originalModel, provider);
}
