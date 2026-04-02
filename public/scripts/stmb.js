import {
    chat,
    chatElement,
    chat_metadata,
    eventSource,
    event_types,
    getCurrentChatId,
    name1,
    name2,
    saveSettingsDebounced,
} from '../script.js';
import { getContext, saveMetadataDebounced } from './extensions.js';
import { commitStmbSummaries, generateStmbSummary, generateStmbText, prepareStmbMemoryMessages, prepareStmbSummaryPrompt, saveStmbMemoryEntry } from './stmb-api.js';
import { closeActiveMemoryPreviewPopups, showAdvancedOptionsPopup, showAutoConsolidationPromptPopup, showAutoSummaryDecisionPopup, showConfirmationPopup, showFailedAIResponsePopup, showFailedSummaryResponsePopup, showLorebookPickerPopup, showMemoryPreviewPopup, showSummaryConsolidationOptionsPopup } from './stmb-popups.js';
import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from './slash-commands/SlashCommandArgument.js';
import { executeSlashCommands } from './slash-commands.js';
import { groups, selected_group } from './group-chats.js';
import { getRegexScripts, runRegexScript } from './extensions/regex/engine.js';
import { createNewWorldInfo, getLorebookStorageForRequest, loadWorldInfo, METADATA_KEY, reloadEditor, world_names, worldInfoCache } from './world-info.js';
import { buildOpenAIGenerateData, oai_settings } from './openai.js';
import {
    applyStmbProfileToGenerateData,
    compiledSceneToText,
    getPresetPrompt,
    STMB_DEFAULT_MEMORY_SCHEMA,
    STMB_DEFAULT_TITLE_FORMAT,
    STMB_METADATA_KEY,
    compileScene,
    getActiveStmbProfile,
    identifyManagedMemoryEntries,
    normalizeStmbSettings,
    parseSequenceFromTitle,
    parseStructuredMemoryResponse,
} from './stmb-core.js';
import {
    STMB_SUMMARY_RESPONSE_SCHEMA,
    STMB_DEFAULT_SUMMARY_PROMPTS,
    createSummaryCandidatesFromResponse,
    getDefaultSummaryMinChildren,
    getDefaultSummaryTitleFormat,
    getSummaryPrompt,
    getSummaryTierLabel,
    getSourceTierForTarget,
    identifyEligibleSummarySourceEntries,
    identifyManagedSummaryEntries,
    migrateLorebookSummarySchema,
    normalizeSummaryMinChildren,
    parseSummaryJsonResponse,
} from './stmb-summary.js';
import {
    evaluateTrackers,
    firstRunInitSidePrompts,
    runAfterMemory,
    runSidePrompt,
    toggleSidePromptEnabled,
} from './stmb-sideprompts.js';
import { createStmbTask, getActiveStmbTaskCount, hasActiveStmbTasks, isStmbAbortError, stopAllStmbTasks, throwIfStmbAborted } from './stmb-tasks.js';
import { getTokenCountAsync } from './tokenizers.js';

const $ = window.jQuery;
let stmbSettings = normalizeStmbSettings();
let activeRootTask = null;
let stmbInitialized = false;
let sceneButtonsBound = false;
let slashCommandsRegistered = false;
let lastFailedSummaryError = null;
let lastFailedSummaryContext = null;

function cloneRegexScriptEnabled(script) {
    try {
        const clone = { ...script };
        clone.disabled = false;
        return clone;
    } catch {
        return script;
    }
}

function applySelectedRegex(text, selectedKeys) {
    if (typeof text !== 'string') return text;
    if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) return text;

    try {
        const allScripts = getRegexScripts({ allowedOnly: false }) || [];
        const indices = selectedKeys
            .map(key => Number(String(key).replace(/^idx:/, '')))
            .filter(index => Number.isInteger(index) && index >= 0 && index < allScripts.length);

        let output = text;
        for (const index of indices) {
            output = runRegexScript(cloneRegexScriptEnabled(allScripts[index]), output);
        }
        return output;
    } catch (error) {
        console.warn('STMB selected regex application failed', error);
        return text;
    }
}

function getStmbProviderDefaults() {
    return {
        azure_base_url: oai_settings.azure_base_url,
        azure_api_version: oai_settings.azure_api_version,
        azure_deployment_name: oai_settings.azure_deployment_name,
        custom_url: oai_settings.custom_url,
    };
}

async function getCurrentUiConnectionInfo() {
    const { generateData } = await buildOpenAIGenerateData('quiet', [{ role: 'user', content: 'ping' }]);
    return {
        api: String(generateData?.chat_completion_source || 'openai'),
        model: String(generateData?.model || ''),
        temperature: Number.isFinite(Number(generateData?.temperature)) ? Number(generateData.temperature) : 0.7,
    };
}

function getEffectivePromptText(profile) {
    if (typeof profile?.prompt === 'string' && profile.prompt.trim()) {
        return profile.prompt;
    }

    return getPresetPrompt(stmbSettings, profile?.preset);
}

function getProfileDisplayName(profile) {
    return profile?.isBuiltinCurrentST ? 'Current SillyTavern Settings' : String(profile?.name || 'Profile');
}

function getProfileModelDisplay(profile) {
    return profile?.connection?.api === 'current_st'
        ? 'Current SillyTavern model'
        : String(profile?.connection?.model || 'Current SillyTavern model');
}

function getProfileTemperatureDisplay(profile) {
    return profile?.connection?.api === 'current_st'
        ? 'Current SillyTavern temperature'
        : (profile?.connection?.temperature ?? 'Current SillyTavern temperature');
}

function buildScenePopupData(compiledScene, range, estimatedTokens) {
    const startMessage = chat[range.sceneStart];
    const endMessage = chat[range.sceneEnd];
    const excerpt = message => {
        const content = String(message?.mes || '');
        return content.length > 100 ? `${content.slice(0, 100)}...` : content;
    };

    return {
        sceneStart: range.sceneStart,
        sceneEnd: range.sceneEnd,
        startExcerpt: excerpt(startMessage),
        endExcerpt: excerpt(endMessage),
        startSpeaker: String(startMessage?.name || 'Unknown'),
        endSpeaker: String(endMessage?.name || 'Unknown'),
        messageCount: compiledScene?.metadata?.messageCount ?? 0,
        estimatedTokens,
    };
}

async function getAvailableMemoryCount(lorebookName) {
    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        return 0;
    }

    return identifyManagedMemoryEntries(lorebookData.entries).length;
}

function generateSafeProfileName(name) {
    const base = String(name || 'New Profile').trim() || 'New Profile';
    const existing = new Set((stmbSettings.profiles || []).map(profile => String(profile?.name || '').trim()).filter(Boolean));
    if (!existing.has(base)) {
        return base;
    }

    let counter = 1;
    while (existing.has(`${base} (${counter})`)) {
        counter++;
    }
    return `${base} (${counter})`;
}

function saveAdvancedProfile(baseProfile, popupResult, currentUiConnection) {
    const nextProfile = structuredClone(baseProfile || getActiveStmbProfile(stmbSettings));
    nextProfile.name = generateSafeProfileName(popupResult.newProfileName);
    delete nextProfile.isBuiltinCurrentST;
    if (popupResult.overrideSettings) {
        nextProfile.connection = {
            api: currentUiConnection.api,
            model: currentUiConnection.model,
            temperature: currentUiConnection.temperature,
        };
    }
    const basePrompt = String(getEffectivePromptText(baseProfile) || '').trim();
    const nextPrompt = String(popupResult.promptText || '').trim();
    if (nextPrompt && nextPrompt !== basePrompt) {
        nextProfile.prompt = popupResult.promptText;
        nextProfile.preset = '';
    }
    nextProfile.titleFormat = nextProfile.titleFormat || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT;
    stmbSettings.profiles.push(nextProfile);
    saveSettingsDebounced();
    return nextProfile;
}

async function showAndGetMemorySettings(compiledScene, range, lorebookName, selectedProfileIndex = null) {
    const tokenThreshold = getModuleSettings().tokenWarningThreshold ?? 30000;
    const estimatedTokens = await getTokenCountAsync(compiledSceneToText(compiledScene));
    const sceneData = buildScenePopupData(compiledScene, range, estimatedTokens);
    const shouldShowConfirmation = !getModuleSettings().alwaysUseDefault || estimatedTokens > tokenThreshold;
    const currentUiConnection = await getCurrentUiConnectionInfo();

    if (!shouldShowConfirmation) {
        const profile = getActiveStmbProfile(stmbSettings, selectedProfileIndex ?? null);
        return {
            profileSettings: structuredClone(profile),
            summaryCount: Math.max(0, Math.min(7, Number(getModuleSettings().defaultMemoryCount ?? 0))),
            tokenThreshold,
        };
    }

    const popupProfiles = stmbSettings.profiles.map(profile => ({
        name: getProfileDisplayName(profile),
        effectivePrompt: getEffectivePromptText(profile),
        profileModel: getProfileModelDisplay(profile),
        profileTemperature: getProfileTemperatureDisplay(profile),
    }));
    const defaultProfileIndex = selectedProfileIndex ?? stmbSettings.defaultProfile ?? 0;
    const confirmation = await showConfirmationPopup({
        ...sceneData,
        profiles: popupProfiles,
        selectedProfileIndex: defaultProfileIndex,
        currentApi: currentUiConnection.api,
        currentModel: currentUiConnection.model,
        currentTemperature: currentUiConnection.temperature,
        tokenThreshold,
        showWarning: estimatedTokens > tokenThreshold,
    });

    if (confirmation.action === 'cancel') {
        return null;
    }

    if (confirmation.action === 'confirm') {
        return {
            profileSettings: structuredClone(getActiveStmbProfile(stmbSettings, confirmation.profileIndex)),
            summaryCount: Math.max(0, Math.min(7, Number(getModuleSettings().defaultMemoryCount ?? 0))),
            tokenThreshold,
        };
    }

    const selectedProfile = getActiveStmbProfile(stmbSettings, confirmation.profileIndex);
    const advanced = await showAdvancedOptionsPopup({
        ...sceneData,
        profiles: popupProfiles,
        selectedProfileIndex: confirmation.profileIndex,
        currentApi: currentUiConnection.api,
        currentModel: currentUiConnection.model,
        currentTemperature: currentUiConnection.temperature,
        availableMemories: await getAvailableMemoryCount(lorebookName),
        defaultMemoryCount: Math.max(0, Math.min(7, Number(getModuleSettings().defaultMemoryCount ?? 0))),
        overrideSettings: false,
        suggestedProfileName: `${getProfileDisplayName(selectedProfile)} - Modified`,
    });

    if (advanced.action === 'cancel') {
        return null;
    }

    if (advanced.action === 'save_profile') {
        if (!advanced.newProfileName) {
            throw new Error('Please enter a profile name');
        }
        const saved = saveAdvancedProfile(selectedProfile, advanced, currentUiConnection);
        toastr.success(`Profile "${saved.name}" saved successfully`, 'STMB');
        return null;
    }
    if (advanced.action === 'save_and_confirm') {
        if (!advanced.newProfileName) {
            throw new Error('Please enter a profile name');
        }
        const saved = saveAdvancedProfile(selectedProfile, advanced, currentUiConnection);
        toastr.success(`Profile "${saved.name}" saved successfully`, 'STMB');
        return {
            profileSettings: structuredClone(saved),
            summaryCount: Math.max(0, Math.min(7, Number(advanced.memoryCount ?? 0))),
            tokenThreshold,
        };
    }

    const effectiveProfile = structuredClone(selectedProfile);
    const basePrompt = String(getEffectivePromptText(selectedProfile) || '').trim();
    const nextPrompt = String(advanced.promptText || '').trim();
    if (nextPrompt && nextPrompt !== basePrompt) {
        effectiveProfile.prompt = advanced.promptText;
        effectiveProfile.preset = '';
    }
    if (advanced.overrideSettings) {
        effectiveProfile.connection = {
            api: 'current_st',
            model: '',
            temperature: currentUiConnection.temperature,
        };
    }

    return {
        profileSettings: effectiveProfile,
        summaryCount: Math.max(0, Math.min(7, Number(advanced.memoryCount ?? 0))),
        tokenThreshold,
    };
}

function getModuleSettings() {
    return stmbSettings.moduleSettings || {};
}

function getStmbState() {
    const context = getContext();
    const metadata = context?.chatMetadata || chat_metadata;
    if (!metadata[STMB_METADATA_KEY] || typeof metadata[STMB_METADATA_KEY] !== 'object') {
        metadata[STMB_METADATA_KEY] = {};
    }

    return metadata[STMB_METADATA_KEY];
}

export function loadStmbSettings(settings) {
    stmbSettings = normalizeStmbSettings(settings?.stmb_settings, settings?.extension_settings?.STMemoryBooks);
}

export function getStmbSettings() {
    return structuredClone(stmbSettings);
}

function getSceneMarkers() {
    const state = getStmbState();
    if (!Number.isInteger(state.sceneStart)) {
        state.sceneStart = null;
    }
    if (!Number.isInteger(state.sceneEnd)) {
        state.sceneEnd = null;
    }
    return state;
}

function setSceneMarker(kind, messageId) {
    const state = getStmbState();
    const numericId = Number(messageId);
    const currentStart = Number.isInteger(state.sceneStart) ? state.sceneStart : null;
    const currentEnd = Number.isInteger(state.sceneEnd) ? state.sceneEnd : null;
    let nextStart = currentStart;
    let nextEnd = currentEnd;

    if (kind === 'sceneStart') {
        if (currentEnd !== null && currentEnd < numericId) {
            nextEnd = null;
        }
        nextStart = currentStart === numericId ? null : numericId;
    } else if (kind === 'sceneEnd') {
        if (currentStart !== null && currentStart > numericId) {
            nextStart = null;
        }
        nextEnd = currentEnd === numericId ? null : numericId;
    }

    state.sceneStart = nextStart;
    state.sceneEnd = nextEnd;
    saveMetadataDebounced();
    renderAllSceneButtons();
}

function setSceneRange(sceneStart, sceneEnd) {
    const state = getStmbState();
    state.sceneStart = Number(sceneStart);
    state.sceneEnd = Number(sceneEnd);
    saveMetadataDebounced();
    renderAllSceneButtons();
}

function clearSceneMarkers() {
    const state = getStmbState();
    delete state.sceneStart;
    delete state.sceneEnd;
    saveMetadataDebounced();
    renderAllSceneButtons();
}

function getHighestProcessedMessageId() {
    const state = getStmbState();
    return Number.isInteger(state.highestMemoryProcessed) ? state.highestMemoryProcessed : null;
}

function setHighestProcessedMessageId(messageId) {
    const state = getStmbState();
    state.highestMemoryProcessed = Number(messageId);
    delete state.highestMemoryProcessedManuallySet;
    saveMetadataDebounced();
}

function ensureSceneButtonContainer(messageElement) {
    let extraButtons = messageElement.querySelector('.extraMesButtons');
    if (!extraButtons) {
        extraButtons = document.createElement('div');
        extraButtons.classList.add('extraMesButtons');
        const messageBlock = messageElement.querySelector('.mes_block');
        if (messageBlock) {
            messageBlock.appendChild(extraButtons);
        } else {
            messageElement.appendChild(extraButtons);
        }
    }

    if (!extraButtons.querySelector('.mes_stmb_start')) {
        const startButton = document.createElement('div');
        startButton.className = 'mes_stmb_start mes_button fa-solid fa-caret-right interactable';
        startButton.title = 'Mark scene start';
        extraButtons.appendChild(startButton);
    }

    if (!extraButtons.querySelector('.mes_stmb_end')) {
        const endButton = document.createElement('div');
        endButton.className = 'mes_stmb_end mes_button fa-solid fa-caret-left interactable';
        endButton.title = 'Mark scene end';
        extraButtons.appendChild(endButton);
    }
}

function renderSceneButtonsForMessage(messageElement) {
    const messageId = Number(messageElement.getAttribute('mesid'));
    if (!Number.isInteger(messageId)) {
        return;
    }

    ensureSceneButtonContainer(messageElement);
    const { sceneStart, sceneEnd } = getSceneMarkers();
    const startButton = messageElement.querySelector('.mes_stmb_start');
    const endButton = messageElement.querySelector('.mes_stmb_end');
    if (!startButton || !endButton) {
        return;
    }

    startButton.classList.remove('on', 'valid-start-point', 'in-scene');
    endButton.classList.remove('on', 'valid-end-point', 'in-scene');

    if (sceneStart !== null && sceneEnd !== null) {
        if (messageId === sceneStart) {
            startButton.classList.add('on');
        } else if (messageId === sceneEnd) {
            endButton.classList.add('on');
        } else if (messageId > sceneStart && messageId < sceneEnd) {
            startButton.classList.add('in-scene');
            endButton.classList.add('in-scene');
        }
        return;
    }

    if (sceneStart !== null) {
        if (messageId === sceneStart) {
            startButton.classList.add('on');
        } else if (messageId > sceneStart) {
            endButton.classList.add('valid-end-point');
        }
        return;
    }

    if (sceneEnd !== null) {
        if (messageId === sceneEnd) {
            endButton.classList.add('on');
        } else if (messageId < sceneEnd) {
            startButton.classList.add('valid-start-point');
        }
    }
}

function renderAllSceneButtons() {
    chatElement.find('.mes').each((_, element) => renderSceneButtonsForMessage(element));
}

function bindSceneButtons() {
    if (sceneButtonsBound) {
        return;
    }

    $(document).on('click', '.mes_stmb_start', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const messageId = Number($(this).closest('.mes').attr('mesid'));
        if (Number.isInteger(messageId)) {
            setSceneMarker('sceneStart', messageId);
        }
    });

    $(document).on('click', '.mes_stmb_end', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const messageId = Number($(this).closest('.mes').attr('mesid'));
        if (Number.isInteger(messageId)) {
            setSceneMarker('sceneEnd', messageId);
        }
    });

    sceneButtonsBound = true;
}

function buildSceneRequest(range) {
    const context = getContext();
    const group = selected_group ? groups.find(item => item.id === selected_group) : null;
    const characterName = selected_group
        ? String(group?.name || name2 || '')
        : String(name2 || context?.characters?.[context.characterId]?.name || '');

    return {
        sceneStart: range.sceneStart,
        sceneEnd: range.sceneEnd,
        chatId: context?.chatId || getCurrentChatId() || '',
        characterName,
        userName: String(name1 || ''),
    };
}

function assertRangeWithinCurrentChat(range) {
    const sceneStart = Number(range?.sceneStart);
    const sceneEnd = Number(range?.sceneEnd);

    if (chat.length === 0) {
        throw new Error('There are no messages in this chat yet.');
    }
    if (!Number.isInteger(sceneStart) || !Number.isInteger(sceneEnd)) {
        throw new Error('Invalid scene range');
    }
    if (sceneStart > sceneEnd) {
        throw new Error('Start message cannot be greater than end message');
    }
    if (sceneStart < 0 || sceneEnd >= chat.length) {
        throw new Error(`Message IDs out of range. Valid range: 0-${Math.max(chat.length - 1, 0)}`);
    }
    if (!chat[sceneStart] || !chat[sceneEnd]) {
        throw new Error('One or more specified messages do not exist');
    }
}

function getCurrentSceneRange() {
    const markers = getSceneMarkers();
    if (!Number.isInteger(markers.sceneStart) || !Number.isInteger(markers.sceneEnd)) {
        throw new Error('No scene markers set');
    }

    assertRangeWithinCurrentChat(markers);
    return markers;
}

function getNextMemoryRange() {
    const highestProcessed = getHighestProcessedMessageId();
    const sceneStart = highestProcessed === null ? 0 : highestProcessed + 1;
    const sceneEnd = chat.length - 1;

    if (sceneStart > sceneEnd) {
        throw new Error('No new messages available for /nextmemory');
    }

    return { sceneStart, sceneEnd };
}

async function resolveAutoSummaryLorebook() {
    if (!getModuleSettings().manualModeEnabled) {
        try {
            const lorebookName = await ensureLorebookName();
            return { valid: Boolean(lorebookName), lorebookName, error: lorebookName ? '' : 'No chat-bound lorebook selected' };
        } catch (error) {
            return {
                valid: false,
                lorebookName: null,
                error: String(error?.message || 'No chat-bound lorebook selected'),
            };
        }
    }

    const state = getStmbState();
    let lorebookName = String(state.manualLorebook || '').trim();
    if (!lorebookName) {
        const decision = await showAutoSummaryDecisionPopup();
        if (decision.action !== 'select') {
            const postponeMessages = Number.isFinite(Number(decision.postponeMessages))
                ? Number(decision.postponeMessages)
                : 10;
            state.autoSummaryNextPromptAt = chat.length + postponeMessages;
            saveMetadataDebounced();
            return {
                valid: false,
                lorebookName: null,
                error: `Auto-summary postponed for ${postponeMessages} messages.`,
            };
        }

        const selectedLorebook = await showLorebookPickerPopup(world_names, {
            title: 'Select Lorebook',
            emptyMessage: 'No existing lorebooks are available.',
        });
        if (!selectedLorebook) {
            return {
                valid: false,
                lorebookName: null,
                error: 'No lorebook selected for auto-summary.',
            };
        }

        state.manualLorebook = selectedLorebook;
        saveMetadataDebounced();
        lorebookName = selectedLorebook;
    }

    return {
        valid: Boolean(lorebookName),
        lorebookName: lorebookName || null,
        error: lorebookName ? '' : 'No manual lorebook selected',
    };
}

async function checkAutoSummaryTrigger() {
    const settings = getModuleSettings();
    if (!settings.autoSummaryEnabled) {
        return;
    }

    const state = getStmbState();
    const currentMessageCount = chat.length;
    if (currentMessageCount === 0) {
        return;
    }

    const currentLastMessage = currentMessageCount - 1;
    const requiredInterval = Number.isFinite(Number(settings.autoSummaryInterval))
        ? Math.max(1, Math.trunc(Number(settings.autoSummaryInterval)))
        : 50;
    const buffer = Number.isFinite(Number(settings.autoSummaryBuffer))
        ? Math.max(0, Math.min(50, Math.trunc(Number(settings.autoSummaryBuffer))))
        : 0;
    const requiredTotal = requiredInterval + buffer;
    const rawHighestProcessed = state.highestMemoryProcessed;
    const hasHighestProcessed = typeof rawHighestProcessed === 'number' && Number.isFinite(rawHighestProcessed);
    const highestProcessed = hasHighestProcessed ? rawHighestProcessed : -1;

    if (hasActiveStmbTasks()) {
        return;
    }

    const messagesSinceLastMemory = currentLastMessage - highestProcessed;
    if (messagesSinceLastMemory < requiredTotal) {
        return;
    }

    if (Number.isInteger(state.autoSummaryNextPromptAt) && currentMessageCount < state.autoSummaryNextPromptAt) {
        return;
    }

    const lorebookResolution = await resolveAutoSummaryLorebook();
    if (!lorebookResolution.valid) {
        console.warn('STMB auto-summary blocked by lorebook resolution', lorebookResolution.error);
        return;
    }

    if (Number.isInteger(state.autoSummaryNextPromptAt)) {
        delete state.autoSummaryNextPromptAt;
        saveMetadataDebounced();
    }

    const sceneStart = highestProcessed + 1;
    const sceneEnd = Math.max(0, currentLastMessage - buffer);
    if (sceneStart > sceneEnd) {
        return;
    }

    setSceneRange(sceneStart, sceneEnd);
    await createMemoryFromRange({ sceneStart, sceneEnd }, { keepSceneMarkers: false });
}

function validateSceneMarkers() {
    const state = getStmbState();
    const chatLength = chat.length;
    let changed = false;

    if (chatLength === 0) {
        if (state.sceneStart !== null || state.sceneEnd !== null) {
            state.sceneStart = null;
            state.sceneEnd = null;
            changed = true;
        }
    } else {
        if (!Number.isInteger(state.sceneStart) || state.sceneStart < 0 || state.sceneStart >= chatLength) {
            if (state.sceneStart !== null) changed = true;
            state.sceneStart = null;
        }
        if (!Number.isInteger(state.sceneEnd) || state.sceneEnd < 0 || state.sceneEnd >= chatLength) {
            if (state.sceneEnd !== null) changed = true;
            state.sceneEnd = Number.isInteger(state.sceneEnd) && chatLength > 0 ? chatLength - 1 : null;
        }
        if (state.sceneStart !== null && state.sceneEnd !== null && state.sceneStart > state.sceneEnd) {
            state.sceneStart = null;
            state.sceneEnd = null;
            changed = true;
        }
    }

    if (Number.isInteger(state.highestMemoryProcessed)) {
        if (chatLength === 0) {
            delete state.highestMemoryProcessed;
            delete state.highestMemoryProcessedManuallySet;
            changed = true;
        } else if (state.highestMemoryProcessed < 0) {
            delete state.highestMemoryProcessed;
            delete state.highestMemoryProcessedManuallySet;
            changed = true;
        } else if (state.highestMemoryProcessed >= chatLength) {
            state.highestMemoryProcessed = chatLength - 1;
            changed = true;
        }
    }

    if (changed) {
        saveMetadataDebounced();
    }
    renderAllSceneButtons();
}

function handleMessageDeletion(deletedId) {
    const id = Number(deletedId);
    if (!Number.isFinite(id)) {
        validateSceneMarkers();
        return;
    }

    const state = getStmbState();
    let newStart = Number.isInteger(state.sceneStart) ? state.sceneStart : null;
    let newEnd = Number.isInteger(state.sceneEnd) ? state.sceneEnd : null;
    let changed = false;

    if (newStart === id && newEnd === id) {
        newStart = null;
        newEnd = null;
        changed = true;
    } else if (newStart !== null && newEnd !== null) {
        if (id < newStart) {
            newStart--;
            newEnd--;
            changed = true;
        } else if (id === newStart) {
            newStart = null;
            if (newEnd > id) {
                newEnd--;
            }
            changed = true;
        } else if (id > newStart && id < newEnd) {
            newEnd--;
            changed = true;
        } else if (id === newEnd) {
            newEnd = null;
            changed = true;
        }
    } else if (newStart !== null) {
        if (id < newStart) {
            newStart--;
            changed = true;
        } else if (id === newStart) {
            newStart = null;
            changed = true;
        }
    } else if (newEnd !== null) {
        if (id < newEnd) {
            newEnd--;
            changed = true;
        } else if (id === newEnd) {
            newEnd = null;
            changed = true;
        }
    }

    if (changed) {
        state.sceneStart = newStart;
        state.sceneEnd = newEnd;
        saveMetadataDebounced();
    }

    if (Number.isInteger(state.highestMemoryProcessed)) {
        if (id < state.highestMemoryProcessed) {
            state.highestMemoryProcessed--;
            saveMetadataDebounced();
        } else if (id === state.highestMemoryProcessed) {
            delete state.highestMemoryProcessed;
            delete state.highestMemoryProcessedManuallySet;
            saveMetadataDebounced();
        }
    }

    validateSceneMarkers();
}

function resolveLorebookName() {
    if (getModuleSettings().manualModeEnabled) {
        const manualLorebook = String(getStmbState().manualLorebook || '').trim();
        return manualLorebook;
    }

    const chatLorebook = String(chat_metadata[METADATA_KEY] || '').trim();
    return chatLorebook;
}

function renderLorebookNameFromTemplate() {
    const chatId = getCurrentChatId() || 'Chat';
    return String(getModuleSettings().lorebookNameTemplate || 'LTM - {{char}} - {{chat}}')
        .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
        .replace(/\{\{user\}\}/g, String(name1 || 'User'))
        .replace(/\{\{chat\}\}/g, String(chatId));
}

async function ensureLorebookName() {
    const existing = resolveLorebookName();
    if (existing) {
        return existing;
    }

    if (getModuleSettings().manualModeEnabled) {
        throw new Error('No manual lorebook selected');
    }

    if (!getModuleSettings().autoCreateLorebook) {
        throw new Error('No chat-bound lorebook selected');
    }

    const lorebookName = renderLorebookNameFromTemplate();
    const created = await createNewWorldInfo(lorebookName);
    if (!created) {
        throw new Error(`Failed to create lorebook "${lorebookName}"`);
    }
    chat_metadata[METADATA_KEY] = lorebookName;
    saveMetadataDebounced();
    return lorebookName;
}

function getMemorySchema() {
    return {
        name: 'stmb_memory',
        strict: true,
        value: STMB_DEFAULT_MEMORY_SCHEMA,
    };
}

function getSummarySchema() {
    return {
        name: 'stmb_summary',
        strict: true,
        value: STMB_SUMMARY_RESPONSE_SCHEMA,
    };
}

function buildSummaryPromptMessages(prompt) {
    return [{ role: 'user', content: String(prompt || '') }];
}

async function requestStructuredMemory(compiledScene, profile, lorebookName, summaryCount, signal) {
    const requestSettings = {
        ...stmbSettings,
        moduleSettings: {
            ...(stmbSettings.moduleSettings || {}),
            defaultMemoryCount: Math.max(0, Math.min(7, Number(summaryCount ?? 0))),
        },
    };
    const prepared = await prepareStmbMemoryMessages({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        compiledScene,
        profile,
        stmbSettings: requestSettings,
    }, { signal });

    let promptText = String(prepared.promptText || '');
    if (getModuleSettings().useRegex) {
        promptText = applySelectedRegex(promptText, getModuleSettings().selectedRegexOutgoing);
    }

    const { generateData } = await buildOpenAIGenerateData('quiet', [{ role: 'user', content: promptText }], {
        jsonSchema: getMemorySchema(),
    });
    const result = await generateStmbText({
        generateData: applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
    }, { signal });

    try {
        const parseTarget = getModuleSettings().useRegex
            ? applySelectedRegex(String(result.text || ''), getModuleSettings().selectedRegexIncoming)
            : (result.providerResponse ?? result.text);
        return parseStructuredMemoryResponse(parseTarget);
    } catch (error) {
        error.rawResponse = typeof result?.text === 'string' && result.text
            ? result.text
            : JSON.stringify(result?.providerResponse ?? {});
        error.providerBody = JSON.stringify(result?.providerResponse ?? {});
        throw error;
    }
}

async function requestStructuredSummary(prompt, profile, signal) {
    const { generateData } = await buildOpenAIGenerateData('quiet', buildSummaryPromptMessages(prompt), {
        jsonSchema: getSummarySchema(),
    });
    const result = await generateStmbSummary({
        generateData: applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
    }, { signal });
    return result.parsed;
}

function installAbortHook() {
    const task = createStmbTask('STMB:root');
    activeRootTask = task;
    return {
        controller: task.controller,
        signal: task.signal,
        cleanup: () => {
            task.cleanup();
            if (activeRootTask === task) {
                activeRootTask = null;
            }
        },
    };
}

function buildMemorySceneData(compiledScene, range) {
    return {
        sceneStart: range.sceneStart,
        sceneEnd: range.sceneEnd,
        messageCount: compiledScene?.metadata?.messageCount ?? 0,
        chatId: compiledScene?.metadata?.chatId || '',
        characterName: compiledScene?.metadata?.characterName || '',
        userName: compiledScene?.metadata?.userName || '',
        titleFormat: stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT,
    };
}

async function applyPostSaveLorebookEffects(lorebookName, range) {
    if (getModuleSettings().refreshEditor !== false) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn('STMB refreshEditor failed', error);
        }
    }

    const autoHideMode = String(getModuleSettings().autoHideMode || 'none').toLowerCase();
    if (autoHideMode === 'none') {
        return;
    }

    const unhiddenCount = Number.isFinite(Number(getModuleSettings().unhiddenEntriesCount))
        ? Math.max(0, Math.trunc(Number(getModuleSettings().unhiddenEntriesCount)))
        : 2;

    try {
        if (autoHideMode === 'all') {
            const hideEnd = unhiddenCount === 0 ? range.sceneEnd : range.sceneEnd - unhiddenCount;
            if (hideEnd >= 0) {
                await executeSlashCommands(`/hide 0-${hideEnd}`);
            }
            return;
        }

        if (autoHideMode === 'last') {
            const sceneSize = range.sceneEnd - range.sceneStart + 1;
            if (unhiddenCount >= sceneSize) {
                return;
            }

            const hideEnd = unhiddenCount === 0 ? range.sceneEnd : range.sceneEnd - unhiddenCount;
            if (hideEnd >= range.sceneStart) {
                await executeSlashCommands(`/hide ${range.sceneStart}-${hideEnd}`);
            }
        }
    } catch (error) {
        console.warn('STMB auto-hide failed', error);
    }
}

function normalizePreviewMemory(memoryObject) {
    return {
        title: String(memoryObject?.title || '').trim(),
        extractedTitle: String(memoryObject?.title || '').trim(),
        content: String(memoryObject?.content || '').trim(),
        keywords: Array.isArray(memoryObject?.keywords) ? memoryObject.keywords.slice() : [],
        suggestedKeys: Array.isArray(memoryObject?.keywords) ? memoryObject.keywords.slice() : [],
    };
}

async function maybePreviewMemory(memoryObject, compiledScene, range, profile) {
    if (!getModuleSettings().showMemoryPreviews) {
        return memoryObject;
    }

    const previewResult = await showMemoryPreviewPopup(
        normalizePreviewMemory(memoryObject),
        {
            sceneStart: range.sceneStart,
            sceneEnd: range.sceneEnd,
            messageCount: compiledScene?.metadata?.messageCount ?? 0,
        },
        profile,
    );

    if (previewResult?.action === 'cancel') {
        return null;
    }
    if (previewResult?.action === 'retry') {
        return 'retry';
    }
    if (previewResult?.action === 'edit' && previewResult.memoryData) {
        return {
            title: String(previewResult.memoryData.extractedTitle || previewResult.memoryData.title || '').trim(),
            content: String(previewResult.memoryData.content || '').trim(),
            keywords: Array.isArray(previewResult.memoryData.suggestedKeys)
                ? previewResult.memoryData.suggestedKeys.slice()
                : Array.isArray(previewResult.memoryData.keywords)
                    ? previewResult.memoryData.keywords.slice()
                    : [],
        };
    }

    return memoryObject;
}

async function saveMemoryObjectToLorebook(memoryObject, { lorebookName, range, compiledScene, profile, keepSceneMarkers = false, signal = null }) {
    throwIfStmbAborted(signal);
    const result = await saveStmbMemoryEntry({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        memoryObject,
        sceneContext: buildMemorySceneData(compiledScene, range),
        profile,
    }, { signal });
    throwIfStmbAborted(signal);
    worldInfoCache.delete(lorebookName);
    await applyPostSaveLorebookEffects(lorebookName, range);
    throwIfStmbAborted(signal);
    setHighestProcessedMessageId(range.sceneEnd);
    if (!keepSceneMarkers || getModuleSettings().autoClearSceneAfterMemory) {
        clearSceneMarkers();
    }

    if (getModuleSettings().showNotifications) {
        toastr.success(`Memory saved to "${lorebookName}"`, 'STMB');
    }

    return {
        lorebookName,
        memory: memoryObject,
        entry: result.entry,
    };
}

async function applyManualFixedMemoryJson(correctedRaw, context) {
    const task = createStmbTask('STMB:manual-repair');
    try {
        let memoryCandidate = parseStructuredMemoryResponse(correctedRaw);

        for (;;) {
            const maybeEdited = await maybePreviewMemory(memoryCandidate, context.compiledScene, context.range, context.profile);
            if (maybeEdited === null) {
                return null;
            }
            if (maybeEdited === 'retry') {
                memoryCandidate = await requestStructuredMemory(
                    context.compiledScene,
                    context.profile,
                    context.lorebookName,
                    context.summaryCount,
                    task.signal,
                );
                continue;
            }

            const saved = await saveMemoryObjectToLorebook(maybeEdited, {
                lorebookName: context.lorebookName,
                range: context.range,
                compiledScene: context.compiledScene,
                profile: context.profile,
                keepSceneMarkers: context.keepSceneMarkers,
                signal: task.signal,
            });

            try {
                await runAfterMemory(context.compiledScene, stmbSettings, context.profile, { signal: task.signal });
            } catch (error) {
                if (!isStmbAbortError(error)) {
                    console.warn('STMB side prompts after manual repair failed', error);
                }
            }

            return saved;
        }
    } finally {
        task.cleanup();
    }
}

async function commitSummaryCandidates(summaryCandidates, {
    normalizedTargetTier,
    lorebookName,
    titleFormat,
    migrated = false,
    disableOriginals = false,
    signal = null,
}) {
    throwIfStmbAborted(signal);
    const result = await commitStmbSummaries({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        summaryCandidates,
        targetTier: normalizedTargetTier,
        titleFormat,
        migrated,
        disableOriginals,
        summaryEntrySettings: getModuleSettings().summaryEntrySettings || {},
    }, { signal });
    throwIfStmbAborted(signal);
    worldInfoCache.delete(lorebookName);
    const createdEntries = Array.isArray(result?.createdEntries) ? result.createdEntries : [];

    if (getModuleSettings().showNotifications) {
        toastr.success(
            `${getSummaryTierLabel(normalizedTargetTier)} summary saved to "${lorebookName}"`,
            'STMB',
        );
    }

    lastFailedSummaryError = null;
    lastFailedSummaryContext = null;

    return createdEntries;
}

async function createMemoryFromRange(range, options = {}) {
    if (hasActiveStmbTasks()) {
        throw new Error('Memory creation is already in progress');
    }

    assertRangeWithinCurrentChat(range);

    const lorebookName = await ensureLorebookName();
    const compiledScene = compileScene(chat, buildSceneRequest(range));
    const effectiveSettings = await showAndGetMemorySettings(compiledScene, range, lorebookName, options.profileIndex ?? null);
    if (!effectiveSettings) {
        return null;
    }
    const profile = effectiveSettings.profileSettings;
    const { signal, cleanup } = installAbortHook();
    try {
        for (;;) {
            try {
                const parsedMemory = await requestStructuredMemory(compiledScene, profile, lorebookName, effectiveSettings.summaryCount, signal);
                const maybeEdited = await maybePreviewMemory(parsedMemory, compiledScene, range, profile);
                if (maybeEdited === null) {
                    return null;
                }
                if (maybeEdited === 'retry') {
                    continue;
                }

                const saved = await saveMemoryObjectToLorebook(maybeEdited, {
                    lorebookName,
                    range,
                    compiledScene,
                    profile,
                    keepSceneMarkers: options.keepSceneMarkers,
                    signal,
                });

                try {
                    await runAfterMemory(compiledScene, stmbSettings, profile, { signal });
                } catch (error) {
                    if (!isStmbAbortError(error)) {
                        console.warn('STMB side prompts after memory failed', error);
                    }
                }

                return saved;
            } catch (error) {
                if (isStmbAbortError(error)) {
                    throw error;
                }
                if (error?.rawResponse) {
                    showFailedAIResponsePopup(error, {
                        onApply: correctedRaw => applyManualFixedMemoryJson(correctedRaw, {
                            lorebookName,
                            range,
                            compiledScene,
                            profile,
                            summaryCount: effectiveSettings.summaryCount,
                            keepSceneMarkers: options.keepSceneMarkers,
                            signal,
                        }),
                    });
                }
                throw error;
            }
        }
    } finally {
        cleanup();
    }
}

export async function createSummaryForTier(targetTier, options = {}) {
    if (hasActiveStmbTasks()) {
        throw new Error('STMB generation is already in progress');
    }

    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)));
    const lorebookName = await ensureLorebookName();
    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    const migrated = migrateLorebookSummarySchema(lorebookData);
    const sourceEntries = identifyEligibleSummarySourceEntries(lorebookData.entries, normalizedTargetTier);
    const configuredMinimum = getModuleSettings().summaryTierMinimums?.[normalizedTargetTier];
    const requiredMinimum = normalizeSummaryMinChildren(
        options.requiredMin,
        configuredMinimum ?? getDefaultSummaryMinChildren(normalizedTargetTier),
    );
    if (sourceEntries.length < requiredMinimum) {
        throw new Error(
            `Not enough ${getSummaryTierLabel(normalizedTargetTier - 1).toLowerCase()} entries to create a ${getSummaryTierLabel(normalizedTargetTier).toLowerCase()} summary (${sourceEntries.length}/${requiredMinimum})`,
        );
    }

    const existingSummaries = identifyManagedSummaryEntries(lorebookData.entries, normalizedTargetTier);
    const previousSummary = existingSummaries.at(-1) || null;
    const profile = getActiveStmbProfile(stmbSettings, options.profileIndex ?? null);
    const presetKey = typeof options.presetKey === 'string' && options.presetKey.trim()
        ? options.presetKey.trim()
        : 'arc_default';
    const promptText = getSummaryPrompt(stmbSettings, presetKey);
    const { signal, cleanup } = installAbortHook();
    try {
        const promptResult = await prepareStmbSummaryPrompt({
            sourceEntries,
            previousSummary: previousSummary?.content || null,
            previousOrder: previousSummary ? (parseSequenceFromTitle(previousSummary.comment || '') ?? null) : null,
            promptText,
            targetTier: normalizedTargetTier,
        }, { signal });
        const prompt = String(promptResult?.prompt || '');
        const parsed = await requestStructuredSummary(prompt, profile, signal);
        const { summaryCandidates } = createSummaryCandidatesFromResponse(parsed, sourceEntries);
        if (summaryCandidates.length === 0) {
            throw new Error(`Model did not return a usable ${getSummaryTierLabel(normalizedTargetTier).toLowerCase()} summary`);
        }

        const titleFormat = typeof options.titleFormat === 'string' && options.titleFormat.trim()
            ? options.titleFormat
            : getDefaultSummaryTitleFormat(normalizedTargetTier);
        const createdEntries = await commitSummaryCandidates(summaryCandidates, {
            normalizedTargetTier,
            lorebookName,
            titleFormat,
            migrated,
            disableOriginals: Boolean(options.disableOriginals),
            signal,
        });

        return {
            lorebookName,
            targetTier: normalizedTargetTier,
            summaryCandidates,
            entries: createdEntries,
        };
    } catch (error) {
        if (!isStmbAbortError(error) && error?.rawResponse) {
            const titleFormat = typeof options.titleFormat === 'string' && options.titleFormat.trim()
                ? options.titleFormat
                : getDefaultSummaryTitleFormat(normalizedTargetTier);
            lastFailedSummaryError = error;
            lastFailedSummaryContext = {
                lorebookName,
                normalizedTargetTier,
                titleFormat,
                disableOriginals: Boolean(options.disableOriginals),
            };
            showFailedSummaryResponsePopup(error, {
                onApply: async correctedRaw => {
                    const repairTask = createStmbTask('STMB:summary-manual-repair');
                    try {
                        const context = lastFailedSummaryContext || {
                            lorebookName,
                            normalizedTargetTier,
                            titleFormat,
                            disableOriginals: Boolean(options.disableOriginals),
                        };
                        const freshLorebookData = await loadWorldInfo(context.lorebookName) || { entries: {} };
                        if (!freshLorebookData.entries || typeof freshLorebookData.entries !== 'object') {
                            freshLorebookData.entries = {};
                        }
                        const freshMigrated = migrateLorebookSummarySchema(freshLorebookData);
                        const freshSourceEntries = identifyEligibleSummarySourceEntries(
                            freshLorebookData.entries,
                            context.normalizedTargetTier,
                        );
                        const correctedParsed = parseSummaryJsonResponse(correctedRaw);
                        const { summaryCandidates } = createSummaryCandidatesFromResponse(correctedParsed, freshSourceEntries);
                        if (summaryCandidates.length === 0) {
                            throw new Error(`Model did not return a usable ${getSummaryTierLabel(context.normalizedTargetTier).toLowerCase()} summary`);
                        }
                        await commitSummaryCandidates(summaryCandidates, {
                            normalizedTargetTier: context.normalizedTargetTier,
                            lorebookName: context.lorebookName,
                            titleFormat: context.titleFormat,
                            migrated: freshMigrated,
                            disableOriginals: Boolean(context.disableOriginals),
                            signal: repairTask.signal,
                        });
                        return true;
                    } finally {
                        repairTask.cleanup();
                    }
                },
            });
        }
        throw error;
    } finally {
        cleanup();
    }
}

function showSlashCommandError(message, error) {
    if (isStmbAbortError(error)) {
        toastr.info('STMB generation stopped', 'STMB');
        return;
    }
    if (error) {
        console.error('STMemoryBooks slash command failed:', error);
    }

    toastr.error(String(message || 'STMB command failed'), 'STMB');
}

async function createMemoryCommand() {
    try {
        await createMemoryFromRange(getCurrentSceneRange());
    } catch (error) {
        showSlashCommandError(error?.message || 'Failed to create memory.', error);
    }

    return '';
}

async function sceneMemoryCommand(_, rangeText) {
    try {
        const rangeValue = String(rangeText || '').trim();
        if (!rangeValue) {
            throw new Error('Missing range argument. Use: /scenememory X-Y (e.g., /scenememory 10-15)');
        }

        const match = rangeValue.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        if (!match) {
            throw new Error('Invalid format. Use: /scenememory X-Y (e.g., /scenememory 10-15)');
        }

        const startId = Number(match[1]);
        const endId = Number(match[2]);
        if (!Number.isFinite(startId) || !Number.isFinite(endId)) {
            throw new Error('Invalid message IDs parsed. Use: /scenememory X-Y (e.g., /scenememory 10-15)');
        }

        const range = { sceneStart: startId, sceneEnd: endId };
        assertRangeWithinCurrentChat(range);
        setSceneRange(range.sceneStart, range.sceneEnd);
        const group = selected_group ? groups.find(item => item.id === selected_group) : null;
        const groupSuffix = group?.name ? ` in group "${group.name}"` : '';
        toastr.info(`Scene set: messages ${range.sceneStart}-${range.sceneEnd}${groupSuffix}`, 'STMB');
        await createMemoryFromRange(range, { keepSceneMarkers: true });
    } catch (error) {
        showSlashCommandError(error?.message || 'Failed to create memory from scene range.', error);
    }

    return '';
}

async function nextMemoryCommand() {
    try {
        if (chat.length === 0) {
            toastr.info('There are no messages to summarize yet.', 'STMB');
            return '';
        }

        const range = getNextMemoryRange();
        setSceneRange(range.sceneStart, range.sceneEnd);
        await createMemoryFromRange(range, { keepSceneMarkers: true });
    } catch (error) {
        if (error?.message === 'No new messages available for /nextmemory') {
            toastr.info('No new messages since the last memory.', 'STMB');
            return '';
        }
        showSlashCommandError(error?.message || 'Failed to create next memory.', error);
    }

    return '';
}

async function sidePromptCommand(_, rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        toastr.info('SidePrompt guide: /sideprompt "Name" {{macro}}="value" [X-Y]', 'STMB');
        return '';
    }

    try {
        if (getActiveStmbTaskCount() > 0) {
            throw new Error('STMB generation is already in progress');
        }
        await runSidePrompt(raw, stmbSettings);
    } catch (error) {
        showSlashCommandError(error?.message || 'Failed to run side prompt.', error);
    }

    return '';
}

async function toggleSidePromptCommand(_, rawInput, enabled) {
    try {
        const result = await toggleSidePromptEnabled(String(rawInput || '').trim(), enabled);
        if (result.all) {
            toastr.success(`${enabled ? 'Enabled' : 'Disabled'} ${result.changed} side prompt${result.changed === 1 ? '' : 's'}`, 'STMB');
        } else if (result.template) {
            if (result.changed > 0) {
                toastr.success(`${enabled ? 'Enabled' : 'Disabled'} "${result.template.name}"`, 'STMB');
            } else {
                toastr.info(`"${result.template.name}" is already ${enabled ? 'enabled' : 'disabled'}`, 'STMB');
            }
        }
    } catch (error) {
        showSlashCommandError(error?.message || 'Failed to toggle side prompt.', error);
    }

    return '';
}

async function sidePromptOnCommand(_, rawInput) {
    return toggleSidePromptCommand(_, rawInput, true);
}

async function sidePromptOffCommand(_, rawInput) {
    return toggleSidePromptCommand(_, rawInput, false);
}

async function getHighestProcessedCommand() {
    const highestProcessed = getHighestProcessedMessageId();
    return String(highestProcessed);
}

async function setHighestProcessedCommand(_, value) {
    try {
        const raw = String(value || '').trim();
        if (!raw) {
            throw new Error('Missing argument. Use: /stmb-set-highest <N|none>');
        }

        const input = raw.toLowerCase();
        if (input === 'none') {
            delete getStmbState().highestMemoryProcessed;
            delete getStmbState().highestMemoryProcessedManuallySet;
            saveMetadataDebounced();
            return '';
        }

        const parsed = Number.parseInt(input, 10);
        if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
            throw new Error('Invalid argument. Use: /stmb-set-highest <N|none>');
        }

        const lastIndex = chat.length - 1;
        if (lastIndex < 0) {
            throw new Error('There are no messages in this chat yet.');
        }
        if (parsed < 0) {
            throw new Error(`Message IDs out of range. Valid range: 0-${lastIndex}`);
        }

        const state = getStmbState();
        state.highestMemoryProcessed = Math.min(parsed, lastIndex);
        state.highestMemoryProcessedManuallySet = true;
        saveMetadataDebounced();
    } catch (error) {
        showSlashCommandError(error?.message || 'Failed to set highest processed message.', error);
        return '';
    }

    return '';
}

async function stopStmbCommand() {
    const { stoppedCount } = stopAllStmbTasks();
    closeActiveMemoryPreviewPopups();
    if (activeRootTask) {
        activeRootTask = null;
    }

    if (stoppedCount > 0) {
        toastr.info(`Stopped ${stoppedCount} STMB task${stoppedCount === 1 ? '' : 's'}`, 'STMB');
    } else {
        toastr.info('No in-flight STMB tasks to stop', 'STMB');
    }

    return '';
}

function registerSlashCommands() {
    if (slashCommandsRegistered) {
        return;
    }

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'creatememory',
        callback: createMemoryCommand,
        helpString: 'Create memory from marked scene',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scenememory',
        callback: sceneMemoryCommand,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message range (X-Y format)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Set scene range and create memory (e.g., /scenememory 10-15)',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'nextmemory',
        callback: nextMemoryCommand,
        helpString: 'Create memory from end of last memory to current message',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'sideprompt',
        callback: sidePromptCommand,
        rawQuotes: true,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Quoted template name, then any required {{macro}}="value" assignments, optionally followed by X-Y range',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Run side prompt. Usage: /sideprompt "Name" {{macro}}="value" [X-Y]',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'sideprompt-on',
        callback: sidePromptOnCommand,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Template name (quote if contains spaces) or "all"',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Enable a Side Prompt by name or all. Usage: /sideprompt-on "Name" | all',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'sideprompt-off',
        callback: sidePromptOffCommand,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Template name (quote if contains spaces) or "all"',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Disable a Side Prompt by name or all. Usage: /sideprompt-off "Name" | all',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'stmb-highest',
        callback: getHighestProcessedCommand,
        helpString: 'Return the highest message index for processed memories in this chat. Usage: /stmb-highest',
        returns: 'Highest memory processed message index as a string.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'stmb-set-highest',
        callback: setHighestProcessedCommand,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message index (0-based) or "none" to reset',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Manually set the highest processed message index for this chat. Usage: /stmb-set-highest <N|none>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'stmb-stop',
        callback: stopStmbCommand,
        helpString: 'Stop all in-flight STMB generation everywhere. Usage: /stmb-stop',
    }));

    slashCommandsRegistered = true;
}

export function initStmb() {
    if (stmbInitialized) {
        return;
    }

    bindSceneButtons();
    registerSlashCommands();
    firstRunInitSidePrompts().catch(error => {
        console.warn('STMB side prompts init failed', error);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            validateSceneMarkers();
            renderAllSceneButtons();
        }, 0);
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
        if (hasActiveStmbTasks()) {
            return;
        }
        evaluateTrackers(stmbSettings).catch(error => {
            console.warn('STMB evaluateTrackers failed after message receive', error);
        });
        if (!selected_group) {
            checkAutoSummaryTrigger().catch(error => {
                console.warn('STMB auto-summary trigger failed after message receive', error);
            });
        }
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
        if (hasActiveStmbTasks()) {
            return;
        }
        evaluateTrackers(stmbSettings).catch(error => {
            console.warn('STMB evaluateTrackers failed after user message', error);
        });
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
    });

    eventSource.on(event_types.SETTINGS_LOADED, () => {
        renderAllSceneButtons();
    });

    eventSource.on(event_types.MESSAGE_DELETED, (deletedId) => {
        handleMessageDeletion(deletedId);
    });

    eventSource.on(event_types.GROUP_WRAPPER_FINISHED, () => {
        if (hasActiveStmbTasks()) {
            return;
        }
        checkAutoSummaryTrigger().catch(error => {
            console.warn('STMB auto-summary trigger failed after group wrapper', error);
        });
    });

    stmbInitialized = true;
}
