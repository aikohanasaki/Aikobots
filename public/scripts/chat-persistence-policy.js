/**
 * Returns whether an ordinary temporary character chat has no user-authored activity and must remain client-only.
 * @param {object} options Persistence context.
 * @param {boolean} options.isTemporary Whether the current character chat is temporary.
 * @param {boolean} options.hasLocalPristineGreeting Whether its greeting exists only in the client.
 * @param {object[]} options.messages Current logical chat messages.
 * @returns {boolean}
 */
export function shouldSkipUnstartedCharacterChatSave({ isTemporary, hasLocalPristineGreeting, messages }) {
    const hasTemporaryOpening = isTemporary || hasLocalPristineGreeting;
    const hasUserMessage = Array.isArray(messages) && messages.some(message => message?.is_user === true);
    return hasTemporaryOpening && !hasUserMessage;
}
