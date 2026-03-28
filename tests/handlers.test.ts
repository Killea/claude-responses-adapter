import { FastifyReply } from 'fastify';
import { createMessagesHandler } from '../src/server/handlers';

jest.mock('../src/converters/streaming', () => ({
    streamResponsesToAnthropic: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/converters/xmlStreaming', () => ({
    streamXmlOpenAIToAnthropic: jest.fn().mockResolvedValue(undefined),
}));

const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
};

jest.mock('../src/utils/logger', () => ({
    logger: {
        withRequestId: () => mockLogger
    }
}));

jest.mock('../src/utils/tokenUsage', () => ({
    recordUsage: jest.fn(),
}));

jest.mock('../src/utils/errorLog', () => ({
    recordError: jest.fn(),
}));

function createMockReply() {
    let statusCode = 200;
    let sentBody: any;
    const raw = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
    };

    const reply = {
        raw,
        header: jest.fn().mockReturnThis(),
        code: jest.fn().mockImplementation((code: number) => {
            statusCode = code;
            return reply;
        }),
        send: jest.fn().mockImplementation((body: any) => {
            sentBody = body;
            return reply;
        }),
    } as unknown as FastifyReply;

    return {
        reply,
        raw,
        getStatusCode: () => statusCode,
        getBody: () => sentBody,
    };
}

const baseConfig = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    models: { opus: 'gpt-4.1', sonnet: 'gpt-4.1-mini', haiku: 'gpt-4.1-nano' },
};

describe('Request Handlers', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    it('logs payload summary metrics without raw request content', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_123',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Hello from test' }],
                    },
                ],
                usage: { input_tokens: 9, output_tokens: 5 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native' });
        const { reply } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                system: 'You are helpful.',
                tools: [
                    {
                        name: 'search',
                        description: 'Search the web',
                        input_schema: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query'],
                        },
                    },
                ],
                messages: [{ role: 'user', content: 'Hello' }],
                stream: false,
            },
        } as any, reply);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            'responses payload summary',
            expect.objectContaining({
                instructionsChars: expect.any(Number),
                toolCount: 1,
                toolsChars: expect.any(Number),
                inputItemCount: 1,
                inputChars: expect.any(Number),
                totalRequestChars: expect.any(Number),
                inputItems: [
                    expect.objectContaining({
                        index: 0,
                        kind: 'message:user',
                        chars: expect.any(Number),
                    }),
                ],
            })
        );

        const [, summary] = mockLogger.debug.mock.calls.find(([message]: [string]) => message === 'responses payload summary') ?? [];
        expect(summary).toBeDefined();
        expect(JSON.stringify(summary)).not.toContain('You are helpful.');
        expect(JSON.stringify(summary)).not.toContain('Hello');
    });

    it('omits tools from upstream payload when disableTools is enabled', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_123',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Hello from test' }],
                    },
                ],
                usage: { input_tokens: 9, output_tokens: 5 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native', disableTools: true });
        const { reply } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                tool_choice: { type: 'tool', name: 'search' },
                tools: [
                    {
                        name: 'search',
                        description: 'Search the web',
                        input_schema: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query'],
                        },
                    },
                ],
                messages: [{ role: 'user', content: 'Hello' }],
                stream: false,
            },
        } as any, reply);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(options.body as string);
        expect(payload.tools).toBeUndefined();
        expect(payload.tool_choice).toBeUndefined();
        expect(mockLogger.info).toHaveBeenCalledWith('experimental mode: tools disabled');
    });

    it('keeps only the last user turn when disableHistory is enabled', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_123',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Hello from test' }],
                    },
                ],
                usage: { input_tokens: 9, output_tokens: 5 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native', disableHistory: true });
        const { reply } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'reply' },
                    { role: 'user', content: 'last' },
                ],
                stream: false,
            },
        } as any, reply);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(options.body as string);
        expect(payload.input).toEqual([{ role: 'user', content: 'last' }]);
        expect(mockLogger.info).toHaveBeenCalledWith('experimental mode: history disabled', { removedInputItems: 2 });
    });

    it('preserves input when disableHistory is enabled but no user turn exists', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_123',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Hello from test' }],
                    },
                ],
                usage: { input_tokens: 9, output_tokens: 5 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native', disableHistory: true });
        const { reply } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [
                    { role: 'assistant', content: 'reply' },
                ],
                stream: false,
            },
        } as any, reply);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(options.body as string);
        expect(payload.input).toEqual([{ role: 'assistant', content: 'reply' }]);
        expect(mockLogger.info).toHaveBeenCalledWith('experimental mode: history disabled', { removedInputItems: 0 });
    });

    it('supports disabling tools and history together', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_123',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Hello from test' }],
                    },
                ],
                usage: { input_tokens: 9, output_tokens: 5 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native', disableTools: true, disableHistory: true });
        const { reply } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                tool_choice: { type: 'tool', name: 'search' },
                tools: [
                    {
                        name: 'search',
                        description: 'Search the web',
                        input_schema: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query'],
                        },
                    },
                ],
                messages: [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'reply' },
                    { role: 'user', content: 'last' },
                ],
                stream: false,
            },
        } as any, reply);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(options.body as string);
        expect(payload.tools).toBeUndefined();
        expect(payload.tool_choice).toBeUndefined();
        expect(payload.input).toEqual([{ role: 'user', content: 'last' }]);
    });

    it('returns 400 for invalid Anthropic requests', async () => {
        const handler = createMessagesHandler(baseConfig);
        const { reply, getStatusCode, getBody } = createMockReply();

        await handler({ body: { invalid: true } } as any, reply);

        expect(getStatusCode()).toBe(400);
        expect(getBody().error.type).toBe('invalid_request_error');
    });

    it('maps model aliases before sending to upstream', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_123',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Hello from test' }],
                    },
                ],
                usage: { input_tokens: 9, output_tokens: 5 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native' });
        const { reply, getBody } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [{ role: 'user', content: 'Hello' }],
                stream: false,
            },
        } as any, reply);

        expect(getBody()).toEqual(expect.objectContaining({
            type: 'message',
            model: 'claude-sonnet-4-5',
        }));

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(options.body as string);
        expect(payload.model).toBe('gpt-4.1-mini');
    });

    it('delegates streaming responses to the native streaming converter', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response('event: response.created\ndata: {"type":"response.created"}\n\n', {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'native' });
        const { reply } = createMockReply();
        const { streamResponsesToAnthropic } = require('../src/converters/streaming');

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true,
            },
        } as any, reply);

        expect(streamResponsesToAnthropic).toHaveBeenCalled();
    });

    it('delegates streaming responses to the XML converter in xml mode', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            body: {
                async *[Symbol.asyncIterator]() {
                    yield { choices: [{ delta: { content: 'hello' }, finish_reason: null }] };
                }
            }
        }) as unknown as typeof fetch;

        const handler = createMessagesHandler({ ...baseConfig, toolFormat: 'xml' });
        const { reply } = createMockReply();
        const { streamXmlOpenAIToAnthropic } = require('../src/converters/xmlStreaming');

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true,
            },
        } as any, reply);

        expect(streamXmlOpenAIToAnthropic).toHaveBeenCalled();
    });

    it('retries the direct responses endpoint when /v1/responses returns 404', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(new Response('404 page not found', { status: 404 }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({
                    id: 'resp_fallback',
                    model: 'gpt-4.1-mini',
                    output: [
                        {
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: 'Recovered via fallback' }],
                        },
                    ],
                    usage: { input_tokens: 4, output_tokens: 3 },
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            ) as unknown as typeof fetch;

        const handler = createMessagesHandler({
            ...baseConfig,
            baseUrl: 'https://example.com/openai',
            toolFormat: 'native',
        });
        const { reply, getBody } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [{ role: 'user', content: 'Hello' }],
                stream: false,
            },
        } as any, reply);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://example.com/openai/v1/responses');
        expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe('https://example.com/openai/responses');
        expect(getBody()).toEqual(expect.objectContaining({
            type: 'message',
            model: 'claude-sonnet-4-5',
        }));
    });

    it('uses a fully qualified responses endpoint as-is', async () => {
        global.fetch = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'resp_direct',
                model: 'gpt-4.1-mini',
                output: [
                    {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'Direct endpoint works' }],
                    },
                ],
                usage: { input_tokens: 4, output_tokens: 3 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        ) as unknown as typeof fetch;

        const handler = createMessagesHandler({
            ...baseConfig,
            baseUrl: 'https://example.com/custom/responses',
            toolFormat: 'native',
        });
        const { reply } = createMockReply();

        await handler({
            body: {
                model: 'claude-sonnet-4-5',
                max_tokens: 128,
                messages: [{ role: 'user', content: 'Hello' }],
                stream: false,
            },
        } as any, reply);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://example.com/custom/responses');
    });
});
