import {
    convertToolChoiceToResponses,
    convertToolsToResponses,
    generateToolUseId,
} from '../src/converters/tools';
import { AnthropicToolChoice, AnthropicToolDefinition } from '../src/types/anthropic';

describe('Tool Converters', () => {
    it('converts Anthropic tools to Responses tools', () => {
        const tools: AnthropicToolDefinition[] = [
            {
                name: 'get_weather',
                description: 'Get weather',
                input_schema: {
                    type: 'object',
                    properties: {
                        city: { type: 'string' },
                    },
                    required: ['city'],
                },
            },
        ];

        expect(convertToolsToResponses(tools)).toEqual([
            {
                type: 'function',
                name: 'get_weather',
                description: 'Get weather',
                parameters: {
                    type: 'object',
                    properties: {
                        city: { type: 'string' },
                    },
                    required: ['city'],
                },
            },
        ]);
    });

    it('converts tool_choice values to Responses tool_choice', () => {
        const autoChoice: AnthropicToolChoice = { type: 'auto' };
        const anyChoice: AnthropicToolChoice = { type: 'any' };
        const namedChoice: AnthropicToolChoice = { type: 'tool', name: 'search' };

        expect(convertToolChoiceToResponses(autoChoice)).toBe('auto');
        expect(convertToolChoiceToResponses(anyChoice)).toBe('required');
        expect(convertToolChoiceToResponses(namedChoice)).toEqual({
            type: 'function',
            name: 'search',
        });
    });

    it('generates Anthropic-style tool IDs', () => {
        const ids = new Set(Array.from({ length: 20 }, () => generateToolUseId()));
        expect(ids.size).toBe(20);
        for (const id of ids) {
            expect(id).toMatch(/^toolu_[A-Za-z0-9]{24}$/);
        }
    });
});
