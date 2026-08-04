import assert from 'node:assert/strict';
import test from 'node:test';

import { applyStmbRequestTransport } from '../public/scripts/stmb-request-transport.js';

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
