import { AnthropicToolChoice, AnthropicToolDefinition } from '../types/anthropic';
import { ResponsesTool, ResponsesToolChoice } from '../types/responses';

export function convertToolsToResponses(tools: AnthropicToolDefinition[]): ResponsesTool[] {
    return tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
    }));
}

export function convertToolChoiceToResponses(toolChoice: AnthropicToolChoice): ResponsesToolChoice {
    switch (toolChoice.type) {
        case 'auto':
            return 'auto';
        case 'any':
            return 'required';
        case 'tool':
            return toolChoice.name
                ? { type: 'function', name: toolChoice.name }
                : 'auto';
        default:
            return 'auto';
    }
}

export function generateToolUseId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'toolu_';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
