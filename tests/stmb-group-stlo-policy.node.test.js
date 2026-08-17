import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStmbGroupStloReconciliationTargets } from '../public/scripts/stmb-group-stlo-policy.js';

test('group STLO reconciliation merges shared books and skips invalid bindings', () => {
    const targets = buildStmbGroupStloReconciliationTargets({
        members: [
            { key: 'a', characterFilterName: 'Alice' },
            { key: 'b', characterFilterName: 'Bob' },
            { key: 'c', characterFilterName: 'Carol' },
            { key: 'd', characterFilterName: 'Dana' },
        ],
        bindings: { a: 'Shared', b: 'Shared', c: 'Group Memory', d: 'Missing' },
        canonicalLorebookName: 'Group Memory',
        availableLorebookNames: ['Shared', 'Group Memory'],
        getStorage: () => 'user',
    });

    assert.deepEqual(targets, [{
        lorebookName: 'Shared',
        storage: 'user',
        characterNames: ['Alice', 'Bob'],
    }]);
});
