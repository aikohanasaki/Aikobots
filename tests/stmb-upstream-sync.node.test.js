import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getStmbGroupParticipantConfirmationPolicy,
    getStmbProviderTruncationCode,
    normalizeStmbSettings,
} from '../public/scripts/stmb-core.js';

test('auto-summary intervals accept five messages but reject lower persisted values', () => {
    assert.equal(normalizeStmbSettings({ moduleSettings: { autoSummaryInterval: 5 } }).moduleSettings.autoSummaryInterval, 5);
    assert.equal(normalizeStmbSettings({ moduleSettings: { autoSummaryInterval: 4 } }).moduleSettings.autoSummaryInterval, 50);
});

test('failed group participant detection always requires confirmation', () => {
    assert.deepEqual(getStmbGroupParticipantConfirmationPolicy([], ['Alice', 'Bob'], true), {
        detectionFailed: true,
        selectedNames: ['Alice', 'Bob'],
        requiresConfirmation: true,
    });
    assert.equal(getStmbGroupParticipantConfirmationPolicy(['Alice'], ['Alice', 'Bob'], true).requiresConfirmation, false);
});

test('provider truncation recognizes finish reasons and explicit flags', () => {
    assert.equal(getStmbProviderTruncationCode({ choices: [{ finish_reason: 'length' }] }), 'PROVIDER_TRUNCATION');
    assert.equal(getStmbProviderTruncationCode({ stop_reason: 'max_tokens' }), 'PROVIDER_TRUNCATION');
    assert.equal(getStmbProviderTruncationCode({ truncated: true }), 'PROVIDER_TRUNCATION_FLAG');
    assert.equal(getStmbProviderTruncationCode({ choices: [{ finish_reason: 'stop' }] }), '');
});
