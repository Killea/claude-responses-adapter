jest.mock('../src/utils/tokenUsage', () => ({
    recordUsage: jest.fn(),
}));

jest.mock('../src/utils/errorLog', () => ({
    recordError: jest.fn(),
}));

import { streamResponsesToAnthropic } from '../src/converters/streaming';

class MockRawResponse {
    public chunks: string[] = [];
    public headers: Record<string, string> = {};
    public ended = false;

    setHeader(name: string, value: string): void {
        this.headers[name] = value;
    }

    write(data: string): void {
        this.chunks.push(data);
    }

    end(): void {
        this.ended = true;
    }

    getEvents(): Array<{ event: string; data: any }> {
        const events: Array<{ event: string; data: any }> = [];
        let currentEvent = '';

        for (const chunk of this.chunks) {
            if (chunk.startsWith('event: ')) {
                currentEvent = chunk.slice(7).trim();
            } else if (chunk.startsWith('data: ')) {
                events.push({
                    event: currentEvent,
                    data: JSON.parse(chunk.slice(6).trim()),
                });
            }
        }

        return events;
    }
}

function createSseResponse(events: string[]): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const event of events) {
                controller.enqueue(encoder.encode(event));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
        },
    });
}

describe('Responses Streaming Converter', () => {
    it('streams text deltas into Anthropic SSE events', async () => {
        const raw = new MockRawResponse();
        const reply = { raw } as any;
        const recordUsage = require('../src/utils/tokenUsage').recordUsage;

        const response = createSseResponse([
            'event: response.created\ndata: {"type":"response.created"}\n\n',
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":" world"}\n\n',
            'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-4.1","usage":{"input_tokens":10,"output_tokens":4}}}\n\n',
        ]);

        await streamResponsesToAnthropic(response, reply, 'claude-sonnet-4-5', 'test-provider');

        const events = raw.getEvents();
        expect(raw.headers['Content-Type']).toBe('text/event-stream');
        expect(events[0].data.type).toBe('message_start');
        expect(events.some((event) => event.data.delta?.text === 'Hello')).toBe(true);
        expect(events.some((event) => event.data.delta?.text === ' world')).toBe(true);
        expect(events[events.length - 1].data.type).toBe('message_stop');
        expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'test-provider',
            inputTokens: 10,
            outputTokens: 4,
            streaming: true,
        }));
    });

    it('streams function calls as tool_use blocks', async () => {
        const raw = new MockRawResponse();
        const reply = { raw } as any;

        const response = createSseResponse([
            'event: response.created\ndata: {"type":"response.created"}\n\n',
            'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"search"}}\n\n',
            'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"query\\":\\"weather\\"}"}\n\n',
            'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_2","model":"gpt-4.1","usage":{"input_tokens":7,"output_tokens":2}}}\n\n',
        ]);

        await streamResponsesToAnthropic(response, reply, 'claude-sonnet-4-5');

        const events = raw.getEvents();
        const toolStart = events.find((event) => event.data.content_block?.type === 'tool_use');
        const inputDelta = events.find((event) => event.data.delta?.type === 'input_json_delta');
        const messageDelta = events.find((event) => event.data.type === 'message_delta');

        expect(toolStart?.data.content_block.name).toBe('search');
        expect(inputDelta?.data.delta.partial_json).toBe('{"query":"weather"}');
        expect(messageDelta?.data.delta.stop_reason).toBe('tool_use');
    });

    it('handles function argument deltas that arrive before output_item.added', async () => {
        const raw = new MockRawResponse();
        const reply = { raw } as any;

        const response = createSseResponse([
            'event: response.created\ndata: {"type":"response.created"}\n\n',
            'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item":{"type":"function_call","id":"fc_2","call_id":"call_2","name":"search"},"delta":"{\\"query\\":\\"weather\\"}"}\n\n',
            'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_2","call_id":"call_2","name":"search"}}\n\n',
            'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_3","model":"gpt-4.1","usage":{"input_tokens":7,"output_tokens":2}}}\n\n',
        ]);

        await streamResponsesToAnthropic(response, reply, 'claude-sonnet-4-5');

        const events = raw.getEvents();
        const toolStarts = events.filter((event) => event.data.content_block?.type === 'tool_use');
        const inputDelta = events.find((event) => event.data.delta?.type === 'input_json_delta');

        expect(toolStarts).toHaveLength(1);
        expect(inputDelta?.data.delta.partial_json).toBe('{"query":"weather"}');
    });

    it('propagates stop_sequence from completed response', async () => {
        const raw = new MockRawResponse();
        const reply = { raw } as any;

        const response = createSseResponse([
            'event: response.created\ndata: {"type":"response.created"}\n\n',
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Done"}\n\n',
            'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_4","model":"gpt-4.1","incomplete_details":{"stop_sequence":"</tool_code>"},"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
        ]);

        await streamResponsesToAnthropic(response, reply, 'claude-sonnet-4-5');

        const events = raw.getEvents();
        const messageDelta = events.find((event) => event.data.type === 'message_delta');

        expect(messageDelta?.data.delta.stop_reason).toBe('stop_sequence');
        expect(messageDelta?.data.delta.stop_sequence).toBe('</tool_code>');
    });
});
