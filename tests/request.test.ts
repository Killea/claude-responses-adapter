import {
    convertRequestToOpenAI,
    convertRequestToResponses,
    summarizeResponsesRequest,
} from '../src/converters/request';
import { AnthropicMessageRequest } from '../src/types/anthropic';

describe('Request Converter', () => {
    it('converts simple text input to Responses input', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 512,
            messages: [
                { role: 'user', content: 'Hello there' },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.model).toBe('gpt-4.1');
        expect(result.max_output_tokens).toBe(512);
        expect(result.input).toEqual([
            { role: 'user', content: 'Hello there' },
        ]);
    });

    it('normalizes system prompts into instructions', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            system: [
                { type: 'text', text: 'You are helpful.' },
                { type: 'text', text: 'Be concise.' },
            ],
            messages: [
                { role: 'user', content: 'Hi' },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1-mini');

        expect(result.instructions).toBe('You are helpful.\nBe concise.');
    });

    it('maps tools and tool_choice to Responses format', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            tool_choice: { type: 'tool', name: 'search' },
            tools: [
                {
                    name: 'search',
                    description: 'Search the web',
                    input_schema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string' },
                        },
                        required: ['query'],
                    },
                },
            ],
            messages: [
                { role: 'user', content: 'Search for the weather' },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.tools).toEqual([
            {
                type: 'function',
                name: 'search',
                description: 'Search the web',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                    },
                    required: ['query'],
                },
            },
        ]);
        expect(result.tool_choice).toEqual({
            type: 'function',
            name: 'search',
        });
    });

    it('converts assistant tool_use blocks and user tool_result blocks', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                { role: 'user', content: 'Check the weather' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Let me look that up.' },
                        {
                            type: 'tool_use',
                            id: 'call_weather_1',
                            name: 'get_weather',
                            input: { city: 'Toronto' },
                        },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'call_weather_1',
                            content: 'Sunny',
                        },
                        { type: 'text', text: 'Continue.' },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            { role: 'user', content: 'Check the weather' },
            { role: 'assistant', content: 'Let me look that up.' },
            {
                type: 'function_call',
                call_id: 'call_weather_1',
                name: 'get_weather',
                arguments: '{"city":"Toronto"}',
            },
            {
                type: 'function_call_output',
                call_id: 'call_weather_1',
                output: 'Sunny',
            },
            { role: 'user', content: 'Continue.' },
        ]);
    });

    it('omits empty assistant text when the same turn only performs tool_use', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                { role: 'user', content: 'Check the weather' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: '   ' },
                        {
                            type: 'tool_use',
                            id: 'call_weather_1',
                            name: 'get_weather',
                            input: { city: 'Toronto' },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            { role: 'user', content: 'Check the weather' },
            {
                type: 'function_call',
                call_id: 'call_weather_1',
                name: 'get_weather',
                arguments: '{"city":"Toronto"}',
            },
        ]);
    });

    it('preserves assistant multimodal content when images accompany tool_use', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                { role: 'user', content: 'Check this screenshot' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: '   ' },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: 'ZmFrZQ==',
                            },
                        },
                        {
                            type: 'tool_use',
                            id: 'call_vision_1',
                            name: 'inspect_image',
                            input: { detail: 'high' },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            { role: 'user', content: 'Check this screenshot' },
            {
                role: 'assistant',
                content: [
                    { type: 'input_text', text: '   ' },
                    { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' },
                ],
            },
            {
                type: 'function_call',
                call_id: 'call_vision_1',
                name: 'inspect_image',
                arguments: '{"detail":"high"}',
            },
        ]);
    });

    it('preserves assistant text-only turns without tool_use', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Done.' },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            { role: 'assistant', content: 'Done.' },
        ]);
    });

    it('preserves meaningful assistant text alongside tool_use', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Calling the tool now.' },
                        {
                            type: 'tool_use',
                            id: 'call_1',
                            name: 'lookup',
                            input: { q: 'test' },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            { role: 'assistant', content: 'Calling the tool now.' },
            {
                type: 'function_call',
                call_id: 'call_1',
                name: 'lookup',
                arguments: '{"q":"test"}',
            },
        ]);
    });

    it('preserves assistant image-only turns with tool_use', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: 'ZmFrZQ==',
                            },
                        },
                        {
                            type: 'tool_use',
                            id: 'call_2',
                            name: 'inspect_image',
                            input: { mode: 'fast' },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' },
                ],
            },
            {
                type: 'function_call',
                call_id: 'call_2',
                name: 'inspect_image',
                arguments: '{"mode":"fast"}',
            },
        ]);
    });

    it('omits assistant message when a tool_use turn contains no text or images', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'call_3',
                            name: 'lookup',
                            input: { q: 'test' },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            {
                type: 'function_call',
                call_id: 'call_3',
                name: 'lookup',
                arguments: '{"q":"test"}',
            },
        ]);
    });

    it('preserves assistant text with tool_use when at least one text block is meaningful', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-5',
            max_tokens: 256,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: '   ' },
                        { type: 'text', text: 'Need to inspect this.' },
                        {
                            type: 'tool_use',
                            id: 'call_4',
                            name: 'inspect',
                            input: { value: 1 },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');

        expect(result.input).toEqual([
            { role: 'assistant', content: '   \nNeed to inspect this.' },
            {
                type: 'function_call',
                call_id: 'call_4',
                name: 'inspect',
                arguments: '{"value":1}',
            },
        ]);
    });

    it('repairs max_tokens=1 to a safer max_output_tokens value', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-haiku-4-5',
            max_tokens: 1,
            messages: [
                { role: 'user', content: 'Ping' },
            ],
        };

        const result = convertRequestToOpenAI(anthropicRequest, 'gpt-4.1-nano');

        expect(result.max_output_tokens).toBe(32);
    });

    it('omits stop sequences, top_k, and metadata user id for provider compatibility', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-opus-4-1',
            max_tokens: 256,
            top_k: 42,
            stop_sequences: ['</tool_code>'],
            metadata: { user_id: 'user-123' },
            messages: [
                { role: 'user', content: 'Hello' },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-5.4');

        expect(result.top_k).toBeUndefined();
        expect(result.stop).toBeUndefined();
        expect(result.user).toBeUndefined();
    });

    it('injects xml tool instructions and omits native tools in xml mode', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-6',
            max_tokens: 256,
            system: 'You are helpful.',
            tools: [
                {
                    name: 'Read',
                    description: 'Read a file',
                    input_schema: {
                        type: 'object',
                        properties: { file_path: { type: 'string' } },
                        required: ['file_path'],
                    },
                },
            ],
            messages: [
                { role: 'user', content: 'Use a tool' },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-5-codex', 'xml');

        expect(result.instructions).toContain('# TOOL CALLING FORMAT');
        expect(result.instructions).toContain('Read');
        expect(result.tools).toBeUndefined();
        expect(result.tool_choice).toBeUndefined();
    });

    it('converts image blocks into responses multimodal input', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-6',
            max_tokens: 256,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe this' },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: 'ZmFrZQ==',
                            },
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-5-codex');

        expect(result.input[0]).toEqual({
            role: 'user',
            content: [
                { type: 'input_text', text: 'Describe this' },
                { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' },
            ],
        });
    });

    it('summarizes request payload sizes without exposing raw content', () => {
        const anthropicRequest: AnthropicMessageRequest = {
            model: 'claude-sonnet-4-6',
            max_tokens: 256,
            system: 'You are helpful.',
            tools: [
                {
                    name: 'search',
                    description: 'Search the web',
                    input_schema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string' },
                        },
                        required: ['query'],
                    },
                },
            ],
            messages: [
                { role: 'user', content: 'Search for weather' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Checking now.' },
                        {
                            type: 'tool_use',
                            id: 'call_1',
                            name: 'search',
                            input: { query: 'weather' },
                        },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'call_1',
                            content: 'Sunny and 20C',
                        },
                    ],
                },
            ],
        };

        const result = convertRequestToResponses(anthropicRequest, 'gpt-4.1');
        const summary = summarizeResponsesRequest(result);

        expect(summary.instructionsChars).toBeGreaterThan(0);
        expect(summary.toolCount).toBe(1);
        expect(summary.toolsChars).toBeGreaterThan(0);
        expect(summary.inputItemCount).toBe(result.input.length);
        expect(summary.inputChars).toBeGreaterThan(0);
        expect(summary.totalRequestChars).toBeGreaterThan(summary.inputChars);
        expect(summary.inputItems).toEqual([
            expect.objectContaining({ index: 0, kind: 'message:user' }),
            expect.objectContaining({ index: 1, kind: 'message:assistant' }),
            expect.objectContaining({ index: 2, kind: 'function_call' }),
            expect.objectContaining({ index: 3, kind: 'function_call_output' }),
        ]);
        expect(summary.inputItems.every((item) => item.chars > 0)).toBe(true);
    });
});
