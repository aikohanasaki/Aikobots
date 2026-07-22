export const ACTIVE_SESSION_STATUS_ACTION = Object.freeze({
    ACTIVE: 'active',
    CLAIM: 'claim',
    LOCK: 'lock',
    RETRY: 'retry',
});

/**
 * Classifies the latest active-session status without treating transient failures as competing sessions.
 * @param {{ active?: boolean, hasActiveSession?: boolean } | null | undefined} status Active-session status
 * @returns {string} Required client action
 */
export function getActiveSessionStatusAction(status) {
    if (!status) {
        return ACTIVE_SESSION_STATUS_ACTION.RETRY;
    }

    if (status.active) {
        return ACTIVE_SESSION_STATUS_ACTION.ACTIVE;
    }

    if (!status.hasActiveSession) {
        return ACTIVE_SESSION_STATUS_ACTION.CLAIM;
    }

    return ACTIVE_SESSION_STATUS_ACTION.LOCK;
}
