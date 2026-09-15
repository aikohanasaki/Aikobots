import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateStmbAutoSummary } from '../public/scripts/stmb-auto-summary-policy.js';
import { captureStmbGroupPolicy, applyStmbGroupPolicy, filterStmbMemoryRole } from '../public/scripts/stmb-group-policy.js';
import { buildTopicalClipEntryOverrides } from '../public/scripts/stmb-core.js';

test('token triggering captures only eligible history and keeps the counted scene', async () => {
    const captured = { compiledScene: { messages: [{ text: 'Stored earlier message' }] } };
    const result = await evaluateStmbAutoSummary({
        settings: { autoSummaryTriggerMode: 'tokens', autoSummaryTokenThreshold: 4000, autoSummaryBuffer: 2 },
        highest: 4, last: 100, isCurrent: () => true,
        capture: async range => { assert.deepEqual(range, { sceneStart: 5, sceneEnd: 98 }); return captured; },
        countTokens: async scene => { assert.equal(scene, captured.compiledScene); return 4000; },
    });
    assert.equal(result.captured, captured);
});

test('token triggering never falls back for empty, failed, or superseded captures', async () => {
    const args = {
        settings: { autoSummaryTriggerMode: 'tokens', autoSummaryTokenThreshold: 4000, autoSummaryInterval: 5 },
        highest: -1, last: 100, isCurrent: () => true,
        capture: async () => ({ compiledScene: { messages: [] } }),
        countTokens: async () => { throw new Error('Must not count an empty scene'); },
    };
    assert.equal(await evaluateStmbAutoSummary(args), null);
    await assert.rejects(evaluateStmbAutoSummary({ ...args, capture: async () => { throw new Error('capture failed'); } }), /capture failed/);
    let current = true;
    assert.equal(await evaluateStmbAutoSummary({ ...args, isCurrent: () => current,
        capture: async () => ({ compiledScene: { messages: [{}] } }),
        countTokens: async () => { current = false; return 5000; },
    }), null);
});

test('queued group policy is independent of later settings and retains Narrator routing', () => {
    const settings = { characterAwareMemories: false };
    const policy = captureStmbGroupPolicy(settings, { isGroupChat: true });
    settings.characterAwareMemories = true;
    const scene = { metadata: { characterFilterNames: ['Alice'], stmbPromptTarget: 'group' } };
    const profile = applyStmbGroupPolicy({ useGroupSpecificPrompts: true }, scene, policy);
    assert.equal(profile.useGroupSpecificPrompts, false);
    assert.equal(scene.metadata.characterFilterNames, undefined);
    assert.equal(scene.metadata.stmbPromptTarget, '');
    assert.equal(captureStmbGroupPolicy({ characterAwareMemories: false }, { isNarratorMode: true }).characterAware, true);
    const entries = [{ STMB_memoryRole: 'group' }, { STMB_memoryRole: 'character', characterFilter: { names: ['Alice'] } }, {}];
    assert.deepEqual(filterStmbMemoryRole(entries, 'group', true), [entries[0]]);
    assert.deepEqual(filterStmbMemoryRole(entries, 'character', true, ['Alice']), [entries[1]]);
});

test('Clip overrides preserve manual zero, reverse order, and disabled profile behavior', () => {
    const profile = { position: 1, orderMode: 'manual', orderValue: 57 };
    assert.equal(buildTopicalClipEntryOverrides(profile, { enabled: false, orderValue: 0 }).order, 57);
    const overrides = buildTopicalClipEntryOverrides(profile, { enabled: true, position: 0, orderMode: 'manual', orderValue: 0 });
    assert.equal(overrides.order, 0);
    assert.equal(overrides.position, 0);
    assert.equal(buildTopicalClipEntryOverrides(profile, { enabled: true, orderMode: 'reverse', reverseStart: 9999 }).order, 9999);
});
