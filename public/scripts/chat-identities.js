export const AIKOBOTS_MESSAGE_UUID_KEY = 'aikobots_message_uuid';
export const AIKOBOTS_SWIPE_UUID_KEY = 'aikobots_swipe_uuid';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAikobotsUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function createAikobotsUuid(generateUuid = null) {
    const candidate = typeof generateUuid === 'function'
        ? generateUuid()
        : globalThis.crypto?.randomUUID?.();

    if (isValidAikobotsUuid(candidate)) {
        return candidate;
    }

    if (globalThis.crypto?.getRandomValues) {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    throw new Error('Unable to generate a UUID for chat identity metadata.');
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureUniqueUuid(currentUuid, seenUuids, { generateUuid, repairDuplicates, regenerate }) {
    const isMissing = !isValidAikobotsUuid(currentUuid);
    const isDuplicate = Boolean(seenUuids?.has(currentUuid));

    if (regenerate || isMissing || (repairDuplicates && isDuplicate)) {
        let nextUuid = createAikobotsUuid(generateUuid);
        while (seenUuids?.has(nextUuid)) {
            nextUuid = createAikobotsUuid(generateUuid);
        }
        seenUuids?.add(nextUuid);
        return { uuid: nextUuid, changed: true, missing: isMissing, duplicate: isDuplicate };
    }

    if (!isMissing) {
        seenUuids?.add(currentUuid);
    }

    return { uuid: currentUuid, changed: false, missing: isMissing, duplicate: isDuplicate };
}

export function ensureMessageIdentity(message, {
    generateUuid = null,
    seenMessageUuids = null,
    repairDuplicates = true,
    regenerate = false,
} = {}) {
    if (!isObject(message)) {
        return { changed: false, missing: false, duplicate: false };
    }

    const result = ensureUniqueUuid(message[AIKOBOTS_MESSAGE_UUID_KEY], seenMessageUuids, {
        generateUuid,
        repairDuplicates,
        regenerate,
    });

    if (result.changed) {
        message[AIKOBOTS_MESSAGE_UUID_KEY] = result.uuid;
    }

    return result;
}

export function ensureSwipeIdentities(message, {
    generateUuid = null,
    seenSwipeUuids = null,
    repairDuplicates = true,
    regenerate = false,
} = {}) {
    if (!isObject(message) || !Array.isArray(message.swipes)) {
        return { changed: false, missing: [], duplicate: [] };
    }

    let changed = false;
    const missing = [];
    const duplicate = [];

    if (!Array.isArray(message.swipe_info)) {
        message.swipe_info = [];
        changed = true;
    }

    for (let index = 0; index < message.swipes.length; index++) {
        if (!isObject(message.swipe_info[index])) {
            message.swipe_info[index] = {};
            changed = true;
        }

        const result = ensureUniqueUuid(message.swipe_info[index][AIKOBOTS_SWIPE_UUID_KEY], seenSwipeUuids, {
            generateUuid,
            repairDuplicates,
            regenerate,
        });

        if (result.changed) {
            message.swipe_info[index][AIKOBOTS_SWIPE_UUID_KEY] = result.uuid;
            changed = true;
        }
        if (result.missing) {
            missing.push(index);
        }
        if (result.duplicate) {
            duplicate.push(index);
        }
    }

    return { changed, missing, duplicate };
}

export function normalizeChatIdentities(messages, {
    generateUuid = null,
    repairDuplicates = true,
    regenerateAll = false,
} = {}) {
    const result = {
        changed: false,
        missingMessageIndexes: [],
        duplicateMessageIndexes: [],
        missingSwipeRefs: [],
        duplicateSwipeRefs: [],
    };

    if (!Array.isArray(messages)) {
        return result;
    }

    const seenMessageUuids = new Set();
    const seenSwipeUuids = new Set();

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
        if (!Object.prototype.hasOwnProperty.call(messages, messageIndex) || !isObject(messages[messageIndex])) {
            continue;
        }

        const messageResult = ensureMessageIdentity(messages[messageIndex], {
            generateUuid,
            seenMessageUuids,
            repairDuplicates,
            regenerate: regenerateAll,
        });

        if (messageResult.changed) {
            result.changed = true;
        }
        if (messageResult.missing) {
            result.missingMessageIndexes.push(messageIndex);
        }
        if (messageResult.duplicate) {
            result.duplicateMessageIndexes.push(messageIndex);
        }

        const swipeResult = ensureSwipeIdentities(messages[messageIndex], {
            generateUuid,
            seenSwipeUuids,
            repairDuplicates,
            regenerate: regenerateAll,
        });

        if (swipeResult.changed) {
            result.changed = true;
        }
        for (const swipeIndex of swipeResult.missing) {
            result.missingSwipeRefs.push({ messageIndex, swipeIndex });
        }
        for (const swipeIndex of swipeResult.duplicate) {
            result.duplicateSwipeRefs.push({ messageIndex, swipeIndex });
        }
    }

    return result;
}

export function validateChatIdentities(messages) {
    const result = {
        ok: true,
        missingMessageIndexes: [],
        duplicateMessageIndexes: [],
        missingSwipeRefs: [],
        duplicateSwipeRefs: [],
    };

    if (!Array.isArray(messages)) {
        result.ok = false;
        return result;
    }

    const seenMessageUuids = new Set();
    const seenSwipeUuids = new Set();

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
        const message = messages[messageIndex];
        if (!isObject(message)) {
            continue;
        }

        const messageUuid = message[AIKOBOTS_MESSAGE_UUID_KEY];
        if (!isValidAikobotsUuid(messageUuid)) {
            result.missingMessageIndexes.push(messageIndex);
        } else if (seenMessageUuids.has(messageUuid)) {
            result.duplicateMessageIndexes.push(messageIndex);
        } else {
            seenMessageUuids.add(messageUuid);
        }

        if (!Array.isArray(message.swipes)) {
            continue;
        }

        for (let swipeIndex = 0; swipeIndex < message.swipes.length; swipeIndex++) {
            const swipeUuid = message.swipe_info?.[swipeIndex]?.[AIKOBOTS_SWIPE_UUID_KEY];
            if (!isValidAikobotsUuid(swipeUuid)) {
                result.missingSwipeRefs.push({ messageIndex, swipeIndex });
            } else if (seenSwipeUuids.has(swipeUuid)) {
                result.duplicateSwipeRefs.push({ messageIndex, swipeIndex });
            } else {
                seenSwipeUuids.add(swipeUuid);
            }
        }
    }

    result.ok = result.missingMessageIndexes.length === 0
        && result.duplicateMessageIndexes.length === 0
        && result.missingSwipeRefs.length === 0
        && result.duplicateSwipeRefs.length === 0;

    return result;
}

export function findMessageByAikobotsUuid(messages, uuid) {
    if (!isValidAikobotsUuid(uuid) || !Array.isArray(messages)) {
        return { ok: false, reason: 'missing_message_uuid', index: -1, message: null, matches: [] };
    }

    const matches = [];
    for (let index = 0; index < messages.length; index++) {
        if (messages[index]?.[AIKOBOTS_MESSAGE_UUID_KEY] === uuid) {
            matches.push(index);
        }
    }

    if (matches.length !== 1) {
        return {
            ok: false,
            reason: matches.length > 1 ? 'duplicate_message_uuid' : 'deleted_message',
            index: -1,
            message: null,
            matches,
        };
    }

    const index = matches[0];
    return { ok: true, reason: '', index, message: messages[index], matches };
}

export function findSwipeByAikobotsUuid(message, uuid) {
    if (!isValidAikobotsUuid(uuid) || !Array.isArray(message?.swipes) || !Array.isArray(message?.swipe_info)) {
        return { ok: false, reason: 'missing_swipe_uuid', index: -1, swipeInfo: null, matches: [] };
    }

    const matches = [];
    for (let index = 0; index < message.swipes.length; index++) {
        if (message.swipe_info[index]?.[AIKOBOTS_SWIPE_UUID_KEY] === uuid) {
            matches.push(index);
        }
    }

    if (matches.length !== 1) {
        return {
            ok: false,
            reason: matches.length > 1 ? 'duplicate_swipe_uuid' : 'deleted_swipe',
            index: -1,
            swipeInfo: null,
            matches,
        };
    }

    const index = matches[0];
    return { ok: true, reason: '', index, swipeInfo: message.swipe_info[index], matches };
}

export function cloneMessageWithNewIdentity(message, options = {}) {
    const clone = structuredClone(message);
    normalizeChatIdentities([clone], { ...options, regenerateAll: true });
    return clone;
}

export function regenerateChatIdentities(messages, options = {}) {
    return normalizeChatIdentities(messages, { ...options, regenerateAll: true });
}

export function stripAikobotsIdentityMetadata(recordsOrMessages) {
    if (!Array.isArray(recordsOrMessages)) {
        return recordsOrMessages;
    }

    return recordsOrMessages.map(record => {
        if (!isObject(record)) {
            return record;
        }

        const clone = structuredClone(record);
        delete clone[AIKOBOTS_MESSAGE_UUID_KEY];

        if (Array.isArray(clone.swipe_info)) {
            for (const swipeInfo of clone.swipe_info) {
                if (isObject(swipeInfo)) {
                    delete swipeInfo[AIKOBOTS_SWIPE_UUID_KEY];
                }
            }
        }

        return clone;
    });
}
