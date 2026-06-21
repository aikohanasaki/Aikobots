import express from 'express';
import { resolveSqliteLogicalChatReference } from './chats.js';
import { stableHashString } from '../../public/scripts/hashing.js';

import {
    applyLorebookSettings,
    createManagedLorebookEntryData,
    getNextManagedMemorySequenceNumber,
    parseSequenceFromTitle,
    compileScene,
} from '../../public/scripts/stmb-core.js';
import {
    createManagedSummaryEntryData,
    getNextSummaryNumber,
    migrateLorebookSummarySchema,
    getSummaryTierLabel,
    verifySummarySourceFingerprints,
} from '../../public/scripts/stmb-summary.js';
import {
    getLorebookForManagement,
    LorebookRepositoryError,
    saveLorebookForManagement,
} from '../lorebook-repository.js';
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
        },
        {
            skipSystemMessages: normalizedRequest.skipSystemMessages,
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

    return {
        lorebookName,
        storage: normalizeStorage(request.body?.storage),
    };
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
            });
            Object.assign(entry, entryPayload);
            applyLorebookSettings(entry, summaryEntrySettings, {
                orderNumber: nextSummaryNumber,
                orderNumberLabel: getSummaryTierLabel(targetTier).toLowerCase(),
                onOrderClamped: notification => orderClampNotifications.push(notification),
            });

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
