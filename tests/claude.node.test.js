import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
    createClaudeCatalogResolver,
    getClaudeRequestPolicy,
    sanitizeClaudeModel,
} from '../src/claude.js';
import { setConfigFilePath } from '../src/util.js';
import {
    accumulateClaudeToolTurnBlock,
    extractClaudeToolTurnBlocks,
    getCompletedClaudeToolTurnBlocks,
} from '../public/scripts/claude.js';

const names = { userName: '', charName: '', startsWithGroupName: () => false };
setConfigFilePath(path.resolve(process.cwd(), 'config.yaml'));
const { convertClaudeMessages } = await import('../src/prompt-converters.js');

test('Claude catalog sanitization retains only public capability metadata', () => {
    assert.deepEqual(sanitizeClaudeModel({
        id: 'claude-test',
        display_name: 'Claude Test',
        created_at: '2026-01-01T00:00:00Z',
        max_input_tokens: 200000,
        max_tokens: 64000,
        secret: 'discard-me',
        capabilities: {
            image_input: { supported: true, detail: 'discard-me' },
            structured_outputs: { supported: false },
            thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } },
            effort: { supported: true, low: { supported: true }, high: { supported: true } },
            unknown: { supported: true },
        },
    }), {
        id: 'claude-test',
        display_name: 'Claude Test',
        created_at: '2026-01-01T00:00:00Z',
        max_input_tokens: 200000,
        max_tokens: 64000,
        capabilities: {
            image_input: { supported: true },
            structured_outputs: { supported: false },
            thinking: { supported: true, types: { adaptive: true, enabled: false } },
            effort: { supported: true, levels: { low: true, medium: false, high: true, xhigh: false, max: false } },
        },
    });
});

test('Claude catalog cache is credential scoped, coalesces requests, and serves stale data after failure', async () => {
    let time = 0;
    let calls = 0;
    let fail = false;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const resolver = createClaudeCatalogResolver({
        now: () => time,
        fetchImpl: async (_url, options) => {
            calls++;
            if (calls === 1) await gate;
            if (fail) throw new Error('synthetic failure');
            assert.equal(options.headers['x-api-key'].startsWith('key-'), true);
            return { ok: true, json: async () => ({ data: [{ id: `model-${calls}` }] }) };
        },
    });

    const first = resolver('https://api.example/v1/', 'key-a');
    const coalesced = resolver('https://api.example/v1', 'key-a');
    release();
    assert.deepEqual(await first, await coalesced);
    assert.equal(calls, 1);
    await resolver('https://api.example/v1', 'key-b');
    assert.equal(calls, 2);

    time = 60 * 60 * 1000 + 1;
    fail = true;
    const stale = await resolver('https://api.example/v1', 'key-a');
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.data, [{ id: 'model-1' }]);
    await resolver('https://api.example/v1', 'key-a');
    assert.equal(calls, 3);
});

test('Claude policy applies adaptive thinking, effort mapping, native JSON, and conservative unknown fallback', () => {
    const adaptive = {
        capabilities: {
            thinking: { types: { adaptive: true, enabled: true } },
            effort: { levels: { low: true, medium: true, high: true, max: true } },
            structured_outputs: { supported: true },
        },
    };
    const policy = getClaudeRequestPolicy({
        model: adaptive,
        reasoningEffort: 'max',
        includeReasoning: false,
        maxTokens: 8000,
        stream: true,
        temperature: 0.7,
        topP: 0.8,
        topK: 20,
        prefill: 'Prefill',
        hasTools: false,
        jsonSchema: { name: 'answer', value: { type: 'object' } },
        calculateBudget: () => { throw new Error('adaptive thinking must not calculate a manual budget'); },
    });
    assert.deepEqual(policy, {
        prefill: '',
        body: {
            thinking: { type: 'adaptive', display: 'omitted' },
            output_config: {
                effort: 'max',
                format: { type: 'json_schema', schema: { type: 'object' } },
            },
        },
    });

    const unknown = getClaudeRequestPolicy({ model: null, jsonSchema: null });
    assert.deepEqual(unknown, { prefill: '', body: {}, error: undefined });
    assert.match(getClaudeRequestPolicy({ model: null, jsonSchema: {} }).error, /could not be verified/);
});

test('Claude policy limits sampling and omits unsupported prefill', () => {
    const manual = { capabilities: { thinking: { types: { enabled: true } } } };
    const thinking = getClaudeRequestPolicy({
        model: manual,
        reasoningEffort: 'low',
        includeReasoning: true,
        maxTokens: 8000,
        stream: false,
        temperature: 0.5,
        topP: 0.7,
        topK: 10,
        prefill: 'Nope',
        calculateBudget: () => 1024,
    });
    assert.deepEqual(thinking, {
        prefill: '',
        body: { thinking: { type: 'enabled', budget_tokens: 1024, display: 'summarized' } },
    });

    const basic = getClaudeRequestPolicy({ model: { capabilities: {} }, reasoningEffort: 'auto', temperature: 0.5, topP: 0.7, topK: 10, prefill: 'Okay' });
    assert.deepEqual(basic, { prefill: 'Okay', body: { temperature: 0.5, top_k: 10 } });
});

test('Claude thinking and tool blocks round-trip in exact stream order', () => {
    const state = {};
    const events = [
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'synthetic-signature' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'synthetic-redacted' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } },
        { type: 'content_block_stop', index: 2 },
    ];
    events.forEach(event => accumulateClaudeToolTurnBlock(state, event));
    const blocks = getCompletedClaudeToolTurnBlocks(state);
    assert.deepEqual(blocks, [
        { type: 'thinking', thinking: 'plan', signature: 'synthetic-signature' },
        { type: 'redacted_thinking', data: 'synthetic-redacted' },
        { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: 'x' } },
    ]);
    assert.deepEqual(extractClaudeToolTurnBlocks([{ type: 'text', text: 'hidden' }, ...blocks]), blocks);

    const converted = convertClaudeMessages([{ role: 'assistant', content: '', tool_calls: [{ id: 'tool-1', function: { name: 'lookup', arguments: '{}' } }], claude_tool_turn_blocks: blocks }], '', false, true, names);
    assert.deepEqual(converted.messages[0].content, blocks);
});

test('unsupported Claude prefill is omitted, never relabeled as a user message', () => {
    const converted = convertClaudeMessages([{ role: 'user', content: 'Hello' }], '', false, false, names);
    assert.deepEqual(converted.messages, [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
});
