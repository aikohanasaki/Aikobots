import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { createMacroState, evaluatePromptMacros } from '../prompting/macro-evaluator.js';
import { handleChatCompletionsGenerate } from './backends/chat-completions.js';
import { resolveLogicalChatReference } from './chats.js';
import { getAllUserHandles, getUserDirectories } from '../users.js';

import {
    applyLorebookSettings,
    createManagedLorebookEntryData,
    getNextManagedMemorySequenceNumber,
    getPresetPrompt,
    identifyManagedMemoryEntries,
    parseSequenceFromTitle,
    compiledSceneToText,
    compileScene,
    parseStructuredMemoryResponse,
} from '../../public/scripts/stmb-core.js';
import {
    buildBriefsFromEntries,
    buildSummaryAnalysisPrompt,
    createManagedSummaryEntryData,
    getNextSummaryNumber,
    migrateLorebookSummarySchema,
    parseSummaryJsonResponse,
    getSummaryTierLabel,
} from '../../public/scripts/stmb-summary.js';
import {
    getLorebookForManagement,
    LorebookRepositoryError,
    saveLorebookForManagement,
} from '../lorebook-repository.js';

export const router = express.Router();

const promptStateModuleMap = {
    summary: '1_memory',
    authorsNote: '2_floating_prompt',
    vectorsMemory: '3_vectors',
    vectorsDataBank: '4_vectors_data_bank',
    smartContext: 'chromadb',
};

const STMB_METADATA_KEY = 'STMemoryBooks';
const STMB_WAVE_PLANNER_FILE = 'stmb-wave-planner.json';
const STMB_WAVE_PLANNER_VERSION = 1;
const STMB_PLANNER_MAX_HISTORY = 200;
const stmbPlannerQueues = new Map();
const activePlannerRuns = new Map();
let plannerWorkerStarted = false;
let plannerWorkerTickActive = false;

function getPlannerFilePath(directories) {
    return path.join(directories.root, STMB_WAVE_PLANNER_FILE);
}

function createEmptyPlannerDoc() {
    return {
        version: STMB_WAVE_PLANNER_VERSION,
        waves: [],
        jobs: [],
    };
}

function readPlannerDoc(directories) {
    const filePath = getPlannerFilePath(directories);
    if (!fs.existsSync(filePath)) {
        return createEmptyPlannerDoc();
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            version: STMB_WAVE_PLANNER_VERSION,
            waves: Array.isArray(parsed?.waves) ? parsed.waves : [],
            jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [],
        };
    } catch (error) {
        console.warn('[STMB Planner] Failed to read planner document, resetting.', error);
        return createEmptyPlannerDoc();
    }
}

function writePlannerDoc(directories, document) {
    const filePath = getPlannerFilePath(directories);
    writeFileAtomicSync(filePath, JSON.stringify(document, null, 2), 'utf8');
}

async function withPlannerDocument(user, mutate) {
    const handle = String(user?.profile?.handle || '');
    const previous = stmbPlannerQueues.get(handle) || Promise.resolve();
    const operation = previous
        .catch(() => {})
        .then(async () => {
            const document = readPlannerDoc(user.directories);
            const result = await mutate(document);
            trimPlannerHistory(document);
            writePlannerDoc(user.directories, document);
            return result;
        });

    stmbPlannerQueues.set(handle, operation.finally(() => {
        if (stmbPlannerQueues.get(handle) === operation) {
            stmbPlannerQueues.delete(handle);
        }
    }));

    return operation;
}

function trimPlannerHistory(document) {
    const terminalStatuses = new Set(['completed', 'failed', 'canceled']);
    const terminalJobs = document.jobs.filter(job => terminalStatuses.has(String(job?.status || '')));
    if (terminalJobs.length <= STMB_PLANNER_MAX_HISTORY) {
        return;
    }

    terminalJobs.sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0));
    const keepIds = new Set(terminalJobs.slice(0, STMB_PLANNER_MAX_HISTORY).map(job => String(job.id)));
    document.jobs = document.jobs.filter(job => !terminalStatuses.has(String(job?.status || '')) || keepIds.has(String(job.id)));
    const remainingJobIds = new Set(document.jobs.map(job => String(job.id)));
    document.waves = document.waves
        .map(wave => ({
            ...wave,
            jobIds: Array.isArray(wave?.jobIds) ? wave.jobIds.filter(jobId => remainingJobIds.has(String(jobId))) : [],
        }))
        .filter(wave => wave.jobIds.length > 0);
}

function makePlannerUser(handle) {
    const normalizedHandle = String(handle || '').trim();
    return {
        profile: {
            handle: normalizedHandle,
            name: normalizedHandle || 'User',
            admin: false,
            enabled: true,
        },
        directories: getUserDirectories(normalizedHandle),
    };
}

function buildPlannerChatKey(sceneContext = {}) {
    if (sceneContext?.chatRef?.type === 'group') {
        return `group:${String(sceneContext?.groupId || '')}:${String(sceneContext?.chatId || sceneContext?.chatRef?.chatId || '')}`;
    }

    return `character:${String(sceneContext?.chatId || sceneContext?.chatRef?.fileName || '')}`;
}

function buildPlannerChatStateSnapshot(sceneContext = {}, state = {}) {
    return {
        sceneContext: structuredClone(sceneContext),
        state: structuredClone(state || {}),
        chatKey: buildPlannerChatKey(sceneContext),
    };
}

function readJsonlLines(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return [];
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) {
        return [];
    }

    return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
}

function serializeJsonlLines(items) {
    return items.map(item => JSON.stringify(item)).join('\n');
}

function normalizeStoredStmbState(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return structuredClone(value);
}

function readChatMetadataState(user, sceneContext = {}) {
    if (sceneContext?.chatRef?.type === 'group') {
        const groupId = String(sceneContext?.groupId || '').trim();
        const chatId = String(sceneContext?.chatId || sceneContext?.chatRef?.chatId || '').trim();
        if (!groupId) {
            return {};
        }

        const groupPath = path.join(user.directories.groups, `${groupId}.json`);
        if (!fs.existsSync(groupPath)) {
            return {};
        }

        const group = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
        const pastMetadata = group?.past_metadata?.[chatId];
        const activeMetadata = String(group?.chat_id || '') === chatId ? group?.chat_metadata : null;
        return normalizeStoredStmbState((pastMetadata || activeMetadata || {})[STMB_METADATA_KEY]);
    }

    const logicalChat = resolveLogicalChatReference(user.directories, sceneContext.chatRef);
    const headerState = logicalChat?.header?.chat_metadata?.[STMB_METADATA_KEY];
    return normalizeStoredStmbState(headerState);
}

function updateChatMetadataState(user, sceneContext = {}, updater) {
    if (typeof updater !== 'function') {
        return {};
    }

    if (sceneContext?.chatRef?.type === 'group') {
        const groupId = String(sceneContext?.groupId || '').trim();
        const chatId = String(sceneContext?.chatId || sceneContext?.chatRef?.chatId || '').trim();
        const groupPath = path.join(user.directories.groups, `${groupId}.json`);
        if (!groupId || !fs.existsSync(groupPath)) {
            return {};
        }

        const group = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
        if (!group.chat_metadata || typeof group.chat_metadata !== 'object') {
            group.chat_metadata = {};
        }
        if (!group.past_metadata || typeof group.past_metadata !== 'object') {
            group.past_metadata = {};
        }

        const sourceMetadata = normalizeStoredStmbState(
            (group.past_metadata?.[chatId] || (String(group?.chat_id || '') === chatId ? group.chat_metadata : {}))[STMB_METADATA_KEY],
        );
        const nextState = normalizeStoredStmbState(updater(sourceMetadata) ?? sourceMetadata);
        const nextMetadata = {
            ...(group.past_metadata?.[chatId] || (String(group?.chat_id || '') === chatId ? group.chat_metadata : {})),
            [STMB_METADATA_KEY]: nextState,
        };

        group.past_metadata[chatId] = nextMetadata;
        if (String(group?.chat_id || '') === chatId) {
            group.chat_metadata = nextMetadata;
        }

        writeFileAtomicSync(groupPath, JSON.stringify(group, null, 4), 'utf8');
        return nextState;
    }

    const logicalChat = resolveLogicalChatReference(user.directories, sceneContext.chatRef);
    const filePath = logicalChat?.filePath;
    const records = readJsonlLines(filePath);
    if (records.length === 0) {
        return {};
    }

    const header = records[0];
    if (!header.chat_metadata || typeof header.chat_metadata !== 'object') {
        header.chat_metadata = {};
    }
    const nextState = normalizeStoredStmbState(updater(normalizeStoredStmbState(header.chat_metadata[STMB_METADATA_KEY])) ?? header.chat_metadata[STMB_METADATA_KEY]);
    header.chat_metadata[STMB_METADATA_KEY] = nextState;
    records[0] = header;
    writeFileAtomicSync(filePath, serializeJsonlLines(records), 'utf8');
    return nextState;
}

function createInternalPlannerRequest(user, headers = {}) {
    const request = new EventEmitter();
    request.user = user;
    request.headers = headers;
    request.socket = new EventEmitter();
    return request;
}

async function forwardChatCompletionGenerateForUser(user, generateData, jobId = null) {
    const request = createInternalPlannerRequest(user);
    if (jobId) {
        activePlannerRuns.set(String(jobId), request);
    }

    try {
        return await forwardChatCompletionGenerate(request, generateData);
    } finally {
        if (jobId) {
            activePlannerRuns.delete(String(jobId));
        }
    }
}

function sendStmbError(response, error) {
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

class InternalResponseSink {
    constructor() {
        this.statusCode = 200;
        this.headers = new Map();
        this.body = undefined;
        this.headersSent = false;
        this.writableEnded = false;
    }

    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), value);
        return this;
    }

    getHeader(name) {
        return this.headers.get(String(name).toLowerCase());
    }

    status(code) {
        this.statusCode = Number(code) || 200;
        return this;
    }

    send(payload) {
        this.body = payload;
        this.headersSent = true;
        this.writableEnded = true;
        return this;
    }

    json(payload) {
        return this.send(payload);
    }

    sendStatus(code) {
        this.statusCode = Number(code) || 500;
        this.headersSent = true;
        this.writableEnded = true;
        this.body = undefined;
        return this;
    }

    write(payload) {
        this.headersSent = true;
        if (payload !== undefined) {
            this.body = this.body === undefined ? payload : `${String(this.body)}${String(payload)}`;
        }
        return true;
    }

    end(payload) {
        if (payload !== undefined && this.body === undefined) {
            this.body = payload;
        }
        this.headersSent = true;
        this.writableEnded = true;
        return this;
    }
}

class InternalSocketSink extends EventEmitter {
    removeAllListeners(eventName) {
        return super.removeAllListeners(eventName);
    }
}

async function forwardChatCompletionGenerate(request, generateData) {
    const internalRequest = Object.create(request);
    internalRequest.body = structuredClone(generateData);
    internalRequest.user = request.user;
    internalRequest.headers = request.headers;
    const socket = new InternalSocketSink();
    const emitClose = () => socket.emit('close');
    const outerSocket = request.socket;
    request.once('aborted', emitClose);
    outerSocket?.once?.('close', emitClose);
    internalRequest.socket = socket;

    const sink = new InternalResponseSink();
    try {
        await handleChatCompletionsGenerate(internalRequest, sink);
        const hasPayloadError = Boolean(sink.body && typeof sink.body === 'object' && !Array.isArray(sink.body) && sink.body.error);
        const effectiveStatus = hasPayloadError
            ? (sink.body?.quota_error ? 429 : (sink.statusCode >= 400 ? sink.statusCode : 502))
            : sink.statusCode;

        return {
            ok: !hasPayloadError && effectiveStatus >= 200 && effectiveStatus < 300,
            status: effectiveStatus,
            data: sink.body,
        };
    } finally {
        request.off('aborted', emitClose);
        outerSocket?.off?.('close', emitClose);
    }
}

function sendForwardedFailure(response, forwarded) {
    return response.status(forwarded.status || 500).send(
        forwarded.data || {
            error: {
                type: 'StmbGenerationFailed',
                message: 'Failed to generate STMB response.',
            },
        },
    );
}

function extractTextFromProviderResponse(payload) {
    if (typeof payload === 'string') {
        return payload;
    }
    if (!payload || typeof payload !== 'object') {
        return String(payload ?? '');
    }

    const choiceContent = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
    if (typeof choiceContent === 'string') {
        return choiceContent;
    }
    if (Array.isArray(choiceContent)) {
        return choiceContent
            .map(part => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                return '';
            })
            .join('');
    }

    const claudeContent = payload?.content;
    if (Array.isArray(claudeContent)) {
        return claudeContent
            .map(part => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                return '';
            })
            .join('');
    }

    const geminiParts = payload?.candidates?.[0]?.content?.parts;
    if (Array.isArray(geminiParts)) {
        return geminiParts
            .map(part => typeof part?.text === 'string' ? part.text : '')
            .join('');
    }

    return '';
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
    return resolveLogicalChatReference(request.user.directories, chatRef);
}

function resolveCapturedScene(request, normalizedRequest) {
    const chatState = resolveStmbChatState(request, normalizedRequest.chatRef);
    const totalLogicalMessages = Number(chatState?.totalMessages) || 0;

    if (totalLogicalMessages === 0) {
        throw createStmbRequestError(400, 'StmbNoMessages', 'There are no messages in this chat yet.', {
            totalLogicalMessages,
            lastAvailableMessageId: -1,
            storageMode: chatState?.storageMode,
            storageHealthy: chatState?.storageHealthy,
        });
    }

    if (!Number.isInteger(normalizedRequest.sceneStart) || !Number.isInteger(normalizedRequest.sceneEnd)) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'sceneStart and sceneEnd are required.');
    }

    if (normalizedRequest.sceneStart < 0 || normalizedRequest.sceneEnd < 0 || normalizedRequest.sceneStart > normalizedRequest.sceneEnd) {
        throw createStmbRequestError(400, 'StmbInvalidRange', 'Start message cannot be greater than end message.');
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

async function saveManagedMemoryForUser(user, {
    lorebookName,
    storage = null,
    memoryObject,
    sceneContext,
    profile = {},
}) {
    const { data: lorebookData, metadata } = await getLorebookForManagement(
        user,
        lorebookName,
        true,
        storage,
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

    const savedMetadata = await saveLorebookForManagement(user, metadata.name, lorebookData, metadata.storage);
    return {
        lorebookName: savedMetadata.name,
        storage: savedMetadata.storage,
        entry,
        sequenceNumber,
        orderClampNotifications,
    };
}

async function upsertLorebookEntryByTitleForUser(user, {
    lorebookName,
    storage = null,
    title,
    content = '',
    defaults = {},
    metadataUpdates = {},
    entryOverrides = {},
}) {
    const { data: lorebookData, metadata } = await getLorebookForManagement(
        user,
        lorebookName,
        true,
        storage,
    );
    ensureEntriesObject(lorebookData);

    const { created, entry } = upsertLorebookEntryByTitleData(lorebookData, {
        title,
        content,
        defaults,
        metadataUpdates,
        entryOverrides,
    });

    const savedMetadata = await saveLorebookForManagement(user, metadata.name, lorebookData, metadata.storage);
    return {
        lorebookName: savedMetadata.name,
        storage: savedMetadata.storage,
        created,
        entry,
    };
}

function buildPlannerWaveStatus(document, wave) {
    const jobs = (Array.isArray(wave?.jobIds) ? wave.jobIds : [])
        .map(jobId => document.jobs.find(job => String(job.id) === String(jobId)))
        .filter(Boolean);
    if (jobs.some(job => job.status === 'running')) return 'running';
    if (jobs.some(job => job.status === 'pending')) return 'pending';
    if (jobs.every(job => job.status === 'completed')) return 'completed';
    if (jobs.some(job => job.status === 'failed')) return 'failed';
    if (jobs.every(job => job.status === 'canceled')) return 'canceled';
    return 'pending';
}

function refreshPlannerWaveStatuses(document) {
    document.waves = document.waves.map(wave => ({
        ...wave,
        status: buildPlannerWaveStatus(document, wave),
        updatedAt: Date.now(),
    }));
}

function ensurePlannerWorker() {
    if (plannerWorkerStarted) {
        return;
    }

    plannerWorkerStarted = true;
    setInterval(() => {
        processPlannerJobs().catch(error => {
            console.error('[STMB Planner] Worker tick failed', error);
        });
    }, 1500).unref?.();

    setTimeout(() => {
        processPlannerJobs().catch(error => {
            console.error('[STMB Planner] Initial worker tick failed', error);
        });
    }, 100);
}

async function enqueuePlannerWave(user, payload = {}) {
    const sceneContext = payload?.sceneContext && typeof payload.sceneContext === 'object'
        ? structuredClone(payload.sceneContext)
        : null;
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const source = String(payload?.source || 'manual');
    if (!sceneContext || jobs.length === 0) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'sceneContext and at least one job are required.');
    }

    const waveId = randomUUID();
    const now = Date.now();
    const chatKey = buildPlannerChatKey(sceneContext);

    const enqueueResult = await withPlannerDocument(user, async document => {
        const wave = {
            id: waveId,
            chatKey,
            source,
            createdAt: now,
            updatedAt: now,
            status: 'pending',
            sceneContext: structuredClone(sceneContext),
            jobIds: [],
        };

        for (const jobSpec of jobs) {
            const dedupeKey = String(jobSpec?.dedupeKey || '').trim();
            if (!dedupeKey) {
                continue;
            }

            const existing = document.jobs.find(job =>
                String(job?.dedupeKey || '') === dedupeKey
                && ['pending', 'running'].includes(String(job?.status || '')),
            );
            if (existing) {
                wave.jobIds.push(existing.id);
                continue;
            }

            const jobId = randomUUID();
            const job = {
                id: jobId,
                waveId,
                chatKey,
                kind: String(jobSpec?.kind || ''),
                dedupeKey,
                source,
                status: 'pending',
                createdAt: now,
                updatedAt: now,
                sceneContext: structuredClone(sceneContext),
                payload: structuredClone(jobSpec?.payload || {}),
                result: null,
                error: null,
            };
            document.jobs.push(job);
            wave.jobIds.push(jobId);
        }

        document.waves.push(wave);
        refreshPlannerWaveStatuses(document);
        return {
            wave,
            jobs: wave.jobIds
                .map(jobId => document.jobs.find(job => String(job.id) === String(jobId)))
                .filter(Boolean),
        };
    });

    ensurePlannerWorker();
    return enqueueResult;
}

async function listPlannerState(user, chatKey = null) {
    return withPlannerDocument(user, async document => {
        refreshPlannerWaveStatuses(document);
        const normalizedChatKey = chatKey ? String(chatKey) : null;
        return {
            waves: document.waves.filter(wave => !normalizedChatKey || String(wave.chatKey) === normalizedChatKey),
            jobs: document.jobs.filter(job => !normalizedChatKey || String(job.chatKey) === normalizedChatKey),
        };
    });
}

async function cancelPlannerJobs(user, {
    chatKey = null,
    waveId = null,
    all = false,
} = {}) {
    return withPlannerDocument(user, async document => {
        const normalizedChatKey = chatKey ? String(chatKey) : null;
        const normalizedWaveId = waveId ? String(waveId) : null;
        let canceled = 0;

        for (const job of document.jobs) {
            if (!['pending', 'running'].includes(String(job?.status || ''))) {
                continue;
            }
            if (!all && normalizedChatKey && String(job.chatKey) !== normalizedChatKey) {
                continue;
            }
            if (!all && normalizedWaveId && String(job.waveId) !== normalizedWaveId) {
                continue;
            }
            if (!all && !normalizedChatKey && !normalizedWaveId) {
                continue;
            }
            job.status = 'canceled';
            job.updatedAt = Date.now();
            job.error = { message: 'Canceled by user.' };
            const activeRun = activePlannerRuns.get(String(job.id));
            activeRun?.emit?.('aborted');
            activeRun?.socket?.emit?.('close');
            canceled++;
        }

        refreshPlannerWaveStatuses(document);
        return { canceled };
    });
}

async function executePlannerMemoryJob(user, job) {
    const forwarded = await forwardChatCompletionGenerateForUser(user, job.payload.generateData, job.id);
    if (!forwarded.ok) {
        throw createStmbRequestError(forwarded.status || 500, 'StmbGenerationFailed', 'Failed to generate STMB memory.', {
            providerBody: forwarded.data,
        });
    }

    const memory = parseStructuredMemoryResponse(forwarded.data);
    const saveResult = await saveManagedMemoryForUser(user, {
        lorebookName: job.payload.lorebookName,
        storage: job.payload.storage,
        memoryObject: memory,
        sceneContext: job.payload.sceneSaveContext,
        profile: job.payload.profile || {},
    });

    updateChatMetadataState(user, job.sceneContext, currentState => {
        const nextState = { ...currentState };
        nextState.highestMemoryProcessed = Number(job.payload.range?.sceneEnd);
        delete nextState.highestMemoryProcessedManuallySet;
        if (job.payload.keepSceneMarkers !== true && job.payload.autoClearSceneAfterMemory !== false) {
            nextState.sceneStart = null;
            nextState.sceneEnd = null;
        }
        return nextState;
    });

    return {
        type: 'memory',
        lorebookName: saveResult.lorebookName,
        entryUid: saveResult.entry?.uid ?? null,
        highestProcessed: Number(job.payload.range?.sceneEnd),
    };
}

async function executePlannerSidePromptJob(user, job) {
    const forwarded = await forwardChatCompletionGenerateForUser(user, job.payload.generateData, job.id);
    if (!forwarded.ok) {
        throw createStmbRequestError(forwarded.status || 500, 'StmbGenerationFailed', 'Failed to generate STMB side prompt.', {
            providerBody: forwarded.data,
        });
    }

    const text = extractTextFromProviderResponse(forwarded.data).trim();
    if (!text) {
        return {
            type: 'sidePrompt',
            blank: true,
            title: String(job.payload.title || ''),
        };
    }

    const saveResult = await upsertLorebookEntryByTitleForUser(user, {
        lorebookName: job.payload.lorebookName,
        storage: job.payload.storage,
        title: job.payload.title,
        content: text,
        defaults: job.payload.defaults || {},
        metadataUpdates: job.payload.metadataUpdates || {},
        entryOverrides: job.payload.entryOverrides || {},
    });

    return {
        type: 'sidePrompt',
        title: String(job.payload.title || ''),
        entryUid: saveResult.entry?.uid ?? null,
    };
}

async function executePlannerJob(user, job) {
    if (job.kind === 'memory') {
        return executePlannerMemoryJob(user, job);
    }
    if (job.kind === 'sidePrompt') {
        return executePlannerSidePromptJob(user, job);
    }
    throw new Error(`Unsupported planner job kind "${job.kind}"`);
}

async function claimNextPlannerJob(user) {
    return withPlannerDocument(user, async document => {
        const runningChats = new Set(
            document.jobs
                .filter(job => String(job?.status || '') === 'running')
                .map(job => String(job.chatKey || '')),
        );
        const nextJob = document.jobs.find(job => String(job?.status || '') === 'pending' && !runningChats.has(String(job.chatKey || '')));
        if (!nextJob) {
            return null;
        }

        nextJob.status = 'running';
        nextJob.updatedAt = Date.now();
        refreshPlannerWaveStatuses(document);
        return structuredClone(nextJob);
    });
}

async function settlePlannerJob(user, jobId, updater) {
    return withPlannerDocument(user, async document => {
        const job = document.jobs.find(candidate => String(candidate.id) === String(jobId));
        if (!job) {
            return null;
        }
        if (String(job.status || '') === 'canceled') {
            refreshPlannerWaveStatuses(document);
            return structuredClone(job);
        }
        updater(job);
        job.updatedAt = Date.now();
        refreshPlannerWaveStatuses(document);
        return structuredClone(job);
    });
}

async function processPlannerJobs() {
    if (plannerWorkerTickActive) {
        return;
    }

    plannerWorkerTickActive = true;
    try {
        const handles = await getAllUserHandles();
        for (const handle of handles) {
            const user = makePlannerUser(handle);
            const nextJob = await claimNextPlannerJob(user);
            if (!nextJob) {
                continue;
            }

            try {
                const result = await executePlannerJob(user, nextJob);
                await settlePlannerJob(user, nextJob.id, job => {
                    job.status = 'completed';
                    job.result = result;
                    job.error = null;
                });
            } catch (error) {
                console.error('[STMB Planner] Job failed', nextJob.id, error);
                await settlePlannerJob(user, nextJob.id, job => {
                    job.status = 'failed';
                    job.error = {
                        message: String(error?.message || error),
                        type: String(error?.type || error?.name || 'StmbPlannerJobError'),
                    };
                });
            }
        }
    } finally {
        plannerWorkerTickActive = false;
    }
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

function inflatePromptState(promptState = {}, quietPrompt = '') {
    const extensionPrompts = {};

    for (const [moduleKey, legacyKey] of Object.entries(promptStateModuleMap)) {
        if (!promptState?.modules?.[moduleKey]) {
            continue;
        }

        extensionPrompts[legacyKey] = {
            key: legacyKey,
            value: String(promptState.modules[moduleKey]?.value ?? ''),
            position: promptState.modules[moduleKey]?.position,
            depth: promptState.modules[moduleKey]?.depth,
            scan: Boolean(promptState.modules[moduleKey]?.scan),
            role: Number(promptState.modules[moduleKey]?.role ?? 0),
        };
    }

    for (const prompt of Array.isArray(promptState?.prompts) ? promptState.prompts : []) {
        const key = String(prompt?.key || '');
        if (!key) {
            continue;
        }

        extensionPrompts[key] = {
            key,
            value: String(prompt?.value ?? ''),
            position: prompt?.position,
            depth: prompt?.depth,
            scan: Boolean(prompt?.scan),
            role: Number(prompt?.role ?? 0),
        };
    }

    extensionPrompts.QUIET_PROMPT = {
        key: 'QUIET_PROMPT',
        value: String(quietPrompt || ''),
        position: 0,
        depth: 0,
        scan: true,
        role: 0,
    };

    return extensionPrompts;
}

function runtimeMacroEnv(runtimeMacros = {}) {
    const env = {};
    for (const [token, value] of Object.entries(runtimeMacros || {})) {
        if (typeof token !== 'string' || !token.startsWith('{{') || !token.endsWith('}}')) {
            continue;
        }
        env[token.slice(2, -2)] = value ?? '';
    }
    return env;
}

function resolvePromptMacros(content, { macroSnapshot = {}, promptState = {}, runtimeMacros = {} } = {}) {
    const extensionPrompts = inflatePromptState(promptState || {}, '');
    const macroState = createMacroState(macroSnapshot || {}, extensionPrompts);
    return evaluatePromptMacros(String(content || ''), runtimeMacroEnv(runtimeMacros), { macroState });
}

function buildContextMemoriesSection(worldInfo, count) {
    if (!worldInfo?.entries || count <= 0) {
        return '';
    }

    const recentEntries = identifyManagedMemoryEntries(worldInfo.entries).slice(-count);
    if (recentEntries.length === 0) {
        return '';
    }

    const lines = ['=== PREVIOUS MEMORIES ==='];
    for (const entry of recentEntries) {
        lines.push(`${entry.comment || 'Memory'}\n${entry.content || ''}`);
    }
    lines.push('');
    return lines.join('\n');
}

function buildMemoryPromptMessages(compiledScene, profile, worldInfo, stmbSettings = {}) {
    const promptText = buildMemoryPromptText(compiledScene, profile, worldInfo, stmbSettings);
    return [{ role: 'user', content: promptText }];
}

function buildMemoryPromptText(compiledScene, profile, worldInfo, stmbSettings = {}) {
    const basePrompt = typeof profile?.promptText === 'string' && profile.promptText.trim()
        ? profile.promptText
        : getPresetPrompt(stmbSettings, profile?.preset);
    const presetPrompt = basePrompt
        .replace(/\{\{user\}\}/g, String(compiledScene?.metadata?.userName || 'User'))
        .replace(/\{\{char\}\}/g, String(compiledScene?.metadata?.characterName || 'Character'));
    const memoryCount = Number(stmbSettings?.moduleSettings?.defaultMemoryCount) || 0;
    const previousMemories = fetchPreviousMemories(worldInfo, memoryCount);
    const messageLines = Array.isArray(compiledScene?.messages)
        ? compiledScene.messages
            .map(message => {
                const speaker = String(message?.name || 'Unknown').trim() || 'Unknown';
                const content = String(message?.mes || '').trim();
                return content ? `${speaker}: ${content}` : null;
            })
            .filter(Boolean)
        : [];
    const sceneLines = [];

    if (previousMemories.length > 0) {
        sceneLines.push('=== PREVIOUS SCENE CONTEXT (DO NOT SUMMARIZE) ===');
        sceneLines.push('These are previous memories for context only. Do NOT include them in your new memory:');
        sceneLines.push('');
        previousMemories.forEach((memory, index) => {
            sceneLines.push(`Context ${index + 1} - ${memory.title || 'Memory'}:`);
            sceneLines.push(String(memory.content || ''));
            if (Array.isArray(memory.keywords) && memory.keywords.length > 0) {
                sceneLines.push(`Keywords: ${memory.keywords.join(', ')}`);
            }
            sceneLines.push('');
        });
        sceneLines.push('=== END PREVIOUS SCENE CONTEXT - SUMMARIZE ONLY THE SCENE BELOW ===');
        sceneLines.push('');
    }

    sceneLines.push('=== SCENE TRANSCRIPT ===');
    sceneLines.push(...messageLines);
    sceneLines.push('');
    sceneLines.push('=== END SCENE ===');

    return `${presetPrompt}\n\n${sceneLines.join('\n')}`;
}

function findFirstLoreEntryByTitle(lorebookData, titles = []) {
    const entries = Object.values(lorebookData?.entries || {});
    for (const title of titles) {
        const found = entries.find(entry => String(entry?.comment || '') === title);
        if (found) return found;
    }
    return null;
}

function fetchPreviousMemories(lorebookData, count) {
    if (!Number.isFinite(Number(count)) || Number(count) <= 0) return [];
    return identifyManagedMemoryEntries(lorebookData?.entries || {})
        .slice(-Math.max(0, Math.min(7, Math.trunc(Number(count)))))
        .map(entry => ({
            title: entry.comment || 'Memory',
            content: entry.content || '',
            keywords: Array.isArray(entry.key) ? entry.key : [],
        }));
}

function buildSidePromptText(templatePrompt, priorContent, compiledScene, responseFormat, previousMemories = []) {
    const parts = [];
    parts.push(String(templatePrompt || ''));
    if (priorContent && String(priorContent).trim()) {
        parts.push('\n=== PRIOR ENTRY ===\n');
        parts.push(String(priorContent));
    }
    if (previousMemories.length > 0) {
        parts.push('\n=== PREVIOUS SCENE CONTEXT (DO NOT SUMMARIZE) ===\n');
        parts.push('These are previous memories for context only. Do NOT include them in your new output.\n\n');
        previousMemories.forEach((memory, index) => {
            parts.push(`Context ${index + 1} - ${memory.title || 'Memory'}:\n`);
            parts.push(`${memory.content || ''}\n`);
            if (Array.isArray(memory.keywords) && memory.keywords.length > 0) {
                parts.push(`Keywords: ${memory.keywords.join(', ')}\n`);
            }
            parts.push('\n');
        });
        parts.push('=== END PREVIOUS SCENE CONTEXT ===\n');
    }
    parts.push('\n=== SCENE TEXT ===\n');
    parts.push(compiledSceneToText(compiledScene));
    if (responseFormat && String(responseFormat).trim()) {
        parts.push('\n=== RESPONSE FORMAT ===\n');
        parts.push(String(responseFormat).trim());
    }
    return parts.join('');
}

router.post('/chat-range-info', async (request, response) => {
    try {
        const normalizedRequest = normalizeRangeInfoRequest(request.body);
        const chatState = resolveStmbChatState(request, normalizedRequest.chatRef);
        const totalLogicalMessages = Number(chatState?.totalMessages) || 0;
        const lastAvailableMessageId = Number.isInteger(chatState?.lastAvailableMessageId)
            ? chatState.lastAvailableMessageId
            : -1;

        if (normalizedRequest.rangeStart !== null && (!Number.isInteger(normalizedRequest.rangeStart) || normalizedRequest.rangeStart < 0)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'rangeStart must be a non-negative integer.');
        }
        if (normalizedRequest.rangeEnd !== null && (!Number.isInteger(normalizedRequest.rangeEnd) || normalizedRequest.rangeEnd < 0)) {
            throw createStmbRequestError(400, 'StmbBadRequest', 'rangeEnd must be a non-negative integer.');
        }
        if (normalizedRequest.rangeStart !== null && normalizedRequest.rangeEnd !== null && normalizedRequest.rangeStart > normalizedRequest.rangeEnd) {
            throw createStmbRequestError(400, 'StmbInvalidRange', 'Start message cannot be greater than end message.');
        }

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
        const result = resolveCapturedScene(request, normalizedRequest);
        return response.send({
            ok: true,
            compiledScene: result.compiledScene,
            capture: result.capture,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/planner/chat-state', async (request, response) => {
    try {
        const normalizedRequest = normalizeSceneEndpointRequest(request.body?.sceneContext || request.body);
        return response.send({
            ok: true,
            chatKey: buildPlannerChatKey(normalizedRequest),
            state: readChatMetadataState(request.user, normalizedRequest),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/planner/update-chat-state', async (request, response) => {
    try {
        const normalizedRequest = normalizeSceneEndpointRequest(request.body?.sceneContext || request.body);
        const patch = request.body?.patch && typeof request.body.patch === 'object' ? request.body.patch : {};
        const nextState = updateChatMetadataState(request.user, normalizedRequest, currentState => ({
            ...currentState,
            ...patch,
        }));
        return response.send({
            ok: true,
            chatKey: buildPlannerChatKey(normalizedRequest),
            state: nextState,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/planner/enqueue-wave', async (request, response) => {
    try {
        const sceneContext = request.body?.sceneContext && typeof request.body.sceneContext === 'object'
            ? request.body.sceneContext
            : null;
        const result = await enqueuePlannerWave(request.user, {
            sceneContext,
            jobs: Array.isArray(request.body?.jobs) ? request.body.jobs : [],
            source: request.body?.source || 'manual',
        });
        return response.send({
            ok: true,
            wave: result.wave,
            jobs: result.jobs,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/planner/list-jobs', async (request, response) => {
    try {
        const normalizedRequest = normalizeSceneEndpointRequest(request.body?.sceneContext || request.body);
        const result = await listPlannerState(
            request.user,
            request.body?.sceneContext ? buildPlannerChatKey(normalizedRequest) : null,
        );
        return response.send({
            ok: true,
            ...result,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/planner/cancel', async (request, response) => {
    try {
        const normalizedRequest = normalizeSceneEndpointRequest(request.body?.sceneContext || request.body);
        const result = await cancelPlannerJobs(request.user, {
            all: request.body?.all === true,
            waveId: request.body?.waveId || null,
            chatKey: request.body?.sceneContext ? buildPlannerChatKey(normalizedRequest) : null,
        });
        return response.send({
            ok: true,
            ...result,
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/prepare-memory-messages', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const compiledScene = request.body?.compiledScene;
    const profile = request.body?.profile || {};
    const stmbSettings = request.body?.stmbSettings || {};

    if (!lorebookContext || !compiledScene || typeof compiledScene !== 'object') {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and compiledScene are required.',
            },
        });
    }

    try {
        const { data: lorebookData } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            true,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);

        return response.send({
            ok: true,
            messages: buildMemoryPromptMessages(compiledScene, profile, lorebookData, stmbSettings),
            promptText: buildMemoryPromptText(compiledScene, profile, lorebookData, stmbSettings),
        });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/prepare-summary-prompt', async (request, response) => {
    const sourceEntries = Array.isArray(request.body?.sourceEntries) ? request.body.sourceEntries : [];
    const previousSummary = request.body?.previousSummary || null;
    const previousOrder = request.body?.previousOrder ?? null;
    const promptText = request.body?.promptText ?? null;
    const targetTier = Number(request.body?.targetTier);

    if (!Number.isFinite(targetTier)) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'targetTier is required.',
            },
        });
    }

    try {
        const prompt = buildSummaryAnalysisPrompt({
            briefs: buildBriefsFromEntries(sourceEntries),
            previousSummary,
            previousOrder,
            promptText,
            targetTier,
        });

        return response.send({ ok: true, prompt });
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/prepare-sideprompt', async (request, response) => {
    const lorebookContext = getLorebookContext(request);
    const compiledScene = request.body?.compiledScene;
    const lookupTitles = Array.isArray(request.body?.lookupTitles) ? request.body.lookupTitles : [];
    const templatePrompt = String(request.body?.templatePrompt || '');
    const responseFormat = String(request.body?.responseFormat || '');
    const previousMemoriesCount = Number(request.body?.previousMemoriesCount ?? 0);
    const runtimeMacros = request.body?.runtimeMacros || {};
    const macroSnapshot = request.body?.macroSnapshot || {};
    const promptState = request.body?.promptState || {};

    if (!lorebookContext || !compiledScene || typeof compiledScene !== 'object') {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and compiledScene are required.',
            },
        });
    }

    try {
        const { data: lorebookData } = await getLorebookForManagement(
            request.user,
            lorebookContext.lorebookName,
            true,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);

        const existing = findFirstLoreEntryByTitle(lorebookData, lookupTitles);
        const previousMemories = fetchPreviousMemories(lorebookData, previousMemoriesCount);
        const resolvedPrompt = resolvePromptMacros(templatePrompt, { macroSnapshot, promptState, runtimeMacros });
        const resolvedResponseFormat = resolvePromptMacros(responseFormat, { macroSnapshot, promptState, runtimeMacros }).trim();
        const finalPrompt = buildSidePromptText(
            resolvedPrompt,
            existing?.content || '',
            compiledScene,
            resolvedResponseFormat,
            previousMemories,
        );

        return response.send({
            ok: true,
            finalPrompt,
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
            true,
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

router.post('/generate-memory', async (request, response) => {
    const generateData = request.body?.generateData;
    if (!generateData || typeof generateData !== 'object') {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'generateData is required.',
            },
        });
    }

    try {
        const forwarded = await forwardChatCompletionGenerate(request, { ...generateData, stream: false });
        if (!forwarded.ok) {
            return sendForwardedFailure(response, forwarded);
        }

        try {
            const memory = parseStructuredMemoryResponse(forwarded.data);
            return response.send({
                ok: true,
                memory,
                providerResponse: forwarded.data,
            });
        } catch (error) {
            return response.status(422).send({
                error: {
                    type: error?.name || 'StmbMemoryParseError',
                    code: error?.code || 'PARSE_FAILED',
                    message: String(error?.message || 'Failed to parse structured memory response.'),
                    rawResponse: typeof error?.rawResponse === 'string' && error.rawResponse
                        ? error.rawResponse
                        : JSON.stringify(forwarded.data ?? {}),
                    providerBody: JSON.stringify(forwarded.data ?? {}),
                },
            });
        }
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/generate-summary', async (request, response) => {
    const generateData = request.body?.generateData;
    if (!generateData || typeof generateData !== 'object') {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'generateData is required.',
            },
        });
    }

    try {
        const forwarded = await forwardChatCompletionGenerate(request, { ...generateData, stream: false });
        if (!forwarded.ok) {
            return sendForwardedFailure(response, forwarded);
        }

        try {
            const parsed = parseSummaryJsonResponse(forwarded.data);
            return response.send({
                ok: true,
                parsed,
                providerResponse: forwarded.data,
            });
        } catch (error) {
            return response.status(422).send({
                error: {
                    type: error?.name || 'StmbSummaryParseError',
                    code: error?.code || 'PARSE_FAILED',
                    message: String(error?.message || 'Failed to parse structured summary response.'),
                    rawResponse: typeof error?.rawResponse === 'string' && error.rawResponse
                        ? error.rawResponse
                        : JSON.stringify(forwarded.data ?? {}),
                    providerBody: JSON.stringify(forwarded.data ?? {}),
                },
            });
        }
    } catch (error) {
        return sendStmbError(response, error);
    }
});

router.post('/generate-text', async (request, response) => {
    const generateData = request.body?.generateData;
    if (!generateData || typeof generateData !== 'object') {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'generateData is required.',
            },
        });
    }

    try {
        const forwarded = await forwardChatCompletionGenerate(request, { ...generateData, stream: false });
        if (!forwarded.ok) {
            return sendForwardedFailure(response, forwarded);
        }

        return response.send({
            ok: true,
            text: extractTextFromProviderResponse(forwarded.data),
            providerResponse: forwarded.data,
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
            true,
            lorebookContext.storage,
        );
        ensureEntriesObject(lorebookData);
        const schemaMigrated = migrateLorebookSummarySchema(lorebookData);

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
            true,
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
            true,
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

ensurePlannerWorker();
