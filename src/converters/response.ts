import {
    AnthropicContentBlock,
    AnthropicMessageResponse,
    AnthropicUsage,
} from '../types/anthropic';
import {
    ResponsesFunctionCallOutputItem,
    ResponsesOutputItem,
    ResponsesResponse,
} from '../types/responses';

function textFromOutputItem(item: ResponsesOutputItem): string {
    if (item.type !== 'message' || !item.content) {
        return '';
    }

    return item.content
        .filter((part) => part.type === 'output_text' || part.type === 'text')
        .map((part) => part.text)
        .join('');
}

function convertFunctionCallToToolUse(item: ResponsesFunctionCallOutputItem): AnthropicContentBlock {
    let input: Record<string, unknown>;

    try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
    } catch {
        input = { raw: item.arguments };
    }

    return {
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input,
    };
}

function mapStopReason(response: ResponsesResponse, hasToolUse: boolean): AnthropicMessageResponse['stop_reason'] {
    if (hasToolUse) {
        return 'tool_use';
    }

    if (response.incomplete_details?.reason === 'max_output_tokens') {
        return 'max_tokens';
    }

    if (response.incomplete_details?.stop_sequence) {
        return 'stop_sequence';
    }

    return 'end_turn';
}

export function convertResponseToAnthropic(
    responsesResponse: ResponsesResponse,
    originalModelRequested: string
): AnthropicMessageResponse {
    const content: AnthropicContentBlock[] = [];

    for (const outputItem of responsesResponse.output ?? []) {
        if (outputItem.type === 'message') {
            const text = textFromOutputItem(outputItem);
            if (text) {
                content.push({
                    type: 'text',
                    text,
                });
            }
        }

        if (outputItem.type === 'function_call') {
            content.push(convertFunctionCallToToolUse(outputItem));
        }
    }

    const usage: AnthropicUsage = {
        input_tokens: responsesResponse.usage?.input_tokens ?? 0,
        output_tokens: responsesResponse.usage?.output_tokens ?? 0,
        cache_read_input_tokens: responsesResponse.usage?.input_tokens_details?.cached_tokens,
    };

    const hasToolUse = content.some((block) => block.type === 'tool_use');

    return {
        id: `msg_${responsesResponse.id}`,
        type: 'message',
        role: 'assistant',
        content,
        model: originalModelRequested,
        stop_reason: mapStopReason(responsesResponse, hasToolUse),
        stop_sequence: responsesResponse.incomplete_details?.stop_sequence ?? null,
        usage,
    };
}

export function convertResponsesToAnthropic(
    responsesResponse: ResponsesResponse,
    originalModelRequested: string
): AnthropicMessageResponse {
    return convertResponseToAnthropic(responsesResponse, originalModelRequested);
}

export function createErrorResponse(
    error: Error,
    statusCode: number = 500
): { error: { type: string; message: string }; status: number } {
    return {
        error: {
            type: mapErrorType(statusCode),
            message: error.message,
        },
        status: statusCode,
    };
}

function mapErrorType(statusCode: number): string {
    switch (statusCode) {
        case 400:
            return 'invalid_request_error';
        case 401:
            return 'authentication_error';
        case 403:
            return 'permission_error';
        case 404:
            return 'not_found_error';
        case 429:
            return 'rate_limit_error';
        default:
            return 'api_error';
    }
}
