# API Reference

API documentation for **claude-responses-adapter**.

This project exposes a Claude-compatible surface area and bridges requests to an upstream OpenAI-compatible / Responses-style provider.

## Endpoints

### POST /v1/messages

Primary endpoint for Claude / Anthropic-compatible message requests.

The server accepts Claude-compatible request payloads, transforms them into the configured upstream provider format, and translates the upstream response back into Claude-compatible output.

**Request headers:**
```http
Content-Type: application/json
```

**Request body:**
```typescript
{
  model: string;
  max_tokens: number;
  messages: Message[];
  system?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
  tools?: Tool[];
  tool_choice?: ToolChoice;
}
```

**Message format:**
```typescript
{
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}
```

**Response (non-streaming):**
```typescript
{
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
```

**Response (streaming):**
Server-Sent Events (SSE) with event types such as:
- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

---

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "adapter": "claude-responses-adapter"
}
```

---

## Converter functions

### convertRequestToOpenAI

Converts a Claude / Anthropic-compatible message request into the upstream OpenAI-compatible request format used by this bridge.

```typescript
import { convertRequestToOpenAI } from 'claude-responses-adapter';

const upstreamRequest = convertRequestToOpenAI(anthropicRequest, 'gpt-4');
```

**Parameters:**
- `anthropicRequest: AnthropicMessageRequest`
- `targetModel: string`

**Returns:** `OpenAIChatRequest`

---

### convertResponseToAnthropic

Converts an upstream provider response into Claude-compatible output.

```typescript
import { convertResponseToAnthropic } from 'claude-responses-adapter';

const anthropicResponse = convertResponseToAnthropic(upstreamResponse, 'claude-4-opus');
```

**Parameters:**
- `openaiResponse: OpenAIChatResponse`
- `originalModelRequested: string`

**Returns:** `AnthropicMessageResponse`

---

### streamOpenAIToAnthropic

Transforms an upstream streaming response into Claude-compatible SSE output.

```typescript
import { streamOpenAIToAnthropic } from 'claude-responses-adapter';

await streamOpenAIToAnthropic(upstreamStream, fastifyReply, 'claude-4-opus');
```

---

## Error responses

Errors follow Anthropic-compatible error formatting:

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "Description of the error"
  }
}
```

| Status Code | Error Type              |
| ----------- | ----------------------- |
| 400         | `invalid_request_error` |
| 401         | `authentication_error`  |
| 403         | `permission_error`      |
| 404         | `not_found_error`       |
| 429         | `rate_limit_error`      |
| 500         | `api_error`             |

---

## Configuration type

```typescript
interface AdapterConfig {
  baseUrl: string;
  apiKey: string;
  models: {
    opus: string;
    sonnet: string;
    haiku: string;
  };
}
```

---

## Example usage

```typescript
import { createServer } from 'claude-responses-adapter';

const config = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  models: {
    opus: 'gpt-5.2-codex-max',
    sonnet: 'gpt-5.2-codex',
    haiku: 'gpt-5-mini'
  }
};

const server = createServer(config);
await server.start(3080);
```
