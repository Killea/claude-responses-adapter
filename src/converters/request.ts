import {
    AnthropicContentBlock,
    AnthropicImageBlock,
    AnthropicMessage,
    AnthropicMessageRequest,
    AnthropicSystemContent,
    AnthropicToolResultBlock,
    AnthropicToolUseBlock,
} from '../types/anthropic';
import {
    ResponsesCreateRequest,
    ResponsesInputItem,
    ResponsesMessageInput,
    ResponsesMultimodalMessageInput,
} from '../types/responses';

export interface ResponsesInputItemSummary {
    index: number;
    kind: 'message:user' | 'message:assistant' | 'message:system' | 'function_call' | 'function_call_output';
    chars: number;
}

export interface ResponsesRequestSummary {
    instructionsChars: number;
    toolCount: number;
    toolsChars: number;
    inputItemCount: number;
    inputChars: number;
    totalRequestChars: number;
    hasUser: boolean;
    hasStop: boolean;
    hasTopK: boolean;
    inputItems: ResponsesInputItemSummary[];
}

function measureChars(value: unknown): number {
    if (value === undefined) {
        return 0;
    }

    return JSON.stringify(value).length;
}

function summarizeInputItem(item: ResponsesInputItem, index: number): ResponsesInputItemSummary {
    if ('type' in item) {
        return {
            index,
            kind: item.type,
            chars: measureChars(item),
        };
    }

    return {
        index,
        kind: `message:${item.role}`,
        chars: measureChars(item),
    };
}

export function summarizeResponsesRequest(request: ResponsesCreateRequest): ResponsesRequestSummary {
    return {
        instructionsChars: measureChars(request.instructions),
        toolCount: request.tools?.length ?? 0,
        toolsChars: measureChars(request.tools),
        inputItemCount: request.input.length,
        inputChars: measureChars(request.input),
        totalRequestChars: measureChars(request),
        hasUser: request.user !== undefined,
        hasStop: Array.isArray(request.stop) && request.stop.length > 0,
        hasTopK: request.top_k !== undefined,
        inputItems: request.input.map((item, index) => summarizeInputItem(item, index)),
    };
}

import { generateXmlToolInstructions, hasXmlToolInstructions } from './xmlPrompt';
import { convertToolChoiceToResponses, convertToolsToResponses } from './tools';

function normalizeSystemPrompt(system?: string | AnthropicSystemContent[]): string | undefined {
    if (!system) {
        return undefined;
    }

    if (typeof system === 'string') {
        return system;
    }

    return system.map((entry) => entry.text).join('\n');
}

function withXmlToolInstructions(
    instructions: string | undefined,
    anthropicRequest: AnthropicMessageRequest,
    toolFormat: 'native' | 'xml'
): string | undefined {
    if (toolFormat !== 'xml' || !anthropicRequest.tools?.length) {
        return instructions;
    }

    const xmlInstructions = generateXmlToolInstructions(anthropicRequest.tools);
    if (!instructions) {
        return xmlInstructions.trim();
    }

    if (hasXmlToolInstructions(instructions)) {
        return instructions;
    }

    return `${instructions}\n\n${xmlInstructions.trim()}`;
}

function extractTextFromBlocks(blocks: AnthropicContentBlock[]): string {
    return blocks
        .filter((block): block is Extract<AnthropicContentBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
}

function convertImageBlock(block: AnthropicImageBlock) {
    return {
        type: 'input_image' as const,
        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
    };
}

function createMessageItem(role: 'user' | 'assistant', contentBlocks: AnthropicContentBlock[]): ResponsesMessageInput | ResponsesMultimodalMessageInput | null {
    const supportedBlocks = contentBlocks.filter((block) => block.type === 'text' || block.type === 'image');
    if (supportedBlocks.length === 0) {
        return null;
    }

    const hasImage = supportedBlocks.some((block) => block.type === 'image');
    if (!hasImage) {
        return {
            role,
            content: supportedBlocks
                .filter((block): block is Extract<AnthropicContentBlock, { type: 'text' }> => block.type === 'text')
                .map((block) => block.text)
                .join('\n'),
        };
    }

    return {
        role,
        content: supportedBlocks.map((block) => {
            if (block.type === 'text') {
                return {
                    type: 'input_text' as const,
                    text: block.text,
                };
            }

            return convertImageBlock(block as AnthropicImageBlock);
        }),
    };
}

function convertUserMessage(msg: AnthropicMessage): ResponsesInputItem[] {
    if (typeof msg.content === 'string') {
        return [{ role: 'user', content: msg.content }];
    }

    const items: ResponsesInputItem[] = [];
    const supportedMessageItem = createMessageItem('user', msg.content);

    for (const block of msg.content) {
        if (block.type === 'tool_result') {
            const toolResult = block as AnthropicToolResultBlock;
            const content = typeof toolResult.content === 'string'
                ? toolResult.content
                : extractTextFromBlocks(toolResult.content);

            items.push({
                type: 'function_call_output',
                call_id: toolResult.tool_use_id,
                output: toolResult.is_error ? `Error: ${content}` : content,
            });
        }
    }

    if (supportedMessageItem) {
        items.push(supportedMessageItem);
    }

    return items;
}

function convertAssistantMessage(msg: AnthropicMessage): ResponsesInputItem[] {
    if (typeof msg.content === 'string') {
        return [{ role: 'assistant', content: msg.content }];
    }

    const items: ResponsesInputItem[] = [];
    const hasToolUse = msg.content.some((block) => block.type === 'tool_use');
    const hasMeaningfulText = msg.content.some(
        (block): block is Extract<AnthropicContentBlock, { type: 'text' }> => block.type === 'text' && block.text.trim().length > 0
    );
    const hasImage = msg.content.some((block) => block.type === 'image');
    const shouldIncludeMessageItem = !hasToolUse || hasMeaningfulText || hasImage;
    const supportedMessageItem = shouldIncludeMessageItem ? createMessageItem('assistant', msg.content) : null;

    for (const block of msg.content) {
        if (block.type === 'tool_use') {
            const toolUse = block as AnthropicToolUseBlock;
            items.push({
                type: 'function_call',
                call_id: toolUse.id,
                name: toolUse.name,
                arguments: JSON.stringify(toolUse.input),
            });
        }
    }

    if (supportedMessageItem) {
        items.unshift(supportedMessageItem);
    }

    return items;
}

function convertMessages(messages: AnthropicMessage[]): ResponsesInputItem[] {
    const input: ResponsesInputItem[] = [];

    for (const message of messages) {
        if (message.role === 'user') {
            input.push(...convertUserMessage(message));
        } else {
            input.push(...convertAssistantMessage(message));
        }
    }

    return input;
}

export function convertRequestToResponses(
    anthropicRequest: AnthropicMessageRequest,
    targetModel: string,
    toolFormat: 'native' | 'xml' = 'native'
): ResponsesCreateRequest {
    const request: ResponsesCreateRequest = {
        model: targetModel,
        input: convertMessages(anthropicRequest.messages),
        stream: anthropicRequest.stream ?? false,
        max_output_tokens: anthropicRequest.max_tokens === 1 ? 32 : anthropicRequest.max_tokens,
    };

    const instructions = withXmlToolInstructions(
        normalizeSystemPrompt(anthropicRequest.system),
        anthropicRequest,
        toolFormat
    );
    if (instructions) {
        request.instructions = instructions;
    }

    if (anthropicRequest.temperature !== undefined) {
        request.temperature = anthropicRequest.temperature;
    }

    if (anthropicRequest.top_p !== undefined) {
        request.top_p = anthropicRequest.top_p;
    }

    // Responses providers are often stricter than Chat Completions-compatible APIs.
    // We intentionally do not forward Anthropic-only/less-portable fields like top_k
    // or stop_sequences by default to avoid upstream 400 validation failures.
    //
    // We also omit metadata.user_id for compatibility with providers that reject it.

    if (anthropicRequest.tools?.length && toolFormat === 'native') {
        request.tools = convertToolsToResponses(anthropicRequest.tools);
    }

    if (anthropicRequest.tool_choice && toolFormat === 'native') {
        request.tool_choice = convertToolChoiceToResponses(anthropicRequest.tool_choice);
    }

    return request;
}

export function convertRequestToOpenAI(
    anthropicRequest: AnthropicMessageRequest,
    targetModel: string,
    toolFormat: 'native' | 'xml' = 'native'
): ResponsesCreateRequest {
    return convertRequestToResponses(anthropicRequest, targetModel, toolFormat);
}

export type { ResponsesMessageInput };
