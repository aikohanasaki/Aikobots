/**
 * Returns whether a historical message is the effective prompt tail and can generate a swipe.
 * @param {object[]} messages Chat messages.
 * @param {number} messageId Target message ID.
 * @param {(message: object) => boolean} [isPromptHidden] Prompt-visibility predicate.
 * @returns {boolean}
 */
export function canGenerateHistoricalSwipe(messages, messageId, isPromptHidden = message => message?.is_system === true) {
    const message = messages?.[messageId];
    return Boolean(
        Array.isArray(messages) &&
        messageId >= 0 &&
        messageId < messages.length - 1 &&
        message &&
        !isPromptHidden(message) &&
        messages.slice(messageId + 1).every(isPromptHidden)
    );
}
