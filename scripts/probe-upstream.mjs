#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PROMPT = 'ping';

function parseArgs(argv) {
    const args = {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        prompt: DEFAULT_PROMPT,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        switch (arg) {
            case '--base-url':
                args.baseUrl = next;
                index += 1;
                break;
            case '--api-key':
                args.apiKey = next;
                index += 1;
                break;
            case '--model':
                args.model = next;
                index += 1;
                break;
            case '--timeout-ms':
                args.timeoutMs = Number(next);
                index += 1;
                break;
            case '--prompt':
                args.prompt = next;
                index += 1;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                break;
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage:
  node scripts/probe-upstream.mjs
  node scripts/probe-upstream.mjs --base-url https://example.com/openai --api-key sk-... --model gpt-5.4

Options:
  --base-url     Override base URL from ~/.claude-responses-adapter/config.json
  --api-key      Override API key from ~/.claude-responses-adapter/config.json
  --model        Override probe model from config
  --timeout-ms   Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  --prompt       Probe prompt text (default: "${DEFAULT_PROMPT}")`);
}

function loadAdapterConfig() {
    const configPath = path.join(os.homedir(), '.claude-responses-adapter', 'config.json');
    if (!fs.existsSync(configPath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function normalizeBaseUrl(baseUrl) {
    if (!baseUrl) {
        return '';
    }

    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function resolveConfig(cliArgs) {
    const fileConfig = loadAdapterConfig() ?? {};
    const baseUrl = normalizeBaseUrl(cliArgs.baseUrl ?? fileConfig.baseUrl);
    const apiKey = cliArgs.apiKey ?? fileConfig.apiKey;
    const model =
        cliArgs.model ??
        fileConfig.models?.sonnet ??
        fileConfig.models?.opus ??
        fileConfig.models?.haiku;

    if (!baseUrl || !apiKey || !model) {
        throw new Error('Missing baseUrl, apiKey, or model. Pass flags or ensure ~/.claude-responses-adapter/config.json exists.');
    }

    return { baseUrl, apiKey, model };
}

function buildCandidateUrls(baseUrl) {
    const candidates = [];
    const add = (kind, url) => {
        if (!candidates.some(candidate => candidate.url === url)) {
            candidates.push({ kind, url });
        }
    };

    if (baseUrl.endsWith('/responses')) {
        add('responses', baseUrl);
    } else if (baseUrl.endsWith('/v1')) {
        add('responses', `${baseUrl}/responses`);
        add('chat.completions', `${baseUrl}/chat/completions`);
        add('models', `${baseUrl}/models`);
    } else {
        add('responses', `${baseUrl}/v1/responses`);
        add('responses', `${baseUrl}/responses`);
        add('chat.completions', `${baseUrl}/v1/chat/completions`);
        add('chat.completions', `${baseUrl}/chat/completions`);
        add('models', `${baseUrl}/v1/models`);
        add('models', `${baseUrl}/models`);
    }

    return candidates;
}

function buildRequest(kind, model, prompt) {
    if (kind === 'responses') {
        return {
            method: 'POST',
            body: {
                model,
                input: prompt,
                max_output_tokens: 16,
            },
        };
    }

    if (kind === 'chat.completions') {
        return {
            method: 'POST',
            body: {
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 16,
            },
        };
    }

    return {
        method: 'GET',
        body: undefined,
    };
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

async function readResponsePreview(response) {
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    return {
        contentType,
        preview: text.slice(0, 500),
    };
}

async function probeCandidate(candidate, config, timeoutMs, prompt) {
    const request = buildRequest(candidate.kind, config.model, prompt);
    const headers = {
        Authorization: `Bearer ${config.apiKey}`,
    };

    if (request.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const startedAt = Date.now();

    try {
        const response = await fetchWithTimeout(candidate.url, {
            method: request.method,
            headers,
            body: request.body === undefined ? undefined : JSON.stringify(request.body),
        }, timeoutMs);

        const { contentType, preview } = await readResponsePreview(response);
        return {
            ok: response.ok,
            status: response.status,
            kind: candidate.kind,
            url: candidate.url,
            contentType,
            elapsedMs: Date.now() - startedAt,
            preview,
        };
    } catch (error) {
        return {
            ok: false,
            status: null,
            kind: candidate.kind,
            url: candidate.url,
            contentType: '',
            elapsedMs: Date.now() - startedAt,
            preview: '',
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
    }
}

function printResult(result) {
    console.log(`\n[${result.kind}] ${result.url}`);
    console.log(`status: ${result.status ?? 'ERR'} | ok: ${result.ok} | elapsed: ${result.elapsedMs}ms`);

    if (result.error) {
        console.log(`error: ${result.error}`);
        return;
    }

    console.log(`content-type: ${result.contentType || '(empty)'}`);
    console.log('body preview:');
    console.log(result.preview || '(empty)');
}

async function main() {
    const cliArgs = parseArgs(process.argv.slice(2));
    if (cliArgs.help) {
        printHelp();
        return;
    }

    const config = resolveConfig(cliArgs);
    const candidates = buildCandidateUrls(config.baseUrl);

    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Model: ${config.model}`);
    console.log(`Candidates: ${candidates.length}`);

    for (const candidate of candidates) {
        const result = await probeCandidate(candidate, config, cliArgs.timeoutMs, cliArgs.prompt);
        printResult(result);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
