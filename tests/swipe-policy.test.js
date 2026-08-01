import assert from 'node:assert/strict';
import test from 'node:test';

import { canGenerateHistoricalSwipe } from '../public/scripts/swipe-policy.js';

test('historical swipe generation requires every later message to be prompt-hidden', () => {
    const messages = [
        { mes: 'target', is_system: false },
        { mes: 'later user', is_system: false },
        { mes: 'later assistant', is_system: true },
    ];

    assert.equal(canGenerateHistoricalSwipe(messages, 0), false);
    messages[1].is_system = true;
    assert.equal(canGenerateHistoricalSwipe(messages, 0), true);
    assert.equal(canGenerateHistoricalSwipe(messages, 2), false);
    messages[0].is_system = true;
    assert.equal(canGenerateHistoricalSwipe(messages, 0), false);
});

test('historical swipe generation uses the prompt assembler visibility policy', () => {
    const messages = [
        { mes: 'target' },
        { mes: 'ignored later message', extra: { ignore: true } },
    ];
    const isPromptHidden = message => message?.extra?.ignore === true;

    assert.equal(canGenerateHistoricalSwipe(messages, 0, isPromptHidden), true);
    messages[0].extra = { ignore: true };
    assert.equal(canGenerateHistoricalSwipe(messages, 0, isPromptHidden), false);
});
