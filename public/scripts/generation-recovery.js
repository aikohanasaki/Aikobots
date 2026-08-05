const STORAGE_KEY = 'aikobots.pending-generation.v1';
const MAX_PENDING_AGE_MS = 24 * 60 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERABLE_TYPES = new Set(['normal', 'regenerate', 'continue', 'swipe']);

function getDefaultStorage() {
    try {
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
}

function normalizePendingGeneration(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const generationId = String(value.generationId || '');
    const type = String(value.type || 'normal');
    const chatIdentity = value.chatIdentity;
    const createdAt = Number(value.createdAt);
    const anchorMessageUuid = String(value.anchorMessageUuid || '');
    if (!UUID_PATTERN.test(generationId)
        || !chatIdentity || typeof chatIdentity !== 'object' || Array.isArray(chatIdentity)
        || !String(chatIdentity.chatId || '')
        || !UUID_PATTERN.test(anchorMessageUuid)
        || !RECOVERABLE_TYPES.has(type)
        || !Number.isFinite(createdAt) || createdAt <= 0 || now - createdAt > MAX_PENDING_AGE_MS) {
        return null;
    }

    const swipeTarget = value.swipeTarget && typeof value.swipeTarget === 'object'
        ? {
            messageId: Number(value.swipeTarget.messageId),
            swipeId: Number(value.swipeTarget.swipeId),
            swipeUuid: String(value.swipeTarget.swipeUuid || ''),
            previousSwipeId: Number(value.swipeTarget.previousSwipeId),
        }
        : null;
    if (swipeTarget && (!Number.isInteger(swipeTarget.messageId) || swipeTarget.messageId < 0
        || !Number.isInteger(swipeTarget.swipeId) || swipeTarget.swipeId < 0
        || !UUID_PATTERN.test(swipeTarget.swipeUuid)
        || !Number.isInteger(swipeTarget.previousSwipeId) || swipeTarget.previousSwipeId < 0)) {
        return null;
    }
    if ((type === 'swipe') !== Boolean(swipeTarget)) {
        return null;
    }

    return {
        generationId,
        type,
        chatIdentity: {
            groupId: String(chatIdentity.groupId || ''),
            characterId: String(chatIdentity.characterId || ''),
            chatId: String(chatIdentity.chatId),
        },
        anchorMessageUuid,
        createdAt,
        startedAt: Number.isFinite(Number(value.startedAt)) ? Number(value.startedAt) : createdAt,
        canMultiSwipe: Boolean(value.canMultiSwipe),
        serverRequestId: typeof value.serverRequestId === 'string' ? value.serverRequestId : '',
        forceChid: value.forceChid !== null && value.forceChid !== undefined && Number.isInteger(Number(value.forceChid))
            ? Number(value.forceChid)
            : null,
        swipeTarget,
    };
}

/** Stores the single page-reload-resumable generation owned by this browser tab. */
export function savePendingGeneration(value, storage = getDefaultStorage()) {
    if (!storage) {
        return null;
    }

    const normalized = normalizePendingGeneration(value);
    if (!normalized) {
        return null;
    }

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    } catch {
        return null;
    }
}

/** Returns a valid pending generation, discarding malformed or expired state. */
export function getPendingGeneration(storage = getDefaultStorage(), now = Date.now()) {
    if (!storage) {
        return null;
    }

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const normalized = normalizePendingGeneration(JSON.parse(raw), now);
        if (!normalized) {
            storage.removeItem(STORAGE_KEY);
        }
        return normalized;
    } catch {
        try {
            storage.removeItem(STORAGE_KEY);
        } catch {
            // Storage is unavailable; there is nothing recoverable to return.
        }
        return null;
    }
}

/** Clears the pending generation when it still belongs to the supplied job ID. */
export function clearPendingGeneration(generationId = null, storage = getDefaultStorage()) {
    if (!storage) {
        return;
    }

    try {
        if (generationId) {
            const current = getPendingGeneration(storage);
            if (current?.generationId !== generationId) {
                return;
            }
        }
        storage.removeItem(STORAGE_KEY);
    } catch {
        // Storage is best-effort; generation cancellation and chat writes remain authoritative.
    }
}
