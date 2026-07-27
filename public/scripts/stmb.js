import {
    applyChunkedChatPayload,
    chat,
    chatElement,
    chat_metadata,
    eventSource,
    event_types,
    getCurrentChatId,
    getFirstDisplayedMessageId,
    hasActiveMessageEditSession,
    jumpToMessageWindow,
    name1,
    name2,
    reloadCurrentChat,
    renderMessageWindow,
    scrollChatElementIntoView,
    scrollChatToBottom,
    saveSettingsDebounced,
    substituteParams,
    substituteParamsExtended,
    toggleTopChatSidebar,
} from '../script.js';
import { DOMPurify } from '../lib.js';
import { getContext, saveMetadataDebounced } from './extensions.js';
import { power_user } from './power-user.js';
import {
    commitStmbSummaries,
    generateStmbMemory,
    generateStmbSummary,
    generateStmbText,
    listStmbContextSettings,
    migrateStmbContextSettingsLorebookReference,
    regenerateStmbEntry,
    saveStmbMemoryEntry,
    saveStmbGroupMemoryEntries,
    syncStmbGroupStloMetadata,
} from './stmb-api.js';
import { closeActiveMemoryPreviewPopups, showAdvancedOptionsPopup, showAutoConsolidationPromptPopup, showAutoSummaryDecisionPopup, showConfirmationPopup, showConsolidationPreviewPopup, showFailedAIResponsePopup, showFailedSummaryResponsePopup, showLorebookPickerPopup, showMemoryPreviewPopup, showRegenerationReviewPopup, showSummaryConsolidationOptionsPopup } from './stmb-popups.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { applyLocale, translate } from './i18n.js';
import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from './slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue } from './slash-commands/SlashCommandEnumValue.js';
import { hideChatMessageRange } from './chats.js';
import { groups, selected_group } from './group-chats.js';
import { getRegexScripts, runRegexScript, substitute_find_regex } from './extensions/regex/engine.js';
import { getLorebookStorageForRequest, isReservedTemplateWorldName, loadWorldInfo, METADATA_KEY, openLorebookOrderingDialog, registerStmbRegenerationHandler, reloadEditor, world_names, worldInfoCache } from './world-info.js';
import { buildOpenAIGenerateData, oai_settings } from './openai.js';
import { SECRET_KEYS, secret_state } from './secrets.js';
import { buildMemoryPromptText } from './stmb-prompt-assembly.js';
import {
    applyDeletedMessageToSceneState,
    applyStmbProfileToGenerateData,
    applyStmbMaxTokensToGenerateData,
    parseSceneRange,
    compiledSceneToText,
    createDefaultStmbProfile,
    findOverlappingManagedMemoryEntry,
    formatMemoryTitle,
    normalizeLorebookEntrySettings,
    normalizeStmbMemoryBoundaryMode,
    STMB_DEFAULT_MAX_TOKENS,
    STMB_DEFAULT_MEMORY_SCHEMA,
    STMB_DEFAULT_TITLE_FORMAT,
    STMB_DEFAULT_TITLE_FORMATS,
    STMB_MEMORY_BOUNDARY_MODES,
    STMB_METADATA_KEY,
    compileScene,
    getActiveStmbProfile,
    getStmbConnectionProfileApiKeyError,
    identifyManagedMemoryEntries,
    normalizeStmbCharacterFilterNames,
    normalizeStmbSettings,
    parseStmbCatchupCommandArgs,
    parseSequenceFromTitle,
    parseStructuredMemoryResponse,
    buildStmbCatchupChunks,
} from './stmb-core.js';
import { buildStmbSceneContext, captureStmbSceneRange, fetchStmbChatRangeInfo, getStmbChatKey, isPassiveStmbFlushSuppressedForChat } from './stmb-scene.js';
import { isMobile } from './RossAscends-mods.js';
import {
    CONSOLIDATION_REGENERATION_PRESET_KEY,
    STMB_REGENERATION_RESPONSE_SCHEMA,
    STMB_SUMMARY_RESPONSE_SCHEMA,
    buildBriefsFromEntries,
    buildSummaryAnalysisPrompt,
    createSummaryCandidatesFromResponse,
    fingerprintLorebookEntry,
    getDefaultSummaryMinChildren,
    getDefaultSummaryTitleFormat,
    getSummaryTierLabel,
    getSourceTierForTarget,
    formatSummaryTitle,
    identifyEligibleSummarySourceEntries,
    identifyManagedSummaryEntries,
    migrateLorebookSummarySchema,
    normalizeSummaryMinChildren,
    parseSummaryJsonResponse,
    pluralizeSummaryLabel,
    resolveSelectedSummarySourceEntries,
} from './stmb-summary.js';
import {
    buildRegenerationIndexes,
    getRegenerationEligibility,
    getRegenerationEntryByUid,
    hashRegenerationEntry,
    isRegenerationSourceChatCurrent,
    selectPreviousRegenerationMemories,
} from './stmb-regeneration.js';
import {
    buildQueuedAfterMemorySidePromptJobs,
    evaluateTrackers,
    firstRunInitSidePrompts,
    enqueueAfterMemorySidePromptJobs,
    runSidePrompt,
    runSidePromptSet,
    toggleSidePromptEnabled,
} from './stmb-sideprompts.js';
import {
    firstRunInitArcPromptPresets,
    duplicateArcPromptPresetFile,
    exportArcPromptPresetsJsonFile,
    getCachedArcPromptDisplayName,
    getCachedArcPromptText,
    getRequiredArcPromptText,
    importArcPromptPresetsJsonFile,
    isRegenerationOnlyPreset,
    listCachedArcPromptPresets,
    recreateBuiltInArcPromptOverridesFile,
    removeArcPromptPresetFile,
    selectConsolidationDefaultPresetKey,
    upsertArcPromptPresetFile,
} from './stmb-arc-prompt-manager.js';
import {
    duplicateSummaryPromptPresetFile,
    exportSummaryPromptPresetsJsonFile,
    firstRunInitSummaryPromptPresets,
    getCachedSummaryPromptDisplayName,
    getCachedSummaryPromptText,
    getRequiredSummaryPromptText,
    importSummaryPromptPresetsJsonFile,
    listCachedSummaryPromptPresets,
    recreateBuiltInSummaryPromptOverridesFile,
    removeSummaryPromptPresetFile,
    upsertSummaryPromptPresetFile,
} from './stmb-summary-prompt-manager.js';
import {
    applySidePromptMacros,
    buildSidePromptMacroSuggestion,
    collectTemplateRuntimeMacros,
    extractMacroTokens,
    formatQuotedSidePromptName,
    isValidMacroToken,
    parseSidePromptCommandInput,
} from './stmb-sideprompt-macros.js';
import {
    duplicateTemplate,
    duplicateSet,
    exportSidePromptsJson,
    collectSetRuntimeMacros,
    getCachedSetSnapshot,
    getCachedTemplateSnapshot,
    getSet,
    getTemplate,
    importSidePromptsJson,
    listSets,
    listTemplates,
    recreateBuiltInSidePrompts,
    removeSet,
    removeTemplate,
    upsertSet,
    upsertTemplate,
} from './stmb-sideprompts-manager.js';
import { escapeHtml, flashHighlight, withGoBackButton } from './utils.js';
import { ensureResolvedLorebookName, isStmbLorebookHandledError } from './stmb-lorebook.js';
import { createStmbTask, getActiveStmbTaskCount, hasActiveStmbTasks, isStmbAbortError, stopAllStmbTasks, throwIfStmbAborted } from './stmb-tasks.js';
import { getTokenCountAsync } from './tokenizers.js';
import { cloneStloSettings } from './stlo-utils.js';
import {
    configureStmbClipRuntime,
    hideFloatingClipButton,
    initializeFloatingClipButton,
    refreshFloatingClipButtonSetting,
    showStmbEntryReviewPopup,
    showTopicalClipPopup,
} from './stmb-clips.js';
import {
    awaitStmbJobApproval,
    cancelAllStmbJobs,
    enqueueStmbJob,
    getStmbJobStoreSnapshot,
    hasActiveStmbJobs,
    initStmbJobsUi,
    registerStmbJobExecutor,
    respondToStmbJobApproval,
    updateStmbJobsForLorebookReference,
} from './stmb-jobs.js';
import {
    buildAdditionalContextSourceOptionsHtml,
    readAdditionalContextSourceSetting,
    resolveAdditionalContextEntriesForKey,
    showStmbContextSettingsPopup,
    STMB_CONTEXT_NONE_KEY,
} from './stmb-context-settings.js';

const $ = window.jQuery;
let stmbSettings = normalizeStmbSettings();
let activeRootTask = null;
let stmbInitialized = false;
let sceneButtonsBound = false;
let slashCommandsRegistered = false;
let lastFailedSummaryError = null;
let lastFailedSummaryContext = null;
let stmbUiBound = false;
let sidePromptNameCache = [];
let sidePromptSetNameCache = [];
let activeSettingsPopupDialog = null;
const pendingPassiveChecksByChat = new Map();
const deferredPostSaveEffectsByChat = new Map();
let plannerStatusPollHandle = null;
let plannerStatusPollInFlight = false;
const handledPlannerTerminalJobUpdates = new Map();
const handledPlannerApprovalPrompts = new Map();
let plannerChatReloadPromise = null;
const activePlannerApprovalPrompts = new Set();
const OPEN_APPROVAL_EVENT = 'stmb:open-job-approval';
const PLANNER_ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'awaiting_approval']);
const PLANNER_TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'canceled', 'rejected', 'skipped']);
const PLANNER_RECENT_JOB_WINDOW_MS = 15 * 60 * 1000;
const PLANNER_UI_MAX_ROWS = 12;
const DEFAULT_ARC_PROMPT_KEY = 'arc_default';
let latestPlannerJobs = [];
let plannerStatusUiInitialized = false;
let plannerStatusButton = null;
let plannerStatusBadge = null;
const dismissedPlannerNotificationIds = new Set();
let memoryBoundaryButton = null;
let chatEndButton = null;
let floatingJumpButtonDragState = null;
const FLOATING_JUMP_BUTTON_SIZE = 36;
const FLOATING_JUMP_BUTTON_MARGIN = 12;
const FLOATING_JUMP_BUTTON_WAND_GAP = 8;
const MEMORY_BOUNDARY_BUTTON_DEFAULT_BOTTOM = 112;
const MEMORY_BOUNDARY_BUTTON_DEFAULT_RIGHT = 18;
const CHAT_END_BUTTON_DEFAULT_BOTTOM = 64;
const CHAT_END_BUTTON_DEFAULT_RIGHT = 18;

const DURABLE_SYNC_STATE_KEYS = [
    'sceneStart',
    'sceneEnd',
    'highestMemoryProcessed',
    'highestMemoryProcessedManuallySet',
    'autoSummaryNextPromptAt',
    'manualLorebook',
    'manualCharacterLorebooks',
    'contextSettingKey',
    'autoConsolidationLastPromptKey',
];

function getClientPlannerJobStatus(job = {}) {
    switch (String(job?.state || '')) {
        case 'queued':
            return 'pending';
        case 'awaiting_approval':
            return 'awaiting_approval';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'canceled':
            return 'canceled';
        case 'rejected':
            return 'rejected';
        case 'skipped':
            return 'skipped';
        default:
            return 'running';
    }
}

function getClientPlannerJobKind(job = {}) {
    const type = String(job?.type || '');
    const approvalKind = String(job?.approvalRequest?.kind || '');
    const state = String(job?.state || '');

    if (approvalKind === 'memoryApproval' || approvalKind === 'sidePromptApproval' || approvalKind === 'consolidationApproval') {
        return approvalKind;
    }

    if (state === 'awaiting_approval') {
        if (type === 'sidePrompt' || type === 'sidePromptBatch') {
            return 'sidePromptApproval';
        }
        if (type === 'memory') {
            return 'memoryApproval';
        }
        if (type === 'consolidation') {
            return 'consolidationApproval';
        }
    }

    switch (type) {
        case 'memoryApproval':
            return 'memoryApproval';
        case 'sidePromptApproval':
            return 'sidePromptApproval';
        case 'consolidationApproval':
            return 'consolidationApproval';
        case 'sidePrompt':
        case 'sidePromptBatch':
            return 'sidePrompt';
        case 'consolidation':
            return 'consolidationCheck';
        case 'memory':
        default:
            return 'memory';
    }
}

function mapClientJobToPlannerJob(job = {}) {
    const updatedAt = Number(job?.updatedAt || job?.finishedAt || job?.startedAt || job?.createdAt || Date.now());
    return {
        id: String(job?.id || ''),
        status: getClientPlannerJobStatus(job),
        kind: getClientPlannerJobKind(job),
        createdAt: Number(job?.createdAt || 0),
        startedAt: Number(job?.startedAt || 0),
        updatedAt,
        clientHandledAt: Number(job?.clientHandledAt || 0),
        error: job?.error ? structuredClone(job.error) : null,
        result: job?.result ? structuredClone(job.result) : null,
        payload: job?.payload ? structuredClone(job.payload) : {},
        approvalRequest: job?.approvalRequest ? structuredClone(job.approvalRequest) : null,
        sceneContext: job?.sceneContext ? structuredClone(job.sceneContext) : null,
    };
}

async function listStmbPlannerJobs() {
    const snapshot = getStmbJobStoreSnapshot();
    const jobs = [];

    for (const store of Object.values(snapshot || {})) {
        if (Array.isArray(store?.runningJobs) && store.runningJobs.length > 0) {
            jobs.push(...store.runningJobs.map(mapClientJobToPlannerJob));
        } else if (store?.runningJob) {
            jobs.push(mapClientJobToPlannerJob(store.runningJob));
        }
        if (Array.isArray(store?.queue)) {
            jobs.push(...store.queue.map(mapClientJobToPlannerJob));
        }
        if (Array.isArray(store?.recentHistory)) {
            jobs.push(...store.recentHistory.map(mapClientJobToPlannerJob));
        }
    }

    jobs.sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0));
    return { jobs };
}

async function getStmbPlannerChatState({ sceneContext } = {}) {
    return {
        state: structuredClone(getStmbState(resolveStmbStateChatKey(sceneContext))),
    };
}

async function respondStmbPlannerApproval(input = {}) {
    return respondToStmbJobApproval(input);
}

async function acknowledgeStmbPlannerJobs() {
    return { ok: true };
}

async function enqueueStmbPlannerWave() {
    return { ok: false, unsupported: true };
}

function applyServerPlannerStateToLocal(state = {}, chatScope = null) {
    const localState = getStmbState(chatScope);
    const hasServerState = DURABLE_SYNC_STATE_KEYS.some(key => Object.hasOwn(state, key));
    if (!hasServerState) {
        return;
    }

    for (const key of DURABLE_SYNC_STATE_KEYS) {
        if (Object.hasOwn(state, key)) {
            localState[key] = structuredClone(state[key]);
        } else {
            delete localState[key];
        }
    }
}

async function syncCurrentChatPlannerState(sceneContext = buildStmbSceneContext()) {
    const sceneChatKey = resolveStmbStateChatKey(sceneContext);
    try {
        const result = await getStmbPlannerChatState({ sceneContext });
        if (sceneChatKey !== getCurrentPlannerChatKey()) {
            return;
        }
        applyServerPlannerStateToLocal(result?.state || {}, sceneContext);
        renderAllSceneButtons();
        await refreshOpenSettingsPopupSceneState();
    } catch (error) {
        console.warn('STMB planner state sync failed', error);
    }
}

function getCurrentPlannerChatKey() {
    try {
        return getStmbChatKey(buildStmbSceneContext());
    } catch {
        return '';
    }
}

function isSceneContextCurrent(sceneContext = null) {
    const targetChatKey = sceneContext
        ? String(getStmbChatKey(sceneContext) || '').trim()
        : getCurrentPlannerChatKey();
    const currentChatKey = getCurrentPlannerChatKey();
    return Boolean(targetChatKey) && targetChatKey === currentChatKey;
}

function getPlannerJobChatKey(job = {}) {
    try {
        return getStmbChatKey(job?.sceneContext || {});
    } catch {
        return '';
    }
}

function isPlannerJobForCurrentChat(job = {}) {
    const currentChatKey = getCurrentPlannerChatKey();
    return Boolean(currentChatKey) && currentChatKey === getPlannerJobChatKey(job);
}

function isPlannerJobActive(job = {}) {
    return PLANNER_ACTIVE_JOB_STATUSES.has(String(job?.status || ''));
}

function isPlannerJobTerminal(job = {}) {
    return PLANNER_TERMINAL_JOB_STATUSES.has(String(job?.status || ''));
}

function getPlannerStatusTone(job = {}) {
    const status = String(job?.status || '');
    if (status === 'awaiting_approval') {
        return 'stmb-planner-status-tone-awaiting';
    }
    if (status === 'failed' || status === 'rejected') {
        return 'stmb-planner-status-tone-failed';
    }
    if (status === 'canceled' || status === 'skipped') {
        return 'stmb-planner-status-tone-canceled';
    }
    if (status === 'completed') {
        return 'stmb-planner-status-tone-completed';
    }
    if (isPlannerJobActive(job)) {
        return 'stmb-planner-status-tone-running';
    }
    return '';
}

function getPlannerStatusLabel(job = {}) {
    switch (String(job?.status || '')) {
        case 'pending':
            return 'Queued';
        case 'running':
            return 'Running';
        case 'awaiting_approval':
            return 'Awaiting approval';
        case 'completed':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'canceled':
            return 'Canceled';
        case 'rejected':
            return 'Rejected';
        case 'skipped':
            return 'Skipped';
        default:
            return 'Queued';
    }
}

function summarizePlannerJobs(jobs = []) {
    const summary = {
        running: 0,
        queued: 0,
        awaitingApproval: 0,
        recentFailures: 0,
        recentTerminal: 0,
    };
    const cutoff = Date.now() - PLANNER_RECENT_JOB_WINDOW_MS;

    for (const job of Array.isArray(jobs) ? jobs : []) {
        const status = String(job?.status || '');
        const updatedAt = Number(job?.updatedAt || 0);

        if (status === 'running') {
            summary.running += 1;
            continue;
        }
        if (status === 'pending') {
            summary.queued += 1;
            continue;
        }
        if (status === 'awaiting_approval') {
            summary.awaitingApproval += 1;
            continue;
        }
        if (isPlannerJobTerminal(job) && updatedAt >= cutoff) {
            summary.recentTerminal += 1;
            if (status === 'failed' || status === 'rejected') {
                summary.recentFailures += 1;
            }
        }
    }

    summary.active = summary.running + summary.queued + summary.awaitingApproval;
    return summary;
}

function pruneDismissedPlannerNotifications(jobs = latestPlannerJobs) {
    if (dismissedPlannerNotificationIds.size === 0) {
        return;
    }

    const visibleTerminalIds = new Set(
        (Array.isArray(jobs) ? jobs : [])
            .filter(job => isPlannerJobTerminal(job))
            .map(job => String(job?.id || ''))
            .filter(Boolean),
    );

    for (const jobId of dismissedPlannerNotificationIds) {
        if (!visibleTerminalIds.has(jobId)) {
            dismissedPlannerNotificationIds.delete(jobId);
        }
    }
}

function getPlannerJobsForNotifications(jobs = latestPlannerJobs) {
    return (Array.isArray(jobs) ? jobs : []).filter(job => {
        if (!isPlannerJobTerminal(job)) {
            return true;
        }
        return !dismissedPlannerNotificationIds.has(String(job?.id || ''));
    });
}

function formatPlannerElapsed(job = {}) {
    const end = isPlannerJobActive(job)
        ? Date.now()
        : Number(job?.updatedAt || 0);
    const start = Number(job?.startedAt || job?.createdAt || 0);
    if (!(start > 0) || !(end >= start)) {
        return '';
    }

    const elapsedSeconds = Math.max(0, Math.floor((end - start) / 1000));
    if (elapsedSeconds < 60) {
        return `${elapsedSeconds}s`;
    }

    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    if (minutes < 60) {
        return `${minutes}m ${seconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

function getPlannerJobChatLabel(job = {}) {
    if (isPlannerJobForCurrentChat(job)) {
        return 'This chat';
    }

    const sceneContext = job?.sceneContext && typeof job.sceneContext === 'object'
        ? job.sceneContext
        : {};
    const characterName = String(sceneContext?.characterName || '').trim();
    if (characterName) {
        return characterName;
    }

    const chatId = String(sceneContext?.chatId || '').trim();
    if (chatId) {
        return chatId;
    }

    return 'Other chat';
}

function getPlannerJobLorebookName(job = {}) {
    return String(
        job?.result?.lorebookName
        || job?.payload?.lorebookName
        || job?.payload?.storage?.lorebookName
        || '',
    ).trim();
}

function getPlannerJobsForUi(jobs = latestPlannerJobs) {
    const visibleJobs = getPlannerJobsForNotifications(jobs);
    const cutoff = Date.now() - PLANNER_RECENT_JOB_WINDOW_MS;
    const activeJobs = [];
    const recentTerminalJobs = [];

    for (const job of visibleJobs) {
        if (isPlannerJobActive(job)) {
            activeJobs.push(job);
            continue;
        }

        if (isPlannerJobTerminal(job) && Number(job?.updatedAt || 0) >= cutoff) {
            recentTerminalJobs.push(job);
        }
    }

    const statusRank = {
        awaiting_approval: 0,
        running: 1,
        pending: 2,
        failed: 3,
        rejected: 4,
        canceled: 5,
        skipped: 6,
        completed: 7,
    };
    const sortByPriority = (left, right) => {
        const leftRank = statusRank[String(left?.status || '')] ?? 99;
        const rightRank = statusRank[String(right?.status || '')] ?? 99;
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }
        return Number(right?.updatedAt || right?.createdAt || 0) - Number(left?.updatedAt || left?.createdAt || 0);
    };

    activeJobs.sort(sortByPriority);
    recentTerminalJobs.sort(sortByPriority);

    return [...activeJobs, ...recentTerminalJobs].slice(0, PLANNER_UI_MAX_ROWS);
}

function getSharedSidebarElements() {
    const sidebar = document.getElementById('top_chat_sidebar');
    const container = document.getElementById('top_chat_sidebar_container');
    const loader = document.getElementById('top_chat_sidebar_loader');
    const title = sidebar?.querySelector('.dragTitle') || null;
    const chatButton = document.getElementById('top_chat_bar_toggle_sidebar');
    const plannerButton = document.getElementById('top_chat_bar_toggle_stmb_sidebar');
    const plannerIcon = plannerButton?.querySelector('.stmb-planner-status-icon') || null;
    return { sidebar, container, loader, title, chatButton, plannerButton, plannerIcon };
}

function isPlannerSidebarVisible() {
    const { sidebar } = getSharedSidebarElements();
    return Boolean(sidebar?.classList.contains('visible') && sidebar?.dataset?.sidebarMode === 'stmb');
}

function ensurePlannerStatusBadge(button) {
    let badge = button?.querySelector('.stmb-planner-status-badge');
    if (badge instanceof HTMLElement) {
        return badge;
    }

    badge = document.createElement('span');
    badge.className = 'stmb-planner-status-badge';
    badge.hidden = true;
    button?.appendChild(badge);
    return badge;
}

function syncPlannerToggleButton() {
    const { chatButton, plannerButton, plannerIcon } = getSharedSidebarElements();
    if (!(plannerButton instanceof HTMLElement)) {
        return;
    }

    const visibleJobs = getPlannerJobsForNotifications(latestPlannerJobs);
    const summary = summarizePlannerJobs(visibleJobs);
    const badgeCount = summary.active > 0 ? summary.active : summary.recentFailures;
    const plannerVisible = isPlannerSidebarVisible();
    const chatVisible = Boolean(chatButton instanceof HTMLElement
        && getSharedSidebarElements().sidebar?.classList.contains('visible')
        && getSharedSidebarElements().sidebar?.dataset?.sidebarMode === 'chat');

    plannerButton.className = 'top_chat_bar_button stmb-planner-status-button';
    plannerButton.title = plannerVisible ? 'Close Memory Books sidebar' : 'Open Memory Books sidebar';
    plannerButton.setAttribute('aria-label', plannerButton.title);
    plannerButton.setAttribute('aria-pressed', String(plannerVisible));
    plannerButton.classList.toggle('active', plannerVisible);
    plannerButton.classList.toggle('stmb-planner-status-attention', summary.awaitingApproval > 0);
    plannerButton.classList.toggle('stmb-planner-status-failed', summary.active === 0 && summary.recentFailures > 0);
    if (plannerIcon instanceof HTMLElement) {
        plannerIcon.className = 'fa-fw fa-solid fa-book stmb-planner-status-icon';
    }

    if (chatButton instanceof HTMLElement) {
        chatButton.classList.toggle('active', chatVisible);
    }

    plannerStatusButton = plannerButton;
    plannerStatusBadge = ensurePlannerStatusBadge(plannerButton);
    plannerStatusBadge.hidden = badgeCount <= 0;
    plannerStatusBadge.textContent = badgeCount > 0 ? String(badgeCount) : '';
    plannerStatusBadge.classList.toggle('stmb-planner-status-badge-failed', summary.active === 0 && summary.recentFailures > 0);
    plannerStatusBadge.classList.toggle('stmb-planner-status-badge-attention', summary.awaitingApproval > 0);
}

function addPlannerNotificationDismissals() {
    for (const job of latestPlannerJobs) {
        if (isPlannerJobTerminal(job)) {
            const jobId = String(job?.id || '');
            if (jobId) {
                dismissedPlannerNotificationIds.add(jobId);
            }
        }
    }
}

function buildPlannerSidebarActionButton(label, action, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button';
    button.dataset.action = action;
    button.textContent = label;
    if (disabled) {
        button.disabled = true;
        button.classList.add('disabled');
    }
    return button;
}

function getFocusedPlannerSidebarAction(container) {
    if (!(container instanceof HTMLElement) || !(document.activeElement instanceof HTMLElement) || !container.contains(document.activeElement)) {
        return '';
    }

    const focusedAction = document.activeElement.closest('.stmb-top-chat-actions [data-action]');
    return focusedAction instanceof HTMLElement
        ? String(focusedAction.dataset.action || '')
        : '';
}

function findPlannerSidebarActionButton(container, action) {
    if (!(container instanceof HTMLElement) || !action) {
        return null;
    }

    for (const candidate of container.querySelectorAll('.stmb-top-chat-actions [data-action]')) {
        if (candidate instanceof HTMLButtonElement && String(candidate.dataset.action || '') === action) {
            return candidate;
        }
    }

    return null;
}

function createPlannerSidebarJobItem(job) {
    const item = document.createElement('div');
    item.className = `top_chat_sidebar_item stmb-top-chat-item ${getPlannerStatusTone(job)}`.trim();
    if (isPlannerApprovalJob(job)) {
        item.dataset.action = 'open-approval';
        item.dataset.jobId = String(job?.id || '');
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.title = 'Review approval request';
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'top_chat_sidebar_name_row';

    const name = document.createElement('div');
    name.className = 'top_chat_sidebar_name';
    name.textContent = getPlannerJobLabel(job);
    name.title = getPlannerJobLabel(job);

    const status = document.createElement('small');
    status.className = 'stmb-top-chat-status';
    status.textContent = getPlannerStatusLabel(job);

    nameRow.append(name, status);

    const messageRow = document.createElement('div');
    messageRow.className = 'top_chat_sidebar_message_row';

    const message = document.createElement('div');
    message.className = 'top_chat_sidebar_message';
    const lorebookName = getPlannerJobLorebookName(job);
    const baseDetail = String(job?.error?.message || '').trim()
        || [getPlannerJobChatLabel(job), lorebookName ? `Lorebook: ${lorebookName}` : ''].filter(Boolean).join(' | ');
    message.textContent = baseDetail || 'No additional detail.';
    message.title = baseDetail || 'No additional detail.';

    const stats = document.createElement('div');
    stats.className = 'top_chat_sidebar_stats';

    const meta = document.createElement('small');
    meta.className = 'stmb-top-chat-meta';
    meta.textContent = [getPlannerJobChatLabel(job), formatPlannerElapsed(job)].filter(Boolean).join(' | ');

    stats.append(meta);
    messageRow.append(message, stats);

    item.append(nameRow, messageRow);
    return item;
}

function handlePlannerSidebarJobInteraction(event) {
    const item = event.target.closest?.('.stmb-top-chat-item[data-action="open-approval"]');
    if (!(item instanceof HTMLElement)) {
        return;
    }

    const jobId = String(item.dataset.jobId || '').trim();
    if (!jobId) {
        return;
    }

    openPlannerApprovalByJobId(jobId).catch(error => {
        console.warn('STMB approval popup failed from shared sidebar', error);
    });
}

function handlePlannerSidebarJobKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    const item = event.target.closest?.('.stmb-top-chat-item[data-action="open-approval"]');
    if (!(item instanceof HTMLElement)) {
        return;
    }

    event.preventDefault();
    handlePlannerSidebarJobInteraction(event);
}

function renderPlannerSidebarContent() {
    const { sidebar, container, loader, title } = getSharedSidebarElements();
    if (!(sidebar instanceof HTMLElement) || !(container instanceof HTMLElement) || !(loader instanceof HTMLElement) || !(title instanceof HTMLElement)) {
        return;
    }

    if (!isPlannerSidebarVisible()) {
        return;
    }

    const visibleJobs = getPlannerJobsForNotifications(latestPlannerJobs);
    const summary = summarizePlannerJobs(visibleJobs);
    const previousScrollTop = container.scrollTop;
    const focusedAction = getFocusedPlannerSidebarAction(container);
    const rows = getPlannerJobsForUi(visibleJobs);

    sidebar.dataset.sidebarMode = 'stmb';
    title.textContent = 'Memory Books';
    container.innerHTML = '';
    loader.classList.add('displayNone');

    const summaryBlock = document.createElement('div');
    summaryBlock.className = 'top_chat_sidebar_empty stmb-top-chat-summary';
    summaryBlock.textContent = summary.active > 0
        ? `${summary.running} running | ${summary.queued} queued${summary.awaitingApproval > 0 ? ` | ${summary.awaitingApproval} awaiting approval` : ''}`
        : (summary.recentTerminal > 0
            ? `${summary.recentTerminal} recent job${summary.recentTerminal === 1 ? '' : 's'}`
            : 'No Memory Books jobs yet.');
    container.append(summaryBlock);

    const actions = document.createElement('div');
    actions.className = 'stmb-top-chat-actions';
    actions.append(
        buildPlannerSidebarActionButton('Open Memory Books', 'open-memory-books'),
        buildPlannerSidebarActionButton('Stop All', 'stop-all', summary.active === 0),
        buildPlannerSidebarActionButton('Clear Notifications', 'clear-notifications', summary.recentTerminal === 0),
        buildPlannerSidebarActionButton('Refresh', 'refresh-jobs'),
    );
    actions.addEventListener('click', event => {
        const actionButton = event.target.closest('[data-action]');
        if (!(actionButton instanceof HTMLElement) || actionButton.hasAttribute('disabled')) {
            return;
        }

        const action = String(actionButton.dataset.action || '');
        if (action === 'open-memory-books') {
            showMainEntryPopup().catch(error => {
                console.warn('STMB main entry popup failed from shared sidebar', error);
            });
            return;
        }

        if (action === 'stop-all') {
            stopStmbCommand().catch(error => {
                console.warn('STMB stop-all from shared sidebar failed', error);
            });
            return;
        }

        if (action === 'clear-notifications') {
            addPlannerNotificationDismissals();
            renderPlannerStatusUi();
            return;
        }

        if (action === 'refresh-jobs') {
            pollCurrentChatPlannerState().catch(error => {
                console.warn('STMB planner refresh failed from shared sidebar', error);
            });
        }
    });
    container.append(actions);

    if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'top_chat_sidebar_empty';
        empty.textContent = 'No queued, running, or recent Memory Books jobs.';
        container.append(empty);
    } else {
        for (const job of rows) {
            const item = createPlannerSidebarJobItem(job);
            item.addEventListener('click', handlePlannerSidebarJobInteraction);
            item.addEventListener('keydown', handlePlannerSidebarJobKeydown);
            container.append(item);
        }
    }

    container.scrollTop = previousScrollTop;
    const nextFocusedAction = findPlannerSidebarActionButton(container, focusedAction);
    if (nextFocusedAction && !nextFocusedAction.disabled) {
        nextFocusedAction.focus();
    }
}

async function openPlannerSidebar() {
    await toggleTopChatSidebar(true);
    const { sidebar } = getSharedSidebarElements();
    if (!(sidebar instanceof HTMLElement)) {
        return;
    }

    sidebar.dataset.sidebarMode = 'stmb';
    renderPlannerStatusUi();
}

async function openChatSidebar() {
    const { sidebar } = getSharedSidebarElements();
    if (sidebar instanceof HTMLElement) {
        sidebar.dataset.sidebarMode = 'chat';
    }
    await toggleTopChatSidebar(true);
    renderPlannerStatusUi();
}

function handlePlannerSidebarButtonInteraction(event) {
    if (isPlannerSidebarVisible()) {
        event.preventDefault();
        openTopChatSidebarClosed().catch(error => {
            console.warn('Top sidebar close from Memory Books failed', error);
        });
        return;
    }

    event.preventDefault();
    openPlannerSidebar().catch(error => {
        console.warn('Top sidebar switch to Memory Books failed', error);
    });
}

async function openTopChatSidebarClosed() {
    const { sidebar } = getSharedSidebarElements();
    if (sidebar instanceof HTMLElement) {
        delete sidebar.dataset.sidebarMode;
    }
    await toggleTopChatSidebar(false);
    renderPlannerStatusUi();
}

function renderPlannerStatusUi() {
    if (!plannerStatusUiInitialized) {
        return;
    }

    syncPlannerToggleButton();
    renderPlannerSidebarContent();
}

function ensurePlannerStatusUi() {
    if (plannerStatusUiInitialized) {
        renderPlannerStatusUi();
        return;
    }

    const { chatButton, plannerButton, sidebar } = getSharedSidebarElements();
    if (!(chatButton instanceof HTMLElement)
        || !(sidebar instanceof HTMLElement)) {
        setTimeout(() => ensurePlannerStatusUi(), 250);
        return;
    }

    if (!(plannerButton instanceof HTMLElement)) {
        plannerStatusUiInitialized = true;
        return;
    }

    plannerButton.addEventListener('click', handlePlannerSidebarButtonInteraction);

    const observer = new MutationObserver(() => {
        renderPlannerStatusUi();
    });
    observer.observe(sidebar, { attributes: true, attributeFilter: ['class', 'data-sidebar-mode'] });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        renderPlannerStatusUi();
    });

    plannerStatusUiInitialized = true;
    renderPlannerStatusUi();
}

function getPlannerReloadActionPayload(job = {}) {
    const result = job?.result && typeof job.result === 'object' ? job.result : {};
    const clientActions = Array.isArray(result?.clientActions) ? result.clientActions : [];
    const reloadAction = clientActions.find(action => String(action?.type || '') === 'reload_chat');
    return reloadAction?.payload && typeof reloadAction.payload === 'object'
        ? reloadAction.payload
        : null;
}

async function applyPlannerReloadPayload(payload = null) {
    if (hasActiveMessageEditSession()) {
        return reloadPlannerCurrentChat();
    }

    if (!payload || typeof payload !== 'object') {
        return reloadPlannerCurrentChat();
    }

    if (plannerChatReloadPromise) {
        return plannerChatReloadPromise;
    }

    plannerChatReloadPromise = (async () => {
        const previousChatLength = chat.length;
        const previousStartId = getFirstDisplayedMessageId();
        const previousCount = Math.max(
            1,
            chatElement.find('.mes').length || Number(payload?.displayCount) || 0,
        );
        const wasShowingLatest = Number.isFinite(previousStartId)
            ? previousStartId + previousCount >= previousChatLength
            : true;
        const nextView = wasShowingLatest
            ? 'tail'
            : (Number.isInteger(payload?.loadedRangeStart) && Number(previousStartId) < payload.loadedRangeStart ? 'history' : 'tail');

        applyChunkedChatPayload(payload, { replace: true, currentView: nextView });

        if (chat.length > 0) {
            const renderStart = wasShowingLatest
                ? Math.max(0, chat.length - previousCount)
                : Math.min(Math.max(0, Number(previousStartId) || 0), Math.max(0, chat.length - 1));
            await renderMessageWindow(renderStart, previousCount);
            if (nextView === 'tail') {
                scrollChatToBottom({ waitForFrame: true });
            }
            return;
        }

        await renderMessageWindow(0, previousCount);
    })().finally(() => {
        plannerChatReloadPromise = null;
    });

    return plannerChatReloadPromise;
}

async function pollCurrentChatPlannerState() {
    try {
        const sceneContext = buildStmbSceneContext();
        const plannerState = await listStmbPlannerJobs();
        const jobs = Array.isArray(plannerState?.jobs) ? plannerState.jobs : [];
        latestPlannerJobs = jobs;
        pruneDismissedPlannerNotifications(jobs);
        renderPlannerStatusUi();
        const handledApproval = await handlePlannerApprovalRequests(jobs);
        const currentPlannerState = handledApproval ? await listStmbPlannerJobs() : plannerState;
        const currentJobs = Array.isArray(currentPlannerState?.jobs) ? currentPlannerState.jobs : [];
        await refreshPlannerEffectsFromJobs(currentJobs);
        latestPlannerJobs = currentJobs;
        pruneDismissedPlannerNotifications(currentJobs);
        renderPlannerStatusUi();
        const hasActiveJobs = currentJobs.some(job => ['pending', 'running', 'awaiting_approval'].includes(String(job?.status || '')));
        const hasRecentTerminal = currentJobs.some(job => ['completed', 'failed', 'canceled', 'rejected', 'skipped'].includes(String(job?.status || '')) && Number(job?.updatedAt || 0) > (Date.now() - 15_000));
        if (hasActiveJobs || hasRecentTerminal) {
            ensurePlannerStatusPolling();
            await syncCurrentChatPlannerState(sceneContext);
        } else {
            stopPlannerStatusPolling();
        }
    } catch (error) {
        console.warn('STMB planner poll failed', error);
    }
}

function ensurePlannerStatusPolling() {
    if (plannerStatusPollHandle) {
        return;
    }

    plannerStatusPollHandle = setInterval(async () => {
        if (plannerStatusPollInFlight) {
            return;
        }

        plannerStatusPollInFlight = true;
        try {
            await pollCurrentChatPlannerState();
        } catch (error) {
            console.warn('STMB planner poll tick failed', error);
        } finally {
            plannerStatusPollInFlight = false;
        }
    }, 5000);
}

function stopPlannerStatusPolling() {
    if (!plannerStatusPollHandle) {
        return;
    }

    clearInterval(plannerStatusPollHandle);
    plannerStatusPollHandle = null;
}

function pruneHandledPlannerTerminalJobs(now = Date.now()) {
    for (const [jobId, updatedAt] of handledPlannerTerminalJobUpdates.entries()) {
        if (!Number.isFinite(updatedAt) || updatedAt < now - 3_600_000) {
            handledPlannerTerminalJobUpdates.delete(jobId);
        }
    }

    for (const [jobId, updatedAt] of handledPlannerApprovalPrompts.entries()) {
        if (!Number.isFinite(updatedAt) || updatedAt < now - 3_600_000) {
            handledPlannerApprovalPrompts.delete(jobId);
        }
    }
}

async function refreshCachedPlannerLorebook(lorebookName) {
    const normalizedName = String(lorebookName || '').trim();
    if (!normalizedName || !worldInfoCache.has(normalizedName)) {
        return;
    }

    worldInfoCache.delete(normalizedName);
    const data = await loadWorldInfo(normalizedName);
    if (!data) {
        return;
    }

    reloadEditor(normalizedName);
    await eventSource.emit(event_types.WORLDINFO_UPDATED, normalizedName, data);
}

async function reloadPlannerCurrentChat() {
    if (plannerChatReloadPromise) {
        return plannerChatReloadPromise;
    }

    plannerChatReloadPromise = reloadCurrentChat().finally(() => {
        plannerChatReloadPromise = null;
    });
    return plannerChatReloadPromise;
}

function buildPlannerApprovalProfile(profile = {}) {
    if (profile && typeof profile === 'object' && Object.keys(profile).length > 0) {
        return profile;
    }
    return { name: 'Queued STMB Job' };
}

function queueDeferredPostSaveEffects(sceneContext = null, effects = {}) {
    const chatKey = String(getStmbChatKey(sceneContext || buildStmbSceneContext()) || '').trim();
    if (!chatKey) {
        return;
    }

    const pending = deferredPostSaveEffectsByChat.get(chatKey) || {
        highestProcessedMessageId: null,
        clearSceneMarkers: false,
        hideRanges: [],
        autoConsolidationChecks: [],
    };

    if (Number.isInteger(Number(effects.highestProcessedMessageId))) {
        const nextHighest = Math.trunc(Number(effects.highestProcessedMessageId));
        pending.highestProcessedMessageId = pending.highestProcessedMessageId === null
            ? nextHighest
            : Math.max(Number(pending.highestProcessedMessageId) || 0, nextHighest);
    }

    if (effects.clearSceneMarkers === true) {
        pending.clearSceneMarkers = true;
    }

    if (Array.isArray(effects.hideRanges)) {
        for (const hideRange of effects.hideRanges) {
            const start = Math.trunc(Number(hideRange?.start));
            const end = Math.trunc(Number(hideRange?.end));
            if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
                continue;
            }

            if (!pending.hideRanges.some(existing => existing.start === start && existing.end === end)) {
                pending.hideRanges.push({ start, end });
            }
        }
    }

    if (Array.isArray(effects.autoConsolidationChecks)) {
        for (const check of effects.autoConsolidationChecks) {
            const targetTier = Math.min(6, Math.max(1, Math.trunc(Number(check?.targetTier) || 1)));
            const lorebookName = String(check?.lorebookName || '').trim();
            const dedupeKey = `${targetTier}:${lorebookName}`;
            if (!pending.autoConsolidationChecks.some(existing => `${existing.targetTier}:${existing.lorebookName}` === dedupeKey)) {
                pending.autoConsolidationChecks.push({ targetTier, lorebookName });
            }
        }
    }

    deferredPostSaveEffectsByChat.set(chatKey, pending);
}

async function flushDeferredPostSaveEffects(sceneContext = buildStmbSceneContext()) {
    const chatKey = String(getStmbChatKey(sceneContext || buildStmbSceneContext()) || '').trim();
    if (!chatKey || !isSceneContextCurrent(sceneContext)) {
        return;
    }

    const pending = deferredPostSaveEffectsByChat.get(chatKey);
    if (!pending) {
        return;
    }

    try {
        for (const hideRange of pending.hideRanges) {
            await hideChatMessageRange(hideRange.start, hideRange.end, false, null, true);
        }

        if (Number.isInteger(Number(pending.highestProcessedMessageId))) {
            setHighestProcessedMessageId(Math.trunc(Number(pending.highestProcessedMessageId)));
        }

        if (pending.clearSceneMarkers) {
            clearSceneMarkers();
        }

        for (const check of pending.autoConsolidationChecks) {
            await maybePromptAutoConsolidation(check.targetTier, {
                sceneContext,
                lorebookName: check.lorebookName,
            });
        }

        deferredPostSaveEffectsByChat.delete(chatKey);
    } catch (error) {
        deferredPostSaveEffectsByChat.set(chatKey, pending);
        console.warn('STMB deferred post-save effects failed', error);
    }
}

function buildMemoryApprovalRequest(memoryObject, compiledScene, range, profile) {
    return {
        kind: 'memoryApproval',
        memory: structuredClone(memoryObject || {}),
        sceneData: buildMemorySceneData(compiledScene, range),
        profile: buildPlannerApprovalProfile(profile),
        allowRetry: true,
        lockTitle: false,
    };
}

function isPlannerApprovalJob(job = {}) {
    return String(job?.status || '') === 'awaiting_approval'
        && ['memoryApproval', 'sidePromptApproval', 'consolidationApproval'].includes(String(job?.kind || ''))
        && job?.approvalRequest
        && typeof job.approvalRequest === 'object';
}

async function openPlannerApprovalPopup(job = {}, { force = false } = {}) {
    if (!isPlannerApprovalJob(job)) {
        return false;
    }

    const jobId = String(job?.id || '');
    const updatedAt = Number(job?.updatedAt || 0);
    if (!jobId || activePlannerApprovalPrompts.has(jobId)) {
        return false;
    }
    if (!force && (handledPlannerApprovalPrompts.get(jobId) || 0) >= updatedAt) {
        return false;
    }

    handledPlannerApprovalPrompts.set(jobId, updatedAt || Date.now());
    activePlannerApprovalPrompts.add(jobId);
    const approvalRequest = job.approvalRequest;

    try {
        if (String(job?.kind || '') === 'consolidationApproval') {
            const previewResult = await showConsolidationPreviewPopup({
                summaryCandidates: approvalRequest.summaryCandidates,
                selectedEntries: approvalRequest.selectedEntries,
                targetLabel: approvalRequest.targetLabel || 'Summary',
                sourceLabel: approvalRequest.sourceLabel || 'Memory',
                ambiguousAssignments: Boolean(approvalRequest.ambiguousAssignments),
                lockedCount: Number(approvalRequest.lockedCount || 0),
                pendingCount: Number(approvalRequest.pendingCount || 0),
            });

            if (previewResult?.action === 'retryAll') {
                await respondStmbPlannerApproval({
                    jobId,
                    decision: 'retry',
                    editedData: { action: 'retryAll' },
                });
                return true;
            }
            if (previewResult?.action === 'cancel') {
                await respondStmbPlannerApproval({
                    jobId,
                    decision: 'reject',
                });
                return true;
            }
            if (previewResult?.action !== 'apply') {
                await respondStmbPlannerApproval({
                    jobId,
                    decision: 'reject',
                });
                return true;
            }

            await respondStmbPlannerApproval({
                jobId,
                decision: 'approve',
                editedData: {
                    action: 'apply',
                    acceptedCandidates: Array.isArray(previewResult?.acceptedCandidates) ? previewResult.acceptedCandidates : [],
                    rejectedCandidates: Array.isArray(previewResult?.rejectedCandidates) ? previewResult.rejectedCandidates : [],
                },
            });
            return true;
        }

        const isSidePrompt = String(job?.kind || '') === 'sidePromptApproval';
        const previewResult = await showMemoryPreviewPopup(
            isSidePrompt
                ? {
                    extractedTitle: String(approvalRequest.title || ''),
                    title: String(approvalRequest.title || ''),
                    content: String(approvalRequest.content || ''),
                    suggestedKeys: [],
                    keywords: [],
                }
                : normalizePreviewMemory(approvalRequest.memory || {}),
            approvalRequest.sceneData || {
                sceneStart: Number(job?.payload?.range?.sceneStart || 0),
                sceneEnd: Number(job?.payload?.range?.sceneEnd || 0),
                messageCount: Number(job?.payload?.sceneData?.messageCount || 0),
            },
            buildPlannerApprovalProfile(approvalRequest.profile),
            {
                allowRetry: approvalRequest.allowRetry !== false,
                lockTitle: approvalRequest.lockTitle === true,
            },
        );

        if (previewResult?.action === 'retry') {
            await respondStmbPlannerApproval({
                jobId,
                decision: 'retry',
            });
            return true;
        }

        if (previewResult?.action === 'cancel') {
            await respondStmbPlannerApproval({
                jobId,
                decision: 'reject',
            });
            return true;
        }

        const approvalResponse = {
            jobId,
            decision: 'approve',
        };
        if (previewResult?.memoryData) {
            approvalResponse.editedData = isSidePrompt
                ? {
                    title: String(previewResult.memoryData.extractedTitle || previewResult.memoryData.title || approvalRequest.title || '').trim(),
                    content: String(previewResult.memoryData.content || '').trim(),
                }
                : {
                    title: String(previewResult.memoryData.extractedTitle || previewResult.memoryData.title || '').trim(),
                    content: String(previewResult.memoryData.content || '').trim(),
                    keywords: Array.isArray(previewResult.memoryData.suggestedKeys)
                        ? previewResult.memoryData.suggestedKeys.slice()
                        : Array.isArray(previewResult.memoryData.keywords)
                            ? previewResult.memoryData.keywords.slice()
                            : [],
                };
        }

        await respondStmbPlannerApproval(approvalResponse);
        return true;
    } catch (error) {
        handledPlannerApprovalPrompts.delete(jobId);
        throw error;
    } finally {
        activePlannerApprovalPrompts.delete(jobId);
    }
}

async function openPlannerApprovalByJobId(jobId) {
    const targetJobId = String(jobId || '').trim();
    if (!targetJobId) {
        return false;
    }

    const plannerState = await listStmbPlannerJobs();
    const jobs = Array.isArray(plannerState?.jobs) ? plannerState.jobs : [];
    const job = jobs.find(candidate => String(candidate?.id || '') === targetJobId);
    const opened = await openPlannerApprovalPopup(job, { force: true });
    const refreshedPlannerState = opened ? await listStmbPlannerJobs() : plannerState;
    const refreshedJobs = Array.isArray(refreshedPlannerState?.jobs) ? refreshedPlannerState.jobs : [];
    await refreshPlannerEffectsFromJobs(refreshedJobs);
    latestPlannerJobs = refreshedJobs;
    pruneDismissedPlannerNotifications(refreshedJobs);
    const hasActiveJobs = refreshedJobs.some(isPlannerJobActive);
    const hasRecentTerminal = refreshedJobs.some(job => isPlannerJobTerminal(job) && Number(job?.updatedAt || 0) > (Date.now() - 15_000));
    if (hasActiveJobs || hasRecentTerminal) {
        ensurePlannerStatusPolling();
    } else {
        stopPlannerStatusPolling();
    }
    renderPlannerStatusUi();
    return opened;
}

async function handlePlannerApprovalRequests(jobs = []) {
    const now = Date.now();
    pruneHandledPlannerTerminalJobs(now);

    const pendingApprovals = (Array.isArray(jobs) ? jobs : [])
        .filter(isPlannerApprovalJob)
        .sort((left, right) => Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0));

    let handledAny = false;
    for (const job of pendingApprovals) {
        try {
            handledAny = await openPlannerApprovalPopup(job) || handledAny;
        } catch (error) {
            console.warn('STMB planner approval response failed', error);
        }
    }

    return handledAny;
}

async function acknowledgePlannerJobHandled(job) {
    const jobId = String(job?.id || '');
    const updatedAt = Number(job?.updatedAt || 0);
    if (!jobId || !updatedAt) {
        return;
    }

    try {
        await acknowledgeStmbPlannerJobs({
            jobs: [{ jobId, updatedAt }],
        });
    } catch (error) {
        console.warn('STMB planner acknowledgement failed', error);
    }
}

async function handlePlannerCompletedJob(job) {
    const result = job?.result && typeof job.result === 'object' ? job.result : {};
    const lorebookName = String(result?.lorebookName || job?.payload?.lorebookName || '').trim();
    const isCurrentChatJob = isPlannerJobForCurrentChat(job);
    if (lorebookName) {
        await refreshCachedPlannerLorebook(lorebookName);
    }

    if (Array.isArray(result?.orderClampNotifications) && result.orderClampNotifications.length > 0) {
        showOrderClampNotifications(result.orderClampNotifications);
    }

    if (result?.type === 'memory' && getModuleSettings().showNotifications) {
        toastr.success(`Memory saved to "${lorebookName}"`, 'STMB');
    }

    if (result?.type === 'chatAutoHide' && result.applied) {
        if (!isCurrentChatJob) {
            return;
        }

        const reloadPayload = getPlannerReloadActionPayload(job);
        if (reloadPayload) {
            await applyPlannerReloadPayload(reloadPayload);
        } else {
            await reloadPlannerCurrentChat();
        }
    }

    if (result?.type === 'sidePrompt' && job?.payload?.trigger === 'onAfterMemory' && result.blank !== true && getModuleSettings().showNotifications) {
        toastr.success(`SidePrompt "${String(result.title || 'Unknown')}" updated.`, 'STMB');
    }

    if (result?.type === 'consolidationCheck' && result.ready) {
        if (!isCurrentChatJob) {
            return;
        }

        const sourceLabel = getSummaryTierLabel(getSourceTierForTarget(result.targetTier)).toLowerCase();
        const sourcePlural = pluralizeSummaryLabel(sourceLabel);
        const targetLabel = getSummaryTierLabel(result.targetTier).toLowerCase();
        const shouldOpen = await showAutoConsolidationPromptPopup({
            eligibleCount: Number(result.eligibleCount) || 0,
            requiredMin: Number(result.requiredMin) || 0,
            sourcePlural,
            targetLabel,
        });
        if (shouldOpen) {
            await showSummaryConsolidationPopup({ initialTargetTier: Number(result.targetTier) || 1 });
        }
    }
}

function getPlannerJobLabel(job) {
    switch (String(job?.kind || '')) {
        case 'memory':
        case 'memoryGenerate':
        case 'memoryApproval':
        case 'memoryCommit':
            return 'Memory workflow';
        case 'sidePromptGenerate':
        case 'sidePromptApproval':
        case 'sidePromptCommit':
        case 'sidePrompt':
            return 'SidePrompt workflow';
        case 'consolidationApproval':
            return 'Consolidation review';
        case 'consolidationCheck':
            return 'Consolidation check';
        case 'chatAutoHide':
            return 'Chat auto-hide';
        default:
            return 'STMB job';
    }
}

function isInternalPlannerDependencySkip(job) {
    if (String(job?.error?.type || '') === 'StmbPlannerDependencySkipped') {
        return true;
    }

    const message = String(job?.error?.message || '').trim();
    return /^Dependency [0-9a-f-]+ settled as (failed|canceled|rejected|skipped)$/i.test(message)
        || /^Missing dependency [0-9a-f-]+$/i.test(message);
}

function notifyPlannerTerminalStatus(job) {
    const status = String(job?.status || '');
    if (status === 'completed') {
        return;
    }

    const label = getPlannerJobLabel(job);
    const message = String(job?.error?.message || '').trim();

    if (status === 'canceled') {
        toastr.info(message || `${label} canceled.`, 'STMB');
        return;
    }

    if (status === 'rejected') {
        toastr.info(message || `${label} rejected.`, 'STMB');
        return;
    }

    if (status === 'skipped') {
        if (isInternalPlannerDependencySkip(job)) {
            return;
        }
        toastr.warning(message || `${label} skipped.`, 'STMB');
        return;
    }

    toastr.error(message || `${label} failed.`, 'STMB');
}

async function refreshPlannerEffectsFromJobs(jobs = []) {
    const now = Date.now();
    const terminalNotificationCutoff = now - PLANNER_RECENT_JOB_WINDOW_MS;
    pruneHandledPlannerTerminalJobs(now);

    for (const job of Array.isArray(jobs) ? jobs : []) {
        const status = String(job?.status || '');
        if (!['completed', 'failed', 'canceled', 'rejected', 'skipped'].includes(status)) {
            continue;
        }

        const jobId = String(job?.id || '');
        const updatedAt = Number(job?.updatedAt || 0);
        const clientHandledAt = Number(job?.clientHandledAt || 0);
        if (!jobId) {
            continue;
        }
        if (updatedAt > 0 && updatedAt < terminalNotificationCutoff) {
            handledPlannerTerminalJobUpdates.set(jobId, updatedAt || now);
            await acknowledgePlannerJobHandled(job);
            continue;
        }
        if (clientHandledAt >= updatedAt) {
            handledPlannerTerminalJobUpdates.set(jobId, updatedAt || now);
            continue;
        }
        if ((handledPlannerTerminalJobUpdates.get(jobId) || 0) >= updatedAt) {
            continue;
        }

        handledPlannerTerminalJobUpdates.set(jobId, updatedAt || now);
        if (status === 'completed') {
            await handlePlannerCompletedJob(job);
        } else {
            notifyPlannerTerminalStatus(job);
        }
        await acknowledgePlannerJobHandled(job);
    }
}

async function enqueueDurableWave(sceneContext, jobs, source, successMessage = 'STMB job queued.') {
    const result = await enqueueStmbPlannerWave({
        sceneContext,
        source,
        jobs,
    });
    ensurePlannerStatusPolling();
    pollCurrentChatPlannerState().catch(error => {
        console.warn('STMB planner poll failed after enqueue', error);
    });
    if (getModuleSettings().showNotifications) {
        toastr.info(successMessage, 'STMB');
    }
    return result;
}
let stmbJobExecutorsRegistered = false;
const STMB_VOLATILE_STATE_KEYS = new Set([
    'autoSummaryNextPromptAt',
    'autoConsolidationLastPromptKey',
]);
const stmbVolatileStateByChat = new Map();

function isManualSidePromptEnabled(template) {
    const commands = template?.triggers?.commands;
    return Array.isArray(commands) && commands.some(command => String(command).toLowerCase() === 'sideprompt');
}

async function refreshSidePromptCache() {
    try {
        const templates = await listTemplates();
        sidePromptNameCache = (templates || []).map(template => ({
            name: template.name,
            runtimeMacros: collectTemplateRuntimeMacros(template),
            manualEnabled: isManualSidePromptEnabled(template),
        }));
        const sets = await listSets();
        const settledSets = await Promise.allSettled((sets || []).map(async set => ({
            name: set.name,
            runtimeMacros: await collectSetRuntimeMacros(set),
        })));
        sidePromptSetNameCache = settledSets
            .filter(result => {
                if (result.status === 'fulfilled') return true;
                console.warn('STMB side prompt set cache refresh failed', result.reason);
                return false;
            })
            .map(result => result.value);
    } catch (error) {
        console.warn('STMB side prompt cache refresh failed', error);
    }
}

window.addEventListener('stmb-sideprompts-updated', refreshSidePromptCache);

function findCachedSidePromptByName(name, entries = sidePromptNameCache) {
    const target = String(name || '').toLowerCase();
    return entries.find(entry => entry.name.toLowerCase() === target) || null;
}

function findCachedSidePromptSetByName(name, entries = sidePromptSetNameCache) {
    const target = String(name || '').toLowerCase();
    return entries.find(entry => entry.name.toLowerCase() === target) || null;
}

function getCurrentSidePromptAutocompleteEntries(options = {}) {
    const { manualOnly = false } = options;
    const liveEntries = getCachedTemplateSnapshot().map(template => ({
        name: template.name,
        runtimeMacros: collectTemplateRuntimeMacros(template),
        manualEnabled: isManualSidePromptEnabled(template),
    }));
    const entries = liveEntries.length > 0 ? liveEntries : sidePromptNameCache;
    return manualOnly ? entries.filter(entry => entry.manualEnabled) : entries;
}

function getCurrentSidePromptSetAutocompleteEntries() {
    return sidePromptSetNameCache.length > 0
        ? sidePromptSetNameCache
        : getCachedSetSnapshot().map(set => ({
            name: set.name,
            runtimeMacros: [],
        }));
}

function buildSidePromptNameSuggestions(rawInput, options = {}) {
    const { manualOnly = false } = options;
    const input = String(rawInput || '').trimStart();
    const filter = input.startsWith('"') || input.startsWith('\'')
        ? input.slice(1).toLowerCase()
        : input.toLowerCase();
    const entries = getCurrentSidePromptAutocompleteEntries({ manualOnly });

    return entries.map(entry => new SlashCommandEnumValue(
        formatQuotedSidePromptName(entry.name),
        entry.runtimeMacros.length
            ? `Required macros: ${entry.runtimeMacros.join(', ')}`
            : 'No required runtime macros',
        'name',
        '📝',
        () => !filter || entry.name.toLowerCase().includes(filter),
    ));
}

function buildSidePromptSetNameSuggestions(rawInput) {
    const input = String(rawInput || '').trimStart();
    const filter = input.startsWith('"') || input.startsWith('\'')
        ? input.slice(1).toLowerCase()
        : input.toLowerCase();
    const entries = getCurrentSidePromptSetAutocompleteEntries();

    return entries.map(entry => new SlashCommandEnumValue(
        formatQuotedSidePromptName(entry.name),
        entry.runtimeMacros.length
            ? `Required macros: ${entry.runtimeMacros.join(', ')}`
            : 'No required runtime macros',
        'name',
        '📚',
        () => !filter || entry.name.toLowerCase().includes(filter),
    ));
}

function buildSidePromptMacroSuggestions(rawInput, draft, entry) {
    const provided = new Set(Object.keys(draft.runtimeMacros || {}));
    const remaining = (entry?.runtimeMacros || []).filter(token => !provided.has(token));
    return remaining.map(token => new SlashCommandEnumValue(
        `${token}=""`,
        `Required macro for "${entry.name}"`,
        'macro',
        '{}',
        () => true,
        () => buildSidePromptMacroSuggestion(rawInput, draft, token),
        true,
    ));
}

const sidePromptTemplateEnumProvider = (executor, options = {}) => {
    const { manualOnly = false } = options;
    const rawInput = String(executor?.unnamedArgumentList?.[0]?.value || '');
    const draft = parseSidePromptCommandInput(rawInput, { allowIncomplete: true });
    const entries = getCurrentSidePromptAutocompleteEntries({ manualOnly });

    if (draft.nameClosed) {
        const entry = findCachedSidePromptByName(draft.name, entries);
        if (entry) {
            return buildSidePromptMacroSuggestions(rawInput, draft, entry);
        }
    }

    return buildSidePromptNameSuggestions(rawInput, { manualOnly });
};

const manualSidePromptTemplateEnumProvider = executor =>
    sidePromptTemplateEnumProvider(executor, { manualOnly: true });

const allSidePromptTemplateEnumProvider = executor =>
    sidePromptTemplateEnumProvider(executor, { manualOnly: false });

const sidePromptSetEnumProvider = (executor, options = {}) => {
    const { includeMacros = false } = options;
    const rawInput = String(executor?.unnamedArgumentList?.[0]?.value || '');
    const draft = parseSidePromptCommandInput(rawInput, { allowIncomplete: true });

    if (includeMacros && draft.nameClosed) {
        const entry = findCachedSidePromptSetByName(draft.name, getCurrentSidePromptSetAutocompleteEntries());
        if (entry) {
            return buildSidePromptMacroSuggestions(rawInput, draft, entry);
        }
    }

    return buildSidePromptSetNameSuggestions(rawInput);
};

function cloneRegexScriptEnabled(script) {
    try {
        const clone = { ...script };
        clone.disabled = false;
        return clone;
    } catch {
        return script;
    }
}

function escapeRegexMacroValue(value) {
    return (value && typeof value === 'string')
        ? value.replaceAll(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, char => {
            switch (char) {
                case '\n': return '\\n';
                case '\r': return '\\r';
                case '\t': return '\\t';
                case '\v': return '\\v';
                case '\f': return '\\f';
                case '\0': return '\\0';
                default: return '\\' + char;
            }
        })
        : value;
}

function resolvePlannerRegexFind(regexScript) {
    switch (Number(regexScript?.substituteRegex)) {
        case substitute_find_regex.RAW:
            return substituteParamsExtended(regexScript?.findRegex, {}, value => value);
        case substitute_find_regex.ESCAPED:
            return substituteParamsExtended(regexScript?.findRegex, {}, escapeRegexMacroValue);
        case substitute_find_regex.NONE:
        default:
            return String(regexScript?.findRegex || '');
    }
}

function createPlannerRegexSnapshot(regexScript) {
    const script = cloneRegexScriptEnabled(regexScript);
    return {
        ...script,
        disabled: false,
        substituteRegex: substitute_find_regex.NONE,
        findRegex: resolvePlannerRegexFind(script),
        replaceString: substituteParams(String(script?.replaceString || '').replace(/{{match}}/gi, '$0')),
        trimStrings: Array.isArray(script?.trimStrings)
            ? script.trimStrings.map(item => substituteParams(String(item || '')))
            : [],
    };
}

function getPlannerRegexSnapshots(selectedKeys) {
    if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) {
        return [];
    }

    try {
        const allScripts = getRegexScripts({ allowedOnly: false }) || [];
        return selectedKeys
            .map(key => Number(String(key).replace(/^idx:/, '')))
            .filter(index => Number.isInteger(index) && index >= 0 && index < allScripts.length)
            .map(index => createPlannerRegexSnapshot(allScripts[index]));
    } catch (error) {
        console.warn('STMB planner regex snapshot failed', error);
        return [];
    }
}

function applyRegexScriptSnapshots(text, regexScripts = []) {
    if (typeof text !== 'string') return text;
    if (!Array.isArray(regexScripts) || regexScripts.length === 0) return text;

    try {
        let output = text;
        for (const script of regexScripts) {
            output = runRegexScript(cloneRegexScriptEnabled(script), output);
        }
        return output;
    } catch (error) {
        console.warn('STMB planner regex application failed', error);
        return text;
    }
}

function buildPlannerRegexConfig() {
    const moduleSettings = getModuleSettings();
    const enabled = Boolean(moduleSettings.useRegex);
    return {
        enabled,
        outgoingScripts: enabled ? getPlannerRegexSnapshots(moduleSettings.selectedRegexOutgoing) : [],
        incomingScripts: enabled ? getPlannerRegexSnapshots(moduleSettings.selectedRegexIncoming) : [],
    };
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

function getEffectivePromptText(profile, target = '') {
    const normalizedTarget = String(target || '').trim().toLowerCase();
    if (profile?.useGroupSpecificPrompts && normalizedTarget === 'group') {
        return getRequiredSummaryPromptText(profile?.groupPreset || 'group', stmbSettings);
    }
    if (profile?.useGroupSpecificPrompts && (normalizedTarget === 'character' || normalizedTarget === 'char')) {
        return getRequiredSummaryPromptText(profile?.characterPreset || 'char', stmbSettings);
    }
    if (typeof profile?.promptText === 'string' && profile.promptText.trim()) {
        return profile.promptText;
    }

    return getRequiredSummaryPromptText(profile?.preset, stmbSettings);
}

function buildEffectiveMemoryProfile(profile) {
    const effectiveProfile = structuredClone(profile || getActiveStmbProfile(stmbSettings));
    const effectivePrompt = getEffectivePromptText(effectiveProfile);
    if (typeof effectivePrompt === 'string' && effectivePrompt.trim()) {
        effectiveProfile.promptText = effectivePrompt;
    }
    if (effectiveProfile.useGroupSpecificPrompts) {
        effectiveProfile.groupPromptText = getEffectivePromptText(effectiveProfile, 'group');
        effectiveProfile.characterPromptText = getEffectivePromptText(effectiveProfile, 'character');
    }
    return effectiveProfile;
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

function getSettingsRegexOptions() {
    try {
        const scripts = getRegexScripts({ allowedOnly: false }) || [];
        return scripts.map((script, index) => {
            const key = `idx:${index}`;
            const name = String(script?.scriptName || 'Untitled');
            const disabled = Boolean(script?.disabled);
            return {
                key,
                label: `${name}${disabled ? ' (disabled)' : ''}`,
            };
        });
    } catch (error) {
        console.warn('STMB regex option enumeration failed', error);
        return [];
    }
}

function renderSettingsMultiOptions(options, selectedValues = []) {
    const selected = new Set((selectedValues || []).map(String));
    return options.map(option => `<option value="${escapeHtml(String(option.key))}" ${selected.has(String(option.key)) ? 'selected' : ''}>${escapeHtml(String(option.label || option.key))}</option>`).join('');
}

function renderSummaryTierOptions(selectedValues = []) {
    const selected = new Set((selectedValues || []).map(value => String(Number(value))));
    return Array.from({ length: 6 }, (_, index) => {
        const tier = index + 1;
        return `<option value="${tier}" ${selected.has(String(tier)) ? 'selected' : ''}>${escapeHtml(getSummaryTierLabel(tier))}</option>`;
    }).join('');
}

function renderMemoryBoundaryModeOptions(selectedMode) {
    const selected = normalizeStmbMemoryBoundaryMode(selectedMode);
    const options = [
        { value: STMB_MEMORY_BOUNDARY_MODES.OFF, label: 'Off' },
        { value: STMB_MEMORY_BOUNDARY_MODES.DIVIDER, label: 'Memory boundary' },
        { value: STMB_MEMORY_BOUNDARY_MODES.BUTTON, label: 'Jump button' },
        { value: STMB_MEMORY_BOUNDARY_MODES.BOTH, label: 'Memory boundary + jump button' },
    ];
    return options.map(option => `<option value="${escapeHtml(option.value)}" ${selected === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

function getStmbSelectableLorebookNames() {
    return (Array.isArray(world_names) ? world_names : []).filter(name => !isReservedTemplateWorldName(name));
}

function getManualPrimaryLorebookNames(sceneContext = buildStmbSceneContext()) {
    if (!sceneContext?.isGroupChat) return getStmbSelectableLorebookNames();
    const assignedCharacterBooks = new Set(
        Object.values(getManualCharacterLorebookBindings(getStmbState(sceneContext)))
            .map(value => String(value || '').trim())
            .filter(Boolean),
    );
    return getStmbSelectableLorebookNames().filter(name => !assignedCharacterBooks.has(name));
}

function renderManualGroupLorebookBindingsHtml(manualMode) {
    const sceneContext = buildStmbSceneContext();
    if (!manualMode || !sceneContext.isGroupChat) return '';
    const members = getStmbGroupMembers(sceneContext);
    const bindings = getManualCharacterLorebookBindings();
    const canonicalLorebookName = String(getStmbState(sceneContext).manualLorebook || '').trim();
    if (members.length === 0) {
        return '<small class="opacity50p">No group members are available for manual lorebook setup.</small>';
    }
    const rows = members.map(member => {
        const current = String(bindings[member.key] || '');
        const currentConflicts = Boolean(current && current === canonicalLorebookName);
        const options = [
            `<option value="" ${current ? '' : 'selected'} disabled>None selected</option>`,
            ...(currentConflicts ? [`<option value="${escapeHtml(current)}" selected disabled>${escapeHtml(current)} (unavailable: group Memory Book)</option>`] : []),
            ...getStmbSelectableLorebookNames()
                .filter(name => name !== canonicalLorebookName)
                .map(name => `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`),
        ].join('');
        return `<div class="stmb-manual-group-lorebook-row">
            <label class="stmb-manual-group-lorebook-label" for="stmb-member-lorebook-${escapeHtml(member.key)}">${escapeHtml(member.name)}</label>
            <select id="stmb-member-lorebook-${escapeHtml(member.key)}" class="text_pole stmb-manual-group-lorebook-select" data-member-key="${escapeHtml(member.key)}">${options}</select>
            <button type="button" class="menu_button stmb-manual-group-lorebook-clear" data-member-key="${escapeHtml(member.key)}" ${current ? '' : 'disabled'}>Clear</button>
        </div>`;
    }).join('');
    return `<div id="stmb-settings-manual-group-lorebooks" class="marginTop10">
        <h4>Group Character Lorebooks</h4>
        <small class="opacity50p">Select a lorebook for every group member. The same lorebook may be selected more than once.</small>
        <div class="stmb-manual-group-lorebook-list">${rows}</div>
        <label class="checkbox_label marginTop5"><input type="checkbox" id="stmb-settings-auto-accept-group-participants" ${getModuleSettings().autoAcceptGroupParticipants ? 'checked' : ''}> <span>Automatically accept detected memory participants</span></label>
    </div>`;
}

async function getSettingsPopupSceneData() {
    const markers = getSceneMarkers();
    const hasScene = Number.isInteger(markers.sceneStart) && Number.isInteger(markers.sceneEnd);
    const highestProcessed = getHighestProcessedMessageId();
    const data = {
        hasScene,
        highestProcessed,
        highestProcessedManuallySet: Boolean(markers.highestMemoryProcessedManuallySet),
        sceneStart: markers.sceneStart,
        sceneEnd: markers.sceneEnd,
        startSpeaker: '',
        endSpeaker: '',
        startExcerpt: '',
        endExcerpt: '',
        messageCount: 0,
        estimatedTokens: null,
    };

    if (!hasScene) {
        return data;
    }

    try {
        const range = getCurrentSceneRange();
        const compiledScene = compileScene(chat, buildSceneRequest(range));
        const startMessage = chat[range.sceneStart];
        const endMessage = chat[range.sceneEnd];
        const excerpt = message => {
            const content = String(message?.mes || '');
            return content.length > 140 ? `${content.slice(0, 140)}...` : content;
        };

        data.startSpeaker = String(startMessage?.name || 'Unknown');
        data.endSpeaker = String(endMessage?.name || 'Unknown');
        data.startExcerpt = excerpt(startMessage);
        data.endExcerpt = excerpt(endMessage);
        data.messageCount = compiledScene?.metadata?.messageCount ?? Math.max(0, range.sceneEnd - range.sceneStart + 1);
        data.estimatedTokens = await getTokenCountAsync(compiledSceneToText(compiledScene));
    } catch (error) {
        console.warn('STMB scene popup data compilation failed', error);
        data.messageCount = Math.max(0, Number(data.sceneEnd) - Number(data.sceneStart) + 1);
    }

    return data;
}

function buildDefaultSidePromptSetOptionsHtml(sets = [], selectedKey = '') {
    const normalizedKey = String(selectedKey || '').trim();
    const hasSelected = normalizedKey && sets.some(set => set.key === normalizedKey);
    return [
        `<option value="" ${!normalizedKey ? 'selected' : ''}>Use individually-enabled side prompts</option>`,
        ...(hasSelected || !normalizedKey ? [] : [`<option value="${escapeHtml(normalizedKey)}" selected>Missing set: ${escapeHtml(normalizedKey)}</option>`]),
        ...sets.map(set => `<option value="${escapeHtml(set.key)}" ${normalizedKey === set.key ? 'selected' : ''}>${escapeHtml(set.name)}</option>`),
    ].join('');
}

function buildSettingsPopupHtml(sceneData, currentUiConnection, regexOptions, sidePromptSets = []) {
    const settings = stmbSettings;
    const moduleSettings = getModuleSettings();
    const selectedProfileIndex = Number.isFinite(Number(settings.defaultProfile)) ? Number(settings.defaultProfile) : 0;
    const selectedProfile = getActiveStmbProfile(settings, selectedProfileIndex);
    const currentTitleFormat = String(settings.titleFormat || STMB_DEFAULT_TITLE_FORMAT);
    const titleFormats = Array.isArray(STMB_DEFAULT_TITLE_FORMATS) ? STMB_DEFAULT_TITLE_FORMATS : [];
    const usesCustomTitleFormat = !titleFormats.includes(currentTitleFormat);
    const activeLorebook = resolveLorebookName();
    const manualMode = Boolean(moduleSettings.manualModeEnabled);
    const summaryOrderMode = String(moduleSettings.summaryOrderMode || moduleSettings.summaryEntrySettings?.orderMode || 'auto').toLowerCase();
    const summaryOrderValue = Number.isFinite(Number(moduleSettings.summaryOrderValue))
        ? Math.trunc(Number(moduleSettings.summaryOrderValue))
        : Number(moduleSettings.summaryEntrySettings?.orderValue ?? 100);
    const summaryReverseStart = Number.isFinite(Number(moduleSettings.summaryReverseStart))
        ? Math.trunc(Number(moduleSettings.summaryReverseStart))
        : Number(moduleSettings.summaryEntrySettings?.reverseStart ?? 9999);
    const hasLorebookOrderDefaults = Boolean(moduleSettings.lorebookOrderDefaults);

    return `
        <div class="stmb-settings-popup">
            <h2>📕 Memory Books</h2>
            <div id="stmb-settings-scene-section">${buildSettingsPopupSceneSectionHtml(sceneData)}</div>

            <div id="stmb-settings-memory-status" class="info-block marginBot10">${buildSettingsPopupMemoryStatusHtml(sceneData)}</div>

            <section class="stmb-settings-subsection" data-stmb-settings-view="general">
            <h3 class="stmb-section-title">General Settings</h3>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-always-use-default" ${moduleSettings.alwaysUseDefault ? 'checked' : ''}> <span>Always use default profile (no confirmation prompt)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-show-memory-previews" ${moduleSettings.showMemoryPreviews ? 'checked' : ''}> <span>Show memory previews</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-show-consolidation-previews" ${moduleSettings.showConsolidationPreviews ? 'checked' : ''}> <span>Show consolidation previews</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-show-notifications" ${moduleSettings.showNotifications ? 'checked' : ''}> <span>Show notifications</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-show-floating-clip-button" ${moduleSettings.showFloatingClipButton !== false ? 'checked' : ''}> <span>Show floating Clip button</span></label>
                <label for="stmb-settings-memory-boundary-mode">
                    <span>Memory boundary indicator</span>
                    <small class="opacity50p">Show a chat divider, a jump button, or both at the Memory Books processed boundary.</small>
                    <select id="stmb-settings-memory-boundary-mode" class="text_pole">
                        ${renderMemoryBoundaryModeOptions(moduleSettings.memoryBoundaryMode)}
                    </select>
                </label>
                <label class="checkbox_label" title="Check this box to skip checking for overlapping memories/scenes."><input type="checkbox" id="stmb-settings-allow-scene-overlap" ${moduleSettings.allowSceneOverlap ? 'checked' : ''}> <span title="Check this box to skip checking for overlapping memories/scenes.">Allow scene overlap</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-refresh-editor" ${moduleSettings.refreshEditor !== false ? 'checked' : ''}> <span>Refresh lorebook editor after adding memories</span></label>
            </div>

            <div class="world_entry_form_control">
                <label for="stmb-settings-max-tokens" title="Maximum number of tokens to use for memory summaries.">Max Response Tokens</label>
                <input type="number" id="stmb-settings-max-tokens" class="text_pole" min="0" step="1" value="${escapeHtml(String(moduleSettings.maxTokens ?? STMB_DEFAULT_MAX_TOKENS))}" title="Maximum number of tokens to use for memory summaries.">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-token-warning-threshold" title="Show confirmation dialog when estimated input tokens exceed this threshold. Default: 30,000.">Token Warning Threshold</label>
                <input type="number" id="stmb-settings-token-warning-threshold" class="text_pole" min="1000" max="200000" step="1000" value="${escapeHtml(String(moduleSettings.tokenWarningThreshold ?? 50000))}" title="Show confirmation dialog when estimated input tokens exceed this threshold. Default: 30,000.">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-default-memory-count" title="Default number of previous memories to include as context when creating new memories.">Default Previous Memories Count</label>
                <input type="number" id="stmb-settings-default-memory-count" class="text_pole" min="0" max="7" step="1" value="${escapeHtml(String(moduleSettings.defaultMemoryCount ?? 0))}" title="Default number of previous memories to include as context when creating new memories.">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-default-solo-sideprompt-set">Default Side Prompt Set for Solo Chats</label>
                <select id="stmb-settings-default-solo-sideprompt-set" class="text_pole">
                    ${buildDefaultSidePromptSetOptionsHtml(sidePromptSets, moduleSettings.defaultSoloSidePromptSetKey)}
                </select>
                <small class="opacity50p">Used for after-memory side prompts when a solo chat has no per-chat override.</small>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-default-group-sideprompt-set">Default Side Prompt Set for Group Chats</label>
                <select id="stmb-settings-default-group-sideprompt-set" class="text_pole">
                    ${buildDefaultSidePromptSetOptionsHtml(sidePromptSets, moduleSettings.defaultGroupSidePromptSetKey)}
                </select>
                <small class="opacity50p">Used for after-memory side prompts when a group chat has no per-chat override.</small>
            </div>

            <h3 class="stmb-section-title">Token Saving (Hide/Unhide Messages)</h3>
            <div class="world_entry_form_control">
                <label for="stmb-settings-auto-hide-mode" title="Choose what messages to automatically hide after creating a memory.">Auto-hide messages after adding memory</label>
                <select id="stmb-settings-auto-hide-mode" class="text_pole" title="Choose what messages to automatically hide after creating a memory.">
                    <option value="none" ${String(moduleSettings.autoHideMode || 'all').toLowerCase() === 'none' ? 'selected' : ''}>Do not auto-hide</option>
                    <option value="all" ${String(moduleSettings.autoHideMode || 'all').toLowerCase() === 'all' ? 'selected' : ''}>Auto-hide all messages up to the last memory</option>
                    <option value="last" ${String(moduleSettings.autoHideMode || 'all').toLowerCase() === 'last' ? 'selected' : ''}>Auto-hide only messages in the last memory</option>
                </select>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-unhidden-entries-count" title="Number of recent messages to leave visible when auto-hiding (0 = hide all up to scene end).">Messages to leave unhidden</label>
                <input type="number" id="stmb-settings-unhidden-entries-count" class="text_pole" min="0" max="50" step="1" value="${escapeHtml(String(moduleSettings.unhiddenEntriesCount ?? 2))}" title="Number of recent messages to leave visible when auto-hiding (0 = hide all up to scene end).">
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label" title="Include hidden messages when STMB captures a message range."><input type="checkbox" id="stmb-settings-unhide-before-memory" ${moduleSettings.unhideBeforeMemory ? 'checked' : ''}> <span title="Include hidden messages when STMB captures a message range.">Include hidden messages for memory generation</span></label>
            </div>

            <div class="world_entry_form_control">
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-use-regex" ${moduleSettings.useRegex ? 'checked' : ''}> <span>Use regex (advanced)</span></label>
            </div>
            <div id="stmb-settings-regex-section" class="world_entry_form_control" style="display:${moduleSettings.useRegex ? 'block' : 'none'}">
                <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                    <div id="stmb-settings-configure-regex" class="menu_button interactable">Configure regex…</div>
                </div>
                <small id="stmb-settings-regex-summary" class="opacity50p">Selected outgoing: ${escapeHtml(String((moduleSettings.selectedRegexOutgoing || []).length))} | selected incoming: ${escapeHtml(String((moduleSettings.selectedRegexIncoming || []).length))}</small>
            </div>

            </section>

            <h3 class="stmb-section-title">Current Lorebook Configuration</h3>
            <div class="info-block">
                <small class="opacity50p">Mode</small>
                <h5 id="stmb-settings-mode-badge">${manualMode ? 'Manual' : 'Automatic (Chat-bound)'}</h5>
                <small class="opacity50p">Active Lorebook</small>
                <h5 id="stmb-settings-active-lorebook" class="${activeLorebook ? '' : 'opacity50p'}">${activeLorebook ? escapeHtml(activeLorebook) : 'None selected'}</h5>
                <div id="stmb-settings-manual-buttons" class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap" style="display:${manualMode ? 'flex' : 'none'}">
                    <div id="stmb-settings-select-lorebook" class="menu_button interactable">Select Lorebook</div>
                    <div id="stmb-settings-clear-lorebook" class="menu_button interactable">Clear Selection</div>
                </div>
                <div id="stmb-settings-automatic-info" class="marginTop5 ${manualMode ? 'displayNone' : ''}">
                    <small class="opacity50p">${activeLorebook ? `Using chat-bound lorebook "${escapeHtml(activeLorebook)}"` : 'No chat-bound lorebook. Memory creation will prompt for recovery when needed.'}</small>
                </div>
            </div>

            <div class="world_entry_form_control">
                <label class="checkbox_label" title="When enabled, you must specify a lorebook for memories instead of using the one bound to the chat."><input type="checkbox" id="stmb-settings-manual-mode-enabled" ${manualMode ? 'checked' : ''} ${moduleSettings.autoCreateLorebook ? 'disabled' : ''}> <span title="When enabled, you must specify a lorebook for memories instead of using the one bound to the chat.">Enable Manual Lorebook Mode</span></label>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label" title="When enabled, automatically creates and binds a lorebook to the chat if none exists."><input type="checkbox" id="stmb-settings-auto-create-lorebook" ${moduleSettings.autoCreateLorebook ? 'checked' : ''} ${manualMode ? 'disabled' : ''}> <span title="When enabled, automatically creates and binds a lorebook to the chat if none exists.">Auto-create lorebook if none exists</span></label>
            </div>
            ${renderManualGroupLorebookBindingsHtml(manualMode)}
            <div class="world_entry_form_control marginTop10 marginBot10">
                <label for="stmb-settings-lorebook-name-template" title="Template for auto-created lorebook names. Supports {{char}}, {{user}}, {{chat}} placeholders.">Lorebook Name Template</label>
                <input type="text" id="stmb-settings-lorebook-name-template" class="text_pole" value="${escapeHtml(String(moduleSettings.lorebookNameTemplate || 'LTM - {{char}} - {{chat}}'))}" ${moduleSettings.autoCreateLorebook ? '' : 'disabled'} title="Template for auto-created lorebook names. Supports {{char}}, {{user}}, {{chat}} placeholders.">
            </div>
            <div class="world_entry_form_control">
                <h4 class="stmb-section-title margin5">Lorebook Order Defaults</h4>
                <div class="buttons_block marginTop10 justifyCenter gap10px whitespacenowrap">
                    <div id="stmb-settings-configure-lorebook-order-defaults" class="menu_button interactable">Configure Lorebook Order Defaults</div>
                </div>
                <small id="stmb-settings-lorebook-order-defaults-summary" class="opacity50p">${hasLorebookOrderDefaults ? 'Defaults configured for newly auto-created memory books.' : 'No order defaults configured.'}</small>
            </div>

            <section class="stmb-settings-subsection" data-stmb-settings-view="automatic">
            <h3 class="stmb-section-title">Automatic Memories</h3>
            <div class="world_entry_form_control">
                <label class="checkbox_label" title="Automatically run /nextmemory after a specified number of messages. Warning: enabling Auto-Summary may create one large memory from the existing backlog. Use /stmb-set-highest &lt;N|none&gt; to control the baseline."><input type="checkbox" id="stmb-settings-auto-summary-enabled" ${moduleSettings.autoSummaryEnabled ? 'checked' : ''}> <span title="Automatically run /nextmemory after a specified number of messages. Warning: enabling Auto-Summary may create one large memory from the existing backlog. Use /stmb-set-highest &lt;N|none&gt; to control the baseline.">Auto-create memory summaries</span></label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-auto-summary-interval" title="Number of messages after which to automatically create a memory summary.">Auto-Summary Interval</label>
                <input type="number" id="stmb-settings-auto-summary-interval" class="text_pole" min="10" max="200" step="1" value="${escapeHtml(String(moduleSettings.autoSummaryInterval ?? 50))}" title="Number of messages after which to automatically create a memory summary.">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-auto-summary-buffer" title="Delay auto-summary by X messages (belated generation). Default 2, max 50.">Auto-Summary Buffer</label>
                <input type="number" id="stmb-settings-auto-summary-buffer" class="text_pole" min="0" max="50" step="1" value="${escapeHtml(String(moduleSettings.autoSummaryBuffer ?? 2))}" title="Delay auto-summary by X messages (belated generation). Default 2, max 50.">
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label" title="Shows a yes/no prompt when any selected summary tier has enough eligible source entries. Uses each tier's saved minimum."><input type="checkbox" id="stmb-settings-auto-consolidation-prompt-enabled" ${moduleSettings.autoConsolidationPromptEnabled ? 'checked' : ''}> <span title="Shows a yes/no prompt when any selected summary tier has enough eligible source entries. Uses each tier's saved minimum.">Prompt for consolidation when a tier is ready</span></label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-auto-consolidation-target-tier" title="Choose which summary tiers should trigger the confirmation prompt.">Auto-Consolidation Tiers</label>
                <select id="stmb-settings-auto-consolidation-target-tier" class="text_pole" multiple size="6" title="Choose which summary tiers should trigger the confirmation prompt.">${renderSummaryTierOptions(normalizeAutoConsolidationTargetTiers(moduleSettings.autoConsolidationTargetTiers ?? moduleSettings.autoConsolidationTargetTier))}</select>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-settings-summary-order-mode">Default Summary Entry Order Mode</label>
                <select id="stmb-settings-summary-order-mode" class="text_pole">
                    <option value="auto" ${summaryOrderMode === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="manual" ${summaryOrderMode === 'manual' ? 'selected' : ''}>Manual</option>
                    <option value="reverse" ${summaryOrderMode === 'reverse' ? 'selected' : ''}>Reverse</option>
                </select>
            </div>
            <div id="stmb-settings-summary-order-value-row" class="world_entry_form_control" style="display:${summaryOrderMode === 'manual' ? 'block' : 'none'}">
                <label for="stmb-settings-summary-order-value">Manual Summary Entry Order</label>
                <input type="number" id="stmb-settings-summary-order-value" class="text_pole" min="0" max="9999" step="1" value="${escapeHtml(String(summaryOrderValue))}">
            </div>
            <div id="stmb-settings-summary-reverse-start-row" class="world_entry_form_control" style="display:${summaryOrderMode === 'reverse' ? 'block' : 'none'}">
                <label for="stmb-settings-summary-reverse-start">Reverse Summary Start Order</label>
                <input type="number" id="stmb-settings-summary-reverse-start" class="text_pole" min="100" max="9999" step="1" value="${escapeHtml(String(summaryReverseStart))}">
            </div>

            </section>

            <h3 class="stmb-section-title">🧠 Memory Profiles</h3>
            <div class="world_entry_form_control">
                <label for="stmb-settings-title-format-select" title="Use [0], [00], [000] for plain auto-numbering; use [[0]], [[00]], [[000]] to keep square brackets. Available: {{title}}, {{scene}}, {{char}}, {{user}}, {{messages}}, {{profile}}, {{date}}, {{time}}.">Memory Title Format</label>
                <select id="stmb-settings-title-format-select" class="text_pole">
                    ${titleFormats.map(format => `<option value="${escapeHtml(format)}" ${!usesCustomTitleFormat && format === currentTitleFormat ? 'selected' : ''}>${escapeHtml(format)}</option>`).join('')}
                    <option value="custom" ${usesCustomTitleFormat ? 'selected' : ''}>Custom Title Format...</option>
                </select>
                <input type="text" id="stmb-settings-custom-title-format" class="text_pole marginTop5 ${usesCustomTitleFormat ? '' : 'displayNone'}" value="${escapeHtml(currentTitleFormat)}" placeholder="Enter custom format" title="Use [0], [00], [000] for plain auto-numbering; use [[0]], [[00]], [[000]] to keep square brackets. Available: {{title}}, {{scene}}, {{char}}, {{user}}, {{messages}}, {{profile}}, {{date}}, {{time}}.">
            </div>

            <div class="world_entry_form_control">
                <label for="stmb-settings-profile-select">Profile</label>
                <select id="stmb-settings-profile-select" class="text_pole">
                    ${(settings.profiles || []).map((profile, index) => `<option value="${index}" ${index === selectedProfileIndex ? 'selected' : ''}>${escapeHtml(getProfileDisplayName(profile))}${index === settings.defaultProfile ? ' (Default)' : ''}</option>`).join('')}
                </select>
            </div>
            <div id="stmb-settings-profile-summary" class="info-block marginBot10">
                <div class="marginBot5">Profile Settings:</div>
                <div>Provider: <span id="stmb-settings-summary-api">${escapeHtml(String(selectedProfile?.connection?.api === 'current_st' ? currentUiConnection.api : (selectedProfile?.connection?.api || 'openai')))}</span></div>
                <div>Model: <span id="stmb-settings-summary-model">${escapeHtml(String(getProfileModelDisplay(selectedProfile) || 'Current SillyTavern model'))}</span></div>
                <div>Temperature: <span id="stmb-settings-summary-temp">${escapeHtml(String(getProfileTemperatureDisplay(selectedProfile)))}</span></div>
                <div>Title Format: <span id="stmb-settings-summary-title">${escapeHtml(String(selectedProfile?.titleFormat || settings.titleFormat || STMB_DEFAULT_TITLE_FORMAT))}</span></div>
                <details class="marginTop10">
                    <summary>View Prompt</summary>
                    <div class="padding10 marginTop5 stmb-box">
                        <pre><code id="stmb-settings-summary-prompt">${escapeHtml(String(getEffectivePromptText(selectedProfile) || ''))}</code></pre>
                    </div>
                </details>
            </div>
            <div class="world_entry_form_control">
                <div class="marginBot5">👤 Profile Actions</div>
                <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap">
                    <div id="stmb-settings-profile-set-default" class="menu_button interactable">Set As Default</div>
                    <div id="stmb-settings-profile-new" class="menu_button interactable">New Profile</div>
                    <div id="stmb-settings-profile-edit" class="menu_button interactable">Edit Profile</div>
                    <div id="stmb-settings-profile-delete" class="menu_button interactable">Delete Profile</div>
                </div>
            </div>
            <input type="file" id="stmb-settings-import-file" accept=".json" class="displayNone">
            <div class="world_entry_form_control">
                <div class="marginBot5">Import / Export Profiles</div>
                <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap">
                    <div id="stmb-settings-profile-export" class="menu_button interactable">Export Profiles</div>
                    <div id="stmb-settings-profile-import" class="menu_button interactable">Import Profiles</div>
                </div>
            </div>
            <h3 class="stmb-section-title">⚙️ Settings</h3>
            <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap">
                <div id="stmb-settings-open-general-settings" class="menu_button interactable">General Settings</div>
                <div id="stmb-settings-open-automatic-settings" class="menu_button interactable">Automatic Memories</div>
                <div id="stmb-settings-open-prompt-manager" class="menu_button interactable">Open Summary Prompt Manager</div>
                <div id="stmb-settings-open-arc-prompt-manager" class="menu_button interactable">Open Consolidation Prompt Manager</div>
                <div id="stmb-settings-open-sideprompt-manager" class="menu_button interactable">Open Side Prompt Manager</div>
            </div>
        </div>
    `;
}

function buildSettingsPopupSceneSectionHtml(sceneData) {
    if (!sceneData?.hasScene) {
        return `
            <div class="info-block warning marginBot10">
                No scene markers set. Use the inline scene buttons in chat messages to mark a start and end point.
            </div>
        `;
    }

    return `
        <div class="padding10 marginBot10">
            <div class="marginBot5">Current Scene:</div>
            <div class="padding10 marginTop5 stmb-box">
                <pre><code>Start: Message #${escapeHtml(String(sceneData.sceneStart))} (${escapeHtml(sceneData.startSpeaker || 'Unknown')})
${escapeHtml(sceneData.startExcerpt || '')}

End: Message #${escapeHtml(String(sceneData.sceneEnd))} (${escapeHtml(sceneData.endSpeaker || 'Unknown')})
${escapeHtml(sceneData.endExcerpt || '')}

Messages: ${escapeHtml(String(sceneData.messageCount || 0))} | Estimated tokens: ${escapeHtml(String(sceneData.estimatedTokens ?? '?'))}</code></pre>
            </div>
        </div>
    `;
}

function buildSettingsPopupMemoryStatusHtml(sceneData) {
    return Number.isInteger(sceneData?.highestProcessed)
        ? `Memory Status: ${sceneData.highestProcessedManuallySet ? 'last processed message manually set to' : 'processed up to message'} #${escapeHtml(String(sceneData.highestProcessed))}.`
        : 'Memory Status: no memories have been processed for this chat yet.';
}

function syncSummaryOrderModuleSettings(moduleSettings, overrides = {}) {
    if (!moduleSettings || typeof moduleSettings !== 'object') {
        return normalizeLorebookEntrySettings(overrides);
    }

    const nextSummaryEntrySettings = normalizeLorebookEntrySettings({
        ...(moduleSettings.summaryEntrySettings || {}),
        orderMode: overrides.orderMode ?? moduleSettings.summaryOrderMode ?? moduleSettings.summaryEntrySettings?.orderMode,
        orderValue: overrides.orderValue ?? moduleSettings.summaryOrderValue ?? moduleSettings.summaryEntrySettings?.orderValue,
        reverseStart: overrides.reverseStart ?? moduleSettings.summaryReverseStart ?? moduleSettings.summaryEntrySettings?.reverseStart,
    }, moduleSettings.summaryEntrySettings || {});

    moduleSettings.summaryEntrySettings = { ...(moduleSettings.summaryEntrySettings || {}), ...nextSummaryEntrySettings };
    moduleSettings.summaryOrderMode = nextSummaryEntrySettings.orderMode;
    moduleSettings.summaryOrderValue = nextSummaryEntrySettings.orderValue;
    moduleSettings.summaryReverseStart = nextSummaryEntrySettings.reverseStart;
    moduleSettings.arcOrderMode = nextSummaryEntrySettings.orderMode;
    moduleSettings.arcOrderValue = nextSummaryEntrySettings.orderValue;
    moduleSettings.arcReverseStart = nextSummaryEntrySettings.reverseStart;
    return nextSummaryEntrySettings;
}

async function refreshOpenSettingsPopupSceneState() {
    const dialog = activeSettingsPopupDialog;
    if (!(dialog instanceof HTMLElement) || !dialog.isConnected) {
        if (activeSettingsPopupDialog === dialog) {
            activeSettingsPopupDialog = null;
        }
        return;
    }

    const sceneData = await getSettingsPopupSceneData();
    const sceneSection = dialog.querySelector('#stmb-settings-scene-section');
    const memoryStatus = dialog.querySelector('#stmb-settings-memory-status');

    if (sceneSection) {
        sceneSection.innerHTML = DOMPurify.sanitize(buildSettingsPopupSceneSectionHtml(sceneData));
    }
    if (memoryStatus) {
        memoryStatus.innerHTML = DOMPurify.sanitize(buildSettingsPopupMemoryStatusHtml(sceneData));
    }
}

function updateSettingsPopupDynamicState(dialog, currentUiConnection) {
    if (!dialog) {
        return;
    }

    const moduleSettings = getModuleSettings();
    const manualMode = Boolean(moduleSettings.manualModeEnabled);
    const activeLorebook = resolveLorebookName();
    const titleFormatSelect = dialog.querySelector('#stmb-settings-title-format-select');
    const customTitleInput = dialog.querySelector('#stmb-settings-custom-title-format');
    const profileSelect = dialog.querySelector('#stmb-settings-profile-select');
    const selectedProfile = getActiveStmbProfile(stmbSettings, Number(profileSelect?.value ?? stmbSettings.defaultProfile ?? 0));
    const automaticInfo = dialog.querySelector('#stmb-settings-automatic-info');
    const regexSection = dialog.querySelector('#stmb-settings-regex-section');
    const currentDefaultProfile = Number(stmbSettings.defaultProfile ?? 0);

    const modeBadge = dialog.querySelector('#stmb-settings-mode-badge');
    if (modeBadge) {
        modeBadge.textContent = manualMode ? 'Manual' : 'Automatic (Chat-bound)';
    }

    const activeLorebookEl = dialog.querySelector('#stmb-settings-active-lorebook');
    if (activeLorebookEl) {
        activeLorebookEl.textContent = activeLorebook || 'None selected';
        activeLorebookEl.classList.toggle('opacity50p', !activeLorebook);
    }

    const manualButtons = dialog.querySelector('#stmb-settings-manual-buttons');
    if (manualButtons) {
        manualButtons.style.display = manualMode ? 'flex' : 'none';
    }

    if (automaticInfo) {
        automaticInfo.classList.toggle('displayNone', manualMode);
        automaticInfo.innerHTML = `<small class="opacity50p">${manualMode
            ? ''
            : (activeLorebook
                ? `Using chat-bound lorebook "${escapeHtml(activeLorebook)}"`
                : 'No chat-bound lorebook. Memory creation will prompt for recovery when needed.')}</small>`;
    }

    const manualModeCheckbox = dialog.querySelector('#stmb-settings-manual-mode-enabled');
    const autoCreateCheckbox = dialog.querySelector('#stmb-settings-auto-create-lorebook');
    const lorebookTemplateInput = dialog.querySelector('#stmb-settings-lorebook-name-template');
    const lorebookOrderDefaultsSummary = dialog.querySelector('#stmb-settings-lorebook-order-defaults-summary');
    if (manualModeCheckbox) {
        manualModeCheckbox.disabled = Boolean(moduleSettings.autoCreateLorebook);
    }
    if (autoCreateCheckbox) {
        autoCreateCheckbox.disabled = manualMode;
    }
    if (lorebookTemplateInput) {
        lorebookTemplateInput.disabled = !moduleSettings.autoCreateLorebook;
    }
    if (lorebookOrderDefaultsSummary) {
        lorebookOrderDefaultsSummary.textContent = moduleSettings.lorebookOrderDefaults
            ? 'Defaults configured for newly auto-created memory books.'
            : 'No order defaults configured.';
    }

    if (regexSection) {
        regexSection.style.display = moduleSettings.useRegex ? 'block' : 'none';
    }
    const summaryOrderMode = String(moduleSettings.summaryOrderMode || moduleSettings.summaryEntrySettings?.orderMode || 'auto').toLowerCase();
    const summaryOrderModeSelect = dialog.querySelector('#stmb-settings-summary-order-mode');
    const summaryOrderValueInput = dialog.querySelector('#stmb-settings-summary-order-value');
    const summaryReverseStartInput = dialog.querySelector('#stmb-settings-summary-reverse-start');
    const summaryOrderValueRow = dialog.querySelector('#stmb-settings-summary-order-value-row');
    const summaryReverseStartRow = dialog.querySelector('#stmb-settings-summary-reverse-start-row');
    if (summaryOrderModeSelect) {
        summaryOrderModeSelect.value = summaryOrderMode;
    }
    if (summaryOrderValueInput) {
        summaryOrderValueInput.value = String(moduleSettings.summaryOrderValue ?? moduleSettings.summaryEntrySettings?.orderValue ?? 100);
    }
    if (summaryReverseStartInput) {
        summaryReverseStartInput.value = String(moduleSettings.summaryReverseStart ?? moduleSettings.summaryEntrySettings?.reverseStart ?? 9999);
    }
    if (summaryOrderValueRow) {
        summaryOrderValueRow.style.display = summaryOrderMode === 'manual' ? 'block' : 'none';
    }
    if (summaryReverseStartRow) {
        summaryReverseStartRow.style.display = summaryOrderMode === 'reverse' ? 'block' : 'none';
    }
    const regexSummary = dialog.querySelector('#stmb-settings-regex-summary');
    if (regexSummary) {
        regexSummary.textContent = `Selected outgoing: ${(moduleSettings.selectedRegexOutgoing || []).length} | selected incoming: ${(moduleSettings.selectedRegexIncoming || []).length}`;
    }

    const maxTokensInput = dialog.querySelector('#stmb-settings-max-tokens');
    if (maxTokensInput) {
        maxTokensInput.value = String(moduleSettings.maxTokens ?? STMB_DEFAULT_MAX_TOKENS);
    }

    if (customTitleInput && titleFormatSelect) {
        const usingCustom = titleFormatSelect.value === 'custom';
        customTitleInput.classList.toggle('displayNone', !usingCustom);
    }

    if (profileSelect) {
        Array.from(profileSelect.options).forEach(option => {
            const optionIndex = Number(option.value);
            const profile = stmbSettings.profiles?.[optionIndex];
            option.textContent = `${getProfileDisplayName(profile)}${optionIndex === currentDefaultProfile ? ' (Default)' : ''}`;
        });
    }

    const apiEl = dialog.querySelector('#stmb-settings-summary-api');
    if (apiEl) {
        apiEl.textContent = String(selectedProfile?.connection?.api === 'current_st' ? currentUiConnection.api : (selectedProfile?.connection?.api || 'openai'));
    }
    const modelEl = dialog.querySelector('#stmb-settings-summary-model');
    if (modelEl) {
        modelEl.textContent = String(getProfileModelDisplay(selectedProfile) || 'Current SillyTavern model');
    }
    const tempEl = dialog.querySelector('#stmb-settings-summary-temp');
    if (tempEl) {
        tempEl.textContent = String(getProfileTemperatureDisplay(selectedProfile));
    }
    const titleEl = dialog.querySelector('#stmb-settings-summary-title');
    if (titleEl) {
        titleEl.textContent = String(selectedProfile?.titleFormat || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT);
    }
    const promptEl = dialog.querySelector('#stmb-settings-summary-prompt');
    if (promptEl) {
        promptEl.textContent = String(getEffectivePromptText(selectedProfile) || '');
    }
}

function readSelectedValues(selectElement) {
    return Array.from(selectElement?.selectedOptions || []).map(option => String(option.value));
}

async function showRegexSelectionPopup() {
    const regexOptions = getSettingsRegexOptions();
    const moduleSettings = getModuleSettings();
    const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-regex-selection-popup">
            <h3>Regex selection</h3>
            <div class="world_entry_form_control">
                <small class="opacity70p">Selecting a regex here will run it REGARDLESS of whether it is enabled or disabled.</small>
            </div>
            <div class="world_entry_form_control">
                <h4>Run regex before sending to AI</h4>
                <select id="stmb-regex-popup-outgoing" class="text_pole" multiple size="${Math.max(4, Math.min(10, regexOptions.length || 4))}" style="width:100%">
                    ${renderSettingsMultiOptions(regexOptions, moduleSettings.selectedRegexOutgoing)}
                </select>
            </div>
            <div class="world_entry_form_control">
                <h4>Run regex before adding to lorebook (before previews)</h4>
                <select id="stmb-regex-popup-incoming" class="text_pole" multiple size="${Math.max(4, Math.min(10, regexOptions.length || 4))}" style="width:100%">
                    ${renderSettingsMultiOptions(regexOptions, moduleSettings.selectedRegexIncoming)}
                </select>
            </div>
        </div>
    `), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: 'Save',
        cancelButton: 'Close',
    });

    setTimeout(() => {
        try {
            if (window.jQuery && typeof window.jQuery.fn.select2 === 'function') {
                const $parent = window.jQuery(popup.dlg);
                window.jQuery('#stmb-regex-popup-outgoing').select2({
                    width: '100%',
                    placeholder: 'Select outgoing regex…',
                    closeOnSelect: false,
                    dropdownParent: $parent,
                });
                window.jQuery('#stmb-regex-popup-incoming').select2({
                    width: '100%',
                    placeholder: 'Select incoming regex…',
                    closeOnSelect: false,
                    dropdownParent: $parent,
                });
            }
        } catch (error) {
            console.warn('STMB regex selection Select2 initialization failed', error);
        }
    }, 0);

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }

    try {
        moduleSettings.selectedRegexOutgoing = readSelectedValues(popup.dlg?.querySelector('#stmb-regex-popup-outgoing'));
        moduleSettings.selectedRegexIncoming = readSelectedValues(popup.dlg?.querySelector('#stmb-regex-popup-incoming'));
        stmbSettings = normalizeStmbSettings(stmbSettings);
        saveSettingsDebounced();
        toastr.success('Regex selections saved', 'STMB');
        return true;
    } catch (error) {
        console.warn('STMB regex selection save failed', error);
        toastr.error('Failed to save regex selections', 'STMB');
        return false;
    }
}

const STMB_PROFILE_PROVIDER_OPTIONS = Object.freeze([
    ['current_st', 'Current SillyTavern Settings'],
    ['ai21', 'AI21'],
    ['aimlapi', 'AI/ML API'],
    ['claude', 'Anthropic/Claude'],
    ['azure_openai', 'Azure OpenAI'],
    ['cohere', 'Cohere'],
    ['cometapi', 'Comet API'],
    ['deepseek', 'DeepSeek'],
    ['electronhub', 'Electron Hub'],
    ['fireworks', 'Fireworks'],
    ['makersuite', 'Google AI Studio'],
    ['groq', 'Groq'],
    ['mistralai', 'MistralAI'],
    ['moonshot', 'Moonshot'],
    ['navy', 'Navy'],
    ['nanogpt', 'NanoGPT'],
    ['openai', 'OpenAI'],
    ['openrouter', 'OpenRouter'],
    ['perplexity', 'Perplexity'],
    ['pollinations', 'Pollinations'],
    ['siliconflow', 'SiliconFlow'],
    ['vertexai', 'Vertex AI'],
    ['xai', 'xAI'],
    ['zai', 'Z.AI'],
    ['custom', 'Custom OpenAI-Compatible API'],
    ['full-manual', 'Full Manual Configuration'],
]);

const STMB_SUMMARY_PROMPT_DISPLAY_NAMES = Object.freeze({
    summary: 'Summary - Detailed beat-by-beat summaries in narrative prose',
    summarize: 'Summarize - Bullet-point format',
    synopsis: 'Synopsis - Long and comprehensive (beats, interactions, details) with headings',
    sumup: 'Sum Up - Concise story beats in narrative prose',
    minimal: 'Minimal - Brief 1-2 sentence summary',
    northgate: 'Northgate - Intended for creative writing. By Northgate on ST Discord',
    aelemar: 'Aelemar - Focuses on plot points and character memories. By Aelemar on ST Discord',
    comprehensive: 'Comprehensive - Synopsis plus improved keywords extraction',
});

const STMB_PROFILE_SECRET_KEYS = Object.freeze({
    ai21: SECRET_KEYS.AI21,
    aimlapi: SECRET_KEYS.AIMLAPI,
    azure_openai: SECRET_KEYS.AZURE_OPENAI,
    claude: SECRET_KEYS.CLAUDE,
    cohere: SECRET_KEYS.COHERE,
    cometapi: SECRET_KEYS.COMETAPI,
    deepseek: SECRET_KEYS.DEEPSEEK,
    electronhub: SECRET_KEYS.ELECTRONHUB,
    fireworks: SECRET_KEYS.FIREWORKS,
    groq: SECRET_KEYS.GROQ,
    makersuite: SECRET_KEYS.MAKERSUITE,
    mistralai: SECRET_KEYS.MISTRALAI,
    moonshot: SECRET_KEYS.MOONSHOT,
    nanogpt: SECRET_KEYS.NANOGPT,
    navy: SECRET_KEYS.NAVY,
    openai: SECRET_KEYS.OPENAI,
    openrouter: SECRET_KEYS.OPENROUTER,
    perplexity: SECRET_KEYS.PERPLEXITY,
    siliconflow: SECRET_KEYS.SILICONFLOW,
    vertexai: SECRET_KEYS.VERTEXAI,
    xai: SECRET_KEYS.XAI,
    zai: SECRET_KEYS.ZAI,
    zanity: SECRET_KEYS.ZANITY,
});
const STMB_PROFILE_KEYLESS_SOURCES = new Set(['custom', 'pollinations']);

function toTitleCase(text) {
    return String(text || '').replace(/\w\S*/g, token => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase());
}

function safeSlug(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'custom-prompt';
}

function getProfilePresetKeys(settings = stmbSettings) {
    return listCachedSummaryPromptPresets(settings).map(preset => preset.key);
}

function getSummaryPromptDisplayName(key) {
    return getCachedSummaryPromptDisplayName(key, stmbSettings);
}

function listSummaryPromptPresets() {
    return listCachedSummaryPromptPresets(stmbSettings);
}

function getSummaryPromptText(key) {
    return getCachedSummaryPromptText(key, stmbSettings);
}

function emitSummaryPresetsUpdated() {
    try {
        window.dispatchEvent(new CustomEvent('stmb-presets-updated'));
    } catch {
        // noop
    }
}

async function upsertSummaryPromptPreset(key, prompt, displayName = null) {
    const nextKey = await upsertSummaryPromptPresetFile(key, prompt, displayName);
    emitSummaryPresetsUpdated();
    return nextKey;
}

async function duplicateSummaryPromptPreset(key) {
    const nextKey = await duplicateSummaryPromptPresetFile(key);
    emitSummaryPresetsUpdated();
    return nextKey;
}

async function removeSummaryPromptPreset(key) {
    await removeSummaryPromptPresetFile(key);
    emitSummaryPresetsUpdated();
}

async function recreateBuiltInSummaryPromptOverrides() {
    const result = await recreateBuiltInSummaryPromptOverridesFile();
    emitSummaryPresetsUpdated();
    return result;
}

async function exportSummaryPromptPresetsJson() {
    return await exportSummaryPromptPresetsJsonFile();
}

async function importSummaryPromptPresetsJson(text) {
    await importSummaryPromptPresetsJsonFile(text);
    emitSummaryPresetsUpdated();
}

function listArcPromptPresets() {
    return listCachedArcPromptPresets(stmbSettings);
}

function getArcPromptDisplayName(key) {
    return getCachedArcPromptDisplayName(key, stmbSettings);
}

function getArcPromptText(key) {
    return getCachedArcPromptText(key, stmbSettings);
}

function getDefaultArcPromptKey() {
    const configuredKey = String(getModuleSettings().defaultArcPromptKey || '').trim();
    return selectConsolidationDefaultPresetKey(configuredKey, listArcPromptPresets()) || DEFAULT_ARC_PROMPT_KEY;
}

function setDefaultArcPromptKey(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || isRegenerationOnlyPreset(normalizedKey) || !listArcPromptPresets().some(preset => preset.key === normalizedKey)) {
        throw new Error('Select a consolidation preset first');
    }
    stmbSettings.moduleSettings.defaultArcPromptKey = normalizedKey;
    stmbSettings = normalizeStmbSettings(stmbSettings);
    saveSettingsDebounced();
    return normalizedKey;
}

function buildArcPromptDefaultOptionsHtml(selectedKey = null) {
    const resolvedKey = String(selectedKey || getDefaultArcPromptKey());
    return listArcPromptPresets()
        .filter(preset => !preset.regenerationOnly)
        .map(preset => `<option value="${escapeHtml(preset.key)}" ${preset.key === resolvedKey ? 'selected' : ''}>${escapeHtml(preset.displayName)}</option>`)
        .join('');
}

function refreshArcPromptDefaultSelect(dialog) {
    const select = dialog?.querySelector('#stmb-apm-default-preset');
    if (!select) {
        return;
    }
    select.innerHTML = buildArcPromptDefaultOptionsHtml();
}

async function upsertArcPromptPreset(key, prompt, displayName = null) {
    return await upsertArcPromptPresetFile(key, prompt, displayName);
}

async function duplicateArcPromptPreset(key) {
    return await duplicateArcPromptPresetFile(key);
}

async function removeArcPromptPreset(key) {
    await removeArcPromptPresetFile(key);
}

async function exportArcPromptPresetsJson() {
    return await exportArcPromptPresetsJsonFile();
}

async function importArcPromptPresetsJson(text) {
    await importArcPromptPresetsJsonFile(text);
}

function buildSummaryPromptManagerRowsHtml(presets, selectedPresetKey = null) {
    if (!Array.isArray(presets) || presets.length === 0) {
        return `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th data-i18n="STMemoryBooks_PromptManager_DisplayName">Display Name</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>
                            <div class="opacity50p" data-i18n="STMemoryBooks_PromptManager_NoPresets">No presets available</div>
                        </td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    return `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th data-i18n="STMemoryBooks_PromptManager_DisplayName">Display Name</th>
                </tr>
            </thead>
            <tbody>
                ${presets.map(preset => `
                    <tr data-preset-key="${escapeHtml(preset.key)}" style="cursor: pointer; border-bottom: 1px solid var(--SmartThemeBorderColor); ${preset.key === selectedPresetKey ? 'background-color: var(--cobalt30a);' : ''}">
                        <td style="padding: 8px;">
                            <span class="stmb-preset-name">${escapeHtml(preset.displayName)}</span>
                            <span class="stmb-inline-actions textAlignRight whitespacenowrap" style="float: right; display: inline-flex; align-items:center; gap: 10px; flex-wrap: nowrap;">
                            <button class="menu_button stmb-action stmb-action-edit whitespacenowrap" data-action="edit" title="Edit" aria-label="Edit" data-i18n="[title]STMemoryBooks_Edit;[aria-label]STMemoryBooks_Edit" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            ${preset.regenerationOnly ? '' : `<button class="menu_button stmb-action stmb-action-duplicate whitespacenowrap" data-action="duplicate" title="Duplicate" aria-label="Duplicate" data-i18n="[title]STMemoryBooks_Duplicate;[aria-label]STMemoryBooks_Duplicate" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
                                <i class="fa-solid fa-copy"></i>
                            </button>`}
                            <button class="menu_button stmb-action stmb-action-delete whitespacenowrap" data-action="delete" title="Delete" aria-label="Delete" data-i18n="[title]STMemoryBooks_Delete;[aria-label]STMemoryBooks_Delete" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                            </span>
                            ${preset.regenerationOnly ? '<small class="opacity70p" style="display:block;margin-top:4px;">Used only by the lorebook editor Regenerate action.</small>' : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function getPersistedSummaryPromptManagerTarget(targetProfileIndex = null) {
    const normalizedIndex = Number(targetProfileIndex);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) {
        return null;
    }
    const profile = stmbSettings.profiles?.[normalizedIndex];
    if (!profile) {
        return null;
    }
    return {
        profile,
        profileIndex: normalizedIndex,
    };
}

function refreshSummaryPromptManagerList(dialog, selectedPresetKey = null, targetProfileIndex = null) {
    if (!dialog) {
        return;
    }
    const searchTerm = String(dialog.querySelector('#stmb-prompt-search')?.value || '').trim().toLowerCase();
    const presets = listSummaryPromptPresets().filter(preset => !searchTerm || preset.displayName.toLowerCase().includes(searchTerm));
    const list = dialog.querySelector('#stmb-preset-list');
    if (list) {
        list.innerHTML = buildSummaryPromptManagerRowsHtml(presets, selectedPresetKey);
        try {
            applyLocale(list);
        } catch {
            // noop
        }
    }
    const applyButton = dialog.querySelector('#stmb-pm-apply');
    if (applyButton) {
        const resolvedTarget = getPersistedSummaryPromptManagerTarget(targetProfileIndex);
        applyButton.disabled = !selectedPresetKey || !resolvedTarget;
        if (resolvedTarget) {
            applyButton.removeAttribute('title');
        } else {
            applyButton.title = 'Save the profile first to apply a preset';
        }
    }
}

async function openSummaryPromptEditPopup({ presetKey = null, duplicate = false } = {}) {
    const sourceKey = presetKey ? String(presetKey) : null;
    const sourcePrompt = sourceKey ? getSummaryPromptText(sourceKey) : '';
    const sourceDisplayName = sourceKey ? getSummaryPromptDisplayName(sourceKey) : '';
    const defaultDisplayName = duplicate
        ? `${sourceDisplayName} (Copy)`
        : (sourceDisplayName || 'My Custom Preset');
    const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-summary-prompt-editor">
            <h3 data-i18n="${sourceKey ? (duplicate ? 'STMemoryBooks_DuplicatePresetTitle' : 'STMemoryBooks_EditPresetTitle') : 'STMemoryBooks_CreateNewPresetTitle'}">${escapeHtml(sourceKey ? (duplicate ? translate('Duplicate Preset', 'STMemoryBooks_DuplicatePresetTitle') : translate('Edit Preset', 'STMemoryBooks_EditPresetTitle')) : translate('Create New Preset', 'STMemoryBooks_CreateNewPresetTitle'))}</h3>
            <div class="world_entry_form_control">
                <label for="stmb-pm-edit-display-name">
                    <h4 data-i18n="STMemoryBooks_DisplayNameTitle">Display Name:</h4>
                    <input id="stmb-pm-edit-display-name" class="text_pole" value="${escapeHtml(defaultDisplayName)}" data-i18n="[placeholder]STMemoryBooks_MyCustomPreset" placeholder="${escapeHtml(translate('My Custom Preset', 'STMemoryBooks_MyCustomPreset'))}">
                </label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-pm-edit-prompt">
                    <h4 data-i18n="STMemoryBooks_PromptTitle">Prompt:</h4>
                    <i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="stmb-pm-edit-prompt" title="Expand the editor" data-i18n="[title]STMemoryBooks_ExpandEditor"></i>
                    <textarea id="stmb-pm-edit-prompt" class="text_pole textarea_compact" rows="10" data-i18n="[placeholder]STMemoryBooks_EnterPromptPlaceholder" placeholder="${escapeHtml(translate('Enter your prompt here...', 'STMemoryBooks_EnterPromptPlaceholder'))}">${escapeHtml(sourcePrompt)}</textarea>
                </label>
            </div>
        </div>
    `), POPUP_TYPE.TEXT, '', withGoBackButton({
        okButton: sourceKey && !duplicate ? translate('Save', 'STMemoryBooks_Save') : translate('Create', 'STMemoryBooks_Create'),
        cancelButton: translate('Cancel', 'STMemoryBooks_Cancel'),
    }));
    try {
        applyLocale(popup.dlg);
    } catch {
        // noop
    }

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    const displayName = String(popup.dlg?.querySelector('#stmb-pm-edit-display-name')?.value || '').trim();
    const prompt = String(popup.dlg?.querySelector('#stmb-pm-edit-prompt')?.value || '').trim();
    if (!prompt) {
        throw new Error(translate('Prompt cannot be empty', 'STMemoryBooks_PromptCannotBeEmpty'));
    }

    const nextKey = duplicate ? null : sourceKey;
    return await upsertSummaryPromptPreset(nextKey, prompt, displayName || null);
}

async function openArcPromptEditPopup({ presetKey = null, duplicate = false } = {}) {
    const sourceKey = presetKey ? String(presetKey) : null;
    const sourcePrompt = sourceKey ? getArcPromptText(sourceKey) : '';
    const sourceDisplayName = sourceKey ? getArcPromptDisplayName(sourceKey) : '';
    const defaultDisplayName = duplicate
        ? `${sourceDisplayName} (Copy)`
        : (sourceDisplayName || 'My Consolidation Preset');
    const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-arc-prompt-editor">
            <h3>${sourceKey ? (duplicate ? 'Duplicate Consolidation Preset' : 'Edit Consolidation Preset') : 'Create New Consolidation Preset'}</h3>
            <div class="world_entry_form_control">
                <label for="stmb-apm-edit-display-name">Display Name</label>
                <input id="stmb-apm-edit-display-name" class="text_pole" value="${escapeHtml(defaultDisplayName)}">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-apm-edit-prompt">Prompt</label>
                <textarea id="stmb-apm-edit-prompt" class="text_pole textarea_compact" rows="12">${escapeHtml(sourcePrompt)}</textarea>
            </div>
        </div>
    `), POPUP_TYPE.TEXT, '', withGoBackButton({
        okButton: sourceKey && !duplicate ? 'Save' : 'Create',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }));

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    const displayName = String(popup.dlg?.querySelector('#stmb-apm-edit-display-name')?.value || '').trim();
    const prompt = String(popup.dlg?.querySelector('#stmb-apm-edit-prompt')?.value || '').trim();
    if (!prompt) {
        throw new Error('Prompt cannot be empty');
    }

    const nextKey = duplicate ? null : sourceKey;
    return await upsertArcPromptPreset(nextKey, prompt, displayName || null);
}

async function applySummaryPromptPresetToSelectedProfile(presetKey, targetProfileIndex = null) {
    if (!presetKey) {
        throw new Error(translate('Select a preset first', 'STMemoryBooks_SelectPresetFirst'));
    }
    const target = getPersistedSummaryPromptManagerTarget(targetProfileIndex);
    if (!target) {
        throw new Error('Save the profile before applying a preset');
    }
    const { profile } = target;
    if (!profile) {
        throw new Error(translate('Selected profile not found', 'STMemoryBooks_SelectedProfileNotFound'));
    }
    profile.preset = String(presetKey);
    stmbSettings = normalizeStmbSettings(stmbSettings);
    saveSettingsDebounced();
    return true;
}

async function showSummaryPromptManagerPopup({ onChange = null, targetProfileIndex = null } = {}) {
    try {
        await firstRunInitSummaryPromptPresets(stmbSettings);
        let selectedPresetKey = null;
        const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-summary-prompt-manager">
            <h3 data-i18n="STMemoryBooks_PromptManager_Title">${escapeHtml(translate('🧩 Summary Prompt Manager', 'STMemoryBooks_PromptManager_Title'))}</h3>
            <div class="world_entry_form_control">
                <p data-i18n="STMemoryBooks_PromptManager_Desc">${escapeHtml(translate('Manage your summary generation prompts. All presets are editable.', 'STMemoryBooks_PromptManager_Desc'))}</p>
            </div>
            <div class="world_entry_form_control">
                <input type="text" id="stmb-prompt-search" class="text_pole" placeholder="${escapeHtml(translate('Search presets...', 'STMemoryBooks_PromptManager_Search'))}" aria-label="${escapeHtml(translate('Search presets...', 'STMemoryBooks_PromptManager_Search'))}" data-i18n="[placeholder]STMemoryBooks_PromptManager_Search;[aria-label]STMemoryBooks_PromptManager_Search">
            </div>
            <div id="stmb-preset-list" class="padding10 marginBot10" style="max-height: 400px; overflow-y: auto;"></div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-pm-new" class="menu_button whitespacenowrap" data-i18n="STMemoryBooks_PromptManager_New">${escapeHtml(translate('➕ New Preset', 'STMemoryBooks_PromptManager_New'))}</button>
                <button id="stmb-pm-export" class="menu_button whitespacenowrap" data-i18n="STMemoryBooks_PromptManager_Export">${escapeHtml(translate('📤 Export JSON', 'STMemoryBooks_PromptManager_Export'))}</button>
                <button id="stmb-pm-import" class="menu_button whitespacenowrap" data-i18n="STMemoryBooks_PromptManager_Import">${escapeHtml(translate('📥 Import JSON', 'STMemoryBooks_PromptManager_Import'))}</button>
                <button id="stmb-pm-recreate-builtins" class="menu_button whitespacenowrap" data-i18n="STMemoryBooks_PromptManager_RecreateBuiltins">${escapeHtml(translate('♻️ Recreate Built-in Prompts', 'STMemoryBooks_PromptManager_RecreateBuiltins'))}</button>
                <button id="stmb-pm-apply" class="menu_button whitespacenowrap" disabled data-i18n="STMemoryBooks_PromptManager_ApplyToProfile">${escapeHtml(translate('✅ Apply to Selected Profile', 'STMemoryBooks_PromptManager_ApplyToProfile'))}</button>
            </div>
            <small>${escapeHtml(translate('💡 When creating a new prompt, copy one of the other built-in prompts and then amend it. Don\'t change the "respond with JSON" instructions, 📕Memory Books uses that to process the returned result from the AI.', 'STMemoryBooks_PromptManager_Hint'))}</small>
            <input type="file" id="stmb-pm-import-file" accept=".json" style="display:none">
        </div>
        `), POPUP_TYPE.TEXT, '', withGoBackButton({
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            okButton: false,
            cancelButton: translate('Close', 'STMemoryBooks_Close'),
        }));
        try {
            applyLocale(popup.dlg);
        } catch {
            // noop
        }

        const notifyChange = async change => {
            if (typeof onChange === 'function') {
                await onChange(change);
            }
        };
        const reopenManager = async () => {
            popup.completeAffirmative();
            await showSummaryPromptManagerPopup({ onChange, targetProfileIndex });
        };

        popup.dlg?.addEventListener('click', async event => {
            const actionButton = event.target.closest('.stmb-action');
            if (actionButton) {
                const row = actionButton.closest('tr[data-preset-key]');
                selectedPresetKey = String(row?.dataset?.presetKey || '');
                try {
                    if (actionButton.classList.contains('stmb-action-edit')) {
                        const savedKey = await openSummaryPromptEditPopup({ presetKey: selectedPresetKey });
                        if (savedKey) {
                            toastr.success(translate('Preset updated successfully', 'STMemoryBooks_PresetUpdatedSuccessfully'), 'Memory Books');
                            await notifyChange();
                            await reopenManager();
                        }
                    } else if (actionButton.classList.contains('stmb-action-duplicate')) {
                        await duplicateSummaryPromptPreset(selectedPresetKey);
                        toastr.success(translate('Preset duplicated successfully', 'STMemoryBooks_PresetDuplicatedSuccessfully'), 'Memory Books');
                        await notifyChange();
                        await reopenManager();
                    } else if (actionButton.classList.contains('stmb-action-delete')) {
                        const displayName = getSummaryPromptDisplayName(selectedPresetKey);
                        const confirmPopup = new Popup(
                            `<h3 data-i18n="STMemoryBooks_DeletePresetTitle">${escapeHtml(translate('Delete Preset', 'STMemoryBooks_DeletePresetTitle'))}</h3><p>${escapeHtml(translate('Are you sure you want to delete "{{name}}"?', 'STMemoryBooks_DeletePresetConfirm').replace('{{name}}', displayName))}</p>`,
                            POPUP_TYPE.CONFIRM,
                            '',
                            {
                                okButton: translate('Delete', 'STMemoryBooks_Delete'),
                                cancelButton: translate('Cancel', 'STMemoryBooks_Cancel'),
                            },
                        );
                        try {
                            applyLocale(confirmPopup.dlg);
                        } catch {
                            // noop
                        }
                        const confirm = await confirmPopup.show();
                        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
                            return;
                        }
                        await removeSummaryPromptPreset(selectedPresetKey);
                        toastr.success(translate('Preset deleted successfully', 'STMemoryBooks_PresetDeletedSuccessfully'), 'Memory Books');
                        await notifyChange();
                        await reopenManager();
                    }
                } catch (error) {
                    toastr.error(error?.message || translate('Prompt manager action failed', 'STMemoryBooks_PromptManagerActionFailed'), 'Memory Books');
                }
                return;
            }

            const row = event.target.closest('tr[data-preset-key]');
            if (row) {
                selectedPresetKey = String(row.dataset.presetKey || '');
                refreshSummaryPromptManagerList(popup.dlg, selectedPresetKey, targetProfileIndex);
                return;
            }

            if (event.target.closest('#stmb-pm-new')) {
                try {
                    selectedPresetKey = await openSummaryPromptEditPopup({});
                    if (selectedPresetKey) {
                        toastr.success(translate('Preset created successfully', 'STMemoryBooks_PresetCreatedSuccessfully'), 'Memory Books');
                        await notifyChange();
                        await reopenManager();
                    }
                } catch (error) {
                    toastr.error(error?.message || translate('Failed to create preset', 'STMemoryBooks_FailedToCreatePreset'), 'Memory Books');
                }
                return;
            }

            if (event.target.closest('#stmb-pm-export')) {
                try {
                    const blob = new Blob([await exportSummaryPromptPresetsJson()], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'stmb-summary-prompts.json';
                    link.click();
                    URL.revokeObjectURL(url);
                    toastr.success(translate('Prompts exported successfully', 'STMemoryBooks_PromptsExportedSuccessfully'), 'Memory Books');
                } catch (error) {
                    toastr.error(error?.message || translate('Failed to export prompts', 'STMemoryBooks_FailedToExportPrompts'), 'Memory Books');
                }
                return;
            }

            if (event.target.closest('#stmb-pm-import')) {
                popup.dlg?.querySelector('#stmb-pm-import-file')?.click();
                return;
            }

            if (event.target.closest('#stmb-pm-recreate-builtins')) {
                try {
                    const confirmPopup = new Popup(`
                    <h3>${escapeHtml(translate('Recreate Built-in Prompts', 'STMemoryBooks_RecreateBuiltinsTitle'))}</h3>
                    <div class="info-block warning">
                        ${escapeHtml(translate('This will remove overrides for all built-in presets (summary, summarize, synopsis, sumup, minimal, northgate, aelemar, comprehensive). Any customizations to these built-ins will be lost. After this, built-ins will follow the current app locale.', 'STMemoryBooks_RecreateBuiltinsWarning'))}
                    </div>
                    <p class="opacity70p">${escapeHtml(translate('This does not affect your other custom presets.', 'STMemoryBooks_RecreateBuiltinsDoesNotAffectCustom'))}</p>
                `, POPUP_TYPE.CONFIRM, '', {
                        okButton: translate('Overwrite', 'STMemoryBooks_RecreateBuiltinsOverwrite'),
                        cancelButton: translate('Cancel', 'STMemoryBooks_Cancel'),
                    });
                    try {
                        applyLocale(confirmPopup.dlg);
                    } catch {
                        // noop
                    }
                    const confirm = await confirmPopup.show();
                    if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
                        return;
                    }
                    const result = await recreateBuiltInSummaryPromptOverrides();
                    toastr.success(`Recreated ${result.replaced || 0} built-in prompt overrides`, 'Memory Books');
                    await notifyChange();
                    await reopenManager();
                } catch (error) {
                    toastr.error(error?.message || translate('Failed to recreate built-in prompts', 'STMemoryBooks_FailedToRecreateBuiltins'), 'Memory Books');
                }
                return;
            }

            if (event.target.closest('#stmb-pm-apply')) {
                try {
                    const applied = await applySummaryPromptPresetToSelectedProfile(selectedPresetKey, targetProfileIndex);
                    if (applied) {
                        toastr.success(translate('Preset applied to profile', 'STMemoryBooks_PresetAppliedToProfile'), 'Memory Books');
                        await notifyChange({
                            type: 'apply',
                            presetKey: selectedPresetKey,
                            targetProfileIndex,
                        });
                    }
                } catch (error) {
                    toastr.error(error?.message || translate('Failed to apply preset', 'STMemoryBooks_FailedToApplyPreset'), 'Memory Books');
                }
            }
        });

        popup.dlg?.querySelector('#stmb-prompt-search')?.addEventListener('input', () => {
            refreshSummaryPromptManagerList(popup.dlg, selectedPresetKey, targetProfileIndex);
        });

        popup.dlg?.querySelector('#stmb-pm-import-file')?.addEventListener('change', async event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) {
                return;
            }
            try {
                await importSummaryPromptPresetsJson(await file.text());
                toastr.success(translate('Prompts imported successfully', 'STMemoryBooks_PromptsImportedSuccessfully'), 'Memory Books');
                await notifyChange();
                await reopenManager();
            } catch (error) {
                toastr.error(error?.message ? `${translate('Failed to import prompts', 'STMemoryBooks_FailedToImportPrompts')}: ${error.message}` : translate('Failed to import prompts', 'STMemoryBooks_FailedToImportPrompts'), 'Memory Books');
            }
        });

        refreshSummaryPromptManagerList(popup.dlg, selectedPresetKey, targetProfileIndex);
        try {
            applyLocale(popup.dlg);
        } catch {
            // noop
        }
        await popup.show();
    } catch (error) {
        console.error('Memory Books: Error showing prompt manager:', error);
        toastr.error(translate('Failed to open Summary Prompt Manager', 'STMemoryBooks_FailedToOpenSummaryPromptManager'), 'Memory Books');
    }
}

function refreshArcPromptManagerList(dialog, selectedPresetKey = null) {
    if (!dialog) {
        return;
    }
    const searchTerm = String(dialog.querySelector('#stmb-apm-search')?.value || '').trim().toLowerCase();
    const presets = listArcPromptPresets().filter(preset => !searchTerm || preset.displayName.toLowerCase().includes(searchTerm));
    const list = dialog.querySelector('#stmb-apm-list');
    if (list) {
        list.innerHTML = buildSummaryPromptManagerRowsHtml(presets, selectedPresetKey);
    }
}

async function showArcPromptManagerPopup({ onChange = null } = {}) {
    await firstRunInitArcPromptPresets(stmbSettings);
    let selectedPresetKey = null;
    const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-arc-prompt-manager">
            <h3>Consolidation Prompt Manager</h3>
            <div class="world_entry_form_control">
                <p>Manage your consolidation analysis prompts. All presets are editable.</p>
            </div>
            <div class="world_entry_form_control">
                <input type="text" id="stmb-apm-search" class="text_pole" placeholder="Search consolidation presets..." aria-label="Search consolidation presets">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-apm-default-preset">Set Default</label>
                <select id="stmb-apm-default-preset" class="text_pole" style="width:100%">
                    ${buildArcPromptDefaultOptionsHtml()}
                </select>
                <small>Used as the default preset for Consolidate Memories and auto-consolidation.</small>
            </div>
            <div id="stmb-apm-list" class="padding10 marginBot10" style="max-height: 400px; overflow-y: auto;"></div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-apm-new" class="menu_button whitespacenowrap">New Consolidation Preset</button>
                <button id="stmb-apm-export" class="menu_button whitespacenowrap">Export JSON</button>
                <button id="stmb-apm-import" class="menu_button whitespacenowrap">Import JSON</button>
                <button id="stmb-apm-recreate-builtins" class="menu_button whitespacenowrap">Recreate Built-in Consolidation Prompts</button>
            </div>
            <small>These presets are used by Consolidate Memories and auto-consolidation.</small>
            <input type="file" id="stmb-apm-import-file" accept=".json" style="display:none">
        </div>
    `), POPUP_TYPE.TEXT, '', withGoBackButton({
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: 'Close',
    }));

    const notifyChange = async () => {
        try {
            window.dispatchEvent(new CustomEvent('stmb-arc-presets-updated'));
        } catch {
            // noop
        }
        if (typeof onChange === 'function') {
            await onChange();
        }
    };

    popup.dlg?.addEventListener('click', async event => {
        const actionButton = event.target.closest('.stmb-action');
        if (actionButton) {
            const row = actionButton.closest('tr[data-preset-key]');
            selectedPresetKey = String(row?.dataset?.presetKey || '');
            try {
                if (actionButton.classList.contains('stmb-action-edit')) {
                    const savedKey = await openArcPromptEditPopup({ presetKey: selectedPresetKey });
                    if (!savedKey) {
                        return;
                    }
                    toastr.success('Consolidation preset updated successfully', 'STMB');
                } else if (actionButton.classList.contains('stmb-action-duplicate')) {
                    await duplicateArcPromptPreset(selectedPresetKey);
                    toastr.success('Consolidation preset duplicated successfully', 'STMB');
                } else if (actionButton.classList.contains('stmb-action-delete')) {
                    const confirm = await Popup.show.confirm('Delete Consolidation Preset', `Are you sure you want to delete "${escapeHtml(getArcPromptDisplayName(selectedPresetKey))}"?`);
                    if (!confirm) {
                        return;
                    }
                    const wasDefault = selectedPresetKey === getDefaultArcPromptKey();
                    await removeArcPromptPreset(selectedPresetKey);
                    if (wasDefault && !listArcPromptPresets().some(preset => preset.key === selectedPresetKey)) {
                        setDefaultArcPromptKey(DEFAULT_ARC_PROMPT_KEY);
                    }
                    toastr.success('Consolidation preset deleted successfully', 'STMB');
                    selectedPresetKey = null;
                }
                refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
                refreshArcPromptDefaultSelect(popup.dlg);
                await notifyChange();
            } catch (error) {
                toastr.error(error?.message || 'Consolidation prompt manager action failed', 'STMB');
            }
            return;
        }

        const row = event.target.closest('tr[data-preset-key]');
        if (row) {
            selectedPresetKey = String(row.dataset.presetKey || '');
            refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
            return;
        }

        if (event.target.closest('#stmb-apm-new')) {
            try {
                selectedPresetKey = await openArcPromptEditPopup({});
                if (selectedPresetKey) {
                    toastr.success('Consolidation preset created successfully', 'STMB');
                    refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
                    refreshArcPromptDefaultSelect(popup.dlg);
                    await notifyChange();
                }
            } catch (error) {
                toastr.error(error?.message || 'Failed to create consolidation preset', 'STMB');
            }
            return;
        }

        if (event.target.closest('#stmb-apm-export')) {
            try {
                const blob = new Blob([await exportArcPromptPresetsJson()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'stmb-arc-prompts.json';
                link.click();
                URL.revokeObjectURL(url);
                toastr.success('Consolidation prompts exported successfully', 'STMB');
            } catch (error) {
                toastr.error(error?.message || 'Failed to export consolidation prompts', 'STMB');
            }
            return;
        }

        if (event.target.closest('#stmb-apm-import')) {
            popup.dlg?.querySelector('#stmb-apm-import-file')?.click();
            return;
        }

        if (event.target.closest('#stmb-apm-recreate-builtins')) {
            const confirm = await Popup.show.confirm(
                'Recreate Built-in Consolidation Prompts',
                'This overwrites all built-in consolidation presets in your prompt file. Custom presets are not affected.',
            );
            if (!confirm) {
                return;
            }
            const result = await recreateBuiltInArcPromptOverridesFile();
            selectedPresetKey = null;
            refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
            refreshArcPromptDefaultSelect(popup.dlg);
            toastr.success(`Recreated ${result.replaced} built-in consolidation prompt overrides`, 'STMB');
            await notifyChange();
        }
    });

    popup.dlg?.querySelector('#stmb-apm-default-preset')?.addEventListener('change', async event => {
        try {
            const selectedKey = setDefaultArcPromptKey(event.target?.value);
            refreshArcPromptDefaultSelect(popup.dlg);
            toastr.success(`Default consolidation preset set to "${getArcPromptDisplayName(selectedKey)}"`, 'STMB');
            await notifyChange();
        } catch (error) {
            refreshArcPromptDefaultSelect(popup.dlg);
            toastr.error(error?.message || 'Failed to set default consolidation preset', 'STMB');
        }
    });

    popup.dlg?.querySelector('#stmb-apm-search')?.addEventListener('input', () => {
        refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
    });

    popup.dlg?.querySelector('#stmb-apm-import-file')?.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        try {
            await importArcPromptPresetsJson(await file.text());
            selectedPresetKey = null;
            refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
            refreshArcPromptDefaultSelect(popup.dlg);
            toastr.success('Consolidation prompts imported successfully', 'STMB');
            await notifyChange();
        } catch (error) {
            toastr.error(error?.message || 'Failed to import consolidation prompts', 'STMB');
        }
    });

    refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
    await popup.show();
}

function getSidePromptTriggerBadges(template) {
    const badges = [];
    if (template?.enabled) {
        badges.push('Enabled');
    }
    if (template?.triggers?.onInterval && Number(template.triggers.onInterval.visibleMessages) >= 1) {
        badges.push(`Interval:${Math.max(1, Number(template.triggers.onInterval.visibleMessages))}`);
    }
    if (template?.triggers?.onAfterMemory?.enabled) {
        badges.push('AfterMemory');
    }
    if (isManualSidePromptEnabled(template)) {
        badges.push('Manual');
    }
    return badges;
}

function getSidePromptMacroToastOptions() {
    return {
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: true,
        closeButton: true,
    };
}

function formatStrippedSidePromptTriggerLabel(triggerKey) {
    if (triggerKey === 'onInterval') {
        return 'Run on visible message interval';
    }
    if (triggerKey === 'onAfterMemory') {
        return 'Run automatically after memory';
    }
    return String(triggerKey || '');
}

function showSidePromptRuntimeMacroImportNormalizationToast(strippedDetails) {
    if (!Array.isArray(strippedDetails) || strippedDetails.length === 0) {
        return;
    }

    const details = strippedDetails
        .map(({ name, triggers }) => `"${String(name || 'Untitled Side Prompt')}" (${Array.isArray(triggers) ? triggers.map(formatStrippedSidePromptTriggerLabel).join(', ') : ''})`)
        .join('; ');

    toastr.warning(
        `Stripped automatic triggers from imported side prompts because they contain custom runtime macros: ${details}.`,
        'STMB',
        getSidePromptMacroToastOptions(),
    );
}

function isStandardSidePromptKeywordMacro(token) {
    const unresolved = extractMacroTokens(applySidePromptMacros(String(token || '')));
    return !unresolved.includes(token);
}

function validateSidePromptKeywordsMacroConfig({ prompt, responseFormat, keywordsTemplate }) {
    const normalizedKeywords = String(keywordsTemplate || '').trim();
    if (!normalizedKeywords) {
        return { ok: true };
    }

    const allowedMacros = new Set([
        ...extractMacroTokens(prompt),
        ...extractMacroTokens(responseFormat),
    ]);
    const disallowedMacros = extractMacroTokens(normalizedKeywords).filter(token => !allowedMacros.has(token) && !isStandardSidePromptKeywordMacro(token));
    if (disallowedMacros.length === 0) {
        return { ok: true };
    }

    toastr.error(
        `Lorebook Entry Keywords may only use ST standard macros or macros already defined in Prompt or Response Format: ${disallowedMacros.join(', ')}.`,
        'STMB',
    );
    return { ok: false, disallowedMacros };
}

function validateSidePromptRuntimeMacroTriggerConfig({ name, prompt, responseFormat, titleOverride, intervalOn, afterOn }) {
    const runtimeMacros = collectTemplateRuntimeMacros({
        prompt,
        responseFormat,
        settings: {
            lorebook: {
                entryTitleOverride: String(titleOverride || ''),
            },
        },
    });
    if (runtimeMacros.length === 0) {
        return { runtimeMacros, strippedAutoTriggers: [] };
    }

    const strippedAutoTriggers = [];
    if (intervalOn) strippedAutoTriggers.push('Run on visible message interval');
    if (afterOn) strippedAutoTriggers.push('Run automatically after memory');
    if (strippedAutoTriggers.length > 0) {
        const displayName = String(name || 'Untitled Side Prompt');
        const usage = `/sideprompt "${displayName}" ${runtimeMacros.map(token => `${token}="value"`).join(' ')}`;
        toastr.warning(
            `Stripped ${strippedAutoTriggers.join(', ')} from "${displayName}" because it contains custom runtime macros: ${runtimeMacros.join(', ')}. Run it manually with ${usage}.`,
            'STMB',
            getSidePromptMacroToastOptions(),
        );
    }

    return { runtimeMacros, strippedAutoTriggers };
}

function isBuiltinSidePromptKey(key) {
    return ['plotpoints', 'status', 'cast-of-characters', 'assess'].includes(String(key || '').trim());
}

function buildSidePromptManagerRowsHtml(templates, selectedTemplateKey = null) {
    if (!Array.isArray(templates) || templates.length === 0) {
        return `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align:center;">Name</th>
                        <th style="width: 240px; text-align:center;">Triggers</th>
                        <th style="width: 120px; text-align:center;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colspan="3">
                            <div class="opacity50p">No side prompts available</div>
                        </td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    return `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align:center;">Name</th>
                    <th style="width: 240px; text-align:center;">Triggers</th>
                    <th style="width: 120px; text-align:center;">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${templates.map(template => `
                    <tr data-template-key="${escapeHtml(template.key)}" style="cursor: pointer; border-bottom: 1px solid var(--SmartThemeBorderColor); ${template.key === selectedTemplateKey ? 'background-color: var(--cobalt30a);' : ''}">
                        <td style="padding: 8px;">${escapeHtml(template.name || 'Untitled Side Prompt')}</td>
                        <td style="padding: 8px;">
                            ${getSidePromptTriggerBadges(template).length > 0
            ? getSidePromptTriggerBadges(template).map(badge => `<span class="badge" style="margin-right:6px;">${escapeHtml(badge)}</span>`).join('')
            : '<span class="opacity50p">None</span>'}
                        </td>
                        <td style="padding: 8px; text-align:right;">
                            <span class="stmb-sp-inline-actions whitespacenowrap" style="display: inline-flex; gap: 10px;">
                            <button class="menu_button stmb-sp-action stmb-sp-action-edit whitespacenowrap" data-action="edit" title="Edit" aria-label="Edit" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="menu_button stmb-sp-action stmb-sp-action-duplicate whitespacenowrap" data-action="duplicate" title="Duplicate" aria-label="Duplicate" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                            <button class="menu_button stmb-sp-action stmb-sp-action-delete whitespacenowrap" data-action="delete" title="Delete" aria-label="Delete" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0; color:var(--redColor);">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                            </span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function refreshSidePromptManagerList(dialog, selectedTemplateKey = null) {
    if (!dialog) {
        return;
    }

    const searchTerm = String(dialog.querySelector('#stmb-sp-search')?.value || '').trim().toLowerCase();
    const templates = await listTemplates();
    const filtered = templates.filter(template => {
        if (!searchTerm) return true;
        const name = String(template?.name || '').toLowerCase();
        const badges = getSidePromptTriggerBadges(template).join(' ').toLowerCase();
        return name.includes(searchTerm) || badges.includes(searchTerm);
    });

    const list = dialog.querySelector('#stmb-sp-list');
    if (list) {
        list.innerHTML = buildSidePromptManagerRowsHtml(filtered, selectedTemplateKey);
        try {
            applyLocale(list);
        } catch {
            // noop
        }
    }
}

function buildAfterMemorySetModeHtml(sets = []) {
    const hasOverride = hasChatAfterMemorySetOverride();
    const selectedKey = getChatAfterMemorySetKey();
    const hasSelected = selectedKey && sets.some(set => set.key === selectedKey);
    const defaultKey = String((selected_group
        ? getModuleSettings().defaultGroupSidePromptSetKey
        : getModuleSettings().defaultSoloSidePromptSetKey) || '').trim();
    const defaultSet = sets.find(set => set.key === defaultKey);
    const defaultLabel = defaultKey
        ? (defaultSet?.name || `Missing set: ${defaultKey}`)
        : 'individually-enabled side prompts';
    const options = [
        `<option value="inherit" ${!hasOverride ? 'selected' : ''}>Use ${selected_group ? 'group' : 'solo'} default (${escapeHtml(defaultLabel)})</option>`,
        `<option value="individual" ${hasOverride && !selectedKey ? 'selected' : ''}>Use individually-enabled side prompts</option>`,
        ...(hasSelected || !selectedKey ? [] : [`<option value="set:${escapeHtml(selectedKey)}" selected>Missing set: ${escapeHtml(selectedKey)}</option>`]),
        ...sets.map(set => `<option value="set:${escapeHtml(set.key)}" ${hasOverride && selectedKey === set.key ? 'selected' : ''}>${escapeHtml(set.name)}</option>`),
    ].join('');

    return `
        <div class="world_entry_form_control">
            <label for="stmb-sp-after-memory-set-mode">
                <h4>After-memory side prompt mode for this chat</h4>
                <select id="stmb-sp-after-memory-set-mode" class="text_pole">${options}</select>
            </label>
            <small class="opacity70p">A per-chat selection overrides the default configured in General Settings.</small>
        </div>
    `;
}

function buildSidePromptSetsRowsHtml(sets = []) {
    const rows = sets.map(set => `
        <tr data-set-key="${escapeHtml(set.key)}" style="border-bottom: 1px solid var(--SmartThemeBorderColor);">
            <td style="padding: 8px;">${escapeHtml(set.name || 'Untitled Side Prompt Set')}</td>
            <td style="padding: 8px; width: 80px;">${Number(set.items?.length || 0)}</td>
            <td style="padding: 8px; text-align:right; width: 140px;">
                <span class="stmb-sp-inline-actions whitespacenowrap" style="display: inline-flex; gap: 10px;">
                    <button class="menu_button stmb-sp-set-action stmb-sp-set-action-edit whitespacenowrap" title="Edit" aria-label="Edit" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;"><i class="fa-solid fa-pen"></i></button>
                    <button class="menu_button stmb-sp-set-action stmb-sp-set-action-duplicate whitespacenowrap" title="Duplicate" aria-label="Duplicate" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;"><i class="fa-solid fa-copy"></i></button>
                    <button class="menu_button stmb-sp-set-action stmb-sp-set-action-delete whitespacenowrap" title="Delete" aria-label="Delete" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0; color:var(--redColor);"><i class="fa-solid fa-trash"></i></button>
                </span>
            </td>
        </tr>
    `).join('');

    return `
        <div class="world_entry_form_control">
            <h4>Side Prompt Sets</h4>
            <small class="opacity70p">Sets run grouped side prompts manually or as the after-memory mode for this chat.</small>
            <div style="max-height: 220px; overflow-y: auto; margin-top: 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left;">Name</th>
                            <th style="width: 80px; text-align:left;">Items</th>
                            <th style="width: 140px; text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="3"><div class="opacity50p">No side prompt sets available</div></td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap" style="margin-top: 8px;">
                <button id="stmb-sp-new-set" class="menu_button whitespacenowrap">New Set</button>
            </div>
        </div>
    `;
}

async function refreshSidePromptSetControls(dialog) {
    const container = dialog?.querySelector('#stmb-sp-set-controls');
    if (!container) {
        return;
    }
    const sets = await listSets();
    container.innerHTML = buildAfterMemorySetModeHtml(sets) + buildSidePromptSetsRowsHtml(sets);
    try {
        applyLocale(container);
    } catch {
        // noop
    }
}

function buildSetEditorRowHtml(templates = [], item = {}) {
    const rowId = String(item.id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const currentPromptKey = String(item.promptKey || '');
    const hasCurrentTemplate = currentPromptKey
        ? templates.some(template => template.key === currentPromptKey)
        : false;
    const options = [
        '<option value="">Select side prompt...</option>',
        ...(hasCurrentTemplate || !currentPromptKey
            ? []
            : [`<option value="${escapeHtml(currentPromptKey)}" selected>[Missing] ${escapeHtml(currentPromptKey)}</option>`]),
        ...templates.map(template => `<option value="${escapeHtml(template.key)}" ${currentPromptKey === template.key ? 'selected' : ''}>${escapeHtml(template.name || template.key)}</option>`),
    ].join('');
    const macros = JSON.stringify(item.runtimeMacros || {}, null, 2);

    return `
        <tr data-set-item-id="${escapeHtml(rowId)}">
            <td style="padding: 6px; vertical-align: top;">
                <select class="text_pole stmb-sp-set-item-prompt">${options}</select>
            </td>
            <td style="padding: 6px; vertical-align: top;">
                <input class="text_pole stmb-sp-set-item-label" value="${escapeHtml(String(item.label || ''))}" placeholder="Optional entry title label">
            </td>
            <td style="padding: 6px; vertical-align: top;">
                <textarea class="text_pole stmb-sp-set-item-macros" rows="3" placeholder='{"{{topic}}":"value"}'>${escapeHtml(macros)}</textarea>
            </td>
            <td style="padding: 6px; vertical-align: top; text-align:right;">
                <button type="button" class="menu_button stmb-sp-set-item-remove" title="Remove" aria-label="Remove" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0; color:var(--redColor);"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `;
}

function appendSetEditorRow(tbody, templates = [], item = {}) {
    if (!tbody) {
        return;
    }

    const template = document.createElement('template');
    template.innerHTML = DOMPurify.sanitize(`<table><tbody>${buildSetEditorRowHtml(templates, item)}</tbody></table>`);
    const row = template.content.querySelector('tr[data-set-item-id]');
    if (row) {
        tbody.append(row);
    }
}

function buildSidePromptSetEditorHtml(set = null, templates = []) {
    const rows = (set?.items?.length ? set.items : [{}])
        .map(item => buildSetEditorRowHtml(templates, item))
        .join('');
    return `
        <div class="stmb-sideprompt-set-editor-popup" style="max-height: min(72vh, 900px); overflow-y: auto; padding-right: 6px; contain: layout paint;">
            <h3>${set ? 'Edit Side Prompt Set' : 'New Side Prompt Set'}</h3>
            ${set?.key ? `<div class="world_entry_form_control"><small class="opacity50p">Key: <code>${escapeHtml(set.key)}</code></small></div>` : ''}
            <div class="world_entry_form_control">
                <label for="stmb-sp-set-editor-name">
                    <h4>Name:</h4>
                    <input id="stmb-sp-set-editor-name" class="text_pole" value="${escapeHtml(String(set?.name || ''))}" placeholder="My Side Prompt Set">
                </label>
            </div>
            <div class="world_entry_form_control">
                <h4>Set Items</h4>
                <small class="opacity70p">Each row runs one side prompt. Runtime macros are JSON maps such as <code>{"{{topic}}":"trust"}</code>; values may reference macroset inputs.</small>
                <div style="overflow-x:auto; margin-top: 8px;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th style="text-align:left; min-width: 180px;">Side Prompt</th>
                                <th style="text-align:left; min-width: 180px;">Label</th>
                                <th style="text-align:left; min-width: 220px;">Runtime Macros JSON</th>
                                <th style="width: 60px;"></th>
                            </tr>
                        </thead>
                        <tbody id="stmb-sp-set-editor-items">${rows}</tbody>
                    </table>
                </div>
                <div class="buttons_block justifyCenter gap10px whitespacenowrap" style="margin-top: 8px;">
                    <button type="button" id="stmb-sp-set-add-row" class="menu_button whitespacenowrap">Add Row</button>
                </div>
            </div>
        </div>
    `;
}

function findLooseSetEditorControl(promptControl, selector) {
    const start = promptControl.closest('td') && !promptControl.closest('tr[data-set-item-id]')
        ? promptControl.closest('td')
        : promptControl;
    for (let node = start.nextElementSibling; node; node = node.nextElementSibling) {
        if (node.matches('.stmb-sp-set-item-prompt')) {
            return null;
        }
        if (node.matches(selector)) {
            return node;
        }

        const nestedPrompt = node.querySelector('.stmb-sp-set-item-prompt');
        if (nestedPrompt) {
            return null;
        }

        const nested = node.querySelector(selector);
        if (nested) {
            return nested;
        }
    }

    return null;
}

function readSetEditorItemFromPromptControl(promptControl) {
    const row = promptControl.closest('tr[data-set-item-id]');
    const labelControl = row?.querySelector('.stmb-sp-set-item-label')
        || findLooseSetEditorControl(promptControl, '.stmb-sp-set-item-label');
    const macrosControl = row?.querySelector('.stmb-sp-set-item-macros')
        || findLooseSetEditorControl(promptControl, '.stmb-sp-set-item-macros');
    const promptKey = String(promptControl.value || '').trim();
    const label = String(labelControl?.value || '').trim();
    const rawMacros = String(macrosControl?.value || '').trim();
    let runtimeMacros = {};
    if (rawMacros) {
        runtimeMacros = JSON.parse(rawMacros);
        if (!runtimeMacros || typeof runtimeMacros !== 'object' || Array.isArray(runtimeMacros)) {
            throw new Error('Runtime macros must be a JSON object.');
        }
        for (const [token, value] of Object.entries(runtimeMacros)) {
            if (!isValidMacroToken(token)) {
                throw new Error(`Invalid macro token "${token}". Use {{name}} format.`);
            }
            runtimeMacros[token] = String(value ?? '');
        }
    }

    return {
        id: String(row?.dataset.setItemId || '').trim(),
        promptKey,
        label,
        runtimeMacros,
    };
}

function readSetEditorItems(dialog) {
    const tbody = dialog?.querySelector('#stmb-sp-set-editor-items');
    const promptControls = Array.from(tbody?.querySelectorAll('.stmb-sp-set-item-prompt') || []);
    return promptControls
        .map(readSetEditorItemFromPromptControl)
        .filter(item => item.promptKey);
}

export async function openSidePromptSetEditorPopup({ setKey = null } = {}) {
    const set = setKey ? await getSet(setKey) : null;
    if (setKey && !set) {
        throw new Error(`Set "${setKey}" not found`);
    }

    const templates = await listTemplates();
    const popup = new Popup(DOMPurify.sanitize(buildSidePromptSetEditorHtml(set, templates)), POPUP_TYPE.TEXT, '', withGoBackButton({
        okButton: set ? 'Save' : 'Create',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: false,
        onClosing: async popupInstance => {
            if (popupInstance?.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            try {
                const name = String(popupInstance.dlg?.querySelector('#stmb-sp-set-editor-name')?.value || '').trim();
                const items = readSetEditorItems(popupInstance.dlg);
                if (items.length === 0) {
                    throw new Error('Add at least one side prompt to the set.');
                }
                popupInstance.stmbSavedSetKey = await upsertSet({
                    key: set?.key || null,
                    name,
                    items,
                });
                await refreshSidePromptCache();
                window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                return true;
            } catch (error) {
                toastr.error(error?.message || 'Failed to save side prompt set', 'STMB');
                return false;
            }
        },
    }));

    popup.dlg?.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        if (target.closest('#stmb-sp-set-add-row')) {
            const tbody = popup.dlg?.querySelector('#stmb-sp-set-editor-items');
            appendSetEditorRow(tbody, templates, {});
            return;
        }
        const removeButton = target.closest('.stmb-sp-set-item-remove');
        if (removeButton) {
            const row = removeButton.closest('tr[data-set-item-id]');
            row?.remove();
        }
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }
    return popup.stmbSavedSetKey || null;
}

function buildSidePromptProfileOptionsHtml(selectedIndex) {
    return (stmbSettings.profiles || []).map((profile, index) => `
        <option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(getProfileDisplayName(profile))}</option>
    `).join('');
}

function getSidePromptMemoryLorebookName() {
    return getModuleSettings().manualModeEnabled
        ? String(getStmbState().manualLorebook || '').trim()
        : String(chat_metadata?.[METADATA_KEY] || '').trim();
}

function getChatSidePromptLorebookOverrides() {
    const state = getPersistedStmbState();
    return state.sidePromptLorebookOverrides && typeof state.sidePromptLorebookOverrides === 'object'
        ? state.sidePromptLorebookOverrides
        : {};
}

function setChatSidePromptLorebookOverride(templateKey, lorebookName) {
    const key = String(templateKey || '').trim();
    if (!key) {
        return;
    }

    const state = getPersistedStmbState();
    if (!state.sidePromptLorebookOverrides || typeof state.sidePromptLorebookOverrides !== 'object') {
        state.sidePromptLorebookOverrides = {};
    }

    const target = String(lorebookName || '').trim();
    if (target) {
        state.sidePromptLorebookOverrides[key] = target;
    } else {
        delete state.sidePromptLorebookOverrides[key];
        if (Object.keys(state.sidePromptLorebookOverrides).length === 0) {
            delete state.sidePromptLorebookOverrides;
        }
    }
    saveMetadataDebounced();
}

function getChatAfterMemorySetKey() {
    const state = getPersistedStmbState();
    return String(state.sidePromptAfterMemorySetKey || '').trim();
}

function hasChatAfterMemorySetOverride() {
    return Object.hasOwn(getPersistedStmbState(), 'sidePromptAfterMemorySetKey');
}

function setChatAfterMemorySetKey(setKey, { inherit = false } = {}) {
    const state = getPersistedStmbState();
    if (inherit) {
        delete state.sidePromptAfterMemorySetKey;
    } else {
        state.sidePromptAfterMemorySetKey = String(setKey || '').trim();
    }
    saveMetadataDebounced();
}

function getSidePromptLorebookTargetInfo(template = null) {
    const key = String(template?.key || '').trim();
    const chatOverrides = getChatSidePromptLorebookOverrides();
    const hasChatOverride = key && Object.hasOwn(chatOverrides, key);
    const chatOverride = hasChatOverride ? String(chatOverrides[key] || '').trim() : '';
    const templateOverride = String(template?.settings?.lorebook?.targetLorebookName || '').trim();
    const memoryLorebook = getSidePromptMemoryLorebookName();

    if (hasChatOverride && chatOverride === '__memory__') {
        return { value: memoryLorebook, sourceLabel: 'Chat override' };
    }
    if (hasChatOverride && chatOverride && Array.isArray(world_names) && world_names.includes(chatOverride) && !isReservedTemplateWorldName(chatOverride)) {
        return { value: chatOverride, sourceLabel: 'Chat override' };
    }
    if (hasChatOverride) {
        return { value: memoryLorebook, sourceLabel: 'Chat override' };
    }
    if (templateOverride && Array.isArray(world_names) && world_names.includes(templateOverride) && !isReservedTemplateWorldName(templateOverride)) {
        return { value: templateOverride, sourceLabel: 'Side prompt setting' };
    }

    return { value: memoryLorebook, sourceLabel: 'Memory book default' };
}

function getSidePromptLorebookSelectValue(template = null) {
    const key = String(template?.key || '').trim();
    const chatOverrides = getChatSidePromptLorebookOverrides();
    const hasChatOverride = key && Object.hasOwn(chatOverrides, key);
    const chatOverride = hasChatOverride ? String(chatOverrides[key] || '').trim() : '';
    if (hasChatOverride && chatOverride === '__memory__') {
        return '__memory__';
    }
    if (hasChatOverride && chatOverride && Array.isArray(world_names) && world_names.includes(chatOverride) && !isReservedTemplateWorldName(chatOverride)) {
        return chatOverride;
    }
    if (hasChatOverride) {
        return '__memory__';
    }

    const templateOverride = String(template?.settings?.lorebook?.targetLorebookName || '').trim();
    if (templateOverride && Array.isArray(world_names) && world_names.includes(templateOverride) && !isReservedTemplateWorldName(templateOverride)) {
        return templateOverride;
    }

    return '__memory__';
}

function buildSidePromptLorebookTargetHtml(template = null) {
    const targetInfo = getSidePromptLorebookTargetInfo(template);
    const selectedValue = getSidePromptLorebookSelectValue(template);
    const memoryLorebook = getSidePromptMemoryLorebookName();
    const memoryLabel = memoryLorebook
        ? `Same as memory lorebook (${memoryLorebook})`
        : 'Same as memory lorebook (none selected)';
    const options = [
        `<option value="__memory__" ${selectedValue === '__memory__' ? 'selected' : ''}>${escapeHtml(memoryLabel)}</option>`,
        ...((Array.isArray(world_names) ? world_names : []).filter(name => !isReservedTemplateWorldName(name)).map(name => (
            `<option value="${escapeHtml(name)}" ${selectedValue === name ? 'selected' : ''}>${escapeHtml(name)}</option>`
        ))),
    ].join('');

    return `
        <div class="world_entry_form_control">
            <h4>Lorebook Target</h4>
            <div class="info-block">
                <small class="opacity50p">Current Target:</small>
                <h5>${escapeHtml(targetInfo.value || 'None selected')}</h5>
                <small class="opacity50p">Source:</small>
                <h5>${escapeHtml(targetInfo.sourceLabel)}</h5>
            </div>
            <label for="stmb-sp-editor-lorebook-target">
                <h5 style="margin: 8px 0 4px 0;">Save side prompt entry to:</h5>
                <select id="stmb-sp-editor-lorebook-target" class="text_pole" data-original-value="${escapeHtml(selectedValue)}">
                    ${options}
                </select>
            </label>
            <small class="opacity70p">Changing this target will ask whether to save it for this chat only or for this side prompt going forward.</small>
        </div>
    `;
}

async function promptSidePromptLorebookTargetScope() {
    const popup = new Popup(DOMPurify.sanitize(`
        <h3>Save Lorebook Target</h3>
        <p>Save this side prompt lorebook target for this chat only, or for this side prompt going forward?</p>
    `), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Cancel',
        customButtons: [
            { text: 'This chat only', result: POPUP_RESULT.CUSTOM1, appendAtEnd: true },
            { text: 'This side prompt going forward', result: POPUP_RESULT.CUSTOM2, appendAtEnd: true },
        ],
    });
    const result = await popup.show();
    if (result === POPUP_RESULT.CUSTOM1) return 'chat';
    if (result === POPUP_RESULT.CUSTOM2) return 'template';
    return null;
}

function buildSidePromptEditorHtml(template = null, options = {}) {
    const mode = String(options.mode || (template ? 'edit' : 'new'));
    const contextSettings = Array.isArray(options.contextSettings) ? options.contextSettings : [];
    const triggers = template?.triggers && typeof template.triggers === 'object' ? template.triggers : {};
    const settings = template?.settings && typeof template.settings === 'object' ? template.settings : {};
    const lorebook = settings?.lorebook && typeof settings.lorebook === 'object' ? settings.lorebook : {};
    const intervalEnabled = Boolean(triggers.onInterval && Number(triggers.onInterval.visibleMessages) >= 1);
    const intervalValue = intervalEnabled ? Math.max(1, Number(triggers.onInterval.visibleMessages)) : 50;
    const afterMemoryEnabled = Boolean(triggers.onAfterMemory?.enabled);
    const manualEnabled = template ? isManualSidePromptEnabled(template) : true;
    const overrideProfileEnabled = Boolean(settings.overrideProfileEnabled);
    const overrideProfileIndex = Number.isFinite(Number(settings.overrideProfileIndex))
        ? Number(settings.overrideProfileIndex)
        : Number(stmbSettings.defaultProfile ?? 0);
    const previousMemoriesCount = Number.isFinite(Number(settings.previousMemoriesCount))
        ? Math.max(0, Math.min(7, Math.trunc(Number(settings.previousMemoriesCount))))
        : 0;
    const lorebookMode = ['link', 'green', 'blue'].includes(String(lorebook.constVectMode || ''))
        ? String(lorebook.constVectMode)
        : 'link';
    const lorebookPosition = Number.isFinite(Number(lorebook.position)) ? Number(lorebook.position) : 0;
    const manualOrder = String(lorebook.orderMode || 'auto') === 'manual';
    const orderValue = Number.isFinite(Number(lorebook.orderValue)) ? Number(lorebook.orderValue) : 100;

    return `
        <div class="stmb-sideprompt-editor-popup" style="max-height: min(72vh, 900px); overflow-y: auto; padding-right: 6px; contain: layout paint;">
            <h3>${mode === 'new' ? 'New Side Prompt' : 'Edit Side Prompt'}</h3>
            ${template?.key ? `<div class="world_entry_form_control"><small class="opacity50p">Key: <code>${escapeHtml(template.key)}</code></small></div>` : ''}
            <div class="world_entry_form_control">
                <label for="stmb-sp-editor-name">
                    <h4>Name:</h4>
                    <input id="stmb-sp-editor-name" class="text_pole" value="${escapeHtml(String(template?.name || ''))}" placeholder="${template ? '' : 'My Side Prompt'}">
                </label>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-enabled" ${template?.enabled ? 'checked' : ''}> <span>Enabled</span></label>
            </div>
            <div class="world_entry_form_control">
                <h4>Triggers:</h4>
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-trigger-interval" ${intervalEnabled ? 'checked' : ''}> <span>Run on visible message interval</span></label>
                <div id="stmb-sp-editor-interval-container" style="display:${intervalEnabled ? 'block' : 'none'}; margin-left: 28px;">
                    <label for="stmb-sp-editor-interval">
                        <h4 style="margin: 0 0 4px 0;">Interval (visible messages):</h4>
                        <input id="stmb-sp-editor-interval" type="number" min="1" step="1" class="text_pole" value="${escapeHtml(String(intervalValue))}">
                    </label>
                </div>
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-trigger-after-memory" ${afterMemoryEnabled ? 'checked' : ''}> <span>Run automatically after memory</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-trigger-manual" ${manualEnabled ? 'checked' : ''}> <span>Allow manual run via /sideprompt</span></label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-sp-editor-prompt">
                    <h4>Prompt:</h4>
                    <i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="stmb-sp-editor-prompt" title="Expand the editor"></i>
                    <textarea id="stmb-sp-editor-prompt" class="text_pole textarea_compact" rows="10">${escapeHtml(String(template?.prompt || ''))}</textarea>
                </label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-sp-editor-response-format">
                    <h4>Response Format (optional):</h4>
                    <i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="stmb-sp-editor-response-format" title="Expand the editor"></i>
                    <textarea id="stmb-sp-editor-response-format" class="text_pole textarea_compact" rows="6">${escapeHtml(String(template?.responseFormat || ''))}</textarea>
                </label>
            </div>
            <div class="world_entry_form_control">
                <h4 class="stmb-section-title">Lorebook Entry Settings</h4>
                <label for="stmb-sp-editor-title-override">
                    <h5 style="margin: 8px 0 4px 0;">Lorebook Entry Title Override</h5>
                    <small class="opacity70p">Optional. Standard ST macros and required runtime macros are resolved here, and STMB still appends (STMB SidePrompt).</small>
                    <input id="stmb-sp-editor-title-override" class="text_pole" value="${escapeHtml(String(lorebook.entryTitleOverride || ''))}" placeholder="Optional title template (e.g., NPC {{npcname}})">
                </label>
                <label for="stmb-sp-editor-keywords" class="marginTop5">
                    <h5 style="margin: 8px 0 4px 0;">Lorebook Entry Keywords</h5>
                    <small class="opacity70p">Optional. If filled in, these keywords are applied to the upserted lorebook entry. You may only use macros already present in Prompt or Response Format.</small>
                    <input id="stmb-sp-editor-keywords" class="text_pole" value="${escapeHtml(String(lorebook.entryKeywords || ''))}" placeholder="Optional comma-separated keywords" title="You can only use ST standard macros or macros already defined in Prompt or Response Format.">
                </label>
            </div>
            ${buildSidePromptLorebookTargetHtml(template)}
            <div class="world_entry_form_control">
                <div class="flex-container" style="gap:12px; flex-wrap: wrap;">
                    <label>
                        <h5 style="margin: 0 0 4px 0;">Activation Mode</h5>
                        <select id="stmb-sp-editor-lorebook-mode" class="text_pole">
                            <option value="link" ${lorebookMode === 'link' ? 'selected' : ''}>Vectorized</option>
                            <option value="green" ${lorebookMode === 'green' ? 'selected' : ''}>Normal</option>
                            <option value="blue" ${lorebookMode === 'blue' ? 'selected' : ''}>Constant</option>
                        </select>
                    </label>
                    <label>
                        <h5 style="margin: 0 0 4px 0;">Insertion Position:</h5>
                        <select id="stmb-sp-editor-lorebook-position" class="text_pole">
                            <option value="0" ${lorebookPosition === 0 ? 'selected' : ''}>↑Char</option>
                            <option value="1" ${lorebookPosition === 1 ? 'selected' : ''}>↓Char</option>
                            <option value="5" ${lorebookPosition === 5 ? 'selected' : ''}>↑EM</option>
                            <option value="6" ${lorebookPosition === 6 ? 'selected' : ''}>↓EM</option>
                            <option value="2" ${lorebookPosition === 2 ? 'selected' : ''}>↑AN</option>
                            <option value="3" ${lorebookPosition === 3 ? 'selected' : ''}>↓AN</option>
                            <option value="7" ${lorebookPosition === 7 ? 'selected' : ''}>Outlet</option>
                        </select>
                        <div id="stmb-sp-editor-outlet-container" style="display:${lorebookPosition === 7 ? 'block' : 'none'}; margin-top: 8px;">
                            <label for="stmb-sp-editor-outlet-name">
                                <h5 style="margin: 0 0 4px 0;">Outlet Name:</h5>
                                <input id="stmb-sp-editor-outlet-name" class="text_pole" value="${escapeHtml(String(lorebook.outletName || ''))}" placeholder="Outlet name">
                            </label>
                        </div>
                    </label>
                </div>
            </div>
            <div class="world_entry_form_control">
                <h5>Insertion Order:</h5>
                <label class="radio_label"><input type="radio" name="stmb-sp-editor-order-mode" id="stmb-sp-editor-order-auto" value="auto" ${manualOrder ? '' : 'checked'}> <span>Auto (uses memory #)</span></label>
                <label class="radio_label"><input type="radio" name="stmb-sp-editor-order-mode" id="stmb-sp-editor-order-manual" value="manual" ${manualOrder ? 'checked' : ''}> <span>Manual</span></label>
            </div>
            <div id="stmb-sp-editor-order-value-container" class="world_entry_form_control" style="display:${manualOrder ? 'block' : 'none'}">
                <label for="stmb-sp-editor-order-value">
                    <h5>Order Value:</h5>
                    <input id="stmb-sp-editor-order-value" type="number" step="1" class="text_pole" value="${escapeHtml(String(orderValue))}">
                </label>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-prevent-recursion" ${lorebook.preventRecursion !== false ? 'checked' : ''}> <span>Prevent Recursion</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-delay-recursion" ${lorebook.delayUntilRecursion ? 'checked' : ''}> <span>Delay Until Recursion</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-ignore-budget" ${lorebook.ignoreBudget ? 'checked' : ''}> <span>Ignore Budget</span></label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-sp-editor-previous-memories">
                    <h5>Previous memories for context:</h5>
                    <input id="stmb-sp-editor-previous-memories" type="number" min="0" max="7" step="1" class="text_pole" value="${escapeHtml(String(previousMemoriesCount))}">
                </label>
                <small class="opacity70p">Number of previous memory entries to include before scene text (0 = none).</small>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-sp-editor-additional-context">
                    <h5>Additional Context Source:</h5>
                    <select id="stmb-sp-editor-additional-context" class="text_pole">
                        ${buildAdditionalContextSourceOptionsHtml(contextSettings, settings.additionalContext)}
                    </select>
                </label>
            </div>
            <div class="world_entry_form_control">
                <h5>Overrides:</h5>
                <label class="checkbox_label"><input type="checkbox" id="stmb-sp-editor-override-profile-enabled" ${overrideProfileEnabled ? 'checked' : ''}> <span>Override default memory profile</span></label>
            </div>
            <div id="stmb-sp-editor-override-profile-container" class="world_entry_form_control" style="display:${overrideProfileEnabled ? 'block' : 'none'}">
                <label for="stmb-sp-editor-override-profile-index">
                    <h4>Connection Profile:</h4>
                    <select id="stmb-sp-editor-override-profile-index" class="text_pole">
                        ${buildSidePromptProfileOptionsHtml(overrideProfileIndex)}
                    </select>
                </label>
            </div>
        </div>
    `;
}

function attachSidePromptEditorHandlers(dialog) {
    if (!dialog) {
        return;
    }

    const intervalCheckbox = dialog.querySelector('#stmb-sp-editor-trigger-interval');
    const intervalContainer = dialog.querySelector('#stmb-sp-editor-interval-container');
    intervalCheckbox?.addEventListener('change', () => {
        if (intervalContainer) {
            intervalContainer.style.display = intervalCheckbox.checked ? 'block' : 'none';
        }
        if (intervalCheckbox.checked) {
            dialog.querySelector('#stmb-sp-editor-interval')?.focus();
        }
    });

    const overrideCheckbox = dialog.querySelector('#stmb-sp-editor-override-profile-enabled');
    const overrideContainer = dialog.querySelector('#stmb-sp-editor-override-profile-container');
    overrideCheckbox?.addEventListener('change', () => {
        if (overrideContainer) {
            overrideContainer.style.display = overrideCheckbox.checked ? 'block' : 'none';
        }
    });

    const positionSelect = dialog.querySelector('#stmb-sp-editor-lorebook-position');
    const outletContainer = dialog.querySelector('#stmb-sp-editor-outlet-container');
    positionSelect?.addEventListener('change', () => {
        if (outletContainer) {
            outletContainer.style.display = positionSelect.value === '7' ? 'block' : 'none';
        }
    });

    const orderAuto = dialog.querySelector('#stmb-sp-editor-order-auto');
    const orderManual = dialog.querySelector('#stmb-sp-editor-order-manual');
    const orderValueContainer = dialog.querySelector('#stmb-sp-editor-order-value-container');
    const syncOrderVisibility = () => {
        if (orderValueContainer) {
            orderValueContainer.style.display = orderManual?.checked ? 'block' : 'none';
        }
    };
    orderAuto?.addEventListener('change', syncOrderVisibility);
    orderManual?.addEventListener('change', syncOrderVisibility);
}

async function readSidePromptEditorPayload(dialog, template = null) {
    const prompt = String(dialog?.querySelector('#stmb-sp-editor-prompt')?.value || '').trim();
    if (!prompt) {
        throw new Error('Prompt cannot be empty');
    }

    const name = String(dialog?.querySelector('#stmb-sp-editor-name')?.value || '').trim();
    const responseFormat = String(dialog?.querySelector('#stmb-sp-editor-response-format')?.value || '').trim();
    const titleOverride = String(dialog?.querySelector('#stmb-sp-editor-title-override')?.value || '').trim();
    const keywords = String(dialog?.querySelector('#stmb-sp-editor-keywords')?.value || '').trim();
    if (!validateSidePromptKeywordsMacroConfig({ prompt, responseFormat, keywordsTemplate: keywords }).ok) {
        throw new Error('Invalid lorebook entry keywords');
    }
    const intervalRequested = Boolean(dialog?.querySelector('#stmb-sp-editor-trigger-interval')?.checked);
    const afterMemoryRequested = Boolean(dialog?.querySelector('#stmb-sp-editor-trigger-after-memory')?.checked);
    const validation = validateSidePromptRuntimeMacroTriggerConfig({
        name: name || template?.name || 'Untitled Side Prompt',
        prompt,
        responseFormat,
        titleOverride,
        intervalOn: intervalRequested,
        afterOn: afterMemoryRequested,
    });
    const runtimeMacros = validation.runtimeMacros;

    const triggers = {};
    const allowAutoTriggers = runtimeMacros.length === 0;
    if (intervalRequested && allowAutoTriggers) {
        const intervalValue = Math.max(1, Number(dialog?.querySelector('#stmb-sp-editor-interval')?.value || 50));
        triggers.onInterval = { visibleMessages: intervalValue };
    }
    if (afterMemoryRequested && allowAutoTriggers) {
        triggers.onAfterMemory = { enabled: true };
    }
    if (dialog?.querySelector('#stmb-sp-editor-trigger-manual')?.checked || runtimeMacros.length > 0) {
        triggers.commands = ['sideprompt'];
    }

    const previousMemoriesCount = Math.max(0, Math.min(7, Math.trunc(Number(dialog?.querySelector('#stmb-sp-editor-previous-memories')?.value || 0))));
    const position = Number(dialog?.querySelector('#stmb-sp-editor-lorebook-position')?.value || 0);
    const manualOrder = Boolean(dialog?.querySelector('#stmb-sp-editor-order-manual')?.checked);
    const orderValue = Number(dialog?.querySelector('#stmb-sp-editor-order-value')?.value || 100);
    const targetSelect = dialog?.querySelector('#stmb-sp-editor-lorebook-target');
    const selectedTarget = String(targetSelect?.value || '__memory__').trim() || '__memory__';
    const originalTarget = String(targetSelect?.dataset?.originalValue || '__memory__').trim() || '__memory__';
    const targetChanged = selectedTarget !== originalTarget;
    const targetScope = targetChanged ? await promptSidePromptLorebookTargetScope() : null;
    if (targetChanged && !targetScope) {
        throw new Error('__STMB_TARGET_SCOPE_CANCELLED__');
    }
    const selectedTargetName = selectedTarget === '__memory__' ? '' : selectedTarget;
    const existingLorebook = template?.settings?.lorebook && typeof template.settings.lorebook === 'object'
        ? template.settings.lorebook
        : {};
    let targetLorebookName = String(existingLorebook.targetLorebookName || '').trim();
    if (targetChanged && targetScope === 'template') {
        targetLorebookName = selectedTargetName;
    }
    const lorebook = {
        constVectMode: String(dialog?.querySelector('#stmb-sp-editor-lorebook-mode')?.value || 'link'),
        position: Number.isFinite(position) ? position : 0,
        orderMode: manualOrder ? 'manual' : 'auto',
        orderValue: Number.isFinite(orderValue) ? orderValue : 100,
        preventRecursion: Boolean(dialog?.querySelector('#stmb-sp-editor-prevent-recursion')?.checked),
        delayUntilRecursion: Boolean(dialog?.querySelector('#stmb-sp-editor-delay-recursion')?.checked),
        ignoreBudget: Boolean(dialog?.querySelector('#stmb-sp-editor-ignore-budget')?.checked),
    };

    const outletName = String(dialog?.querySelector('#stmb-sp-editor-outlet-name')?.value || '').trim();
    if (position === 7 && !outletName) {
        throw new Error('Outlet Name is required when Insertion Position is Outlet');
    }
    if (position === 7 && outletName) {
        lorebook.outletName = outletName;
    }
    if (titleOverride) {
        lorebook.entryTitleOverride = titleOverride;
    }
    if (keywords) {
        lorebook.entryKeywords = keywords;
    }
    if (targetLorebookName) {
        lorebook.targetLorebookName = targetLorebookName;
    }

    const settings = {
        ...(template?.settings || {}),
        previousMemoriesCount,
        additionalContext: readAdditionalContextSourceSetting(dialog?.querySelector('#stmb-sp-editor-additional-context')),
        overrideProfileEnabled: Boolean(dialog?.querySelector('#stmb-sp-editor-override-profile-enabled')?.checked),
        lorebook,
    };
    if (settings.overrideProfileEnabled) {
        settings.overrideProfileIndex = Number(dialog?.querySelector('#stmb-sp-editor-override-profile-index')?.value || stmbSettings.defaultProfile || 0);
    } else {
        delete settings.overrideProfileIndex;
    }

    return {
        payload: {
            key: template?.key,
            name,
            enabled: Boolean(dialog?.querySelector('#stmb-sp-editor-enabled')?.checked),
            prompt,
            responseFormat,
            settings,
            triggers,
        },
        strippedAutoTriggers: validation.strippedAutoTriggers,
        targetOverride: targetChanged
            ? {
                scope: targetScope,
                value: selectedTarget,
            }
            : null,
    };
}

async function openSidePromptEditorPopup({ templateKey = null } = {}) {
    const template = templateKey ? await getTemplate(templateKey) : null;
    if (templateKey && !template) {
        throw new Error(`Template "${templateKey}" not found`);
    }

    let contextSettings = [];
    try {
        contextSettings = (await listStmbContextSettings()).settings || [];
    } catch (error) {
        console.warn('STMB context settings list failed for side prompt editor', error);
    }

    const popup = new Popup(DOMPurify.sanitize(buildSidePromptEditorHtml(template, {
        mode: template ? 'edit' : 'new',
        contextSettings,
    })), POPUP_TYPE.TEXT, '', withGoBackButton({
        okButton: template ? 'Save' : 'Create',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: false,
        onClosing: async popupInstance => {
            if (popupInstance?.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            try {
                const { payload, strippedAutoTriggers, targetOverride } = await readSidePromptEditorPayload(popupInstance.dlg, template);
                const savedKey = await upsertTemplate(payload);
                if (targetOverride?.scope === 'chat') {
                    setChatSidePromptLorebookOverride(savedKey, targetOverride.value);
                } else if (targetOverride?.scope === 'template') {
                    setChatSidePromptLorebookOverride(savedKey, '');
                }
                popupInstance.stmbSavedKey = savedKey;
                popupInstance.stmbStrippedAutoTriggers = strippedAutoTriggers;
                await refreshSidePromptCache();
                window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                if (!template && payload.name.trim() === '') {
                    toastr.info('No name provided. Using "Untitled Side Prompt".', 'STMB');
                }
                if (template && payload.name.trim() === '') {
                    toastr.info('Name was empty. Keeping previous name.', 'STMB');
                }
                return true;
            } catch (error) {
                if (error?.message === '__STMB_TARGET_SCOPE_CANCELLED__') {
                    return false;
                }
                toastr.error(error?.message || 'Failed to save side prompt', 'STMB');
                return false;
            }
        },
    }));

    attachSidePromptEditorHandlers(popup.dlg);
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    return popup.stmbSavedKey || null;
}

async function showSidePromptManagerPopup({ onChange = null } = {}) {
    let selectedTemplateKey = null;
    const parsedMaxConcurrent = Number(stmbSettings?.moduleSettings?.sidePromptsMaxConcurrent ?? 1);
    const maxConcurrent = Number.isFinite(parsedMaxConcurrent)
        ? Math.max(1, Math.min(5, Math.trunc(parsedMaxConcurrent)))
        : 1;
    const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-sideprompt-manager-popup">
            <h3>Trackers & Side Prompts</h3>
            <div class="world_entry_form_control">
                <p>Create and manage side prompts for trackers and other behind-the-scenes functions.</p>
            </div>
            <div id="stmb-sp-set-controls"></div>
            <div class="world_entry_form_control">
                <input type="text" id="stmb-sp-search" class="text_pole" placeholder="Search side prompts..." aria-label="Search side prompts">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-sp-max-concurrent"><h4>How many concurrent prompts to run at once</h4></label>
                <input type="number" id="stmb-sp-max-concurrent" class="text_pole" min="1" max="5" step="1" value="${escapeHtml(String(maxConcurrent))}">
                <small class="opacity70p">Range 1-5. Defaults to 1. Runtime generation is capped at 2.</small>
            </div>
            <div id="stmb-sp-list" class="padding10 marginBot10" style="max-height: 400px; overflow-y: auto;"></div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-sp-new" class="menu_button whitespacenowrap">New</button>
                <button id="stmb-sp-export" class="menu_button whitespacenowrap">Export JSON</button>
                <button id="stmb-sp-import" class="menu_button whitespacenowrap">Import JSON</button>
                <button id="stmb-sp-compact-review" class="menu_button whitespacenowrap">Compaction</button>
                <button id="stmb-sp-recreate-builtins" class="menu_button whitespacenowrap">Recreate Built-in Side Prompts</button>
            </div>
            <input type="file" id="stmb-sp-import-file" accept=".json" style="display:none">
        </div>
    `), POPUP_TYPE.TEXT, '', withGoBackButton({
        okButton: false,
        cancelButton: 'Close',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }));

    const notifyChange = async () => {
        if (typeof onChange === 'function') {
            await onChange();
        }
    };

    popup.dlg?.querySelector('#stmb-sp-search')?.addEventListener('input', async () => {
        await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
    });

    popup.dlg?.querySelector('#stmb-sp-max-concurrent')?.addEventListener('change', async event => {
        const target = event.target;
        const value = Math.max(1, Math.min(5, Number(target?.value || 1)));
        if (target) {
            target.value = String(value);
        }
        stmbSettings.moduleSettings.sidePromptsMaxConcurrent = value;
        stmbSettings = normalizeStmbSettings(stmbSettings);
        saveSettingsDebounced();
        await notifyChange();
    });

    popup.dlg?.addEventListener('click', async event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const setActionButton = target.closest('.stmb-sp-set-action');
        if (setActionButton) {
            const row = setActionButton.closest('tr[data-set-key]');
            const setKey = String(row?.dataset?.setKey || '');
            try {
                if (setActionButton.classList.contains('stmb-sp-set-action-edit')) {
                    const savedKey = await openSidePromptSetEditorPopup({ setKey });
                    if (!savedKey) return;
                    toastr.success('Side prompt set updated successfully', 'STMB');
                } else if (setActionButton.classList.contains('stmb-sp-set-action-duplicate')) {
                    await duplicateSet(setKey);
                    await refreshSidePromptCache();
                    window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                    toastr.success('Side prompt set duplicated successfully', 'STMB');
                } else if (setActionButton.classList.contains('stmb-sp-set-action-delete')) {
                    const set = await getSet(setKey);
                    const confirmPopup = new Popup(
                        `<h3>Delete Side Prompt Set</h3><p>Delete "${escapeHtml(set?.name || setKey)}"? Chats using this set will run no after-memory side prompts until a new mode is selected.</p>`,
                        POPUP_TYPE.CONFIRM,
                        '',
                        { okButton: 'Delete', cancelButton: 'Cancel' },
                    );
                    const confirmed = await confirmPopup.show();
                    if (confirmed !== POPUP_RESULT.AFFIRMATIVE) {
                        return;
                    }
                    await removeSet(setKey);
                    if (getChatAfterMemorySetKey() === setKey) {
                        setChatAfterMemorySetKey('');
                    }
                    let clearedDefault = false;
                    for (const settingKey of ['defaultSoloSidePromptSetKey', 'defaultGroupSidePromptSetKey']) {
                        if (String(stmbSettings.moduleSettings?.[settingKey] || '').trim() === setKey) {
                            stmbSettings.moduleSettings[settingKey] = '';
                            clearedDefault = true;
                        }
                    }
                    if (clearedDefault) {
                        stmbSettings = normalizeStmbSettings(stmbSettings);
                        saveSettingsDebounced();
                    }
                    await refreshSidePromptCache();
                    window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                    toastr.success('Side prompt set deleted successfully', 'STMB');
                }
                await refreshSidePromptSetControls(popup.dlg);
                await notifyChange();
            } catch (error) {
                toastr.error(error?.message || 'Side prompt set action failed', 'STMB');
            }
            return;
        }

        if (target.closest('#stmb-sp-new-set')) {
            try {
                const savedKey = await openSidePromptSetEditorPopup({});
                if (savedKey) {
                    toastr.success('Side prompt set created successfully', 'STMB');
                    await refreshSidePromptSetControls(popup.dlg);
                    await notifyChange();
                }
            } catch (error) {
                toastr.error(error?.message || 'Failed to create side prompt set', 'STMB');
            }
            return;
        }

        const actionButton = target.closest('.stmb-sp-action');
        if (actionButton) {
            const row = actionButton.closest('tr[data-template-key]');
            selectedTemplateKey = String(row?.dataset?.templateKey || '');
            try {
                if (actionButton.classList.contains('stmb-sp-action-edit')) {
                    const savedKey = await openSidePromptEditorPopup({ templateKey: selectedTemplateKey });
                    if (!savedKey) {
                        return;
                    }
                    toastr.success('Side prompt updated successfully', 'STMB');
                } else if (actionButton.classList.contains('stmb-sp-action-duplicate')) {
                    selectedTemplateKey = await duplicateTemplate(selectedTemplateKey);
                    await refreshSidePromptCache();
                    window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                    toastr.success('Side prompt duplicated successfully', 'STMB');
                } else if (actionButton.classList.contains('stmb-sp-action-delete')) {
                    const templateName = String(row?.querySelector('td')?.textContent || '').trim() || 'this template';
                    const confirmPopup = new Popup(
                        `<h3>Delete Side Prompt</h3><p>Are you sure you want to delete "${escapeHtml(templateName)}"?</p>`,
                        POPUP_TYPE.CONFIRM,
                        '',
                        { okButton: 'Delete', cancelButton: 'Cancel' },
                    );
                    const confirmed = await confirmPopup.show();
                    if (confirmed !== POPUP_RESULT.AFFIRMATIVE) {
                        return;
                    }
                    await removeTemplate(selectedTemplateKey);
                    await refreshSidePromptCache();
                    window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                    selectedTemplateKey = null;
                    toastr.success('Side prompt deleted successfully', 'STMB');
                }
                await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
                await notifyChange();
            } catch (error) {
                toastr.error(error?.message || 'Side prompt manager action failed', 'STMB');
            }
            return;
        }

        const row = target.closest('tr[data-template-key]');
        if (row) {
            selectedTemplateKey = String(row.dataset.templateKey || '');
            await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
            return;
        }

        if (target.closest('#stmb-sp-new')) {
            try {
                selectedTemplateKey = await openSidePromptEditorPopup({});
                if (selectedTemplateKey) {
                    toastr.success('Side prompt created successfully', 'STMB');
                    await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
                    await notifyChange();
                }
            } catch (error) {
                toastr.error(error?.message || 'Failed to create side prompt', 'STMB');
            }
            return;
        }

        if (target.closest('#stmb-sp-export')) {
            try {
                const blob = new Blob([await exportSidePromptsJson()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'stmb-side-prompts.json';
                link.click();
                URL.revokeObjectURL(url);
                toastr.success('Side prompts exported successfully', 'STMB');
            } catch (error) {
                toastr.error(error?.message || 'Failed to export side prompts', 'STMB');
            }
            return;
        }

        if (target.closest('#stmb-sp-import')) {
            popup.dlg?.querySelector('#stmb-sp-import-file')?.click();
            return;
        }

        if (target.closest('#stmb-sp-compact-review')) {
            try {
                await showStmbEntryReviewPopup({ showGoBack: true });
            } catch (error) {
                toastr.error(error?.message || 'Failed to open compaction review', 'STMB');
            }
            return;
        }

        if (target.closest('#stmb-sp-recreate-builtins')) {
            try {
                const confirmPopup = new Popup(
                    `
                        <h3>Recreate Built-in Side Prompts</h3>
                        <div class="info-block warning">This will overwrite the built-in Side Prompts with the current local defaults. Custom prompts are not touched. This action cannot be undone.</div>
                    `,
                    POPUP_TYPE.CONFIRM,
                    '',
                    { okButton: 'Recreate', cancelButton: 'Cancel' },
                );
                const confirmed = await confirmPopup.show();
                if (confirmed !== POPUP_RESULT.AFFIRMATIVE) {
                    return;
                }
                const result = await recreateBuiltInSidePrompts('overwrite');
                await refreshSidePromptCache();
                window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
                selectedTemplateKey = null;
                await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
                toastr.success(`Recreated ${result.replaced} built-in side prompts`, 'STMB');
                await notifyChange();
            } catch (error) {
                toastr.error(error?.message || 'Failed to recreate built-in side prompts', 'STMB');
            }
        }
    });

    popup.dlg?.querySelector('#stmb-sp-import-file')?.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        try {
            const result = await importSidePromptsJson(await file.text());
            await refreshSidePromptCache();
            window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
            selectedTemplateKey = null;
            await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
            await refreshSidePromptSetControls(popup.dlg);
            const setDetail = result.setsAdded
                ? `; sets: ${result.setsAdded} added${result.setsRenamed ? ` (${result.setsRenamed} renamed due to key conflicts)` : ''}`
                : '';
            toastr.success(`Imported side prompts: ${result.added} added${result.renamed ? ` (${result.renamed} renamed due to key conflicts)` : ''}${setDetail}`, 'STMB');
            showSidePromptRuntimeMacroImportNormalizationToast(result.strippedDetails);
            await notifyChange();
        } catch (error) {
            toastr.error(error?.message ? `Failed to import side prompts: ${error.message}` : 'Failed to import side prompts', 'STMB');
        }
    });

    popup.dlg?.querySelector('#stmb-sp-set-controls')?.addEventListener('change', async event => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }
        if (target.id === 'stmb-sp-after-memory-set-mode') {
            const value = String(target.value || '');
            if (value === 'inherit') {
                setChatAfterMemorySetKey('', { inherit: true });
            } else if (value === 'individual') {
                setChatAfterMemorySetKey('');
            } else if (value.startsWith('set:')) {
                setChatAfterMemorySetKey(value.slice(4));
            }
            toastr.success('After-memory side prompt mode saved for this chat.', 'STMB');
            await notifyChange();
        }
    });

    await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
    await refreshSidePromptSetControls(popup.dlg);
    try {
        applyLocale(popup.dlg);
    } catch {
        // noop
    }
    await popup.show();
}

function getUniqueProfileName(name, ignoreIndex = null) {
    const base = (String(name || 'New Profile').trim().replace(/[<>:"/\\|?*]/g, '')) || 'New Profile';
    const existing = new Set((stmbSettings.profiles || [])
        .map((profile, index) => index === ignoreIndex ? null : String(profile?.name || '').trim())
        .filter(Boolean));
    if (!existing.has(base)) {
        return base;
    }

    let counter = 1;
    while (existing.has(`${base} (${counter})`)) {
        counter++;
    }
    return `${base} (${counter})`;
}

function buildProfileEditorHtml(profile, options = {}) {
    const mode = String(options.mode || 'edit');
    const isBuiltin = Boolean(profile?.isBuiltinCurrentST);
    const connection = profile?.connection && typeof profile.connection === 'object' ? profile.connection : {};
    const currentTitleFormat = String(profile?.titleFormat || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT);
    const titleFormats = Array.isArray(STMB_DEFAULT_TITLE_FORMATS) ? STMB_DEFAULT_TITLE_FORMATS : [];
    const usesCustomTitleFormat = !titleFormats.includes(currentTitleFormat);
    const presetKeys = getProfilePresetKeys();
    const selectedPreset = String(profile?.preset || 'summary');
    const orderMode = String(profile?.orderMode || 'auto');
    const position = Number(profile?.position ?? 0);

    return `
        <div class="stmb-profile-editor-popup">
            <h3>${mode === 'new' ? 'New Profile' : 'Edit Profile'}</h3>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-name">Profile Name</label>
                <input id="stmb-profile-editor-name" class="text_pole" value="${escapeHtml(String(profile?.name || 'New Profile'))}" ${isBuiltin ? 'disabled' : ''}>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-api">API/Provider</label>
                <select id="stmb-profile-editor-api" class="text_pole" ${isBuiltin ? 'disabled' : ''}>
                    ${STMB_PROFILE_PROVIDER_OPTIONS.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(connection.api || 'current_st') === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input id="stmb-profile-editor-skip-structured-output" type="checkbox" ${profile?.skipStructuredOutput ? 'checked' : ''}> <span>Skip structured-output and use plain-text completion</span></label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-model">Model</label>
                <input id="stmb-profile-editor-model" class="text_pole" value="${escapeHtml(String(connection.model || ''))}" ${String(connection.api || 'current_st') === 'current_st' ? 'disabled' : ''}>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-temperature">Temperature</label>
                <input id="stmb-profile-editor-temperature" type="number" min="0" max="2" step="0.1" class="text_pole" value="${escapeHtml(String(connection.temperature ?? 0.7))}" ${String(connection.api || 'current_st') === 'current_st' ? 'disabled' : ''}>
            </div>
            <div id="stmb-profile-editor-manual-section" class="${String(connection.api || 'current_st') === 'full-manual' ? '' : 'displayNone'}">
                <div class="world_entry_form_control">
                    <label for="stmb-profile-editor-endpoint">API Base URL</label>
                    <input id="stmb-profile-editor-endpoint" class="text_pole" value="${escapeHtml(String(connection.endpoint || ''))}">
                    <small>Use the provider base URL, for example <code>https://hanasaki.ai/v1</code>. <code>/chat/completions</code> is added automatically.</small>
                </div>
                <div class="world_entry_form_control">
                    <label for="stmb-profile-editor-apikey">API Key</label>
                    <input id="stmb-profile-editor-apikey" class="text_pole" type="password" value="${escapeHtml(String(connection.apiKey || ''))}">
                </div>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-preset">Memory Creation Method</label>
                <select id="stmb-profile-editor-preset" class="text_pole">
                    ${presetKeys.map(key => `<option value="${escapeHtml(key)}" ${key === selectedPreset ? 'selected' : ''}>${escapeHtml(getSummaryPromptDisplayName(key))}</option>`).join('')}
                </select>
            </div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap marginTop5">
                <div id="stmb-profile-editor-open-prompt-manager" class="menu_button interactable">Open Summary Prompt Manager</div>
                <div id="stmb-profile-editor-refresh-presets" class="menu_button interactable">Refresh Presets</div>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input id="stmb-profile-editor-use-group-specific-prompts" type="checkbox" ${profile?.useGroupSpecificPrompts ? 'checked' : ''}> <span>Use separate group and character prompts in group chats</span></label>
                <small>Group lorebooks use the group prompt; single-character target lorebooks use the character prompt.</small>
            </div>
            <div id="stmb-profile-editor-group-prompt-section" class="${profile?.useGroupSpecificPrompts ? '' : 'displayNone'}">
                <div class="world_entry_form_control">
                    <label for="stmb-profile-editor-group-preset">Group Summary Prompt</label>
                    <select id="stmb-profile-editor-group-preset" class="text_pole">
                        ${presetKeys.map(key => `<option value="${escapeHtml(key)}" ${key === String(profile?.groupPreset || 'group') ? 'selected' : ''}>${escapeHtml(getSummaryPromptDisplayName(key))}</option>`).join('')}
                    </select>
                </div>
                <div class="world_entry_form_control">
                    <label for="stmb-profile-editor-character-preset">Character Summary Prompt</label>
                    <select id="stmb-profile-editor-character-preset" class="text_pole">
                        ${presetKeys.map(key => `<option value="${escapeHtml(key)}" ${key === String(profile?.characterPreset || 'char') ? 'selected' : ''}>${escapeHtml(getSummaryPromptDisplayName(key))}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-title-format-select">Memory Title Format</label>
                <select id="stmb-profile-editor-title-format-select" class="text_pole">
                    ${titleFormats.map(format => `<option value="${escapeHtml(format)}" ${!usesCustomTitleFormat && format === currentTitleFormat ? 'selected' : ''}>${escapeHtml(format)}</option>`).join('')}
                    <option value="custom" ${usesCustomTitleFormat ? 'selected' : ''}>Custom Title Format...</option>
                </select>
                <input id="stmb-profile-editor-custom-title-format" class="text_pole marginTop5 ${usesCustomTitleFormat ? '' : 'displayNone'}" value="${escapeHtml(currentTitleFormat)}" placeholder="Enter custom format">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-const-vect">Activation Mode</label>
                <select id="stmb-profile-editor-const-vect" class="text_pole">
                    <option value="link" ${String(profile?.constVectMode || 'link') === 'link' ? 'selected' : ''}>Vectorized (Default)</option>
                    <option value="blue" ${String(profile?.constVectMode || 'link') === 'blue' ? 'selected' : ''}>Constant</option>
                    <option value="green" ${String(profile?.constVectMode || 'link') === 'green' ? 'selected' : ''}>Normal</option>
                </select>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-position">Insertion Position</label>
                <select id="stmb-profile-editor-position" class="text_pole">
                    <option value="0" ${position === 0 ? 'selected' : ''}>↑Char</option>
                    <option value="1" ${position === 1 ? 'selected' : ''}>↓Char</option>
                    <option value="5" ${position === 5 ? 'selected' : ''}>↑EM</option>
                    <option value="6" ${position === 6 ? 'selected' : ''}>↓EM</option>
                    <option value="2" ${position === 2 ? 'selected' : ''}>↑AN</option>
                    <option value="3" ${position === 3 ? 'selected' : ''}>↓AN</option>
                    <option value="7" ${position === 7 ? 'selected' : ''}>Outlet</option>
                </select>
            </div>
            <div id="stmb-profile-editor-outlet-container" class="world_entry_form_control ${position === 7 ? '' : 'displayNone'}">
                <label for="stmb-profile-editor-outlet-name">Outlet Name</label>
                <input id="stmb-profile-editor-outlet-name" class="text_pole" value="${escapeHtml(String(profile?.outletName || ''))}">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-order-mode">Insertion Order</label>
                <select id="stmb-profile-editor-order-mode" class="text_pole">
                    <option value="auto" ${orderMode === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="reverse" ${orderMode === 'reverse' ? 'selected' : ''}>Reverse</option>
                    <option value="manual" ${orderMode === 'manual' ? 'selected' : ''}>Manual</option>
                </select>
            </div>
            <div id="stmb-profile-editor-order-value-container" class="world_entry_form_control ${orderMode === 'manual' ? '' : 'displayNone'}">
                <label for="stmb-profile-editor-order-value">Manual Order Value</label>
                <input id="stmb-profile-editor-order-value" type="number" min="1" max="9999" step="1" class="text_pole" value="${escapeHtml(String(profile?.orderValue ?? 100))}">
            </div>
            <div id="stmb-profile-editor-reverse-start-container" class="world_entry_form_control ${orderMode === 'reverse' ? '' : 'displayNone'}">
                <label for="stmb-profile-editor-reverse-start">Reverse Start</label>
                <input id="stmb-profile-editor-reverse-start" type="number" min="100" max="9999" step="1" class="text_pole" value="${escapeHtml(String(profile?.reverseStart ?? 9999))}">
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input id="stmb-profile-editor-prevent-recursion" type="checkbox" ${profile?.preventRecursion ? 'checked' : ''}> <span>Prevent Recursion</span></label>
                <label class="checkbox_label"><input id="stmb-profile-editor-delay-recursion" type="checkbox" ${profile?.delayUntilRecursion ? 'checked' : ''}> <span>Delay Until Recursion</span></label>
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input id="stmb-profile-editor-convert-existing-recursion" type="checkbox" ${stmbSettings.moduleSettings?.convertExistingRecursion ? 'checked' : ''}> <span>Also convert recursion settings on existing entries</span></label>
            </div>
        </div>
    `;
}

function updateProfileEditorDynamicState(dialog) {
    if (!dialog) {
        return;
    }

    const apiSelect = dialog.querySelector('#stmb-profile-editor-api');
    const titleFormatSelect = dialog.querySelector('#stmb-profile-editor-title-format-select');
    const manualSection = dialog.querySelector('#stmb-profile-editor-manual-section');
    const modelInput = dialog.querySelector('#stmb-profile-editor-model');
    const temperatureInput = dialog.querySelector('#stmb-profile-editor-temperature');
    const customTitleInput = dialog.querySelector('#stmb-profile-editor-custom-title-format');
    const positionSelect = dialog.querySelector('#stmb-profile-editor-position');
    const outletContainer = dialog.querySelector('#stmb-profile-editor-outlet-container');
    const orderModeSelect = dialog.querySelector('#stmb-profile-editor-order-mode');
    const orderValueContainer = dialog.querySelector('#stmb-profile-editor-order-value-container');
    const reverseStartContainer = dialog.querySelector('#stmb-profile-editor-reverse-start-container');
    const useGroupSpecificPrompts = dialog.querySelector('#stmb-profile-editor-use-group-specific-prompts');
    const groupPromptSection = dialog.querySelector('#stmb-profile-editor-group-prompt-section');
    const isCurrentSt = String(apiSelect?.value || 'current_st') === 'current_st';

    if (manualSection) {
        manualSection.classList.toggle('displayNone', String(apiSelect?.value || '') !== 'full-manual');
    }
    if (modelInput) {
        modelInput.disabled = isCurrentSt;
    }
    if (temperatureInput) {
        temperatureInput.disabled = isCurrentSt;
    }
    if (customTitleInput) {
        customTitleInput.classList.toggle('displayNone', titleFormatSelect?.value !== 'custom');
    }
    if (outletContainer) {
        outletContainer.classList.toggle('displayNone', String(positionSelect?.value || '0') !== '7');
    }
    if (orderValueContainer) {
        orderValueContainer.classList.toggle('displayNone', String(orderModeSelect?.value || 'auto') !== 'manual');
    }
    if (reverseStartContainer) {
        reverseStartContainer.classList.toggle('displayNone', String(orderModeSelect?.value || 'auto') !== 'reverse');
    }
    if (groupPromptSection) {
        groupPromptSection.classList.toggle('displayNone', !useGroupSpecificPrompts?.checked);
    }
}

function buildProfileFromEditor(dialog, baseProfile = null) {
    const profile = structuredClone(baseProfile || createDefaultStmbProfile());
    const isBuiltin = Boolean(baseProfile?.isBuiltinCurrentST);
    const titleFormatSelect = dialog.querySelector('#stmb-profile-editor-title-format-select');
    const titleFormat = titleFormatSelect?.value === 'custom'
        ? String(dialog.querySelector('#stmb-profile-editor-custom-title-format')?.value || '').trim()
        : String(titleFormatSelect?.value || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT).trim();

    profile.name = String(dialog.querySelector('#stmb-profile-editor-name')?.value || profile.name || 'New Profile').trim() || 'New Profile';
    profile.preset = String(dialog.querySelector('#stmb-profile-editor-preset')?.value || 'summary').trim() || 'summary';
    profile.useGroupSpecificPrompts = Boolean(dialog.querySelector('#stmb-profile-editor-use-group-specific-prompts')?.checked);
    profile.groupPreset = String(dialog.querySelector('#stmb-profile-editor-group-preset')?.value || 'group').trim() || 'group';
    profile.characterPreset = String(dialog.querySelector('#stmb-profile-editor-character-preset')?.value || 'char').trim() || 'char';
    profile.connection = profile.connection && typeof profile.connection === 'object' ? profile.connection : {};
    profile.connection.api = isBuiltin
        ? 'current_st'
        : String(dialog.querySelector('#stmb-profile-editor-api')?.value || profile.connection.api || 'current_st').trim();
    profile.skipStructuredOutput = Boolean(dialog.querySelector('#stmb-profile-editor-skip-structured-output')?.checked);

    const model = String(dialog.querySelector('#stmb-profile-editor-model')?.value || '').trim();
    const temperature = Number(dialog.querySelector('#stmb-profile-editor-temperature')?.value ?? 0.7);
    const endpoint = String(dialog.querySelector('#stmb-profile-editor-endpoint')?.value || '').trim();
    const apiKey = String(dialog.querySelector('#stmb-profile-editor-apikey')?.value || '').trim();
    if (model) profile.connection.model = model;
    else delete profile.connection.model;
    if (Number.isFinite(temperature)) profile.connection.temperature = temperature;
    else delete profile.connection.temperature;
    if (endpoint) profile.connection.endpoint = endpoint;
    else delete profile.connection.endpoint;
    if (apiKey) profile.connection.apiKey = apiKey;
    else delete profile.connection.apiKey;

    profile.titleFormat = titleFormat || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT;
    profile.constVectMode = String(dialog.querySelector('#stmb-profile-editor-const-vect')?.value || 'link');
    profile.position = Number(dialog.querySelector('#stmb-profile-editor-position')?.value ?? 0);
    profile.outletName = String(dialog.querySelector('#stmb-profile-editor-outlet-name')?.value || '');
    profile.orderMode = String(dialog.querySelector('#stmb-profile-editor-order-mode')?.value || 'auto');
    profile.orderValue = Number(dialog.querySelector('#stmb-profile-editor-order-value')?.value ?? 100);
    profile.reverseStart = Number(dialog.querySelector('#stmb-profile-editor-reverse-start')?.value ?? 9999);
    profile.preventRecursion = Boolean(dialog.querySelector('#stmb-profile-editor-prevent-recursion')?.checked);
    profile.delayUntilRecursion = Boolean(dialog.querySelector('#stmb-profile-editor-delay-recursion')?.checked);

    if (isBuiltin) {
        profile.isBuiltinCurrentST = true;
        profile.name = 'Current SillyTavern Settings';
        profile.connection.api = 'current_st';
    } else {
        delete profile.isBuiltinCurrentST;
    }

    return profile;
}

function isImportableProfile(profile) {
    if (!profile || typeof profile !== 'object') {
        return false;
    }
    if (!profile.name || typeof profile.name !== 'string') {
        return false;
    }
    if (profile.connection && typeof profile.connection !== 'object') {
        return false;
    }
    return true;
}

async function openProfileEditor(profileIndex = null) {
    const isNew = profileIndex === null;
    const baseProfile = isNew
        ? {
            ...createDefaultStmbProfile(),
            name: getUniqueProfileName('New Profile'),
            isBuiltinCurrentST: false,
            connection: { api: 'current_st', temperature: 0.7 },
        }
        : structuredClone(stmbSettings.profiles[profileIndex] || getActiveStmbProfile(stmbSettings));
    const popup = new Popup(DOMPurify.sanitize(buildProfileEditorHtml(baseProfile, { mode: isNew ? 'new' : 'edit' })), POPUP_TYPE.TEXT, '', {
        okButton: isNew ? 'Create' : 'Save',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClosing: popupInstance => {
            if (popupInstance?.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            const dialog = popupInstance.dlg;
            const nextProfile = buildProfileFromEditor(dialog, baseProfile);
            if (!nextProfile.name.trim()) {
                toastr.error('Profile name is required', 'STMB');
                return false;
            }
            if (nextProfile.connection?.api !== 'current_st' && !String(nextProfile.connection?.model || '').trim()) {
                toastr.error('Model is required for non-current-st profiles', 'STMB');
                return false;
            }
            if (nextProfile.connection?.api === 'full-manual' && !String(nextProfile.connection?.endpoint || '').trim()) {
                toastr.error('Endpoint is required for full-manual profiles', 'STMB');
                return false;
            }
            if (Number(nextProfile.position) === 7 && !String(nextProfile.outletName || '').trim()) {
                toastr.error('Outlet Name is required when Insertion Position is Outlet', 'STMB');
                return false;
            }
            return true;
        },
    });

    const handlePresetsUpdated = () => refreshProfileEditorPresetOptions(popup.dlg);
    popup.dlg?.addEventListener('change', event => {
        const target = event.target;
        if (target instanceof HTMLElement && target.matches('#stmb-profile-editor-convert-existing-recursion')) {
            stmbSettings.moduleSettings.convertExistingRecursion = target.checked;
            stmbSettings = normalizeStmbSettings(stmbSettings);
            saveSettingsDebounced();
        }
        updateProfileEditorDynamicState(popup.dlg);
    });
    popup.dlg?.addEventListener('input', () => updateProfileEditorDynamicState(popup.dlg));
    popup.dlg?.querySelector('#stmb-profile-editor-temperature')?.addEventListener('input', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        const value = Number.parseFloat(input.value);
        if (!Number.isNaN(value)) {
            if (value < 0) input.value = '0';
            if (value > 2) input.value = '2';
        }
    });
    popup.dlg?.querySelector('#stmb-profile-editor-model')?.addEventListener('input', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.value = input.value.replace(/[<>]/g, '');
    });
    popup.dlg?.querySelector('#stmb-profile-editor-reverse-start')?.addEventListener('input', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.value = String(input.value ?? '').replace(/[^\d]/g, '');
    });
    popup.dlg?.querySelector('#stmb-profile-editor-reverse-start')?.addEventListener('blur', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        const parsed = Number.parseInt(input.value, 10);
        const clamped = Number.isFinite(parsed) ? Math.max(100, Math.min(9999, Math.trunc(parsed))) : 9999;
        input.value = String(clamped);
    });
    popup.dlg?.addEventListener('click', async event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        if (target.closest('#stmb-profile-editor-open-prompt-manager')) {
            await showSummaryPromptManagerPopup({
                onChange: async change => {
                    const preferredPresetKey = change?.type === 'apply' && change?.targetProfileIndex === profileIndex
                        ? change.presetKey
                        : null;
                    refreshProfileEditorPresetOptions(popup.dlg, preferredPresetKey);
                },
                targetProfileIndex: isNew ? null : profileIndex,
            });
            refreshProfileEditorPresetOptions(popup.dlg);
            return;
        }
        if (target.closest('#stmb-profile-editor-refresh-presets')) {
            refreshProfileEditorPresetOptions(popup.dlg);
            toastr.success('Preset list refreshed', 'STMB');
            return;
        }
    });
    window.addEventListener('stmb-presets-updated', handlePresetsUpdated);
    updateProfileEditorDynamicState(popup.dlg);
    refreshProfileEditorPresetOptions(popup.dlg);

    let result;
    try {
        result = await popup.show();
    } finally {
        window.removeEventListener('stmb-presets-updated', handlePresetsUpdated);
    }
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }

    const nextProfile = buildProfileFromEditor(popup.dlg, baseProfile);
    nextProfile.name = getUniqueProfileName(nextProfile.name, isNew ? null : profileIndex);
    if (isNew) {
        stmbSettings.profiles.push(nextProfile);
    } else {
        stmbSettings.profiles[profileIndex] = nextProfile;
    }
    stmbSettings = normalizeStmbSettings(stmbSettings);
    saveSettingsDebounced();
    return true;
}

async function deleteSelectedProfile(profileIndex) {
    if (!Number.isInteger(profileIndex) || !stmbSettings.profiles[profileIndex]) {
        return false;
    }
    if (stmbSettings.profiles.length <= 1) {
        toastr.error('Cannot delete the last profile', 'STMB');
        return false;
    }
    if (stmbSettings.profiles[profileIndex]?.isBuiltinCurrentST) {
        toastr.error('Cannot delete the "Current SillyTavern Settings" profile - it is required for Memory Books to work', 'STMB');
        return false;
    }

    const profileName = String(stmbSettings.profiles[profileIndex]?.name || 'Profile');
    const result = await Popup.show.confirm('Delete Profile', `Delete profile "${escapeHtml(profileName)}"?`);
    if (!result) {
        return false;
    }

    stmbSettings.profiles.splice(profileIndex, 1);
    if (stmbSettings.defaultProfile === profileIndex) {
        stmbSettings.defaultProfile = 0;
    } else if (stmbSettings.defaultProfile > profileIndex) {
        stmbSettings.defaultProfile -= 1;
    }
    stmbSettings = normalizeStmbSettings(stmbSettings);
    saveSettingsDebounced();
    return true;
}

function exportProfilesToFile() {
    const profiles = Array.isArray(stmbSettings.profiles)
        ? stmbSettings.profiles.map(profile => {
            const sanitizedProfile = structuredClone(profile || {});
            if (sanitizedProfile.connection && typeof sanitizedProfile.connection === 'object' && Object.hasOwn(sanitizedProfile.connection, 'apiKey')) {
                delete sanitizedProfile.connection.apiKey;
            }
            return sanitizedProfile;
        })
        : [];

    const payload = {
        profiles,
        exportDate: new Date().toISOString(),
        version: 1,
        moduleVersion: stmbSettings.migrationVersion || 1,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `stmemorybooks-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importProfilesFromFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve({ importedCount: 0, skippedCount: 0 });
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const importData = JSON.parse(String(reader.result || '{}'));
                if (!Array.isArray(importData?.profiles)) {
                    throw new Error('Invalid profile data format');
                }

                const validProfiles = importData.profiles.filter(isImportableProfile);
                if (validProfiles.length === 0) {
                    throw new Error('No valid profiles found in import file');
                }

                const existingNames = stmbSettings.profiles.map(profile => String(profile?.name || '').trim());
                let importedCount = 0;
                let skippedCount = 0;
                for (const rawProfile of validProfiles) {
                    const candidateSettings = normalizeStmbSettings({
                        ...stmbSettings,
                        profiles: [...stmbSettings.profiles, rawProfile],
                        defaultProfile: stmbSettings.defaultProfile,
                    });
                    const normalizedProfile = candidateSettings.profiles[candidateSettings.profiles.length - 1];
                    if (normalizedProfile?.isBuiltinCurrentST) {
                        skippedCount++;
                        continue;
                    }
                    if (existingNames.includes(normalizedProfile.name)) {
                        skippedCount++;
                        continue;
                    }
                    normalizedProfile.name = getUniqueProfileName(normalizedProfile.name, null);
                    existingNames.push(normalizedProfile.name);
                    stmbSettings.profiles.push(normalizedProfile);
                    importedCount++;
                }

                if (importedCount > 0) {
                    stmbSettings = normalizeStmbSettings(stmbSettings);
                    saveSettingsDebounced();
                }
                resolve({ importedCount, skippedCount });
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read import file'));
        reader.readAsText(file);
    });
}

function refreshSettingsPopupProfileSection(dialog, currentUiConnection, selectedProfileIndex = null) {
    if (!dialog) {
        return;
    }

    const profileSelect = dialog.querySelector('#stmb-settings-profile-select');
    if (profileSelect) {
        const currentSelectedIndex = Number(profileSelect.value);
        const preferredIndex = Number.isFinite(Number(selectedProfileIndex))
            ? Number(selectedProfileIndex)
            : (Number.isFinite(currentSelectedIndex) ? currentSelectedIndex : Number(stmbSettings.defaultProfile ?? 0));
        profileSelect.innerHTML = (stmbSettings.profiles || []).map((profile, index) => (
            `<option value="${index}">${escapeHtml(getProfileDisplayName(profile))}${index === stmbSettings.defaultProfile ? ' (Default)' : ''}</option>`
        )).join('');
        const maxIndex = Math.max(0, (stmbSettings.profiles?.length || 1) - 1);
        profileSelect.value = String(Math.max(0, Math.min(maxIndex, preferredIndex)));
    }

    updateSettingsPopupDynamicState(dialog, currentUiConnection);
}

function refreshProfileEditorPresetOptions(dialog, preferredSelectedValue = null) {
    if (!dialog) {
        return;
    }
    const selectors = [
        ['#stmb-profile-editor-preset', preferredSelectedValue, 'summary'],
        ['#stmb-profile-editor-group-preset', null, 'group'],
        ['#stmb-profile-editor-character-preset', null, 'char'],
    ];
    for (const [selector, preferredValue, fallback] of selectors) {
        const presetSelect = dialog.querySelector(selector);
        if (!presetSelect) continue;
        const selectedValue = String(preferredValue || presetSelect.value || fallback);
        presetSelect.innerHTML = getProfilePresetKeys().map(key => (
            `<option value="${escapeHtml(key)}" ${key === selectedValue ? 'selected' : ''}>${escapeHtml(getSummaryPromptDisplayName(key))}</option>`
        )).join('');
        presetSelect.value = Array.from(presetSelect.options).some(option => option.value === selectedValue)
            ? selectedValue
            : fallback;
    }
}

function createMainEntryUi() {
    if (stmbUiBound || $('#stmb-menu-item').length > 0) {
        stmbUiBound = true;
        return;
    }

    const menuItem = $(`
        <div id="stmb-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-fw fa-solid fa-book extensionsMenuExtensionButton"></div>
            <span>Memory Books</span>
        </div>
    `);
    const memoryBooksWandContainer = $('#memory_books_wand_container');
    if (memoryBooksWandContainer.length > 0) {
        memoryBooksWandContainer.append(menuItem);
        stmbUiBound = true;
    } else {
        setTimeout(() => {
            if (!stmbUiBound) {
                createMainEntryUi();
            }
        }, 250);
    }
}

function selectSettingsPopupView(html, view = 'main') {
    const template = document.createElement('template');
    template.innerHTML = DOMPurify.sanitize(html);
    const root = template.content.querySelector('.stmb-settings-popup');
    if (!root) return template.innerHTML;
    if (view === 'main') {
        root.querySelectorAll('.stmb-settings-subsection').forEach(section => section.remove());
    } else {
        for (const child of Array.from(root.children)) {
            if (child.matches(`[data-stmb-settings-view="${CSS.escape(view)}"]`)) continue;
            if (child.tagName === 'H2') continue;
            child.remove();
        }
    }
    return template.innerHTML;
}

async function showMainEntryPopup(view = 'main') {
    await firstRunInitArcPromptPresets(stmbSettings);
    await firstRunInitSummaryPromptPresets(stmbSettings);
    let sidePromptSets = [];
    if (view === 'general') {
        try {
            sidePromptSets = await listSets();
        } catch (error) {
            console.warn('STMB failed to load side prompt sets for General Settings', error);
        }
    }
    const sceneData = await getSettingsPopupSceneData();
    const currentUiConnection = await getCurrentUiConnectionInfo();
    const regexOptions = getSettingsRegexOptions();
    const popup = new Popup(selectSettingsPopupView(buildSettingsPopupHtml(sceneData, currentUiConnection, regexOptions, sidePromptSets), view), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Close',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        customButtons: view === 'main' ? [
            {
                text: 'Create Memory',
                result: null,
                classes: ['menu_button'],
                action: async () => {
                    try {
                        const profileIndex = Number(popup.dlg?.querySelector('#stmb-settings-profile-select')?.value ?? stmbSettings.defaultProfile ?? 0);
                        await initiateMemoryCreation({ range: getCurrentSceneRange(), profileIndex });
                    } catch (error) {
                        showSlashCommandError(error?.message || 'Failed to create memory.', error);
                    }
                },
            },
            {
                text: 'Consolidate Memories',
                classes: ['menu_button'],
                action: async () => {
                    const initialTargetTier = Number(readSelectedValues(popup.dlg?.querySelector('#stmb-settings-auto-consolidation-target-tier')).at(0) || 1);
                    await showSummaryConsolidationPopup({ initialTargetTier, showGoBack: true });
                },
            },
            {
                text: 'Compaction',
                classes: ['menu_button'],
                action: async () => {
                    await showStmbEntryReviewPopup({ showGoBack: true });
                },
            },
            {
                text: 'Topical Clip',
                classes: ['menu_button'],
                action: async () => {
                    await showTopicalClipPopup({ showGoBack: true });
                },
            },
            {
                text: 'Additional Context',
                classes: ['menu_button'],
                action: async () => {
                    await showStmbContextSettingsPopup({
                        selectedKey: getChatContextSettingKey(),
                        onSelectedKeyChange: key => {
                            setChatContextSettingKey(key);
                        },
                    });
                },
            },
            {
                text: 'Clear Scene',
                result: null,
                classes: ['menu_button'],
                action: () => {
                    clearSceneMarkers();
                },
            },
        ] : [],
    });
    activeSettingsPopupDialog = popup.dlg ?? null;

    const persistSettings = () => {
        stmbSettings = normalizeStmbSettings(stmbSettings);
        saveSettingsDebounced();
        updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
    };
    const persistAutoConsolidationTargetTiers = selectElement => {
        const moduleSettings = stmbSettings.moduleSettings;
        moduleSettings.autoConsolidationTargetTiers = readSelectedValues(selectElement).map(value => Number(value)).filter(Number.isFinite);
        persistSettings();
    };

    setTimeout(() => {
        try {
            if (window.jQuery && typeof window.jQuery.fn.select2 === 'function') {
                const $parent = window.jQuery(popup.dlg);
                const $tierSelect = $parent.find('#stmb-settings-auto-consolidation-target-tier');
                $tierSelect.select2({
                    width: '100%',
                    placeholder: 'Select tiers…',
                    closeOnSelect: false,
                    dropdownParent: $parent,
                });
                $tierSelect.on('change.stmbAutoConsolidationTiers', function () {
                    persistAutoConsolidationTargetTiers(this);
                });
            }
        } catch (error) {
            console.warn('STMB auto-consolidation Select2 initialization failed', error);
        }
    }, 0);

    popup.dlg?.addEventListener('change', async event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const moduleSettings = stmbSettings.moduleSettings;

        if (target.matches('#stmb-settings-always-use-default')) {
            moduleSettings.alwaysUseDefault = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-show-memory-previews')) {
            moduleSettings.showMemoryPreviews = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-show-consolidation-previews')) {
            moduleSettings.showConsolidationPreviews = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-show-notifications')) {
            moduleSettings.showNotifications = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-show-floating-clip-button')) {
            moduleSettings.showFloatingClipButton = target.checked;
            persistSettings();
            refreshFloatingClipButtonSetting();
            return;
        }
        if (target.matches('#stmb-settings-memory-boundary-mode')) {
            moduleSettings.memoryBoundaryMode = normalizeStmbMemoryBoundaryMode(target.value);
            persistSettings();
            refreshMemoryBoundaryUi();
            return;
        }
        if (target.matches('#stmb-settings-allow-scene-overlap')) {
            moduleSettings.allowSceneOverlap = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-refresh-editor')) {
            moduleSettings.refreshEditor = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-unhide-before-memory')) {
            moduleSettings.unhideBeforeMemory = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-max-tokens')) {
            const value = Number(target.value);
            moduleSettings.maxTokens = Number.isFinite(value) && value > 0 ? Math.trunc(value) : STMB_DEFAULT_MAX_TOKENS;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-token-warning-threshold')) {
            const value = Number.parseInt(target.value, 10);
            if (!Number.isFinite(value) || value < 1000 || value > 200000) {
                return;
            }
            moduleSettings.tokenWarningThreshold = value;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-default-memory-count')) {
            const value = Number(target.value);
            moduleSettings.defaultMemoryCount = normalizeMemoryContextCount(value);
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-default-solo-sideprompt-set')) {
            moduleSettings.defaultSoloSidePromptSetKey = String(target.value || '').trim();
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-default-group-sideprompt-set')) {
            moduleSettings.defaultGroupSidePromptSetKey = String(target.value || '').trim();
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-summary-order-mode')) {
            syncSummaryOrderModuleSettings(moduleSettings, { orderMode: String(target.value || 'auto').toLowerCase() });
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-summary-order-value')) {
            syncSummaryOrderModuleSettings(moduleSettings, { orderValue: Number(target.value) });
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-summary-reverse-start')) {
            syncSummaryOrderModuleSettings(moduleSettings, { reverseStart: Number(target.value) });
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-hide-mode')) {
            moduleSettings.autoHideMode = String(target.value || 'all').toLowerCase();
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-unhidden-entries-count')) {
            const value = Number.parseInt(target.value, 10);
            if (!Number.isFinite(value) || value < 0 || value > 50) {
                return;
            }
            moduleSettings.unhiddenEntriesCount = value;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-use-regex')) {
            moduleSettings.useRegex = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-regex-outgoing')) {
            moduleSettings.selectedRegexOutgoing = readSelectedValues(target);
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-regex-incoming')) {
            moduleSettings.selectedRegexIncoming = readSelectedValues(target);
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-manual-mode-enabled')) {
            if (target.checked) {
                const state = getStmbState();
                if (!String(state.manualLorebook || '').trim()) {
                    const chatBoundLorebook = String(chat_metadata[METADATA_KEY] || '').trim();
                    if (chatBoundLorebook && !isReservedTemplateWorldName(chatBoundLorebook)) {
                        const setupPopup = new Popup(DOMPurify.sanitize(`
                            <div class="stmb-manual-lorebook-setup">
                                <h4>Manual Lorebook Setup</h4>
                                <p>You have a chat-bound lorebook "${escapeHtml(chatBoundLorebook)}".</p>
                                <p>Would you like to use it for manual mode or select a different one?</p>
                            </div>
                        `), POPUP_TYPE.TEXT, '', {
                            okButton: 'Use Chat-bound',
                            cancelButton: 'Select Different',
                        });
                        const setupResult = await setupPopup.show();
                        if (setupResult === POPUP_RESULT.AFFIRMATIVE) {
                            state.manualLorebook = chatBoundLorebook;
                            saveMetadataDebounced();
                        } else {
                            const selectedLorebook = await showLorebookPickerPopup(getManualPrimaryLorebookNames(), {
                                title: 'Select Lorebook',
                                emptyMessage: 'No existing lorebooks are available.',
                            });
                            if (!selectedLorebook) {
                                target.checked = false;
                                return;
                            }
                            state.manualLorebook = selectedLorebook;
                            saveMetadataDebounced();
                        }
                    } else {
                        const selectedLorebook = await showLorebookPickerPopup(getManualPrimaryLorebookNames(), {
                            title: 'Select Lorebook',
                            emptyMessage: 'No existing lorebooks are available.',
                        });
                        if (!selectedLorebook) {
                            target.checked = false;
                            return;
                        }
                        state.manualLorebook = selectedLorebook;
                        saveMetadataDebounced();
                    }
                }
                moduleSettings.autoCreateLorebook = false;
            }
            moduleSettings.manualModeEnabled = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-accept-group-participants')) {
            moduleSettings.autoAcceptGroupParticipants = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('.stmb-manual-group-lorebook-select')) {
            const memberKey = String(target.dataset.memberKey || '').trim();
            const lorebookName = String(target.value || '').trim();
            if (lorebookName && lorebookName === String(getStmbState().manualLorebook || '').trim()) {
                toastr.error('A character lorebook cannot be the group Memory Book.', 'STMB');
                target.value = '';
                return;
            }
            if (memberKey && lorebookName) {
                const bindings = getManualCharacterLorebookBindings();
                const previousLorebookName = String(bindings[memberKey] || '').trim();
                const member = getStmbGroupMembers().find(item => item.key === memberKey);
                target.disabled = true;
                try {
                    await syncStmbGroupStloMetadata({
                        targets: [{
                            lorebookName,
                            storage: getLorebookStorageForRequest(lorebookName),
                            characterNames: [member?.characterFilterName].filter(Boolean),
                        }],
                    });
                    bindings[memberKey] = lorebookName;
                    saveMetadataDebounced();
                    const clearButton = popup.dlg.querySelector(`.stmb-manual-group-lorebook-clear[data-member-key="${CSS.escape(memberKey)}"]`);
                    if (clearButton) clearButton.disabled = false;
                } catch (error) {
                    target.value = previousLorebookName;
                    toastr.error(error?.message || 'Failed to update STLO character filters.', 'STMB');
                } finally {
                    target.disabled = false;
                }
            }
            return;
        }
        if (target.matches('#stmb-settings-auto-create-lorebook')) {
            moduleSettings.autoCreateLorebook = target.checked;
            if (target.checked) {
                moduleSettings.manualModeEnabled = false;
            }
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-lorebook-name-template')) {
            moduleSettings.lorebookNameTemplate = String(target.value || '').trim();
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-summary-enabled')) {
            moduleSettings.autoSummaryEnabled = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-summary-interval')) {
            const value = Number.parseInt(target.value, 10);
            if (!Number.isFinite(value) || value < 10 || value > 200) {
                return;
            }
            moduleSettings.autoSummaryInterval = value;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-summary-buffer')) {
            const value = Number(target.value);
            moduleSettings.autoSummaryBuffer = Number.isFinite(value) ? Math.max(0, Math.min(50, Math.trunc(value))) : 0;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-consolidation-prompt-enabled')) {
            moduleSettings.autoConsolidationPromptEnabled = target.checked;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-auto-consolidation-target-tier')) {
            persistAutoConsolidationTargetTiers(target);
            return;
        }
        if (target.matches('#stmb-settings-title-format-select')) {
            if (target.value !== 'custom') {
                stmbSettings.titleFormat = String(target.value || STMB_DEFAULT_TITLE_FORMAT);
                persistSettings();
            } else {
                updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            }
            return;
        }
        if (target.matches('#stmb-settings-custom-title-format')) {
            stmbSettings.titleFormat = String(target.value || STMB_DEFAULT_TITLE_FORMAT);
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-profile-select')) {
            updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            return;
        }
        if (target.matches('#stmb-settings-import-file')) {
            try {
                const result = await importProfilesFromFile(target.files?.[0] || null);
                target.value = '';
                if (result.importedCount > 0) {
                    refreshSettingsPopupProfileSection(popup.dlg, currentUiConnection);
                    const duplicateText = result.skippedCount > 0
                        ? ` (${result.skippedCount} duplicate${result.skippedCount === 1 ? '' : 's'} skipped)`
                        : '';
                    toastr.success(`Imported ${result.importedCount} profile${result.importedCount === 1 ? '' : 's'}${duplicateText}`, 'STMB profile import completed');
                } else {
                    toastr.warning('No new profiles imported - all profiles already exist', 'STMB');
                }
            } catch (error) {
                target.value = '';
                toastr.error(error?.message || 'Failed to import profiles', 'STMB');
            }
        }
    });

    popup.dlg?.addEventListener('click', async event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.closest('#stmb-settings-open-general-settings')) {
            await showMainEntryPopup('general');
            return;
        }
        if (target.closest('#stmb-settings-open-automatic-settings')) {
            await showMainEntryPopup('automatic');
            return;
        }

        if (target.closest('#stmb-settings-select-lorebook')) {
            const selectedLorebook = await showLorebookPickerPopup(getManualPrimaryLorebookNames(), {
                title: 'Select Lorebook',
                emptyMessage: 'No existing lorebooks are available.',
            });
            if (selectedLorebook) {
                getStmbState().manualLorebook = selectedLorebook;
                saveMetadataDebounced();
                updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            }
            return;
        }

        if (target.closest('#stmb-settings-clear-lorebook')) {
            delete getStmbState().manualLorebook;
            saveMetadataDebounced();
            updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            return;
        }
        const groupLorebookClear = target.closest('.stmb-manual-group-lorebook-clear');
        if (groupLorebookClear) {
            const memberKey = String(groupLorebookClear.dataset.memberKey || '').trim();
            if (memberKey) {
                delete getManualCharacterLorebookBindings()[memberKey];
                saveMetadataDebounced();
                const select = popup.dlg.querySelector(`.stmb-manual-group-lorebook-select[data-member-key="${CSS.escape(memberKey)}"]`);
                if (select) select.value = '';
                groupLorebookClear.disabled = true;
                toastr.warning('Character lorebook cleared. Its STLO character filter was retained; remove it in STLO if it is no longer needed.', 'STMB');
            }
            return;
        }
        if (target.closest('#stmb-settings-configure-regex')) {
            try {
                const saved = await showRegexSelectionPopup();
                if (saved) {
                    updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
                }
            } catch (error) {
                toastr.error(error?.message || 'Failed to open regex selection popup', 'STMB');
            }
            return;
        }
        if (target.closest('#stmb-settings-configure-lorebook-order-defaults')) {
            const moduleSettings = getModuleSettings();
            try {
                await openLorebookOrderingDialog('Memory Book Defaults', {
                    entries: {},
                    ...(moduleSettings.lorebookOrderDefaults
                        ? { stlo: cloneStloSettings(moduleSettings.lorebookOrderDefaults) }
                        : {}),
                }, {
                    popupTitle: 'Lorebook Order Defaults',
                    heading: 'ST Lorebook Ordering Defaults',
                    introText: 'Configure priority, order, budget, and group chat behavior for memory books that STMB auto-creates later.',
                    successMessage: 'Lorebook order defaults updated.',
                    successTitle: 'STMB',
                    onSave: async nextData => {
                        moduleSettings.lorebookOrderDefaults = cloneStloSettings(nextData?.stlo, { omitDefault: true });
                        stmbSettings = normalizeStmbSettings(stmbSettings);
                        saveSettingsDebounced();
                        updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
                    },
                });
                updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            } catch (error) {
                console.warn('STMB lorebook order defaults popup failed', error);
                toastr.error(error?.message || 'Failed to configure lorebook order defaults', 'STMB');
            }
            return;
        }
        if (target.closest('#stmb-settings-open-prompt-manager')) {
            const selectedProfileIndex = Number(popup.dlg?.querySelector('#stmb-settings-profile-select')?.value ?? stmbSettings.defaultProfile ?? 0);
            await showSummaryPromptManagerPopup({
                onChange: async () => {
                    updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
                },
                targetProfileIndex: selectedProfileIndex,
            });
            updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            return;
        }
        if (target.closest('#stmb-settings-open-arc-prompt-manager')) {
            await showArcPromptManagerPopup({
                onChange: async () => {
                    updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
                },
            });
            updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            return;
        }
        if (target.closest('#stmb-settings-open-sideprompt-manager')) {
            await showSidePromptManagerPopup({
                onChange: async () => {
                    updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
                },
            });
            updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
            return;
        }

        const selectedProfileIndex = Number(popup.dlg?.querySelector('#stmb-settings-profile-select')?.value ?? stmbSettings.defaultProfile ?? 0);
        if (target.closest('#stmb-settings-profile-set-default')) {
            stmbSettings.defaultProfile = selectedProfileIndex;
            stmbSettings = normalizeStmbSettings(stmbSettings);
            saveSettingsDebounced();
            refreshSettingsPopupProfileSection(popup.dlg, currentUiConnection, selectedProfileIndex);
            toastr.success(`Set "${getProfileDisplayName(stmbSettings.profiles?.[selectedProfileIndex])}" as default profile`, 'STMB');
            return;
        }
        if (target.closest('#stmb-settings-profile-new')) {
            if (await openProfileEditor(null)) {
                refreshSettingsPopupProfileSection(popup.dlg, currentUiConnection, (stmbSettings.profiles?.length || 1) - 1);
                toastr.success('Profile created successfully', 'STMB');
            }
            return;
        }
        if (target.closest('#stmb-settings-profile-edit')) {
            if (await openProfileEditor(selectedProfileIndex)) {
                refreshSettingsPopupProfileSection(popup.dlg, currentUiConnection, selectedProfileIndex);
                toastr.success('Profile updated successfully', 'STMB');
            }
            return;
        }
        if (target.closest('#stmb-settings-profile-delete')) {
            if (await deleteSelectedProfile(selectedProfileIndex)) {
                refreshSettingsPopupProfileSection(popup.dlg, currentUiConnection, Math.max(0, selectedProfileIndex - 1));
                toastr.success('Profile deleted successfully', 'STMB');
            }
            return;
        }
        if (target.closest('#stmb-settings-profile-export')) {
            exportProfilesToFile();
            toastr.success('Profiles exported successfully', 'STMB');
            return;
        }
        if (target.closest('#stmb-settings-profile-import')) {
            popup.dlg?.querySelector('#stmb-settings-import-file')?.click();
        }
    });

    updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);

    try {
        await popup.show();
    } finally {
        if (activeSettingsPopupDialog === popup.dlg) {
            activeSettingsPopupDialog = null;
        }
    }
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

function saveAdvancedProfile(baseProfile, popupResult, currentUiConnection) {
    const sourceProfile = baseProfile || getActiveStmbProfile(stmbSettings);
    const sourceConnection = sourceProfile?.connection && typeof sourceProfile.connection === 'object'
        ? sourceProfile.connection
        : {};
    const sourceApi = String(sourceConnection.api || 'openai').trim() || 'openai';
    const sourceModel = String(sourceConnection.model || '').trim();
    const sourceTemperature = Number(sourceConnection.temperature);

    const overrideApi = String(currentUiConnection?.api || '').trim();
    const overrideModel = String(currentUiConnection?.model || '').trim();
    const overrideTemperature = Number(currentUiConnection?.temperature);

    const nextProfile = {
        name: getUniqueProfileName(popupResult.newProfileName),
        connection: {
            api: popupResult.overrideSettings && overrideApi ? overrideApi : sourceApi,
            temperature: popupResult.overrideSettings && Number.isFinite(overrideTemperature)
                ? Math.max(0, Math.min(2, overrideTemperature))
                : (Number.isFinite(sourceTemperature) ? Math.max(0, Math.min(2, sourceTemperature)) : 0.7),
        },
        preset: String(sourceProfile?.preset || '').trim() || 'summary',
        useGroupSpecificPrompts: Boolean(sourceProfile?.useGroupSpecificPrompts),
        groupPreset: String(sourceProfile?.groupPreset || 'group').trim() || 'group',
        characterPreset: String(sourceProfile?.characterPreset || 'char').trim() || 'char',
        constVectMode: 'link',
        position: 0,
        orderMode: 'auto',
        orderValue: 100,
        reverseStart: 9999,
        preventRecursion: true,
        delayUntilRecursion: false,
        titleFormat: String(sourceProfile?.titleFormat || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT).trim() || STMB_DEFAULT_TITLE_FORMAT,
    };

    const nextModel = popupResult.overrideSettings ? overrideModel : sourceModel;
    if (nextModel) {
        nextProfile.connection.model = nextModel;
    }

    stmbSettings.profiles.push(nextProfile);
    saveSettingsDebounced();
    return nextProfile;
}

/**
 * Estimates the full memory generation prompt used by warning and threshold gates.
 */
async function estimateAdvancedMemoryTokens(compiledScene, lorebookName, options = {}) {
    const rawProfileIndex = options?.profileIndex;
    const profileIndex = rawProfileIndex !== null && rawProfileIndex !== undefined && Number.isInteger(Number(rawProfileIndex))
        ? Number(rawProfileIndex)
        : null;
    const promptText = String(options?.promptText || '').trim();
    const memoryCount = normalizeMemoryContextCount(options?.memoryCount);
    const sourceProfile = options?.profile && typeof options.profile === 'object'
        ? options.profile
        : getActiveStmbProfile(stmbSettings, profileIndex);
    const effectiveProfile = structuredClone(sourceProfile);

    if (promptText) {
        effectiveProfile.promptText = promptText;
    }

    const requestSettings = {
        ...stmbSettings,
        moduleSettings: {
            ...(stmbSettings.moduleSettings || {}),
            defaultMemoryCount: memoryCount,
        },
    };
    const worldInfo = options?.worldInfoOverride && typeof options.worldInfoOverride === 'object'
        ? options.worldInfoOverride
        : await loadWorldInfo(lorebookName) || { entries: {} };
    let additionalContextEntries;
    if (Array.isArray(options?.additionalContextEntries)) {
        additionalContextEntries = options.additionalContextEntries;
    } else if (Object.hasOwn(options || {}, 'contextSettingKey')) {
        additionalContextEntries = await resolveAdditionalContextEntriesForKey(options.contextSettingKey, { notify: false });
    } else {
        additionalContextEntries = await resolveCurrentChatAdditionalContextEntries({ notify: false });
    }
    const finalPromptText = buildMemoryPromptText(compiledScene, effectiveProfile, worldInfo, requestSettings, additionalContextEntries);
    return await getTokenCountAsync(String(finalPromptText || ''));
}

async function showAndGetMemorySettings(compiledScene, range, lorebookName, selectedProfileIndex = null) {
    await firstRunInitSummaryPromptPresets(stmbSettings);
    const tokenThreshold = getModuleSettings().tokenWarningThreshold ?? 30000;
    const defaultMemoryCount = normalizeMemoryContextCount(getModuleSettings().defaultMemoryCount);
    const defaultProfileIndex = selectedProfileIndex ?? stmbSettings.defaultProfile ?? 0;
    const estimatedTokens = await estimateAdvancedMemoryTokens(compiledScene, lorebookName, {
        profileIndex: defaultProfileIndex,
        memoryCount: defaultMemoryCount,
    });
    const sceneData = buildScenePopupData(compiledScene, range, estimatedTokens);
    const shouldShowConfirmation = !getModuleSettings().alwaysUseDefault || estimatedTokens > tokenThreshold;
    const currentUiConnection = await getCurrentUiConnectionInfo();

    if (!shouldShowConfirmation) {
        const profile = getActiveStmbProfile(stmbSettings, selectedProfileIndex ?? null);
        if (!validateConnectionProfilePreflight(profile)) {
            return null;
        }
        return {
            profileSettings: buildEffectiveMemoryProfile(profile),
            summaryCount: defaultMemoryCount,
            tokenThreshold,
        };
    }

    const popupProfiles = stmbSettings.profiles.map(profile => ({
        name: getProfileDisplayName(profile),
        effectivePrompt: getEffectivePromptText(profile),
        profileModel: getProfileModelDisplay(profile),
        profileTemperature: getProfileTemperatureDisplay(profile),
    }));
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

    if (confirmation.action === 'settings') {
        await showMainEntryPopup();
        return null;
    }

    if (confirmation.action === 'confirm') {
        const profile = getActiveStmbProfile(stmbSettings, confirmation.profileIndex);
        if (!validateConnectionProfilePreflight(profile)) {
            return null;
        }
        return {
            profileSettings: buildEffectiveMemoryProfile(profile),
            summaryCount: defaultMemoryCount,
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
        defaultMemoryCount,
        overrideSettings: false,
        suggestedProfileName: `${getProfileDisplayName(selectedProfile)} - Modified`,
        tokenThreshold,
        estimateTokenTotal: async popupOptions => await estimateAdvancedMemoryTokens(compiledScene, lorebookName, popupOptions),
    });

    if (advanced.action === 'cancel') {
        return null;
    }

    if (advanced.action === 'settings') {
        await showMainEntryPopup();
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
        if (!validateConnectionProfilePreflight(saved)) {
            return null;
        }
        toastr.success(`Profile "${saved.name}" saved successfully`, 'STMB');
        const effectiveSavedProfile = buildEffectiveMemoryProfile(saved);
        const savedPromptText = String(advanced.promptText || '').trim();
        if (savedPromptText) {
            effectiveSavedProfile.promptText = advanced.promptText;
        }
        return {
            profileSettings: effectiveSavedProfile,
            summaryCount: normalizeMemoryContextCount(advanced.memoryCount),
            tokenThreshold,
        };
    }

    const effectiveProfile = structuredClone(selectedProfile);
    const basePrompt = String(getEffectivePromptText(selectedProfile) || '').trim();
    const nextPrompt = String(advanced.promptText || '').trim();
    effectiveProfile.promptText = nextPrompt || basePrompt;
    if (advanced.overrideSettings) {
        effectiveProfile.connection = {
            api: 'current_st',
            model: '',
            temperature: currentUiConnection.temperature,
        };
    }

    if (!validateConnectionProfilePreflight(effectiveProfile)) {
        return null;
    }

    return {
        profileSettings: effectiveProfile,
        summaryCount: normalizeMemoryContextCount(advanced.memoryCount),
        tokenThreshold,
    };
}

function getModuleSettings() {
    return stmbSettings.moduleSettings || {};
}

function getPersistedStmbState() {
    const context = getContext();
    const metadata = context?.chatMetadata || chat_metadata;
    if (!metadata[STMB_METADATA_KEY] || typeof metadata[STMB_METADATA_KEY] !== 'object') {
        metadata[STMB_METADATA_KEY] = {};
    }

    return metadata[STMB_METADATA_KEY];
}

function resolveStmbStateChatKey(chatScope = null) {
    if (typeof chatScope === 'string') {
        return String(chatScope).trim() || '__stmb__';
    }

    return String(getStmbChatKey(chatScope || buildStmbSceneContext()) || '__stmb__').trim() || '__stmb__';
}

function getStmbVolatileState(chatScope = null) {
    const resolvedChatKey = resolveStmbStateChatKey(chatScope);
    if (!stmbVolatileStateByChat.has(resolvedChatKey)) {
        stmbVolatileStateByChat.set(resolvedChatKey, {});
    }
    return stmbVolatileStateByChat.get(resolvedChatKey);
}

function migrateVolatileStmbState(persistedState, volatileState) {
    let changed = false;
    for (const key of STMB_VOLATILE_STATE_KEYS) {
        if (!Object.hasOwn(volatileState, key) && Object.hasOwn(persistedState, key)) {
            volatileState[key] = structuredClone(persistedState[key]);
        }
        if (Object.hasOwn(persistedState, key)) {
            delete persistedState[key];
            changed = true;
        }
    }
    return changed;
}

function getStmbState(chatScope = null) {
    const persistedState = getPersistedStmbState();
    const volatileState = getStmbVolatileState(chatScope);
    if (migrateVolatileStmbState(persistedState, volatileState)) {
        saveMetadataDebounced();
    }

    return new Proxy(persistedState, {
        get(target, property, receiver) {
            if (typeof property === 'string' && STMB_VOLATILE_STATE_KEYS.has(property)) {
                return volatileState[property];
            }
            return Reflect.get(target, property, receiver);
        },
        set(target, property, value, receiver) {
            if (typeof property === 'string' && STMB_VOLATILE_STATE_KEYS.has(property)) {
                volatileState[property] = value;
                return true;
            }
            return Reflect.set(target, property, value, receiver);
        },
        deleteProperty(target, property) {
            if (typeof property === 'string' && STMB_VOLATILE_STATE_KEYS.has(property)) {
                delete volatileState[property];
                return true;
            }
            return Reflect.deleteProperty(target, property);
        },
        has(target, property) {
            if (typeof property === 'string' && STMB_VOLATILE_STATE_KEYS.has(property)) {
                return Object.hasOwn(volatileState, property);
            }
            return Reflect.has(target, property);
        },
        ownKeys(target) {
            return Array.from(new Set([
                ...Reflect.ownKeys(target),
                ...Reflect.ownKeys(volatileState),
            ]));
        },
        getOwnPropertyDescriptor(target, property) {
            if (typeof property === 'string' && STMB_VOLATILE_STATE_KEYS.has(property) && Object.hasOwn(volatileState, property)) {
                return {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: volatileState[property],
                };
            }
            return Reflect.getOwnPropertyDescriptor(target, property);
        },
    });
}

function getChatContextSettingKey(chatScope = null) {
    const key = String(getStmbState(chatScope).contextSettingKey || '').trim();
    return key && key !== STMB_CONTEXT_NONE_KEY ? key : STMB_CONTEXT_NONE_KEY;
}

function setChatContextSettingKey(key) {
    const normalized = String(key || '').trim();
    const state = getStmbState();
    if (!normalized || normalized === STMB_CONTEXT_NONE_KEY) {
        delete state.contextSettingKey;
    } else {
        state.contextSettingKey = normalized;
    }
    saveMetadataDebounced();
}

async function resolveCurrentChatAdditionalContextEntries(options = {}) {
    return await resolveAdditionalContextEntriesForKey(getChatContextSettingKey(), options);
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
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
}

function setSceneRange(sceneStart, sceneEnd, chatScope = null) {
    const state = getStmbState(chatScope);
    state.sceneStart = Number(sceneStart);
    state.sceneEnd = Number(sceneEnd);
    saveMetadataDebounced();
    renderAllSceneButtons();
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
}

function clearSceneMarkers() {
    const state = getStmbState();
    delete state.sceneStart;
    delete state.sceneEnd;
    saveMetadataDebounced();
    renderAllSceneButtons();
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
}

function getHighestProcessedMessageId() {
    const state = getStmbState();
    return Number.isInteger(state.highestMemoryProcessed) ? state.highestMemoryProcessed : null;
}

function isMemoryBoundaryDividerEnabled(mode = getModuleSettings().memoryBoundaryMode) {
    const normalized = normalizeStmbMemoryBoundaryMode(mode);
    return normalized === STMB_MEMORY_BOUNDARY_MODES.DIVIDER || normalized === STMB_MEMORY_BOUNDARY_MODES.BOTH;
}

function isMemoryBoundaryButtonEnabled(mode = getModuleSettings().memoryBoundaryMode) {
    const normalized = normalizeStmbMemoryBoundaryMode(mode);
    return power_user.show_floating_memory_boundary_button !== false
        && (normalized === STMB_MEMORY_BOUNDARY_MODES.BUTTON || normalized === STMB_MEMORY_BOUNDARY_MODES.BOTH);
}

function getMemoryBoundaryTargetId() {
    const highestProcessed = getHighestProcessedMessageId();
    if (!Number.isInteger(highestProcessed)) {
        return null;
    }

    const nextId = highestProcessed + 1;
    if (nextId >= 0 && nextId < chat.length) {
        return nextId;
    }

    if (highestProcessed >= 0 && highestProcessed < chat.length) {
        return highestProcessed;
    }

    return null;
}

function getRenderedMessageElement(messageId) {
    if (!Number.isInteger(messageId)) {
        return null;
    }
    return chatElement.find(`.mes[mesid="${messageId}"]`).get(0) || null;
}

function clearMemoryBoundaryDivider() {
    document.querySelectorAll('.stmb_memory_boundary_divider').forEach(element => element.remove());
    document.querySelectorAll('.stmb_memory_boundary_target').forEach(element => {
        element.classList.remove('stmb_memory_boundary_target');
    });
}

function refreshMemoryBoundaryDivider() {
    clearMemoryBoundaryDivider();

    if (!isMemoryBoundaryDividerEnabled()) {
        return;
    }

    const targetId = getMemoryBoundaryTargetId();
    const targetElement = getRenderedMessageElement(targetId);
    if (!targetElement) {
        return;
    }

    const divider = document.createElement('div');
    divider.classList.add('stmb_memory_boundary_divider');
    divider.textContent = 'Memory Books boundary';
    targetElement.classList.add('stmb_memory_boundary_target');
    targetElement.prepend(divider);
}

function getFallbackFloatingJumpButtonPosition(defaultRight, defaultBottom) {
    return {
        left: window.innerWidth - FLOATING_JUMP_BUTTON_SIZE - defaultRight,
        top: window.innerHeight - FLOATING_JUMP_BUTTON_SIZE - defaultBottom,
    };
}

function getMemoryBoundaryButtonFallbackPosition() {
    return getFallbackFloatingJumpButtonPosition(MEMORY_BOUNDARY_BUTTON_DEFAULT_RIGHT, MEMORY_BOUNDARY_BUTTON_DEFAULT_BOTTOM);
}

function getChatEndButtonFallbackPosition() {
    const wandButton = document.getElementById('extensionsMenuButton');
    const wandRect = wandButton?.getBoundingClientRect();
    const hasVisibleWand = wandButton
        && !wandButton.hidden
        && getComputedStyle(wandButton).display !== 'none'
        && wandRect
        && wandRect.width > 0
        && wandRect.height > 0;

    if (!hasVisibleWand) {
        return getFallbackFloatingJumpButtonPosition(CHAT_END_BUTTON_DEFAULT_RIGHT, CHAT_END_BUTTON_DEFAULT_BOTTOM);
    }

    const rightSideLeft = wandRect.right + FLOATING_JUMP_BUTTON_WAND_GAP;
    const leftSideLeft = wandRect.left - FLOATING_JUMP_BUTTON_SIZE - FLOATING_JUMP_BUTTON_WAND_GAP;
    const left = rightSideLeft + FLOATING_JUMP_BUTTON_SIZE <= window.innerWidth - FLOATING_JUMP_BUTTON_MARGIN
        ? rightSideLeft
        : leftSideLeft;

    return {
        left,
        top: wandRect.top + ((wandRect.height - FLOATING_JUMP_BUTTON_SIZE) / 2),
    };
}

function clampFloatingJumpButtonPosition(position = {}, fallbackPosition = getFallbackFloatingJumpButtonPosition(CHAT_END_BUTTON_DEFAULT_RIGHT, CHAT_END_BUTTON_DEFAULT_BOTTOM)) {
    const maxLeft = Math.max(FLOATING_JUMP_BUTTON_MARGIN, window.innerWidth - FLOATING_JUMP_BUTTON_SIZE - FLOATING_JUMP_BUTTON_MARGIN);
    const maxTop = Math.max(FLOATING_JUMP_BUTTON_MARGIN, window.innerHeight - FLOATING_JUMP_BUTTON_SIZE - FLOATING_JUMP_BUTTON_MARGIN);
    const rawLeft = Number.isFinite(Number(position.left)) ? Number(position.left) : fallbackPosition.left;
    const rawTop = Number.isFinite(Number(position.top)) ? Number(position.top) : fallbackPosition.top;

    return {
        left: Math.round(Math.min(Math.max(rawLeft, FLOATING_JUMP_BUTTON_MARGIN), maxLeft)),
        top: Math.round(Math.min(Math.max(rawTop, FLOATING_JUMP_BUTTON_MARGIN), maxTop)),
    };
}

function getManualCharacterLorebookBindings(state = getStmbState()) {
    if (!state.manualCharacterLorebooks || typeof state.manualCharacterLorebooks !== 'object' || Array.isArray(state.manualCharacterLorebooks)) {
        state.manualCharacterLorebooks = {};
    }
    return state.manualCharacterLorebooks;
}

function getStmbGroupMembers(sceneContext = buildStmbSceneContext()) {
    return (Array.isArray(sceneContext?.groupParticipants) ? sceneContext.groupParticipants : [])
        .filter(member => member?.key && member?.characterFilterName)
        .map(member => ({
            key: String(member.key),
            avatar: String(member.avatar || member.key),
            memberId: String(member.memberId || member.avatar || member.key),
            name: String(member.name || member.key),
            characterFilterName: String(member.characterFilterName),
        }));
}

function getManualGroupBindingSnapshot(sceneContext = buildStmbSceneContext(), state = getStmbState(sceneContext)) {
    return {
        members: structuredClone(getStmbGroupMembers(sceneContext)),
        bindings: structuredClone(getManualCharacterLorebookBindings(state)),
        canonicalLorebookName: String(state.manualLorebook || '').trim(),
    };
}

function validateManualGroupBindingSnapshot(snapshot) {
    const members = Array.isArray(snapshot?.members) ? snapshot.members : [];
    const bindings = snapshot?.bindings && typeof snapshot.bindings === 'object' ? snapshot.bindings : {};
    const canonicalLorebookName = String(snapshot?.canonicalLorebookName || '').trim();
    if (members.length === 0) {
        throw new Error('No group members are available for manual lorebook setup.');
    }
    const issues = [];
    for (const member of members) {
        const lorebookName = String(bindings[member.key] || '').trim();
        if (!lorebookName) issues.push(`${member.name}: no lorebook selected`);
        else if (canonicalLorebookName && lorebookName === canonicalLorebookName) issues.push(`${member.name}: character lorebook cannot be the group Memory Book`);
        else if (!world_names.includes(lorebookName) || isReservedTemplateWorldName(lorebookName)) issues.push(`${member.name}: "${lorebookName}" not found`);
    }
    if (issues.length > 0) {
        throw new Error(`Group manual lorebooks are incomplete: ${issues.join('; ')}`);
    }
    return { members, bindings, canonicalLorebookName };
}

async function confirmGroupMemoryParticipants(compiledScene, snapshot) {
    const allNames = normalizeStmbCharacterFilterNames(snapshot.members.map(member => member.characterFilterName));
    const detectedNames = normalizeStmbCharacterFilterNames(compiledScene?.metadata?.characterFilterNames)
        .filter(name => allNames.includes(name));
    if (getModuleSettings().autoAcceptGroupParticipants) {
        return detectedNames.length > 0 ? detectedNames : allNames;
    }

    const selected = new Set(detectedNames.length > 0 ? detectedNames : allNames);
    const rows = snapshot.members.map(member => `
        <label class="checkbox_label">
            <input type="checkbox" class="stmb-group-participant" value="${escapeHtml(member.characterFilterName)}" ${selected.has(member.characterFilterName) ? 'checked' : ''}>
            <span>${escapeHtml(member.name)}</span>
        </label>`).join('');
    const popup = new Popup(DOMPurify.sanitize(`
        <h3>Confirm memory participants</h3>
        <p>Select the characters this memory applies to. If none are selected, it will apply to every group character.</p>
        <div class="world_entry_form_control flex-container flexFlowColumn">${rows}</div>
        <label class="checkbox_label"><input type="checkbox" id="stmb-group-participants-auto"> <span>Automatically accept detected participants in future</span></label>
    `), POPUP_TYPE.CONFIRM, '', { okButton: 'Save', cancelButton: 'Cancel' });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    const chosen = Array.from(popup.dlg.querySelectorAll('.stmb-group-participant'))
        .filter(input => input.checked)
        .map(input => input.value);
    if (popup.dlg.querySelector('#stmb-group-participants-auto')?.checked) {
        getModuleSettings().autoAcceptGroupParticipants = true;
        saveSettingsDebounced();
    }
    return normalizeStmbCharacterFilterNames(chosen.length > 0 ? chosen : allNames);
}

async function prepareGroupMemoryParticipantSnapshot(compiledScene, sceneContext) {
    if (!sceneContext?.isGroupChat) return null;
    const rawSnapshot = getManualGroupBindingSnapshot(sceneContext);
    const snapshot = getModuleSettings().manualModeEnabled
        ? validateManualGroupBindingSnapshot(rawSnapshot)
        : rawSnapshot;
    const characterFilterNames = await confirmGroupMemoryParticipants(compiledScene, snapshot);
    if (!characterFilterNames) return null;
    compiledScene.metadata = {
        ...(compiledScene.metadata || {}),
        groupName: sceneContext.groupName || compiledScene?.metadata?.groupName || '',
        stmbPromptTarget: 'group',
        characterFilterNames,
    };
    return { ...snapshot, characterFilterNames };
}

function getFloatingButtonDeviceProfile() {
    return isMobile() ? 'mobile' : 'desktop';
}

function isValidFloatingJumpButtonPosition(position) {
    return Number.isFinite(Number(position?.left)) && Number.isFinite(Number(position?.top));
}

function getSavedFloatingJumpButtonPosition(positionKey, legacyPositionKey) {
    const moduleSettings = getModuleSettings();
    const deviceProfile = getFloatingButtonDeviceProfile();
    const profilePosition = moduleSettings.floatingButtonPositions?.[deviceProfile]?.[positionKey];

    if (isValidFloatingJumpButtonPosition(profilePosition)) {
        return profilePosition;
    }

    if (deviceProfile === 'desktop' && isValidFloatingJumpButtonPosition(moduleSettings[legacyPositionKey])) {
        return moduleSettings[legacyPositionKey];
    }

    return null;
}

function saveFloatingJumpButtonPosition(positionKey, position, getFallbackPosition) {
    const deviceProfile = getFloatingButtonDeviceProfile();
    const moduleSettings = stmbSettings.moduleSettings || {};
    const floatingButtonPositions = moduleSettings.floatingButtonPositions && typeof moduleSettings.floatingButtonPositions === 'object'
        ? moduleSettings.floatingButtonPositions
        : {};
    const profilePositions = floatingButtonPositions[deviceProfile] && typeof floatingButtonPositions[deviceProfile] === 'object'
        ? floatingButtonPositions[deviceProfile]
        : {};

    profilePositions[positionKey] = clampFloatingJumpButtonPosition(position, getFallbackPosition());
    floatingButtonPositions[deviceProfile] = profilePositions;
    moduleSettings.floatingButtonPositions = floatingButtonPositions;
    stmbSettings.moduleSettings = moduleSettings;
    stmbSettings = normalizeStmbSettings(stmbSettings);
    saveSettingsDebounced();
}

function applyFloatingJumpButtonPosition(button, savedPosition, getFallbackPosition) {
    if (!button) {
        return;
    }

    const fallbackPosition = getFallbackPosition();
    const position = clampFloatingJumpButtonPosition(savedPosition || {}, fallbackPosition);
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
}

function saveMemoryBoundaryButtonPosition(position) {
    saveFloatingJumpButtonPosition('memoryBoundary', position, getMemoryBoundaryButtonFallbackPosition);
}

function saveChatEndButtonPosition(position) {
    saveFloatingJumpButtonPosition('chatEnd', position, getChatEndButtonFallbackPosition);
}

function showNoMemoryBoundaryToast() {
    toastr.info('No memories have been processed for this chat yet.', 'STMB');
}

async function scrollToMemoryBoundaryTarget() {
    const targetId = getMemoryBoundaryTargetId();
    if (!Number.isInteger(targetId)) {
        showNoMemoryBoundaryToast();
        return;
    }

    const target = await jumpToMessageWindow(targetId);
    if (target?.length) {
        refreshMemoryBoundaryDivider();
        if (await scrollChatElementIntoView(target, 'auto')) {
            flashHighlight(target, 2000);
            return;
        }
    }

    const highestProcessed = getHighestProcessedMessageId();
    toastr.info(`Highest memory is #${highestProcessed}. The target message could not be rendered.`, 'STMB');
}

async function scrollToChatEndTarget() {
    if (!chat.length) {
        toastr.info('No chat messages are available yet.', 'STMB');
        return;
    }

    const targetId = chat.length - 1;
    const target = await jumpToMessageWindow(targetId);
    const chatContainer = chatElement.get(0);

    if (target?.length && chatContainer instanceof HTMLElement) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
        flashHighlight(target, 2000);
        return;
    }

    toastr.info('The end of chat could not be rendered.', 'STMB');
}

function handleFloatingJumpButtonPointerMove(event) {
    if (!floatingJumpButtonDragState) {
        return;
    }

    const { button, getFallbackPosition } = floatingJumpButtonDragState;
    const position = clampFloatingJumpButtonPosition({
        left: event.clientX - floatingJumpButtonDragState.offsetX,
        top: event.clientY - floatingJumpButtonDragState.offsetY,
    }, getFallbackPosition());

    if (
        Math.abs(position.left - floatingJumpButtonDragState.startLeft) > 2 ||
        Math.abs(position.top - floatingJumpButtonDragState.startTop) > 2
    ) {
        floatingJumpButtonDragState.moved = true;
    }

    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
}

function handleFloatingJumpButtonPointerUp() {
    if (!floatingJumpButtonDragState) {
        return;
    }

    const { button, moved, savePosition } = floatingJumpButtonDragState;
    const position = button
        ? {
            left: Number.parseInt(button.style.left, 10),
            top: Number.parseInt(button.style.top, 10),
        }
        : null;

    document.removeEventListener('pointermove', handleFloatingJumpButtonPointerMove);
    document.removeEventListener('pointerup', handleFloatingJumpButtonPointerUp);
    document.removeEventListener('pointercancel', handleFloatingJumpButtonPointerUp);
    floatingJumpButtonDragState = null;
    if (!button || !position) {
        return;
    }

    savePosition(position);

    if (moved) {
        button.dataset.stmbDragged = 'true';
        setTimeout(() => {
            if (button.isConnected) {
                delete button.dataset.stmbDragged;
            }
        }, 0);
    }
}

function bindFloatingJumpButtonDrag(button, getFallbackPosition, savePosition) {
    button.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        const rect = button.getBoundingClientRect();
        floatingJumpButtonDragState = {
            button,
            getFallbackPosition,
            savePosition,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            startLeft: rect.left,
            startTop: rect.top,
            moved: false,
        };
        document.addEventListener('pointermove', handleFloatingJumpButtonPointerMove);
        document.addEventListener('pointerup', handleFloatingJumpButtonPointerUp);
        document.addEventListener('pointercancel', handleFloatingJumpButtonPointerUp);
    });
}

function createFloatingJumpButton({ id, title, icon, onClick, getFallbackPosition, savePosition }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.classList.add('stmb_memory_boundary_button', 'interactable');
    button.title = title;
    button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
    bindFloatingJumpButtonDrag(button, getFallbackPosition, savePosition);

    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.stmbDragged === 'true') {
            return;
        }
        onClick();
    });

    document.body.appendChild(button);
    applyLocale(button);
    return button;
}

function createMemoryBoundaryButton() {
    return createFloatingJumpButton({
        id: 'stmb-memory-boundary-jump',
        title: translate('Jump to first unprocessed message', 'STMemoryBooks_JumpToUnprocessedMemory'),
        icon: 'fa-angles-up',
        getFallbackPosition: getMemoryBoundaryButtonFallbackPosition,
        savePosition: saveMemoryBoundaryButtonPosition,
        onClick: () => scrollToMemoryBoundaryTarget().catch(error => {
            console.warn('STMB memory boundary jump failed', error);
            toastr.error('Failed to jump to the Memory Books boundary.', 'STMB');
        }),
    });
}

function createChatEndButton() {
    return createFloatingJumpButton({
        id: 'stmb-chat-end-jump',
        title: 'Jump to end of chat',
        icon: 'fa-angles-down',
        getFallbackPosition: getChatEndButtonFallbackPosition,
        savePosition: saveChatEndButtonPosition,
        onClick: () => scrollToChatEndTarget().catch(error => {
            console.warn('STMB chat end jump failed', error);
            toastr.error('Failed to jump to the end of chat.', 'STMB');
        }),
    });
}

function refreshMemoryBoundaryButton() {
    if (!isMemoryBoundaryButtonEnabled()) {
        memoryBoundaryButton?.remove();
        memoryBoundaryButton = null;
        return;
    }

    if (!memoryBoundaryButton) {
        memoryBoundaryButton = createMemoryBoundaryButton();
    }

    applyFloatingJumpButtonPosition(
        memoryBoundaryButton,
        getSavedFloatingJumpButtonPosition('memoryBoundary', 'memoryBoundaryButtonPosition'),
        getMemoryBoundaryButtonFallbackPosition,
    );
    memoryBoundaryButton.style.display = 'inline-flex';
}

function refreshChatEndButton() {
    if (power_user.show_floating_chat_end_button === false) {
        chatEndButton?.remove();
        chatEndButton = null;
        return;
    }

    if (!chatEndButton) {
        chatEndButton = createChatEndButton();
    }

    applyFloatingJumpButtonPosition(
        chatEndButton,
        getSavedFloatingJumpButtonPosition('chatEnd', 'chatEndButtonPosition'),
        getChatEndButtonFallbackPosition,
    );
    chatEndButton.style.display = 'inline-flex';
}

function refreshFloatingJumpButtons() {
    refreshMemoryBoundaryButton();
    refreshChatEndButton();
}

/** Refreshes the visible STMB processed-message boundary without changing chat state. */
function refreshMemoryBoundaryUi() {
    refreshMemoryBoundaryDivider();
    refreshFloatingJumpButtons();
}

function setHighestProcessedMessageId(messageId) {
    const state = getStmbState();
    state.highestMemoryProcessed = Number(messageId);
    delete state.highestMemoryProcessedManuallySet;
    saveMetadataDebounced();
    refreshMemoryBoundaryUi();
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
}

function getSceneButtonElements(messageElement) {
    return {
        startButton: messageElement.querySelector('.mes_stmb_start'),
        endButton: messageElement.querySelector('.mes_stmb_end'),
    };
}

function renderSceneButtonsForMessage(messageElement) {
    const messageId = Number(messageElement.getAttribute('mesid'));
    if (!Number.isInteger(messageId)) {
        return;
    }

    messageElement.querySelectorAll('.extraMesButtons .mes_stmb_clip').forEach(button => button.remove());

    const { sceneStart, sceneEnd } = getSceneMarkers();
    const { startButton, endButton } = getSceneButtonElements(messageElement);
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
    refreshMemoryBoundaryUi();
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
    const chatId = selected_group
        ? String(group?.chat_id || context?.chatId || getCurrentChatId() || '')
        : String(context?.chatId || getCurrentChatId() || '');

    return {
        sceneStart: range.sceneStart,
        sceneEnd: range.sceneEnd,
        chatId,
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
    if (sceneStart < 0 || sceneEnd < 0) {
        throw new Error(`Message IDs out of range. Valid range: 0-${Math.max(chat.length - 1, 0)}`);
    }
    if (sceneStart >= chat.length || sceneEnd >= chat.length) {
        throw new Error(`Message IDs out of range. Valid range: 0-${Math.max(chat.length - 1, 0)}`);
    }
}

function getCurrentSceneRange() {
    const markers = getSceneMarkers();
    if (!Number.isInteger(markers.sceneStart) || !Number.isInteger(markers.sceneEnd)) {
        throw new Error('No scene markers set');
    }

    assertRangeWithinCurrentChat(markers);
    return {
        sceneStart: markers.sceneStart,
        sceneEnd: markers.sceneEnd,
    };
}

async function getNextMemoryRange() {
    const sceneContext = buildStmbSceneContext();
    const state = getStmbState();
    const highestProcessed = Number.isInteger(state?.highestMemoryProcessed)
        ? state.highestMemoryProcessed
        : null;
    const sceneStart = highestProcessed === null ? 0 : highestProcessed + 1;
    const rangeInfo = await fetchStmbChatRangeInfo({
        rangeStart: sceneStart,
        sceneContext,
    });
    const sceneEnd = Number(rangeInfo?.lastAvailableMessageId);

    if (!Number.isInteger(sceneEnd) || sceneStart > sceneEnd) {
        throw new Error('No new messages available for /nextmemory');
    }

    if (Array.isArray(rangeInfo?.missingRanges) && rangeInfo.missingRanges.length > 0) {
        const missing = rangeInfo.missingRanges[0];
        throw new Error(`Cannot capture messages ${sceneStart}-${sceneEnd} because messages ${missing.start}-${missing.end} are unavailable in chat storage.`);
    }

    return { sceneStart, sceneEnd };
}

function validateMemoryCreationContext() {
    const context = getContext();
    const group = selected_group ? groups.find(item => item.id === selected_group) : null;
    const isGroupChat = Boolean(selected_group);

    if (!isGroupChat) {
        const activeCharacter = context?.characters?.[context.characterId];
        if (!activeCharacter && !String(name2 || '').trim()) {
            toastr.error(
                'SillyTavern is still loading character data, please wait a few seconds and try again.',
                'STMB',
            );
            return null;
        }
    } else if (!group?.name) {
        toastr.error(
            'Group chat data not available, please wait a few seconds and try again.',
            'STMB',
        );
        return null;
    }

    return { context, group, isGroupChat };
}

async function resolveAutoSummaryLorebook(options = {}) {
    const sceneContext = options.sceneContext || null;
    const currentMessageCount = Number.isFinite(Number(options.currentMessageCount))
        ? Math.max(0, Math.trunc(Number(options.currentMessageCount)))
        : chat.length;
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

    const state = getStmbState(sceneContext);
    let lorebookName = String(state.manualLorebook || '').trim();
    if (!lorebookName) {
        const decision = await showAutoSummaryDecisionPopup();
        if (decision.action !== 'select') {
            const postponeMessages = Number.isFinite(Number(decision.postponeMessages))
                ? Number(decision.postponeMessages)
                : 10;
            state.autoSummaryNextPromptAt = currentMessageCount + postponeMessages;
            return {
                valid: false,
                lorebookName: null,
                error: `Auto-summary postponed for ${postponeMessages} messages.`,
            };
        }

        const selectedLorebook = await showLorebookPickerPopup(getManualPrimaryLorebookNames(sceneContext), {
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

    try {
        const resolvedLorebookName = await ensureResolvedLorebookName({
            manualMode: true,
            getManualLorebook: () => state.manualLorebook,
            setManualLorebook: async selectedLorebook => {
                state.manualLorebook = String(selectedLorebook || '').trim();
                saveMetadataDebounced();
            },
            createContext: 'auto-summary',
        });
        return {
            valid: Boolean(resolvedLorebookName),
            lorebookName: resolvedLorebookName || null,
            error: resolvedLorebookName ? '' : 'No manual lorebook selected',
        };
    } catch (error) {
        if (isStmbLorebookHandledError(error)) {
            return {
                valid: false,
                lorebookName: null,
                error: String(error?.message || 'No manual lorebook selected'),
            };
        }

        return {
            valid: false,
            lorebookName: null,
            error: String(error?.message || 'No manual lorebook selected'),
        };
    }
}

async function checkAutoSummaryTrigger(options = {}) {
    const settings = getModuleSettings();
    if (!settings.autoSummaryEnabled) {
        return;
    }

    const sceneContext = options.sceneContext || buildStmbSceneContext();
    const state = getStmbState(sceneContext);
    const rangeInfo = await fetchStmbChatRangeInfo({ saveFirst: false, sceneContext });
    const currentLastMessage = Number(rangeInfo?.lastAvailableMessageId);
    if (!Number.isInteger(currentLastMessage) || currentLastMessage < 0) {
        return;
    }

    const currentMessageCount = currentLastMessage + 1;
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

    if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(sceneContext))) {
        return;
    }

    const messagesSinceLastMemory = currentLastMessage - highestProcessed;
    if (messagesSinceLastMemory < requiredTotal) {
        return;
    }

    if (Number.isInteger(state.autoSummaryNextPromptAt) && currentMessageCount < state.autoSummaryNextPromptAt) {
        return;
    }

    const lorebookResolution = await resolveAutoSummaryLorebook({ sceneContext, currentMessageCount });
    if (!lorebookResolution.valid) {
        console.warn('STMB auto-summary blocked by lorebook resolution', lorebookResolution.error);
        return;
    }

    if (Number.isInteger(state.autoSummaryNextPromptAt)) {
        getStmbState(sceneContext).autoSummaryNextPromptAt = null;
    }

    const sceneStart = highestProcessed + 1;
    const sceneEnd = Math.max(0, currentLastMessage - buffer);
    if (sceneStart > sceneEnd) {
        return;
    }

    setSceneRange(sceneStart, sceneEnd, sceneContext);
    await initiateMemoryCreation({ range: { sceneStart, sceneEnd }, keepSceneMarkers: false, sceneContext, source: 'autoSummary' });
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

    if (changed) {
        saveMetadataDebounced();
        refreshOpenSettingsPopupSceneState().catch(error => {
            console.warn('STMB settings popup scene refresh failed', error);
        });
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
    const result = applyDeletedMessageToSceneState(state, id, chat.length);

    if (result.changed) {
        state.sceneStart = result.sceneStart;
        state.sceneEnd = result.sceneEnd;
        state.highestMemoryProcessed = result.highestProcessed;
        if (result.highestProcessed === null) {
            delete state.highestMemoryProcessed;
            delete state.highestMemoryProcessedManuallySet;
        }
        saveMetadataDebounced();
        if (result.sceneChanged && getModuleSettings().showNotifications) {
            toastr.warning(result.toastrMessage, 'STMB');
        }
        refreshOpenSettingsPopupSceneState().catch(error => {
            console.warn('STMB settings popup scene refresh failed', error);
        });
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

function getCompactionProfileForRuntime(profileIndex) {
    const profile = structuredClone(getActiveStmbProfile(stmbSettings, profileIndex));
    const api = String(profile?.connection?.api || '').trim().toLowerCase();
    if (api && api !== 'current_st' && profile?.connection && !Number.isFinite(Number(profile.connection.temperature))) {
        profile.connection.temperature = 0.3;
    }
    return profile;
}

function configureClipRuntime() {
    configureStmbClipRuntime({
        getSettings: () => stmbSettings,
        persistSettings: () => {
            stmbSettings = normalizeStmbSettings(stmbSettings);
            saveSettingsDebounced();
        },
        ensureLorebookName,
        getDefaultLorebookName: resolveLorebookName,
        getProfile: getCompactionProfileForRuntime,
        buildGenerateData: async (messages, profile) => buildStmbGenerateData(messages, profile),
    });
}

function migrateStmbLorebookReferenceValue(value, oldName, newName = '') {
    return String(value || '').trim() === String(oldName || '').trim() ? String(newName || '').trim() : value;
}

function handleLorebookReferencesUpdated(payloadOrOperation = {}, oldNameArg = '', newNameArg = '') {
    const isObjectPayload = payloadOrOperation && typeof payloadOrOperation === 'object';
    const operation = String(isObjectPayload ? payloadOrOperation.operation : payloadOrOperation || '').trim();
    const oldName = isObjectPayload ? payloadOrOperation.oldName : oldNameArg;
    const newName = isObjectPayload ? payloadOrOperation.newName : newNameArg;
    const target = String(oldName || '').trim();
    const replacement = operation === 'rename' ? String(newName || '').trim() : '';
    if (!target || (operation !== 'rename' && operation !== 'delete')) {
        return;
    }

    let metadataChanged = false;
    const state = getPersistedStmbState();
    const migratedManualLorebook = migrateStmbLorebookReferenceValue(state.manualLorebook, target, replacement);
    if (migratedManualLorebook !== state.manualLorebook) {
        if (migratedManualLorebook) {
            state.manualLorebook = migratedManualLorebook;
        } else {
            delete state.manualLorebook;
        }
        metadataChanged = true;
    }

    if (state.manualCharacterLorebooks && typeof state.manualCharacterLorebooks === 'object' && !Array.isArray(state.manualCharacterLorebooks)) {
        for (const [memberKey, value] of Object.entries(state.manualCharacterLorebooks)) {
            const migrated = migrateStmbLorebookReferenceValue(value, target, replacement);
            if (migrated === value) continue;
            if (migrated) state.manualCharacterLorebooks[memberKey] = migrated;
            else delete state.manualCharacterLorebooks[memberKey];
            metadataChanged = true;
        }
        if (Object.keys(state.manualCharacterLorebooks).length === 0) delete state.manualCharacterLorebooks;
    }

    if (state.sidePromptLorebookOverrides && typeof state.sidePromptLorebookOverrides === 'object') {
        for (const [key, value] of Object.entries(state.sidePromptLorebookOverrides)) {
            const migrated = migrateStmbLorebookReferenceValue(value, target, replacement);
            if (migrated !== value) {
                if (migrated) {
                    state.sidePromptLorebookOverrides[key] = migrated;
                } else {
                    delete state.sidePromptLorebookOverrides[key];
                }
                metadataChanged = true;
            }
        }

        if (Object.keys(state.sidePromptLorebookOverrides).length === 0) {
            delete state.sidePromptLorebookOverrides;
        }
    }

    updateStmbJobsForLorebookReference({ operation, oldName: target, newName: replacement });
    migrateStmbContextSettingsLorebookReference({ operation, oldName: target, newName: replacement }).catch(error => {
        console.warn('STMB context settings lorebook reference migration failed', error);
    });
    if (metadataChanged) {
        saveMetadataDebounced();
    }
}

function renderLorebookNameFromTemplate() {
    const chatId = getCurrentChatId() || 'Chat';
    return String(getModuleSettings().lorebookNameTemplate || 'LTM - {{char}} - {{chat}}')
        .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
        .replace(/\{\{user\}\}/g, String(name1 || 'User'))
        .replace(/\{\{chat\}\}/g, String(chatId));
}

async function ensureLorebookName(createContext = 'chat') {
    return ensureResolvedLorebookName({
        manualMode: getModuleSettings().manualModeEnabled,
        getManualLorebook: () => getStmbState().manualLorebook,
        setManualLorebook: async selectedLorebook => {
            getStmbState().manualLorebook = String(selectedLorebook || '').trim();
            saveMetadataDebounced();
        },
        autoCreateLorebook: getModuleSettings().autoCreateLorebook,
        lorebookNameTemplate: getModuleSettings().lorebookNameTemplate || 'LTM - {{char}} - {{chat}}',
        lorebookOrderDefaults: getModuleSettings().lorebookOrderDefaults || null,
        createContext,
    });
}

async function validateLorebookPreflight() {
    try {
        await ensureLorebookName();
        return true;
    } catch (error) {
        if (isStmbLorebookHandledError(error)) {
            return false;
        }

        toastr.error(`No lorebook available: ${String(error?.message || 'Unknown lorebook error')}`, 'STMB');
        return false;
    }
}

function getConnectionProfilePreflightMessage(profile) {
    const connectionApi = String(profile?.connection?.api || '').trim().toLowerCase();
    const secretKey = STMB_PROFILE_SECRET_KEYS[connectionApi];
    return getStmbConnectionProfileApiKeyError(profile, {
        hasStoredApiKey: STMB_PROFILE_KEYLESS_SOURCES.has(connectionApi) || Boolean(secretKey && secret_state[secretKey]),
    });
}

function validateConnectionProfilePreflight(profile, { showToast = true } = {}) {
    const message = getConnectionProfilePreflightMessage(profile);
    if (!message) {
        return true;
    }

    if (showToast) {
        toastr.error(message, 'STMB');
    }
    return false;
}

function getMemorySchema() {
    return {
        name: 'stmb_memory',
        strict: true,
        value: STMB_DEFAULT_MEMORY_SCHEMA,
    };
}

function getSummarySchema(responseShape = 'summary') {
    return {
        name: responseShape === 'regeneration' ? 'stmb_regeneration' : 'stmb_summary',
        strict: true,
        value: responseShape === 'regeneration' ? STMB_REGENERATION_RESPONSE_SCHEMA : STMB_SUMMARY_RESPONSE_SCHEMA,
    };
}

function buildSummaryPromptMessages(prompt) {
    return [{ role: 'user', content: String(prompt || '') }];
}

async function buildStmbGenerateData(messages, profile, { jsonSchema = null } = {}) {
    const options = jsonSchema ? { jsonSchema } : {};
    const { generateData } = await buildOpenAIGenerateData('quiet', messages, options);
    return applyStmbMaxTokensToGenerateData(
        applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
        getModuleSettings().maxTokens,
    );
}

function shouldSkipStructuredOutput(profile) {
    return Boolean(profile?.skipStructuredOutput);
}

function shouldFallbackToPlainTextGeneration(error, generateData) {
    if (!generateData?.json_schema || isStmbAbortError(error)) {
        return false;
    }

    const provider = String(generateData?.chat_completion_source || '').toLowerCase();
    const stage = String(error?.stage || '').toLowerCase();
    const upstreamStatus = Number(error?.upstream_status || error?.status || 0);
    const combinedText = [
        error?.message,
        error?.providerBody,
        error?.rawResponse,
    ].map(value => String(value || '')).join('\n').toLowerCase();

    if (provider === 'custom' && (stage === 'provider_response' || stage === 'provider_request' || upstreamStatus >= 400)) {
        return true;
    }

    return combinedText.includes('response_format')
        || combinedText.includes('json_schema')
        || combinedText.includes('json_object')
        || combinedText.includes('structured output');
}

async function requestPlainTextMemory(promptText, profile, signal, onRateLimitWait = null, { applyIncomingRegex = false } = {}) {
    const result = await generateStmbText({
        generateData: await buildStmbGenerateData([{ role: 'user', content: promptText }], profile),
    }, { signal, onRateLimitWait });
    const rawText = String(result.text || '');
    assertNoProviderTruncation(result.providerResponse, rawText);
    const cleanedText = applyIncomingRegex
        ? applySelectedRegex(rawText, getModuleSettings().selectedRegexIncoming)
        : rawText;

    try {
        return parseStructuredMemoryResponse(cleanedText);
    } catch (error) {
        error.rawResponse = cleanedText || rawText || JSON.stringify(result?.providerResponse ?? {});
        error.providerBody = JSON.stringify(result?.providerResponse ?? {});
        throw error;
    }
}

async function requestPlainTextSummaryDetailed(prompt, profile, signal, onRateLimitWait = null, responseShape = 'summary') {
    const result = await generateStmbText({
        generateData: await buildStmbGenerateData(buildSummaryPromptMessages(prompt), profile),
    }, { signal, onRateLimitWait });
    const rawText = String(result.text || '');
    assertNoProviderTruncation(result.providerResponse, rawText);
    return {
        parsed: parseSummaryJsonResponse(rawText, { responseShape }),
        providerResponse: result.providerResponse,
        rawResponse: serializeSummaryProviderResponse(result.providerResponse, rawText),
    };
}

async function requestStructuredMemory(compiledScene, profile, lorebookName, summaryCount, signal, onRateLimitWait = null, options = {}) {
    await firstRunInitSummaryPromptPresets(stmbSettings);
    const requestSettings = {
        ...stmbSettings,
        moduleSettings: {
            ...(stmbSettings.moduleSettings || {}),
            defaultMemoryCount: normalizeMemoryContextCount(summaryCount),
        },
    };
    const worldInfo = options?.worldInfoOverride && typeof options.worldInfoOverride === 'object'
        ? options.worldInfoOverride
        : await loadWorldInfo(lorebookName) || { entries: {} };
    const hasContextSettingKey = Object.hasOwn(options || {}, 'contextSettingKey');
    const contextSettingKey = hasContextSettingKey
        ? (options.contextSettingKey || STMB_CONTEXT_NONE_KEY)
        : getChatContextSettingKey();
    const additionalContextEntries = Array.isArray(options.additionalContextEntries)
        ? options.additionalContextEntries
        : await resolveAdditionalContextEntriesForKey(contextSettingKey);
    let promptText = buildMemoryPromptText(compiledScene, profile, worldInfo, requestSettings, additionalContextEntries);
    if (getModuleSettings().useRegex) {
        promptText = applySelectedRegex(promptText, getModuleSettings().selectedRegexOutgoing);
    }

    if (shouldSkipStructuredOutput(profile)) {
        return await requestPlainTextMemory(promptText, profile, signal, onRateLimitWait, {
            applyIncomingRegex: Boolean(getModuleSettings().useRegex),
        });
    }

    if (!getModuleSettings().useRegex) {
        const finalGenerateData = await buildStmbGenerateData(
            [{ role: 'user', content: promptText }],
            profile,
            { jsonSchema: getMemorySchema() },
        );
        try {
            const result = await generateStmbMemory({
                generateData: finalGenerateData,
            }, { signal, onRateLimitWait });
            return result.memory;
        } catch (error) {
            if (!shouldFallbackToPlainTextGeneration(error, finalGenerateData)) {
                throw error;
            }

            console.warn('STMB structured memory request failed; retrying as plain-text chat completion.', {
                provider: finalGenerateData.chat_completion_source,
                model: finalGenerateData.model,
            });
            return await requestPlainTextMemory(promptText, profile, signal, onRateLimitWait);
        }
    }

    return await requestPlainTextMemory(promptText, profile, signal, onRateLimitWait, { applyIncomingRegex: true });
}

function serializeSummaryProviderResponse(providerResponse, fallback = '') {
    if (typeof fallback === 'string' && fallback.trim()) {
        return fallback.trim();
    }
    if (typeof providerResponse === 'string' && providerResponse.trim()) {
        return providerResponse.trim();
    }
    if (Array.isArray(providerResponse?.choices)) {
        const messageContent = providerResponse.choices[0]?.message?.content;
        if (typeof messageContent === 'string' && messageContent.trim()) {
            return messageContent.trim();
        }
        if (Array.isArray(messageContent)) {
            const joinedText = messageContent
                .map(part => typeof part?.text === 'string' ? part.text : '')
                .join('')
                .trim();
            if (joinedText) {
                return joinedText;
            }
        }
        if (typeof providerResponse.choices[0]?.text === 'string' && providerResponse.choices[0].text.trim()) {
            return providerResponse.choices[0].text.trim();
        }
    }
    if (typeof providerResponse?.content === 'string' && providerResponse.content.trim()) {
        return providerResponse.content.trim();
    }
    try {
        return JSON.stringify(providerResponse ?? {}, null, 2);
    } catch {
        return String(providerResponse ?? '').trim();
    }
}

function assertNoProviderTruncation(providerResponse, fallbackText = '') {
    const finishReason = providerResponse?.choices?.[0]?.finish_reason || providerResponse?.finish_reason || providerResponse?.stop_reason;
    const normalizedFinishReason = typeof finishReason === 'string' ? finishReason.toLowerCase() : '';

    if (normalizedFinishReason.includes('length') || normalizedFinishReason.includes('max')) {
        const error = new Error('Model response appears truncated (provider finish_reason). Please increase Max Response Length.');
        error.name = 'StmbStructuredParseError';
        error.code = 'PROVIDER_TRUNCATION';
        error.rawResponse = String(fallbackText || '').trim();
        error.providerBody = serializeSummaryProviderResponse(providerResponse);
        throw error;
    }

    if (providerResponse?.truncated === true) {
        const error = new Error('Model response appears truncated (provider flag). Please increase Max Response Length.');
        error.name = 'StmbStructuredParseError';
        error.code = 'PROVIDER_TRUNCATION_FLAG';
        error.rawResponse = String(fallbackText || '').trim();
        error.providerBody = serializeSummaryProviderResponse(providerResponse);
        throw error;
    }
}

async function requestStructuredSummaryDetailed(prompt, profile, signal, onRateLimitWait = null, responseShape = 'summary') {
    if (shouldSkipStructuredOutput(profile)) {
        return await requestPlainTextSummaryDetailed(prompt, profile, signal, onRateLimitWait, responseShape);
    }

    const finalGenerateData = await buildStmbGenerateData(
        buildSummaryPromptMessages(prompt),
        profile,
        { jsonSchema: getSummarySchema(responseShape) },
    );

    try {
        const result = await generateStmbSummary({
            generateData: finalGenerateData,
        }, { signal, onRateLimitWait, responseShape });
        return {
            parsed: result.parsed,
            providerResponse: result.providerResponse,
            rawResponse: serializeSummaryProviderResponse(result.providerResponse),
        };
    } catch (error) {
        if (!shouldFallbackToPlainTextGeneration(error, finalGenerateData)) {
            throw error;
        }

        console.warn('STMB structured summary request failed; retrying as plain-text chat completion.', {
            provider: finalGenerateData.chat_completion_source,
            model: finalGenerateData.model,
        });
        return await requestPlainTextSummaryDetailed(prompt, profile, signal, onRateLimitWait, responseShape);
    }
}

async function requestStructuredSummaryWithRetry(prompt, profile, signal, onRateLimitWait = null, responseShape = 'summary') {
    try {
        return await requestStructuredSummaryDetailed(prompt, profile, signal, onRateLimitWait, responseShape);
    } catch (error) {
        if (isStmbAbortError(error) || !error?.rawResponse) {
            throw error;
        }

        const repairPrompt = `${prompt}\n\nReturn ONLY the JSON object, nothing else. Ensure arrays and commas are valid.`;
        try {
            const repaired = await requestStructuredSummaryDetailed(repairPrompt, profile, signal, onRateLimitWait, responseShape);
            return {
                ...repaired,
                rawResponse: String(error.rawResponse || '').trim() || repaired.rawResponse,
                retryRawResponse: repaired.rawResponse,
            };
        } catch (retryError) {
            if (isStmbAbortError(retryError)) {
                throw retryError;
            }

            const combined = new Error(String(retryError?.message || error?.message || 'Model did not return valid summary JSON'));
            combined.name = retryError?.name || error?.name || 'StmbSummaryParseError';
            combined.code = retryError?.code || error?.code || 'PARSE_FAILED';
            combined.rawResponse = String(error?.rawResponse || '').trim();
            combined.retryRawResponse = String(retryError?.rawResponse || '').trim();
            combined.providerBody = String(retryError?.providerBody || error?.providerBody || '').trim();
            throw combined;
        }
    }
}

async function estimateSummaryPromptTokens(prompt, estimatedOutput = 500) {
    const inputTokens = await getTokenCountAsync(String(prompt || ''));
    return {
        input: Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : 0,
        total: (Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : 0) + Math.max(0, Math.trunc(Number(estimatedOutput) || 0)),
    };
}

async function runSequentialSummaryAnalysis(sourceEntries, options = {}, profile, signal, onRateLimitWait = null) {
    const {
        presetKey: requestedPresetKey = null,
        maxItemsPerPass = 15,
        maxPasses = 10,
        requiredMin = 1,
        tokenTarget = getModuleSettings().tokenWarningThreshold ?? 30000,
        targetTier = 1,
        lockedSummaries = [],
        allowAmbiguousAssignments = false,
        previousSummary = null,
        previousOrder = null,
        promptText: promptTextOverride = null,
    } = options;
    const presetKey = typeof requestedPresetKey === 'string' && requestedPresetKey.trim()
        ? requestedPresetKey.trim()
        : getDefaultArcPromptKey();
    const regenerationOnly = presetKey === CONSOLIDATION_REGENERATION_PRESET_KEY;

    const briefs = buildBriefsFromEntries(sourceEntries);
    const gapBriefs = briefs.filter(brief => brief.gapMarker);
    const remainingMap = new Map(briefs.filter(brief => !brief.gapMarker).map(brief => [String(brief.id), brief]));
    const acceptedSummaries = [];
    const singleSummaryPreset = presetKey === 'arc_alternate' || regenerationOnly;
    const maxPassesLocal = Object.prototype.hasOwnProperty.call(options, 'maxPasses')
        ? Math.max(1, Math.trunc(Number(maxPasses) || 1))
        : (singleSummaryPreset ? 1 : 10);
    const maxItems = Math.max(1, Math.trunc(Number(maxItemsPerPass) || 15));
    const minimumProgress = Math.max(1, Math.trunc(Number(requiredMin) || 1));
    const baseTokenTarget = Math.max(1000, Math.trunc(Number(tokenTarget) || 30000));
    if (!(typeof promptTextOverride === 'string' && promptTextOverride.trim())) {
        await firstRunInitArcPromptPresets(stmbSettings);
    }
    const promptText = typeof promptTextOverride === 'string' && promptTextOverride.trim()
        ? promptTextOverride
        : getRequiredArcPromptText(presetKey);

    let previousSummaryText = typeof previousSummary === 'string' && previousSummary.trim() ? previousSummary.trim() : null;
    let previousOrderValue = Number.isFinite(Number(previousOrder)) ? Math.trunc(Number(previousOrder)) : null;
    let carryBriefs = [];
    let lastRawResponse = '';
    let lastRetryRawResponse = '';

    for (let pass = 1; remainingMap.size > 0 && pass <= maxPassesLocal; pass++) {
        throwIfStmbAborted(signal);

        const remainingBriefs = Array.from(remainingMap.values()).sort((left, right) => left.order - right.order);
        const batch = [];
        for (const carry of carryBriefs) {
            if (remainingMap.has(String(carry.id)) && batch.length < maxItems) {
                batch.push(carry);
            }
        }
        for (const brief of remainingBriefs) {
            if (batch.length >= maxItems) {
                break;
            }
            if (!batch.some(item => item.id === brief.id)) {
                batch.push(brief);
            }
        }
        if (batch.length > 0 && gapBriefs.length > 0) {
            const orders = batch.map(brief => Number(brief.order || 0));
            const minimumOrder = Math.min(...orders);
            const maximumOrder = Math.max(...orders);
            for (const gap of gapBriefs) {
                const order = Number(gap.order || 0);
                if (order >= minimumOrder && order <= maximumOrder) batch.push(gap);
            }
            batch.sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
        }
        if (batch.length === 0) {
            break;
        }

        let prompt = buildSummaryAnalysisPrompt({
            briefs: batch,
            lockedSummaries,
            previousSummary: previousSummaryText,
            previousOrder: previousOrderValue,
            promptText,
            targetTier,
        });
        let tokenEstimate = await estimateSummaryPromptTokens(prompt, 500);
        const countRealBriefs = () => batch.filter(brief => !brief.gapMarker).length;
        const removeLastTrimmableBrief = () => {
            for (let index = batch.length - 1; index >= 0; index--) {
                if (batch[index]?.gapMarker) {
                    batch.splice(index, 1);
                    return true;
                }
            }
            if (countRealBriefs() > 1) {
                batch.pop();
                return true;
            }
            return false;
        };
        while (tokenEstimate.total > baseTokenTarget && removeLastTrimmableBrief()) {
            prompt = buildSummaryAnalysisPrompt({
                briefs: batch,
                lockedSummaries,
                previousSummary: previousSummaryText,
                previousOrder: previousOrderValue,
                promptText,
                targetTier,
            });
            tokenEstimate = await estimateSummaryPromptTokens(prompt, 500);
        }

        const batchEntryMap = new Map(sourceEntries.map(entry => [String(entry?.__stmbGapMarker ? entry.id : entry?.uid), entry]));
        const batchEntries = batch
            .map(brief => batchEntryMap.get(String(brief.id)))
            .filter(Boolean);
        if (batchEntries.length === 0) {
            break;
        }

        const response = await requestStructuredSummaryWithRetry(
            prompt,
            profile,
            signal,
            onRateLimitWait,
            regenerationOnly ? 'regeneration' : 'summary',
        );
        lastRawResponse = String(response.rawResponse || '').trim();
        lastRetryRawResponse = String(response.retryRawResponse || '').trim();

        const { summaryCandidates, leftovers } = createSummaryCandidatesFromResponse(response.parsed, batchEntries, { allowAmbiguousAssignments });
        const consumedIds = new Set(
            batchEntries
                .filter(entry => !entry.__stmbGapMarker)
                .map(entry => String(entry.uid))
                .filter(id => !leftovers.includes(id)),
        );

        if (summaryCandidates.length > 0) {
            for (let index = 0; index < summaryCandidates.length; index++) {
                acceptedSummaries.push(summaryCandidates[index]);
                previousSummaryText = summaryCandidates[index].summary;
                previousOrderValue = pass * 10 + index;
            }
        }

        if (consumedIds.size === 0) {
            break;
        }

        for (const consumedId of consumedIds) {
            remainingMap.delete(String(consumedId));
        }

        if (consumedIds.size < minimumProgress && pass > 1) {
            break;
        }

        carryBriefs = batch.filter(brief => leftovers.includes(String(brief.id)));
    }

    return {
        summaryCandidates: acceptedSummaries,
        leftovers: Array.from(remainingMap.keys()),
        rawResponse: lastRawResponse,
        retryRawResponse: lastRetryRawResponse,
    };
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

function buildMemorySceneData(compiledScene, range, settings = stmbSettings) {
    return {
        sceneStart: range.sceneStart,
        sceneEnd: range.sceneEnd,
        messageCount: compiledScene?.metadata?.messageCount ?? 0,
        chatId: compiledScene?.metadata?.chatId || '',
        characterName: compiledScene?.metadata?.characterName || '',
        userName: compiledScene?.metadata?.userName || '',
        groupName: compiledScene?.metadata?.groupName || '',
        stmbPromptTarget: compiledScene?.metadata?.stmbPromptTarget || '',
        characterFilterNames: normalizeStmbCharacterFilterNames(compiledScene?.metadata?.characterFilterNames),
        titleFormat: settings?.titleFormat || STMB_DEFAULT_TITLE_FORMAT,
    };
}

function shouldQueueAutoConsolidationCheck(settings, targetTier = 1) {
    if (settings?.moduleSettings?.autoConsolidationPromptEnabled !== true) {
        return false;
    }

    const configuredTargetTiers = normalizeAutoConsolidationTargetTiers(
        settings?.moduleSettings?.autoConsolidationTargetTiers,
    );
    return configuredTargetTiers.includes(Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1))));
}

function buildPostSaveHideRanges(range) {
    const autoHideMode = String(getModuleSettings().autoHideMode || 'none').toLowerCase();
    if (autoHideMode === 'none') {
        return [];
    }

    const unhiddenCount = Number.isFinite(Number(getModuleSettings().unhiddenEntriesCount))
        ? Math.max(0, Math.trunc(Number(getModuleSettings().unhiddenEntriesCount)))
        : 2;

    if (autoHideMode === 'all') {
        const hideEnd = unhiddenCount === 0 ? range.sceneEnd : range.sceneEnd - unhiddenCount;
        return hideEnd >= 0 ? [{ start: 0, end: hideEnd }] : [];
    }

    if (autoHideMode === 'last') {
        const sceneSize = range.sceneEnd - range.sceneStart + 1;
        if (unhiddenCount >= sceneSize) {
            return [];
        }

        const hideEnd = unhiddenCount === 0 ? range.sceneEnd : range.sceneEnd - unhiddenCount;
        return hideEnd >= range.sceneStart ? [{ start: range.sceneStart, end: hideEnd }] : [];
    }

    return [];
}

async function applyPostSaveLorebookEffects(lorebookName, range, sceneContext = null) {
    if (getModuleSettings().refreshEditor !== false) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn('STMB refreshEditor failed', error);
        }
    }

    const hideRanges = buildPostSaveHideRanges(range);
    if (hideRanges.length === 0) {
        return;
    }

    if (!isSceneContextCurrent(sceneContext)) {
        queueDeferredPostSaveEffects(sceneContext, { hideRanges });
        return;
    }

    try {
        for (const hideRange of hideRanges) {
            await hideChatMessageRange(hideRange.start, hideRange.end, false, null, true);
        }
    } catch (error) {
        console.warn('STMB auto-hide failed', error);
    }
}

async function applyPostSummarySaveLorebookEffects(lorebookName) {
    if (getModuleSettings().refreshEditor !== false) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn('STMB summary refreshEditor failed', error);
        }
    }
}

function showOrderClampNotifications(notifications = []) {
    const seen = new Set();
    for (const notification of Array.isArray(notifications) ? notifications : []) {
        const source = String(notification?.source || '').trim();
        const requested = Number(notification?.requested);
        const clamped = Number(notification?.clamped);
        if (!source || !Number.isFinite(requested) || !Number.isFinite(clamped)) {
            continue;
        }

        const key = `${source}|${requested}|${clamped}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        toastr.info(
            `Order range is limited to 0-9999. Current ${source} is ${requested}; clamped to ${clamped}.`,
            'STMB',
        );
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

function getSummarySourceUid(entry) {
    const uid = entry?.uid;
    return uid === undefined || uid === null ? null : String(uid);
}

function collectSummaryMemberIds(candidates) {
    const ids = new Set();
    for (const candidate of candidates || []) {
        for (const id of candidate?.memberIds || []) {
            ids.add(String(id));
        }
    }
    return ids;
}

function getSummaryEntriesById(selectedEntries, ids) {
    const wanted = new Set(Array.from(ids || []).map(String));
    return (selectedEntries || []).filter(entry => {
        const uid = getSummarySourceUid(entry);
        return uid !== null && wanted.has(uid);
    });
}

function hasAmbiguousMultiSummaryAssignments(summaryCandidates, selectedEntries) {
    const candidates = Array.isArray(summaryCandidates) ? summaryCandidates : [];
    if (candidates.length <= 1) {
        return false;
    }

    const sourceIds = new Set(
        (selectedEntries || [])
            .map(getSummarySourceUid)
            .filter(uid => uid !== null),
    );
    const seen = new Set();
    for (const candidate of candidates) {
        const memberIds = Array.isArray(candidate?.memberIds)
            ? candidate.memberIds.map(String)
            : [];
        if (!candidate?.memberIdsClear || memberIds.length === 0) {
            return true;
        }
        for (const id of memberIds) {
            if (!sourceIds.has(id) || seen.has(id)) {
                return true;
            }
            seen.add(id);
        }
    }
    return false;
}

function buildSummarySourceFingerprints(entries) {
    return Object.fromEntries(
        (entries || [])
            .filter(entry => getSummarySourceUid(entry) !== null)
            .map(entry => [String(entry.uid), fingerprintLorebookEntry(entry)]),
    );
}

function buildConsolidationApprovalRequest({
    summaryCandidates,
    selectedEntries,
    targetLabel,
    sourceLabel,
    ambiguousAssignments,
    lockedCount,
    pendingCount,
}) {
    return {
        kind: 'consolidationApproval',
        summaryCandidates: structuredClone(summaryCandidates || []),
        selectedEntries: structuredClone(selectedEntries || []),
        targetLabel,
        sourceLabel,
        ambiguousAssignments: Boolean(ambiguousAssignments),
        lockedCount: Number(lockedCount || 0),
        pendingCount: Number(pendingCount || 0),
    };
}

async function runConsolidationPreviewWorkflow({
    context,
    initialAnalysis,
    selectedEntries,
    sourceLabel,
    targetLabel,
    generateAnalysis,
    commitCandidates,
}) {
    const originalEntries = Array.isArray(selectedEntries) ? selectedEntries : [];
    const pendingIds = new Set(
        originalEntries
            .map(getSummarySourceUid)
            .filter(uid => uid !== null),
    );
    const committedCandidates = [];
    const committedEntries = [];
    const rejectedIds = new Set();
    let analysis = initialAnalysis || {};
    const getWorkflowLeftovers = () => Array.from(new Set([
        ...rejectedIds,
        ...pendingIds,
    ]));

    while (pendingIds.size > 0) {
        throwIfStmbAborted(context?.signal);
        const summaryCandidates = Array.isArray(analysis?.summaryCandidates)
            ? analysis.summaryCandidates
            : [];
        if (summaryCandidates.length === 0) {
            return {
                canceled: false,
                created: committedEntries.length,
                leftovers: getWorkflowLeftovers(),
                entries: committedEntries,
                summaryCandidates: committedCandidates,
            };
        }

        const pendingEntries = getSummaryEntriesById(originalEntries, pendingIds);
        const ambiguousAssignments = hasAmbiguousMultiSummaryAssignments(summaryCandidates, pendingEntries);
        const acceptedByDefaultIds = collectSummaryMemberIds(summaryCandidates);
        const pendingAfterAcceptAll = new Set(pendingIds);
        for (const id of acceptedByDefaultIds) {
            pendingAfterAcceptAll.delete(String(id));
        }

        const approvalResult = await awaitStmbJobApproval(
            context,
            buildConsolidationApprovalRequest({
                summaryCandidates,
                selectedEntries: pendingEntries,
                targetLabel,
                sourceLabel,
                ambiguousAssignments,
                lockedCount: committedCandidates.length,
                pendingCount: pendingAfterAcceptAll.size,
            }),
            { detail: targetLabel },
        );
        throwIfStmbAborted(context?.signal);

        if (!approvalResult || approvalResult.decision === 'cancel' || approvalResult.decision === 'reject') {
            return {
                canceled: true,
                created: committedEntries.length,
                leftovers: getWorkflowLeftovers(),
                entries: committedEntries,
                summaryCandidates: committedCandidates,
            };
        }

        if (approvalResult.decision === 'retry' || approvalResult.editedData?.action === 'retryAll') {
            analysis = await generateAnalysis(pendingEntries, committedCandidates);
            continue;
        }

        const acceptedCandidates = Array.isArray(approvalResult.editedData?.acceptedCandidates)
            ? approvalResult.editedData.acceptedCandidates
            : summaryCandidates;
        const rejectedCandidates = Array.isArray(approvalResult.editedData?.rejectedCandidates)
            ? approvalResult.editedData.rejectedCandidates
            : [];
        if (acceptedCandidates.length > 0) {
            const createdEntries = await commitCandidates(acceptedCandidates);
            committedEntries.push(...(Array.isArray(createdEntries) ? createdEntries : []));
            committedCandidates.push(...acceptedCandidates);
            for (const id of collectSummaryMemberIds(acceptedCandidates)) {
                pendingIds.delete(String(id));
                rejectedIds.delete(String(id));
            }
        }
        for (const id of collectSummaryMemberIds(rejectedCandidates)) {
            pendingIds.delete(String(id));
            rejectedIds.add(String(id));
        }

        if (pendingIds.size === 0) {
            break;
        }

        const nextPendingEntries = getSummaryEntriesById(originalEntries, pendingIds);
        if (nextPendingEntries.length === 0) {
            break;
        }
        analysis = await generateAnalysis(nextPendingEntries, committedCandidates);
    }

    return {
        canceled: false,
        created: committedEntries.length,
        leftovers: getWorkflowLeftovers(),
        entries: committedEntries,
        summaryCandidates: committedCandidates,
    };
}

function buildManualGroupCopyTargets(snapshot, primaryLorebookName) {
    const selectedNames = new Set(normalizeStmbCharacterFilterNames(snapshot?.characterFilterNames));
    const targetsByLorebook = new Map();
    for (const member of snapshot?.members || []) {
        if (!selectedNames.has(member.characterFilterName)) continue;
        const lorebookName = String(snapshot?.bindings?.[member.key] || '').trim();
        if (!lorebookName) continue;
        if (lorebookName === primaryLorebookName) {
            throw new Error(`${member.name}: character lorebook cannot be the group Memory Book.`);
        }
        if (!targetsByLorebook.has(lorebookName)) {
            targetsByLorebook.set(lorebookName, { lorebookName, members: [], characterFilterNames: [] });
        }
        const target = targetsByLorebook.get(lorebookName);
        target.members.push(member);
        target.characterFilterNames.push(member.characterFilterName);
    }
    return Array.from(targetsByLorebook.values()).map(target => ({
        ...target,
        characterFilterNames: normalizeStmbCharacterFilterNames(target.characterFilterNames),
    }));
}

async function generateManualGroupCharacterMemories(groupMemory, compiledScene, profile, targets, summaryCount, signal, onRateLimitWait, contextSettingKey) {
    const memories = new Map();
    if (!profile?.useGroupSpecificPrompts) return memories;
    for (const target of targets) {
        if (target.characterFilterNames.length !== 1 || target.members.length !== 1) continue;
        const member = target.members[0];
        const characterScene = structuredClone(compiledScene);
        characterScene.metadata = {
            ...(characterScene.metadata || {}),
            characterName: member.name,
            stmbPromptTarget: 'character',
            characterFilterNames: target.characterFilterNames,
        };
        const memory = await requestStructuredMemory(
            characterScene,
            profile,
            target.lorebookName,
            summaryCount,
            signal,
            onRateLimitWait,
            { contextSettingKey },
        );
        memories.set(target.lorebookName, memory);
    }
    return memories;
}

async function saveManualGroupMemoryObjects(groupMemory, characterMemories, snapshot, options) {
    const { lorebookName, range, compiledScene, profile, keepSceneMarkers, sceneContext, signal } = options;
    const targets = buildManualGroupCopyTargets(snapshot, lorebookName);
    throwIfStmbAborted(signal);
    const result = await saveStmbGroupMemoryEntries({
        primary: {
            lorebookName,
            storage: getLorebookStorageForRequest(lorebookName),
            memoryObject: groupMemory,
            characterFilterNames: snapshot.characterFilterNames,
        },
        targets: targets.map(target => ({
            lorebookName: target.lorebookName,
            storage: getLorebookStorageForRequest(target.lorebookName),
            memoryObject: characterMemories.get(target.lorebookName) || groupMemory,
            characterFilterNames: target.characterFilterNames,
            usePrimaryTitle: !characterMemories.has(target.lorebookName),
        })),
        sceneContext: buildMemorySceneData(compiledScene, range),
        profile,
    }, { signal });
    throwIfStmbAborted(signal);

    for (const entry of result?.entries || []) worldInfoCache.delete(entry.lorebookName);
    await applyPostSaveLorebookEffects(lorebookName, range, sceneContext);
    for (const target of targets) {
        if (getModuleSettings().refreshEditor !== false) {
            try {
                await Promise.resolve(reloadEditor(target.lorebookName));
            } catch (error) {
                console.warn('STMB group target refresh failed', { lorebookName: target.lorebookName, error });
            }
        }
    }
    showOrderClampNotifications(result?.orderClampNotifications);
    const shouldClearSceneMarkers = !keepSceneMarkers && getModuleSettings().autoClearSceneAfterMemory === true;
    if (isSceneContextCurrent(sceneContext)) {
        setHighestProcessedMessageId(range.sceneEnd);
        if (shouldClearSceneMarkers) clearSceneMarkers();
    } else {
        queueDeferredPostSaveEffects(sceneContext, {
            highestProcessedMessageId: range.sceneEnd,
            clearSceneMarkers: shouldClearSceneMarkers,
        });
    }
    return {
        lorebookName,
        memory: groupMemory,
        entry: result?.entries?.[0] || null,
        entries: result?.entries || [],
    };
}

async function saveMemoryObjectToLorebook(memoryObject, { lorebookName, range, compiledScene, profile, keepSceneMarkers = false, sceneContext = null, signal = null, showSuccessToast = true }) {
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
    await applyPostSaveLorebookEffects(lorebookName, range, sceneContext);
    throwIfStmbAborted(signal);
    showOrderClampNotifications(result?.orderClampNotifications);
    const shouldClearSceneMarkers = !keepSceneMarkers && getModuleSettings().autoClearSceneAfterMemory === true;
    if (isSceneContextCurrent(sceneContext)) {
        setHighestProcessedMessageId(range.sceneEnd);
        if (shouldClearSceneMarkers) {
            clearSceneMarkers();
        }
    } else {
        queueDeferredPostSaveEffects(sceneContext, {
            highestProcessedMessageId: range.sceneEnd,
            clearSceneMarkers: shouldClearSceneMarkers,
        });
    }

    if (showSuccessToast && getModuleSettings().showNotifications) {
        toastr.success(`Memory saved to "${lorebookName}"`, 'STMB');
    }

    return {
        lorebookName,
        memory: memoryObject,
        entry: result.entry,
    };
}

function normalizeAutoConsolidationTargetTiers(value) {
    const source = Array.isArray(value) ? value : [value];
    return Array.from(new Set(
        source
            .map(item => Number(item))
            .filter(item => Number.isFinite(item))
            .map(item => Math.trunc(item))
            .filter(item => item >= 1 && item <= 6),
    ));
}

function clearAutoConsolidationPromptState(targetTier, sceneContext = null) {
    const state = getStmbState(sceneContext);
    const prefix = `${Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)))}:`;
    if (typeof state.autoConsolidationLastPromptKey === 'string' && state.autoConsolidationLastPromptKey.startsWith(prefix)) {
        delete state.autoConsolidationLastPromptKey;
    }
}

function listSummaryConsolidationPresets() {
    return listCachedArcPromptPresets(stmbSettings)
        .filter(preset => !preset.regenerationOnly)
        .map(preset => ({
        value: preset.key,
        label: preset.displayName,
        prompt: getRequiredArcPromptText(preset.key),
        }));
}

function persistSummaryConsolidationPopupSettings({ targetTier, requiredMin, summaryEntrySettings } = {}) {
    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)));
    const nextRequiredMin = normalizeSummaryMinChildren(
        requiredMin,
        getModuleSettings().summaryTierMinimums?.[normalizedTargetTier] ?? getDefaultSummaryMinChildren(normalizedTargetTier),
    );
    const nextSummaryEntrySettings = normalizeLorebookEntrySettings(
        summaryEntrySettings || {},
        getModuleSettings().summaryEntrySettings || {},
    );

    let changed = false;
    if (getModuleSettings().summaryTierMinimums?.[normalizedTargetTier] !== nextRequiredMin) {
        stmbSettings.moduleSettings.summaryTierMinimums[normalizedTargetTier] = nextRequiredMin;
        changed = true;
    }

    if (JSON.stringify(getModuleSettings().summaryEntrySettings || {}) !== JSON.stringify(nextSummaryEntrySettings)) {
        stmbSettings.moduleSettings.summaryEntrySettings = { ...nextSummaryEntrySettings };
        syncSummaryOrderModuleSettings(stmbSettings.moduleSettings, nextSummaryEntrySettings);
        changed = true;
    }

    if (changed) {
        saveSettingsDebounced();
    }

    return {
        targetTier: normalizedTargetTier,
        requiredMin: nextRequiredMin,
        summaryEntrySettings: nextSummaryEntrySettings,
    };
}

async function showSummaryConsolidationPopup({ initialTargetTier = 1, showGoBack = false } = {}) {
    await firstRunInitArcPromptPresets(stmbSettings);
    const lorebookName = resolveLorebookName();
    if (!lorebookName) {
        toastr.info('No memory lorebook currently assigned, no memories found.', 'STMB');
    }

    const lorebookData = lorebookName ? (await loadWorldInfo(lorebookName) || { entries: {} }) : { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(initialTargetTier) || 1)));
    const summaryEntrySettings = normalizeLorebookEntrySettings(getModuleSettings().summaryEntrySettings || {});

    const popupResult = await showSummaryConsolidationOptionsPopup({
        initialTargetTier: normalizedTargetTier,
        tierOptions: Array.from({ length: 6 }, (_, index) => ({
            value: index + 1,
            label: getSummaryTierLabel(index + 1),
        })),
        tierConfigs: Array.from({ length: 6 }, (_, index) => {
            const targetTier = index + 1;
            const sourceTier = getSourceTierForTarget(targetTier);
            return {
                value: targetTier,
                label: getSummaryTierLabel(targetTier),
                sourceLabel: getSummaryTierLabel(sourceTier),
                sourcePlural: pluralizeSummaryLabel(getSummaryTierLabel(sourceTier)),
                requiredMin: normalizeSummaryMinChildren(
                    getModuleSettings().summaryTierMinimums?.[targetTier],
                    getDefaultSummaryMinChildren(targetTier),
                ),
                candidates: identifyEligibleSummarySourceEntries(lorebookData.entries, targetTier).map(entry => ({
                    uid: entry.uid,
                    title: entry.comment || entry.title || `#${entry.uid}`,
                })),
            };
        }),
        presets: listSummaryConsolidationPresets(),
        defaultPresetKey: getDefaultArcPromptKey(),
        requiredMin: normalizeSummaryMinChildren(
            getModuleSettings().summaryTierMinimums?.[normalizedTargetTier],
            getDefaultSummaryMinChildren(normalizedTargetTier),
        ),
        maxItemsPerPass: 15,
        maxPasses: 10,
        tokenTarget: getModuleSettings().tokenWarningThreshold ?? 30000,
        disableOriginals: true,
        summaryEntrySettings,
        hasLorebook: Boolean(lorebookName),
        allowPresetRebuild: true,
        showGoBack,
        onPresetRebuild: async () => {
            const result = await recreateBuiltInArcPromptOverridesFile();
            toastr.success(`Recreated ${result.replaced} built-in consolidation prompt overrides`, 'STMB');
            return listSummaryConsolidationPresets();
        },
        onPersist: persistSummaryConsolidationPopupSettings,
    });

    if (popupResult.action !== 'run') {
        return null;
    }
    if (!lorebookName) {
        toastr.info('Summary consolidation requires a memory lorebook. No lorebook assigned.', 'STMB');
        return null;
    }

    const persisted = persistSummaryConsolidationPopupSettings({
        targetTier: popupResult.targetTier,
        requiredMin: popupResult.requiredMin,
        summaryEntrySettings: popupResult.summaryEntrySettings,
    });

    return createSummaryForTier(popupResult.targetTier, {
        requiredMin: persisted.requiredMin,
        presetKey: popupResult.presetKey,
        promptText: popupResult.promptText,
        maxItemsPerPass: popupResult.maxItemsPerPass,
        maxPasses: popupResult.maxPasses,
        tokenTarget: popupResult.tokenTarget,
        disableOriginals: popupResult.disableOriginals,
        selectedEntryIds: popupResult.selectedEntryIds,
        summaryEntrySettings: persisted.summaryEntrySettings,
    });
}

async function maybePromptAutoConsolidation(targetTier, options = {}) {
    try {
        const sceneContext = options?.sceneContext || null;
        const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)));
        const configuredTargetTiers = normalizeAutoConsolidationTargetTiers(
            getModuleSettings().autoConsolidationTargetTiers,
        );
        if (!getModuleSettings().autoConsolidationPromptEnabled || !configuredTargetTiers.includes(normalizedTargetTier)) {
            return;
        }

        const lorebookName = String(options?.lorebookName || resolveLorebookName() || '').trim();
        if (!lorebookName) {
            return;
        }

        if (sceneContext && !isSceneContextCurrent(sceneContext)) {
            queueDeferredPostSaveEffects(sceneContext, {
                autoConsolidationChecks: [{
                    targetTier: normalizedTargetTier,
                    lorebookName,
                }],
            });
            return;
        }

        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
            lorebookData.entries = {};
        }

        const requiredMin = normalizeSummaryMinChildren(
            getModuleSettings().summaryTierMinimums?.[normalizedTargetTier],
            getDefaultSummaryMinChildren(normalizedTargetTier),
        );
        const eligibleEntries = identifyEligibleSummarySourceEntries(lorebookData.entries, normalizedTargetTier);
        const eligibleCount = eligibleEntries.length;
        if (eligibleCount < requiredMin) {
            return;
        }

        const state = getStmbState(sceneContext);
        const promptKey = `${normalizedTargetTier}:${eligibleCount}`;
        if (state.autoConsolidationLastPromptKey === promptKey) {
            return;
        }
        state.autoConsolidationLastPromptKey = promptKey;

        const sourceLabel = getSummaryTierLabel(getSourceTierForTarget(normalizedTargetTier)).toLowerCase();
        const sourcePlural = sourceLabel.endsWith('y') ? `${sourceLabel.slice(0, -1)}ies` : `${sourceLabel}s`;
        const targetLabel = getSummaryTierLabel(normalizedTargetTier).toLowerCase();
        const shouldOpen = await showAutoConsolidationPromptPopup({
            eligibleCount,
            requiredMin,
            sourcePlural,
            targetLabel,
        });
        if (shouldOpen) {
            await showSummaryConsolidationPopup({ initialTargetTier: normalizedTargetTier });
        }
    } catch (error) {
        console.error('STMB auto-consolidation prompt check failed', error);
    }
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
                    null,
                    Object.fromEntries(Object.entries({
                        additionalContextEntries: Array.isArray(context.additionalContextEntries)
                            ? context.additionalContextEntries
                            : undefined,
                        contextSettingKey: context.contextSettingKey ?? undefined,
                    }).filter(([, value]) => value !== undefined)),
                );
                continue;
            }

            const saved = await saveMemoryObjectToLorebook(maybeEdited, {
                lorebookName: context.lorebookName,
                range: context.range,
                compiledScene: context.compiledScene,
                profile: context.profile,
                keepSceneMarkers: context.keepSceneMarkers,
                sceneContext: context.sceneContext || null,
                signal: task.signal,
            });

            try {
                await enqueueAfterMemorySidePromptJobs(context.compiledScene, stmbSettings, context.profile, {
                    lorebookName: context.lorebookName,
                    range: context.range,
                    sceneContext: context.sceneContext || null,
                    signal: task.signal,
                });
            } catch (error) {
                if (!isStmbAbortError(error)) {
                    console.warn('STMB side prompts after manual repair failed', error);
                }
            }

            await maybePromptAutoConsolidation(1, {
                sceneContext: context.sceneContext || null,
                lorebookName: context.lorebookName,
            });

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
    summaryEntrySettings = null,
    sourceFingerprints = null,
    sourceIds = null,
    showSuccessToast = true,
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
        summaryEntrySettings: summaryEntrySettings || getModuleSettings().summaryEntrySettings || {},
        sourceFingerprints,
        sourceIds: sourceIds ? Array.from(sourceIds).map(String) : null,
    }, { signal });
    throwIfStmbAborted(signal);
    worldInfoCache.delete(lorebookName);
    const createdEntries = Array.isArray(result?.createdEntries) ? result.createdEntries : [];
    await applyPostSummarySaveLorebookEffects(lorebookName);
    showOrderClampNotifications(result?.orderClampNotifications);

    if (showSuccessToast && getModuleSettings().showNotifications) {
        toastr.success(
            `${getSummaryTierLabel(normalizedTargetTier)} summary saved to "${lorebookName}"`,
            'STMB',
        );
    }

    lastFailedSummaryError = null;
    lastFailedSummaryContext = null;

    return createdEntries;
}

async function runPostConsolidationCommitFlow({
    created,
    normalizedTargetTier,
    lorebookName,
    sceneContext = null,
} = {}) {
    if (Number(created || 0) <= 0) {
        return;
    }

    const targetTier = Math.min(6, Math.max(1, Math.trunc(Number(normalizedTargetTier) || 1)));
    clearAutoConsolidationPromptState(targetTier, sceneContext);
    if (targetTier < 6) {
        await maybePromptAutoConsolidation(targetTier + 1, {
            sceneContext,
            lorebookName,
        });
    }
}

/**
 * Normalizes the requested number of prior memories included as context.
 */
function normalizeMemoryContextCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.max(0, Math.min(7, Math.trunc(parsed)))
        : 0;
}

function buildMemoryRequestSettings(summaryCount = 0) {
    return {
        ...stmbSettings,
        moduleSettings: {
            ...(stmbSettings.moduleSettings || {}),
            defaultMemoryCount: normalizeMemoryContextCount(summaryCount),
        },
    };
}

async function executeMemoryJob(job, context) {
    const payload = job?.payload || {};
    const range = job?.range || payload.range || null;
    const lorebookName = String(job?.lorebookName || payload.lorebookName || '').trim();
    const requestSettings = buildMemoryRequestSettings(payload.summaryCount);
    const profile = buildEffectiveMemoryProfile(payload.profile || getActiveStmbProfile(stmbSettings, job?.profileIndex ?? null));
    const jobContextSettingKey = Object.hasOwn(payload, 'contextSettingKey')
        ? payload.contextSettingKey
        : STMB_CONTEXT_NONE_KEY;
    const manualGroupSnapshot = payload.manualGroupSnapshot && typeof payload.manualGroupSnapshot === 'object'
        ? structuredClone(payload.manualGroupSnapshot)
        : null;

    if (!Number.isInteger(Number(range?.sceneStart)) || !Number.isInteger(Number(range?.sceneEnd))) {
        throw new Error('Memory job is missing a valid scene range.');
    }
    if (!lorebookName) {
        throw new Error('Memory job is missing a lorebook.');
    }

    context.setState('capturing_scene', {
        detail: `Messages ${range.sceneStart}-${range.sceneEnd}`,
    });
    const skipSystemMessages = typeof payload.skipSystemMessages === 'boolean'
        ? payload.skipSystemMessages
        : !requestSettings.moduleSettings?.unhideBeforeMemory;
    const sceneCapture = payload.compiledScene
        ? { compiledScene: structuredClone(payload.compiledScene) }
        : await captureStmbSceneRange(range, {
            skipSystemMessages,
            sceneContext: job?.sceneContext || buildStmbSceneContext(),
        });
    const compiledScene = sceneCapture?.compiledScene;
    if (manualGroupSnapshot) {
        compiledScene.metadata = {
            ...(compiledScene.metadata || {}),
            groupName: compiledScene?.metadata?.groupName || job?.sceneContext?.groupName || '',
            stmbPromptTarget: 'group',
            characterFilterNames: normalizeStmbCharacterFilterNames(manualGroupSnapshot.characterFilterNames),
        };
    }

    if (payload.source === 'catchup') {
        const rawTokenThreshold = payload.tokenWarningThreshold
            ?? requestSettings.moduleSettings?.tokenWarningThreshold
            ?? 30000;
        const parsedTokenThreshold = Number(rawTokenThreshold);
        const tokenThreshold = Number.isFinite(parsedTokenThreshold)
            ? Math.max(1000, Math.trunc(parsedTokenThreshold))
            : 30000;
        const tokenEstimateOptions = {
            profile,
            memoryCount: payload.summaryCount,
        };
        if (Array.isArray(payload.additionalContextEntries)) {
            tokenEstimateOptions.additionalContextEntries = payload.additionalContextEntries;
        } else {
            tokenEstimateOptions.contextSettingKey = jobContextSettingKey;
        }
        const estimatedTokens = await estimateAdvancedMemoryTokens(compiledScene, lorebookName, tokenEstimateOptions);
        if (estimatedTokens > tokenThreshold) {
            throw new Error(
                `/stmb-catchup chunk ${range.sceneStart}-${range.sceneEnd} is estimated at ${estimatedTokens} tokens, above the token warning threshold (${tokenThreshold}). Use a smaller interval or increase the threshold.`,
            );
        }
    }

    if (!requestSettings.moduleSettings?.allowSceneOverlap) {
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
            lorebookData.entries = {};
        }

        const overlappingMemory = findOverlappingManagedMemoryEntry(lorebookData.entries, range);
        if (overlappingMemory) {
            const existingRange = overlappingMemory.range;
            throw new Error(`Scene overlaps with existing memory: "${overlappingMemory.title}" (messages ${existingRange.start}-${existingRange.end})`);
        }
    }

    for (;;) {
        const preflightMessage = getConnectionProfilePreflightMessage(profile);
        if (preflightMessage) {
            throw new Error(preflightMessage);
        }

        context.setState('assembling_prompt', { detail: profile?.name || 'Memory' });
        context.setState('generating', { detail: profile?.name || 'Memory' });
        let memoryCandidate = await requestStructuredMemory(
            compiledScene,
            profile,
            lorebookName,
            payload.summaryCount,
            context.signal,
            wait => context.setState('generating', {
                detail: `Rate limited, retrying in ${Math.max(1, Math.ceil(Math.max(0, Number(wait?.delayMs) || 0) / 1000))}s`,
            }),
            {
                additionalContextEntries: payload.additionalContextEntries,
                contextSettingKey: jobContextSettingKey,
            },
        );

        if (requestSettings.moduleSettings?.showMemoryPreviews) {
            const approvalResult = await awaitStmbJobApproval(
                context,
                buildMemoryApprovalRequest(memoryCandidate, compiledScene, range, profile),
                { detail: `Messages ${range.sceneStart}-${range.sceneEnd}` },
            );

            if (!approvalResult || approvalResult.decision === 'cancel' || approvalResult.decision === 'reject') {
                context.patch({ state: 'canceled', detail: 'Canceled in approval' });
                return;
            }
            if (approvalResult.decision === 'retry') {
                continue;
            }
            if (approvalResult.editedData && typeof approvalResult.editedData === 'object') {
                memoryCandidate = {
                    title: String(approvalResult.editedData.title || memoryCandidate?.title || '').trim(),
                    content: String(approvalResult.editedData.content || memoryCandidate?.content || '').trim(),
                    keywords: Array.isArray(approvalResult.editedData.keywords)
                        ? approvalResult.editedData.keywords.slice()
                        : Array.isArray(memoryCandidate?.keywords)
                            ? memoryCandidate.keywords.slice()
                            : [],
                };
            }
        }

        const groupTargets = manualGroupSnapshot
            ? buildManualGroupCopyTargets(manualGroupSnapshot, lorebookName)
            : [];
        const characterMemories = manualGroupSnapshot
            ? await generateManualGroupCharacterMemories(
                memoryCandidate,
                compiledScene,
                profile,
                groupTargets,
                payload.summaryCount,
                context.signal,
                wait => context.setState('generating', {
                    detail: `Rate limited, retrying in ${Math.max(1, Math.ceil(Math.max(0, Number(wait?.delayMs) || 0) / 1000))}s`,
                }),
                jobContextSettingKey,
            )
            : new Map();

        context.setState('saving', { detail: lorebookName });
        const saved = manualGroupSnapshot
            ? await saveManualGroupMemoryObjects(memoryCandidate, characterMemories, manualGroupSnapshot, {
                lorebookName,
                range,
                compiledScene,
                profile,
                keepSceneMarkers: Boolean(payload.keepSceneMarkers),
                sceneContext: job?.sceneContext || null,
                signal: context.signal,
            })
            : await saveMemoryObjectToLorebook(memoryCandidate, {
                lorebookName,
                range,
                compiledScene,
                profile,
                keepSceneMarkers: Boolean(payload.keepSceneMarkers),
                sceneContext: job?.sceneContext || null,
                signal: context.signal,
                showSuccessToast: false,
            });
        context.setResult({
            lorebookName,
            memory: saved?.memory || memoryCandidate,
            entry: saved?.entry || null,
        });

        throwIfStmbAborted(context.signal);
        context.setState('post_save', { detail: 'Running post-save actions' });
        await maybePromptAutoConsolidation(1, {
            sceneContext: job?.sceneContext || null,
            lorebookName,
        });
        return;
    }
}

function ensureStmbJobExecutorsRegistered() {
    if (stmbJobExecutorsRegistered) {
        return;
    }
    registerStmbJobExecutor('memory', executeMemoryJob);
    registerStmbJobExecutor('consolidation', executeConsolidationJob);
    stmbJobExecutorsRegistered = true;
}

function createMemoryJobId() {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

async function executeMemoryCreationFromRange(range, options = {}) {
    assertRangeWithinCurrentChat(range);

    const lorebookName = await ensureLorebookName();
    const sceneContext = options.sceneContext || buildStmbSceneContext();
    const sceneCapture = await captureStmbSceneRange(range, {
        skipSystemMessages: !getModuleSettings().unhideBeforeMemory,
        sceneContext,
    });
    const compiledScene = sceneCapture?.compiledScene;

    if (!getModuleSettings().allowSceneOverlap) {
        const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
        if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
            lorebookData.entries = {};
        }

        const overlappingMemory = findOverlappingManagedMemoryEntry(lorebookData.entries, range);
        if (overlappingMemory) {
            const existingRange = overlappingMemory.range;
            console.error(
                `STMemoryBooks: Scene overlap detected with memory: ${overlappingMemory.title} [${existingRange.start}-${existingRange.end}] vs new [${range.sceneStart}-${range.sceneEnd}]`,
            );
            toastr.error(
                `Scene overlaps with existing memory: "${overlappingMemory.title}" (messages ${existingRange.start}-${existingRange.end})`,
                'STMB',
            );
            return null;
        }
    }

    const effectiveSettings = await showAndGetMemorySettings(compiledScene, range, lorebookName, options.profileIndex ?? null);
    if (!effectiveSettings) {
        return null;
    }
    let manualGroupSnapshot = null;
    if (sceneContext.isGroupChat) {
        const groupParticipantSnapshot = await prepareGroupMemoryParticipantSnapshot(compiledScene, sceneContext);
        if (!groupParticipantSnapshot) return null;
        if (getModuleSettings().manualModeEnabled) manualGroupSnapshot = groupParticipantSnapshot;
    }
    ensureStmbJobExecutorsRegistered();
    const memoryJobId = createMemoryJobId();
    const contextSettingKey = getChatContextSettingKey();
    const requestSettings = buildMemoryRequestSettings(effectiveSettings.summaryCount);
    let afterMemoryJobs = [];
    try {
        afterMemoryJobs = await buildQueuedAfterMemorySidePromptJobs({
            lorebookName,
            compiledScene,
            range,
            settings: requestSettings,
            profile: effectiveSettings.profileSettings,
            sceneContext,
            contextSettingKey,
        });
    } catch (error) {
        console.warn('STMB after-memory side prompt planning failed', error);
    }
    enqueueStmbJob({
        id: memoryJobId,
        type: 'memory',
        range,
        lorebookName,
        profileIndex: options.profileIndex ?? null,
        sceneContext,
        characterName: compiledScene?.metadata?.characterName || '',
        chatTitle: compiledScene?.metadata?.chatId || '',
        payload: {
            compiledScene,
            range,
            lorebookName,
            profile: effectiveSettings.profileSettings,
            summaryCount: effectiveSettings.summaryCount,
            contextSettingKey,
            keepSceneMarkers: Boolean(options.keepSceneMarkers),
            source: options.source || 'memory',
            manualGroupSnapshot,
        },
    });
    for (const job of afterMemoryJobs) {
        enqueueStmbJob({
            ...job,
            dependsOnJobId: memoryJobId,
            payload: {
                ...(job.payload || {}),
                dependsOnJobId: memoryJobId,
            },
        });
    }
    return {
        queued: true,
        range,
        lorebookName,
    };
}

async function initiateMemoryCreation(options = {}) {
    const range = options?.range ?? getCurrentSceneRange();
    const keepSceneMarkers = Boolean(options?.keepSceneMarkers);
    const profileIndex = options?.profileIndex ?? null;
    const notifyIfBusy = Boolean(options?.notifyIfBusy);
    const sceneContext = options?.sceneContext || buildStmbSceneContext();
    const source = options?.source || 'memory';

    assertRangeWithinCurrentChat(range);

    if (!validateMemoryCreationContext()) {
        return null;
    }

    if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(sceneContext))) {
        if (notifyIfBusy) {
            toastr.info('Memory creation is already in progress', 'STMB');
        }
        return null;
    }

    return executeMemoryCreationFromRange(range, {
        keepSceneMarkers,
        profileIndex,
        sceneContext,
        source,
    });
}

function getStmbCanonicalEntryNumber(entry) {
    const direct = Number(entry?.STMB_canonicalMemoryNumber ?? entry?.STMB_memoryNumber);
    if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
    const parsed = parseSequenceFromTitle(entry?.comment || entry?.title || '');
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function buildGroupConsolidationGapMarkers(targetEntries, primaryEntries, members) {
    const selectedNumbers = targetEntries.map(getStmbCanonicalEntryNumber).filter(Number.isFinite);
    if (selectedNumbers.length < 2) return [];
    const minimum = Math.min(...selectedNumbers);
    const maximum = Math.max(...selectedNumbers);
    const present = new Set(selectedNumbers);
    const primaryNumbers = primaryEntries.map(getStmbCanonicalEntryNumber)
        .filter(number => Number.isFinite(number) && number >= minimum && number <= maximum);
    const missing = primaryNumbers.filter(number => !present.has(number));
    if (missing.length === 0) return [];
    const names = members.map(member => member.name).filter(Boolean);
    const label = names.length <= 1 ? (names[0] || 'this character') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return missing.map(number => ({
        __stmbGapMarker: true,
        id: `gap-${members.map(member => member.key).join('-')}-${number}`,
        order: number - 0.5,
        title: `Skipped summaries before ${String(number).padStart(3, '0')}`,
        content: `Some summaries are omitted because ${label} did not participate in them; treat this as a chronological gap, not missing context they should know.`,
    }));
}

async function buildGroupConsolidationWorkItems(primaryItem, targetTier, requiredMinimum) {
    const sceneContext = buildStmbSceneContext();
    if (!getModuleSettings().manualModeEnabled || !sceneContext.isGroupChat) return [primaryItem];
    const snapshot = validateManualGroupBindingSnapshot(getManualGroupBindingSnapshot(sceneContext));
    const itemsByLorebook = new Map();
    for (const member of snapshot.members) {
        const lorebookName = String(snapshot.bindings[member.key] || '').trim();
        if (!lorebookName || lorebookName === primaryItem.lorebookName) continue;
        if (!itemsByLorebook.has(lorebookName)) itemsByLorebook.set(lorebookName, { lorebookName, members: [] });
        itemsByLorebook.get(lorebookName).members.push(member);
    }
    if (itemsByLorebook.size === 0) return [primaryItem];

    const selectedNumbers = new Set(primaryItem.sourceEntries.map(getStmbCanonicalEntryNumber).filter(Number.isFinite));
    const ready = [primaryItem];
    const skipped = [];
    for (const item of itemsByLorebook.values()) {
        const data = await loadWorldInfo(item.lorebookName) || { entries: {} };
        const realEntries = identifyEligibleSummarySourceEntries(data.entries || {}, targetTier)
            .filter(entry => selectedNumbers.size === 0 || selectedNumbers.has(getStmbCanonicalEntryNumber(entry)));
        const gapMarkers = buildGroupConsolidationGapMarkers(realEntries, primaryItem.sourceEntries, item.members);
        const workItem = {
            lorebookName: item.lorebookName,
            sourceEntries: realEntries,
            selectedEntryIds: realEntries.map(entry => String(entry.uid)),
            gapMarkers,
            members: item.members,
        };
        if (realEntries.length >= requiredMinimum) ready.push(workItem);
        else skipped.push(workItem);
    }
    if (skipped.length > 0) {
        const popup = new Popup(DOMPurify.sanitize(`
            <h3>Some lorebooks are below the threshold</h3>
            <p>Continue with the ready lorebooks?</p>
            <strong>Ready</strong><ul>${ready.map(item => `<li>${escapeHtml(item.lorebookName)} (${item.sourceEntries.length})</li>`).join('')}</ul>
            <strong>Skipped</strong><ul>${skipped.map(item => `<li>${escapeHtml(item.lorebookName)} (${item.sourceEntries.length}/${requiredMinimum})</li>`).join('')}</ul>
        `), POPUP_TYPE.CONFIRM, '', { okButton: 'Continue', cancelButton: 'Cancel' });
        if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) return [];
    }
    return ready;
}

export async function createSummaryForTier(targetTier, options = {}) {
    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)));
    if (hasActiveStmbTasks()) {
        throw new Error('STMB generation is already in progress');
    }
    await firstRunInitArcPromptPresets(stmbSettings);

    const lorebookName = await ensureLorebookName();
    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    migrateLorebookSummarySchema(lorebookData);
    const selectedEntryIds = Array.isArray(options.selectedEntryIds)
        ? options.selectedEntryIds.map(value => String(value))
        : null;
    const sourceEntries = resolveSelectedSummarySourceEntries(
        lorebookData.entries,
        normalizedTargetTier,
        selectedEntryIds,
    );
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

    const profile = getActiveStmbProfile(stmbSettings, options.profileIndex ?? null);
    const presetKey = typeof options.presetKey === 'string' && options.presetKey.trim()
        ? options.presetKey.trim()
        : getDefaultArcPromptKey();
    const promptText = typeof options.promptText === 'string' && options.promptText.trim()
        ? options.promptText
        : getRequiredArcPromptText(presetKey);
    const chosenSummaryEntrySettings = normalizeLorebookEntrySettings(
        options.summaryEntrySettings || getModuleSettings().summaryEntrySettings || {},
        getModuleSettings().summaryEntrySettings || {},
    );
    const workItems = await buildGroupConsolidationWorkItems({
        lorebookName,
        sourceEntries,
        selectedEntryIds: sourceEntries.map(entry => String(entry.uid)),
        gapMarkers: [],
    }, normalizedTargetTier, requiredMinimum);
    if (workItems.length === 0) return { queued: false, canceled: true };

    ensureStmbJobExecutorsRegistered();
    const sceneContext = buildStmbSceneContext();
    for (const workItem of workItems) {
        enqueueStmbJob({
            type: 'consolidation',
            lorebookName: workItem.lorebookName,
            sceneContext,
            characterName: name2 || '',
            chatTitle: getCurrentChatId() || '',
            title: getSummaryTierLabel(normalizedTargetTier),
            detail: `${workItem.lorebookName}: ${getSummaryTierLabel(getSourceTierForTarget(normalizedTargetTier))} -> ${getSummaryTierLabel(normalizedTargetTier)}`,
            payload: {
                lorebookName: workItem.lorebookName,
                normalizedTargetTier,
                selectedEntryIds: workItem.selectedEntryIds,
                gapMarkers: structuredClone(workItem.gapMarkers || []),
                requiredMin: requiredMinimum,
                profileIndex: options.profileIndex ?? null,
                presetKey,
                promptText,
                maxItemsPerPass: Math.max(1, Math.trunc(Number(options.maxItemsPerPass) || 15)),
                maxPasses: Math.max(1, Math.trunc(Number(options.maxPasses) || 10)),
                tokenTarget: Math.max(1000, Math.trunc(Number(options.tokenTarget) || (getModuleSettings().tokenWarningThreshold ?? 30000))),
                disableOriginals: Boolean(options.disableOriginals),
                summaryEntrySettings: chosenSummaryEntrySettings,
                sourceFingerprints: buildSummarySourceFingerprints(workItem.sourceEntries),
                titleFormat: typeof options.titleFormat === 'string' && options.titleFormat.trim()
                    ? options.titleFormat
                    : getDefaultSummaryTitleFormat(normalizedTargetTier),
            },
        });
    }
    return {
        queued: true,
        lorebookName,
        targetTier: normalizedTargetTier,
        jobCount: workItems.length,
    };
}

function buildSummaryRepairHandler(contextBase = {}) {
    return async correctedRaw => {
        const repairTask = createStmbTask('STMB:summary-manual-repair');
        try {
            const context = {
                ...contextBase,
                ...(lastFailedSummaryContext || {}),
            };
            const freshLorebookData = await loadWorldInfo(context.lorebookName) || { entries: {} };
            if (!freshLorebookData.entries || typeof freshLorebookData.entries !== 'object') {
                freshLorebookData.entries = {};
            }
            const freshMigrated = migrateLorebookSummarySchema(freshLorebookData);
            const freshSourceEntries = resolveSelectedSummarySourceEntries(
                freshLorebookData.entries,
                context.normalizedTargetTier,
                context.selectedEntryIds ?? null,
            );
            const analysisEntries = [
                ...freshSourceEntries,
                ...(Array.isArray(context.gapMarkers) ? context.gapMarkers.filter(marker => marker?.__stmbGapMarker) : []),
            ];
            const correctedParsed = parseSummaryJsonResponse(correctedRaw);
            const { summaryCandidates } = createSummaryCandidatesFromResponse(correctedParsed, analysisEntries);
            if (summaryCandidates.length === 0) {
                throw new Error(`Model did not return a usable ${getSummaryTierLabel(context.normalizedTargetTier).toLowerCase()} summary`);
            }
            await commitSummaryCandidates(summaryCandidates, {
                normalizedTargetTier: context.normalizedTargetTier,
                lorebookName: context.lorebookName,
                titleFormat: context.titleFormat,
                migrated: freshMigrated,
                disableOriginals: Boolean(context.disableOriginals),
                summaryEntrySettings: normalizeLorebookEntrySettings(
                    context.summaryEntrySettings || getModuleSettings().summaryEntrySettings || {},
                    getModuleSettings().summaryEntrySettings || {},
                ),
                sourceFingerprints: buildSummarySourceFingerprints(freshSourceEntries),
                signal: repairTask.signal,
            });
            await runPostConsolidationCommitFlow({
                created: summaryCandidates.length,
                normalizedTargetTier: context.normalizedTargetTier,
                lorebookName: context.lorebookName,
                sceneContext: context.sceneContext || null,
            });
            return true;
        } finally {
            repairTask.cleanup();
        }
    };
}

async function runSummaryConsolidationNow(payload = {}, signal = null, onRateLimitWait = null, context = null) {
    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(payload.normalizedTargetTier || payload.targetTier) || 1)));
    const lorebookName = String(payload.lorebookName || '').trim() || await ensureLorebookName();
    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    const migrated = migrateLorebookSummarySchema(lorebookData);
    const selectedEntryIds = Array.isArray(payload.selectedEntryIds)
        ? payload.selectedEntryIds.map(value => String(value))
        : null;
    const realSourceEntries = resolveSelectedSummarySourceEntries(
        lorebookData.entries,
        normalizedTargetTier,
        selectedEntryIds,
    );
    const gapMarkers = (Array.isArray(payload.gapMarkers) ? payload.gapMarkers : [])
        .filter(marker => marker?.__stmbGapMarker)
        .map(marker => structuredClone(marker));
    const configuredMinimum = getModuleSettings().summaryTierMinimums?.[normalizedTargetTier];
    const requiredMinimum = normalizeSummaryMinChildren(
        payload.requiredMin,
        configuredMinimum ?? getDefaultSummaryMinChildren(normalizedTargetTier),
    );
    if (realSourceEntries.length < requiredMinimum) {
        throw new Error(
            `Not enough ${getSummaryTierLabel(normalizedTargetTier - 1).toLowerCase()} entries to create a ${getSummaryTierLabel(normalizedTargetTier).toLowerCase()} summary (${realSourceEntries.length}/${requiredMinimum})`,
        );
    }

    const existingSummaries = identifyManagedSummaryEntries(lorebookData.entries, normalizedTargetTier);
    const previousSummary = existingSummaries.at(-1) || null;
    const profile = getActiveStmbProfile(stmbSettings, payload.profileIndex ?? null);
    const chosenSummaryEntrySettings = normalizeLorebookEntrySettings(
        payload.summaryEntrySettings || getModuleSettings().summaryEntrySettings || {},
        getModuleSettings().summaryEntrySettings || {},
    );
    const titleFormat = typeof payload.titleFormat === 'string' && payload.titleFormat.trim()
        ? payload.titleFormat
        : getDefaultSummaryTitleFormat(normalizedTargetTier);
    const sourceFingerprints = payload.sourceFingerprints
        && typeof payload.sourceFingerprints === 'object'
        && !Array.isArray(payload.sourceFingerprints)
        ? payload.sourceFingerprints
        : buildSummarySourceFingerprints(realSourceEntries);
    const sourceLabel = getSummaryTierLabel(getSourceTierForTarget(normalizedTargetTier));
    const targetLabel = getSummaryTierLabel(normalizedTargetTier);

    try {
        const buildAnalysisOptions = (lockedSummaries = []) => ({
            presetKey: typeof payload.presetKey === 'string' && payload.presetKey.trim() ? payload.presetKey.trim() : getDefaultArcPromptKey(),
            promptText: typeof payload.promptText === 'string' && payload.promptText.trim() ? payload.promptText : null,
            maxItemsPerPass: Math.max(1, Math.trunc(Number(payload.maxItemsPerPass) || 15)),
            maxPasses: Math.max(1, Math.trunc(Number(payload.maxPasses) || 10)),
            requiredMin: requiredMinimum,
            tokenTarget: Math.max(1000, Math.trunc(Number(payload.tokenTarget) || (getModuleSettings().tokenWarningThreshold ?? 30000))),
            targetTier: normalizedTargetTier,
            lockedSummaries,
            allowAmbiguousAssignments: Boolean(getModuleSettings().showConsolidationPreviews && context),
            previousSummary: previousSummary?.content || null,
            previousOrder: previousSummary ? (parseSequenceFromTitle(previousSummary.comment || '') ?? null) : null,
        });
        const runAnalysis = async (entries, lockedSummaries = []) => {
            context?.setState?.('generating', { detail: targetLabel });
            return await runSequentialSummaryAnalysis(
                [...entries, ...gapMarkers],
                buildAnalysisOptions(lockedSummaries),
                profile,
                signal,
                onRateLimitWait,
            );
        };

        const analysisResult = await runAnalysis(realSourceEntries, []);
        const { summaryCandidates, leftovers, rawResponse, retryRawResponse } = analysisResult;
        if (summaryCandidates.length === 0) {
            const emptyError = new Error(`Model did not return a usable ${getSummaryTierLabel(normalizedTargetTier).toLowerCase()} summary`);
            emptyError.name = 'StmbSummaryParseError';
            emptyError.code = 'SUMMARY_NO_USABLE_SUMMARIES';
            emptyError.rawResponse = String(rawResponse || '').trim();
            emptyError.retryRawResponse = String(retryRawResponse || '').trim();
            throw emptyError;
        }

        if (getModuleSettings().showConsolidationPreviews && context) {
            const previewResult = await runConsolidationPreviewWorkflow({
                context,
                initialAnalysis: analysisResult,
                selectedEntries: realSourceEntries,
                sourceLabel,
                targetLabel,
                generateAnalysis: runAnalysis,
                commitCandidates: async candidates => {
                    context.setState('saving', { detail: lorebookName });
                    return await commitSummaryCandidates(candidates, {
                        normalizedTargetTier,
                        lorebookName,
                        titleFormat,
                        migrated,
                        disableOriginals: Boolean(payload.disableOriginals),
                        summaryEntrySettings: chosenSummaryEntrySettings,
                        sourceFingerprints,
                        sourceIds: collectSummaryMemberIds(candidates),
                        showSuccessToast: false,
                        signal,
                    });
                },
            });
            await runPostConsolidationCommitFlow({
                created: previewResult.created,
                normalizedTargetTier,
                lorebookName,
                sceneContext: payload.sceneContext || null,
            });
            return {
                lorebookName,
                targetTier: normalizedTargetTier,
                summaryCandidates: previewResult.summaryCandidates,
                leftovers: previewResult.leftovers,
                entries: previewResult.entries,
                canceled: previewResult.canceled,
            };
        }

        const createdEntries = await commitSummaryCandidates(summaryCandidates, {
            normalizedTargetTier,
            lorebookName,
            titleFormat,
            migrated,
            disableOriginals: Boolean(payload.disableOriginals),
            summaryEntrySettings: chosenSummaryEntrySettings,
            sourceFingerprints,
            showSuccessToast: false,
            signal,
        });

        await runPostConsolidationCommitFlow({
            created: createdEntries.length,
            normalizedTargetTier,
            lorebookName,
            sceneContext: payload.sceneContext || null,
        });

        return {
            lorebookName,
            targetTier: normalizedTargetTier,
            summaryCandidates,
            leftovers,
            entries: createdEntries,
        };
    } catch (error) {
        if (!isStmbAbortError(error) && error?.rawResponse) {
            lastFailedSummaryError = error;
            lastFailedSummaryContext = {
                lorebookName,
                normalizedTargetTier,
                titleFormat,
                disableOriginals: Boolean(payload.disableOriginals),
                selectedEntryIds,
                gapMarkers,
                summaryEntrySettings: chosenSummaryEntrySettings,
                maxItemsPerPass: Math.max(1, Math.trunc(Number(payload.maxItemsPerPass) || 15)),
                maxPasses: Math.max(1, Math.trunc(Number(payload.maxPasses) || 10)),
                tokenTarget: Math.max(1000, Math.trunc(Number(payload.tokenTarget) || (getModuleSettings().tokenWarningThreshold ?? 30000))),
                sceneContext: payload.sceneContext || null,
            };
            showFailedSummaryResponsePopup(error, {
                onApply: buildSummaryRepairHandler(lastFailedSummaryContext),
            });
        }
        throw error;
    }
}

async function executeConsolidationJob(job, context) {
    const payload = job?.payload || {};
    const runPayload = {
        ...payload,
        sceneContext: payload.sceneContext || job?.sceneContext || null,
    };
    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(runPayload.normalizedTargetTier || runPayload.targetTier) || 1)));
    context.setState('assembling_prompt', {
        detail: `${getSummaryTierLabel(getSourceTierForTarget(normalizedTargetTier))} -> ${getSummaryTierLabel(normalizedTargetTier)}`,
    });
    context.setState('generating', { detail: getSummaryTierLabel(normalizedTargetTier) });
    const result = await runSummaryConsolidationNow(runPayload, context.signal, wait => context.setState('generating', {
        detail: `Rate limited, retrying in ${Math.max(1, Math.ceil(Math.max(0, Number(wait?.delayMs) || 0) / 1000))}s`,
    }), context);
    if (result?.canceled && !(Array.isArray(result?.entries) && result.entries.length > 0)) {
        context.patch({ state: 'canceled', detail: 'Canceled in approval' });
    } else {
        context.setState('saving', { detail: runPayload.lorebookName || job?.lorebookName || '' });
    }
    context.setResult(result);
}

function showSlashCommandError(message, error) {
    if (isStmbLorebookHandledError(error)) {
        if (error?.message) {
            toastr.info(String(error.message), 'STMB');
        }
        return;
    }
    if (isStmbAbortError(error)) {
        toastr.info('STMB generation stopped', 'STMB');
        return;
    }
    if (error) {
        console.error('STMemoryBooks slash command failed:', error);
    }

    toastr.error(String(message || 'STMB command failed'), 'STMB');
}

function buildCurrentChatSavePayload() {
    const sceneContext = buildStmbSceneContext();
    return {
        chatId: String(sceneContext?.chatId || getCurrentChatId() || ''),
        isGroup: Boolean(selected_group),
        groupId: selected_group ? String(selected_group) : null,
        chatRef: sceneContext?.chatRef ? { ...sceneContext.chatRef } : null,
        avatarUrl: String(sceneContext?.chatRef?.avatarUrl || ''),
        fileName: String(sceneContext?.chatRef?.fileName || sceneContext?.chatId || ''),
    };
}

function queuePassiveStmbChecks(chatLike = buildCurrentChatSavePayload(), options = {}) {
    const { includeAutoSummary = false, includeTrackers = true } = options;
    const chatKey = getStmbChatKey(chatLike);
    if (!chatKey) {
        return;
    }

    const pending = pendingPassiveChecksByChat.get(chatKey) || {
        tracker: false,
        autoSummary: false,
        sceneContext: options.sceneContext || null,
        savedChat: { ...chatLike },
    };

    pending.tracker = pending.tracker || Boolean(includeTrackers);
    pending.autoSummary = pending.autoSummary || Boolean(includeAutoSummary);
    pending.sceneContext = options.sceneContext || pending.sceneContext;
    pending.savedChat = { ...pending.savedChat, ...chatLike };
    pendingPassiveChecksByChat.set(chatKey, pending);
}

function clearPendingPassiveStmbChecks(chatLike = null) {
    if (!chatLike) {
        pendingPassiveChecksByChat.clear();
        return;
    }

    const chatKey = getStmbChatKey(chatLike);
    if (chatKey) {
        pendingPassiveChecksByChat.delete(chatKey);
    }
}

function flushPassiveStmbChecks(savedChat = {}) {
    const chatKey = getStmbChatKey(savedChat);
    const pending = chatKey ? pendingPassiveChecksByChat.get(chatKey) : null;
    if (!pending) {
        return;
    }
    if (isPassiveStmbFlushSuppressedForChat(savedChat)) {
        return;
    }

    if (hasActiveStmbTasks() || hasActiveStmbJobs(chatKey)) {
        return;
    }

    pendingPassiveChecksByChat.delete(chatKey);

    const shouldCheckTrackers = pending.tracker;
    const shouldCheckAutoSummary = pending.autoSummary;

    if (shouldCheckTrackers) {
        evaluateTrackers(stmbSettings, { sceneContext: pending.sceneContext }).catch(error => {
            console.warn('STMB evaluateTrackers failed after chat save', error);
        });
    }

    if (shouldCheckAutoSummary) {
        checkAutoSummaryTrigger({ sceneContext: pending.sceneContext }).catch(error => {
            console.warn('STMB auto-summary trigger failed after chat save', error);
        });
    }
}

function launchMemoryCreationInBackground(options, errorMessage) {
    void initiateMemoryCreation(options).catch(error => {
        showSlashCommandError(error?.message || errorMessage || 'Failed to create memory.', error);
    });
}

async function createMemoryCommand() {
    const markers = getSceneMarkers() || {};
    if (markers.sceneStart == null || markers.sceneEnd == null) {
        console.error('STMemoryBooks: No scene markers set for createMemory command');
        toastr.error('No scene markers set. Use chevron buttons to mark start and end points first.', 'STMB');
        return '';
    }

    launchMemoryCreationInBackground({ range: getCurrentSceneRange() }, 'Failed to create memory.');

    return '';
}

async function sceneMemoryCommand(_, rangeText) {
    let range;
    try {
        range = parseSceneRange(rangeText);
    } catch (error) {
        toastr.error(String(error?.message || 'Failed to parse /scenememory range'), 'STMB');
        return '';
    }

    try {
        const rangeInfo = await fetchStmbChatRangeInfo({
            rangeStart: range.sceneStart,
            rangeEnd: range.sceneEnd,
        });
        const lastAvailableMessageId = Number(rangeInfo?.lastAvailableMessageId);
        if (!Number.isInteger(lastAvailableMessageId) || lastAvailableMessageId < 0) {
            toastr.error('There are no messages in this chat yet.', 'STMB');
            return '';
        }
        if (range.sceneStart > lastAvailableMessageId || range.sceneEnd > lastAvailableMessageId) {
            toastr.error(`Message IDs out of range. Valid range: 0-${lastAvailableMessageId}`, 'STMB');
            return '';
        }
        if (Array.isArray(rangeInfo?.missingRanges) && rangeInfo.missingRanges.length > 0) {
            const missing = rangeInfo.missingRanges[0];
            toastr.error(`Cannot use messages ${range.sceneStart}-${range.sceneEnd} because messages ${missing.start}-${missing.end} are unavailable in chat storage.`, 'STMB');
            return '';
        }
    } catch (error) {
        toastr.error(String(error?.message || 'Invalid message range for /scenememory'), 'STMB');
        return '';
    }

    setSceneRange(range.sceneStart, range.sceneEnd);
    const group = selected_group ? groups.find(item => item.id === selected_group) : null;
    const groupSuffix = group?.name ? ` in group "${group.name}"` : '';
    toastr.info(`Scene set: messages ${range.sceneStart}-${range.sceneEnd}${groupSuffix}`, 'STMB');
    launchMemoryCreationInBackground({ range, keepSceneMarkers: true }, 'Failed to create memory from scene range.');

    return '';
}

async function nextMemoryCommand() {
    try {
        if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(buildStmbSceneContext()))) {
            toastr.info('Memory creation is already in progress', 'STMB');
            return '';
        }

        const lorebookReady = await validateLorebookPreflight();
        if (!lorebookReady) {
            return '';
        }

        if (chat.length === 0) {
            toastr.info('There are no messages to summarize yet.', 'STMB');
            return '';
        }

        const range = await getNextMemoryRange();
        setSceneRange(range.sceneStart, range.sceneEnd);
        launchMemoryCreationInBackground({ range, keepSceneMarkers: true, notifyIfBusy: true }, 'Failed to create next memory.');
    } catch (error) {
        if (error?.message === 'No new messages available for /nextmemory') {
            toastr.info('No new messages since the last memory.', 'STMB');
            return '';
        }
        if (isStmbLorebookHandledError(error)) {
            return '';
        }
        if (/lorebook/i.test(String(error?.message || ''))) {
            toastr.error(`No lorebook available: ${error.message}`, 'STMB');
            return '';
        }
        showSlashCommandError(error?.message || 'Failed to create next memory.', error);
    }

    return '';
}

async function stmbCatchupCommand(namedArgs = {}) {
    try {
        const sceneContext = buildStmbSceneContext();
        const chatKey = getStmbChatKey(sceneContext);
        if (hasActiveStmbTasks() || hasActiveStmbJobs(chatKey)) {
            toastr.info('Memory creation is already in progress', 'STMB');
            return '';
        }

        if (!validateMemoryCreationContext()) {
            return '';
        }

        let parsed;
        try {
            parsed = parseStmbCatchupCommandArgs(namedArgs);
        } catch (error) {
            toastr.error(error?.message || 'Missing or invalid arguments. Use: /stmb-catchup interval=<chunk size> start=<message id> end=<message id>', 'STMB');
            return '';
        }

        const rangeInfo = await fetchStmbChatRangeInfo({
            rangeStart: parsed.start,
            rangeEnd: parsed.end,
            sceneContext,
        });
        let chunks;
        try {
            chunks = buildStmbCatchupChunks({
                interval: parsed.interval,
                start: parsed.start,
                end: parsed.end,
                lastAvailableMessageId: Number(rangeInfo?.lastAvailableMessageId),
                missingRanges: rangeInfo?.missingRanges || [],
            });
        } catch (error) {
            toastr.error(error?.message || 'Invalid /stmb-catchup range', 'STMB');
            return '';
        }

        const lorebookName = await ensureLorebookName();
        const profile = getActiveStmbProfile(stmbSettings, stmbSettings.defaultProfile ?? null);
        if (!validateConnectionProfilePreflight(profile)) {
            return '';
        }

        const tokenThreshold = Math.max(1000, Math.trunc(Number(getModuleSettings().tokenWarningThreshold ?? 30000)));
        const defaultMemoryCount = normalizeMemoryContextCount(getModuleSettings().defaultMemoryCount);
        const skipSystemMessages = !getModuleSettings().unhideBeforeMemory;
        const queuedProfile = buildEffectiveMemoryProfile(profile);
        const contextSettingKey = getChatContextSettingKey();

        ensureStmbJobExecutorsRegistered();
        for (let index = 0; index < chunks.length; index++) {
            const chunk = chunks[index];
            const range = {
                sceneStart: chunk.sceneStart,
                sceneEnd: chunk.sceneEnd,
            };
            let compiledScene = null;
            let manualGroupSnapshot = null;
            if (sceneContext.isGroupChat) {
                compiledScene = (await captureStmbSceneRange(range, {
                    skipSystemMessages,
                    sceneContext,
                }))?.compiledScene;
                const groupParticipantSnapshot = await prepareGroupMemoryParticipantSnapshot(compiledScene, sceneContext);
                if (!groupParticipantSnapshot) return '';
                if (getModuleSettings().manualModeEnabled) manualGroupSnapshot = groupParticipantSnapshot;
            }
            enqueueStmbJob({
                type: 'memory',
                range,
                lorebookName,
                sceneContext,
                characterName: sceneContext?.characterName || '',
                chatTitle: sceneContext?.chatId || '',
                title: `Catch-up ${index + 1}/${chunks.length}`,
                detail: `Messages ${range.sceneStart}-${range.sceneEnd}`,
                payload: {
                    range,
                    lorebookName,
                    profile: queuedProfile,
                    summaryCount: defaultMemoryCount,
                    contextSettingKey,
                    keepSceneMarkers: true,
                    source: 'catchup',
                    skipSystemMessages,
                    tokenWarningThreshold: tokenThreshold,
                    compiledScene,
                    manualGroupSnapshot,
                },
            });
        }

        toastr.info(`STMB catch-up queued: ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}.`, 'STMB');
    } catch (error) {
        showSlashCommandError(error?.message || 'Failed to run /stmb-catchup.', error);
    }

    return '';
}

async function sidePromptCommand(_, rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        toastr.info('SidePrompt guide: Choose a quoted template name, then fill any prompted macros. Usage: /sideprompt "Name" {{macro}}="value" [X-Y].', 'STMB');
        return '';
    }

    return await runSidePrompt(raw, stmbSettings);
}

async function sidePromptSetCommand(_, rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        toastr.info('SidePrompt set guide: Choose a quoted set name. Usage: /sideprompt-set "Name" [X-Y].', 'STMB');
        return '';
    }

    return await runSidePromptSet(raw, stmbSettings, { macroMode: false });
}

async function sidePromptMacroSetCommand(_, rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        toastr.info('SidePrompt macroset guide: Choose a quoted set name, then fill any prompted macros. Usage: /sideprompt-macroset "Name" {{macro}}="value" [X-Y].', 'STMB');
        return '';
    }

    return await runSidePromptSet(raw, stmbSettings, { macroMode: true });
}

async function toggleSidePromptCommand(_, rawInput, enabled) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        toastr.error(
            enabled
                ? 'Missing name. Use: /sideprompt-on "Name" OR /sideprompt-on all'
                : 'Missing name. Use: /sideprompt-off "Name" OR /sideprompt-off all',
            'STMB',
        );
        return '';
    }

    try {
        const result = await toggleSidePromptEnabled(raw, enabled);
        await refreshSidePromptCache();
        window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
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
        console.error('STMemoryBooks: sideprompt enable/disable failed:', error);
        if (String(error?.message || '').startsWith('Side Prompt not found: ')) {
            toastr.error(String(error.message), 'STMB');
            return '';
        }
        toastr.error(`Failed to toggle side prompt: ${error?.message || 'Unknown error'}`, 'STMB');
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
    const state = getStmbState();
    const highestProcessed = Number.isInteger(state?.highestMemoryProcessed)
        ? state.highestMemoryProcessed
        : null;
    return String(highestProcessed);
}

async function setHighestProcessedCommand(_, value) {
    const raw = String(value || '').trim();
    if (!raw) {
        toastr.error('Missing argument. Use: /stmb-set-highest <N|none>', 'STMB');
        return '';
    }

    const input = raw.toLowerCase();
    if (input === 'none') {
        delete getStmbState().highestMemoryProcessed;
        delete getStmbState().highestMemoryProcessedManuallySet;
        saveMetadataDebounced();
        refreshMemoryBoundaryUi();
        await refreshOpenSettingsPopupSceneState();
        toastr.success('Last processed message cleared (no memories processed).', 'STMB');
        return '';
    }

    const parsed = Number.parseInt(input, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        toastr.error('Invalid argument. Use: /stmb-set-highest <N|none>', 'STMB');
        return '';
    }
    if (parsed < 0) {
        toastr.error('Message IDs must be zero or greater.', 'STMB');
        return '';
    }

    const lastChatIndex = chat.length - 1;
    if (!Number.isInteger(lastChatIndex) || lastChatIndex < 0) {
        toastr.error('There are no messages in this chat yet.', 'STMB');
        return '';
    }

    const clamped = Math.min(parsed, lastChatIndex);
    if (clamped !== parsed) {
        toastr.info(
            `Highest message is ${lastChatIndex}, so last message processed has been set to ${lastChatIndex}.`,
            'STMB',
        );
    }

    const rangeInfo = await fetchStmbChatRangeInfo({
        rangeStart: clamped,
        rangeEnd: clamped,
    });
    const lastAvailableMessageId = Number(rangeInfo?.lastAvailableMessageId);
    if (!Number.isInteger(lastAvailableMessageId) || lastAvailableMessageId < 0) {
        toastr.error('There are no messages in this chat yet.', 'STMB');
        return '';
    }
    if (Array.isArray(rangeInfo?.missingRanges) && rangeInfo.missingRanges.length > 0) {
        const missing = rangeInfo.missingRanges[0];
        toastr.error(`Message #${clamped} is unavailable because messages ${missing.start}-${missing.end} are missing from chat storage.`, 'STMB');
        return '';
    }

    const state = getStmbState();
    state.highestMemoryProcessed = clamped;
    state.highestMemoryProcessedManuallySet = true;
    saveMetadataDebounced();
    refreshMemoryBoundaryUi();
    await refreshOpenSettingsPopupSceneState();
    toastr.success(`Last processed message manually set to #${clamped}.`, 'STMB');

    return '';
}

async function stopStmbCommand() {
    const before = getActiveStmbTaskCount();
    const { stoppedCount } = stopAllStmbTasks();
    const canceledJobs = cancelAllStmbJobs();
    if (stoppedCount > 0 || before > 0) {
        try {
            toastr.clear();
        } catch {
            // noop
        }
        closeActiveMemoryPreviewPopups();
    }
    if (activeRootTask) {
        activeRootTask = null;
    }

    const message = stoppedCount > 0 || before > 0 || canceledJobs > 0
        ? `STMB generation manually stopped by user.${canceledJobs > 0 ? ` Canceled ${canceledJobs} job${canceledJobs === 1 ? '' : 's'}.` : ''}`
        : 'STMB stop issued, but no generation is in progress.';
    toastr.info(message, 'STMB');
    console.log(`STMemoryBooks: ${message}`);
    pollCurrentChatPlannerState().catch(error => {
        console.warn('STMB planner poll failed after stop', error);
    });

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
        name: 'stmb-catchup',
        callback: stmbCatchupCommand,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'interval',
                description: 'Chunk size (number of messages per memory)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'start',
                description: 'Starting message ID',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'end',
                description: 'Ending message ID',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
            }),
        ],
        helpString: 'Create scene memories over a message range in chunks. Usage: /stmb-catchup interval=<chunk size> start=<message id> end=<message id>',
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
                enumProvider: manualSidePromptTemplateEnumProvider,
            }),
        ],
        helpString: 'Run side prompt. Usage: /sideprompt "Name" {{macro}}="value" [X-Y]',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'sideprompt-set',
        callback: sidePromptSetCommand,
        rawQuotes: true,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Quoted set name, optionally followed by X-Y range',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: sidePromptSetEnumProvider,
            }),
        ],
        helpString: 'Run side prompt set. Usage: /sideprompt-set "Name" [X-Y]',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'sideprompt-macroset',
        callback: sidePromptMacroSetCommand,
        rawQuotes: true,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Quoted set name, then any required {{macro}}="value" assignments, optionally followed by X-Y range',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: executor => sidePromptSetEnumProvider(executor, { includeMacros: true }),
            }),
        ],
        helpString: 'Run side prompt set with runtime macros. Usage: /sideprompt-macroset "Name" {{macro}}="value" [X-Y]',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'sideprompt-on',
        callback: sidePromptOnCommand,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Template name (quote if contains spaces) or "all"',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: () => [
                    new SlashCommandEnumValue('all'),
                    ...allSidePromptTemplateEnumProvider(),
                ],
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
                enumProvider: () => [
                    new SlashCommandEnumValue('all'),
                    ...allSidePromptTemplateEnumProvider(),
                ],
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

function getRegenerationDisabledMessage(eligibility) {
    const messages = {
        'active-parent': 'Delete the parent consolidation before regenerating this entry.',
        'missing-sources': 'The complete source set cannot be recovered.',
        'wrong-source-tier': 'The complete source set exactly one tier lower cannot be recovered.',
        'missing-number': 'The original sequence number cannot be recovered.',
        'missing-range': 'The original message range is missing or invalid.',
    };
    return messages[eligibility?.reason] || 'This entry cannot be regenerated.';
}

function getCurrentRegenerationLorebookNames() {
    const state = getStmbState();
    const names = new Set([
        String(chat_metadata?.[METADATA_KEY] || '').trim(),
        String(state.manualLorebook || '').trim(),
        ...Object.values(getManualCharacterLorebookBindings(state)).map(value => String(value || '').trim()),
    ]);
    names.delete('');
    return names;
}

async function findLinkedManualGroupLorebooks(lorebookName, entry) {
    if (!entry?.STMB_inclusionGroup && !entry?.STMB_canonicalEntryUid) return [];
    const state = getStmbState();
    const candidates = new Set([
        String(entry?.STMB_canonicalLorebook || '').trim(),
        String(state.manualLorebook || '').trim(),
        ...Object.values(getManualCharacterLorebookBindings(state)).map(value => String(value || '').trim()),
    ]);
    candidates.delete('');
    candidates.delete(lorebookName);
    const linked = [];
    for (const candidateName of candidates) {
        if (getLorebookStorageForRequest(candidateName) !== 'user') continue;
        try {
            const candidateData = await loadWorldInfo(candidateName);
            const match = Object.values(candidateData?.entries || {}).some(candidate => (
                entry.STMB_inclusionGroup && candidate?.STMB_inclusionGroup === entry.STMB_inclusionGroup
            ) || (
                entry.STMB_canonicalEntryUid !== undefined
                && String(candidate?.STMB_canonicalEntryUid ?? '') === String(entry.STMB_canonicalEntryUid)
                && String(candidate?.STMB_canonicalLorebook || '') === String(entry?.STMB_canonicalLorebook || lorebookName)
            ));
            if (match) linked.push(candidateName);
        } catch {
            // A missing linked copy does not block replacing the selected ordinary entry.
        }
    }
    return linked.length > 0 ? linked : ['other linked group books'];
}

async function buildBaseRegenerationDraft(lorebookName, lorebookData, entry, eligibility, task) {
    const sceneContext = buildStmbSceneContext();
    if (!isRegenerationSourceChatCurrent(
        entry,
        lorebookName,
        sceneContext.chatId,
        getCurrentRegenerationLorebookNames(),
    )) {
        throw new Error('This memory does not belong to the current chat and lorebook.');
    }
    const range = { sceneStart: eligibility.sceneStart, sceneEnd: eligibility.sceneEnd };
    const sceneCapture = await captureStmbSceneRange(range, {
        signal: task.signal,
        saveFirst: true,
        skipSystemMessages: !getModuleSettings().unhideBeforeMemory,
        sceneContext,
    });
    const compiledScene = sceneCapture?.compiledScene;
    if (!compiledScene || !Array.isArray(compiledScene.messages) || compiledScene.messages.length === 0) {
        throw new Error('No capturable messages remain in the original range.');
    }
    compiledScene.metadata = {
        ...(compiledScene.metadata || {}),
        stmbPromptTarget: Array.isArray(entry?.characterFilter?.names) && entry.characterFilter.names.length !== 1 && sceneContext.isGroupChat
            ? 'group'
            : 'character',
        characterFilterNames: normalizeStmbCharacterFilterNames(entry?.characterFilter?.names),
    };
    const effectiveSettings = await showAndGetMemorySettings(compiledScene, range, lorebookName);
    if (!effectiveSettings) return null;
    const previous = selectPreviousRegenerationMemories(lorebookData, entry.uid, effectiveSettings.summaryCount);
    const previousWorldInfo = {
        entries: Object.fromEntries(previous.summaries.map(memory => [memory.uid, {
            uid: memory.uid,
            comment: memory.title,
            content: memory.content,
            key: memory.keywords,
            [STMB_MANAGED_FLAG]: true,
        }])),
    };
    const memory = await requestStructuredMemory(
        compiledScene,
        effectiveSettings.profileSettings,
        lorebookName,
        effectiveSettings.summaryCount,
        task.signal,
        null,
        { worldInfoOverride: previousWorldInfo },
    );
    throwIfStmbAborted(task.signal);
    const titleFormat = effectiveSettings.profileSettings?.titleFormat || stmbSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT;
    return {
        generatedTitle: memory.title,
        generatedContent: memory.content,
        generatedKeywords: memory.keywords,
        formatTitle: semanticTitle => formatMemoryTitle(titleFormat, {
            title: semanticTitle,
            sceneStart: eligibility.sceneStart,
            sceneEnd: eligibility.sceneEnd,
            sceneRange: `${eligibility.sceneStart}-${eligibility.sceneEnd}`,
            characterName: compiledScene?.metadata?.characterName,
            userName: compiledScene?.metadata?.userName,
            messageCount: compiledScene?.metadata?.messageCount,
            profileName: effectiveSettings.profileSettings?.name,
        }, eligibility.sequenceNumber),
        sourceUids: [],
        sourceHashes: {},
        chatRef: sceneContext.chatRef,
        currentChatId: sceneContext.chatId,
        expectedChatRevision: Number(sceneCapture?.capture?.chatRevision),
    };
}

async function buildConsolidationRegenerationDraft(lorebookData, eligibility, task) {
    await firstRunInitArcPromptPresets(stmbSettings);
    const indexes = buildRegenerationIndexes(lorebookData);
    const sources = eligibility.sourceUids.map(uid => getRegenerationEntryByUid(lorebookData, uid, indexes));
    const analysis = await runSequentialSummaryAnalysis(sources, {
        presetKey: CONSOLIDATION_REGENERATION_PRESET_KEY,
        maxItemsPerPass: sources.length,
        maxPasses: 1,
        requiredMin: 1,
        tokenTarget: Number.MAX_SAFE_INTEGER,
        targetTier: eligibility.tier,
    }, getActiveStmbProfile(stmbSettings), task.signal);
    const candidates = Array.isArray(analysis?.summaryCandidates) ? analysis.summaryCandidates : [];
    if (candidates.length !== 1) {
        throw new Error('Regeneration must generate exactly one consolidation.');
    }
    const candidate = candidates[0];
    return {
        generatedTitle: candidate.title,
        generatedContent: candidate.summary,
        generatedKeywords: candidate.keywords,
        formatTitle: semanticTitle => formatSummaryTitle(
            eligibility.tier,
            getDefaultSummaryTitleFormat(eligibility.tier),
            semanticTitle,
            eligibility.sequenceNumber,
        ),
        sourceUids: [...eligibility.sourceUids],
        sourceHashes: Object.fromEntries(sources.map(source => [String(source.uid), hashRegenerationEntry(source)])),
        chatRef: null,
        currentChatId: '',
        expectedChatRevision: null,
    };
}

async function handleLorebookEntryRegeneration(button) {
    if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(buildStmbSceneContext()))) {
        toastr.warning('STMB generation is already in progress.', 'STMB');
        return;
    }
    const lorebookName = String(button?.dataset?.lorebookName || '').trim();
    const entryUid = String(button?.dataset?.entryUid || '').trim();
    if (!lorebookName || !entryUid || getLorebookStorageForRequest(lorebookName) !== 'user') return;
    const task = createStmbTask(`STMB:regenerate:${lorebookName}:${entryUid}`);
    button.disabled = true;
    try {
        const lorebookData = await loadWorldInfo(lorebookName);
        const entry = getRegenerationEntryByUid(lorebookData, entryUid);
        const eligibility = getRegenerationEligibility(entry, lorebookData);
        if (!eligibility.eligible) throw new Error(getRegenerationDisabledMessage(eligibility));
        const targetHash = hashRegenerationEntry(entry);
        const linkedLorebooks = await findLinkedManualGroupLorebooks(lorebookName, entry);
        const draft = eligibility.kind === 'memory'
            ? await buildBaseRegenerationDraft(lorebookName, lorebookData, entry, eligibility, task)
            : await buildConsolidationRegenerationDraft(lorebookData, eligibility, task);
        if (!draft) return;
        throwIfStmbAborted(task.signal);
        const review = await showRegenerationReviewPopup({
            originalEntry: entry,
            generatedTitle: draft.generatedTitle,
            generatedContent: draft.generatedContent,
            generatedKeywords: draft.generatedKeywords,
            formatTitle: draft.formatTitle,
            linkedLorebooks,
        });
        if (review.action !== 'replace') return;
        throwIfStmbAborted(task.signal);
        await regenerateStmbEntry({
            lorebookName,
            storage: 'user',
            uid: entryUid,
            replacement: {
                title: review.title,
                content: review.content,
                keywords: review.keywords,
            },
            expectedTargetHash: targetHash,
            sourceUids: draft.sourceUids,
            sourceHashes: draft.sourceHashes,
            chatRef: draft.chatRef,
            currentChatId: draft.currentChatId,
            expectedChatRevision: draft.expectedChatRevision,
        }, { signal: task.signal });
        worldInfoCache.delete(lorebookName);
        await Promise.resolve(reloadEditor(lorebookName));
        toastr.success('Memory regenerated successfully.', 'STMB');
    } catch (error) {
        if (!isStmbAbortError(error)) {
            toastr.error(error?.message || 'Memory regeneration failed.', 'STMB');
        }
    } finally {
        task.cleanup();
        button.disabled = false;
    }
}

export function initStmb() {
    if (stmbInitialized) {
        return;
    }

    configureClipRuntime();
    createMainEntryUi();
    ensurePlannerStatusUi();
    void pollCurrentChatPlannerState();
    $(document).on('click', '#stmb-menu-item', () => {
        showMainEntryPopup().catch(error => {
            console.warn('STMB main entry popup failed', error);
        });
    });
    registerStmbRegenerationHandler(handleLorebookEntryRegeneration);
    window.addEventListener(OPEN_APPROVAL_EVENT, event => {
        const jobId = String(event?.detail?.jobId || '').trim();
        if (!jobId) {
            return;
        }

        openPlannerApprovalByJobId(jobId).catch(error => {
            console.warn('STMB approval popup failed from job notification', error);
        });
    });
    bindSceneButtons();
    initializeFloatingClipButton();
    registerSlashCommands();
    firstRunInitArcPromptPresets(stmbSettings).catch(error => {
        console.warn('STMB consolidation prompts init failed', error);
    });
    firstRunInitSummaryPromptPresets(stmbSettings).catch(error => {
        console.warn('STMB summary prompts init failed', error);
    });
    firstRunInitSidePrompts().catch(error => {
        console.warn('STMB side prompts init failed', error);
    });
    refreshSidePromptCache().catch(error => {
        console.warn('STMB side prompt cache refresh failed during init', error);
    });
    ensureStmbJobExecutorsRegistered();
    initStmbJobsUi();
    refreshFloatingJumpButtons();
    setTimeout(() => {
        validateSceneMarkers();
        renderAllSceneButtons();
    }, 0);
    window.addEventListener('resize', refreshFloatingJumpButtons);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        hideFloatingClipButton();
        void pollCurrentChatPlannerState();
        flushDeferredPostSaveEffects().catch(error => {
            console.warn('STMB deferred post-save flush failed', error);
        });
        setTimeout(() => {
            validateSceneMarkers();
            renderAllSceneButtons();
        }, 0);
        initStmbJobsUi();
    });

    eventSource.on(event_types.LOREBOOK_REFERENCES_UPDATED, handleLorebookReferencesUpdated);
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
        refreshMemoryBoundaryUi();
        if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(buildStmbSceneContext()))) {
            return;
        }
        const sceneContext = buildStmbSceneContext();
        queuePassiveStmbChecks(sceneContext, { includeAutoSummary: !selected_group, sceneContext });
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
        refreshMemoryBoundaryUi();
        if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(buildStmbSceneContext()))) {
            return;
        }
        const sceneContext = buildStmbSceneContext();
        queuePassiveStmbChecks(sceneContext, { includeAutoSummary: false, sceneContext });
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
        refreshMemoryBoundaryUi();
    });

    eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
        renderAllSceneButtons();
    });

    eventSource.on(event_types.SETTINGS_LOADED, () => {
        refreshFloatingClipButtonSetting();
        refreshFloatingJumpButtons();
        renderAllSceneButtons();
    });

    eventSource.on(event_types.FLOATING_BUTTONS_UPDATED, () => {
        refreshFloatingJumpButtons();
    });

    eventSource.once(event_types.APP_READY, () => {
        refreshFloatingJumpButtons();
    });

    eventSource.on(event_types.MESSAGE_DELETED, (deletedId) => {
        handleMessageDeletion(deletedId);
    });

    eventSource.on(event_types.CHAT_SAVED, (savedChat) => {
        flushPassiveStmbChecks(savedChat);
    });

    eventSource.on(event_types.GROUP_WRAPPER_FINISHED, () => {
        if (hasActiveStmbTasks() || hasActiveStmbJobs(getStmbChatKey(buildStmbSceneContext()))) {
            return;
        }
        const sceneContext = buildStmbSceneContext();
        queuePassiveStmbChecks(sceneContext, { includeAutoSummary: true, includeTrackers: false, sceneContext });
        flushPassiveStmbChecks(buildCurrentChatSavePayload());
    });

    stmbInitialized = true;
}
