const STORAGE_KEY = 'aikobots.pending-generations.v2';
const LEGACY_STORAGE_KEY = 'aikobots.pending-generation.v1';
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERABLE_TYPES = new Set(['normal', 'regenerate', 'continue', 'swipe']);

function getDefaultStorage() {
    try {
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
}

/** Validates and strips a content-free recovery record received from local or server storage. */
export function normalizePendingGeneration(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const generationId = String(value.generationId || '');
    const type = String(value.type || 'normal');
    const chatIdentity = value.chatIdentity;
    const createdAt = Number(value.createdAt);
    const anchorMessageUuid = String(value.anchorMessageUuid || '');
    const outputMessageUuid = String(value.outputMessageUuid || '');
    if (!UUID_PATTERN.test(generationId)
        || !chatIdentity || typeof chatIdentity !== 'object' || Array.isArray(chatIdentity)
        || !String(chatIdentity.chatId || '')
        || !UUID_PATTERN.test(anchorMessageUuid)
        || !RECOVERABLE_TYPES.has(type)
        || (['normal', 'regenerate'].includes(type) && !UUID_PATTERN.test(outputMessageUuid))
        || (!['normal', 'regenerate'].includes(type) && outputMessageUuid)
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
            characterAvatar: String(chatIdentity.characterAvatar || ''),
            chatId: String(chatIdentity.chatId),
        },
        anchorMessageUuid,
        outputMessageUuid,
        createdAt,
        startedAt: Number.isFinite(Number(value.startedAt)) ? Number(value.startedAt) : createdAt,
        stream: value.stream !== false,
        canMultiSwipe: Boolean(value.canMultiSwipe),
        serverRequestId: typeof value.serverRequestId === 'string' ? value.serverRequestId : '',
        forceChid: value.forceChid !== null && value.forceChid !== undefined && Number.isInteger(Number(value.forceChid))
            ? Number(value.forceChid)
            : null,
        swipeTarget,
        ...(['queued', 'running', 'completed', 'failed', 'cancelled'].includes(value.state) ? { state: value.state } : {}),
    };
}

/** Matches a recovery route by stable character avatar, with index fallback for legacy records only. */
export function isSameGenerationRecoveryChatIdentity(recoveryIdentity, currentIdentity) {
    if (!recoveryIdentity || !currentIdentity
        || recoveryIdentity.groupId !== currentIdentity.groupId
        || recoveryIdentity.chatId !== currentIdentity.chatId) {
        return false;
    }
    if (recoveryIdentity.groupId) {
        return true;
    }
    return recoveryIdentity.characterAvatar
        ? recoveryIdentity.characterAvatar === currentIdentity.characterAvatar
        : recoveryIdentity.characterId === currentIdentity.characterId;
}

/** Finds older failed recoveries superseded by a successful chat mutation. */
export function getSupersededFailedGenerationIds(successfulRecovery, recoveries = []) {
    if (!successfulRecovery?.chatIdentity) {
        return [];
    }
    return recoveries
        .filter(recovery => recovery?.state === 'failed'
            && recovery.generationId !== successfulRecovery.generationId
            && Number(recovery.createdAt) <= Number(successfulRecovery.createdAt)
            && isSameGenerationRecoveryChatIdentity(recovery.chatIdentity, successfulRecovery.chatIdentity))
        .map(recovery => recovery.generationId);
}

/** Returns every valid pending generation, migrating the legacy single record once. */
export function listPendingGenerations(storage = getDefaultStorage(), now = Date.now()) {
    if (!storage) {
        return [];
    }

    try {
        let values = [];
        const raw = storage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            values = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
        } else {
            const legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
            if (legacyRaw) {
                values = [JSON.parse(legacyRaw)];
            }
        }
        const normalized = values.map(value => normalizePendingGeneration(value, now)).filter(Boolean);
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, jobs: normalized }));
        storage.removeItem(LEGACY_STORAGE_KEY);
        return normalized;
    } catch {
        try {
            storage.removeItem(STORAGE_KEY);
            storage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
            // Storage is unavailable; there is nothing recoverable to return.
        }
        return [];
    }
}

/** Stores or updates one content-free page-reload-resumable generation. */
export function savePendingGeneration(value, storage = getDefaultStorage()) {
    if (!storage) {
        return null;
    }

    const normalized = normalizePendingGeneration(value);
    if (!normalized) {
        return null;
    }

    try {
        const jobs = listPendingGenerations(storage).filter(job => job.generationId !== normalized.generationId);
        jobs.push(normalized);
        jobs.sort((left, right) => left.createdAt - right.createdAt || left.generationId.localeCompare(right.generationId));
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, jobs }));
        return normalized;
    } catch {
        return null;
    }
}

/** Persists an admitted detached job before exposing it to foreground navigation. */
export function recordGenerationAdmission(value, onGenerationReady, storage = getDefaultStorage()) {
    const normalized = savePendingGeneration(value, storage);
    if (normalized) {
        onGenerationReady?.(normalized.generationId);
    }
    return normalized;
}

/** Returns the oldest valid pending generation for compatibility with single-job callers. */
export function getPendingGeneration(storage = getDefaultStorage(), now = Date.now()) {
    return listPendingGenerations(storage, now)[0] || null;
}

/** Clears the pending generation when it still belongs to the supplied job ID. */
export function clearPendingGeneration(generationId = null, storage = getDefaultStorage()) {
    if (!storage) {
        return;
    }

    try {
        if (generationId) {
            const jobs = listPendingGenerations(storage).filter(job => job.generationId !== generationId);
            storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, jobs }));
        } else {
            storage.removeItem(STORAGE_KEY);
            storage.removeItem(LEGACY_STORAGE_KEY);
        }
    } catch {
        // Storage is best-effort; generation cancellation and chat writes remain authoritative.
    }
}
