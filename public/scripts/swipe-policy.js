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
        messages.slice(messageId + 1).every(isPromptHidden),
    );
}

/**
 * Returns whether a message may display a swipe counter.
 * @param {object} message Chat message.
 * @param {(message: object) => boolean} [isSystemNotice] Actual system-notice predicate.
 * @returns {boolean}
 */
export function shouldDisplaySwipeCounter(message, isSystemNotice = () => false) {
    return Boolean(
        message &&
        !message.is_user &&
        !message.extra?.isSmallSys &&
        !(message.is_system && isSystemNotice(message)),
    );
}

/**
 * Returns whether restoring the send controls may also restore swipe controls.
 * @param {object} state Current UI state.
 * @param {boolean} state.swipesEnabled User swipe-button preference.
 * @param {boolean} state.hasActiveMessageEdit Whether a message edit still owns the UI.
 * @param {boolean} state.isDeleteMode Whether bulk message deletion is active.
 * @param {boolean} state.isGroupGenerating Whether a group generation still owns the UI.
 * @returns {boolean}
 */
export function shouldRestoreSwipeButtons({ swipesEnabled, hasActiveMessageEdit, isDeleteMode, isGroupGenerating }) {
    return Boolean(swipesEnabled && !hasActiveMessageEdit && !isDeleteMode && !isGroupGenerating);
}
