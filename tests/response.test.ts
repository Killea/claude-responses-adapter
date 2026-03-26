import { convertResponseToAnthropic, createErrorResponse } from '../src/converters/response';
import { ResponsesResponse } from '../src/types/responses';

describe('Response Converter', () => {
    it('converts message text output to an Anthropic message', () => {
        const response: ResponsesResponse = {
            id: 'resp_123',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'output_text', text: 'Hello from upstream.' },
                    ],
                },
            ],
            usage: {
                input_tokens: 10,
                output_tokens: 6,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');

        expect(result.id).toBe('msg_resp_123');
        expect(result.model).toBe('claude-sonnet-4-5');
        expect(result.content).toEqual([
            { type: 'text', text: 'Hello from upstream.' },
        ]);
        expect(result.stop_reason).toBe('end_turn');
        expect(result.usage.input_tokens).toBe(10);
        expect(result.usage.output_tokens).toBe(6);
    });

    it('converts function_call output to tool_use', () => {
        const response: ResponsesResponse = {
            id: 'resp_tool',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'function_call',
                    call_id: 'call_123',
                    name: 'search',
                    arguments: '{"query":"weather"}',
                },
            ],
            usage: {
                input_tokens: 12,
                output_tokens: 4,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');

        expect(result.content).toEqual([
            {
                type: 'tool_use',
                id: 'call_123',
                name: 'search',
                input: { query: 'weather' },
            },
        ]);
        expect(result.stop_reason).toBe('tool_use');
    });

    it('maps max_output_tokens incompletion to max_tokens stop_reason', () => {
        const response: ResponsesResponse = {
            id: 'resp_incomplete',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'output_text', text: 'Partial answer' },
                    ],
                },
            ],
            incomplete_details: {
                reason: 'max_output_tokens',
            },
            usage: {
                input_tokens: 3,
                output_tokens: 100,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.stop_reason).toBe('max_tokens');
    });

    it('maps stop_sequence when provided by upstream', () => {
        const response: ResponsesResponse = {
            id: 'resp_stop',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'output_text', text: 'Stopped early' },
                    ],
                },
            ],
            incomplete_details: {
                stop_sequence: '</tool_code>',
            },
            usage: {
                input_tokens: 3,
                output_tokens: 10,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.stop_reason).toBe('stop_sequence');
        expect(result.stop_sequence).toBe('</tool_code>');
    });

    it('keeps raw tool arguments when upstream returns invalid json', () => {
        const response: ResponsesResponse = {
            id: 'resp_bad_tool',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'function_call',
                    call_id: 'call_bad',
                    name: 'search',
                    arguments: '{not-json',
                },
            ],
            usage: {
                input_tokens: 1,
                output_tokens: 1,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.content[0]).toEqual({
            type: 'tool_use',
            id: 'call_bad',
            name: 'search',
            input: { raw: '{not-json' },
        });
    });

    it('supports mixed text and tool outputs', () => {
        const response: ResponsesResponse = {
            id: 'resp_mixed',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Checking now.' }],
                },
                {
                    type: 'function_call',
                    call_id: 'call_123',
                    name: 'search',
                    arguments: '{"query":"weather"}',
                },
            ],
            usage: {
                input_tokens: 1,
                output_tokens: 1,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.content).toEqual([
            { type: 'text', text: 'Checking now.' },
            {
                type: 'tool_use',
                id: 'call_123',
                name: 'search',
                input: { query: 'weather' },
            },
        ]);
        expect(result.stop_reason).toBe('tool_use');
    });

    it('defaults stop_sequence to null when not provided', () => {
        const response: ResponsesResponse = {
            id: 'resp_null_stop',
            model: 'gpt-4.1',
            output: [],
            usage: {
                input_tokens: 1,
                output_tokens: 1,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.stop_sequence).toBeNull();
    });

    it('treats stop_sequence as lower priority than tool_use', () => {
        const response: ResponsesResponse = {
            id: 'resp_tool_stop',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'function_call',
                    call_id: 'call_123',
                    name: 'search',
                    arguments: '{"query":"weather"}',
                },
            ],
            incomplete_details: {
                stop_sequence: '</tool_code>',
            },
            usage: {
                input_tokens: 1,
                output_tokens: 1,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.stop_reason).toBe('tool_use');
        expect(result.stop_sequence).toBe('</tool_code>');
    });

    it('keeps end_turn when there is no stop detail', () => {
        const response: ResponsesResponse = {
            id: 'resp_end_turn',
            model: 'gpt-4.1',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Done' }],
                },
            ],
            usage: {
                input_tokens: 1,
                output_tokens: 1,
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.stop_reason).toBe('end_turn');
    });

    it('maps cached token usage', () => {
        const response: ResponsesResponse = {
            id: 'resp_cache',
            model: 'gpt-4.1',
            output: [],
            usage: {
                input_tokens: 100,
                output_tokens: 5,
                input_tokens_details: {
                    cached_tokens: 80,
                },
            },
        };

        const result = convertResponseToAnthropic(response, 'claude-sonnet-4-5');
        expect(result.usage.cache_read_input_tokens).toBe(80);
    });

    it('creates Anthropic-style errors', () => {
        const result = createErrorResponse(new Error('Unauthorized'), 401);
        expect(result.status).toBe(401);
        expect(result.error.type).toBe('authentication_error');
        expect(result.error.message).toBe('Unauthorized');
    });
});
