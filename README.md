<div align="center">

# claude-responses-adapter

![claude-responses-adapter banner](assets/banner.png)

**A protocol bridge from Claude-compatible clients to Responses API and Codex-compatible backends**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/claude-responses-adapter.svg)](https://nodejs.org)

[Overview](#overview) •
[Getting Started](#getting-started) •
[Configuration](#configuration) •
[API Reference](#api-reference) •
[Development](#development)

</div>

---

## Overview

`claude-responses-adapter` is a local protocol bridge. It accepts Claude / Anthropic-compatible traffic on one side and forwards translated requests to Responses API, OpenAI-compatible backends, or third-party APIs that expose Codex-capable models on the other.

In practice, that means you can use this adapter not only with official OpenAI endpoints, but also with self-hosted or commercial third-party providers as long as they offer a compatible API surface and the Codex model IDs you want to map.

This repository should not be read as a drop-in continuation of the original `claude-adapter` project. It started from that codebase, but the project goal here is more specific: run Claude-compatible clients against a different upstream protocol surface, while preserving the parts that matter in practice such as streaming, tool use, and model aliasing.

> **Upstream attribution**
> This project is based on [shantoislamdev/claude-adapter](https://github.com/shantoislamdev/claude-adapter). That repository provided the initial foundation, but this codebase has since diverged substantially in protocol focus, product framing, and runtime workflow.

### What this project is

- A local bridge for **Claude-compatible clients**
- A translator for **request / response / streaming / tool-calling** semantics
- A way to point Claude-oriented tooling at **Responses-style upstream providers**
- A way to connect **Claude Code workflows to third-party Codex APIs** through a local compatible endpoint

### What this project is not

- Not the upstream `claude-adapter` repository
- Not a generic “adapt any model for Claude Code” compatibility layer
- Not primarily positioned around preserving the upstream product branding

### How it differs from the upstream project

- **Narrower purpose** — this repo is centered on Claude-compatible to Responses-style protocol bridging.
- **Different protocol story** — the implementation is optimized around the translation paths this bridge needs, rather than broad model-adaptation messaging.
- **Different operator experience** — the CLI and docs are framed around running a local bridge process and wiring Claude-compatible clients into it.

### Key features

- **Protocol translation** — maps Claude / Anthropic-compatible request structures into upstream provider formats.
- **Streaming support** — preserves server-sent event behavior so Claude-compatible clients can stream responses through the bridge.
- **Tool calling compatibility** — translates tool definitions and tool-use flows across protocol boundaries.
- **Interactive setup** — provides a CLI configuration flow for base URL, API key, and model mapping.
- **Local proxy operation** — runs as a local HTTP bridge without patching the Claude Code binary.
- **Third-party Codex API support** — works with compatible upstream providers that expose Codex-family models via Responses-style or OpenAI-compatible APIs.

---

## Architecture

The adapter runs as a local HTTP bridge between a Claude-compatible client and an upstream provider.

```
┌────────────────────┐      ┌──────────────────────────┐      ┌────────────────────────────┐
│ Claude-compatible  │ ───▶ │ claude-responses-adapter │ ───▶ │ Responses / OpenAI-style   │
│ client             │ ◀─── │ protocol bridge          │ ◀─── │ or third-party Codex API   │
└────────────────────┘      └──────────────────────────┘      └────────────────────────────┘
   Claude/Anthropic            Request + response mapping         Upstream provider protocol
```

When the client sends a Claude-compatible request, `claude-responses-adapter` intercepts it, transforms the payload into the configured upstream format, forwards it to the provider, then converts the response back into the Claude-compatible format expected by the client.

---

## Getting Started

### Prerequisites

- **Node.js**: version 20 or higher
- **API access**: an API key for a supported upstream provider

### Installation

```bash
npm install -g claude-responses-adapter
```

### Quick start

1. Start the interactive setup:
   ```bash
   claude-responses-adapter
   ```

2. Provide the required configuration:
   - **Base URL** for your upstream provider
   - **API key**
   - **Model mapping** for `opus`, `sonnet`, and `haiku`

3. If you are using a third-party Codex API, enter that provider's compatible base URL and map each Claude tier to the Codex model ID exposed by that provider.

4. The adapter starts a local bridge server and, unless disabled, updates Claude settings so Claude-compatible tooling targets that local endpoint.

### Using third-party Codex APIs

`claude-responses-adapter` can be used with third-party providers, API gateways, or self-hosted services that expose Codex-family models through a compatible upstream API.

Typical setup looks like this:

- Set `baseUrl` to the third-party provider endpoint, not necessarily `https://api.openai.com/v1`
- Use the provider-issued API key
- Map Claude tiers such as `opus`, `sonnet`, and `haiku` to the Codex model IDs available from that provider
- Keep in mind that exact support for tools, streaming, and multimodal input depends on the upstream implementation

Example mappings for a Codex-oriented provider:

| Claude Tier | Example third-party mapping |
| ----------- | --------------------------- |
| `opus`      | `gpt-5.2-codex-max`         |
| `sonnet`    | `gpt-5.2-codex`             |
| `haiku`     | `gpt-5-mini`                |

---

## Configuration

### CLI options

| Option                 | Description                               | Default |
| ---------------------- | ----------------------------------------- | ------- |
| `-p, --port <port>`    | Port for the local bridge server          | `3080`  |
| `-r, --reconfigure`    | Force the configuration wizard            | `false` |
| `--no-claude-settings` | Skip updating Claude Code settings files  | `false` |
| `-V, --version`        | Show version information                  | —       |
| `-h, --help`           | Show available commands and options       | —       |

### Model mapping

The adapter maps Claude-facing model tiers to upstream models you choose.

| Claude Tier | Typical role        | Example mapping                |
| ----------- | ------------------- | ------------------------------ |
| `opus`      | heavy reasoning     | `gpt-5.2-codex-max`            |
| `sonnet`    | balanced workloads  | `gpt-5.2-codex`                |
| `haiku`     | lower-latency tasks | `gpt-5-mini`                   |

This model mapping is also how you enable third-party Codex APIs: point `baseUrl` at the provider you want, then enter that provider's Codex model names here.

---

## API Reference

### Programmatic integration

The package exports its server factory and conversion helpers:

```typescript
import { createServer, AdapterConfig } from 'claude-responses-adapter';

const config: AdapterConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  models: {
    opus: 'gpt-5.2-codex-max',
    sonnet: 'gpt-5.2-codex',
    haiku: 'gpt-5-mini'
  }
};

const server = createServer(config);
await server.start(3080);
```

### Conversion utilities

```typescript
import {
  convertRequestToOpenAI,
  convertResponseToAnthropic
} from 'claude-responses-adapter';

const upstreamRequest = convertRequestToOpenAI(anthropicRequest, 'target-model-name');
const anthropicResponse = convertResponseToAnthropic(upstreamResponse, 'original-model-name');
```

For endpoint-level details, see [docs/API.md](./docs/API.md).

---

## Supported Features

| Feature Capability    | Support Status | Implementation Notes                  |
| --------------------- | :------------: | ------------------------------------- |
| Text generation       |       ✅        | Claude-compatible response mapping    |
| System prompts        |       ✅        | Translated to upstream request format |
| Real-time streaming   |       ✅        | SSE translation                       |
| Tool/function calling |       ✅        | Protocol-aware mapping                |
| Context preservation  |       ✅        | Multi-turn history support            |
| Token controls        |       ✅        | Parameter forwarding                  |
| Stop sequences        |       ✅        | Translated where supported            |
| Multimodal inputs     |       🔜        | Not fully implemented                 |

---

## Troubleshooting

<details>
<summary><strong>EADDRINUSE: Port collision</strong></summary>

If port `3080` is already in use, start the bridge on another port:

```bash
claude-responses-adapter --port 3000
```
</details>

<details>
<summary><strong>Authentication failures</strong></summary>

If the upstream provider returns `401`, rerun the configuration wizard:

```bash
claude-responses-adapter --reconfigure
```
</details>

<details>
<summary><strong>Connection refused</strong></summary>

Make sure the local bridge is running, then verify `ANTHROPIC_BASE_URL` points to the correct local address in `~/.claude/settings.json`.
</details>

<details>
<summary><strong>Manual configuration mode</strong></summary>

To avoid modifying Claude settings automatically:

```bash
claude-responses-adapter --no-claude-settings
```

Then set the required environment variables yourself in `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3080",
    "ANTHROPIC_AUTH_TOKEN": "default"
  }
}
```
</details>

---

## Development

```bash
git clone https://github.com/Killea/claude-responses-adapter.git
cd claude-responses-adapter
npm install
npm run dev
npm test
npm run build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

---

## License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE).

---

<div align="center">

**[Issues](https://github.com/Killea/claude-responses-adapter/issues)** •
**[Documentation](./docs/)** •
**[Upstream project](https://github.com/shantoislamdev/claude-adapter)**

</div>
