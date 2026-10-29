import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { prepareGoogleConversation } from '../src/google-conversation-state.js';

let root;
let scope;
const step = (type, text) => ({ type, content: [{ type: 'text', text }] });
const user = step('user_input', 'SYNTHETIC_SECURE_ENTRY');
const answer = step('model_output', 'Answer');
const next = step('user_input', 'Next');
const body = (input = [user]) => ({ model: 'dummy-model', input: structuredClone(input), store: false, system_instruction: 'Synthetic lore' });
const completed = (id = 'dummy-id', text = 'Answer') => ({ id, status: 'completed', steps: [step('model_output', text)] });

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'google-state-test-'));
    scope = { root, user: 'dummy-user', chat: 'dummy-chat', endpoint: 'https://example.invalid', credential: 'dummy-secret' };
});
afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
});

it('continues exact history across separate database connections without persisting content or credentials', () => {
    const first = body();
    prepareGoogleConversation(first, scope).complete(completed());
    expect(first.store).toBe(true);
    const second = body([user, answer, next]);
    second.generation_config = { seed: 123 };
    prepareGoogleConversation(second, scope).complete(completed('second-id', 'Second'));
    expect(second.previous_interaction_id).toBe('dummy-id');
    expect(second.input).toEqual([next]);
    const third = body([user, answer, next, step('model_output', 'Second'), next]);
    prepareGoogleConversation(third, scope);
    expect(third.previous_interaction_id).toBe('second-id');
    const disk = readFileSync(path.join(root, '_google-interactions', 'state.sqlite')).toString();
    for (const secret of ['SYNTHETIC_SECURE_ENTRY', 'Synthetic lore', 'dummy-secret', 'dummy-user', 'dummy-chat']) {
        expect(disk.includes(secret)).toBe(false);
    }
});

it('rebuilds for edits, swipes, trimming, changed lore, models and account/chat scopes', () => {
    prepareGoogleConversation(body(), scope).complete(completed());
    const variants = [
        body([step('user_input', 'Edited'), answer, next]),
        body([user, step('model_output', 'Other swipe'), next]),
        body([answer, next]),
        { ...body([user, answer, next]), system_instruction: 'Changed lore' },
        { ...body([user, answer, next]), model: 'other-model' },
    ];
    for (const request of variants) {
        prepareGoogleConversation(request, scope);
        expect(request.previous_interaction_id).toBeUndefined();
    }
    for (const key of ['user', 'chat', 'endpoint', 'credential']) {
        const request = body([user, answer, next]);
        prepareGoogleConversation(request, { ...scope, [key]: 'different' });
        expect(request.previous_interaction_id).toBeUndefined();
    }
});

it('resets an expired provider continuation to the full prompt', () => {
    prepareGoogleConversation(body(), scope).complete(completed());
    const request = body([user, answer, next]);
    const state = prepareGoogleConversation(request, scope);
    state.reset();
    expect(request.previous_interaction_id).toBeUndefined();
    expect(request.input).toEqual([user, answer, next]);
});

it('expires local metadata and falls back safely when metadata storage is unavailable', () => {
    prepareGoogleConversation(body(), scope).complete(completed());
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 24 * 60 * 60_000);
    const expired = body([user, answer, next]);
    prepareGoogleConversation(expired, scope);
    expect(expired.previous_interaction_id).toBeUndefined();
    const unavailable = body([user, answer, next]);
    expect(prepareGoogleConversation(unavailable, { ...scope, root: path.join(root, '_google-interactions', 'state.sqlite') })).toBeNull();
    expect(unavailable.store).toBe(false);
    expect(unavailable.input).toEqual([user, answer, next]);
});

it('does not reuse failed, incomplete or ambiguous outputs or unsupported inputs', () => {
    for (const result of [
        { ...completed(), status: 'incomplete' },
        { ...completed(), status: 'failed' },
        { ...completed(), steps: [answer, answer] },
        { ...completed(), steps: [{ type: 'function_call', name: 'dummy' }] },
    ]) {
        prepareGoogleConversation(body(), scope).complete(result);
        const request = body([user, answer, next]);
        prepareGoogleConversation(request, scope);
        expect(request.previous_interaction_id).toBeUndefined();
    }
    for (const request of [
        { ...body(), tools: [{ type: 'google_search' }] },
        { ...body(), response_format: [{ type: 'text' }, { type: 'image' }] },
        body([{ type: 'user_input', content: [{ type: 'image', data: 'dummy' }] }]),
    ]) {
        expect(prepareGoogleConversation(request, scope)).toBeNull();
        expect(request.store).toBe(false);
    }
});

it('concurrent completions can lose a cache hit but cannot substitute another answer', () => {
    const first = prepareGoogleConversation(body(), scope);
    const second = prepareGoogleConversation(body(), scope);
    second.complete(completed('second-id', 'Second'));
    first.complete(completed('first-id', 'First'));
    const request = body([user, step('model_output', 'Second'), next]);
    prepareGoogleConversation(request, scope);
    expect(request.previous_interaction_id).toBeUndefined();
});
