import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { createMacroState, evaluatePromptMacros } from '../prompting/macro-evaluator.js';
import { handleChatCompletionsGenerate } from './backends/chat-completions.js';
import { buildChunkedChatPayload, resolveLogicalChatReference, writeLogicalChat } from './chats.js';
import { getAllUserHandles, getUserDirectories } from '../users.js';

import {
    applyLorebookSettings,
    buildSidePromptCheckpointMetadata,
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
    getDefaultSummaryMinChildren,
    getNextSummaryNumber,
    identifyEligibleSummarySourceEntries,
    migrateLorebookSummarySchema,
    normalizeSummaryMinChildren,
    parseSummaryJsonResponse,
    getSummaryTierLabel,
} from '../../public/scripts/stmb-summary.js';
import {
    getLorebookForManagement,
    LorebookRepositoryError,
    saveLorebookForManagement,
} from '../lorebook-repository.js';
import { runRegexScript, substitute_find_regex } from '../prompting/regex-runtime.js';

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
const STMB_PLANNER_MAX_CONCURRENT_JOBS = 4;
const PLANNER_TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'rejected', 'skipped']);
const PLANNER_BLOCKING_DEPENDENCY_STATUSES = new Set(['failed', 'canceled', 'rejected', 'skipped']);
const stmbPlannerQueues = new Map();
const activePlannerRuns = new Map();
const activePlannerJobExecutions = new Map();
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

function getPlannerJobStatus(job) {
    return String(job?.status || 'pending');
}

function isPlannerTerminalStatus(status) {
    return PLANNER_TERMINAL_STATUSES.has(String(status || ''));
}

function normalizePlannerDependencyList(value) {
    return Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .map(item => String(item || '').trim())
            .filter(Boolean),
    ));
}

function getPlannerJobDefaultPhase(kind) {
    switch (String(kind || '')) {
        case 'memoryGenerate':
            return 'generate';
        case 'memoryApproval':
            return 'approval';
        case 'memoryCommit':
            return 'commit';
        case 'sidePromptGenerate':
            return 'generate';
        case 'sidePromptApproval':
            return 'approval';
        case 'sidePromptCommit':
        case 'chatAutoHide':
        case 'sidePrompt':
        case 'consolidationCheck':
            return 'post_commit';
        case 'memory':
            return 'commit';
        default:
            return 'pending';
    }
}

function normalizePlannerJob(job = {}) {
    return {
        ...job,
        status: getPlannerJobStatus(job),
        phase: String(job?.phase || getPlannerJobDefaultPhase(job?.kind)),
        dependsOn: normalizePlannerDependencyList(job?.dependsOn),
        clientHandledAt: Number.isFinite(Number(job?.clientHandledAt)) ? Number(job.clientHandledAt) : null,
    };
}

function getPlannerJobMap(document) {
    return new Map(
        (Array.isArray(document?.jobs) ? document.jobs : [])
            .map(job => normalizePlannerJob(job))
            .map(job => [String(job.id), job]),
    );
}

function evaluatePlannerDependencyState(document, job) {
    const jobMap = getPlannerJobMap(document);
    const dependencies = normalizePlannerDependencyList(job?.dependsOn);
    if (dependencies.length === 0) {
        return { runnable: true, blocked: false, skip: false };
    }

    let hasPending = false;
    for (const dependencyId of dependencies) {
        const dependency = jobMap.get(String(dependencyId));
        if (!dependency) {
            return { runnable: false, blocked: false, skip: true, reason: `Missing dependency ${dependencyId}` };
        }

        const status = getPlannerJobStatus(dependency);
        if (PLANNER_BLOCKING_DEPENDENCY_STATUSES.has(status)) {
            return { runnable: false, blocked: false, skip: true, reason: `Dependency ${dependencyId} settled as ${status}` };
        }
        if (status !== 'completed') {
            hasPending = true;
        }
    }

    return {
        runnable: !hasPending,
        blocked: hasPending,
        skip: false,
    };
}

function refreshPlannerDependencyStatuses(document) {
    let changed = false;
    for (const job of Array.isArray(document?.jobs) ? document.jobs : []) {
        if (getPlannerJobStatus(job) !== 'pending') {
            continue;
        }

        const dependencyState = evaluatePlannerDependencyState(document, job);
        if (!dependencyState.skip) {
            continue;
        }

        job.status = 'skipped';
        job.phase = String(job?.phase || getPlannerJobDefaultPhase(job?.kind));
        job.updatedAt = Date.now();
        job.error = {
            message: String(dependencyState.reason || 'A dependency did not complete.'),
            type: 'StmbPlannerDependencySkipped',
        };
        changed = true;
    }
    return changed;
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
            jobs: Array.isArray(parsed?.jobs) ? parsed.jobs.map(normalizePlannerJob) : [],
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

async function withPlannerDocument(user, mutate, options = {}) {
    const handle = String(user?.profile?.handle || '');
    const persist = options?.persist !== false;
    const previous = stmbPlannerQueues.get(handle) || Promise.resolve();
    const operation = previous
        .catch(() => {})
        .then(async () => {
            const document = readPlannerDoc(user.directories);
            const result = await mutate(document);
            if (persist) {
                refreshPlannerDependencyStatuses(document);
                trimPlannerHistory(document);
                writePlannerDoc(user.directories, document);
            }
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
    const terminalJobs = document.jobs.filter(job => isPlannerTerminalStatus(job?.status));
    if (terminalJobs.length <= STMB_PLANNER_MAX_HISTORY) {
        return;
    }

    terminalJobs.sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0));
    const keepIds = new Set(terminalJobs.slice(0, STMB_PLANNER_MAX_HISTORY).map(job => String(job.id)));
    document.jobs = document.jobs.filter(job => !isPlannerTerminalStatus(job?.status) || keepIds.has(String(job.id)));
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

    const fileName = String(sceneContext?.chatId || sceneContext?.chatRef?.fileName || '').trim();
    const avatarUrl = String(sceneContext?.chatRef?.avatarUrl || sceneContext?.avatarUrl || '').trim();
    return avatarUrl
        ? `character:${JSON.stringify({ avatarUrl, fileName })}`
        : `character:${fileName}`;
}

function buildPlannerChatKeyAliases(sceneContext = {}) {
    const primaryKey = buildPlannerChatKey(sceneContext);
    const aliases = new Set([primaryKey]);

    if (sceneContext?.chatRef?.type !== 'group') {
        const legacyFileName = String(sceneContext?.chatId || sceneContext?.chatRef?.fileName || '').trim();
        aliases.add(`character:${legacyFileName}`);
    }

    return Array.from(aliases);
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

function isGroupChatHeaderRecord(record) {
    return Boolean(record?.is_group_chat_header === true);
}

function buildGroupChatHeaderRecord(chatMetadata = {}, existingHeader = null) {
    return {
        ...(isGroupChatHeaderRecord(existingHeader) ? existingHeader : {}),
        is_group_chat_header: true,
        group_chat_header_version: Number(existingHeader?.group_chat_header_version || 1),
        create_date: String(existingHeader?.create_date || new Date().toISOString()),
        chat_metadata: chatMetadata && typeof chatMetadata === 'object' ? structuredClone(chatMetadata) : {},
    };
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
        const legacyMetadata = pastMetadata || activeMetadata || {};
        const groupChatPath = path.join(user.directories.groupChats, `${chatId}.jsonl`);
        const records = readJsonlLines(groupChatPath);
        if (records.length > 0 && isGroupChatHeaderRecord(records[0])) {
            return normalizeStoredStmbState(records[0]?.chat_metadata?.[STMB_METADATA_KEY]);
        }

        if (records.length > 0 && legacyMetadata && typeof legacyMetadata === 'object' && Object.keys(legacyMetadata).length > 0) {
            writeLogicalChat(groupChatPath, buildGroupChatHeaderRecord(legacyMetadata), records);
        }

        return normalizeStoredStmbState(legacyMetadata[STMB_METADATA_KEY]);
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

        const groupChatPath = path.join(user.directories.groupChats, `${chatId}.jsonl`);
        const records = readJsonlLines(groupChatPath);
        if (records.length > 0) {
            const existingHeader = isGroupChatHeaderRecord(records[0]) ? records[0] : null;
            const messages = existingHeader ? records.slice(1) : records;
            writeLogicalChat(groupChatPath, buildGroupChatHeaderRecord(nextMetadata, existingHeader), messages);
        }

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
        return await forwardChatCompletionGenerate(request, {
            ...(generateData && typeof generateData === 'object' ? generateData : {}),
            stream: false,
        });
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

function assertPlannerResponseNotTruncated(providerResponse, fallbackText = '') {
    const finishReason = providerResponse?.choices?.[0]?.finish_reason || providerResponse?.finish_reason || providerResponse?.stop_reason;
    const normalizedFinishReason = typeof finishReason === 'string' ? finishReason.toLowerCase() : '';

    if (normalizedFinishReason.includes('length') || normalizedFinishReason.includes('max') || providerResponse?.truncated === true) {
        throw createStmbRequestError(502, 'StmbGenerationFailed', 'Model response appears truncated. Increase Max Response Tokens.', {
            providerBody: fallbackText || providerResponse,
        });
    }
}

function applyPlannerRegexScripts(text, regexScripts = []) {
    let output = String(text || '');

    for (const script of Array.isArray(regexScripts) ? regexScripts : []) {
        output = runRegexScript({
            ...script,
            disabled: false,
            substituteRegex: substitute_find_regex.NONE,
        }, output, {});
    }

    return output;
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
    if (jobs.some(job => getPlannerJobStatus(job) === 'running')) return 'running';
    if (jobs.some(job => getPlannerJobStatus(job) === 'awaiting_approval')) return 'awaiting_approval';
    if (jobs.some(job => getPlannerJobStatus(job) === 'pending')) return 'pending';
    if (jobs.some(job => getPlannerJobStatus(job) === 'failed')) return 'failed';
    if (jobs.some(job => getPlannerJobStatus(job) === 'rejected')) return 'rejected';
    if (jobs.every(job => ['completed', 'skipped'].includes(getPlannerJobStatus(job)))) return 'completed';
    if (jobs.every(job => ['canceled', 'skipped'].includes(getPlannerJobStatus(job)))) return 'canceled';
    return 'pending';
}

function refreshPlannerWaveStatuses(document) {
    refreshPlannerDependencyStatuses(document);
    document.waves = document.waves.map(wave => ({
        ...wave,
        status: buildPlannerWaveStatus(document, wave),
        updatedAt: Date.now(),
    }));
}

function buildPlannerStateView(document, chatKey = null) {
    const snapshot = structuredClone(document);
    refreshPlannerDependencyStatuses(snapshot);
    snapshot.waves = snapshot.waves.map(wave => ({
        ...wave,
        status: buildPlannerWaveStatus(snapshot, wave),
    }));

    const normalizedChatKeys = Array.isArray(chatKey)
        ? new Set(chatKey.map(key => String(key || '')).filter(Boolean))
        : (chatKey ? new Set([String(chatKey)]) : null);
    return {
        waves: snapshot.waves.filter(wave => !normalizedChatKeys || normalizedChatKeys.has(String(wave.chatKey))),
        jobs: snapshot.jobs.filter(job => !normalizedChatKeys || normalizedChatKeys.has(String(job.chatKey))),
    };
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
        const localJobIds = new Map();
        const specsToCreate = [];

        for (const jobSpec of jobs) {
            const dedupeKey = String(jobSpec?.dedupeKey || '').trim();
            const localKey = String(jobSpec?.key || jobSpec?.localKey || '').trim();
            if (!dedupeKey || (localKey && localJobIds.has(localKey))) {
                continue;
            }

            const existing = document.jobs.find(job =>
                String(job?.dedupeKey || '') === dedupeKey
                && ['pending', 'running', 'awaiting_approval'].includes(String(job?.status || '')),
            );
            if (existing) {
                wave.jobIds.push(existing.id);
                if (localKey) {
                    localJobIds.set(localKey, existing.id);
                }
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
                phase: String(jobSpec?.phase || getPlannerJobDefaultPhase(jobSpec?.kind)),
                createdAt: now,
                updatedAt: now,
                sceneContext: structuredClone(sceneContext),
                payload: structuredClone(jobSpec?.payload || {}),
                dependsOn: [],
                result: null,
                error: null,
                approvalRequest: null,
                clientHandledAt: null,
            };
            wave.jobIds.push(jobId);
            if (localKey) {
                localJobIds.set(localKey, jobId);
            }
            specsToCreate.push({ job, jobSpec });
        }

        for (const { job, jobSpec } of specsToCreate) {
            const requestedDependencies = normalizePlannerDependencyList(jobSpec?.dependsOn);
            job.dependsOn = requestedDependencies.map(item => {
                const resolved = localJobIds.get(String(item || '').trim()) || String(item || '').trim();
                const exists = document.jobs.some(candidate => String(candidate.id) === resolved)
                    || specsToCreate.some(candidate => String(candidate.job.id) === resolved);
                if (!exists) {
                    throw createStmbRequestError(400, 'StmbBadRequest', `Unknown planner dependency "${item}".`);
                }
                return resolved;
            });
            document.jobs.push(normalizePlannerJob(job));
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
    return enqueueResult;
}

async function listPlannerState(user, chatKey = null) {
    return withPlannerDocument(user, async document => buildPlannerStateView(document, chatKey), { persist: false });
}

async function cancelPlannerJobs(user, {
    chatKey = null,
    waveId = null,
    all = false,
} = {}) {
    return withPlannerDocument(user, async document => {
        const normalizedChatKeys = Array.isArray(chatKey)
            ? new Set(chatKey.map(key => String(key || '')).filter(Boolean))
            : (chatKey ? new Set([String(chatKey)]) : null);
        const normalizedWaveId = waveId ? String(waveId) : null;
        let canceled = 0;

        for (const job of document.jobs) {
            if (!['pending', 'running', 'awaiting_approval'].includes(String(job?.status || ''))) {
                continue;
            }
            if (!all && normalizedChatKeys && !normalizedChatKeys.has(String(job.chatKey))) {
                continue;
            }
            if (!all && normalizedWaveId && String(job.waveId) !== normalizedWaveId) {
                continue;
            }
            if (!all && !normalizedChatKeys && !normalizedWaveId) {
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
        metadataUpdates: buildPlannerSidePromptMetadataUpdates(job.payload.metadataUpdates, job.payload.commitCheckpoint),
        entryOverrides: job.payload.entryOverrides || {},
    });

    return {
        type: 'sidePrompt',
        title: String(job.payload.title || ''),
        lorebookName: String(job.payload.lorebookName || ''),
        entryUid: saveResult.entry?.uid ?? null,
    };
}

function buildPlannerSidePromptMetadataUpdates(metadataUpdates = {}, commitCheckpoint = null) {
    const baseMetadata = metadataUpdates && typeof metadataUpdates === 'object'
        ? structuredClone(metadataUpdates)
        : {};
    const checkpoint = commitCheckpoint && typeof commitCheckpoint === 'object'
        ? commitCheckpoint
        : null;
    if (!checkpoint?.templateKey) {
        return baseMetadata;
    }

    return {
        ...baseMetadata,
        ...buildSidePromptCheckpointMetadata(checkpoint.templateKey, {
            lastMsgId: checkpoint.lastMsgId ?? null,
            lastRunAt: new Date().toISOString(),
            includeLastMsgId: checkpoint.includeLastMsgId !== false,
            includeTrackerFallback: checkpoint.includeTrackerFallback !== false,
        }),
    };
}

async function executePlannerSidePromptGenerateJob(user, job) {
    const forwarded = await forwardChatCompletionGenerateForUser(user, job.payload.generateData, job.id);
    if (!forwarded.ok) {
        throw createStmbRequestError(forwarded.status || 500, 'StmbGenerationFailed', 'Failed to generate STMB side prompt.', {
            providerBody: forwarded.data,
        });
    }

    const text = extractTextFromProviderResponse(forwarded.data).trim();
    return {
        type: 'sidePromptGenerate',
        blank: !text,
        title: String(job.payload.title || ''),
        text,
        lorebookName: String(job.payload.lorebookName || ''),
    };
}

async function executePlannerSidePromptApprovalJob(user, job) {
    const dependencies = await getPlannerDependencyJobs(user, job);
    const generatedJob = getFirstPlannerDependencyByKind(dependencies, 'sidePromptGenerate');
    const generatedResult = generatedJob?.result || {};

    if (generatedResult.blank) {
        return {
            status: 'completed',
            phase: 'approval',
            result: {
                type: 'sidePromptApproval',
                decision: 'blank',
                blank: true,
                title: String(generatedResult.title || job.payload?.title || ''),
                text: '',
            },
        };
    }

    if (!String(generatedResult.text || '').trim()) {
        throw createStmbRequestError(409, 'StmbPlannerDependencyMissing', 'Side prompt approval is missing generated text.');
    }

    if (job.payload?.previewRequired !== true) {
        return {
            status: 'completed',
            phase: 'approval',
            result: {
                type: 'sidePromptApproval',
                decision: 'approved',
                title: String(generatedResult.title || job.payload?.title || ''),
                text: String(generatedResult.text || ''),
            },
        };
    }

    return {
        status: 'awaiting_approval',
        phase: 'awaiting_approval',
        approvalRequest: buildSidePromptApprovalRequest(generatedResult, job),
    };
}

async function executePlannerSidePromptCommitJob(user, job) {
    const dependencies = await getPlannerDependencyJobs(user, job);
    const approvalJob = getFirstPlannerDependencyByKind(dependencies, 'sidePromptApproval');
    const approvalResult = approvalJob?.result || {};

    if (approvalResult.blank === true) {
        return {
            type: 'sidePrompt',
            blank: true,
            title: String(approvalResult.title || job.payload?.title || ''),
            lorebookName: String(job.payload?.lorebookName || ''),
        };
    }

    const text = String(approvalResult.text || '').trim();
    if (!text) {
        throw createStmbRequestError(409, 'StmbPlannerDependencyMissing', 'Side prompt commit is missing approved text.');
    }

    const saveResult = await upsertLorebookEntryByTitleForUser(user, {
        lorebookName: job.payload.lorebookName,
        storage: job.payload.storage,
        title: String(approvalResult.title || job.payload.title || ''),
        content: text,
        defaults: job.payload.defaults || {},
        metadataUpdates: buildPlannerSidePromptMetadataUpdates(job.payload.metadataUpdates, job.payload.commitCheckpoint),
        entryOverrides: job.payload.entryOverrides || {},
    });

    return {
        type: 'sidePrompt',
        title: String(approvalResult.title || job.payload.title || ''),
        lorebookName: String(job.payload.lorebookName || ''),
        entryUid: saveResult.entry?.uid ?? null,
    };
}

async function getPlannerDependencyJobs(user, job) {
    const dependencyIds = normalizePlannerDependencyList(job?.dependsOn);
    if (dependencyIds.length === 0) {
        return [];
    }

    return withPlannerDocument(user, async document => dependencyIds
        .map(jobId => document.jobs.find(candidate => String(candidate.id) === String(jobId)))
        .filter(Boolean)
        .map(candidate => structuredClone(candidate)));
}

function getFirstPlannerDependencyByKind(dependencies, kind) {
    return (Array.isArray(dependencies) ? dependencies : []).find(dependency => String(dependency?.kind || '') === String(kind || '')) || null;
}

function buildMemoryApprovalRequest(memory, job) {
    return {
        kind: 'memory_preview',
        memory: normalizeApprovedMemoryObject(memory),
        sceneData: structuredClone(job?.payload?.sceneData || {}),
        profile: structuredClone(job?.payload?.profile || {}),
        allowRetry: true,
        lockTitle: false,
    };
}

function buildSidePromptApprovalRequest(result, job) {
    return {
        kind: 'sideprompt_preview',
        title: String(result?.title || job?.payload?.title || ''),
        content: String(result?.text || ''),
        sceneData: structuredClone(job?.payload?.sceneData || {}),
        profile: structuredClone(job?.payload?.profile || {}),
        allowRetry: true,
        lockTitle: job?.payload?.lockTitle === true,
    };
}

function normalizeApprovedMemoryObject(value) {
    return parseStructuredMemoryResponse(value);
}

function extractPlannerGeneratedMemory(forwarded, regexConfig = {}) {
    if (regexConfig.enabled) {
        const rawText = extractTextFromProviderResponse(forwarded.data).trim();
        assertPlannerResponseNotTruncated(forwarded.data, rawText);
        const cleanedText = applyPlannerRegexScripts(rawText, regexConfig.incomingScripts);
        return parseStructuredMemoryResponse(cleanedText);
    }

    return parseStructuredMemoryResponse(forwarded.data);
}

async function executePlannerMemoryGenerateJob(user, job) {
    const forwarded = await forwardChatCompletionGenerateForUser(user, job.payload.generateData, job.id);
    if (!forwarded.ok) {
        throw createStmbRequestError(forwarded.status || 500, 'StmbGenerationFailed', 'Failed to generate STMB memory.', {
            providerBody: forwarded.data,
        });
    }

    const regexConfig = job.payload?.regexConfig && typeof job.payload.regexConfig === 'object'
        ? job.payload.regexConfig
        : {};
    const memory = extractPlannerGeneratedMemory(forwarded, regexConfig);
    return {
        type: 'memoryGenerate',
        memory,
        lorebookName: String(job.payload.lorebookName || ''),
        range: structuredClone(job.payload.range || {}),
    };
}

async function executePlannerMemoryApprovalJob(user, job) {
    const dependencies = await getPlannerDependencyJobs(user, job);
    const generatedJob = getFirstPlannerDependencyByKind(dependencies, 'memoryGenerate');
    const generatedMemory = generatedJob?.result?.memory;
    if (!generatedMemory) {
        throw createStmbRequestError(409, 'StmbPlannerDependencyMissing', 'Memory approval is missing generated memory output.');
    }

    if (job.payload?.previewRequired !== true) {
        return {
            status: 'completed',
            phase: 'approval',
            result: {
                type: 'memoryApproval',
                decision: 'approved',
                memory: normalizeApprovedMemoryObject(generatedMemory),
            },
        };
    }

    return {
        status: 'awaiting_approval',
        phase: 'awaiting_approval',
        approvalRequest: buildMemoryApprovalRequest(generatedMemory, job),
    };
}

async function executePlannerMemoryCommitJob(user, job) {
    const dependencies = await getPlannerDependencyJobs(user, job);
    const approvalJob = getFirstPlannerDependencyByKind(dependencies, 'memoryApproval');
    const approvedMemory = approvalJob?.result?.memory;
    if (!approvedMemory) {
        throw createStmbRequestError(409, 'StmbPlannerDependencyMissing', 'Memory commit is missing approved memory data.');
    }

    const saveResult = await saveManagedMemoryForUser(user, {
        lorebookName: job.payload.lorebookName,
        storage: job.payload.storage,
        memoryObject: normalizeApprovedMemoryObject(approvedMemory),
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
        orderClampNotifications: Array.isArray(saveResult?.orderClampNotifications) ? saveResult.orderClampNotifications : [],
        clientActions: [
            {
                type: 'refresh_lorebook',
                lorebookName: saveResult.lorebookName,
            },
        ],
    };
}

function buildPlannerAutoHideRanges(range = {}, mode = 'none', unhiddenCount = 0) {
    const normalizedMode = String(mode || 'none').toLowerCase();
    const normalizedStart = Math.max(0, Math.trunc(Number(range?.sceneStart) || 0));
    const normalizedEnd = Math.max(normalizedStart, Math.trunc(Number(range?.sceneEnd) || normalizedStart));
    const keepVisible = Math.max(0, Math.trunc(Number(unhiddenCount) || 0));

    if (normalizedMode === 'all') {
        const hideEnd = keepVisible === 0 ? normalizedEnd : normalizedEnd - keepVisible;
        return hideEnd >= 0 ? [{ start: 0, end: hideEnd, hide: true }] : [];
    }

    if (normalizedMode === 'last') {
        const sceneSize = normalizedEnd - normalizedStart + 1;
        if (keepVisible >= sceneSize) {
            return [];
        }
        const hideEnd = keepVisible === 0 ? normalizedEnd : normalizedEnd - keepVisible;
        return hideEnd >= normalizedStart ? [{ start: normalizedStart, end: hideEnd, hide: true }] : [];
    }

    return [];
}

function writePlannerGroupChat(filePath, header, messages) {
    const records = header ? [header, ...messages] : messages;
    writeFileAtomicSync(filePath, records.map(item => JSON.stringify(item)).join('\n'), 'utf8');
}

function mutateLogicalChatVisibility(user, sceneContext, ranges = []) {
    const logicalChat = resolveLogicalChatReference(user.directories, sceneContext.chatRef);
    const filePath = String(logicalChat?.filePath || '');
    if (!filePath || !fs.existsSync(filePath)) {
        return {
            applied: false,
            changedMessageIds: [],
            chatType: String(logicalChat?.chatType || ''),
        };
    }

    const nextMessages = Array.isArray(logicalChat?.messages) ? logicalChat.messages.slice() : [];
    const changedMessageIds = [];

    for (const range of Array.isArray(ranges) ? ranges : []) {
        const start = Math.max(0, Math.trunc(Number(range?.start) || 0));
        const end = Math.max(start, Math.trunc(Number(range?.end) || start));
        const hide = range?.hide !== false;

        for (let index = start; index <= end; index++) {
            const message = nextMessages[index];
            if (!message || message.is_system === hide) {
                continue;
            }
            nextMessages[index] = {
                ...message,
                is_system: hide,
            };
            changedMessageIds.push(index);
        }
    }

    if (changedMessageIds.length === 0) {
        return {
            applied: false,
            changedMessageIds: [],
            chatType: String(logicalChat?.chatType || ''),
        };
    }

    if (logicalChat?.chatType === 'group') {
        writePlannerGroupChat(filePath, logicalChat?.header || null, nextMessages);
        return {
            applied: true,
            changedMessageIds,
            chatType: 'group',
        };
    }

    const tailStartId = Number.isInteger(logicalChat?.tailStartId) ? logicalChat.tailStartId : 0;
    const tailCount = Math.max(0, nextMessages.length - tailStartId);
    writeLogicalChat(filePath, logicalChat?.header || {}, nextMessages, {
        tailStartId,
        displayCount: Math.max(20, Math.min(200, tailCount || 100)),
        bufferMax: Math.max(70, Math.min(500, tailCount || 200)),
    });

    return {
        applied: true,
        changedMessageIds,
        chatType: 'character',
        payload: buildChunkedChatPayload(filePath, {
            hydrateFull: true,
            count: nextMessages.length,
            displayCount: Math.max(20, Math.min(200, tailCount || 100)),
            bufferMax: Math.max(70, Math.min(500, tailCount || 200)),
            includeParentPromptCache: true,
        }),
    };
}

async function executePlannerChatAutoHideJob(user, job) {
    const ranges = buildPlannerAutoHideRanges(
        job.payload?.range || {},
        job.payload?.mode || 'none',
        job.payload?.unhiddenCount || 0,
    );
    if (ranges.length === 0) {
        return {
            type: 'chatAutoHide',
            applied: false,
            clientActions: [],
        };
    }

    const mutationResult = mutateLogicalChatVisibility(user, job.sceneContext, ranges);
    return {
        type: 'chatAutoHide',
        applied: mutationResult.applied,
        changedMessageIds: mutationResult.changedMessageIds,
        clientActions: mutationResult.applied
            ? [{
                type: 'reload_chat',
                payload: mutationResult.payload || null,
            }]
            : [],
    };
}

async function executePlannerConsolidationCheckJob(user, job) {
    const targetTier = Math.min(6, Math.max(1, Math.trunc(Number(job.payload?.targetTier) || 1)));
    const requiredMin = normalizeSummaryMinChildren(
        job.payload?.requiredMin,
        getDefaultSummaryMinChildren(targetTier),
    );
    const lorebookData = await getLorebookForManagement(
        user,
        String(job.payload?.lorebookName || ''),
        true,
        job.payload?.storage || null,
    );
    ensureEntriesObject(lorebookData.data);

    const eligibleEntries = identifyEligibleSummarySourceEntries(lorebookData.data.entries, targetTier);
    const eligibleCount = eligibleEntries.length;
    const promptKey = `${targetTier}:${eligibleCount}`;
    let ready = eligibleCount >= requiredMin;
    if (ready) {
        const state = readChatMetadataState(user, job.sceneContext);
        if (String(state?.autoConsolidationLastPromptKey || '') === promptKey) {
            ready = false;
        } else {
            updateChatMetadataState(user, job.sceneContext, currentState => ({
                ...currentState,
                autoConsolidationLastPromptKey: promptKey,
            }));
        }
    }

    return {
        type: 'consolidationCheck',
        lorebookName: String(job.payload?.lorebookName || ''),
        targetTier,
        requiredMin,
        eligibleCount,
        ready,
    };
}

async function executePlannerJob(user, job) {
    if (job.kind === 'memory') {
        const generated = await executePlannerMemoryGenerateJob(user, job);
        const saveResult = await saveManagedMemoryForUser(user, {
            lorebookName: job.payload.lorebookName,
            storage: job.payload.storage,
            memoryObject: generated.memory,
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
            status: 'completed',
            phase: 'commit',
            result: {
                type: 'memory',
                lorebookName: saveResult.lorebookName,
                entryUid: saveResult.entry?.uid ?? null,
                highestProcessed: Number(job.payload.range?.sceneEnd),
                orderClampNotifications: Array.isArray(saveResult?.orderClampNotifications) ? saveResult.orderClampNotifications : [],
            },
        };
    }
    if (job.kind === 'memoryGenerate') {
        return {
            status: 'completed',
            phase: 'generate',
            result: await executePlannerMemoryGenerateJob(user, job),
        };
    }
    if (job.kind === 'memoryApproval') {
        return executePlannerMemoryApprovalJob(user, job);
    }
    if (job.kind === 'memoryCommit') {
        return {
            status: 'completed',
            phase: 'commit',
            result: await executePlannerMemoryCommitJob(user, job),
        };
    }
    if (job.kind === 'chatAutoHide') {
        return {
            status: 'completed',
            phase: 'post_commit',
            result: await executePlannerChatAutoHideJob(user, job),
        };
    }
    if (job.kind === 'sidePrompt') {
        return {
            status: 'completed',
            phase: 'post_commit',
            result: await executePlannerSidePromptJob(user, job),
        };
    }
    if (job.kind === 'sidePromptGenerate') {
        return {
            status: 'completed',
            phase: 'generate',
            result: await executePlannerSidePromptGenerateJob(user, job),
        };
    }
    if (job.kind === 'sidePromptApproval') {
        return executePlannerSidePromptApprovalJob(user, job);
    }
    if (job.kind === 'sidePromptCommit') {
        return {
            status: 'completed',
            phase: 'post_commit',
            result: await executePlannerSidePromptCommitJob(user, job),
        };
    }
    if (job.kind === 'consolidationCheck') {
        return {
            status: 'completed',
            phase: 'post_commit',
            result: await executePlannerConsolidationCheckJob(user, job),
        };
    }
    throw new Error(`Unsupported planner job kind "${job.kind}"`);
}

async function claimNextPlannerJob(user) {
    return withPlannerDocument(user, async document => {
        refreshPlannerDependencyStatuses(document);
        const runningChats = new Set(
            document.jobs
                .filter(job => String(job?.status || '') === 'running')
                .map(job => String(job.chatKey || '')),
        );
        const nextJob = document.jobs.find(job => {
            if (String(job?.status || '') !== 'pending') {
                return false;
            }
            if (runningChats.has(String(job.chatKey || ''))) {
                return false;
            }
            return evaluatePlannerDependencyState(document, job).runnable;
        });
        if (!nextJob) {
            return null;
        }

        nextJob.status = 'running';
        nextJob.phase = String(nextJob?.phase || getPlannerJobDefaultPhase(nextJob?.kind));
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

async function runPlannerJobExecution(user, job) {
    try {
        const execution = await executePlannerJob(user, job);
        await settlePlannerJob(user, job.id, settledJob => {
            settledJob.status = String(execution?.status || 'completed');
            settledJob.phase = String(execution?.phase || settledJob.phase || getPlannerJobDefaultPhase(settledJob?.kind));
            settledJob.result = execution?.result ?? null;
            settledJob.approvalRequest = execution?.approvalRequest ?? null;
            settledJob.error = execution?.error ?? null;
        });
    } catch (error) {
        console.error('[STMB Planner] Job failed', job.id, error);
        await settlePlannerJob(user, job.id, settledJob => {
            settledJob.status = 'failed';
            settledJob.phase = String(settledJob?.phase || getPlannerJobDefaultPhase(settledJob?.kind));
            settledJob.approvalRequest = null;
            settledJob.error = {
                message: String(error?.message || error),
                type: String(error?.type || error?.name || 'StmbPlannerJobError'),
            };
        });
    } finally {
        activePlannerJobExecutions.delete(String(job.id));
        processPlannerJobs().catch(error => {
            console.error('[STMB Planner] Worker reschedule failed', error);
        });
    }
}

function buildApprovedPlannerResultForJob(job, approvalRequest, editedData = null) {
    const kind = String(job?.kind || '');
    if (kind === 'memoryApproval') {
        const sourceMemory = editedData ?? approvalRequest?.memory;
        return {
            type: 'memoryApproval',
            decision: 'approved',
            memory: normalizeApprovedMemoryObject(sourceMemory),
        };
    }

    if (kind === 'sidePromptApproval') {
        const source = editedData && typeof editedData === 'object' ? editedData : {};
        return {
            type: 'sidePromptApproval',
            decision: 'approved',
            title: String(source.title || approvalRequest?.title || ''),
            text: String(source.content ?? source.text ?? approvalRequest?.content ?? ''),
        };
    }

    throw createStmbRequestError(409, 'StmbPlannerApprovalInvalid', `Unsupported approval job kind "${kind}".`);
}

async function rerunPlannerApprovalGeneration(user, document, approvalJob) {
    const dependencyIds = normalizePlannerDependencyList(approvalJob?.dependsOn);
    const generateJob = dependencyIds
        .map(jobId => document.jobs.find(candidate => String(candidate.id) === String(jobId)))
        .find(candidate => ['memoryGenerate', 'sidePromptGenerate'].includes(String(candidate?.kind || '')));
    if (!generateJob) {
        throw createStmbRequestError(409, 'StmbPlannerDependencyMissing', 'Approval retry is missing its generate job.');
    }

    let generateResult;
    if (String(generateJob.kind) === 'memoryGenerate') {
        generateResult = await executePlannerMemoryGenerateJob(user, structuredClone(generateJob));
        generateJob.result = generateResult;
        generateJob.status = 'completed';
        generateJob.phase = 'generate';
        generateJob.error = null;
        generateJob.approvalRequest = null;
        generateJob.updatedAt = Date.now();
        approvalJob.status = 'awaiting_approval';
        approvalJob.phase = 'awaiting_approval';
        approvalJob.result = null;
        approvalJob.error = null;
        approvalJob.approvalRequest = buildMemoryApprovalRequest(generateResult.memory, approvalJob);
        approvalJob.updatedAt = Date.now();
        return;
    }

    if (String(generateJob.kind) === 'sidePromptGenerate') {
        generateResult = await executePlannerSidePromptGenerateJob(user, structuredClone(generateJob));
        generateJob.result = generateResult;
        generateJob.status = 'completed';
        generateJob.phase = 'generate';
        generateJob.error = null;
        generateJob.approvalRequest = null;
        generateJob.updatedAt = Date.now();
        approvalJob.status = 'awaiting_approval';
        approvalJob.result = null;
        approvalJob.error = null;
        if (generateResult.blank) {
            approvalJob.phase = 'approval';
            approvalJob.status = 'completed';
            approvalJob.approvalRequest = null;
            approvalJob.result = {
                type: 'sidePromptApproval',
                decision: 'blank',
                blank: true,
                title: String(generateResult.title || approvalJob.payload?.title || ''),
                text: '',
            };
        } else {
            approvalJob.phase = 'awaiting_approval';
            approvalJob.approvalRequest = buildSidePromptApprovalRequest(generateResult, approvalJob);
        }
        approvalJob.updatedAt = Date.now();
        return;
    }

    throw createStmbRequestError(409, 'StmbPlannerDependencyMissing', 'Unsupported generate job for approval retry.');
}

async function respondPlannerApproval(user, {
    jobId,
    decision,
    memory = null,
    editedData = null,
} = {}) {
    const normalizedJobId = String(jobId || '').trim();
    const normalizedDecision = String(decision || '').trim().toLowerCase();
    if (!normalizedJobId || !['approve', 'reject', 'retry'].includes(normalizedDecision)) {
        throw createStmbRequestError(400, 'StmbBadRequest', 'jobId and a valid decision are required.');
    }

    return withPlannerDocument(user, async document => {
        const job = document.jobs.find(candidate => String(candidate.id) === normalizedJobId);
        if (!job) {
            throw createStmbRequestError(404, 'StmbPlannerJobNotFound', 'Planner approval job was not found.');
        }
        if (!['memoryApproval', 'sidePromptApproval'].includes(String(job?.kind || '')) || String(job?.status || '') !== 'awaiting_approval') {
            throw createStmbRequestError(409, 'StmbPlannerApprovalInvalid', 'Planner job is not awaiting approval.');
        }

        const approvalRequest = structuredClone(job.approvalRequest || null);
        if (normalizedDecision === 'reject') {
            job.approvalRequest = null;
            job.phase = 'approval';
            job.updatedAt = Date.now();
            job.status = 'rejected';
            job.result = {
                type: String(job.kind),
                decision: 'rejected',
            };
            job.error = {
                message: 'Rejected by user.',
                type: 'StmbPlannerApprovalRejected',
            };
        } else if (normalizedDecision === 'retry') {
            await rerunPlannerApprovalGeneration(user, document, job);
        } else {
            job.approvalRequest = null;
            job.phase = 'approval';
            job.updatedAt = Date.now();
            job.status = 'completed';
            job.result = buildApprovedPlannerResultForJob(job, approvalRequest, editedData ?? memory ?? null);
            job.error = null;
        }

        refreshPlannerWaveStatuses(document);
        return structuredClone(job);
    });
}

async function acknowledgePlannerJobs(user, jobs = []) {
    const acknowledgements = Array.isArray(jobs) ? jobs : [];
    return withPlannerDocument(user, async document => {
        let acknowledged = 0;
        for (const ack of acknowledgements) {
            const jobId = String(ack?.jobId || '').trim();
            const updatedAt = Number(ack?.updatedAt || 0);
            if (!jobId || !updatedAt) {
                continue;
            }

            const job = document.jobs.find(candidate => String(candidate.id) === jobId);
            if (!job) {
                continue;
            }
            if (Number(job.updatedAt || 0) !== updatedAt) {
                continue;
            }

            job.clientHandledAt = Date.now();
            acknowledged++;
        }

        refreshPlannerWaveStatuses(document);
        return { acknowledged };
    });
}

async function processPlannerJobs() {
    if (plannerWorkerTickActive) {
        return;
    }

    plannerWorkerTickActive = true;
    try {
        let remainingCapacity = STMB_PLANNER_MAX_CONCURRENT_JOBS - activePlannerJobExecutions.size;
        if (remainingCapacity <= 0) {
            return;
        }

        const handles = await getAllUserHandles();
        const users = handles.map(handle => makePlannerUser(handle));
        const claimedJobs = [];

        while (remainingCapacity > 0) {
            let claimedInPass = false;
            for (const user of users) {
                if (remainingCapacity <= 0) {
                    break;
                }

                const nextJob = await claimNextPlannerJob(user);
                if (!nextJob) {
                    continue;
                }

                claimedJobs.push({ user, job: nextJob });
                remainingCapacity--;
                claimedInPass = true;
            }

            if (!claimedInPass) {
                break;
            }
        }

        for (const { user, job } of claimedJobs) {
            const executionPromise = runPlannerJobExecution(user, job);
            activePlannerJobExecutions.set(String(job.id), executionPromise);
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
