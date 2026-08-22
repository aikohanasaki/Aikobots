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
