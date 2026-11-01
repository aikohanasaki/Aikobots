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
    for (const owner of ['runningJobs', 'queue', 'recentHistory', 'otherChat', 'none']) {
        let prepared = 0;
        let reviewed = 0;
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
            reviewStmbOperations: async () => { reviewed++; },
            assertRangeWithinCurrentChat: () => {},
            validateMemoryCreationContext: () => true,
            hasActiveStmbTasks: () => false,
            hasActiveStmbJobs: () => true,
            shouldBlockStmbMemoryPreparation,
            executeMemoryCreationFromRange: async () => { prepared++; return { queued: true }; },
        });
        const initiate = vm.runInContext(source.slice(start, end) + '; initiateMemoryCreation', context);
        const options = { range: { sceneStart: 10, sceneEnd: 20 }, sceneContext: { chatRef: {} } };
        const owned = owner === 'runningJobs' || owner === 'queue';
        await initiate(options);
        assert.equal(prepared, owned ? 1 : 0, owner);
        assert.equal(reviewed, owned ? 0 : 1, owner);
        if (owned) {
            context.getStmbOperations = async () => ({ operations: [{ id: 'active-operation' }, { id: 'orphan' }] });
            await initiate(options);
            assert.equal(prepared, 1, 'unrelated unresolved work must still block preparation');
            assert.equal(reviewed, 1);
        }
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
