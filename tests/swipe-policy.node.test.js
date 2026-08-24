import assert from 'node:assert/strict';
import test from 'node:test';

import { canGenerateHistoricalSwipe, shouldDisplaySwipeCounter, shouldRestoreSwipeButtons } from '../public/scripts/swipe-policy.js';

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

test('swipe counters distinguish prompt-hidden messages from system notices', () => {
    const isSystemNotice = message => message?.extra?.type === 'notice';

    assert.equal(shouldDisplaySwipeCounter({ is_system: true, swipes: ['one', 'two'] }, isSystemNotice), true);
    assert.equal(shouldDisplaySwipeCounter({ is_system: true, swipes: ['notice'], extra: { type: 'notice' } }, isSystemNotice), false);
    assert.equal(shouldDisplaySwipeCounter({ is_user: true, swipes: ['user'] }, isSystemNotice), false);
    assert.equal(shouldDisplaySwipeCounter({ swipes: ['small'], extra: { isSmallSys: true } }, isSystemNotice), false);
});

test('send controls restore swipes only when no other UI operation owns them', () => {
    const available = {
        swipesEnabled: true,
        hasActiveMessageEdit: false,
        isDeleteMode: false,
        isGroupGenerating: false,
    };

    assert.equal(shouldRestoreSwipeButtons(available), true);
    assert.equal(shouldRestoreSwipeButtons({ ...available, swipesEnabled: false }), false);
    assert.equal(shouldRestoreSwipeButtons({ ...available, hasActiveMessageEdit: true }), false);
    assert.equal(shouldRestoreSwipeButtons({ ...available, isDeleteMode: true }), false);
    assert.equal(shouldRestoreSwipeButtons({ ...available, isGroupGenerating: true }), false);
});
