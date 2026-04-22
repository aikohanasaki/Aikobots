import {
    showdown,
    moment,
    DOMPurify,
    hljs,
    Handlebars,
    SVGInject,
    Popper,
    initLibraryShims,
    default as libs,
} from './lib.js';

import { humanizedDateTime, favsToHotswap, getMessageTimeStamp, dragElement, isMobile, initRossMods } from './scripts/RossAscends-mods.js';
import { userStatsHandler, statMesProcess, initStats } from './scripts/stats.js';

import {
    world_info,
    getWorldInfoSettings,
    getWorldInfoRegexScripts,
    setWorldInfoSettings,
    world_names,
    importEmbeddedWorldInfo,
    checkEmbeddedWorld,
    setWorldInfoButtonClass,
    wi_anchor_position,
    selected_world_info,
    getSecureWorldNames,
    world_info_depth,
    world_info_min_activations,
    world_info_min_activations_depth_max,
    world_info_budget,
    world_info_include_names,
    world_info_recursive,
    world_info_case_sensitive,
    world_info_match_whole_words,
    world_info_use_group_scoring,
    world_info_budget_cap,
    world_info_max_recursion_steps,
    world_info_position,
    METADATA_KEY,
    initWorldInfo,
    charUpdatePrimaryWorld,
    charSetAuxWorlds,
    getCharacterExtraBooks,
    getEditableCharacterExtraBooks,
    getLegacyCharacterExtraBooks,
    getForcedActivationEntriesSnapshot,
} from './scripts/world-info.js';

import {
    groups,
    selected_group,
    saveGroupChat,
    getGroups,
    generateGroupWrapper,
    is_group_generating,
    resetSelectedGroup,
    select_group_chats,
    regenerateGroup,
    group_generation_id,
    getGroupChat,
    getGroupPastChats,
    renameGroupMember,
    createNewGroupChat,
    getGroupAvatar,
    editGroup,
    deleteGroupChat,
    deleteGroupChatByName,
    renameGroupChat,
    importGroupChat,
    getGroupBlock,
    getGroupCharacterCards,
    getGroupDepthPrompts,
    openGroupById,
    openGroupChat,
} from './scripts/group-chats.js';

import {
    collapseNewlines,
    loadPowerUserSettings,
    playMessageSound,
    fixMarkdown,
    power_user,
    persona_description_positions,
    loadMovingUIState,
    getCustomStoppingStrings,
    MAX_CONTEXT_DEFAULT,
    MAX_RESPONSE_DEFAULT,
    LONG_CHAT_BUFFER_GAP,
    LONG_CHAT_BUFFER_MAX,
    LONG_CHAT_BUFFER_MIN,
    LONG_CHAT_DISPLAY_MAX,
    LONG_CHAT_DISPLAY_MIN,
    normalizeLongChatHandlingSettings,
    sortEntitiesList,
    registerDebugFunction,
    flushEphemeralStoppingStrings,
    resetMovableStyles,
    forceCharacterEditorTokenize,
    applyPowerUserSettings,
    generatedTextFiltered,
    applyStylePins,
} from './scripts/power-user.js';

import {
    setOpenAIMessageExamples,
    setOpenAIMessages,
    setupChatCompletionPromptManager,
    consumeOpenAIResponseData,
    buildServerAssemblyPayload,
    debugServerAssemblyDump,
    getLastServerAssemblyDebugDump,
    maintainPromptInspectionSnapshots,
    sendOpenAIRequest,
    loadOpenAISettings,
    oai_settings,
    chat_completion_sources,
    getChatCompletionModel,
    proxies,
    loadProxyPresets,
    selected_proxy,
    initOpenAI,
} from './scripts/openai.js';

import {
    initBookmarks,
    showBookmarksButtons,
    updateBookmarkDisplay,
} from './scripts/bookmarks.js';

import {
    debounce,
    delay,
    trimToEndSentence,
    countOccurrences,
    isOdd,
    sortMoments,
    timestampToMoment,
    download,
    isDataURL,
    getCharaFilename,
    PAGINATION_TEMPLATE,
    waitUntilCondition,
    escapeRegex,
    resetScrollHeight,
    onlyUnique,
    getBase64Async,
    humanFileSize,
    Stopwatch,
    isValidUrl,
    ensureImageFormatSupported,
    flashHighlight,
    toggleDrawer,
    isElementInViewport,
    copyText,
    escapeHtml,
    uuidv4,
    equalsIgnoreCaseAndAccents,
    localizePagination,
    renderPaginationDropdown,
    paginationDropdownChangeHandler,
    importFromExternalUrl,
    shiftUpByOne,
    shiftDownByOne,
    canUseNegativeLookbehind,
    trimSpaces,
    clamp,
    urlContentToDataUri,
} from './scripts/utils.js';
import { debounce_timeout, GENERATION_TYPE_TRIGGERS, IGNORE_SYMBOL, inject_ids, MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE, SCROLL_BEHAVIOR, SWIPE_DIRECTION } from './scripts/constants.js';

import { cancelDebouncedMetadataSave, doDailyExtensionUpdatesCheck, extension_settings, initExtensions, loadExtensionSettings, runGenerationInterceptors } from './scripts/extensions.js';
import { COMMENT_NAME_DEFAULT, CONNECT_API_MAP, executeSlashCommandsOnChatInput, initDefaultSlashCommands, isExecutingCommandsFromChatInput, pauseScriptExecution, stopScriptExecution, UNIQUE_APIS } from './scripts/slash-commands.js';
import {
    tag_map,
    tags,
    filterByTagState,
    isBogusFolder,
    isBogusFolderOpen,
    chooseBogusFolder,
    getTagBlock,
    loadTagsSettings,
    printTagFilters,
    getTagKeyForEntity,
    printTagList,
    createTagMapFromList,
    renameTagKey,
    importTags,
    tag_filter_type,
    compareTagsForSort,
    initTags,
    applyTagsOnCharacterSelect,
    applyTagsOnGroupSelect,
    tag_import_setting,
    applyCharacterTagsToMessageDivs,
} from './scripts/tags.js';
import { initSecrets, readSecretState } from './scripts/secrets.js';
import { markdownExclusionExt } from './scripts/showdown-exclusion.js';
import { markdownUnderscoreExt } from './scripts/showdown-underscore.js';
import { NOTE_MODULE_NAME, initAuthorsNote, metadata_keys, setFloatingPrompt, shouldWIAddPrompt } from './scripts/authors-note.js';
import { registerPromptManagerMigration } from './scripts/PromptManager.js';
import { getRegexedString, regex_placement } from './scripts/extensions/regex/engine.js';
import { initLogprobs, saveLogprobsForActiveMessage } from './scripts/logprobs.js';
import { FILTER_STATES, FILTER_TYPES, FilterHelper, isFilterState } from './scripts/filters.js';
import { getCfgPrompt, getGuidanceScale, initCfg } from './scripts/cfg-scale.js';
import { initLocales, t } from './scripts/i18n.js';
import { getFriendlyTokenizerName, getTokenCount, getTokenCountAsync, getTokenizerModel, initTokenizers, saveTokenCache } from './scripts/tokenizers.js';
import {
    user_avatar,
    getUserAvatars,
    getUserAvatar,
    setUserAvatar,
    initPersonas,
    setPersonaDescription,
    initUserAvatar,
    updatePersonaConnectionsAvatarList,
    isPersonaPanelOpen,
} from './scripts/personas.js';
import { getBackgrounds, initBackgrounds, loadBackgroundSettings, background_settings } from './scripts/backgrounds.js';
import { deferLoader, ensureDeferredLoaderShown, hideLoader, isLoaderVisible, showLoader, waitForLoaderPaint } from './scripts/loader.js';
import { BulkEditOverlay } from './scripts/BulkEditOverlay.js';
import { appendFileContent, backfillImageMediaIdsForMessages, createImageAttachmentFromUrl, getMediaAttachmentUrl, hasPendingFileAttachment, hydrateMediaAttachment, markImageAttachmentUnavailable, populateFileAttachment, decodeStyleTags, encodeStyleTags, isExternalMediaAllowed, preserveNeutralChat, restoreNeutralChat, formatCreatorNotes, initChatUtilities, addDOMPurifyHooks } from './scripts/chats.js';
import { getPresetManager, initPresetManager } from './scripts/preset-manager.js';
import { evaluateMacros, getLastMessageId, initMacros, MacrosParser } from './scripts/macros.js';
import { currentUser, setUserControls, submitSelectedCharacterForReview } from './scripts/user.js';
import { POPUP_RESULT, POPUP_TYPE, Popup, callGenericPopup, fixToastrForDialogs } from './scripts/popup.js';
import { renderTemplate, renderTemplateAsync } from './scripts/templates.js';
import { initScrapers } from './scripts/scrapers.js';
import { DragAndDropHandler } from './scripts/dragdrop.js';
import { INTERACTABLE_CONTROL_CLASS, initKeyboard } from './scripts/keyboard.js';
import { initDynamicStyles } from './scripts/dynamic-styles.js';
import { initInputMarkdown } from './scripts/input-md-formatting.js';
import { AbortReason } from './scripts/util/AbortReason.js';
import { registerExtensionSlashCommands as initExtensionSlashCommands } from './scripts/extensions-slashcommands.js';
import { ToolManager } from './scripts/tool-calling.js';
import { addShowdownPatch } from './scripts/util/showdown-patch.js';
import { applyBrowserFixes } from './scripts/browser-fixes.js';
import { initServerHistory } from './scripts/server-history.js';
import { initBulkEdit } from './scripts/bulk-edit.js';
import { getContext } from './scripts/st-context.js';
import { extractReasoningFromData, initReasoning, parseReasoningInSwipes, PromptReasoning, ReasoningHandler, ReasoningType, removeReasoningFromString, updateReasoningUI } from './scripts/reasoning.js';
import { accountStorage } from './scripts/util/AccountStorage.js';
import { initWelcomeScreen, openPermanentAssistantChat, getPermanentAssistantAvatar } from './scripts/welcome-screen.js';
import { initDataMaid } from './scripts/data-maid.js';
import { clearItemizedPrompts, deleteItemizedPrompts, findItemizedPromptSet, getLatestItemizedPrompt, initItemizedPrompts, itemizedParams, itemizedPrompts, loadItemizedPrompts, promptItemize, replaceItemizedPromptText, saveItemizedPrompts, setLatestItemizedPrompt } from './scripts/itemized-prompts.js';
import { getSystemMessageByType, initSystemMessages, SAFETY_CHAT, sendSystemMessage, system_message_types, system_messages } from './scripts/system-messages.js';
import { event_types, eventSource } from './scripts/events.js';
import { isAdmin } from './scripts/user.js';
import { initializeHiddenTemplates } from './scripts/hidden-templates.js';
import { initializeModelTagInjection } from './scripts/model-tag-injection.js';
import { initAccessibility } from './scripts/a11y.js';
import { applyStreamFadeIn } from './scripts/util/stream-fadein.js';
import { initDomHandlers } from './scripts/dom-handlers.js';
import { SimpleMutex } from './scripts/util/SimpleMutex.js';
import { AudioPlayer } from './scripts/audio-player.js';
import { getStmbSettings, initStmb, loadStmbSettings } from './scripts/stmb.js';

let pendingPromptInspectorRecord = null;

function createPromptInspectorButton() {
    return $('<div>', {
        title: 'Prompt',
        class: 'mes_button mes_prompt fa-solid fa-square-poll-horizontal',
        'data-i18n': '[title]Prompt',
    });
}

function getPromptInspectorTargetMessageId() {
    const retainedPrompt = getLatestItemizedPrompt();
    const targetMesId = Number(retainedPrompt?.mesId);
    if (!Number.isFinite(targetMesId) || targetMesId < 0) {
        return null;
    }

    const targetMessage = chat[targetMesId];
    if (!targetMessage || targetMessage.is_user || targetMessage.is_system) {
        return null;
    }

    if (Array.isArray(targetMessage.swipes) && targetMessage.swipes.length > 0) {
        const activeSwipeId = Number(targetMessage.swipe_id);
        if (!Number.isFinite(activeSwipeId) || activeSwipeId !== targetMessage.swipes.length - 1) {
            return null;
        }
    }

    return targetMesId;
}

function refreshPromptInspectorButton() {
    chatElement.find('.mes_prompt').remove();

    const targetMesId = getPromptInspectorTargetMessageId();
    if (!Number.isFinite(targetMesId)) {
        return;
    }

    const messageElement = chatElement.find(`.mes[mesid="${targetMesId}"]`).last();
    if (!messageElement.length) {
        return;
    }

    const extraButtons = messageElement.find('.extraMesButtons').first();
    if (!extraButtons.length) {
        return;
    }

    const promptButton = createPromptInspectorButton();
    const insertionTarget = extraButtons.find('.mes_hide').first();
    if (insertionTarget.length) {
        promptButton.insertBefore(insertionTarget);
    } else {
        extraButtons.append(promptButton);
    }
}

function showPromptInspectorButtonForMessage(_messageId) {
    refreshPromptInspectorButton();
}

function stagePromptInspectorRecord(record) {
    pendingPromptInspectorRecord = record && typeof record === 'object'
        ? structuredClone(record)
        : null;
}

function parsePromptSnapshotKey(promptSnapshotKey) {
    const parts = String(promptSnapshotKey || '').split('|');
    if (parts.length !== 4) {
        return null;
    }

    const [username, chatScope, mesIdText, swipeIdText] = parts;
    const mesId = Number(mesIdText);
    const swipeId = Number(swipeIdText);
    if (!username || !chatScope || !Number.isFinite(mesId) || mesId < 0 || !Number.isFinite(swipeId) || swipeId < 0) {
        return null;
    }

    return { username, chatScope, mesId, swipeId };
}

function buildPromptSnapshotKey({ username, chatScope, mesId, swipeId }) {
    if (!username || !chatScope || !Number.isFinite(Number(mesId)) || Number(mesId) < 0 || !Number.isFinite(Number(swipeId)) || Number(swipeId) < 0) {
        return null;
    }

    return `${username}|${chatScope}|${Number(mesId)}|${Number(swipeId)}`;
}

function rekeyPromptSnapshotKey(promptSnapshotKey, { mesId = null, swipeId = null } = {}) {
    const parsed = parsePromptSnapshotKey(promptSnapshotKey);
    if (!parsed) {
        return null;
    }

    return buildPromptSnapshotKey({
        ...parsed,
        mesId: mesId ?? parsed.mesId,
        swipeId: swipeId ?? parsed.swipeId,
    });
}

async function commitLatestPromptInspectorRecord(messageId) {
    if (!pendingPromptInspectorRecord) {
        return null;
    }

    const targetMesId = Number(messageId);
    if (!Number.isFinite(targetMesId) || targetMesId < 0) {
        pendingPromptInspectorRecord = null;
        return null;
    }

    const retainedRecord = {
        ...structuredClone(pendingPromptInspectorRecord),
        mesId: targetMesId,
        swipeId: Number(chat[targetMesId]?.swipe_id ?? 0) || 0,
        promptSnapshotKey: typeof chat[targetMesId]?.extra?.promptSnapshotKey === 'string'
            ? chat[targetMesId].extra.promptSnapshotKey
            : null,
    };

    pendingPromptInspectorRecord = null;
    setLatestItemizedPrompt(retainedRecord);
    refreshPromptInspectorButton();
    await saveItemizedPrompts(getCurrentChatId());
    return retainedRecord;
}

async function syncLatestPromptInspectorAfterMessageDeletion(deletedMessageId) {
    const retainedPrompt = getLatestItemizedPrompt();
    const retainedMesId = Number(retainedPrompt?.mesId);
    if (!retainedPrompt || !Number.isFinite(retainedMesId)) {
        refreshPromptInspectorButton();
        return;
    }

    if (deletedMessageId === retainedMesId) {
        setLatestItemizedPrompt(null);
    } else if (deletedMessageId < retainedMesId) {
        const nextPromptSnapshotKey = retainedPrompt?.promptSnapshotKey
            ? rekeyPromptSnapshotKey(retainedPrompt.promptSnapshotKey, { mesId: retainedMesId - 1 })
            : null;
        setLatestItemizedPrompt({
            ...structuredClone(retainedPrompt),
            mesId: retainedMesId - 1,
            promptSnapshotKey: nextPromptSnapshotKey,
        });
    }

    refreshPromptInspectorButton();
    await saveItemizedPrompts(getCurrentChatId());
}

function getPromptSnapshotChatScope() {
    const currentChatId = getCurrentChatId() || '';
    if (selected_group) {
        return `group:${selected_group}:${currentChatId || 'chat'}`;
    }

    return `chat:${currentChatId || name2 || 'chat'}`;
}

function getPromptSnapshotTarget(type) {
    if (type === 'swipe') {
        const message = chat[chat.length - 1];
        return {
            mesId: Math.max(0, chat.length - 1),
            swipeId: Array.isArray(message?.swipes) ? message.swipes.length : 0,
        };
    }

    if (['append', 'continue', 'appendFinal'].includes(type)) {
        const message = chat[chat.length - 1];
        return {
            mesId: Math.max(0, chat.length - 1),
            swipeId: Number(message?.swipe_id ?? 0) || 0,
        };
    }

    return {
        mesId: chat.length,
        swipeId: 0,
    };
}

function buildPromptSnapshotKeyForMessage(messageId, swipeId = null) {
    const mesId = Number(messageId);
    if (!Number.isFinite(mesId) || mesId < 0) {
        return null;
    }

    const item = chat[messageId];
    if (!item) {
        return null;
    }

    const targetSwipeId = Number(swipeId ?? item?.swipe_id ?? 0) || 0;
    const username = String(currentUser?.handle || 'default-user').trim() || 'default-user';
    const chatScope = getPromptSnapshotChatScope();
    return buildPromptSnapshotKey({
        username,
        chatScope,
        mesId,
        swipeId: targetSwipeId,
    });
}

function applyPromptInspectionResponseDataToMessage(messageId, promptInspectionResponseData, { allowFallbackPromptSnapshotKey = false } = {}) {
    let promptSnapshotKey = promptInspectionResponseData?.promptSnapshotKey;
    if ((typeof promptSnapshotKey !== 'string' || !promptSnapshotKey) && allowFallbackPromptSnapshotKey) {
        promptSnapshotKey = buildPromptSnapshotKeyForMessage(messageId);
    }
    if (typeof promptSnapshotKey !== 'string' || !promptSnapshotKey) {
        return null;
    }

    const item = chat[messageId];
    if (!item) {
        return null;
    }

    item.extra ??= {};
    item.extra.promptSnapshotKey = promptSnapshotKey;
    return promptSnapshotKey;
}

function getPromptSnapshotKeysFromMessage(message) {
    const keys = new Set();

    const messageKey = message?.extra?.promptSnapshotKey;
    if (typeof messageKey === 'string' && messageKey) {
        keys.add(messageKey);
    }

    if (Array.isArray(message?.swipe_info)) {
        for (const swipeInfo of message.swipe_info) {
            const swipeKey = swipeInfo?.extra?.promptSnapshotKey;
            if (typeof swipeKey === 'string' && swipeKey) {
                keys.add(swipeKey);
            }
        }
    }

    return [...keys];
}

function addPromptSnapshotRekeyOperation(rekeys, fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) {
        return;
    }

    rekeys.push({ from: fromKey, to: toKey });
}

function rekeyMessagePromptSnapshotKeys(message, mesId, rekeys) {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (typeof message?.extra?.promptSnapshotKey === 'string' && message.extra.promptSnapshotKey) {
        const nextMessageKey = rekeyPromptSnapshotKey(message.extra.promptSnapshotKey, {
            mesId,
            swipeId: Number(message?.swipe_id ?? 0) || 0,
        });
        if (nextMessageKey) {
            addPromptSnapshotRekeyOperation(rekeys, message.extra.promptSnapshotKey, nextMessageKey);
            message.extra.promptSnapshotKey = nextMessageKey;
        }
    }

    if (!Array.isArray(message?.swipe_info)) {
        return;
    }

    for (let index = 0; index < message.swipe_info.length; index++) {
        const swipeExtra = message.swipe_info[index]?.extra;
        const swipeKey = swipeExtra?.promptSnapshotKey;
        if (typeof swipeKey !== 'string' || !swipeKey) {
            continue;
        }

        const nextSwipeKey = rekeyPromptSnapshotKey(swipeKey, { mesId, swipeId: index });
        if (!nextSwipeKey) {
            continue;
        }

        addPromptSnapshotRekeyOperation(rekeys, swipeKey, nextSwipeKey);
        swipeExtra.promptSnapshotKey = nextSwipeKey;
    }
}

function syncMessagePromptSnapshotKeyFromActiveSwipe(message) {
    if (!message || typeof message !== 'object' || !Array.isArray(message.swipe_info)) {
        return;
    }

    const activeSwipeId = Number(message.swipe_id ?? 0);
    const activeSwipeKey = message.swipe_info[activeSwipeId]?.extra?.promptSnapshotKey;
    if (typeof activeSwipeKey === 'string' && activeSwipeKey) {
        message.extra ??= {};
        message.extra.promptSnapshotKey = activeSwipeKey;
    }
}

async function maintainPromptSnapshotKeys({ deletes = [], rekeys = [] } = {}) {
    if ((!Array.isArray(deletes) || !deletes.length) && (!Array.isArray(rekeys) || !rekeys.length)) {
        return;
    }

    try {
        await maintainPromptInspectionSnapshots({ deletes, rekeys });
    } catch (error) {
        console.error('Failed to maintain prompt inspection snapshots', error);
    }
}

async function syncLatestPromptInspectorAfterSwipeMutation(messageId) {
    const retainedPrompt = getLatestItemizedPrompt();
    if (!retainedPrompt || Number(retainedPrompt?.mesId) !== Number(messageId)) {
        refreshPromptInspectorButton();
        await saveItemizedPrompts(getCurrentChatId());
        return;
    }

    const message = chat[messageId];
    if (!message) {
        setLatestItemizedPrompt(null);
    } else {
        setLatestItemizedPrompt({
            ...structuredClone(retainedPrompt),
            swipeId: Number(message?.swipe_id ?? 0) || 0,
            promptSnapshotKey: typeof message?.extra?.promptSnapshotKey === 'string'
                ? message.extra.promptSnapshotKey
                : null,
        });
    }

    refreshPromptInspectorButton();
    await saveItemizedPrompts(getCurrentChatId());
}

async function debugServerAssemblyToPrompt(promptContext = null, messageId = null) {
    return await debugServerAssemblyDump(promptContext);
}

// API OBJECT FOR EXTERNAL WIRING
globalThis.SillyTavern = {
    libs,
    getContext,
    debugServerAssembly: debugServerAssemblyToPrompt,
    getLastServerAssemblyDebugDump: () => getLastServerAssemblyDebugDump(),
};

export {
    user_avatar,
    setUserAvatar,
    getUserAvatars,
    getUserAvatar,
    isOdd,
    countOccurrences,
    renderTemplate,
    promptItemize,
    itemizedPrompts,
    saveItemizedPrompts,
    loadItemizedPrompts,
    itemizedParams,
    clearItemizedPrompts,
    replaceItemizedPromptText,
    deleteItemizedPrompts,
    findItemizedPromptSet,
    UNIQUE_APIS,
    CONNECT_API_MAP,
    system_messages,
    system_message_types,
    sendSystemMessage,
    getSystemMessageByType,
    event_types,
    eventSource,
    /** @deprecated Use setCharacterSettingsOverrides instead. */
    setCharacterSettingsOverrides as setScenarioOverride,
    /** @deprecated Use appendMediaToMessage instead. */
    appendMediaToMessage as appendImageToMessage,
};

/**
 * Wait for page to load before continuing the app initialization.
 */
await new Promise((resolve) => {
    if (document.readyState === 'complete') {
        resolve();
    } else {
        window.addEventListener('load', resolve);
    }
});

// Configure toast library:
toastr.options = {
    positionClass: 'toast-top-center',
    closeButton: false,
    progressBar: false,
    showDuration: 250,
    hideDuration: 250,
    timeOut: 4000,
    extendedTimeOut: 10000,
    showEasing: 'linear',
    hideEasing: 'linear',
    showMethod: 'fadeIn',
    hideMethod: 'fadeOut',
    escapeHtml: true,
    onHidden: function () {
        // If we have any dialog still open, the last "hidden" toastr will remove the toastr-container. We need to keep it alive inside the dialog though
        // so the toasts still show up inside there.
        fixToastrForDialogs();
    },
    onShown: function () {
        // Set tooltip to the notification message
        $(this).attr('title', t`Tap to close`);
    },
};

export const characterGroupOverlay = new BulkEditOverlay();

// Markdown converter
export let mesForShowdownParse; //intended to be used as a context to compare showdown strings against
/** @type {import('showdown').Converter} */
export let converter;

// array for prompt token calculations

export const systemUserName = 'SillyTavern System';
export const neutralCharacterName = 'Assistant';
let default_user_name = 'User';
export let name1 = default_user_name;
export let name2 = systemUserName;
/** @type {ChatMessage[]} */
export let chat = [];
export let isSwipingAllowed = true; //false when a swipe is in progress, or swiping is blocked.
let chatSaveTimeout;
let importFlashTimeout;
export let isChatSaving = false;
let chatSaveRevision = 0;
let chatSaveSessionId = '';
let chatSaveDirty = false;
let chatSaveQueuePromise = null;
let chatSaveRequestOptions = {};
const CHAT_SAVE_RESULT = {
    SAVED: 'saved',
    FAILED: 'failed',
};
export { CHAT_SAVE_RESULT };
const CHAT_SAVE_SESSION_ID_KEY = 'aikobots_chat_save_session_id';
const SYNC_CURRENT_CHAT_COOLDOWN_MS = 60_000;
const SYNC_CURRENT_CHAT_TITLE = 'update server with current browser chat state';
let syncCurrentChatCooldownUntil = 0;
let syncCurrentChatCooldownInterval = null;
let chat_create_date = '';
let firstRun = false;
let settingsReady = false;
let currentVersion = '0.0.0';
export let displayVersion = 'Aikobots';

let generation_started = new Date();
/** @type {import('./scripts/char-data.js').v1CharData[]} */
export let characters = [];
/**
 * Stringified index of a currently chosen entity in the characters array.
 * @type {string|undefined} Yes, we hate it as much as you do.
 */
export let this_chid;
let saveCharactersPage = 0;
let charactersLoadRequestId = 0;
let characterPanelRenderId = 0;
export const default_avatar = 'img/ai4.png';
export const system_avatar = 'img/five.png';
export const comment_avatar = 'img/quill.png';
export const default_user_avatar = 'img/user-default.png';
export let CLIENT_VERSION = 'Aikobots:UNKNOWN:Cohee#1207'; // For Horde header
let manageChatsOwnerContext = null;
let manageChatsOwnerSelectorInitialized = false;
let manageChatsOwnerSelectorSyncing = false;
let manageChatsMode = 'owners';
let manageChatsOrphanEntries = [];
let manageChatsSelectedOrphanKey = null;
let manageChatsOrphanSelectorInitialized = false;
let manageChatsOrphanSelectorSyncing = false;
let manageChatsDeletedSearchRequestId = 0;
let manageChatsUiInitialized = false;
let optionsPopper = Popper.createPopper(document.getElementById('options_button'), document.getElementById('options'), {
    placement: 'top-start',
});
let exportPopper = Popper.createPopper(document.getElementById('export_button'), document.getElementById('export_format_popup'), {
    placement: 'left',
});
let isExportPopupOpen = false;

// Saved here for performance reasons
const messageTemplate = $('#message_template .mes');
export const chatElement = $('#chat');
const TOP_HISTORY_CONTROL_ID = 'show_more_messages';
const BOTTOM_HISTORY_CONTROL_ID = 'show_newer_messages';
const RETURN_TO_TAIL_CONTROL_ID = 'return_to_live_tail';
const HYDRATE_CHAT_CONTROL_ID = 'load_full_chat_for_editing';
const FALLBACK_CHAT_WINDOW_SIZE = 200;
const CHAT_STORAGE_MODE_SPLIT_TAIL = 'split-tail';

let dialogueResolve = null;
let dialogueCloseStop = false;
export let chat_metadata = {};
/** @type {StreamingProcessor} */
export let streamingProcessor = null;
let crop_data = undefined;
let is_delete_mode = false;
let fav_ch_checked = false;
let scrollLock = false;
export let abortStatusCheck = new AbortController();
export let charDragDropHandler = null;
let visibleChatStartId = null;
let visibleChatEndId = null;
export let chatDragDropHandler = null;
let historyWindowNavigationQueue = Promise.resolve();
let isRunningHistoryWindowNavigation = false;
let activeHistoryWindowNavigationToken = null;

function serializeHistoryWindowNavigation(callback, navigationToken = null) {
    if (navigationToken && navigationToken === activeHistoryWindowNavigationToken) {
        return callback(navigationToken);
    }

    const run = historyWindowNavigationQueue.then(async () => {
        const token = {};
        isRunningHistoryWindowNavigation = true;
        activeHistoryWindowNavigationToken = token;
        try {
            return await callback(token);
        } finally {
            isRunningHistoryWindowNavigation = false;
            if (activeHistoryWindowNavigationToken === token) {
                activeHistoryWindowNavigationToken = null;
            }
        }
    });

    historyWindowNavigationQueue = run.catch(() => {});
    return run;
}

function getDefaultChatLoadState() {
    return {
        storageMode: 'full',
        loadedRanges: [],
        tailStartId: 0,
        tailEndId: -1,
        headCount: 0,
        tailCount: 0,
        parentPromptCache: [],
        parentPromptCacheTailStartId: 0,
        currentView: 'tail',
        isHydrated: true,
    };
}

let chatLoadState = getDefaultChatLoadState();

/** @type {debounce_timeout} The debounce timeout used for settings save. debounce_timeout.relaxed: 1000 ms */
export const DEFAULT_SAVE_EDIT_TIMEOUT = debounce_timeout.relaxed;
/** @type {number} The debounce timeout used for debounced chat saves: 15000 ms */
const DEFAULT_CHAT_SAVE_EDIT_TIMEOUT = 15_000;
/** @type {debounce_timeout} The debounce timeout used for printing. debounce_timeout.quick: 100 ms */
export const DEFAULT_PRINT_TIMEOUT = debounce_timeout.quick;

export const saveSettingsDebounced = debounce((loopCounter = 0) => saveSettings(loopCounter), DEFAULT_SAVE_EDIT_TIMEOUT);
let isCharacterEditorDirty = false;

export function saveCharacterDebounced() {
    markCharacterEditorDirty();
}

function isCharacterEditorInEditMode() {
    return $('#form_create').attr('actiontype') === 'editcharacter' && this_chid !== undefined && !!characters[this_chid];
}

function updateCharacterSaveButtonState() {
    const saveButtonLabel = $('#create_button_label');
    if (!saveButtonLabel.length) {
        return;
    }

    const isEditMode = $('#form_create').attr('actiontype') === 'editcharacter';
    saveButtonLabel
        .toggleClass('fa-user-check', !isEditMode)
        .toggleClass('fa-floppy-disk', isEditMode)
        .attr('title', isEditMode ? t`Save Character` : t`Create Character`);

    $('#create_button').attr('aria-label', isEditMode ? t`Save Character` : t`Create Character`);
}

function markCharacterEditorDirty() {
    if (!isCharacterEditorInEditMode()) {
        return;
    }

    isCharacterEditorDirty = true;
    updateCharacterSaveButtonState();
}

function clearCharacterEditorDirtyState() {
    isCharacterEditorDirty = false;
    updateCharacterSaveButtonState();
}

function hasUnsavedCharacterEdits() {
    return isCharacterEditorInEditMode() && isCharacterEditorDirty;
}

async function discardUnsavedCharacterEdits() {
    if (!isCharacterEditorInEditMode()) {
        clearCharacterEditorDirtyState();
        return;
    }

    const avatar = characters[this_chid]?.avatar;
    if (avatar) {
        await getOneCharacter(avatar);
    }

    clearCharacterEditorDirtyState();
}

async function confirmCharacterEditorNavigation() {
    if (!hasUnsavedCharacterEdits()) {
        return true;
    }

    const confirmed = await Popup.show.confirm(
        t`Discard unsaved character changes?`,
        t`You have unsaved changes for this character. Leave without saving?`,
    );

    if (!confirmed) {
        return false;
    }

    await discardUnsavedCharacterEdits();
    return true;
}

/**
 * Prints the character list in a debounced fashion without blocking, with a delay of 100 milliseconds.
 * Use this function instead of a direct `printCharacters()` whenever the reprinting of the character list is not the primary focus.
 *
 * The printing will also always reprint all filter options of the global list, to keep them up to date.
 */
export const printCharactersDebounced = debounce(() => { printCharacters(false); }, DEFAULT_PRINT_TIMEOUT);

/**
 * @enum {number} Extension prompt types
 */
export const extension_prompt_types = {
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

/**
 * @enum {number} Extension prompt roles
 */
export const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

export const MAX_INJECTION_DEPTH = 10000;

async function getClientVersion() {
    try {
        const response = await fetch('/version');
        const data = await response.json();
        CLIENT_VERSION = data.agent;
        displayVersion = `Aikobots ${data.pkgVersion}`;
        currentVersion = data.pkgVersion;

        if (data.gitRevision && data.gitBranch) {
            displayVersion += ` '${data.gitBranch}' (${data.gitRevision})`;
        }

        $('#version_display').text(displayVersion);
        $('#version_display_welcome').text(displayVersion);
    } catch (err) {
        console.error('Couldn\'t get client version', err);
    }
}

export function reloadMarkdownProcessor() {
    converter = new showdown.Converter({
        emoji: true,
        literalMidWordUnderscores: true,
        parseImgDimensions: true,
        tables: true,
        underline: true,
        simpleLineBreaks: true,
        strikethrough: true,
        disableForced4SpacesIndentedSublists: true,
        extensions: [markdownUnderscoreExt()],
    });

    // Inject the dinkus extension after creating the converter
    // Maybe move this into power_user init?
    converter.addExtension(markdownExclusionExt(), 'exclusion');

    return converter;
}

export function getCurrentChatId() {
    if (selected_group) {
        return groups.find(x => x.id == selected_group)?.chat_id;
    }
    else if (this_chid !== undefined) {
        return characters[this_chid]?.chat;
    }
}

export function getChatSaveRevision() {
    return Number.isInteger(chatSaveRevision) && chatSaveRevision >= 0 ? chatSaveRevision : 0;
}

export function setChatSaveRevision(revision) {
    const normalizedRevision = Number(revision);
    chatSaveRevision = Number.isInteger(normalizedRevision) && normalizedRevision >= 0 ? normalizedRevision : 0;
}

export function getChatSaveSessionId() {
    if (chatSaveSessionId) {
        return chatSaveSessionId;
    }

    try {
        chatSaveSessionId = sessionStorage.getItem(CHAT_SAVE_SESSION_ID_KEY) || '';
        if (!chatSaveSessionId) {
            chatSaveSessionId = uuidv4();
            sessionStorage.setItem(CHAT_SAVE_SESSION_ID_KEY, chatSaveSessionId);
        }
    } catch {
        chatSaveSessionId = uuidv4();
    }

    return chatSaveSessionId;
}

export function warnStaleChatSave(errorData) {
    const lastSaveSessionId = String(errorData?.last_save_session_id || '');
    const conflictMessage = lastSaveSessionId && lastSaveSessionId !== getChatSaveSessionId()
        ? t`Another browser session has a newer save. Close all other browser sessions before trying again.`
        : t`This chat has a newer save. Close other browser sessions before trying again.`;

    toastr.warning(conflictMessage, t`Chat save conflict`);
}

function getSyncCurrentChatCooldownSeconds() {
    return Math.max(0, Math.ceil((syncCurrentChatCooldownUntil - Date.now()) / 1000));
}

function updateSyncCurrentChatCooldownState() {
    const button = document.getElementById('option_sync_current_chat');
    if (!button) {
        return;
    }

    const cooldownSeconds = getSyncCurrentChatCooldownSeconds();
    if (cooldownSeconds > 0) {
        button.setAttribute('title', `save cooldown, ${cooldownSeconds} seconds remaining`);
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('disabled');
        return;
    }

    button.setAttribute('title', SYNC_CURRENT_CHAT_TITLE);
    button.setAttribute('aria-disabled', 'false');
    button.classList.remove('disabled');

    if (syncCurrentChatCooldownInterval !== null) {
        clearInterval(syncCurrentChatCooldownInterval);
        syncCurrentChatCooldownInterval = null;
    }
}

function startSyncCurrentChatCooldown() {
    syncCurrentChatCooldownUntil = Date.now() + SYNC_CURRENT_CHAT_COOLDOWN_MS;
    updateSyncCurrentChatCooldownState();

    if (syncCurrentChatCooldownInterval !== null) {
        clearInterval(syncCurrentChatCooldownInterval);
    }

    syncCurrentChatCooldownInterval = setInterval(updateSyncCurrentChatCooldownState, 1000);
}

// The cooldown is intentionally per-click and not per-successful-save. 
// This prevents users from hammering the server with save requests by repeatedly clicking the button when they have a large chat that takes a while to save.

async function syncCurrentChatToServer() {
    if (getSyncCurrentChatCooldownSeconds() > 0) {
        updateSyncCurrentChatCooldownState();
        return;
    }

    if (!hasActiveChatContext()) {
        return;
    }

    startSyncCurrentChatCooldown();
    toastr.info(t`Syncing chat to server`);
    const syncResult = await saveChatConditional({ syncLoadedMessages: true, refreshTailAfterSave: true });

    if (syncResult === CHAT_SAVE_RESULT.SAVED) {
        toastr.success(t`Chat sync successful`);
    }
}

function hasActiveChatContext() {
    return Boolean(selected_group || this_chid !== undefined || chat.length || name2 === neutralCharacterName);
}

function isTopChatInteractionBusy() {
    return Boolean(is_send_press || (selected_group && is_group_generating));
}

function normalizeTopChatFileName(name) {
    return String(name ?? '').replace(/\.jsonl$/i, '');
}

function setTopChatActionDisabled(element, disabled) {
    if (!element) {
        return;
    }

    element.classList.toggle('not-in-chat', disabled);
    if (element instanceof HTMLButtonElement) {
        element.disabled = disabled;
    }
    element.setAttribute('aria-disabled', String(disabled));
}

function saveTopChatPanelsState() {
    localStorage.setItem(TOP_CHAT_PANELS_STATE_KEY, JSON.stringify({
        sidebarVisible: document.getElementById(TOP_CHAT_SIDEBAR_ID)?.classList.contains('visible') ?? false,
        connectionProfilesVisible: topChatConnectionProfiles?.classList.contains('visible') ?? false,
    }));
}

function setTopChatAvailabilityState(hasChat) {
    const isChatBusy = isTopChatInteractionBusy();
    const canOpenManageChats = (selected_group && !is_group_generating) || (!selected_group && !is_send_press);
    setTopChatActionDisabled(topChatButtons.chatManager, !canOpenManageChats || isManageChatsActionPending);
    setTopChatActionDisabled(topChatButtons.newChat, isChatBusy);
    setTopChatActionDisabled(topChatButtons.closeChat, !hasActiveChatContext() || isChatBusy);
    setTopChatActionDisabled(topChatButtons.renameChat, !hasChat || isChatBusy);
    setTopChatActionDisabled(topChatButtons.deleteChat, !hasChat || isChatBusy);
}

async function getTopChatChatFiles() {
    if (!getCurrentChatId()) {
        return [];
    }

    if (selected_group) {
        return await getGroupPastChats(selected_group);
    }

    if (this_chid !== undefined) {
        return await getPastCharacterChats();
    }

    return [];
}

async function getTopChatSelectorEntries() {
    if (selected_group) {
        const group = groups.find(x => x.id == selected_group);
        return (group?.chats ?? []).map(normalizeTopChatFileName).sort((a, b) => a.localeCompare(b));
    }

    if (this_chid === undefined) {
        return [];
    }

    const chats = await getPastCharacterChats();
    return chats
        .map(chat => normalizeTopChatFileName(chat.file_name))
        .filter(onlyUnique)
        .sort((a, b) => a.localeCompare(b));
}

async function openTopChatById(chatId) {
    if (isTopChatInteractionBusy()) {
        return;
    }

    const normalizedChatId = normalizeTopChatFileName(chatId);
    if (!normalizedChatId) {
        return;
    }

    if (selected_group) {
        await openGroupChat(selected_group, normalizedChatId);
        return;
    }

    if (this_chid !== undefined) {
        await openCharacterChat(normalizedChatId);
    }
}

async function handleManageChatsAction({ fromSlashCommand = false } = {}) {
    const canOpenManageChats = fromSlashCommand || (selected_group && !is_group_generating) || (!selected_group && !is_send_press);
    if (!canOpenManageChats || isManageChatsActionPending) {
        return;
    }

    isManageChatsActionPending = true;
    setTopChatActionDisabled(topChatButtons.chatManager, true);

    try {
        // Show the popup before loading chats so the interaction doesn't feel frozen.
        if (!fromSlashCommand) {
            console.log('displaying shadow');
            $('#shadow_select_chat_popup').css('display', 'block');
            $('#shadow_select_chat_popup').css('opacity', 0.0);
            $('#shadow_select_chat_popup').transition({
                opacity: 1.0,
                duration: animation_duration,
                easing: animation_easing,
            });
            $('#select_chat_div').empty().append(`<div class="text_muted padding10px">${t`Loading chats...`}</div>`);
            await delay(1);
        }

        await displayPastChats();
    } finally {
        isManageChatsActionPending = false;
        setTopChatAvailabilityState(Boolean(normalizeTopChatFileName(getCurrentChatId())));
    }
}

async function handleStartNewChatAction() {
    if ((selected_group || this_chid !== undefined) && !is_send_press) {
        let deleteCurrentChat = false;
        const result = await Popup.show.confirm(t`Start new chat?`, await renderTemplateAsync('newChatConfirm'), {
            onClose: () => { deleteCurrentChat = !!$('#del_chat_checkbox').prop('checked'); },
        });
        if (!result) {
            return;
        }

        await doNewChat({ deleteCurrentChat: deleteCurrentChat });
        return;
    }

    if (!selected_group && this_chid === undefined && !is_send_press) {
        const alreadyInTempChat = this_chid === undefined && name2 === neutralCharacterName;
        await newAssistantChat({ temporary: alreadyInTempChat });
    }
}

async function handleCloseChatAction() {
    if (!hasActiveChatContext() || isTopChatInteractionBusy()) {
        return;
    }

    await closeCurrentChat();
}

function getTopChatSidebarElement() {
    return /** @type {HTMLDivElement | null} */ (document.getElementById(TOP_CHAT_SIDEBAR_ID));
}

function ensureTopChatSidebar() {
    const existingSidebar = getTopChatSidebarElement();
    if (existingSidebar) {
        return existingSidebar;
    }

    const draggableTemplate = /** @type {HTMLTemplateElement} */ (document.getElementById('generic_draggable_template'));
    const movingDivs = /** @type {HTMLDivElement} */ (document.getElementById('movingDivs'));
    if (!draggableTemplate || !movingDivs) {
        return null;
    }

    const fragment = /** @type {DocumentFragment} */ (draggableTemplate.content.cloneNode(true));
    const draggable = /** @type {HTMLDivElement | null} */ (fragment.querySelector('.draggable'));
    const title = /** @type {HTMLDivElement | null} */ (fragment.querySelector('.dragTitle'));
    const closeButton = /** @type {HTMLDivElement | null} */ (fragment.querySelector('.dragClose'));
    const dragHandle = /** @type {HTMLDivElement | null} */ (fragment.querySelector('.drag-grabber'));
    if (!draggable || !title || !closeButton || !dragHandle) {
        return null;
    }

    draggable.id = TOP_CHAT_SIDEBAR_ID;
    title.textContent = 'Chats';
    closeButton.id = `${TOP_CHAT_SIDEBAR_ID}_close`;
    dragHandle.id = `${TOP_CHAT_SIDEBAR_ID}header`;
    closeButton.addEventListener('click', () => {
        void toggleTopChatSidebar(false);
    });

    const container = document.createElement('div');
    container.id = TOP_CHAT_SIDEBAR_CONTAINER_ID;
    draggable.append(container);

    const loader = document.createElement('div');
    loader.id = TOP_CHAT_SIDEBAR_LOADER_ID;
    loader.classList.add('displayNone');
    loader.innerHTML = '<i class="fa-2x fa-solid fa-gear fa-spin"></i>';
    draggable.append(loader);

    movingDivs.append(fragment);
    loadMovingUIState();
    dragElement($(draggable));
    return draggable;
}

async function populateTopChatSidebar() {
    const sidebar = ensureTopChatSidebar();
    const container = /** @type {HTMLDivElement | null} */ (document.getElementById(TOP_CHAT_SIDEBAR_CONTAINER_ID));
    const loader = /** @type {HTMLDivElement | null} */ (document.getElementById(TOP_CHAT_SIDEBAR_LOADER_ID));
    if (!sidebar || !container || !loader) {
        return;
    }

    if (sidebar.dataset.sidebarMode && sidebar.dataset.sidebarMode !== 'chat') {
        loader.classList.add('displayNone');
        return;
    }

    if (!sidebar.classList.contains('visible')) {
        container.innerHTML = '';
        loader.classList.add('displayNone');
        return;
    }

    sidebar.dataset.sidebarMode = 'chat';

    const processToken = uuidv4();
    topChatSidebarPopulateToken = processToken;
    const currentChatId = normalizeTopChatFileName(getCurrentChatId());
    const previousScrollTop = container.scrollTop;

    loader.classList.remove('displayNone');
    container.innerHTML = '';

    const chats = (await getTopChatChatFiles()).map(chat => ({
        ...chat,
        file_name: normalizeTopChatFileName(chat.file_name),
        mes: String(chat.mes ?? '').replace(/\s+/g, ' ').trim() || '[The chat is empty]',
        last_mes: timestampToMoment(chat.last_mes || Date.now()),
    })).sort((a, b) => sortMoments(a.last_mes, b.last_mes));

    if (!sidebar.classList.contains('visible') || sidebar.dataset.sidebarMode !== 'chat') {
        loader.classList.add('displayNone');
        return;
    }

    if (topChatSidebarPopulateToken !== processToken) {
        return;
    }

    if (!chats.length) {
        const emptyState = document.createElement('div');
        emptyState.className = 'top_chat_sidebar_empty';
        emptyState.textContent = 'No chats available.';
        container.append(emptyState);
        loader.classList.add('displayNone');
        return;
    }

    for (const chat of chats) {
        const item = document.createElement('div');
        item.className = 'top_chat_sidebar_item';
        item.classList.toggle('selected', chat.file_name === currentChatId);
        item.addEventListener('click', async () => {
            if (chat.file_name === currentChatId || item.classList.contains('selected')) {
                return;
            }

            await openTopChatById(chat.file_name);
        });

        const nameRow = document.createElement('div');
        nameRow.className = 'top_chat_sidebar_name_row';

        const name = document.createElement('div');
        name.className = 'top_chat_sidebar_name';
        name.textContent = chat.file_name;
        name.title = chat.file_name;

        const date = document.createElement('small');
        date.className = 'top_chat_sidebar_date';
        date.textContent = chat.last_mes.format('l');
        date.title = chat.last_mes.format('LL LT');
        nameRow.append(name, date);

        const messageRow = document.createElement('div');
        messageRow.className = 'top_chat_sidebar_message_row';

        const message = document.createElement('div');
        message.className = 'top_chat_sidebar_message';
        message.textContent = chat.mes;
        message.title = chat.mes;

        const stats = document.createElement('div');
        stats.className = 'top_chat_sidebar_stats';

        const counter = document.createElement('div');
        counter.className = 'top_chat_sidebar_counter';

        const counterIcon = document.createElement('i');
        counterIcon.className = 'fa-solid fa-comment fa-xs';

        const counterText = document.createElement('small');
        counterText.textContent = String(chat.chat_items ?? 0);
        counter.append(counterIcon, counterText);

        const fileSize = document.createElement('small');
        fileSize.className = 'top_chat_sidebar_file_size';
        fileSize.textContent = String(chat.file_size ?? '');

        stats.append(counter, fileSize);
        messageRow.append(message, stats);

        item.append(nameRow, messageRow);
        container.append(item);
    }

    container.scrollTop = previousScrollTop;
    const selectedItem = /** @type {HTMLElement | null} */ (container.querySelector('.selected'));
    if (selectedItem && (selectedItem.offsetTop < container.scrollTop || selectedItem.offsetTop > container.scrollTop + container.clientHeight)) {
        container.scrollTop = Math.max(0, selectedItem.offsetTop - container.clientHeight / 2);
    }

    loader.classList.add('displayNone');
}

export async function toggleTopChatSidebar(forceVisible = undefined, { animate = true, save = true } = {}) {
    const sidebar = ensureTopChatSidebar();
    if (!sidebar) {
        return;
    }

    const shouldSwitchFromAlternateMode = typeof forceVisible !== 'boolean'
        && sidebar.classList.contains('visible')
        && sidebar.dataset.sidebarMode
        && sidebar.dataset.sidebarMode !== 'chat';
    const shouldShow = typeof forceVisible === 'boolean'
        ? forceVisible
        : (shouldSwitchFromAlternateMode ? true : !sidebar.classList.contains('visible'));
    topChatButtons.toggleSidebar?.classList.toggle('active', shouldShow);
    topChatButtons.toggleSidebar?.setAttribute('aria-pressed', String(shouldShow));

    if (shouldShow) {
        sidebar.dataset.sidebarMode = 'chat';
        sidebar.classList.add('visible');
        if (animate) {
            $(sidebar).stop(true, true).fadeIn(animation_duration);
        } else {
            $(sidebar).show();
        }
        await populateTopChatSidebar();
    } else {
        sidebar.classList.remove('visible');
        delete sidebar.dataset.sidebarMode;
        if (animate) {
            $(sidebar).stop(true, true).fadeOut(animation_duration);
        } else {
            $(sidebar).hide();
        }
        const container = document.getElementById(TOP_CHAT_SIDEBAR_CONTAINER_ID);
        if (container) {
            container.innerHTML = '';
        }
    }

    if (save) {
        saveTopChatPanelsState();
    }
}

function syncTopChatConnectionProfilesSelect() {
    if (!topChatConnectionProfilesSelect) {
        return;
    }

    const mainSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('connection_profiles'));
    if (mainSelect) {
        topChatConnectionProfilesSelect.innerHTML = mainSelect.innerHTML;
        topChatConnectionProfilesSelect.value = mainSelect.value;
        topChatConnectionProfilesSelect.disabled = mainSelect.disabled;
        return;
    }

    topChatConnectionProfilesSelect.innerHTML = '<option selected>No connection profiles</option>';
    topChatConnectionProfilesSelect.disabled = true;
}

function getSelectOptionLabel(select, value) {
    if (!(select instanceof HTMLSelectElement)) {
        return '';
    }

    return Array.from(select.options).find(option => option.value === String(value))?.textContent?.trim() ?? '';
}

function getTopChatCurrentApiLabel() {
    const source = getGeneratingApi();
    const sourceSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('chat_completion_source'));
    return getSelectOptionLabel(sourceSelect, source) || source;
}

function getTopChatCurrentModelLabel() {
    const model = getChatCompletionModel();
    if (!model) {
        return String(online_status);
    }

    const apiBlock = document.getElementById('rm_api_block');
    if (apiBlock) {
        for (const select of apiBlock.querySelectorAll('select')) {
            const label = getSelectOptionLabel(/** @type {HTMLSelectElement} */ (select), model);
            if (label) {
                return label;
            }
        }
    }

    return model;
}

async function updateTopChatConnectionProfileIcon() {
    if (!topChatConnectionProfilesModelIcon) {
        return;
    }

    topChatConnectionProfilesModelIcon.replaceChildren();
    if (online_status === 'no_connection') {
        return;
    }

    const modelName = getGeneratingApi();
    if (!modelName) {
        return;
    }

    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };

        const image = new Image();
        image.classList.add('icon-svg');
        image.src = `/img/${modelName}.svg`;
        image.onload = async () => {
            topChatConnectionProfilesModelIcon.replaceChildren(image);
            try {
                await SVGInject(image);
            } catch {
                // Ignore broken SVG injections and keep the fallback image.
            }
            finish();
        };
        image.onerror = finish;
        setTimeout(finish, 500);
    });
}

async function refreshTopChatConnectionProfiles() {
    syncTopChatConnectionProfilesSelect();

    if (!topChatConnectionProfiles || !topChatConnectionProfilesStatus) {
        return;
    }

    if (!topChatConnectionProfiles.classList.contains('visible')) {
        return;
    }

    if (online_status === 'no_connection') {
        topChatConnectionProfilesStatus.classList.add('offline');
        topChatConnectionProfilesStatus.textContent = 'No connection...';
        topChatConnectionProfilesModelIcon?.replaceChildren();
        return;
    }

    topChatConnectionProfilesStatus.classList.remove('offline');
    topChatConnectionProfilesStatus.textContent = `${getTopChatCurrentApiLabel()} - ${getTopChatCurrentModelLabel()}`;
    await updateTopChatConnectionProfileIcon();
}

function bindTopChatConnectionProfilesSelect() {
    if (isTopChatConnectionProfilesBound) {
        syncTopChatConnectionProfilesSelect();
        return;
    }

    waitUntilCondition(() => document.getElementById('connection_profiles') !== null, debounce_timeout.extended, 10).then(() => {
        const mainSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('connection_profiles'));
        if (!mainSelect || isTopChatConnectionProfilesBound) {
            return;
        }

        isTopChatConnectionProfilesBound = true;
        syncTopChatConnectionProfilesSelect();

        topChatConnectionProfilesSelect?.addEventListener('change', () => {
            mainSelect.value = topChatConnectionProfilesSelect.value;
            mainSelect.dispatchEvent(new Event('change'));
        });

        mainSelect.addEventListener('change', () => {
            syncTopChatConnectionProfilesSelect();
            void refreshTopChatConnectionProfiles();
        });

        const observer = new MutationObserver(() => {
            syncTopChatConnectionProfilesSelect();
            void refreshTopChatConnectionProfiles();
        });
        observer.observe(mainSelect, { childList: true, subtree: true });
    }).catch(() => {
        syncTopChatConnectionProfilesSelect();
    });
}

async function toggleTopChatConnectionProfiles(forceVisible = undefined, { save = true } = {}) {
    if (!topChatConnectionProfiles) {
        return;
    }

    const shouldShow = typeof forceVisible === 'boolean' ? forceVisible : !topChatConnectionProfiles.classList.contains('visible');
    topChatConnectionProfiles.classList.toggle('visible', shouldShow);
    topChatButtons.toggleConnectionProfiles?.classList.toggle('active', shouldShow);
    topChatButtons.toggleConnectionProfiles?.setAttribute('aria-pressed', String(shouldShow));

    if (shouldShow) {
        await refreshTopChatConnectionProfiles();
    }

    if (save) {
        saveTopChatPanelsState();
    }
}

async function refreshTopChatBarState() {
    const currentChatId = normalizeTopChatFileName(getCurrentChatId());
    const hasChat = Boolean(currentChatId);
    const isChatBusy = isTopChatInteractionBusy();
    setTopChatAvailabilityState(hasChat);

    if (!topChatBarChatNameSelect) {
        return;
    }

    topChatBarChatNameSelect.innerHTML = '';
    if (!hasChat) {
        topChatBarChatNameSelect.innerHTML = '<option selected>No chat selected</option>';
        topChatBarChatNameSelect.disabled = true;
        await populateTopChatSidebar();
        return;
    }

    const entries = await getTopChatSelectorEntries();
    if (!entries.length) {
        topChatBarChatNameSelect.innerHTML = `<option selected>${currentChatId}</option>`;
        topChatBarChatNameSelect.disabled = true;
    } else {
        for (const entry of entries) {
            const option = document.createElement('option');
            option.value = entry;
            option.textContent = entry;
            option.selected = entry === currentChatId;
            topChatBarChatNameSelect.append(option);
        }

        topChatBarChatNameSelect.disabled = isChatBusy;
    }

    await populateTopChatSidebar();
}

function bindTopChatButton(element, handler) {
    if (!element) {
        return;
    }

    element.addEventListener('click', () => {
        if (element.classList.contains('not-in-chat')) {
            return;
        }

        void handler();
    });
}

async function renameCurrentTopChat() {
    if (isTopChatInteractionBusy()) {
        return;
    }

    const currentChatId = normalizeTopChatFileName(getCurrentChatId());
    if (!currentChatId) {
        return;
    }

    const popupText = await renderTemplateAsync('chatRename');
    const newChatName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, currentChatId);
    if (!newChatName || typeof newChatName !== 'string' || newChatName === currentChatId) {
        return;
    }

    await renameChat(currentChatId, String(newChatName));
}

async function deleteCurrentTopChat() {
    if (isTopChatInteractionBusy()) {
        return;
    }

    const currentChatId = normalizeTopChatFileName(getCurrentChatId());
    if (!currentChatId) {
        return;
    }

    const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
    if (!confirm) {
        return;
    }

    if (selected_group) {
        await deleteGroupChat(selected_group, currentChatId);
        return;
    }

    if (this_chid !== undefined) {
        await delChat(`${currentChatId}.jsonl`);
    }
}

function restoreTopChatPanelsState() {
    const rawState = localStorage.getItem(TOP_CHAT_PANELS_STATE_KEY);
    if (!rawState) {
        return;
    }

    try {
        const state = JSON.parse(rawState);
        // The archive sidebar should always start closed on load.
        if (state?.sidebarVisible) {
            state.sidebarVisible = false;
            localStorage.setItem(TOP_CHAT_PANELS_STATE_KEY, JSON.stringify(state));
        }
        if (state?.connectionProfilesVisible) {
            void toggleTopChatConnectionProfiles(true, { save: false });
        }
    } catch {
        // Ignore malformed persisted state.
    }
}

function initTopChatUi() {
    if (!topChatBarElement || !topChatBarChatNameSelect) {
        return;
    }
    ensureTopChatSidebar();

    bindTopChatButton(topChatButtons.toggleSidebar, async () => {
        await toggleTopChatSidebar();
    });
    bindTopChatButton(topChatButtons.toggleConnectionProfiles, async () => {
        await toggleTopChatConnectionProfiles();
    });
    bindTopChatButton(topChatButtons.chatManager, async () => {
        await handleManageChatsAction();
    });
    bindTopChatButton(topChatButtons.newChat, handleStartNewChatAction);
    bindTopChatButton(topChatButtons.renameChat, renameCurrentTopChat);
    bindTopChatButton(topChatButtons.deleteChat, deleteCurrentTopChat);
    bindTopChatButton(topChatButtons.closeChat, handleCloseChatAction);

    topChatBarChatNameSelect.addEventListener('change', async () => {
        await openTopChatById(topChatBarChatNameSelect.value);
    });

    const refreshTopChatUiDebounced = debounce(() => {
        void refreshTopChatBarState();
    }, debounce_timeout.short);
    const refreshTopChatConnectionProfilesDebounced = debounce(() => {
        void refreshTopChatConnectionProfiles();
    }, debounce_timeout.short);

    eventSource.on(event_types.CHAT_CHANGED, refreshTopChatUiDebounced);
    eventSource.on(event_types.CHAT_DELETED, refreshTopChatUiDebounced);
    eventSource.on(event_types.GROUP_CHAT_DELETED, refreshTopChatUiDebounced);
    eventSource.on(event_types.GENERATION_STARTED, refreshTopChatUiDebounced);
    eventSource.on(event_types.GENERATION_STOPPED, refreshTopChatUiDebounced);
    eventSource.on(event_types.GENERATION_ENDED, refreshTopChatUiDebounced);
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, refreshTopChatConnectionProfilesDebounced);
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, refreshTopChatConnectionProfilesDebounced);
    eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, refreshTopChatConnectionProfilesDebounced);
    eventSource.on(event_types.CHATCOMPLETION_MODEL_CHANGED, refreshTopChatConnectionProfilesDebounced);
    eventSource.on(event_types.MAIN_API_CHANGED, refreshTopChatConnectionProfilesDebounced);
    eventSource.once(event_types.APP_READY, () => {
        bindTopChatConnectionProfilesSelect();
        restoreTopChatPanelsState();
        void refreshTopChatConnectionProfiles();
    });

    void refreshTopChatBarState();
    syncTopChatConnectionProfilesSelect();
}

export const talkativeness_default = 0.5;
export const depth_prompt_depth_default = 4;
export const depth_prompt_role_default = 'system';
const per_page_default = 50;

var is_advanced_char_open = false;

/**
 * The type of the right menu
 * @typedef {'characters' | 'character_edit' | 'create' | 'group_edit' | 'group_create' | '' } MenuType
 */

/**
 * The type of the right menu that is currently open
 * @type {MenuType}
 */
export let menu_type = '';

export let selected_button = ''; //which button pressed

//create pole save
export let create_save = {
    name: '',
    description: '',
    creator_notes: '',
    post_history_instructions: '',
    character_version: '',
    system_prompt: '',
    tags: '',
    creator: '',
    personality: '',
    first_message: '',
    /** @type {FileList|null} */
    avatar: null,
    scenario: '',
    mes_example: '',
    world: '',
    talkativeness: talkativeness_default,
    alternate_greetings: [],
    depth_prompt_prompt: '',
    depth_prompt_depth: depth_prompt_depth_default,
    depth_prompt_role: depth_prompt_role_default,
    extensions: {},
    extra_books: [],
};

//animation right menu
export const ANIMATION_DURATION_DEFAULT = 125;
export let animation_duration = ANIMATION_DURATION_DEFAULT;
export let animation_easing = 'ease-in-out';
let popup_type = '';
let chat_file_for_del = '';
export let online_status = 'no_connection';

export let is_send_press = false; //Send generation

let this_del_mes = -1;

/** @type {string} */
let this_edit_mes_chname = '';
/** @type {number|undefined} */
let this_edit_mes_id = undefined;

//settings
export let settings;
export let amount_gen = 80; //default max length of AI generated responses
export let max_context = 2048;

var swipes = true;
export let extension_prompts = {};

export let main_api;
/** @type {AbortController} */
let abortController;

export const CHAT_COMPLETIONS_ONLY = true;

//css
var css_send_form_display = $('<div id=send_form></div>').css('display');
const TOP_CHAT_PANELS_STATE_KEY = 'topBarPanelsState';
const TOP_CHAT_SIDEBAR_ID = 'top_chat_sidebar';
const TOP_CHAT_SIDEBAR_CONTAINER_ID = 'top_chat_sidebar_container';
const TOP_CHAT_SIDEBAR_LOADER_ID = 'top_chat_sidebar_loader';
const topChatBarElement = /** @type {HTMLDivElement} */ (document.getElementById('top_chat_bar'));
const topChatBarChatNameSelect = /** @type {HTMLSelectElement} */ (document.getElementById('top_chat_bar_chat_name'));
const topChatConnectionProfiles = /** @type {HTMLDivElement} */ (document.getElementById('top_chat_connection_profiles'));
const topChatConnectionProfilesSelect = /** @type {HTMLSelectElement} */ (document.getElementById('top_chat_connection_profiles_select'));
const topChatConnectionProfilesStatus = /** @type {HTMLDivElement} */ (document.getElementById('top_chat_connection_profiles_status'));
const topChatConnectionProfilesModelIcon = /** @type {HTMLDivElement} */ (document.getElementById('top_chat_connection_profiles_model_icon'));
const topChatButtons = {
    toggleSidebar: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_toggle_sidebar')),
    toggleConnectionProfiles: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_toggle_connection_profiles')),
    chatManager: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_chat_manager')),
    newChat: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_new_chat')),
    renameChat: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_rename_chat')),
    deleteChat: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_delete_chat')),
    closeChat: /** @type {HTMLButtonElement} */ (document.getElementById('top_chat_bar_close_chat')),
};
let isTopChatConnectionProfilesBound = false;
let topChatSidebarPopulateToken = '';
let isManageChatsActionPending = false;

export let token;


/** The tag of the active character. (NOT the id) */
export let active_character = '';
/** The tag of the active group. (Coincidentally also the id) */
export let active_group = '';

export const entitiesFilter = new FilterHelper(printCharactersDebounced);

export function getRequestHeaders({ omitContentType = false } = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
    };

    if (omitContentType) {
        delete headers['Content-Type'];
    }

    return headers;
}

$.ajaxPrefilter((options, originalOptions, xhr) => {
    xhr.setRequestHeader('X-CSRF-Token', token);
});

function enforceChatCompletionsOnlyMode({ save = false } = {}) {
    if (!CHAT_COMPLETIONS_ONLY) {
        return false;
    }

    let changed = false;

    if (main_api !== 'openai') {
        console.warn(`Forcing main_api from ${main_api} to openai`);
        changed = true;
    }

    main_api = 'openai';
    $('#main_api').val('openai').prop('disabled', true);
    $('#main_api option:not([value="openai"])').remove();

    if (settings && settings.main_api !== 'openai') {
        changed = true;
        settings.main_api = 'openai';
    }

    if (save && changed) {
        saveSettingsDebounced();
    }

    return changed;
}

/**
 * Pings the STserver to check if it is reachable.
 * @returns {Promise<boolean>} True if the server is reachable, false otherwise.
 */
export async function pingServer() {
    try {
        const result = await fetch('api/ping', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!result.ok) {
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error pinging server', error);
        return false;
    }
}

//MARK: firstLoadInit
async function firstLoadInit() {
    try {
        const tokenResponse = await fetch('/csrf-token');
        const tokenData = await tokenResponse.json();
        token = tokenData.token;
    } catch {
        toastr.error(t`Couldn't get CSRF token. Please refresh the page.`, t`Error`, { timeOut: 0, extendedTimeOut: 0, preventDuplicates: true });
        throw new Error('Initialization failed');
    }

    showLoader();
    registerPromptManagerMigration();
    initDomHandlers();
    initStandaloneMode();
    initLibraryShims();
    addShowdownPatch(showdown);
    addDOMPurifyHooks();
    reloadMarkdownProcessor();
    applyBrowserFixes();
    await getClientVersion();
    await initSecrets();
    await readSecretState();
    await initLocales();
    initChatUtilities();
    initDefaultSlashCommands();
    initOpenAI();
    initExtensions();
    initExtensionSlashCommands();
    ToolManager.initToolSlashCommands();
    await initPresetManager();
    await initSystemMessages();
    await getSettings();
    initKeyboard();
    initDynamicStyles();
    initTags();
    initBookmarks();
    initMacros();
    await getUserAvatars(true, user_avatar);
    await getCharacters();
    await getBackgrounds();
    await initTokenizers();
    initBackgrounds();
    initAuthorsNote();
    await initPersonas();
    initWorldInfo();
    initRossMods();
    initStats();
    initCfg();
    initLogprobs();
    initInputMarkdown();
    initServerHistory();
    initBulkEdit();
    initReasoning();
    initWelcomeScreen();
    initTopChatUi();
    await initScrapers();
    initDataMaid();
    initItemizedPrompts();
    initAccessibility();
    initStmb();
    addDebugFunctions();
    doDailyExtensionUpdatesCheck();
    await hideLoader();
    await fixViewport();
    initializeModelTagInjection();
    await initializeHiddenTemplates();
    await eventSource.emit(event_types.APP_READY);
}

async function fixViewport() {
    document.body.style.position = 'absolute';
    await delay(1);
    document.body.style.position = '';
}

function initStandaloneMode() {
    const isPwaMode = window.matchMedia('(display-mode: standalone)').matches;
    if (isPwaMode) {
        $('body').addClass('PWA');
    }
}

function cancelStatusCheck(reason = 'Manually cancelled status check') {
    abortStatusCheck?.abort(new AbortReason(reason));
    abortStatusCheck = new AbortController();
    setOnlineStatus('no_connection');
}

export function displayOnlineStatus() {
    if (online_status == 'no_connection') {
        $('.online_status_indicator').removeClass('success');
        $('.online_status_text').text($('#API-status-top').attr('no_connection_text'));
    } else {
        $('.online_status_indicator').addClass('success');
        $('.online_status_text').text(online_status);
    }
}

/**
 * Sets the duration of JS animations.
 * @param {number} ms Duration in milliseconds. Resets to default if null.
 */
export function setAnimationDuration(ms = null) {
    animation_duration = ms ?? ANIMATION_DURATION_DEFAULT;
    // Set CSS variable to document
    document.documentElement.style.setProperty('--animation-duration', `${animation_duration}ms`);
}

/**
 * Sets the currently active character
 * @param {object|number|string} [entityOrKey] - An entity with id property (character, group, tag), or directly an id or tag key. If not provided, the active character is reset to `null`.
 */
export function setActiveCharacter(entityOrKey) {
    active_character = entityOrKey ? getTagKeyForEntity(entityOrKey) : null;
    if (active_character) active_group = null;
}

/**
 * Sets the currently active group.
 * @param {object|number|string} [entityOrKey] - An entity with id property (character, group, tag), or directly an id or tag key. If not provided, the active group is reset to `null`.
 */
export function setActiveGroup(entityOrKey) {
    active_group = entityOrKey ? getTagKeyForEntity(entityOrKey) : null;
    if (active_group) active_character = null;
}

export function startStatusLoading() {
    $('.api_loading').show();
    $('.api_button').addClass('disabled');
}

export function stopStatusLoading() {
    $('.api_loading').hide();
    $('.api_button').removeClass('disabled');
}

export function resultCheckStatus() {
    displayOnlineStatus();
    stopStatusLoading();
}

/**
 * Switches the currently selected character to the one with the given ID. (character index, not the character key!)
 *
 * If the character ID doesn't exist, if the chat is being saved, or if a group is being generated, this function does nothing.
 * If the character is different from the currently selected one, it will clear the chat and reset any selected character or group.
 * @param {number} id The ID of the character to switch to.
 * @param {object} [options] Options for the switch.
 * @param {boolean} [options.switchMenu=true] Whether to switch the right menu to the character edit menu if the character is already selected.
 * @returns {Promise<void>} A promise that resolves when the character is switched.
 */
export async function selectCharacterById(id, { switchMenu = true } = {}) {
    if (characters[id] === undefined) {
        return;
    }

    if (isChatSaving) {
        toastr.info(t`Please wait until the chat is saved before switching characters.`, t`Your chat is still saving...`);
        return;
    }

    if (selected_group && is_group_generating) {
        return;
    }

    if (selected_group || String(this_chid) !== String(id)) {
        //if clicked on a different character from what was currently selected
        if (!is_send_press) {
            if (!await confirmCharacterEditorNavigation()) {
                return;
            }

            const deferredLoader = deferLoader();
            try {
                await clearChat();
                cancelTtsPlay();
                resetSelectedGroup();
                this_edit_mes_id = undefined;
                selected_button = 'character_edit';
                setCharacterId(id);
                chat.length = 0;
                chat_metadata = {};
                await getChat();
            } finally {
                await deferredLoader.clear();
            }
        }
    } else {
        //if clicked on character that was already selected
        switchMenu && (selected_button = 'character_edit');
        await unshallowCharacter(this_chid);
        select_selected_character(this_chid, { switchMenu });
    }
}

function getBackBlock() {
    const template = $('#bogus_folder_back_template .bogus_folder_select').clone();
    return template;
}

const CHARACTER_PANEL_LOAD_STATE = {
    LOADING: 'loading',
    EMPTY: 'empty',
    ERROR: 'error',
    LOADED: 'loaded',
};

function getCharacterPanelStatusBlock(state, title, detail = '') {
    const icon = state === CHARACTER_PANEL_LOAD_STATE.ERROR
        ? 'fa-circle-exclamation'
        : state === CHARACTER_PANEL_LOAD_STATE.LOADING
            ? 'fa-spinner fa-spin'
            : 'fa-circle-info';
    const block = $('<div class="text_block character_panel_status"></div>');
    block.attr('data-status', state);
    block.append($('<i class="fa-solid fa-2x"></i>').addClass(icon));
    const text = $('<div class="character_panel_status_text"></div>');
    text.append($('<strong></strong>').text(title));
    if (detail) {
        text.append($('<small></small>').text(detail));
    }
    block.append(text);
    return block;
}

function disableCharacterPanelPagination() {
    const pagination = $('#rm_print_characters_pagination');
    const paginationData = pagination.data('pagination');
    if (paginationData?.initialized) {
        pagination.pagination('disable');
    }
    pagination.empty();
    saveCharactersPage = 0;
}

function setCharacterPanelLoadState(state, { title = '', detail = '', replaceList = false } = {}) {
    const list = $('#rm_print_characters_block');
    list.attr('data-load-state', state);
    if (replaceList || state === CHARACTER_PANEL_LOAD_STATE.ERROR) {
        characterPanelRenderId++;
    }
    if (state === CHARACTER_PANEL_LOAD_STATE.ERROR) {
        disableCharacterPanelPagination();
    }
    if (replaceList) {
        list.empty().append(getCharacterPanelStatusBlock(state, title, detail));
    }
}

async function getEmptyBlock() {
    const icons = ['fa-dragon', 'fa-otter', 'fa-kiwi-bird', 'fa-crow', 'fa-frog'];
    const texts = [t`Here be dragons`, t`Otterly empty`, t`Kiwibunga`, t`Pump-a-Rum`, t`Croak it`];
    const roll = new Date().getMinutes() % icons.length;
    const params = {
        text: texts[roll],
        icon: icons[roll],
    };
    const emptyBlock = await renderTemplateAsync('emptyBlock', params);
    return emptyBlock ? $(emptyBlock) : getCharacterPanelStatusBlock(CHARACTER_PANEL_LOAD_STATE.EMPTY, t`No characters or groups found.`);
}

/**
 * @param {number} hidden Number of hidden characters
 */
async function getHiddenBlock(hidden) {
    const params = {
        text: (hidden > 1 ? t`${hidden} characters hidden.` : t`${hidden} character hidden.`),
    };
    const hiddenBlock = await renderTemplateAsync('hiddenBlock', params);
    return $(hiddenBlock);
}

function getCharacterBlock(item, id) {
    let this_avatar = default_avatar;
    if (item.avatar != 'none') {
        this_avatar = getThumbnailUrl('avatar', item.avatar);
    }
    const ownerHandles = Array.isArray(item.ownerHandles) && item.ownerHandles.length
        ? item.ownerHandles.filter(Boolean)
        : Array.isArray(item.data?.extensions?.aikobots?.owner_handles) && item.data.extensions.aikobots.owner_handles.length
            ? item.data.extensions.aikobots.owner_handles.filter(Boolean)
            : [item.ownerHandle || item.data?.extensions?.aikobots?.owner_handle].filter(Boolean);
    const isOwnedCharacter = Boolean(currentUser?.handle) && ownerHandles.includes(currentUser.handle);
    // Populate the template
    const template = $('#character_template .character_select').clone();
    template.attr({ 'data-chid': id, 'id': `CharID${id}` });
    template.find('img').attr('src', this_avatar).attr('alt', item.name);
    template.find('.avatar').attr('title', `[Character] ${item.name}\nFile: ${item.avatar}`);
    template.find('.ch_name').text(item.name).attr('title', `[Character] ${item.name}`);
    template.find('.ch_name').css('color', isOwnedCharacter ? 'var(--SmartThemeEmColor)' : '');
    if (power_user.show_card_avatar_urls) {
        template.find('.ch_avatar_url').text(item.avatar);
    }
    template.find('.ch_fav_icon').css('display', 'none');
    template.toggleClass('is_fav', item.fav || item.fav == 'true');
    template.toggleClass('has_owner_handle', Boolean(item.data?.extensions?.aikobots?.owner_handle));
    template.find('.ch_fav').val(item.fav);

    const isAssistant = item.avatar === getPermanentAssistantAvatar();
    if (!isAssistant) {
        template.find('.ch_assistant').remove();
    }

    const description = item.data?.creator_notes || '';
    if (description) {
        template.find('.ch_description').text(description);
    }
    else {
        template.find('.ch_description').hide();
    }

    const auxFieldName = power_user.aux_field || 'character_version';
    const auxFieldValue = (item.data && item.data[auxFieldName]) || '';
    if (auxFieldValue) {
        template.find('.character_version').text(auxFieldValue);
    }
    else {
        template.find('.character_version').hide();
    }

    // Display inline tags
    const tagsElement = template.find('.tags');
    printTagList(tagsElement, { forEntityOrKey: id, tagOptions: { isCharacterList: true } });

    // Add to the list
    return template;
}

/**
 * Prints the global character list, optionally doing a full refresh of the list
 * Use this function whenever the reprinting of the character list is the primary focus, otherwise using `printCharactersDebounced` is preferred for a cleaner, non-blocking experience.
 *
 * The printing will also always reprint all filter options of the global list, to keep them up to date.
 *
 * @param {boolean} fullRefresh - If true, the list is fully refreshed and the navigation is being reset
 */
export async function printCharacters(fullRefresh = false) {
    const printRenderId = ++characterPanelRenderId;
    let paginationCallbackRenderId = 0;
    const storageKey = 'Characters_PerPage';
    const listId = '#rm_print_characters_block';

    let currentScrollTop = $(listId).scrollTop();

    if (fullRefresh) {
        saveCharactersPage = 0;
        currentScrollTop = 0;
        await delay(1);
        if (printRenderId !== characterPanelRenderId) {
            return;
        }
    }

    // Before printing the personas, we check if we should enable/disable search sorting
    verifyCharactersSearchSortRule();

    // We are actually always reprinting filters, as it "doesn't hurt", and this way they are always up to date
    printTagFilters(tag_filter_type.character);
    printTagFilters(tag_filter_type.group_member);

    // We are also always reprinting the lists on character/group edit window, as these ones doesn't get updated otherwise
    applyTagsOnCharacterSelect();
    applyTagsOnGroupSelect();

    const entities = getEntitiesList({ doFilter: true });

    const pageSize = Number(accountStorage.getItem(storageKey)) || per_page_default;
    const sizeChangerOptions = [10, 25, 50, 100, 250, 500, 1000];
    $('#rm_print_characters_pagination').pagination({
        dataSource: entities,
        pageSize,
        pageRange: 1,
        pageNumber: saveCharactersPage || 1,
        position: 'top',
        showPageNumbers: false,
        showSizeChanger: true,
        prevText: '<',
        nextText: '>',
        formatNavigator: PAGINATION_TEMPLATE,
        formatSizeChanger: renderPaginationDropdown(pageSize, sizeChangerOptions),
        showNavigator: true,
        callback: async function (/** @type {Entity[]} */ data) {
            const renderId = ++paginationCallbackRenderId;
            const isCurrentRender = () =>
                printRenderId === characterPanelRenderId && renderId === paginationCallbackRenderId;
            try {
                if (!isCurrentRender()) {
                    return;
                }
                $(listId).empty();
                if (power_user.bogus_folders && isBogusFolderOpen()) {
                    if (!isCurrentRender()) {
                        return;
                    }
                    $(listId).append(getBackBlock());
                }
                if (!data.length) {
                    const emptyBlock = await getEmptyBlock();
                    if (!isCurrentRender()) {
                        return;
                    }
                    $(listId).append(emptyBlock);
                }
                let displayCount = 0;
                for (const i of data) {
                    if (!isCurrentRender()) {
                        return;
                    }
                    switch (i.type) {
                        case 'character':
                            $(listId).append(getCharacterBlock(i.item, i.id));
                            displayCount++;
                            break;
                        case 'group':
                            $(listId).append(getGroupBlock(i.item));
                            displayCount++;
                            break;
                        case 'tag':
                            $(listId).append(getTagBlock(i.item, i.entities, i.hidden, i.isUseless));
                            break;
                    }
                }

                const hidden = (characters.length + groups.length) - displayCount;
                if (hidden > 0 && entitiesFilter.hasAnyFilter()) {
                    const hiddenBlock = await getHiddenBlock(hidden);
                    if (!isCurrentRender()) {
                        return;
                    }
                    $(listId).append(hiddenBlock);
                }
                if (!isCurrentRender()) {
                    return;
                }
                localizePagination($('#rm_print_characters_pagination'));
                setCharacterPanelLoadState(data.length ? CHARACTER_PANEL_LOAD_STATE.LOADED : CHARACTER_PANEL_LOAD_STATE.EMPTY);

                eventSource.emit(event_types.CHARACTER_PAGE_LOADED);
            } catch (error) {
                if (!isCurrentRender()) {
                    return;
                }
                console.error('[Characters] Failed to render characters panel.', error);
                setCharacterPanelLoadState(CHARACTER_PANEL_LOAD_STATE.ERROR, {
                    title: t`Characters failed to render.`,
                    detail: error?.message || '',
                    replaceList: true,
                });
            }
        },
        afterSizeSelectorChange: function (e, size) {
            accountStorage.setItem(storageKey, e.target.value);
            paginationDropdownChangeHandler(e, size);
        },
        afterPaging: function (e) {
            saveCharactersPage = e;
        },
        afterRender: function () {
            $(listId).scrollTop(currentScrollTop);
        },
    });

    favsToHotswap();
    updatePersonaConnectionsAvatarList();
}

/** Checks the state of the current search, and adds/removes the search sorting option accordingly */
function verifyCharactersSearchSortRule() {
    const searchTerm = entitiesFilter.getFilterData(FILTER_TYPES.SEARCH);
    const searchOption = $('#character_sort_order option[data-field="search"]');
    const selector = $('#character_sort_order');
    const isHidden = searchOption.attr('hidden') !== undefined;

    // If we have a search term, we are displaying the sorting option for it
    if (searchTerm && isHidden) {
        searchOption.removeAttr('hidden');
        searchOption.prop('selected', true);
        flashHighlight(selector);
    }
    // If search got cleared, we make sure to hide the option and go back to the one before
    if (!searchTerm && !isHidden) {
        searchOption.attr('hidden', '');
        $(`#character_sort_order option[data-order="${power_user.sort_order}"][data-field="${power_user.sort_field}"]`).prop('selected', true);
    }
}

/** @typedef {object} Character - A character */
/** @typedef {object} Group - A group */

/**
 * @typedef {object} Entity - Object representing a display entity
 * @property {Character|Group|import('./scripts/tags.js').Tag|*} item - The item
 * @property {string|number} id - The id
 * @property {'character'|'group'|'tag'} type - The type of this entity (character, group, tag)
 * @property {Entity[]?} [entities=null] - An optional list of entities relevant for this item
 * @property {number?} [hidden=null] - An optional number representing how many hidden entities this entity contains
 * @property {boolean?} [isUseless=null] - Specifies if the entity is useless (not relevant, but should still be displayed for consistency) and should be displayed greyed out
 */

/**
 * Converts the given character to its entity representation
 *
 * @param {Character} character - The character
 * @param {string|number} id - The id of this character
 * @returns {Entity} The entity for this character
 */
export function characterToEntity(character, id) {
    return { item: character, id, type: 'character' };
}

/**
 * Converts the given group to its entity representation
 *
 * @param {Group} group - The group
 * @returns {Entity} The entity for this group
 */
export function groupToEntity(group) {
    return { item: group, id: group.id, type: 'group' };
}

/**
 * Converts the given tag to its entity representation
 *
 * @param {import('./scripts/tags.js').Tag} tag - The tag
 * @returns {Entity} The entity for this tag
 */
export function tagToEntity(tag) {
    return { item: structuredClone(tag), id: tag.id, type: 'tag', entities: [] };
}

/**
 * Builds the full list of all entities available
 *
 * They will be correctly marked and filtered.
 *
 * @param {object} param0 - Optional parameters
 * @param {boolean} [param0.doFilter] - Whether this entity list should already be filtered based on the global filters
 * @param {boolean} [param0.doSort] - Whether the entity list should be sorted when returned
 * @returns {Entity[]} All entities
 */
export function getEntitiesList({ doFilter = false, doSort = true } = {}) {
    let entities = [
        ...characters.map((item, index) => characterToEntity(item, index)),
        ...groups.map(item => groupToEntity(item)),
        ...(power_user.bogus_folders ? tags.filter(isBogusFolder).sort(compareTagsForSort).map(item => tagToEntity(item)) : []),
    ];

    // We need to do multiple filter runs in a specific order, otherwise different settings might override each other
    // and screw up tags and search filter, sub lists or similar.
    // The specific filters are written inside the "filterByTagState" method and its different parameters.
    // Generally what we do is the following:
    //   1. First swipe over the list to remove the most obvious things
    //   2. Build sub entity lists for all folders, filtering them similarly to the second swipe
    //   3. We do the last run, where global filters are applied, and the search filters last

    // First run filters, that will hide what should never be displayed
    if (doFilter) {
        entities = filterByTagState(entities);
    }

    // Run over all entities between first and second filter to save some states
    for (const entity of entities) {
        // For folders, we remember the sub entities so they can be displayed later, even if they might be filtered
        // Those sub entities should be filtered and have the search filters applied too
        if (entity.type === 'tag') {
            let subEntities = filterByTagState(entities, { subForEntity: entity, filterHidden: false });
            const subCount = subEntities.length;
            subEntities = filterByTagState(entities, { subForEntity: entity });
            if (doFilter) {
                // sub entities filter "hacked" because folder filter should not be applied there, so even in "only folders" mode characters show up
                subEntities = entitiesFilter.applyFilters(subEntities, { clearScoreCache: false, tempOverrides: { [FILTER_TYPES.FOLDER]: FILTER_STATES.UNDEFINED }, clearFuzzySearchCaches: false });
            }
            if (doSort) {
                sortEntitiesList(subEntities, false);
            }
            entity.entities = subEntities;
            entity.hidden = subCount - subEntities.length;
        }
    }

    // Second run filters, hiding whatever should be filtered later
    if (doFilter) {
        const beforeFinalEntities = filterByTagState(entities, { globalDisplayFilters: true });
        entities = entitiesFilter.applyFilters(beforeFinalEntities, { clearFuzzySearchCaches: false });

        // Magic for folder filter. If that one is enabled, and no folders are display anymore, we remove that filter to actually show the characters.
        if (isFilterState(entitiesFilter.getFilterData(FILTER_TYPES.FOLDER), FILTER_STATES.SELECTED) && entities.filter(x => x.type == 'tag').length == 0) {
            entities = entitiesFilter.applyFilters(beforeFinalEntities, { tempOverrides: { [FILTER_TYPES.FOLDER]: FILTER_STATES.UNDEFINED }, clearFuzzySearchCaches: false });
        }
    }

    // Final step, updating some properties after the last filter run
    const nonTagEntitiesCount = entities.filter(entity => entity.type !== 'tag').length;
    for (const entity of entities) {
        if (entity.type === 'tag') {
            if (entity.entities?.length == nonTagEntitiesCount) entity.isUseless = true;
        }
    }

    // Sort before returning if requested
    if (doSort) {
        sortEntitiesList(entities, false);
    }
    entitiesFilter.clearFuzzySearchCaches();
    return entities;
}

export async function getOneCharacter(avatarUrl) {
    const response = await fetch('/api/characters/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: avatarUrl,
        }),
    });

    if (response.ok) {
        const getData = await response.json();
        getData['name'] = DOMPurify.sanitize(getData['name']);
        getData['chat'] = String(getData['chat']);

        const indexOf = characters.findIndex(x => x.avatar === avatarUrl);

        if (indexOf !== -1) {
            characters[indexOf] = getData;
        } else {
            toastr.error(t`Character ${avatarUrl} not found in the list`, t`Error`, { timeOut: 5000, preventDuplicates: true });
        }
    }
}

export async function persistCharacterFavorite(avatarUrl, value, { sharedCharacterKey = '' } = {}) {
    const response = await fetch('/api/favorites/set', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            entityType: 'character',
            avatar: avatarUrl,
            sharedCharacterKey,
            value,
        }),
    });

    if (!response.ok) {
        let errorMessage = '';
        try {
            const errorData = await response.json();
            errorMessage = errorData?.error || errorData?.message || '';
        } catch {
            errorMessage = '';
        }

        toastr.error(errorMessage || t`Character favorite could not be updated.`);
        return false;
    }

    const character = characters.find(entry => entry.avatar === avatarUrl);
    if (character) {
        character.fav = value;
        character.data = character.data || {};
        character.data.extensions = character.data.extensions || {};
        character.data.extensions.fav = value;
    }

    return true;
}

function getCharacterSource(chId = this_chid) {
    const character = characters[chId];

    if (!character) {
        return '';
    }

    const chubId = characters[chId]?.data?.extensions?.chub?.full_path;

    if (chubId) {
        return `https://chub.ai/characters/${chubId}`;
    }

    const pygmalionId = characters[chId]?.data?.extensions?.pygmalion_id;

    if (pygmalionId) {
        return `https://pygmalion.chat/${pygmalionId}`;
    }

    const githubRepo = characters[chId]?.data?.extensions?.github_repo;

    if (githubRepo) {
        return `https://github.com/${githubRepo}`;
    }

    const sourceUrl = characters[chId]?.data?.extensions?.source_url;

    if (sourceUrl) {
        return sourceUrl;
    }

    const risuId = characters[chId]?.data?.extensions?.risuai?.source;

    if (Array.isArray(risuId) && risuId.length && typeof risuId[0] === 'string' && risuId[0].startsWith('risurealm:')) {
        const realmId = risuId[0].split(':')[1];
        return `https://realm.risuai.net/character/${realmId}`;
    }

    const perchanceSlug = characters[chId]?.data?.extensions?.perchance_data?.slug;

    if (perchanceSlug) {
        return `https://perchance.org/ai-character-chat?data=${perchanceSlug}`;
    }

    return '';
}

export async function getCharacters() {
    const requestId = ++charactersLoadRequestId;
    const startedAt = performance.now();
    const charactersBlock = $('#rm_print_characters_block');
    const listHasContent = charactersBlock.children().length > 0;
    const currentLoadState = charactersBlock.attr('data-load-state');
    const shouldReplaceWithLoading = !listHasContent
        || currentLoadState === CHARACTER_PANEL_LOAD_STATE.ERROR
        || currentLoadState === CHARACTER_PANEL_LOAD_STATE.EMPTY
        || currentLoadState === CHARACTER_PANEL_LOAD_STATE.LOADING;
    setCharacterPanelLoadState(CHARACTER_PANEL_LOAD_STATE.LOADING, {
        title: t`Loading characters...`,
        replaceList: shouldReplaceWithLoading,
    });

    try {
        const response = await fetch('/api/characters/all', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
        });
        const serverRequestId = response.headers.get('x-aikobots-character-request') || '';
        const serverInstanceId = response.headers.get('x-aikobots-character-instance') || '';

        if (requestId !== charactersLoadRequestId) {
            console.debug('[Characters] Ignoring stale characters response.', { requestId, serverRequestId, serverInstanceId });
            return;
        }

        if (!response.ok) {
            const errorData = await readCharacterLoadError(response);
            const status = `${response.status} ${response.statusText}`.trim();
            console.error('[Characters] Failed to fetch characters.', {
                status,
                serverRequestId,
                serverInstanceId,
                error: errorData,
            });
            setCharacterPanelLoadState(CHARACTER_PANEL_LOAD_STATE.ERROR, {
                title: t`Characters failed to load.`,
                detail: status,
                replaceList: true,
            });
            if (errorData?.overflow) {
                await Popup.show.text(t`Character data length limit reached`, t`To resolve this, set "performance.lazyLoadCharacters" to "true" in config.yaml and restart the server.`);
            }
            return;
        }

        const getData = await response.json();
        if (!Array.isArray(getData)) {
            throw new Error(`Unexpected characters response shape: ${typeof getData}`);
        }

        const previousAvatar = this_chid !== undefined ? characters[this_chid]?.avatar : null;
        const nextCharacters = [];
        for (let i = 0; i < getData.length; i++) {
            const character = getData[i];
            if (!character || typeof character !== 'object') {
                throw new Error(`Invalid character entry at index ${i}`);
            }

            character['name'] = DOMPurify.sanitize(character['name']);

            // For dropped-in cards
            if (!character['chat']) {
                character['chat'] = `${character['name']} - ${humanizedDateTime()}`;
            }

            character['chat'] = String(character['chat']);
            nextCharacters[i] = character;
        }

        if (requestId !== charactersLoadRequestId) {
            console.debug('[Characters] Ignoring stale parsed characters response.', { requestId, serverRequestId, serverInstanceId });
            return;
        }

        characters.splice(0, characters.length, ...nextCharacters);

        if (previousAvatar) {
            const newCharacterId = characters.findIndex(x => x.avatar === previousAvatar);
            if (newCharacterId >= 0) {
                setCharacterId(newCharacterId);
                await selectCharacterById(newCharacterId, { switchMenu: false });
            } else {
                await Popup.show.text(t`ERROR: The active character is no longer available.`, t`The page will be refreshed to prevent data loss. Press "OK" to continue.`);
                return location.reload();
            }
        }

        try {
            await getGroups();
        } catch (error) {
            console.error('[Characters] Failed to fetch groups while refreshing characters panel.', error);
        }

        if (requestId !== charactersLoadRequestId) {
            console.debug('[Characters] Ignoring stale characters render request.', { requestId, serverRequestId, serverInstanceId });
            return;
        }

        await printCharacters(true);
        console.debug('[Characters] Characters data loaded; render scheduled.', {
            requestId,
            serverRequestId,
            serverInstanceId,
            characters: characters.length,
            elapsedMs: Math.round(performance.now() - startedAt),
        });
    } catch (error) {
        if (requestId !== charactersLoadRequestId) {
            console.debug('[Characters] Ignoring stale characters load error.', { requestId, error });
            return;
        }

        console.error('[Characters] Characters load failed before render.', error);
        setCharacterPanelLoadState(CHARACTER_PANEL_LOAD_STATE.ERROR, {
            title: t`Characters failed to load.`,
            detail: error?.message || '',
            replaceList: true,
        });
    }
}

async function readCharacterLoadError(response) {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await response.json();
        }
        return { message: await response.text() };
    } catch (error) {
        return { message: error?.message || 'Unable to read error response.' };
    }
}

async function delChat(chatfile) {
    const response = await fetch('/api/chats/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            chatfile: chatfile,
            avatar_url: characters[this_chid].avatar,
        }),
    });
    if (response.ok === true) {
        // choose another chat if current was deleted
        const name = chatfile.replace('.jsonl', '');
        if (name === characters[this_chid].chat) {
            characters[this_chid].chat = '';
            $('#selected_chat_pole').val('');
            chat_metadata = {};
            if (power_user.delete_current_chat_to_welcome) {
                const replacementChatName = await getReplacementCharacterChatName(String(this_chid));
                await updateRemoteChatName(String(this_chid), replacementChatName);
                await closeCurrentChat();
            } else {
                const replaced = await replaceCurrentChat();
                if (!replaced) {
                    await closeCurrentChat();
                }
            }
        }
        await eventSource.emit(event_types.CHAT_DELETED, name);
    }
}

/**
 * Deletes a character chat by its name.
 * @param {string} characterId Character ID to delete chat for
 * @param {string} fileName Name of the chat file to delete (without .jsonl extension)
 * @returns {Promise<void>} A promise that resolves when the chat is deleted.
 */
export async function deleteCharacterChatByName(characterId, fileName) {
    // Make sure all the data is loaded.
    await unshallowCharacter(characterId);

    /** @type {import('./scripts/char-data.js').v1CharData} */
    const character = characters[characterId];
    if (!character) {
        console.warn(`Character with ID ${characterId} not found.`);
        return;
    }

    if (!selected_group && String(this_chid) === String(characterId)) {
        await delChat(`${fileName}.jsonl`);
        return;
    }

    const response = await fetch('/api/chats/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            chatfile: `${fileName}.jsonl`,
            avatar_url: character.avatar,
        }),
    });

    if (!response.ok) {
        console.error('Failed to delete chat for character.');
        return;
    }

    if (fileName === character.chat) {
        const chatsResponse = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: character.avatar }),
        });
        const chats = Object.values(await chatsResponse.json());
        chats.sort((a, b) => sortMoments(timestampToMoment(a.last_mes), timestampToMoment(b.last_mes)));
        const newChatName = chats.length && typeof chats[0] === 'object' ? chats[0].file_name.replace('.jsonl', '') : `${character.name} - ${humanizedDateTime()}`;
        await updateRemoteChatName(characterId, newChatName);
    }

    await eventSource.emit(event_types.CHAT_DELETED, fileName);
}

async function getReplacementCharacterChatName(characterId) {
    const character = characters[characterId];
    if (!character) {
        return `${name2} - ${humanizedDateTime()}`;
    }

    const chatsResponse = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ avatar_url: character.avatar }),
    });

    if (!chatsResponse.ok) {
        return `${character.name} - ${humanizedDateTime()}`;
    }

    const chats = Object.values(await chatsResponse.json());
    chats.sort((a, b) => sortMoments(timestampToMoment(a.last_mes), timestampToMoment(b.last_mes)));

    return chats.length && typeof chats[0] === 'object'
        ? chats[0].file_name.replace('.jsonl', '')
        : `${character.name} - ${humanizedDateTime()}`;
}

export async function replaceCurrentChat() {
    if (this_chid === undefined || !characters[this_chid]) {
        return false;
    }

    await clearChat();
    chat.length = 0;

    const replacementChatName = await getReplacementCharacterChatName(String(this_chid));
    if (!replacementChatName) {
        return false;
    }

    try {
        await updateRemoteChatName(String(this_chid), replacementChatName);
        $('#selected_chat_pole').val(replacementChatName);
        await getChat();
        return Boolean(normalizeTopChatFileName(getCurrentChatId()));
    } catch (error) {
        console.error('Failed to replace current chat', error);
        return false;
    }
}

function resetChatLoadState() {
    chatLoadState = getDefaultChatLoadState();
}

function getNormalizedLongChatHandling() {
    return normalizeLongChatHandlingSettings(power_user);
}

function getConfiguredLongChatDisplayCount() {
    const { displayCount } = getNormalizedLongChatHandling();
    return clamp(displayCount, LONG_CHAT_DISPLAY_MIN, LONG_CHAT_DISPLAY_MAX);
}

function getConfiguredLongChatBufferMax() {
    const { bufferMax } = getNormalizedLongChatHandling();
    return clamp(bufferMax, LONG_CHAT_BUFFER_MIN, LONG_CHAT_BUFFER_MAX);
}

function mergeLoadedRange(startId, endId) {
    const nextRange = { start: startId, end: endId };
    const ranges = [...chatLoadState.loadedRanges, nextRange].sort((a, b) => a.start - b.start);
    const merged = [];

    for (const range of ranges) {
        const lastRange = merged.at(-1);
        if (!lastRange || range.start > lastRange.end + 1) {
            merged.push({ ...range });
            continue;
        }

        lastRange.end = Math.max(lastRange.end, range.end);
    }

    chatLoadState.loadedRanges = merged;
}

export function getTotalChatMessages() {
    return chat.length;
}

export function isSplitTailChat() {
    return chatLoadState.storageMode === CHAT_STORAGE_MODE_SPLIT_TAIL;
}

export function isChatFullyHydrated() {
    return !isSplitTailChat() || chatLoadState.isHydrated;
}

export function isChatMessageLoaded(messageId) {
    const normalizedMessageId = Number(messageId);
    if (!Number.isInteger(normalizedMessageId) || normalizedMessageId < 0 || normalizedMessageId >= getTotalChatMessages()) {
        return false;
    }

    if (!isSplitTailChat() || isChatFullyHydrated()) {
        return true;
    }

    return chatLoadState.loadedRanges.some(range => normalizedMessageId >= range.start && normalizedMessageId <= range.end);
}

export function isHistoricalChatMessage(messageId) {
    return isSplitTailChat() && !isChatFullyHydrated() && Number(messageId) < chatLoadState.tailStartId;
}

function syncSplitTailStateAfterMutation() {
    if (!isSplitTailChat() || isChatFullyHydrated()) {
        return;
    }

    const previousTailStartId = chatLoadState.tailStartId;
    chatLoadState.tailEndId = Math.max(-1, getTotalChatMessages() - 1);
    chatLoadState.tailStartId = Math.min(chatLoadState.tailStartId, Math.max(0, getTotalChatMessages()));
    chatLoadState.headCount = chatLoadState.tailStartId;
    chatLoadState.tailCount = Math.max(0, getTotalChatMessages() - chatLoadState.tailStartId);
    syncParentPromptCacheForTailStartChange(chatLoadState.tailStartId, previousTailStartId);
}

function getDenseChatMessages(startId, endId) {
    const messages = [];

    for (let i = startId; i <= endId; i++) {
        if (chat[i]) {
            messages.push(chat[i]);
        }
    }

    return messages;
}

function getContiguousChatMessagesForSave(startId, endId) {
    const start = Number(startId);
    const end = Number(endId);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start - 1) {
        return null;
    }

    const messages = [];
    for (let messageId = start; messageId <= end; messageId++) {
        const message = chat[messageId];
        if (!message || typeof message !== 'object') {
            return null;
        }

        messages.push(message);
    }

    return messages;
}

function getContiguousLoadedChatRangeForSave() {
    if (!isSplitTailChat() || isChatFullyHydrated()) {
        return null;
    }

    if (!chatLoadState.loadedRanges.length) {
        return null;
    }

    const expectedEnd = getTotalChatMessages() - 1;
    const tailRange = chatLoadState.loadedRanges.find(range => Number(range?.end) === expectedEnd);
    if (!tailRange) {
        return null;
    }

    const start = Number(tailRange.start);
    const end = Number(tailRange.end);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end !== expectedEnd || start > end) {
        return null;
    }

    const messages = [];
    for (let messageId = start; messageId <= end; messageId++) {
        if (!chat[messageId]) {
            return null;
        }

        messages.push(chat[messageId]);
    }

    return { start, messages };
}

function setParentPromptCache(messages, tailStartId) {
    const normalizedTailStartId = Math.max(0, Number(tailStartId) || 0);
    chatLoadState.parentPromptCache = Array.isArray(messages)
        ? messages.map(message => {
            ensureMessageMediaIsArray(message);
            return message;
        })
        : [];
    chatLoadState.parentPromptCacheTailStartId = normalizedTailStartId;
}

function syncParentPromptCacheForTailStartChange(nextTailStartId, previousTailStartId = chatLoadState.tailStartId) {
    const normalizedPreviousTailStartId = Math.max(0, Number(previousTailStartId) || 0);
    const normalizedNextTailStartId = Math.max(0, Number(nextTailStartId) || 0);

    if (normalizedNextTailStartId === normalizedPreviousTailStartId) {
        if (chatLoadState.parentPromptCacheTailStartId !== normalizedNextTailStartId) {
            chatLoadState.parentPromptCacheTailStartId = normalizedNextTailStartId;
        }
        return;
    }

    if (normalizedNextTailStartId < normalizedPreviousTailStartId) {
        setParentPromptCache(chatLoadState.parentPromptCache.slice(0, normalizedNextTailStartId), normalizedNextTailStartId);
        return;
    }

    if (chatLoadState.parentPromptCacheTailStartId !== normalizedPreviousTailStartId) {
        console.warn('Resident parent prompt cache is out of sync before tailStartId advancement.', {
            cachedTailStartId: chatLoadState.parentPromptCacheTailStartId,
            previousTailStartId: normalizedPreviousTailStartId,
            nextTailStartId: normalizedNextTailStartId,
        });
    }

    const promotedMessages = getDenseChatMessages(normalizedPreviousTailStartId, normalizedNextTailStartId - 1);
    setParentPromptCache([...chatLoadState.parentPromptCache, ...promotedMessages], normalizedNextTailStartId);
}

function getLogicalChatForPromptAssembly() {
    if (!isSplitTailChat() || isChatFullyHydrated() || selected_group) {
        return chat;
    }

    if (chatLoadState.parentPromptCacheTailStartId !== chatLoadState.tailStartId) {
        console.warn('Resident parent prompt cache is out of sync with tailStartId.', {
            cachedTailStartId: chatLoadState.parentPromptCacheTailStartId,
            tailStartId: chatLoadState.tailStartId,
        });
    }

    return [
        ...chatLoadState.parentPromptCache,
        ...getDenseChatMessages(chatLoadState.tailStartId, getTotalChatMessages() - 1),
    ];
}

function isPromptExcludedChatMessage(message) {
    return Boolean(message?.extra?.[IGNORE_SYMBOL] || message?.extra?.ignore);
}

export function isPromptHiddenChatMessage(message, { allowToolInvocations = false } = {}) {
    if (isPromptExcludedChatMessage(message)) {
        return true;
    }

    if (!message?.is_system) {
        return false;
    }

    return !(allowToolInvocations && Array.isArray(message?.extra?.tool_invocations));
}

function getCoreChatPayloadForAssembly(coreChat) {
    return coreChat;
}

export function applyChunkedChatPayload(response, { replace = false, currentView = null } = {}) {
    const header = response?.header ?? null;
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    const totalMessages = Number(response?.totalMessages) || 0;
    const loadedRangeStart = Number(response?.loadedRangeStart) || 0;
    const loadedRangeEnd = Number(response?.loadedRangeEnd);

    if (replace) {
        chat.length = 0;
        chat.length = totalMessages;
        resetChatLoadState();
    } else if (chat.length < totalMessages) {
        chat.length = totalMessages;
    }

    for (let i = 0; i < messages.length; i++) {
        const absoluteId = loadedRangeStart + i;
        chat[absoluteId] = messages[i];
        ensureMessageMediaIsArray(chat[absoluteId]);
    }

    if (messages.length > 0 && Number.isFinite(loadedRangeEnd)) {
        mergeLoadedRange(loadedRangeStart, loadedRangeEnd);
    }

    chatLoadState.storageMode = response?.mode === CHAT_STORAGE_MODE_SPLIT_TAIL ? CHAT_STORAGE_MODE_SPLIT_TAIL : 'full';
    chatLoadState.tailStartId = Number.isInteger(response?.tailStartId)
        ? response.tailStartId
        : Math.max(0, getTotalChatMessages() - Math.min(getConfiguredLongChatDisplayCount(), getTotalChatMessages()));
    chatLoadState.tailEndId = Number.isInteger(response?.tailEndId) ? response.tailEndId : Math.max(-1, getTotalChatMessages() - 1);
    chatLoadState.headCount = Number.isInteger(response?.headCount) ? response.headCount : Math.max(0, chatLoadState.tailStartId);
    chatLoadState.tailCount = Number.isInteger(response?.tailCount) ? response.tailCount : Math.max(0, getTotalChatMessages() - chatLoadState.tailStartId);
    chatLoadState.isHydrated = response?.isHydrated !== false;
    chatLoadState.currentView = currentView ?? (loadedRangeStart < chatLoadState.tailStartId ? 'history' : 'tail');

    if (Array.isArray(response?.parentPromptMessages) && isSplitTailChat() && !isChatFullyHydrated()) {
        setParentPromptCache(response.parentPromptMessages, chatLoadState.tailStartId);
    } else if (!isSplitTailChat() || isChatFullyHydrated()) {
        setParentPromptCache([], 0);
    }

    setChatSaveRevision(header?.chat_revision);

    return header;
}

async function replaceChunkedChatPayloadPreservingWindow(response, { scrollToTail = false } = {}) {
    const previousChatLength = chat.length;
    const previousStartId = getFirstDisplayedMessageId();
    const previousCount = Math.max(
        1,
        chatElement.find('.mes').length || getConfiguredChatWindowSize(),
    );
    const wasShowingLatest = Number.isFinite(previousStartId)
        ? previousStartId + previousCount >= previousChatLength
        : chatLoadState.currentView !== 'history';
    const nextView = wasShowingLatest
        ? 'tail'
        : (Number.isInteger(response?.tailStartId) && Number(previousStartId) < response.tailStartId ? 'history' : 'tail');

    applyChunkedChatPayload(response, { replace: true, currentView: nextView });

    if (!chat.length) {
        await renderMessageWindow(0, previousCount);
        return;
    }

    const renderStart = wasShowingLatest
        ? Math.max(0, chat.length - previousCount)
        : clamp(
            Number.isFinite(previousStartId) ? previousStartId : 0,
            0,
            Math.max(0, chat.length - 1),
        );

    await renderMessageWindow(renderStart, previousCount);
    if (nextView === 'tail' && scrollToTail) {
        scrollChatToBottom({ waitForFrame: true });
    }
}

async function replaceChunkedChatPayloadWithLatestTail(response) {
    applyChunkedChatPayload(response, { replace: true, currentView: 'tail' });

    if (!chat.length) {
        await renderMessageWindow(0, getConfiguredLongChatDisplayCount());
        return;
    }

    const count = getConfiguredLongChatDisplayCount();
    const startId = isSplitTailChat() && !isChatFullyHydrated()
        ? Math.max(chatLoadState.tailStartId, chatLoadState.tailEndId - count + 1)
        : Math.max(0, chat.length - getConfiguredChatWindowSize(count));

    await renderMessageWindow(startId, count);
    scrollChatToBottom({ waitForFrame: true });
}

async function fetchChunkedChat({ rangeStart = null, count = null, hydrateFull = false, includeParentPromptCache = false } = {}) {
    await unshallowCharacter(this_chid);

    const requestedCount = Number.isFinite(Number(count))
        ? Number(count)
        : getConfiguredLongChatBufferMax();

    return await $.ajax({
        type: 'POST',
        url: '/api/chats/get',
        data: JSON.stringify({
            ch_name: characters[this_chid].name,
            file_name: characters[this_chid].chat,
            avatar_url: characters[this_chid].avatar,
            chunked: true,
            range_start: rangeStart,
            count: requestedCount,
            display_count: getConfiguredLongChatDisplayCount(),
            buffer_max: getConfiguredLongChatBufferMax(),
            hydrate_full: hydrateFull,
            include_parent_prompt_cache: includeParentPromptCache,
        }),
        dataType: 'json',
        contentType: 'application/json',
    });
}

async function ensureChatRangeLoaded(startId, count = null) {
    if (!isSplitTailChat() || isChatFullyHydrated()) {
        return true;
    }

    const windowSize = getConfiguredChatWindowSize(count);
    const normalizedStartId = clamp(Number(startId) || 0, 0, Math.max(0, getTotalChatMessages() - 1));
    const endId = Math.min(getTotalChatMessages() - 1, normalizedStartId + windowSize - 1);

    let hasGap = false;
    for (let i = normalizedStartId; i <= endId; i++) {
        if (!isChatMessageLoaded(i)) {
            hasGap = true;
            break;
        }
    }

    if (!hasGap) {
        return true;
    }

    const response = await fetchChunkedChat({ rangeStart: normalizedStartId, count: windowSize });
    applyChunkedChatPayload(response, { replace: false, currentView: normalizedStartId < chatLoadState.tailStartId ? 'history' : 'tail' });
    return true;
}

async function ensureChatSuffixLoaded(startId) {
    if (!isSplitTailChat() || isChatFullyHydrated()) {
        return true;
    }

    const normalizedStartId = clamp(Number(startId) || 0, 0, Math.max(0, getTotalChatMessages() - 1));
    const count = Math.max(1, getTotalChatMessages() - normalizedStartId);
    return ensureChatRangeLoaded(normalizedStartId, count);
}

export async function returnToLiveTailView(navigationToken = null) {
    return serializeHistoryWindowNavigation(async (activeNavigationToken) => {
        if (!isSplitTailChat() || isChatFullyHydrated()) {
            return;
        }

        const count = getConfiguredLongChatDisplayCount();
        const startId = Math.max(chatLoadState.tailStartId, chatLoadState.tailEndId - count + 1);
        await ensureChatRangeLoaded(startId, count);
        chatLoadState.currentView = 'tail';
        await renderMessageWindow(startId, count, activeNavigationToken);
        scrollChatToBottom();
    }, navigationToken);
}

export async function hydrateCurrentChatForEditing(navigationToken = null) {
    return serializeHistoryWindowNavigation(async (activeNavigationToken) => {
        if (!isSplitTailChat() || isChatFullyHydrated()) {
            return true;
        }

        const previousStartId = getFirstDisplayedMessageId();
        const previousCount = Math.max(1, chatElement.find('.mes').length || getConfiguredChatWindowSize());
        const response = await fetchChunkedChat({ hydrateFull: true, count: getTotalChatMessages() });
        applyChunkedChatPayload(response, { replace: true, currentView: chatLoadState.currentView });
        chatLoadState.isHydrated = true;

        const renderStart = Number.isFinite(previousStartId)
            ? clamp(previousStartId, 0, Math.max(0, getTotalChatMessages() - 1))
            : Math.max(0, getTotalChatMessages() - previousCount);
        await renderMessageWindow(renderStart, previousCount, activeNavigationToken);
        return true;
    }, navigationToken);
}

async function ensureMessageEditable(messageId, actionLabel = 'modify this message') {
    if (!isHistoricalChatMessage(messageId)) {
        return true;
    }

    const confirmed = await Popup.show.confirm(
        t`Load Full Chat`,
        `${t`This action requires the full chat to be loaded.`}<br>${t`Load the full chat now so you can ${actionLabel}?`}`,
    );

    if (confirmed !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }

    return hydrateCurrentChatForEditing();
}

function getConfiguredChatWindowSize(count = null) {
    const candidate = Number(count);
    if (Number.isFinite(candidate) && candidate > 0) {
        return candidate;
    }

    if (isSplitTailChat() && !isChatFullyHydrated()) {
        return getConfiguredLongChatDisplayCount();
    }

    const configured = Number(power_user.chat_truncation);
    if (Number.isFinite(configured) && configured > 0) {
        return configured;
    }

    return FALLBACK_CHAT_WINDOW_SIZE;
}

function setVisibleChatRange(startId = null, endId = null) {
    const normalizedStart = Number(startId);
    const normalizedEnd = Number(endId);

    if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd) || normalizedStart < 0 || normalizedEnd < normalizedStart) {
        visibleChatStartId = null;
        visibleChatEndId = null;
        return;
    }

    visibleChatStartId = normalizedStart;
    visibleChatEndId = normalizedEnd;
}

function syncVisibleChatRangeFromDom() {
    const firstMessageId = Number(chatElement.children('.mes').first().attr('mesid'));
    const lastMessageId = Number(chatElement.children('.mes').last().attr('mesid'));

    if (!Number.isFinite(firstMessageId) || !Number.isFinite(lastMessageId)) {
        setVisibleChatRange(null, null);
        return;
    }

    setVisibleChatRange(firstMessageId, lastMessageId);
}

function removeHistoryControls() {
    chatElement.children(`#${TOP_HISTORY_CONTROL_ID}, #${BOTTOM_HISTORY_CONTROL_ID}, #${RETURN_TO_TAIL_CONTROL_ID}, #${HYDRATE_CHAT_CONTROL_ID}`).remove();
}

function updateHistoryControls() {
    removeHistoryControls();

    if (!Number.isFinite(visibleChatStartId) || !Number.isFinite(visibleChatEndId)) {
        return;
    }

    if (isSplitTailChat() && !isChatFullyHydrated() && chatLoadState.currentView === 'history') {
        chatElement.prepend(`<button id="${HYDRATE_CHAT_CONTROL_ID}" type="button" class="chat_history_button">Load full chat for editing</button>`);
        chatElement.prepend(`<button id="${RETURN_TO_TAIL_CONTROL_ID}" type="button" class="chat_history_button">Return to live tail</button>`);
    }

    if (visibleChatStartId > 0) {
        chatElement.prepend(`<button id="${TOP_HISTORY_CONTROL_ID}" type="button" class="chat_history_button">Show more messages</button>`);
    }

    if (visibleChatEndId < chat.length - 1) {
        chatElement.append(`<button id="${BOTTOM_HISTORY_CONTROL_ID}" type="button" class="chat_history_button">Show newer messages</button>`);
    }
}

function finalizeRenderedMessageWindow() {
    chatElement.find('.mes').removeClass('last_mes');
    chatElement.find('.mes').last().addClass('last_mes');
    refreshSwipeButtons();
    refreshPromptInspectorButton();
    applyStylePins();
    updateHistoryControls();
}

export async function renderMessageWindow(startId = 0, count = null, navigationToken = null) {
    return serializeHistoryWindowNavigation(async () => {
        closeMessageEditor();
        removeHistoryControls();
        chatElement.children('.mes').remove();

        if (!chat.length) {
            setVisibleChatRange(null, null);
            return;
        }

        const normalizedStartId = clamp(Number(startId) || 0, 0, Math.max(0, chat.length - 1));
        const windowSize = getConfiguredChatWindowSize(count);
        const endId = Math.min(chat.length - 1, normalizedStartId + windowSize - 1);

        if (isSplitTailChat() && !isChatFullyHydrated()) {
            await ensureChatSuffixLoaded(normalizedStartId);
        } else {
            await ensureChatRangeLoaded(normalizedStartId, windowSize);
        }

        for (let i = normalizedStartId; i <= endId; i++) {
            if (!chat[i]) {
                continue;
            }
            addOneMessage(chat[i], { scroll: false, forceId: i, showSwipes: false });
        }

        if (isSplitTailChat() && !isChatFullyHydrated()) {
            chatLoadState.currentView = normalizedStartId < chatLoadState.tailStartId ? 'history' : 'tail';
        }

        setVisibleChatRange(normalizedStartId, endId);
        finalizeRenderedMessageWindow();
        await eventSource.emit(event_types.MORE_MESSAGES_LOADED);
    }, navigationToken);
}

export async function jumpToMessageWindow(messageId, count = null, navigationToken = null) {
    return serializeHistoryWindowNavigation(async (activeNavigationToken) => {
        const normalizedMessageId = Number(messageId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId < 0 || normalizedMessageId >= chat.length) {
            return $();
        }

        const firstDisplayedMessageId = getFirstDisplayedMessageId();
        const lastDisplayedMessageId = getLastDisplayedMessageId();
        const isVisible = Number.isFinite(firstDisplayedMessageId)
            && Number.isFinite(lastDisplayedMessageId)
            && normalizedMessageId >= firstDisplayedMessageId
            && normalizedMessageId <= lastDisplayedMessageId;

        if (!isVisible) {
            const windowSize = getConfiguredChatWindowSize(count);
            const startId = clamp(
                normalizedMessageId - Math.floor(windowSize / 2),
                0,
                Math.max(0, chat.length - windowSize),
            );
            await renderMessageWindow(startId, windowSize, activeNavigationToken);
        }

        return chatElement.find(`.mes[mesid="${normalizedMessageId}"]`);
    }, navigationToken);
}

export async function showMoreMessages(messagesToLoad = null, navigationToken = null) {
    return serializeHistoryWindowNavigation(async () => {
        const firstDisplayedMessageId = getFirstDisplayedMessageId();
        let messageId = firstDisplayedMessageId;
        let count = getConfiguredChatWindowSize(messagesToLoad);

        if (!Number.isFinite(messageId)) {
            messageId = getLastMessageId() + 1;
        }

        console.debug('Inserting messages before', messageId, 'count', count, 'chat length', chat.length);
        const prevHeight = chatElement.prop('scrollHeight');
        const isButtonInView = isElementInViewport($(`#${TOP_HISTORY_CONTROL_ID}`)[0]);
        let anchorId = Number.isFinite(firstDisplayedMessageId) && firstDisplayedMessageId < chat.length
            ? firstDisplayedMessageId
            : null;
        const loadStartId = Math.max(0, messageId - count);

        await ensureChatRangeLoaded(loadStartId, count);

        removeHistoryControls();

        while (messageId > 0 && count > 0) {
            const newMessageId = messageId - 1;
            if (!chat[newMessageId]) {
                break;
            }
            addOneMessage(chat[newMessageId], { insertBefore: anchorId, scroll: false, forceId: newMessageId, showSwipes: false });
            anchorId = newMessageId;
            count--;
            messageId--;
        }

        if (chatElement.children('.mes').length > 0) {
            setVisibleChatRange(messageId, getLastDisplayedMessageId() ?? messageId);
        } else {
            syncVisibleChatRangeFromDom();
        }

        if (isSplitTailChat() && !isChatFullyHydrated()) {
            chatLoadState.currentView = Number.isFinite(visibleChatStartId) && visibleChatStartId < chatLoadState.tailStartId ? 'history' : 'tail';
        }

        if (isButtonInView) {
            const newHeight = chatElement.prop('scrollHeight');
            chatElement.scrollTop(newHeight - prevHeight);
        }

        finalizeRenderedMessageWindow();
        await eventSource.emit(event_types.MORE_MESSAGES_LOADED);
    }, navigationToken);
}

export async function showNewerMessages(messagesToLoad = null, navigationToken = null) {
    return serializeHistoryWindowNavigation(async (activeNavigationToken) => {
        let messageId = getLastDisplayedMessageId();
        let count = getConfiguredChatWindowSize(messagesToLoad);

        if (!Number.isFinite(messageId)) {
            await renderMessageWindow(Math.max(0, chat.length - count), count, activeNavigationToken);
            return;
        }

        removeHistoryControls();

        await ensureChatRangeLoaded(messageId + 1, count);

        while (messageId < chat.length - 1 && count > 0) {
            const newMessageId = messageId + 1;
            if (!chat[newMessageId]) {
                break;
            }
            addOneMessage(chat[newMessageId], { scroll: false, forceId: newMessageId, showSwipes: false });
            count--;
            messageId++;
        }

        if (chatElement.children('.mes').length > 0) {
            setVisibleChatRange(getFirstDisplayedMessageId() ?? messageId, messageId);
        } else {
            syncVisibleChatRangeFromDom();
        }

        if (isSplitTailChat() && !isChatFullyHydrated()) {
            chatLoadState.currentView = Number.isFinite(visibleChatStartId) && visibleChatStartId < chatLoadState.tailStartId ? 'history' : 'tail';
        }

        finalizeRenderedMessageWindow();
        await eventSource.emit(event_types.MORE_MESSAGES_LOADED);
    }, navigationToken);
}

export async function printMessages() {
    let startIndex = 0;
    let count = getConfiguredChatWindowSize();

    if (chat.length > count) {
        startIndex = chat.length - count;
    }

    await renderMessageWindow(startIndex, count);
    scrollChatToBottom();
    delay(debounce_timeout.short).then(() => scrollOnMediaLoad());
}

function scrollOnMediaLoad() {
    const started = Date.now();
    const media = chatElement.find('.mes_block img, .mes_block video, .mes_block audio').toArray();
    let mediaLoaded = 0;

    for (const currentElement of media) {
        if (currentElement instanceof HTMLImageElement) {
            if (currentElement.complete) {
                incrementAndCheck();
            } else {
                currentElement.addEventListener('load', incrementAndCheck);
                currentElement.addEventListener('error', incrementAndCheck);
            }
        }
        if (currentElement instanceof HTMLMediaElement) {
            if (currentElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                incrementAndCheck();
            } else {
                currentElement.addEventListener('loadeddata', incrementAndCheck);
                currentElement.addEventListener('error', incrementAndCheck);
            }
        }
    }

    function incrementAndCheck() {
        const MAX_DELAY = 1000; // 1 second
        if ((Date.now() - started) > MAX_DELAY) {
            return;
        }
        mediaLoaded++;
        if (mediaLoaded === media.length) {
            scrollChatToBottom({ waitForFrame: true });
        }
    }
}

/**
 * Cancels the debounced chat save if it is currently pending.
 */
export function cancelDebouncedChatSave() {
    if (chatSaveTimeout) {
        console.debug('Debounced chat save cancelled');
        clearTimeout(chatSaveTimeout);
        chatSaveTimeout = null;
    }
}

function hasPendingDebouncedChatSave() {
    return Boolean(chatSaveTimeout);
}

export async function flushDebouncedChatSave() {
    if (!hasPendingDebouncedChatSave()) {
        return chatSaveQueuePromise
            ? await chatSaveQueuePromise
            : CHAT_SAVE_RESULT.SAVED;
    }

    cancelDebouncedChatSave();
    toastr.info(t`Please wait until the chat is saved.`, t`Your chat is still saving...`);
    const result = await saveChatConditional();

    if (result !== CHAT_SAVE_RESULT.SAVED) {
        saveChatDebounced();
    }

    return result;
}

export async function clearChat({ flushPendingSave = true } = {}) {
    if (flushPendingSave) {
        const saveResult = await flushDebouncedChatSave();
        if (saveResult !== CHAT_SAVE_RESULT.SAVED) {
            throw new Error('Pending chat save failed before clearing chat');
        }
    } else {
        cancelDebouncedChatSave();
    }

    cancelDebouncedMetadataSave();
    closeMessageEditor();
    extension_prompts = {};
    if (is_delete_mode) {
        $('#dialogue_del_mes_cancel').trigger('click');
    }
    chatElement.children().remove();
    if ($('.zoomed_avatar[forChar]').length) {
        console.debug('saw avatars to remove');
        $('.zoomed_avatar[forChar]').remove();
    } else { console.debug('saw no avatars'); }

    setVisibleChatRange(null, null);
    resetChatLoadState();
    setLatestItemizedPrompt(null);
    await saveItemizedPrompts(getCurrentChatId());
    refreshPromptInspectorButton();
}

export async function deleteLastMessage() {
    const deletedId = chat.length - 1;
    const deletedSnapshotKeys = deletedId >= 0 ? getPromptSnapshotKeysFromMessage(chat[deletedId]) : [];
    chat.length = chat.length - 1;
    syncSplitTailStateAfterMutation();
    chatElement.children('.mes').last().remove();
    syncVisibleChatRangeFromDom();
    await syncLatestPromptInspectorAfterMessageDeletion(deletedId);
    await maintainPromptSnapshotKeys({ deletes: deletedSnapshotKeys });
    updateHistoryControls();
    restoreTimedWorldInfoFromChat();
    await eventSource.emit(event_types.MESSAGE_DELETED, deletedId, chat.length);
}

/**
 * Deletes a message from the chat by its ID, optionally asking for confirmation.
 * @param {number} id The ID of the message to delete.
 * @param {number} [swipeDeletionIndex] Deletes the swipe with that index.
 * @param {boolean} [askConfirmation=false] Whether to ask for confirmation before deleting.
 */
export async function deleteMessage(id, swipeDeletionIndex = undefined, askConfirmation = false) {
    if (!await ensureMessageEditable(id, 'delete this message')) {
        return;
    }

    const canDeleteSwipe = swipeDeletionIndex !== undefined && swipeDeletionIndex !== null;
    if (canDeleteSwipe) {
        if (swipeDeletionIndex < 0) {
            throw new Error('Swipe index cannot be negative');
        }
        if (!Array.isArray(chat[id].swipes)) {
            throw new Error('Message has no swipes to delete');
        }
        if (chat[id].swipes.length <= swipeDeletionIndex) {
            throw new Error('Swipe index out of bounds');
        }
    }

    const minId = getFirstDisplayedMessageId();
    const messageElement = chatElement.find(`.mes[mesid="${id}"]`);
    if (messageElement.length === 0) {
        return;
    }

    let deleteOnlySwipe = canDeleteSwipe;
    if (askConfirmation) {
        const result = await callGenericPopup(t`Are you sure you want to delete this message?`, POPUP_TYPE.CONFIRM, null, {
            okButton: canDeleteSwipe ? t`Delete Swipe` : t`Delete Message`,
            cancelButton: 'Cancel',
            customButtons: canDeleteSwipe ? [t`Delete Message`] : null,
        });
        if (!result) {
            return;
        }
        deleteOnlySwipe = canDeleteSwipe && result === POPUP_RESULT.AFFIRMATIVE; // Default button, not the custom one
    }

    if (deleteOnlySwipe) {
        await deleteSwipe(swipeDeletionIndex, id);
        return;
    }

    const deletedSnapshotKeys = getPromptSnapshotKeysFromMessage(chat[id]);
    chat.splice(id, 1);
    syncSplitTailStateAfterMutation();
    const rekeys = [];
    for (let messageIndex = id; messageIndex < chat.length; messageIndex++) {
        rekeyMessagePromptSnapshotKeys(chat[messageIndex], messageIndex, rekeys);
    }
    await syncLatestPromptInspectorAfterMessageDeletion(id);
    messageElement.remove();
    restoreTimedWorldInfoFromChat();
    await maintainPromptSnapshotKeys({ deletes: deletedSnapshotKeys, rekeys });

    chat_metadata['tainted'] = true;

    const startIndex = [0, minId].includes(id) ? id : null;
    updateViewMessageIds(startIndex);
    if (askConfirmation) {
        await saveChatConditional();
    } else {
        saveChatDebounced();
    }

    if (this_edit_mes_id === id) {
        this_edit_mes_id = undefined;
    }

    refreshSwipeButtons();

    await eventSource.emit(event_types.MESSAGE_DELETED, id, chat.length);
}

export async function reloadCurrentChat() {
    const deferredLoader = isLoaderVisible() ? null : deferLoader();

    try {
        preserveNeutralChat();
        await clearChat();
        chat.length = 0;

        if (selected_group) {
            await getGroupChat(selected_group, true);
        }
        else if (this_chid !== undefined) {
            await getChat();
        }
        else {
            resetChatState();
            restoreNeutralChat();
            await getCharacters();
            await ensureDeferredLoaderShown({ force: true });
            await waitForLoaderPaint();
            await printMessages();
            await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId());
        }

        refreshSwipeButtons();
    } finally {
        await deferredLoader?.clear();
    }
}

/**
 * Send the message currently typed into the chat box.
 */
export async function sendTextareaMessage() {
    if (is_send_press) return;
    if (isExecutingCommandsFromChatInput) return;

    let generateType = 'normal';
    // "Continue on send" is activated when the user hits "send" (or presses enter) on an empty chat box, and the last
    // message was sent from a character (not the user or the system).
    const textareaText = String($('#send_textarea').val());
    if (power_user.continue_on_send &&
        !hasPendingFileAttachment() &&
        !textareaText &&
        !selected_group &&
        chat.length &&
        !chat[chat.length - 1]['is_user'] &&
        !chat[chat.length - 1]['is_system']
    ) {
        generateType = 'continue';
    }

    if (textareaText && !selected_group && this_chid === undefined && name2 !== neutralCharacterName) {
        await newAssistantChat({ temporary: false });
    }

    try {
        return await Generate(generateType);
    } catch (error) {
        unblockGeneration(generateType);

        if (abortController?.signal?.aborted || error?.name === 'AbortError') {
            return;
        }

        console.error('sendTextareaMessage failed', error);

        if (typeof error?.message === 'string' && error.message) {
            toastr.error(error.message, t`Generation failed`, { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
        } else {
            toastr.error(t`Check the browser console for details.`, t`Generation failed`, { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
        }

        return;
    }
}

/**
 * Formats the message text into an HTML string using Markdown and other formatting.
 * @param {string} mes Message text
 * @param {string} ch_name Character name
 * @param {boolean} isSystem If the message was sent by the system
 * @param {boolean} isUser If the message was sent by the user
 * @param {number} messageId Message index in chat array
 * @param {object} [sanitizerOverrides] DOMPurify sanitizer option overrides
 * @param {boolean} [isReasoning] If the message is reasoning output
 * @returns {string} HTML string
 */
export function messageFormatting(mes, ch_name, isSystem, isUser, messageId, sanitizerOverrides = {}, isReasoning = false) {
    if (!mes) {
        return '';
    }

    if (Number(messageId) === 0 && !isSystem && !isUser && !isReasoning) {
        const mesBeforeReplace = mes;
        const chatMessage = chat[messageId];
        mes = substituteParams(mes, undefined, ch_name);
        if (chatMessage && chatMessage.mes === mesBeforeReplace && chatMessage.extra?.display_text !== mesBeforeReplace) {
            chatMessage.mes = mes;
        }
    }

    mesForShowdownParse = mes;

    // Force isSystem = false on comment messages so they get formatted properly
    if (ch_name === COMMENT_NAME_DEFAULT && isSystem && !isUser) {
        isSystem = false;
    }

    // Let hidden messages have markdown
    if (isSystem && ch_name !== systemUserName) {
        isSystem = false;
    }

    // Prompt bias replacement should be applied on the raw message
    const replacedPromptBias = power_user.user_prompt_bias && substituteParams(power_user.user_prompt_bias);
    if (!power_user.show_user_prompt_bias && ch_name && !isUser && !isSystem && replacedPromptBias && mes.startsWith(replacedPromptBias)) {
        mes = mes.slice(replacedPromptBias.length);
    }

    if (!isSystem) {
        function getRegexPlacement() {
            try {
                if (isReasoning) {
                    return regex_placement.REASONING;
                }
                if (isUser) {
                    return regex_placement.USER_INPUT;
                } else if (chat[messageId]?.extra?.type === 'narrator') {
                    return regex_placement.SLASH_COMMAND;
                } else {
                    return regex_placement.AI_OUTPUT;
                }
            } catch {
                return regex_placement.AI_OUTPUT;
            }
        }

        const regexPlacement = getRegexPlacement();
        const usableMessages = chat.map((x, index) => ({ message: x, index: index })).filter(x => !x.message.is_system);
        const indexOf = usableMessages.findIndex(x => x.index === Number(messageId));
        const depth = messageId >= 0 && indexOf !== -1 ? (usableMessages.length - indexOf - 1) : undefined;

        // Always override the character name
        mes = getRegexedString(mes, regexPlacement, {
            characterOverride: ch_name,
            isMarkdown: true,
            depth: depth,
        });
    }

    if (power_user.auto_fix_generated_markdown) {
        mes = fixMarkdown(mes, true);
    }

    if (!isSystem && power_user.encode_tags) {
        mes = canUseNegativeLookbehind()
            ? mes.replaceAll('<', '&lt;').replace(new RegExp('(?<!^|\\n\\s*)>', 'g'), '&gt;')
            : mes.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    // Make sure reasoning strings are always shown, even if they include "<" or ">"
    [power_user.reasoning.prefix, power_user.reasoning.suffix].forEach((reasoningString) => {
        if (!reasoningString || !reasoningString.trim().length) {
            return;
        }
        // Only replace the first occurrence of the reasoning string
        if (mes.includes(reasoningString)) {
            mes = mes.replace(reasoningString, escapeHtml(reasoningString));
        }
    });

    if (!isSystem) {
        // Save double quotes in tags as a special character to prevent them from being encoded
        if (!power_user.encode_tags) {
            mes = mes.replace(/<([^>]+)>/g, function (_, contents) {
                return '<' + contents.replace(/"/g, '\ufffe') + '>';
            });
        }

        mes = mes.replace(
            /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(\u300C.*?\u300D)|(\u300E.*?\u300F)|(\uFF02.*?\uFF02)/gim,
            function (match, p1, p2, p3, p4, p5, p6) {
                if (p1) {
                    // English double quotes
                    return `<q>"${p1.slice(1, -1)}"</q>`;
                } else if (p2) {
                    // Curly double quotes “ ”
                    return `<q>“${p2.slice(1, -1)}”</q>`;
                } else if (p3) {
                    // Guillemets « »
                    return `<q>«${p3.slice(1, -1)}»</q>`;
                } else if (p4) {
                    // Corner brackets 「 」
                    return `<q>「${p4.slice(1, -1)}」</q>`;
                } else if (p5) {
                    // White corner brackets 『 』
                    return `<q>『${p5.slice(1, -1)}』</q>`;
                } else if (p6) {
                    // Fullwidth quotes ＂ ＂
                    return `<q>＂${p6.slice(1, -1)}＂</q>`;
                } else {
                    // Return the original match if no quotes are found
                    return match;
                }
            },
        );

        // Restore double quotes in tags
        if (!power_user.encode_tags) {
            mes = mes.replace(/\ufffe/g, '"');
        }

        mes = mes.replaceAll('\\begin{align*}', '$$');
        mes = mes.replaceAll('\\end{align*}', '$$');
        mes = converter.makeHtml(mes);

        mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, function (match) {
            // Firefox creates extra newlines from <br>s in code blocks, so we replace them before converting newlines to <br>s.
            return match.replace(/\n/gm, '\u0000');
        });
        mes = mes.replace(/\u0000/g, '\n'); // Restore converted newlines
        mes = mes.trim();

        mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, function (match) {
            return match.replace(/&amp;/g, '&');
        });
    }

    if (!power_user.allow_name2_display && ch_name && !isUser && !isSystem) {
        mes = mes.replace(new RegExp(`(^|\n)${escapeRegex(ch_name)}:`, 'g'), '$1');
    }

    /** @type {import('dompurify').Config & { RETURN_DOM_FRAGMENT: false; RETURN_DOM: false }} */
    const config = {
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_TRUSTED_TYPE: false,
        MESSAGE_SANITIZE: true,
        ADD_TAGS: ['custom-style'],
        ...sanitizerOverrides,
    };
    mes = encodeStyleTags(mes);
    mes = DOMPurify.sanitize(mes, config);
    mes = decodeStyleTags(mes, { prefix: '.mes_text ' });

    return mes;
}

/**
 * Inserts or replaces an SVG icon adjacent to the provided message's timestamp.
 *
 * If the `extra.api` is "openai" and `extra.model` contains the substring "claude",
 * the function fetches the "claude.svg". Otherwise, it fetches the SVG named after
 * the value in `extra.api`.
 *
 * @param {JQuery<HTMLElement>} mes - The message element containing the timestamp where the icon should be inserted or replaced.
 * @param {Object} extra - Contains the API and model details.
 * @param {string} extra.api - The name of the API, used to determine which SVG to fetch.
 * @param {string} extra.model - The model name, used to check for the substring "claude".
 */
function insertSVGIcon(mes, extra) {
    // Determine the SVG filename
    let modelName;

    // Claude on OpenRouter or Anthropic
    if (extra.api === 'openai' && extra.model?.toLowerCase().includes('claude')) {
        modelName = 'claude';
    }
    // OpenAI on OpenRouter
    else if (extra.api === 'openai' && extra.model?.toLowerCase().includes('openai')) {
        modelName = 'openai';
    }
    // OpenRouter website model or other models
    else if (extra.api === 'openai' && (extra.model === null || extra.model?.toLowerCase().includes('/'))) {
        modelName = 'openrouter';
    }
    // Everything else
    else {
        modelName = extra.api;
    }

    const insertOrReplaceSVG = (image, className, targetSelector, insertBefore) => {
        image.onload = async function () {
            let existingSVG = insertBefore ? mes.find(targetSelector).prev(`.${className}`) : mes.find(targetSelector).next(`.${className}`);
            if (existingSVG.length) {
                existingSVG.replaceWith(image);
            } else {
                if (insertBefore) mes.find(targetSelector).before(image);
                else mes.find(targetSelector).after(image);
            }
            await SVGInject(image);
        };
    };

    const createModelImage = (className, targetSelector, insertBefore) => {
        const image = new Image();
        image.classList.add('icon-svg', className);
        image.src = `/img/${modelName}.svg`;
        image.title = `${extra?.api ? extra.api + ' - ' : ''}${extra?.model ?? ''}`;
        insertOrReplaceSVG(image, className, targetSelector, insertBefore);
    };

    createModelImage('timestamp-icon', '.timestamp');
    createModelImage('thinking-icon', '.mes_reasoning_header_title', true);
}


function getMessageFromTemplate({
    mesId,
    swipeId,
    characterName,
    isUser,
    avatarImg,
    bias,
    isSystem,
    title,
    timerValue,
    timerTitle,
    bookmarkLink,
    forceAvatar,
    timestamp,
    tokenCount,
    extra,
    type,
    isPromptHidden,
}) {
    const mes = messageTemplate.clone();
    mes.attr({
        'mesid': mesId,
        'swipeid': swipeId,
        'ch_name': characterName,
        'is_user': isUser,
        'is_system': !!(isPromptHidden ?? isSystem),
        'bookmark_link': bookmarkLink,
        'force_avatar': !!forceAvatar,
        'timestamp': timestamp,
        ...(type ? { type } : {}),
    });
    mes.find('.avatar img').attr('src', avatarImg);
    mes.find('.ch_name .name_text').text(characterName);
    mes.find('.mes_bias').html(bias);
    mes.find('.timestamp').text(timestamp).attr('title', `${extra?.api ? extra.api + ' - ' : ''}${extra?.model ?? ''}`);
    mes.find('.mesIDDisplay').text(`#${mesId}`);
    tokenCount && mes.find('.tokenCounterDisplay').text(`${tokenCount}t`);
    title && mes.attr('title', title);
    timerValue && mes.find('.mes_timer').attr('title', timerTitle).text(timerValue);
    bookmarkLink && updateBookmarkDisplay(mes);

    updateReasoningUI(mes);

    if (power_user.timestamp_model_icon && extra?.api) {
        insertSVGIcon(mes, extra);
    }

    return mes;
}

/**
 * Re-renders a message block with updated content.
 * @param {number} messageId Message ID
 * @param {object} message Message object
 * @param {object} [options={}] Optional arguments
 * @param {boolean} [options.rerenderMessage=true] Whether to re-render the message content (inside <c>.mes_text</c>)
 */
export function updateMessageBlock(messageId, message, { rerenderMessage = true } = {}) {
    const messageElement = chatElement.find(`[mesid="${messageId}"]`);
    if (rerenderMessage) {
        const text = message?.extra?.display_text ?? message.mes;
        messageElement.find('.mes_text').html(messageFormatting(text, message.name, message.is_system, message.is_user, messageId, {}, false));
    }

    updateReasoningUI(messageElement);

    addCopyToCodeBlocks(messageElement);
    appendMediaToMessage(message, messageElement);
}

/**
 * Ensures that the message media properties are arrays, adding getters/setters for single media items.
 * @param {ChatMessage} mes Message object
 */
export function ensureMessageMediaIsArray(mes) {
    /**
     * Determines if a property of an object is a plain property (not a getter/setter or non-enumerable).
     * @param {object} obj Object to check
     * @param {string} name Property name
     * @returns {boolean} True if the property is a plain property, false otherwise
     */
    function isPlainObjectProperty(obj, name) {
        const hasProperty = Object.hasOwn(obj, name);
        if (hasProperty) {
            const descriptor = Object.getOwnPropertyDescriptor(obj, name);
            return descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable;
        }
        return false;
    }

    /**
     * Determines if a property of an object is a getter (not a plain property).
     * @param {object} obj Object to check
     * @param {string} name Property name
     * @returns {boolean} True if the property is a getter, false otherwise
     */
    function isGetterObjectProperty(obj, name) {
        const hasProperty = Object.hasOwn(obj, name);
        if (hasProperty) {
            const descriptor = Object.getOwnPropertyDescriptor(obj, name);
            return descriptor && typeof descriptor.get === 'function';
        }
        return false;
    }

    /**
     * Adds a plain property to an object that wraps around an array property.
     * @param {object} obj Object to add property to
     * @param {string} plainProperty Plain property name
     * @param {string} arrayProperty Array property to back the plain property
     * @param {(value: any) => boolean} [filterFn] Optional filter function to apply when getting/setting the plain property
     * @param {(value: any) => any} [mapFn] Optional map function to apply when getting/setting the plain property
     */
    function addArrayAutoWrapper(obj, plainProperty, arrayProperty, filterFn = () => true, mapFn = (t) => t) {
        // If the plain property is already a getter, do nothing.
        const hasGetterProperty = isGetterObjectProperty(obj, plainProperty);
        if (hasGetterProperty) {
            return;
        }

        // Define the plain property as a getter/setter that wraps around the array property.
        Object.defineProperty(obj, plainProperty, {
            // Getting the plain property returns the first item in the array property, or undefined if the array is empty.
            get: function () {
                console.trace(`Attempting to GET an array-wrapped property '${plainProperty}'. Use the array property '${arrayProperty}' instead.`);
                const array = Array.isArray(this[arrayProperty]) ? this[arrayProperty].filter(filterFn).map(mapFn) : [];
                return array.length > 0 ? array[0] : void 0;
            },
            // Setting the plain property is not supported, as it would be ambiguous.
            set: function () {
                console.trace(`Attempting to SET an array-wrapped property '${plainProperty}'. Use the array property '${arrayProperty}' instead.`);
            },
            // Exclude the property from JSON serialization and from being listed in for...in loops.
            enumerable: false,
            // Make the property non-configurable to prevent deletion or redefinition.
            configurable: false,
        });
    }

    /**
     * Migrates image swipes from a single image property to an array.
     * @param {ChatMessageExtra} obj
     */
    function migrateMediaToArray(obj) {
        if (isPlainObjectProperty(obj, 'file')) {
            if (!Array.isArray(obj.files)) {
                obj.files = [];
            }
            const fileValue = obj.file;
            delete obj.file;
            if (fileValue) {
                obj.files.push(fileValue);
            }
        }

        if (Array.isArray(obj.image_swipes)) {
            if (!Array.isArray(obj.media)) {
                obj.media = [];
            }
            for (const swipe of obj.image_swipes) {
                if (swipe && typeof swipe === 'string') {
                    obj.media_display = MEDIA_DISPLAY.GALLERY;
                    obj.media.push({ type: MEDIA_TYPE.IMAGE, url: swipe });
                }
            }
            delete obj.image_swipes;
        }

        if (isPlainObjectProperty(obj, 'image')) {
            if (!Array.isArray(obj.media)) {
                obj.media = [];
            }
            const imageValue = obj.image;
            delete obj.image;
            if (imageValue && typeof imageValue === 'string') {
                obj.media.push({ type: MEDIA_TYPE.IMAGE, url: imageValue });
            }
            if (obj.media_display === MEDIA_DISPLAY.GALLERY) {
                const selectedIndex = obj.media.findIndex(t => t.url === imageValue);
                if (selectedIndex > -1) {
                    obj.media_index = selectedIndex;
                }
            }
            obj.media = obj.media.filter((v, i, a) => i === a.findIndex(t => t.url === v.url));
        }

        if (isPlainObjectProperty(obj, 'video')) {
            if (!Array.isArray(obj.media)) {
                obj.media = [];
            }
            const videoValue = obj.video;
            delete obj.video;
            if (videoValue && typeof videoValue === 'string') {
                obj.media.push({ type: MEDIA_TYPE.VIDEO, url: videoValue });
            }
        }
    }

    if (!mes || !mes.extra || typeof mes.extra !== 'object') {
        return;
    }

    migrateMediaToArray(mes.extra);
    addArrayAutoWrapper(mes.extra, 'file', 'files');
    addArrayAutoWrapper(mes.extra, 'image', 'media', (t) => t.type === MEDIA_TYPE.IMAGE, (t) => t.url);
    addArrayAutoWrapper(mes.extra, 'video', 'media', (t) => t.type === MEDIA_TYPE.VIDEO, (t) => t.url);

    if (Array.isArray(mes.extra.media)) {
        mes.extra.media.forEach(hydrateMediaAttachment);
        if (mes.extra.media.some(attachment => attachment?.type === MEDIA_TYPE.IMAGE && !attachment?.mediaId && attachment?.url)) {
            void backfillImageMediaIdsForMessages([mes], { persist: true });
        }
    }
}

/**
 * Gets the media display setting for a message.
 * @param {ChatMessage} mes Message object
 * @returns {MEDIA_DISPLAY} Media display setting
 */
export function getMediaDisplay(mes) {
    const value = mes?.extra?.media_display || power_user.media_display || MEDIA_DISPLAY.LIST;
    return Object.values(MEDIA_DISPLAY).includes(value) ? value : MEDIA_DISPLAY.LIST;
}

/**
 * Gets the media index for a message.
 * @param {ChatMessage} mes Message object
 * @returns {number} Media index
 */
export function getMediaIndex(mes) {
    if (!Array.isArray(mes?.extra?.media)) {
        return 0;
    }
    const value = mes.extra?.media_index;
    if (isNaN(value) || value < 0 || value >= mes.extra.media.length) {
        return 0;
    }
    return value;
}

/**
 * Appends image or file to the message element.
 * @param {ChatMessage} mes Message object
 * @param {JQuery<HTMLElement>} messageElement Message element
 * @param {string} [scrollBehavior] Scroll behavior when adjusting scroll position
 */
export function appendMediaToMessage(mes, messageElement, scrollBehavior = SCROLL_BEHAVIOR.ADJUST) {
    ensureMessageMediaIsArray(mes);

    const fileWrapper = messageElement.find('.mes_file_wrapper');
    const mediaWrapper = messageElement.find('.mes_media_wrapper');

    const hasMedia = Array.isArray(mes?.extra?.media) && mes.extra.media.length > 0;
    const hasFiles = Array.isArray(mes?.extra?.files) && mes.extra.files.length > 0;
    const mediaDisplay = hasMedia ? getMediaDisplay(mes) : null;
    const hideMessageText = hasMedia && mes?.extra?.inline_image === false;

    const mediaBlocks = [];
    const mediaPromises = [];

    const chatHeight = (hasMedia || hasFiles) ? chatElement.prop('scrollHeight') : 0;
    const scrollPosition = (hasMedia || hasFiles) ? chatElement.scrollTop() : 0;
    const doAdjustScroll = () => {
        if (!hasMedia && !hasFiles) {
            return;
        }
        if (scrollBehavior === SCROLL_BEHAVIOR.NONE) {
            return;
        }
        if (scrollBehavior === SCROLL_BEHAVIOR.KEEP) {
            chatElement.scrollTop(scrollPosition);
            return;
        }
        const newChatHeight = chatElement.prop('scrollHeight');
        const diff = newChatHeight - chatHeight;
        chatElement.scrollTop(scrollPosition + diff);
    };

    // Set media display attribute
    messageElement.attr('data-media-display', mediaDisplay);
    // Toggle text visibility
    messageElement.find('.mes_text').toggleClass('displayNone', hideMessageText);

    /**
     * Appends a single image attachment to the message element.
     * @param {MediaAttachment} attachment Image attachment object
     * @param {number} index Index of the image attachment
     * @returns {JQuery<HTMLElement>} The appended image container element
     */
    function appendImageAttachment(attachment, index) {
        const template = $('#message_image_template .mes_img_container').clone();
        template.attr('data-index', index);
        const attachmentUrl = getMediaAttachmentUrl(attachment);

        if (attachment.status === 'unavailable' || !attachmentUrl) {
            template.addClass('mes_img_container_unavailable');
            template.find('.mes_media_enlarge, .mes_img_caption').remove();
            template.find('.mes_img').remove();
            const unavailable = $('<div />', { class: 'mes_img mes_img_unavailable' });
            $('<div />', { class: 'mes_img_unavailable_title', text: attachment.title || t`Image unavailable` }).appendTo(unavailable);
            $('<div />', { class: 'mes_img_unavailable_error', text: attachment.error || t`This image could not be ingested and was skipped.` }).appendTo(unavailable);
            template.append(unavailable);
            mediaBlocks.push(template);
            return template;
        }

        const image = template.find('.mes_img');
        image.attr('src', attachmentUrl);
        image.attr('title', attachment.title || mes.extra.title || '');
        mediaPromises.push(new Promise((resolve) => {
            function onLoad() {
                image.removeAttr('alt');
                image.removeClass('error');
                resolve();
            }
            function onError() {
                image.attr('alt', '');
                image.addClass('error');
                resolve();
            }
            if (image.prop('complete')) {
                onLoad();
            } else {
                image.off('load').on('load', onLoad);
                image.off('error').on('error', onError);
            }
        }));

        mediaBlocks.push(template);
        return template;
    }

    /**
     * Appends a single video attachment to the message element.
     * @param {MediaAttachment} attachment Video attachment object
     * @param {number} index Index of the video attachment
     * @returns {JQuery<HTMLElement>} The appended video container element
     */
    function appendVideoAttachment(attachment, index) {
        const template = $('#message_video_template .mes_video_container').clone();
        template.attr('data-index', index);

        const video = template.find('.mes_video');
        video.attr('src', attachment.url);
        video.attr('title', attachment.title || mes.extra.title || '');
        mediaPromises.push(new Promise((resolve) => {
            function onLoad() {
                resolve();
            }
            function onError() {
                video.addClass('error');
                resolve();
            }
            if (video.prop('readyState') >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                onLoad();
            } else {
                video.off('loadeddata').on('loadeddata', onLoad);
                video.off('error').on('error', onError);
            }
        }));

        mediaBlocks.push(template);
        return template;
    }

    /**
     * Appends a single audio attachment to the message element.
     * @param {MediaAttachment} attachment Audio attachment object
     * @param {number} index Index of the audio attachment
     * @returns {JQuery<HTMLElement>} The appended audio container element
     */
    function appendAudioAttachment(attachment, index) {
        const template = $('#message_audio_template .mes_audio_container').clone();
        template.attr('data-index', index);
        const audio = template.find('.mes_audio');
        audio.attr('src', attachment.url);
        audio.attr('title', attachment.title || mes.extra.title || '');

        mediaPromises.push(new Promise((resolve) => {
            function onLoad() {
                resolve();
            }
            function onError() {
                audio.addClass('error');
                resolve();
            }
            if (audio.prop('readyState') >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                onLoad();
            } else {
                audio.off('loadeddata').on('loadeddata', onLoad);
                audio.off('error').on('error', onError);
            }
        }));

        new AudioPlayer(audio.get(0), template.get(0));

        mediaBlocks.push(template);
        return template;
    }

    /**
     * Appends a media attachment to the message element.
     * @param {MediaAttachment} attachment Media attachment object
     * @param {number} index Index of the media attachment
     * @returns {JQuery<HTMLElement>} The appended media container element
     */
    function appendMediaAttachment(attachment, index) {
        if (!attachment.type) {
            attachment.type = MEDIA_TYPE.IMAGE;
        }
        switch (attachment.type) {
            case MEDIA_TYPE.IMAGE:
                return appendImageAttachment(attachment, index);
            case MEDIA_TYPE.VIDEO:
                return appendVideoAttachment(attachment, index);
            case MEDIA_TYPE.AUDIO:
                return appendAudioAttachment(attachment, index);
        }

        console.warn(`Unknown media type: ${attachment.type}, defaulting to image.`, attachment);
        return appendImageAttachment(attachment, index);
    }

    /**
     * Saves the current playback times of media elements in the message.
     * @returns {Map<string, MediaState>} Media playback times by source URL
     */
    function saveMediaStates() {
        const states = new Map();
        const media = mediaWrapper.find('video, audio');
        media.each((_, element) => {
            if (element instanceof HTMLMediaElement) {
                if (!element.currentSrc || element.readyState === HTMLMediaElement.HAVE_NOTHING) {
                    return;
                }
                const state = { currentTime: element.currentTime, paused: element.paused };
                states.set(element.currentSrc, state);
            }
        });
        return states;
    }

    /**
     * Restores the playback times of media elements in the message.
     * @param {Map<string, MediaState>} states Media playback times by source URL
     */
    function restoreMediaStates(states) {
        const media = mediaWrapper.find('video, audio');
        media.each((_, element) => {
            if (element instanceof HTMLMediaElement) {
                const restoreState = () => {
                    if (!states.has(element.currentSrc)) {
                        return;
                    }
                    const state = states.get(element.currentSrc);
                    element.currentTime = state.currentTime;
                    if (!state.paused) {
                        element.play();
                    }
                };
                if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
                    element.addEventListener('loadedmetadata', () => restoreState(), { once: true });
                } else {
                    restoreState();
                }
            }
        });
    }

    // Add media gallery to message
    if (hasMedia && mediaDisplay === MEDIA_DISPLAY.GALLERY) {
        const mediaIndex = getMediaIndex(mes);
        const selectedMedia = mes.extra.media[mediaIndex];

        const galleryControls = $('#message_gallery_controls .mes_img_swipes').clone();
        const counter = galleryControls.find('.mes_img_swipe_counter');
        counter.text(`${mediaIndex + 1}/${mes.extra.media.length}`);

        const template = appendMediaAttachment(selectedMedia, mediaIndex);
        template.addClass('img_swipes');
        template.append(galleryControls);
    }

    // Add media as a list to message
    if (hasMedia && mediaDisplay === MEDIA_DISPLAY.LIST) {
        for (let index = 0; index < mes.extra.media.length; index++) {
            const attachment = mes.extra.media[index];
            appendMediaAttachment(attachment, index);
        }
    }

    // Remove existing file containers
    fileWrapper.empty();

    // Add files to message
    if (hasFiles) {
        for (let index = 0; index < mes.extra.files.length; index++) {
            const file = mes.extra.files[index];
            const template = $('#message_file_template .mes_file_container').clone();
            template.attr('data-index', index);
            template.find('.mes_file_name').text(file.name).attr('title', file.name);
            template.find('.mes_file_size').text(humanFileSize(file.size)).attr('title', file.size);
            fileWrapper.append(template);
        }
    }

    // Early return if no media
    if (!hasMedia) {
        mediaWrapper.empty();
        doAdjustScroll();
        return;
    }

    // TODO: Consider making this awaitable
    Promise.race([Promise.all(mediaPromises), delay(debounce_timeout.short)]).then(() => {
        const states = saveMediaStates();
        mediaWrapper.empty().append(mediaBlocks);
        restoreMediaStates(states);
        doAdjustScroll();
    });
}

export function addCopyToCodeBlocks(messageElement) {
    const codeBlocks = $(messageElement).find('pre code');
    for (let i = 0; i < codeBlocks.length; i++) {
        hljs.highlightElement(codeBlocks.get(i));
        const copyButton = document.createElement('i');
        copyButton.classList.add('fa-solid', 'fa-copy', 'code-copy', 'interactable');
        copyButton.title = 'Copy code';
        codeBlocks.get(i).appendChild(copyButton);
        copyButton.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        copyButton.addEventListener('pointerup', async function () {
            const text = codeBlocks.get(i).textContent;
            await copyText(text);
            toastr.info(t`Copied!`, '', { timeOut: 2000 });
        });
    }
}


/**
 * Adds a single message to the chat.
 * @param {ChatMessage} mes Message object
 * @param {object} [options] Options
 * @param {string} [options.type='normal'] Message type
 * @param {number} [options.insertAfter=null] Message ID to insert the new message after
 * @param {boolean} [options.scroll=true] Whether to scroll to the new message
 * @param {number} [options.insertBefore=null] Message ID to insert the new message before
 * @param {number} [options.forceId=null] Force the message ID
 * @param {boolean} [options.showSwipes=true] Whether to show swipe buttons
 * @returns {void}
 */
export function addOneMessage(mes, { type = 'normal', insertAfter = null, scroll = true, insertBefore = null, forceId = null, showSwipes = true } = {}) {
    let messageText = mes['mes'];
    const momentDate = timestampToMoment(mes.send_date);
    const timestamp = momentDate.isValid() ? momentDate.format('LL LT') : '';

    if (mes?.extra?.display_text) {
        messageText = mes.extra.display_text;
    }

    // Forbidden black magic
    // This allows to use "continue" on user messages
    if (type === 'swipe' && mes.swipe_id === undefined) {
        mes.swipe_id = 0;
        mes.swipes = [mes.mes];
    }

    let avatarImg = getThumbnailUrl('persona', user_avatar);
    const isSystem = mes.is_system;
    const isPromptHidden = isPromptHiddenChatMessage(mes);
    const title = mes.title;

    //for non-user mesages
    if (!mes['is_user']) {
        if (mes.force_avatar) {
            avatarImg = mes.force_avatar;
        } else if (this_chid === undefined) {
            avatarImg = system_avatar;
        } else {
            if (characters[this_chid].avatar !== 'none') {
                avatarImg = getThumbnailUrl('avatar', characters[this_chid].avatar);
            } else {
                avatarImg = default_avatar;
            }
        }
        //old processing:
        //if messge is from sytem, use the name provided in the message JSONL to proceed,
        //if not system message, use name2 (char's name) to proceed
        //characterName = mes.is_system || mes.force_avatar ? mes.name : name2;
    } else if (mes['is_user'] && mes['force_avatar']) {
        // Special case for persona images.
        avatarImg = mes['force_avatar'];
    }

    // if mes.extra.uses_system_ui is true, set an override on the sanitizer options
    const sanitizerOverrides = mes.extra?.uses_system_ui ? { MESSAGE_ALLOW_SYSTEM_UI: true } : {};

    messageText = messageFormatting(
        messageText,
        mes.name,
        isSystem,
        mes.is_user,
        chat.indexOf(mes),
        sanitizerOverrides,
        false,
    );
    const bias = messageFormatting(mes.extra?.bias ?? '', '', false, false, -1, {}, false);
    let bookmarkLink = mes?.extra?.bookmark_link ?? '';

    let params = {
        mesId: forceId ?? chat.length - 1,
        swipeId: mes.swipe_id ?? 0,
        characterName: mes.name,
        isUser: mes.is_user,
        avatarImg: avatarImg,
        bias: bias,
        isSystem: isSystem,
        title: title,
        bookmarkLink: bookmarkLink,
        forceAvatar: mes.force_avatar,
        timestamp: timestamp,
        extra: mes.extra,
        tokenCount: mes.extra?.token_count ?? 0,
        type: mes.extra?.type ?? '',
        isPromptHidden,
        ...formatGenerationTimer(mes.gen_started, mes.gen_finished, mes.extra?.token_count, mes.extra?.reasoning_duration, mes.extra?.time_to_first_token),
    };

    const renderedMessage = getMessageFromTemplate(params);

    if (type !== 'swipe') {
        if (insertAfter == null && insertBefore == null) {
            chatElement.append(renderedMessage);
        }
        else if (insertAfter != null) {
            const target = chatElement.find(`.mes[mesid="${insertAfter}"]`);
            $(renderedMessage).insertAfter(target);
        } else {
            const target = chatElement.find(`.mes[mesid="${insertBefore}"]`);
            $(renderedMessage).insertBefore(target);
        }
    }

    // Callers push the new message to chat before calling addOneMessage
    const newMessageId = typeof forceId == 'number' ? forceId : chat.length - 1;
    mergeLoadedRange(newMessageId, newMessageId);

    const newMessage = chatElement.find(`[mesid="${newMessageId}"]`);
    const isSmallSys = mes?.extra?.isSmallSys;

    if (isSmallSys === true) {
        newMessage.addClass('smallSysMes');
    }

    if (Array.isArray(mes?.extra?.tool_invocations)) {
        newMessage.addClass('toolCall');
    }

    newMessage.find('.avatar img').on('error', function () {
        $(this).hide();
        $(this).parent().html('<div class="missing-avatar fa-solid fa-user-slash"></div>');
    });

    if (type === 'swipe') {
        const messageId = forceId ?? chat.length - 1;
        const swipeMessage = chatElement.find(`[mesid="${messageId}"]`);
        swipeMessage.attr('swipeid', params.swipeId);
        swipeMessage.find('.mes_text').html(messageText).attr('title', title);
        swipeMessage.find('.timestamp').text(timestamp).attr('title', `${params.extra.api} - ${params.extra.model}`);
        updateReasoningUI(swipeMessage);
        appendMediaToMessage(mes, swipeMessage, scroll ? SCROLL_BEHAVIOR.ADJUST : SCROLL_BEHAVIOR.NONE);
        if (power_user.timestamp_model_icon && params.extra?.api) {
            insertSVGIcon(swipeMessage, params.extra);
        }

        if (mes.swipe_id == mes.swipes.length - 1) {
            swipeMessage.find('.mes_timer').text(params.timerValue).attr('title', params.timerTitle);
            swipeMessage.find('.tokenCounterDisplay').text(`${params.tokenCount}t`);
        } else {
            swipeMessage.find('.mes_timer').empty();
            swipeMessage.find('.tokenCounterDisplay').empty();
        }
    } else {
        const messageId = forceId ?? chat.length - 1;
        chatElement.find(`[mesid="${messageId}"] .mes_text`).append(messageText);
        appendMediaToMessage(mes, newMessage, scroll ? SCROLL_BEHAVIOR.ADJUST : SCROLL_BEHAVIOR.NONE);
        showSwipes && hideSwipeButtons();
    }

    addCopyToCodeBlocks(newMessage);

    // Set the swipes counter for past messages, only visible if 'Show Swipes on All Message' is enabled
    if (!params.isUser && newMessageId !== 0 && newMessageId !== chat.length - 1) {
        const swipesNum = chat[newMessageId].swipes?.length;
        const swipeId = chat[newMessageId].swipe_id + 1;
        newMessage.find('.swipes-counter').text(formatSwipeCounter(swipeId, swipesNum));
    }

    if (showSwipes) {
        chatElement.find('.mes').last().addClass('last_mes');
        chatElement.find('.mes').eq(-2).removeClass('last_mes');
        refreshSwipeButtons();
    }

    refreshPromptInspectorButton();

    // Don't scroll if not inserting last
    if (insertAfter == null && insertBefore == null && scroll) {
        scrollChatToBottom();
    }

    applyCharacterTagsToMessageDivs({ mesIds: newMessageId });
    updateEditArrowClasses();
}

/**
 * Returns the URL of the avatar for the given character Id.
 * @param {number|string} characterId Character Id
 * @returns {string} Avatar URL
 */
export function getCharacterAvatar(characterId) {
    const character = characters[characterId];
    const avatarImg = character?.avatar;

    if (!avatarImg || avatarImg === 'none') {
        return default_avatar;
    }

    return formatCharacterAvatar(avatarImg);
}

export function formatCharacterAvatar(characterAvatar) {
    return `characters/${characterAvatar}`;
}

/**
 * Formats the title for the generation timer.
 * @param {MessageTimestamp} gen_started Date when generation was started
 * @param {MessageTimestamp} gen_finished Date when generation was finished
 * @param {number} tokenCount Number of tokens generated (0 if not available)
 * @param {number?} [reasoningDuration=null] Reasoning duration (null if no reasoning was done)
 * @param {number?} [timeToFirstToken=null] Time to first token
 * @returns {Object} Object containing the formatted timer value and title
 * @example
 * const { timerValue, timerTitle } = formatGenerationTimer(gen_started, gen_finished, tokenCount);
 * console.log(timerValue); // 1.2s
 * console.log(timerTitle); // Generation queued: 12:34:56 7 Jan 2021\nReply received: 12:34:57 7 Jan 2021\nTime to generate: 1.2 seconds\nToken rate: 5 t/s
 */
function formatGenerationTimer(gen_started, gen_finished, tokenCount, reasoningDuration = null, timeToFirstToken = null) {
    if (!gen_started || !gen_finished) {
        return {};
    }

    const dateFormat = 'HH:mm:ss D MMM YYYY';
    const start = moment(gen_started);
    const finish = moment(gen_finished);
    const seconds = finish.diff(start, 'seconds', true);
    const timerValue = `${seconds.toFixed(1)}s`;
    const timerTitle = [
        `Generation queued: ${start.format(dateFormat)}`,
        `Reply received: ${finish.format(dateFormat)}`,
        `Time to generate: ${seconds} seconds`,
        timeToFirstToken ? `Time to first token: ${timeToFirstToken / 1000} seconds` : '',
        reasoningDuration > 0 ? `Time to think: ${reasoningDuration / 1000} seconds` : '',
        tokenCount > 0 ? `Token rate: ${Number(tokenCount / seconds).toFixed(3)} t/s` : '',
    ].filter(x => x).join('\n').trim();

    if (isNaN(seconds) || seconds < 0) {
        return { timerValue: '', timerTitle };
    }

    return { timerValue, timerTitle };
}

let requestId = null;

/**
 * Scrolls the chat to the bottom if configured to do so.
 * @param {object} [options] Options
 * @param {boolean} [options.waitForFrame] If true, waits for the animation frame before scrolling
 */
export function scrollChatToBottom({ waitForFrame } = {}) {
    if (!power_user.auto_scroll_chat_to_bottom) {
        return;
    }

    const doScroll = () => {
        let position = chatElement[0].scrollHeight;

        if (power_user.waifuMode) {
            const lastMessage = chatElement.find('.mes').last();
            if (lastMessage.length) {
                const lastMessagePosition = lastMessage.position().top;
                position = chatElement.scrollTop() + lastMessagePosition;
            }
        }

        chatElement.scrollTop(position);
        requestId = null;
    };

    // Do not check truthiness. requestId can loop to zero.
    if (requestId !== null) {
        cancelAnimationFrame(requestId);
    }

    if (!waitForFrame) {
        doScroll();
        return;
    }

    // This prevents layout thrashing.
    // https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame#return_value
    // https://gist.github.com/paulirish/5d52fb081b3570c81e3a#file-what-forces-layout-md
    requestId = requestAnimationFrame(() => doScroll());
}

/**
 * Substitutes {{macro}} parameters in a string.
 * @param {string} content - The string to substitute parameters in.
 * @param {Record<string,any>} additionalMacro - Additional environment variables for substitution.
 * @param {(x: string) => string} [postProcessFn] - Post-processing function for each substituted macro.
 * @returns {string} The string with substituted parameters.
 */
export function substituteParamsExtended(content, additionalMacro = {}, postProcessFn = (x) => x) {
    return substituteParams(content, undefined, undefined, undefined, undefined, true, additionalMacro, postProcessFn);
}

/**
 * Substitutes {{macro}} parameters in a string.
 * @param {string} content - The string to substitute parameters in.
 * @param {string} [_name1] - The name of the user. Uses global name1 if not provided.
 * @param {string} [_name2] - The name of the character. Uses global name2 if not provided.
 * @param {string} [_original] - The original message for {{original}} substitution.
 * @param {string} [_group] - The group members list for {{group}} substitution.
 * @param {boolean} [_replaceCharacterCard] - Whether to replace character card macros.
 * @param {Record<string,any>} [additionalMacro] - Additional environment variables for substitution.
 * @param {(x: string) => string} [postProcessFn] - Post-processing function for each substituted macro.
 * @returns {string} The string with substituted parameters.
 */
export function substituteParams(content, _name1, _name2, _original, _group, _replaceCharacterCard = true, additionalMacro = {}, postProcessFn = (x) => x) {
    if (!content) {
        return '';
    }

    const environment = {};

    if (typeof _original === 'string') {
        let originalSubstituted = false;
        environment.original = () => {
            if (originalSubstituted) {
                return '';
            }

            originalSubstituted = true;
            return _original;
        };
    }

    const getGroupValue = (includeMuted) => {
        if (typeof _group === 'string') {
            return _group;
        }

        if (selected_group) {
            const members = groups.find(x => x.id === selected_group)?.members;
            /** @type {string[]} */
            const disabledMembers = groups.find(x => x.id === selected_group)?.disabled_members ?? [];
            const isMuted = x => includeMuted ? true : !disabledMembers.includes(x);
            const names = Array.isArray(members)
                ? members.filter(isMuted).map(m => characters.find(c => c.avatar === m)?.name).filter(Boolean).join(', ')
                : '';
            return names;
        } else {
            return _name2 ?? name2;
        }
    };

    const getNotCharValue = () => {
        const currentUser = _name1 ?? name1;
        const currentSpeaker = _name2 ?? name2;

        // Single character chat
        if (!selected_group) {
            return currentUser;
        }

        // Group chat
        const members = groups.find(x => x.id === selected_group)?.members;

        if (!Array.isArray(members)) {
            return currentUser;
        }

        const memberNames = members
            .map(m => characters.find(c => c.avatar === m)?.name)
            .filter(Boolean); // Filter out any null/undefined names

        // Filter out the current speaker and add the user
        const otherMembers = memberNames.filter(name => name !== currentSpeaker);
        otherMembers.push(currentUser);

        return otherMembers.join(', ');
    };

    if (_replaceCharacterCard) {
        const fields = getCharacterCardFields();
        environment.charPrompt = fields.system || '';
        environment.charInstruction = environment.charJailbreak = fields.jailbreak || '';
        environment.description = fields.description || '';
        environment.personality = fields.personality || '';
        environment.scenario = fields.scenario || '';
        environment.persona = fields.persona || '';
        environment.mesExamples = () => parseMesExamples(fields.mesExamples).join('');
        environment.mesExamplesRaw = fields.mesExamples || '';
        environment.charVersion = fields.version || '';
        environment.char_version = fields.version || '';
        environment.charDepthPrompt = fields.charDepthPrompt || '';
        environment.creatorNotes = fields.creatorNotes || '';
    }

    // Must be substituted last so that they're replaced inside {{description}}
    environment.user = _name1 ?? name1;
    environment.char = _name2 ?? name2;
    environment.group = environment.charIfNotGroup = getGroupValue(true);
    environment.groupNotMuted = getGroupValue(false);
    environment.notChar = getNotCharValue();
    environment.model = getGeneratingModel();

    if (additionalMacro && typeof additionalMacro === 'object') {
        Object.assign(environment, additionalMacro);
    }

    return evaluateMacros(content, environment, postProcessFn);
}

export function getServerMacroSnapshot() {
    const macroNames = new Set([
        'user',
        'char',
        'group',
        'charIfNotGroup',
        'groupNotMuted',
        'notChar',
        'model',
        'description',
        'personality',
        'scenario',
        'persona',
        'mesExamples',
        'mesExamplesRaw',
        'charVersion',
        'char_version',
        'charDepthPrompt',
        'creatorNotes',
        'charPrompt',
        'charInstruction',
        'charJailbreak',
        'input',
        'maxPrompt',
        'lastMessage',
        'lastMessageId',
        'lastUserMessage',
        'lastCharMessage',
        'firstIncludedMessageId',
        'firstDisplayedMessageId',
        'lastSwipeId',
        'currentSwipeId',
        'time',
        'date',
        'weekday',
        'isotime',
        'isodate',
        'idle_duration',
        'isMobile',
        'lastGenerationType',
    ]);
    const registeredMacroNames = new Set();

    for (const { key } of MacrosParser) {
        for (const alias of String(key || '').split('|').map(x => x.trim()).filter(Boolean)) {
            macroNames.add(alias);
            registeredMacroNames.add(alias);
        }
    }

    const values = {};
    const registeredValues = {};
    for (const macroName of macroNames) {
        const marker = `{{${macroName}}}`;
        const resolved = substituteParams(marker);
        if (resolved !== marker) {
            if (registeredMacroNames.has(macroName)) {
                registeredValues[macroName] = resolved;
            } else {
                values[macroName] = resolved;
            }
        }
    }

    return {
        values,
        registeredValues,
        localVariables: structuredClone(chat_metadata.variables || {}),
        globalVariables: structuredClone(extension_settings.variables.global || {}),
        chatId: chat_metadata['main_chat'] ?? getCurrentChatId() ?? '',
        now: new Date().toISOString(),
    };
}


/**
 * Gets stopping sequences for the prompt.
 * @param {boolean} isImpersonate A request is made to impersonate a user
 * @param {boolean} isContinue A request is made to continue the message
 * @returns {string[]} Array of stopping strings
 */
export function getStoppingStrings(isImpersonate, isContinue) {
    const result = [];

    const charString = `\n${name2}:`;
    const userString = `\n${name1}:`;
    result.push(isImpersonate ? charString : userString);

    result.push(userString);

    if (isContinue && Array.isArray(chat) && chat[chat.length - 1]?.is_user) {
        result.push(charString);
    }

    // Add group members as stopping strings if generating for a specific group member or user. (Allow slash commands to work around name stopping string restrictions)
    if (selected_group && (name2 || isImpersonate)) {
        const group = groups.find(x => x.id === selected_group);

        if (group && Array.isArray(group.members)) {
            const names = group.members
                    .map(x => characters.find(y => y.avatar == x))
                    .filter(x => x && x.name && x.name !== name2)
                    .map(x => `\n${x.name}:`);
            result.push(...names);
        }
    }

    result.push(...getCustomStoppingStrings());

    if (power_user.single_line) {
        result.unshift('\n');
    }

    return result.filter(x => x).filter(onlyUnique);
}

/**
 * Background generation based on the provided prompt.
 * @typedef {object} GenerateQuietPromptParams
 * @prop {string} [quietPrompt] Instruction prompt for the AI
 * @prop {boolean} [quietToLoud] Whether the message should be sent in a foreground (loud) or background (quiet) mode
 * @prop {boolean} [skipWIAN] Deprecated. Ignored by chat-completions generation.
 * @prop {string} [quietImage] Image to use for the quiet prompt
 * @prop {string} [quietName] Name to use for the quiet prompt (defaults to "System:")
 * @prop {number} [responseLength] Maximum response length. If unset, the global default value is used.
 * @prop {number} [forceChId] Character ID to use for this generation run. Works in groups only.
 * @prop {object} [jsonSchema] JSON schema to use for the structured generation. Usually requires a special instruction.
 * @prop {boolean} [removeReasoning] Parses and removes the reasoning block according to reasoning format preferences
 * @prop {boolean} [trimToSentence] Whether to trim the response to the last complete sentence
 * @param {GenerateQuietPromptParams} params Parameters for the quiet prompt generation
 * @returns {Promise<string>} Generated text. If using structured output, will contain a serialized JSON object.
 */
export async function generateQuietPrompt({ quietPrompt = '', quietToLoud = false, skipWIAN = false, quietImage = null, quietName = null, responseLength = null, forceChId = null, jsonSchema = null, removeReasoning = true, trimToSentence = false } = {}) {
    if (arguments.length > 0 && typeof arguments[0] !== 'object') {
        console.trace('generateQuietPrompt called with positional arguments. Please use an object instead.');
        [quietPrompt, quietToLoud, skipWIAN, quietImage, quietName, responseLength, forceChId, jsonSchema] = arguments;
    }

    const responseLengthCustomized = typeof responseLength === 'number' && responseLength > 0;
    let responseLengthSession = null;
    let eventHook = () => { };
    try {
        /** @type {GenerateOptions} */
        const generateOptions = {
            quiet_prompt: quietPrompt ?? '',
            quietToLoud: quietToLoud ?? false,
            skipWIAN: skipWIAN ?? false,
            force_name2: true,
            quietImage: quietImage ?? null,
            quietName: quietName ?? null,
            force_chid: forceChId ?? null,
            jsonSchema: jsonSchema ?? null,
        };
        if (responseLengthCustomized) {
            responseLengthSession = TempResponseLength.save(main_api, responseLength);
            eventHook = TempResponseLength.setupEventHook(responseLengthSession);
        }
        let result = await Generate('quiet', generateOptions);
        result = trimToSentence ? trimToEndSentence(result) : result;
        result = removeReasoning ? removeReasoningFromString(result) : result;
        return result;
    } finally {
        if (responseLengthSession) {
            if (TempResponseLength.isCustomized(responseLengthSession)) {
                TempResponseLength.restore(responseLengthSession);
            }
            TempResponseLength.removeEventHook(responseLengthSession, eventHook);
        }
    }
}

/**
 * Executes slash commands and returns the new text and whether the generation was interrupted.
 * @param {string} message Text to be sent
 * @returns {Promise<boolean>} Whether the message sending was interrupted
 */
export async function processCommands(message) {
    if (!message || !message.trim().startsWith('/')) {
        return false;
    }
    await executeSlashCommandsOnChatInput(message, {
        clearChatInput: true,
    });
    return true;
}

/**
 * Extracts the contents of bias macros from a message.
 * @param {string} message Message text
 * @returns {string} Message bias extracted from the message (or an empty string if not found)
 */
export function extractMessageBias(message) {
    if (!message) {
        return '';
    }

    try {
        const biasHandlebars = Handlebars.create();
        const biasMatches = [];
        biasHandlebars.registerHelper('bias', function (text) {
            biasMatches.push(text);
            return '';
        });
        const template = biasHandlebars.compile(message);
        template({});

        if (biasMatches && biasMatches.length > 0) {
            return ` ${biasMatches.join(' ')}`;
        }

        return '';
    } catch {
        return '';
    }
}

/**
 * Removes impersonated group member lines from the group member messages.
 * Doesn't do anything if group reply trimming is disabled.
 * @param {string} getMessage Group message
 * @returns Cleaned-up group message
 */
function cleanGroupMessage(getMessage) {
    if (power_user.disable_group_trimming) {
        return getMessage;
    }

    const group = groups.find((x) => x.id == selected_group);

    if (group && Array.isArray(group.members) && group.members) {
        for (let member of group.members) {
            const character = characters.find(x => x.avatar == member);

            if (!character) {
                continue;
            }

            const name = character.name;

            // Skip current speaker.
            if (name === name2) {
                continue;
            }

            const regex = new RegExp(`(^|\n)${escapeRegex(name)}:`);
            const nameMatch = getMessage.match(regex);
            if (nameMatch) {
                getMessage = getMessage.substring(0, nameMatch.index);
            }
        }
    }
    return getMessage;
}

function addPersonaDescriptionExtensionPrompt() {
    const INJECT_TAG = 'PERSONA_DESCRIPTION';
    setExtensionPrompt(INJECT_TAG, '', extension_prompt_types.IN_PROMPT, 0);

    if (!power_user.persona_description || power_user.persona_description_position === persona_description_positions.NONE) {
        return;
    }

    const promptPositions = [persona_description_positions.BOTTOM_AN, persona_description_positions.TOP_AN];

    if (promptPositions.includes(power_user.persona_description_position) && shouldWIAddPrompt) {
        const originalAN = extension_prompts[NOTE_MODULE_NAME].value;
        const ANWithDesc = power_user.persona_description_position === persona_description_positions.TOP_AN
            ? `${power_user.persona_description}\n${originalAN}`
            : `${originalAN}\n${power_user.persona_description}`;

        setExtensionPrompt(NOTE_MODULE_NAME, ANWithDesc, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth], extension_settings.note.allowWIScan, chat_metadata[metadata_keys.role]);
    }

    if (power_user.persona_description_position === persona_description_positions.AT_DEPTH) {
        setExtensionPrompt(INJECT_TAG, power_user.persona_description, extension_prompt_types.IN_CHAT, power_user.persona_description_depth, true, power_user.persona_description_role);
    }
}

async function shouldIncludeExtensionPrompt(prompt) {
    if (!prompt) {
        return false;
    }

    if (typeof prompt.filter === 'boolean') {
        return prompt.filter;
    }

    if (typeof prompt.filter === 'function') {
        return Boolean(await prompt.filter());
    }

    return true;
}

/**
 * Returns a filtered extension prompt snapshot for server-side prompt assembly.
 * @param {Record<string, any>} [source] Source prompt registry
 * @returns {Promise<Record<string, {value: string, resolvedValue: string, position: number, depth: number, scan: boolean, role: number}>>}
 */
export async function getExtensionPromptSnapshot(source = extension_prompts) {
    const snapshot = {};

    for (const key of Object.keys(source || {}).sort()) {
        const prompt = source[key];

        if (!await shouldIncludeExtensionPrompt(prompt)) {
            continue;
        }

        const value = String(prompt.value ?? '');
        snapshot[key] = {
            value,
            resolvedValue: substituteParams(value),
            position: prompt.position === undefined ? undefined : Number(prompt.position),
            depth: prompt.depth === undefined ? undefined : Number(prompt.depth),
            scan: !!prompt.scan,
            role: Number(prompt.role ?? extension_prompt_roles.SYSTEM),
        };
    }

    return snapshot;
}

/**
 * Returns a filtered prompt-state payload for server-side chat-completion assembly.
 * This is narrower than the client extension registry shape and only includes
 * prompt data relevant to built-in generation behavior.
 * @param {Record<string, any>} [source] Source prompt registry
 * @returns {Promise<{ modules: Record<string, any>, prompts: any[] }>}
 */
export async function getServerPromptState(source = extension_prompts) {
    const moduleKeyMap = {
        '1_memory': 'summary',
        '2_floating_prompt': 'authorsNote',
        '3_vectors': 'vectorsMemory',
        '4_vectors_data_bank': 'vectorsDataBank',
        'chromadb': 'smartContext',
    };

    const promptState = {
        modules: {},
        prompts: [],
    };

    for (const key of Object.keys(source || {}).sort()) {
        const prompt = source[key];

        if (!await shouldIncludeExtensionPrompt(prompt)) {
            continue;
        }

        const entry = {
            key,
            value: String(prompt?.value ?? ''),
            position: prompt?.position === undefined ? undefined : Number(prompt.position),
            depth: prompt?.depth === undefined ? undefined : Number(prompt.depth),
            scan: Boolean(prompt?.scan),
            role: Number(prompt?.role ?? extension_prompt_roles.SYSTEM),
        };

        const moduleKey = moduleKeyMap[key];
        if (moduleKey) {
            promptState.modules[moduleKey] = entry;
            continue;
        }

        if (entry.scan || entry.position !== undefined) {
            promptState.prompts.push(entry);
        }
    }

    return promptState;
}

/**
 * Returns all extension prompts combined.
 * @returns {Promise<string>} Combined extension prompts
 */
async function getAllExtensionPrompts() {
    const snapshot = await getExtensionPromptSnapshot();
    const values = Object.values(snapshot)
        .map(prompt => prompt.value.trim())
        .filter(Boolean);

    return substituteParams(values.join('\n'));
}

/**
 * Gets the maximum depth of extension prompts.
 * @returns {number} Maximum depth of extension prompts
 */
export function getExtensionPromptMaxDepth() {
    return MAX_INJECTION_DEPTH;
    /*
    const prompts = Object.values(extension_prompts);
    const maxDepth = Math.max(...prompts.map(x => x.depth ?? 0));
    // Clamp to 1 <= depth <= MAX_INJECTION_DEPTH
    return Math.max(Math.min(maxDepth, MAX_INJECTION_DEPTH), 1);
    */
}

/**
 * Returns the extension prompt for the given position, depth, and role.
 * If multiple prompts are found, they are joined with a separator.
 * @param {number} [position] Position of the prompt
 * @param {number} [depth] Depth of the prompt
 * @param {string} [separator] Separator for joining multiple prompts
 * @param {number} [role] Role of the prompt
 * @param {boolean} [wrap] Wrap start and end with a separator
 * @returns {Promise<string>} Extension prompt
 */
export async function getExtensionPrompt(position = extension_prompt_types.IN_PROMPT, depth = undefined, separator = '\n', role = undefined, wrap = true) {
    const snapshot = await getExtensionPromptSnapshot();
    const prompts = Object.keys(snapshot)
        .sort()
        .map((key) => snapshot[key])
        .filter(prompt => prompt.position == position && prompt.value)
        .filter(prompt => depth === undefined || prompt.depth === undefined || prompt.depth === depth)
        .filter(prompt => role === undefined || prompt.role === undefined || prompt.role === role);

    let values = prompts.map(x => x.value.trim()).join(separator);
    if (wrap && values.length && !values.startsWith(separator)) {
        values = separator + values;
    }
    if (wrap && values.length && !values.endsWith(separator)) {
        values = values + separator;
    }
    if (values.length) {
        values = substituteParams(values);
    }
    return values;
}

export function baseChatReplace(value, name1, name2) {
    if (value !== undefined && value.length > 0) {
        const _ = undefined;
        value = substituteParams(value, name1, name2, _, _, false);

        if (power_user.collapse_newlines) {
            value = collapseNewlines(value);
        }

        value = value.replace(/\r/g, '');
    }
    return value;
}

/**
 * Returns the character card fields for the current character.
 * @param {object} [options]
 * @param {number} [options.chid] Optional character index
 *
 * @typedef {object} CharacterCardFields
 * @property {string} system System prompt
 * @property {string} mesExamples Message examples
 * @property {string} description Description
 * @property {string} personality Personality
 * @property {string} persona Persona
 * @property {string} scenario Scenario
 * @property {string} jailbreak Jailbreak instructions
 * @property {string} version Character version
 * @property {string} charDepthPrompt Character depth note
 * @property {string} creatorNotes Character creator notes
 * @returns {CharacterCardFields} Character card fields
 */
export function getCharacterCardFields({ chid = null } = {}) {
    const currentChid = chid ?? this_chid;

    const result = {
        system: '',
        mesExamples: '',
        description: '',
        personality: '',
        persona: '',
        scenario: '',
        jailbreak: '',
        version: '',
        charDepthPrompt: '',
        creatorNotes: '',
    };
    result.persona = baseChatReplace(power_user.persona_description?.trim(), name1, name2);

    const character = characters[currentChid];

    if (!character) {
        return result;
    }

    const hasChatScenarioOverride = Object.prototype.hasOwnProperty.call(chat_metadata, 'scenario');
    const hasChatExamplesOverride = Object.prototype.hasOwnProperty.call(chat_metadata, 'mes_example');
    const hasChatSystemPromptOverride = Object.prototype.hasOwnProperty.call(chat_metadata, 'system_prompt');
    const scenarioText = hasChatScenarioOverride ? String(chat_metadata['scenario'] ?? '') : (character.scenario || '');
    const exampleDialog = hasChatExamplesOverride ? String(chat_metadata['mes_example'] ?? '') : (character.mes_example || '');
    const systemPrompt = hasChatSystemPromptOverride ? String(chat_metadata['system_prompt'] ?? '') : (character.data?.system_prompt || '');

    result.description = baseChatReplace(character.description?.trim(), name1, name2);
    result.personality = baseChatReplace(character.personality?.trim(), name1, name2);
    result.scenario = baseChatReplace(scenarioText.trim(), name1, name2);
    result.mesExamples = baseChatReplace(exampleDialog.trim(), name1, name2);
    result.system = power_user.prefer_character_prompt ? baseChatReplace(systemPrompt.trim(), name1, name2) : '';
    result.jailbreak = power_user.prefer_character_jailbreak ? baseChatReplace(character.data?.post_history_instructions?.trim(), name1, name2) : '';
    result.version = character.data?.character_version ?? '';
    result.charDepthPrompt = baseChatReplace(character.data?.extensions?.depth_prompt?.prompt?.trim(), name1, name2);
    result.creatorNotes = baseChatReplace(character.data?.creator_notes?.trim(), name1, name2);

    if (selected_group) {
        const groupCards = getGroupCharacterCards(selected_group, Number(currentChid));

        if (groupCards) {
            result.description = groupCards.description;
            result.personality = groupCards.personality;
            result.scenario = groupCards.scenario;
            result.mesExamples = groupCards.mesExamples;
        }
    }

    return result;
}

/**
 * Parses an examples string.
 * @param {string} examplesStr
 * @returns {string[]} Examples array with block heading
 */
export function parseMesExamples(examplesStr) {
    if (!examplesStr || examplesStr.length === 0 || examplesStr === '<START>') {
        return [];
    }

    if (!examplesStr.startsWith('<START>')) {
        examplesStr = '<START>\n' + examplesStr.trim();
    }

    const blockHeading = '<START>\n';
    const splitExamples = examplesStr.split(/<START>/gi).slice(1).map(block => `${blockHeading}${block.trim()}\n`);

    return splitExamples;
}

export function isStreamingEnabled() {
    return (
        main_api === 'openai' &&
        oai_settings.stream_openai &&
        !(oai_settings.chat_completion_source == chat_completion_sources.OPENAI && ['o1-2024-12-17', 'o1'].includes(oai_settings.openai_model))
    );
}

function showStopButton() {
    $('#mes_stop').css({ 'display': 'flex' });
}

function hideStopButton() {
    // prevent NOOP, because hideStopButton() gets called multiple times
    if ($('#mes_stop').css('display') !== 'none') {
        $('#mes_stop').css({ 'display': 'none' });
        eventSource.emit(event_types.GENERATION_ENDED, chat.length);
    }
}

class StreamingProcessor {
    /**
     * Creates a new streaming processor.
     * @param {string} type Generation type
     * @param {boolean} forceName2 If true, force the use of name2
     * @param {Date} timeStarted Date when generation was started
     * @param {string} continueMessage Previous message if the type is 'continue'
     * @param {PromptReasoning} promptReasoning Prompt reasoning instance
     */
    constructor(type, forceName2, timeStarted, continueMessage, promptReasoning) {
        this.result = '';
        this.messageId = -1;
        /** @type {HTMLElement} */
        this.messageDom = null;
        /** @type {HTMLElement} */
        this.messageTextDom = null;
        /** @type {HTMLElement} */
        this.messageTimerDom = null;
        /** @type {HTMLElement} */
        this.messageTokenCounterDom = null;
        /** @type {HTMLTextAreaElement} */
        this.sendTextarea = document.querySelector('#send_textarea');
        this.type = type;
        this.force_name2 = forceName2;
        this.isStopped = false;
        this.isFinished = false;
        this.generator = this.nullStreamingGeneration;
        this.abortController = new AbortController();
        this.firstMessageText = '...';
        this.timeStarted = timeStarted;
        /** @type {number?} */
        this.timeToFirstToken = null;
        this.createdAt = new Date();
        this.continueMessage = type === 'continue' ? continueMessage : '';
        this.swipes = [];
        this.swipeReasoning = [];
        /** @type {import('./scripts/logprobs.js').TokenLogprobs[]} */
        this.messageLogprobs = [];
        this.toolCalls = [];
        // Initialize reasoning in its own handler
        this.reasoningHandler = new ReasoningHandler(timeStarted);
        /** @type {PromptReasoning} */
        this.promptReasoning = promptReasoning;
        /** @type {string[]} */
        this.images = [];
    }

    /**
     * Initializes DOM elements for the current message.
     * @param {number} messageId Current message ID
     * @param {boolean?} continueOnReasoning If continuing on reasoning
     */
    async #checkDomElements(messageId, continueOnReasoning = null) {
        if (this.messageDom === null || this.messageTextDom === null) {
            this.messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
            this.messageTextDom = this.messageDom?.querySelector('.mes_text');
            this.messageTimerDom = this.messageDom?.querySelector('.mes_timer');
            this.messageTokenCounterDom = this.messageDom?.querySelector('.tokenCounterDisplay');
        }
        if (continueOnReasoning) {
            await this.reasoningHandler.process(messageId, false, this.promptReasoning);
        }
        this.reasoningHandler.updateDom(messageId);
    }

    #updateMessageBlockVisibility() {
        if (this.messageDom instanceof HTMLElement && Array.isArray(this.toolCalls) && this.toolCalls.length > 0) {
            const shouldHide = ['', '...'].includes(this.result) && !this.reasoningHandler.reasoning;
            this.messageDom.classList.toggle('displayNone', shouldHide);
        }
    }

    markUIGenStarted() {
        deactivateSendButtons();
    }

    markUIGenStopped() {
        activateSendButtons();
    }

    async onStartStreaming(text) {
        const continueOnReasoning = !!(this.type === 'continue' && this.promptReasoning.prefixReasoning);
        if (continueOnReasoning) {
            this.reasoningHandler.initContinue(this.promptReasoning);
        }

        let messageId = -1;

        if (this.type == 'impersonate') {
            this.sendTextarea.value = '';
            this.sendTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            await saveReply({ type: this.type, getMessage: text, fromStreaming: true });
            messageId = chat.length - 1;
            await this.#checkDomElements(messageId, continueOnReasoning);
            this.markUIGenStarted();
        }
        hideSwipeButtons({ hideCounters: true });
        scrollChatToBottom({ waitForFrame: true });
        return messageId;
    }

    async onProgressStreaming(messageId, text, isFinal) {
        const isImpersonate = this.type == 'impersonate';
        const isContinue = this.type == 'continue';

        if (!isImpersonate && !isContinue && Array.isArray(this.swipes) && this.swipes.length > 0) {
            for (let i = 0; i < this.swipes.length; i++) {
                this.swipes[i] = cleanUpMessage({
                    getMessage: this.swipes[i],
                    isImpersonate: false,
                    isContinue: false,
                    displayIncompleteSentences: true,
                    stoppingStrings: this.stoppingStrings,
                });
            }
        }

        let processedText = cleanUpMessage({
            getMessage: text,
            isImpersonate: isImpersonate,
            isContinue: isContinue,
            displayIncompleteSentences: !isFinal,
            stoppingStrings: this.stoppingStrings,
        });

        const charsToBalance = ['*', '"', '```', '~~~'];
        for (const char of charsToBalance) {
            if (!isFinal && isOdd(countOccurrences(processedText, char))) {
                const separator = char.length > 1 ? '\n' : '';
                processedText = processedText.trimEnd() + separator + char;
            }
        }

        if (isImpersonate) {
            this.sendTextarea.value = processedText;
            this.sendTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            const mesChanged = chat[messageId]['mes'] !== processedText;
            await this.#checkDomElements(messageId);
            this.#updateMessageBlockVisibility();
            const currentTime = new Date();
            chat[messageId]['mes'] = processedText;
            chat[messageId]['gen_started'] = this.timeStarted;
            chat[messageId]['gen_finished'] = currentTime;
            if (!chat[messageId]['extra']) {
                chat[messageId]['extra'] = {};
            }
            chat[messageId]['extra']['time_to_first_token'] = this.timeToFirstToken;

            // Update reasoning
            await this.reasoningHandler.process(messageId, mesChanged, this.promptReasoning);
            processedText = chat[messageId]['mes'];

            // Token count update.
            const tokenCountText = this.reasoningHandler.reasoning + processedText;
            const currentTokenCount = isFinal && power_user.message_token_count_enabled ? await getTokenCountAsync(tokenCountText, 0) : 0;
            if (currentTokenCount) {
                chat[messageId]['extra']['token_count'] = currentTokenCount;
                if (this.messageTokenCounterDom instanceof HTMLElement) {
                    this.messageTokenCounterDom.textContent = `${currentTokenCount}t`;
                }
            }

            if ((this.type == 'swipe' || this.type === 'continue') && Array.isArray(chat[messageId]['swipes'])) {
                chat[messageId]['swipes'][chat[messageId]['swipe_id']] = processedText;
                chat[messageId]['swipe_info'][chat[messageId]['swipe_id']] = {
                    'send_date': chat[messageId]['send_date'],
                    'gen_started': chat[messageId]['gen_started'],
                    'gen_finished': chat[messageId]['gen_finished'],
                    'extra': structuredClone(chat[messageId]['extra']),
                };
            }

            const formattedText = messageFormatting(
                processedText,
                chat[messageId].name,
                chat[messageId].is_system,
                chat[messageId].is_user,
                messageId,
                {},
                false,
            );
            if (this.messageTextDom instanceof HTMLElement) {
                if (power_user.stream_fade_in) {
                    applyStreamFadeIn(this.messageTextDom, formattedText);
                } else {
                    this.messageTextDom.innerHTML = formattedText;
                }
            }

            const timePassed = formatGenerationTimer(this.timeStarted, currentTime, currentTokenCount, this.reasoningHandler.getDuration(), this.timeToFirstToken);
            if (this.messageTimerDom instanceof HTMLElement) {
                this.messageTimerDom.textContent = timePassed.timerValue;
                this.messageTimerDom.title = timePassed.timerTitle;
            }

            this.setFirstSwipe(messageId);
        }

        if (!scrollLock) {
            scrollChatToBottom({ waitForFrame: true });
        }
    }

    async onFinishStreaming(messageId, text) {
        this.markUIGenStopped();
        await this.onProgressStreaming(messageId, text, true);
        addCopyToCodeBlocks(chatElement.find(`.mes[mesid="${messageId}"]`));

        await this.reasoningHandler.finish(messageId);

        const {
            timedWorldInfo,
            promptInspectionResponseData,
            worldInfoResponseData,
        } = consumeOpenAIResponseData(this.generator?.openAIRequestId ?? null);
        applyTimedWorldInfoToMessage(messageId, timedWorldInfo);
        applyPromptInspectionResponseDataToMessage(messageId, promptInspectionResponseData, { allowFallbackPromptSnapshotKey: true });
        applyWorldInfoResponseDataToMessage(messageId, worldInfoResponseData);

        if (Array.isArray(this.swipes) && this.swipes.length > 0) {
            const message = chat[messageId];
            const swipeInfoExtra = structuredClone(message.extra ?? {});
            delete swipeInfoExtra.token_count;
            delete swipeInfoExtra.reasoning;
            delete swipeInfoExtra.reasoning_duration;
            const swipeInfo = {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: swipeInfoExtra,
            };
            const startingSwipeIndex = Array.isArray(message.swipes) ? message.swipes.length : 0;
            const basePromptSnapshotKey = typeof message.extra?.promptSnapshotKey === 'string' ? message.extra.promptSnapshotKey : null;
            const swipeInfoArray = Array(this.swipes.length).fill().map((_, index) => {
                const swipeInfoClone = structuredClone(swipeInfo);
                const swipePromptSnapshotKey = basePromptSnapshotKey
                    ? rekeyPromptSnapshotKey(basePromptSnapshotKey, { mesId: messageId, swipeId: startingSwipeIndex + index })
                    : null;
                if (swipePromptSnapshotKey) {
                    swipeInfoClone.extra.promptSnapshotKey = swipePromptSnapshotKey;
                }
                return swipeInfoClone;
            });
            parseReasoningInSwipes(this.swipes, swipeInfoArray, message.extra?.reasoning_duration);
            applyReasoningToSwipeInfoArray(this.swipeReasoning, swipeInfoArray, message.extra?.reasoning_duration);
            chat[messageId].swipes.push(...this.swipes);
            chat[messageId].swipe_info.push(...swipeInfoArray);
        }

        await commitLatestPromptInspectorRecord(messageId);

        if (Array.isArray(this.images) && this.images.length > 0) {
            await processImageAttachment(chat[messageId], { imageUrls: this.images });
            appendMediaToMessage(chat[messageId], $(this.messageDom));
        }

        if (this.type !== 'impersonate') {
            await eventSource.emit(event_types.MESSAGE_RECEIVED, this.messageId, this.type);
            await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, this.messageId, this.type);
        } else {
            await eventSource.emit(event_types.IMPERSONATE_READY, text);
        }

        syncMesToSwipe(messageId);
        saveLogprobsForActiveMessage(this.messageLogprobs.filter(Boolean), this.continueMessage);
        await saveChatConditional();
        unblockGeneration();

        const isAborted = this.abortController.signal.aborted;
        if (!isAborted && power_user.auto_swipe && generatedTextFiltered(text)) {
            return swipe_right();
        }

        playMessageSound();
    }

    onErrorStreaming() {
        this.abortController.abort();
        this.isStopped = true;

        this.markUIGenStopped();
        unblockGeneration();

        const noEmitTypes = ['swipe', 'impersonate', 'continue'];
        if (!noEmitTypes.includes(this.type)) {
            eventSource.emit(event_types.MESSAGE_RECEIVED, this.messageId, this.type);
            eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, this.messageId, this.type);
        }
    }

    setFirstSwipe(messageId) {
        if (this.type !== 'swipe' && this.type !== 'impersonate') {
            if (Array.isArray(chat[messageId]['swipes']) && chat[messageId]['swipes'].length === 1 && chat[messageId]['swipe_id'] === 0) {
                chat[messageId]['swipes'][0] = chat[messageId]['mes'];
                chat[messageId]['swipe_info'][0] = {
                    'send_date': chat[messageId]['send_date'],
                    'gen_started': chat[messageId]['gen_started'],
                    'gen_finished': chat[messageId]['gen_finished'],
                    'extra': structuredClone(chat[messageId]['extra']),
                };
            }
        }
    }

    onStopStreaming() {
        this.abortController.abort();
        this.isFinished = true;
    }

    /**
     * @returns {Generator<{ text: string, swipes: string[], logprobs: import('./scripts/logprobs.js').TokenLogprobs, toolCalls: any[], state: any }, void, void>}
     */
    *nullStreamingGeneration() {
        throw new Error('Generation function for streaming is not hooked up');
    }

    async generate() {
        if (this.messageId == -1) {
            this.messageId = await this.onStartStreaming(this.firstMessageText);
            await delay(1); // delay for message to be rendered
            scrollLock = false;
        }

        // Stopping strings are expensive to calculate, especially with macros enabled. To remove stopping strings
        // when streaming, we cache the result of getStoppingStrings instead of calling it once per token.
        const isImpersonate = this.type == 'impersonate';
        const isContinue = this.type == 'continue';
        this.stoppingStrings = getStoppingStrings(isImpersonate, isContinue);

        try {
            const sw = new Stopwatch(1000 / power_user.streaming_fps);
            const timestamps = [];
            for await (const { text, swipes, logprobs, toolCalls, state } of this.generator()) {
                const now = Date.now();
                timestamps.push(now);
                if (!this.timeToFirstToken) {
                    this.timeToFirstToken = now - this.createdAt.getTime();
                }
                if (this.isStopped || this.abortController.signal.aborted) {
                    return this.result;
                }

                this.toolCalls = toolCalls;
                this.result = text;
                this.swipes = Array.from(swipes ?? []);
                this.swipeReasoning = Array.from(state?.swipeReasoning ?? []);
                if (logprobs) {
                    this.messageLogprobs.push(...(Array.isArray(logprobs) ? logprobs : [logprobs]));
                }
                // Get the updated reasoning string into the handler
                this.reasoningHandler.updateReasoning(this.messageId, state?.reasoning);
                this.images = state?.images ?? [];
                await eventSource.emit(event_types.STREAM_TOKEN_RECEIVED, text);
                await sw.tick(async () => await this.onProgressStreaming(this.messageId, this.continueMessage + text));
            }
            const seconds = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
            console.warn(`Stream stats: ${timestamps.length} tokens, ${seconds.toFixed(2)} seconds, rate: ${Number(timestamps.length / seconds).toFixed(2)} TPS`);
        }
        catch (err) {
            // in the case of a self-inflicted abort, we have already cleaned up
            if (!this.isFinished) {
                console.error(err);
                this.onErrorStreaming();
            }
            return this.result;
        }

        this.isFinished = true;
        return this.result;
    }
}

/**
 * Constructs a prompt to be used for either Text Completion or Chat Completion. Input is format-agnostic.
 * @param {string | object[]} prompt Input prompt. Can be a string or an array of chat-style messages, i.e. [{role: '', content: ''}, ...]
 * @param {string} api API to use.
 * @param {boolean} quietToLoud true to generate a message in system mode, false to generate a message in character mode
 * @param {string} [systemPrompt] System prompt to use.
 * @param {string} [prefill] Prefill for the prompt.
 * @returns {string | object[]} Prompt ready for use in generation as an array of chat-style messages.
 */
export function createRawPrompt(prompt, api, quietToLoud, systemPrompt, prefill) {
    if (api !== 'openai') {
        throw new Error(`Unsupported API: ${api}`);
    }

    // If the prompt was given as a string, convert to a message-style object assuming user role
    if (typeof prompt === 'string') {
        const message = { role: 'user', content: prompt.trim() };
        prompt = [message];
    } else {  // checks for message-style object
        if (prompt.length === 0 && !systemPrompt) throw Error('No messages provided');
    }

    // Substitute the prefill if provided
    prefill = substituteParams(prefill ?? '');

    // Format each message in the prompt, accounting for the provided roles
    for (const message of prompt) {
        let name = '';
        if (message.role === 'user') name = message.name ?? name1;
        if (message.role === 'assistant') name = message.name ?? name2;
        if (message.role === 'system') name = message.name ?? '';
        const prefix = '';
        message.content = prefix + substituteParams(message.content ?? '');
    }

    // prepend system prompt, if provided
    if (systemPrompt) {
        systemPrompt = substituteParams(systemPrompt);
        prompt.unshift({ role: 'system', content: systemPrompt.trim() });
    }

    // with Chat Completion, the prefill is an additional assistant message at the end.
    if (api === 'openai' && prefill) {
        prompt.push({ role: 'assistant', content: prefill });
    }

    return prompt;
}

/**
 * Generates a message using the provided prompt.
 * @typedef {object} GenerateRawParams
 * @prop {string | object[]} [prompt] Prompt to generate a message from. Can be a string or an array of chat-style messages, i.e. [{role: '', content: ''}, ...]
 * @prop {string} [api] API to use. Main API is used if not specified.
 * @prop {boolean} [quietToLoud] true to generate a message in system mode, false to generate a message in character mode
 * @prop {string} [systemPrompt] System prompt to use.
 * @prop {number} [responseLength] Maximum response length. If unset, the global default value is used.
 * @prop {boolean} [trimNames] Whether to allow trimming "{{user}}:" and "{{char}}:" from the response.
 * @prop {string} [prefill] An optional prefill for the prompt.
 * @prop {object} [jsonSchema] JSON schema to use for the structured generation. Usually requires a special instruction.
 * @param {GenerateRawParams} params Parameters for generating a message
 * @returns {Promise<string>} Generated message
 */
export async function generateRaw({ prompt = '', api = null, quietToLoud = false, systemPrompt = '', responseLength = null, trimNames = true, prefill = '', jsonSchema = null } = {}) {
    if (arguments.length > 0 && typeof arguments[0] !== 'object') {
        console.trace('generateRaw called with positional arguments. Please use an object instead.');
        [prompt, api, quietToLoud, systemPrompt, responseLength, trimNames, prefill, jsonSchema] = arguments;
    }

    if (!api) {
        api = main_api;
    }

    const abortController = new AbortController();
    const responseLengthCustomized = typeof responseLength === 'number' && responseLength > 0;
    let responseLengthSession = null;
    let eventHook = () => { };

    // construct final prompt from the input. Can either be a string or an array of chat-style messages.
    prompt = createRawPrompt(prompt, api, quietToLoud, systemPrompt, prefill);

    // Allow extensions to stop generation before it happens
    const eventAbortController = new AbortController();
    const abortHook = () => eventAbortController.abort(new Error('Cancelled by extension'));
    eventSource.on(event_types.GENERATION_STOPPED, abortHook);

    try {
        if (responseLengthCustomized) {
            responseLengthSession = TempResponseLength.save(api, responseLength);
        }
        /** @type {object|any[]} */
        let generateData = {};

        // Allow extensions to modify the prompt before generation
        // 1. for text completion
        if (typeof prompt === 'string') {
            const eventData = { prompt: prompt, dryRun: false };
            await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, eventData);
            prompt = eventData.prompt;
        }
        // 2. for chat completion
        if (Array.isArray(prompt)) {
            const eventData = { chat: prompt, dryRun: false };
            await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, eventData);
            prompt = eventData.chat;
        }

        // Check if the generation was aborted during the event
        eventAbortController.signal.throwIfAborted();

        switch (api) {
            case 'openai': {
                generateData = prompt;
                if (responseLengthSession) {
                    eventHook = TempResponseLength.setupEventHook(responseLengthSession);
                }
            } break;
            default:
                throw new Error(`Unsupported API: ${api}`);
        }

        let data = {};

        if (api === 'openai') {
            data = await sendOpenAIRequest('quiet', generateData, abortController.signal, { jsonSchema });
        }

        // should only happen for text completions
        // other frontend paths do not return data if calling the backend fails,
        // they throw things instead
        if (data.error) {
            throw new Error(data.response);
        }

        if (jsonSchema) {
            return extractJsonFromData(data, { mainApi: api });
        }

        // format result, exclude user prompt bias
        const message = cleanUpMessage({
            getMessage: extractMessageFromData(data),
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences: true,
            includeUserPromptBias: false,
            trimNames: trimNames,
            trimWrongNames: trimNames,
        });

        if (!message) {
            throw new Error('No message generated');
        }

        return message;
    } finally {
        eventSource.removeListener(event_types.GENERATION_STOPPED, abortHook);
        if (responseLengthSession) {
            if (TempResponseLength.isCustomized(responseLengthSession)) {
                TempResponseLength.restore(responseLengthSession);
            }
            TempResponseLength.removeEventHook(responseLengthSession, eventHook);
        }
    }
}

class TempResponseLength {
    static #nextSessionId = 0;
    static #activeSessions = new Map();
    static #baseResponseLength = new Map();

    static #getSettingKey(api) {
        return api === 'openai' ? 'openai' : 'default';
    }

    static #getCurrentResponseLength(settingKey) {
        return settingKey === 'openai' ? oai_settings.openai_max_tokens : amount_gen;
    }

    static #setCurrentResponseLength(settingKey, responseLength) {
        if (settingKey === 'openai') {
            oai_settings.openai_max_tokens = responseLength;
        } else {
            amount_gen = responseLength;
        }
    }

    static #getActiveSessions(settingKey) {
        if (!this.#activeSessions.has(settingKey)) {
            this.#activeSessions.set(settingKey, []);
        }

        return this.#activeSessions.get(settingKey);
    }

    static isCustomized(session = null) {
        if (!session) {
            return Array.from(this.#activeSessions.values()).some(sessions => sessions.length > 0);
        }

        const sessions = this.#activeSessions.get(session.settingKey);
        return sessions?.some(activeSession => activeSession.id === session.id) ?? false;
    }

    /**
     * Save the current response length for the specified API.
     * @param {string} api API identifier
     * @param {number} responseLength New response length
     * @returns {{ id: number, api: string, settingKey: string, responseLength: number }} Saved response length session
     */
    static save(api, responseLength) {
        const settingKey = this.#getSettingKey(api);
        const sessions = this.#getActiveSessions(settingKey);
        if (sessions.length === 0) {
            this.#baseResponseLength.set(settingKey, this.#getCurrentResponseLength(settingKey));
        }

        const session = {
            id: ++this.#nextSessionId,
            api: api,
            settingKey: settingKey,
            responseLength: responseLength,
        };

        sessions.push(session);
        this.#setCurrentResponseLength(settingKey, responseLength);

        console.log('[TempResponseLength] Saved response length session:', session.id, 'base:', this.#baseResponseLength.get(settingKey), 'current:', responseLength);
        return session;
    }

    /**
     * Restore the original response length for the specified API.
     * @param {{ id: number, api: string, settingKey: string, responseLength: number }} session Response length session
     * @returns {void}
     */
    static restore(session) {
        if (!session) {
            return;
        }

        const sessions = this.#activeSessions.get(session.settingKey);
        if (!sessions?.length) {
            return;
        }

        const sessionIndex = sessions.findIndex(activeSession => activeSession.id === session.id);
        if (sessionIndex === -1) {
            return;
        }

        sessions.splice(sessionIndex, 1);

        const nextResponseLength = sessions.length > 0
            ? sessions[sessions.length - 1].responseLength
            : this.#baseResponseLength.get(session.settingKey);

        if (typeof nextResponseLength === 'number') {
            this.#setCurrentResponseLength(session.settingKey, nextResponseLength);
        }

        if (sessions.length === 0) {
            this.#activeSessions.delete(session.settingKey);
            this.#baseResponseLength.delete(session.settingKey);
        }

        console.log('[TempResponseLength] Restored response length session:', session.id, 'current:', nextResponseLength);
    }

    static restoreAll() {
        for (const [settingKey, sessions] of this.#activeSessions.entries()) {
            if (sessions.length === 0) {
                continue;
            }

            const baseResponseLength = this.#baseResponseLength.get(settingKey);
            if (typeof baseResponseLength === 'number') {
                this.#setCurrentResponseLength(settingKey, baseResponseLength);
            }
        }

        this.#activeSessions.clear();
        this.#baseResponseLength.clear();
    }

    /**
     * Sets up an event hook to restore the original response length when the event is emitted.
     * @param {{ id: number, api: string, settingKey: string, responseLength: number }} session Response length session
     * @returns {function(): void} Event hook function
     */
    static setupEventHook(session) {
        const eventHook = () => {
            if (this.isCustomized(session)) {
                this.restore(session);
            }
        };

        switch (session?.api) {
            case 'openai':
                eventSource.once(event_types.CHAT_COMPLETION_SETTINGS_READY, eventHook);
                break;
            default:
                eventSource.once(event_types.GENERATE_AFTER_DATA, eventHook);
                break;
        }

        return eventHook;
    }

    /**
     * Removes the event hook for the specified API.
     * @param {{ id: number, api: string, settingKey: string, responseLength: number }} session Response length session
     * @param {function(): void} eventHook Previously set up event hook
     */
    static removeEventHook(session, eventHook) {
        switch (session?.api) {
            case 'openai':
                eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, eventHook);
                break;
            default:
                eventSource.removeListener(event_types.GENERATE_AFTER_DATA, eventHook);
                break;
        }
    }
}

/**
 * Removes last message from the chat DOM.
 * @returns {Promise<void>} Resolves when the message is removed.
 */
function removeLastMessage() {
    return new Promise((resolve) => {
        const lastMes = chatElement.children('.mes').last();
        if (lastMes.length === 0) {
            return resolve();
        }
        lastMes.hide(animation_duration, function () {
            $(this).remove();
            resolve();
        });
    });
}

function refreshChatStateAfterSaveRollback() {
    syncSplitTailStateAfterMutation();
    syncVisibleChatRangeFromDom();
    updateHistoryControls();
    refreshSwipeButtons();
    refreshPromptInspectorButton();
    updateEditArrowClasses();
}

function rollbackUnsavedInsertedMessage(messageId, message) {
    if (!message || chat[messageId] !== message || messageId !== chat.length - 1) {
        console.warn('Could not roll back unsaved inserted message after failed save');
        return false;
    }

    chat.length = chat.length - 1;
    chatElement.children(`.mes[mesid="${messageId}"]`).remove();
    refreshChatStateAfterSaveRollback();
    return true;
}

function restoreUnsavedDeletedLastMessage(messageId, message) {
    if (!message || messageId !== chat.length) {
        console.warn('Could not restore deleted message after failed save');
        return false;
    }

    chat.push(message);
    addOneMessage(message, { forceId: messageId, scroll: false });
    restoreTimedWorldInfoFromChat(messageId);
    refreshChatStateAfterSaveRollback();
    return true;
}

/**
 * @typedef {object} JsonSchema
 * @property {string} name Name of the schema.
 * @property {object} value JSON schema value.
 * @property {string} [description] Description of the schema.
 * @property {boolean} [strict] If true, the schema will be used in strict mode, meaning that only the fields defined in the schema will be allowed.
 *
 * @typedef {object} GenerateOptions
 * @property {boolean} [automatic_trigger] If the generation was triggered automatically (e.g. group auto mode).
 * @property {boolean} [force_name2] If a char name should be forced to add to the prompt's last line (Text Completion, non-Instruct only).
 * @property {string} [quiet_prompt] A system instruction to use for the quiet prompt.
 * @property {boolean} [quietToLoud] Whether the system instruction should be sent in background (quiet) or a foreground (loud) mode.
 * @property {boolean} [skipWIAN] Deprecated. Ignored by chat-completions generation.
 * @property {number} [force_chid] Force character ID to use for the generation. Only works in groups.
 * @property {AbortSignal} [signal] Abort signal to cancel the generation. If not provided, will create a new AbortController.
 * @property {string} [quietImage] Image URL to use for the quiet prompt (defaults to empty string)
 * @property {string} [quietName] Name to use for the quiet prompt (defaults to "System:")
 * @property {number} [depth] Recursion depth for the generation. Used to prevent infinite loops in tool calls.
 * @property {JsonSchema} [jsonSchema] JSON schema to use for the structured generation. Usually requires a special instruction.
 */

/**
 * MARK:Generate()
 * Runs a generation using the current chat context.
 * @param {string} type Generation type
 * @param {GenerateOptions} options Generation options
 * @param {boolean} dryRun Whether to actually generate a message or just assemble the prompt
 * @returns {Promise<any>} Returns a promise that resolves when the text is done generating.
 */
export async function Generate(type, { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage, quietName, jsonSchema = null, depth = 0 } = {}, dryRun = false) {
    enforceChatCompletionsOnlyMode();
    console.log('Generate entered');
    setGenerationProgress(0);
    generation_started = new Date();

    // OpenAI prompt preview/dry-run is disabled so WI and prompt assembly stay server-side.
    if (main_api === 'openai' && dryRun) {
        return Promise.resolve();
    }

    const pendingSaveResult = await flushDebouncedChatSave();
    if (pendingSaveResult !== CHAT_SAVE_RESULT.SAVED) {
        is_send_press = false;
        return Promise.resolve();
    }

    // Prevent generation from shallow characters
    await unshallowCharacter(this_chid);

    // Occurs every time, even if the generation is aborted due to slash commands execution
    await eventSource.emit(event_types.GENERATION_STARTED, type, { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage }, dryRun);

    // Don't recreate abort controller if signal is passed
    if (!(abortController && signal)) {
        abortController = new AbortController();
    }

    const isImpersonate = type == 'impersonate';

    if (!(dryRun || type == 'regenerate' || type == 'swipe' || type == 'quiet')) {
        const interruptedByCommand = await processCommands(String($('#send_textarea').val()));

        if (interruptedByCommand) {
            //$("#send_textarea").val('')[0].dispatchEvent(new Event('input', { bubbles:true }));
            unblockGeneration(type);
            return Promise.resolve();
        }
    }

    // Occurs only if the generation is not aborted due to slash commands execution
    await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage }, dryRun);

    if (!dryRun) {
        // Ping server to make sure it is still alive
        const pingResult = await pingServer();

        if (!pingResult) {
            unblockGeneration(type);
            toastr.error(t`Verify that the server is running and accessible.`, t`ST Server cannot be reached`);
            throw new Error('Server unreachable');
        }

        // Hide swipes if not in a dry run.
        hideSwipeButtons();
        // If generated any message, set the flag to indicate it can't be recreated again.
        chat_metadata['tainted'] = true;
    }

    if (selected_group && !is_group_generating) {
        if (!dryRun) {
            // Returns the promise that generateGroupWrapper returns; resolves when generation is done
            return generateGroupWrapper(false, type, { quiet_prompt, force_chid, signal: abortController.signal, quietImage });
        }

        const characterIndexMap = new Map(characters.map((char, index) => [char.avatar, index]));
        const group = groups.find((x) => x.id === selected_group);

        const enabledMembers = group.members.reduce((acc, member) => {
            if (!group.disabled_members.includes(member) && !acc.includes(member)) {
                acc.push(member);
            }
            return acc;
        }, []);

        const memberIds = enabledMembers
            .map((member) => characterIndexMap.get(member))
            .filter((index) => index !== undefined && index !== null);

        if (memberIds.length > 0) {
            if (menu_type != 'character_edit') setCharacterId(memberIds[0]);
            setCharacterName('');
        } else {
            console.log('No enabled members found');
            unblockGeneration(type);
            return Promise.resolve();
        }
    }

    //#########QUIET PROMPT STUFF##############
    // This function gives special care to quiet prompts.
    if (quiet_prompt) {
        quiet_prompt = substituteParams(quiet_prompt);
        quiet_prompt = quiet_prompt;
    }

    const hasBackendConnection = online_status !== 'no_connection';

    // We can't do anything because we're not in a chat right now. (Unless it's a dry run, in which case we need to
    // assemble the prompt so we can count its tokens regardless of whether a chat is active.)
    if (!dryRun && !hasBackendConnection) {
        is_send_press = false;
        return Promise.resolve();
    }

    let textareaText;
    let generationStartMutatedChat = false;
    let generationStartDeletedId = null;
    let generationStartDeletedMessage = null;
    let continueTimerRollback = null;
    if (type !== 'regenerate' && type !== 'swipe' && type !== 'quiet' && !isImpersonate && !dryRun) {
        is_send_press = true;
        textareaText = String($('#send_textarea').val());
        $('#send_textarea').val('')[0].dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        textareaText = '';
        if (chat.length && chat[chat.length - 1]['is_user']) {
            //do nothing? why does this check exist?
        }
        else if (type !== 'quiet' && type !== 'swipe' && !isImpersonate && !dryRun && chat.length) {
            const deletedId = chat.length - 1;
            const deletedMessage = chat[deletedId];
            chat.length = chat.length - 1;
            syncSplitTailStateAfterMutation();
            restoreTimedWorldInfoFromChat();
            await removeLastMessage();
            generationStartMutatedChat = true;
            generationStartDeletedId = deletedId;
            generationStartDeletedMessage = deletedMessage;
        }
    }

    const isContinue = type == 'continue';

    // Rewrite the generation timer to account for the time passed for all the continuations.
    if (isContinue && chat.length) {
        const continuedMessage = chat[chat.length - 1];
        const prevFinished = continuedMessage['gen_finished'];
        const prevStarted = continuedMessage['gen_started'];

        if (prevFinished && prevStarted) {
            const timePassed = Number(prevFinished) - Number(prevStarted);
            generation_started = new Date(Date.now() - timePassed);
            continueTimerRollback = {
                message: continuedMessage,
                gen_started: continuedMessage['gen_started'],
            };
            continuedMessage['gen_started'] = generation_started;
        }
    }

    if (!dryRun) {
        deactivateSendButtons();
    }

    let { messageBias, promptBias, isUserPromptBias } = getBiasStrings(textareaText, type);

    //*********************************
    //PRE FORMATING STRING
    //*********************************

    // These generation types should not attach pending files to the chat
    const noAttachTypes = [
        'regenerate',
        'swipe',
        'impersonate',
        'quiet',
        'continue',
    ];
    //for normal messages sent from user..
    if ((textareaText != '' || (hasPendingFileAttachment() && !noAttachTypes.includes(type))) && !automatic_trigger && type !== 'quiet' && !dryRun) {
        // If user message contains no text other than bias - send as a system message
        if (messageBias && !removeMacros(textareaText)) {
            const insertedMessageId = chat.length;
            sendSystemMessage(system_message_types.GENERIC, ' ', { bias: messageBias });
            const insertedMessage = chat[insertedMessageId];
            const saveResult = await saveChatConditional();
            if (saveResult !== CHAT_SAVE_RESULT.SAVED) {
                rollbackUnsavedInsertedMessage(insertedMessageId, insertedMessage);
                unblockGeneration(type);
                return Promise.resolve();
            }
        }
        else {
            await sendMessageAsUser(textareaText, messageBias);
        }
    }
    else if (textareaText == '' && !automatic_trigger && !dryRun && type === undefined && main_api == 'openai' && oai_settings.send_if_empty.trim().length > 0) {
        // Use send_if_empty if set and the user message is empty. Only when sending messages normally
        await sendMessageAsUser(oai_settings.send_if_empty.trim(), messageBias);
    }

    if (generationStartMutatedChat) {
        const saveResult = await saveChatConditional();
        if (saveResult !== CHAT_SAVE_RESULT.SAVED) {
            if (continueTimerRollback?.message) {
                continueTimerRollback.message['gen_started'] = continueTimerRollback.gen_started;
            }
            restoreUnsavedDeletedLastMessage(generationStartDeletedId, generationStartDeletedMessage);
            unblockGeneration(type);
            return Promise.resolve();
        }
        await eventSource.emit(event_types.MESSAGE_DELETED, generationStartDeletedId, chat.length);
    }

    let {
        description,
        personality,
        persona,
        scenario,
        mesExamples,
        system,
        jailbreak,
        charDepthPrompt,
        creatorNotes,
    } = getCharacterCardFields();

    // Depth prompt (character-specific A/N)
    removeDepthPrompts();
    const groupDepthPrompts = getGroupDepthPrompts(selected_group, Number(this_chid));

    if (selected_group && Array.isArray(groupDepthPrompts) && groupDepthPrompts.length > 0) {
        groupDepthPrompts.forEach((value, index) => {
            const role = getExtensionPromptRoleByName(value.role);
            setExtensionPrompt(inject_ids.DEPTH_PROMPT_INDEX(index), value.text, extension_prompt_types.IN_CHAT, value.depth, extension_settings.note.allowWIScan, role);
        });
    } else {
        const depthPromptText = charDepthPrompt || '';
        const depthPromptDepth = characters[this_chid]?.data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default;
        const depthPromptRole = getExtensionPromptRoleByName(characters[this_chid]?.data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default);
        setExtensionPrompt(inject_ids.DEPTH_PROMPT, depthPromptText, extension_prompt_types.IN_CHAT, depthPromptDepth, extension_settings.note.allowWIScan, depthPromptRole);
    }

    const logicalChat = getLogicalChatForPromptAssembly();

    // First message in fresh 1-on-1 chat reacts to user/character settings changes
    if (logicalChat.length) {
        logicalChat[0].mes = substituteParams(logicalChat[0].mes);
    }

    // Collect messages with usable content
    const canUseTools = ToolManager.isToolCallingSupported();
    const canPerformToolCalls = !dryRun && ToolManager.canPerformToolCalls(type) && depth < ToolManager.RECURSE_LIMIT;
    let coreChat = logicalChat.filter(x => !isPromptHiddenChatMessage(x, { allowToolInvocations: canUseTools }));
    if (type === 'swipe') {
        coreChat.pop();
    }

    coreChat = await Promise.all(coreChat.map(async (/** @type {ChatMessage} */ chatItem, index) => {
        let message = chatItem.mes;
        let regexType = chatItem.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
        let options = { isPrompt: true, depth: (coreChat.length - index - (isContinue ? 2 : 1)) };

        let regexedMessage = getRegexedString(message, regexType, options);
        regexedMessage = await appendFileContent(chatItem, regexedMessage);

        const titles = [];
        if (chatItem?.extra?.append_title && chatItem?.extra?.title) {
            titles.push(chatItem.extra.title);
        }
        if (Array.isArray(chatItem?.extra?.media)) {
            for (const mediaItem of chatItem.extra.media) {
                if (mediaItem?.title && mediaItem?.append_title) {
                    titles.push(mediaItem.title);
                }
            }
        }
        if (titles.length > 0) {
            regexedMessage = `${regexedMessage}\n\n${titles.join('\n\n')}`;
        }

        return {
            ...chatItem,
            mes: regexedMessage,
            index,
        };
    }));

    const promptReasoning = new PromptReasoning();
    for (let i = coreChat.length - 1; i >= 0; i--) {
        const depth = coreChat.length - i - (isContinue ? 2 : 1);
        const isPrefix = isContinue && i === coreChat.length - 1;
        coreChat[i] = {
            ...coreChat[i],
            mes: promptReasoning.addToMessage(
                coreChat[i].mes,
                getRegexedString(
                    String(coreChat[i].extra?.reasoning ?? ''),
                    regex_placement.REASONING,
                    { isPrompt: true, depth: depth },
                ),
                isPrefix,
                coreChat[i].extra?.reasoning_duration,
            ),
        };
        if (promptReasoning.isLimitReached()) {
            break;
        }
    }

    // Determine token limit
    let this_max_context = getMaxContextSize();

    if (!dryRun) {
        console.debug('Running extension interceptors');
        const aborted = await runGenerationInterceptors(coreChat, this_max_context, type);

        if (aborted) {
            console.debug('Generation aborted by extension interceptors');
            unblockGeneration(type);
            return Promise.resolve();
        }
    } else {
        console.debug('Skipping extension interceptors for dry run');
    }

    // Fetches the combined prompt for both negative and positive prompts
    const cfgGuidanceScale = getGuidanceScale();
    const useCfgPrompt = cfgGuidanceScale && cfgGuidanceScale.value !== 1;

    // Adjust max context based on CFG prompt to prevent overfitting
    if (useCfgPrompt) {
        const negativePrompt = getCfgPrompt(cfgGuidanceScale, true, true)?.value || '';
        const positivePrompt = getCfgPrompt(cfgGuidanceScale, false, true)?.value || '';
        if (negativePrompt || positivePrompt) {
            const previousMaxContext = this_max_context;
            const [negativePromptTokenCount, positivePromptTokenCount] = await Promise.all([getTokenCountAsync(negativePrompt), getTokenCountAsync(positivePrompt)]);
            const decrement = Math.max(negativePromptTokenCount, positivePromptTokenCount);
            this_max_context -= decrement;
            console.log(`Max context reduced by ${decrement} tokens of CFG prompt (${previousMaxContext} -> ${this_max_context})`);
        }
    }

    console.log(`Core/all messages: ${coreChat.length}/${chat.length}`);

    if ((promptBias && !isUserPromptBias) || power_user.always_force_name2) {
        force_name2 = true;
    }

    if (isImpersonate) {
        force_name2 = false;
    }

    if (skipWIAN === true) {
        console.warn('[Generate] skipWIAN is deprecated and ignored. World Info is assembled server-side.');
    }
    if (main_api !== 'openai') {
        console.warn(`[Generate] World Info generation is deprecated for "${main_api}" and will only be assembled for chat-completions.`);
    }

    let mesExamplesArray = parseMesExamples(mesExamples);

    // Set non-WI AN
    setFloatingPrompt();

    const chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse();
    const preliminaryOaiMessages = main_api === 'openai' ? setOpenAIMessages(coreChat) : [];
    /** @type {import('./scripts/world-info.js').WIGlobalScanData} */
    const globalScanData = {
        personaDescription: persona,
        characterDescription: description,
        characterPersonality: personality,
        characterDepthPrompt: charDepthPrompt,
        scenario: scenario,
        creatorNotes: creatorNotes,
        trigger: GENERATION_TYPE_TRIGGERS.includes(type) ? type : 'normal',
    };
    let worldInfoString = '';
    let worldInfoBefore = '';
    let worldInfoAfter = '';

    // At this point, the raw message examples can be created
    const mesExamplesRawArray = [...mesExamplesArray];

    // Add persona description to prompt
    addPersonaDescriptionExtensionPrompt();

    // Legacy text-completion prompt assembly is disabled in chat-completions-only mode.
    if (main_api !== 'openai') {
        system = '';
    }

    // Collect before / after story string injections
    const beforeScenarioAnchor = await getExtensionPrompt(extension_prompt_types.BEFORE_PROMPT);
    const afterScenarioAnchor = await getExtensionPrompt(extension_prompt_types.IN_PROMPT);

    const storyStringParams = {
        description: description,
        personality: personality,
        persona: power_user.persona_description_position == persona_description_positions.IN_PROMPT ? persona : '',
        scenario: scenario,
        system: system,
        char: name2,
        user: name1,
        wiBefore: worldInfoBefore,
        wiAfter: worldInfoAfter,
        loreBefore: worldInfoBefore,
        loreAfter: worldInfoAfter,
        anchorBefore: beforeScenarioAnchor.trim(),
        anchorAfter: afterScenarioAnchor.trim(),
        mesExamples: mesExamplesArray.join(''),
        mesExamplesRaw: mesExamplesRawArray.join(''),
    };

    let combinedStoryString = '';
    setExtensionPrompt(inject_ids.STORY_STRING, '', extension_prompt_types.IN_CHAT, 0);

    // Story string rendered, safe to remove
    if (power_user.strip_examples) {
        mesExamplesArray = [];
    }

    // Inject all Depth prompts. Chat Completion does it separately
    let injectedIndices = [];
    let systemInjectedIndices = [];
    if (main_api !== 'openai') {
        const injectionData = await doChatInject(coreChat, isContinue);
        injectedIndices = injectionData.indices;
        systemInjectedIndices = injectionData.systemIndices;
    }

    let chat2 = [];
    let continue_mag = '';
    let userMessageIndices = [];
    const lastUserMessageIndex = coreChat.findLastIndex(x => x.is_user);

    for (let i = coreChat.length - 1, j = 0; i >= 0; i--, j++) {
        if (main_api == 'openai') {
            chat2[i] = coreChat[j].mes;
            if (i === 0 && isContinue) {
                chat2[i] = chat2[i].slice(0, chat2[i].lastIndexOf(coreChat[j].mes) + coreChat[j].mes.length);
                continue_mag = coreChat[j].mes;
            }
            continue;
        }

        chat2[i] = formatMessageHistoryItem(coreChat[j]);

        // Do not suffix the message for continuation
        if (i === 0 && isContinue) {
            // Pick something that's very unlikely to be in a message
            const FORMAT_TOKEN = '\u0000\ufffc\u0000\ufffd';

            chat2[i] = chat2[i].includes(FORMAT_TOKEN)
                ? chat2[i].slice(0, chat2[i].lastIndexOf(FORMAT_TOKEN))
                : chat2[i].slice(0, chat2[i].lastIndexOf(coreChat[j].mes) + coreChat[j].mes.length);
            continue_mag = coreChat[j].mes;
        }

        if (coreChat[j].is_user) {
            userMessageIndices.push(i);
        }
    }

    let oaiMessages = [];
    let oaiMessageExamples = [];

    if (main_api === 'openai') {
        oaiMessages = preliminaryOaiMessages;
        oaiMessageExamples = setOpenAIMessageExamples(mesExamplesArray);
    }

    // hack for regeneration of the first message
    if (chat2.length == 0) {
        chat2.push('');
    }

    let examplesString = '';
    let chatString = addChatsPreamble(addChatsSeparator(''));
    let cyclePrompt = '';
    const addUserAlignment = false;
    const userAlignmentMessage = '';

    async function getMessagesTokenCount() {
        const encodeString = [
            combinedStoryString,
            examplesString,
            userAlignmentMessage,
            chatString,
            modifyLastPromptLine(''),
            cyclePrompt,
        ].join('').replace(/\r/gm, '');
        return getTokenCountAsync(encodeString, power_user.token_padding);
    }

    // Force pinned examples into the context
    let pinExmString;
    if (power_user.pin_examples) {
        pinExmString = examplesString = mesExamplesArray.join('');
    }

    // Only add the chat in context if past the greeting message
    if (isContinue && (chat2.length > 1 || main_api === 'openai')) {
        cyclePrompt = chat2.shift();
        // Adjust indices to account for the shift
        injectedIndices = injectedIndices.map(shiftDownByOne).filter(x => x >= 0);
        systemInjectedIndices = systemInjectedIndices.map(shiftDownByOne).filter(x => x >= 0);
        userMessageIndices = userMessageIndices.map(shiftDownByOne).filter(x => x >= 0);
    }

    // Collect enough messages to fill the context
    let arrMes = new Array(chat2.length);
    let tokenCount = await getMessagesTokenCount();
    let lastAddedIndex = 0;

    // Pre-allocate all injections first.
    // If it doesn't fit - user shot himself in the foot
    for (const index of injectedIndices) {
        // not needed for OAI prompting
        if (main_api == 'openai') {
            break;
        }

        const item = chat2[index];

        if (typeof item !== 'string') {
            continue;
        }

        tokenCount += await getTokenCountAsync(item.replace(/\r/gm, ''));
        if (tokenCount < this_max_context) {
            chatString = chatString + item;
            arrMes[index] = item;
            lastAddedIndex = Math.max(lastAddedIndex, index);
        } else {
            break;
        }
    }

    for (let i = 0; i < chat2.length; i++) {
        // not needed for OAI prompting
        if (main_api == 'openai') {
            break;
        }

        // Skip already injected messages
        if (arrMes[i] !== undefined) {
            continue;
        }

        const item = chat2[i];

        if (typeof item !== 'string') {
            continue;
        }

        tokenCount += await getTokenCountAsync(item.replace(/\r/gm, ''));
        if (tokenCount < this_max_context) {
            chatString = chatString + item;
            arrMes[i] = item;
            lastAddedIndex = Math.max(lastAddedIndex, i);
        } else {
            break;
        }
    }

    // Add user alignment message if last message is not a user message
    const stoppedAtUser = userMessageIndices.includes(lastAddedIndex);
    if (addUserAlignment && !stoppedAtUser) {
        tokenCount += await getTokenCountAsync(userAlignmentMessage.replace(/\r/gm, ''));
        chatString = userAlignmentMessage + chatString;
        arrMes.push(userAlignmentMessage);
        injectedIndices.push(arrMes.length - 1);
    }

    // Unsparse the array. Adjust injected indices
    const newArrMes = [];
    const newInjectedIndices = [];
    const newSystemInjectedIndices = [];
    for (let i = 0; i < arrMes.length; i++) {
        if (arrMes[i] !== undefined) {
            newArrMes.push(arrMes[i]);
            if (injectedIndices.includes(i)) {
                newInjectedIndices.push(newArrMes.length - 1);
            }
            if (systemInjectedIndices.includes(i)) {
                newSystemInjectedIndices.push(newArrMes.length - 1);
            }
        }
    }

    arrMes = newArrMes;
    injectedIndices = newInjectedIndices;
    systemInjectedIndices = newSystemInjectedIndices;

    if (main_api !== 'openai') {
        setInContextMessages(arrMes.length - injectedIndices.length, type);
    }

    // Estimate how many unpinned example messages fit in the context
    tokenCount = await getMessagesTokenCount();
    let count_exm_add = 0;
    if (!power_user.pin_examples) {
        for (let example of mesExamplesArray) {
            tokenCount += await getTokenCountAsync(example.replace(/\r/gm, ''));
            examplesString += example;
            if (tokenCount < this_max_context) {
                count_exm_add++;
            } else {
                break;
            }
        }
    }

    let mesSend = [];
    console.debug('calling runGenerate');

    if (isContinue) {
        // Coping mechanism for OAI spacing
        if (main_api === 'openai' && !cyclePrompt.endsWith(' ')) {
            cyclePrompt += oai_settings.continue_postfix;
            continue_mag += oai_settings.continue_postfix;
        }
    }

    const originalType = type;

    if (!dryRun) {
        is_send_press = true;
    }

    let generatedPromptCache = cyclePrompt || '';
    if (generatedPromptCache.length == 0 || type === 'continue') {
        console.debug('generating prompt');
        chatString = '';
        arrMes = arrMes.reverse();
        arrMes.forEach(function (item, i, arr) {
            // OAI doesn't need all of this
            if (main_api === 'openai') {
                return;
            }

            // Cohee: This removes a newline from the end of the last message in the context.
            if (i === arrMes.length - 1 && type !== 'continue') {
                item = item.replace(/\n?$/, '');
            }

            mesSend[mesSend.length] = { message: item, extensionPrompts: [] };
        });
    }

    let mesExmString = '';

    function setPromptString() {
        if (main_api == 'openai') {
            return;
        }

        console.debug('--setting Prompt string');
        mesExmString = pinExmString ?? mesExamplesArray.slice(0, count_exm_add).join('');

        if (mesSend.length) {
            mesSend[mesSend.length - 1].message = modifyLastPromptLine(mesSend[mesSend.length - 1].message);
        }
    }

    function modifyLastPromptLine(lastMesString) {
        //#########QUIET PROMPT STUFF PT2##############

        // Add quiet generation prompt at depth 0
        if (quiet_prompt && quiet_prompt.length) {

            lastMesString += `\n${quiet_prompt}`;

            // Bail out early?
            if (!quietToLoud) {
                return lastMesString;
            }
        }

        // Get impersonation line
        if (isImpersonate && !isContinue) {
            const name = name1;
            if (!lastMesString.endsWith('\n')) {
                lastMesString += '\n';
            }
            lastMesString += name + ':';
        }

        // Add character's name
        // Force name append on continue (if not continuing on user message or first message)
        const isContinuingOnFirstMessage = chat.length === 1 && isContinue;
        if (force_name2 && !isContinuingOnFirstMessage) {
            if (!lastMesString.endsWith('\n')) {
                lastMesString += '\n';
            }
            if (!isContinue || !(chat[chat.length - 1]?.is_user)) {
                lastMesString += `${name2}:`;
            }
        }

        return lastMesString;
    }

    async function checkPromptSize() {
        console.debug('---checking Prompt size');
        setPromptString();
        const jointMessages = mesSend.map((e) => `${e.extensionPrompts.join('')}${e.message}`).join('');
        const prompt = [
            combinedStoryString,
            mesExmString,
            addChatsPreamble(addChatsSeparator(jointMessages)),
            '\n',
            modifyLastPromptLine(''),
            generatedPromptCache,
        ].join('').replace(/\r/gm, '');
        let thisPromptContextSize = await getTokenCountAsync(prompt, power_user.token_padding);

        if (thisPromptContextSize > this_max_context) {        //if the prepared prompt is larger than the max context size...
            if (count_exm_add > 0) {                            // ..and we have example mesages..
                count_exm_add--;                            // remove the example messages...
                await checkPromptSize();                            // and try agin...
            } else if (mesSend.length > 0) {                    // if the chat history is longer than 0
                mesSend.shift();                            // remove the first (oldest) chat entry..
                await checkPromptSize();                            // and check size again..
            } else {
                //end
                console.debug(`---mesSend.length = ${mesSend.length}`);
            }
        }
    }

    if (generatedPromptCache.length > 0 && main_api !== 'openai') {
        console.debug('---Generated Prompt Cache length: ' + generatedPromptCache.length);
        await checkPromptSize();
    } else {
        console.debug('---calling setPromptString ' + generatedPromptCache.length);
        setPromptString();
    }

    // For prompt bit itemization
    let mesSendString = '';

    async function getCombinedPrompt(isNegative) {
        // Only return if the guidance scale doesn't exist or the value is 1
        // Also don't return if constructing the neutral prompt
        if (isNegative && !useCfgPrompt) {
            return;
        }

        // OAI has its own prompt manager. No need to do anything here
        if (main_api === 'openai') {
            return '';
        }

        // Deep clone
        let finalMesSend = structuredClone(mesSend);

        if (useCfgPrompt) {
            const cfgPrompt = getCfgPrompt(cfgGuidanceScale, isNegative);
            if (cfgPrompt.value) {
                if (cfgPrompt.depth === 0) {
                    finalMesSend[finalMesSend.length - 1].message +=
                        /\s/.test(finalMesSend[finalMesSend.length - 1].message.slice(-1))
                            ? cfgPrompt.value
                            : ` ${cfgPrompt.value}`;
                } else {
                    // TODO: Make all extension prompts use an array/splice method
                    const lengthDiff = mesSend.length - cfgPrompt.depth;
                    const cfgDepth = lengthDiff >= 0 ? lengthDiff : 0;
                    const cfgMessage = finalMesSend[cfgDepth];
                    if (cfgMessage) {
                        if (!Array.isArray(finalMesSend[cfgDepth].extensionPrompts)) {
                            finalMesSend[cfgDepth].extensionPrompts = [];
                        }
                        finalMesSend[cfgDepth].extensionPrompts.push(`${cfgPrompt.value}\n`);
                    }
                }
            }
        }

        // Add prompt bias after everything else
        // Always run with continue
        if (!isImpersonate) {
            if (promptBias.trim().length !== 0) {
                finalMesSend[finalMesSend.length - 1].message +=
                    /\s/.test(finalMesSend[finalMesSend.length - 1].message.slice(-1))
                        ? promptBias.trimStart()
                        : ` ${promptBias.trimStart()}`;
            }
        }

        // Flattens the multiple prompt objects to a string.
        const combine = () => {
            // Right now, everything is suffixed with a newline
            mesSendString = finalMesSend.map((e) => `${e.extensionPrompts.join('')}${e.message}`).join('');

            // add a custom dingus (if defined)
            mesSendString = addChatsSeparator(mesSendString);

            // add chat preamble
            mesSendString = addChatsPreamble(mesSendString);

            let combinedPrompt = [
                combinedStoryString,
                mesExmString,
                mesSendString,
                generatedPromptCache,
            ].join('').replace(/\r/gm, '');

            if (power_user.collapse_newlines) {
                combinedPrompt = collapseNewlines(combinedPrompt);
            }

            return combinedPrompt;
        };

        finalMesSend.forEach((item, i) => {
            item.injected = injectedIndices.includes(finalMesSend.length - i - 1);
        });

        let data = {
            api: main_api,
            combinedPrompt: null,
            description,
            personality,
            persona,
            scenario,
            char: name2,
            user: name1,
            worldInfoBefore,
            worldInfoAfter,
            beforeScenarioAnchor,
            afterScenarioAnchor,
            storyString,
            mesExmString,
            mesSendString,
            finalMesSend,
            generatedPromptCache,
            main: system,
            jailbreak,
        };

        // Before returning the combined prompt, give available context related information to all subscribers.
        await eventSource.emit(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, data);

        // If one or multiple subscribers return a value, forfeit the responsibillity of flattening the context.
        return !data.combinedPrompt ? combine() : data.combinedPrompt;
    }

    let finalPrompt = await getCombinedPrompt(false);

    const eventData = { prompt: finalPrompt, dryRun: dryRun };
    await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, eventData);
    finalPrompt = eventData.prompt;

    const maxLength = Number(amount_gen); // how many tokens the AI will be requested to generate
    let thisPromptBits = [];

    let generate_data;
    switch (main_api) {
        case 'openai': {
            const tagKey = getTagKeyForEntity(this_chid);
            const activeCharacter = globalThis.promptManager?.activeCharacter ?? characters[this_chid];
            const promptSnapshotTarget = getPromptSnapshotTarget(type);
            const promptContext = await buildServerAssemblyPayload({
                coreChat: getCoreChatPayloadForAssembly(coreChat),
                name2: name2,
                charDescription: description,
                charPersonality: personality,
                persona: persona,
                scenario: scenario,
                mesExamples: mesExamples,
                charDepthPrompt: charDepthPrompt,
                creatorNotes: creatorNotes,
                bias: promptBias,
                type: type,
                quietPrompt: quiet_prompt,
                quietImage: quietImage,
                cyclePrompt: cyclePrompt,
                systemPromptOverride: system,
                jailbreakPromptOverride: jailbreak,
                messages: oaiMessages,
                messageExamples: oaiMessageExamples,
                worldInfoRequest: {
                    chat: chatForWI,
                    includeNames: world_info_include_names,
                    maxContext: this_max_context,
                    isDryRun: dryRun,
                    globalScanData,
                    regexScripts: getWorldInfoRegexScripts(),
                    selectedWorldInfo: selected_world_info,
                    chatWorld: chat_metadata[METADATA_KEY] || '',
                    personaWorld: power_user.persona_description_lorebook || '',
                    characterWorld: characters[this_chid]?.data?.extensions?.world || '',
                    characterExtraBooks: getCharacterExtraBooks(getCharaFilename(this_chid)),
                    selectedGroup: Boolean(selected_group),
                    activeSpeaker: {
                        name: activeCharacter?.name || name2 || '',
                        avatar: activeCharacter?.avatar || characters[this_chid]?.avatar || '',
                        filename: String(activeCharacter?.avatar || characters[this_chid]?.avatar || '').replace(/\.[^/.]+$/, '') || getCharaFilename(),
                    },
                    currentCharacterFilename: getCharaFilename(),
                    currentCharacterTags: Array.isArray(tag_map?.[tagKey]) ? tag_map[tagKey] : [],
                    forcedActivations: getForcedActivationEntriesSnapshot(),
                    timedWorldInfo: structuredClone(chat_metadata.timedWorldInfo || {}),
                    settings: {
                        world_info_depth,
                        world_info_min_activations,
                        world_info_min_activations_depth_max,
                        world_info_budget,
                        world_info_recursive,
                        world_info_case_sensitive,
                        world_info_match_whole_words,
                        world_info_budget_cap,
                        world_info_use_group_scoring,
                        world_info_max_recursion_steps,
                    },
                    worldInfoPosition: world_info_position,
                    wiAnchorPosition: wi_anchor_position,
                    tokenizerModel: getTokenizerModel(),
                },
            });
            if (!['quiet', 'impersonate'].includes(type)) {
                promptContext.promptInspection = {
                    chatScope: getPromptSnapshotChatScope(),
                    mesId: promptSnapshotTarget.mesId,
                    swipeId: promptSnapshotTarget.swipeId,
                };
            }
            generate_data = { promptContext };
            break;
        }
        default:
            throw new Error(`Unsupported API: ${main_api}`);
    }

    await eventSource.emit(event_types.GENERATE_AFTER_DATA, generate_data, dryRun);

    if (dryRun) {
        return Promise.resolve();
    }

    /**
     * Saves itemized prompt bits and calls streaming or non-streaming generation API.
     * @returns {Promise<void|*|Awaited<*>|String|{fromStream}|string|undefined|Object>}
     * @throws {Error|object} Error with message text, or Error with response JSON (OAI/Horde), or the actual response JSON
     */
    async function finishGenerating() {
        console.debug('rungenerate calling API');

        showStopButton();

        //set array object for prompt token itemization of this message
        let currentArrayEntry = Number(thisPromptBits.length - 1);
        const isServerAssembledOpenAI = main_api === 'openai' && !generate_data.prompt && !generate_data.input;
        const canPersistPromptInspectorContent = isAdmin();
        const canPersistPromptInspectorText = canPersistPromptInspectorContent || !isServerAssembledOpenAI;
        const promptSnapshotTarget = getPromptSnapshotTarget(type);
        let additionalPromptStuff = {
            ...thisPromptBits[currentArrayEntry],
            rawPrompt: canPersistPromptInspectorText ? (generate_data.prompt || generate_data.input) : '',
            mesId: getNextMessageId(type),
            swipeId: promptSnapshotTarget.swipeId,
            promptSnapshotKey: null,
            allAnchors: canPersistPromptInspectorContent ? await getAllExtensionPrompts() : '',
            chatInjects: canPersistPromptInspectorContent ? (injectedIndices?.map(index => arrMes[arrMes.length - index - 1])?.join('') || '') : '',
            chatSystemInjects: canPersistPromptInspectorContent ? (systemInjectedIndices?.map(index => arrMes[arrMes.length - index - 1])?.join('') || '') : '',
            summarizeString: canPersistPromptInspectorContent ? (extension_prompts['1_memory']?.value || '') : '',
            authorsNoteString: canPersistPromptInspectorContent ? (extension_prompts['2_floating_prompt']?.value || '') : '',
            smartContextString: canPersistPromptInspectorContent ? (extension_prompts['chromadb']?.value || '') : '',
            chatVectorsString: canPersistPromptInspectorContent ? (extension_prompts['3_vectors']?.value || '') : '',
            dataBankVectorsString: canPersistPromptInspectorContent ? (extension_prompts['4_vectors_data_bank']?.value || '') : '',
            worldInfoString: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : worldInfoString,
            storyString: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : storyString,
            beforeScenarioAnchor: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : beforeScenarioAnchor,
            afterScenarioAnchor: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : afterScenarioAnchor,
            examplesString: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : examplesString,
            mesSendString: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : mesSendString,
            generatedPromptCache: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : generatedPromptCache,
            promptBias: canPersistPromptInspectorContent ? promptBias : '',
            finalPrompt: (isServerAssembledOpenAI || !canPersistPromptInspectorContent) ? '' : finalPrompt,
            charDescription: canPersistPromptInspectorContent ? description : '',
            charPersonality: canPersistPromptInspectorContent ? personality : '',
            scenarioText: canPersistPromptInspectorContent ? scenario : '',
            this_max_context: this_max_context,
            padding: power_user.token_padding,
            main_api: main_api,
            serverPromptAssembly: isServerAssembledOpenAI,
            instruction: '',
            userPersona: canPersistPromptInspectorContent && power_user.persona_description_position == persona_description_positions.IN_PROMPT ? (persona || '') : '',
            tokenizer: getFriendlyTokenizerName(main_api).tokenizerName || '',
            presetName: getPresetManager()?.getSelectedPresetName() || '',
            messagesCount: main_api !== 'openai' ? Math.max(0, mesSend.length - systemInjectedIndices.length) : null,
            examplesCount: main_api !== 'openai' ? (pinExmString ? mesExamplesArray.length : count_exm_add) : null,
        };

        stagePromptInspectorRecord(additionalPromptStuff);
        console.debug('Staged latest prompt inspector record.');

        if (isStreamingEnabled() && type !== 'quiet') {
            continue_mag = promptReasoning.removePrefix(continue_mag);
            streamingProcessor = new StreamingProcessor(type, force_name2, generation_started, continue_mag, promptReasoning);
            if (isContinue) {
                // Save reply does add cycle text to the prompt, so it's not needed here
                streamingProcessor.firstMessageText = '';
            }

            streamingProcessor.generator = await sendStreamingRequest(type, generate_data);

            hideSwipeButtons();
            let getMessage = await streamingProcessor.generate();
            let messageChunk = cleanUpMessage({
                getMessage: getMessage,
                isImpersonate: isImpersonate,
                isContinue: isContinue,
                displayIncompleteSentences: false,
            });

            if (isContinue) {
                getMessage = continue_mag + getMessage;
            }

            const isStreamFinished = streamingProcessor && !streamingProcessor.isStopped && streamingProcessor.isFinished;
            const isStreamWithToolCalls = streamingProcessor && Array.isArray(streamingProcessor.toolCalls) && streamingProcessor.toolCalls.length;
            if (canPerformToolCalls && isStreamFinished && isStreamWithToolCalls) {
                const lastMessage = chat[chat.length - 1];
                const hasToolCalls = ToolManager.hasToolCalls(streamingProcessor.toolCalls);
                const shouldDeleteMessage = type !== 'swipe' && ['', '...'].includes(lastMessage?.mes) && !lastMessage?.extra?.reasoning && ['', '...'].includes(streamingProcessor?.result);
                hasToolCalls && shouldDeleteMessage && await deleteLastMessage();
                const invocationResult = await ToolManager.invokeFunctionTools(streamingProcessor.toolCalls);
                const shouldStopGeneration = (!invocationResult.invocations.length && shouldDeleteMessage) || invocationResult.stealthCalls.length;
                if (hasToolCalls) {
                    if (shouldStopGeneration) {
                        if (Array.isArray(invocationResult.errors) && invocationResult.errors.length) {
                            ToolManager.showToolCallError(invocationResult.errors);
                        }
                        unblockGeneration(type);
                        streamingProcessor = null;
                        return;
                    }

                    streamingProcessor = null;
                    depth = depth + 1;
                    await ToolManager.saveFunctionToolInvocations(invocationResult.invocations);
                    return Generate('normal', { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage, quietName, depth }, dryRun);
                }
            }

            if (isStreamFinished) {
                await streamingProcessor.onFinishStreaming(streamingProcessor.messageId, getMessage);
                streamingProcessor = null;
                triggerAutoContinue(messageChunk, isImpersonate);
                return Object.defineProperties(new String(getMessage), {
                    'messageChunk': { value: messageChunk },
                    'fromStream': { value: true },
                });
            }
        } else {
            return await sendGenerationRequest(type, generate_data, { jsonSchema });
        }
    }

    return finishGenerating().then(onSuccess, onError);

    /**
     * Handles the successful response from the generation API.
     * @param data
     * @returns {Promise<String|{fromStream}|*|string|string|void|Awaited<*>|undefined>}
     * @throws {Error} Throws an error if the response data contains an error message
     */
    async function onSuccess(data) {
        const openAIRequestId = data?.openAIRequestId ?? streamingProcessor?.generator?.openAIRequestId ?? null;

        if (!data) {
            consumeOpenAIResponseData(openAIRequestId);
            return;
        }

        if (data?.fromStream) {
            return data;
        }

        let messageChunk = '';

        // if an error was returned in data (textgenwebui), show it and throw it
        if (data.error) {
            unblockGeneration(type);
            consumeOpenAIResponseData(openAIRequestId);

            if (data?.response) {
                toastr.error(data.response, t`API Error`, { preventDuplicates: true });
            }
            throw new Error(data?.response);
        }

        if (jsonSchema) {
            unblockGeneration(type);
            consumeOpenAIResponseData(openAIRequestId);
            return extractJsonFromData(data);
        }

        //const getData = await response.json();
        let getMessage = extractMessageFromData(data);
        let title = extractTitleFromData(data);
        let reasoning = extractReasoningFromData(data);
        let imageUrls = extractImagesFromData(data);

        const swipes = extractMultiSwipes(data, type);
        const swipeReasoning = extractMultiSwipeReasoning(data, type);

        messageChunk = cleanUpMessage({
            getMessage: getMessage,
            isImpersonate: isImpersonate,
            isContinue: isContinue,
            displayIncompleteSentences: false,
        });


        reasoning = getRegexedString(reasoning, regex_placement.REASONING);

        if (power_user.trim_spaces) {
            reasoning = reasoning.trim();
        }

        if (isContinue) {
            continue_mag = promptReasoning.removePrefix(continue_mag);
            getMessage = continue_mag + getMessage;
        }

        //Formating
        const displayIncomplete = type === 'quiet' && !quietToLoud;
        getMessage = cleanUpMessage({
            getMessage: getMessage,
            isImpersonate: isImpersonate,
            isContinue: isContinue,
            displayIncompleteSentences: displayIncomplete,
        });

        if (isImpersonate) {
            $('#send_textarea').val(getMessage)[0].dispatchEvent(new Event('input', { bubbles: true }));
            await eventSource.emit(event_types.IMPERSONATE_READY, getMessage);
            consumeOpenAIResponseData(openAIRequestId);
        }
        else if (type == 'quiet') {
            unblockGeneration(type);
            consumeOpenAIResponseData(openAIRequestId);
            return getMessage;
        }
        else {
            // Without streaming we'll be having a full message on continuation. Treat it as a last chunk.
            if (originalType !== 'continue') {
                ({ type, getMessage } = await saveReply({ type, getMessage, title, swipes, swipeReasoning, reasoning, imageUrls, openAIRequestId }));
            }
            else {
                ({ type, getMessage } = await saveReply({ type: 'appendFinal', getMessage, title, swipes, swipeReasoning, reasoning, imageUrls, openAIRequestId }));
            }

            // This relies on `saveReply` having been called to add the message to the chat, so it must be last.
            parseAndSaveLogprobs(data, continue_mag);
        }

        if (canPerformToolCalls) {
            const hasToolCalls = ToolManager.hasToolCalls(data);
            const shouldDeleteMessage = type !== 'swipe' && ['', '...'].includes(getMessage) && !reasoning;
            hasToolCalls && shouldDeleteMessage && await deleteLastMessage();
            const invocationResult = await ToolManager.invokeFunctionTools(data);
            const shouldStopGeneration = (!invocationResult.invocations.length && shouldDeleteMessage) || invocationResult.stealthCalls.length;
            if (hasToolCalls) {
                if (shouldStopGeneration) {
                    if (Array.isArray(invocationResult.errors) && invocationResult.errors.length) {
                        ToolManager.showToolCallError(invocationResult.errors);
                    }
                    unblockGeneration(type);
                    return;
                }

                depth = depth + 1;
                await ToolManager.saveFunctionToolInvocations(invocationResult.invocations);
                return Generate('normal', { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage, quietName, depth }, dryRun);
            }
        }

        if (type !== 'quiet') {
            playMessageSound();
        }

        const isAborted = abortController && abortController.signal.aborted;
        if (!isAborted && power_user.auto_swipe && generatedTextFiltered(getMessage)) {
            is_send_press = false;
            return swipe_right();
        }

        console.debug('/api/chats/save called by /Generate');
        await saveChatConditional();
        unblockGeneration(type);
        streamingProcessor = null;

        if (type !== 'quiet') {
            triggerAutoContinue(messageChunk, isImpersonate);
        }

        // Don't break the API chain that expects a single string in return
        return Object.defineProperty(new String(getMessage), 'messageChunk', { value: messageChunk });
    }

    /**
     * Exception handler for finishGenerating
     * @param {Error|object} exception Error or response JSON
     * @throws {Error|object} Re-throws the exception
     */
    function onError(exception) {
        // If the response JSON was thrown, show the error message.
        if (typeof exception?.error?.message === 'string') {
            toastr.error(exception.error.message, t`Text generation error`, { timeOut: 10000, extendedTimeOut: 20000 });
        }

        consumeOpenAIResponseData(streamingProcessor?.generator?.openAIRequestId ?? null);
        unblockGeneration(type);
        console.log(exception);
        streamingProcessor = null;
        throw exception;
    }
}
//MARK: Generate() ends

/**
 * Stops the generation and any streaming if it is currently running.
 */
export function stopGeneration() {
    let stopped = false;
    if (streamingProcessor) {
        streamingProcessor.onStopStreaming();
        stopped = true;
    }
    if (abortController) {
        abortController.abort('Clicked stop button');
        hideStopButton();
        stopped = true;
    }
    eventSource.emit(event_types.GENERATION_STOPPED);
    return stopped;
}

/**
 * Injects extension prompts into chat messages.
 * @param {object[]} messages Array of chat messages
 * @param {boolean} isContinue Whether the generation is a continuation. If true, the extension prompts of depth 0 are injected at position 1.
 * @returns {Promise<number[]>} Array of indices where the extension prompts were injected
 */
async function doChatInject(messages, isContinue) {
    const injectedMessages = [];
    const systemInjectedMessages = [];
    let totalInsertedMessages = 0;
    messages.reverse();

    const maxDepth = getExtensionPromptMaxDepth();
    for (let i = 0; i <= maxDepth; i++) {
        // Order of priority (most important go lower)
        const roles = [extension_prompt_roles.SYSTEM, extension_prompt_roles.USER, extension_prompt_roles.ASSISTANT];
        const names = {
            [extension_prompt_roles.SYSTEM]: '',
            [extension_prompt_roles.USER]: name1,
            [extension_prompt_roles.ASSISTANT]: name2,
        };
        const roleMessages = [];
        const separator = '\n';
        const wrap = false;

        for (const role of roles) {
            const extensionPrompt = String(await getExtensionPrompt(extension_prompt_types.IN_CHAT, i, separator, role, wrap)).trimStart();
            const isNarrator = role === extension_prompt_roles.SYSTEM;
            const isUser = role === extension_prompt_roles.USER;
            const name = names[role];

            if (extensionPrompt) {
                roleMessages.push({
                    name: name,
                    is_user: isUser,
                    mes: extensionPrompt,
                    extra: {
                        type: isNarrator ? system_message_types.NARRATOR : null,
                    },
                });
            }
        }

        if (roleMessages.length) {
            const depth = isContinue && i === 0 ? 1 : i;
            const injectIdx = Math.min(depth + totalInsertedMessages, messages.length);
            messages.splice(injectIdx, 0, ...roleMessages);
            totalInsertedMessages += roleMessages.length;
            injectedMessages.push(...roleMessages);
            systemInjectedMessages.push(...roleMessages.filter(x => x.extra?.type === system_message_types.NARRATOR));
        }
    }

    const injectedIndices = injectedMessages.map(msg => messages.indexOf(msg));
    const systemInjectedIndices = systemInjectedMessages.map(msg => messages.indexOf(msg));
    messages.reverse();
    return {
        indices: injectedIndices,
        systemIndices: systemInjectedIndices,
    };
}

/**
 * Unblocks the UI after a generation is complete.
 * @param {string} [type] Generation type (optional)
 */
function unblockGeneration(type) {
    // Don't unblock if a parallel stream is still running
    if (type === 'quiet' && streamingProcessor && !streamingProcessor.isFinished) {
        return;
    }

    is_send_press = false;
    activateSendButtons();
    showSwipeButtons();
    setGenerationProgress(0);
    flushEphemeralStoppingStrings();
}

export function getNextMessageId(type) {
    return type == 'swipe' ? chat.length - 1 : chat.length;
}

/**
 * Determines if the message should be auto-continued.
 * @param {string} messageChunk Current message chunk
 * @param {boolean} isImpersonate Is the user impersonation
 * @returns {boolean} Whether the message should be auto-continued
 */
export function shouldAutoContinue(messageChunk, isImpersonate) {
    if (!power_user.auto_continue.enabled) {
        console.debug('Auto-continue is disabled by user.');
        return false;
    }

    if (typeof messageChunk !== 'string') {
        console.debug('Not triggering auto-continue because message chunk is not a string');
        return false;
    }

    if (isImpersonate) {
        console.log('Continue for impersonation is not implemented yet');
        return false;
    }

    if (is_send_press) {
        console.debug('Auto-continue is disabled because a message is currently being sent.');
        return false;
    }

    if (abortController && abortController.signal.aborted) {
        console.debug('Auto-continue is not triggered because the generation was stopped.');
        return false;
    }

    if (power_user.auto_continue.target_length <= 0) {
        console.log('Auto-continue target length is 0, not triggering auto-continue');
        return false;
    }

    if (main_api === 'openai' && !power_user.auto_continue.allow_chat_completions) {
        console.log('Auto-continue for OpenAI is disabled by user.');
        return false;
    }

    const textareaText = String($('#send_textarea').val());
    const USABLE_LENGTH = 5;

    if (textareaText.length > 0) {
        console.log('Not triggering auto-continue because user input is not empty');
        return false;
    }

    if (messageChunk.trim().length > USABLE_LENGTH && chat.length) {
        const lastMessage = chat[chat.length - 1];
        const messageLength = getTokenCount(lastMessage.mes);
        const shouldAutoContinue = messageLength < power_user.auto_continue.target_length;

        if (shouldAutoContinue) {
            console.log(`Triggering auto-continue. Message tokens: ${messageLength}. Target tokens: ${power_user.auto_continue.target_length}. Message chunk: ${messageChunk}`);
            return true;
        } else {
            console.log(`Not triggering auto-continue. Message tokens: ${messageLength}. Target tokens: ${power_user.auto_continue.target_length}`);
            return false;
        }
    } else {
        console.log('Last generated chunk was empty, not triggering auto-continue');
        return false;
    }
}

/**
 * Triggers auto-continue if the message meets the criteria.
 * @param {string} messageChunk Current message chunk
 * @param {boolean} isImpersonate Is the user impersonation
 */
export function triggerAutoContinue(messageChunk, isImpersonate) {
    if (selected_group) {
        console.debug('Auto-continue is disabled for group chat');
        return;
    }

    if (shouldAutoContinue(messageChunk, isImpersonate)) {
        $('#option_continue').trigger('click');
    }
}

export function getBiasStrings(textareaText, type) {
    if (type == 'impersonate' || type == 'continue') {
        return { messageBias: '', promptBias: '', isUserPromptBias: false };
    }

    let promptBias = '';
    let messageBias = extractMessageBias(textareaText);

    // If user input is not provided, retrieve the bias of the most recent relevant message
    if (!textareaText) {
        for (let i = chat.length - 1; i >= 0; i--) {
            const mes = chat[i];
            if (type === 'swipe' && chat.length - 1 === i) {
                continue;
            }
            if (mes && (mes.is_user || mes.is_system || mes.extra?.type === system_message_types.NARRATOR)) {
                if (mes.extra?.bias?.trim()?.length > 0) {
                    promptBias = mes.extra.bias;
                }
                break;
            }
        }
    }

    promptBias = messageBias || promptBias || power_user.user_prompt_bias || '';
    const isUserPromptBias = promptBias === power_user.user_prompt_bias;

    // Substitute params for everything
    messageBias = substituteParams(messageBias);
    promptBias = substituteParams(promptBias);

    return { messageBias, promptBias, isUserPromptBias };
}

/**
 * @param {Object} chatItem Message history item.
 */
function formatMessageHistoryItem(chatItem) {
    const isNarratorType = chatItem?.extra?.type === system_message_types.NARRATOR;
    const characterName = chatItem?.name ? chatItem.name : name2;
    const itemName = chatItem.is_user ? chatItem['name'] : characterName;
    const shouldPrependName = !isNarratorType;

    // If this symbol flag is set, completely ignore the message.
    // This can be used to hide messages without affecting the number of messages in the chat.
    if (isPromptExcludedChatMessage(chatItem)) {
        return '';
    }

    // Don't include a name if it's empty
    let textResult = chatItem?.name && shouldPrependName ? `${itemName}: ${chatItem.mes}\n` : `${chatItem.mes}\n`;

    return textResult;
}

/**
 * Removes all {{macros}} from a string.
 * @param {string} str String to remove macros from.
 * @returns {string} String with macros removed.
 */
export function removeMacros(str) {
    return (str ?? '').replace(/\{\{[\s\S]*?\}\}/gm, '').trim();
}

/**
 * Inserts a user message into the chat history.
 * @param {string} messageText Message text.
 * @param {string} messageBias Message bias.
 * @param {number} [insertAt] Optional index to insert the message at.
 * @param {boolean} [compact] Send as a compact display message.
 * @param {string} [name] Name of the user sending the message. Defaults to name1.
 * @param {string} [avatar] Avatar of the user sending the message. Defaults to user_avatar.
 * @returns {Promise<any>} A promise that resolves to the message when it is inserted.
 */
export async function sendMessageAsUser(messageText, messageBias, insertAt = null, compact = false, name = name1, avatar = user_avatar) {
    messageText = getRegexedString(messageText, regex_placement.USER_INPUT);

    const message = {
        name: name,
        is_user: true,
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: substituteParams(messageText),
        extra: {
            isSmallSys: compact,
        },
    };

    if (power_user.message_token_count_enabled) {
        message.extra.token_count = await getTokenCountAsync(message.mes, 0);
    }

    // Lock user avatar to a persona.
    if (avatar in power_user.personas) {
        message.force_avatar = getThumbnailUrl('persona', avatar);
    }

    if (messageBias) {
        message.extra.bias = messageBias;
        message.mes = removeMacros(message.mes);
    }

    await populateFileAttachment(message);
    statMesProcess(message, 'user', characters, this_chid, '');

    chat_metadata['tainted'] = true;

    if (typeof insertAt === 'number' && insertAt >= 0 && insertAt <= chat.length) {
        chat.splice(insertAt, 0, message);
        await saveChatConditional();
        await eventSource.emit(event_types.MESSAGE_SENT, insertAt);
        await reloadCurrentChat();
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, insertAt);
    } else {
        chat.push(message);
        const chat_id = (chat.length - 1);
        await eventSource.emit(event_types.MESSAGE_SENT, chat_id);
        addOneMessage(message);
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, chat_id);
        await saveChatConditional();
    }

    return message;
}

/**
 * Gets the maximum usable context size for the current API.
 * @param {number|null} overrideResponseLength Optional override for the response length.
 * @returns {number} Maximum usable context size.
 */
export function getMaxContextSize(overrideResponseLength = null) {
    if (typeof overrideResponseLength !== 'number' || overrideResponseLength <= 0 || isNaN(overrideResponseLength)) {
        overrideResponseLength = null;
    }

    return oai_settings.openai_max_context - (overrideResponseLength || oai_settings.openai_max_tokens);
}

function addChatsPreamble(mesSendString) {
    return mesSendString;
}

function addChatsSeparator(mesSendString) {
    return mesSendString;
}

export async function duplicateCharacter() {
    if (this_chid === undefined || !characters[this_chid]) {
        toastr.warning(t`You must first select a character to duplicate!`);
        return '';
    }

    if (!canDuplicateCharacter(this_chid)) {
        const ownerLabel = getCharacterOwnerLabel(this_chid);
        toastr.info(`Only ${ownerLabel} and admins can duplicate this character.`, 'Character locked');
        return '';
    }

    const confirmMessage = $(await renderTemplateAsync('duplicateConfirm'));
    const confirm = await callGenericPopup(confirmMessage, POPUP_TYPE.CONFIRM);

    if (!confirm) {
        console.log('User cancelled duplication');
        return '';
    }

    const body = { avatar_url: characters[this_chid].avatar };
    const response = await fetch('/api/characters/duplicate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (response.ok) {
        toastr.success(t`Character Duplicated`);
        const data = await response.json();
        await eventSource.emit(event_types.CHARACTER_DUPLICATED, { oldAvatar: body.avatar_url, newAvatar: data.path });
        await getCharacters();
    }

    return '';
}

export function setInContextMessages(msgInContextCount, type) {
    chatElement.find('.mes').removeClass('lastInContext');

    if (type === 'swipe' || type === 'regenerate' || type === 'continue') {
        msgInContextCount++;
    }

    const lastMessageBlock = chatElement.find('.mes:not([is_system="true"]), .mes.toolCall').eq(-msgInContextCount);
    lastMessageBlock.addClass('lastInContext');

    if (lastMessageBlock.length === 0) {
        const firstMessageId = getFirstDisplayedMessageId();
        chatElement.find(`.mes[mesid="${firstMessageId}"]`).addClass('lastInContext');
    }

    // Update last id to chat. No metadata save on purpose, gets hopefully saved via another call
    const lastMessageId = Math.max(0, chat.length - msgInContextCount);
    chat_metadata['lastInContextMessageId'] = lastMessageId;
}

/**
 * @typedef {object} AdditionalRequestOptions
 * @property {JsonSchema} [jsonSchema]
 */

/**
 * Sends a non-streaming request to the API.
 * @param {string} type Generation type
 * @param {object} data Generation data
 * @param {AdditionalRequestOptions} [options] Additional options for the generation request
 * @returns {Promise<object>} Response data from the API
 * @throws {Error|object}
 */
export async function sendGenerationRequest(type, data, options = {}) {
    if (main_api !== 'openai') {
        throw new Error('Only chat-completions generation is supported.');
    }

    const openAIRequest = data?.promptContext ? { promptContext: data.promptContext } : data.prompt;
    return await sendOpenAIRequest(type, openAIRequest, abortController.signal, options);
}

/**
 * Sends a streaming request to the API.
 * @param {string} type Generation type
 * @param {object} data Generation data
 * @param {AdditionalRequestOptions} [options] Additional options for the generation request
 * @returns {Promise<any>} Streaming generator
 */
export async function sendStreamingRequest(type, data, options = {}) {
    if (abortController?.signal?.aborted) {
        throw new Error('Generation was aborted.');
    }

    if (main_api !== 'openai') {
        throw new Error('Only chat-completions generation is supported.');
    }

    return await sendOpenAIRequest(type, data?.promptContext ? { promptContext: data.promptContext } : data.prompt, streamingProcessor.abortController.signal, options);
}

/**
 * Gets the generation endpoint URL for the specified API or chat-completion source.
 * @param {string} api API name or chat-completion source
 * @returns {string} Generation URL
 * @throws {Error} If the API is unknown
 */
export function getGenerateUrl(api) {
    if (Object.values(chat_completion_sources).includes(api)) {
        return '/api/backends/chat-completions/generate';
    }

    throw new Error(`Unsupported API: ${api}`);
}

function extractTitleFromData(data) {
    return undefined;
}

/**
 * Extracts the image from the response data.
 * @param {object} data Response data
 * @param {object} [options] Extraction options
 * @param {string} [options.mainApi] Main API to use
 * @param {string} [options.chatCompletionSource] Chat completion source
 * @returns {string[]} Extracted images or empty array
 */
function extractImagesFromData(data, { mainApi = null, chatCompletionSource = null } = {}) {
    switch (mainApi ?? main_api) {
        case 'openai': {
            switch (chatCompletionSource ?? oai_settings.chat_completion_source) {
                case chat_completion_sources.VERTEXAI:
                case chat_completion_sources.MAKERSUITE: {
                    const inlineData = data?.responseContent?.parts?.filter(x => x.inlineData && !x.thought)?.map(x => x.inlineData);
                    if (Array.isArray(inlineData) && inlineData.length > 0) {
                        return inlineData.map(x => `data:${x.mimeType};base64,${x.data}`).filter(isDataURL);
                    }
                } break;
                case chat_completion_sources.OPENROUTER: {
                    const imageUrl = data?.choices[0]?.message?.images
                        ?.filter(x => x.type === 'image_url')
                        ?.map(x => typeof x?.image_url?.url === 'string' ? x.image_url.url.trim() : x?.image_url?.url);
                    if (Array.isArray(imageUrl) && imageUrl.length > 0) {
                        return imageUrl.filter(url => isDataURL(url) || (/^https?:\/\//i.test(url) && isValidUrl(url)));
                    }
                }
            }
        } break;
    }

    return [];
}

/**
 * parseAndSaveLogprobs receives the full data response for a non-streaming
 * generation, parses logprobs for all tokens in the message, and saves them
 * to the currently active message.
 * @param {object} data - response data containing all tokens/logprobs
 * @param {string} continueFrom - for 'continue' generations, the prompt
 *  */
function parseAndSaveLogprobs(data, continueFrom) {
    // Chat-completion providers handle logprobs during request processing.
    return;
}

/**
 * Extracts the message from the response data.
 * @param {object} data Response data
 * @param {string} activeApi If it's set, ignores active API
 * @returns {string} Extracted message
 */
export function extractMessageFromData(data, activeApi = null) {
    function getResult() {
        if (typeof data === 'string') {
            return data;
        }

        switch (activeApi ?? main_api) {
            case 'openai':
                return data?.content?.find(p => p.type === 'text')?.text ?? data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.text ?? data?.message?.content?.[0]?.text ?? data?.message?.tool_plan ?? '';
            default:
                return '';
        }
    }

    const result = getResult();
    return Array.isArray(result) ? result.map(x => x.text).filter(x => x).join('') : result;
}

/**
 * Extracts JSON from the response data.
 * @param {object} data Response data
 * @returns {string} Extracted JSON string from the response data
 */
export function extractJsonFromData(data, { mainApi = null, chatCompletionSource = null } = {}) {
    mainApi = mainApi ?? main_api;
    chatCompletionSource = chatCompletionSource ?? oai_settings.chat_completion_source;

    const tryParse = (/** @type {string} */ value) => {
        try {
            return JSON.parse(value);
        } catch (e) {
            console.debug('Failed to parse content as JSON.', e);
        }
    };

    let result = {};

    switch (mainApi) {
        case 'openai': {
            const text = extractMessageFromData(data, mainApi);
            switch (chatCompletionSource) {
                case chat_completion_sources.CLAUDE:
                    result = data?.content?.find(x => x.type === 'tool_use')?.input;
                    break;
                case chat_completion_sources.PERPLEXITY:
                    result = tryParse(removeReasoningFromString(text));
                    break;
                case chat_completion_sources.VERTEXAI:
                case chat_completion_sources.MAKERSUITE:
                case chat_completion_sources.DEEPSEEK:
                case chat_completion_sources.AI21:
                case chat_completion_sources.GROQ:
                case chat_completion_sources.POLLINATIONS:
                case chat_completion_sources.AIMLAPI:
                case chat_completion_sources.OPENAI:
                case chat_completion_sources.OPENROUTER:
                case chat_completion_sources.MISTRALAI:
                case chat_completion_sources.CUSTOM:
                case chat_completion_sources.COHERE:
                case chat_completion_sources.XAI:
                case chat_completion_sources.ELECTRONHUB:
                case chat_completion_sources.AZURE_OPENAI:
                case chat_completion_sources.ZAI:
                default:
                    result = tryParse(text);
                    break;
            }
        } break;
    }

    return JSON.stringify(result ?? {});
}

/**
 * Extracts multiswipe swipes from the response data.
 * @param {Object} data Response data
 * @param {string} type Type of generation
 * @returns {string[]} Array of extra swipes
 */
function extractMultiSwipes(data, type) {
    const swipes = [];

    if (!data) {
        return swipes;
    }

    if (type === 'continue' || type === 'impersonate' || type === 'quiet') {
        return swipes;
    }

    if (!Array.isArray(data.choices)) {
        return swipes;
    }

    const multiSwipeCount = data.choices.length - 1;

    if (multiSwipeCount <= 0) {
        return swipes;
    }

    for (let i = 1; i < data.choices.length; i++) {
        const text = extractMessageFromData({ choices: [data.choices[i]] }, 'openai');
        const cleanedText = cleanUpMessage({
            getMessage: text,
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences: false,
        });

        if (cleanedText) {
            swipes.push(cleanedText);
        }
    }

    return swipes;
}

/**
 * Extracts multiswipe reasoning blocks from the response data.
 * @param {Object} data Response data
 * @param {string} type Type of generation
 * @returns {string[]} Array of extra swipe reasoning blocks
 */
function extractMultiSwipeReasoning(data, type) {
    const reasoning = [];

    if (!data) {
        return reasoning;
    }

    if (type === 'continue' || type === 'impersonate' || type === 'quiet') {
        return reasoning;
    }

    if (!Array.isArray(data.choices)) {
        return reasoning;
    }

    const multiSwipeCount = data.choices.length - 1;

    if (multiSwipeCount <= 0) {
        return reasoning;
    }

    for (let i = 1; i < data.choices.length; i++) {
        const text = extractMessageFromData({ choices: [data.choices[i]] }, 'openai');
        const cleanedText = cleanUpMessage({
            getMessage: text,
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences: false,
        });

        if (cleanedText) {
            reasoning.push(extractReasoningFromData({ choices: [data.choices[i]] }));
        }
    }

    return reasoning;
}

/**
 * Formats a message according to user settings
 * @param {object} [options] - Additional options.
 * @param {string} [options.getMessage] The message to clean up
 * @param {boolean} [options.isImpersonate] Whether this is an impersonated message
 * @param {boolean} [options.isContinue] Whether this is a continued message
 * @param {boolean} [options.displayIncompleteSentences] Whether to keep incomplete sentences at the end.
 * @param {array} [options.stoppingStrings] Array of stopping strings.
 * @param {boolean} [options.includeUserPromptBias] Whether to permit prepending the user prompt bias at the beginning.
 * @param {boolean} [options.trimNames] Whether to allow trimming "{{char}}:" or "{{user}}:" from the beginning.
 * @param {boolean} [options.trimWrongNames] Whether to allow deleting responses prefixed by the incorrect name, depending on isImpersonate
 *
 * @returns {string} The formatted message
 */
export function cleanUpMessage({ getMessage, isImpersonate, isContinue, displayIncompleteSentences = false, stoppingStrings = null, includeUserPromptBias = true, trimNames = true, trimWrongNames = true } = {}) {
    if (arguments.length > 0 && typeof arguments[0] !== 'object') {
        console.trace('cleanUpMessage called with positional arguments. Please use an object instead.');
        [getMessage, isImpersonate, isContinue, displayIncompleteSentences, stoppingStrings, includeUserPromptBias, trimNames, trimWrongNames] = arguments;
    }

    if (!getMessage) {
        return '';
    }

    // Add the prompt bias before anything else
    if (
        includeUserPromptBias &&
        power_user.user_prompt_bias &&
        !isImpersonate &&
        !isContinue &&
        power_user.user_prompt_bias.length !== 0
    ) {
        getMessage = substituteParams(power_user.user_prompt_bias) + getMessage;
    }

    // Allow for caching of stopping strings. getStoppingStrings is an expensive function, especially with macros
    // enabled, so for streaming, we call it once and then pass it into each cleanUpMessage call.
    if (!stoppingStrings) {
        stoppingStrings = getStoppingStrings(isImpersonate, isContinue);
    }

    for (const stoppingString of stoppingStrings) {
        if (stoppingString.length) {
            for (let j = stoppingString.length; j > 0; j--) {
                if (getMessage.slice(-j) === stoppingString.slice(0, j)) {
                    getMessage = getMessage.slice(0, -j);
                    break;
                }
            }
        }
    }

    // Regex uses vars, so add before formatting
    getMessage = getRegexedString(getMessage, isImpersonate ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT);

    if (power_user.collapse_newlines) {
        getMessage = collapseNewlines(getMessage);
    }

    // trailing invisible whitespace before every newlines, on a multiline string
    // "trailing whitespace on newlines       \nevery line of the string    \n?sample text" ->
    // "trailing whitespace on newlines\nevery line of the string\nsample text"
    getMessage = getMessage.replace(/[^\S\r\n]+$/gm, '');

    if (trimWrongNames) {
        // If this is an impersonation, delete the entire response if it starts with "{{char}}:"
        // If this isn't an impersonation, delete the entire response if it starts with "{{user}}:"
        // Also delete any trailing text that starts with the wrong name.
        // This only occurs if the corresponding "power_user.allow_nameX_display" is false.

        let wrongName = isImpersonate
            ? (!power_user.allow_name2_display ? name2 : '')  // char
            : (!power_user.allow_name1_display ? name1 : '');  // user

        if (wrongName) {
            // If the message starts with the wrong name, delete the entire response
            let startIndex = getMessage.indexOf(`${wrongName}:`);
            if (startIndex === 0) {
                getMessage = '';
                console.debug(`Message started with the wrong name: "${wrongName}" - response was deleted.`);
            }

            // If there is trailing text starting with the wrong name, trim it off.
            startIndex = getMessage.indexOf(`\n${wrongName}:`);
            if (startIndex >= 0) {
                getMessage = getMessage.substring(0, startIndex);
            }
        }
    }

    if (getMessage.indexOf('<|endoftext|>') != -1) {
        getMessage = getMessage.substring(0, getMessage.indexOf('<|endoftext|>'));
    }
    // clean-up group message from excessive generations
    if (selected_group) {
        getMessage = cleanGroupMessage(getMessage);
    }

    if (!power_user.allow_name2_display) {
        const name2Escaped = escapeRegex(name2);
        getMessage = getMessage.replace(new RegExp(`(^|\n)${name2Escaped}:\\s*`, 'g'), '$1');
    }

    if (isImpersonate) {
        getMessage = getMessage.trim();
    }

    if (power_user.auto_fix_generated_markdown) {
        getMessage = fixMarkdown(getMessage, false);
    }

    if (trimNames) {
        // If this is an impersonation, trim "{{user}}:" from the beginning
        // If this isn't an impersonation, trim "{{char}}:" from the beginning.
        // Only applied when the corresponding "power_user.allow_nameX_display" is false.
        const nameToTrim2 = isImpersonate
            ? (!power_user.allow_name1_display ? name1 : '')  // user
            : (!power_user.allow_name2_display ? name2 : '');  // char

        if (nameToTrim2 && getMessage.startsWith(nameToTrim2 + ':')) {
            getMessage = getMessage.replace(nameToTrim2 + ':', '');
            getMessage = getMessage.trimStart();
        }
    }

    if (isImpersonate) {
        getMessage = getMessage.trim();
    }

    if (!displayIncompleteSentences && power_user.trim_sentences) {
        getMessage = trimToEndSentence(getMessage);
    }

    if (power_user.trim_spaces && !PromptReasoning.getLatestPrefix()) {
        getMessage = getMessage.trim();
    }

    return getMessage;
}

/**
 * Adds an image to the message.
 * @param {object} message Message object
 * @param {object} sources Image sources
 * @param {string[]} [sources.imageUrls] Image URLs
 *
 * @returns {Promise<void>}
 */
async function processImageAttachment(message, { imageUrls }) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        return;
    }

    for (const [index, imageUrl] of imageUrls.filter(onlyUnique).entries()) {
        if (!imageUrl) {
            continue;
        }
        const title = `inline_image_${Date.now().toString()}_${index}`;
        try {
            const attachment = await createImageAttachmentFromUrl(imageUrl, {
                title,
                source: MEDIA_SOURCE.API,
                unavailableOnFailure: true,
            });
            if (attachment) {
                saveImageToMessage({ attachment, inline: true }, message);
            }
        } catch (error) {
            console.error('Failed to process generated image attachment', error);
            saveImageToMessage({
                attachment: markImageAttachmentUnavailable({
                    type: MEDIA_TYPE.IMAGE,
                    title,
                    source: MEDIA_SOURCE.API,
                    originalUrl: String(imageUrl || ''),
                }, error?.message || 'This image could not be ingested and was skipped.'),
                inline: true,
            }, message);
        }
    }
}

/**
 * Saves a resulting message to the chat.
 * @param {SaveReplyParams} params
 * @returns {Promise<SaveReplyResult>} Promise when the message is saved
 *
 * @typedef {object} SaveReplyParams
 * @property {string} type Type of generation
 * @property {string} getMessage Generated message
 * @property {boolean} [fromStreaming] If the message is from streaming
 * @property {string} [title] Message tooltip
 * @property {string[]} [swipes] Extra swipes
 * @property {string[]} [swipeReasoning] Reasoning for extra swipes
 * @property {string} [reasoning] Message reasoning
 * @property {string[]} [imageUrls] Links to images
 *
 * @typedef {object} SaveReplyResult
 * @property {string} type Type of generation
 * @property {string} getMessage Generated message
 */
export async function saveReply({ type, getMessage, fromStreaming = false, title = '', swipes = [], swipeReasoning = [], reasoning = '', imageUrls = [], openAIRequestId = null }) {
    // Backward compatibility
    if (arguments.length > 1 && typeof arguments[0] !== 'object') {
        console.trace('saveReply called with positional arguments. Please use an object instead.');
        [type, getMessage, fromStreaming, title, swipes, reasoning, imageUrls] = arguments;
    }

    if (type != 'append' && type != 'continue' && type != 'appendFinal' && chat.length && (chat[chat.length - 1]['swipe_id'] === undefined ||
        chat[chat.length - 1]['is_user'])) {
        type = 'normal';
    }

    if (chat.length && (!chat[chat.length - 1]['extra'] || typeof chat[chat.length - 1]['extra'] !== 'object')) {
        chat[chat.length - 1]['extra'] = {};
    }

    // Coerce null/undefined to empty string
    if (chat.length && !chat[chat.length - 1]['extra']['reasoning']) {
        chat[chat.length - 1]['extra']['reasoning'] = '';
    }

    if (!reasoning) {
        reasoning = '';
    }

    const {
        timedWorldInfo,
        promptInspectionResponseData,
        worldInfoResponseData,
    } = fromStreaming
        ? {
            timedWorldInfo: null,
            promptInspectionResponseData: null,
            worldInfoResponseData: null,
        }
        : consumeOpenAIResponseData(openAIRequestId);

    let oldMessage = '';
    const generationFinished = new Date();
    if (type === 'swipe') {
        oldMessage = chat[chat.length - 1]['mes'];
        chat[chat.length - 1]['swipes'].length++;
        if (chat[chat.length - 1]['swipe_id'] === chat[chat.length - 1]['swipes'].length - 1) {
            chat[chat.length - 1]['title'] = title;
            chat[chat.length - 1]['mes'] = getMessage;
            chat[chat.length - 1]['gen_started'] = generation_started;
            chat[chat.length - 1]['gen_finished'] = generationFinished;
            chat[chat.length - 1]['send_date'] = getMessageTimeStamp();
            chat[chat.length - 1]['extra']['api'] = getGeneratingApi();
            chat[chat.length - 1]['extra']['model'] = getGeneratingModel();
            chat[chat.length - 1]['extra']['reasoning'] = reasoning;
            chat[chat.length - 1]['extra']['reasoning_duration'] = null;
            await processImageAttachment(chat[chat.length - 1], { imageUrls });
            if (power_user.message_token_count_enabled) {
                const tokenCountText = (reasoning || '') + chat[chat.length - 1]['mes'];
                chat[chat.length - 1]['extra']['token_count'] = await getTokenCountAsync(tokenCountText, 0);
            }
            const chat_id = (chat.length - 1);
            !fromStreaming && await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, type);
            addOneMessage(chat[chat_id], { type: 'swipe' });
            !fromStreaming && await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, type);
        } else {
            chat[chat.length - 1]['mes'] = getMessage;
        }
    } else if (type === 'append' || type === 'continue') {
        console.debug('Trying to append.');
        oldMessage = chat[chat.length - 1]['mes'];
        chat[chat.length - 1]['title'] = title;
        chat[chat.length - 1]['mes'] += getMessage;
        chat[chat.length - 1]['gen_started'] = generation_started;
        chat[chat.length - 1]['gen_finished'] = generationFinished;
        chat[chat.length - 1]['send_date'] = getMessageTimeStamp();
        chat[chat.length - 1]['extra']['api'] = getGeneratingApi();
        chat[chat.length - 1]['extra']['model'] = getGeneratingModel();
        chat[chat.length - 1]['extra']['reasoning'] = reasoning;
        chat[chat.length - 1]['extra']['reasoning_duration'] = null;
        await processImageAttachment(chat[chat.length - 1], { imageUrls });
        if (power_user.message_token_count_enabled) {
            const tokenCountText = (reasoning || '') + chat[chat.length - 1]['mes'];
            chat[chat.length - 1]['extra']['token_count'] = await getTokenCountAsync(tokenCountText, 0);
        }
        const chat_id = (chat.length - 1);
        !fromStreaming && await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, type);
        addOneMessage(chat[chat_id], { type: 'swipe' });
        !fromStreaming && await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, type);
    } else if (type === 'appendFinal') {
        oldMessage = chat[chat.length - 1]['mes'];
        console.debug('Trying to appendFinal.');
        chat[chat.length - 1]['title'] = title;
        chat[chat.length - 1]['mes'] = getMessage;
        chat[chat.length - 1]['gen_started'] = generation_started;
        chat[chat.length - 1]['gen_finished'] = generationFinished;
        chat[chat.length - 1]['send_date'] = getMessageTimeStamp();
        chat[chat.length - 1]['extra']['api'] = getGeneratingApi();
        chat[chat.length - 1]['extra']['model'] = getGeneratingModel();
        chat[chat.length - 1]['extra']['reasoning'] += reasoning;
        await processImageAttachment(chat[chat.length - 1], { imageUrls });
        // We don't know if the reasoning duration extended, so we don't update it here on purpose.
        if (power_user.message_token_count_enabled) {
            const tokenCountText = (reasoning || '') + chat[chat.length - 1]['mes'];
            chat[chat.length - 1]['extra']['token_count'] = await getTokenCountAsync(tokenCountText, 0);
        }
        const chat_id = (chat.length - 1);
        !fromStreaming && await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, type);
        addOneMessage(chat[chat_id], { type: 'swipe' });
        !fromStreaming && await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, type);

    } else {
        console.debug('entering chat update routine for non-swipe post');
        chat[chat.length] = {};
        chat[chat.length - 1]['extra'] = {};
        chat[chat.length - 1]['name'] = name2;
        chat[chat.length - 1]['is_user'] = false;
        chat[chat.length - 1]['send_date'] = getMessageTimeStamp();
        chat[chat.length - 1]['extra']['api'] = getGeneratingApi();
        chat[chat.length - 1]['extra']['model'] = getGeneratingModel();
        chat[chat.length - 1]['extra']['reasoning'] = reasoning;
        chat[chat.length - 1]['extra']['reasoning_duration'] = null;
        if (power_user.trim_spaces) {
            getMessage = getMessage.trim();
        }
        chat[chat.length - 1]['mes'] = getMessage;
        chat[chat.length - 1]['title'] = title;
        chat[chat.length - 1]['gen_started'] = generation_started;
        chat[chat.length - 1]['gen_finished'] = generationFinished;

        if (power_user.message_token_count_enabled) {
            const tokenCountText = (reasoning || '') + chat[chat.length - 1]['mes'];
            chat[chat.length - 1]['extra']['token_count'] = await getTokenCountAsync(tokenCountText, 0);
        }

        if (selected_group) {
            console.debug('entering chat update for groups');
            let avatarImg = 'img/ai4.png';
            if (characters[this_chid].avatar != 'none') {
                avatarImg = getThumbnailUrl('avatar', characters[this_chid].avatar);
            }
            chat[chat.length - 1]['force_avatar'] = avatarImg;
            chat[chat.length - 1]['original_avatar'] = characters[this_chid].avatar;
            chat[chat.length - 1]['extra']['gen_id'] = group_generation_id;
        }

        await processImageAttachment(chat[chat.length - 1], { imageUrls });
        const chat_id = (chat.length - 1);

        !fromStreaming && await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, type);
        addOneMessage(chat[chat_id]);
        !fromStreaming && await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, type);
    }

    const item = chat[chat.length - 1];
    if (!item.extra || typeof item.extra !== 'object') {
        item.extra = {};
    }
    applyTimedWorldInfoToMessage(chat.length - 1, timedWorldInfo);
    applyPromptInspectionResponseDataToMessage(chat.length - 1, promptInspectionResponseData, {
        allowFallbackPromptSnapshotKey: !fromStreaming,
    });
    applyWorldInfoResponseDataToMessage(chat.length - 1, worldInfoResponseData);
    if (item['swipe_info'] === undefined) {
        item['swipe_info'] = [];
    }
    if (item['swipe_id'] !== undefined) {
        const swipeId = item['swipe_id'];
        item['swipes'][swipeId] = item['mes'];
        item['swipe_info'][swipeId] = {
            send_date: item['send_date'],
            gen_started: item['gen_started'],
            gen_finished: item['gen_finished'],
            extra: structuredClone(item['extra']),
        };
    } else {
        item['swipe_id'] = 0;
        item['swipes'] = [];
        item['swipes'][0] = chat[chat.length - 1]['mes'];
        item['swipe_info'][0] = {
            send_date: chat[chat.length - 1]['send_date'],
            gen_started: chat[chat.length - 1]['gen_started'],
            gen_finished: chat[chat.length - 1]['gen_finished'],
            extra: structuredClone(chat[chat.length - 1]['extra']),
        };
    }

    if (Array.isArray(swipes) && swipes.length > 0) {
        const swipeInfoExtra = structuredClone(item.extra ?? {});
        delete swipeInfoExtra.token_count;
        delete swipeInfoExtra.reasoning;
        delete swipeInfoExtra.reasoning_duration;
        const swipeInfo = {
            send_date: item.send_date,
            gen_started: item.gen_started,
            gen_finished: item.gen_finished,
            extra: swipeInfoExtra,
        };
        const startingSwipeIndex = Array.isArray(item.swipes) ? item.swipes.length : 0;
        const basePromptSnapshotKey = typeof item.extra?.promptSnapshotKey === 'string' ? item.extra.promptSnapshotKey : null;
        const swipeInfoArray = Array(swipes.length).fill().map((_, index) => {
            const swipeInfoClone = structuredClone(swipeInfo);
            const swipePromptSnapshotKey = basePromptSnapshotKey
                ? rekeyPromptSnapshotKey(basePromptSnapshotKey, { mesId: chat.length - 1, swipeId: startingSwipeIndex + index })
                : null;
            if (swipePromptSnapshotKey) {
                swipeInfoClone.extra.promptSnapshotKey = swipePromptSnapshotKey;
            }
            return swipeInfoClone;
        });
        parseReasoningInSwipes(swipes, swipeInfoArray, item.extra?.reasoning_duration);
        applyReasoningToSwipeInfoArray(swipeReasoning, swipeInfoArray, item.extra?.reasoning_duration);
        item.swipes.push(...swipes);
        item.swipe_info.push(...swipeInfoArray);
    }

    if (!fromStreaming) {
        await commitLatestPromptInspectorRecord(chat.length - 1);
    }

    statMesProcess(chat[chat.length - 1], type, characters, this_chid, oldMessage);
    return { type, getMessage };
}

function applyTimedWorldInfoToMessage(messageId, timedWorldInfo) {
    if (!timedWorldInfo || typeof timedWorldInfo !== 'object') {
        return;
    }

    const item = chat[messageId];
    if (!item) {
        return;
    }

    item.extra ??= {};
    item.extra.timedWorldInfo = structuredClone(timedWorldInfo);
    chat_metadata.timedWorldInfo = structuredClone(timedWorldInfo);
}

function applyWorldInfoResponseDataToMessage(messageId, worldInfoResponseData) {
    if (!worldInfoResponseData || typeof worldInfoResponseData !== 'object') {
        return;
    }

    const item = chat[messageId];
    if (!item) {
        return;
    }

    const worldInfoSummary = worldInfoResponseData.worldInfoSummary;
    const worldInfoReport = worldInfoResponseData.worldInfoReport;
    if ((!worldInfoSummary || typeof worldInfoSummary !== 'object') && (!worldInfoReport || typeof worldInfoReport !== 'object')) {
        return;
    }

    item.extra ??= {};

    if (worldInfoSummary && typeof worldInfoSummary === 'object') {
        item.extra.worldInfoSummary = structuredClone(worldInfoSummary);
        chat_metadata.worldInfoSummary = structuredClone(worldInfoSummary);
    }

    if (worldInfoReport && typeof worldInfoReport === 'object') {
        item.extra.worldInfoReport = structuredClone(worldInfoReport);
        chat_metadata.worldInfoReport = structuredClone(worldInfoReport);
    }
}

/**
 * Syncs the current message and all its data into the swipe data at the given message ID (or the last message if no ID is given).
 *
 * If the swipe data is invalid in some way, this function will exit out without doing anything.
 * @param {number?} [messageId=null] - The ID of the message to sync with the swipe data. If no ID is given, the last message is used.
 * @returns {boolean} Whether the message was successfully synced
 */
export function syncMesToSwipe(messageId = null) {
    if (!chat.length) {
        return false;
    }

    const targetMessageId = messageId ?? chat.length - 1;
    if (targetMessageId >= chat.length || targetMessageId < 0) {
        console.warn(`[syncMesToSwipe] Invalid message ID: ${messageId}`);
        return false;
    }

    const targetMessage = chat[targetMessageId];
    if (!targetMessage) {
        return false;
    }

    // No swipe data there yet, exit out
    if (typeof targetMessage.swipe_id !== 'number') {
        return false;
    }
    // If swipes structure is invalid, exit out (for now?)
    if (!Array.isArray(targetMessage.swipe_info) || !Array.isArray(targetMessage.swipes)) {
        return false;
    }
    // If the swipe is not present yet, exit out (will likely be copied later)
    // "" is falsy. An empty string is a valid message.
    if (typeof targetMessage.swipes[targetMessage.swipe_id] !== 'string' || !targetMessage.swipe_info[targetMessage.swipe_id]) {
        return false;
    }

    const targetSwipeInfo = targetMessage.swipe_info[targetMessage.swipe_id];
    if (typeof targetSwipeInfo !== 'object') {
        return false;
    }

    targetMessage.swipes[targetMessage.swipe_id] = targetMessage.mes;

    targetSwipeInfo.send_date = targetMessage.send_date;
    targetSwipeInfo.gen_started = targetMessage.gen_started;
    targetSwipeInfo.gen_finished = targetMessage.gen_finished;
    targetSwipeInfo.extra = structuredClone(targetMessage.extra);

    return true;
}

function restoreTimedWorldInfoFromChat(messageId = null) {
    restoreWorldInfoResponseDataFromChat(messageId);

    if (!Array.isArray(chat) || chat.length === 0) {
        delete chat_metadata.timedWorldInfo;
        return false;
    }

    const startIndex = Math.min(
        typeof messageId === 'number' ? messageId : chat.length - 1,
        chat.length - 1,
    );

    for (let index = startIndex; index >= 0; index--) {
        const snapshot = chat[index]?.extra?.timedWorldInfo;
        if (snapshot && typeof snapshot === 'object') {
            chat_metadata.timedWorldInfo = structuredClone(snapshot);
            return true;
        }
    }

    delete chat_metadata.timedWorldInfo;
    return false;
}

function restoreWorldInfoResponseDataFromChat(messageId = null) {
    if (!Array.isArray(chat) || chat.length === 0) {
        delete chat_metadata.worldInfoSummary;
        delete chat_metadata.worldInfoReport;
        return false;
    }

    const startIndex = Math.min(
        typeof messageId === 'number' ? messageId : chat.length - 1,
        chat.length - 1,
    );

    for (let index = startIndex; index >= 0; index--) {
        const summarySnapshot = chat[index]?.extra?.worldInfoSummary;
        const reportSnapshot = chat[index]?.extra?.worldInfoReport;

        if ((summarySnapshot && typeof summarySnapshot === 'object') || (reportSnapshot && typeof reportSnapshot === 'object')) {
            if (summarySnapshot && typeof summarySnapshot === 'object') {
                chat_metadata.worldInfoSummary = structuredClone(summarySnapshot);
            } else {
                delete chat_metadata.worldInfoSummary;
            }

            if (reportSnapshot && typeof reportSnapshot === 'object') {
                chat_metadata.worldInfoReport = structuredClone(reportSnapshot);
            } else {
                delete chat_metadata.worldInfoReport;
            }

            return true;
        }
    }

    delete chat_metadata.worldInfoSummary;
    delete chat_metadata.worldInfoReport;
    return false;
}

/**
 * Syncs swipe data back to the message data at the given message ID (or the last message if no ID is given).
 * If the swipe ID is not provided, the current swipe ID in the message object is used.
 *
 * If the swipe data is invalid in some way, this function will exit out without doing anything.
 * @param {number?} [messageId=null] - The ID of the message to sync with the swipe data. If no ID is given, the last message is used.
 * @param {number?} [swipeId=null] - The ID of the swipe to sync. If no ID is given, the current swipe ID in the message object is used.
 * @returns {boolean} Whether the swipe data was successfully synced to the message
 */
export function syncSwipeToMes(messageId = null, swipeId = null) {
    if (!chat.length) {
        return false;
    }

    const targetMessageId = messageId ?? chat.length - 1;
    if (targetMessageId >= chat.length || targetMessageId < 0) {
        console.warn(`[syncSwipeToMes] Invalid message ID: ${messageId}`);
        return false;
    }

    const targetMessage = chat[targetMessageId];
    if (!targetMessage) {
        return false;
    }

    if (swipeId !== null) {
        if (isNaN(swipeId) || swipeId < 0) {
            console.warn(`[syncSwipeToMes] Invalid swipe ID: ${swipeId}`);
            return false;
        }
        targetMessage.swipe_id = swipeId;
    }

    // No swipe data there yet, exit out
    if (typeof targetMessage.swipe_id !== 'number') {
        return false;
    }
    // If swipes structure is invalid, exit out
    if (!Array.isArray(targetMessage.swipes)) {
        return false;
    }

    // Backfill swipe_info if missing.
    if (!Array.isArray(targetMessage.swipe_info)) {
        targetMessage.swipe_info = targetMessage.swipes.map(_ => ({
            send_date: targetMessage.send_date,
            gen_started: void 0,
            gen_finished: void 0,
            extra: {},
        }));
    }

    const targetSwipeId = targetMessage.swipe_id;
    if (typeof targetMessage.swipes[targetSwipeId] !== 'string') {
        console.warn(`[syncSwipeToMes] Invalid swipe ID: ${targetSwipeId}`);
        return false;
    }

    const targetSwipeInfo = targetMessage?.swipe_info?.[targetSwipeId];
    if (typeof targetSwipeInfo !== 'object') {
        console.warn(`[syncSwipeToMes] Invalid swipe info: ${targetSwipeId}`);
    }

    targetMessage.mes = targetMessage.swipes[targetSwipeId];
    targetMessage.send_date = targetSwipeInfo?.send_date;
    targetMessage.gen_started = targetSwipeInfo?.gen_started;
    targetMessage.gen_finished = targetSwipeInfo?.gen_finished;
    targetMessage.extra = structuredClone(targetSwipeInfo?.extra) ?? {};
    restoreTimedWorldInfoFromChat();

    return true;
}

/**
 * Applies model-provided reasoning blocks to generated swipe metadata.
 * @param {string[]} swipeReasoning Reasoning strings for generated swipes
 * @param {{extra: object}[]} swipeInfoArray Swipe metadata objects
 * @param {number?} duration Reasoning duration to associate with the swipe
 */
function applyReasoningToSwipeInfoArray(swipeReasoning, swipeInfoArray, duration) {
    if (power_user.strip_ai_thinking_from_response || !Array.isArray(swipeReasoning) || !Array.isArray(swipeInfoArray)) {
        return;
    }

    for (let index = 0; index < swipeInfoArray.length; index++) {
        const reasoning = trimSpaces(swipeReasoning[index] || '');
        if (!reasoning) {
            continue;
        }

        swipeInfoArray[index].extra.reasoning = getRegexedString(reasoning, regex_placement.REASONING);
        swipeInfoArray[index].extra.reasoning_duration = duration ?? null;
        swipeInfoArray[index].extra.reasoning_type = ReasoningType.Model;
    }
}

/**
 * Saves the image to the message object.
 * @param {ParsedImage} img Image object
 * @param {ChatMessage} mes Chat message object
 * @typedef {{ attachment?: MediaAttachment, inline?: boolean }} ParsedImage
 */
function saveImageToMessage(img, mes) {
    if (mes && img.attachment) {
        if (!mes.extra || typeof mes.extra !== 'object') {
            mes.extra = {};
        }
        if (!Array.isArray(mes.extra.media)) {
            mes.extra.media = [];
        }
        mes.extra.media.push(hydrateMediaAttachment(img.attachment));
        mes.extra.media_index = mes.extra.media.length - 1;
        mes.extra.inline_image = img.inline;
    }
}

export function getGeneratingApi() {
    return oai_settings.chat_completion_source || 'openai';
}

function getGeneratingModel(mes) {
    return getChatCompletionModel();
}

/**
 * A function mainly used to switch 'generating' state - setting it to false and activating the buttons again
 */
export function activateSendButtons() {
    is_send_press = false;
    hideStopButton();
    delete document.body.dataset.generating;
}

/**
 * A function mainly used to switch 'generating' state - setting it to true and deactivating the buttons
 */
export function deactivateSendButtons() {
    showStopButton();
    document.body.dataset.generating = 'true';
}

export function resetChatState() {
    // replaces deleted charcter name with system user since it will be displayed next.
    name2 = (this_chid === undefined && neutralCharacterName) ? neutralCharacterName : systemUserName;
    //unsets expected chid before reloading (related to getCharacters/printCharacters from using old arrays)
    setCharacterId(undefined);
    // sets up system user to tell user about having deleted a character
    chat.splice(0, chat.length, ...SAFETY_CHAT);
    // resets chat metadata
    chat_metadata = {};
    setChatSaveRevision(0);
    // resets the characters array, forcing getcharacters to reset
    characters.length = 0;
}

/**
 *
 * @param {'characters' | 'character_edit' | 'create' | 'group_edit' | 'group_create'} value
 */
export function setMenuType(value) {
    menu_type = value;
    // Allow custom CSS to see which menu type is active
    document.getElementById('right-nav-panel').dataset.menuType = menu_type;
}

export function setExternalAbortController(controller) {
    abortController = controller;
}

/**
 * Sets a character array index.
 * @param {number|string|undefined} value
 */
export function setCharacterId(value) {
    switch (typeof value) {
        case 'bigint':
        case 'number':
            this_chid = String(value);
            break;
        case 'string':
            this_chid = !isNaN(parseInt(value)) ? value : undefined;
            break;
        case 'object':
            this_chid = characters.indexOf(value) !== -1 ? String(characters.indexOf(value)) : undefined;
            break;
        case 'undefined':
            this_chid = undefined;
            break;
        default:
            console.error('Invalid character ID type:', value);
            break;
    }
}

export function setCharacterName(value) {
    name2 = value;
}

/**
 * Sets the API connection status of the application
 * @param {string|'no_connection'} value Connection status value
 */
export function setOnlineStatus(value) {
    const previousStatus = online_status;
    online_status = value;
    displayOnlineStatus();
    if (previousStatus !== online_status) {
        eventSource.emitAndWait(event_types.ONLINE_STATUS_CHANGED, online_status);
    }
}

export function setEditedMessageId(value) {
    this_edit_mes_id = value;
}

export function setSendButtonState(value) {
    is_send_press = value;
}

/**
 * Renames the currently selected character, updating relevant references and optionally renaming past chats.
 *
 * If no name is provided, a popup prompts for a new name. If the new name matches the current name,
 * the renaming process is aborted. The function sends a request to the server to rename the character
 * and handles updates to other related fields such as tags, lore, and author notes.
 *
 * If the renaming is successful, the character list is reloaded and the renamed character is selected.
 * Optionally, past chats can be renamed to reflect the new character name.
 *
 * @param {string?} [name=null] - The new name for the character. If not provided, a popup will prompt for it.
 * @param {object} [options] - Additional options.
 * @param {boolean} [options.silent=false] - If true, suppresses popups and warnings.
 * @param {boolean?} [options.renameChats=null] - If true, renames past chats to reflect the new character name.
 * @returns {Promise<boolean>} - Returns true if the character was successfully renamed, false otherwise.
 */

export async function renameCharacter(name = null, { silent = false, renameChats = null } = {}) {
    if (!name && silent) {
        toastr.warning(t`No character name provided.`, t`Rename Character`);
        return false;
    }
    if (this_chid === undefined) {
        toastr.warning(t`No character selected.`, t`Rename Character`);
        return false;
    }

    const oldAvatar = characters[this_chid].avatar;
    const newValue = name || await callGenericPopup('<h3>' + t`New name:` + '</h3>', POPUP_TYPE.INPUT, characters[this_chid].name);

    if (!newValue) {
        toastr.warning(t`No character name provided.`, t`Rename Character`);
        return false;
    }
    if (newValue === characters[this_chid].name) {
        toastr.info(t`Same character name provided, so name did not change.`, t`Rename Character`);
        return false;
    }

    const body = JSON.stringify({ avatar_url: oldAvatar, new_name: newValue });
    const response = await fetch('/api/characters/rename', {
        method: 'POST',
        headers: getRequestHeaders(),
        body,
    });

    try {
        if (response.ok) {
            const data = await response.json();
            const newAvatar = data.avatar;

            const oldName = getCharaFilename(null, { manualAvatarKey: oldAvatar });
            const newName = getCharaFilename(null, { manualAvatarKey: newAvatar });

            // Replace other auxiliary fields where was referenced by avatar key
            // Tag List
            renameTagKey(oldAvatar, newAvatar);

            // Additional lore books
            const charLore = world_info.charLore?.find(x => x.name == oldName);
            if (charLore) {
                charLore.name = newName;
                saveSettingsDebounced();
            }

            // Char-bound Author's Notes
            const charNote = extension_settings.note.chara?.find(x => x.name == oldName);
            if (charNote) {
                charNote.name = newName;
                saveSettingsDebounced();
            }

            // Update active character, if the current one was the currently active one
            if (active_character === oldAvatar) {
                active_character = newAvatar;
                saveSettingsDebounced();
            }

            await eventSource.emit(event_types.CHARACTER_RENAMED, oldAvatar, newAvatar);

            // Unload current character
            setCharacterId(undefined);
            // Reload characters list
            await getCharacters();

            // Find newly renamed character
            const newChId = characters.findIndex(c => c.avatar == data.avatar);

            if (newChId !== -1) {
                // Select the character after the renaming
                await selectCharacterById(newChId);

                // Async delay to update UI
                await delay(1);

                if (this_chid === undefined) {
                    throw new Error('New character not selected');
                }

                // Also rename as a group member
                await renameGroupMember(oldAvatar, newAvatar, newValue);
                const renamePastChatsConfirm = renameChats !== null
                    ? renameChats
                    : silent
                        ? false
                        : await Popup.show.confirm(
                            t`Character renamed!`,
                            `<p>${t`Past chats will still contain the old character name. Would you like to update the character name in previous chats as well?`}</p>
                            <i><b>${t`Sprites folder (if any) should be renamed manually.`}</b></i>`,
                        ) == POPUP_RESULT.AFFIRMATIVE;

                if (renamePastChatsConfirm) {
                    await renamePastChats(oldAvatar, newAvatar, newValue);
                    await reloadCurrentChat();
                    toastr.success(t`Character renamed and past chats updated!`, t`Rename Character`);
                } else {
                    toastr.success(t`Character renamed!`, t`Rename Character`);
                }
            }
            else {
                throw new Error('Newly renamed character was lost?');
            }
        }
        else {
            throw new Error('Could not rename the character');
        }
    }
    catch (error) {
        // Reloading to prevent data corruption
        if (!silent) await Popup.show.text(t`Rename Character`, t`Something went wrong. The page will be reloaded.`);
        else toastr.error(t`Something went wrong. The page will be reloaded.`, t`Rename Character`);

        console.log('Renaming character error:', error);
        location.reload();
        return false;
    }

    return true;
}

async function renamePastChats(oldAvatar, newAvatar, newName) {
    const pastChats = await getPastCharacterChats();

    for (const { file_name } of pastChats) {
        try {
            const fileNameWithoutExtension = file_name.replace('.jsonl', '');
            const getChatResponse = await fetch('/api/chats/get', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: newName,
                    file_name: fileNameWithoutExtension,
                    avatar_url: newAvatar,
                }),
                cache: 'no-cache',
            });

            if (getChatResponse.ok) {
                const currentChat = await getChatResponse.json();

                for (const message of currentChat) {
                    if (message.is_user || message.is_system || message.extra?.type == system_message_types.NARRATOR) {
                        continue;
                    }

                    if (message.name !== undefined) {
                        message.name = newName;
                    }
                }

                await eventSource.emit(event_types.CHARACTER_RENAMED_IN_PAST_CHAT, currentChat, oldAvatar, newAvatar);

                const saveChatResponse = await fetch('/api/chats/save', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        ch_name: newName,
                        file_name: fileNameWithoutExtension,
                        chat: currentChat,
                        avatar_url: newAvatar,
                    }),
                    cache: 'no-cache',
                });

                if (!saveChatResponse.ok) {
                    throw new Error('Could not save chat');
                }
            }
        } catch (error) {
            toastr.error(t`Past chat could not be updated: ${file_name}`);
            console.error(error);
        }
    }
}

export function saveChatDebounced() {
    const chid = this_chid;
    const selectedGroup = selected_group;

    cancelDebouncedChatSave();

    chatSaveTimeout = setTimeout(async () => {
        chatSaveTimeout = null;

        if (selectedGroup !== selected_group) {
            console.warn('Chat save timeout triggered, but group changed. Aborting.');
            return;
        }

        if (chid !== this_chid) {
            console.warn('Chat save timeout triggered, but chid changed. Aborting.');
            return;
        }

        console.debug('Chat save timeout triggered');
        await saveChatConditional();
        console.debug('Chat saved');
    }, DEFAULT_CHAT_SAVE_EDIT_TIMEOUT);
}

/**
 * Saves the chat to the server.
 * @param {object} [options] - Additional options.
 * @param {string} [options.chatName] The name of the chat file to save to
 * @param {object} [options.withMetadata] Additional metadata to save with the chat
 * @param {number} [options.mesId] The message ID to save the chat up to
 * @param {boolean} [options.force] Force the saving despite the integrity check result
 * @param {boolean} [options.syncLoadedMessages] Save the contiguous loaded message range on split-tail save
 * @param {boolean} [options.refreshTailAfterSave] Reload the newest server tail after a successful split-tail save
 *
 * @returns {Promise<void>}
 */
export async function saveChat({ chatName, withMetadata, mesId, force = false, syncLoadedMessages = false, refreshTailAfterSave = false } = {}) {
    if (arguments.length > 0 && typeof arguments[0] !== 'object') {
        console.trace('saveChat called with positional arguments. Please use an object instead.');
        [chatName, withMetadata, mesId, force] = arguments;
    }

    const normalizedMesId = Number.isInteger(Number(mesId)) ? Number(mesId) : undefined;

    const metadata = { ...chat_metadata, ...(withMetadata || {}) };
    const fileName = chatName ?? characters[this_chid]?.chat;

    if (!fileName && name2 === neutralCharacterName) {
        // TODO: Do something for a temporary chat with no character.
        return;
    }

    if (!fileName) {
        console.warn('saveChat called without chat_name and no chat file found');
        return;
    }

    characters[this_chid]['date_last_chat'] = Date.now();
    chat.forEach(function (item, i) {
        if (item['is_group']) {
            toastr.error(t`Trying to save group chat with regular saveChat function. Aborting to prevent corruption.`);
            throw new Error('Group chat saved from saveChat');
        }
    });

    if (normalizedMesId !== undefined && isSplitTailChat() && !isChatFullyHydrated()) {
        await hydrateCurrentChatForEditing();
    }

    let trimmedChat = [];
    let saveMode = undefined;
    let absoluteStartId = undefined;
    let loadedRangeStart = undefined;
    const shouldTrackRevision = chatName === undefined && normalizedMesId === undefined;

    if (isSplitTailChat() && !isChatFullyHydrated() && chatName === undefined && normalizedMesId === undefined) {
        if (syncLoadedMessages) {
            const loadedRange = getContiguousLoadedChatRangeForSave();
            if (!loadedRange) {
                toastr.warning(t`Loaded chat messages are not contiguous. Reload the chat before syncing.`, t`Chat sync blocked`);
                return CHAT_SAVE_RESULT.FAILED;
            }

            loadedRangeStart = loadedRange.start;
            trimmedChat = loadedRange.messages;
            saveMode = 'loaded_range';
        } else {
            absoluteStartId = chatLoadState.tailStartId;
            trimmedChat = getContiguousChatMessagesForSave(absoluteStartId, getTotalChatMessages() - 1);
            if (!trimmedChat) {
                await ensureChatSuffixLoaded(absoluteStartId);
                trimmedChat = getContiguousChatMessagesForSave(absoluteStartId, getTotalChatMessages() - 1);
            }
            if (!trimmedChat) {
                toastr.warning(t`The loaded chat tail is incomplete. Reload the chat before saving.`, t`Chat save blocked`);
                return CHAT_SAVE_RESULT.FAILED;
            }
            saveMode = 'tail';
        }
    } else {
        const endId = normalizedMesId !== undefined
            ? Math.min(normalizedMesId, getTotalChatMessages() - 1)
            : getTotalChatMessages() - 1;
        trimmedChat = getDenseChatMessages(0, endId);
    }

    const chatToSave = [{
        user_name: name1,
        character_name: name2,
        create_date: chat_create_date,
        chat_metadata: metadata,
    }, ...trimmedChat];

    try {
        const result = await fetch('/api/chats/save', {
            method: 'POST',
            cache: 'no-cache',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: characters[this_chid].name,
                file_name: fileName,
                chat: chatToSave,
                avatar_url: characters[this_chid].avatar,
                force: force,
                save_mode: saveMode,
                absolute_start_id: absoluteStartId,
                loaded_range_start: loadedRangeStart,
                loaded_range_end: loadedRangeStart === undefined ? undefined : loadedRangeStart + trimmedChat.length - 1,
                saved_message_count: getTotalChatMessages(),
                refresh_tail: Boolean(refreshTailAfterSave && isSplitTailChat()),
                ...(shouldTrackRevision ? {
                    base_revision: getChatSaveRevision(),
                    save_session_id: getChatSaveSessionId(),
                } : {}),
                display_count: getConfiguredLongChatDisplayCount(),
                buffer_max: getConfiguredLongChatBufferMax(),
            }),
        });

        if (result.ok) {
            const responseData = await result.json();
            if (shouldTrackRevision) {
                setChatSaveRevision(responseData?.chat_revision);
            }

            if (refreshTailAfterSave && responseData?.payload) {
                await replaceChunkedChatPayloadWithLatestTail(responseData.payload);
            } else if (isSplitTailChat() && !isChatFullyHydrated() && saveMode === 'tail') {
                syncSplitTailStateAfterMutation();

                if (responseData?.payload) {
                    await replaceChunkedChatPayloadPreservingWindow(responseData.payload, { scrollToTail: true });
                } else {
                    const previousTailStartId = chatLoadState.tailStartId;
                    chatLoadState.storageMode = responseData?.storage_mode === CHAT_STORAGE_MODE_SPLIT_TAIL
                        ? CHAT_STORAGE_MODE_SPLIT_TAIL
                        : chatLoadState.storageMode;
                    if (Number.isInteger(responseData?.tailStartId)) {
                        chatLoadState.tailStartId = responseData.tailStartId;
                    }
                    if (Number.isInteger(responseData?.tailEndId)) {
                        chatLoadState.tailEndId = responseData.tailEndId;
                    }
                    if (Number.isInteger(responseData?.headCount)) {
                        chatLoadState.headCount = responseData.headCount;
                    }
                    if (Number.isInteger(responseData?.tailCount)) {
                        chatLoadState.tailCount = responseData.tailCount;
                    }
                    syncParentPromptCacheForTailStartChange(chatLoadState.tailStartId, previousTailStartId);
                }
            }
            return CHAT_SAVE_RESULT.SAVED;
        }

        const errorData = await result.json();
        if (errorData?.error === 'stale_revision') {
            warnStaleChatSave(errorData);
            return CHAT_SAVE_RESULT.FAILED;
        }

        const isIntegrityError = errorData?.error === 'integrity' && !force;
        if (!isIntegrityError) {
            const errorReason = errorData?.error || result.statusText || `HTTP ${result.status}`;
            throw new Error(`Chat save failed: ${errorReason}`);
        }

        const popupResult = await Popup.show.input(
            t`ERROR: Chat integrity check failed while saving the file.`,
            t`<p>After you click OK, the page will be reloaded to prevent data corruption.</p>
              <p>To confirm an overwrite (and potentially <b>LOSE YOUR DATA</b>), enter <code>OVERWRITE</code> (in all caps) in the box below before clicking OK.</p>`,
            '',
            { okButton: 'OK', cancelButton: false },
        );

        const forceSaveConfirmed = popupResult === 'OVERWRITE';

        if (!forceSaveConfirmed) {
            console.warn('Chat integrity check failed, and user did not confirm the overwrite. Reloading the page.');
            window.location.reload();
            return CHAT_SAVE_RESULT.FAILED;
        }

        return await saveChat({ chatName, withMetadata, mesId, force: true, syncLoadedMessages, refreshTailAfterSave });
    } catch (error) {
        console.error(error);
        toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Chat could not be saved`);
        return CHAT_SAVE_RESULT.FAILED;
    }
}

/**
 * Processes the avatar image from the input element, allowing the user to crop it if necessary.
 * @param {HTMLInputElement} input - The input element containing the avatar file.
 * @returns {Promise<void>}
 */
async function read_avatar_load(input) {
    if (input.files && input.files[0]) {
        if (selected_button == 'create') {
            create_save.avatar = input.files;
        }

        crop_data = undefined;
        const file = input.files[0];
        const fileData = await getBase64Async(file);

        if (!power_user.never_resize_avatars) {
            const dlg = new Popup('Set the crop position of the avatar image', POPUP_TYPE.CROP, '', { cropImage: fileData });
            const croppedImage = await dlg.show();

            if (!croppedImage) {
                return;
            }

            crop_data = dlg.cropData;
            $('#avatar_load_preview').attr('src', String(croppedImage));
        } else {
            $('#avatar_load_preview').attr('src', fileData);
        }

        if (menu_type == 'create') {
            return;
        }

        markCharacterEditorDirty();
        console.log('Avatar preview updated; save required to persist');
    }
}

/**
 * Gets the URL for a thumbnail of a specific type and file.
 * @param {import('../src/endpoints/thumbnails.js').ThumbnailType} type The type of the thumbnail to get
 * @param {string} file The file name or path for which to get the thumbnail URL
 * @param {boolean} [t=false] Whether to add a cache-busting timestamp to the URL
 * @returns {string} The URL for the thumbnail
 */
export function getThumbnailUrl(type, file, t = false) {
    return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}${t ? `&t=${Date.now()}` : ''}`;
}

export function buildAvatarList(block, entities, { templateId = 'inline_avatar_template', empty = true, interactable = false, highlightFavs = true } = {}) {
    if (empty) {
        block.empty();
    }

    for (const entity of entities) {
        const id = entity.id;

        // Populate the template
        const avatarTemplate = $(`#${templateId} .avatar`).clone();

        let this_avatar = default_avatar;
        if (entity.item.avatar !== undefined && entity.item.avatar != 'none') {
            this_avatar = getThumbnailUrl('avatar', entity.item.avatar);
        }

        avatarTemplate.attr('data-type', entity.type);
        avatarTemplate.attr('data-chid', id);
        avatarTemplate.find('img').attr('src', this_avatar).attr('alt', entity.item.name);
        avatarTemplate.attr('title', `[Character] ${entity.item.name}\nFile: ${entity.item.avatar}`);
        if (highlightFavs) {
            avatarTemplate.toggleClass('is_fav', entity.item.fav || entity.item.fav == 'true');
            avatarTemplate.find('.ch_fav').val(entity.item.fav);
        }

        // If this is a group, we need to hack slightly. We still want to keep most of the css classes and layout, but use a group avatar instead.
        if (entity.type === 'group') {
            const grpTemplate = getGroupAvatar(entity.item);

            avatarTemplate.addClass(grpTemplate.attr('class'));
            avatarTemplate.empty();
            avatarTemplate.append(grpTemplate.children());
            avatarTemplate.attr({ 'data-grid': id, 'data-chid': null });
            avatarTemplate.attr('title', `[Group] ${entity.item.name}`);
        }
        else if (entity.type === 'persona') {
            avatarTemplate.attr({ 'data-pid': id, 'data-chid': null });
            avatarTemplate.find('img').attr('src', getThumbnailUrl('persona', entity.item.avatar));
            avatarTemplate.attr('title', `[Persona] ${entity.item.name}\nFile: ${entity.item.avatar}`);
        }

        if (interactable) {
            avatarTemplate.addClass(INTERACTABLE_CONTROL_CLASS);
            avatarTemplate.toggleClass('character_select', entity.type === 'character');
            avatarTemplate.toggleClass('group_select', entity.type === 'group');
        }

        block.append(avatarTemplate);
    }
}

/**
 * Loads all the data of a shallow character.
 * @param {string|undefined} characterId Array index
 * @returns {Promise<void>} Promise that resolves when the character is unshallowed
 */
export async function unshallowCharacter(characterId) {
    if (characterId === undefined) {
        console.debug('Undefined character cannot be unshallowed');
        return;
    }

    /** @type {import('./scripts/char-data.js').v1CharData} */
    const character = characters[characterId];
    if (!character) {
        console.debug('Character not found:', characterId);
        return;
    }

    // Character is not shallow
    if (!character.shallow) {
        return;
    }

    const avatar = character.avatar;
    if (!avatar) {
        console.debug('Character has no avatar field:', characterId);
        return;
    }

    await getOneCharacter(avatar);
}

export async function getChat() {
    //console.log('/api/chats/get -- entered for -- ' + characters[this_chid].name);
    try {
        const response = await fetchChunkedChat({ includeParentPromptCache: true });
        // A brand-new chat may not have a file on disk yet. Treat that as a valid empty chat.
        const header = applyChunkedChatPayload(response, { replace: true, currentView: 'tail' });
        chat_create_date = header?.create_date ?? humanizedDateTime();
        chat_metadata = header?.chat_metadata ?? {};
        if (!chat_metadata['integrity']) {
            chat_metadata['integrity'] = uuidv4();
        }
        await ensureDeferredLoaderShown({ force: getTotalChatMessages() >= LONG_CHAT_DISPLAY_MIN });
        await waitForLoaderPaint();
        await getChatResult();
        eventSource.emit('chatLoaded', { detail: { id: this_chid, character: characters[this_chid] } });

        // Focus on the textarea if not already focused on a visible text input
        setTimeout(function () {
            if ($(document.activeElement).is('input:visible, textarea:visible')) {
                return;
            }
            $('#send_textarea').trigger('click').trigger('focus');
        }, 200);
    } catch (error) {
        console.error('Failed to load chat', error);
        toastr.error(t`Could not load this chat.`, t`Chat load failed`);
        return;
    }
}

/**
 * Renders a message into a detached message element for read-only snapshots such as the popout reader.
 * @param {ChatMessage} mes Message object
 * @param {number} messageId Absolute message ID
 * @returns {JQuery<HTMLElement>} Detached rendered message element
 */
export function renderDetachedMessage(mes, messageId) {
    let messageText = mes?.extra?.display_text ?? mes?.mes;
    const momentDate = timestampToMoment(mes?.send_date);
    const timestamp = momentDate.isValid() ? momentDate.format('LL LT') : '';

    let avatarImg = getThumbnailUrl('persona', user_avatar);
    const isSystem = mes?.is_system;
    const isPromptHidden = isPromptHiddenChatMessage(mes);
    const title = mes?.title;

    if (!mes?.is_user) {
        if (mes?.force_avatar) {
            avatarImg = mes.force_avatar;
        } else if (this_chid === undefined) {
            avatarImg = system_avatar;
        } else if (characters[this_chid]?.avatar !== 'none') {
            avatarImg = getThumbnailUrl('avatar', characters[this_chid].avatar);
        } else {
            avatarImg = default_avatar;
        }
    } else if (mes?.force_avatar) {
        avatarImg = mes.force_avatar;
    }

    const sanitizerOverrides = mes?.extra?.uses_system_ui ? { MESSAGE_ALLOW_SYSTEM_UI: true } : {};
    messageText = messageFormatting(
        messageText,
        mes?.name,
        isSystem,
        mes?.is_user,
        messageId,
        sanitizerOverrides,
        false,
    );
    const bias = messageFormatting(mes?.extra?.bias ?? '', '', false, false, -1, {}, false);
    const bookmarkLink = mes?.extra?.bookmark_link ?? '';
    const params = {
        mesId: messageId,
        swipeId: mes?.swipe_id ?? 0,
        characterName: mes?.name,
        isUser: mes?.is_user,
        avatarImg,
        bias,
        isSystem,
        title,
        bookmarkLink,
        forceAvatar: mes?.force_avatar,
        timestamp,
        extra: mes?.extra,
        tokenCount: mes?.extra?.token_count ?? 0,
        type: mes?.extra?.type ?? '',
        isPromptHidden,
        ...formatGenerationTimer(mes?.gen_started, mes?.gen_finished, mes?.extra?.token_count, mes?.extra?.reasoning_duration, mes?.extra?.time_to_first_token),
    };

    const renderedMessage = getMessageFromTemplate(params);
    const messageElement = $(renderedMessage);
    const isSmallSys = mes?.extra?.isSmallSys;

    if (isSmallSys === true) {
        messageElement.addClass('smallSysMes');
    }

    if (Array.isArray(mes?.extra?.tool_invocations)) {
        messageElement.addClass('toolCall');
    }

    messageElement.find('.mes_text').append(messageText);
    appendMediaToMessage(mes, messageElement, SCROLL_BEHAVIOR.NONE);
    addCopyToCodeBlocks(messageElement);

    if (!params.isUser && messageId !== 0 && messageId !== chat.length - 1) {
        const swipesNum = chat[messageId]?.swipes?.length;
        const swipeId = (chat[messageId]?.swipe_id ?? 0) + 1;
        if (swipesNum) {
            messageElement.find('.swipes-counter').text(formatSwipeCounter(swipeId, swipesNum));
        }
    }

    return messageElement;
}

async function getChatResult() {
    name2 = characters[this_chid].name;
    let freshChat = false;
    if (getTotalChatMessages() === 0) {
        const message = getFirstMessage();
        if (message.mes) {
            chat.length = 1;
            chat[0] = message;
            resetChatLoadState();
            mergeLoadedRange(0, 0);
            chatLoadState.tailStartId = 0;
            chatLoadState.tailEndId = 0;
            chatLoadState.tailCount = 1;
            freshChat = true;
        }
        // Make sure the chat appears on the server
        await saveChatConditional();
    }
    await loadItemizedPrompts(getCurrentChatId());
    await printMessages();
    select_selected_character(this_chid);

    await eventSource.emit(event_types.CHAT_CHANGED, (getCurrentChatId()));
    if (freshChat) await eventSource.emit(event_types.CHAT_CREATED);

    if (getTotalChatMessages() === 1 && chat[0]) {
        const chat_id = 0;
        await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, 'first_message');
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, 'first_message');
    }
}

function getFirstMessage() {
    const firstMes = characters[this_chid]?.first_mes || '';
    const alternateGreetings = characters[this_chid]?.data?.alternate_greetings;

    const message = {
        name: name2,
        is_user: false,
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: getRegexedString(firstMes, regex_placement.AI_OUTPUT),
        extra: {},
    };

    if (Array.isArray(alternateGreetings) && alternateGreetings.length > 0) {
        const swipes = [message.mes, ...(alternateGreetings.map(greeting => getRegexedString(greeting, regex_placement.AI_OUTPUT)))];

        if (!message.mes) {
            swipes.shift();
            message.mes = swipes[0];
        }

        message['swipe_id'] = 0;
        message['swipes'] = swipes;
        message['swipe_info'] = swipes.map(_ => ({
            send_date: message.send_date,
            gen_started: void 0,
            gen_finished: void 0,
            extra: {},
        }));
    }

    return message;
}

/**
 * Refreshes the first character message for an untouched solo chat.
 * Used when chat rendering inputs change without modifying the character card itself.
 * @returns {Promise<boolean>} Whether the first message was regenerated.
 */
export async function refreshPristineFirstMessage() {
    const shouldRegenerateMessage =
        !selected_group &&
        !chat_metadata['tainted'] &&
        (chat.length === 0 || (chat.length === 1 && !chat[0].is_user && !chat[0].is_system));

    if (!shouldRegenerateMessage) {
        return false;
    }

    const message = getFirstMessage();
    chat.splice(0, chat.length, message);
    const messageId = chat.length - 1;
    await eventSource.emit(event_types.MESSAGE_RECEIVED, messageId, 'first_message');
    await clearChat();
    await printMessages();
    await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, 'first_message');
    await saveChatConditional();

    return true;
}

export async function openCharacterChat(file_name) {
    await waitUntilCondition(() => !isChatSaving, debounce_timeout.extended, 10);
    const deferredLoader = deferLoader();

    try {
        await clearChat();
        characters[this_chid]['chat'] = file_name;
        chat.length = 0;
        chat_metadata = {};
        await getChat();
        $('#selected_chat_pole').val(file_name);
        await createOrEditCharacter(new CustomEvent('newChat'));
    } finally {
        await deferredLoader.clear();
    }
}

////////// OPTIMZED MAIN API CHANGE FUNCTION ////////////

export function changeMainAPI() {
    const selectedVal = 'openai';

    $('#openai_settings').css('display', 'block');
    $('#openai_api').css('display', 'block');
    $('#range_block_openai').css('display', 'block');
    $('#openai_api-presets').css('display', 'flex');
    $('#common-gen-settings-block').css('display', 'none');
    $('#prompt_cost_block').hide();

    main_api = selectedVal;
    setOnlineStatus('no_connection');
    setupChatCompletionPromptManager(oai_settings);
    forceCharacterEditorTokenize();
    return enforceChatCompletionsOnlyMode();
}

export function setUserName(value, { toastPersonaNameChange = true } = {}) {
    name1 = value;
    if (name1 === undefined || name1 == '')
        name1 = default_user_name;
    console.log(`User name changed to ${name1}`);
    $('#your_name').text(name1);
    if (toastPersonaNameChange && power_user.persona_show_notifications && !isPersonaPanelOpen()) {
        toastr.success(t`Your messages will now be sent as ${name1}`, t`Persona Changed`);
    }
    saveSettingsDebounced();
}

async function doOnboarding(avatarId) {
    const template = $('#onboarding_template .onboarding');
    let userName = await callGenericPopup(template, POPUP_TYPE.INPUT, currentUser?.name || name1, { wider: true, cancelButton: false });

    if (userName) {
        userName = String(userName).replace('\n', ' ');
        setUserName(userName);
        console.log(`Binding persona ${avatarId} to name ${userName}`);
        power_user.personas[avatarId] = userName;
        power_user.persona_descriptions[avatarId] = {
            description: '',
            position: persona_description_positions.IN_PROMPT,
        };
    }
}

function reloadLoop() {
    const MAX_RELOADS = 5;
    let reloads = Number(sessionStorage.getItem('reloads') || 0);
    if (reloads < MAX_RELOADS) {
        reloads++;
        sessionStorage.setItem('reloads', String(reloads));
        window.location.reload();
    }
}

//MARK: getSettings()
///////////////////////////////////////////
export async function getSettings() {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
        cache: 'no-cache',
    });

    if (!response.ok) {
        reloadLoop();
        toastr.error(t`Settings could not be loaded after multiple attempts. Please try again later.`);
        throw new Error('Error getting settings');
    }

    const data = await response.json();
    if (data.result != 'file not find' && data.settings) {
        settings = JSON.parse(data.settings);
        if (settings.username !== undefined && settings.username !== '') {
            name1 = settings.username;
            $('#your_name').text(name1);
        }

        accountStorage.init(settings?.accountStorage);
        await setUserControls(data.enable_accounts);

        // Allow subscribers to mutate settings
        await eventSource.emit(event_types.SETTINGS_LOADED_BEFORE, settings);

        //Load AI model config settings
        amount_gen = settings.amount_gen;
        if (settings.max_context !== undefined)
            max_context = parseInt(settings.max_context);

        swipes = settings.swipes !== undefined ? !!settings.swipes : true;  // enable swipes by default
        $('#swipes-checkbox').prop('checked', swipes); /// swipecode
        refreshSwipeButtons();

        // OpenAI
        loadOpenAISettings(data, settings.oai_settings ?? settings);

        // Load power user settings
        await loadPowerUserSettings(settings, data);

        // Apply theme toggles from power user settings
        applyPowerUserSettings();

        // Load character tags
        loadTagsSettings(settings);

        // Load background
        loadBackgroundSettings(settings);

        // Load proxy presets
        loadProxyPresets(settings);

        // Allow subscribers to mutate settings
        await eventSource.emit(event_types.SETTINGS_LOADED_AFTER, settings);

        // Set context size after loading power user (may override the max value)
        $('#max_context').val(max_context);
        $('#max_context_counter').val(max_context);

        $('#amount_gen').val(amount_gen);
        $('#amount_gen_counter').val(amount_gen);

        //Load which API we are using
        let didNormalizeMainApi = false;

        if (settings.main_api == undefined) {
            settings.main_api = 'openai';
            didNormalizeMainApi = true;
        }

        if (settings.main_api == 'poe') {
            settings.main_api = 'openai';
            didNormalizeMainApi = true;
        }

        if (CHAT_COMPLETIONS_ONLY && settings.main_api !== 'openai') {
            settings.main_api = 'openai';
            didNormalizeMainApi = true;
        }

        main_api = settings.main_api;
        $('#main_api').val(main_api);
        $(`#main_api option[value=${main_api}]`).attr('selected', 'true');
        const didEnforceChatCompletionsOnlyMode = changeMainAPI();
        if (didNormalizeMainApi || didEnforceChatCompletionsOnlyMode) {
            saveSettingsDebounced();
        }

        //Load User's Name and Avatar
        initUserAvatar(settings.user_avatar);
        setPersonaDescription();

        //Load the active character and group
        active_character = settings.active_character;
        active_group = settings.active_group;

        setWorldInfoSettings(settings.world_info_settings ?? settings, data);
        loadStmbSettings(settings);

        selected_button = settings.selected_button;

        if (data.enable_extensions) {
            const enableAutoUpdate = Boolean(data.enable_extensions_auto_update);
            const isVersionChanged = settings.currentVersion !== currentVersion;
            await loadExtensionSettings(settings, isVersionChanged, enableAutoUpdate);
            await eventSource.emit(event_types.EXTENSION_SETTINGS_LOADED);
        }

        firstRun = !!settings.firstRun;

        if (firstRun) {
            hideLoader();
            await doOnboarding(user_avatar);
            firstRun = false;
        }
    }
    settingsReady = true;
    await eventSource.emit(event_types.SETTINGS_LOADED);
}

//MARK: saveSettings()
export async function saveSettings(loopCounter = 0) {
    if (!settingsReady) {
        console.warn('Settings not ready, scheduling another save');
        saveSettingsDebounced();
        return;
    }

    const MAX_RETRIES = 3;
    if (TempResponseLength.isCustomized()) {
        if (loopCounter < MAX_RETRIES) {
            console.warn('Response length is currently being overridden, scheduling another save');
            saveSettingsDebounced(++loopCounter);
            return;
        }
        console.error('Response length is currently being overridden, but the save loop has reached the maximum number of retries');
        TempResponseLength.restoreAll();
    }

    const payload = {
        firstRun: firstRun,
        accountStorage: accountStorage.getState(),
        currentVersion: currentVersion,
        username: name1,
        active_character: active_character,
        active_group: active_group,
        user_avatar: user_avatar,
        amount_gen: amount_gen,
        max_context: max_context,
        main_api: main_api,
        world_info_settings: getWorldInfoSettings(),
        stmb_settings: getStmbSettings(),
        swipes: swipes,
        power_user: power_user,
        extension_settings: extension_settings,
        tags: tags,
        tag_map: tag_map,
        oai_settings: oai_settings,
        background: background_settings,
        proxies: proxies,
        selected_proxy: selected_proxy,
    };

    try {
        const result = await fetch('/api/settings/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(payload),
            cache: 'no-cache',
        });

        if (!result.ok) {
            throw new Error(`Failed to save settings: ${result.statusText}`);
        }

        settings = payload;
        await eventSource.emit(event_types.SETTINGS_UPDATED);
    } catch (error) {
        console.error('Error saving settings:', error);
        toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Settings could not be saved`);
    }
}

/**
 * Sets the generation parameters from a preset object.
 * @param {{ genamt?: number, max_length?: number }} preset Preset object
 */
export function setGenerationParamsFromPreset(preset) {
    const needsUnlock = (preset.max_length ?? max_context) > MAX_CONTEXT_DEFAULT || (preset.genamt ?? amount_gen) > MAX_RESPONSE_DEFAULT;
    $('#max_context_unlocked').prop('checked', needsUnlock).trigger('change');

    if (preset.genamt !== undefined) {
        amount_gen = preset.genamt;
        $('#amount_gen').val(amount_gen);
        $('#amount_gen_counter').val(amount_gen);
    }

    if (preset.max_length !== undefined) {
        max_context = preset.max_length;
        $('#max_context').val(max_context);
        $('#max_context_counter').val(max_context);
    }
}

// Common code for message editor done and auto-save
function updateMessage(div) {
    const mesBlock = div.closest('.mes_block');
    let text = mesBlock.find('.edit_textarea').val()
        ?? mesBlock.find('.mes_text').text();
    const mesElement = div.closest('.mes');
    const mes = chat[mesElement.attr('mesid')];

    let regexPlacement;
    if (mes.is_user) {
        regexPlacement = regex_placement.USER_INPUT;
    } else if (mes.extra?.type === 'narrator') {
        regexPlacement = regex_placement.SLASH_COMMAND;
    } else {
        regexPlacement = regex_placement.AI_OUTPUT;
    }

    // Ignore character override if sent as system
    text = getRegexedString(
        text,
        regexPlacement,
        {
            characterOverride: mes.extra?.type === 'narrator' ? undefined : mes.name,
            isEdit: true,
        },
    );


    if (power_user.trim_spaces) {
        text = text.trim();
    }

    const bias = substituteParams(extractMessageBias(text));
    text = substituteParams(text);
    if (bias) {
        text = removeMacros(text);
    }
    mes['mes'] = text;
    if (mes['swipe_id'] !== undefined) {
        mes['swipes'][mes['swipe_id']] = text;
    }

    // editing old messages
    if (!mes.extra) {
        mes.extra = {};
    }

    if (mes.is_system || mes.is_user || mes.extra.type === system_message_types.NARRATOR) {
        mes.extra.bias = bias ?? null;
    } else {
        mes.extra.bias = null;
    }

    chat_metadata['tainted'] = true;

    return { mesBlock, text, mes, bias };
}

function openMessageDelete(fromSlashCommand) {
    closeMessageEditor();
    hideSwipeButtons();
    if (fromSlashCommand || (!is_send_press) || (selected_group && !is_group_generating)) {
        $('#dialogue_del_mes').css('display', 'block');
        $('#send_form').css('display', 'none');
        $('.del_checkbox').each(function () {
            $(this).css('display', 'grid');
            $(this).parent().children('.for_checkbox').css('display', 'none');
        });
    } else {
        console.debug(`
            ERR -- could not enter del mode
            this_chid: ${this_chid}
            is_send_press: ${is_send_press}
            selected_group: ${selected_group}
            is_group_generating: ${is_group_generating}`);
    }
    this_del_mes = -1;
    is_delete_mode = true;
}

function messageEditAuto(div) {
    const { mesBlock, text, mes, bias } = updateMessage(div);

    mesBlock.find('.mes_text').val('');
    mesBlock.find('.mes_text').val(messageFormatting(
        text,
        this_edit_mes_chname,
        mes.is_system,
        mes.is_user,
        this_edit_mes_id,
        {},
        false,
    ));
    mesBlock.find('.mes_bias').empty();
    mesBlock.find('.mes_bias').append(messageFormatting(bias, '', false, false, -1, {}, false));
    saveChatDebounced();
}

/**
 * Create the message edit UI.
 * @param {number} editMessageId The ID of the message to edit
 */
export async function messageEdit(editMessageId) {
    if (!await ensureMessageEditable(editMessageId, 'edit this message')) {
        return;
    }

    const editMessage = chat[editMessageId];
    if (!editMessage) {
        console.warn(`Message with id ${editMessageId} not found in chat array.`);
        return;
    }

    const messageElement = chatElement.find(`.mes[mesid="${editMessageId}"]`);
    if (messageElement.length === 0) {
        console.warn(`Message element with id ${editMessageId} not found in DOM.`);
        return;
    }

    this_edit_mes_id = editMessageId;
    this_edit_mes_chname = editMessage.name || (editMessage.is_user ? name1 : name2);

    const hideCounters = editMessageId < chat.length - 1;
    hideSwipeButtons({ hideCounters });

    const chatScrollPosition = chatElement.scrollTop();
    const messageBlock = messageElement.find('.mes_block');
    const messageText = messageBlock.find('.mes_text');

    messageText.empty();
    messageBlock.find('.mes_buttons').css('display', 'none');
    messageBlock.find('.mes_edit_buttons').css('display', 'inline-flex');

    // Also edit reasoning, if it exists
    const reasoningEdit = messageBlock.find('.mes_reasoning_edit:visible');
    if (reasoningEdit.length > 0) {
        reasoningEdit.trigger('click');
    }

    const editTextArea = document.createElement('textarea');
    editTextArea.id = 'curEditTextarea';
    editTextArea.className = 'edit_textarea mdHotkeys';
    messageText.append(editTextArea);

    const text = trimSpaces(editMessage.mes || '');
    const $editTextArea = $(editTextArea);
    $editTextArea.val(text);

    const cssAutofit = CSS.supports('field-sizing', 'content');
    if (!cssAutofit) {
        $editTextArea.height(0);
        $editTextArea.height(editTextArea.scrollHeight);
    }

    $editTextArea.trigger('focus');

    // Sets the cursor at the end of the text
    editTextArea.setSelectionRange(text.length, text.length);

    if (Number(this_edit_mes_id) === chat.length - 1) {
        chatElement.scrollTop(chatScrollPosition);
    }

    updateEditArrowClasses();
}

/**
 * Close the open message editor.
 * This deletes the user's unsaved changes.
 * @param {number} [messageId=this_edit_mes_id]
 */
async function messageEditCancel(messageId = this_edit_mes_id) {
    let text = chat[messageId]['mes'];
    let thisMesDiv;
    // If this is the button then select it's parent. Otherwise, select by messageId.
    if (this?.classList?.contains('mes_edit_cancel')) {
        thisMesDiv = $(this).closest('.mes');
    } else {
        thisMesDiv = chatElement.children().filter(`[mesid="${messageId}"]`);
    }

    const thisMesBlock = thisMesDiv.find('.mes_block');
    thisMesBlock.find('.mes_text').empty();
    thisMesDiv.find('.mes_edit_buttons').css('display', 'none');
    thisMesBlock.find('.mes_buttons').css('display', '');
    thisMesBlock.find('.mes_text')
        .append(messageFormatting(
            text,
            this_edit_mes_chname,
            chat[messageId].is_system,
            chat[messageId].is_user,
            messageId,
            {},
            false,
        ));
    appendMediaToMessage(chat[messageId], thisMesDiv);
    addCopyToCodeBlocks(thisMesDiv);

    const reasoningEditDone = thisMesBlock.find('.mes_reasoning_edit_cancel:visible');
    if (reasoningEditDone.length > 0) {
        reasoningEditDone.trigger('click');
    }

    await eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
    if (messageId == this_edit_mes_id) {
        this_edit_mes_id = undefined;
    }
    else {
        console.warn(`The message editor was closed on message #${messageId} while #${this_edit_mes_id} is being edited.`);
    }

    showSwipeButtons();
}

/**
 * Swaps chat[sourceId] with chat[targetId]. They must be adjacent.
 * @param {number} sourceId Index of the message to move
 * @param {number} targetId Index of the target message
 * @returns {Promise<boolean>} True if the messages were moved, false otherwise
 */
async function messageEditMove(sourceId, targetId) {
    if (!await ensureMessageEditable(sourceId, 'reorder this message') || !await ensureMessageEditable(targetId, 'reorder this message')) {
        return false;
    }

    if (is_send_press) {
        console.warn(`The message #${sourceId} was not moved to #${targetId} because a generation is in progress.`);
        return false;
    }

    if (Math.abs(sourceId - targetId) !== 1) {
        console.error(`Message #${sourceId} and #${targetId} are not adjacent.`);
        return false;
    }

    const targetMessageDiv = chatElement.find(`.mes[mesid="${targetId}"]`);
    const sourceMessageDiv = chatElement.find(`.mes[mesid="${sourceId}"]`);

    if (sourceMessageDiv.length === 0 || targetMessageDiv.length === 0) {
        console.error(`Message #${sourceId} or #${targetId} were not found.`);
        return false;
    }

    if (sourceId <= targetId) {
        sourceMessageDiv.insertAfter(targetMessageDiv);
    }
    else {
        sourceMessageDiv.insertBefore(targetMessageDiv);
    }

    //Swap Ids.
    targetMessageDiv.attr('mesid', sourceId);
    sourceMessageDiv.attr('mesid', targetId);

    // Swap chat array entries.
    [chat[sourceId], chat[targetId]] = [chat[targetId], chat[sourceId]];

    // Update edited message id
    if (this_edit_mes_id === sourceId) {
        this_edit_mes_id = targetId;
    }

    updateViewMessageIds();
    await saveChatConditional();
    return true;
}

async function messageEditDone(div) {
    let { mesBlock, text, mes, bias } = updateMessage(div);
    if (this_edit_mes_id == 0) {
        text = substituteParams(text);
    }

    await eventSource.emit(event_types.MESSAGE_EDITED, this_edit_mes_id);
    text = chat[this_edit_mes_id]?.mes ?? text;
    mesBlock.find('.mes_text').empty();
    mesBlock.find('.mes_edit_buttons').css('display', 'none');
    mesBlock.find('.mes_buttons').css('display', '');
    mesBlock.find('.mes_text').append(
        messageFormatting(
            text,
            this_edit_mes_chname,
            mes.is_system,
            mes.is_user,
            this_edit_mes_id,
            {},
            false,
        ),
    );
    mesBlock.find('.mes_bias').empty();
    mesBlock.find('.mes_bias').append(messageFormatting(bias, '', false, false, -1, {}, false));
    appendMediaToMessage(mes, div.closest('.mes'));
    addCopyToCodeBlocks(div.closest('.mes'));

    const reasoningEditDone = mesBlock.find('.mes_reasoning_edit_done:visible');
    if (reasoningEditDone.length > 0) {
        reasoningEditDone.trigger('click');
    }

    await eventSource.emit(event_types.MESSAGE_UPDATED, this_edit_mes_id);
    this_edit_mes_id = undefined;
    await saveChatConditional();
    showSwipeButtons();
}

/**
 * Fetches the metadata of all past chats related to a specific character based on its avatar URL.
 * The function sends a POST request to the server to retrieve all chats for the character. It then
 * processes the received data, sorts it by the file name, and returns the sorted data.
 *
 * @param {null|number} [characterId=null] - When set, the function will use this character id instead of this_chid.
 *
 * @returns {Promise<Array>} - An array containing metadata of all past chats of the character, sorted
 * in descending order by file name. Returns an empty array if the fetch request is unsuccessful or the
 * response is an object with an `error` property set to `true`.
 */
export async function getPastCharacterChats(characterId = null) {
    characterId = characterId ?? parseInt(this_chid);
    if (!characters[characterId]) return [];

    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        body: JSON.stringify({ avatar_url: characters[characterId].avatar }),
        headers: getRequestHeaders(),
    });

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    if (typeof data === 'object' && data.error === true) {
        return [];
    }

    const chats = Object.values(data);
    return chats.sort((a, b) => a['file_name'].localeCompare(b['file_name'])).reverse();
}

/**
 * @typedef {{ type: 'character' | 'group', id: string|number }} ManageChatsOwnerContext
 */

function normalizeManageChatsOwner(ownerContext) {
    if (!ownerContext?.type || ownerContext?.id === undefined || ownerContext?.id === null || ownerContext?.id === '') {
        return null;
    }

    return {
        type: ownerContext.type === 'group' ? 'group' : 'character',
        id: ownerContext.type === 'group' ? String(ownerContext.id) : Number(ownerContext.id),
    };
}

function isSameManageChatsOwner(left, right) {
    const normalizedLeft = normalizeManageChatsOwner(left);
    const normalizedRight = normalizeManageChatsOwner(right);
    return !!normalizedLeft && !!normalizedRight
        && normalizedLeft.type === normalizedRight.type
        && String(normalizedLeft.id) === String(normalizedRight.id);
}

function serializeManageChatsOwnerValue(ownerContext) {
    const normalizedOwner = normalizeManageChatsOwner(ownerContext);
    return normalizedOwner ? `${normalizedOwner.type}:${normalizedOwner.id}` : '';
}

function parseManageChatsOwnerValue(value) {
    const [type, ...rest] = String(value ?? '').split(':');
    const id = rest.join(':');

    if (!type || !id) {
        return null;
    }

    return normalizeManageChatsOwner({ type, id });
}

function setManageChatsOwnerDataset(element, ownerContext) {
    const normalizedOwner = normalizeManageChatsOwner(ownerContext);
    if (!normalizedOwner) {
        return;
    }

    $(element)
        .attr('data-owner-type', normalizedOwner.type)
        .attr('data-owner-id', String(normalizedOwner.id));
}

function getManageChatsOwnerFromElement(element) {
    const target = $(element);
    const ownerType = target.attr('data-owner-type') || target.closest('[data-owner-type]').attr('data-owner-type');
    const ownerId = target.attr('data-owner-id') || target.closest('[data-owner-id]').attr('data-owner-id');
    return parseManageChatsOwnerValue(`${ownerType}:${ownerId}`);
}

function isManageChatsSelectableCharacter(character) {
    return !!character;
}

export function getCurrentManageChatsOwner() {
    if (selected_group) {
        return { type: 'group', id: String(selected_group) };
    }

    if (this_chid !== undefined && isManageChatsSelectableCharacter(characters[this_chid])) {
        return { type: 'character', id: Number(this_chid) };
    }

    return null;
}

function getManageChatsOwnerDetails(ownerContext = getCurrentManageChatsOwner()) {
    const normalizedOwner = normalizeManageChatsOwner(ownerContext);
    if (!normalizedOwner) {
        return {
            ownerContext: null,
            sessionName: '',
            group: null,
            characterName: '',
            avatarImgURL: '',
            avatarUrl: '',
            characterId: null,
            groupId: null,
            isGroup: false,
        };
    }

    if (normalizedOwner.type === 'group') {
        const group = groups.find(x => String(x.id) === String(normalizedOwner.id));
        if (!group) {
            return {
                ownerContext: null,
                sessionName: '',
                group: null,
                characterName: '',
                avatarImgURL: '',
                avatarUrl: '',
                characterId: null,
                groupId: null,
                isGroup: true,
            };
        }

        return {
            ownerContext: normalizedOwner,
            sessionName: group.chat_id || '',
            group: group,
            characterName: group.name || '',
            avatarImgURL: group.avatar_url || default_avatar,
            avatarUrl: '',
            characterId: null,
            groupId: String(group.id),
            isGroup: true,
        };
    }

    const character = characters[normalizedOwner.id];
    if (!isManageChatsSelectableCharacter(character)) {
        return {
            ownerContext: null,
            sessionName: '',
            group: null,
            characterName: '',
            avatarImgURL: '',
            avatarUrl: '',
            characterId: null,
            groupId: null,
            isGroup: false,
        };
    }

    return {
        ownerContext: normalizedOwner,
        sessionName: character.chat || '',
        group: null,
        characterName: character.name || '',
        avatarImgURL: getThumbnailUrl('avatar', character.avatar),
        avatarUrl: character.avatar,
        characterId: Number(normalizedOwner.id),
        groupId: null,
        isGroup: false,
    };
}

/**
 * Helper for `displayPastChats`, to make the same info consistently available for other functions
 * @param {ManageChatsOwnerContext?} [ownerContext]
 */
export function getCurrentChatDetails(ownerContext = getCurrentManageChatsOwner()) {
    return getManageChatsOwnerDetails(ownerContext);
}

function setManageChatsRowContext(element, context = {}) {
    const target = $(element);
    const rowType = String(context.rowType || '');
    const orphanKey = context.orphanKey ? String(context.orphanKey) : '';
    const groupId = context.groupId !== undefined && context.groupId !== null ? String(context.groupId) : '';

    if (rowType) {
        target.attr('data-manage-chats-row-type', rowType);
    } else {
        target.removeAttr('data-manage-chats-row-type');
    }

    if (orphanKey) {
        target.attr('data-orphan-key', orphanKey);
    } else {
        target.removeAttr('data-orphan-key');
    }

    if (groupId) {
        target.attr('data-group-id', groupId);
    } else {
        target.removeAttr('data-group-id');
    }

    if (context.ownerContext) {
        setManageChatsOwnerDataset(target, context.ownerContext);
    }
}

function getManageChatsRowContext(element) {
    const target = $(element);
    const rowType = target.attr('data-manage-chats-row-type') || target.closest('[data-manage-chats-row-type]').attr('data-manage-chats-row-type') || '';
    const orphanKey = target.attr('data-orphan-key') || target.closest('[data-orphan-key]').attr('data-orphan-key') || '';
    const groupId = target.attr('data-group-id') || target.closest('[data-group-id]').attr('data-group-id') || '';
    const ownerContext = getManageChatsOwnerFromElement(target);

    if (!rowType && !orphanKey && !groupId && !ownerContext) {
        return null;
    }

    return {
        rowType,
        orphanKey: orphanKey || null,
        groupId: groupId || null,
        ownerContext,
    };
}

function makeOrphanAvatarUrl(orphanKey) {
    return orphanKey ? `${String(orphanKey)}.png` : '';
}

function toggleManageChatsSelect(selector, visible) {
    const element = $(selector);
    element.toggle(visible);
    element.next('.select2-container').toggle(visible);
}

function refreshManageChatsModeUi() {
    const isDeletedMode = manageChatsMode === 'deleted';
    $('#manage_chats_mode_switch_label').text(isDeletedMode
        ? t`Switch to Current Chats`
        : t`Switch to Deleted Characters`);
    toggleManageChatsSelect('#manage_chats_owner_select', !isDeletedMode);
    toggleManageChatsSelect('#manage_chats_orphan_select', isDeletedMode);
    $('#newChatFromManageScreenButton, #chat_import_button').toggle(!isDeletedMode);
}

async function fetchManageChatsOrphanEntries({ query = '', orphanKey = null, updateCache = true } = {}) {
    const payload = {};
    if (String(query || '').trim()) {
        payload.query = String(query);
    }
    if (String(orphanKey || '').trim()) {
        payload.orphan_key = String(orphanKey);
    }

    const response = await fetch('/api/chats/orphaned', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error('Failed to load orphaned chats');
    }

    const data = await response.json();
    const entries = Array.isArray(data) ? data : [];
    if (updateCache) {
        manageChatsOrphanEntries = entries;
    }
    return entries;
}

function findManageChatsOrphanEntry(orphanKey) {
    return manageChatsOrphanEntries.find(entry => String(entry?.orphan_key) === String(orphanKey)) ?? null;
}

function populateManageChatsOrphanSelect(orphanKey = null) {
    const selector = $('#manage_chats_orphan_select');
    selector.find('option[value!=""]').remove();

    manageChatsOrphanEntries.forEach((entry) => {
        selector.append($('<option></option>')
            .val(String(entry.orphan_key))
            .text(String(entry.orphan_key)));
    });

    manageChatsOrphanSelectorSyncing = true;
    selector.val(orphanKey ? String(orphanKey) : '').trigger('change');
    manageChatsOrphanSelectorSyncing = false;
}

function updateManageChatsDeletedHeader(orphanKey) {
    $('#ChatHistoryCharName').text(orphanKey ? `${orphanKey} ` : `${t`Choose a deleted character`} `);
    $('#chat_import_avatar_url').val('');
    $('#chat_import_character_name').val('');
}

function initManageChatsOrphanSelect() {
    if (manageChatsOrphanSelectorInitialized) {
        return;
    }

    const selector = $('#manage_chats_orphan_select');
    if (!selector.length) {
        return;
    }

    if (!isMobile() && !selector.hasClass('select2-hidden-accessible')) {
        selector.select2({
            placeholder: t`--- Pick Deleted Character ---`,
            searchInputPlaceholder: t`Search...`,
            allowClear: true,
            closeOnSelect: true,
            multiple: false,
        });
    }

    selector.on('change', async function () {
        if (manageChatsOrphanSelectorSyncing) {
            return;
        }

        const nextOrphanKey = String($(this).find(':selected').val() || '').trim();
        await displayDeletedCharacterChats(nextOrphanKey || null);
    });

    manageChatsOrphanSelectorInitialized = true;
}

function initManageChatsModeToggle() {
    $('#manage_chats_mode_switch').on('click', async function () {
        if (manageChatsMode === 'deleted') {
            manageChatsMode = 'owners';
            await displayPastChats([], manageChatsOwnerContext ?? getCurrentManageChatsOwner());
            return;
        }

        manageChatsMode = 'deleted';
        await displayDeletedCharacterChats(manageChatsSelectedOrphanKey);
    });
}

function initManageChatsUi() {
    if (manageChatsUiInitialized) {
        return;
    }

    initManageChatsOwnerSelect();
    initManageChatsOrphanSelect();
    initManageChatsModeToggle();
    refreshManageChatsModeUi();
    manageChatsUiInitialized = true;
}

function populateManageChatsOwnerSelect(ownerContext = getCurrentManageChatsOwner()) {
    const normalizedOwner = normalizeManageChatsOwner(ownerContext);
    const selector = $('#manage_chats_owner_select');
    const characterGroup = $('#manage_chats_owner_select_characters');
    const groupGroup = $('#manage_chats_owner_select_groups');

    characterGroup.empty();
    groupGroup.empty();

    characters.forEach((character, index) => {
        if (!isManageChatsSelectableCharacter(character)) {
            return;
        }

        characterGroup.append($('<option></option>')
            .val(serializeManageChatsOwnerValue({ type: 'character', id: index }))
            .text(character.name || String(character.avatar || index)));
    });

    groups.forEach((group) => {
        if (!group) {
            return;
        }

        groupGroup.append($('<option></option>')
            .val(serializeManageChatsOwnerValue({ type: 'group', id: group.id }))
            .text(group.name || String(group.id)));
    });

    const serializedOwner = serializeManageChatsOwnerValue(normalizedOwner);
    manageChatsOwnerSelectorSyncing = true;
    selector.val(serializedOwner).trigger('change');
    manageChatsOwnerSelectorSyncing = false;
}

function updateManageChatsHeader(ownerContext) {
    const details = getManageChatsOwnerDetails(ownerContext);
    manageChatsOwnerContext = details.ownerContext;
    $('#ChatHistoryCharName').text(details.characterName ? `${details.characterName} ` : `${t`Choose a character`} `);

    if (details.characterId !== null) {
        $('#chat_import_avatar_url').val(details.avatarUrl);
        $('#chat_import_character_name').val(details.characterName);
    } else {
        $('#chat_import_avatar_url').val('');
        $('#chat_import_character_name').val('');
    }
}

function initManageChatsOwnerSelect() {
    if (manageChatsOwnerSelectorInitialized) {
        return;
    }

    const selector = $('#manage_chats_owner_select');
    if (!selector.length) {
        return;
    }

    if (!isMobile() && !selector.hasClass('select2-hidden-accessible')) {
        selector.select2({
            placeholder: t`--- Pick Owner ---`,
            searchInputPlaceholder: t`Search...`,
            allowClear: true,
            closeOnSelect: true,
            multiple: false,
        });
    }

    selector.on('change', async function () {
        if (manageChatsOwnerSelectorSyncing) {
            return;
        }

        const nextOwner = parseManageChatsOwnerValue($(this).val());
        if (!nextOwner) {
            await displayPastChats([], null);
            return;
        }

        if (isSameManageChatsOwner(nextOwner, manageChatsOwnerContext)) {
            return;
        }

        await displayPastChats([], nextOwner);
    });

    manageChatsOwnerSelectorInitialized = true;
}

async function switchToManageChatsOwner(ownerContext) {
    const normalizedOwner = normalizeManageChatsOwner(ownerContext);
    if (!normalizedOwner) {
        return false;
    }

    if (normalizedOwner.type === 'group') {
        if (String(selected_group) === String(normalizedOwner.id)) {
            return true;
        }

        return await openGroupById(String(normalizedOwner.id));
    }

    if (!selected_group && String(this_chid) === String(normalizedOwner.id)) {
        return true;
    }

    await selectCharacterById(Number(normalizedOwner.id), { switchMenu: false });
    return !selected_group && String(this_chid) === String(normalizedOwner.id);
}

export async function openManageChatsOwnerChat(ownerContext, fileName) {
    const normalizedOwner = normalizeManageChatsOwner(ownerContext);
    if (!normalizedOwner || !fileName) {
        return;
    }

    const switched = await switchToManageChatsOwner(normalizedOwner);
    if (!switched) {
        return;
    }

    if (normalizedOwner.type === 'group') {
        await openGroupChat(String(normalizedOwner.id), fileName);
    } else {
        await openCharacterChat(fileName);
    }
}

async function createNewManageChatsOwnerChat(ownerContext) {
    const switched = await switchToManageChatsOwner(ownerContext);
    if (!switched) {
        return;
    }

    await doNewChat({ deleteCurrentChat: false });
}

async function renameManageChatsOwnerChat(ownerContext, oldFileName, newName) {
    const details = getManageChatsOwnerDetails(ownerContext);
    if (!details.ownerContext) {
        return;
    }

    await renameGroupOrCharacterChat({
        characterId: details.characterId ?? undefined,
        groupId: details.groupId ?? undefined,
        oldFileName: oldFileName,
        newFileName: newName,
        loader: true,
    });
}

async function deleteManageChatsOwnerChat(ownerContext, fileName) {
    const details = getManageChatsOwnerDetails(ownerContext);
    if (!details.ownerContext) {
        return;
    }

    if (details.isGroup) {
        if (String(selected_group) === String(details.groupId)) {
            await deleteGroupChat(String(details.groupId), fileName);
        } else {
            await deleteGroupChatByName(String(details.groupId), fileName);
        }
        return;
    }

    if (!selected_group && String(this_chid) === String(details.characterId)) {
        await delChat(`${fileName}.jsonl`);
    } else if (details.characterId !== null) {
        await deleteCharacterChatByName(details.characterId, fileName);
    }
}

function escapeManageChatsHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatManageChatsHtmlText(text) {
    let formatted = escapeManageChatsHtml(text);
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return formatted;
}

function toManageChatsAbsoluteAssetUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
        return '';
    }

    if (/^(?:https?:|data:|blob:|file:)/i.test(value)) {
        return value;
    }

    if (value.startsWith('//')) {
        return `${window.location.protocol}${value}`;
    }

    if (value.startsWith('/')) {
        return `${window.location.origin}${value}`;
    }

    return `${window.location.origin}/${value.replace(/^\.?\//, '')}`;
}

function getManageChatsHtmlFallbackAvatar(rowContext) {
    if (rowContext?.rowType === 'orphan-character') {
        return toManageChatsAbsoluteAssetUrl(default_avatar);
    }

    const ownerDetails = getManageChatsOwnerDetails(rowContext?.ownerContext);
    if (ownerDetails.ownerContext) {
        return toManageChatsAbsoluteAssetUrl(ownerDetails.avatarImgURL || default_avatar);
    }

    return toManageChatsAbsoluteAssetUrl(default_avatar);
}

function getManageChatsHtmlOwnerLabel(rowContext) {
    if (rowContext?.rowType === 'orphan-character' && rowContext.orphanKey) {
        return String(rowContext.orphanKey);
    }

    const ownerDetails = getManageChatsOwnerDetails(rowContext?.ownerContext);
    if (ownerDetails.ownerContext) {
        return ownerDetails.characterName || String(ownerDetails.groupId || ownerDetails.characterId || '');
    }

    return t`Chat Export`;
}

function getManageChatsHtmlVisibleMessages(messages) {
    return Array.isArray(messages)
        ? messages.filter(message => message && (message.mes || message.extra?.display_text))
        : [];
}

function getManageChatsHtmlMessageAvatarUrl(rowContext, message, fallbackAvatar) {
    return toManageChatsAbsoluteAssetUrl(
        message.force_avatar
        || (message.original_avatar ? getThumbnailUrl('avatar', message.original_avatar) : '')
        || (message.is_system ? system_avatar : '')
        || (message.is_user ? default_user_avatar : '')
        || fallbackAvatar,
    ) || fallbackAvatar;
}

function escapeManageChatsCssUrl(url) {
    return String(url || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, '');
}

async function compressManageChatsHtmlAvatar(dataUrl, maxSize = 100, mimeType = 'image/webp', quality = 0.72) {
    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('Canvas context is not available.'));
                return;
            }

            const sourceSize = Math.min(img.width, img.height);
            const sourceX = (img.width - sourceSize) / 2;
            const sourceY = (img.height - sourceSize) / 2;

            canvas.width = maxSize;
            canvas.height = maxSize;
            ctx.clearRect(0, 0, maxSize, maxSize);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, maxSize, maxSize);

            let compressed = canvas.toDataURL(mimeType, quality);
            if (!compressed.startsWith(`data:${mimeType}`)) {
                compressed = canvas.toDataURL('image/jpeg', quality);
            }

            resolve(compressed);
        };
        img.onerror = () => reject(new Error('Failed to load avatar image.'));
    });
}

async function buildManageChatsHtmlAvatarAssets(rowContext, visibleMessages, fallbackAvatar) {
    const sourceMap = new Map();
    const cssRules = [];
    let classIndex = 1;

    async function registerSource(source) {
        const normalizedSource = String(source || '').trim() || fallbackAvatar;
        if (sourceMap.has(normalizedSource)) {
            return sourceMap.get(normalizedSource);
        }

        const asset = {
            className: `avatar-asset-${classIndex++}`,
            hasImage: false,
        };

        sourceMap.set(normalizedSource, asset);

        try {
            const dataUrl = normalizedSource.startsWith('data:')
                ? normalizedSource
                : await urlContentToDataUri(normalizedSource, { cache: 'force-cache' });
            const compressed = await compressManageChatsHtmlAvatar(dataUrl);
            cssRules.push(`.avatar.${asset.className} { background-image: url("${escapeManageChatsCssUrl(compressed)}"); }`);
            asset.hasImage = true;
        } catch (error) {
            console.warn('Failed to embed avatar for HTML export:', normalizedSource, error);
        }

        return asset;
    }

    const fallbackAsset = await registerSource(fallbackAvatar);

    for (const message of visibleMessages) {
        const source = getManageChatsHtmlMessageAvatarUrl(rowContext, message, fallbackAvatar);
        await registerSource(source);
    }

    return {
        sourceMap,
        fallbackAsset,
        cssText: cssRules.join('\n        '),
    };
}

async function fetchManageChatsHtmlExportMessages(rowContext, filename) {
    if (rowContext?.rowType === 'orphan-character' && rowContext.orphanKey) {
        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: rowContext.orphanKey,
                file_name: filename,
                avatar_url: makeOrphanAvatarUrl(rowContext.orphanKey),
            }),
            cache: 'no-cache',
        });

        if (!response.ok) {
            throw new Error('Could not load deleted character chat.');
        }

        return await response.json();
    }

    const ownerDetails = getManageChatsOwnerDetails(rowContext?.ownerContext);
    if (!ownerDetails.ownerContext) {
        throw new Error('Chat owner is not available.');
    }

    if (ownerDetails.isGroup) {
        const response = await fetch('/api/chats/group/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id: filename }),
        });

        if (!response.ok) {
            throw new Error('Could not load group chat.');
        }

        return await response.json();
    }

    const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ch_name: ownerDetails.characterName,
            file_name: filename,
            avatar_url: ownerDetails.avatarUrl,
        }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error('Could not load character chat.');
    }

    return await response.json();
}

async function buildManageChatsHtmlExport(rowContext, filename, messages) {
    const ownerLabel = escapeManageChatsHtml(getManageChatsHtmlOwnerLabel(rowContext));
    const chatTitle = escapeManageChatsHtml(filename);
    const generatedDate = escapeManageChatsHtml(new Date().toLocaleString());
    const fallbackAvatar = getManageChatsHtmlFallbackAvatar(rowContext);
    const visibleMessages = getManageChatsHtmlVisibleMessages(messages);
    const { sourceMap, fallbackAsset, cssText: avatarCssText } = await buildManageChatsHtmlAvatarAssets(rowContext, visibleMessages, fallbackAvatar);

    let messageNumber = 1;
    const bodyHtml = visibleMessages.map((message) => {
        const rawText = String(message.extra?.display_text || message.mes || '');
        const safeText = formatManageChatsHtmlText(rawText);
        const displayName = escapeManageChatsHtml(message.name || (message.is_user ? name1 : getManageChatsHtmlOwnerLabel(rowContext)));
        const timestamp = escapeManageChatsHtml(message.send_date || '');
        const avatarUrl = getManageChatsHtmlMessageAvatarUrl(rowContext, message, fallbackAvatar);
        const avatarAsset = sourceMap.get(avatarUrl);
        const avatarClassName = escapeManageChatsHtml((avatarAsset?.hasImage ? avatarAsset : fallbackAsset)?.className || fallbackAsset.className);
        const isThought = rawText.includes('▶ Thought');
        const isOoc = rawText.includes('[OOC:') || rawText.includes('[Okia:');
        let messageClass = 'message';

        if (isOoc) {
            messageClass += ' ooc-message';
        } else if (message.is_system) {
            messageClass += ' system-message';
        }

        const messageHtml = isThought
            ? safeText.replace('▶ Thought', '<span class="thought-indicator">▶ Thought</span><br>')
            : safeText;

        return `
            <div class="${messageClass}">
                <span class="message-number">#${messageNumber++}</span>
                <div class="avatar-container">
                    <div class="avatar ${avatarClassName}" role="img" aria-label="${displayName}"></div>
                </div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="character-name">${displayName}</span>
                        <span class="timestamp">${timestamp || 'No timestamp'}</span>
                    </div>
                    <div class="message-text">${messageHtml}</div>
                </div>
            </div>
        `;
    }).join('');

    const emptyState = visibleMessages.length ? '' : `<div class="empty-state">${escapeManageChatsHtml(t`This chat is empty.`)}</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${chatTitle} - Chat Export</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a1a, #2d2d2d);
            color: #e0e0e0;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
        }

        .header h1 {
            color: #df9fe0;
            font-size: 2.5em;
            margin-bottom: 10px;
        }

        .header p {
            color: #b0b0b0;
            font-size: 1.05em;
        }

        .content {
            background: #2a2a2a;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }

        .message {
            display: flex;
            gap: 15px;
            margin-bottom: 25px;
            padding: 15px;
            background: #222222;
            border-radius: 5px;
            border-left: 3px solid #df9fe0;
            position: relative;
        }

        .message-number {
            position: absolute;
            top: 10px;
            left: 10px;
            color: #8a8a8a;
            font-size: 12px;
            font-weight: bold;
        }

        .avatar-container {
            flex-shrink: 0;
            width: 60px;
            height: 60px;
        }

        .avatar {
            width: 60px;
            height: 60px;
            border-radius: 5px;
            border: 2px solid #3d3d3d;
            background-position: center;
            background-repeat: no-repeat;
            background-size: cover;
        }

        ${avatarCssText}

        .message-content {
            flex-grow: 1;
            padding-left: 10px;
        }

        .message-header {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }

        .character-name {
            font-weight: bold;
            font-size: 16px;
            color: #df9fe0;
        }

        .timestamp {
            color: #8a8a8a;
            font-size: 12px;
            font-style: italic;
        }

        .message-text {
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .message-text em {
            color: #e6a1b1;
            font-style: italic;
        }

        .message-text strong {
            color: #df9fe0;
            font-weight: bold;
        }

        .thought-indicator {
            color: #6893cc;
            font-size: 14px;
        }

        .ooc-message {
            border-left-color: #6893cc;
            background: #1a1a2e;
        }

        .system-message {
            border-left-color: #ff6b6b;
            background: #2d1b1b;
        }

        .empty-state {
            color: #b0b0b0;
            text-align: center;
            padding: 30px 0;
        }

        @media print {
            body {
                background: white;
                color: black;
                padding: 0;
            }

            .content {
                box-shadow: none;
                background: transparent;
            }

            .message {
                page-break-inside: avoid;
                border: 1px solid #ddd;
                background: #f9f9f9;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>${chatTitle}</h1>
            <p>${ownerLabel}</p>
            <p>Exported ${generatedDate}</p>
        </header>
        <main class="content">
            ${bodyHtml || emptyState}
        </main>
    </div>
</body>
</html>`;
}

async function exportManageChatsChatAsHtml(rowContext, filename) {
    await saveChatConditional();
    const messages = await fetchManageChatsHtmlExportMessages(rowContext, filename);
    const html = await buildManageChatsHtmlExport(rowContext, filename, messages);
    download(html, `${filename}.html`, 'text/html');
    await delay(250);
    toastr.success(t`Chat saved to HTML`);
}

async function exportManageChatsOwnerChat(ownerContext, filename, format) {
    const details = getManageChatsOwnerDetails(ownerContext);
    if (!details.ownerContext) {
        return;
    }

    await saveChatConditional();
    const body = {
        is_group: details.isGroup,
        avatar_url: details.avatarUrl || null,
        file: `${filename}.jsonl`,
        exportfilename: `${filename}.${format}`,
        format: format,
    };

    const response = await fetch('/api/chats/export', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: getRequestHeaders(),
    });
    const data = await response.json();

    if (!response.ok) {
        await delay(250);
        toastr.error(`Error: ${data.message}`);
        return;
    }

    const mimeType = format == 'txt' ? 'text/plain' : 'application/octet-stream';
    await delay(250);
    toastr.success(data.message);
    download(data.result, body.exportfilename, mimeType);
}

async function renameOrphanCharacterChat(orphanKey, oldFileName, newFileName) {
    const response = await fetch('/api/chats/rename', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            is_group: false,
            avatar_url: makeOrphanAvatarUrl(orphanKey),
            original_file: `${oldFileName}.jsonl`,
            renamed_file: `${newFileName.trim()}.jsonl`,
        }),
    });

    if (!response.ok) {
        throw new Error('Unsuccessful request.');
    }
}

async function deleteOrphanCharacterChat(orphanKey, fileName) {
    const response = await fetch('/api/chats/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            chatfile: `${fileName}.jsonl`,
            avatar_url: makeOrphanAvatarUrl(orphanKey),
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to delete chat for deleted character.');
    }
}

async function exportOrphanCharacterChat(orphanKey, filename, format) {
    await saveChatConditional();
    const body = {
        is_group: false,
        avatar_url: makeOrphanAvatarUrl(orphanKey),
        file: `${filename}.jsonl`,
        exportfilename: `${filename}.${format}`,
        format: format,
    };

    const response = await fetch('/api/chats/export', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: getRequestHeaders(),
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Failed to export chat.');
    }

    const mimeType = format == 'txt' ? 'text/plain' : 'application/octet-stream';
    await delay(250);
    toastr.success(data.message);
    download(data.result, body.exportfilename, mimeType);
}

export async function openManageChatsOrphanCharacterChat(orphanKey, fileName) {
    if (!orphanKey || !fileName) {
        return;
    }

    const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ch_name: orphanKey,
            file_name: fileName,
            avatar_url: makeOrphanAvatarUrl(orphanKey),
        }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        toastr.error(t`Could not load deleted character chat.`);
        return;
    }

    const messages = await response.json();
    const container = $('<div class="flex-container flexFlowColumn gap8px"></div>');
    container.append($('<div class="nameText"></div>').text(fileName));
    container.append($('<div class="text_muted"></div>').text(orphanKey));

    let hasVisibleMessages = false;
    messages.forEach((message, index) => {
        if (!message || (!message.mes && !message.extra?.display_text)) {
            return;
        }

        hasVisibleMessages = true;
        const displayName = message.name || (message.is_user ? name1 : orphanKey);
        const block = $('<div class="flex-container flexFlowColumn gap4px"></div>');
        block.append($('<div class="nameText"></div>').text(displayName));
        block.append($('<div class="mes_text"></div>').html(messageFormatting(
            message.extra?.display_text || message.mes || '',
            displayName,
            !!message.is_system,
            !!message.is_user,
            -1,
            {},
            false,
        )));
        container.append(block);
    });

    if (!hasVisibleMessages) {
        container.append($('<div class="text_muted"></div>').text(t`This chat is empty.`));
    }

    await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
        large: true,
        wide: true,
        allowVerticalScrolling: true,
    });
}

function appendManageChatsRow(target, chat, options = {}) {
    const template = $('#past_chat_template .select_chat_block_wrapper').clone();
    const chatBlock = template.find('.select_chat_block');
    chatBlock.attr('file_name', chat.file_name);
    setManageChatsRowContext(template, options.rowContext);
    setManageChatsRowContext(chatBlock, options.rowContext);
    template.find('.avatar img').attr('src', options.avatarImgURL || default_avatar);
    template.find('.select_chat_block_filename').text(chat.file_name);
    template.find('.chat_file_size').text(`(${chat.file_size},`);
    template.find('.chat_messages_num').text(`${chat.message_count} 💬)`);
    template.find('.select_chat_block_mes').text(chat.preview_message || '');
    template.find('.PastChat_cross').attr('file_name', chat.file_name);
    template.find('.chat_messages_date').text(timestampToMoment(chat.last_mes).format('lll'));

    template.find('.renameChatButton, .exportRawChatButton, .exportChatButton, .PastChat_cross').each((_, element) => {
        setManageChatsRowContext(element, options.rowContext);
    });

    if (options.isSelected) {
        chatBlock.attr('highlight', String(true));
    }

    target.append(template);

    if (Array.isArray(options.highlightNames) && options.highlightNames.includes(chat.file_name)) {
        const templateOffset = template.offset().top - template.parent().offset().top;
        $('#select_chat_div').scrollTop(templateOffset);
        flashHighlight(template, debounce_timeout.extended);
    }
}

function filterManageChatsChats(chats, searchQuery, extraTexts = []) {
    const fragments = String(searchQuery || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!fragments.length) {
        return chats;
    }

    return chats.filter((chat) => {
        const haystack = [
            chat?.file_name,
            chat?.preview_message,
            ...extraTexts,
        ].join('\n').toLowerCase();

        return fragments.every(fragment => haystack.includes(fragment));
    });
}

async function displayDeletedCharacterChats(orphanKey = manageChatsSelectedOrphanKey, highlightNames = []) {
    manageChatsMode = 'deleted';
    initManageChatsUi();
    refreshManageChatsModeUi();
    try {
        await fetchManageChatsOrphanEntries();
    } catch (error) {
        console.error('Error loading deleted character chats:', error);
        $('#select_chat_div').empty().append(`<div class="text_muted padding10px">${t`Could not load chats for deleted characters.`}</div>`);
        $('#select_chat_search').val('').off('input');
        return;
    }
    const nextOrphanKey = orphanKey && findManageChatsOrphanEntry(orphanKey)
        ? String(orphanKey)
        : (manageChatsOrphanEntries[0]?.orphan_key ? String(manageChatsOrphanEntries[0].orphan_key) : null);

    manageChatsSelectedOrphanKey = nextOrphanKey;
    populateManageChatsOrphanSelect(nextOrphanKey);
    updateManageChatsDeletedHeader(nextOrphanKey);

    $('#select_chat_div').empty();
    $('#select_chat_search').val('').off('input');

    if (!manageChatsOrphanEntries.length) {
        $('#select_chat_div').append(`<div class="text_muted padding10px">${t`No chats for deleted characters were found.`}</div>`);
        return;
    }

    if (!nextOrphanKey) {
        $('#select_chat_div').append(`<div class="text_muted padding10px">${t`Choose a deleted character`}</div>`);
        return;
    }

    const renderDeletedCharacterChats = async (searchQuery = '') => {
        const requestId = ++manageChatsDeletedSearchRequestId;
        const trimmedQuery = String(searchQuery || '').trim();
        let entries = manageChatsOrphanEntries;

        if (trimmedQuery) {
            try {
                entries = await fetchManageChatsOrphanEntries({
                    query: trimmedQuery,
                    orphanKey: manageChatsSelectedOrphanKey,
                    updateCache: false,
                });
            } catch (error) {
                if (requestId !== manageChatsDeletedSearchRequestId) {
                    return;
                }

                console.error('Error searching deleted character chats:', error);
                $('#select_chat_div').empty().append(`<div class="text_muted padding10px">${t`Could not load chats for deleted characters.`}</div>`);
                return;
            }
        }

        if (requestId !== manageChatsDeletedSearchRequestId) {
            return;
        }

        const entry = entries.find(item => String(item?.orphan_key) === String(manageChatsSelectedOrphanKey)) ?? null;
        $('#select_chat_div').empty();

        if (!entry) {
            $('#select_chat_div').append(`<div class="text_muted padding10px">${trimmedQuery ? t`No chats matched your search.` : t`Choose a deleted character`}</div>`);
            return;
        }

        const directChats = entry.direct_chats || [];
        const relatedGroups = entry.related_groups || [];

        if (directChats.length) {
            $('#select_chat_div').append(`<div class="manage_chats_section_title">${t`Character chats`}</div>`);
            directChats.forEach((chat) => appendManageChatsRow($('#select_chat_div'), chat, {
                avatarImgURL: default_avatar,
                rowContext: { rowType: 'orphan-character', orphanKey: entry.orphan_key },
                highlightNames,
            }));
        }

        const groupsWithChats = relatedGroups.filter(group => (group.chats || []).length > 0);
        if (groupsWithChats.length) {
            $('#select_chat_div').append(`<div class="manage_chats_section_title">${t`Group chats`}</div>`);
            groupsWithChats.forEach((group) => {
                $('#select_chat_div').append($('<div class="manage_chats_group_title"></div>').text(group.name || group.id));
                const groupDetails = getManageChatsOwnerDetails({ type: 'group', id: group.id });
                const currentGroupChat = groupDetails.group?.chat_id || '';

                group.chats.forEach((chat) => appendManageChatsRow($('#select_chat_div'), chat, {
                    avatarImgURL: group.avatar_url || default_avatar,
                    rowContext: {
                        rowType: 'orphan-group',
                        orphanKey: entry.orphan_key,
                        groupId: group.id,
                        ownerContext: { type: 'group', id: group.id },
                    },
                    highlightNames,
                    isSelected: String(currentGroupChat).replace(/\.jsonl$/i, '') === String(chat.file_name).replace(/\.jsonl$/i, ''),
                }));
            });
        }

        if (!directChats.length && !groupsWithChats.length) {
            $('#select_chat_div').append(`<div class="text_muted padding10px">${t`No chats matched your search.`}</div>`);
        }
    };

    await renderDeletedCharacterChats('');

    const debouncedDisplay = debounce((searchQuery) => {
        void renderDeletedCharacterChats(searchQuery);
    });

    $('#select_chat_search').on('input', function () {
        debouncedDisplay($(this).val());
    });
}

/**
 * Displays the past chats for a character or a group based on the selected context.
 * The function first fetches the chats, processes them, and then displays them in
 * the HTML. It also has a built-in search functionality that allows filtering the
 * displayed chats based on a search query.
 * @param {string[]} hightlightNames - An array of chat names to highlight
 * @param {ManageChatsOwnerContext?} [ownerContext]
 */
export async function displayPastChats(hightlightNames = [], ownerContext = getCurrentManageChatsOwner()) {
    manageChatsMode = 'owners';
    initManageChatsUi();
    refreshManageChatsModeUi();
    const details = getManageChatsOwnerDetails(ownerContext);
    populateManageChatsOwnerSelect(details.ownerContext);
    updateManageChatsHeader(details.ownerContext);

    if (!details.ownerContext) {
        $('#select_chat_div').empty();
        $('#select_chat_search').val('').off('input');
        $('#select_chat_div').append(`<div class="text_muted padding10px">${t`Choose a character`}</div>`);
        return;
    }

    $('#select_chat_div').empty();
    $('#select_chat_search').val('').off('input');

    await displayChats('', details, hightlightNames);

    const debouncedDisplay = debounce((searchQuery) => {
        displayChats(searchQuery, getManageChatsOwnerDetails(details.ownerContext), []);
    });

    $('#select_chat_search').on('input', function () {
        const searchQuery = $(this).val();
        debouncedDisplay(searchQuery);
    });

    setTimeout(function () {
        const textSearchElement = $('#select_chat_search');
        textSearchElement.trigger('click').trigger('focus').trigger('select');
    }, 200);
}

async function displayChats(searchQuery, chatDetails, highlightNames) {
    try {
        const ownerContext = normalizeManageChatsOwner(chatDetails?.ownerContext);
        if (!ownerContext) {
            $('#select_chat_div').empty();
            return;
        }

        const trimExtension = (fileName) => String(fileName).replace('.jsonl', '');
        const response = await fetch('/api/chats/search', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                query: searchQuery,
                avatar_url: chatDetails.isGroup ? null : chatDetails.avatarUrl,
                group_id: chatDetails.isGroup ? chatDetails.groupId : null,
            }),
        });

        if (!response.ok) {
            throw new Error('Search failed');
        }

        const filteredData = await response.json();
        $('#select_chat_div').empty();

        filteredData.sort((a, b) => sortMoments(timestampToMoment(a.last_mes), timestampToMoment(b.last_mes)));

        for (const chat of filteredData) {
            const isSelected = trimExtension(chatDetails.sessionName) === trimExtension(chat.file_name);
            appendManageChatsRow($('#select_chat_div'), chat, {
                avatarImgURL: chatDetails.avatarImgURL,
                rowContext: {
                    rowType: ownerContext.type === 'group' ? 'live-group' : 'live-character',
                    ownerContext,
                    groupId: ownerContext.type === 'group' ? ownerContext.id : null,
                },
                highlightNames,
                isSelected,
            });
        }
    } catch (error) {
        console.error('Error loading chats:', error);
        toastr.error('Could not load chat data. Try reloading the page.');
    }
}

export function selectRightMenuWithAnimation(selectedMenuId) {
    const displayModes = {
        'rm_group_chats_block': 'flex',
        'rm_api_block': 'grid',
        'rm_characters_block': 'flex',
    };
    $('#result_info').toggle(selectedMenuId === 'rm_ch_create_block');
    document.querySelectorAll('#right-nav-panel .right_menu').forEach((menu) => {
        $(menu).css('display', 'none');

        if (selectedMenuId && selectedMenuId.replace('#', '') === menu.id) {
            const mode = displayModes[menu.id] ?? 'block';
            $(menu).css('display', mode);
            $(menu).css('opacity', 0.0);
            $(menu).transition({
                opacity: 1.0,
                duration: animation_duration,
                easing: animation_easing,
                complete: function () { },
            });
        }
    });
}

export function select_rm_info(type, charId, previousCharId = null) {
    if (!type) {
        toastr.error(t`Invalid process (no 'type')`);
        return;
    }
    if (type !== 'group_create') {
        var displayName = String(charId).replace('.png', '');
    }

    if (type === 'char_delete') {
        toastr.warning(t`Character Deleted: ${displayName}`);
    }
    if (type === 'char_create') {
        toastr.success(t`Character Created: ${displayName}`);
    }
    if (type === 'group_create') {
        toastr.success(t`Group Created`);
    }
    if (type === 'group_delete') {
        toastr.warning(t`Group Deleted`);
    }

    if (type === 'char_import') {
        toastr.success(t`Character Imported: ${displayName}`);
    }

    selectRightMenuWithAnimation('rm_characters_block');

    // Set a timeout so multiple flashes don't overlap
    clearTimeout(importFlashTimeout);
    importFlashTimeout = setTimeout(function () {
        if (type === 'char_import' || type === 'char_create' || type === 'char_import_no_toast') {
            // Find the page at which the character is located
            const avatarFileName = charId;
            const charData = getEntitiesList({ doFilter: true });
            const charIndex = charData.findIndex((x) => x?.item?.avatar?.startsWith(avatarFileName));

            if (charIndex === -1) {
                console.log(`Could not find character ${charId} in the list`);
                return;
            }

            try {
                const perPage = Number(accountStorage.getItem('Characters_PerPage')) || per_page_default;
                const page = Math.floor(charIndex / perPage) + 1;
                const selector = `#rm_print_characters_block [title*="${avatarFileName}"]`;
                $('#rm_print_characters_pagination').pagination('go', page);

                waitUntilCondition(() => document.querySelector(selector) !== null).then(() => {
                    const element = $(selector).parent();

                    if (element.length === 0) {
                        console.log(`Could not find element for character ${charId}`);
                        return;
                    }

                    const scrollOffset = element.offset().top - element.parent().offset().top;
                    element.parent().scrollTop(scrollOffset);
                    flashHighlight(element, 5000);
                });
            } catch (e) {
                console.error(e);
            }
        }

        if (type === 'group_create') {
            // Find the page at which the character is located
            const charData = getEntitiesList({ doFilter: true });
            const charIndex = charData.findIndex((x) => String(x?.item?.id) === String(charId));

            if (charIndex === -1) {
                console.log(`Could not find group ${charId} in the list`);
                return;
            }

            const perPage = Number(accountStorage.getItem('Characters_PerPage')) || per_page_default;
            const page = Math.floor(charIndex / perPage) + 1;
            $('#rm_print_characters_pagination').pagination('go', page);
            const selector = `#rm_print_characters_block [grid="${charId}"]`;
            try {
                waitUntilCondition(() => document.querySelector(selector) !== null).then(() => {
                    const element = $(selector);
                    const scrollOffset = element.offset().top - element.parent().offset().top;
                    element.parent().scrollTop(scrollOffset);
                    flashHighlight(element, 5000);
                });
            } catch (e) {
                console.error(e);
            }
        }
    }, 250);

    if (previousCharId) {
        const newId = characters.findIndex((x) => x.avatar == previousCharId);
        if (newId >= 0) {
            setCharacterId(newId);
        }
    }
}

/**
 * Selects the right menu for displaying the character editor.
 * @param {string} chid Character array index
 * @param {object} [param1] Options for the switch
 * @param {boolean} [param1.switchMenu=true] Whether to switch the menu
 * @param {boolean} [param1.forceRefresh=false] Whether to repopulate the form even with unsaved edits
 */
export function select_selected_character(chid, { switchMenu = true, forceRefresh = false } = {}) {
    //character select
    //console.log('select_selected_character() -- starting with input of -- ' + chid + ' (name:' + characters[chid].name + ')');
    const shouldPreserveUnsavedEdits = !forceRefresh
        && String(chid) === String(this_chid)
        && hasUnsavedCharacterEdits();

    select_rm_create({ switchMenu, hydrateForm: false });
    switchMenu && setMenuType('character_edit');
    $('#delete_button').css('display', 'flex');
    $('#export_button').css('display', 'flex');

    //create text poles
    $('#rm_button_back').css('display', 'none');
    //$("#character_import_button").css("display", "none");
    $('#create_button').attr('value', 'Save');              // what is the use case for this?
    $('#dupe_button').show();
    $('#dupe_button')
        .toggleClass('disabled', !canDuplicateCharacter(chid))
        .attr('aria-disabled', !canDuplicateCharacter(chid) ? 'true' : 'false');
    $('#create_button_label').css('display', '');
    $('#char_connections_button').show();
    $('#submit_character_review_button').css('display', canSubmitCharacterForReview(chid) ? 'flex' : 'none');

    // Hide the chat scenario button if we're peeking the group member defs
    $('#set_chat_character_settings').toggle(!selected_group);

    // Don't update the navbar name if we're peeking the group member defs
    if (!selected_group) {
        $('#rm_button_selected_ch').children('h2').text(characters[chid].name);
    }

    if (!shouldPreserveUnsavedEdits) {
        $('#add_avatar_button').val('');
    }

    if (!shouldPreserveUnsavedEdits) {
        $('#character_popup-button-h3').text(characters[chid].name);
        $('#character_name_pole').val(characters[chid].name);
        $('#description_textarea').val(characters[chid].description);
        $('#character_world').val(characters[chid].data?.extensions?.world || '');
        $('#creator_notes_textarea').val(characters[chid].data?.creator_notes || characters[chid].creatorcomment);
        $('#creator_notes_spoiler').html(formatCreatorNotes(characters[chid].data?.creator_notes || characters[chid].creatorcomment));
        $('#character_version_textarea').val(characters[chid].data?.character_version || '');
        $('#system_prompt_textarea').val(characters[chid].data?.system_prompt || '');
        $('#post_history_instructions_textarea').val(characters[chid].data?.post_history_instructions || '');
        $('#tags_textarea').val(Array.isArray(characters[chid].data?.tags) ? characters[chid].data.tags.join(', ') : '');
        $('#creator_textarea').val(characters[chid].data?.creator);
        $('#character_version_textarea').val(characters[chid].data?.character_version || '');
        $('#personality_textarea').val(characters[chid].personality);
        $('#firstmessage_textarea').val(characters[chid].first_mes);
        $('#scenario_pole').val(characters[chid].scenario);
        $('#depth_prompt_prompt').val(characters[chid].data?.extensions?.depth_prompt?.prompt ?? '');
        $('#depth_prompt_depth').val(characters[chid].data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default);
        $('#depth_prompt_role').val(characters[chid].data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default);
        $('#talkativeness_slider').val(characters[chid].talkativeness || talkativeness_default);
        $('#mes_example_textarea').val(characters[chid].mes_example);
        $('#selected_chat_pole').val(characters[chid].chat);
        $('#create_date_pole').val(characters[chid].create_date);
        $('#avatar_url_pole').val(characters[chid].avatar);
        $('#chat_import_avatar_url').val(characters[chid].avatar);
        $('#chat_import_character_name').val(characters[chid].name);
        $('#character_json_data').val(characters[chid].json_data);

        updateFavButtonState(characters[chid].fav || characters[chid].fav == 'true');

        const avatarUrl = characters[chid].avatar != 'none' ? getThumbnailUrl('avatar', characters[chid].avatar) : default_avatar;
        $('#avatar_load_preview').attr('src', avatarUrl);
        $('.open_alternate_greetings').data('chid', chid);
        $('#set_character_world').data('chid', chid);
        setWorldInfoButtonClass(chid);
        checkEmbeddedWorld(chid);

        $('#name_div').removeClass('displayBlock');
        $('#name_div').addClass('displayNone');
        $('#renameCharButton').css('display', '');
    }

    $('#form_create').attr('actiontype', 'editcharacter');
    $('.form_create_bottom_buttons_block .chat_lorebook_button').show();
    if (!shouldPreserveUnsavedEdits) {
        clearCharacterEditorDirtyState();
    }
    updateCharacterSaveButtonState();

    const externalMediaState = isExternalMediaAllowed();
    $('#character_open_media_overrides').toggle(!selected_group);
    $('#character_media_allowed_icon').toggle(externalMediaState);
    $('#character_media_forbidden_icon').toggle(!externalMediaState);

    // Update some stuff about the char management dropdown
    $('#character_source').attr('disabled', !getCharacterSource(chid) ? '' : null);
    updateCharacterSharedControls(chid);

    eventSource.emit(event_types.CHARACTER_EDITOR_OPENED, chid);

    saveSettingsDebounced();
}

/**
 * Selects the right menu for creating a new character.
 * @param {object} [options] Options for the switch
 * @param {boolean} [options.switchMenu=true] Whether to switch the menu
 * @param {boolean} [options.hydrateForm=true] Whether to populate the form with create-mode values
 */
function select_rm_create({ switchMenu = true, hydrateForm = true } = {}) {
    switchMenu && setMenuType('create');

    //console.log('select_rm_Create() -- selected button: '+selected_button);
    if (hydrateForm && selected_button == 'create' && create_save.avatar) {
        const addAvatarInput = /** @type {HTMLInputElement} */ ($('#add_avatar_button').get(0));
        addAvatarInput.files = create_save.avatar;
        read_avatar_load(addAvatarInput);
    }

    switchMenu && selectRightMenuWithAnimation('rm_ch_create_block');

    $('#set_chat_character_settings').hide();
    $('#delete_button_div').css('display', 'none');
    $('#delete_button').css('display', 'none');
    $('#export_button').css('display', 'none');
    $('#create_button_label').css('display', '');
    $('#create_button').attr('value', 'Create');
    $('#dupe_button').hide();
    $('#char_connections_button').hide();
    $('#submit_character_review_button').hide();
    $('#character_shared_status').hide().empty();
    $('#character_promote_shared').prop('hidden', true).prop('disabled', true);
    $('#character_manage_owners').prop('hidden', true).prop('disabled', true);
    $('#character_checkout_toggle').prop('hidden', true).prop('disabled', true).text('Check Out / In');

    //create text poles
    $('#rm_button_back').css('display', '');
    $('#character_import_button').css('display', '');
    if (hydrateForm) {
        $('#character_popup-button-h3').text('Create character');
        $('#character_name_pole').val(create_save.name);
        $('#description_textarea').val(create_save.description);
        $('#character_world').val(create_save.world);
        $('#creator_notes_textarea').val(create_save.creator_notes);
        $('#creator_notes_spoiler').html(formatCreatorNotes(create_save.creator_notes));
        $('#post_history_instructions_textarea').val(create_save.post_history_instructions);
        $('#system_prompt_textarea').val(create_save.system_prompt);
        $('#tags_textarea').val(create_save.tags);
        $('#creator_textarea').val(create_save.creator);
        $('#character_version_textarea').val(create_save.character_version);
        $('#personality_textarea').val(create_save.personality);
        $('#firstmessage_textarea').val(create_save.first_message);
        $('#talkativeness_slider').val(create_save.talkativeness);
        $('#scenario_pole').val(create_save.scenario);
        $('#depth_prompt_prompt').val(create_save.depth_prompt_prompt);
        $('#depth_prompt_depth').val(create_save.depth_prompt_depth);
        $('#depth_prompt_role').val(create_save.depth_prompt_role);
        $('#mes_example_textarea').val(create_save.mes_example);
        $('#character_json_data').val('');
        $('#avatar_div').css('display', 'flex');
        $('#avatar_load_preview').attr('src', default_avatar);
        $('#renameCharButton').css('display', 'none');
        $('#name_div').removeClass('displayNone');
        $('#name_div').addClass('displayBlock');
        $('.open_alternate_greetings').data('chid', -1);
        $('#set_character_world').data('chid', -1);
        setWorldInfoButtonClass(undefined, !!create_save.world);
        updateFavButtonState(false);
        checkEmbeddedWorld();
    }

    $('#form_create').attr('actiontype', 'createcharacter');
    $('.form_create_bottom_buttons_block .chat_lorebook_button').hide();
    $('#character_open_media_overrides').hide();
    hydrateForm && clearCharacterEditorDirtyState();
    updateCharacterSaveButtonState();
}

function select_rm_characters() {
    const doFullRefresh = menu_type === 'characters';
    setMenuType('characters');
    selectRightMenuWithAnimation('rm_characters_block');
    printCharacters(doFullRefresh);
}

/**
 * Sets a prompt injection to insert custom text into any outgoing prompt. For use in UI extensions.
 * @param {string} key Prompt injection id.
 * @param {string} value Prompt injection value.
 * @param {number} position Insertion position. 0 is after story string, 1 is in-chat with custom depth.
 * @param {number} depth Insertion depth. 0 represets the last message in context. Expected values up to MAX_INJECTION_DEPTH.
 * @param {number} role Extension prompt role. Defaults to SYSTEM.
 * @param {boolean} scan Should the prompt be included in the world info scan.
 * @param {(function(): Promise<boolean>|boolean)} filter Filter function to determine if the prompt should be injected.
 */
export function setExtensionPrompt(key, value, position, depth, scan = false, role = extension_prompt_roles.SYSTEM, filter = null) {
    extension_prompts[key] = {
        value: String(value),
        position: Number(position),
        depth: Number(depth),
        scan: !!scan,
        role: Number(role ?? extension_prompt_roles.SYSTEM),
        filter: filter,
    };
}

/**
 * Gets a enum value of the extension prompt role by its name.
 * @param {string} roleName The name of the extension prompt role.
 * @returns {number} The role id of the extension prompt.
 */
export function getExtensionPromptRoleByName(roleName) {
    // If the role is already a valid number, return it
    if (typeof roleName === 'number' && Object.values(extension_prompt_roles).includes(roleName)) {
        return roleName;
    }

    switch (roleName) {
        case 'system':
            return extension_prompt_roles.SYSTEM;
        case 'user':
            return extension_prompt_roles.USER;
        case 'assistant':
            return extension_prompt_roles.ASSISTANT;
    }

    // Skill issue?
    return extension_prompt_roles.SYSTEM;
}

/**
 * Removes all char A/N prompt injections from the chat.
 * To clean up when switching from groups to solo and vice versa.
 */
export function removeDepthPrompts() {
    for (const key of Object.keys(extension_prompts)) {
        if (key.startsWith(inject_ids.DEPTH_PROMPT)) {
            delete extension_prompts[key];
        }
    }
}

/**
 * Adds or updates the metadata for the currently active chat.
 * @param {Object} newValues An object with collection of new values to be added into the metadata.
 * @param {boolean} reset Should a metadata be reset by this call.
 */
export function updateChatMetadata(newValues, reset) {
    chat_metadata = reset ? { ...newValues } : { ...chat_metadata, ...newValues };
}


/**
 * Updates the state of the favorite button based on the provided state.
 * @param {boolean} state Whether the favorite button should be on or off.
 */
function updateFavButtonState(state) {
    // Update global state of the flag
    // TODO: This is bad and needs to be refactored.
    fav_ch_checked = state;
    $('#fav_checkbox').prop('checked', state);
    $('#favorite_button').toggleClass('fav_on', state);
    $('#favorite_button').toggleClass('fav_off', !state);
}

function getCharacterOwnerHandle(chid) {
    if (chid === undefined || chid === null || !characters[chid]) {
        return '';
    }

    return String(characters[chid]?.ownerHandle || characters[chid]?.data?.extensions?.aikobots?.owner_handle || '').trim();
}

function getCharacterOwnerHandles(chid) {
    if (chid === undefined || chid === null || !characters[chid]) {
        return [];
    }

    const ownerHandles = Array.isArray(characters[chid]?.ownerHandles)
        ? characters[chid].ownerHandles
        : characters[chid]?.data?.extensions?.aikobots?.owner_handles;
    if (Array.isArray(ownerHandles)) {
        return [...new Set(ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean))];
    }

    const ownerHandle = getCharacterOwnerHandle(chid);
    return ownerHandle ? [ownerHandle] : [];
}

function getCharacterOwnerLabel(chid) {
    const ownerHandles = getCharacterOwnerHandles(chid);
    return ownerHandles.length > 0 ? ownerHandles.join(', ') : getCharacterOwnerHandle(chid);
}

function getCharacterSharingMode(chid) {
    if (chid === undefined || chid === null || !characters[chid]) {
        return 'single';
    }

    return characters[chid]?.sharingMode === 'shared'
        || characters[chid]?.data?.extensions?.aikobots?.sharing_mode === 'shared'
        ? 'shared'
        : 'single';
}

function isSharedCharacter(chid) {
    return getCharacterSharingMode(chid) === 'shared';
}

export function canEditCharacterMetadata(chid) {
    const ownerHandles = getCharacterOwnerHandles(chid);
    return ownerHandles.length === 0 || isAdmin() || ownerHandles.includes(currentUser?.handle);
}

function canDuplicateCharacter(chid) {
    return canEditCharacterMetadata(chid);
}

function parseCharacterOwnerHandles(value) {
    return [...new Set(String(value || '')
        .split(',')
        .map(handle => handle.trim())
        .filter(Boolean))];
}

function ensureActingUserIncludedInCharacterOwnerHandles(ownerHandles = []) {
    return [...new Set([
        ...(Array.isArray(ownerHandles) ? ownerHandles : []),
        String(currentUser?.handle || '').trim(),
    ].filter(Boolean))];
}

async function refreshSelectedCharacterManagementState() {
    if (this_chid === undefined || !characters[this_chid]) {
        return;
    }

    const avatar = characters[this_chid].avatar;
    await getOneCharacter(avatar);
    select_selected_character(this_chid, { switchMenu: false });
    printCharactersDebounced();
}

async function promoteSelectedCharacterToShared() {
    if (this_chid === undefined || !characters[this_chid]) {
        return;
    }

    if (canEditCharacterMetadata(this_chid)) {
        const saved = await createOrEditCharacter();
        if (!saved) {
            return;
        }
    }

    const ownerDefaults = ensureActingUserIncludedInCharacterOwnerHandles([]).join(', ');
    const ownerInput = await Popup.show.input(
        'Share Character',
        'Enter comma-separated owner handles. Your handle will be included automatically. Shared characters must keep at least two owners.',
        ownerDefaults,
    );
    if (!ownerInput) {
        return;
    }

    const response = await fetch('/api/characters/promote-shared', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: characters[this_chid].avatar,
            ownerHandles: ensureActingUserIncludedInCharacterOwnerHandles(parseCharacterOwnerHandles(ownerInput)),
        }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        toastr.error(data?.error?.message || 'Could not share this character.', 'Character Sharing');
        return;
    }

    await refreshSelectedCharacterManagementState();
    toastr.success('Character is now shared.', 'Character Sharing');
}

async function manageSelectedSharedCharacterOwners() {
    if (this_chid === undefined || !characters[this_chid]) {
        return;
    }

    if (!characters[this_chid]?.canManageOwners) {
        toastr.info(getCharacterSharedReadOnlyMessage(this_chid) || 'Shared owner management is unavailable.', 'Character Sharing');
        return;
    }

    const ownerInput = await Popup.show.input(
        'Manage Shared Character Owners',
        'Enter comma-separated owner handles. Your handle will stay selected automatically. Shared characters must keep at least two owners.',
        getCharacterOwnerHandles(this_chid).join(', '),
    );
    if (!ownerInput) {
        return;
    }

    const response = await fetch('/api/characters/shared/owners', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: characters[this_chid].avatar,
            ownerHandles: ensureActingUserIncludedInCharacterOwnerHandles(parseCharacterOwnerHandles(ownerInput)),
        }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        toastr.error(data?.error?.message || 'Could not update shared character owners.', 'Character Sharing');
        return;
    }

    await refreshSelectedCharacterManagementState();
    toastr.success('Shared character owners updated.', 'Character Sharing');
}

async function toggleSelectedSharedCharacterCheckout() {
    if (this_chid === undefined || !characters[this_chid] || !isSharedCharacter(this_chid)) {
        return;
    }

    const checkoutState = String(characters[this_chid]?.checkoutState || 'available');
    const canForceCheckout = Boolean(characters[this_chid]?.canForceCheckout);
    if (checkoutState === 'other' && !canForceCheckout) {
        toastr.info(getCharacterSharedReadOnlyMessage(this_chid), 'Character Sharing');
        return;
    }

    let force = false;
    if (checkoutState === 'other' && canForceCheckout) {
        const confirmed = await Popup.show.confirm(
            'Force Check Out Shared Character',
            `Force take checkout from "${characters[this_chid]?.checkedOutBy || 'another owner'}"?`,
        );
        if (!confirmed) {
            return;
        }
        force = true;
    }

    const endpoint = checkoutState === 'self' ? '/api/characters/checkin' : '/api/characters/checkout';
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: characters[this_chid].avatar,
            force,
        }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        toastr.error(data?.error?.message || 'Could not update shared character checkout.', 'Character Sharing');
        return;
    }

    await refreshSelectedCharacterManagementState();
}

function canSubmitCharacterForReview(chid) {
    if (selected_group || chid === undefined || chid === null || !characters[chid]) {
        return false;
    }

    const avatar = String(characters[chid]?.avatar || '').trim();
    return !!avatar && avatar !== 'none' && canEditCharacterMetadata(chid);
}

function getCharacterSharedReadOnlyMessage(chid) {
    if (!isSharedCharacter(chid)) {
        return '';
    }

    const checkoutState = String(characters[chid]?.checkoutState || 'available');
    const checkedOutBy = String(characters[chid]?.checkedOutBy || '').trim();
    if (checkoutState === 'other') {
        return checkedOutBy
            ? `Checked out by ${checkedOutBy}.`
            : 'Checked out by another owner.';
    }

    if (checkoutState === 'self') {
        return `Checked out by you${characters[chid]?.checkedOutAt ? ` since ${characters[chid].checkedOutAt}` : ''}.`;
    }

    return 'Shared character is available for checkout.';
}

function updateCharacterSharedControls(chid) {
    const promoteOption = $('#character_promote_shared');
    const manageOwnersOption = $('#character_manage_owners');
    const checkoutOption = $('#character_checkout_toggle');
    const status = $('#character_shared_status');
    const hasCharacter = chid !== undefined && chid !== null && !!characters[chid] && !selected_group;
    const shared = hasCharacter && isSharedCharacter(chid);
    const canManage = hasCharacter && canEditCharacterMetadata(chid);
    const canManageOwners = Boolean(characters[chid]?.canManageOwners);
    const checkoutState = String(characters[chid]?.checkoutState || 'available');
    const canForceCheckout = Boolean(characters[chid]?.canForceCheckout);

    promoteOption.prop('hidden', !hasCharacter || shared).prop('disabled', !hasCharacter || shared || !canManage);
    manageOwnersOption.prop('hidden', !shared).prop('disabled', !shared || !canManageOwners);
    checkoutOption.prop('hidden', !shared).prop('disabled', !shared || (checkoutState === 'other' ? !canForceCheckout : checkoutState === 'self' ? !characters[chid]?.canCheckIn : !characters[chid]?.canCheckOut));

    if (shared) {
        checkoutOption.text(
            checkoutState === 'self'
                ? 'Check In Shared Character'
                : checkoutState === 'other'
                    ? (canForceCheckout ? 'Force Check Out Shared Character' : 'Shared Character Locked')
                    : 'Check Out Shared Character',
        );
        status.text(getCharacterSharedReadOnlyMessage(chid)).show();
    } else {
        checkoutOption.text('Check Out / In');
        status.hide().empty();
    }
}

export async function setCharacterSettingsOverrides() {
    if (!selected_group && (this_chid === undefined || !characters[this_chid])) {
        console.warn('setCharacterSettingsOverrides() -- no selected group or character');
        return;
    }

    const scenarioOverrideValue = chat_metadata['scenario'] || '';
    const exampleMessagesValue = chat_metadata['mes_example'] || '';
    const systemPromptValue = chat_metadata['system_prompt'] || '';
    const isGroup = !!selected_group;

    const $template = $(await renderTemplateAsync('scenarioOverride'));
    $template.find('[data-group="true"]').toggle(isGroup);
    $template.find('[data-character="true"]').toggle(!isGroup);
    const pendingChanges = {
        scenario: scenarioOverrideValue,
        examples: exampleMessagesValue,
        system_prompt: systemPromptValue,
    };

    // Keep edits local until the popup is closed/confirmed
    const $scenario = $template.find('.chat_scenario');
    $scenario.val(scenarioOverrideValue).on('input', function () {
        pendingChanges.scenario = String($(this).val());
    });
    const $examples = $template.find('.chat_examples');
    $examples.val(exampleMessagesValue).on('input', function () {
        pendingChanges.examples = String($(this).val());
    });
    const $systemPrompt = $template.find('.chat_system_prompt');
    $systemPrompt.val(systemPromptValue).on('input', function () {
        pendingChanges.system_prompt = String($(this).val());
    });

    $template.find('.remove_scenario_override').on('click', async function () {
        const confirm = await Popup.show.confirm(t`Are you sure you want to remove all overrides?`, t`This action cannot be undone.`);
        if (!confirm) {
            return;
        }

        $scenario.val('');
        pendingChanges.scenario = '';
        $examples.val('');
        pendingChanges.examples = '';
        $systemPrompt.val('');
        pendingChanges.system_prompt = '';
    });

    // Wait for popup close/confirm.
    await callGenericPopup($template, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    chat_metadata['scenario'] = pendingChanges.scenario;
    chat_metadata['mes_example'] = pendingChanges.examples;
    chat_metadata['system_prompt'] = pendingChanges.system_prompt;
    await saveMetadata();
}

/**
 * Displays a blocking popup with a given text and type.
 * @param {JQuery<HTMLElement>|string|Element} text - Text to display in the popup.
 * @param {string} type
 * @param {string} inputValue - Value to set the input to.
 * @param {PopupOptions} options - Options for the popup.
 * @typedef {{okButton?: string, rows?: number, wide?: boolean, wider?: boolean, large?: boolean, allowHorizontalScrolling?: boolean, allowVerticalScrolling?: boolean, cropAspect?: number }} PopupOptions - Options for the popup.
 * @returns {Promise<any>} A promise that resolves when the popup is closed.
 * @deprecated Use `callGenericPopup` instead.
 */
export function callPopup(text, type, inputValue = '', { okButton, rows, wide, wider, large, allowHorizontalScrolling, allowVerticalScrolling, cropAspect } = {}) {
    function getOkButtonText() {
        if (['text', 'char_not_selected'].includes(popup_type)) {
            $dialoguePopupCancel.css('display', 'none');
            return okButton ?? t`Ok`;
        } else if (['delete_extension'].includes(popup_type)) {
            return okButton ?? t`Ok`;
        } else if (['new_chat', 'confirm'].includes(popup_type)) {
            return okButton ?? t`Yes`;
        } else if (['input'].includes(popup_type)) {
            return okButton ?? t`Save`;
        }
        return okButton ?? t`Delete`;
    }

    dialogueCloseStop = true;
    if (type) {
        popup_type = type;
    }

    const $dialoguePopup = $('#dialogue_popup');
    const $dialoguePopupCancel = $('#dialogue_popup_cancel');
    const $dialoguePopupOk = $('#dialogue_popup_ok');
    const $dialoguePopupInput = $('#dialogue_popup_input');
    const $dialoguePopupText = $('#dialogue_popup_text');
    const $shadowPopup = $('#shadow_popup');

    $dialoguePopup.toggleClass('wide_dialogue_popup', !!wide)
        .toggleClass('wider_dialogue_popup', !!wider)
        .toggleClass('large_dialogue_popup', !!large)
        .toggleClass('horizontal_scrolling_dialogue_popup', !!allowHorizontalScrolling)
        .toggleClass('vertical_scrolling_dialogue_popup', !!allowVerticalScrolling);

    $dialoguePopupCancel.css('display', 'inline-block');
    $dialoguePopupOk.text(getOkButtonText());
    $dialoguePopupInput.toggle(popup_type === 'input').val(inputValue).attr('rows', rows ?? 1);
    $dialoguePopupText.empty().append(text);
    $shadowPopup.css('display', 'block');

    if (popup_type == 'input') {
        $dialoguePopupInput.trigger('focus');
    }

    $shadowPopup.transition({
        opacity: 1,
        duration: animation_duration,
        easing: animation_easing,
    });

    return new Promise((resolve) => {
        dialogueResolve = resolve;
    });
}

/**
 * Update the swipe counter for mesId.
 * @param {Number} mesId
 */
export async function updateSwipeCounter(mesId) {
    const swipeCounterText = formatSwipeCounter((chat[mesId]?.['swipe_id'] + 1), chat[mesId]?.['swipes']?.length);
    const currentMessage = chatElement.children().filter(`[mesid="${mesId}"]`);
    const swipeCounter = currentMessage.find('.swipes-counter');
    swipeCounter.text(swipeCounterText).show();
}

/**
 * Swipe buttons are often toggled to update their position.
 * This should be replaced with a more efficient function.
 */
export function refreshSwipeButtons() {
    hideSwipeButtons();
    showSwipeButtons();
}

export function showSwipeButtons(mesId = chat.length - 1) {
    isSwipingAllowed = true;

    if (chat.length === 0) {
        return;
    }

    if (
        chat[mesId].is_system ||
        !swipes ||
        Number($('.mes:last').attr('mesid')) < 0 ||
        chat[mesId].is_user ||
        (selected_group && is_group_generating)
    ) {
        return;
    }

    // swipe_id should be set if alternate greetings are added
    if (chat.length == 1 && chat[0].swipe_id === undefined) {
        return;
    }

    //had to add this to make the swipe counter work
    //(copied from the onclick functions for swipe buttons..
    //don't know why the array isn't set for non-swipe messages in Generate or addOneMessage..)
    if (chat[mesId]['swipe_id'] === undefined) {              // if there is no swipe-message in the last spot of the chat array
        chat[mesId]['swipe_id'] = 0;                        // set it to id 0
        chat[mesId]['swipes'] = [];                         // empty the array
        chat[mesId]['swipes'][0] = chat[mesId]['mes'];  //assign swipe array with last message from chat
        chat[mesId]['swipe_info'] = [];
        chat[mesId]['swipe_info'][0] = {
            'send_date': chat[mesId]['send_date'],
            'gen_started': chat[mesId]['gen_started'],
            'gen_finished': chat[mesId]['gen_finished'],
            'extra': structuredClone(chat[mesId]['extra']),
        };
    }

    const currentMessage = chatElement.children().filter(`[mesid="${mesId}"]`);
    const swipeId = chat[mesId].swipe_id;
    const swipeCounterText = formatSwipeCounter((swipeId + 1), chat[mesId]['swipes'].length);
    const swipeRight = currentMessage.find('.swipe_right');
    const swipeLeft = currentMessage.find('.swipe_left');
    const swipeCounter = currentMessage.find('.swipes-counter');

    if (swipeId !== undefined && (chat[mesId].swipes.length > 1 || swipeId > 0)) {
        swipeLeft.css('display', 'flex');
    }
    //only show right when generate is off, or when next right swipe would not make a generate happen
    if (is_send_press === false || chat[mesId].swipes.length >= swipeId) {
        swipeRight.css('display', 'flex').css('opacity', '0.3');
        swipeCounter.css('opacity', '0.3');
    }
    if ((chat[mesId].swipes.length - swipeId) === 1) {
        //chevron was moved out of hardcode in HTML to class toggle dependent on last_mes or not
        //necessary for 'swipe_right' div in past messages to have no chevron if 'show swipes for all messages' is turned on
        swipeRight.css('opacity', '0.7');
        swipeCounter.css('opacity', '0.7');
    }

    //allows for writing individual swipe counters for past messages
    const lastSwipeCounter = $('.last_mes .swipes-counter');
    lastSwipeCounter.text(swipeCounterText).show();
}

/**
 * @param {object} [options] Options
 * @param {boolean} [options.hideCounters=false] Also hide the swipes counter.
 */
export function hideSwipeButtons({ hideCounters = false } = {}) {
    isSwipingAllowed = false;
    chatElement.find('.swipe_right').hide();
    chatElement.find('.swipe_left').hide();
    if (hideCounters === true) {
        chatElement.find('.last_mes .swipes-counter').hide();
    }
}

/**
 * Deletes a swipe from the chat.
 *
 * @param {number?} [swipeId = null] - The ID of the swipe to delete. If not provided, the current swipe will be deleted.
 * @param {number?} [messageId = chat.length - 1] - The ID of the message to delete from. If not provided, the last message will be targeted.
 * @returns {Promise<number>|undefined} - The ID of the new swipe after deletion.
 */
export async function deleteSwipe(swipeId = null, messageId = chat.length - 1) {
    if (swipeId && (isNaN(swipeId) || swipeId < 0)) {
        toastr.warning(t`Invalid swipe ID: ${swipeId + 1}`);
        return;
    }

    const message = chat[messageId];
    if (!message || !Array.isArray(message.swipes) || !message.swipes.length) {
        toastr.warning(t`No messages to delete swipes from.`);
        return;
    }

    if (message.swipes.length <= 1) {
        toastr.warning(t`Can't delete the last swipe.`);
        return;
    }

    swipeId = swipeId ?? message.swipe_id;

    if (swipeId < 0 || swipeId >= message.swipes.length) {
        toastr.warning(t`Invalid swipe ID: ${swipeId + 1}`);
        return;
    }

    const deletedSwipeSnapshotKey = message.swipe_info?.[swipeId]?.extra?.promptSnapshotKey;
    message.swipes.splice(swipeId, 1);

    if (Array.isArray(message.swipe_info) && message.swipe_info.length) {
        message.swipe_info.splice(swipeId, 1);
    }

    // Select the next swipe, or the one before if it was the last one
    const newSwipeId = Math.min(swipeId, message.swipes.length - 1);
    syncSwipeToMes(messageId, newSwipeId);
    const rekeys = [];
    if (Array.isArray(message.swipe_info)) {
        for (let index = swipeId; index < message.swipe_info.length; index++) {
            const swipeExtra = message.swipe_info[index]?.extra;
            const swipeKey = swipeExtra?.promptSnapshotKey;
            if (typeof swipeKey !== 'string' || !swipeKey) {
                continue;
            }

            const nextSwipeKey = rekeyPromptSnapshotKey(swipeKey, { mesId: messageId, swipeId: index });
            if (!nextSwipeKey) {
                continue;
            }

            addPromptSnapshotRekeyOperation(rekeys, swipeKey, nextSwipeKey);
            swipeExtra.promptSnapshotKey = nextSwipeKey;
        }
    }
    syncMessagePromptSnapshotKeyFromActiveSwipe(message);
    await syncLatestPromptInspectorAfterSwipeMutation(messageId);
    await maintainPromptSnapshotKeys({
        deletes: typeof deletedSwipeSnapshotKey === 'string' && deletedSwipeSnapshotKey ? [deletedSwipeSnapshotKey] : [],
        rekeys,
    });

    chat_metadata['tainted'] = true;

    await eventSource.emit(event_types.MESSAGE_SWIPE_DELETED, { messageId, swipeId, newSwipeId });

    await saveChatConditional();
    await reloadCurrentChat();

    return newSwipeId;
}

export async function saveMetadata() {
    await saveChatConditional();
}

async function saveChatOnce(options = {}) {
    let savedChatId = '';
    let savedIsGroup = false;
    let savedGroupId = null;
    let savedChatRef = null;
    let savedAvatarUrl = '';
    let savedFileName = '';
    let saveSucceeded = false;

    try {
        cancelDebouncedChatSave();

        savedChatId = String(getCurrentChatId() || '');
        savedIsGroup = Boolean(selected_group);
        savedGroupId = savedIsGroup ? selected_group : null;
        if (savedIsGroup) {
            savedChatRef = {
                type: 'group',
                chatId: savedChatId,
            };
        } else {
            const currentChatDetails = getCurrentChatDetails();
            savedAvatarUrl = String(currentChatDetails?.avatarUrl || '');
            savedFileName = savedChatId;
            savedChatRef = {
                type: 'character',
                avatarUrl: savedAvatarUrl,
                fileName: savedFileName,
            };
        }

        // TODO: saveChatConditional() may emit CHAT_SAVED for non-persistent temp Assistant chats.
        // Non-urgent for now; defer until temp-chat/STMB save-flow cleanup.

        if (savedIsGroup) {
            const groupSaved = await saveGroupChat(savedGroupId, true);
            if (groupSaved === CHAT_SAVE_RESULT.FAILED || groupSaved === false) {
                return CHAT_SAVE_RESULT.FAILED;
            }
        }
        else {
            const chatSaved = await saveChat(options);
            if (chatSaved === CHAT_SAVE_RESULT.FAILED || chatSaved === false) {
                return CHAT_SAVE_RESULT.FAILED;
            }
            savedChatId = String(getCurrentChatId() || savedChatId || '');
            savedFileName = savedChatId;
            if (savedChatRef?.type === 'character') {
                savedChatRef.fileName = savedFileName;
            }
        }

        // Save token and prompts cache to IndexedDB storage
        saveTokenCache();
        await saveItemizedPrompts(savedChatId);
        saveSucceeded = true;
    } catch (error) {
        console.error('Error saving chat', error);
    }

    if (saveSucceeded) {
        await eventSource.emit(event_types.CHAT_SAVED, {
            chatId: String(savedChatId || ''),
            isGroup: savedIsGroup,
            groupId: savedGroupId ? String(savedGroupId) : null,
            chatRef: savedChatRef,
            avatarUrl: savedAvatarUrl,
            fileName: savedFileName,
        });
    }

    return saveSucceeded ? CHAT_SAVE_RESULT.SAVED : CHAT_SAVE_RESULT.FAILED;
}

async function drainChatSaveQueue() {
    isChatSaving = true;
    let finalResult = CHAT_SAVE_RESULT.SAVED;

    try {
        while (chatSaveDirty) {
            chatSaveDirty = false;
            const options = chatSaveRequestOptions;
            chatSaveRequestOptions = {};
            const result = await saveChatOnce(options);
            finalResult = result;

            if (result !== CHAT_SAVE_RESULT.SAVED) {
                chatSaveDirty = false;
                break;
            }
        }

        return finalResult;
    } finally {
        isChatSaving = false;
        chatSaveQueuePromise = null;
    }
}

export async function saveChatConditional(options = {}) {
    chatSaveDirty = true;
    chatSaveRequestOptions = {
        ...chatSaveRequestOptions,
        ...(options || {}),
    };

    if (!chatSaveQueuePromise) {
        chatSaveQueuePromise = drainChatSaveQueue().catch((error) => {
            console.error('Error saving chat', error);
            chatSaveDirty = false;
            return CHAT_SAVE_RESULT.FAILED;
        });
    }

    return chatSaveQueuePromise;
}

/**
 * Saves the chat to the server.
 * @param {FormData} formData Form data to send to the server.
 * @param {object} [options={}] Options for the import
 * @param {boolean} [options.refresh] Whether to refresh the group chat list after import
 * @returns {Promise<string[]>} List of imported file names.
 */
async function importCharacterChat(formData, { refresh = true } = {}) {
    const fetchResult = await fetch('/api/chats/import', {
        method: 'POST',
        body: formData,
        headers: getRequestHeaders({ omitContentType: true }),
        cache: 'no-cache',
    });

    if (fetchResult.ok) {
        const data = await fetchResult.json();
        if (data.res && refresh) {
            await displayPastChats();
        }
        return data?.fileNames || [];
    }

    try {
        const errorData = await fetchResult.json();
        if (errorData?.message) {
            toastr.error(errorData.message, t`Failed to import chat`);
        }
    } catch {
        // Ignore non-JSON error responses and fall through to the empty result.
    }

    return [];
}

export function updateViewMessageIds(startIndex = null) {
    const minId = startIndex ?? getFirstDisplayedMessageId();
    const messageCount = chatElement.find('.mes').length;

    chatElement.find('.mes').each(function (index, element) {
        $(element).attr('mesid', minId + index);
        $(element).find('.mesIDDisplay').text(`#${minId + index}`);
    });

    chatElement.find('.mes').removeClass('last_mes');
    chatElement.find('.mes').last().addClass('last_mes');

    setVisibleChatRange(messageCount > 0 ? minId : null, messageCount > 0 ? minId + messageCount - 1 : null);
    updateHistoryControls();
    updateEditArrowClasses();
}

export function getFirstDisplayedMessageId() {
    if (Number.isFinite(visibleChatStartId)) {
        return visibleChatStartId;
    }

    const mesId = Number(chatElement.children('.mes').first().attr('mesid'));
    return Number.isFinite(mesId) ? mesId : null;
}

export function getLastDisplayedMessageId() {
    if (Number.isFinite(visibleChatEndId)) {
        return visibleChatEndId;
    }

    const mesId = Number(chatElement.children('.mes').last().attr('mesid'));
    return Number.isFinite(mesId) ? mesId : null;
}

export function updateEditArrowClasses() {
    if (!(this_edit_mes_id >= 0)) {
        return;
    }

    const message = chatElement.find(`.mes[mesid="${this_edit_mes_id}"]`);

    const downButton = message.find('.mes_edit_down');
    const upButton = message.find('.mes_edit_up');
    const copyButton = message.find('.mes_edit_copy');
    const deleteButton = message.find('.mes_edit_delete');
    const lastId = Number(chatElement.find('.mes').last().attr('mesid'));
    const firstId = Number(chatElement.find('.mes').first().attr('mesid'));

    copyButton.removeClass('disabled');
    deleteButton.removeClass('disabled');

    // The last message cannot be moved down.
    downButton.toggleClass('disabled', lastId === Number(this_edit_mes_id));
    // The first message cannot be moved up.
    upButton.toggleClass('disabled', firstId === Number(this_edit_mes_id));
}

/**
 * Closes the message editor.
 * @param {'message'|'reasoning'|'all'} what What to close. Default is 'all'.
 */
export function closeMessageEditor(what = 'all') {
    if (what === 'message' || what === 'all') {
        if (this_edit_mes_id >= 0) {
            chatElement.find(`.mes[mesid="${this_edit_mes_id}"] .mes_edit_cancel`).trigger('click');
        }
    }
    if (what === 'reasoning' || what === 'all') {
        document.querySelectorAll('.reasoning_edit_textarea').forEach((el) => {
            const cancelButton = el.closest('.mes')?.querySelector('.mes_reasoning_edit_cancel');
            if (cancelButton instanceof HTMLElement) {
                cancelButton.click();
            }
        });
    }
}

export function setGenerationProgress(progress) {
    if (!progress) {
        $('#send_textarea').css({ 'background': '', 'transition': '' });
    }
    else {
        $('#send_textarea').css({
            'background': `linear-gradient(90deg, #008000d6 ${progress}%, transparent ${progress}%)`,
            'transition': '0.25s ease-in-out',
        });
    }
}

export function cancelTtsPlay() {
    if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
    }
}

function updateAlternateGreetingsHintVisibility(root) {
    const numberOfGreetings = root.find('.alternate_greetings_list .alternate_greeting').length;
    $(root).find('.alternate_grettings_hint').toggle(numberOfGreetings == 0);
}

async function openCharacterWorldPopup() {
    const chid = $('#set_character_world').data('chid');
    if (menu_type != 'create' && chid === undefined) {
        toastr.error('Does not have an Id for this character in world select menu.');
        return;
    }

    // TODO: Maybe make this utility function not use the window context?
    const fileName = getCharaFilename(chid);
    const charName = (menu_type == 'create' ? create_save.name : characters[chid]?.data?.name) || 'Nameless';
    const worldId = (menu_type == 'create' ? create_save.world : characters[chid]?.data?.extensions?.world) || '';
    const ownerHandle = menu_type == 'create'
        ? ''
        : getCharacterOwnerHandle(chid);
    const canEditLoreLinks = menu_type == 'create'
        || !ownerHandle
        || canEditCharacterMetadata(chid);
    if (!canEditLoreLinks && ownerHandle) {
        toastr.info(`Only ${getCharacterOwnerLabel(chid)} and admins may access character lore for this character.`, t`Character locked`);
        return;
    }

    const allowsUserLinkedLorebooks = canEditLoreLinks && !ownerHandle;
    const secureWorldNames = getSecureWorldNames();
    const selectableExtraBookOptions = allowsUserLinkedLorebooks ? world_names : secureWorldNames;
    const selectableExtraBookSet = new Set(selectableExtraBookOptions);
    const extrasPlaceholder = canEditLoreLinks
        ? t`Click here to select lorebooks.`
        : 'Read-only linked lorebooks.';
    const template = $('#character_world_template .character_world').clone();
    template.find('.character_name').text(charName);
    template.find('.character_extra_world_info_help_primary').text(
        allowsUserLinkedLorebooks
            ? 'Choose secure lorebooks and your own lorebooks to be used with this character.'
            : t`Choose secure lorebooks to be used with this character.`,
    );
    template.find('.character_extra_world_info_help_secondary').text(
        allowsUserLinkedLorebooks
            ? 'If this character is submitted or assigned an owner, only secure lorebooks can remain linked.'
            : t`These lorebooks will not be exported. Please ensure that these lorebooks are set as secure lorebooks.`,
    );

    // --- Event Handlers ---
    async function handlePrimaryWorldSelect() {
        const selectedValue = $(this).val();
        const worldIndex = selectedValue !== '' ? Number(selectedValue) : NaN;
        const name = !isNaN(worldIndex) ? world_names[worldIndex] : '';
        await charUpdatePrimaryWorld(name);
    }

    async function handleExtrasWorldSelect(evt) {
        const el = evt?.currentTarget ?? this;
        const selectedValues = $(el).val();
        const selected = Array.isArray(selectedValues) ? selectedValues : [];
        const nextList = selected.map(i => selectableExtraBookOptions[Number(i)]).filter(Boolean);

        if (menu_type == 'create') {
            await charSetAuxWorlds('', nextList);
            return;
        }

        const fileName = getCharaFilename(null, {});
        await charSetAuxWorlds(fileName, nextList);
    }

    // --- Populate Dropdowns ---
    // Append to primary dropdown.
    const primarySelect = template.find('.character_world_info_selector');
    if (!canEditLoreLinks && worldId && !world_names.includes(worldId)) {
        primarySelect.append(new Option(worldId, worldId, true, true));
    }
    world_names.forEach((item, i) => {
        primarySelect.append(new Option(item, String(i), item === worldId, item === worldId));
    });
    primarySelect.prop('disabled', !canEditLoreLinks);

    // Append to extras dropdown.
    const extrasSelect = template.find('.character_extra_world_info_selector');
    const selectedExtraBooks = menu_type == 'create' ? create_save.extra_books : getEditableCharacterExtraBooks(fileName);
    const legacyExtraBooks = menu_type == 'create' ? [] : getLegacyCharacterExtraBooks(fileName);
    const filteredSelectedExtraBooks = canEditLoreLinks
        ? selectedExtraBooks.filter(item => selectableExtraBookSet.has(item))
        : selectedExtraBooks.filter(Boolean).filter(onlyUnique);

    const extraBookOptions = canEditLoreLinks ? selectableExtraBookOptions : filteredSelectedExtraBooks;
    extraBookOptions.forEach((item, i) => {
        const isSelected = filteredSelectedExtraBooks.includes(item);
        extrasSelect.append(new Option(item, String(i), isSelected, isSelected));
    });
    extrasSelect.prop('disabled', !canEditLoreLinks);

    if (legacyExtraBooks.length > 0) {
        template.find('.range-block-range').first().after($(`
            <div class="range-block-counter justifyLeft flex-container flexFlowColumn margin-bot-10px opacity50p">
                <span>Legacy compatibility lorebooks from settings.json are also active for this character at runtime.</span>
                <span>These links are read-only here and are not changed when you edit metadata-linked lorebooks.</span>
                <span><strong>${escapeHtml(legacyExtraBooks.join(', '))}</strong></span>
            </div>
        `));
    }

    if (!canEditLoreLinks && ownerHandle) {
        template.find('.range-block-title').first().after($(`
            <div class="range-block-counter justifyLeft flex-container flexFlowColumn margin-bot-10px opacity50p">
                <span>Editing lorebooks is locked for this character. Only ${escapeHtml(getCharacterOwnerLabel(chid))} and admins can change linked or embedded lorebooks.</span>
            </div>
        `));
    }

    const popup = new Popup(template, POPUP_TYPE.TEXT, '', {
        onOpen: function (popup) {
            const popupDialog = $(popup.dlg);

            if (canEditLoreLinks) {
                primarySelect.on('change', handlePrimaryWorldSelect);
                extrasSelect.on('change', handleExtrasWorldSelect);
            }

            // Not needed on mobile.
            if (!isMobile()) {
                extrasSelect.select2({
                    width: '100%',
                    placeholder: extrasPlaceholder,
                    allowClear: true,
                    closeOnSelect: false,
                    dropdownParent: popupDialog,
                });
            }
        },
    });

    await popup.show();
}

function openAlternateGreetings() {
    const chid = $('.open_alternate_greetings').data('chid');

    if (menu_type != 'create' && chid === undefined) {
        toastr.error('Does not have an Id for this character in editor menu.');
        return;
    } else {
        // If the character does not have alternate greetings, create an empty array
        if (characters[chid] && !Array.isArray(characters[chid].data.alternate_greetings)) {
            characters[chid].data.alternate_greetings = [];
        }
    }

    const template = $('#alternate_greetings_template .alternate_grettings').clone();
    const getArray = () => menu_type == 'create' ? create_save.alternate_greetings : characters[chid].data.alternate_greetings;
    const popup = new Popup(template, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClose: async () => {
            if (menu_type !== 'create') {
                markCharacterEditorDirty();
            }
        },
    });

    for (let index = 0; index < getArray().length; index++) {
        addAlternateGreeting(template, getArray()[index], index, getArray, popup);
    }

    template.find('.add_alternate_greeting').on('click', function () {
        const array = getArray();
        const index = array.length;
        array.push('');
        addAlternateGreeting(template, '', index, getArray, popup);
        updateAlternateGreetingsHintVisibility(template);
        const list = template.find('.alternate_greetings_list');
        list.scrollTop(list.prop('scrollHeight'));
    });

    popup.show();
    updateAlternateGreetingsHintVisibility(template);
}

/**
 * Adds an alternate greeting to the template.
 * @param {JQuery<HTMLElement>} template
 * @param {string} greeting
 * @param {number} index
 * @param {() => any[]} getArray
 * @param {Popup} popup
 */
function addAlternateGreeting(template, greeting, index, getArray, popup) {
    const greetingBlock = $('#alternate_greeting_form_template .alternate_greeting').clone();
    greetingBlock.attr('data-index', index);
    greetingBlock.find('.alternate_greeting_text')
        .attr('id', `alternate_greeting_${index}`)
        .on('input', async function () {
            const value = $(this).val();
            const array = getArray();
            array[index] = value;
        }).val(greeting);
    greetingBlock.find('.editor_maximize').attr('data-for', `alternate_greeting_${index}`);
    greetingBlock.find('.greeting_index').text(index + 1);
    greetingBlock.find('.delete_alternate_greeting').on('click', async function (event) {
        event.preventDefault();
        event.stopPropagation();

        const confirm = await callGenericPopup(t`Are you sure you want to delete this alternate greeting?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            return;
        }

        const array = getArray();
        array.splice(index, 1);

        // We need to reopen the popup to update the index numbers
        await popup.complete(POPUP_RESULT.AFFIRMATIVE);
        openAlternateGreetings();
    });
    greetingBlock.find('.move_up_alternate_greeting').on('click', function (event) {
        handleMoveAlternateGreeting(event, -1);
    });
    greetingBlock.find('.move_down_alternate_greeting').on('click', function (event) {
        handleMoveAlternateGreeting(event, 1);
    });

    /**
     * Handles moving an alternate greeting up or down in the list.
     * @param {JQuery.ClickEvent} event - The click event
     * @param {number} direction - Direction to move: -1 for up, 1 for down
     */
    function handleMoveAlternateGreeting(event, direction) {
        event.preventDefault();
        event.stopPropagation();

        const array = getArray();
        const index = Number(greetingBlock.attr('data-index'));
        const newIndex = index + direction;

        // Check bounds
        if (direction === -1 && index <= 0) {
            return;
        }
        if (direction === 1 && index >= array.length - 1) {
            return;
        }

        // Swap the greetings
        [array[index], array[newIndex]] = [array[newIndex], array[index]];

        // Update current greeting
        greetingBlock.find('.alternate_greeting_text').val(array[index]);

        // Update adjacent greeting
        const adjacentGreetingBlock = template.find(`.alternate_greeting[data-index="${newIndex}"]`);
        adjacentGreetingBlock.find('.alternate_greeting_text').val(array[newIndex]);
    }

    template.find('.alternate_greetings_list').append(greetingBlock);
}

/**
 * Creates or edits a character based on the form data.
 * @param {Event} [e] Event that triggered the function call.
 * @returns {Promise<boolean>} Whether the character was saved successfully.
 */
export async function createOrEditCharacter(e) {
    $('#rm_info_avatar').html('');
    const formData = new FormData(/** @type {HTMLFormElement} */($('#form_create').get(0)));
    formData.set('fav', String(fav_ch_checked));
    const isNewChat = e instanceof CustomEvent && e.type === 'newChat';
    const getFetchErrorMessage = async (response) => {
        try {
            const errorData = await response.json();
            return errorData?.error || errorData?.message || errorData?.error?.message || '';
        } catch {
            try {
                return await response.text();
            } catch {
                return '';
            }
        }
    };

    const rawFile = formData.get('avatar');
    if (rawFile instanceof File) {
        const convertedFile = await ensureImageFormatSupported(rawFile);
        formData.set('avatar', convertedFile);
    }

    const headers = getRequestHeaders({ omitContentType: true });

    if ($('#form_create').attr('actiontype') == 'createcharacter') {
        if (String($('#character_name_pole').val()).length === 0) {
            toastr.error(t`Name is required`);
            return false;
        }
        if (is_group_generating || is_send_press) {
            toastr.error(t`Cannot create characters while generating. Stop the request and try again.`, t`Creation aborted`);
            return false;
        }
        try {
            //if the character name text area isn't empty (only posible when creating a new character)
            let url = '/api/characters/create';

            if (crop_data != undefined) {
                url += `?crop=${encodeURIComponent(JSON.stringify(crop_data))}`;
            }

            formData.delete('alternate_greetings');
            for (const value of create_save.alternate_greetings) {
                formData.append('alternate_greetings', value);
            }

            formData.append('extensions', JSON.stringify(create_save.extensions));

            const fetchResult = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: formData,
                cache: 'no-cache',
            });

            if (!fetchResult.ok) {
                const errorMessage = await getFetchErrorMessage(fetchResult);
                throw new Error(errorMessage || 'Fetch result is not ok');
            }

            const avatarId = await fetchResult.text();

            $('#character_cross').trigger('click'); //closes the advanced character editing popup
            const fields = [
                { id: '#character_name_pole', callback: value => create_save.name = value },
                { id: '#description_textarea', callback: value => create_save.description = value },
                { id: '#creator_notes_textarea', callback: value => create_save.creator_notes = value },
                { id: '#character_version_textarea', callback: value => create_save.character_version = value },
                { id: '#post_history_instructions_textarea', callback: value => create_save.post_history_instructions = value },
                { id: '#system_prompt_textarea', callback: value => create_save.system_prompt = value },
                { id: '#tags_textarea', callback: value => create_save.tags = value },
                { id: '#creator_textarea', callback: value => create_save.creator = value },
                { id: '#personality_textarea', callback: value => create_save.personality = value },
                { id: '#firstmessage_textarea', callback: value => create_save.first_message = value },
                { id: '#talkativeness_slider', callback: value => create_save.talkativeness = value, defaultValue: talkativeness_default },
                { id: '#scenario_pole', callback: value => create_save.scenario = value },
                { id: '#depth_prompt_prompt', callback: value => create_save.depth_prompt_prompt = value },
                { id: '#depth_prompt_depth', callback: value => create_save.depth_prompt_depth = value, defaultValue: depth_prompt_depth_default },
                { id: '#depth_prompt_role', callback: value => create_save.depth_prompt_role = value, defaultValue: depth_prompt_role_default },
                { id: '#mes_example_textarea', callback: value => create_save.mes_example = value },
                { id: '#character_json_data', callback: () => { } },
                { id: '#alternate_greetings_template', callback: value => create_save.alternate_greetings = value, defaultValue: [] },
                { id: '#character_world', callback: value => create_save.world = value },
                { id: '#_character_extensions_fake', callback: value => create_save.extensions = {} },
            ];

            fields.forEach(field => {
                const fieldValue = field.defaultValue !== undefined ? field.defaultValue : '';
                $(field.id).val(fieldValue);
                field.callback && field.callback(fieldValue);
            });

            create_save.extra_books = [];

            $('#character_popup-button-h3').text('Create character');

            create_save.avatar = null;

            $('#add_avatar_button').replaceWith(
                $('#add_avatar_button').val('').clone(true),
            );

            let oldSelectedChar = null;
            if (this_chid !== undefined) {
                oldSelectedChar = characters[this_chid].avatar;
            }

            console.log(`new avatar id: ${avatarId}`);
            createTagMapFromList('#tagList', avatarId);
            await getCharacters();

            select_rm_info('char_create', avatarId, oldSelectedChar);

            crop_data = undefined;
            clearCharacterEditorDirtyState();

            return true;
        } catch (error) {
            console.error('Error creating character', error);
            toastr.error(t`Failed to create character`);
            return false;
        }
    } else {
        try {
            let url = '/api/characters/edit';

            if (crop_data != undefined) {
                url += `?crop=${encodeURIComponent(JSON.stringify(crop_data))}`;
            }

            formData.delete('alternate_greetings');
            const chid = $('.open_alternate_greetings').data('chid');
            if (characters[chid] && Array.isArray(characters[chid]?.data?.alternate_greetings)) {
                for (const value of characters[chid].data.alternate_greetings) {
                    formData.append('alternate_greetings', value);
                }
            }

            const fetchResult = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: formData,
                cache: 'no-cache',
            });

            if (!fetchResult.ok) {
                const errorMessage = await getFetchErrorMessage(fetchResult);
                throw new Error(errorMessage || 'Fetch result is not ok');
            }

            await getOneCharacter(formData.get('avatar_url'));
            if (isNewChat) {
                favsToHotswap();
            } else {
                await printCharacters(false);
            }

            $('#add_avatar_button').replaceWith(
                $('#add_avatar_button').val('').clone(true),
            );
            $('#create_button').attr('value', 'Save');
            crop_data = undefined;
            clearCharacterEditorDirtyState();
            await eventSource.emit(event_types.CHARACTER_EDITED, { detail: { id: this_chid, character: characters[this_chid] } });

            // Recreate the chat if it hasn't been used at least once (i.e. with continue).
            if (!isNewChat) {
                await refreshPristineFirstMessage();
            }

            return true;
        } catch (error) {
            console.log(error);
            toastr.error(error?.message || t`Something went wrong while saving the character, or the image file provided was in an invalid format. Double check that the image is not a webp.`);
            return false;
        }
    }
}

/**
 * Formats a counter for a swipe view.
 * @param {number} current The current number of items.
 * @param {number} total The total number of items.
 * @returns {string} The formatted counter.
 */
function formatSwipeCounter(current, total) {
    if (isNaN(current) && isNaN(total)) {
        return '';
    }
    return `${!isNaN(current) ? current : '?'}\u200b/\u200b${!isNaN(total) ? total : '?'}`;
}

/**
 * Handles the swipe event.
 * @param {JQuery.Event} _event Event.
 * @param {'left'|'right'} direction The direction to swipe.
 * @param {object} params Additional parameters.
 * @param {string} [params.source] The source of the swipe event.
 * @param {boolean} [params.repeated] Is the swipe event repeated.
 * @param {object} [params.message=chat[chat.length - 1]] The chat message to swipe.
 */
export async function swipe(_event, direction, { source, repeated, message = chat[chat.length - 1] } = {}) {
    if (chat.length === 0) {
        console.warn('Swipe was called on an empty chat.');
        return;
    }

    //Only allow one concurrent swipe.
    if (!isSwipingAllowed) {
        console.info('The swipe has been ignored because another is in progress.');
        return;
    }
    isSwipingAllowed = false;

    let generation;
    let messageIndex;

    //Only set messageIndex if message exists because -1 is truthy.
    if (message) {
        messageIndex = chat.indexOf(message);
        if (messageIndex === -1) {
            console.error(`The message must exist in chat. ${message};`);
            return;
        }
    }

    const mesId = Number($(this).closest('.mes').attr('mesid') ?? messageIndex ?? chat.length - 1);

    const thisMesDiv = chatElement.children().filter(`.mes[mesid="${mesId}"]`);
    const thisMesText = thisMesDiv.find('.mes_block .mes_text');
    const thisMesDivHeight = thisMesDiv[0]?.scrollHeight;
    const thisMesTextHeight = thisMesText[0]?.scrollHeight;
    if (![thisMesDiv.length, thisMesText.length].every(num => num > 0)) {
        console.error(`Message #${mesId}'s DOM element is not valid.`);
        return;
    }
    const originalSwipeId = Number(chat[mesId]?.['swipe_id'] ?? 0);
    let newSwipeId = Number(originalSwipeId);

    const isPristine = !chat_metadata?.tainted;
    const swipeDuration = Math.round(animation_duration * 1.25);
    const swipeRange = direction === SWIPE_DIRECTION.RIGHT ? -700 : 700;

    async function endSwipe() {
        //Wait for the generation to end.
        try {
            await generation;
        }
        catch (error) {
            console.warn(`Swipe failed, Swiping back. ${error}`);
        }
        //Allow for another swipe.
        showSwipeButtons();

        //Clamp Id between swipes.
        let clampedId = clamp(chat[mesId]['swipe_id'], 0, Math.max(0, chat[mesId]['swipes'].length - 1));

        //If the id is not within bounds, Swipe back.
        if (chat[mesId]['swipe_id'] !== clampedId) {
            chat[mesId]['swipe_id'] = clampedId;
            syncSwipeToMes(mesId);
            addOneMessage(chat[mesId], { type: 'swipe', forceId: mesId, scroll: false });
        }

        await updateSwipeCounter(mesId);
        //Fallback.
        if (mesId != chat.length - 1) {
            await updateSwipeCounter(chat.length - 1);
        }
    }

    async function standardSwipe() {
        //If swipe_id has changed, or the source is being deleted.
        if (newSwipeId !== originalSwipeId || source == 'delete') {
            //Update the chat.
            await loadFromSwipeId(mesId, newSwipeId);
            //Transition to the new chat.
            await animateSwipe();
        }
        await endSwipe();
    }

    /**
     * Sets the message to the newSwipeId and loads it.
     * @param {number} mesId
     * @param {number} newSwipeId
     */
    async function loadFromSwipeId(mesId, newSwipeId) {
        //Update the swipe_id.
        chat[mesId]['swipe_id'] = newSwipeId;

        if (chat[mesId].extra && typeof chat[mesId].extra === 'object') {
            delete chat[mesId].extra.memory;
            delete chat[mesId].extra.display_text;
            delete chat[mesId].extra.media;
            delete chat[mesId].extra.inline_image;
            delete chat[mesId].extra.files;
            delete chat[mesId].extra.fileLength;
            delete chat[mesId].extra.generationType;
            delete chat[mesId].extra.negative;
            delete chat[mesId].extra.title;
            delete chat[mesId].extra.append_title;
        }
        delete chat[mesId].gen_started;
        delete chat[mesId].gen_finished;
        //load from swipes.
        syncSwipeToMes(mesId, chat[mesId]['swipe_id']);
    }

    // Helper function to convert transition to promise
    const transitionPromise = (element, properties) => {
        return new Promise((resolve) => {
            element.transition({
                ...properties,
                complete: resolve,
            });
        });
    };

    /**
     * Animates a swipe for all messages >= mesId.
     * @param {number} mesId
     * @param {number} x
     * @param {number} duration
     */
    async function animateSwipeTransition(mesId, x, duration) {
        //Selects the swiped message.
        const swipedMessagesDiv = chatElement.children().filter((index, div) => {
            const $div = $(div);
            return mesId === Number($div.attr('mesid'));
        });
        const swipedElementsDiv = swipedMessagesDiv.children('.mes_block, .mesAvatarWrapper');

        //Swipe.
        await transitionPromise(swipedElementsDiv, {
            x: x,
            duration: duration,
            easing: animation_easing,
            queue: false,
        });
    }

    function getMessageBottomHeight(thisMesDiv) {
        const thisMesRect = thisMesDiv[0].getBoundingClientRect();
        //Scroll position + Chat height = Bottom of chat height.
        const chatBottom = chatElement.scrollTop() - chatElement.height();
        //Message offset from viewport top + height = Bottom of message offset.
        const messageBottom = thisMesRect.top + thisMesDiv.height();
        // Bottom of chat + Bottom of message offset = target scroll position.
        const scrollHeight = (chatBottom + messageBottom);
        return scrollHeight;
    }

    function expandNewMessage(thisMesDiv) {
        //Only scroll if the view is not near the bottom.
        const is_animation_scroll = (chatElement.scrollTop() >= (chatElement.prop('scrollHeight') - chatElement.outerHeight()) - 10);

        let new_height = thisMesDivHeight - (thisMesTextHeight - thisMesText[0].scrollHeight);
        if (new_height < 103) new_height = 103;

        //Keep the swipe buttons at the same height when scrolling is finished.

        //Expand new message.
        thisMesDiv.animate({ height: new_height + 'px' }, {
            duration: 0, //used to be 100 //Disabled on Cohee's request. https://github.com/SillyTavern/SillyTavern/pull/4610/files#r2408731744
            queue: false,
            progress: function (animation, progress, remainingMs) {

                if (is_animation_scroll) chatElement.scrollTop(getMessageBottomHeight(thisMesDiv));
            },
            complete: function () {
                thisMesDiv.css('height', 'auto');
                //Correct height auto offset.
                if (is_animation_scroll) chatElement.scrollTop(getMessageBottomHeight(thisMesDiv));
            },
        });
    }

    /**
     * Anime a swipe, optionally running a generation.
     * @param {boolean} run_generate
     */
    async function animateSwipe(run_generate = false) {

        //Swipe out.
        await animateSwipeTransition(mesId, swipeRange, swipeDuration);

        if (run_generate) {
            await updateSwipeCounter(mesId);
            //shows "..." while generating
            thisMesDiv.find('.mes_text').html('...');
            // resets the timer
            thisMesDiv.find('.mes_timer').html('');
            thisMesDiv.find('.tokenCounterDisplay').text('');
            updateReasoningUI(thisMesDiv, { reset: true });
        } else {
            //console.log('showing previously generated swipe candidate, or "..."');
            //console.log('onclick right swipe calling addOneMessage');

            //Only scroll when swiping the last message.
            const scroll = (mesId == chat.length - 1);
            addOneMessage(chat[mesId], { type: 'swipe', forceId: mesId, scroll: scroll });

            if (power_user.message_token_count_enabled) {
                if (!chat[mesId].extra) {
                    chat[mesId].extra = {};
                }

                const tokenCountText = (chat[mesId]?.extra?.reasoning || '') + chat[mesId].mes;
                const tokenCount = await getTokenCountAsync(tokenCountText, 0);
                chat[mesId]['extra']['token_count'] = tokenCount;
                thisMesDiv.find('.tokenCounterDisplay').text(`${tokenCount}t`);
            }
        }

        //Animate expanding to the new message height.
        thisMesDiv.css('height', thisMesDivHeight);
        expandNewMessage(thisMesDiv);


        //Jump to the opposite side.
        await animateSwipeTransition(mesId, -swipeRange, 0);

        appendMediaToMessage(chat[mesId], thisMesDiv);

        await eventSource.emit(event_types.MESSAGE_SWIPED, (mesId));

        if (run_generate && !is_send_press) {
            is_send_press = true;
            generation = Generate('swipe');
        } else if (Number(chat[mesId]['swipe_id']) !== chat[mesId]['swipes'].length) {
            await saveChatConditional();
        }

        //Swipe in.
        await animateSwipeTransition(mesId, 0, swipeDuration);
    }

    if (mesId === Number(this_edit_mes_id)) {
        closeMessageEditor();
    }
    if (isStreamingEnabled() && streamingProcessor) {
        streamingProcessor.onStopStreaming();
    }

    //If the swipe is not being deleted.
    if (source != 'delete') {

        // Make sure ad-hoc changes to extras are saved before swiping away
        syncMesToSwipe(mesId);

        if (chat[mesId]['swipe_id'] === undefined) {              // if there is no swipe-message in the last spot of the chat array
            chat[mesId]['swipe_id'] = 0;                        // set it to id 0
            chat[mesId]['swipes'] = [];                         // empty the array
            chat[mesId]['swipe_info'] = [];
            chat[mesId]['swipes'][0] = chat[mesId]['mes'];  //assign swipe array with last chat[mesId] from chat
            chat[mesId]['swipe_info'][0] = {
                'send_date': chat[mesId]['send_date'],
                'gen_started': chat[mesId]['gen_started'],
                'gen_finished': chat[mesId]['gen_finished'],
                'extra': structuredClone(chat[mesId]['extra']),
            };
        }
        // If the user is holding down the key and we're at the last or first swipe, don't do anything.
        let isLastSwipe = (direction === SWIPE_DIRECTION.RIGHT) ? (chat[mesId].swipe_id === Math.max(0, chat[mesId]['swipes'].length - 1)) : chat[mesId].swipe_id === 0;
        if (source === 'keyboard' && repeated && isLastSwipe) {
            await endSwipe();
            return;
        }
    } else if (source == 'delete') {
        //If the swipe is being deleted.
        await standardSwipe();
        return;
    }

    //If swiping left.
    if (direction === SWIPE_DIRECTION.LEFT) {
        newSwipeId--;
        //Loop to last swipe if negative.
        if (newSwipeId < 0) {
            newSwipeId = Math.max(0, chat[mesId]['swipes'].length - 1);
        }
        //Limit swipe_id to swipes.
        if (newSwipeId > chat[mesId]['swipes'].length - 1) {
            toastr.warning(`The swipe_id for message #${mesId} was ${newSwipeId}. It has been reset to ${chat[mesId]['swipes'].length - 1}.`);
            chat[mesId]['swipe_id'] = chat[mesId]['swipes'].length - 1;
            await endSwipe();
            return;
        }
        await standardSwipe();
        return;
    }
    //If swiping right.
    else if (direction === SWIPE_DIRECTION.RIGHT) {
        // make new slot in array
        newSwipeId++;

        //Minimum of zero.
        if (newSwipeId < 0) {
            toastr.warning(`The swipe_id for message #${mesId} was ${newSwipeId}. It has been reset to zero.`);
            chat[mesId]['swipe_id'] = 0;
            await endSwipe();
            return;
        }

        //if swipe id of last message is the same as the length of the 'swipes' array and not the greeting.
        if (newSwipeId >= chat[mesId]['swipes'].length && ((chat.length !== 1 || !isPristine))) {
            newSwipeId = chat[mesId]['swipes'].length;

            //Update the swipe_id.
            chat[mesId]['swipe_id'] = newSwipeId;

            //Cancel the generation if it's a user message or the first message in a pristine chat.
            if (chat[mesId].is_user || (mesId === 0 && isPristine)) {
                //Cancel swipe.
                chat[mesId]['swipe_id'] = originalSwipeId;
                await endSwipe();
                return;
            } else {
                //Generate.
                await loadFromSwipeId(mesId, newSwipeId);
                let run_generate = true;
                await animateSwipe(run_generate);
                await endSwipe();
                return;
            }
        }
        else {
            // if swipe_right is called on the last alternate greeting in pristine chats, loop back around
            if (chat.length === 1 && newSwipeId !== undefined && newSwipeId === chat[0]['swipes'].length && isPristine) {
                newSwipeId = 0;
            }
        }
        await standardSwipe();
        return;
    }
}

/**
 * @deprecated Use `swipe` instead.
 * Handles the swipe to the left event.
 * @param {JQuery.Event} _event Event.
 * @param {object} params Additional parameters.
 * @param {string} [params.source] The source of the swipe event.
 * @param {boolean} [params.repeated] Is the swipe event repeated.
 * @param {object} [params.message] The chat message to swipe.
 */
export async function swipe_left(_event, { source, repeated, message } = {}) {
    await swipe.call(this, _event, SWIPE_DIRECTION.LEFT, { source: source, repeated: repeated, message: message });
}

/**
 * @deprecated Use `swipe` instead.
 * Handles the swipe to the right event.
 * @param {JQuery.Event} [_event] Event.
 * @param {object} params Additional parameters.
 * @param {string} [params.source] The source of the swipe event.
 * @param {boolean} [params.repeated] Is the swipe event repeated.
 * @param {object} [params.message] The chat message to swipe.
 */
//MARK: swipe_right
export async function swipe_right(_event = null, { source, repeated, message } = {}) {
    await swipe.call(this, _event, SWIPE_DIRECTION.RIGHT, { source: source, repeated: repeated, message: message });
}

/**
 * Imports supported files dropped into the app window.
 * @param {File[]} files Array of files to process
 * @param {Map<File, string>} [data] Extra data to pass to the import function
 * @returns {Promise<void>}
 */
export async function processDroppedFiles(files, data = new Map()) {
    const allowedMimeTypes = [
        'application/json',
        'image/png',
        'application/yaml',
        'application/x-yaml',
        'text/yaml',
        'text/x-yaml',
    ];

    const allowedExtensions = [
        'charx',
        'byaf',
    ];

    const avatarFileNames = [];
    for (const file of files) {
        const extension = file.name.split('.').pop().toLowerCase();
        if (allowedMimeTypes.some(x => file.type.startsWith(x)) || allowedExtensions.includes(extension)) {
            const preservedName = data instanceof Map && data.get(file);
            const avatarFileName = await importCharacter(file, { preserveFileName: preservedName });
            if (avatarFileName !== undefined) {
                avatarFileNames.push(avatarFileName);
            }
        } else {
            toastr.warning(t`Unsupported file type: ` + file.name);
        }
    }

    if (avatarFileNames.length > 0) {
        await importCharactersTags(avatarFileNames);
        selectImportedChar(avatarFileNames[avatarFileNames.length - 1]);
    }
}

/**
 * Imports tags for the given characters
 * @param {string[]} avatarFileNames character avatar filenames whose tags are to import
 */
async function importCharactersTags(avatarFileNames) {
    await getCharacters();
    for (let i = 0; i < avatarFileNames.length; i++) {
        if (power_user.tag_import_setting !== tag_import_setting.NONE) {
            const importedCharacter = characters.find(character => character.avatar === avatarFileNames[i]);
            await importTags(importedCharacter);
        }
    }
}

/**
 * Selects the given imported char
 * @param {string} charId char to select
 */
function selectImportedChar(charId) {
    let oldSelectedChar = null;
    if (this_chid !== undefined) {
        oldSelectedChar = characters[this_chid].avatar;
    }
    select_rm_info('char_import_no_toast', charId, oldSelectedChar);
}

/**
 * Imports a character from a file.
 * @param {File} file File to import
 * @param {object} [options] - Options
 * @param {string} [options.preserveFileName] Whether to preserve original file name
 * @param {Boolean} [options.importTags=false] Whether to import tags
 * @returns {Promise<string>}
 */
async function importCharacter(file, { preserveFileName = '', importTags = false } = {}) {
    if (is_group_generating || is_send_press) {
        toastr.error(t`Cannot import characters while generating. Stop the request and try again.`, t`Import aborted`);
        throw new Error('Cannot import character while generating');
    }

    const ext = file.name.match(/\.(\w+)$/);
    if (!ext || !(['json', 'png', 'yaml', 'yml', 'charx', 'byaf'].includes(ext[1].toLowerCase()))) {
        return;
    }

    const exists = preserveFileName ? characters.find(character => character.avatar === preserveFileName) : undefined;

    const format = ext[1].toLowerCase();
    $('#character_import_file_type').val(format);
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('file_type', format);
    formData.append('user_name', name1);
    if (preserveFileName) formData.append('preserved_name', preserveFileName);

    try {
        const result = await fetch('/api/characters/import', {
            method: 'POST',
            body: formData,
            headers: getRequestHeaders({ omitContentType: true }),
            cache: 'no-cache',
        });

        if (!result.ok) {
            throw new Error(`Failed to import character: ${result.statusText}`);
        }

        const data = await result.json();

        if (data.error) {
            throw new Error(`Server returned an error: ${data.error}`);
        }

        if (data.file_name !== undefined) {
            let avatarFileName = `${data.file_name}.png`;

            // Refresh existing thumbnail
            if (exists && this_chid !== undefined) {
                await fetch(getThumbnailUrl('avatar', avatarFileName), { cache: 'reload' });
            }

            $('#character_search_bar').val('').trigger('input');

            if (exists) {
                toastr.success(t`Character Replaced: ${String(data.file_name).replace('.png', '')}`);
            } else {
                toastr.success(t`Character Created: ${String(data.file_name).replace('.png', '')}`);
            }
            if (importTags) {
                await importCharactersTags([avatarFileName]);
                selectImportedChar(data.file_name);
            }
            return avatarFileName;
        }
    } catch (error) {
        console.error('Error importing character', error);
        toastr.error(t`The file is likely invalid or corrupted.`, t`Could not import character`);
    }
}

async function importFromURL(items, files) {
    for (const item of items) {
        if (item.type === 'text/uri-list') {
            const uriList = await new Promise((resolve) => {
                item.getAsString((uriList) => { resolve(uriList); });
            });
            const uris = uriList.split('\n').filter(uri => uri.trim() !== '');
            try {
                for (const uri of uris) {
                    const request = await fetch(uri);
                    const data = await request.blob();
                    const fileName = request.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || uri.split('/').pop() || 'file.png';
                    const file = new File([data], fileName, { type: data.type });
                    files.push(file);
                }
            } catch (error) {
                console.error('Failed to import from URL', error);
            }
        }
    }
}

export async function doNewChat({ deleteCurrentChat = false } = {}) {
    //Make a new chat for selected character
    if ((!selected_group && this_chid == undefined) || menu_type == 'create') {
        return;
    }

    //Fix it; New chat doesn't create while open create character menu
    await waitUntilCondition(() => !isChatSaving, debounce_timeout.extended, 10);
    await clearChat();
    chat.length = 0;

    chat_file_for_del = getCurrentChatDetails()?.sessionName;

    // Make it easier to find in backups
    if (deleteCurrentChat) {
        await saveChatConditional();
    }

    if (selected_group) {
        await createNewGroupChat(selected_group);
        if (deleteCurrentChat) await deleteGroupChat(selected_group, chat_file_for_del, { jumpToNewChat: false }); // don't jump, new chat was already created and jumped to above
    }
    else {
        //RossAscends: added character name to new chat filenames and replaced Date.now() with humanizedDateTime;
        chat_metadata = {};
        characters[this_chid].chat = `${name2} - ${humanizedDateTime()}`;
        $('#selected_chat_pole').val(characters[this_chid].chat);
        await getChat();
        await createOrEditCharacter(new CustomEvent('newChat'));
        if (deleteCurrentChat) await delChat(chat_file_for_del + '.jsonl');
    }

}

/**
 * Renames a group or character chat.
 * @param {object} param Parameters for renaming chat
 * @param {string} [param.characterId] Character ID to rename chat for
 * @param {string} [param.groupId] Group ID to rename chat for
 * @param {string} param.oldFileName Old name of the chat (no JSONL extension)
 * @param {string} param.newFileName New name for the chat (no JSONL extension)
 * @param {boolean} [param.loader=true] Whether to show loader during the operation
 */
export async function renameGroupOrCharacterChat({ characterId, groupId, oldFileName, newFileName, loader }) {
    const currentChatId = getCurrentChatId();
    const isCurrentGroup = !!groupId && String(groupId) === String(selected_group);
    const isCurrentCharacter = characterId !== undefined && !selected_group && String(characterId) === String(this_chid);
    const body = {
        is_group: !!groupId,
        avatar_url: characters[characterId]?.avatar,
        original_file: `${oldFileName}.jsonl`,
        renamed_file: `${newFileName.trim()}.jsonl`,
    };

    if (body.original_file === body.renamed_file) {
        console.debug('Chat rename cancelled, old and new names are the same');
        return;
    }
    if (equalsIgnoreCaseAndAccents(body.original_file, body.renamed_file)) {
        toastr.warning(t`Name not accepted, as it is the same as before (ignoring case and accents).`, t`Rename Chat`);
        return;
    }

    try {
        loader && showLoader();

        const response = await fetch('/api/chats/rename', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Unsuccessful request.');
        }

        const data = await response.json();

        if (data.error) {
            throw new Error('Server returned an error.');
        }

        if (data.sanitizedFileName) {
            newFileName = data.sanitizedFileName;
        }

        if (groupId) {
            await renameGroupChat(groupId, oldFileName, newFileName);
        }
        else if (characterId !== undefined && characters[characterId]?.chat === oldFileName) {
            await updateRemoteChatName(characterId, newFileName);

            if (isCurrentCharacter) {
                $('#selected_chat_pole').val(characters[characterId].chat);
                await createOrEditCharacter();
            }
        }

        if ((isCurrentGroup || isCurrentCharacter) && currentChatId && currentChatId === oldFileName) {
            await reloadCurrentChat();
        }
    } catch {
        loader && hideLoader();
        await delay(500);
        await callGenericPopup('An error has occurred. Chat was not renamed.', POPUP_TYPE.TEXT);
    } finally {
        loader && hideLoader();
    }
}

/**
 * Renames the currently selected chat.
 * @param {string} oldFileName Old name of the chat (no JSONL extension)
 * @param {string} newName New name for the chat (no JSONL extension)
 */
export async function renameChat(oldFileName, newName) {
    return await renameGroupOrCharacterChat({
        characterId: this_chid,
        groupId: selected_group,
        oldFileName: oldFileName,
        newFileName: newName,
        loader: true,
    });
}

/**
 * Closes the current chat, clearing all associated data and resetting the UI.
 * If a message generation is in progress, it prompts the user to stop it first.
 * @returns {Promise<boolean>} True if the chat was successfully closed, false otherwise.
 */
export async function closeCurrentChat() {
    if (is_send_press == false) {
        await waitUntilCondition(() => !isChatSaving, debounce_timeout.extended, 10);
        await clearChat();
        chat.length = 0;
        resetSelectedGroup();
        setCharacterId(undefined);
        setCharacterName('');
        setActiveCharacter(null);
        setActiveGroup(null);
        this_edit_mes_id = undefined;
        chat_metadata = {};
        selected_button = 'characters';
        $('#rm_button_selected_ch').children('h2').text('');
        select_rm_characters();
        await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId());
        return true;
    } else {
        toastr.info(t`Please stop the message generation first.`);
        return false;
    }
}

/**
 * Forces the update of the chat name for a remote character.
 * @param {string|number} characterId Character ID to update chat name for
 * @param {string} newName New name for the chat
 * @returns {Promise<void>}
 */
export async function updateRemoteChatName(characterId, newName) {
    const character = characters[characterId];
    if (!character) {
        console.warn(`Character not found for ID: ${characterId}`);
        return;
    }
    character.chat = newName;
    const mergeRequest = {
        avatar: character.avatar,
        chat: newName,
    };
    const mergeResponse = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(mergeRequest),
    });
    if (!mergeResponse.ok) {
        console.error('Failed to save extension field', mergeResponse.statusText);
    }
}


function doCharListDisplaySwitch() {
    power_user.charListGrid = !power_user.charListGrid;
    document.body.classList.toggle('charListGrid', power_user.charListGrid);
    saveSettingsDebounced();
}

/**
 * Deletes a character completely, including associated chats if specified
 *
 * @param {string|string[]} characterKey - The key (avatar) of the character to be deleted
 * @param {Object} [options] - Optional parameters for the deletion
 * @param {boolean} [options.deleteChats=true] - Whether to delete associated chats or not
 * @param {boolean} [options.deleteForAllUsers=false] - Whether admins should delete the character for all users
 * @param {boolean} [options.skipFuturePushes=false] - Whether to opt out of future repushes for a pushed character
 * @return {Promise<void>} - A promise that resolves when the character is successfully deleted
 */
export async function deleteCharacter(characterKey, { deleteChats = true, deleteForAllUsers = false, skipFuturePushes = false } = {}) {
    if (!Array.isArray(characterKey)) {
        characterKey = [characterKey];
    }

    const inTempChat = this_chid === undefined && name2 === neutralCharacterName;
    if (inTempChat) {
        const confirmClose = await Popup.show.confirm(
            t`You are currently in a temporary chat.`,
            t`Deleting this character will close the chat and you will lose any unsaved messages. Do you want to proceed?`,
        );
        if (!confirmClose) {
            return;
        }
    }

    const closeChatResult = await closeCurrentChat();
    if (!closeChatResult) {
        return;
    }

    for (const key of characterKey) {
        const character = characters.find(x => x.avatar == key);
        if (!character) {
            toastr.warning(t`Character ${key} not found. Skipping deletion.`);
            continue;
        }

        const chid = characters.indexOf(character);
        const pastChats = await getPastCharacterChats(chid);

        const msg = {
            avatar_url: character.avatar,
            delete_chats: deleteChats,
            delete_for_all_users: deleteForAllUsers,
            skip_future_pushes: skipFuturePushes,
        };

        const response = await fetch('/api/characters/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(msg),
            cache: 'no-cache',
        });

        if (!response.ok) {
            let errorMessage = `${response.status} ${response.statusText}`;

            try {
                const errorData = await response.json();
                errorMessage = errorData?.error || errorData?.message || errorMessage;
            } catch {
                // Ignore malformed or empty error responses and fall back to the status text.
            }

            toastr.error(errorMessage, t`Failed to delete character`);
            continue;
        }

        accountStorage.removeItem(`AlertWI_${character.avatar}`);
        accountStorage.removeItem(`AlertRegex_${character.avatar}`);
        accountStorage.removeItem(`mediaWarningShown:${character.avatar}`);
        delete tag_map[character.avatar];
        select_rm_info('char_delete', character.name);

        if (deleteChats) {
            for (const chat of pastChats) {
                const name = chat.file_name.replace('.jsonl', '');
                await eventSource.emit(event_types.CHAT_DELETED, name);
            }
        }

        await eventSource.emit(event_types.CHARACTER_DELETED, { id: chid, character: character });
    }

    await removeCharacterFromUI();
}

/**
 * Function to delete a character from UI after character deletion API success.
 * It manages necessary UI changes such as closing advanced editing popup, unsetting
 * character ID, resetting characters array and chat metadata, deselecting character's tab
 * panel, removing character name from navigation tabs, clearing chat, fetching updated list of characters.
 * It also ensures to save the settings after all the operations.
 */
async function removeCharacterFromUI() {
    preserveNeutralChat();
    await clearChat({ flushPendingSave: false });
    $('#character_cross').trigger('click');
    resetChatState();
    $(document.getElementById('rm_button_selected_ch')).children('h2').text('');
    restoreNeutralChat();
    await getCharacters();
    await printMessages();
    saveSettingsDebounced();
    await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId());
}

/**
 * Creates a new assistant chat.
 * @param {object} params - Parameters for the new assistant chat
 * @param {boolean} [params.temporary=false] I need a temporary secretary
 * @returns {Promise<void>} - A promise that resolves when the new assistant chat is created
 */
export async function newAssistantChat({ temporary = false } = {}) {
    await clearChat();
    if (!temporary) {
        return openPermanentAssistantChat();
    }
    chat.splice(0, chat.length);
    chat_metadata = {};
    setCharacterName(neutralCharacterName);
    sendSystemMessage(system_message_types.ASSISTANT_NOTE);
}

/**
 * Event handler to open a navbar drawer when a drawer open button is clicked.
 * Handles click events on .drawer-opener elements.
 * Opens the drawer associated with the clicked button according to the data-target attribute.
 * @returns {void}
 */
function doDrawerOpenClick() {
    const targetDrawerID = $(this).attr('data-target');
    const drawer = $(`#${targetDrawerID}`);
    const drawerToggle = drawer.find('.drawer-toggle');
    const drawerWasOpenAlready = drawerToggle.parent().find('.drawer-content').hasClass('openDrawer');
    if (drawerWasOpenAlready || drawer.hasClass('resizing')) { return; }
    doNavbarIconClick.call(drawerToggle);
}

/**
 * Event handler to open or close a navbar drawer when a navbar icon is clicked.
 * Handles click events on .drawer-toggle elements.
 * @returns {Promise<void>}
 */
export async function doNavbarIconClick() {
    const icon = $(this).find('.drawer-icon');
    const drawer = $(this).parent().find('.drawer-content');
    const drawerWasOpenAlready = $(this).parent().find('.drawer-content').hasClass('openDrawer');
    const targetDrawerID = $(this).parent().find('.drawer-content').attr('id');

    if (!drawerWasOpenAlready) {
        const $openDrawers = $('.openDrawer:not(.pinnedOpen)');
        const $openIcons = $('.openIcon:not(.drawerPinnedOpen)');
        for (const iconEl of $openIcons) {
            $(iconEl).toggleClass('closedIcon openIcon');
        }
        for (const el of $openDrawers) {
            $(el).toggleClass('closedDrawer openDrawer');
        }
        if ($openDrawers.length && animation_duration) {
            await delay(animation_duration);
        }
        icon.toggleClass('openIcon closedIcon');
        drawer.toggleClass('openDrawer closedDrawer');

        if (targetDrawerID === 'right-nav-panel') {
            favsToHotswap();
            $('#rm_print_characters_block').trigger('scroll');
        }

        // Set the height of "autoSetHeight" textareas within the drawer to their scroll height
        if (!CSS.supports('field-sizing', 'content')) {
            const textareas = $(this).closest('.drawer').find('.drawer-content textarea.autoSetHeight');
            for (const textarea of textareas) {
                await resetScrollHeight($(textarea));
            }
        }
    } else if (drawerWasOpenAlready) {
        icon.toggleClass('closedIcon openIcon');
        drawer.toggleClass('closedDrawer openDrawer');
    }
}

function addDebugFunctions() {
    const doBackfill = async () => {
        for (const message of chat) {
            // System messages are not counted
            if (message.is_system) {
                continue;
            }

            if (!message.extra) {
                message.extra = {};
            }

            const tokenCountText = (message?.extra?.reasoning || '') + message.mes;
            message.extra.token_count = await getTokenCountAsync(tokenCountText, 0);
        }

        await saveChatConditional();
        await reloadCurrentChat();
    };

    registerDebugFunction('forceOnboarding', 'Force onboarding', 'Forces the onboarding process to restart.', async () => {
        firstRun = true;
        await saveSettings();
        location.reload();
    });

    registerDebugFunction('backfillTokenCounts', 'Backfill token counters',
        `Recalculates token counts of all messages in the current chat to refresh the counters.
        Useful when you switch between models that have different tokenizers.
        This is a visual change only. Your chat will be reloaded.`, doBackfill);

    registerDebugFunction('generationTest', 'Send a generation request', 'Generates text using the currently selected API.', async () => {
        const text = prompt('Input text:', 'Hello');
        toastr.info('Working on it...');
        const message = await generateRaw({ prompt: text });
        alert(message);
    });
    registerDebugFunction('toggleEventTracing', 'Toggle event tracing', 'Useful to see what triggered a certain event.', () => {
        localStorage.setItem('eventTracing', localStorage.getItem('eventTracing') === 'true' ? 'false' : 'true');
        toastr.info('Event tracing is now ' + (localStorage.getItem('eventTracing') === 'true' ? 'enabled' : 'disabled'));
    });

    registerDebugFunction('toggleRegenerateWarning', 'Toggle Ctrl+Enter regeneration confirmation', 'Toggle the warning when regenerating a message with a Ctrl+Enter hotkey.', () => {
        accountStorage.setItem('RegenerateWithCtrlEnter', accountStorage.getItem('RegenerateWithCtrlEnter') === 'true' ? 'false' : 'true');
        toastr.info('Regenerate warning is now ' + (accountStorage.getItem('RegenerateWithCtrlEnter') === 'true' ? 'disabled' : 'enabled'));
    });

    registerDebugFunction('copySetup', 'Copy ST setup to clipboard [WIP]', 'Useful data when reporting bugs', async () => {
        const getContextContents = getContext();
        const getSettingsContents = settings;
        //console.log(getSettingsContents);
        const logMessage = `
\`\`\`
API: ${getSettingsContents.main_api}
API Type: ${getSettingsContents[getSettingsContents.main_api + '_settings'].type}
API server: ${getSettingsContents.api_server}
Model: ${getContextContents.onlineStatus}
API Settings: ${JSON.stringify(getSettingsContents[getSettingsContents.main_api + '_settings'], null, 2)}
\`\`\`
    `;

        //console.log(getSettingsContents)
        //console.log(logMessage);

        try {
            await copyText(logMessage);
            toastr.info('Your ST API setup data has been copied to the clipboard.');
        } catch (error) {
            toastr.error('Failed to copy ST Setup to clipboard:', error);
        }
    });
}

function initCharacterSearch() {
    const debouncedCharacterSearch = debounce((searchQuery) => {
        entitiesFilter.setFilterData(FILTER_TYPES.SEARCH, searchQuery);
    });

    const searchForm = $('#form_character_search_form');
    const searchInput = $('#character_search_bar');
    const searchButton = $('#rm_button_search');

    const storageKey = 'characterSearchFormVisible';

    searchInput.on('input', function () {
        const searchQuery = String($(this).val());
        debouncedCharacterSearch(searchQuery);
    });

    searchButton.on('click', function () {
        const newVisibility = !searchForm.is(':visible');
        searchForm.toggle(newVisibility);
        searchButton.toggleClass('active', newVisibility);
        accountStorage.setItem(storageKey, String(newVisibility));
        if (newVisibility) {
            searchInput.trigger('focus');
        }
    });

    eventSource.on(event_types.APP_READY, () => {
        const isVisible = accountStorage.getItem(storageKey) === 'true';
        searchForm.toggle(isVisible);
        searchButton.toggleClass('active', isVisible);
    });
}

// MARK: DOM Handlers Start
jQuery(async function () {
    setTimeout(function () {
        $('#groupControlsToggle').trigger('click');
        $('#groupCurrentMemberListToggle .inline-drawer-icon').trigger('click');
    }, 200);

    $(document).on('click', '.api_loading', () => cancelStatusCheck('Canceled because connecting was manually canceled'));

    //////////INPUT BAR FOCUS-KEEPING LOGIC/////////////
    let S_TAPreviouslyFocused = false;
    $('#send_textarea').on('focusin focus click', () => {
        S_TAPreviouslyFocused = true;
    });
    $('#send_but, #option_regenerate, #option_continue, #mes_continue, #mes_regenerate, #mes_impersonate').on('click', () => {
        if (S_TAPreviouslyFocused) {
            $('#send_textarea').trigger('focus');
        }
    });
    $(document).on('click', event => {
        if ($(':focus').attr('id') !== 'send_textarea') {
            var validIDs = ['options_button', 'send_but', 'mes_impersonate', 'mes_regenerate', 'mes_continue', 'send_textarea', 'option_regenerate', 'option_continue'];
            if (!validIDs.includes($(event.target).attr('id'))) {
                S_TAPreviouslyFocused = false;
            }
        } else {
            S_TAPreviouslyFocused = true;
        }
    });

    /////////////////

    $('#swipes-checkbox').on('change', function () {
        swipes = !!$('#swipes-checkbox').prop('checked');
        if (swipes) {
            //console.log('toggle change calling showswipebtns');
            showSwipeButtons();
        } else {
            hideSwipeButtons();
        }
        saveSettingsDebounced();
    });

    ///// SWIPE BUTTON CLICKS ///////

    //limit swiping to only last message clicks
    $(document).on('click', '.last_mes .swipe_right', async (e, data) => await swipe(e, SWIPE_DIRECTION.RIGHT, data));
    $(document).on('click', '.last_mes .swipe_left', async (e, data) => await swipe(e, SWIPE_DIRECTION.LEFT, data));

    initCharacterSearch();

    $('#mes_impersonate').on('click', function () {
        $('#option_impersonate').trigger('click');
    });

    $('#mes_continue').on('click', function () {
        $('#option_continue').trigger('click');
    });

    $('#mes_regenerate').on('click', function () {
        $('#option_regenerate').trigger('click');
    });

    const userInputGenerateMutex = new SimpleMutex(sendTextareaMessage);
    $('#send_but').on('click', async function () {
        await userInputGenerateMutex.update();
    });

    //menu buttons setup

    $('#rm_button_settings').on('click', async function () {
        if (!await confirmCharacterEditorNavigation()) {
            return;
        }
        selected_button = 'settings';
        selectRightMenuWithAnimation('rm_api_block');
    });
    $('#rm_button_characters').on('click', async function () {
        if (!await confirmCharacterEditorNavigation()) {
            return;
        }
        selected_button = 'characters';
        select_rm_characters();
    });
    $('#rm_button_back').on('click', async function () {
        if (!await confirmCharacterEditorNavigation()) {
            return;
        }
        selected_button = 'characters';
        select_rm_characters();
    });
    $('#rm_button_create').on('click', async function () {
        if (!await confirmCharacterEditorNavigation()) {
            return;
        }
        selected_button = 'create';
        select_rm_create();
    });
    $('#rm_button_selected_ch').on('click', function () {
        if (selected_group) {
            select_group_chats(selected_group);
        } else {
            selected_button = 'character_edit';
            select_selected_character(this_chid);
        }
        $('#character_search_bar').val('').trigger('input');
    });

    $(document).on('click', '.character_select', async function () {
        const id = Number($(this).attr('data-chid'));
        await selectCharacterById(id);
    });

    $(document).on('click', '.bogus_folder_select', function () {
        const tagId = $(this).attr('tagid');
        console.debug('Bogus folder clicked', tagId);
        chooseBogusFolder($(this), tagId);
    });

    const cssAutofit = CSS.supports('field-sizing', 'content');
    if (!cssAutofit) {
        /**
         * Sets the scroll height of the edit textarea to fit the content.
         * @param {HTMLTextAreaElement} e Textarea element to auto-fit
         */
        function autoFitEditTextArea(e) {
            const scrollTop = chatElement.scrollTop();
            e.style.height = '0px';
            const newHeight = e.scrollHeight + 4;
            e.style.height = `${newHeight}px`;
            chatElement.scrollTop(scrollTop);
        }
        const autoFitEditTextAreaDebounced = debounce(autoFitEditTextArea, debounce_timeout.short);
        document.addEventListener('input', e => {
            if (e.target instanceof HTMLTextAreaElement && e.target.classList.contains('edit_textarea')) {
                const scrollbarShown = e.target.clientWidth < e.target.offsetWidth && e.target.offsetHeight >= window.innerHeight * 0.75;
                const immediately = (e.target.scrollHeight > e.target.offsetHeight && !scrollbarShown) || e.target.value === '';
                immediately ? autoFitEditTextArea(e.target) : autoFitEditTextAreaDebounced(e.target);
            }
        });
    }

    const chatElementScroll = document.getElementById('chat');
    const chatScrollHandler = function () {
        if (power_user.waifuMode) {
            scrollLock = true;
            return;
        }

        const scrollIsAtBottom = Math.abs(chatElementScroll.scrollHeight - chatElementScroll.clientHeight - chatElementScroll.scrollTop) < 5;

        // Resume autoscroll if the user scrolls to the bottom
        if (scrollLock && scrollIsAtBottom) {
            scrollLock = false;
        }

        // Cancel autoscroll if the user scrolls up
        if (!scrollLock && !scrollIsAtBottom) {
            scrollLock = true;
        }
    };
    chatElementScroll.addEventListener('scroll', chatScrollHandler, { passive: true });

    $(document).on('click', '.mes', function () {
        //when a 'delete message' parent div is clicked
        // and we are in delete mode and del_checkbox is visible
        if (!is_delete_mode || !$(this).children('.del_checkbox').is(':visible')) {
            return;
        }
        $('.mes').children('.del_checkbox').each(function () {
            $(this).prop('checked', false);
            $(this).parent().removeClass('selected');
        });
        $(this).addClass('selected'); //sets the bg of the mes selected for deletion
        var i = Number($(this).attr('mesid')); //checks the message ID in the chat
        this_del_mes = i;
        //as long as the current message ID is less than the total chat length
        while (i < chat.length) {
            //sets the bg of the all msgs BELOW the selected .mes
            $(`.mes[mesid="${i}"]`).addClass('selected');
            $(`.mes[mesid="${i}"]`).children('.del_checkbox').prop('checked', true);
            i++;
        }
    });

    /**
     * Handles the deletion of a chat file, including group chats.
     *
     * @param {string} chatFile - The name of the chat file to delete.
     * @param {object} chatContext - Row/owner context for the target chat.
     * @param {boolean} [fromSlashCommand=false] - Whether the deletion was triggered from a slash command.
     * @returns {Promise<void>}
     */
    async function refreshManageChatsPopup(highlightNames = []) {
        if (manageChatsMode === 'deleted') {
            await displayDeletedCharacterChats(manageChatsSelectedOrphanKey, highlightNames);
        } else {
            await displayPastChats(highlightNames, manageChatsOwnerContext ?? getCurrentManageChatsOwner());
        }
    }

    async function renameManageChatsChat(rowContext, oldFileName, newName) {
        if (rowContext?.rowType === 'orphan-character' && rowContext.orphanKey) {
            await renameOrphanCharacterChat(rowContext.orphanKey, oldFileName, newName);
            return;
        }

        if (rowContext?.rowType === 'orphan-group' && !getManageChatsOwnerDetails(rowContext.ownerContext).ownerContext) {
            toastr.warning(t`That group no longer exists.`);
            await displayDeletedCharacterChats(manageChatsSelectedOrphanKey);
            return;
        }

        const ownerContext = rowContext?.ownerContext ?? manageChatsOwnerContext ?? getCurrentManageChatsOwner();
        await renameManageChatsOwnerChat(ownerContext, oldFileName, newName);
    }

    async function deleteManageChatsChat(rowContext, fileName) {
        if (rowContext?.rowType === 'orphan-character' && rowContext.orphanKey) {
            await deleteOrphanCharacterChat(rowContext.orphanKey, fileName);
            return;
        }

        if (rowContext?.rowType === 'orphan-group' && !getManageChatsOwnerDetails(rowContext.ownerContext).ownerContext) {
            toastr.warning(t`That group no longer exists.`);
            await displayDeletedCharacterChats(manageChatsSelectedOrphanKey);
            return;
        }

        const ownerContext = rowContext?.ownerContext ?? manageChatsOwnerContext ?? getCurrentManageChatsOwner();
        await deleteManageChatsOwnerChat(ownerContext, fileName);
    }

    async function exportManageChatsChat(rowContext, fileName, format) {
        if (format === 'html') {
            await exportManageChatsChatAsHtml(rowContext, fileName);
            return;
        }

        if (rowContext?.rowType === 'orphan-character' && rowContext.orphanKey) {
            await exportOrphanCharacterChat(rowContext.orphanKey, fileName, format);
            return;
        }

        if (rowContext?.rowType === 'orphan-group' && !getManageChatsOwnerDetails(rowContext.ownerContext).ownerContext) {
            toastr.warning(t`That group no longer exists.`);
            await displayDeletedCharacterChats(manageChatsSelectedOrphanKey);
            return;
        }

        const ownerContext = rowContext?.ownerContext ?? manageChatsOwnerContext ?? getCurrentManageChatsOwner();
        await exportManageChatsOwnerChat(ownerContext, fileName, format);
    }

    async function handleDeleteChat(chatFile, chatContext, fromSlashCommand = false) {
        // Close past chat popup.
        $('#select_chat_cross').trigger('click');
        showLoader();
        await deleteManageChatsChat(chatContext, String(chatFile).replace(/\.jsonl$/i, ''));

        if (fromSlashCommand) {  // When called from `/delchat` command, don't re-open the history view.
            $('#options').hide();  // Hide option popup menu.
            hideLoader();
        } else {  // Open the history view again after 2 seconds (delay to avoid edge cases for deleting last chat).
            setTimeout(async function () {
                await refreshManageChatsPopup();
                $('#options').hide();  // Hide option popup menu.
                hideLoader();
            }, 2000);
        }
    }

    $(document).on('click', '.PastChat_cross', async function (e, { fromSlashCommand = false } = {}) {
        e.stopPropagation();
        chat_file_for_del = $(this).attr('file_name');
        const rowContext = getManageChatsRowContext(this) ?? { ownerContext: getManageChatsOwnerFromElement(this) ?? manageChatsOwnerContext ?? getCurrentManageChatsOwner() };
        console.debug('detected cross click for' + chat_file_for_del);

        // Skip confirmation if called from a slash command.
        if (fromSlashCommand) {
            await handleDeleteChat(chat_file_for_del, rowContext, true);
            return;
        }

        const result = await callGenericPopup('<h3>' + t`Delete the Chat File?` + '</h3>', POPUP_TYPE.CONFIRM);
        if (result === POPUP_RESULT.AFFIRMATIVE) {
            await handleDeleteChat(chat_file_for_del, rowContext, false);
        }
    });

    $('#advanced_div').on('click', function () {
        if (!is_advanced_char_open) {
            is_advanced_char_open = true;
            $('#character_popup').css({ 'display': 'flex', 'opacity': 0.0 }).addClass('open');
            $('#character_popup').transition({
                opacity: 1.0,
                duration: animation_duration,
                easing: animation_easing,
            });
        } else {
            is_advanced_char_open = false;
            $('#character_popup').css('display', 'none').removeClass('open');
        }
    });

    $('#character_cross').on('click', function () {
        is_advanced_char_open = false;
        $('#character_popup').transition({
            opacity: 0,
            duration: animation_duration,
            easing: animation_easing,
        });
        setTimeout(function () { $('#character_popup').css('display', 'none'); }, animation_duration);
    });

    $('#character_popup_ok').on('click', function () {
        is_advanced_char_open = false;
        $('#character_popup').css('display', 'none');
    });

    $('#dialogue_popup_ok').on('click', async function (_e, customData) {
        const fromSlashCommand = customData?.fromSlashCommand || false;
        dialogueCloseStop = false;
        $('#shadow_popup').transition({
            opacity: 0,
            duration: animation_duration,
            easing: animation_easing,
        });
        setTimeout(function () {
            if (dialogueCloseStop) return;
            $('#shadow_popup').css('display', 'none');
            $('#dialogue_popup').removeClass('large_dialogue_popup');
            $('#dialogue_popup').removeClass('wide_dialogue_popup');
        }, animation_duration);

        if (popup_type == 'del_chat') {
            await handleDeleteChat(chat_file_for_del, manageChatsOwnerContext ?? getCurrentManageChatsOwner(), fromSlashCommand);
        }

        if (dialogueResolve) {
            if (popup_type == 'input') {
                dialogueResolve($('#dialogue_popup_input').val());
                $('#dialogue_popup_input').val('');
            }
            else {
                dialogueResolve(true);
            }

            dialogueResolve = null;
        }
    });

    $('#dialogue_popup_cancel').on('click', function (e) {
        dialogueCloseStop = false;
        $('#shadow_popup').transition({
            opacity: 0,
            duration: animation_duration,
            easing: animation_easing,
        });
        setTimeout(function () {
            if (dialogueCloseStop) return;
            $('#shadow_popup').css('display', 'none');
            $('#dialogue_popup').removeClass('large_dialogue_popup');
        }, animation_duration);

        popup_type = '';

        if (dialogueResolve) {
            dialogueResolve(false);
            dialogueResolve = null;
        }
    });

    $('#add_avatar_button').on('change', function () {
        const inputElement = /** @type {HTMLInputElement} */ (this);
        read_avatar_load(inputElement);
    });

    $('#form_create').on('submit', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        await createOrEditCharacter(e.originalEvent ?? e);
    });

    $('#delete_button').on('click', async function () {
        if (this_chid === undefined || !characters[this_chid]) {
            toastr.warning('No character selected.');
            return;
        }

        let deleteChats = false;
        let deleteForAllUsers = false;
        let skipFuturePushes = false;
        const ownerHandles = getCharacterOwnerHandles(this_chid);
        const offerRepushOptOut = Boolean(currentUser?.handle) && ownerHandles.length > 0 && !ownerHandles.includes(currentUser.handle);

        const confirm = await Popup.show.confirm(t`Delete the character?`, await renderTemplateAsync('deleteConfirm', {
            isAdmin: isAdmin(),
            offerRepushOptOut,
        }), {
            onClose: () => {
                deleteChats = !!$('#del_char_checkbox').prop('checked');
                deleteForAllUsers = !!$('#del_char_checkbox_all_users').prop('checked');
                skipFuturePushes = !deleteForAllUsers && !!$('#del_char_checkbox_skip_future_pushes').prop('checked');
            },
        });
        if (!confirm) {
            return;
        }

        await deleteCharacter(characters[this_chid].avatar, {
            deleteChats: deleteChats,
            deleteForAllUsers: deleteForAllUsers,
            skipFuturePushes: skipFuturePushes,
        });
    });

    //////// OPTIMIZED ALL CHAR CREATION/EDITING TEXTAREA LISTENERS ///////////////

    $('#character_name_pole').on('input', function () {
        if (menu_type == 'create') {
            create_save.name = String($('#character_name_pole').val());
        } else {
            markCharacterEditorDirty();
        }
    });

    const elementsToUpdate = {
        '#description_textarea': function () { create_save.description = String($('#description_textarea').val()); },
        '#creator_notes_textarea': function () { create_save.creator_notes = String($('#creator_notes_textarea').val()); },
        '#character_version_textarea': function () { create_save.character_version = String($('#character_version_textarea').val()); },
        '#system_prompt_textarea': function () { create_save.system_prompt = String($('#system_prompt_textarea').val()); },
        '#post_history_instructions_textarea': function () { create_save.post_history_instructions = String($('#post_history_instructions_textarea').val()); },
        '#creator_textarea': function () { create_save.creator = String($('#creator_textarea').val()); },
        '#tags_textarea': function () { create_save.tags = String($('#tags_textarea').val()); },
        '#personality_textarea': function () { create_save.personality = String($('#personality_textarea').val()); },
        '#scenario_pole': function () { create_save.scenario = String($('#scenario_pole').val()); },
        '#mes_example_textarea': function () { create_save.mes_example = String($('#mes_example_textarea').val()); },
        '#firstmessage_textarea': function () { create_save.first_message = String($('#firstmessage_textarea').val()); },
        '#talkativeness_slider': function () { create_save.talkativeness = Number($('#talkativeness_slider').val()); },
        '#depth_prompt_prompt': function () { create_save.depth_prompt_prompt = String($('#depth_prompt_prompt').val()); },
        '#depth_prompt_depth': function () { create_save.depth_prompt_depth = Number($('#depth_prompt_depth').val()); },
        '#depth_prompt_role': function () { create_save.depth_prompt_role = String($('#depth_prompt_role').val()); },
    };

    Object.keys(elementsToUpdate).forEach(function (id) {
        $(id).on('input', function () {
            if (menu_type == 'create') {
                elementsToUpdate[id]();
            } else {
                markCharacterEditorDirty();
            }
        });
    });

    $('#creator_notes_textarea').on('input', function () {
        const notes = String($('#creator_notes_textarea').val());
        $('#creator_notes_spoiler').html(formatCreatorNotes(notes));
    });

    $('#favorite_button').on('click', async function () {
        const nextValue = !fav_ch_checked;
        updateFavButtonState(nextValue);

        if (menu_type === 'create') {
            return;
        }

        const character = characters[this_chid];
        if (!character) {
            updateFavButtonState(!nextValue);
            return;
        }

        const saved = await persistCharacterFavorite(character.avatar, nextValue, {
            sharedCharacterKey: character.sharedCharacterKey || character.data?.extensions?.aikobots?.shared_character_key || '',
        });
        if (!saved) {
            updateFavButtonState(!nextValue);
            return;
        }

        await printCharacters(false);
    });

    /* $("#renameCharButton").on('click', renameCharacter); */

    $(document).on('click', '.renameChatButton', async function (e) {
        e.stopPropagation();
        const rowContext = getManageChatsRowContext(this) ?? { ownerContext: getManageChatsOwnerFromElement(this) ?? manageChatsOwnerContext ?? getCurrentManageChatsOwner() };
        const oldFileNameFull = $(this).closest('.select_chat_block_wrapper').find('.select_chat_block_filename').text();
        const oldFileName = oldFileNameFull.replace('.jsonl', '');

        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, oldFileName);

        if (!newName || typeof newName !== 'string' || newName == oldFileName) {
            console.log('no new name found, aborting');
            return;
        }

        await renameManageChatsChat(rowContext, oldFileName, newName);

        await delay(250);
        await refreshManageChatsPopup();
        $('#options').hide();
    });

    $(document).on('click', '.exportChatButton, .exportRawChatButton', async function (e) {
        e.stopPropagation();
        const format = $(this).data('format') || 'txt';
        const rowContext = getManageChatsRowContext(this) ?? { ownerContext: getManageChatsOwnerFromElement(this) ?? manageChatsOwnerContext ?? getCurrentManageChatsOwner() };
        const filenamefull = $(this).closest('.select_chat_block_wrapper').find('.select_chat_block_filename').text();
        console.log(`exporting ${filenamefull} in ${format} format`);

        const filename = filenamefull.replace('.jsonl', '');
        try {
            await exportManageChatsChat(rowContext, filename, format);
        } catch (error) {
            // display error message
            console.log(`An error has occurred: ${error.message}`);
            await delay(250);
            toastr.error(`Error: ${error.message}`);
        }
    });


    const button = $('#options_button');
    const menu = $('#options');
    let isOptionsMenuVisible = false;

    function showMenu() {
        showBookmarksButtons();
        menu.fadeIn(animation_duration);
        optionsPopper.update();
        isOptionsMenuVisible = true;
    }

    function hideMenu() {
        menu.fadeOut(animation_duration);
        optionsPopper.update();
        isOptionsMenuVisible = false;
    }

    function isMouseOverButtonOrMenu() {
        return menu.is(':hover, :focus-within') || button.is(':hover, :focus');
    }

    button.on('click', function () {
        if (isOptionsMenuVisible) {
            hideMenu();
        } else {
            showMenu();
        }
    });
    $(document).on('click', function () {
        if (!isOptionsMenuVisible) return;
        if (!isMouseOverButtonOrMenu()) { hideMenu(); }
    });

    /* $('#set_chat_character_settings').on('click', setScenarioOverride); */

    ///////////// OPTIMIZED LISTENERS FOR LEFT SIDE OPTIONS POPUP MENU //////////////////////
    $('#options [id]').on('click', async function (event, customData) {
        const fromSlashCommand = customData?.fromSlashCommand || false;
        var id = $(this).attr('id');

        // Check whether a custom prompt was provided via custom data (for example through a slash command)
        const additionalPrompt = customData?.additionalPrompt?.trim() || undefined;
        const buildOrFillAdditionalArgs = (args = {}) => ({
            ...args,
            ...(additionalPrompt !== undefined && { quiet_prompt: additionalPrompt, quietToLoud: true }),
        });

        if (id == 'option_select_chat') {
            await handleManageChatsAction({ fromSlashCommand });
        }

        else if (id == 'option_sync_current_chat') {
            await syncCurrentChatToServer();
        }

        else if (id == 'option_start_new_chat') {
            await handleStartNewChatAction();
        }

        else if (id == 'option_regenerate') {
            closeMessageEditor();
            if (is_send_press == false) {
                //hideSwipeButtons();

                if (selected_group) {
                    regenerateGroup();
                }
                else {
                    is_send_press = true;
                    Generate('regenerate', buildOrFillAdditionalArgs());
                }
            }
        }

        else if (id == 'option_impersonate') {
            if (is_send_press == false || fromSlashCommand) {
                is_send_press = true;
                Generate('impersonate', buildOrFillAdditionalArgs());
            }
        }

        else if (id == 'option_continue') {
            if (this_edit_mes_id >= 0) return; // don't proceed if editing a message

            if (is_send_press == false || fromSlashCommand) {
                is_send_press = true;
                Generate('continue', buildOrFillAdditionalArgs());
            }
        }

        else if (id == 'option_delete_mes') {
            setTimeout(() => openMessageDelete(fromSlashCommand), animation_duration);
        }

        else if (id == 'option_close_chat') {
            await handleCloseChatAction();
        }

        else if (id === 'option_settings') {
            //var checkBox = document.getElementById("waifuMode");
            var topBar = document.getElementById('top-bar');
            var topSettingsHolder = document.getElementById('top-settings-holder');
            var divchat = document.getElementById('chat');

            //if (checkBox.checked) {
            if (topBar.style.display === 'none') {
                topBar.style.display = ''; // or "inline-block" if that's the original display value
                topSettingsHolder.style.display = ''; // or "inline-block" if that's the original display value

                divchat.style.borderRadius = '';
                divchat.style.backgroundColor = '';

            } else {

                divchat.style.borderRadius = '10px'; // Adjust the value to control the roundness of the corners
                divchat.style.backgroundColor = ''; // Set the background color to your preference

                topBar.style.display = 'none';
                topSettingsHolder.style.display = 'none';
            }
            //}
        }
        hideMenu();
    });

    $('#newChatFromManageScreenButton').on('click', async function () {
        if (manageChatsMode === 'deleted') {
            return;
        }

        await createNewManageChatsOwnerChat(manageChatsOwnerContext ?? getCurrentManageChatsOwner());
        $('#select_chat_cross').trigger('click');
    });

    //////////////////////////////////////////////////////////////////////////////////////////////

    //functionality for the cancel delete messages button, reverts to normal display of input form
    $('#dialogue_del_mes_cancel').on('click', function () {
        $('#dialogue_del_mes').css('display', 'none');
        $('#send_form').css('display', css_send_form_display);
        $('.del_checkbox').each(function () {
            $(this).css('display', 'none');
            $(this).parent().children('.for_checkbox').css('display', 'block');
            $(this).parent().removeClass('selected');
            $(this).prop('checked', false);
        });
        showSwipeButtons();
        this_del_mes = -1;
        is_delete_mode = false;
    });

    //confirms message deletion with the "ok" button
    $('#dialogue_del_mes_ok').on('click', async function () {
        $('#dialogue_del_mes').css('display', 'none');
        $('#send_form').css('display', css_send_form_display);
        $('.del_checkbox').each(function () {
            $(this).css('display', 'none');
            $(this).parent().children('.for_checkbox').css('display', 'block');
            $(this).parent().removeClass('selected');
            $(this).prop('checked', false);
        });

        if (this_del_mes >= 0) {
            chatElement.find(`.mes[mesid="${this_del_mes}"]`).nextAll('div').remove();
            chatElement.find(`.mes[mesid="${this_del_mes}"]`).remove();
            chat.length = this_del_mes;
            restoreTimedWorldInfoFromChat();
            chat_metadata['tainted'] = true;
            await saveChatConditional();
            chatElement.scrollTop(chatElement[0].scrollHeight);
            await eventSource.emit(event_types.MESSAGE_DELETED, this_del_mes, chat.length);
            chatElement.find('.mes').removeClass('last_mes');
            chatElement.find('.mes').last().addClass('last_mes');
        } else {
            console.log('this_del_mes is not >= 0, not deleting');
        }

        showSwipeButtons();
        this_del_mes = -1;
        is_delete_mode = false;
    });

    $('#main_api').on('change', async function () {
        cancelStatusCheck('Canceled because main api changed');
        changeMainAPI();
        saveSettingsDebounced();
        await eventSource.emit(event_types.MAIN_API_CHANGED, { apiId: main_api });
    });

    ////////////////// OPTIMIZED RANGE SLIDER LISTENERS////////////////

    var sliderLocked = true;
    var sliderTimer;

    $('input[type=\'range\']').on('touchstart', function () {
        // Unlock the slider after 300ms
        setTimeout(function () {
            sliderLocked = false;
            $(this).css('background-color', 'var(--SmartThemeQuoteColor)');
        }.bind(this), 300);
    });

    $('input[type=\'range\']').on('touchend', function () {
        clearTimeout(sliderTimer);
        $(this).css('background-color', '');
        sliderLocked = true;
    });

    $('input[type=\'range\']').on('touchmove', function (event) {
        if (sliderLocked) {
            event.preventDefault();
        }
    });

    const sliders = [
        {
            sliderId: '#amount_gen',
            counterId: '#amount_gen_counter',
            format: (val) => `${val}`,
            setValue: (val) => { amount_gen = Number(val); },
        },
        {
            sliderId: '#max_context',
            counterId: '#max_context_counter',
            format: (val) => `${val}`,
            setValue: (val) => { max_context = Number(val); },
        },
    ];

    sliders.forEach(slider => {
        $(document).on('input', slider.sliderId, function () {
            const value = $(this).val();
            const formattedValue = slider.format(value);
            slider.setValue(value);
            $(slider.counterId).val(formattedValue);
            saveSettingsDebounced();
        });
    });

    //////////////////////////////////////////////////////////////

    $('#select_chat_cross').on('click', function () {
        $('#shadow_select_chat_popup').transition({
            opacity: 0,
            duration: animation_duration,
            easing: animation_easing,
        });
        setTimeout(function () { $('#shadow_select_chat_popup').css('display', 'none'); }, animation_duration);
    });

    $(document).on('pointerup', '.mes_copy', async function () {
        if (this_chid !== undefined || selected_group || name2 === neutralCharacterName) {
            try {
                const messageId = $(this).closest('.mes').attr('mesid');
                const text = chat[messageId]['mes'];
                await copyText(text);
                toastr.info('Copied!', '', { timeOut: 2000 });
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        }
    });

    //********************
    //***Message Editor***
    $(document).on('click', '.mes_edit', async function () {
        if (is_delete_mode) {
            return;
        }
        if (this_chid !== undefined || selected_group || name2 === neutralCharacterName) {
            // Previously system messages we're allowed to be edited
            /*const message = $(this).closest(".mes");

            if (message.data("isSystem")) {
                return;
            }*/

            if (this_edit_mes_id >= 0) {
                let mes_edited = chatElement.find(`[mesid="${this_edit_mes_id}"]`).find('.mes_edit_done');
                if (Number(edit_mes_id) == chat.length - 1) { //if the generating swipe (...)
                    let run_edit = true;
                    if (chat[edit_mes_id]['swipe_id'] !== undefined) {
                        if (chat[edit_mes_id]['swipes'].length === chat[edit_mes_id]['swipe_id']) {
                            run_edit = false;
                        }
                    }
                    if (run_edit) {
                        hideSwipeButtons();
                    }
                }
                await messageEditDone(mes_edited);
            }
            var edit_mes_id = Number($(this).closest('.mes').attr('mesid'));

            await messageEdit(edit_mes_id);
        }
    });

    $(document).on('input', '#curEditTextarea', function () {
        if (power_user.auto_save_msg_edits === true) {
            messageEditAuto($(this));
        }
    });

    $(document).on('click', '.extraMesButtonsHint', function (e) {
        const $hint = $(e.target);
        const $buttons = $hint.siblings('.extraMesButtons');

        $hint.transition({
            opacity: 0,
            duration: animation_duration,
            easing: animation_easing,
            complete: function () {
                $hint.hide();
                $buttons
                    .addClass('visible')
                    .css({
                        opacity: 0,
                        display: 'flex',
                    })
                    .transition({
                        opacity: 1,
                        duration: animation_duration,
                        easing: animation_easing,
                    });
            },
        });
    });

    $(document).on('click', function (e) {
        // Expanded options don't need to be closed
        if (power_user.expand_message_actions) {
            return;
        }

        // Check if the click was outside the relevant elements
        if (!$(e.target).closest('.extraMesButtons, .extraMesButtonsHint').length) {
            const $visibleButtons = $('.extraMesButtons.visible');

            if (!$visibleButtons.length) {
                return;
            }

            const $hiddenHints = $('.extraMesButtonsHint:hidden');

            // Transition out the .extraMesButtons first
            $visibleButtons.transition({
                opacity: 0,
                duration: animation_duration,
                easing: animation_easing,
                complete: function () {
                    // Hide the .extraMesButtons after the transition
                    $(this)
                        .hide()
                        .removeClass('visible');

                    // Transition the .extraMesButtonsHint back in
                    $hiddenHints
                        .show()
                        .transition({
                            opacity: 0.3,
                            duration: animation_duration,
                            easing: animation_easing,
                            complete: function () {
                                $(this).css('opacity', '');
                            },
                        });
                },
            });
        }
    });

    $(document).on('click', '.mes_edit_cancel', async function () {
        await messageEditCancel.call(this, this_edit_mes_id);
    });

    $(document).on('click', '.mes_edit_up', async function () {
        if (this_edit_mes_id <= 0) {
            return;
        }
        const targetId = Number(this_edit_mes_id) - 1;
        await messageEditMove(this_edit_mes_id, targetId);
    });

    $(document).on('click', '.mes_edit_down', async function () {
        if (this_edit_mes_id >= chat.length - 1) {
            return;
        }

        const targetId = Number(this_edit_mes_id) + 1;
        await messageEditMove(this_edit_mes_id, targetId);
    });

    $(document).on('click', '.mes_edit_copy', async function () {
        if (!await ensureMessageEditable(this_edit_mes_id, 'copy this message')) {
            return;
        }

        const confirmation = await callGenericPopup(t`Create a copy of this message?`, POPUP_TYPE.CONFIRM);
        if (!confirmation) {
            return;
        }

        hideSwipeButtons();
        const oldScroll = chatElement[0].scrollTop;
        const clone = structuredClone(chat[this_edit_mes_id]);
        clone.send_date = Date.now();
        clone.mes = $(this).closest('.mes').find('.edit_textarea').val().toString();

        if (power_user.trim_spaces) {
            clone.mes = clone.mes.trim();
        }

        chat.splice(Number(this_edit_mes_id) + 1, 0, clone);
        syncSplitTailStateAfterMutation();
        addOneMessage(clone, { insertAfter: this_edit_mes_id });

        updateViewMessageIds();
        await saveChatConditional();
        chatElement[0].scrollTop = oldScroll;
        showSwipeButtons();
    });

    $(document).on('click', '.mes_edit_delete', async function (event, customData) {
        const fromSlashCommand = customData?.fromSlashCommand || false;
        const message = chat[this_edit_mes_id];
        const selectedSwipe = message['swipe_id'] ?? undefined;
        const swipesArray = Array.isArray(message['swipes']) ? message['swipes'] : [];
        const canDeleteSwipe = power_user.confirm_message_delete && !fromSlashCommand && !message.is_user && swipesArray.length > 1 && this_edit_mes_id === chat.length - 1 && selectedSwipe !== undefined;
        await deleteMessage(Number(this_edit_mes_id), canDeleteSwipe ? selectedSwipe : undefined, power_user.confirm_message_delete && fromSlashCommand !== true);
    });

    $(document).on('click', '.mes_edit_done', async function () {
        await messageEditDone($(this));
    });

    //Select chat

    //**************************CHARACTER IMPORT EXPORT*************************//
    $('#character_import_button').on('click', function () {
        $('#character_import_file').trigger('click');
    });

    $('#character_import_file').on('change', async function (e) {
        $('#rm_info_avatar').html('');

        if (!(e.target instanceof HTMLInputElement)) {
            return;
        }

        if (!e.target.files.length) {
            return;
        }

        const avatarFileNames = [];
        for (const file of e.target.files) {
            const avatarFileName = await importCharacter(file);
            if (avatarFileName !== undefined) {
                avatarFileNames.push(avatarFileName);
            }
        }

        if (avatarFileNames.length > 0) {
            await importCharactersTags(avatarFileNames);
            selectImportedChar(avatarFileNames[avatarFileNames.length - 1]);
        }

        // Clear the file input value to allow re-uploading the same file
        e.target.value = '';
    });

    $('#export_button').on('click', function () {
        isExportPopupOpen = !isExportPopupOpen;
        $('#export_format_popup').toggle(isExportPopupOpen);
        exportPopper.update();
    });

    $('#submit_character_review_button').on('click', async function () {
        if (this_chid === undefined || !characters[this_chid]) {
            toastr.error('Choose a saved character first.', 'Submission unavailable');
            return;
        }

        if (!canSubmitCharacterForReview(this_chid)) {
            toastr.info(`Only ${getCharacterOwnerLabel(this_chid)} and admins can submit this character.`, 'Submission unavailable');
            return;
        }

        if (canEditCharacterMetadata(this_chid)) {
            const saved = await createOrEditCharacter();
            if (!saved) {
                return;
            }
        }

        await submitSelectedCharacterForReview(characters[this_chid]);
    });

    $(document).on('click', '.export_format', async function () {
        const format = $(this).data('format');

        if (!format) {
            return;
        }

        $('#export_format_popup').hide();
        isExportPopupOpen = false;
        exportPopper.update();

        // Save before exporting
        await createOrEditCharacter();
        const body = { format, avatar_url: characters[this_chid].avatar };

        const response = await fetch('/api/characters/export', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (response.ok) {
            const filename = characters[this_chid].avatar.replace('.png', `.${format}`);
            const blob = await response.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.setAttribute('download', filename);
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(a.href);
            document.body.removeChild(a);
        }
    });
    //**************************CHAT IMPORT EXPORT*************************//
    $('#chat_import_button').on('click', function () {
        if (manageChatsMode === 'deleted') {
            return;
        }

        $('#chat_import_file').trigger('click');
    });

    $('#chat_import_file').on('change', async function (e) {
        const targetElement = e.target;
        const formElement = document.getElementById('form_import_chat');
        if (!(targetElement instanceof HTMLInputElement) || !(formElement instanceof HTMLFormElement)) {
            return;
        }

        if (manageChatsMode === 'deleted') {
            targetElement.value = '';
            return;
        }

        const ownerContext = manageChatsOwnerContext ?? getCurrentManageChatsOwner();
        const ownerDetails = getManageChatsOwnerDetails(ownerContext);
        if (!ownerDetails.ownerContext) {
            targetElement.value = '';
            return;
        }

        const importedFileNames = [];

        for (const file of targetElement.files) {
            const ext = file.name.match(/\.(\w+)$/);
            const format = ext?.[1]?.toLowerCase();

            if (!['json', 'jsonl'].includes(format)) {
                toastr.warning(t`Only JSON and JSONL files are supported for chat imports.`);
                continue;
            }

            if (ownerDetails.isGroup && format === 'json') {
                toastr.warning(t`Only SillyTavern's own format is supported for group chat imports. Sorry!`);
                continue;
            }

            const formData = new FormData(formElement);
            formData.set('file_type', format);
            formData.set('avatar', file);
            formData.set('user_name', name1);
            formData.set('avatar_url', ownerDetails.avatarUrl || '');
            formData.set('character_name', ownerDetails.characterName || '');

            const result = ownerDetails.isGroup
                ? await importGroupChat(formData, { refresh: false, groupId: ownerDetails.groupId })
                : await importCharacterChat(formData, { refresh: false });
            importedFileNames.push(...result);
        }

        if (importedFileNames.length > 0) {
            toastr.success(t`Successfully imported ${importedFileNames.length} chat(s).`);
        }

        await displayPastChats(importedFileNames, ownerDetails.ownerContext);

        targetElement.value = '';
    });

    $('#rm_button_group_chats').on('click', function () {
        selected_button = 'group_chats';
        select_group_chats();
    });

    $('#rm_button_back_from_group').on('click', function () {
        selected_button = 'characters';
        select_rm_characters();
    });

    $('#dupe_button').on('click', async function () {
        await duplicateCharacter();
    });

    $(document).on('click', '.mes_stop', function () {
        stopGeneration();
    });

    $(document).on('click', '#form_sheld .stscript_continue', function () {
        pauseScriptExecution();
    });

    $(document).on('click', '#form_sheld .stscript_pause', function () {
        pauseScriptExecution();
    });

    $(document).on('click', '#form_sheld .stscript_stop', function () {
        stopScriptExecution();
    });

    $(document).on('click', '.drawer-opener', doDrawerOpenClick);

    $('.drawer-toggle').on('click', doNavbarIconClick);

    $('html').on('touchstart mousedown', async function (e) {
        const clickTarget = $(e.target);

        if (isExportPopupOpen
            && clickTarget.closest('#export_button').length == 0
            && clickTarget.closest('#export_format_popup').length == 0) {
            $('#export_format_popup').hide();
            isExportPopupOpen = false;
            exportPopper.update();
        }

        const forbiddenTargets = [
            '#character_cross',
            '#avatar-and-name-block',
            '#shadow_popup',
            '.popup',
            '#world_popup',
            '.ui-widget',
            '.text_pole',
            '#toast-container',
            '.select2-results',
        ];

        for (const id of forbiddenTargets) {
            if (clickTarget.closest(id).length > 0) {
                return;
            }
        }

        // This autocloses open drawers that are not pinned if a click happens inside the app which does not target them.
        const targetParentHasOpenDrawer = clickTarget.parents('.openDrawer').length;
        if (!clickTarget.hasClass('drawer-icon') && !clickTarget.hasClass('openDrawer')) {
            const $openDrawers = $('.openDrawer').not('.pinnedOpen');
            if ($openDrawers.length && targetParentHasOpenDrawer === 0) {
                // Toggle icon and drawer classes
                $('.openIcon').not('.drawerPinnedOpen').toggleClass('closedIcon openIcon');
                $openDrawers.toggleClass('closedDrawer openDrawer');
            }
        }
    });

    $(document).on('click', '.inline-drawer-toggle', async function (e) {
        if ($(e.target).hasClass('text_pole')) {
            return;
        }
        const drawer = $(this).closest('.inline-drawer');
        const icon = drawer.find('>.inline-drawer-header .inline-drawer-icon');
        const drawerContent = drawer.find('>.inline-drawer-content');
        icon.toggleClass('down up');
        icon.toggleClass('fa-circle-chevron-down fa-circle-chevron-up');
        drawer.trigger('inline-drawer-toggle');
        drawerContent.stop().slideToggle({
            complete: () => {
                $(this).css('height', '');
            },
        });

        // Set the height of "autoSetHeight" textareas within the inline-drawer to their scroll height
        if (!CSS.supports('field-sizing', 'content')) {
            const textareas = drawerContent.find('textarea.autoSetHeight');
            for (const textarea of textareas) {
                await resetScrollHeight($(textarea));
            }
        }
    });

    $(document).on('click', '.inline-drawer-maximize', function () {
        const icon = $(this).find('.inline-drawer-icon, .floating_panel_maximize');
        icon.toggleClass('fa-window-maximize fa-window-restore');
        const drawerContent = $(this).closest('.drawer-content');
        drawerContent.toggleClass('maximized');
        const drawerId = drawerContent.attr('id');
        resetMovableStyles(drawerId);
    });

    $(document).on('click', '.mes .avatar', function () {
        const messageElement = $(this).closest('.mes');
        const thumbURL = $(this).children('img').attr('src');
        const charsPath = '/characters/';
        const targetAvatarImg = thumbURL.substring(thumbURL.lastIndexOf('=') + 1);
        const charname = targetAvatarImg.replace('.png', '');
        const isValidCharacter = characters.some(x => x.avatar === decodeURIComponent(targetAvatarImg));

        // Remove existing zoomed avatars for characters that are not the clicked character when moving UI is not enabled
        if (!power_user.movingUI) {
            $('.zoomed_avatar').each(function () {
                const currentForChar = $(this).attr('forChar');
                if (currentForChar !== charname && typeof currentForChar !== 'undefined') {
                    console.debug(`Removing zoomed avatar for character: ${currentForChar}`);
                    $(this).remove();
                }
            });
        }

        const avatarSrc = (isDataURL(thumbURL) || /^\/?img\/(?:.+)/.test(thumbURL)) ? thumbURL : charsPath + targetAvatarImg;
        if ($(`.zoomed_avatar[forChar="${charname}"]`).length) {
            console.debug('removing container as it already existed');
            $(`.zoomed_avatar[forChar="${charname}"]`).fadeOut(animation_duration, () => {
                $(`.zoomed_avatar[forChar="${charname}"]`).remove();
            });
        } else {
            console.debug('making new container from template');
            const template = $('#zoomed_avatar_template').html();
            const newElement = $(template);
            newElement.attr('forChar', charname);
            newElement.attr('id', `zoomFor_${charname}`);
            newElement.addClass('draggable');
            newElement.find('.drag-grabber').attr('id', `zoomFor_${charname}header`);

            $('body').append(newElement);
            newElement.fadeIn(animation_duration);
            const zoomedAvatarImgElement = $(`.zoomed_avatar[forChar="${charname}"] img`);
            if (messageElement.attr('is_user') == 'true' || (messageElement.attr('is_system') == 'true' && !isValidCharacter)) {
                //handle user and system avatars
                const isValidPersona = decodeURIComponent(targetAvatarImg) in power_user.personas;
                if (isValidPersona) {
                    const personaSrc = getUserAvatar(targetAvatarImg);
                    zoomedAvatarImgElement.attr('src', personaSrc);
                    zoomedAvatarImgElement.attr('data-izoomify-url', personaSrc);
                } else {
                    zoomedAvatarImgElement.attr('src', thumbURL);
                    zoomedAvatarImgElement.attr('data-izoomify-url', thumbURL);
                }
            } else if (messageElement.attr('is_user') == 'false') { //handle char avatars
                zoomedAvatarImgElement.attr('src', avatarSrc);
                zoomedAvatarImgElement.attr('data-izoomify-url', avatarSrc);
            }
            loadMovingUIState();
            $(`.zoomed_avatar[forChar="${charname}"]`).css('display', 'flex');
            dragElement(newElement);

            if (power_user.zoomed_avatar_magnification) {
                $('.zoomed_avatar_container').izoomify();
            }

            $('.zoomed_avatar, .zoomed_avatar .dragClose').on('click touchend', (e) => {
                if (e.target.closest('.dragClose')) {
                    $(`.zoomed_avatar[forChar="${charname}"]`).fadeOut(animation_duration, () => {
                        $(`.zoomed_avatar[forChar="${charname}"]`).remove();
                    });
                }
            });

            zoomedAvatarImgElement.on('dragstart', (e) => {
                console.log('saw drag on avatar!');
                e.preventDefault();
                return false;
            });
        }
    });

    document.addEventListener('click', function (e) {
        if (!(e.target instanceof HTMLElement)) return;
        if (e.target.matches('#OpenAllWIEntries')) {
            document.querySelectorAll('#world_popup_entries_list .inline-drawer').forEach((/** @type {HTMLElement} */ drawer) => {
                delay(0).then(() => toggleDrawer(drawer, true));
            });
        } else if (e.target.matches('#CloseAllWIEntries')) {
            document.querySelectorAll('#world_popup_entries_list .inline-drawer').forEach((/** @type {HTMLElement} */ drawer) => {
                toggleDrawer(drawer, false);
            });
        }
    });

    $(document).on('click', '.open_alternate_greetings', openAlternateGreetings);
    /* $('#set_character_world').on('click', openCharacterWorldPopup); */

    $(document).on('focus', 'input.auto-select, textarea.auto-select', function () {
        if (!power_user.enable_auto_select_input) return;
        const control = $(this)[0];
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
            control.select();
            console.debug('Auto-selecting content of input control', control);
        }
    });

    $(document).on('keydown', function (e) {
        if (e.key === 'Escape' && !e.originalEvent.isComposing) {
            const isEditVisible = $('#curEditTextarea').is(':visible') || $('.reasoning_edit_textarea').length > 0;
            if (isEditVisible && power_user.auto_save_msg_edits === false) {
                closeMessageEditor('all');
                $('#send_textarea').trigger('focus');
                return;
            }
            if (isEditVisible && power_user.auto_save_msg_edits === true) {
                chatElement.find(`.mes[mesid="${this_edit_mes_id}"] .mes_edit_done`).trigger('click');
                closeMessageEditor('reasoning');
                $('#send_textarea').trigger('focus');
                return;
            }
            if (this_edit_mes_id === undefined && $('#mes_stop').is(':visible')) {
                $('#mes_stop').trigger('click');
                if (chat.length && Array.isArray(chat[chat.length - 1].swipes) && chat[chat.length - 1].swipe_id == chat[chat.length - 1].swipes.length) {
                    $('.last_mes .swipe_left').trigger('click');
                }
            }
        }
    });

    $('#char-management-dropdown').on('change', async (e) => {
        const targetElement = /** @type {HTMLSelectElement} */ (e.target);
        const target = $(targetElement.selectedOptions).attr('id');
        switch (target) {
            case 'set_character_world':
                await openCharacterWorldPopup();
                break;
            case 'set_chat_character_settings':
                await setCharacterSettingsOverrides();
                break;
            case 'character_promote_shared':
                await promoteSelectedCharacterToShared();
                break;
            case 'character_manage_owners':
                await manageSelectedSharedCharacterOwners();
                break;
            case 'character_checkout_toggle':
                await toggleSelectedSharedCharacterCheckout();
                break;
            case 'renameCharButton':
                await renameCharacter();
                break;
            case 'import_character_info':
                await importEmbeddedWorldInfo();
                saveCharacterDebounced();
                break;
            case 'character_source': {
                const source = getCharacterSource(this_chid);
                if (source && isValidUrl(source)) {
                    const url = new URL(source);
                    const confirm = await Popup.show.confirm('Open Source', `<span>Do you want to open the link to ${url.hostname} in a new tab?</span><var>${url}</var>`);
                    if (confirm) {
                        window.open(source, '_blank');
                    }
                } else {
                    toastr.info('This character doesn\'t seem to have a source.');
                }
            } break;
            case 'replace_update': {
                let onlineUrl = getCharacterSource(this_chid);

                const POPUP_RESULT_URL = POPUP_RESULT.CUSTOM1, POPUP_RESULT_FILE = POPUP_RESULT.CUSTOM2;
                const result = await Popup.show.confirm(t`Replace Character`,
                    `<p>${t`Choose a new character card to replace this character with.`}</p>` +
                    `<p>${t`You can also replace this character with the one from the online source.`}${onlineUrl ? `<br />This character was downloaded from: <var>${onlineUrl}</var>` : ''}</p>` +
                    `<p>${t`All chats, assets and group memberships will be preserved, but local changes to the character data will be lost.`}<br />${t`Proceed?`}</p>`,
                    {
                        okButton: false,
                        customButtons: [{
                            text: t`Replace with URL`,
                            result: POPUP_RESULT_URL,
                            classes: ['popup-button-ok'],
                        }, {
                            text: t`Replace with File`,
                            result: POPUP_RESULT_FILE,
                            classes: ['popup-button-ok'],
                        }],
                        defaultResult: onlineUrl ? POPUP_RESULT_URL : POPUP_RESULT_FILE,
                    });

                // Remember the chat currently selected, so we can reload it after the replacement
                const currentChatFile = characters[this_chid]['chat'];
                async function postReplace() {
                    await openCharacterChat(currentChatFile);
                }

                switch (result) {
                    case POPUP_RESULT_FILE: {
                        async function uploadReplacementCard(e) {
                            const file = e.target.files[0];
                            if (!file) {
                                return;
                            }

                            try {
                                const data = new Map();
                                data.set(file, characters[this_chid].avatar);
                                await processDroppedFiles([file], data);
                                await postReplace();
                            } catch {
                                toastr.error('Failed to replace the character card.', 'Something went wrong');
                            }
                        }
                        $('#character_replace_file').off('change').on('change', uploadReplacementCard).trigger('click');
                        break;
                    }
                    case POPUP_RESULT_URL: {
                        const inputUrl = await Popup.show.input(t`Replace Character from URL`,
                            `<p>${t`Enter the URL of the character card to replace this character with.`}</p>` +
                            (onlineUrl ? `<p>${t`This character was downloaded from: <var>${onlineUrl}</var>`}</p>` : ''),
                            onlineUrl);
                        if (!inputUrl) {
                            break;
                        }
                        onlineUrl = inputUrl;
                        await importFromExternalUrl(onlineUrl, { preserveFileName: characters[this_chid].avatar });
                        await postReplace();
                        break;
                    }
                }
            } break;
            case 'import_tags': {
                await importTags(characters[this_chid], { importSetting: tag_import_setting.ASK });
            } break;
            /*case 'delete_button':
                popup_type = "del_ch";
                callPopup(`
                        <h3>Delete the character?</h3>
                        <b>THIS IS PERMANENT!<br><br>
                        THIS WILL ALSO DELETE ALL<br>
                        OF THE CHARACTER'S CHAT FILES.<br><br></b>`
                );
                break;*/
            default:
                await eventSource.emit(event_types.CHARACTER_MANAGEMENT_DROPDOWN, target);
        }
        $('#char-management-dropdown').prop('selectedIndex', 0);
    });

    $(window).on('beforeunload', () => {
        cancelTtsPlay();
        if (streamingProcessor) {
            console.log('Page reloaded. Aborting streaming...');
            streamingProcessor.onStopStreaming();
        }
    });


    var isManualInput = false;
    var valueBeforeManualInput;

    $(document).on('input', '.range-block-counter input, .neo-range-input', function () {
        valueBeforeManualInput = $(this).val();
        console.log(valueBeforeManualInput);
    });

    $(document).on('change', '.range-block-counter input, .neo-range-input', function (e) {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        e.target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    });

    $(document).on('keydown', '.range-block-counter input, .neo-range-input', function (e) {
        const masterSelector = '#' + $(this).data('for');
        const masterElement = $(masterSelector);
        if (e.key === 'Enter') {
            let manualInput = Number($(this).val());
            if (isManualInput) {
                //disallow manual inputs outside acceptable range
                if (manualInput >= Number($(this).attr('min')) && manualInput <= Number($(this).attr('max'))) {
                    //if value is ok, assign to slider and update handle text and position
                    //newSlider.val(manualInput)
                    //handleSlideEvent.call(newSlider, null, { value: parseFloat(manualInput) }, 'manual');
                    valueBeforeManualInput = manualInput;
                    $(masterElement).val($(this).val()).trigger('input', { forced: true });
                } else {
                    //if value not ok, warn and reset to last known valid value
                    toastr.warning(`Invalid value. Must be between ${$(this).attr('min')} and ${$(this).attr('max')}`);
                    //newSlider.val(valueBeforeManualInput)
                    $(this).val(valueBeforeManualInput);
                }
            }
        }
    });

    $(document).on('keyup', '.range-block-counter input, .neo-range-input', function () {
        valueBeforeManualInput = $(this).val();
        isManualInput = true;
    });

    //trigger slider changes when user clicks away
    $(document).on('mouseup blur', '.range-block-counter input, .neo-range-input', function () {
        const masterSelector = '#' + $(this).data('for');
        const masterElement = $(masterSelector);
        let manualInput = Number($(this).val());
        if (isManualInput) {
            //if value is between correct range for the slider
            if (manualInput >= Number($(this).attr('min')) && manualInput <= Number($(this).attr('max'))) {
                valueBeforeManualInput = manualInput;
                //set the slider value to input value
                $(masterElement).val($(this).val()).trigger('input', { forced: true });
            } else {
                //if value not ok, warn and reset to last known valid value
                toastr.warning(`Invalid value. Must be between ${$(this).attr('min')} and ${$(this).attr('max')}`);
                $(this).val(valueBeforeManualInput);
            }
        }
        isManualInput = false;
    });

    $('.user_stats_button').on('click', function () {
        userStatsHandler();
    });

    $(document).on('click', '.external_import_button, #external_import_button', async () => {
        const html = await renderTemplateAsync('importCharacters');
        const input = await callGenericPopup(html, POPUP_TYPE.INPUT, '', { allowVerticalScrolling: true, wider: true, okButton: $('#popup_template').attr('popup-button-import'), rows: 4 });

        if (!input) {
            console.debug('Custom content import cancelled');
            return;
        }

        // break input into one input per line
        const inputs = String(input).split('\n').map(x => x.trim()).filter(x => x.length > 0);

        for (const url of inputs) {
            await importFromExternalUrl(url);
        }
    });

    charDragDropHandler = new DragAndDropHandler('body', async (files, event) => {
        if (!files.length) {
            await importFromURL(event.originalEvent.dataTransfer.items, files);
        }
        await processDroppedFiles(files);
    }, { noAnimation: true });

    chatDragDropHandler = new DragAndDropHandler('#select_chat_popup', async (_, event) => {
        const importFile = document.getElementById('chat_import_file');
        if (importFile instanceof HTMLInputElement) {
            importFile.files = event.originalEvent.dataTransfer.files;
            $(importFile).trigger('change');
        }
    });

    $('#charListGridToggle').on('click', async () => {
        doCharListDisplaySwitch();
    });

    $('#hideCharPanelAvatarButton').on('click', () => {
        $('#avatar-and-name-block').slideToggle();
    });

    $(document).on('click', '#show_more_messages', async function () {
        await showMoreMessages();
    });
    $(document).on('click', '#show_newer_messages', async function () {
        await showNewerMessages();
    });
    $(document).on('click', `#${RETURN_TO_TAIL_CONTROL_ID}`, async function () {
        await returnToLiveTailView();
    });
    $(document).on('click', `#${HYDRATE_CHAT_CONTROL_ID}`, async function () {
        await hydrateCurrentChatForEditing();
    });

    $(document).on('click', '.open_characters_library', async function () {
        await getCharacters();
        await eventSource.emit(event_types.OPEN_CHARACTER_LIBRARY);
    });

    // Added here to prevent execution before script.js is loaded and get rid of quirky timeouts
    await firstLoadInit();

    window.addEventListener('beforeunload', (e) => {
        if (isChatSaving || hasPendingDebouncedChatSave() || this_edit_mes_id >= 0
            || hasUnsavedCharacterEdits()) {
            e.preventDefault();
            e.returnValue = true;
        }
    });
});
