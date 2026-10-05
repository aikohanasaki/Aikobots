import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import * as nodeFetch from 'node-fetch';
import * as secrets from '../src/endpoints/secrets.js';
import * as claude from '../src/claude.js';
import * as google from '../src/endpoints/google.js';
import { CHAT_COMPLETION_SOURCES } from '../src/constants.js';

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
            messages: [{ role: 'user', content: 'Hello' }], temperature: 0.7,
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

for (const source of Object.values(CHAT_COMPLETION_SOURCES)) {
    if (source === CHAT_COMPLETION_SOURCES.COMETAPI) continue;
    for (const stream of [false, true]) {
        it(`${source}: applies final body/header overrides (stream=${stream})`, async () => {
            fetchMock.mockImplementation(async () => success(stream));
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
            expect(body).not.toHaveProperty('model');
            expect(config.headers.raw()['content-type']).toEqual(['application/example']);
            expect(config.headers.get('X-Example')).toBe('enabled');
            expect(response.statusCode).toBe(200);
            if (stream) expect(response.chunks.join('')).toContain('[DONE]');
            else expect(response.body.choices[0].message.content).toBe('OK');
        });
    }

    it(`${source}: empty overrides leave the outbound request unchanged`, async () => {
        fetchMock.mockImplementation(async () => success(false));
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
