import storage from 'node-persist';

const USER_FLOW_STATE_PREFIX = 'user-flow-state:';
const DEFAULT_USER_FLOW_STATE_TTL_MS = 5 * 60 * 1000;

function getUserFlowStateKey(scope, handle) {
    return `${USER_FLOW_STATE_PREFIX}${String(scope || '').trim()}:${String(handle || '').trim()}`;
}

/**
 * Stores expiring state for a multi-request user flow in shared storage.
 * This avoids worker-local memory causing false negatives in production.
 * @param {string} scope Flow identifier
 * @param {string} handle User handle
 * @param {unknown} value Stored value
 * @param {number} [ttlMs]
 */
export async function setUserFlowState(scope, handle, value, ttlMs = DEFAULT_USER_FLOW_STATE_TTL_MS) {
    await storage.setItem(getUserFlowStateKey(scope, handle), {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

/**
 * Reads expiring user flow state from shared storage.
 * @param {string} scope Flow identifier
 * @param {string} handle User handle
 * @returns {Promise<unknown>}
 */
export async function getUserFlowState(scope, handle) {
    const key = getUserFlowStateKey(scope, handle);
    const entry = await storage.getItem(key);

    if (!entry || typeof entry !== 'object') {
        return null;
    }

    if (typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()) {
        await storage.removeItem(key);
        return null;
    }

    return entry.value ?? null;
}

/**
 * Clears user flow state from shared storage.
 * @param {string} scope Flow identifier
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
export async function clearUserFlowState(scope, handle) {
    await storage.removeItem(getUserFlowStateKey(scope, handle));
}
