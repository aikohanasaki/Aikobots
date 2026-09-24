import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { commitStmbConsolidation, cleanupStmbConsolidationReceipts, listStmbConsolidationRecoveries, readStmbConsolidationRecovery, writeStmbConsolidationRecovery } from '../src/stmb-consolidation-commit.js';
import { saveConsolidationBatch, getConsolidationConsumedIds, buildConsolidationRecoveryContext } from '../public/scripts/stmb-consolidation-commit.js';
import { buildStmbRetryPayload } from '../public/scripts/stmb-job-retry-policy.js';
import {
    fingerprintLorebookEntry, verifySummarySourceFingerprints, migrateLorebookSummarySchema,
    getNextSummaryNumber, getSummaryTierLabel, createManagedSummaryEntryData,
} from '../public/scripts/stmb-summary.js';

const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');

test('recovery completion retains its identity until originating-chat effects are acknowledged', async () => {
    const start = source.indexOf('async function completeConsolidationCheckpoints(');
    const end = source.indexOf('/** Persists the active chat', start);
    let current = false;
    let failed = true;
    const calls = [];
    const complete = vm.runInNewContext(source.slice(start, end) + '; completeConsolidationCheckpoints', {
        isSceneContextCurrent: () => current,
        resolveStmbConsolidationRecovery: async (action, id) => {
            calls.push([action, id]);
            if (failed) throw new Error('Lost acknowledgement');
        },
    });
    const checkpoint = { recovery: { sceneContext: { chatId: 'origin' } }, recoveryIds: ['accepted'] };
    await complete(checkpoint);
    assert.equal(calls.length, 0);
    current = true;
    await assert.rejects(complete(checkpoint), /Lost acknowledgement/);
    assert.deepEqual(checkpoint.recoveryIds, ['accepted']);
    failed = false;
    await complete(checkpoint);
    assert.equal(checkpoint.recoveryIds.length, 0);
    assert.deepEqual(calls, [['complete', 'accepted'], ['complete', 'accepted']]);
});

test('commit route checks access on replay and acknowledges before testing stale sources', async t => {
    const previousRoot = globalThis.DATA_ROOT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-consolidation-route-'));
    globalThis.DATA_ROOT = root;
    t.after(() => { globalThis.DATA_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });
    const endpoint = fs.readFileSync(new URL('../src/endpoints/stmb.js', import.meta.url), 'utf8');
    const start = endpoint.indexOf("router.post('/commit-summaries'");
    const end = endpoint.indexOf("router.post('/upsert-entry-by-title'", start);
    const handlers = new Map();
    let persisted = { entries: { 0: { uid: 0, comment: '[MEM 001]', content: 'Ordinary memory', stmemorybooks: true, disable: false } } };
    migrateLorebookSummarySchema(persisted);
    const body = {
        batchId: 'route-batch', batchCreatedAt: Date.now(), lorebookName: 'Book', targetTier: 1, disableOriginals: true,
        summaryCandidates: [{ title: 'Summary', summary: 'Ordinary summary', memberIds: ['0'] }],
        sourceFingerprints: { 0: fingerprintLorebookEntry(persisted.entries[0]) }, sourceIds: ['0'],
    };
    let authorized = true;
    let saves = 0;
    let locked = false;
    vm.runInNewContext(endpoint.slice(start, end), {
        router: { post: (route, callback) => { handlers.set(route, callback); } },
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
        listStmbConsolidationRecoveries, readStmbConsolidationRecovery, writeStmbConsolidationRecovery,
        assertLorebookCheckoutForManagement() {},
        createStmbRequestError: (status, type, message) => Object.assign(new Error(message), { status, type }),
        isActiveSessionError: () => false,
        verifySummarySourceFingerprints, getNextSummaryNumber, getSummaryTierLabel, createManagedSummaryEntryData,
        createLorebookEntry: data => {
            const uid = Math.max(...Object.values(data.entries).map(entry => entry.uid)) + 1;
            return (data.entries[uid] = { uid });
        },
        applyLorebookSettings() {}, restoreManagedInclusionGroup() {}, structuredClone,
        sendSanitizedStmbError: (response, error) => response.status(error.status || 500).send({ error: error.type }),
    });
    const invoke = async (route = '/commit-summaries', requestBody = body, handle = 'test-user') => {
        const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(value) { this.body = value; return this; } };
        await handlers.get(route)({ body: requestBody, user: { profile: { handle } } }, response);
        return response;
    };
    assert.equal((await invoke()).statusCode, 200);
    assert.equal(persisted.entries[0].disable, true);
    assert.equal((await invoke()).body.replayed, true);
    assert.equal(saves, 1);
    const recover = (action, id = body.batchId, handle = 'test-user') => invoke('/consolidation-recovery', { action, id }, handle);
    assert.equal((await recover('list')).body.records[0].state, 'saved');
    assert.equal((await recover('list', null, 'different-user')).body.records.length, 0);
    assert.equal((await recover('resume', body.batchId, 'different-user')).statusCode, 404);
    assert.equal((await recover('resume')).body.replayed, true);
    assert.equal(saves, 1);
    authorized = false;
    assert.equal((await invoke()).statusCode, 403);
    assert.equal((await recover('resume')).statusCode, 403);
    assert.equal((await recover('complete')).statusCode, 403);
    const unavailable = (await recover('list')).body.records[0];
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(unavailable.lorebookName, undefined);
    assert.equal(unavailable.summaries, undefined);
    assert.equal(saves, 1);
    authorized = true;
    assert.equal((await recover('complete')).statusCode, 200);
    assert.equal((await recover('complete')).statusCode, 200);
    assert.equal((await recover('list')).body.records.length, 0);
    assert.equal((await recover('resume')).statusCode, 409);
    assert.equal((await recover('resume', '../outside')).statusCode, 409);
});

test('accepted preview batches survive reload independently and dismissal cannot recreate a pending save', async t => {
    const previousRoot = globalThis.DATA_ROOT;
    globalThis.DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-recovery-preview-'));
    t.after(() => { fs.rmSync(globalThis.DATA_ROOT, { recursive: true, force: true }); globalThis.DATA_ROOT = previousRoot; });
    let book = { entries: {} };
    let builds = 0;
    const commit = async (input, fail = false) => {
        const data = structuredClone(book);
        return commitStmbConsolidation({ userHandle: 'user', metadata: { name: 'Book', storage: 'user' }, data, input,
            build: () => {
                builds++;
                const entry = { uid: input.batchId, content: input.summaryCandidates[0].summary };
                data.entries[entry.uid] = entry;
                return { createdEntries: [entry], orderClampNotifications: [] };
            }, save: async () => { if (fail) throw new Error('Interrupted'); book = data; },
        });
    };
    const request = id => ({ batchId: id, batchCreatedAt: Date.now(), summaryCandidates: [{ title: id, summary: `Ordinary ${id}`, memberIds: [] }],
        recovery: buildConsolidationRecoveryContext({ chatId: 'Chat', chatRef: { type: 'character', avatarUrl: 'a.png', fileName: 'Chat' } }, 'run-1') });
    await commit(request('first'));
    await assert.rejects(commit(request('second'), true), /Interrupted/);
    const afterReload = listStmbConsolidationRecoveries('user');
    assert.deepEqual(afterReload.map(record => record.state), ['saved', 'prepared']);
    assert.ok(afterReload.every(record => record.input.recovery.runId === 'run-1'));
    assert.equal((await commit(afterReload[0].input)).replayed, true);
    assert.equal(builds, 2);
    const discarded = afterReload[1];
    writeStmbConsolidationRecovery('user', { ...discarded, state: 'dismissed', updatedAt: Date.now() });
    await assert.rejects(commit(discarded.input), { type: 'StmbConsolidationCommitConflict' });
    assert.equal(book.entries.second, undefined);
    book.entries.first.content = 'Manually edited ordinary summary';
    await assert.rejects(commit(afterReload[0].input), { type: 'StmbConsolidationCommitConflict' });
    assert.equal(readStmbConsolidationRecovery('user', 'first').state, 'needsReview');
    assert.equal(builds, 2);
});

test('protected targets never create payload recovery records', async t => {
    const previousRoot = globalThis.DATA_ROOT;
    globalThis.DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-recovery-storage-'));
    t.after(() => { fs.rmSync(globalThis.DATA_ROOT, { recursive: true, force: true }); globalThis.DATA_ROOT = previousRoot; });
    await commitStmbConsolidation({ userHandle: 'user', metadata: { storage: 'secure' }, data: { entries: {} },
        input: { batchId: 'empty', batchCreatedAt: Date.now() }, build: () => ({ createdEntries: [] }), save: async () => {} });
    assert.equal(listStmbConsolidationRecoveries('user').length, 0);
    assert.equal(fs.existsSync(path.join(globalThis.DATA_ROOT, '_stmb', 'consolidation-recovery')), false);
});

test('only listing consolidation recovery bypasses the active-session mutation gate', () => {
    const source = fs.readFileSync(new URL('../src/middleware/activeSessionLock.js', import.meta.url), 'utf8');
    const start = source.indexOf('const READ_ONLY_POST_ROUTES');
    const end = source.indexOf('function isForcePushChatSaveRoute', start);
    const isReadOnly = vm.runInNewContext(source.slice(start, end) + '; isReadOnlyRoute');
    for (const action of ['list', 'resume', 'complete', 'dismiss', '', null]) {
        assert.equal(isReadOnly({ method: 'POST', path: '/api/stmb/consolidation-recovery', body: { action } }), action === 'list');
    }
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
    const input = { batchId: 'batch-1', batchCreatedAt: Date.now(), sourceFingerprints: { 0: fingerprintLorebookEntry(persisted.entries[0]) } };
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
    assert.deepEqual(Object.keys(receipt).sort(), ['beforeHash', 'outputHashes', 'requestHash', 'savedAt', 'state']);
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
        buildConsolidationRecoveryContext, buildStmbSceneContext: () => ({}), createAikobotsUuid: () => 'run', completeConsolidationCheckpoints: async () => {},
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
        buildConsolidationRecoveryContext, buildStmbSceneContext: () => ({}),
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

test('retention deletes only expired saved receipts and rejects their retries', async t => {
    const previousRoot = globalThis.DATA_ROOT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-retention-'));
    globalThis.DATA_ROOT = root;
    t.after(() => { globalThis.DATA_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });
    const now = Date.now();
    const retention = 30 * 24 * 60 * 60 * 1000;
    const input = { batchId: 'retention', batchCreatedAt: now };
    const data = { entries: { 1: { uid: 1 } } };
    let saves = 0;
    const run = request => commitStmbConsolidation({
        userHandle: 'test', metadata: { storage: 'user', name: 'Book' }, input: request, data,
        build: () => ({ createdEntries: [data.entries[1]] }), save: async () => { saves++; },
    });
    await run(input);
    const directory = path.join(root, '_stmb', 'consolidation-commits');
    const filename = path.join(directory, fs.readdirSync(directory)[0]);
    const original = fs.readFileSync(filename, 'utf8');
    assert.equal((await run(input)).replayed, true);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
    const old = new Date(now - retention - 6 * 60 * 1000);
    for (const state of ['prepared', 'saved', 'needsReview', 'completed', 'dismissed']) {
        writeStmbConsolidationRecovery('test', { id: state, state, updatedAt: old.getTime() });
    }
    const write = (index, value, date = old) => {
        const target = path.join(directory, `${String(index).padStart(64, '0')}.json`);
        fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify({ ...JSON.parse(original), savedAt: undefined, ...value }));
        fs.utimesSync(target, date, date);
        return target;
    };
    const legacy = write(1, { state: 'saved' });
    const planned = write(2, { state: 'planned' });
    const malformed = write(3, '{');
    const unknown = write(4, { state: 'unknown' });
    const recent = write(5, { state: 'saved', savedAt: now });
    const refreshed = write(6, { state: 'saved' });
    let lockCalls = 0;
    const withLock = async callback => {
        lockCalls++;
        // Simulate a writer winning the lock after the sweep's initial stat.
        fs.utimesSync(refreshed, new Date(now), new Date(now));
        return callback();
    };
    await cleanupStmbConsolidationReceipts(withLock, now);
    for (const state of ['prepared', 'saved', 'needsReview']) assert.ok(readStmbConsolidationRecovery('test', state));
    for (const state of ['completed', 'dismissed']) assert.equal(readStmbConsolidationRecovery('test', state), null);
    assert.ok(lockCalls > 0);
    assert.equal(fs.existsSync(legacy), false);
    for (const target of [filename, planned, malformed, unknown, recent, refreshed]) assert.ok(fs.existsSync(target));
    await cleanupStmbConsolidationReceipts(async callback => callback(), now + retention);
    assert.ok(fs.existsSync(filename), 'Retain receipts through the allowed client clock skew');
    await Promise.all([
        cleanupStmbConsolidationReceipts(async callback => callback(), now + retention + 6 * 60 * 1000),
        cleanupStmbConsolidationReceipts(async callback => callback(), now + retention + 6 * 60 * 1000),
    ]);
    assert.equal(fs.existsSync(filename), false);
    for (const request of [
        { batchId: 'legacy' }, {},
        { ...input, batchCreatedAt: now - retention },
        { ...input, batchCreatedAt: now + 10 * 60 * 1000 },
    ]) await assert.rejects(run(request), { type: 'StmbConsolidationCommitConflict' });
    assert.equal(saves, 1);
});
