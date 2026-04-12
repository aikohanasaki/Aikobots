import {
    chat_metadata,
    getCurrentChatId,
    getServerMacroSnapshot,
    getServerPromptState,
    name1,
    name2,
} from '../script.js';
import { getContext } from './extensions.js';
import { generateStmbText, prepareStmbSidePrompt, upsertStmbEntriesBatch, upsertStmbEntryByTitle } from './stmb-api.js';
import { saveMetadataDebounced } from './extensions.js';
import { getLorebookStorageForRequest, loadWorldInfo, METADATA_KEY, reloadEditor, worldInfoCache } from './world-info.js';
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
import { captureStmbSceneRange, fetchStmbChatRangeInfo } from './stmb-scene.js';
import {
    applySidePromptMacros,
    collectTemplateRuntimeMacros,
    extractMacroTokens,
    parseSidePromptCommandInput,
} from './stmb-sideprompt-macros.js';
import { findTemplateByName, firstRunInitSidePrompts, listByTrigger, listTemplates, upsertTemplate } from './stmb-sideprompts-manager.js';

let trackerEvaluationPromise = null;
let previewQueue = Promise.resolve();
let hasShownSidePromptRangeTip = false;

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

function resolveLorebookName(settings) {
    const moduleSettings = settings?.moduleSettings || {};
    if (moduleSettings.manualModeEnabled) {
        const manualLorebook = String(chat_metadata.STMemoryBooks?.manualLorebook || '').trim();
        return manualLorebook;
    }
    return String(chat_metadata[METADATA_KEY] || '').trim();
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

async function runTextGeneration(prompt, settings, profile = null, signal = null) {
    const { generateData } = await buildOpenAIGenerateData('quiet', [{ role: 'user', content: String(prompt || '') }], {});
    const result = await generateStmbText({
        generateData: applyStmbMaxTokensToGenerateData(
            applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
            settings?.moduleSettings?.maxTokens,
        ),
    }, { signal });
    return String(result?.text ?? '');
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
        const text = await runTextGeneration(finalPrompt, settings, profile, task.signal);
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
    const lookupTitles = getSidePromptLookupTitles(template, runtimeMacros, fallbackKinds);
    const macroSnapshot = getServerMacroSnapshot();
    const promptState = await getServerPromptState();
    const finalPromptResult = await prepareStmbSidePrompt({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        compiledScene,
        lookupTitles,
        templatePrompt: template.prompt,
        responseFormat: template.responseFormat,
        previousMemoriesCount: Number(template?.settings?.previousMemoriesCount ?? 0),
        runtimeMacros,
        macroSnapshot,
        promptState,
    }, { signal });
    const overrideIndex = template?.settings?.overrideProfileEnabled
        ? Number(template?.settings?.overrideProfileIndex)
        : null;
    const resolvedProfile = Number.isFinite(overrideIndex)
        ? resolveSidePromptProfile(settings, overrideIndex)
        : (profile || resolveSidePromptProfile(settings, null));
    return {
        unifiedTitle,
        existing,
        finalPrompt: String(finalPromptResult?.finalPrompt || ''),
        profile: resolvedProfile,
    };
}

async function compileRange(sceneStart, sceneEnd, settings = null, options = {}) {
    const result = await captureStmbSceneRange(
        { sceneStart, sceneEnd },
        {
            saveFirst: options.saveFirst !== false,
            skipSystemMessages: !settings?.moduleSettings?.unhideBeforeMemory,
        },
    );
    return result?.compiledScene;
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
    try {
        const templates = await listByTrigger('onInterval');
        if (!templates || templates.length === 0) return;

        const lorebookName = await ensureLorebookName(settings);
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        const chatRangeInfo = await fetchStmbChatRangeInfo({ saveFirst: false });
        const currentLast = Number(chatRangeInfo?.lastAvailableMessageId);
        if (currentLast < 0) return;

        for (const template of templates) {
            throwIfStmbAborted(signal);
            const lookupTitles = getSidePromptLookupTitles(template, {}, ['tracker']);
            const existing = findFirstLorebookEntryByTitle(lorebookData, lookupTitles);
            const checkpoint = readSidePromptCheckpoint(template.key, existing);
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
                compiledScene = await compileRange(boundedStart, currentLast, settings, { saveFirst: false });
            } catch {
                continue;
            }

            const endId = compiledScene?.metadata?.sceneEnd ?? currentLast;
            const checkpointTimestamp = new Date().toISOString();
            const result = await runTemplateForCompiledScene({
                template,
                lorebookName,
                lorebookData,
                compiledScene,
                settings,
                fallbackKinds: ['tracker'],
                trigger: 'onInterval',
                metadataUpdates: buildSidePromptCheckpointMetadata(template.key, {
                    lastMsgId: endId,
                    lastRunAt: checkpointTimestamp,
                }),
                signal,
            });
            if (result?.status === 'cancel') continue;
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
    const parentTask = options.signal ? null : createStmbTask('SidePrompts:onAfterMemory');
    const signal = options.signal || parentTask?.signal || null;
    try {
        const templates = await listByTrigger('onAfterMemory');
        if (!templates || templates.length === 0) return;

        const lorebookName = await ensureLorebookName(settings);
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        const maxConcurrent = Math.max(1, Math.min(5, Number(settings?.moduleSettings?.sidePromptsMaxConcurrent ?? 2)));
        const showNotifications = settings?.moduleSettings?.showNotifications !== false;
        const refreshEditor = settings?.moduleSettings?.refreshEditor !== false;
        const results = [];

        for (let index = 0; index < templates.length; index += maxConcurrent) {
            const wave = templates.slice(index, index + maxConcurrent);
            throwIfStmbAborted(signal);

            const waveResults = await Promise.all(wave.map(async template => {
                try {
                    const prepared = await prepareSidePromptRun({
                        template,
                        lorebookName,
                        lorebookData,
                        compiledScene,
                        settings,
                        profile,
                        fallbackKinds: ['plotpoints', 'scoreboard'],
                        signal,
                    });
                    const text = await runSidePromptAttempt({
                        template,
                        taskLabel: `SidePrompt:onAfterMemory:${getSidePromptTaskKey(template)}`,
                        finalPrompt: prepared.finalPrompt,
                        settings,
                        profile: prepared.profile,
                        signal,
                    });
                    return {
                        ok: true,
                        template,
                        prepared,
                        text,
                        completedAt: typeof performance?.now === 'function' ? performance.now() : Date.now(),
                    };
                } catch (error) {
                    return {
                        ok: false,
                        template,
                        error,
                        cancelled: isStmbAbortError(error),
                        completedAt: typeof performance?.now === 'function' ? performance.now() : Date.now(),
                    };
                }
            }));
            waveResults.sort((left, right) => left.completedAt - right.completedAt);
            const itemsToSave = [];
            const succeededNames = [];

            for (const waveResult of waveResults) {
                if (!waveResult.ok) {
                    if (waveResult.cancelled) {
                        continue;
                    }
                    console.warn('STMB runAfterMemory wave failed', waveResult.error);
                    results.push({ ok: false, name: waveResult.template?.name || 'unknown', error: waveResult.error });
                    continue;
                }

                let resultText = waveResult.text;
                if (!ensureSidePromptTextNotBlank(resultText, waveResult.template, 'onAfterMemory')) {
                    results.push({ ok: false, name: waveResult.template?.name || 'unknown', error: new Error('Blank side prompt response') });
                    continue;
                }

                if (settings?.moduleSettings?.showMemoryPreviews) {
                    try {
                        const previewResult = await resolveSidePromptPreview({
                            template: waveResult.template,
                            unifiedTitle: waveResult.prepared.unifiedTitle,
                            initialText: resultText,
                            finalPrompt: waveResult.prepared.finalPrompt,
                            settings,
                            profile: waveResult.prepared.profile,
                            compiledScene,
                            signal,
                            queuePreview: true,
                            retryTaskLabel: `SidePrompt:onAfterMemory:retry:${getSidePromptTaskKey(waveResult.template)}`,
                        });
                        if (previewResult?.blank) {
                            results.push({ ok: false, name: waveResult.template?.name || 'unknown', error: new Error('Blank side prompt response') });
                            continue;
                        }
                        if (!previewResult?.approved) {
                            results.push({ ok: false, name: waveResult.template?.name || 'unknown', error: new Error('User canceled or retry in preview') });
                            continue;
                        }
                        resultText = String(previewResult.text ?? resultText);
                    } catch (error) {
                        if (isStmbAbortError(error)) {
                            throw error;
                        }
                        console.warn('STMB runAfterMemory preview failed; proceeding without preview', {
                            template: getSidePromptTaskKey(waveResult.template),
                            error,
                        });
                    }
                }

                if (!ensureSidePromptTextNotBlank(resultText, waveResult.template, 'onAfterMemory')) {
                    results.push({ ok: false, name: waveResult.template?.name || 'unknown', error: new Error('Blank side prompt response') });
                    continue;
                }

                try {
                    const lorebookSettings = getEffectiveLorebookSettingsForTemplate(waveResult.template);
                    const { defaults, entryOverrides } = makeUpsertParamsFromLorebook(lorebookSettings);
                    const checkpointTimestamp = new Date().toISOString();
                    itemsToSave.push({
                        title: waveResult.prepared.unifiedTitle,
                        content: resultText,
                        defaults,
                        entryOverrides,
                        metadataUpdates: buildSidePromptCheckpointMetadata(waveResult.template.key, {
                            lastRunAt: checkpointTimestamp,
                            includeLastMsgId: false,
                            includeTrackerFallback: false,
                        }),
                    });
                    succeededNames.push(waveResult.template.name);
                } catch (error) {
                    if (!isStmbAbortError(error)) {
                        console.warn('STMB runAfterMemory save failed', error);
                    }
                    results.push({ ok: false, name: waveResult.template?.name || 'unknown', error });
                }
            }

            if (itemsToSave.length > 0) {
                try {
                    throwIfStmbAborted(signal);
                    await upsertLorebookEntriesBatch(lorebookName, lorebookData, itemsToSave, {
                        refreshEditor,
                        signal,
                    });
                    for (const name of succeededNames) {
                        results.push({ ok: true, name });
                        if (showNotifications) {
                            toastr.success(`SidePrompt "${name}" updated.`, 'STMB');
                        }
                    }
                } catch (error) {
                    if (isStmbAbortError(error)) {
                        return;
                    }
                    console.warn('STMB runAfterMemory wave save failed', error);
                    toastr.error('Failed to save SidePrompt updates for this wave', 'STMB');
                    for (const name of succeededNames) {
                        results.push({ ok: false, name, error });
                    }
                }
            }
        }

        if (showNotifications && results.length > 0) {
            const succeeded = results.filter(result => result.ok).map(result => result.name);
            const failed = results.filter(result => !result.ok).map(result => result.name);
            const summarize = values => {
                const maxNames = 5;
                if (!values.length) return '';
                const names = values.slice(0, maxNames).join(', ');
                return values.length > maxNames ? `${names}, +${values.length - maxNames} more` : names;
            };

            if (failed.length === 0) {
                toastr.info(`Side Prompts after memory: ${succeeded.length} succeeded. ${summarize(succeeded)}`, 'STMB');
            } else {
                const failedSummary = summarize(failed);
                toastr.warning(
                    `Side Prompts after memory: ${succeeded.length} succeeded, ${failed.length} failed.${failedSummary ? ` Failed: ${failedSummary}` : ''}`,
                    'STMB',
                );
            }
        }
    } catch (error) {
        if (!isStmbAbortError(error) && !isStmbLorebookHandledError(error)) {
            console.warn('STMB runAfterMemory failed', error);
        }
    } finally {
        parentTask?.cleanup();
    }
}

export { firstRunInitSidePrompts };

export async function runSidePrompt(rawInput, settings, options = {}) {
    const parentTask = options.signal ? null : createStmbTask('SidePrompts:manual');
    const signal = options.signal || parentTask?.signal || null;
    let activeTemplateName = '';
    try {
        const lorebookName = await ensureLorebookName(settings);
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
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
                compiledScene = await compileRange(sceneStart, sceneEnd, settings, { saveFirst: false });
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
            const checkpoint = readSidePromptCheckpoint(template.key, existing, { includeLegacyScore: true });
            const lastMessageId = checkpoint.lastMsgId;
            const sceneStart = Math.max(0, lastMessageId + 1);
            const boundedStart = Math.max(sceneStart, currentLast - 199);
            try {
                compiledScene = await compileRange(boundedStart, currentLast, settings, { saveFirst: false });
            } catch {
                toastr.error('Failed to compile messages for /sideprompt', 'STMB');
                return '';
            }
        }

        const endId = compiledScene?.metadata?.sceneEnd ?? currentLast;
        const checkpointTimestamp = new Date().toISOString();
        const result = await runTemplateForCompiledScene({
            template,
            lorebookName,
            lorebookData,
            compiledScene,
            settings,
            runtimeMacros: parsed.runtimeMacros,
            fallbackKinds: ['scoreboard', 'plotpoints', 'tracker'],
            trigger: 'manual',
            metadataUpdates: buildSidePromptCheckpointMetadata(template.key, {
                lastMsgId: endId,
                lastRunAt: checkpointTimestamp,
            }),
            signal,
        });

        if (result?.status === 'cancel') {
            toastr.info(`SidePrompt "${template.name}" canceled.`, 'STMB');
            return '';
        }

        if (result?.status === 'blank') {
            return '';
        }

        toastr.success(`SidePrompt "${template.name}" updated.`, 'STMB');
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
    } finally {
        parentTask?.cleanup();
    }
}

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
