import { findMessageByAikobotsUuid, isSameChatIdentity } from './chat-identities.js';

/**
 * Returns whether an unpersisted character chat must remain client-only.
 * @param {object} options Persistence context.
 * @param {boolean} options.isTemporary Whether the current character chat is temporary.
 * @param {boolean} options.hasLocalPristineGreeting Whether its greeting exists only in the client.
 * @param {object[]} options.messages Current logical chat messages.
 * @param {boolean} options.isDirty Whether the chat has accepted user activity.
 * @param {boolean} options.persistPristine Whether an explicit workflow may persist a pristine greeting.
 * @returns {boolean}
 */
export function shouldSkipUnstartedCharacterChatSave({ isTemporary, hasLocalPristineGreeting, messages, isDirty = false, persistPristine = false }) {
    const hasTemporaryOpening = isTemporary || hasLocalPristineGreeting;
    if (!hasTemporaryOpening) {
        return false;
    }

    const logicalMessages = Array.isArray(messages) ? messages : [];
    if (logicalMessages.length === 0) {
        return true;
    }

    const hasUserMessage = logicalMessages.some(message => message?.is_user === true);
    return !hasUserMessage && !isDirty && !persistPristine;
}

/**
 * Returns whether a full chat save must wait for and adopt a revision acknowledgement.
 * @param {object} options Save context.
 * @param {boolean} options.shouldTrackRevision Whether the save targets the active full chat.
 * @param {boolean} options.isSqlite Whether the active chat is already known to use SQLite.
 * @param {boolean} options.isTemporaryCharacterSave Whether this is the first save of a temporary character chat.
 * @param {boolean} options.isPendingSoloCharacterSave Whether this is the first save of an unnamed solo character chat.
 * @returns {boolean}
 */
export function shouldQueueAcknowledgedChatSave({ shouldTrackRevision, isSqlite, isTemporaryCharacterSave, isPendingSoloCharacterSave }) {
    return Boolean(shouldTrackRevision && (isSqlite || isTemporaryCharacterSave || isPendingSoloCharacterSave));
}

/**
 * Restores a rejected send without overwriting text entered while its save was pending.
 * @param {string} rejectedText Text removed from the composer for the rejected send.
 * @param {string} currentText Current composer contents.
 * @returns {string}
 */
export function mergeRejectedSendDraft(rejectedText, currentText) {
    const rejectedDraft = String(rejectedText || '');
    const currentDraft = String(currentText || '');
    if (!rejectedDraft || currentDraft === rejectedDraft) {
        return currentDraft;
    }
    return currentDraft ? `${rejectedDraft}\n\n${currentDraft}` : rejectedDraft;
}

/**
 * Allows a saved composer send to commit after a benign active-identity change.
 * @param {object|null|undefined} sendAttempt Captured composer send attempt.
 * @param {object|null|undefined} currentChatIdentity Current active chat identity.
 * @param {object[]} messages Current active chat messages.
 * @returns {boolean} Whether the send still belongs to the active chat.
 */
export function canCommitComposerSendAttempt(sendAttempt, currentChatIdentity, messages) {
    if (!sendAttempt || !currentChatIdentity) {
        return false;
    }

    if (isSameChatIdentity(sendAttempt.chatIdentity, currentChatIdentity)) {
        return true;
    }

    const groupId = sendAttempt.chatIdentity?.groupId;
    const hasSameOwner = groupId
        ? groupId === currentChatIdentity.groupId
        : !currentChatIdentity.groupId && sendAttempt.chatIdentity?.characterId === currentChatIdentity.characterId;
    if (!hasSameOwner) {
        return false;
    }

    const postedMessage = findMessageByAikobotsUuid(messages, sendAttempt.messageUuid);
    return postedMessage.ok;
}
