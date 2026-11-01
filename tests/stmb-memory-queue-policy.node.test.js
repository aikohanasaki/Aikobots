import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

import {
    findOverlappingManagedMemoryEntry,
    shouldBlockStmbMemoryPreparation,
} from '../public/scripts/stmb-core.js';

test('explicit memories may prepare while queued jobs are active', () => {
    assert.equal(shouldBlockStmbMemoryPreparation({ hasActiveJob: true }), false);
    assert.equal(shouldBlockStmbMemoryPreparation({
        hasActiveJob: true,
        requiresIdleQueue: true,
    }), true);
});

test('active preparation and non-queue tasks still block memory preparation', () => {
    assert.equal(shouldBlockStmbMemoryPreparation({ preparationInProgress: true }), true);
    assert.equal(shouldBlockStmbMemoryPreparation({ hasActiveTask: true }), true);
});

test('memory preparation permits owned operations but preserves recovery for unowned work', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function initiateMemoryCreation(');
    const end = source.indexOf('function getStmbCanonicalEntryNumber(', start);
    assert.ok(start >= 0 && end > start);
    const reviewStart = source.indexOf('export async function reviewStmbOperations(');
    const reviewEnd = source.indexOf('/** Opens the existing operation review', reviewStart);
    assert.ok(reviewStart >= 0 && reviewEnd > reviewStart);
    for (const owner of ['runningJobs', 'queue', 'recentHistory', 'otherChat', 'none']) {
        let prepared = 0;
        const notices = [];
        const jobs = { runningJobs: [], queue: [], recentHistory: [] };
        if (owner in jobs) jobs[owner].push({ payload: { operationId: 'active-operation' } });
        const stores = { 'current-chat': jobs };
        if (owner === 'otherChat') stores['other-chat'] = { runningJobs: [{ payload: { operationId: 'active-operation' } }], queue: [] };
        const context = vm.createContext({
            memoryPreparationInProgress: false,
            getStmbOperations: async () => ({ operations: [{ id: 'active-operation' }] }),
            getStmbChatKey: () => 'current-chat',
            getStmbJobStoreSnapshot: key => {
                assert.equal(key, 'current-chat');
                return stores[key];
            },
            buildStmbSceneContext: () => ({ chatRef: {} }),
            translate: text => text,
            toastr: { info: text => notices.push(text) },
            resolveStmbOperation: () => assert.fail('Recovery must not resolve job-owned work while jobs are active'),
            assertRangeWithinCurrentChat: () => {},
            validateMemoryCreationContext: () => true,
            hasActiveStmbTasks: () => false,
            hasActiveStmbJobs: () => true,
            shouldBlockStmbMemoryPreparation,
            executeMemoryCreationFromRange: async () => { prepared++; return { queued: true }; },
        });
        vm.runInContext(source.slice(reviewStart, reviewEnd).replace('export ', ''), context);
        const initiate = vm.runInContext(source.slice(start, end) + '; initiateMemoryCreation', context);
        const options = { range: { sceneStart: 10, sceneEnd: 20 }, sceneContext: { chatRef: {} } };
        const owned = owner === 'runningJobs' || owner === 'queue';
        await initiate(options);
        assert.equal(prepared, owned ? 1 : 0, owner);
        assert.equal(notices.length, owned ? 0 : 1, owner);
        if (owned) {
            context.getStmbOperations = async () => ({ operations: [{ id: 'active-operation' }, { id: 'orphan' }] });
            await initiate(options);
            assert.equal(prepared, 1, 'unrelated unresolved work must still block preparation');
            assert.equal(notices.length, 1);
        }
        assert.match(notices[0], /Finish or cancel all running or queued jobs for this chat in Memory Books Jobs/);
        assert.match(notices[0], /Then retry Pending Memory Books operations/);
        await vm.runInContext('reviewStmbOperations({ auto: true })', context);
        assert.equal(notices.length, 1, 'automatic review must stay quiet while busy');
        context.hasActiveStmbJobs = () => false;
        context.hasActiveStmbTasks = () => true;
        await vm.runInContext('reviewStmbOperations()', context);
        assert.equal(notices.length, 2, 'active tasks must also explain blocked recovery');
        context.hasActiveStmbTasks = () => false;
        let recovered = 0;
        context.resolveStmbOperation = async () => { recovered++; return { operations: [] }; };
        context.isSceneContextCurrent = () => true;
        context.refreshMemoryBoundaryUi = () => {};
        await vm.runInContext('reviewStmbOperations()', context);
        assert.equal(recovered, 1, 'recovery must resume once jobs and tasks finish');
        assert.equal(notices.length, 2);
    }
});

test('an identical saved memory range is detected as an overlap', () => {
    const entry = {
        uid: 7,
        comment: '[001] - Existing Memory',
        stmemorybooks: true,
        STMB_start: 10,
        STMB_end: 20,
    };

    assert.deepEqual(
        findOverlappingManagedMemoryEntry({ 7: entry }, { sceneStart: 10, sceneEnd: 20 }),
        {
            entry,
            title: '[001] - Existing Memory',
            range: { start: 10, end: 20 },
        },
    );
});
