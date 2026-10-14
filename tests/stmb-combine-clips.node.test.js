import assert from 'node:assert/strict';
import test from 'node:test';
import { areCombineSourcesCurrent, buildCombineClipsPrompt, isClipForCombination, snapshotCombineSource, unionClipKeywords, visibleCombineClipSelection } from '../public/scripts/stmb-combine-clips-policy.js';

const clips = () => [
    { uid: 0, comment: 'First [STMB Clip]', content: 'Synthetic first fact.', key: [' topic ', 'shared', ''], disable: false },
    { uid: 1, comment: 'Second [STMB Clip]', content: 'Synthetic second fact.', key: ['shared', 'other'], disable: true, data: { extensions: { aikobots: { topical_clip: { version: 2 } } } } },
];

test('combination includes ordinary and disabled Topical Clips, and unions only primary keywords', () => {
    const sources = clips();
    sources[1].keysecondary = ['not copied'];
    assert.ok(sources.every(isClipForCombination));
    assert.equal(isClipForCombination({ uid: 2, comment: 'Memory' }), false);
    assert.equal(isClipForCombination({ comment: 'Missing identity [STMB Clip]' }), false);
    assert.deepEqual(unionClipKeywords(sources), ['topic', 'shared', 'other']);
    const prompt = buildCombineClipsPrompt(sources, 'Combined');
    for (const source of sources) assert.ok(prompt.includes(source.content));
    assert.ok(prompt.includes('preserve the conflicting claims'));
    assert.ok(prompt.includes('New entry title: Combined'));
    assert.throws(() => buildCombineClipsPrompt(sources.slice(0, 1), 'Combined'));
});

test('combination rejects changed source fields, duplicate identities, and missing sources', () => {
    const sources = clips();
    const snapshots = sources.map(snapshotCombineSource);
    assert.equal(areCombineSourcesCurrent(snapshots, sources), true);
    for (const change of [
        entry => { entry.comment = 'Renamed [STMB Clip]'; },
        entry => { entry.content = 'Changed'; },
        entry => { entry.key.push('new'); },
        entry => { entry.disable = true; },
        entry => { entry.data = { extensions: { aikobots: { topical_clip: {} } } }; },
    ]) {
        const changed = structuredClone(sources);
        change(changed[0]);
        assert.equal(areCombineSourcesCurrent(snapshots, changed), false);
    }
    assert.equal(areCombineSourcesCurrent(snapshots, sources.slice(1)), false);
    assert.equal(areCombineSourcesCurrent([snapshots[0], snapshots[0]], sources), false);
    assert.equal(areCombineSourcesCurrent(snapshots, [...sources, sources[0]]), false);
    assert.equal(areCombineSourcesCurrent([null, snapshots[1]], sources), false);
    const unrelated = structuredClone(sources);
    unrelated[0].order = 123;
    assert.equal(areCombineSourcesCurrent(snapshots, unrelated), true);
});

test('visibility toggles retain visible selections and drop hidden disabled selections', () => {
    const sources = clips();
    const shown = visibleCombineClipSelection(sources, ['0', '1'], true);
    assert.deepEqual(shown.checked, ['0', '1']);
    const hidden = visibleCombineClipSelection(sources, shown.checked, false);
    assert.deepEqual(hidden.checked, ['0']);
    assert.deepEqual(unionClipKeywords(hidden.visible.filter(entry => hidden.checked.includes(String(entry.uid)))), ['topic', 'shared']);
    assert.deepEqual(visibleCombineClipSelection(sources, hidden.checked, true).checked, ['0']);
});
