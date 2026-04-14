import {
    applyChunkedChatPayload,
    chat,
    chatElement,
    chat_metadata,
    eventSource,
    event_types,
    getCurrentChatId,
    getFirstDisplayedMessageId,
    name1,
    name2,
    renderMessageWindow,
    scrollChatToBottom,
    saveSettingsDebounced,
    substituteParams,
    substituteParamsExtended,
    toggleTopChatSidebar,
} from '../script.js';
import { DOMPurify } from '../lib.js';
import { getContext, saveMetadataDebounced } from './extensions.js';
import {
    commitStmbSummaries,
    generateStmbMemory,
    generateStmbSummary,
    generateStmbText,
    saveStmbMemoryEntry,
} from './stmb-api.js';
import { closeActiveMemoryPreviewPopups, showAdvancedOptionsPopup, showAutoConsolidationPromptPopup, showAutoSummaryDecisionPopup, showConfirmationPopup, showFailedAIResponsePopup, showFailedSummaryResponsePopup, showLorebookPickerPopup, showMemoryPreviewPopup, showSummaryConsolidationOptionsPopup } from './stmb-popups.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { applyLocale, translate } from './i18n.js';
import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from './slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue } from './slash-commands/SlashCommandEnumValue.js';
import { hideChatMessageRange } from './chats.js';
import { groups, selected_group } from './group-chats.js';
import { getRegexScripts, runRegexScript, substitute_find_regex } from './extensions/regex/engine.js';
import { getLorebookStorageForRequest, loadWorldInfo, METADATA_KEY, reloadEditor, world_names, worldInfoCache } from './world-info.js';
import { buildOpenAIGenerateData, oai_settings } from './openai.js';
import { buildMemoryPromptText } from './stmb-prompt-assembly.js';
import {
    applyDeletedMessageToSceneState,
    applyStmbProfileToGenerateData,
    applyStmbMaxTokensToGenerateData,
    parseSceneRange,
    compiledSceneToText,
    createDefaultStmbProfile,
    findOverlappingManagedMemoryEntry,
    normalizeLorebookEntrySettings,
    STMB_DEFAULT_MAX_TOKENS,
    STMB_DEFAULT_PROMPTS,
    STMB_DEFAULT_MEMORY_SCHEMA,
    STMB_DEFAULT_TITLE_FORMAT,
    STMB_DEFAULT_TITLE_FORMATS,
    STMB_METADATA_KEY,
    compileScene,
    getActiveStmbProfile,
    identifyManagedMemoryEntries,
    normalizeStmbSettings,
    parseSequenceFromTitle,
    parseStructuredMemoryResponse,
} from './stmb-core.js';
import { buildStmbSceneContext, captureStmbSceneRange, fetchStmbChatRangeInfo, getStmbChatKey, isPassiveStmbFlushSuppressedForChat } from './stmb-scene.js';
import {
    STMB_SUMMARY_RESPONSE_SCHEMA,
    buildBriefsFromEntries,
    buildSummaryAnalysisPrompt,
    createSummaryCandidatesFromResponse,
    getDefaultSummaryMinChildren,
    getDefaultSummaryTitleFormat,
    getSummaryTierLabel,
    getSourceTierForTarget,
    identifyEligibleSummarySourceEntries,
    identifyManagedSummaryEntries,
    migrateLorebookSummarySchema,
    normalizeSummaryMinChildren,
    parseSummaryJsonResponse,
    pluralizeSummaryLabel,
    resolveSelectedSummarySourceEntries,
} from './stmb-summary.js';
import {
    evaluateTrackers,
    firstRunInitSidePrompts,
    enqueueAfterMemorySidePromptJobs,
    runSidePrompt,
    toggleSidePromptEnabled,
} from './stmb-sideprompts.js';
import {
    firstRunInitArcPromptPresets,
    duplicateArcPromptPresetFile,
    exportArcPromptPresetsJsonFile,
    getCachedArcPromptDisplayName,
    getCachedArcPromptText,
    importArcPromptPresetsJsonFile,
    listCachedArcPromptPresets,
    recreateBuiltInArcPromptOverridesFile,
    removeArcPromptPresetFile,
    upsertArcPromptPresetFile,
} from './stmb-arc-prompt-manager.js';
import {
    duplicateSummaryPromptPresetFile,
    exportSummaryPromptPresetsJsonFile,
    firstRunInitSummaryPromptPresets,
    getCachedSummaryPromptDisplayName,
    getCachedSummaryPromptText,
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
    parseSidePromptCommandInput,
} from './stmb-sideprompt-macros.js';
import {
    duplicateTemplate,
    exportSidePromptsJson,
    getCachedTemplateSnapshot,
    getTemplate,
    importSidePromptsJson,
    listTemplates,
    recreateBuiltInSidePrompts,
    removeTemplate,
    upsertTemplate,
} from './stmb-sideprompts-manager.js';
import { escapeHtml } from './utils.js';
import { ensureResolvedLorebookName, isStmbLorebookHandledError } from './stmb-lorebook.js';
import { createStmbTask, getActiveStmbTaskCount, hasActiveStmbTasks, isStmbAbortError, stopAllStmbTasks, throwIfStmbAborted } from './stmb-tasks.js';
import { getTokenCountAsync } from './tokenizers.js';
import {
    cancelAllStmbJobs,
    enqueueStmbJob,
    hasActiveStmbJobs,
    initStmbJobsUi,
    registerStmbJobExecutor,
} from './stmb-jobs.js';

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
let activeSettingsPopupDialog = null;
const pendingPassiveChecksByChat = new Map();
let plannerStatusPollHandle = null;
let plannerStatusPollInFlight = false;
const handledPlannerTerminalJobUpdates = new Map();
const handledPlannerApprovalPrompts = new Map();
let plannerChatReloadPromise = null;
const PLANNER_ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'awaiting_approval']);
const PLANNER_TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'canceled', 'rejected', 'skipped']);
const PLANNER_RECENT_JOB_WINDOW_MS = 15 * 60 * 1000;
const PLANNER_UI_MAX_ROWS = 12;
let latestPlannerJobs = [];
let plannerStatusUiInitialized = false;
let plannerStatusButton = null;
let plannerStatusBadge = null;
const dismissedPlannerNotificationIds = new Set();

const DURABLE_SYNC_STATE_KEYS = [
    'sceneStart',
    'sceneEnd',
    'highestMemoryProcessed',
    'highestMemoryProcessedManuallySet',
    'autoSummaryNextPromptAt',
    'manualLorebook',
    'autoConsolidationLastPromptKey',
];

function applyServerPlannerStateToLocal(state = {}) {
    const localState = getStmbState();
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
    try {
        const result = await getStmbPlannerChatState({ sceneContext });
        applyServerPlannerStateToLocal(result?.state || {});
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
            container.append(createPlannerSidebarJobItem(job));
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
    const shouldInterceptKeydown = event.type === 'keydown'
        && !(event.key === 'Enter' || event.key === ' ');
    if (shouldInterceptKeydown) {
        return;
    }

    if (event.type === 'keydown') {
        event.preventDefault();
    }

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
        || !(plannerButton instanceof HTMLElement)
        || !(sidebar instanceof HTMLElement)) {
        setTimeout(() => ensurePlannerStatusUi(), 250);
        return;
    }

    plannerButton.addEventListener('click', handlePlannerSidebarButtonInteraction);
    plannerButton.addEventListener('keydown', handlePlannerSidebarButtonInteraction);

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
            : (Number.isInteger(payload?.tailStartId) && Number(previousStartId) < payload.tailStartId ? 'history' : 'tail');

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
        await handlePlannerApprovalRequests(jobs);
        await refreshPlannerEffectsFromJobs(jobs);
        latestPlannerJobs = jobs;
        pruneDismissedPlannerNotifications(jobs);
        renderPlannerStatusUi();
        const hasActiveJobs = jobs.some(job => ['pending', 'running', 'awaiting_approval'].includes(String(job?.status || '')));
        const hasRecentTerminal = jobs.some(job => ['completed', 'failed', 'canceled', 'rejected', 'skipped'].includes(String(job?.status || '')) && Number(job?.updatedAt || 0) > (Date.now() - 15_000));
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

async function handlePlannerApprovalRequests(jobs = []) {
    const now = Date.now();
    pruneHandledPlannerTerminalJobs(now);

    const pendingApprovals = (Array.isArray(jobs) ? jobs : [])
        .filter(job => String(job?.status || '') === 'awaiting_approval' && ['memoryApproval', 'sidePromptApproval'].includes(String(job?.kind || '')))
        .sort((left, right) => Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0));

    for (const job of pendingApprovals) {
        const jobId = String(job?.id || '');
        const updatedAt = Number(job?.updatedAt || 0);
        if (!jobId) {
            continue;
        }
        if ((handledPlannerApprovalPrompts.get(jobId) || 0) >= updatedAt) {
            continue;
        }

        handledPlannerApprovalPrompts.set(jobId, updatedAt || now);
        const approvalRequest = job?.approvalRequest && typeof job.approvalRequest === 'object'
            ? job.approvalRequest
            : {};

        try {
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
                continue;
            }

            if (previewResult?.action === 'edit' && previewResult.memoryData) {
                await respondStmbPlannerApproval({
                    jobId,
                    decision: 'approve',
                    editedData: isSidePrompt
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
                    },
                });
                continue;
            }

            await respondStmbPlannerApproval({
                jobId,
                decision: 'reject',
            });
        } catch (error) {
            handledPlannerApprovalPrompts.delete(jobId);
            console.warn('STMB planner approval response failed', error);
        }
    }
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
    'sceneStart',
    'sceneEnd',
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
    } catch (error) {
        console.warn('STMB side prompt cache refresh failed', error);
    }
}

window.addEventListener('stmb-sideprompts-updated', refreshSidePromptCache);
try {
    refreshSidePromptCache();
} catch {
    // noop
}

function findCachedSidePromptByName(name, entries = sidePromptNameCache) {
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

function getEffectivePromptText(profile) {
    if (typeof profile?.promptText === 'string' && profile.promptText.trim()) {
        return profile.promptText;
    }

    return getCachedSummaryPromptText(profile?.preset, stmbSettings);
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

function buildSettingsPopupHtml(sceneData, currentUiConnection, regexOptions) {
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

    return `
        <div class="stmb-settings-popup">
            <h2>Memory Books Settings</h2>
            <div id="stmb-settings-scene-section">${buildSettingsPopupSceneSectionHtml(sceneData)}</div>

            <div id="stmb-settings-memory-status" class="info-block marginBot10">${buildSettingsPopupMemoryStatusHtml(sceneData)}</div>

            <h3 class="stmb-section-title">Preferences</h3>
            <div class="world_entry_form_control">
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-always-use-default" ${moduleSettings.alwaysUseDefault ? 'checked' : ''}> <span>Always use default profile (no confirmation prompt)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-show-memory-previews" ${moduleSettings.showMemoryPreviews ? 'checked' : ''}> <span>Show memory previews</span></label>
                <label class="checkbox_label"><input type="checkbox" id="stmb-settings-show-notifications" ${moduleSettings.showNotifications ? 'checked' : ''}> <span>Show notifications</span></label>
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
            <div class="world_entry_form_control">
                <label for="stmb-settings-lorebook-name-template" title="Template for auto-created lorebook names. Supports {{char}}, {{user}}, {{chat}} placeholders.">Lorebook Name Template</label>
                <input type="text" id="stmb-settings-lorebook-name-template" class="text_pole" value="${escapeHtml(String(moduleSettings.lorebookNameTemplate || 'LTM - {{char}} - {{chat}}'))}" ${moduleSettings.autoCreateLorebook ? '' : 'disabled'} title="Template for auto-created lorebook names. Supports {{char}}, {{user}}, {{chat}} placeholders.">
            </div>

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

            <h3 class="stmb-section-title">Memory Profiles</h3>
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
                <div class="marginBot5">Profile Actions</div>
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
            <h3 class="stmb-section-title">Prompt Managers</h3>
            <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap">
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
    if (manualModeCheckbox) {
        manualModeCheckbox.disabled = Boolean(moduleSettings.autoCreateLorebook);
    }
    if (autoCreateCheckbox) {
        autoCreateCheckbox.disabled = manualMode;
    }
    if (lorebookTemplateInput) {
        lorebookTemplateInput.disabled = !moduleSettings.autoCreateLorebook;
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
                            <button class="menu_button stmb-action stmb-action-duplicate whitespacenowrap" data-action="duplicate" title="Duplicate" aria-label="Duplicate" data-i18n="[title]STMemoryBooks_Duplicate;[aria-label]STMemoryBooks_Duplicate" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                            <button class="menu_button stmb-action stmb-action-delete whitespacenowrap" data-action="delete" title="Delete" aria-label="Delete" data-i18n="[title]STMemoryBooks_Delete;[aria-label]STMemoryBooks_Delete" style="display:inline-flex; align-items:center; justify-content:center; width:auto; min-width:0; margin:0;">
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
    `), POPUP_TYPE.TEXT, '', {
        okButton: sourceKey && !duplicate ? translate('Save', 'STMemoryBooks_Save') : translate('Create', 'STMemoryBooks_Create'),
        cancelButton: translate('Cancel', 'STMemoryBooks_Cancel'),
    });
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
    `), POPUP_TYPE.TEXT, '', {
        okButton: sourceKey && !duplicate ? 'Save' : 'Create',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

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
        `), POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            okButton: false,
            cancelButton: translate('Close', 'STMemoryBooks_Close'),
        });
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
                    toastr.success(`Removed ${result.removed || 0} built-in overrides`, 'Memory Books');
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
    `), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: 'Close',
    });

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
                    await removeArcPromptPreset(selectedPresetKey);
                    toastr.success('Consolidation preset deleted successfully', 'STMB');
                    selectedPresetKey = null;
                }
                refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
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
                'This removes overrides for all built-in consolidation presets. Custom presets are not affected.',
            );
            if (!confirm) {
                return;
            }
            const result = await recreateBuiltInArcPromptOverridesFile();
            selectedPresetKey = null;
            refreshArcPromptManagerList(popup.dlg, selectedPresetKey);
            toastr.success(`Removed ${result.removed} built-in consolidation prompt overrides`, 'STMB');
            await notifyChange();
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

function buildSidePromptProfileOptionsHtml(selectedIndex) {
    return (stmbSettings.profiles || []).map((profile, index) => `
        <option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(getProfileDisplayName(profile))}</option>
    `).join('');
}

function buildSidePromptEditorHtml(template = null, options = {}) {
    const mode = String(options.mode || (template ? 'edit' : 'new'));
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

function readSidePromptEditorPayload(dialog, template = null) {
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

    const settings = {
        ...(template?.settings || {}),
        previousMemoriesCount,
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
    };
}

async function openSidePromptEditorPopup({ templateKey = null } = {}) {
    const template = templateKey ? await getTemplate(templateKey) : null;
    if (templateKey && !template) {
        throw new Error(`Template "${templateKey}" not found`);
    }

    const popup = new Popup(DOMPurify.sanitize(buildSidePromptEditorHtml(template, { mode: template ? 'edit' : 'new' })), POPUP_TYPE.TEXT, '', {
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
                const { payload, strippedAutoTriggers } = readSidePromptEditorPayload(popupInstance.dlg, template);
                const savedKey = await upsertTemplate(payload);
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
                toastr.error(error?.message || 'Failed to save side prompt', 'STMB');
                return false;
            }
        },
    });

    attachSidePromptEditorHandlers(popup.dlg);
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }

    return popup.stmbSavedKey || null;
}

async function showSidePromptManagerPopup({ onChange = null } = {}) {
    let selectedTemplateKey = null;
    const parsedMaxConcurrent = Number(stmbSettings?.moduleSettings?.sidePromptsMaxConcurrent ?? 2);
    const maxConcurrent = Number.isFinite(parsedMaxConcurrent)
        ? Math.max(1, Math.min(5, Math.trunc(parsedMaxConcurrent)))
        : 2;
    const popup = new Popup(DOMPurify.sanitize(`
        <div class="stmb-sideprompt-manager-popup">
            <h3>Trackers & Side Prompts</h3>
            <div class="world_entry_form_control">
                <p>Create and manage side prompts for trackers and other behind-the-scenes functions.</p>
            </div>
            <div class="world_entry_form_control">
                <input type="text" id="stmb-sp-search" class="text_pole" placeholder="Search side prompts..." aria-label="Search side prompts">
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-sp-max-concurrent"><h4>How many concurrent prompts to run at once</h4></label>
                <input type="number" id="stmb-sp-max-concurrent" class="text_pole" min="1" max="5" step="1" value="${escapeHtml(String(maxConcurrent))}">
                <small class="opacity70p">Range 1-5. Defaults to 2.</small>
            </div>
            <div id="stmb-sp-list" class="padding10 marginBot10" style="max-height: 400px; overflow-y: auto;"></div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-sp-new" class="menu_button whitespacenowrap">New</button>
                <button id="stmb-sp-export" class="menu_button whitespacenowrap">Export JSON</button>
                <button id="stmb-sp-import" class="menu_button whitespacenowrap">Import JSON</button>
                <button id="stmb-sp-recreate-builtins" class="menu_button whitespacenowrap">Recreate Built-in Side Prompts</button>
            </div>
            <input type="file" id="stmb-sp-import-file" accept=".json" style="display:none">
        </div>
    `), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Close',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

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
        const value = Math.max(1, Math.min(5, Number(target?.value || 2)));
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
            toastr.success(`Imported side prompts: ${result.added} added${result.renamed ? ` (${result.renamed} renamed due to key conflicts)` : ''}`, 'STMB');
            showSidePromptRuntimeMacroImportNormalizationToast(result.strippedDetails);
            await notifyChange();
        } catch (error) {
            toastr.error(error?.message ? `Failed to import side prompts: ${error.message}` : 'Failed to import side prompts', 'STMB');
        }
    });

    await refreshSidePromptManagerList(popup.dlg, selectedTemplateKey);
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
                <label for="stmb-profile-editor-model">Model</label>
                <input id="stmb-profile-editor-model" class="text_pole" value="${escapeHtml(String(connection.model || ''))}" ${String(connection.api || 'current_st') === 'current_st' ? 'disabled' : ''}>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-profile-editor-temperature">Temperature</label>
                <input id="stmb-profile-editor-temperature" type="number" min="0" max="2" step="0.1" class="text_pole" value="${escapeHtml(String(connection.temperature ?? 0.7))}" ${String(connection.api || 'current_st') === 'current_st' ? 'disabled' : ''}>
            </div>
            <div id="stmb-profile-editor-manual-section" class="${String(connection.api || 'current_st') === 'full-manual' ? '' : 'displayNone'}">
                <div class="world_entry_form_control">
                    <label for="stmb-profile-editor-endpoint">API Endpoint URL</label>
                    <input id="stmb-profile-editor-endpoint" class="text_pole" value="${escapeHtml(String(connection.endpoint || ''))}">
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
    profile.connection = profile.connection && typeof profile.connection === 'object' ? profile.connection : {};
    profile.connection.api = isBuiltin
        ? 'current_st'
        : String(dialog.querySelector('#stmb-profile-editor-api')?.value || profile.connection.api || 'current_st').trim();

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
    const presetSelect = dialog.querySelector('#stmb-profile-editor-preset');
    if (!presetSelect) {
        return;
    }
    const selectedValue = String(preferredSelectedValue || presetSelect.value || 'summary');
    presetSelect.innerHTML = getProfilePresetKeys().map(key => (
        `<option value="${escapeHtml(key)}" ${key === selectedValue ? 'selected' : ''}>${escapeHtml(getSummaryPromptDisplayName(key))}</option>`
    )).join('');
    if (!Array.from(presetSelect.options).some(option => option.value === selectedValue)) {
        presetSelect.value = 'summary';
    } else {
        presetSelect.value = selectedValue;
    }
}

function createMainEntryUi() {
    if (stmbUiBound || $('#stmb-menu-item').length > 0) {
        stmbUiBound = true;
        return;
    }

    const menuItem = $(`
        <div id="stmb-menu-item-container" class="extension_container interactable" tabindex="0">
            <div id="stmb-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-book extensionsMenuExtensionButton"></div>
                <span>Memory Books</span>
            </div>
        </div>
    `);
    const extensionsMenu = $('#extensionsMenu');
    if (extensionsMenu.length > 0) {
        extensionsMenu.append(menuItem);
        stmbUiBound = true;
    } else {
        setTimeout(() => {
            if (!stmbUiBound) {
                createMainEntryUi();
            }
        }, 250);
    }
}

async function showMainEntryPopup() {
    await firstRunInitArcPromptPresets(stmbSettings);
    await firstRunInitSummaryPromptPresets(stmbSettings);
    const sceneData = await getSettingsPopupSceneData();
    const currentUiConnection = await getCurrentUiConnectionInfo();
    const regexOptions = getSettingsRegexOptions();
    const popup = new Popup(DOMPurify.sanitize(buildSettingsPopupHtml(sceneData, currentUiConnection, regexOptions)), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: 'Close',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        customButtons: [
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
                result: null,
                classes: ['menu_button'],
                action: async () => {
                    const initialTargetTier = Number(readSelectedValues(popup.dlg?.querySelector('#stmb-settings-auto-consolidation-target-tier')).at(0) || 1);
                    await showSummaryConsolidationPopup({ initialTargetTier });
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
        ],
    });
    activeSettingsPopupDialog = popup.dlg ?? null;

    setTimeout(() => {
        try {
            if (window.jQuery && typeof window.jQuery.fn.select2 === 'function') {
                const $parent = window.jQuery(popup.dlg);
                window.jQuery('#stmb-settings-auto-consolidation-target-tier').select2({
                    width: '100%',
                    placeholder: 'Select tiers…',
                    closeOnSelect: false,
                    dropdownParent: $parent,
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
        const persistSettings = () => {
            stmbSettings = normalizeStmbSettings(stmbSettings);
            saveSettingsDebounced();
            updateSettingsPopupDynamicState(popup.dlg, currentUiConnection);
        };

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
        if (target.matches('#stmb-settings-show-notifications')) {
            moduleSettings.showNotifications = target.checked;
            persistSettings();
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
            if (!Number.isFinite(value) || value < 1000 || value > 100000) {
                return;
            }
            moduleSettings.tokenWarningThreshold = value;
            persistSettings();
            return;
        }
        if (target.matches('#stmb-settings-default-memory-count')) {
            const value = Number(target.value);
            moduleSettings.defaultMemoryCount = Number.isFinite(value) ? Math.max(0, Math.min(7, Math.trunc(value))) : 0;
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
                    if (chatBoundLorebook) {
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
                            const selectedLorebook = await showLorebookPickerPopup(Array.isArray(world_names) ? world_names : [], {
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
                        const selectedLorebook = await showLorebookPickerPopup(Array.isArray(world_names) ? world_names : [], {
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
            moduleSettings.autoConsolidationTargetTiers = readSelectedValues(target).map(value => Number(value)).filter(Number.isFinite);
            persistSettings();
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

        if (target.closest('#stmb-settings-select-lorebook')) {
            const selectedLorebook = await showLorebookPickerPopup(Array.isArray(world_names) ? world_names : [], {
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

async function estimateAdvancedMemoryTokens(compiledScene, lorebookName, options = {}) {
    const profileIndex = Number.isInteger(options?.profileIndex) ? options.profileIndex : null;
    const promptText = String(options?.promptText || '').trim();
    const memoryCount = Number.isFinite(Number(options?.memoryCount))
        ? Math.max(0, Math.min(7, Math.trunc(Number(options.memoryCount))))
        : 0;
    const effectiveProfile = structuredClone(getActiveStmbProfile(stmbSettings, profileIndex));

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
    const worldInfo = await loadWorldInfo(lorebookName) || { entries: {} };
    const finalPromptText = buildMemoryPromptText(compiledScene, effectiveProfile, worldInfo, requestSettings);
    return await getTokenCountAsync(String(finalPromptText || ''));
}

async function showAndGetMemorySettings(compiledScene, range, lorebookName, selectedProfileIndex = null) {
    await firstRunInitSummaryPromptPresets(stmbSettings);
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

    if (confirmation.action === 'settings') {
        await showMainEntryPopup();
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
        effectiveProfile.promptText = advanced.promptText;
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
    renderAllSceneButtons();
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
}

function setSceneRange(sceneStart, sceneEnd, chatScope = null) {
    const state = getStmbState(chatScope);
    state.sceneStart = Number(sceneStart);
    state.sceneEnd = Number(sceneEnd);
    renderAllSceneButtons();
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
}

function clearSceneMarkers() {
    const state = getStmbState();
    delete state.sceneStart;
    delete state.sceneEnd;
    renderAllSceneButtons();
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
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
    refreshOpenSettingsPopupSceneState().catch(error => {
        console.warn('STMB settings popup scene refresh failed', error);
    });
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
    if (sceneStart < 0) {
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

    try {
        const resolvedLorebookName = await ensureResolvedLorebookName({
            manualMode: true,
            getManualLorebook: () => getStmbState().manualLorebook,
            setManualLorebook: async selectedLorebook => {
                getStmbState().manualLorebook = String(selectedLorebook || '').trim();
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
    const previousHighestProcessed = Number.isInteger(state.highestMemoryProcessed) ? state.highestMemoryProcessed : null;
    const hadHighestProcessed = Object.hasOwn(state, 'highestMemoryProcessed');
    const hadHighestProcessedManuallySet = Object.hasOwn(state, 'highestMemoryProcessedManuallySet');
    const result = applyDeletedMessageToSceneState(state, id, chat.length);

    if (result.changed) {
        state.sceneStart = result.sceneStart;
        state.sceneEnd = result.sceneEnd;
        state.highestMemoryProcessed = result.highestProcessed;
        if (result.highestProcessed === null) {
            delete state.highestMemoryProcessed;
            delete state.highestMemoryProcessedManuallySet;
        }
        const shouldPersistHighestProcessed = previousHighestProcessed !== result.highestProcessed
            || (result.highestProcessed === null && (hadHighestProcessed || hadHighestProcessedManuallySet));
        if (shouldPersistHighestProcessed) {
            saveMetadataDebounced();
        }
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

function renderLorebookNameFromTemplate() {
    const chatId = getCurrentChatId() || 'Chat';
    return String(getModuleSettings().lorebookNameTemplate || 'LTM - {{char}} - {{chat}}')
        .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
        .replace(/\{\{user\}\}/g, String(name1 || 'User'))
        .replace(/\{\{chat\}\}/g, String(chatId));
}

async function ensureLorebookName() {
    return ensureResolvedLorebookName({
        manualMode: getModuleSettings().manualModeEnabled,
        getManualLorebook: () => getStmbState().manualLorebook,
        setManualLorebook: async selectedLorebook => {
            getStmbState().manualLorebook = String(selectedLorebook || '').trim();
            saveMetadataDebounced();
        },
        autoCreateLorebook: getModuleSettings().autoCreateLorebook,
        lorebookNameTemplate: getModuleSettings().lorebookNameTemplate || 'LTM - {{char}} - {{chat}}',
        createContext: 'chat',
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
    const worldInfo = await loadWorldInfo(lorebookName) || { entries: {} };
    let promptText = buildMemoryPromptText(compiledScene, profile, worldInfo, requestSettings);
    if (getModuleSettings().useRegex) {
        promptText = applySelectedRegex(promptText, getModuleSettings().selectedRegexOutgoing);
    }

    const { generateData } = await buildOpenAIGenerateData('quiet', [{ role: 'user', content: promptText }], {
        jsonSchema: getMemorySchema(),
    });
    const finalGenerateData = applyStmbMaxTokensToGenerateData(
        applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
        getModuleSettings().maxTokens,
    );

    if (!getModuleSettings().useRegex) {
        const result = await generateStmbMemory({
            generateData: finalGenerateData,
        }, { signal });
        return result.memory;
    }

    const result = await generateStmbText({
        generateData: finalGenerateData,
    }, { signal });
    const rawText = String(result.text || '');
    assertNoProviderTruncation(result.providerResponse, rawText);
    const cleanedText = applySelectedRegex(rawText, getModuleSettings().selectedRegexIncoming);

    try {
        return parseStructuredMemoryResponse(cleanedText);
    } catch (error) {
        error.rawResponse = cleanedText || rawText || JSON.stringify(result?.providerResponse ?? {});
        error.providerBody = JSON.stringify(result?.providerResponse ?? {});
        throw error;
    }
}

function serializeSummaryProviderResponse(providerResponse, fallback = '') {
    if (typeof fallback === 'string' && fallback.trim()) {
        return fallback.trim();
    }
    if (typeof providerResponse === 'string' && providerResponse.trim()) {
        return providerResponse.trim();
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

async function requestStructuredSummaryDetailed(prompt, profile, signal) {
    const { generateData } = await buildOpenAIGenerateData('quiet', buildSummaryPromptMessages(prompt), {
        jsonSchema: getSummarySchema(),
    });
    const result = await generateStmbSummary({
        generateData: applyStmbMaxTokensToGenerateData(
            applyStmbProfileToGenerateData(generateData, profile, getStmbProviderDefaults()),
            getModuleSettings().maxTokens,
        ),
    }, { signal });
    return {
        parsed: result.parsed,
        providerResponse: result.providerResponse,
        rawResponse: serializeSummaryProviderResponse(result.providerResponse),
    };
}

async function requestStructuredSummaryWithRetry(prompt, profile, signal) {
    try {
        return await requestStructuredSummaryDetailed(prompt, profile, signal);
    } catch (error) {
        if (isStmbAbortError(error) || !error?.rawResponse) {
            throw error;
        }

        const repairPrompt = `${prompt}\n\nReturn ONLY the JSON object, nothing else. Ensure arrays and commas are valid.`;
        try {
            const repaired = await requestStructuredSummaryDetailed(repairPrompt, profile, signal);
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

async function runSequentialSummaryAnalysis(sourceEntries, options = {}, profile, signal) {
    const {
        presetKey = 'arc_default',
        maxItemsPerPass = 15,
        maxPasses = 10,
        requiredMin = 1,
        tokenTarget = getModuleSettings().tokenWarningThreshold ?? 30000,
        targetTier = 1,
        previousSummary = null,
        previousOrder = null,
    } = options;

    const briefs = buildBriefsFromEntries(sourceEntries);
    const remainingMap = new Map(briefs.map(brief => [String(brief.id), brief]));
    const acceptedSummaries = [];
    const singleSummaryPreset = presetKey === 'arc_alternate';
    const maxPassesLocal = Object.prototype.hasOwnProperty.call(options, 'maxPasses')
        ? Math.max(1, Math.trunc(Number(maxPasses) || 1))
        : (singleSummaryPreset ? 1 : 10);
    const maxItems = Math.max(1, Math.trunc(Number(maxItemsPerPass) || 15));
    const minimumProgress = Math.max(1, Math.trunc(Number(requiredMin) || 1));
    const baseTokenTarget = Math.max(1000, Math.trunc(Number(tokenTarget) || 30000));
    const promptText = getCachedArcPromptText(presetKey, stmbSettings);

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
        if (batch.length === 0) {
            break;
        }

        let prompt = buildSummaryAnalysisPrompt({
            briefs: batch,
            previousSummary: previousSummaryText,
            previousOrder: previousOrderValue,
            promptText,
            targetTier,
        });
        let tokenEstimate = await estimateSummaryPromptTokens(prompt, 500);
        while (tokenEstimate.total > baseTokenTarget && batch.length > 1) {
            batch.pop();
            prompt = buildSummaryAnalysisPrompt({
                briefs: batch,
                previousSummary: previousSummaryText,
                previousOrder: previousOrderValue,
                promptText,
                targetTier,
            });
            tokenEstimate = await estimateSummaryPromptTokens(prompt, 500);
        }

        const batchEntryMap = new Map(sourceEntries.map(entry => [String(entry?.uid), entry]));
        const batchEntries = batch
            .map(brief => batchEntryMap.get(String(brief.id)))
            .filter(Boolean);
        if (batchEntries.length === 0) {
            break;
        }

        const response = await requestStructuredSummaryWithRetry(prompt, profile, signal);
        lastRawResponse = String(response.rawResponse || '').trim();
        lastRetryRawResponse = String(response.retryRawResponse || '').trim();

        const { summaryCandidates, leftovers } = createSummaryCandidatesFromResponse(response.parsed, batchEntries);
        const consumedIds = new Set(
            batchEntries
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
                await hideChatMessageRange(0, hideEnd, false, null, false);
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
                await hideChatMessageRange(range.sceneStart, hideEnd, false, null, false);
            }
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

async function saveMemoryObjectToLorebook(memoryObject, { lorebookName, range, compiledScene, profile, keepSceneMarkers = false, signal = null, showSuccessToast = true }) {
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
    showOrderClampNotifications(result?.orderClampNotifications);
    setHighestProcessedMessageId(range.sceneEnd);
    if (!keepSceneMarkers || getModuleSettings().autoClearSceneAfterMemory) {
        clearSceneMarkers();
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

function clearAutoConsolidationPromptState(targetTier) {
    const state = getStmbState();
    const prefix = `${Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)))}:`;
    if (typeof state.autoConsolidationLastPromptKey === 'string' && state.autoConsolidationLastPromptKey.startsWith(prefix)) {
        delete state.autoConsolidationLastPromptKey;
    }
}

function listSummaryConsolidationPresets() {
    return listCachedArcPromptPresets(stmbSettings).map(preset => ({
        value: preset.key,
        label: preset.displayName,
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

async function showSummaryConsolidationPopup({ initialTargetTier = 1 } = {}) {
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
        defaultPresetKey: 'arc_default',
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
        onPresetRebuild: async () => {
            const result = await recreateBuiltInArcPromptOverridesFile();
            toastr.success(`Removed ${result.removed} built-in consolidation prompt overrides`, 'STMB');
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
        maxItemsPerPass: popupResult.maxItemsPerPass,
        maxPasses: popupResult.maxPasses,
        tokenTarget: popupResult.tokenTarget,
        disableOriginals: popupResult.disableOriginals,
        selectedEntryIds: popupResult.selectedEntryIds,
        summaryEntrySettings: persisted.summaryEntrySettings,
    });
}

async function maybePromptAutoConsolidation(targetTier) {
    try {
        if (!getModuleSettings().autoConsolidationPromptEnabled) {
            return;
        }

        const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)));
        const configuredTargetTiers = normalizeAutoConsolidationTargetTiers(
            getModuleSettings().autoConsolidationTargetTiers,
        );
        if (!configuredTargetTiers.includes(normalizedTargetTier)) {
            return;
        }

        const lorebookName = resolveLorebookName();
        if (!lorebookName) {
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

        const state = getStmbState();
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
                await enqueueAfterMemorySidePromptJobs(context.compiledScene, stmbSettings, context.profile, {
                    lorebookName: context.lorebookName,
                    range: context.range,
                    signal: task.signal,
                });
            } catch (error) {
                if (!isStmbAbortError(error)) {
                    console.warn('STMB side prompts after manual repair failed', error);
                }
            }

            await maybePromptAutoConsolidation(1);

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

function buildMemoryRequestSettings(summaryCount = 0) {
    return {
        ...stmbSettings,
        moduleSettings: {
            ...(stmbSettings.moduleSettings || {}),
            defaultMemoryCount: Math.max(0, Math.min(7, Number(summaryCount ?? 0))),
        },
    };
}

async function executeMemoryJob(job, context) {
    const payload = job?.payload || {};
    const range = job?.range || payload.range || null;
    const lorebookName = String(job?.lorebookName || payload.lorebookName || '').trim();
    const requestSettings = buildMemoryRequestSettings(payload.summaryCount);
    const profile = payload.profile ? structuredClone(payload.profile) : getActiveStmbProfile(stmbSettings, job?.profileIndex ?? null);

    if (!Number.isInteger(Number(range?.sceneStart)) || !Number.isInteger(Number(range?.sceneEnd))) {
        throw new Error('Memory job is missing a valid scene range.');
    }
    if (!lorebookName) {
        throw new Error('Memory job is missing a lorebook.');
    }

    context.setState('capturing_scene', {
        detail: `Messages ${range.sceneStart}-${range.sceneEnd}`,
    });
    const sceneCapture = payload.compiledScene
        ? { compiledScene: structuredClone(payload.compiledScene) }
        : await captureStmbSceneRange(range, {
            skipSystemMessages: !requestSettings.moduleSettings?.unhideBeforeMemory,
            sceneContext: job?.sceneContext || buildStmbSceneContext(),
        });
    const compiledScene = sceneCapture?.compiledScene;

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
        context.setState('assembling_prompt', { detail: profile?.name || 'Memory' });
        context.setState('generating', { detail: profile?.name || 'Memory' });
        let memoryCandidate = await requestStructuredMemory(
            compiledScene,
            profile,
            lorebookName,
            payload.summaryCount,
            context.signal,
        );

        if (requestSettings.moduleSettings?.showMemoryPreviews) {
            context.setState('awaiting_approval', { detail: `Messages ${range.sceneStart}-${range.sceneEnd}` });
            const maybeEdited = await maybePreviewMemory(memoryCandidate, compiledScene, range, profile);
            if (maybeEdited === null) {
                context.patch({ state: 'canceled', detail: 'Canceled in approval' });
                return;
            }
            if (maybeEdited === 'retry') {
                continue;
            }
            memoryCandidate = maybeEdited;
        }

        context.setState('saving', { detail: lorebookName });
        const saved = await saveMemoryObjectToLorebook(memoryCandidate, {
            lorebookName,
            range,
            compiledScene,
            profile,
            keepSceneMarkers: Boolean(payload.keepSceneMarkers),
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
        await enqueueAfterMemorySidePromptJobs(compiledScene, requestSettings, profile, {
            lorebookName,
            range,
            sceneContext: job?.sceneContext || buildStmbSceneContext(),
            signal: context.signal,
        });
        await maybePromptAutoConsolidation(1);
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
    ensureStmbJobExecutorsRegistered();
    enqueueStmbJob({
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
            keepSceneMarkers: Boolean(options.keepSceneMarkers),
            source: options.source || 'memory',
        },
    });
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

export async function createSummaryForTier(targetTier, options = {}) {
    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(targetTier) || 1)));
    if (hasActiveStmbTasks()) {
        throw new Error('STMB generation is already in progress');
    }

    const lorebookName = await ensureLorebookName();
    const lorebookData = await loadWorldInfo(lorebookName) || { entries: {} };
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') {
        lorebookData.entries = {};
    }

    const migrated = migrateLorebookSummarySchema(lorebookData);
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

    const existingSummaries = identifyManagedSummaryEntries(lorebookData.entries, normalizedTargetTier);
    const previousSummary = existingSummaries.at(-1) || null;
    const profile = getActiveStmbProfile(stmbSettings, options.profileIndex ?? null);
    const presetKey = typeof options.presetKey === 'string' && options.presetKey.trim()
        ? options.presetKey.trim()
        : 'arc_default';
    const chosenSummaryEntrySettings = normalizeLorebookEntrySettings(
        options.summaryEntrySettings || getModuleSettings().summaryEntrySettings || {},
        getModuleSettings().summaryEntrySettings || {},
    );
    ensureStmbJobExecutorsRegistered();
    enqueueStmbJob({
        type: 'consolidation',
        lorebookName,
        sceneContext: buildStmbSceneContext(),
        characterName: name2 || '',
        chatTitle: getCurrentChatId() || '',
        title: getSummaryTierLabel(normalizedTargetTier),
        detail: `${getSummaryTierLabel(getSourceTierForTarget(normalizedTargetTier))} -> ${getSummaryTierLabel(normalizedTargetTier)}`,
        payload: {
            lorebookName,
            normalizedTargetTier,
            selectedEntryIds,
            requiredMin: requiredMinimum,
            profileIndex: options.profileIndex ?? null,
            presetKey,
            maxItemsPerPass: Math.max(1, Math.trunc(Number(options.maxItemsPerPass) || 15)),
            maxPasses: Math.max(1, Math.trunc(Number(options.maxPasses) || 10)),
            tokenTarget: Math.max(1000, Math.trunc(Number(options.tokenTarget) || (getModuleSettings().tokenWarningThreshold ?? 30000))),
            disableOriginals: Boolean(options.disableOriginals),
            summaryEntrySettings: chosenSummaryEntrySettings,
            titleFormat: typeof options.titleFormat === 'string' && options.titleFormat.trim()
                ? options.titleFormat
                : getDefaultSummaryTitleFormat(normalizedTargetTier),
        },
    });
    return {
        queued: true,
        lorebookName,
        targetTier: normalizedTargetTier,
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
                summaryEntrySettings: normalizeLorebookEntrySettings(
                    context.summaryEntrySettings || getModuleSettings().summaryEntrySettings || {},
                    getModuleSettings().summaryEntrySettings || {},
                ),
                signal: repairTask.signal,
            });
            clearAutoConsolidationPromptState(context.normalizedTargetTier);
            if (context.normalizedTargetTier < 6) {
                await maybePromptAutoConsolidation(context.normalizedTargetTier + 1);
            }
            return true;
        } finally {
            repairTask.cleanup();
        }
    };
}

async function runSummaryConsolidationNow(payload = {}, signal = null) {
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
    const sourceEntries = resolveSelectedSummarySourceEntries(
        lorebookData.entries,
        normalizedTargetTier,
        selectedEntryIds,
    );
    const configuredMinimum = getModuleSettings().summaryTierMinimums?.[normalizedTargetTier];
    const requiredMinimum = normalizeSummaryMinChildren(
        payload.requiredMin,
        configuredMinimum ?? getDefaultSummaryMinChildren(normalizedTargetTier),
    );
    if (sourceEntries.length < requiredMinimum) {
        throw new Error(
            `Not enough ${getSummaryTierLabel(normalizedTargetTier - 1).toLowerCase()} entries to create a ${getSummaryTierLabel(normalizedTargetTier).toLowerCase()} summary (${sourceEntries.length}/${requiredMinimum})`,
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

    try {
        const analysisResult = await runSequentialSummaryAnalysis(sourceEntries, {
            presetKey: typeof payload.presetKey === 'string' && payload.presetKey.trim() ? payload.presetKey.trim() : 'arc_default',
            maxItemsPerPass: Math.max(1, Math.trunc(Number(payload.maxItemsPerPass) || 15)),
            maxPasses: Math.max(1, Math.trunc(Number(payload.maxPasses) || 10)),
            requiredMin: requiredMinimum,
            tokenTarget: Math.max(1000, Math.trunc(Number(payload.tokenTarget) || (getModuleSettings().tokenWarningThreshold ?? 30000))),
            targetTier: normalizedTargetTier,
            previousSummary: previousSummary?.content || null,
            previousOrder: previousSummary ? (parseSequenceFromTitle(previousSummary.comment || '') ?? null) : null,
        }, profile, signal);
        const { summaryCandidates, leftovers, rawResponse, retryRawResponse } = analysisResult;
        if (summaryCandidates.length === 0) {
            const emptyError = new Error(`Model did not return a usable ${getSummaryTierLabel(normalizedTargetTier).toLowerCase()} summary`);
            emptyError.name = 'StmbSummaryParseError';
            emptyError.code = 'SUMMARY_NO_USABLE_SUMMARIES';
            emptyError.rawResponse = String(rawResponse || '').trim();
            emptyError.retryRawResponse = String(retryRawResponse || '').trim();
            throw emptyError;
        }

        const createdEntries = await commitSummaryCandidates(summaryCandidates, {
            normalizedTargetTier,
            lorebookName,
            titleFormat,
            migrated,
            disableOriginals: Boolean(payload.disableOriginals),
            summaryEntrySettings: chosenSummaryEntrySettings,
            showSuccessToast: false,
            signal,
        });

        clearAutoConsolidationPromptState(normalizedTargetTier);
        if (normalizedTargetTier < 6) {
            await maybePromptAutoConsolidation(normalizedTargetTier + 1);
        }

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
                summaryEntrySettings: chosenSummaryEntrySettings,
                maxItemsPerPass: Math.max(1, Math.trunc(Number(payload.maxItemsPerPass) || 15)),
                maxPasses: Math.max(1, Math.trunc(Number(payload.maxPasses) || 10)),
                tokenTarget: Math.max(1000, Math.trunc(Number(payload.tokenTarget) || (getModuleSettings().tokenWarningThreshold ?? 30000))),
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
    const normalizedTargetTier = Math.min(6, Math.max(1, Math.trunc(Number(payload.normalizedTargetTier || payload.targetTier) || 1)));
    context.setState('assembling_prompt', {
        detail: `${getSummaryTierLabel(getSourceTierForTarget(normalizedTargetTier))} -> ${getSummaryTierLabel(normalizedTargetTier)}`,
    });
    context.setState('generating', { detail: getSummaryTierLabel(normalizedTargetTier) });
    const result = await runSummaryConsolidationNow(payload, context.signal);
    context.setState('saving', { detail: payload.lorebookName || job?.lorebookName || '' });
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

async function sidePromptCommand(_, rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        toastr.info('SidePrompt guide: Choose a quoted template name, then fill any prompted macros. Usage: /sideprompt "Name" {{macro}}="value" [X-Y].', 'STMB');
        return '';
    }

    return await runSidePrompt(raw, stmbSettings);
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

export function initStmb() {
    if (stmbInitialized) {
        return;
    }

    createMainEntryUi();
    ensurePlannerStatusUi();
    $(document).on('click', '#stmb-menu-item', () => {
        showMainEntryPopup().catch(error => {
            console.warn('STMB main entry popup failed', error);
        });
    });
    bindSceneButtons();
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
    setTimeout(() => {
        validateSceneMarkers();
        renderAllSceneButtons();
    }, 0);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            validateSceneMarkers();
            renderAllSceneButtons();
        }, 0);
        initStmbJobsUi();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
        const messageElement = chatElement.find(`.mes[mesid="${messageId}"]`).get(0);
        if (messageElement) {
            renderSceneButtonsForMessage(messageElement);
        }
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
    });

    eventSource.on(event_types.SETTINGS_LOADED, () => {
        renderAllSceneButtons();
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
