import assert from 'node:assert/strict';
import test from 'node:test';

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
