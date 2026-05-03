import {
    chat_metadata,
    getCurrentChatId,
    name1,
    name2,
} from '../script.js';
import { getContext } from './extensions.js';
import { generateStmbText, upsertStmbEntriesBatch, upsertStmbEntryByTitle } from './stmb-api.js';
import { saveMetadataDebounced } from './extensions.js';
import { removeReasoningFromString } from './reasoning.js';
import { getLorebookStorageForRequest, loadWorldInfo, reloadEditor, world_names, worldInfoCache } from './world-info.js';
import { buildOpenAIGenerateData, oai_settings } from './openai.js';
import { showMemoryPreviewPopup } from './stmb-popups.js';
import { ensureResolvedLorebookName, isStmbLorebookHandledError } from './stmb-lorebook.js';
import { createStmbTask, isStmbAbortError, throwIfStmbAborted } from './stmb-tasks.js';
import {
    applyStmbMaxTokensToGenerateData,
    applyStmbProfileToGenerateData,
    buildSidePromptCheckpointMetadata,
    findFirstLorebookEntryByTitle,
    getActiveStmbProfile,
    readSidePromptCheckpoint,
    STMB_METADATA_KEY,
} from './stmb-core.js';
import { buildStmbSceneContext, captureStmbSceneRange, fetchStmbChatRangeInfo } from './stmb-scene.js';
import { applyStmbIncomingRegex, buildSidePromptText, fetchPreviousMemories } from './stmb-prompt-assembly.js';
import {
    applySidePromptMacros,
    collectTemplateRuntimeMacros,
    extractMacroTokens,
    parseSidePromptCommandInput,
} from './stmb-sideprompt-macros.js';
import {
    findSetByName,
    findTemplateByName,
    firstRunInitSidePrompts,
    getTemplate,
    listByTrigger,
    listTemplates,
    resolveSetItemsForRun,
    upsertTemplate,
} from './stmb-sideprompts-manager.js';
import { awaitStmbJobApproval, enqueueStmbJob, registerStmbJobExecutor } from './stmb-jobs.js';

let trackerEvaluationPromise = null;
let previewQueue = Promise.resolve();
let hasShownSidePromptRangeTip = false;
let sidePromptJobExecutorRegistered = false;

function enqueuePreview(task) {
    previewQueue = previewQueue.then(task).catch(error => {
        console.warn('STMB side prompt preview task failed', error);
    });
    return previewQueue;
}

function getStmbProviderDefaults() {
    return {
        azure_base_url: oai_settings.azure_base_url,
        azure_api_version: oai_settings.azure_api_version,
        azure_deployment_name: oai_settings.azure_deployment_name,
        custom_url: oai_settings.custom_url,
    };
}

function getStmbChatState() {
    const context = getContext();
    const metadata = context?.chatMetadata || chat_metadata;
    if (!metadata[STMB_METADATA_KEY] || typeof metadata[STMB_METADATA_KEY] !== 'object') {
        metadata[STMB_METADATA_KEY] = {};
    }

    return metadata[STMB_METADATA_KEY];
}

function getHighestProcessedMessageBaseline() {
    const highestProcessed = Number(getStmbChatState()?.highestMemoryProcessed);
    return Number.isFinite(highestProcessed) ? Math.trunc(highestProcessed) : -1;
}

function resolveSidePromptCheckpoint(templateKey, existingEntry, options = {}) {
    const checkpoint = readSidePromptCheckpoint(templateKey, existingEntry, options);
    if (checkpoint.lastMsgId >= 0) {
        return checkpoint;
    }

    return {
        ...checkpoint,
        lastMsgId: getHighestProcessedMessageBaseline(),
    };
}

function getSidePromptChatLorebookOverrides() {
    const state = getStmbChatState();
    return state?.sidePromptLorebookOverrides && typeof state.sidePromptLorebookOverrides === 'object'
        ? state.sidePromptLorebookOverrides
        : {};
}

function getSelectedAfterMemorySetKey() {
    return String(getStmbChatState()?.sidePromptAfterMemorySetKey || '').trim();
}

function summarizeTemplateNames(names = [], maxLength = 80) {
    const cleanNames = names.map(name => String(name || '').trim()).filter(Boolean);
    if (cleanNames.length === 0) {
        return 'Side Prompt';
    }

    let output = '';
    let included = 0;
    for (const name of cleanNames) {
        const next = output ? `${output}, ${name}` : name;
        if (next.length > maxLength && included > 0) {
            break;
        }
        output = next;
        included++;
    }

    const remaining = cleanNames.length - included;
    return remaining > 0 ? `${output}, +${remaining} more` : output;
}

function makeSidePromptBatchTitle(runItems = [], set = null) {
    const names = runItems.map(item => item?.displayName || item?.templateName || item?.template?.name || item?.name);
    const summary = summarizeTemplateNames(names, 70);
    if (set?.name) {
        return `Set: ${set.name} - ${summary}`;
    }
    return runItems.length === 1
        ? String(summary || 'Side Prompt')
        : `Side Prompt Wave: ${summary}`;
}

function logSkippedSetItems(skipped = [], context = 'set') {
    for (const item of skipped || []) {
        if (item.reason === 'missing-set') {
            console.warn(`STMB side prompt ${context}: set not found`, item.setKey);
        } else if (item.reason === 'missing-template') {
            console.warn(`STMB side prompt ${context}: set item skipped because template is missing`, item.item);
        } else if (item.reason === 'missing-macros') {
            console.warn(`STMB side prompt ${context}: set item skipped because macros are unresolved`, {
                name: item.template?.name || item.item?.promptKey || 'unknown',
                missingRuntimeMacros: item.missingRuntimeMacros,
            });
        }
    }
}

function summarizeMissingSetMacros(skipped = []) {
    const missing = [];
    const seen = new Set();
    for (const item of skipped || []) {
        if (item.reason !== 'missing-macros') continue;
        for (const token of item.missingRuntimeMacros || []) {
            if (seen.has(token)) continue;
            seen.add(token);
            missing.push(token);
        }
    }
    return missing;
}

function isExistingLorebookName(name) {
    return Boolean(name && Array.isArray(world_names) && world_names.includes(name));
}

async function tryLoadSidePromptTargetLorebook(lorebookName, source, template) {
    if (!isExistingLorebookName(lorebookName)) {
        return null;
    }

    try {
        const data = await loadWorldInfo(lorebookName);
        if (data) {
            return { name: lorebookName, data, source };
        }
    } catch (error) {
        console.warn(`STMB side prompt failed to load ${source} lorebook target for "${template?.name || template?.key || 'unknown'}"`, error);
    }

    return null;
}

async function resolveMemoryDefaultLorebook(settings, resolveContext = null, source = 'memoryDefault') {
    if (resolveContext && !resolveContext.memoryLorebookPromise) {
        resolveContext.memoryLorebookPromise = (async () => {
            const lorebookName = String(resolveContext.memoryLorebookName || await ensureLorebookName(settings)).trim();
            const lorebookData = resolveContext.memoryLorebookData || await loadWorldInfo(lorebookName);
            if (!lorebookName || !lorebookData) {
                throw new Error('No memory lorebook available.');
            }
            return { name: lorebookName, data: lorebookData };
        })();
    }

    const lorebook = resolveContext
        ? await resolveContext.memoryLorebookPromise
        : {
            name: await ensureLorebookName(settings),
            data: null,
        };
    if (!lorebook.data) {
        lorebook.data = await loadWorldInfo(lorebook.name);
    }
    if (!lorebook.name || !lorebook.data) {
        throw new Error('No memory lorebook available.');
    }

    return { ...lorebook, source };
}

async function resolveSidePromptLorebook(template, settings, resolveContext = null) {
    const templateKey = String(template?.key || '').trim();
    const chatOverrides = getSidePromptChatLorebookOverrides();
    if (templateKey && Object.hasOwn(chatOverrides, templateKey)) {
        const chatOverride = String(chatOverrides[templateKey] || '').trim();
        if (chatOverride === '__memory__') {
            return resolveMemoryDefaultLorebook(settings, resolveContext, 'chatOverride');
        }

        const chatTarget = await tryLoadSidePromptTargetLorebook(chatOverride, 'chatOverride', template);
        if (chatTarget) {
            return chatTarget;
        }
        return resolveMemoryDefaultLorebook(settings, resolveContext, 'chatOverride');
    }

    const templateOverride = String(template?.settings?.lorebook?.targetLorebookName || '').trim();
    const templateTarget = await tryLoadSidePromptTargetLorebook(templateOverride, 'templateOverride', template);
    if (templateTarget) {
        return templateTarget;
    }

    return resolveMemoryDefaultLorebook(settings, resolveContext, 'memoryDefault');
}

function resolveSidePromptMaxConcurrent(settings) {
    const parsed = Number(settings?.moduleSettings?.sidePromptsMaxConcurrent ?? 1);
    if (!Number.isFinite(parsed)) {
        return 1;
    }
    return Math.max(1, Math.min(2, Math.trunc(parsed)));
}

function renderLorebookNameFromTemplate(settings) {
    const template = String(settings?.moduleSettings?.lorebookNameTemplate || 'LTM - {{char}} - {{chat}}');
    const chatId = getCurrentChatId() || 'Chat';
    return template
        .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
        .replace(/\{\{user\}\}/g, String(name1 || 'User'))
        .replace(/\{\{chat\}\}/g, String(chatId));
}

async function ensureLorebookName(settings) {
    return ensureResolvedLorebookName({
        manualMode: Boolean(settings?.moduleSettings?.manualModeEnabled),
        getManualLorebook: () => getStmbChatState().manualLorebook,
        setManualLorebook: async selectedLorebook => {
            getStmbChatState().manualLorebook = String(selectedLorebook || '').trim();
            saveMetadataDebounced();
        },
        autoCreateLorebook: Boolean(settings?.moduleSettings?.autoCreateLorebook),
        lorebookNameTemplate: String(settings?.moduleSettings?.lorebookNameTemplate || 'LTM - {{char}} - {{chat}}'),
        createContext: 'side-prompt',
    });
}

function getEffectiveLorebookSettingsForTemplate(template) {
    const lorebook = template?.settings?.lorebook || {};
    return {
        constVectMode: lorebook.constVectMode || 'link',
        position: Number.isFinite(Number(lorebook.position)) ? Number(lorebook.position) : 0,
        orderMode: lorebook.orderMode === 'manual' ? 'manual' : 'auto',
        orderValue: Number.isFinite(Number(lorebook.orderValue)) ? Number(lorebook.orderValue) : 100,
        preventRecursion: lorebook.preventRecursion !== false,
        delayUntilRecursion: Boolean(lorebook.delayUntilRecursion),
        ignoreBudget: Boolean(lorebook.ignoreBudget),
        outletName: String(lorebook.outletName || ''),
        entryTitleOverride: String(lorebook.entryTitleOverride || ''),
        entryKeywords: String(lorebook.entryKeywords || ''),
        targetLorebookName: String(lorebook.targetLorebookName || ''),
    };
}

function resolveLorebookEntryKeywords(lorebookSettings, runtimeMacros = {}) {
    const rawTemplate = String(lorebookSettings?.entryKeywords || '').trim();
    if (!rawTemplate) return [];

    const resolved = applySidePromptMacros(rawTemplate, runtimeMacros);
    const keywords = [];
    const seen = new Set();
    for (const part of resolved.split(/[\n,]+/)) {
        const token = String(part || '').trim();
        if (!token) continue;
        if (extractMacroTokens(token).length > 0) continue;
        const normalized = token.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        keywords.push(token);
    }
    return keywords;
}

function makeUpsertParamsFromLorebook(lorebookSettings, runtimeMacros = {}) {
    const defaults = {
        vectorized: lorebookSettings.constVectMode === 'link',
        selective: true,
        order: lorebookSettings.orderMode === 'manual' ? lorebookSettings.orderValue : 100,
        position: lorebookSettings.position,
    };
    const entryOverrides = {
        constant: lorebookSettings.constVectMode === 'blue',
        vectorized: lorebookSettings.constVectMode === 'link',
        preventRecursion: lorebookSettings.preventRecursion,
        delayUntilRecursion: lorebookSettings.delayUntilRecursion,
        ignoreBudget: lorebookSettings.ignoreBudget,
    };
    if (lorebookSettings.orderMode === 'manual') {
        entryOverrides.order = lorebookSettings.orderValue;
    }
    if (Number(lorebookSettings.position) === 7 && lorebookSettings.outletName) {
        entryOverrides.outletName = lorebookSettings.outletName;
    }
    const keywords = resolveLorebookEntryKeywords(lorebookSettings, runtimeMacros);
    if (keywords.length > 0) {
        entryOverrides.key = keywords;
    }
    return { defaults, entryOverrides };
}

function getSidePromptTitleSuffix() {
    return ' (STMB SidePrompt)';
}

function getResolvedSidePromptTitleBase(template, runtimeMacros = {}) {
    const overrideRaw = String(template?.settings?.lorebook?.entryTitleOverride || '').trim();
    const fallbackBase = String(template?.name || '').trim() || 'Side Prompt';
    if (!overrideRaw) return fallbackBase;
    const resolved = applySidePromptMacros(overrideRaw, runtimeMacros).trim();
    return resolved || fallbackBase;
}

function getUnifiedSidePromptTitle(template, runtimeMacros = {}) {
    const baseTitle = getResolvedSidePromptTitleBase(template, runtimeMacros);
    const suffix = getSidePromptTitleSuffix();
    return baseTitle.endsWith(suffix) ? baseTitle : `${baseTitle}${suffix}`;
}

function getSidePromptLookupTitles(template, runtimeMacros = {}, fallbackKinds = []) {
    const titles = [getUnifiedSidePromptTitle(template, runtimeMacros)];
    const hasTitleOverride = Boolean(String(template?.settings?.lorebook?.entryTitleOverride || '').trim());
    if (!hasTitleOverride) {
        for (const kind of fallbackKinds) {
            if (kind === 'plotpoints') titles.push(`${template.name} (STMB Plotpoints)`);
            else if (kind === 'scoreboard') titles.push(`${template.name} (STMB Scoreboard)`);
            else if (kind === 'tracker') titles.push(`${template.name} (STMB Tracker)`);
        }
    }
    return titles;
}

async function upsertLorebookEntryByTitle(lorebookName, lorebookData, title, content, options = {}) {
    const {
        defaults = {
            vectorized: true,
            selective: true,
            order: 100,
            position: 0,
        },
        metadataUpdates = {},
        entryOverrides = {},
        refreshEditor = true,
        signal = null,
    } = options;

    throwIfStmbAborted(signal);
    const result = await upsertStmbEntryByTitle({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        title,
        content,
        defaults,
        metadataUpdates,
        entryOverrides,
    }, { signal });
    throwIfStmbAborted(signal);
    worldInfoCache.delete(lorebookName);
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }
    if (result?.entry && result.entry.uid !== undefined) {
        lorebookData.entries[result.entry.uid] = result.entry;
    }
    if (refreshEditor) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn('STMB side prompt refreshEditor failed', error);
        }
    }
    return { uid: result?.entry?.uid, created: Boolean(result?.created), entry: result?.entry };
}

async function upsertLorebookEntriesBatch(lorebookName, lorebookData, items, options = {}) {
    const {
        refreshEditor = true,
        signal = null,
    } = options;

    throwIfStmbAborted(signal);
    const result = await upsertStmbEntriesBatch({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        items,
    }, { signal });
    throwIfStmbAborted(signal);

    worldInfoCache.delete(lorebookName);
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    for (const batchResult of Array.isArray(result?.results) ? result.results : []) {
        if (batchResult?.entry?.uid !== undefined) {
            lorebookData.entries[batchResult.entry.uid] = batchResult.entry;
        }
    }

    if (refreshEditor) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn('STMB side prompt batch refreshEditor failed', error);
        }
    }

    return Array.isArray(result?.results) ? result.results : [];
}

function resolveSidePromptProfile(settings, overrideProfileIndex = null) {
    if (Number.isFinite(Number(overrideProfileIndex))) {
        return getActiveStmbProfile(settings, Number(overrideProfileIndex));
    }
    return getActiveStmbProfile(settings, null);
}

function formatRateLimitDelay(delayMs) {
    const seconds = Math.max(1, Math.ceil(Math.max(0, Number(delayMs) || 0) / 1000));
    return `${seconds}s`;
}

async function runWithConcurrencyLimit(items, limit, worker) {
    const source = Array.isArray(items) ? items : [];
    const results = new Array(source.length);
    const concurrency = Math.max(1, Math.trunc(Number(limit) || 1));
    let nextIndex = 0;

    async function runWorker() {
        for (;;) {
            const currentIndex = nextIndex++;
            if (currentIndex >= source.length) {
                return;
            }

            results[currentIndex] = await worker(source[currentIndex], currentIndex);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, source.length) }, () => runWorker()));
    return results;
}

async function runTextGeneration(prompt, settings, profile = null, signal = null, onRateLimitWait = null) {
    const { generateData } = await buildOpenAIGenerateData('quiet', [{ role: 'user', content: String(prompt || '') }], {});
    const result = await generateStmbText({
        generateData: applyStmbMaxTokensToGenerateData(
            applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
            settings?.moduleSettings?.maxTokens,
        ),
    }, { signal, onRateLimitWait });
    const cleanedText = removeReasoningFromString(String(result?.text ?? ''));
    return applyStmbIncomingRegex(cleanedText);
}

function getSidePromptTaskKey(template) {
    return String(template?.key || template?.name || 'unknown');
}

async function runSidePromptAttempt({
    template,
    taskLabel,
    finalPrompt,
    settings,
    profile = null,
    signal = null,
    onRateLimitWait = null,
}) {
    throwIfStmbAborted(signal);
    const task = createStmbTask(taskLabel || `SidePrompt:${getSidePromptTaskKey(template)}`);
    const forwardAbort = () => task.abort(signal?.reason || 'stmb-stop');

    if (signal) {
        if (signal.aborted) {
            task.abort(signal.reason || 'stmb-stop');
        } else {
            signal.addEventListener('abort', forwardAbort, { once: true });
        }
    }

    try {
        const text = await runTextGeneration(finalPrompt, settings, profile, task.signal, onRateLimitWait);
        throwIfStmbAborted(signal);
        task.throwIfAborted();
        return text;
    } finally {
        if (signal) {
            signal.removeEventListener?.('abort', forwardAbort);
        }
        task.cleanup();
    }
}

async function prepareSidePromptRun({ template, lorebookName, lorebookData, compiledScene, settings, profile = null, runtimeMacros = {}, fallbackKinds = [], signal = null }) {
    const unifiedTitle = getUnifiedSidePromptTitle(template, runtimeMacros);
    const existing = findFirstLorebookEntryByTitle(lorebookData, getSidePromptLookupTitles(template, runtimeMacros, fallbackKinds));
    const previousMemories = fetchPreviousMemories(lorebookData, Number(template?.settings?.previousMemoriesCount ?? 0));
    const finalPrompt = buildSidePromptText(
        template.prompt,
        existing?.content || '',
        compiledScene,
        template.responseFormat,
        previousMemories,
        runtimeMacros,
    );
    const overrideIndex = template?.settings?.overrideProfileEnabled
        ? Number(template?.settings?.overrideProfileIndex)
        : null;
    const resolvedProfile = Number.isFinite(overrideIndex)
        ? resolveSidePromptProfile(settings, overrideIndex)
        : (profile || resolveSidePromptProfile(settings, null));
    return {
        unifiedTitle,
        existing,
        finalPrompt: String(finalPrompt || ''),
        profile: resolvedProfile,
    };
}

async function compileRange(sceneStart, sceneEnd, settings = null, options = {}) {
    const result = await captureStmbSceneRange(
        { sceneStart, sceneEnd },
        {
            saveFirst: options.saveFirst !== false,
            skipSystemMessages: !settings?.moduleSettings?.unhideBeforeMemory,
            sceneContext: options.sceneContext || null,
        },
    );
    return result?.compiledScene;
}

export async function buildQueuedSidePromptJob({
    template,
    lorebookName,
    compiledScene,
    range = null,
    settings,
    profile = null,
    runtimeMacros = {},
    fallbackKinds = [],
    metadataUpdates = {},
    commitCheckpoint = null,
    trigger = 'manual',
    sceneContext = null,
}) {
    return {
        type: 'sidePrompt',
        range: range ? structuredClone(range) : (compiledScene?.metadata
            ? {
                sceneStart: compiledScene.metadata.sceneStart,
                sceneEnd: compiledScene.metadata.sceneEnd,
            }
            : null),
        lorebookName,
        sceneContext: sceneContext ? structuredClone(sceneContext) : structuredClone(buildStmbSceneContext()),
        title: String(template?.name || 'Side Prompt'),
        payload: {
            template: template ? structuredClone(template) : null,
            templateKey: String(template?.key || ''),
            templateName: String(template?.name || ''),
            lorebookName,
            compiledScene: compiledScene ? structuredClone(compiledScene) : null,
            range: range ? structuredClone(range) : null,
            settings: settings ? structuredClone(settings) : null,
            profile: profile ? structuredClone(profile) : null,
            runtimeMacros: structuredClone(runtimeMacros || {}),
            fallbackKinds: Array.isArray(fallbackKinds) ? fallbackKinds.slice() : [],
            metadataUpdates: structuredClone(metadataUpdates || {}),
            commitCheckpoint: commitCheckpoint ? structuredClone(commitCheckpoint) : null,
            trigger,
        },
    };
}

export async function buildQueuedAfterMemorySidePromptJobs({
    lorebookName,
    compiledScene,
    range = null,
    settings,
    profile = null,
    sceneContext = null,
}) {
    const selectedSetKey = getSelectedAfterMemorySetKey();
    let selectedSet = null;
    let runItems = [];
    if (selectedSetKey) {
        const resolvedSet = await resolveSetItemsForRun(selectedSetKey, {}, { allowUnresolved: false });
        selectedSet = resolvedSet.set;
        logSkippedSetItems(resolvedSet.skipped, 'onAfterMemory');
        const missingMacros = summarizeMissingSetMacros(resolvedSet.skipped);
        if (!selectedSet) {
            toastr.warning('Selected side prompt set was not found. No after-memory side prompts were queued.', 'STMB');
            return [];
        }
        if (missingMacros.length > 0) {
            toastr.warning(`Skipped side prompt set items with unresolved macros: ${missingMacros.join(', ')}.`, 'STMB');
        }
        runItems = (resolvedSet.runnable || []).map(item => ({
            template: item.template,
            runtimeMacros: item.runtimeMacros || {},
            fallbackKinds: ['plotpoints', 'scoreboard'],
            displayName: String(item.item?.label || item.baseTemplate?.name || item.template?.name || 'Side Prompt'),
            setKey: selectedSet.key,
            setName: selectedSet.name,
            setItemId: item.item?.id || '',
        }));
    } else {
        const templates = await listByTrigger('onAfterMemory');
        runItems = (templates || []).map(template => ({
            template,
            runtimeMacros: {},
            fallbackKinds: ['plotpoints', 'scoreboard'],
            displayName: String(template?.name || 'Side Prompt'),
            setKey: '',
            setName: '',
            setItemId: '',
        }));
    }

    if (!runItems || runItems.length === 0) {
        return [];
    }

    const maxConcurrent = resolveSidePromptMaxConcurrent(settings);
    const checkpointTimestamp = new Date().toISOString();
    const jobs = [];
    const resolveContext = { memoryLorebookName: lorebookName };
    const itemsByLorebook = new Map();

    for (const runItem of runItems) {
        const target = await resolveSidePromptLorebook(runItem.template, settings, resolveContext);
        if (!itemsByLorebook.has(target.name)) {
            itemsByLorebook.set(target.name, []);
        }
        itemsByLorebook.get(target.name).push(runItem);
    }

    for (const [targetLorebookName, targetItems] of itemsByLorebook.entries()) {
        for (let index = 0; index < targetItems.length; index += maxConcurrent) {
            const waveItems = targetItems.slice(index, index + maxConcurrent);
            jobs.push({
                type: 'sidePromptBatch',
                range: range ? structuredClone(range) : (compiledScene?.metadata
                    ? {
                        sceneStart: compiledScene.metadata.sceneStart,
                        sceneEnd: compiledScene.metadata.sceneEnd,
                    }
                    : null),
                lorebookName: targetLorebookName,
                sceneContext: sceneContext ? structuredClone(sceneContext) : structuredClone(buildStmbSceneContext()),
                title: makeSidePromptBatchTitle(waveItems, selectedSet),
                detail: range || compiledScene?.metadata
                    ? `Messages ${range?.sceneStart ?? compiledScene?.metadata?.sceneStart}-${range?.sceneEnd ?? compiledScene?.metadata?.sceneEnd}`
                    : '',
                payload: {
                    lorebookName: targetLorebookName,
                    compiledScene: compiledScene ? structuredClone(compiledScene) : null,
                    range: range ? structuredClone(range) : null,
                    settings: settings ? structuredClone(settings) : null,
                    profile: profile ? structuredClone(profile) : null,
                    trigger: 'onAfterMemory',
                    setKey: selectedSet?.key || '',
                    setName: selectedSet?.name || '',
                    templates: waveItems.map(runItem => ({
                        template: runItem.template ? structuredClone(runItem.template) : null,
                        templateKey: String(runItem.template?.key || ''),
                        templateName: String(runItem.template?.name || ''),
                        displayName: String(runItem.displayName || runItem.template?.name || ''),
                        setItemId: String(runItem.setItemId || ''),
                        setKey: String(runItem.setKey || ''),
                        setName: String(runItem.setName || ''),
                        runtimeMacros: structuredClone(runItem.runtimeMacros || {}),
                        fallbackKinds: Array.isArray(runItem.fallbackKinds) ? runItem.fallbackKinds.slice() : ['plotpoints', 'scoreboard'],
                        metadataUpdates: buildSidePromptCheckpointMetadata(runItem.template.key, {
                            lastRunAt: checkpointTimestamp,
                            includeLastMsgId: false,
                            includeTrackerFallback: false,
                        }),
                        commitCheckpoint: {
                            templateKey: runItem.template.key,
                            includeLastMsgId: false,
                            includeTrackerFallback: false,
                        },
                    })),
                },
            });
        }
    }

    return jobs;
}

function buildQueuedSidePromptBatchJobFromItems({
    runItems,
    set = null,
    lorebookName,
    compiledScene,
    range = null,
    settings,
    profile = null,
    trigger = 'manual',
    sceneContext = null,
    includeLastMsgId = true,
}) {
    const checkpointTimestamp = new Date().toISOString();
    const endId = compiledScene?.metadata?.sceneEnd ?? range?.sceneEnd;
    return {
        type: 'sidePromptBatch',
        range: range ? structuredClone(range) : (compiledScene?.metadata
            ? {
                sceneStart: compiledScene.metadata.sceneStart,
                sceneEnd: compiledScene.metadata.sceneEnd,
            }
            : null),
        lorebookName,
        sceneContext: sceneContext ? structuredClone(sceneContext) : structuredClone(buildStmbSceneContext()),
        title: makeSidePromptBatchTitle(runItems, set),
        detail: range || compiledScene?.metadata
            ? `Messages ${range?.sceneStart ?? compiledScene?.metadata?.sceneStart}-${range?.sceneEnd ?? compiledScene?.metadata?.sceneEnd}`
            : '',
        payload: {
            lorebookName,
            compiledScene: compiledScene ? structuredClone(compiledScene) : null,
            range: range ? structuredClone(range) : null,
            settings: settings ? structuredClone(settings) : null,
            profile: profile ? structuredClone(profile) : null,
            trigger,
            setKey: set?.key || '',
            setName: set?.name || '',
            templates: runItems.map(runItem => {
                const template = runItem.template;
                return {
                    template: template ? structuredClone(template) : null,
                    templateKey: String(template?.key || ''),
                    templateName: String(template?.name || ''),
                    displayName: String(runItem.displayName || template?.name || ''),
                    setItemId: String(runItem.setItemId || ''),
                    setKey: String(runItem.setKey || set?.key || ''),
                    setName: String(runItem.setName || set?.name || ''),
                    runtimeMacros: structuredClone(runItem.runtimeMacros || {}),
                    fallbackKinds: Array.isArray(runItem.fallbackKinds) ? runItem.fallbackKinds.slice() : ['scoreboard', 'plotpoints', 'tracker'],
                    metadataUpdates: buildSidePromptCheckpointMetadata(template.key, {
                        lastMsgId: endId,
                        lastRunAt: checkpointTimestamp,
                        includeLastMsgId,
                        includeTrackerFallback: includeLastMsgId,
                    }),
                    commitCheckpoint: {
                        templateKey: template.key,
                        lastMsgId: endId,
                        includeLastMsgId,
                        includeTrackerFallback: includeLastMsgId,
                    },
                };
            }),
        },
    };
}

export async function buildQueuedSidePromptWorkflowJobs({
    template,
    lorebookName,
    compiledScene,
    range = null,
    settings,
    profile = null,
    runtimeMacros = {},
    fallbackKinds = [],
    metadataUpdates = {},
    commitCheckpoint = null,
    trigger = 'manual',
    sceneContext = null,
}) {
    const job = await buildQueuedSidePromptJob({
        template,
        lorebookName,
        compiledScene,
        range,
        settings,
        profile,
        runtimeMacros,
        fallbackKinds,
        metadataUpdates,
        commitCheckpoint,
        trigger,
        sceneContext,
    });
    return [job];
}

function ensureSidePromptTextNotBlank(text, template, trigger) {
    if (String(text || '').trim()) return true;
    toastr.error(`SidePrompt "${template?.name || 'Unknown'}" returned blank content. No changes were saved.`, 'STMB');
    console.error('STMB SidePrompt blank response', { trigger, template: template?.key || template?.name || null });
    return false;
}

function buildSidePromptPreviewSceneData(compiledScene) {
    return {
        sceneStart: compiledScene?.metadata?.sceneStart,
        sceneEnd: compiledScene?.metadata?.sceneEnd,
        messageCount: compiledScene?.metadata?.messageCount,
    };
}

function buildSidePromptApprovalRequest({
    template,
    unifiedTitle,
    text,
    compiledScene,
    profile,
    allowRetry = true,
}) {
    return {
        kind: 'sidePromptApproval',
        title: String(unifiedTitle || template?.name || 'Side Prompt'),
        content: String(text || ''),
        sceneData: buildSidePromptPreviewSceneData(compiledScene),
        profile: profile ? structuredClone(profile) : null,
        allowRetry,
        lockTitle: true,
    };
}

async function resolveSidePromptPreview({
    template,
    unifiedTitle,
    initialText,
    finalPrompt,
    settings = null,
    profile,
    compiledScene,
    signal = null,
    queuePreview = false,
    allowRetry = true,
    retryTaskLabel = null,
}) {
    let textToSave = initialText;

    while (true) {
        throwIfStmbAborted(signal);
        const openPreview = () => showMemoryPreviewPopup({
            extractedTitle: unifiedTitle,
            content: textToSave,
            suggestedKeys: [],
        }, buildSidePromptPreviewSceneData(compiledScene), profile, { lockTitle: true });
        const previewResult = queuePreview
            ? await enqueuePreview(openPreview)
            : await openPreview();

        if (previewResult?.action === 'cancel') {
            return { approved: false, text: textToSave };
        }

        if (previewResult?.action === 'retry') {
            if (!allowRetry) {
                return { approved: false, retry: true, text: textToSave };
            }

            textToSave = await runSidePromptAttempt({
                template,
                taskLabel: retryTaskLabel || `SidePrompt:retry:${getSidePromptTaskKey(template)}`,
                finalPrompt,
                settings,
                profile,
                signal,
            });
            if (!ensureSidePromptTextNotBlank(textToSave, template, 'retry')) {
                return { approved: false, blank: true, text: textToSave };
            }
            continue;
        }

        if (previewResult?.action === 'edit' && previewResult.memoryData) {
            textToSave = String(previewResult.memoryData.content ?? textToSave);
        }

        return { approved: true, text: textToSave };
    }
}

async function runTemplateForCompiledScene({
    template,
    lorebookName,
    lorebookData,
    compiledScene,
    settings,
    profile = null,
    runtimeMacros = {},
    fallbackKinds = [],
    metadataUpdates = {},
    trigger = 'manual',
    previewAllowRetry = true,
    signal = null,
}) {
    for (;;) {
        throwIfStmbAborted(signal);
        const prepared = await prepareSidePromptRun({
            template,
            lorebookName,
            lorebookData,
            compiledScene,
            settings,
            profile,
            runtimeMacros,
            fallbackKinds,
            signal,
        });
        let resultText = await runSidePromptAttempt({
            template,
            taskLabel: `SidePrompt:${trigger}:${getSidePromptTaskKey(template)}`,
            finalPrompt: prepared.finalPrompt,
            settings,
            profile: prepared.profile,
            signal,
        });
        throwIfStmbAborted(signal);
        if (!ensureSidePromptTextNotBlank(resultText, template, fallbackKinds[0] || 'manual')) {
            return { status: 'blank' };
        }

        if (settings?.moduleSettings?.showMemoryPreviews) {
            try {
                const previewResult = await resolveSidePromptPreview({
                    template,
                    unifiedTitle: prepared.unifiedTitle,
                    initialText: resultText,
                    finalPrompt: prepared.finalPrompt,
                    settings,
                    profile: prepared.profile,
                    compiledScene,
                    signal,
                    queuePreview: true,
                    allowRetry: previewAllowRetry,
                    retryTaskLabel: `SidePrompt:${trigger}:retry:${getSidePromptTaskKey(template)}`,
                });
                if (previewResult?.blank) {
                    return { status: 'blank' };
                }
                if (!previewResult?.approved) {
                    return { status: 'cancel' };
                }
                resultText = String(previewResult.text ?? resultText);
            } catch (error) {
                if (isStmbAbortError(error)) {
                    throw error;
                }
                console.warn('STMB side prompt preview failed; proceeding without preview', {
                    trigger,
                    template: getSidePromptTaskKey(template),
                    error,
                });
            }
        }

        const lorebookSettings = getEffectiveLorebookSettingsForTemplate(template);
        const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lorebookSettings, runtimeMacros);
        return await upsertLorebookEntryByTitle(
            lorebookName,
            lorebookData,
            prepared.unifiedTitle,
            resultText,
            {
                defaults,
                entryOverrides,
                metadataUpdates,
                refreshEditor: settings?.moduleSettings?.refreshEditor !== false,
                signal,
            },
        );
    }
}

export async function evaluateTrackers(settings, options = {}) {
    if (trackerEvaluationPromise) {
        return trackerEvaluationPromise;
    }

    trackerEvaluationPromise = (async () => {
        const parentTask = options.signal ? null : createStmbTask('SidePrompts:onInterval');
        const signal = options.signal || parentTask?.signal || null;
        const sceneContext = options.sceneContext || null;
        try {
            const templates = await listByTrigger('onInterval');
            if (!templates || templates.length === 0) return;

            const chatRangeInfo = await fetchStmbChatRangeInfo({ saveFirst: false, sceneContext });
            const currentLast = Number(chatRangeInfo?.lastAvailableMessageId);
            if (currentLast < 0) return;
            const jobs = [];
            const lorebookResolveContext = {};

            for (const template of templates) {
                throwIfStmbAborted(signal);
                const targetLorebook = await resolveSidePromptLorebook(template, settings, lorebookResolveContext);
                const lorebookName = targetLorebook.name;
                const lorebookData = targetLorebook.data || { entries: {} };
                const lookupTitles = getSidePromptLookupTitles(template, {}, ['tracker']);
                const existing = findFirstLorebookEntryByTitle(lorebookData, lookupTitles);
                const checkpoint = resolveSidePromptCheckpoint(template.key, existing);
                const lastMessageId = checkpoint.lastMsgId;
                const lastRunAt = checkpoint.lastRunAt;
                if (lastRunAt && Date.now() - lastRunAt < 10000) {
                    continue;
                }

                const threshold = Math.max(1, Number(template?.triggers?.onInterval?.visibleMessages ?? 50));
                const rangeInfo = await fetchStmbChatRangeInfo({
                    rangeStart: Math.max(0, lastMessageId + 1),
                    rangeEnd: currentLast,
                    saveFirst: false,
                    sceneContext,
                });
                if (Array.isArray(rangeInfo?.missingRanges) && rangeInfo.missingRanges.length > 0) {
                    continue;
                }
                const visibleSince = Number(rangeInfo?.visibleMessageCount) || 0;
                if (visibleSince < threshold) continue;

                const start = Math.max(0, lastMessageId + 1);
                const boundedStart = Math.max(start, currentLast - 199);
                let compiledScene;
                try {
                    compiledScene = await compileRange(boundedStart, currentLast, settings, { saveFirst: false, sceneContext });
                } catch {
                    continue;
                }

                const endId = compiledScene?.metadata?.sceneEnd ?? currentLast;
                const checkpointTimestamp = new Date().toISOString();
                jobs.push(await buildQueuedSidePromptJob({
                    template,
                    lorebookName,
                    compiledScene,
                    settings,
                    fallbackKinds: ['tracker'],
                    trigger: 'onInterval',
                    metadataUpdates: buildSidePromptCheckpointMetadata(template.key, {
                        lastMsgId: endId,
                        lastRunAt: checkpointTimestamp,
                    }),
                    commitCheckpoint: {
                        templateKey: template.key,
                        lastMsgId: endId,
                        includeLastMsgId: true,
                        includeTrackerFallback: true,
                    },
                    sceneContext,
                }));
            }

            if (jobs.length > 0) {
                ensureSidePromptJobExecutorRegistered();
                for (const job of jobs) {
                    enqueueStmbJob(job);
                }
            }
        } catch (error) {
            if (!isStmbAbortError(error) && !isStmbLorebookHandledError(error)) {
                console.warn('STMB evaluateTrackers failed', error);
            }
        } finally {
            parentTask?.cleanup();
        }
    })();

    try {
        return await trackerEvaluationPromise;
    } finally {
        trackerEvaluationPromise = null;
    }
}

export async function runAfterMemory(compiledScene, settings, profile = null, options = {}) {
    return enqueueAfterMemorySidePromptJobs(compiledScene, settings, profile, options);
}

export async function enqueueAfterMemorySidePromptJobs(compiledScene, settings, profile = null, options = {}) {
    throwIfStmbAborted(options.signal || null);
    const lorebookName = options.lorebookName || await ensureLorebookName(settings);
    const sceneContext = options.sceneContext || buildStmbSceneContext();
    const range = options.range || {
        sceneStart: compiledScene?.metadata?.sceneStart,
        sceneEnd: compiledScene?.metadata?.sceneEnd,
    };
    const jobs = await buildQueuedAfterMemorySidePromptJobs({
        lorebookName,
        compiledScene,
        range,
        settings,
        profile,
        sceneContext,
    });
    ensureSidePromptJobExecutorRegistered();
    for (const job of jobs) {
        enqueueStmbJob(job);
    }
    return jobs.length;
}

export { firstRunInitSidePrompts };

export async function runSidePrompt(rawInput, settings, options = {}) {
    let activeTemplateName = '';
    try {
        const sceneContext = options.sceneContext || buildStmbSceneContext();
        const parsed = parseSidePromptCommandInput(rawInput);
        if (parsed.error || !parsed.name) {
            toastr.error('SidePrompt name not provided. Usage: /sideprompt "Name" {{macro}}="value" [X-Y]', 'STMB');
            return '';
        }

        const template = await findTemplateByName(parsed.name);
        if (!template) {
            toastr.error('SidePrompt template not found. Check name.', 'STMB');
            return '';
        }
        activeTemplateName = String(template.name || '');
        const targetLorebook = await resolveSidePromptLorebook(template, settings);
        const lorebookName = targetLorebook.name;
        const lorebookData = targetLorebook.data || { entries: {} };

        const manualEnabled = Array.isArray(template?.triggers?.commands)
            && template.triggers.commands.some(command => String(command).toLowerCase() === 'sideprompt');
        if (!manualEnabled) {
            toastr.error('Manual run is disabled for this template. Enable "Allow manual run via /sideprompt" in the template settings.', 'STMB');
            return '';
        }

        const requiredRuntimeMacros = collectTemplateRuntimeMacros(template);
        const missingRuntimeMacros = requiredRuntimeMacros.filter(token => !Object.hasOwn(parsed.runtimeMacros, token));
        if (missingRuntimeMacros.length > 0) {
            const usage = requiredRuntimeMacros.map(token => `${token}="value"`).join(' ');
            toastr.error(`SidePrompt "${template.name}" requires: ${missingRuntimeMacros.join(', ')}. Usage: /sideprompt "${template.name}" ${usage} [X-Y]`, 'STMB');
            return '';
        }

        const chatRangeInfo = await fetchStmbChatRangeInfo();
        const currentLast = Number(chatRangeInfo?.lastAvailableMessageId);
        if (currentLast < 0) {
            toastr.error('No messages available.', 'STMB');
            return '';
        }

        let compiledScene;
        if (parsed.range) {
            const match = parsed.range.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
            if (!match) {
                toastr.error('Invalid range format. Use X-Y', 'STMB');
                return '';
            }

            const sceneStart = Number(match[1]);
            const sceneEnd = Number(match[2]);
            if (!(sceneStart >= 0 && sceneEnd >= sceneStart)) {
                toastr.error('Invalid message range for /sideprompt', 'STMB');
                return '';
            }

            try {
                compiledScene = await compileRange(sceneStart, sceneEnd, settings, { saveFirst: false, sceneContext });
            } catch (error) {
                toastr.error(String(error?.message || 'Failed to compile the specified range'), 'STMB');
                return '';
            }
        } else {
            if (!hasShownSidePromptRangeTip) {
                toastr.info('Tip: You can run a specific range with /sideprompt "Name" {{macro}}="value" X-Y (e.g., /sideprompt "Scoreboard" 100-120). Running without a range uses messages since the last checkpoint.', 'STMB');
                hasShownSidePromptRangeTip = true;
            }

            const existing = findFirstLorebookEntryByTitle(
                lorebookData,
                getSidePromptLookupTitles(template, parsed.runtimeMacros, ['scoreboard', 'plotpoints', 'tracker']),
            );
            const checkpoint = resolveSidePromptCheckpoint(template.key, existing, { includeLegacyScore: true });
            const lastMessageId = checkpoint.lastMsgId;
            const sceneStart = Math.max(0, lastMessageId + 1);
            const boundedStart = Math.max(sceneStart, currentLast - 199);
            try {
                compiledScene = await compileRange(boundedStart, currentLast, settings, { saveFirst: false, sceneContext });
            } catch {
                toastr.error('Failed to compile messages for /sideprompt', 'STMB');
                return '';
            }
        }

        const endId = compiledScene?.metadata?.sceneEnd ?? currentLast;
        const checkpointTimestamp = new Date().toISOString();
        const jobs = await buildQueuedSidePromptWorkflowJobs({
            template,
            lorebookName,
            compiledScene,
            range: {
                sceneStart: compiledScene?.metadata?.sceneStart,
                sceneEnd: compiledScene?.metadata?.sceneEnd,
            },
            settings,
            runtimeMacros: parsed.runtimeMacros,
            fallbackKinds: ['scoreboard', 'plotpoints', 'tracker'],
            trigger: 'manual',
            metadataUpdates: buildSidePromptCheckpointMetadata(template.key, {
                lastMsgId: endId,
                lastRunAt: checkpointTimestamp,
            }),
            commitCheckpoint: {
                templateKey: template.key,
                lastMsgId: endId,
                includeLastMsgId: true,
                includeTrackerFallback: true,
            },
            sceneContext,
        });
        ensureSidePromptJobExecutorRegistered();
        for (const job of jobs) {
            enqueueStmbJob(job);
        }
        return '';
    } catch (error) {
        if (isStmbAbortError(error) || isStmbLorebookHandledError(error)) {
            return '';
        }
        console.error('STMB /sideprompt failed', error);
        if (error?.message) {
            if (activeTemplateName) {
                toastr.error(`SidePrompt "${activeTemplateName}" failed: ${error.message}`, 'STMB');
            } else {
                toastr.error(String(error.message), 'STMB');
            }
        }
        return '';
    }
}

export async function runSidePromptSet(rawInput, settings, options = {}) {
    const macroMode = Boolean(options.macroMode);
    try {
        const sceneContext = options.sceneContext || buildStmbSceneContext();
        const parsed = parseSidePromptCommandInput(rawInput);
        if (parsed.error || !parsed.name) {
            toastr.error(macroMode
                ? 'SidePrompt macroset guide: Choose a quoted set name, then fill any prompted macros. Usage: /sideprompt-macroset "Name" {{macro}}="value" [X-Y].'
                : 'Side prompt set name not provided. Usage: /sideprompt-set "Name" [X-Y]',
            'STMB');
            return '';
        }

        const set = await findSetByName(parsed.name);
        if (!set) {
            toastr.error('Side prompt set not found. Check name.', 'STMB');
            return '';
        }

        const resolvedSet = await resolveSetItemsForRun(set.key, parsed.runtimeMacros || {}, { allowUnresolved: false });
        logSkippedSetItems(resolvedSet.skipped, macroMode ? 'macroset' : 'sideprompt-set');
        const missingRuntimeMacros = summarizeMissingSetMacros(resolvedSet.skipped);
        if (missingRuntimeMacros.length > 0) {
            const usage = missingRuntimeMacros.map(token => `${token}="value"`).join(' ');
            toastr.error(`Side prompt set "${set.name}" requires: ${missingRuntimeMacros.join(', ')}. Usage: /sideprompt-macroset "${set.name}" ${usage} [X-Y]`, 'STMB');
            return '';
        }

        const runItems = (resolvedSet.runnable || []).map(item => ({
            template: item.template,
            runtimeMacros: item.runtimeMacros || {},
            fallbackKinds: ['scoreboard', 'plotpoints', 'tracker'],
            displayName: String(item.item?.label || item.baseTemplate?.name || item.template?.name || 'Side Prompt'),
            setKey: set.key,
            setName: set.name,
            setItemId: item.item?.id || '',
        }));
        if (runItems.length === 0) {
            toastr.warning('No runnable side prompts were found in this set.', 'STMB');
            return '';
        }

        const chatRangeInfo = await fetchStmbChatRangeInfo();
        const currentLast = Number(chatRangeInfo?.lastAvailableMessageId);
        if (currentLast < 0) {
            toastr.error('No messages available.', 'STMB');
            return '';
        }

        const resolveContext = {};
        const targetByItemId = new Map();
        let compiledScene;
        if (parsed.range) {
            const match = parsed.range.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
            if (!match) {
                toastr.error('Invalid range format. Use X-Y', 'STMB');
                return '';
            }

            const sceneStart = Number(match[1]);
            const sceneEnd = Number(match[2]);
            if (!(sceneStart >= 0 && sceneEnd >= sceneStart && sceneEnd <= currentLast)) {
                toastr.error('Invalid message range for /sideprompt-set', 'STMB');
                return '';
            }

            try {
                compiledScene = await compileRange(sceneStart, sceneEnd, settings, { saveFirst: false, sceneContext });
            } catch (error) {
                toastr.error(String(error?.message || 'Failed to compile the specified range'), 'STMB');
                return '';
            }
        } else {
            if (!hasShownSidePromptRangeTip) {
                toastr.info('Tip: You can run a specific range with /sideprompt-set "Name" X-Y. Running without a range uses messages since the earliest checkpoint in the set.', 'STMB');
                hasShownSidePromptRangeTip = true;
            }

            let earliestLastMessageId = null;
            for (const runItem of runItems) {
                const target = await resolveSidePromptLorebook(runItem.template, settings, resolveContext);
                targetByItemId.set(runItem.setItemId, target);
                const lorebookData = target.data || { entries: {} };
                const existing = findFirstLorebookEntryByTitle(
                    lorebookData,
                    getSidePromptLookupTitles(runItem.template, runItem.runtimeMacros, ['scoreboard', 'plotpoints', 'tracker']),
                );
                const checkpoint = resolveSidePromptCheckpoint(runItem.template.key, existing, { includeLegacyScore: true });
                earliestLastMessageId = earliestLastMessageId === null
                    ? checkpoint.lastMsgId
                    : Math.min(earliestLastMessageId, checkpoint.lastMsgId);
            }

            const sceneStart = Math.max(0, (earliestLastMessageId ?? getHighestProcessedMessageBaseline()) + 1);
            const boundedStart = Math.max(sceneStart, currentLast - 199);
            try {
                compiledScene = await compileRange(boundedStart, currentLast, settings, { saveFirst: false, sceneContext });
            } catch {
                toastr.error('Failed to compile messages for /sideprompt-set', 'STMB');
                return '';
            }
        }

        const groups = new Map();
        for (const runItem of runItems) {
            const target = targetByItemId.get(runItem.setItemId) || await resolveSidePromptLorebook(runItem.template, settings, resolveContext);
            if (!groups.has(target.name)) {
                groups.set(target.name, []);
            }
            groups.get(target.name).push(runItem);
        }

        ensureSidePromptJobExecutorRegistered();
        const range = {
            sceneStart: compiledScene?.metadata?.sceneStart,
            sceneEnd: compiledScene?.metadata?.sceneEnd,
        };
        let queued = 0;
        for (const [targetLorebookName, targetRunItems] of groups.entries()) {
            enqueueStmbJob(buildQueuedSidePromptBatchJobFromItems({
                runItems: targetRunItems,
                set,
                lorebookName: targetLorebookName,
                compiledScene,
                range,
                settings,
                profile: null,
                trigger: macroMode ? 'macroset' : 'sideprompt-set',
                sceneContext,
                includeLastMsgId: true,
            }));
            queued++;
        }

        toastr.info(`Side prompt set "${set.name}" queued: ${queued} job${queued === 1 ? '' : 's'}.`, 'STMB');
        return '';
    } catch (error) {
        if (isStmbAbortError(error) || isStmbLorebookHandledError(error)) {
            return '';
        }
        console.error('STMB /sideprompt-set failed', error);
        toastr.error(error?.message || 'Failed to queue side prompt set.', 'STMB');
        return '';
    }
}

async function executeSidePromptJob(job, context) {
    const payload = job?.payload || {};
    const settings = payload.settings || null;
    const signal = context.signal;
    const template = payload.template && typeof payload.template === 'object'
        ? structuredClone(payload.template)
        : payload.templateKey
            ? await getTemplate(payload.templateKey)
            : await findTemplateByName(payload.templateName || job?.title || '');
    if (!template) {
        throw new Error(`SidePrompt template "${payload.templateName || payload.templateKey || job?.title || 'unknown'}" not found.`);
    }

    context.setState('capturing_scene', { detail: getRangeLabelForJob(job) });
    let compiledScene = payload.compiledScene ? structuredClone(payload.compiledScene) : null;
    if (!compiledScene) {
        const range = payload.range || job?.range || null;
        if (!Number.isInteger(Number(range?.sceneStart)) || !Number.isInteger(Number(range?.sceneEnd))) {
            throw new Error('SidePrompt job is missing a valid message range.');
        }
        compiledScene = await compileRange(
            Number(range.sceneStart),
            Number(range.sceneEnd),
            settings,
            { saveFirst: false, sceneContext: job?.sceneContext || null },
        );
    }

    const lorebookName = String(payload.lorebookName || job?.lorebookName || '').trim();
    if (!lorebookName) {
        throw new Error('SidePrompt job is missing a lorebook.');
    }

    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    context.setState('assembling_prompt', { detail: template.name || 'Side Prompt' });
    const prepared = await prepareSidePromptRun({
        template,
        lorebookName,
        lorebookData,
        compiledScene,
        settings,
        profile: payload.profile || null,
        runtimeMacros: payload.runtimeMacros || {},
        fallbackKinds: payload.fallbackKinds || [],
        signal,
    });

    context.setState('generating', { detail: template.name || 'Side Prompt' });
    let resultText = await runSidePromptAttempt({
        template,
        taskLabel: `SidePrompt:${payload.trigger || 'queued'}:${getSidePromptTaskKey(template)}`,
        finalPrompt: prepared.finalPrompt,
        settings,
        profile: prepared.profile,
        signal,
        onRateLimitWait: wait => context.setState('generating', {
            detail: `Rate limited, retrying in ${formatRateLimitDelay(wait?.delayMs)}`,
        }),
    });
    if (!ensureSidePromptTextNotBlank(resultText, template, payload.trigger || 'queued')) {
        throw new Error(`SidePrompt "${template?.name || 'Unknown'}" returned blank content.`);
    }

    if (settings?.moduleSettings?.showMemoryPreviews) {
        const approvalResult = await awaitStmbJobApproval(
            context,
            buildSidePromptApprovalRequest({
                template,
                unifiedTitle: prepared.unifiedTitle,
                text: resultText,
                compiledScene,
                profile: prepared.profile,
                allowRetry: true,
            }),
            { detail: template.name || 'Side Prompt' },
        );
        if (!approvalResult || approvalResult.decision === 'cancel' || approvalResult.decision === 'reject') {
            context.patch({ state: 'canceled', detail: 'Canceled in approval' });
            return;
        }
        if (approvalResult.decision === 'retry') {
            resultText = await runSidePromptAttempt({
                template,
                taskLabel: `SidePrompt:${payload.trigger || 'queued'}:retry:${getSidePromptTaskKey(template)}`,
                finalPrompt: prepared.finalPrompt,
                settings,
                profile: prepared.profile,
                signal,
                onRateLimitWait: wait => context.setState('generating', {
                    detail: `Rate limited, retrying in ${formatRateLimitDelay(wait?.delayMs)}`,
                }),
            });
            if (!ensureSidePromptTextNotBlank(resultText, template, `${payload.trigger || 'queued'}-retry`)) {
                throw new Error(`SidePrompt "${template?.name || 'Unknown'}" returned blank content.`);
            }
        } else if (approvalResult.editedData && typeof approvalResult.editedData === 'object') {
            resultText = String(approvalResult.editedData.content || resultText);
        }
    }

    context.setState('saving', { detail: prepared.unifiedTitle });
    const lorebookSettings = getEffectiveLorebookSettingsForTemplate(template);
    const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lorebookSettings, payload.runtimeMacros || {});
    const result = await upsertLorebookEntryByTitle(
        lorebookName,
        lorebookData,
        prepared.unifiedTitle,
        resultText,
        {
            defaults,
            entryOverrides,
            metadataUpdates: payload.metadataUpdates || {},
            refreshEditor: settings?.moduleSettings?.refreshEditor !== false,
            signal,
        },
    );
    context.setResult({
        type: 'sidePrompt',
        title: prepared.unifiedTitle,
        lorebookName,
        created: Boolean(result?.created),
        uid: result?.uid,
    });
}

async function executeSidePromptBatchJob(job, context) {
    const payload = job?.payload || {};
    const settings = payload.settings || null;
    const signal = context.signal;
    const templateInputs = Array.isArray(payload.templates) ? payload.templates : [];

    if (templateInputs.length === 0) {
        throw new Error('SidePrompt batch job is missing templates.');
    }

    context.setState('capturing_scene', { detail: getRangeLabelForJob(job) });
    let compiledScene = payload.compiledScene ? structuredClone(payload.compiledScene) : null;
    if (!compiledScene) {
        const range = payload.range || job?.range || null;
        if (!Number.isInteger(Number(range?.sceneStart)) || !Number.isInteger(Number(range?.sceneEnd))) {
            throw new Error('SidePrompt batch job is missing a valid message range.');
        }
        compiledScene = await compileRange(
            Number(range.sceneStart),
            Number(range.sceneEnd),
            settings,
            { saveFirst: false, sceneContext: job?.sceneContext || null },
        );
    }

    const lorebookName = String(payload.lorebookName || job?.lorebookName || '').trim();
    if (!lorebookName) {
        throw new Error('SidePrompt batch job is missing a lorebook.');
    }

    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    context.setState('assembling_prompt', {
        detail: templateInputs.length === 1 ? '1 side prompt' : `${templateInputs.length} side prompts`,
    });

    let completionOrder = 0;
    context.setState('generating', {
        detail: templateInputs.length === 1 ? '1 side prompt' : `${templateInputs.length} side prompts`,
    });
    const generationResults = await runWithConcurrencyLimit(templateInputs, resolveSidePromptMaxConcurrent(settings), async input => {
        const template = input?.template && typeof input.template === 'object'
            ? structuredClone(input.template)
            : input?.templateKey
                ? await getTemplate(input.templateKey)
                : await findTemplateByName(input?.templateName || '');
        if (!template) {
            return {
                ok: false,
                error: new Error(`SidePrompt template "${input?.templateName || input?.templateKey || 'unknown'}" not found.`),
                templateName: String(input?.displayName || input?.templateName || input?.templateKey || 'Unknown'),
                completedOrder: completionOrder++,
            };
        }

        try {
            const prepared = await prepareSidePromptRun({
                template,
                lorebookName,
                lorebookData,
                compiledScene,
                settings,
                profile: payload.profile || null,
                runtimeMacros: input?.runtimeMacros || {},
                fallbackKinds: input?.fallbackKinds || [],
                signal,
            });
            const resultText = await runSidePromptAttempt({
                template,
                taskLabel: `SidePrompt:${payload.trigger || 'batch'}:${getSidePromptTaskKey(template)}`,
                finalPrompt: prepared.finalPrompt,
                settings,
                profile: prepared.profile,
                signal,
                onRateLimitWait: wait => context.setState('generating', {
                    detail: `Rate limited, retrying in ${formatRateLimitDelay(wait?.delayMs)} (${template?.name || 'Side Prompt'})`,
                }),
            });
            return {
                ok: true,
                template,
                input,
                prepared,
                resultText,
                completedOrder: completionOrder++,
            };
        } catch (error) {
            if (isStmbAbortError(error)) {
                throw error;
            }
            return {
                ok: false,
                error,
                template,
                input,
                templateName: String(input?.displayName || template?.name || input?.templateName || input?.templateKey || 'Unknown'),
                completedOrder: completionOrder++,
            };
        }
    });

    generationResults.sort((left, right) => left.completedOrder - right.completedOrder);

    const batchItems = [];
    const failures = [];
    const canceled = [];

    for (const generationResult of generationResults) {
        if (!generationResult.ok) {
            failures.push({
                templateName: generationResult.templateName,
                message: String(generationResult.error?.message || 'Unknown side prompt failure'),
            });
            continue;
        }

        const { template, input, prepared } = generationResult;
        let resultText = generationResult.resultText;
        if (!ensureSidePromptTextNotBlank(resultText, template, payload.trigger || 'batch')) {
            failures.push({
                templateName: String(input?.displayName || template?.name || 'Unknown'),
                message: 'SidePrompt returned blank content.',
            });
            continue;
        }

        if (settings?.moduleSettings?.showMemoryPreviews) {
            const approvalResult = await awaitStmbJobApproval(
                context,
                buildSidePromptApprovalRequest({
                    template,
                    unifiedTitle: prepared.unifiedTitle,
                    text: resultText,
                    compiledScene,
                    profile: prepared.profile,
                    allowRetry: true,
                }),
                { detail: template?.name || 'Side Prompt' },
            );
            if (approvalResult?.decision === 'retry') {
                resultText = await runSidePromptAttempt({
                    template,
                    taskLabel: `SidePrompt:${payload.trigger || 'batch'}:retry:${getSidePromptTaskKey(template)}`,
                    finalPrompt: prepared.finalPrompt,
                    settings,
                    profile: prepared.profile,
                    signal,
                    onRateLimitWait: wait => context.setState('generating', {
                        detail: `Rate limited, retrying in ${formatRateLimitDelay(wait?.delayMs)} (${template?.name || 'Side Prompt'})`,
                    }),
                });
            }
            if (!ensureSidePromptTextNotBlank(resultText, template, `${payload.trigger || 'batch'}-retry`)) {
                failures.push({
                    templateName: String(input?.displayName || template?.name || 'Unknown'),
                    message: 'SidePrompt returned blank content.',
                });
                continue;
            }
            if (!approvalResult || approvalResult.decision === 'cancel' || approvalResult.decision === 'reject') {
                canceled.push(String(input?.displayName || template?.name || 'Unknown'));
                continue;
            }
            if (approvalResult.editedData && typeof approvalResult.editedData === 'object') {
                resultText = String(approvalResult.editedData.content || resultText);
            }
        }

        const lorebookSettings = getEffectiveLorebookSettingsForTemplate(template);
        const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lorebookSettings, input?.runtimeMacros || {});
        batchItems.push({
            title: prepared.unifiedTitle,
            content: resultText,
            defaults,
            metadataUpdates: input?.metadataUpdates || {},
            entryOverrides,
            templateName: String(input?.displayName || template?.name || 'Unknown'),
        });
    }

    const successes = [];
    if (batchItems.length > 0) {
        context.setState('saving', {
            detail: batchItems.length === 1 ? '1 side prompt' : `${batchItems.length} side prompts`,
        });
        const saveResults = await upsertLorebookEntriesBatch(
            lorebookName,
            lorebookData,
            batchItems.map(item => ({
                title: item.title,
                content: item.content,
                defaults: item.defaults,
                metadataUpdates: item.metadataUpdates,
                entryOverrides: item.entryOverrides,
            })),
            {
                refreshEditor: settings?.moduleSettings?.refreshEditor !== false,
                signal,
            },
        );

        for (let index = 0; index < batchItems.length; index++) {
            const item = batchItems[index];
            const saveResult = saveResults[index] || {};
            successes.push({
                templateName: item.templateName,
                title: item.title,
                created: Boolean(saveResult?.created),
                uid: saveResult?.entry?.uid ?? null,
            });
        }
    }

    if (successes.length === 0 && failures.length > 0 && canceled.length === 0) {
        throw new Error(failures[0].message || 'All side prompts in this wave failed.');
    }

    context.setResult({
        type: 'sidePrompt',
        lorebookName,
        successes,
        failures,
        canceled,
    });
}

function getRangeLabelForJob(job) {
    const sceneStart = Number(job?.range?.sceneStart);
    const sceneEnd = Number(job?.range?.sceneEnd);
    if (Number.isInteger(sceneStart) && Number.isInteger(sceneEnd)) {
        return `Messages ${sceneStart}-${sceneEnd}`;
    }
    return String(job?.detail || 'Preparing scene');
}

function ensureSidePromptJobExecutorRegistered() {
    if (sidePromptJobExecutorRegistered) {
        return;
    }
    registerStmbJobExecutor('sidePrompt', executeSidePromptJob);
    registerStmbJobExecutor('sidePromptBatch', executeSidePromptBatchJob);
    sidePromptJobExecutorRegistered = true;
}

ensureSidePromptJobExecutorRegistered();

export async function toggleSidePromptEnabled(nameOrAll, enabled) {
    const raw = String(nameOrAll || '').trim();
    if (!raw) {
        throw new Error(enabled
            ? 'Missing name. Use: /sideprompt-on "Name" OR /sideprompt-on all'
            : 'Missing name. Use: /sideprompt-off "Name" OR /sideprompt-off all');
    }

    if (raw.toLowerCase() === 'all') {
        const templates = await listTemplates();
        let changed = 0;
        for (const template of templates) {
            if (template.enabled !== enabled) {
                await upsertTemplate({ key: template.key, enabled });
                changed++;
            }
        }
        return { changed, all: true };
    }

    const template = await findTemplateByName(raw);
    if (!template) {
        throw new Error(`Side Prompt not found: ${raw}`);
    }
    if (template.enabled !== enabled) {
        await upsertTemplate({ key: template.key, enabled });
        return { changed: 1, all: false, template };
    }
    return { changed: 0, all: false, template };
}
