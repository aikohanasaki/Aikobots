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
