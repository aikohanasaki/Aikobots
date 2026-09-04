import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { canCommitComposerSendAttempt, isSameComposerContext, isSameComposerOwner, mergeRejectedSendDraft, shouldQueueAcknowledgedChatSave, shouldSkipUnstartedCharacterChatSave } from '../public/scripts/chat-persistence-policy.js';

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

test('first SQLite character-chat saves wait for and adopt the revision acknowledgement', () => {
    assert.equal(shouldQueueAcknowledgedChatSave({
        shouldTrackRevision: true,
        isSqlite: false,
        isTemporaryCharacterSave: true,
        isPendingSoloCharacterSave: false,
    }), true);
    assert.equal(shouldQueueAcknowledgedChatSave({
        shouldTrackRevision: true,
        isSqlite: false,
        isTemporaryCharacterSave: false,
        isPendingSoloCharacterSave: true,
    }), true);
    assert.equal(shouldQueueAcknowledgedChatSave({
        shouldTrackRevision: true,
        isSqlite: true,
        isTemporaryCharacterSave: false,
        isPendingSoloCharacterSave: false,
    }), true);
    assert.equal(shouldQueueAcknowledgedChatSave({
        shouldTrackRevision: false,
        isSqlite: true,
        isTemporaryCharacterSave: true,
        isPendingSoloCharacterSave: true,
    }), false);
});

test('a rejected cross-chat hydration cannot mark the active chat temporary', () => {
    const scriptSource = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
    const hydrationStart = scriptSource.indexOf('export function applyChunkedChatPayload');
    const loadStart = scriptSource.indexOf('export async function getChat()');
    const rejectedResult = scriptSource.indexOf('return false;', hydrationStart);
    const applyResult = scriptSource.indexOf("const header = applyChunkedChatPayload(response, { replace: true, currentView: 'tail' });", loadStart);
    const rejectedGuard = scriptSource.indexOf('if (header === false)', applyResult);
    const temporaryTransition = scriptSource.indexOf('setTemporaryCharacterChat(characters[this_chid]?.chat);', rejectedGuard);

    assert.ok(hydrationStart >= 0 && rejectedResult > hydrationStart);
    assert.ok(loadStart >= 0 && applyResult > loadStart);
    assert.ok(rejectedGuard > applyResult && temporaryTransition > rejectedGuard);
});

test('direct chat hydration captures its revision key after expanding a shallow character', () => {
    const scriptSource = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
    const fetchStart = scriptSource.indexOf('async function fetchChunkedChat');
    const characterCapture = scriptSource.indexOf('const characterId = this_chid;', fetchStart);
    const unshallow = scriptSource.indexOf('await unshallowCharacter(characterId);', characterCapture);
    const navigationGuard = scriptSource.indexOf('if (selected_group || this_chid !== characterId', unshallow);
    const revisionCapture = scriptSource.indexOf('const revisionChatKey = getActiveChatRevisionKey();', navigationGuard);
    const directFetch = scriptSource.indexOf("fetch('/api/chats/get'", revisionCapture);

    assert.ok(fetchStart >= 0 && characterCapture > fetchStart);
    assert.ok(unshallow > characterCapture);
    assert.ok(navigationGuard > unshallow);
    assert.ok(revisionCapture > navigationGuard);
    assert.ok(directFetch > revisionCapture);
});

test('a rejected send is restored without overwriting newer composer input', () => {
    assert.equal(mergeRejectedSendDraft('rejected message', ''), 'rejected message');
    assert.equal(mergeRejectedSendDraft('rejected message', 'rejected message'), 'rejected message');
    assert.equal(
        mergeRejectedSendDraft('rejected message', 'newer draft'),
        'rejected message\n\nnewer draft',
    );
    assert.equal(mergeRejectedSendDraft('', 'newer draft'), 'newer draft');
});

test('a posted send can commit after its temporary chat receives a persistent name', () => {
    const messageUuid = '11111111-1111-4111-8111-111111111111';
    const sendAttempt = {
        chatIdentity: { groupId: '', characterId: '3', chatId: 'temporary-chat' },
        messageUuid,
    };

    assert.equal(canCommitComposerSendAttempt(
        sendAttempt,
        { groupId: '', characterId: '3', chatId: 'saved-chat' },
        [{ aikobots_message_uuid: messageUuid }],
    ), true);
    assert.equal(canCommitComposerSendAttempt(
        sendAttempt,
        { groupId: '', characterId: '3', chatId: 'other-chat' },
        [],
    ), false);
    assert.equal(canCommitComposerSendAttempt(
        sendAttempt,
        { groupId: '', characterId: '4', chatId: 'saved-chat' },
        [{ aikobots_message_uuid: messageUuid }],
    ), false);
});

test('a posted group send can commit while generation temporarily selects a member', () => {
    const messageUuid = '11111111-1111-4111-8111-111111111111';
    const sendAttempt = {
        chatIdentity: { groupId: 'group-1', characterId: '', chatId: 'chat-1' },
        messageUuid,
    };
    const messages = [{ aikobots_message_uuid: messageUuid }];

    assert.equal(canCommitComposerSendAttempt(
        sendAttempt,
        { groupId: 'group-1', characterId: '4', chatId: 'chat-1' },
        [],
    ), true);
    assert.equal(canCommitComposerSendAttempt(
        sendAttempt,
        { groupId: 'group-2', characterId: '4', chatId: 'chat-1' },
        messages,
    ), false);
});

test('group composer ownership ignores only the transient selected speaker', () => {
    const captured = { groupId: 'group-1', characterId: '', chatId: 'chat-1' };

    assert.equal(isSameComposerContext(
        captured,
        { groupId: 'group-1', characterId: '4', chatId: 'chat-1' },
    ), true);
    assert.equal(isSameComposerContext(
        captured,
        { groupId: 'group-1', characterId: '4', chatId: 'chat-2' },
    ), false);
    assert.equal(isSameComposerContext(
        captured,
        { groupId: 'group-2', characterId: '4', chatId: 'chat-1' },
    ), false);
});

test('composer owner remains stable when a temporary chat receives its persistent name', () => {
    assert.equal(isSameComposerOwner(
        { groupId: '', characterId: '3', chatId: 'temporary-chat' },
        { groupId: '', characterId: '3', chatId: 'saved-chat' },
    ), true);
    assert.equal(isSameComposerOwner(
        { groupId: '', characterId: '3', chatId: 'temporary-chat' },
        { groupId: '', characterId: '4', chatId: 'saved-chat' },
    ), false);
});

test('only an explicit normal Send owns and consumes the composer after persistence', () => {
    const scriptSource = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
    assert.match(scriptSource, /Generate\(generateType, { consumeComposer: generateType === 'normal' }\)/);
    assert.match(scriptSource, /messageUuid: composerSendAttempt\?\.messageUuid/);
    assert.match(scriptSource, /clearAcceptedComposerDraft\(composerSendAttempt\)/);
    assert.match(scriptSource, /commitComposerSendAttempt\(composerSendAttempt\)/);
    assert.match(scriptSource, /const attachmentDraft = sendOptions\?\.attachmentDraft \?\? capturePendingFileAttachmentDraft\(\)/);
    assert.match(scriptSource, /consumePendingFileAttachmentDraft\(attachmentDraft\)/);
    assert.match(scriptSource, /restorePendingFileAttachmentDraft\(attachmentDraft\);/);
});

test('background generation and failed edit transitions cannot consume user drafts', () => {
    const scriptSource = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
    const groupSource = fs.readFileSync(new URL('../public/scripts/group-chats.js', import.meta.url), 'utf8');
    const slashSource = fs.readFileSync(new URL('../public/scripts/slash-commands.js', import.meta.url), 'utf8');
    const extensionSlashSource = fs.readFileSync(new URL('../public/scripts/extensions-slashcommands.js', import.meta.url), 'utf8');
    assert.match(scriptSource, /if \(consumeComposer && type === 'normal'/);
    assert.match(scriptSource, /const saved = await messageEditDone\(mes_edited\);\s*if \(!saved\) {\s*return;/);
    assert.doesNotMatch(scriptSource, /reasoningEditDone\.trigger\('click'\)/);
    assert.match(groupSource, /consumeComposer: params\?\.consumeComposer === true && memberIndex === 0 && !by_auto_mode/);
    assert.match(groupSource, /Generate\('continue', { [^\n]*consumeComposer: false }\)/);
    assert.doesNotMatch(slashSource, /send_textarea.*\.val\(''\)/);
    assert.doesNotMatch(extensionSlashSource, /send_textarea.*\.val\(''\)/);
});

test('server-prepared Continue preserves the existing message as its merge base', () => {
    const scriptSource = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');

    assert.match(
        scriptSource,
        /const serverPreparedContinueBase = serverPreparationSource && isContinue\s*\?\s*String\(chat\.at\(-1\)\?\.mes \|\| ''\)\s*:\s*'';/,
    );
    assert.match(scriptSource, /let continue_mag = serverPreparedContinueBase;/);
    assert.match(scriptSource, /let cyclePrompt = serverPreparedContinueBase;/);
    assert.match(scriptSource, /this\.continueMessage \+ text/);
    assert.match(scriptSource, /getMessage = continue_mag \+ getMessage/);
});
