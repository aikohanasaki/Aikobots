import assert from 'node:assert/strict';
import test from 'node:test';

import { applyStmbRequestTransport } from '../public/scripts/stmb-request-transport.js';
import { applyStmbProfileConnection } from '../public/scripts/stmb-core.js';

test('connection-profile fields survive the STMB request allowlist', () => {
    const request = applyStmbRequestTransport({
        model: 'model-id',
        chat_completion_source: 'custom',
        secret_id: 'secret-reference',
        custom_url: 'https://example.invalid/v1',
        custom_include_body: 'feature: true',
        custom_exclude_body: 'seed',
        custom_include_headers: 'X-Feature: enabled',
        custom_prompt_post_processing: 'strict',
        stream: true,
        unrelated_internal_state: 'must not cross the request boundary',
    });

    assert.equal(request.secret_id, 'secret-reference');
    assert.equal(request.custom_include_body, 'feature: true');
    assert.equal(request.custom_exclude_body, 'seed');
    assert.equal(request.custom_include_headers, 'X-Feature: enabled');
    assert.equal(request.custom_prompt_post_processing, 'strict');
    assert.equal(request.stream, true);
    assert.equal(request.unrelated_internal_state, undefined);
});

test('Navy reasoning effort survives the STMB request allowlist and is normalized', () => {
    const request = applyStmbRequestTransport({
        chat_completion_source: 'navy',
        reasoning_effort: 'max',
    });

    assert.equal(request.reasoning_effort, 'xhigh');
});

test('STMB forwards only the selected cache and Gemini tier options', () => {
    const request = applyStmbRequestTransport({
        chat_completion_source: 'makersuite', model: 'synthetic-gemini',
        automatic_prompt_cache_mode: 'off', automatic_prompt_cache_ttl: '1h', service_tier: 'flex',
        gemini_service_tier: 'must stay client-side',
    });
    assert.equal(request.automatic_prompt_cache_mode, 'off');
    assert.equal(request.automatic_prompt_cache_ttl, '1h');
    assert.equal(request.service_tier, 'flex');
    assert.equal(request.gemini_service_tier, undefined);
});

test('STMB caching checkbox applies after current and saved connection options', () => {
    const active = { chat_completion_source: 'makersuite', model: 'synthetic-gemini', automatic_prompt_cache_mode: 'automatic', automatic_prompt_cache_ttl: '1h', service_tier: 'flex' };
    const current = applyStmbProfileConnection(active, { connection: { api: 'current_st' } });
    assert.equal(applyStmbRequestTransport(current).service_tier, 'flex');
    assert.equal(applyStmbRequestTransport(current).automatic_prompt_cache_mode, 'off');
    assert.equal(applyStmbProfileConnection(active, { skipCaching: false, connection: { api: 'current_st' } }).automatic_prompt_cache_mode, 'automatic');
    const snapshotOptions = { chat_completion_source: 'claude', model: 'claude-sonnet-4-6', automatic_prompt_cache_mode: 'automatic', automatic_prompt_cache_ttl: '1h' };
    const saved = { connectionSnapshot: { profileId: 'synthetic' } };
    const options = { applyConnectionProfileSnapshot: () => snapshotOptions };
    assert.equal(applyStmbProfileConnection(active, saved, options).automatic_prompt_cache_mode, 'off');
    assert.equal(applyStmbProfileConnection(active, { ...saved, skipCaching: false }, options).automatic_prompt_cache_mode, 'automatic');
    const independent = applyStmbProfileConnection(active, { connection: { api: 'makersuite', model: 'other-gemini' } });
    assert.equal(independent.automatic_prompt_cache_mode, 'off');
    assert.equal(independent.automatic_prompt_cache_ttl, '5m');
    assert.equal(independent.service_tier, undefined);
});
