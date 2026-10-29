import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import * as nodeFetch from 'node-fetch';
import * as secrets from '../src/endpoints/secrets.js';
import * as claude from '../src/claude.js';
import * as google from '../src/endpoints/google.js';
import { CHAT_COMPLETION_SOURCES } from '../src/constants.js';
import { toGoogleInteraction, fromGoogleInteraction, streamGoogleInteraction } from '../src/google-interactions.js';

const fetchMock = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({ ...nodeFetch, default: fetchMock }));
jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({ ...secrets, readRequestSecret: () => 'test-key' }));
jest.unstable_mockModule('../src/claude.js', () => ({ ...claude, resolveClaudeCatalog: async () => null }));
jest.unstable_mockModule('../src/endpoints/google.js', () => ({ ...google, getVertexAIAuth: async () => ({ authHeader: 'Bearer test-key', authType: 'express' }) }));

let generate;
beforeAll(async () => {
    ({ handleChatCompletionsGenerate: generate } = await import('../src/endpoints/backends/chat-completions.js'));
});
beforeEach(() => {
    fetchMock.mockReset();
    for (const method of ['debug', 'info', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** Runs the real dispatcher with an in-memory request/response and mocked provider transport. */
async function run(source, stream, parameters = {}) {
    const request = {
        body: {
            chat_completion_source: source, model: 'test-model', stream, max_tokens: 100, seed: 42, stop: [],
            messages: [{ role: 'user', content: 'Hello' }], temperature: ['makersuite', 'vertexai'].includes(source) ? 1 : 0.7,
            custom_url: 'https://example.invalid/v1',
            azure_base_url: 'https://example.invalid', azure_deployment_name: 'test', azure_api_version: 'test',
            ...parameters,
        },
        socket: new EventEmitter(), user: { profile: { handle: 'test-user' }, directories: {} },
    };
    const response = {
        socket: new EventEmitter(), headersSent: false, writableEnded: false, statusCode: 200, chunks: [],
        setHeader() {}, flush() {},
        flushHeaders() { this.headersSent = true; },
        status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; return this; },
        write(chunk) { this.chunks.push(chunk); },
        end() { this.writableEnded = true; },
    };
    await generate(request, response);
    return response;
}

function success(stream) {
    return new nodeFetch.Response(stream ? Readable.from([Buffer.from('data: [DONE]\n\n')]) : JSON.stringify({
        choices: [{ message: { content: 'OK' } }], content: [{ type: 'text', text: 'OK' }],
        candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    }), { status: 200 });
}

function googleSuccess(url, stream) {
    if (!String(url).endsWith('/interactions')) return success(stream);
    return new nodeFetch.Response(stream
        ? Readable.from([Buffer.from('event: step.start\ndata: {"event_type":"step.start","index":0,"step":{"type":"model_output"}}\n\nevent: step.delta\ndata: {"event_type":"step.delta","index":0,"delta":{"type":"text","text":"OK"}}\n\nevent: interaction.completed\ndata: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n')])
        : JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'OK' }] }] }), { status: 200 });
}

for (const source of Object.values(CHAT_COMPLETION_SOURCES)) {
    if (source === CHAT_COMPLETION_SOURCES.COMETAPI) continue;
    for (const stream of [false, true]) {
        it(`${source}: applies final body/header overrides (stream=${stream})`, async () => {
            fetchMock.mockImplementation(async url => googleSuccess(url, stream));
            const response = await run(source, stream, {
                custom_include_body: 'temperature: 0.2\nextra_option: true\nremove_me: true',
                custom_exclude_body: '- temperature\n- remove_me\n- model',
                custom_include_headers: 'content-type: application/example\nX-Example: enabled',
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const config = fetchMock.mock.calls[0][1];
            const body = JSON.parse(config.body);
            expect(body.extra_option).toBe(true);
            expect(body).not.toHaveProperty('temperature');
            expect(body).not.toHaveProperty('remove_me');
            if (['makersuite', 'vertexai'].includes(source)) expect(body.model).toBe('test-model');
            else expect(body).not.toHaveProperty('model');
            expect(config.headers.raw()['content-type']).toEqual(['application/example']);
            expect(config.headers.get('X-Example')).toBe('enabled');
            expect(response.statusCode).toBe(200);
            if (stream) expect(response.chunks.join('')).toContain('[DONE]');
            else expect(response.body.choices[0].message.content).toBe('OK');
        });
    }

    it(`${source}: empty overrides leave the outbound request unchanged`, async () => {
        fetchMock.mockImplementation(async url => googleSuccess(url, false));
        await run(source, false);
        const baseline = fetchMock.mock.calls[0][1];
        await run(source, false, { custom_include_body: '', custom_exclude_body: '', custom_include_headers: '' });
        const actual = fetchMock.mock.calls[1][1];
        expect(actual.body).toBe(baseline.body);
        expect(actual.headers.raw()).toEqual(baseline.headers.raw());
    });
}

it('preserves the existing CometAPI disablement', async () => {
    const response = await run('cometapi', false, { custom_include_body: 'example: true' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(503);
});

it.each([false, true])('passes Gemini service tiers at the top level (stream=%s)', async stream => {
    fetchMock.mockImplementation(async url => googleSuccess(url, stream));
    for (const tier of ['standard', 'flex', 'priority', '', undefined]) {
        const response = await run('makersuite', stream, { service_tier: tier });
        const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
        if (tier) expect(body.service_tier).toBe(tier);
        else expect(body).not.toHaveProperty('service_tier');
        expect(body.generation_config).not.toHaveProperty('service_tier');
        expect(response.statusCode).toBe(200);
    }
});

it('rejects invalid Gemini service tiers without echoing input or contacting the provider', async () => {
    for (const tier of ['invalid-tier', null, {}, ['priority']]) {
        const response = await run('makersuite', false, { service_tier: tier });
        expect(response.statusCode).toBe(400);
        expect(response.body.error.message).toBe('Invalid Gemini service tier.');
        expect(JSON.stringify(response.body)).not.toContain('invalid-tier');
    }
    expect(fetchMock).not.toHaveBeenCalled();
});

it('does not pass the AI Studio service tier to Vertex AI', async () => {
    fetchMock.mockImplementation(async url => googleSuccess(url, false));
    await run('vertexai', false, { service_tier: 'priority' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('service_tier');
});

it('uses stateless Interactions by default and keeps only model output', async () => {
    fetchMock.mockResolvedValue(new nodeFetch.Response(JSON.stringify({
        status: 'completed', steps: [
            { type: 'user_input', content: [{ type: 'text', text: 'SYNTHETIC_SECURE_ENTRY' }] },
            { type: 'thought', summary: [{ type: 'text', text: 'summary' }] },
            { type: 'model_output', content: [{ type: 'text', text: 'Answer' }] },
        ],
    }), { status: 200 }));
    const response = await run('makersuite', false, {
        model: 'gemini-new-model', messages: [{ role: 'user', content: 'SYNTHETIC_SECURE_ENTRY' }],
        custom_include_body: 'store: true\nprevious_interaction_id: external\nbackground: true',
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/interactions$/);
    expect(JSON.parse(options.body)).toMatchObject({ model: 'gemini-new-model', store: false });
    expect(JSON.parse(options.body)).not.toHaveProperty('previous_interaction_id');
    expect(JSON.parse(options.body)).not.toHaveProperty('background');
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_SECURE_ENTRY');
    expect(response.body.choices[0].message.content).toBe('Answer');
});

it('routes older models and compatibility proxies directly to generateContent', async () => {
    fetchMock.mockImplementation(async () => success(false));
    await run('makersuite', false, { model: 'gemini-2.0-flash' });
    await run('makersuite', false, { model: 'gemini-3-flash', google_api_mode: 'preserve_compatibility', reverse_proxy: 'https://proxy.invalid' });
    expect(fetchMock.mock.calls[0][0]).toContain(':generateContent');
    expect(fetchMock.mock.calls[1][0]).toContain(':generateContent');
});

it.each([false, true])('continues opted-in Google conversations and rebuilds missing provider history (stream=%s)', async stream => {
    const previousRoot = globalThis.DATA_ROOT;
    const root = mkdtempSync(path.join(os.tmpdir(), 'google-route-test-'));
    globalThis.DATA_ROOT = root;
    try {
        fetchMock.mockImplementation(async () => new nodeFetch.Response(stream
            ? 'data: {"event_type":"step.start","index":0,"step":{"type":"model_output"}}\n\n'
                + 'data: {"event_type":"step.delta","index":0,"delta":{"type":"text","text":"OK"}}\n\n'
                + 'data: {"event_type":"interaction.completed","interaction":{"id":"dummy-id","status":"completed"}}\n\n'
            : JSON.stringify({ id: 'dummy-id', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'OK' }] }] })));
        const parameters = {
            google_api_mode: 'stateful',
            prompt_context: { promptInspection: { chatScope: 'dummy-chat', mesId: 1, swipeId: 0 } },
            messages: [{ role: 'user', content: 'SYNTHETIC_SECURE_ENTRY' }],
            custom_include_body: 'previous_interaction_id: untrusted\nstore: false',
        };
        await run('makersuite', stream, parameters);
        expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).toMatchObject({ store: true });
        const next = { ...parameters, messages: [...parameters.messages, { role: 'assistant', content: 'OK' }, { role: 'user', content: 'Next' }] };
        const response = await run('makersuite', stream, next);
        const sent = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
        expect(sent.previous_interaction_id).toBe('dummy-id');
        expect(sent.input).toEqual([{ type: 'user_input', content: [{ type: 'text', text: 'Next' }] }]);
        expect(JSON.stringify(response.body ?? response.chunks)).not.toContain('SYNTHETIC_SECURE_ENTRY');
        // Rebuild the original prefix so the next request exercises an expired provider ID.
        await run('makersuite', stream, parameters);
        fetchMock.mockResolvedValueOnce(new nodeFetch.Response(JSON.stringify({ error: { message: 'Previous interaction not found' } }), { status: 404 }));
        await run('makersuite', stream, next);
        const rebuilt = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
        expect(rebuilt.previous_interaction_id).toBeUndefined();
        expect(rebuilt.input).toHaveLength(3);
    } finally {
        globalThis.DATA_ROOT = previousRoot;
        rmSync(root, { recursive: true, force: true });
    }
});

it('preserves custom sampling only in compatibility mode', async () => {
    fetchMock.mockImplementation(async () => success(false));
    const latest = await run('makersuite', false, { model: 'gemini-3-flash', temperature: 0.4 });
    expect(latest.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await run('makersuite', false, { model: 'gemini-3-flash', temperature: 0.4, google_api_mode: 'preserve_compatibility' });
    expect(fetchMock.mock.calls[0][0]).toContain(':generateContent');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.temperature).toBe(0.4);
});

it('retries only definitive unsupported Interactions responses once with the original prompt', async () => {
    fetchMock.mockResolvedValueOnce(new nodeFetch.Response(JSON.stringify({ error: { message: 'Interactions unsupported for this model' } }), { status: 400 }))
        .mockResolvedValueOnce(success(false));
    const response = await run('makersuite', false, { model: 'gemini-new-model', messages: [{ role: 'user', content: 'Original text' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content[0].text).toBe('Original text');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).contents[0].parts[0].text).toBe('Original text');
    expect(response.body.choices[0].message.content).toBe('OK');
});

it('does not retry an authentication error', async () => {
    fetchMock.mockResolvedValue(new nodeFetch.Response(JSON.stringify({ error: { message: 'SYNTHETIC_SECURE_ENTRY' } }), { status: 401 }));
    const response = await run('makersuite', false, { model: 'gemini-new-model', messages: [{ role: 'user', content: 'SYNTHETIC_SECURE_ENTRY' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_SECURE_ENTRY');
});

it('maps multimodal prompts and distinct same-name tool calls without losing their IDs', () => {
    const originalMessages = [
        { role: 'assistant', tool_calls: [{ id: 'first', function: { name: 'lookup' } }, { id: 'second', function: { name: 'lookup' } }] },
        { role: 'tool', tool_call_id: 'first' }, { role: 'tool', tool_call_id: 'second' },
    ];
    const interaction = toGoogleInteraction({
        contents: [
            { role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: 'ZHVtbXk=' } }] },
            { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { x: 1 } } }, { functionCall: { name: 'lookup', args: { x: 2 } } }] },
            { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { content: 'one' } } }, { functionResponse: { name: 'lookup', response: { content: 'two' } } }] },
        ], generationConfig: { maxOutputTokens: 100, temperature: 1, topP: 1 }, safetySettings: [],
    }, 'gemini-new-model', false, originalMessages);
    expect(interaction.input[0].content[0]).toMatchObject({ type: 'audio', mime_type: 'audio/wav' });
    expect(interaction.input.filter(step => step.type === 'function_call').map(step => step.id)).toEqual(['first', 'second']);
    expect(interaction.input.filter(step => step.type === 'function_result').map(step => step.call_id)).toEqual(['first', 'second']);
});

it('maps structured and image output requests to Interactions response formats', () => {
    const base = { contents: [{ role: 'user', parts: [{ text: 'Draw a square' }] }], safetySettings: [], generationConfig: { maxOutputTokens: 100, temperature: 1, topP: 1 } };
    const structured = toGoogleInteraction({ ...base, generationConfig: { ...base.generationConfig, responseMimeType: 'application/json', responseSchema: { type: 'object' } } }, 'gemini-new-model', false);
    const image = toGoogleInteraction({ ...base, generationConfig: { ...base.generationConfig, responseModalities: ['text', 'image'] } }, 'gemini-new-model', false);
    expect(structured.response_format).toMatchObject({ type: 'text', mime_type: 'application/json' });
    expect(image.response_format).toEqual([{ type: 'text' }, { type: 'image' }]);
});

it('normalizes generated reasoning, images, and tool calls without echoing input', () => {
    const result = fromGoogleInteraction({ steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'SYNTHETIC_SECURE_ENTRY' }] },
        { type: 'thought', summary: [{ type: 'text', text: 'Reasoning summary' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'Reply' }, { type: 'image', data: 'ZHVtbXk=', mime_type: 'image/png' }] },
        { type: 'function_call', name: 'lookup', arguments: { x: 1 }, signature: 'dummy-signature' },
    ] });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECURE_ENTRY');
    expect(result.responseContent.parts).toEqual([
        { text: 'Reasoning summary', thought: true }, { text: 'Reply' },
        { inlineData: { data: 'ZHVtbXk=', mimeType: 'image/png' } },
        { functionCall: { name: 'lookup', args: { x: 1 } }, thoughtSignature: 'dummy-signature' },
    ]);
});

it('does not mark an interrupted Interactions stream complete', async () => {
    const source = new nodeFetch.Response(Readable.from([Buffer.from('data: {"event_type":"step.delta","index":0,"delta":{"type":"text","text":"partial"}}\n\n')]));
    const onComplete = jest.fn();
    const translated = streamGoogleInteraction(source, onComplete);
    await expect(async () => { for await (const _ of translated.body) { /* consume */ } }).rejects.toThrow('before completion');
    expect(onComplete).not.toHaveBeenCalled();
});

it.each([
    ['claude', 'claude-sonnet-4-6'],
    ['openrouter', 'anthropic/claude-sonnet-4-6'],
    ['electronhub', 'claude-sonnet-4-6'],
])('%s applies explicit automatic caching and rejects invalid modes', async (source, model) => {
    fetchMock.mockImplementation(async () => success(false));
    await run(source, false, { model, automatic_prompt_cache_mode: 'automatic', automatic_prompt_cache_ttl: '1h' });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    await run(source, false, { model, automatic_prompt_cache_mode: 'off' });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).not.toHaveProperty('cache_control');
    const calls = fetchMock.mock.calls.length;
    const invalid = await run(source, false, { model, automatic_prompt_cache_mode: 'invalid' });
    expect(invalid.statusCode).toBe(400);
    const invalidTtl = await run(source, false, { model, automatic_prompt_cache_mode: 'automatic', automatic_prompt_cache_ttl: '2h' });
    expect(invalidTtl.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
});

it('retains overrides and headers through structured-output fallback', async () => {
    fetchMock.mockResolvedValueOnce(new nodeFetch.Response(JSON.stringify({ error: { message: 'response_format json_schema not supported' } }), { status: 400 }))
        .mockImplementation(async () => success(false));
    await run('openai', false, {
        json_schema: { name: 'example', value: { type: 'object', properties: {} } },
        custom_include_body: 'extra_option: true', custom_exclude_body: '- temperature', custom_include_headers: 'X-Example: enabled',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const config = fetchMock.mock.calls[1][1];
    expect(JSON.parse(config.body)).toMatchObject({ extra_option: true, response_format: { type: 'json_object' } });
    expect(JSON.parse(config.body)).not.toHaveProperty('temperature');
    expect(config.headers.get('X-Example')).toBe('enabled');
});

it.each([false, true])('retains sanitized provider errors (stream=%s)', async stream => {
    fetchMock.mockImplementation(async () => new nodeFetch.Response(JSON.stringify({ error: { message: 'Invalid parameter body: omitted-example' } }), { status: 400 }));
    const response = await run('openai', stream, { custom_include_body: 'example: true' });
    const output = JSON.stringify(response.body ?? response.chunks);
    expect(output).toContain('body omitted');
    expect(output).not.toContain('omitted-example');
});
