import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getTopicalClipDefaultRange,
    getStmbGroupParticipantConfirmationPolicy,
    getStmbProviderTruncationCode,
    normalizeStmbSettings,
} from '../public/scripts/stmb-core.js';

test('Topical Clip range defaults honor explicit range, scene markers, and inclusive processed boundary', () => {
    assert.deepEqual(getTopicalClipDefaultRange({ sceneStart: 3, sceneEnd: 9 }, { sceneStart: 1, sceneEnd: 12 }, 2, 20), { sceneStart: 3, sceneEnd: 9 });
    assert.deepEqual(getTopicalClipDefaultRange(null, { sceneStart: 1, sceneEnd: 12 }, 2, 20), { sceneStart: 1, sceneEnd: 12 });
    assert.deepEqual(getTopicalClipDefaultRange(null, {}, 0, 20), { sceneStart: 0, sceneEnd: 20 });
    assert.deepEqual(getTopicalClipDefaultRange(null, {}, null, -1), { sceneStart: 0, sceneEnd: null });
});

test('Topical Clip conflicting defaults fall back to the beginning through the selected end', () => {
    assert.deepEqual(getTopicalClipDefaultRange(null, { sceneStart: null, sceneEnd: 7 }, 15), { sceneStart: 0, sceneEnd: 7 });
    assert.deepEqual(getTopicalClipDefaultRange(null, { sceneStart: 15, sceneEnd: 7 }, null, 20), { sceneStart: 0, sceneEnd: 7 });
    assert.deepEqual(getTopicalClipDefaultRange(null, {}, 15, 7), { sceneStart: 0, sceneEnd: 7 });
    assert.deepEqual(getTopicalClipDefaultRange(null, {}, 15), { sceneStart: 15, sceneEnd: null });
});

test('Topical Clip hidden-message preference is independent and defaults off', () => {
    assert.equal(normalizeStmbSettings({ moduleSettings: { unhideBeforeMemory: true } }).moduleSettings.topicalClipIncludeHiddenMessages, false);
    assert.equal(normalizeStmbSettings({ moduleSettings: { topicalClipIncludeHiddenMessages: true } }).moduleSettings.topicalClipIncludeHiddenMessages, true);
});

test('auto-summary intervals accept five messages but reject lower persisted values', () => {
    assert.equal(normalizeStmbSettings({ moduleSettings: { autoSummaryInterval: 5 } }).moduleSettings.autoSummaryInterval, 5);
    assert.equal(normalizeStmbSettings({ moduleSettings: { autoSummaryInterval: 4 } }).moduleSettings.autoSummaryInterval, 50);
});

test('new upstream settings normalize with safe defaults and bounds', () => {
    const settings = normalizeStmbSettings({ moduleSettings: {
        autoSummaryTriggerMode: 'tokens',
        autoSummaryTokenThreshold: 5000,
        characterAwareMemories: false,
        useSeparateGroupSidePrompts: false,
        sidePromptsMaxConcurrent: 99,
    } });
    assert.equal(settings.moduleSettings.autoSummaryTriggerMode, 'tokens');
    assert.equal(settings.moduleSettings.autoSummaryTokenThreshold, 5000);
    assert.equal(settings.moduleSettings.characterAwareMemories, false);
    assert.equal(settings.moduleSettings.useSeparateGroupSidePrompts, false);
    assert.equal(settings.moduleSettings.sidePromptsMaxConcurrent, 10);
    assert.equal(settings.moduleSettings.manualMemoryReminders, false);
    assert.equal(settings.moduleSettings.automaticMemoryReminderInterval, 10);
    assert.equal(normalizeStmbSettings({ moduleSettings: { manualMemoryReminders: true, manualMemoryReminderInterval: 0 } }).moduleSettings.manualMemoryReminderInterval, 50);
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
