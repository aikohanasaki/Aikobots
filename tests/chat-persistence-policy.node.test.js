import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSkipUnstartedCharacterChatSave } from '../public/scripts/chat-persistence-policy.js';

test('zero-message temporary character chats always stay client-only', () => {
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [],
    }), true);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [],
        isDirty: true,
    }), true);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [],
        persistPristine: true,
    }), true);
});

test('temporary character chats persist after user activity, edits, or generated output', () => {
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Greeting' }],
    }), true);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: true, mes: 'Hello' }],
    }), false);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Edited opening' }],
        isDirty: true,
    }), false);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: true,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Generated opening' }],
        isDirty: true,
    }), false);
});

test('explicit pristine persistence requires a greeting', () => {
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: false,
        hasLocalPristineGreeting: true,
        messages: [{ is_user: false, mes: 'Local greeting' }],
        persistPristine: true,
    }), false);
});

test('the policy does not suppress established character chats', () => {
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: false,
        hasLocalPristineGreeting: false,
        messages: [],
    }), false);
    assert.equal(shouldSkipUnstartedCharacterChatSave({
        isTemporary: false,
        hasLocalPristineGreeting: false,
        messages: [{ is_user: false, mes: 'Imported assistant-only chat' }],
    }), false);
});
