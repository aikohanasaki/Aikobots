import assert from 'node:assert/strict';
import test from 'node:test';
import {
    makeClipReviewRecord,
    matchesClipReviewTargetIdentity,
    normalizeMemoryAssistanceMode,
    packClipReviewBatches,
    parseClipReviewResponse,
    parseClipSuggestionsResponse,
    shouldPreserveClipReviewReport,
} from '../public/scripts/stmb-clip-review-policy.js';

test('normalizes Memory Assistance modes and migrates the legacy checkbox', () => {
    assert.equal(normalizeMemoryAssistanceMode('off', true), 'off');
    assert.equal(normalizeMemoryAssistanceMode('Suggest'), 'update');
    assert.equal(normalizeMemoryAssistanceMode('update and suggest'), 'update_and_suggest');
    assert.equal(normalizeMemoryAssistanceMode('automatic'), 'automatic');
    assert.equal(normalizeMemoryAssistanceMode('', true), 'update');
});

test('normalizes and filters Topical Clip suggestions', () => {
    const result = parseClipSuggestionsResponse(JSON.stringify({ topics: [
        { topic: ' Alice ', keywords: ['Alice'] },
        { topic: 'New Alliance', keywords: ['Alliance', ' alliance ', 'Treaty'] },
        { topic: 'new alliance', keywords: ['duplicate'] },
    ] }), [{ type: 'topical', title: 'About Alice [STMB Clip]', topic: 'Alice' }]);
    assert.deepEqual(result.map(item => item.topic), ['New Alliance']);
    assert.deepEqual(result[0].keywords, ['Alliance', 'Treaty']);
});

test('packs records without dropping an oversized record', () => {
    const records = [1, 2, 3].map(uid => ({ uid, content: 'x'.repeat(800) }));
    assert.deepEqual(packClipReviewBatches(records, 'scene', 1500, 1000).flat().map(item => item.uid), [1, 2, 3]);
});

test('preserves the previous report only when every requested operation fails', () => {
    assert.equal(shouldPreserveClipReviewReport({ batchCount: 2, failedBatchCount: 2 }), true);
    assert.equal(shouldPreserveClipReviewReport({ batchCount: 2, failedBatchCount: 1 }), false);
});

test('validates ordinary excerpts and topical replacements', () => {
    const records = [
        { uid: '1', type: 'ordinary', title: 'One', contentHash: 'a' },
        { uid: '2', type: 'topical', title: 'Two', contentHash: 'b' },
    ];
    const result = parseClipReviewResponse('{"1":"the brass key","2":"Alice has the brass key."}', records, [{ id: 10, mes: 'Alice found the brass key.' }]);
    assert.deepEqual(result[0].evidenceMessageIds, [10]);
    assert.equal(result[1].proposedContent, 'Alice has the brass key.');
    assert.throws(() => parseClipReviewResponse('{"1":"invented"}', records, [{ id: 10, mes: 'source' }]), /none matched/i);
});

test('classifies Topical Clips and rejects nested response envelopes', () => {
    assert.equal(makeClipReviewRecord({ uid: 7, data: { extensions: { aikobots: { topical_clip: {} } } } }).type, 'topical');
    assert.throws(() => parseClipReviewResponse('{"candidates":[]}', [], []), /none matched/i);
});

test('review target identity rejects title and Clip-type drift', () => {
    const ordinary = { comment: 'Facts [STMB Clip]' };
    const topical = { ...ordinary, data: { extensions: { aikobots: { topical_clip: { version: 2 } } } } };
    assert.equal(matchesClipReviewTargetIdentity(ordinary, ordinary.comment, 'ordinary'), true);
    assert.equal(matchesClipReviewTargetIdentity(topical, ordinary.comment, 'topical'), true);
    assert.equal(matchesClipReviewTargetIdentity(ordinary, 'Renamed [STMB Clip]', 'ordinary'), false);
    assert.equal(matchesClipReviewTargetIdentity(topical, ordinary.comment, 'ordinary'), false);
});
