import assert from 'node:assert/strict';
import test from 'node:test';

import {
    mergeConnectionProfilePayloadOverrides,
    resolveConnectionProfileModel,
    resolveConnectionProfileTemperature,
} from '../public/scripts/connection-profile-request-policy.js';

test('model precedence is run entry, STMB override, then connection profile', () => {
    assert.equal(resolveConnectionProfileModel('run-model', 'stmb-model', 'profile-model'), 'run-model');
    assert.equal(resolveConnectionProfileModel('', 'stmb-model', 'profile-model'), 'stmb-model');
    assert.equal(resolveConnectionProfileModel('', '', 'profile-model'), 'profile-model');
    assert.throws(
        () => resolveConnectionProfileModel('', '', ''),
        /Enter a model ID/,
    );
});

test('temperature precedence keeps zero and falls back when overrides are blank', () => {
    assert.equal(resolveConnectionProfileTemperature(0, 0.7, 1), 0);
    assert.equal(resolveConnectionProfileTemperature('', 0.7, 1), 0.7);
    assert.equal(resolveConnectionProfileTemperature(null, '', 1), 1);
    assert.equal(resolveConnectionProfileTemperature(null, '', undefined), undefined);
});

test('public payload overrides win over connection profile fields', () => {
    const result = mergeConnectionProfilePayloadOverrides({
        custom_url: 'https://profile.example',
        secret_id: 'profile-secret',
        model: 'resolved-model',
    }, {
        custom_url: 'https://override.example',
        secret_id: 'override-secret',
    });

    assert.deepEqual(result, {
        custom_url: 'https://override.example',
        secret_id: 'override-secret',
        model: 'resolved-model',
    });
});
