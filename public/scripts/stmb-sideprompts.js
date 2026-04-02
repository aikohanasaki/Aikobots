import {
    chat,
    chat_metadata,
    getCurrentChatId,
    getServerMacroSnapshot,
    getServerPromptState,
    name1,
    name2,
} from '../script.js';
import { generateStmbText, prepareStmbSidePrompt, upsertStmbEntryByTitle } from './stmb-api.js';
import { saveMetadataDebounced } from './extensions.js';
import { createNewWorldInfo, getLorebookStorageForRequest, loadWorldInfo, METADATA_KEY, worldInfoCache } from './world-info.js';
import { buildOpenAIGenerateData, oai_settings } from './openai.js';
import { showMemoryPreviewPopup } from './stmb-popups.js';
import { createStmbTask, getActiveStmbTaskCount, hasActiveStmbTasks, isStmbAbortError, throwIfStmbAborted } from './stmb-tasks.js';
import {
    applyStmbProfileToGenerateData,
    compileScene,
    getActiveStmbProfile,
    STMB_METADATA_KEY,
} from './stmb-core.js';
import {
    applySidePromptMacros,
    collectTemplateRuntimeMacros,
    extractMacroTokens,
    parseSidePromptCommandInput,
} from './stmb-sideprompt-macros.js';
import { findTemplateByName, firstRunInitSidePrompts, listByTrigger, listTemplates, upsertTemplate } from './stmb-sideprompts-manager.js';

let trackerEvaluationPromise = null;

function getStmbProviderDefaults() {
    return {
        azure_base_url: oai_settings.azure_base_url,
        azure_api_version: oai_settings.azure_api_version,
        azure_deployment_name: oai_settings.azure_deployment_name,
        custom_url: oai_settings.custom_url,
    };
}

function getStmbChatState() {
    if (!chat_metadata[STMB_METADATA_KEY] || typeof chat_metadata[STMB_METADATA_KEY] !== 'object') {
        chat_metadata[STMB_METADATA_KEY] = {};
    }

    return chat_metadata[STMB_METADATA_KEY];
}

function getSidePromptCheckpointBucket() {
    const state = getStmbChatState();
    if (!state.sidePromptCheckpoints || typeof state.sidePromptCheckpoints !== 'object') {
        state.sidePromptCheckpoints = {};
    }
    return state.sidePromptCheckpoints;
}

function readSidePromptCheckpoint(templateKey, existingEntry) {
    const lastMsgId = existingEntry?.[`STMB_sp_${templateKey}_lastMsgId`] ?? existingEntry?.STMB_tracker_lastMsgId;
    const lastRunAt = existingEntry?.[`STMB_sp_${templateKey}_lastRunAt`] ?? existingEntry?.STMB_tracker_lastRunAt;
    if (lastMsgId !== undefined || lastRunAt !== undefined) {
        return {
            lastMsgId: Number(lastMsgId ?? -1),
            lastRunAt: lastRunAt ? Date.parse(lastRunAt) : null,
        };
    }

    const checkpoint = getSidePromptCheckpointBucket()[templateKey];
    return {
        lastMsgId: Number(checkpoint?.lastMsgId ?? -1),
        lastRunAt: checkpoint?.lastRunAt ? Date.parse(checkpoint.lastRunAt) : null,
    };
}

async function persistSidePromptCheckpoint({ templateKey, lorebookName, lorebookData, existingEntry, endId, signal = null }) {
    const isoNow = new Date().toISOString();
    if (existingEntry) {
        throwIfStmbAborted(signal);
        const result = await upsertStmbEntryByTitle({
            lorebookName,
            storage: getLorebookStorageForRequest(lorebookName),
            title: String(existingEntry.comment || ''),
            content: existingEntry.content != null ? String(existingEntry.content) : '',
            metadataUpdates: {
                [`STMB_sp_${templateKey}_lastMsgId`]: endId,
                [`STMB_sp_${templateKey}_lastRunAt`]: isoNow,
                STMB_tracker_lastMsgId: endId,
                STMB_tracker_lastRunAt: isoNow,
            },
        }, { signal });
        throwIfStmbAborted(signal);
        worldInfoCache.delete(lorebookName);
        if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
            lorebookData.entries = {};
        }
        if (result?.entry && result.entry.uid !== undefined) {
            lorebookData.entries[result.entry.uid] = result.entry;
        }
        return;
    }

    throwIfStmbAborted(signal);
    const checkpoints = getSidePromptCheckpointBucket();
    checkpoints[templateKey] = {
        lastMsgId: endId,
        lastRunAt: isoNow,
    };
    throwIfStmbAborted(signal);
    saveMetadataDebounced();
}

function buildSceneRequest(sceneStart, sceneEnd) {
    return {
        sceneStart,
        sceneEnd,
        chatId: getCurrentChatId() || '',
        characterName: String(name2 || ''),
        userName: String(name1 || ''),
    };
}

function countVisibleMessagesSince(exclusiveStart, inclusiveEnd) {
    let count = 0;
    const start = Number.isFinite(exclusiveStart) ? exclusiveStart : -1;
    const end = Math.max(-1, inclusiveEnd);
    for (let index = start + 1; index <= end && index < chat.length; index++) {
        const message = chat[index];
        if (message && !message.is_system) count++;
    }
    return count;
}

function resolveLorebookName(settings) {
    const moduleSettings = settings?.moduleSettings || {};
    if (moduleSettings.manualModeEnabled) {
        const manualLorebook = String(chat_metadata.STMemoryBooks?.manualLorebook || '').trim();
        if (manualLorebook) return manualLorebook;
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
    const existing = resolveLorebookName(settings);
    if (existing) return existing;
    if (!settings?.moduleSettings?.autoCreateLorebook) {
        throw new Error('No chat-bound lorebook selected');
    }

    const lorebookName = renderLorebookNameFromTemplate(settings);
    const created = await createNewWorldInfo(lorebookName);
    if (!created) {
        throw new Error(`Failed to create lorebook "${lorebookName}"`);
    }
    chat_metadata[METADATA_KEY] = lorebookName;
    saveMetadataDebounced();
    return lorebookName;
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

function findFirstLoreEntryByTitle(lorebookData, titles = []) {
    const entries = Object.values(lorebookData?.entries || {});
    for (const title of titles) {
        const found = entries.find(entry => String(entry?.comment || '') === title);
        if (found) return found;
    }
    return null;
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
    return { uid: result?.entry?.uid, created: Boolean(result?.created), entry: result?.entry };
}

function resolveSidePromptProfile(settings, overrideProfileIndex = null) {
    if (Number.isFinite(Number(overrideProfileIndex))) {
        return getActiveStmbProfile(settings, Number(overrideProfileIndex));
    }
    return getActiveStmbProfile(settings, null);
}

async function runTextGeneration(prompt, profile = null, signal = null) {
    const { generateData } = await buildOpenAIGenerateData('quiet', [{ role: 'user', content: String(prompt || '') }], {});
    const result = await generateStmbText({
        generateData: applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
    }, { signal });
    return String(result?.text ?? '');
}

async function prepareSidePromptRun({ template, lorebookName, lorebookData, compiledScene, settings, runtimeMacros = {}, fallbackKinds = [], signal = null }) {
    const unifiedTitle = getUnifiedSidePromptTitle(template, runtimeMacros);
    const existing = findFirstLoreEntryByTitle(lorebookData, getSidePromptLookupTitles(template, runtimeMacros, fallbackKinds));
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
    const profile = resolveSidePromptProfile(settings, overrideIndex);
    return {
        unifiedTitle,
        existing,
        finalPrompt: String(finalPromptResult?.finalPrompt || ''),
        profile,
    };
}

async function compileRange(sceneStart, sceneEnd) {
    return compileScene(chat, buildSceneRequest(sceneStart, sceneEnd));
}

function ensureSidePromptTextNotBlank(text, template, trigger) {
    if (String(text || '').trim()) return true;
    toastr.error(`SidePrompt "${template?.name || 'Unknown'}" returned blank content. No changes were saved.`, 'STMB');
    console.error('STMB SidePrompt blank response', { trigger, template: template?.key || template?.name || null });
    return false;
}

async function runTemplateForCompiledScene({ template, lorebookName, lorebookData, compiledScene, settings, runtimeMacros = {}, fallbackKinds = [], metadataUpdates = {}, signal = null }) {
    for (;;) {
        throwIfStmbAborted(signal);
        const prepared = await prepareSidePromptRun({
            template,
            lorebookName,
            lorebookData,
            compiledScene,
            settings,
            runtimeMacros,
            fallbackKinds,
            signal,
        });
        let resultText = await runTextGeneration(prepared.finalPrompt, prepared.profile, signal);
        throwIfStmbAborted(signal);
        if (!ensureSidePromptTextNotBlank(resultText, template, fallbackKinds[0] || 'manual')) {
            return { status: 'blank' };
        }

        if (settings?.moduleSettings?.showMemoryPreviews) {
            const previewResult = await showMemoryPreviewPopup({
                extractedTitle: prepared.unifiedTitle,
                content: resultText,
                suggestedKeys: [],
            }, {
                sceneStart: compiledScene?.metadata?.sceneStart,
                sceneEnd: compiledScene?.metadata?.sceneEnd,
                messageCount: compiledScene?.metadata?.messageCount,
            }, prepared.profile, { lockTitle: true });

            if (previewResult?.action === 'cancel') {
                return { status: 'cancel' };
            }
            if (previewResult?.action === 'retry') {
                continue;
            }
            if (previewResult?.action === 'edit' && previewResult.memoryData) {
                resultText = String(previewResult.memoryData.content ?? resultText);
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
                signal,
            },
        );
    }
}

export async function evaluateTrackers(settings, options = {}) {
    if (trackerEvaluationPromise) {
        return trackerEvaluationPromise;
    }
    if (!options.signal && hasActiveStmbTasks()) {
        return;
    }

    trackerEvaluationPromise = (async () => {
    const parentTask = options.signal ? null : createStmbTask('SidePrompts:onInterval');
    const signal = options.signal || parentTask?.signal || null;
    try {
        const templates = await listByTrigger('onInterval');
        if (!templates || templates.length === 0) return;

        const lorebookName = await ensureLorebookName(settings);
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        const currentLast = chat.length - 1;
        if (currentLast < 0) return;

        for (const template of templates) {
            throwIfStmbAborted(signal);
            const lookupTitles = getSidePromptLookupTitles(template, {}, ['tracker']);
            const existing = findFirstLoreEntryByTitle(lorebookData, lookupTitles);
            const checkpoint = readSidePromptCheckpoint(template.key, existing);
            const lastMessageId = checkpoint.lastMsgId;
            const lastRunAt = checkpoint.lastRunAt;
            if (lastRunAt && Date.now() - lastRunAt < 10000) {
                continue;
            }

            const threshold = Math.max(1, Number(template?.triggers?.onInterval?.visibleMessages ?? 50));
            const visibleSince = countVisibleMessagesSince(lastMessageId, currentLast);
            if (visibleSince < threshold) continue;

            const start = Math.max(0, lastMessageId + 1);
            const boundedStart = Math.max(start, currentLast - 199);
            let compiledScene;
            try {
                compiledScene = await compileRange(boundedStart, currentLast);
            } catch {
                continue;
            }

            const endId = compiledScene?.metadata?.sceneEnd ?? currentLast;
            const result = await runTemplateForCompiledScene({
                template,
                lorebookName,
                lorebookData,
                compiledScene,
                settings,
                fallbackKinds: ['tracker'],
                metadataUpdates: {
                    [`STMB_sp_${template.key}_lastMsgId`]: endId,
                    [`STMB_sp_${template.key}_lastRunAt`]: new Date().toISOString(),
                    STMB_tracker_lastMsgId: endId,
                    STMB_tracker_lastRunAt: new Date().toISOString(),
                },
                signal,
            });
            if (result?.status === 'cancel') {
                await persistSidePromptCheckpoint({
                    templateKey: template.key,
                    lorebookName,
                    lorebookData,
                    existingEntry: existing,
                    endId,
                    signal,
                });
            }
        }
    } catch (error) {
        if (!isStmbAbortError(error)) {
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
    try {
        const templates = await listByTrigger('onAfterMemory');
        if (!templates || templates.length === 0) return;

        const lorebookName = await ensureLorebookName(settings);
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        const maxConcurrent = Math.max(1, Math.min(5, Number(settings?.moduleSettings?.sidePromptsMaxConcurrent ?? 2)));
        const signal = options.signal || null;

        for (let index = 0; index < templates.length; index += maxConcurrent) {
            const wave = templates.slice(index, index + maxConcurrent);
            for (const template of wave) {
                try {
                    throwIfStmbAborted(signal);
                    const result = await runTemplateForCompiledScene({
                    template,
                    lorebookName,
                    lorebookData,
                    compiledScene,
                    settings,
                    fallbackKinds: ['plotpoints', 'scoreboard'],
                    metadataUpdates: {
                        [`STMB_sp_${template.key}_lastRunAt`]: new Date().toISOString(),
                    },
                    signal,
                });
                    if (result?.status === 'cancel') {
                        continue;
                    }
                } catch (error) {
                    if (!isStmbAbortError(error)) {
                        console.warn('STMB runAfterMemory wave failed', error);
                    }
                }
            }
        }
    } catch (error) {
        if (!isStmbAbortError(error)) {
            console.warn('STMB runAfterMemory failed', error);
        }
    }
}

export { firstRunInitSidePrompts };

export async function runSidePrompt(rawInput, settings, options = {}) {
    if (!options.signal && getActiveStmbTaskCount() > 0) {
        throw new Error('STMB generation is already in progress');
    }
    const parentTask = options.signal ? null : createStmbTask('SidePrompts:manual');
    const signal = options.signal || parentTask?.signal || null;
    try {
    const lorebookName = await ensureLorebookName(settings);
    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    const parsed = parseSidePromptCommandInput(rawInput);
    if (parsed.error || !parsed.name) {
        throw new Error('SidePrompt name not provided. Usage: /sideprompt "Name" {{macro}}="value" [X-Y]');
    }

    const template = await findTemplateByName(parsed.name);
    if (!template) {
        throw new Error('SidePrompt template not found. Check name.');
    }
    const manualEnabled = Array.isArray(template?.triggers?.commands) && template.triggers.commands.some(command => String(command).toLowerCase() === 'sideprompt');
    if (!manualEnabled) {
        throw new Error('Manual run is disabled for this template.');
    }

    const requiredRuntimeMacros = collectTemplateRuntimeMacros(template);
    const missingRuntimeMacros = requiredRuntimeMacros.filter(token => !Object.hasOwn(parsed.runtimeMacros, token));
    if (missingRuntimeMacros.length > 0) {
        const usage = requiredRuntimeMacros.map(token => `${token}="value"`).join(' ');
        throw new Error(`SidePrompt "${template.name}" requires: ${missingRuntimeMacros.join(', ')}. Usage: /sideprompt "${template.name}" ${usage} [X-Y]`);
    }

    const currentLast = chat.length - 1;
    if (currentLast < 0) {
        throw new Error('No messages available.');
    }

    let compiledScene;
    if (parsed.range) {
        const match = parsed.range.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        if (!match) {
            throw new Error('Invalid range format. Use X-Y');
        }
        const sceneStart = Number(match[1]);
        const sceneEnd = Number(match[2]);
        if (!(sceneStart >= 0 && sceneEnd >= sceneStart && sceneEnd < chat.length)) {
            throw new Error('Invalid message range for /sideprompt');
        }
        compiledScene = await compileRange(sceneStart, sceneEnd);
    } else {
        const existing = findFirstLoreEntryByTitle(lorebookData, getSidePromptLookupTitles(template, parsed.runtimeMacros, ['scoreboard', 'plotpoints', 'tracker']));
        const lastMessageId = Number(
            existing?.[`STMB_sp_${template.key}_lastMsgId`] ??
            existing?.STMB_score_lastMsgId ??
            existing?.STMB_tracker_lastMsgId ??
            -1,
        );
        const sceneStart = Math.max(0, lastMessageId + 1);
        const boundedStart = Math.max(sceneStart, currentLast - 199);
        compiledScene = await compileRange(boundedStart, currentLast);
    }

    const endId = compiledScene?.metadata?.sceneEnd ?? currentLast;
    const result = await runTemplateForCompiledScene({
        template,
        lorebookName,
        lorebookData,
        compiledScene,
        settings,
        runtimeMacros: parsed.runtimeMacros,
        fallbackKinds: ['scoreboard', 'plotpoints', 'tracker'],
        metadataUpdates: {
            [`STMB_sp_${template.key}_lastMsgId`]: endId,
            [`STMB_sp_${template.key}_lastRunAt`]: new Date().toISOString(),
            STMB_tracker_lastMsgId: endId,
            STMB_tracker_lastRunAt: new Date().toISOString(),
        },
        signal,
    });

    return {
        lorebookName,
        template,
        result,
    };
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
