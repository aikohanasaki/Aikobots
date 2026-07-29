import test from 'node:test';
import assert from 'node:assert/strict';

import { filterAutomaticSidePromptSetItems } from '../public/scripts/stmb-sideprompt-set-policy.js';

const makeItem = (overrides = {}) => ({
    baseTemplate: {
        enabled: true,
        triggers: {
            onAfterMemory: { enabled: false },
            onInterval: { visibleMessages: 0 },
        },
        ...overrides,
    },
});

test('automatic set filtering keeps only rows enabled for the requested trigger', () => {
    const afterMemory = makeItem({ triggers: { onAfterMemory: { enabled: true } } });
    const interval = makeItem({ triggers: { onInterval: { visibleMessages: 25 } } });
    const disabled = makeItem({
        enabled: false,
        triggers: {
            onAfterMemory: { enabled: true },
            onInterval: { visibleMessages: 25 },
        },
    });

    assert.deepEqual(filterAutomaticSidePromptSetItems([afterMemory, interval, disabled], 'onAfterMemory'), [afterMemory]);
    assert.deepEqual(filterAutomaticSidePromptSetItems([afterMemory, interval, disabled], 'onInterval'), [interval]);
});
