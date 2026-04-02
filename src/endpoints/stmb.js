import express from 'express';
import { EventEmitter } from 'node:events';
import { createMacroState, evaluatePromptMacros } from '../prompting/macro-evaluator.js';
import { handleChatCompletionsGenerate } from './backends/chat-completions.js';

import {
    applyLorebookSettings,
    createManagedLorebookEntryData,
    getNextManagedMemorySequenceNumber,
    getPresetPrompt,
    identifyManagedMemoryEntries,
    compiledSceneToText,
    parseStructuredMemoryResponse,
} from '../../public/scripts/stmb-core.js';
import {
    buildBriefsFromEntries,
    buildSummaryAnalysisPrompt,
    createManagedSummaryEntryData,
    getNextSummaryNumber,
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

function sendStmbError(response, error) {
    if (error instanceof LorebookRepositoryError) {
        return response.status(error.status).send({
            error: {
                type: error.type,
                message: error.message,
            },
        });
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
        entry[key] = value;
    }
    for (const [key, value] of Object.entries(entryOverrides)) {
        entry[key] = value;
    }

    return { created, entry };
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

        const sequenceNumber = getNextManagedMemorySequenceNumber(
            lorebookData.entries,
            profile?.titleFormat || sceneContext?.titleFormat || null,
        );
        const entryPayload = createManagedLorebookEntryData(memoryObject, sceneContext, profile, sequenceNumber);
        const entry = createLorebookEntry(lorebookData);
        Object.assign(entry, entryPayload);
        applyLorebookSettings(entry, profile, {
            orderNumber: sequenceNumber,
            orderNumberLabel: 'memory',
        });

        const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
        return response.send({
            ok: true,
            lorebookName: savedMetadata.name,
            storage: savedMetadata.storage,
            entry,
            sequenceNumber,
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

        let nextSummaryNumber = getNextSummaryNumber(lorebookData, targetTier);
        const createdEntries = [];

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

        if (createdEntries.length > 0 || migrated) {
            const savedMetadata = await saveLorebookForManagement(request.user, metadata.name, lorebookData, metadata.storage);
            return response.send({
                ok: true,
                lorebookName: savedMetadata.name,
                storage: savedMetadata.storage,
                createdEntries,
            });
        }

        return response.send({
            ok: true,
            lorebookName: metadata.name,
            storage: metadata.storage,
            createdEntries,
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

    if (!lorebookContext || !title) {
        return response.status(400).send({
            error: {
                type: 'StmbBadRequest',
                message: 'lorebookName and title are required.',
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
