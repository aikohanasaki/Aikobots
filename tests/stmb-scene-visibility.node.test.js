import assert from 'node:assert/strict';
import test from 'node:test';
import { getSceneMessageVisibilityStats } from '../public/scripts/stmb-core.js';

test('scene visibility stats distinguish hidden messages in the selected range', () => {
    const messages = [
        { mes: 'outside' },
        { mes: 'hidden one', is_system: true },
        { mes: 'hidden two', is_system: true },
        { mes: 'visible' },
        { mes: 'outside', is_system: true },
    ];

    assert.deepEqual(getSceneMessageVisibilityStats(messages, 1, 3), {
        totalMessageCount: 3,
        hiddenMessageCount: 2,
        visibleMessageCount: 1,
    });
});

test('scene visibility stats ignore unavailable slots and invalid ranges', () => {
    assert.deepEqual(getSceneMessageVisibilityStats([null, { is_system: true }], 0, 1), {
        totalMessageCount: 1,
        hiddenMessageCount: 1,
        visibleMessageCount: 0,
    });
    assert.deepEqual(getSceneMessageVisibilityStats([], 2, 1), {
        totalMessageCount: 0,
        hiddenMessageCount: 0,
        visibleMessageCount: 0,
    });
});
