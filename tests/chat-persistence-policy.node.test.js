import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSkipUnstartedCharacterChatSave } from '../public/scripts/chat-persistence-policy.js';

test('temporary character chats stay client-only until a user message exists', () => {
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [],
    }), true);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Greeting' }],
    }), true);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Generated opening' }, { is_user: true, mes: 'Hello' }],
    }), false);
});

test('the policy does not suppress established character chats', () => {
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: false,
        hasLocalPristineGreeting: true,
        messages: [{ is_user: false, mes: 'Local greeting' }],
    }), true);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: false,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Imported assistant-only chat' }],
    }), false);
});
