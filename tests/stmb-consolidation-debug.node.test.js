import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as summary from '../public/scripts/stmb-summary.js';

const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');
const start = source.indexOf('async function runSequentialSummaryAnalysis(');
const end = source.indexOf('function buildMemorySceneData(', start);
assert.ok(start >= 0 && end > start);

async function runAnalysis(debugLorebookName) {
    const logs = [];
    const entries = Array.from({ length: 20 }, (_, index) => ({
        uid: 100 + index,
        comment: `${String(index + 1).padStart(3, '0')} - Example`,
        content: `Example memory ${index + 1}`,
        key: [],
        unrelatedMetadata: 'must not be logged',
    }));
    const context = vm.createContext({
        ...summary,
        console: { log: (stage, value) => logs.push({
            stage,
            data: stage.endsWith('Full assembled prompt') ? value : JSON.parse(value),
        }) },
        getStmbOrdinaryUserLorebookNames: () => ['Ordinary book'],
        translate: value => value,
        throwIfStmbAborted: () => {},
        estimateSummaryPromptTokens: async () => ({ total: 1000 }),
        requestStructuredSummaryWithRetry: async () => ({
            parsed: {
                summaries: [{ title: 'Example arc', summary: 'Example result', member_ids: ['015'], keywords: [] }],
                unassigned_items: [{ id: '001', reason: 'Example omission' }],
            },
        }),
        resolveConsolidationCandidateKeywords: async () => ({ keywords: [], usedFallback: false }),
        isStmbAbortError: () => false,
    });
    const run = vm.runInContext(`${source.slice(start, end)}; runSequentialSummaryAnalysis`, context);
    const result = await run(entries, {
        debugLorebookName,
        presetKey: 'arc_default',
        promptText: summary.STMB_DEFAULT_SUMMARY_PROMPTS.arc_default,
        maxItemsPerPass: 15,
        maxPasses: 10,
        requiredMin: 5,
        tokenTarget: 80000,
    }, {});
    return { logs, result: JSON.parse(JSON.stringify(result)) };
}

test('consolidation diagnostics distinguish sent sources, model IDs, resolved members, and final leftovers', async () => {
    const { logs, result } = await runAnalysis('Ordinary book');
    const sent = logs.filter(log => log.stage.endsWith('Memories sent'));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].data.memories.length, 15);
    const prompts = logs.filter(log => log.stage.endsWith('Full assembled prompt')).map(log => log.data);
    assert.equal(prompts.length, 2);
    assert.ok(prompts[0].startsWith('You are an expert narrative analyst'));
    assert.ok(prompts[0].includes('Contents: Example memory 15'));
    assert.equal(prompts[0].includes('Contents: Example memory 16'), false);
    assert.ok(prompts[1].includes('=== PREVIOUS ARC (CANON'));
    assert.ok(prompts[1].includes('Example result'));
    assert.deepEqual(sent[0].data.memories.at(-1), {
        sourceId: '015', uid: '114', title: '015 - Example', content: 'Example memory 15', gapMarker: false,
    });
    assert.equal(sent[1].data.memories.at(-1).uid, '115');
    const returned = logs.find(log => log.stage.endsWith('Arcs returned by model')).data;
    assert.deepEqual(returned.arcs[0], { title: 'Example arc', summary: 'Example result', member_ids: ['015'] });
    assert.deepEqual(returned.unassignedItems, [{ id: '001', reason: 'Example omission' }]);
    const resolved = logs.find(log => log.stage.endsWith('Resolved arc members and leftovers')).data;
    assert.deepEqual(resolved.arcs[0].memberUids, ['114']);
    assert.equal(resolved.leftOutOfPassUids.length, 14);
    assert.equal(resolved.remainingUids.length, 19);
    assert.ok(logs.some(log => log.stage.endsWith('Stopped below minimum progress')));
    assert.equal(logs.at(-1).data.memoriesLeftOut.length, 18);
    assert.deepEqual(result.summaryCandidates.map(arc => arc.memberIds), [['114'], ['115']]);
    assert.equal(JSON.stringify(logs).includes('must not be logged'), false);
});

test('consolidation diagnostics stay silent without an ordinary user lorebook', async () => {
    for (const name of [undefined, 'Secure book', 'Unknown book']) {
        const { logs, result } = await runAnalysis(name);
        assert.deepEqual(logs, []);
        assert.equal(result.summaryCandidates.length, 2);
    }
});
