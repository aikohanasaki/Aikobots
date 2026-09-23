import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { commitStmbConsolidation } from '../src/stmb-consolidation-commit.js';
import { saveConsolidationBatch, getConsolidationConsumedIds } from '../public/scripts/stmb-consolidation-commit.js';
import { buildStmbRetryPayload } from '../public/scripts/stmb-job-retry-policy.js';
import {
    fingerprintLorebookEntry, verifySummarySourceFingerprints, migrateLorebookSummarySchema,
    getNextSummaryNumber, getSummaryTierLabel, createManagedSummaryEntryData,
} from '../public/scripts/stmb-summary.js';

const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');

test('commit route checks access on replay and acknowledges before testing stale sources', async t => {
    const previousRoot = globalThis.DATA_ROOT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-consolidation-route-'));
    globalThis.DATA_ROOT = root;
    t.after(() => { globalThis.DATA_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });
    const endpoint = fs.readFileSync(new URL('../src/endpoints/stmb.js', import.meta.url), 'utf8');
    const start = endpoint.indexOf("router.post('/commit-summaries'");
    const end = endpoint.indexOf("router.post('/upsert-entry-by-title'", start);
    let handler;
    let persisted = { entries: { 0: { uid: 0, comment: '[MEM 001]', content: 'Ordinary memory', stmemorybooks: true, disable: false } } };
    migrateLorebookSummarySchema(persisted);
    const body = {
        batchId: 'route-batch', lorebookName: 'Book', targetTier: 1, disableOriginals: true,
        summaryCandidates: [{ title: 'Summary', summary: 'Ordinary summary', memberIds: ['0'] }],
        sourceFingerprints: { 0: fingerprintLorebookEntry(persisted.entries[0]) }, sourceIds: ['0'],
    };
    let authorized = true;
    let saves = 0;
    let locked = false;
    vm.runInNewContext(endpoint.slice(start, end), {
        router: { post: (_path, callback) => { handler = callback; } },
        getLorebookContext: () => ({ lorebookName: 'Book', storage: 'user' }),
        withLorebookManagementTransaction: async callback => {
            locked = true;
            try {
                return await callback({ save: async (_user, _name, data) => { persisted = structuredClone(data); saves++; } });
            } finally { locked = false; }
        },
        getLorebookForManagement: async () => {
            assert.equal(locked, true);
            if (!authorized) throw Object.assign(new Error('Access denied'), { status: 403 });
            return { data: structuredClone(persisted), metadata: { name: 'Book', storage: 'user' } };
        },
        ensureEntriesObject() {}, commitStmbConsolidation, migrateLorebookSummarySchema,
        verifySummarySourceFingerprints, getNextSummaryNumber, getSummaryTierLabel, createManagedSummaryEntryData,
        createLorebookEntry: data => {
            const uid = Math.max(...Object.values(data.entries).map(entry => entry.uid)) + 1;
            return (data.entries[uid] = { uid });
        },
        applyLorebookSettings() {}, restoreManagedInclusionGroup() {}, structuredClone,
        sendSanitizedStmbError: (response, error) => response.status(error.status || 500).send({ error: error.type }),
    });
    const invoke = async () => {
        const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(value) { this.body = value; return this; } };
        await handler({ body, user: { profile: { handle: 'test-user' } } }, response);
        return response;
    };
    assert.equal((await invoke()).statusCode, 200);
    assert.equal(persisted.entries[0].disable, true);
    assert.equal((await invoke()).body.replayed, true);
    assert.equal(saves, 1);
    authorized = false;
    assert.equal((await invoke()).statusCode, 403);
    assert.equal(saves, 1);
});

test('durable consolidation receipts recover lost responses and reject real conflicts', async t => {
    const previousRoot = globalThis.DATA_ROOT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-consolidation-'));
    globalThis.DATA_ROOT = root;
    t.after(() => {
        globalThis.DATA_ROOT = previousRoot;
        fs.rmSync(root, { recursive: true, force: true });
    });
    let persisted = { entries: { 0: { uid: 0, content: 'Ordinary source', disable: false } } };
    const input = { batchId: 'batch-1', sourceFingerprints: { 0: fingerprintLorebookEntry(persisted.entries[0]) } };
    let saves = 0;
    const run = async ({ request = input, failBeforeSave = false, failAfterSave = false } = {}) => {
        const data = structuredClone(persisted);
        return commitStmbConsolidation({
            userHandle: 'test-user', metadata: { storage: 'user', name: 'Ordinary book' }, data, input: request,
            build() {
                verifySummarySourceFingerprints(data, request.sourceFingerprints);
                data.entries[1] = { uid: 1, content: 'Ordinary summary' };
                data.entries[0].disable = true;
                return { createdEntries: [data.entries[1]], orderClampNotifications: [] };
            },
            async save() {
                if (failBeforeSave) throw new Error('Write unavailable');
                persisted = structuredClone(data);
                saves++;
                if (failAfterSave) throw new Error('Response lost');
            },
        });
    };
    await assert.rejects(run({ failBeforeSave: true }), /Write unavailable/);
    assert.equal(saves, 0);
    await assert.rejects(run({ failAfterSave: true }), /Response lost/);
    assert.equal(saves, 1);
    // A fresh call reads the disk receipt, as another worker would. Source disabling
    // must not run the old precondition again or create another summary.
    const replay = await run();
    assert.equal(replay.replayed, true);
    assert.equal(replay.createdEntries[0].uid, 1);
    assert.equal(saves, 1);
    persisted.entries[2] = { uid: 2, content: 'Later unrelated memory' };
    assert.equal((await run()).replayed, true);
    await assert.rejects(run({ request: { ...input, disableOriginals: false } }), { type: 'StmbConsolidationCommitConflict' });
    persisted.entries[1].content = 'Edited summary';
    await assert.rejects(run(), { type: 'StmbConsolidationCommitConflict' });
    await assert.rejects(run({ request: { ...input, batchId: 'new-batch' } }), { type: 'StmbSourceChanged' });
    assert.equal(saves, 1);
    const receipts = fs.readdirSync(path.join(root, '_stmb', 'consolidation-commits'));
    assert.equal(receipts.length, 1);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '_stmb', 'consolidation-commits', receipts[0]), 'utf8'));
    assert.deepEqual(Object.keys(receipt).sort(), ['beforeHash', 'outputHashes', 'requestHash', 'state']);
    for (const value of [receipt.beforeHash, receipt.requestHash, ...receipt.outputHashes]) assert.match(value, /^[a-f0-9]{64}$/);
});

test('retry preserves the exact pending batch and earlier preview progress', async () => {
    const checkpoint = { pending: null, completedEntries: [], completedCandidates: [], rejectedIds: ['9'], preview: true };
    const first = { batchId: 'first', summaryCandidates: [{ memberIds: ['0'] }] };
    const second = { batchId: 'second', summaryCandidates: [{ memberIds: ['1'] }] };
    const persist = () => {};
    await saveConsolidationBatch(checkpoint, first, { persist, send: async () => ({ createdEntries: [{ uid: 10 }] }) });
    await assert.rejects(saveConsolidationBatch(checkpoint, second, { persist, send: async () => { throw new Error('504'); } }), /504/);
    const retry = buildStmbRetryPayload({ type: 'consolidation', payload: { consolidationCommit: checkpoint } }).consolidationCommit;
    assert.deepEqual(retry.pending, second);
    assert.notEqual(retry.pending, checkpoint.pending);
    await saveConsolidationBatch(retry, { batchId: 'must-not-replace-pending' }, {
        persist,
        send: async request => {
            assert.deepEqual(request, second);
            return { createdEntries: [{ uid: 11 }], replayed: true };
        },
    });
    assert.equal(retry.pending, null);
    assert.deepEqual(retry.completedEntries.map(entry => entry.uid), [10, 11]);
    assert.deepEqual([...getConsolidationConsumedIds(retry)].sort(), ['0', '1', '9']);
    assert.equal(buildStmbRetryPayload({ type: 'consolidation', payload: {} }).consolidationNeedsReview, true);
});

test('an uncertain non-preview save resumes before loading sources or generating', async () => {
    const checkpoint = { preview: false, pending: { batchId: 'pending', summaryCandidates: [{ memberIds: ['0'] }] }, completedEntries: [], completedCandidates: [], rejectedIds: [] };
    const events = [];
    const start = source.indexOf('async function runSummaryConsolidationNow(');
    const end = source.indexOf('async function executeConsolidationJob(', start);
    const run = vm.runInNewContext(source.slice(start, end) + '; runSummaryConsolidationNow', {
        getModuleSettings: () => ({}),
        worldInfoCache: { delete: () => events.push('invalidate') },
        loadWorldInfo: () => assert.fail('Already saved sources should not be loaded for generation'),
        commitSummaryCandidates: async (_candidates, options) => {
            events.push('resume');
            await saveConsolidationBatch(options.checkpoint, null, {
                persist: options.persistCheckpoint,
                send: async request => {
                    assert.equal(request.batchId, 'pending');
                    return { createdEntries: [{ uid: 1 }] };
                },
            });
        },
        applyPostSummarySaveLorebookEffects: async () => events.push('refresh'),
        runPostConsolidationCommitFlow: async () => events.push('post-save'),
    });
    const payload = { lorebookName: 'Book', consolidationCommit: checkpoint };
    const result = await run(payload, null, null, { job: { payload }, patch() {}, setState() {} });
    assert.equal(result.entries.length, 1);
    assert.deepEqual(events, ['invalidate', 'resume', 'refresh', 'post-save']);
});

test('a failed save invalidates the browser cache while retaining the pending request', async () => {
    const checkpoint = { pending: null, completedEntries: [], completedCandidates: [] };
    const invalidated = [];
    const start = source.indexOf('async function commitSummaryCandidates(');
    const end = source.indexOf('async function runPostConsolidationCommitFlow(', start);
    const commit = vm.runInNewContext(source.slice(start, end) + '; commitSummaryCandidates', {
        throwIfStmbAborted() {}, createAikobotsUuid: () => 'stable-batch',
        getLorebookStorageForRequest: () => 'user', getModuleSettings: () => ({}),
        saveConsolidationBatch,
        commitStmbSummaries: async () => { throw new Error('504'); },
        worldInfoCache: { delete: name => invalidated.push(name) },
    });
    await assert.rejects(commit([{ memberIds: ['0'] }], { lorebookName: 'Book', normalizedTargetTier: 1, checkpoint }), /504/);
    assert.deepEqual(invalidated, ['Book']);
    assert.equal(checkpoint.pending.batchId, 'stable-batch');
});

test('preview checkpoints accepted and rejected work before a later generation fails', async () => {
    const checkpoint = { pending: null, completedEntries: [{ uid: 10 }], completedCandidates: [{ memberIds: ['0'] }], rejectedIds: ['9'] };
    const start = source.indexOf('async function runConsolidationPreviewWorkflow(');
    const end = source.indexOf('\nasync function ', start + 1);
    const run = vm.runInNewContext(source.slice(start, end) + '; runConsolidationPreviewWorkflow', {
        getSummarySourceUid: entry => String(entry.uid),
        getSummaryEntriesById: (entries, ids) => entries.filter(entry => ids.has(String(entry.uid))),
        collectSummaryMemberIds: candidates => new Set(candidates.flatMap(candidate => candidate.memberIds)),
        throwIfStmbAborted() {}, hasAmbiguousMultiSummaryAssignments: () => false,
        buildConsolidationApprovalRequest: request => request,
        awaitStmbJobApproval: async (_context, request) => {
            assert.equal(request.lockedCount, 1);
            return { decision: 'approve', editedData: { acceptedCandidates: [{ memberIds: ['1'] }], rejectedCandidates: [{ memberIds: ['2'] }] } };
        },
    });
    await assert.rejects(run({
        checkpoint, persistCheckpoint() {}, context: {},
        initialAnalysis: { summaryCandidates: [{ memberIds: ['1'] }, { memberIds: ['2'] }] },
        selectedEntries: [{ uid: 1 }, { uid: 2 }, { uid: 3 }],
        commitCandidates: candidates => saveConsolidationBatch(checkpoint, { batchId: 'next', summaryCandidates: candidates }, {
            persist() {}, send: async () => ({ createdEntries: [{ uid: 11 }] }),
        }).then(result => result.createdEntries),
        generateAnalysis: async (entries, locked) => {
            assert.deepEqual(Array.from(entries, entry => entry.uid), [3]);
            assert.equal(locked.length, 2);
            throw new Error('504');
        },
    }), /504/);
    assert.deepEqual([...getConsolidationConsumedIds(checkpoint)].sort(), ['0', '1', '2', '9']);
    assert.equal(checkpoint.completedEntries.length, 2);
});
