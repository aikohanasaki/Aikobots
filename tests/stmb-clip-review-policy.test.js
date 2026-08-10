import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CLIP_REVIEW_REQUIRES_REVIEW,
    applyAutomaticClipReviewCandidates,
    getSelectedClipReviewUids,
    isLongClipEntryContent,
    makeClipReviewRecord,
    matchesClipReviewTargetIdentity,
    normalizeMemoryAssistanceMode,
    packClipReviewBatches,
    parseClipReviewResponse,
    parseClipSuggestionsResponse,
    rebuildOrdinaryClipAdditions,
    renderClipReviewReport,
    shouldPreserveClipReviewReport,
} from '../public/scripts/stmb-clip-review-policy.js';

test('reads only checked Memory Assistance Clip choices', () => {
    assert.deepEqual(getSelectedClipReviewUids([]), []);
    assert.deepEqual(getSelectedClipReviewUids([
        { checked: false, value: '1' },
        { checked: true, value: 2 },
        { checked: true, value: '3' },
    ]), ['2', '3']);
});

test('normalizes Memory Assistance modes and migrates the legacy checkbox', () => {
    assert.equal(normalizeMemoryAssistanceMode('off', true), 'off');
    assert.equal(normalizeMemoryAssistanceMode('Suggest'), 'update');
    assert.equal(normalizeMemoryAssistanceMode('update and suggest'), 'update_and_suggest');
    assert.equal(normalizeMemoryAssistanceMode('automatic'), 'automatic');
    assert.equal(normalizeMemoryAssistanceMode('', true), 'update');
});

test('classifies Clip content above the 500-token estimate as long', () => {
    assert.equal(isLongClipEntryContent('x'.repeat(2000)), false);
    assert.equal(isLongClipEntryContent('x'.repeat(2001)), true);
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

test('renders persisted ordinary candidates without additions', () => {
    const report = renderClipReviewReport({ sceneStart: 1, sceneEnd: 2, candidates: [{ type: 'ordinary', title: 'Legacy Clip' }] });
    assert.match(report, /## Legacy Clip\nType: Clip\nSuggested additions:/);
});

test('preserves source IDs when rebuilding edited ordinary additions', () => {
    const additions = rebuildOrdinaryClipAdditions({ additions: [], evidenceMessageIds: [17] }, 'first\nsecond');
    assert.deepEqual(additions, [
        { messageId: 17, text: 'first' },
        { messageId: 17, text: 'second' },
    ]);
});

test('renders unattributed ordinary additions without placeholder IDs', () => {
    const additions = rebuildOrdinaryClipAdditions({ additions: [] }, 'manual addition');
    const report = renderClipReviewReport({ sceneStart: 1, sceneEnd: 2, candidates: [{ type: 'ordinary', title: 'Legacy Clip', additions }] });
    assert.match(report, /Suggested additions:\n- manual addition/);
    assert.doesNotMatch(report, /\[(?:undefined|null)\]/);
});

test('reports oversized automatic updates as requiring review', () => {
    const report = renderClipReviewReport({
        sceneStart: 1,
        sceneEnd: 2,
        status: 'automatic',
        reviewCount: 1,
        candidates: [{ type: 'ordinary', title: 'Long Clip', reviewReason: 'long entry', additions: [] }],
    });
    assert.match(report, /1 Clip update requires approval/);
    assert.match(report, /Review required: long entry/);
});

test('reports a declined topic token warning without calling discovery failed', () => {
    const report = renderClipReviewReport({ sceneStart: 1, sceneEnd: 2, suggestionPassDeclined: true });
    assert.match(report, /Topical Clip discovery was skipped because the token warning was declined\./);
    assert.doesNotMatch(report, /discovery failed/);
});

test('automatic apply stops after cancellation and reports ordinary failures', async () => {
    const controller = new AbortController();
    const attempted = [];
    const failures = [];
    const canceled = new Error('canceled');

    await assert.rejects(
        applyAutomaticClipReviewCandidates(
            [{ uid: 1, type: 'ordinary' }, { uid: 2, type: 'ordinary' }, { uid: 3, type: 'ordinary' }],
            async candidate => {
                attempted.push(candidate.uid);
                if (candidate.uid === 1) throw new Error('conflict');
                if (candidate.uid === 2) controller.abort(canceled);
                return true;
            },
            { signal: controller.signal, applyError: 'apply failed', onFailure: error => failures.push(error.message) },
        ),
        canceled,
    );
    assert.deepEqual(attempted, [1, 2]);
    assert.deepEqual(failures, ['conflict']);
});

test('automatic apply preserves topical and failed candidates for review', async () => {
    const failures = [];
    const result = await applyAutomaticClipReviewCandidates(
        [{ uid: 1, type: 'ordinary' }, { uid: 2, type: 'topical' }, { uid: 3, type: 'ordinary' }, { uid: 4, type: 'ordinary' }],
        async candidate => {
            if (candidate.uid === 3) throw new Error('conflict');
            if (candidate.uid === 4) {
                const error = new Error('long entry');
                error.code = CLIP_REVIEW_REQUIRES_REVIEW;
                throw error;
            }
            return true;
        },
        { applyError: 'apply failed', onFailure: error => failures.push(error.message) },
    );

    assert.deepEqual(result, {
        pendingCandidates: [
            { uid: 2, type: 'topical' },
            { uid: 3, type: 'ordinary', applyError: 'apply failed' },
            { uid: 4, type: 'ordinary', reviewReason: 'long entry' },
        ],
        appliedCount: 1,
        failedCount: 1,
        reviewCount: 2,
    });
    assert.deepEqual(failures, ['conflict']);
});

test('validates ordinary excerpts and topical replacements', () => {
    const records = [
        { uid: '1', type: 'ordinary', title: 'One', contentHash: 'a' },
        { uid: '2', type: 'topical', title: 'Two', contentHash: 'b' },
    ];
    const result = parseClipReviewResponse('{"1":"the brass key","2":"Alice has the brass key."}', records, [{ id: 10, mes: 'Alice found the brass key.' }]);
    assert.deepEqual(result[0].evidenceMessageIds, [10]);
    assert.equal(result[1].proposedContent, 'Alice has the brass key.');
    assert.deepEqual(parseClipReviewResponse('{"1":"  ","2":""}', records, []), []);
    assert.throws(() => parseClipReviewResponse('{"1":"invented"}', records, [{ id: 10, mes: 'source' }]), /none matched/i);
    assert.throws(() => parseClipReviewResponse('{"1":[]}', records, []), /none matched/i);
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
