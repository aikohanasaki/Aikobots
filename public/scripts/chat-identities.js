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

/**
 * Validates that a pending swipe generation still owns either the next unmaterialized
 * slot or the materialized slot carrying its preallocated UUID.
 * @param {object} message Chat message containing the swipe arrays.
 * @param {object} swipeTarget Captured swipe generation target.
 * @returns {{ok: boolean, reason: string, swipeId: number|null, materialized: boolean}}
 */
export function validateSwipeGenerationTarget(message, swipeTarget) {
    const swipeId = Number(swipeTarget?.swipeId);
    const previousSwipeId = Number(swipeTarget?.previousSwipeId);
    const swipeUuid = swipeTarget?.swipeUuid;
    if (!isObject(message)) {
        return { ok: false, reason: 'invalid target message', swipeId: null, materialized: false };
    }
    if (!Number.isInteger(swipeId) || swipeId < 0) {
        return { ok: false, reason: 'invalid swipe id', swipeId: null, materialized: false };
    }
    if (!isValidAikobotsUuid(swipeUuid)) {
        return { ok: false, reason: 'invalid swipe UUID', swipeId, materialized: false };
    }
    if (!Array.isArray(message.swipes) || !Array.isArray(message.swipe_info)) {
        return { ok: false, reason: 'target message has invalid swipe arrays', swipeId, materialized: false };
    }
    if (message.swipes.length !== message.swipe_info.length) {
        return { ok: false, reason: 'target swipe arrays are misaligned', swipeId, materialized: false };
    }
    if (swipeId > message.swipes.length) {
        return { ok: false, reason: 'swipe id is not the next slot', swipeId, materialized: false };
    }

    const matchingUuidIndexes = message.swipe_info.reduce((indexes, info, index) => {
        if (info?.[AIKOBOTS_SWIPE_UUID_KEY] === swipeUuid) {
            indexes.push(index);
        }
        return indexes;
    }, []);
    const materialized = swipeId < message.swipes.length;
    if (!materialized) {
        if (!Number.isInteger(previousSwipeId) || previousSwipeId < 0 || previousSwipeId >= message.swipes.length) {
            return { ok: false, reason: 'invalid previous swipe id', swipeId, materialized: false };
        }
        if (Number(message.swipe_id) !== previousSwipeId) {
            return { ok: false, reason: 'selected swipe changed before materialization', swipeId, materialized: false };
        }
        if (matchingUuidIndexes.length > 0) {
            return { ok: false, reason: 'swipe UUID already belongs to another slot', swipeId, materialized: false };
        }
        return { ok: true, reason: '', swipeId, materialized: false };
    }

    if (message.swipe_info[swipeId]?.[AIKOBOTS_SWIPE_UUID_KEY] !== swipeUuid) {
        return { ok: false, reason: 'materialized swipe UUID changed', swipeId, materialized: true };
    }
    if (matchingUuidIndexes.length !== 1 || matchingUuidIndexes[0] !== swipeId) {
        return { ok: false, reason: 'swipe UUID ownership is ambiguous', swipeId, materialized: true };
    }
    if (Number(message.swipe_id) !== swipeId) {
        return { ok: false, reason: 'selected swipe changed after materialization', swipeId, materialized: true };
    }

    return { ok: true, reason: '', swipeId, materialized: true };
}

/**
 * Materializes a validated pending swipe slot with its preallocated UUID.
 * Existing materialized targets are accepted only when the same UUID still owns the slot.
 * @param {object} message Chat message containing the swipe arrays.
 * @param {object} swipeTarget Captured swipe generation target.
 * @returns {{ok: boolean, reason: string, swipeId: number|null, materialized: boolean}}
 */
export function materializeSwipeGenerationTarget(message, swipeTarget) {
    const validation = validateSwipeGenerationTarget(message, swipeTarget);
    if (!validation.ok) {
        return validation;
    }

    if (!validation.materialized) {
        message.swipes.push('');
        message.swipe_info.push({
            [AIKOBOTS_SWIPE_UUID_KEY]: swipeTarget.swipeUuid,
        });
    }
    message.swipe_id = validation.swipeId;

    return { ...validation, materialized: true };
}

function areMetadataValuesEqual(left, right) {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => areMetadataValuesEqual(value, right[index]));
    }
    if (!isObject(left) || !isObject(right)) {
        return false;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && areMetadataValuesEqual(left[key], right[key]));
}

const COMPARISON_BUCKETS = Object.freeze({
    fatal: 'fatalMismatches',
    harmless: 'harmlessDifferences',
    informational: 'informationalDifferences',
    repairable: 'repairableDifferences',
    ambiguous: 'ambiguousConflicts',
});
const DATE_FIELDS = Object.freeze(['send_date', 'gen_started', 'gen_finished']);
const HARMLESS_EXTRA_KEYS = new Set(['branches', 'timedWorldInfo', 'worldInfoSummary', 'worldInfoReport']);
const MONTH_NAMES = Object.freeze([
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
]);

function createComparisonResult() {
    return {
        ok: true,
        fatalMismatches: [],
        harmlessDifferences: [],
        informationalDifferences: [],
        repairableDifferences: [],
        ambiguousConflicts: [],
    };
}

function addComparisonRecord(result, classification, code, path, location) {
    result[COMPARISON_BUCKETS[classification]].push({
        code,
        path,
        classification,
        messageRelativeIndex: location.messageRelativeIndex ?? null,
        logicalChatIndex: location.logicalChatIndex ?? null,
        selectedSwipeIndex: location.selectedSwipeIndex ?? null,
    });
}

function normalizeActiveSwipeText(value) {
    return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value;
}

function getValidUtcTimestamp(year, month, day, hour, minute, second, millisecond = 0) {
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const date = new Date(timestamp);
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
        && date.getUTCHours() === hour
        && date.getUTCMinutes() === minute
        && date.getUTCSeconds() === second
        && date.getUTCMilliseconds() === millisecond
        ? timestamp
        : null;
}

/**
 * Parses only documented chat timestamp representations without permissive date parsing.
 * Month-name message timestamps have no timezone, so they are comparable only to the same local representation.
 * @param {unknown} value Persisted timestamp representation.
 * @returns {{kind: string, value: number|string}|null} Comparable timestamp or null when unrecognized.
 */
function parseComparableDate(value) {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            return null;
        }
        return { kind: 'instant', value: numeric < 100_000_000_000 ? numeric * 1000 : numeric };
    }

    if (typeof value !== 'string') {
        return null;
    }

    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:\d{2})$/);
    if (isoMatch) {
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? { kind: 'instant', value: timestamp } : null;
    }

    const humanizedMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) ?@(\d{1,2})h ?(\d{1,2})m ?(\d{1,2})s(?: ?(\d{1,3})ms)?$/);
    if (humanizedMatch) {
        const [, year, month, day, hour, minute, second, millisecond = '0'] = humanizedMatch;
        const timestamp = getValidUtcTimestamp(
            Number(year), Number(month), Number(day), Number(hour),
            Number(minute), Number(second), Number(millisecond.padEnd(3, '0')),
        );
        return timestamp === null ? null : { kind: 'instant', value: timestamp };
    }

    const meridiemMatch = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(am|pm)$/i);
    if (meridiemMatch) {
        const [, monthName, day, year, hour, minute, meridiem] = meridiemMatch;
        const month = MONTH_NAMES.indexOf(monthName.toLowerCase()) + 1;
        const hourNumber = Number(hour);
        const minuteNumber = Number(minute);
        if (!month || Number(day) < 1 || Number(day) > 31 || hourNumber < 1 || hourNumber > 12 || minuteNumber > 59) {
            return null;
        }
        const hour24 = (hourNumber % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
        if (getValidUtcTimestamp(Number(year), month, Number(day), hour24, minuteNumber, 0) === null) {
            return null;
        }
        return { kind: 'local', value: `${year}-${month}-${Number(day)}-${hour24}-${minuteNumber}` };
    }

    return null;
}

function compareDateField(result, message, selectedSwipeInfo, key, location) {
    const topHasValue = message[key] !== undefined && message[key] !== null;
    const swipeHasValue = selectedSwipeInfo[key] !== undefined && selectedSwipeInfo[key] !== null;
    const path = key;
    if (!topHasValue && !swipeHasValue) {
        return;
    }
    if (!topHasValue || !swipeHasValue) {
        addComparisonRecord(result, 'harmless', `active_swipe_${key}_missing`, path, location);
        return;
    }
    if (Object.is(message[key], selectedSwipeInfo[key])) {
        return;
    }

    const topDate = parseComparableDate(message[key]);
    const swipeDate = parseComparableDate(selectedSwipeInfo[key]);
    if (!topDate || !swipeDate) {
        addComparisonRecord(result, 'ambiguous', `active_swipe_${key}_unrecognized`, path, location);
    } else if (topDate.kind === swipeDate.kind && topDate.value === swipeDate.value) {
        addComparisonRecord(result, 'repairable', `active_swipe_${key}_equivalent`, path, location);
    } else {
        addComparisonRecord(result, 'ambiguous', `active_swipe_${key}_conflict`, path, location);
    }
}

function isBookmarkExtraKey(key) {
    return key === 'bookmark' || key === 'bookmark_link' || key.startsWith('bookmark_');
}

function compareExtraObjects(result, topExtra, swipeExtra, location, path = 'extra') {
    if (!isObject(topExtra) || !isObject(swipeExtra)) {
        if (!areMetadataValuesEqual(topExtra, swipeExtra)) {
            addComparisonRecord(result, 'ambiguous', 'active_swipe_extra_container_conflict', path, location);
        }
        return;
    }

    const keys = new Set([...Object.keys(topExtra), ...Object.keys(swipeExtra)]);
    for (const key of keys) {
        const topHasKey = Object.prototype.hasOwnProperty.call(topExtra, key);
        const swipeHasKey = Object.prototype.hasOwnProperty.call(swipeExtra, key);
        const fieldPath = `${path}.${key}`;

        if (!topHasKey || !swipeHasKey) {
            const presentValue = topHasKey ? topExtra[key] : swipeExtra[key];
            if (key === 'bias' && presentValue === null) {
                addComparisonRecord(result, 'repairable', 'active_swipe_bias_missing_null', fieldPath, location);
            } else if (HARMLESS_EXTRA_KEYS.has(key) || isBookmarkExtraKey(key)) {
                addComparisonRecord(result, 'harmless', 'active_swipe_preserved_metadata_one_sided', fieldPath, location);
            } else {
                addComparisonRecord(result, 'informational', 'active_swipe_imported_metadata_one_sided', fieldPath, location);
            }
            continue;
        }

        const topValue = topExtra[key];
        const swipeValue = swipeExtra[key];
        if (areMetadataValuesEqual(topValue, swipeValue)) {
            continue;
        }
        if (isObject(topValue) && isObject(swipeValue)) {
            compareExtraObjects(result, topValue, swipeValue, location, fieldPath);
            continue;
        }
        addComparisonRecord(result, 'ambiguous', 'active_swipe_metadata_conflict', fieldPath, location);
    }
}

/**
 * Compares only the semantic state needed to identify and persist a message's active swipe.
 * The comparison is diagnostic-only and never mutates or reconciles either metadata container.
 * @param {object} message Chat message to compare.
 * @param {object} [options] Comparison and diagnostic-location options.
 * @returns {{ok: boolean, fatalMismatches: object[], harmlessDifferences: object[], informationalDifferences: object[], repairableDifferences: object[], ambiguousConflicts: object[]}}
 */
export function compareActiveSwipeState(message, {
    allowMesMismatch = false,
    allowMetadataMismatch = false,
    messageRelativeIndex = null,
    logicalChatIndex = null,
} = {}) {
    const result = createComparisonResult();
    const location = { messageRelativeIndex, logicalChatIndex, selectedSwipeIndex: null };
    const add = (classification, code, path) => addComparisonRecord(result, classification, code, path, location);

    if (!isObject(message)) {
        add('fatal', 'invalid_message', 'message');
        result.ok = false;
        return result;
    }

    const hasSwipesField = Object.prototype.hasOwnProperty.call(message, 'swipes');
    const hasSwipeInfoField = Object.prototype.hasOwnProperty.call(message, 'swipe_info');
    const hasSwipeId = Object.prototype.hasOwnProperty.call(message, 'swipe_id');
    if (!hasSwipesField && !hasSwipeInfoField && !hasSwipeId) {
        return result;
    }
    if (!hasSwipesField) {
        add('fatal', 'invalid_swipe_arrays', 'swipes');
        result.ok = false;
        return result;
    }
    if (!Array.isArray(message.swipes)) {
        add('fatal', 'invalid_swipe_arrays', 'swipes');
        result.ok = false;
        return result;
    }
    if (hasSwipeInfoField && !Array.isArray(message.swipe_info)) {
        add('fatal', 'invalid_swipe_arrays', 'swipe_info');
        result.ok = false;
        return result;
    }

    const swipeId = Number(message.swipe_id);
    location.selectedSwipeIndex = Number.isInteger(swipeId) ? swipeId : null;
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId >= message.swipes.length) {
        add('fatal', 'swipe_id_out_of_bounds', 'swipe_id');
        result.ok = false;
        return result;
    }

    const selectedSwipeText = message.swipes[swipeId];
    if (typeof message.mes !== 'string'
        || typeof selectedSwipeText !== 'string'
        || (!allowMesMismatch && !Object.is(normalizeActiveSwipeText(message.mes), normalizeActiveSwipeText(selectedSwipeText)))) {
        add('fatal', 'active_swipe_text_mismatch', `swipes[${swipeId}]`);
    }

    const swipeInfo = Array.isArray(message.swipe_info) ? message.swipe_info : null;
    if (!swipeInfo) {
        add('repairable', 'swipe_info_missing', 'swipe_info');
    } else {
        if (swipeInfo.length < message.swipes.length) {
            add('repairable', 'swipe_info_shorter_than_swipes', 'swipe_info');
        } else if (swipeInfo.length > message.swipes.length) {
            add('ambiguous', 'swipe_info_longer_than_swipes', 'swipe_info');
        }

        const seenSwipeUuids = new Set();
        for (let index = 0; index < Math.min(swipeInfo.length, message.swipes.length); index++) {
            const swipeUuid = swipeInfo[index]?.[AIKOBOTS_SWIPE_UUID_KEY];
            if (!isValidAikobotsUuid(swipeUuid)) {
                if (index < message.swipes.length) {
                    addComparisonRecord(result, 'repairable', swipeUuid == null ? 'missing_swipe_uuid' : 'malformed_swipe_uuid', `swipe_info[${index}].${AIKOBOTS_SWIPE_UUID_KEY}`, {
                        ...location,
                        selectedSwipeIndex: swipeId,
                    });
                }
                continue;
            }
            if (seenSwipeUuids.has(swipeUuid)) {
                add('fatal', 'duplicate_swipe_uuid', `swipe_info[${index}].${AIKOBOTS_SWIPE_UUID_KEY}`);
            }
            seenSwipeUuids.add(swipeUuid);
        }
    }

    const selectedSwipeInfo = swipeInfo?.[swipeId];
    if (selectedSwipeInfo === undefined || selectedSwipeInfo === null) {
        add('repairable', 'selected_swipe_info_missing', `swipe_info[${swipeId}]`);
    } else if (!isObject(selectedSwipeInfo)) {
        add('fatal', 'invalid_selected_swipe_info', `swipe_info[${swipeId}]`);
    } else {
        const selectedSwipeUuid = selectedSwipeInfo[AIKOBOTS_SWIPE_UUID_KEY];
        const topLevelSwipeUuid = message[AIKOBOTS_SWIPE_UUID_KEY];
        if (topLevelSwipeUuid !== undefined && !isValidAikobotsUuid(topLevelSwipeUuid)) {
            add('repairable', topLevelSwipeUuid == null ? 'missing_active_swipe_uuid' : 'malformed_active_swipe_uuid', AIKOBOTS_SWIPE_UUID_KEY);
        }
        if (isValidAikobotsUuid(selectedSwipeUuid)
            && isValidAikobotsUuid(topLevelSwipeUuid)
            && selectedSwipeUuid !== topLevelSwipeUuid) {
            add('fatal', 'active_swipe_uuid_conflict', AIKOBOTS_SWIPE_UUID_KEY);
        }

        if (!allowMetadataMismatch) {
            for (const key of DATE_FIELDS) {
                compareDateField(result, message, selectedSwipeInfo, key, location);
            }
            compareExtraObjects(
                result,
                message.extra === undefined ? {} : message.extra,
                selectedSwipeInfo.extra === undefined ? {} : selectedSwipeInfo.extra,
                location,
            );
        }
    }

    result.ok = result.fatalMismatches.length === 0;
    return result;
}

/**
 * Validates the active swipe fields that must be persisted as one consistent message.
 * Legacy `bias: null` and an absent bias are treated as equivalent metadata.
 * @param {object} message Chat message to validate.
 * @param {object} [options] Validation options.
 * @param {boolean} [options.allowMesMismatch=false] Allows the greeting's rendered macro text to differ from its stored swipe.
 * @param {boolean} [options.allowMetadataMismatch=false] Allows legacy greeting metadata to differ from its selected swipe.
 * @param {number|null} [options.messageRelativeIndex=null] Submitted-range index for diagnostics.
 * @param {number|null} [options.logicalChatIndex=null] Logical chat index for diagnostics.
 * @returns {{ok: boolean, reason: string, swipeId: number|null, selectedSwipeUuid: string|null, comparison: object}}
 */
export function validateMessageSwipeState(message, {
    allowMesMismatch = false,
    allowMetadataMismatch = false,
    messageRelativeIndex = null,
    logicalChatIndex = null,
} = {}) {
    const comparison = compareActiveSwipeState(message, {
        allowMesMismatch,
        allowMetadataMismatch,
        messageRelativeIndex,
        logicalChatIndex,
    });
    const swipeId = Number(message?.swipe_id);
    const normalizedSwipeId = Number.isInteger(swipeId) ? swipeId : null;
    return {
        ok: comparison.ok,
        reason: comparison.fatalMismatches[0]?.code ?? '',
        swipeId: normalizedSwipeId,
        selectedSwipeUuid: Array.isArray(message?.swipe_info) && normalizedSwipeId !== null
            ? message.swipe_info[normalizedSwipeId]?.[AIKOBOTS_SWIPE_UUID_KEY] ?? null
            : null,
        comparison,
        fatalMismatches: comparison.fatalMismatches,
        harmlessDifferences: comparison.harmlessDifferences,
        informationalDifferences: comparison.informationalDifferences,
        repairableDifferences: comparison.repairableDifferences,
        ambiguousConflicts: comparison.ambiguousConflicts,
    };
}

/**
 * Repairs only the one-past-the-end swipe index left by an interrupted overswipe generation.
 * The message is changed only when selecting the final materialized swipe makes the complete
 * active-swipe state valid; unrelated malformed swipe states remain untouched for diagnosis.
 * @param {object} message Chat message to inspect and optionally repair.
 * @param {object} [options] Repair context.
 * @param {number|null} [options.logicalChatIndex=null] Logical message index for greeting allowances and diagnostics.
 * @returns {{repaired: boolean, swipeId: number|null, reason: string}}
 */
export function repairPendingOverswipeState(message, { logicalChatIndex = null } = {}) {
    const swipeId = Number(message?.swipe_id);
    const swipes = message?.swipes;
    if (!Number.isInteger(swipeId) || !Array.isArray(swipes) || swipes.length === 0 || swipeId !== swipes.length) {
        return { repaired: false, swipeId: Number.isInteger(swipeId) ? swipeId : null, reason: '' };
    }

    const repairedSwipeId = swipes.length - 1;
    const candidate = { ...message, swipe_id: repairedSwipeId };
    const validation = validateMessageSwipeState(candidate, {
        allowMesMismatch: logicalChatIndex === 0,
        allowMetadataMismatch: logicalChatIndex === 0,
        logicalChatIndex,
    });
    if (!validation.ok) {
        return { repaired: false, swipeId, reason: validation.reason };
    }

    message.swipe_id = repairedSwipeId;
    return { repaired: true, swipeId: repairedSwipeId, reason: '' };
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
