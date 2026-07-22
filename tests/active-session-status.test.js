import { describe, expect, it } from '@jest/globals';

import { ACTIVE_SESSION_STATUS_ACTION, getActiveSessionStatusAction } from '../public/scripts/active-session-status.js';

describe('active session status recovery', () => {
    it.each([
        [null, ACTIVE_SESSION_STATUS_ACTION.RETRY],
        [{ active: true, hasActiveSession: true }, ACTIVE_SESSION_STATUS_ACTION.ACTIVE],
        [{ active: false, hasActiveSession: false }, ACTIVE_SESSION_STATUS_ACTION.CLAIM],
        [{ active: false, hasActiveSession: true }, ACTIVE_SESSION_STATUS_ACTION.LOCK],
    ])('classifies %j as %s', (status, expectedAction) => {
        expect(getActiveSessionStatusAction(status)).toBe(expectedAction);
    });
});
