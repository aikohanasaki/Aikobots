import express from 'express';
import { resolveSqliteLogicalChatReference } from './chats.js';
import { stableHashString } from '../../public/scripts/hashing.js';
import { applyStloCharacterFilters } from '../../public/scripts/stlo-utils.js';
import { withChatSaveLock } from '../chat-storage.js';

import {
    applyLorebookSettings,
    createManagedLorebookEntryData,
    getNextManagedMemorySequenceNumber,
    parseSequenceFromTitle,
    compileScene,
    STMB_MANAGED_FLAG,
} from '../../public/scripts/stmb-core.js';
import {
    createManagedSummaryEntryData,
    getNextSummaryNumber,
    migrateLorebookSummarySchema,
    getSummaryTierLabel,
    verifySummarySourceFingerprints,
} from '../../public/scripts/stmb-summary.js';
import {
    applyRegenerationReplacement,
    buildRegenerationIndexes,
    getRegenerationEligibility,
    getRegenerationEntryByUid,
    hashRegenerationEntry,
} from '../../public/scripts/stmb-regeneration.js';
import {
    assertLorebookCheckoutForManagement,
    getLorebookForManagement,
    LorebookRepositoryError,
    saveLorebookForManagement,
    withLorebookManagementTransaction,
} from '../lorebook-repository.js';
import { isReservedRecommendedTemplateSource } from '../recommended-chat-template-store.js';
import {
    deleteStmbContextSetting,
    duplicateStmbContextSetting,
    getStmbContextSetting,
    listOwnedStmbContextSourceEntries,
    listStmbContextSettings,
    migrateStmbContextSettingsLorebookReference,
    resolveStmbContextSettingEntries,
    STMB_CONTEXT_NONE_KEY,
    upsertStmbContextSetting,
} from '../stmb-context-settings.js';
import { isActiveSessionError, sendActiveSessionRequired } from '../active-session-store.js';
import {
    readStmbSidePrompts,
    saveStmbSidePrompts,
    StmbSidePromptsRepositoryError,
} from '../stmb-side-prompts-repository.js';

export const router = express.Router();

function sendStmbError(response, error) {
    if (isActiveSessionError(error)) {
        return sendActiveSessionRequired(response);
    }

    if (error instanceof LorebookRepositoryError) {
        return response.status(error.status).send({
            error: {
                type: error.type,
                message: error.message,
            },
        });
    }

    if (error instanceof StmbSidePromptsRepositoryError) {
        return response.status(error.status).send({
            error: {
                type: error.type,
                message: error.message,
            },
        });
    }

    if (Number.isInteger(error?.status)) {
        const payload = {
            type: String(error?.type || 'StmbRequestError'),
            message: String(error?.message || 'STMB request failed'),
        };
        for (const key of ['code', 'missingRanges', 'requestedStart', 'requestedEnd', 'lastAvailableMessageId', 'totalLogicalMessages', 'storageMode', 'storageHealthy']) {
            if (error?.[key] !== undefined) {
                payload[key] = error[key];
            }
        }

        return response.status(error.status).send({ error: payload });
    }

    console.error('[STMB] Unexpected error', error);
    return response.status(500).send({
        error: {
            type: 'StmbInternalError',
            message: String(error?.message || error),
        },
    });
}

/**
 * Sends known STMB errors normally while hiding unexpected failure details.
 */
function sendSanitizedStmbError(response, error, { logLabel, type, message }) {
    if (!(error instanceof LorebookRepositoryError) && !Number.isInteger(error?.status) && !isActiveSessionError(error)) {
        console.error(logLabel, String(error?.name || 'Error'));
        return response.status(500).send({
            error: {
                type,
                message,
            },
        });
    }

    return sendStmbError(response, error);
}

function normalizeStorage(value) {
    return value === 'secure' ? 'secure' : (value === 'user' ? 'user' : null);
}

function createStmbRequestError(status, type, message, extra = {}) {
    const error = new Error(String(message || 'STMB request failed'));
    error.status = Number(status) || 500;
    error.type = String(type || 'StmbRequestError');
    Object.assign(error, extra);
    return error;
}

function intersectRanges(ranges = [], start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        return [];
    }

    return (Array.isArray(ranges) ? ranges : [])
        .map(range => ({
            start: Math.max(start, Number(range?.start)),
            end: Math.min(end, Number(range?.end)),
        }))
        .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end) && range.start <= range.end);
}

function countRangeMessages(messages = [], start, end) {
    let visibleMessageCount = 0;
    let capturableMessageCount = 0;

    for (let index = start; index <= end && index < messages.length; index++) {
        const message = messages[index];
        if (!message) {
            continue;
        }
        if (!message.is_system) {
            visibleMessageCount++;
        }

        const content = String(message.mes || '').replace(/\r\n/g, '\n').trim();
        if (content && !message.is_system) {
            capturableMessageCount++;
        }
    }

    return { visibleMessageCount, capturableMessageCount };
}

function normalizeSceneEndpointRequest(body = {}) {
    const sceneStart = body.sceneStart === undefined ? null : Number(body.sceneStart);
    const sceneEnd = body.sceneEnd === undefined ? null : Number(body.sceneEnd);
    return {
        chatRef: body.chatRef,
        sceneStart,
        sceneEnd,
        skipSystemMessages: body.skipSystemMessages !== false,
        allowPartial: Boolean(body.allowPartial),
        chatId: String(body.chatId || ''),
        groupId: String(body.groupId || ''),
        characterName: String(body.characterName || ''),
        userName: String(body.userName || ''),
        groupName: String(body.groupName || ''),
        isGroupChat: Boolean(body.isGroupChat || body.groupId),
        groupParticipants: (Array.isArray(body.groupParticipants) ? body.groupParticipants : [])
            .slice(0, 100)
            .map(item => ({
                key: String(item?.key || '').slice(0, 512),
                avatar: String(item?.avatar || '').slice(0, 512),
                memberId: String(item?.memberId || '').slice(0, 512),
                name: String(item?.name || '').slice(0, 512),
                characterFilterName: String(item?.characterFilterName || '').slice(0, 512),
            })),
    };
}

function normalizeRangeInfoRequest(body = {}) {
    const rangeStart = body.rangeStart === undefined || body.rangeStart === null || body.rangeStart === ''
        ? null
        : Number(body.rangeStart);
    const rangeEnd = body.rangeEnd === undefined || body.rangeEnd === null || body.rangeEnd === ''
        ? null
        : Number(body.rangeEnd);
    return {
        chatRef: body.chatRef,
        rangeStart,
        rangeEnd,
    };
}

function getResolvedRangeInfo(chatState, requestedStart = null, requestedEnd = null) {
    const totalLogicalMessages = Number(chatState?.totalMessages) || 0;
    const lastAvailableMessageId = Number.isInteger(chatState?.lastAvailableMessageId)
        ? chatState.lastAvailableMessageId
        : -1;
    const normalizedStart = Number.isInteger(requestedStart)
        ? requestedStart
        : (totalLogicalMessages > 0 ? 0 : null);
    const normalizedEnd = Number.isInteger(requestedEnd)
        ? requestedEnd
        : (lastAvailableMessageId >= 0 ? lastAvailableMessageId : null);
    const missingRanges = normalizedStart === null || normalizedEnd === null
        ? []
        : intersectRanges(chatState?.missingRanges, normalizedStart, normalizedEnd);
    const counts = normalizedStart === null || normalizedEnd === null || normalizedStart > normalizedEnd
        ? { visibleMessageCount: 0, capturableMessageCount: 0 }
        : countRangeMessages(chatState?.messages, normalizedStart, normalizedEnd);

    return {
        totalLogicalMessages,
        lastAvailableMessageId,
        storageMode: String(chatState?.storageMode || 'full'),
        storageHealthy: chatState?.storageHealthy !== false,
        rangeStart: normalizedStart,
        rangeEnd: normalizedEnd,
        missingRanges,
        visibleMessageCount: counts.visibleMessageCount,
        capturableMessageCount: counts.capturableMessageCount,
    };
}

function resolveStmbChatState(request, chatRef) {
    return resolveSqliteLogicalChatReference(request.user.directories, chatRef);
}

function assertSqliteChatStorageAvailable(chatState) {
    if (chatState?.sqliteMissing) {
        throw createStmbRequestError(404, 'StmbChatStorageUnavailable', 'SQLite chat storage is not available for this chat.', {
            totalLogicalMessages: 0,
            lastAvailableMessageId: -1,
            storageMode: 'sqlite',
            storageHealthy: false,
        });
    }
}

async function resolveStmbChatStateForRange(request, chatRef, rangeStart = null, rangeEnd = null) {
    return resolveSqliteLogicalChatReference(request.user.directories, chatRef, {
        rangeStart,
        rangeEnd,
        includeMessages: true,
    });
}

async function resolveCapturedScene(request, normalizedRequest) {
    if (!Number.isInteger(normalizedRequest.sceneStart) || !Number.isInteger(normalizedRequest.sceneEnd)) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'sceneStart and sceneEnd are required.');
    }

    if (normalizedRequest.sceneStart < 0 || normalizedRequest.sceneEnd < 0 || normalizedRequest.sceneStart > normalizedRequest.sceneEnd) {
        throw createStmbRequestError(400, 'StmbInvalidRange', 'Start message cannot be greater than end message.');
    }

    const chatState = await resolveStmbChatStateForRange(
        request,
        normalizedRequest.chatRef,
        normalizedRequest.sceneStart,
        normalizedRequest.sceneEnd,
    );
    assertSqliteChatStorageAvailable(chatState);
    const totalLogicalMessages = Number(chatState?.totalMessages) || 0;

    if (totalLogicalMessages === 0) {
        throw createStmbRequestError(400, 'StmbNoMessages', 'There are no messages in this chat yet.', {
            totalLogicalMessages,
            lastAvailableMessageId: -1,
            storageMode: chatState?.storageMode,
            storageHealthy: chatState?.storageHealthy,
        });
    }

    if (normalizedRequest.sceneEnd >= totalLogicalMessages) {
        throw createStmbRequestError(
            400,
            'StmbRangeOutOfBounds',
            `Message IDs out of range. Valid range: 0-${Math.max(totalLogicalMessages - 1, 0)}`,
            {
                requestedStart: normalizedRequest.sceneStart,
                requestedEnd: normalizedRequest.sceneEnd,
                totalLogicalMessages,
                lastAvailableMessageId: chatState?.lastAvailableMessageId ?? -1,
                storageMode: chatState?.storageMode,
                storageHealthy: chatState?.storageHealthy,
            },
        );
    }

    const missingRanges = intersectRanges(chatState?.missingRanges, normalizedRequest.sceneStart, normalizedRequest.sceneEnd);
    if (!normalizedRequest.allowPartial && missingRanges.length > 0) {
        const firstMissing = missingRanges[0];
        throw createStmbRequestError(
            409,
            'StmbRangeUnavailable',
            `Cannot capture messages ${normalizedRequest.sceneStart}-${normalizedRequest.sceneEnd} because messages ${firstMissing.start}-${firstMissing.end} are unavailable in chat storage.`,
            {
                code: 'MISSING_CHAT_SEGMENT',
                missingRanges,
                requestedStart: normalizedRequest.sceneStart,
                requestedEnd: normalizedRequest.sceneEnd,
                totalLogicalMessages,
                lastAvailableMessageId: chatState?.lastAvailableMessageId ?? -1,
                storageMode: chatState?.storageMode,
                storageHealthy: chatState?.storageHealthy,
            },
        );
    }

    const compiledScene = compileScene(
        chatState.messages,
        {
            sceneStart: normalizedRequest.sceneStart,
            sceneEnd: normalizedRequest.sceneEnd,
            chatId: normalizedRequest.chatId,
            characterName: normalizedRequest.characterName,
            userName: normalizedRequest.userName,
            groupName: normalizedRequest.groupName,
            stmbPromptTarget: normalizedRequest.isGroupChat ? 'group' : 'character',
        },
        {
            skipSystemMessages: normalizedRequest.skipSystemMessages,
            groupParticipants: normalizedRequest.groupParticipants,
        },
    );

    return {
        compiledScene,
        capture: {
            requestedStart: normalizedRequest.sceneStart,
            requestedEnd: normalizedRequest.sceneEnd,
            capturedStart: compiledScene?.metadata?.sceneStart ?? normalizedRequest.sceneStart,
            capturedEnd: compiledScene?.metadata?.sceneEnd ?? normalizedRequest.sceneEnd,
            totalLogicalMessages,
            lastAvailableMessageId: chatState?.lastAvailableMessageId ?? -1,
            hiddenMessagesSkipped: compiledScene?.metadata?.hiddenMessagesSkipped ?? 0,
            messagesSkipped: compiledScene?.metadata?.messagesSkipped ?? 0,
            missingRanges,
            isPartial: missingRanges.length > 0,
            storageMode: String(chatState?.storageMode || 'full'),
            storageHealthy: chatState?.storageHealthy !== false,
            chatRevision: Math.max(0, Math.trunc(Number(chatState?.header?.chat_revision) || 0)),
        },
    };
}

function ensureEntriesObject(lorebookData) {
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object' || Array.isArray(lorebookData.entries)) {
        lorebookData.entries = {};
    }

    return lorebookData.entries;
}

function getFreeWorldEntryUid(lorebookData) {
    const entries = ensureEntriesObject(lorebookData);
    const MAX_UID = 1_000_000;

    for (let uid = 0; uid < MAX_UID; uid++) {
        if (uid in entries) {
            continue;
        }
        return uid;
    }

    throw new Error('Could not allocate a free lorebook entry uid');
}

function createLorebookEntry(lorebookData) {
    const uid = getFreeWorldEntryUid(lorebookData);
    const entry = { uid };
    lorebookData.entries[uid] = entry;
    return entry;
}

const RESERVED_LOREBOOK_ENTRY_UPDATE_FIELDS = new Set(['uid', 'comment', 'content']);

function findReservedLorebookEntryUpdateField(updates = {}) {
    for (const key of Object.keys(updates || {})) {
        if (RESERVED_LOREBOOK_ENTRY_UPDATE_FIELDS.has(key)) {
            return key;
        }
    }

    return null;
}

function getInvalidLorebookEntryUpdate(fieldGroups = {}) {
    for (const [groupName, updates] of Object.entries(fieldGroups || {})) {
        const key = findReservedLorebookEntryUpdateField(updates);
        if (key) {
            return { groupName, key };
        }
    }

    return null;
}

function upsertLorebookEntryByTitleData(lorebookData, {
    title,
    content = '',
    defaults = {},
    metadataUpdates = {},
    entryOverrides = {},
}) {
    let entry = Object.values(lorebookData.entries).find(candidate => String(candidate?.comment || '') === title);
    let created = false;
    if (!entry) {
        entry = createLorebookEntry(lorebookData);
        entry.vectorized = Boolean(defaults.vectorized);
        entry.selective = Boolean(defaults.selective);
        if (typeof defaults.order === 'number') entry.order = defaults.order;
        if (typeof defaults.position === 'number') entry.position = defaults.position;
        entry.key = Array.isArray(entry.key) ? entry.key : [];
        entry.keysecondary = Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
        entry.disable = false;
        created = true;
    }

    entry.comment = title;
    entry.content = content;
    for (const [key, value] of Object.entries(metadataUpdates)) {
        if (RESERVED_LOREBOOK_ENTRY_UPDATE_FIELDS.has(key)) {
            continue;
        }
        entry[key] = value;
    }
    for (const [key, value] of Object.entries(entryOverrides)) {
        if (RESERVED_LOREBOOK_ENTRY_UPDATE_FIELDS.has(key)) {
            continue;
        }
        entry[key] = value;
    }

    return { created, entry };
}

function initializeLorebookEntryDefaults(entry, defaults = {}) {
    entry.vectorized = Boolean(defaults.vectorized);
    entry.selective = Boolean(defaults.selective);
    if (typeof defaults.order === 'number') entry.order = defaults.order;
    if (typeof defaults.position === 'number') entry.position = defaults.position;
    entry.key = Array.isArray(entry.key) ? entry.key : [];
    entry.keysecondary = Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
    entry.disable = false;
}

function findLorebookEntryByUid(lorebookData, uid) {
    const uidText = String(uid);
    const directEntry = lorebookData?.entries?.[uidText];
    if (directEntry && typeof directEntry === 'object') {
        return directEntry;
    }

    return Object.values(lorebookData?.entries || {})
        .find(entry => entry && String(entry.uid) === uidText) || null;
}

function getLorebookContext(request) {
    const lorebookName = String(request.body?.lorebookName || '').trim();
    if (!lorebookName) {
        return null;
    }

    const storage = normalizeStorage(request.body?.storage);
    if (storage === 'user' && isReservedRecommendedTemplateSource(request.user?.profile?.handle, lorebookName)) {
        return null;
    }

    return {
        lorebookName,
        storage,
    };
}

function normalizeGroupMemoryWriteTarget(value, label, user) {
    const lorebookName = String(value?.lorebookName || '').trim();
    const memoryObject = value?.memoryObject;
    if (!lorebookName || !memoryObject || typeof memoryObject !== 'object' || Array.isArray(memoryObject)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} must include lorebookName and memoryObject.`);
    }
    const title = String(memoryObject.title || '').trim();
    const content = String(memoryObject.content || '').trim();
    if (!title || !content) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} memoryObject requires title and content.`);
    }
    if (value.storage !== undefined && !['user', 'secure'].includes(value.storage)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} storage must be "user" or "secure".`);
    }
    if ((value.storage || 'user') === 'user' && isReservedRecommendedTemplateSource(user?.profile?.handle, lorebookName)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} cannot use a designated blank lorebook template.`);
    }
    if (memoryObject.keywords !== undefined && !Array.isArray(memoryObject.keywords)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} memoryObject keywords must be an array.`);
    }
    if (value.characterFilterNames !== undefined && !Array.isArray(value.characterFilterNames)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} characterFilterNames must be an array.`);
    }
    if (value.usePrimaryTitle !== undefined && typeof value.usePrimaryTitle !== 'boolean') {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} usePrimaryTitle must be a boolean.`);
    }
    return {
        lorebookName,
        storage: value.storage || 'user',
        memoryObject: {
            title,
            content,
            keywords: Array.isArray(memoryObject.keywords)
                ? memoryObject.keywords.map(item => String(item || '').trim()).filter(Boolean).slice(0, 100)
                : [],
        },
        characterFilterNames: [...new Set((Array.isArray(value.characterFilterNames) ? value.characterFilterNames : [])
            .map(item => String(item || '').trim()).filter(Boolean))].slice(0, 100),
        usePrimaryTitle: value.usePrimaryTitle !== false,
    };
}

function normalizeRegenerationRequest(body, user) {
    const lorebookName = String(body?.lorebookName || '').trim();
    const storage = normalizeStorage(body?.storage);
    const uid = body?.uid === undefined || body?.uid === null ? '' : String(body.uid).trim();
    const expectedTargetHash = String(body?.expectedTargetHash || '').trim();
    const replacement = body?.replacement;
    if (!lorebookName || !uid || !/^[a-f0-9]{8}$/i.test(expectedTargetHash) || !replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'lorebookName, uid, replacement, and expectedTargetHash are required.');
    }
    if (storage !== 'user') {
        throw createStmbRequestError(403, 'StmbRegenerationStorageNotAllowed', 'Regeneration is available only for ordinary user lorebooks.');
    }
    if (isReservedRecommendedTemplateSource(user?.profile?.handle, lorebookName)) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'A designated blank lorebook template cannot be regenerated.');
    }

    const title = String(replacement.title || '').trim();
    const content = String(replacement.content || '').trim();
    if (!title || !content || title.length > 1000 || content.length > 1_000_000) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'replacement title and content are required and must be within size limits.');
    }
    if (!Array.isArray(replacement.keywords) || replacement.keywords.length > 100) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'replacement keywords must be an array with no more than 100 items.');
    }
    const keywords = replacement.keywords.map(value => String(value || '').trim()).filter(Boolean);
    if (keywords.some(value => value.length > 500)) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'replacement keywords must be within size limits.');
    }

    if (Array.isArray(body?.sourceUids) && body.sourceUids.length > 10_000) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'sourceUids contains too many items.');
    }
    const sourceUids = Array.isArray(body?.sourceUids)
        ? [...new Set(body.sourceUids.map(value => String(value ?? '').trim()).filter(Boolean))]
        : [];
    const sourceHashes = body?.sourceHashes && typeof body.sourceHashes === 'object' && !Array.isArray(body.sourceHashes)
        ? Object.fromEntries(Object.entries(body.sourceHashes).map(([key, value]) => [String(key), String(value || '').trim()]))
        : {};
    if (Object.keys(sourceHashes).length > 10_000 || Object.values(sourceHashes).some(value => !/^[a-f0-9]{8}$/i.test(value))) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'sourceHashes contains an invalid hash.');
    }
    const expectedChatRevision = body?.expectedChatRevision === undefined || body?.expectedChatRevision === null
        ? null
        : Number(body.expectedChatRevision);

    return {
        lorebookName,
        storage,
        uid,
        expectedTargetHash,
        sourceUids,
        sourceHashes,
        replacement: { title, content, keywords },
        chatRef: body?.chatRef,
        expectedChatRevision: Number.isInteger(expectedChatRevision) && expectedChatRevision >= 0 ? expectedChatRevision : null,
        currentChatId: String(body?.currentChatId || '').trim(),
    };
}

function normalizeGroupStloTarget(value, label, user) {
    const lorebookName = String(value?.lorebookName || '').trim();
    const storage = normalizeStorage(value?.storage);
    if (!lorebookName || !storage || !Array.isArray(value?.characterNames)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} requires lorebookName, storage, and characterNames.`);
    }
    if (storage === 'user' && isReservedRecommendedTemplateSource(user?.profile?.handle, lorebookName)) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} cannot use a designated blank lorebook template.`);
    }
    const characterNames = [...new Set(value.characterNames
        .map(item => String(item || '').trim())
        .filter(Boolean))].slice(0, 100);
    if (characterNames.length === 0) {
        throw createStmbRequestError(400, 'StmbBadRequest', `${label} requires at least one character name.`);
    }
    return { lorebookName, storage, characterNames };
}

function assertRegenerationEntryState(lorebookData, requestData) {
    const indexes = buildRegenerationIndexes(lorebookData);
    const target = getRegenerationEntryByUid(lorebookData, requestData.uid, indexes);
    if (!target || hashRegenerationEntry(target) !== requestData.expectedTargetHash) {
        throw createStmbRequestError(409, 'StmbRegenerationTargetChanged', 'The memory entry changed before regeneration could be saved.');
    }
    const eligibility = getRegenerationEligibility(target, lorebookData, indexes);
    if (!eligibility.eligible) {
        throw createStmbRequestError(409, 'StmbRegenerationEligibilityChanged', 'The memory entry is no longer eligible for regeneration.');
    }
    if (parseSequenceFromTitle(requestData.replacement.title) !== eligibility.sequenceNumber) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'The replacement title must preserve the original sequence number.');
    }

    const actualSourceUids = [...(eligibility.sourceUids || [])].map(String).sort();
    const expectedSourceUids = [...requestData.sourceUids].map(String).sort();
    if (actualSourceUids.length !== expectedSourceUids.length || actualSourceUids.some((uid, index) => uid !== expectedSourceUids[index])) {
        throw createStmbRequestError(409, 'StmbRegenerationSourcesChanged', 'The consolidation source set changed before regeneration could be saved.');
    }
    for (const sourceUid of actualSourceUids) {
        const source = getRegenerationEntryByUid(lorebookData, sourceUid, indexes);
        if (!source || hashRegenerationEntry(source) !== requestData.sourceHashes[sourceUid]) {
            throw createStmbRequestError(409, 'StmbRegenerationSourcesChanged', 'A consolidation source changed before regeneration could be saved.');
        }
    }
    return { target, eligibility };
}

router.get('/side-prompts', async (request, response) => {
    try {
        const result = readStmbSidePrompts(request.user);
        if (!result.document) return response.sendStatus(404);
        return response.send(result);
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.put('/side-prompts', async (request, response) => {
    try {
        await request.activeSessionOperation?.assertAllowed();
        const result = await saveStmbSidePrompts(request.user, request.body?.document, request.body?.revision);
        return response.send({ revision: result.revision });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

function getCanonicalMemoryNumber(entry) {
    if (entry?.[STMB_MANAGED_FLAG] !== true || entry?.stmbSummary === true) return null;
    const direct = Number(entry?.STMB_canonicalMemoryNumber ?? entry?.STMB_memoryNumber);
    if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
    const parsed = parseSequenceFromTitle(entry?.comment || entry?.title || '');
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function allocateCanonicalMemoryNumber(lorebooks) {
    let maximum = 0;
    for (const item of lorebooks) {
        for (const entry of Object.values(item?.data?.entries || {})) {
            const number = getCanonicalMemoryNumber(entry);
            if (number && number > maximum) maximum = number;
        }
    }
    return maximum + 1;
}

function createCanonicalInclusionGroup(sceneContext, canonicalNumber) {
    const rawName = String(sceneContext?.groupName || sceneContext?.characterName || sceneContext?.chatId || 'Chat').trim();
    const name = rawName
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'Chat';
    return `${name}-Memory-${String(canonicalNumber).padStart(3, '0')}`;
}

function createCanonicalEntryMetadata(inclusionGroup, canonicalLorebookName, canonicalEntryUid, canonicalNumber, isCanonical) {
    return {
        STMB_canonical: Boolean(isCanonical),
        STMB_canonicalLorebook: canonicalLorebookName,
        STMB_canonicalEntryUid: canonicalEntryUid,
        STMB_canonicalMemoryNumber: canonicalNumber,
        STMB_inclusionGroup: inclusionGroup,
    };
}

function restoreManagedInclusionGroup(entry) {
    const inclusionGroup = String(entry?.STMB_inclusionGroup || '').trim();
    if (inclusionGroup) entry.group = inclusionGroup;
}

router.post('/context-settings/list', (request, response) => {
    try {
        return response.send({
            ok: true,
            settings: listStmbContextSettings(request.user),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/owned-entries', (request, response) => {
    try {
        return response.send({
            ok: true,
            entries: listOwnedStmbContextSourceEntries(request.user),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/get', (request, response) => {
    try {
        const setting = getStmbContextSetting(request.user, request.body?.key);
        if (!setting) {
            return response.status(404).send({
                error: {
                    type: 'StmbContextSettingNotFound',
                    message: 'Context setting was not found.',
                },
            });
        }

        return response.send({ ok: true, setting });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/upsert', async (request, response) => {
    try {
        const setting = await upsertStmbContextSetting(request.user, request.body?.setting);
        return response.send({ ok: true, key: setting.key, setting });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/duplicate', async (request, response) => {
    try {
        const setting = await duplicateStmbContextSetting(request.user, request.body?.key);
        return response.send({ ok: true, key: setting.key, setting });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/delete', async (request, response) => {
    try {
        return response.send({
            ok: true,
            ...(await deleteStmbContextSetting(request.user, request.body?.key)),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/resolve', (request, response) => {
    try {
        const key = String(request.body?.key || '').trim();
        if (!key || key === STMB_CONTEXT_NONE_KEY) {
            return response.send({ ok: true, entries: [], warnings: [] });
        }

        const setting = getStmbContextSetting(request.user, key);
        if (!setting) {
            return response.send({
                ok: true,
                entries: [],
                warnings: [{
                    reason: 'StmbContextSettingNotFound',
                    message: 'Context setting was not found.',
                }],
            });
        }

        return response.send({
            ok: true,
            key: setting.key,
            ...resolveStmbContextSettingEntries(request.user, setting),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/context-settings/migrate-lorebook-reference', async (request, response) => {
    try {
        return response.send({
            ok: true,
            ...(await migrateStmbContextSettingsLorebookReference(request.user, request.body)),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/chat-range-info', async (request, response) => {
    try {
        const normalizedRequest = normalizeRangeInfoRequest(request.body);
        if (normalizedRequest.rangeStart !== null && (!Number.isInteger(normalizedRequest.rangeStart) || normalizedRequest.rangeStart < 0)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'rangeStart must be a non-negative integer.');
        }
        if (normalizedRequest.rangeEnd !== null && (!Number.isInteger(normalizedRequest.rangeEnd) || normalizedRequest.rangeEnd < 0)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'rangeEnd must be a non-negative integer.');
        }
        if (normalizedRequest.rangeStart === null && normalizedRequest.rangeEnd !== null) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'rangeStart is required when rangeEnd is provided.');
        }
        if (normalizedRequest.rangeStart !== null && normalizedRequest.rangeEnd !== null && normalizedRequest.rangeStart > normalizedRequest.rangeEnd) {
            throw createStmbRequestError(400, 'StmbInvalidRange', 'Start message cannot be greater than end message.');
        }

        const metadataState = await resolveStmbChatState(request, normalizedRequest.chatRef);
        assertSqliteChatStorageAvailable(metadataState);
        const totalLogicalMessages = Number(metadataState?.totalMessages) || 0;
        const lastAvailableMessageId = Number.isInteger(metadataState?.lastAvailableMessageId)
            ? metadataState.lastAvailableMessageId
            : -1;

        if (totalLogicalMessages > 0 && normalizedRequest.rangeEnd !== null && normalizedRequest.rangeEnd > lastAvailableMessageId) {
            throw createStmbRequestError(
                400,
                'StmbRangeOutOfBounds',
                `Message IDs out of range. Valid range: 0-${lastAvailableMessageId}`,
                {
                    requestedStart: normalizedRequest.rangeStart,
                    requestedEnd: normalizedRequest.rangeEnd,
                    totalLogicalMessages,
                    lastAvailableMessageId,
                    storageMode: metadataState?.storageMode,
                    storageHealthy: metadataState?.storageHealthy,
                },
            );
        }

        const rangeEndForRead = normalizedRequest.rangeEnd !== null
            ? normalizedRequest.rangeEnd
            : lastAvailableMessageId;
        const shouldReadRange = totalLogicalMessages > 0
            && normalizedRequest.rangeStart !== null
            && normalizedRequest.rangeStart <= rangeEndForRead;
        const chatState = shouldReadRange
            ? await resolveStmbChatStateForRange(request, normalizedRequest.chatRef, normalizedRequest.rangeStart, rangeEndForRead)
            : metadataState;

        const resolvedRangeInfo = getResolvedRangeInfo(chatState, normalizedRequest.rangeStart, normalizedRequest.rangeEnd);
        return response.send({
            ok: true,
            totalLogicalMessages,
            lastAvailableMessageId,
            storageMode: resolvedRangeInfo.storageMode,
            storageHealthy: resolvedRangeInfo.storageHealthy,
            rangeStart: resolvedRangeInfo.rangeStart,
            rangeEnd: resolvedRangeInfo.rangeEnd,
            missingRanges: resolvedRangeInfo.missingRanges,
            visibleMessageCount: resolvedRangeInfo.visibleMessageCount,
            capturableMessageCount: resolvedRangeInfo.capturableMessageCount,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/capture-scene', async (request, response) => {
    try {
        const normalizedRequest = normalizeSceneEndpointRequest(request.body);
        const result = await resolveCapturedScene(request, normalizedRequest);
        return response.send({
            ok: true,
            compiledScene: result.compiledScene,
            capture: result.capture,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/save-memory', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const memoryObject = request.body?.memoryObject;
    const sceneContext = request.body?.sceneContext;
    const profile = request.body?.profile || {};

    if (!lorebookContext || !memoryObject || !sceneContext) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName, memoryObject, and sceneContext are required.',
            },
        });
    }

    try {
        const { data: lorebookData, metadata } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            false,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);
        const orderClampNotifications = [];

        const sequenceNumber = getNextManagedMemorySequenceNumber(
            lorebookData.entries,
            profile?.titleFormat || sceneContext?.titleFormat || null,
        );
        const entryPayload = createManagedLorebookEntryData(memoryObject, sceneContext, profile, sequenceNumber);
        const entry = createLorebookEntry(lorebookData);
        Object.assign(entry, entryPayload);
        applyLorebookSettings(entry, profile, {
            orderNumber: parseSequenceFromTitle(entry.comment || entry.title || '') || 1,
            orderNumberLabel: 'memory',
            onOrderClamped: notification => orderClampNotifications.push(notification),
        });

        await request.activeSessionOperation?.assertAllowed();
        const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
        return response.send({
            ok: true,
            lorebookName: savedMetadata.name,
            storage: savedMetadata.storage,
            entry,
            sequenceNumber,
            orderClampNotifications,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/sync-group-stlo', async (request, response) => {
    let targets;
    try {
        if (!Array.isArray(request.body?.targets) || request.body.targets.length > 100) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'targets must be an array with no more than 100 items.');
        }
        targets = request.body.targets.map((target, index) => normalizeGroupStloTarget(target, `targets[${index}]`, request.user));
    } catch (error) {
        return sendSanitizedStmbError(response, error, {
            logLabel: '[STMB] Group STLO metadata sync failed',
            type: 'StmbGroupStloSyncFailed',
            message: 'The STLO metadata could not be updated.',
        });
    }

    try {
        const updatedCount = await withLorebookManagementTransaction(async transaction => {
            const books = [];
            const resolvedKeys = new Set();
            for (const target of targets) {
                const loaded = await getLorebookForManagement(request.user, target.lorebookName, false, target.storage);
                if (!loaded?.data) {
                    throw createStmbRequestError(404, 'StmbLorebookNotFound', 'A configured group character lorebook was not found.');
                }
                assertLorebookCheckoutForManagement(request.user, loaded.metadata);
                const resolvedKey = `${loaded.metadata.storage}:${loaded.metadata.name}`;
                if (resolvedKeys.has(resolvedKey)) {
                    throw createStmbRequestError(400, 'StmbDuplicateGroupLorebook', 'Each STLO target lorebook must be unique.');
                }
                resolvedKeys.add(resolvedKey);
                const originalData = structuredClone(loaded.data);
                const change = applyStloCharacterFilters(loaded.data, target.characterNames);
                books.push({
                    data: loaded.data,
                    metadata: loaded.metadata,
                    originalData,
                    changed: change.changed,
                });
            }

            await request.activeSessionOperation?.assertAllowed();
            const savedBooks = [];
            try {
                for (const book of books.filter(item => item.changed)) {
                    await request.activeSessionOperation?.assertAllowed();
                    await transaction.save(request.user, book.metadata.name, book.data, book.metadata.storage);
                    savedBooks.push(book);
                }
            } catch (error) {
                let rollbackFailed = false;
                for (const book of savedBooks.reverse()) {
                    try {
                        await transaction.save(request.user, book.metadata.name, book.originalData, book.metadata.storage);
                    } catch {
                        rollbackFailed = true;
                    }
                }
                if (rollbackFailed) {
                    throw createStmbRequestError(
                        500,
                        'StmbGroupStloRollbackFailed',
                        'The STLO metadata update failed and could not be fully rolled back. Manual review is required.',
                    );
                }
                throw error;
            }
            return books.filter(item => item.changed).length;
        });
        return response.send({ ok: true, updatedCount });
    } catch (error) {
        return sendSanitizedStmbError(response, error, {
            logLabel: '[STMB] Group STLO metadata sync failed',
            type: 'StmbGroupStloSyncFailed',
            message: 'The STLO metadata could not be updated.',
        });
    }
});

router.post('/save-group-memory', async (request, response) => {
    let primary;
    let targets;
    const sceneContext = request.body?.sceneContext;
    const profile = request.body?.profile || {};
    try {
        const rawTargets = request.body?.targets;
        if (rawTargets !== undefined && !Array.isArray(rawTargets)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'targets must be an array.');
        }
        if (Array.isArray(rawTargets) && rawTargets.length > 100) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'No more than 100 group memory targets are allowed.');
        }
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'profile must be an object.');
        }
        primary = normalizeGroupMemoryWriteTarget(request.body?.primary, 'primary', request.user);
        targets = (rawTargets || [])
            .map((target, index) => normalizeGroupMemoryWriteTarget(target, `targets[${index}]`, request.user));
        if (!sceneContext || typeof sceneContext !== 'object' || Array.isArray(sceneContext)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'sceneContext is required.');
        }
        const names = new Set([primary.lorebookName]);
        for (const target of targets) {
            if (names.has(target.lorebookName)) {
                throw createStmbRequestError(400, 'StmbDuplicateGroupLorebook', 'Each group memory target lorebook must be unique.');
            }
            names.add(target.lorebookName);
        }
    } catch (error) {
        return sendStmbError(response, error);
    }

    try {
        const result = await withLorebookManagementTransaction(async transaction => {
            const requested = [primary, ...targets];
            const lorebooks = [];
            const resolvedLorebookKeys = new Set();
            for (const target of requested) {
                const loaded = await getLorebookForManagement(
                    request.user,
                    target.lorebookName,
                    false,
                    target.storage,
                );
                if (!loaded?.data) {
                    throw createStmbRequestError(404, 'StmbLorebookNotFound', 'A configured group memory lorebook was not found.');
                }
                assertLorebookCheckoutForManagement(request.user, loaded.metadata);
                const resolvedKey = `${loaded.metadata.storage}:${loaded.metadata.name}`;
                if (resolvedLorebookKeys.has(resolvedKey)) {
                    throw createStmbRequestError(400, 'StmbDuplicateGroupLorebook', 'Each group memory target lorebook must be unique.');
                }
                resolvedLorebookKeys.add(resolvedKey);
                ensureEntriesObject(loaded.data);
                lorebooks.push({
                    request: target,
                    data: loaded.data,
                    metadata: loaded.metadata,
                    originalData: structuredClone(loaded.data),
                });
            }

            const canonicalNumber = allocateCanonicalMemoryNumber(lorebooks);
            const inclusionGroup = createCanonicalInclusionGroup(sceneContext, canonicalNumber);
            const primaryBook = lorebooks[0];
            const primarySequence = getNextManagedMemorySequenceNumber(
                primaryBook.data.entries,
                profile?.titleFormat || sceneContext?.titleFormat || null,
            );
            const primaryPayload = createManagedLorebookEntryData(
                primary.memoryObject,
                sceneContext,
                profile,
                primarySequence,
                {
                    characterFilterNames: primary.characterFilterNames,
                    inclusionGroup,
                    entryMetadata: createCanonicalEntryMetadata(
                        inclusionGroup,
                        primaryBook.metadata.name,
                        null,
                        canonicalNumber,
                        true,
                    ),
                },
            );
            const primaryEntry = createLorebookEntry(primaryBook.data);
            Object.assign(primaryEntry, primaryPayload);
            primaryEntry.STMB_canonicalEntryUid = primaryEntry.uid;
            const orderClampNotifications = [];
            applyLorebookSettings(primaryEntry, profile, {
                orderNumber: parseSequenceFromTitle(primaryEntry.comment || '') || primarySequence,
                orderNumberLabel: 'memory',
                onOrderClamped: notification => orderClampNotifications.push(notification),
            });
            restoreManagedInclusionGroup(primaryEntry);

            const created = [{
                lorebookName: primaryBook.metadata.name,
                storage: primaryBook.metadata.storage,
                entry: primaryEntry,
            }];
            for (let index = 1; index < lorebooks.length; index++) {
                const book = lorebooks[index];
                const target = book.request;
                applyStloCharacterFilters(book.data, target.characterFilterNames);
                const sequence = getNextManagedMemorySequenceNumber(
                    book.data.entries,
                    profile?.titleFormat || sceneContext?.titleFormat || null,
                );
                const payload = createManagedLorebookEntryData(
                    target.memoryObject,
                    sceneContext,
                    profile,
                    sequence,
                    {
                        entryTitle: target.usePrimaryTitle ? primaryEntry.comment : null,
                        characterFilterNames: target.characterFilterNames,
                        inclusionGroup,
                        entryMetadata: createCanonicalEntryMetadata(
                            inclusionGroup,
                            primaryBook.metadata.name,
                            primaryEntry.uid,
                            canonicalNumber,
                            false,
                        ),
                    },
                );
                const entry = createLorebookEntry(book.data);
                Object.assign(entry, payload);
                applyLorebookSettings(entry, profile, {
                    orderNumber: parseSequenceFromTitle(entry.comment || '') || sequence,
                    orderNumberLabel: 'memory',
                    onOrderClamped: notification => orderClampNotifications.push(notification),
                });
                restoreManagedInclusionGroup(entry);
                created.push({ lorebookName: book.metadata.name, storage: book.metadata.storage, entry });
            }

            await request.activeSessionOperation?.assertAllowed();
            const savedBooks = [];
            try {
                for (const book of lorebooks) {
                    await request.activeSessionOperation?.assertAllowed();
                    await transaction.save(request.user, book.metadata.name, book.data, book.metadata.storage);
                    savedBooks.push(book);
                }
            } catch (error) {
                let rollbackFailed = false;
                for (const book of savedBooks.reverse()) {
                    try {
                        await transaction.save(request.user, book.metadata.name, book.originalData, book.metadata.storage);
                    } catch {
                        rollbackFailed = true;
                    }
                }
                if (rollbackFailed) {
                    throw createStmbRequestError(
                        500,
                        'StmbGroupMemoryRollbackFailed',
                        'The group memory write failed and could not be fully rolled back. Manual review is required.',
                    );
                }
                throw error;
            }

            return {
                canonicalNumber,
                inclusionGroup,
                orderClampNotifications,
                entries: created.map(item => ({
                    lorebookName: item.lorebookName,
                    storage: item.storage,
                    uid: item.entry.uid,
                    title: item.entry.comment,
                    characterFilterNames: item.entry.characterFilter?.names || [],
                })),
            };
        });
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendSanitizedStmbError(response, error, {
            logLabel: '[STMB] Group memory save failed',
            type: 'StmbGroupMemoryWriteFailed',
            message: 'The group memory could not be saved.',
        });
    }
});

router.post('/regenerate-entry', async (request, response) => {
    let requestData;
    try {
        requestData = normalizeRegenerationRequest(request.body, request.user);
    } catch (error) {
        return sendStmbError(response, error);
    }

    try {
        const result = await withLorebookManagementTransaction(async transaction => {
            let { data: lorebookData, metadata } = await getLorebookForManagement(
                request.user,
                requestData.lorebookName,
                false,
                'user',
            );
            if (!lorebookData || metadata.storage !== 'user') {
                throw createStmbRequestError(403, 'StmbRegenerationStorageNotAllowed', 'Regeneration is available only for ordinary user lorebooks.');
            }
            ensureEntriesObject(lorebookData);
            const initialState = assertRegenerationEntryState(lorebookData, requestData);

            const saveReplacement = async ({ reread = false } = {}) => {
                if (reread) {
                    const fresh = await getLorebookForManagement(
                        request.user,
                        requestData.lorebookName,
                        false,
                        'user',
                    );
                    if (!fresh?.data || fresh.metadata?.storage !== 'user') {
                        throw createStmbRequestError(409, 'StmbRegenerationTargetChanged', 'The memory entry changed before regeneration could be saved.');
                    }
                    lorebookData = fresh.data;
                    metadata = fresh.metadata;
                    ensureEntriesObject(lorebookData);
                }
                const { target, eligibility } = assertRegenerationEntryState(lorebookData, requestData);
                applyRegenerationReplacement(target, requestData.replacement, {
                    lorebookData,
                    sourceUids: eligibility.sourceUids,
                });
                await request.activeSessionOperation?.assertAllowed();
                await transaction.save(request.user, metadata.name, lorebookData, 'user');
                return {
                    ok: true,
                    lorebookName: metadata.name,
                    storage: 'user',
                    uid: target.uid,
                };
            };

            if (initialState.eligibility.kind !== 'memory') {
                return await saveReplacement();
            }
            if (!requestData.chatRef || requestData.expectedChatRevision === null || !requestData.currentChatId) {
                throw createStmbRequestError(400, 'StmbBadRequest', 'Base-memory regeneration requires chatRef, currentChatId, and expectedChatRevision.');
            }
            const storedChatId = String(initialState.target.STMB_chatId || '').trim();
            if (storedChatId && storedChatId !== requestData.currentChatId) {
                throw createStmbRequestError(409, 'StmbRegenerationChatChanged', 'The memory does not belong to the current chat.');
            }

            const unlockedChatState = await resolveStmbChatState(request, requestData.chatRef);
            assertSqliteChatStorageAvailable(unlockedChatState);
            return await withChatSaveLock(unlockedChatState.sqlitePath, async () => {
                const chatState = await resolveStmbChatStateForRange(
                    request,
                    requestData.chatRef,
                    initialState.eligibility.sceneStart,
                    initialState.eligibility.sceneEnd,
                );
                assertSqliteChatStorageAvailable(chatState);
                const currentRevision = Math.max(0, Math.trunc(Number(chatState?.header?.chat_revision) || 0));
                if (currentRevision !== requestData.expectedChatRevision) {
                    throw createStmbRequestError(409, 'StmbRegenerationChatChanged', 'The chat changed before regeneration could be saved.');
                }
                if (
                    initialState.eligibility.sceneEnd >= Number(chatState?.totalMessages || 0) ||
                    (Array.isArray(chatState?.missingRanges) && chatState.missingRanges.length > 0)
                ) {
                    throw createStmbRequestError(409, 'StmbRegenerationChatChanged', 'The original message range is no longer available.');
                }
                return await saveReplacement({ reread: true });
            });
        });
        return response.send(result);
    } catch (error) {
        return sendSanitizedStmbError(response, error, {
            logLabel: '[STMB] Entry regeneration failed',
            type: 'StmbRegenerationFailed',
            message: 'The memory entry could not be regenerated.',
        });
    }
});

router.post('/commit-summaries', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const summaryCandidates = Array.isArray(request.body?.summaryCandidates) ? request.body.summaryCandidates : null;
    const targetTier = Number(request.body?.targetTier);
    const titleFormat = request.body?.titleFormat;
    const migrated = Boolean(request.body?.migrated);
    const disableOriginals = Boolean(request.body?.disableOriginals);
    const summaryEntrySettings = request.body?.summaryEntrySettings || {};
    const sourceFingerprints = request.body?.sourceFingerprints
        && typeof request.body.sourceFingerprints === 'object'
        && !Array.isArray(request.body.sourceFingerprints)
        ? request.body.sourceFingerprints
        : null;
    const sourceIds = Array.isArray(request.body?.sourceIds) ? request.body.sourceIds.map(String) : null;

    if (!lorebookContext || !summaryCandidates || !Number.isFinite(targetTier)) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName, summaryCandidates, and targetTier are required.',
            },
        });
    }

    try {
        const { data: lorebookData, metadata } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            false,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);
        const schemaMigrated = migrateLorebookSummarySchema(lorebookData);
        verifySummarySourceFingerprints(lorebookData, sourceFingerprints, sourceIds);

        let nextSummaryNumber = getNextSummaryNumber(lorebookData, targetTier);
        const createdEntries = [];
        const orderClampNotifications = [];

        for (const summaryCandidate of summaryCandidates) {
            const entry = createLorebookEntry(lorebookData);
            const entryPayload = createManagedSummaryEntryData(summaryCandidate, {
                targetTier,
                titleFormat,
                sequenceNumber: nextSummaryNumber,
                sourceEntries: Object.values(lorebookData.entries),
                includeSourceUids: metadata.storage === 'user',
            });
            Object.assign(entry, entryPayload);
            applyLorebookSettings(entry, summaryEntrySettings, {
                orderNumber: nextSummaryNumber,
                orderNumberLabel: getSummaryTierLabel(targetTier).toLowerCase(),
                onOrderClamped: notification => orderClampNotifications.push(notification),
            });
            restoreManagedInclusionGroup(entry);

            if (disableOriginals) {
                const sourceIds = new Set((summaryCandidate.memberIds || []).map(String));
                for (const sourceEntry of Object.values(lorebookData.entries)) {
                    if (sourceEntry && sourceIds.has(String(sourceEntry.uid))) {
                        sourceEntry.disable = true;
                        sourceEntry.disabledBySummaryId = entry.uid;
                    }
                }
            }

            createdEntries.push(structuredClone(entry));
            nextSummaryNumber++;
        }

        if (createdEntries.length > 0 || migrated || schemaMigrated) {
            await request.activeSessionOperation?.assertAllowed();
            const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
            return response.send({
                ok: true,
                lorebookName: savedMetadata.name,
                storage: savedMetadata.storage,
                createdEntries,
                orderClampNotifications,
            });
        }

        return response.send({
            ok: true,
            lorebookName: metadata.name,
            storage: metadata.storage,
            createdEntries,
            orderClampNotifications,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/upsert-entry-by-title', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const title = String(request.body?.title || '').trim();
    const content = request.body?.content != null ? String(request.body.content) : '';
    const defaults = request.body?.defaults || {};
    const metadataUpdates = request.body?.metadataUpdates || {};
    const entryOverrides = request.body?.entryOverrides || {};
    const invalidUpdate = getInvalidLorebookEntryUpdate({ metadataUpdates, entryOverrides });

    if (!lorebookContext || !title) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and title are required.',
            },
        });
    }

    if (invalidUpdate) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: `${invalidUpdate.groupName}.${invalidUpdate.key} is reserved. Use the title/content request fields and server-assigned uid instead.`,
            },
        });
    }

    try {
        const { data: lorebookData, metadata } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            false,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);

        const { created, entry } = upsertLorebookEntryByTitleData(lorebookData, {
            title,
            content,
            defaults,
            metadataUpdates,
            entryOverrides,
        });

        await request.activeSessionOperation?.assertAllowed();
        const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
        return response.send({
            ok: true,
            lorebookName: savedMetadata.name,
            storage: savedMetadata.storage,
            created,
            entry,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/create-entry', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const title = String(request.body?.title || '').trim();
    const content = request.body?.content != null ? String(request.body.content) : '';
    const defaults = request.body?.defaults || {};
    const metadataUpdates = request.body?.metadataUpdates || {};
    const entryOverrides = request.body?.entryOverrides || {};
    const invalidUpdate = getInvalidLorebookEntryUpdate({ metadataUpdates, entryOverrides });

    if (!lorebookContext || !title) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and title are required.',
            },
        });
    }

    if (invalidUpdate) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: `${invalidUpdate.groupName}.${invalidUpdate.key} is reserved. Use the title/content request fields and server-assigned uid instead.`,
            },
        });
    }

    try {
        const { data: lorebookData, metadata } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            false,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);

        const duplicate = Object.values(lorebookData.entries)
            .find(entry => String(entry?.comment || '') === title);
        if (duplicate) {
            return response.status(409).send({
                error: {
                    type: 'StmbDuplicateEntryTitle',
                    message: 'A lorebook entry with this title already exists.',
                },
            });
        }

        const entry = createLorebookEntry(lorebookData);
        initializeLorebookEntryDefaults(entry, defaults);
        entry.comment = title;
        entry.content = content;
        for (const [key, value] of Object.entries(metadataUpdates)) {
            entry[key] = value;
        }
        for (const [key, value] of Object.entries(entryOverrides)) {
            entry[key] = value;
        }

        await request.activeSessionOperation?.assertAllowed();
        const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
        return response.send({
            ok: true,
            lorebookName: savedMetadata.name,
            storage: savedMetadata.storage,
            created: true,
            entry,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/update-entry-by-uid', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const uid = request.body?.uid;
    const hasTitle = request.body?.title !== undefined;
    const hasContent = request.body?.content !== undefined;
    const title = hasTitle ? String(request.body.title || '').trim() : '';
    const content = hasContent ? String(request.body.content ?? '') : null;
    const expectedContentHash = request.body?.expectedContentHash === undefined || request.body?.expectedContentHash === null
        ? ''
        : String(request.body.expectedContentHash || '').trim();
    const metadataUpdates = request.body?.metadataUpdates || {};
    const entryOverrides = request.body?.entryOverrides || {};
    const invalidUpdate = getInvalidLorebookEntryUpdate({ metadataUpdates, entryOverrides });

    if (!lorebookContext || uid === undefined || uid === null || uid === '') {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and uid are required.',
            },
        });
    }

    if (hasTitle && !title) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'title cannot be empty when provided.',
            },
        });
    }

    if (invalidUpdate) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: `${invalidUpdate.groupName}.${invalidUpdate.key} is reserved. Use the title/content request fields and server-assigned uid instead.`,
            },
        });
    }

    try {
        const { data: lorebookData, metadata } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            false,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);

        const entry = findLorebookEntryByUid(lorebookData, uid);
        if (!entry) {
            return response.status(404).send({
                error: {
                    type: 'StmbEntryNotFound',
                    message: 'Lorebook entry was not found.',
                },
            });
        }

        if (expectedContentHash && stableHashString(String(entry.content || '')) !== expectedContentHash) {
            return response.status(409).send({
                error: {
                    type: 'StmbEntryContentChanged',
                    code: 'TOPICAL_CLIP_TARGET_CHANGED',
                    message: 'Lorebook entry content changed after draft generation.',
                },
            });
        }

        if (hasTitle) {
            const duplicate = Object.values(lorebookData.entries)
                .find(candidate => candidate !== entry && String(candidate?.comment || '') === title);
            if (duplicate) {
                return response.status(409).send({
                    error: {
                        type: 'StmbDuplicateEntryTitle',
                        message: 'A lorebook entry with this title already exists.',
                    },
                });
            }
            entry.comment = title;
        }
        if (hasContent) {
            entry.content = content;
        }
        for (const [key, value] of Object.entries(metadataUpdates)) {
            entry[key] = value;
        }
        for (const [key, value] of Object.entries(entryOverrides)) {
            entry[key] = value;
        }

        await request.activeSessionOperation?.assertAllowed();
        const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
        return response.send({
            ok: true,
            lorebookName: savedMetadata.name,
            storage: savedMetadata.storage,
            entry,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/upsert-entries-batch', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const items = Array.isArray(request.body?.items) ? request.body.items : null;

    if (!lorebookContext || !items) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and items are required.',
            },
        });
    }

    for (const item of items) {
        if (!String(item?.title || '').trim()) {
            return response.status(400).send({
                error: {
                    type: 'StmbBadRequest',
                    message: 'Every batch item requires a title.',
                },
            });
        }

        const invalidUpdate = getInvalidLorebookEntryUpdate({
            metadataUpdates: item?.metadataUpdates || {},
            entryOverrides: item?.entryOverrides || {},
        });
        if (invalidUpdate) {
            return response.status(400).send({
                error: {
                    type: 'StmbBadRequest',
                    message: `Batch item "${String(item?.title || '').trim()}": ${invalidUpdate.groupName}.${invalidUpdate.key} is reserved. Use the title/content item fields and server-assigned uid instead.`,
                },
            });
        }
    }

    try {
        const { data: lorebookData, metadata } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            false,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);

        const results = [];
        for (const item of items) {
            const result = upsertLorebookEntryByTitleData(lorebookData, {
                title: String(item.title || '').trim(),
                content: item.content != null ? String(item.content) : '',
                defaults: item.defaults || {},
                metadataUpdates: item.metadataUpdates || {},
                entryOverrides: item.entryOverrides || {},
            });
            results.push(result);
        }

        await request.activeSessionOperation?.assertAllowed();
        const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
        return response.send({
            ok: true,
            lorebookName: savedMetadata.name,
            storage: savedMetadata.storage,
            results,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});
