import {
    eventSource,
    event_types,
} from '../script.js';
import { closeActiveMemoryPreviewPopups } from './stmb-popups.js';
import { buildStmbSceneContext, getStmbChatKey } from './stmb-scene.js';
import { escapeHtml } from './utils.js';

const jobStores = new Map();
const jobExecutors = new Map();
const jobListeners = new Set();
const ACTIVE_JOB_STATES = new Set([
    'queued',
    'capturing_scene',
    'assembling_prompt',
    'generating',
    'awaiting_approval',
    'saving',
    'post_save',
]);
const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'canceled']);
const RECENT_HISTORY_LIMIT = 20;
const RENDER_INTERVAL_MS = 1000;

let jobIdCounter = 0;
let topBarButton = null;
let topBarBadge = null;
let jobsPanel = null;
let jobsSummary = null;
let jobsRows = null;
let jobsActions = null;
let jobsUiInitialized = false;
let jobsRenderTimer = null;

function nextJobId() {
    jobIdCounter += 1;
    return `stmb-job-${Date.now()}-${jobIdCounter}`;
}

function ensureChatStore(chatKey) {
    const normalizedKey = String(chatKey || '').trim();
    if (!normalizedKey) {
        throw new Error('STMB job chatKey is required.');
    }

    if (!jobStores.has(normalizedKey)) {
        jobStores.set(normalizedKey, {
            queue: [],
            runningJob: null,
            recentHistory: [],
            lastUpdated: Date.now(),
            uiState: {
                panelOpen: false,
            },
        });
    }

    return jobStores.get(normalizedKey);
}

function cloneJobForView(job = {}) {
    return {
        id: String(job.id || ''),
        chatKey: String(job.chatKey || ''),
        type: String(job.type || 'memory'),
        range: job.range ? { ...job.range } : null,
        lorebookName: String(job.lorebookName || ''),
        profileIndex: Number.isFinite(Number(job.profileIndex)) ? Number(job.profileIndex) : null,
        state: String(job.state || 'queued'),
        createdAt: Number(job.createdAt || 0),
        startedAt: Number(job.startedAt || 0),
        finishedAt: Number(job.finishedAt || 0),
        error: job.error ? { ...job.error } : null,
        result: job.result ? structuredClone(job.result) : null,
        detail: String(job.detail || ''),
        title: String(job.title || ''),
        chatTitle: String(job.chatTitle || ''),
        characterName: String(job.characterName || ''),
        payload: job.payload ? structuredClone(job.payload) : {},
        sceneContext: job.sceneContext ? structuredClone(job.sceneContext) : null,
    };
}

function notifyJobListeners() {
    for (const listener of jobListeners) {
        try {
            listener();
        } catch (error) {
            console.warn('STMB job listener failed', error);
        }
    }
    renderStmbJobsUi();
}

function touchStore(store) {
    store.lastUpdated = Date.now();
    notifyJobListeners();
}

function getCurrentChatKey() {
    try {
        return getStmbChatKey(buildStmbSceneContext());
    } catch {
        return '';
    }
}

function getCurrentStore() {
    const currentChatKey = getCurrentChatKey();
    return currentChatKey ? ensureChatStore(currentChatKey) : null;
}

function sortRecentHistory(recentHistory = []) {
    recentHistory.sort((left, right) => Number(right?.finishedAt || right?.startedAt || right?.createdAt || 0) - Number(left?.finishedAt || left?.startedAt || left?.createdAt || 0));
    if (recentHistory.length > RECENT_HISTORY_LIMIT) {
        recentHistory.length = RECENT_HISTORY_LIMIT;
    }
}

function getJobStateLabel(job = {}) {
    const state = String(job.state || '');
    const type = String(job.type || '');

    if (state === 'saving') {
        if (type === 'memory') return 'Saving memory';
        if (type === 'sidePrompt') return 'Saving memory';
        if (type === 'consolidation') return 'Saving memory';
    }

    switch (state) {
        case 'queued': return 'Queued';
        case 'capturing_scene': return 'Capturing scene';
        case 'assembling_prompt': return 'Assembling prompt';
        case 'generating': return 'Generating';
        case 'awaiting_approval': return 'Awaiting approval';
        case 'saving': return 'Saving memory';
        case 'post_save': return 'Running post-save actions';
        case 'completed': return 'Completed';
        case 'failed': return 'Failed';
        case 'canceled': return 'Canceled';
        default: return state || 'Queued';
    }
}

function getJobTypeLabel(type = '') {
    switch (String(type || '')) {
        case 'sidePrompt': return 'Side Prompt';
        case 'sidePromptBatch': return 'Side Prompt';
        case 'consolidation': return 'Consolidation';
        case 'memory':
        default:
            return 'Memory';
    }
}

function getRangeLabel(range = null) {
    if (!range || !Number.isFinite(Number(range.sceneStart)) || !Number.isFinite(Number(range.sceneEnd))) {
        return '';
    }

    return `Messages ${Math.trunc(Number(range.sceneStart))}-${Math.trunc(Number(range.sceneEnd))}`;
}

function formatElapsed(job = {}) {
    const end = Number(job.finishedAt || 0) || Date.now();
    const start = Number(job.startedAt || job.createdAt || 0);
    if (!(start > 0)) {
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

function getStatusToneClass(job = {}) {
    if (job.state === 'completed') return 'stmb-jobs-tone-completed';
    if (job.state === 'failed') return 'stmb-jobs-tone-failed';
    if (job.state === 'canceled') return 'stmb-jobs-tone-canceled';
    if (job.state === 'awaiting_approval') return 'stmb-jobs-tone-awaiting';
    if (ACTIVE_JOB_STATES.has(job.state)) return 'stmb-jobs-tone-running';
    return 'stmb-jobs-tone-idle';
}

function buildTooltip(summary = {}) {
    if (summary.awaitingApproval > 0) {
        return summary.awaitingApproval === 1 ? '1 awaiting approval' : `${summary.awaitingApproval} awaiting approval`;
    }
    if (summary.running > 0) {
        return summary.running === 1 ? '1 job running' : `${summary.running} jobs running`;
    }
    if (summary.queued > 0) {
        return summary.queued === 1 ? '1 job queued' : `${summary.queued} jobs queued`;
    }
    return 'No Memory Books jobs';
}

function summarizeStore(store) {
    const jobs = [
        ...(store?.runningJob ? [store.runningJob] : []),
        ...(Array.isArray(store?.queue) ? store.queue : []),
    ];
    return jobs.reduce((summary, job) => {
        if (job.state === 'awaiting_approval') summary.awaitingApproval += 1;
        else if (job.state === 'queued') summary.queued += 1;
        else if (ACTIVE_JOB_STATES.has(job.state)) summary.running += 1;
        return summary;
    }, { running: 0, queued: 0, awaitingApproval: 0 });
}

function getRecentFailureCount(store) {
    const recentJobs = Array.isArray(store?.recentHistory) ? store.recentHistory : [];
    return recentJobs.filter(job => job?.state === 'failed').length;
}

function shouldKeepRenderTimer() {
    for (const store of jobStores.values()) {
        if (store.runningJob || (Array.isArray(store.queue) && store.queue.length > 0)) {
            return true;
        }
    }
    return false;
}

function syncRenderTimer() {
    if (shouldKeepRenderTimer()) {
        if (!jobsRenderTimer) {
            jobsRenderTimer = setInterval(() => renderStmbJobsUi(), RENDER_INTERVAL_MS);
        }
        return;
    }

    if (jobsRenderTimer) {
        clearInterval(jobsRenderTimer);
        jobsRenderTimer = null;
    }
}

function removeFromQueueById(store, jobId) {
    const index = store.queue.findIndex(job => String(job.id) === String(jobId));
    if (index >= 0) {
        store.queue.splice(index, 1);
        return true;
    }
    return false;
}

async function runNextJob(chatKey) {
    const store = ensureChatStore(chatKey);
    if (store.runningJob || store.queue.length === 0) {
        syncRenderTimer();
        return;
    }

    const nextJob = store.queue.shift();
    nextJob.startedAt = Date.now();
    nextJob.state = ACTIVE_JOB_STATES.has(nextJob.state) ? nextJob.state : 'queued';
    nextJob.abortController = new AbortController();
    store.runningJob = nextJob;
    touchStore(store);

    try {
        const executor = jobExecutors.get(String(nextJob.type || ''));
        if (typeof executor !== 'function') {
            throw new Error(`No STMB job executor registered for "${nextJob.type}".`);
        }

        await executor(nextJob, createJobContext(store, nextJob));
        if (!TERMINAL_JOB_STATES.has(nextJob.state)) {
            nextJob.state = 'completed';
        }
    } catch (error) {
        if (nextJob.abortController?.signal?.aborted || String(error?.code || '') === 'STMB_ABORTED') {
            nextJob.state = 'canceled';
            nextJob.error = null;
        } else {
            nextJob.state = 'failed';
            nextJob.error = {
                message: String(error?.message || 'Unknown STMB job failure'),
            };
            globalThis.toastr?.error?.(`${getJobTypeLabel(nextJob.type)} job failed: ${nextJob.error.message}`, 'STMB');
        }
    } finally {
        nextJob.finishedAt = Date.now();
        delete nextJob.abortController;
        if (store.runningJob && String(store.runningJob.id) === String(nextJob.id)) {
            store.runningJob = null;
        } else {
            removeFromQueueById(store, nextJob.id);
        }
        store.recentHistory.unshift(cloneJobForView(nextJob));
        sortRecentHistory(store.recentHistory);
        touchStore(store);
        syncRenderTimer();
        queueMicrotask(() => {
            runNextJob(chatKey).catch(error => {
                console.warn('STMB client job runner failed', error);
            });
        });
    }
}

function createJobContext(store, job) {
    return {
        signal: job.abortController.signal,
        setState(state, options = {}) {
            job.state = String(state || job.state || 'queued');
            if (typeof options.detail === 'string') {
                job.detail = options.detail;
            }
            touchStore(store);
        },
        setDetail(detail) {
            job.detail = String(detail || '');
            touchStore(store);
        },
        setResult(result) {
            job.result = structuredClone(result);
            touchStore(store);
        },
        patch(patch = {}) {
            Object.assign(job, patch);
            touchStore(store);
        },
        enqueue(nextJob) {
            return enqueueStmbJob({
                chatKey: job.chatKey,
                ...nextJob,
            });
        },
    };
}

function normalizeJobInput(input = {}) {
    const currentSceneContext = buildStmbSceneContext();
    const chatKey = String(input.chatKey || getStmbChatKey(input.sceneContext || currentSceneContext)).trim();
    const sceneContext = input.sceneContext ? structuredClone(input.sceneContext) : structuredClone(currentSceneContext);
    return {
        id: String(input.id || nextJobId()),
        chatKey,
        type: String(input.type || 'memory'),
        range: input.range ? structuredClone(input.range) : null,
        lorebookName: String(input.lorebookName || ''),
        profileIndex: Number.isFinite(Number(input.profileIndex)) ? Number(input.profileIndex) : null,
        state: 'queued',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        error: null,
        result: null,
        detail: String(input.detail || ''),
        title: String(input.title || ''),
        chatTitle: String(input.chatTitle || ''),
        characterName: String(input.characterName || sceneContext?.characterName || ''),
        payload: input.payload ? structuredClone(input.payload) : {},
        sceneContext,
    };
}

function renderJobRows(store) {
    if (!jobsRows || !jobsActions) {
        return;
    }

    const runningJob = store?.runningJob ? [store.runningJob] : [];
    const queuedJobs = Array.isArray(store?.queue) ? store.queue : [];
    const recentJobs = Array.isArray(store?.recentHistory) ? store.recentHistory : [];
    const orderedJobs = [...runningJob, ...queuedJobs, ...recentJobs];
    const esc = value => escapeHtml(String(value ?? ''));
    const recentFailureCount = getRecentFailureCount(store);

    jobsRows.innerHTML = orderedJobs.map(job => {
        const rangeLabel = getRangeLabel(job.range);
        const elapsedLabel = formatElapsed(job);
        const retryButton = job.state === 'failed'
            ? `<button type="button" class="menu_button stmb-jobs-row-action" data-action="retry" data-job-id="${esc(job.id)}">Retry failed</button>`
            : '';
        return `
            <div class="stmb-jobs-row ${getStatusToneClass(job)}">
                <div class="stmb-jobs-row-main">
                    <div class="stmb-jobs-row-header">
                        <span class="stmb-jobs-row-icon"></span>
                        <strong>${esc(getJobTypeLabel(job.type))}</strong>
                        <span class="stmb-jobs-row-status">${esc(getJobStateLabel(job))}</span>
                    </div>
                    ${rangeLabel ? `<div class="stmb-jobs-row-meta">${esc(rangeLabel)}</div>` : ''}
                    <div class="stmb-jobs-row-meta">${esc(job.characterName)}${job.chatTitle ? ` • ${esc(job.chatTitle)}` : ''}</div>
                    <div class="stmb-jobs-row-meta">${job.lorebookName ? `Lorebook: ${esc(job.lorebookName)}` : ''}${elapsedLabel ? ` • ${esc(elapsedLabel)}` : ''}</div>
                    ${job.detail ? `<div class="stmb-jobs-row-detail">${esc(job.detail)}</div>` : ''}
                    ${job.error?.message ? `<div class="stmb-jobs-row-error">${esc(job.error.message)}</div>` : ''}
                </div>
                ${retryButton}
            </div>
        `;
    }).join('') || '<div class="stmb-jobs-empty">No jobs for this chat.</div>';

    const hasActiveRunningJob = Boolean(store?.runningJob);
    const completedCount = recentJobs.filter(job => job.state === 'completed').length;
    jobsActions.innerHTML = `
        <button type="button" class="menu_button" data-action="cancel-active" ${hasActiveRunningJob ? '' : 'disabled'}>Cancel active job</button>
        <button type="button" class="menu_button" data-action="clear-completed" ${completedCount > 0 ? '' : 'disabled'}>Clear completed</button>
        ${recentFailureCount > 0 ? '<button type="button" class="stmb-jobs-action-link" data-action="dismiss-failures">Dismiss all notifications</button>' : ''}
    `;
}

function renderStmbJobsUi() {
    if (!jobsUiInitialized || !topBarButton || !jobsPanel || !jobsSummary) {
        return;
    }

    const currentStore = getCurrentStore();
    const summary = summarizeStore(currentStore);
    const activeCount = summary.running + summary.queued + summary.awaitingApproval;
    const hasActiveJobs = activeCount > 0;
    const recentFailureCount = getRecentFailureCount(currentStore);
    const canOpenPanel = hasActiveJobs || recentFailureCount > 0;
    const tooltip = hasActiveJobs
        ? buildTooltip(summary)
        : (recentFailureCount > 0 ? (recentFailureCount === 1 ? '1 recent failure' : `${recentFailureCount} recent failures`) : 'No Memory Books jobs');

    topBarButton.disabled = !canOpenPanel;
    topBarButton.classList.toggle('disabled', !canOpenPanel);
    topBarButton.classList.toggle('active', hasActiveJobs);
    topBarButton.title = tooltip;
    topBarButton.setAttribute('aria-label', `Memory Books Jobs. ${tooltip}`);
    topBarBadge.textContent = hasActiveJobs ? String(activeCount) : (recentFailureCount > 0 ? String(recentFailureCount) : '');
    topBarBadge.style.display = canOpenPanel ? 'inline-flex' : 'none';
    topBarBadge.classList.toggle('stmb-jobs-badge-failed', !hasActiveJobs && recentFailureCount > 0);
    jobsSummary.textContent = hasActiveJobs
        ? `${summary.running} running, ${summary.queued} queued${summary.awaitingApproval > 0 ? `, ${summary.awaitingApproval} awaiting approval` : ''}${recentFailureCount > 0 ? `, ${recentFailureCount} recent ${recentFailureCount === 1 ? 'failure' : 'failures'}` : ''}`
        : (recentFailureCount > 0 ? `${recentFailureCount} recent ${recentFailureCount === 1 ? 'failure' : 'failures'}` : 'No active jobs');

    jobsPanel.hidden = !canOpenPanel || !currentStore?.uiState?.panelOpen;

    renderJobRows(currentStore);
    syncRenderTimer();
}

function handleTopBarButtonClick() {
    const currentStore = getCurrentStore();
    const summary = summarizeStore(currentStore);
    const activeCount = summary.running + summary.queued + summary.awaitingApproval;
    const canOpenPanel = activeCount > 0 || getRecentFailureCount(currentStore) > 0;
    if (!canOpenPanel) {
        return;
    }

    currentStore.uiState.panelOpen = !currentStore.uiState.panelOpen;
    renderStmbJobsUi();
}

function handlePanelClick(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
        return;
    }

    const action = String(actionButton.dataset.action || '');
    const currentChatKey = getCurrentChatKey();
    if (!currentChatKey) {
        return;
    }

    if (action === 'cancel-active') {
        cancelActiveStmbJob(currentChatKey);
        return;
    }
    if (action === 'clear-completed') {
        clearCompletedStmbJobs(currentChatKey);
        return;
    }
    if (action === 'dismiss-failures') {
        dismissFailedStmbJobNotifications(currentChatKey);
        return;
    }
    if (action === 'retry') {
        retryFailedStmbJob(currentChatKey, actionButton.dataset.jobId);
    }
}

export function initStmbJobsUi() {
    if (jobsUiInitialized) {
        renderStmbJobsUi();
        return;
    }

    const topBar = document.getElementById('top-bar');
    if (!topBar) {
        setTimeout(() => initStmbJobsUi(), 250);
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'stmb-jobs-topbar';
    wrapper.innerHTML = `
        <button id="stmb-jobs-topbar-button" type="button" class="menu_button menu_button_icon stmb-jobs-topbar-button disabled" disabled title="No Memory Books jobs" aria-label="Memory Books Jobs. No Memory Books jobs">
            <i class="fa-solid fa-book-open stmb-jobs-topbar-icon" aria-hidden="true"></i>
            <span class="sr-only">Memory Books Jobs</span>
            <span id="stmb-jobs-topbar-badge" class="stmb-jobs-badge" style="display:none;"></span>
        </button>
        <div id="stmb-jobs-panel" class="stmb-jobs-panel" hidden>
            <div class="stmb-jobs-panel-header">
                <strong>Memory Books Jobs</strong>
                <div id="stmb-jobs-summary" class="stmb-jobs-summary">No active jobs</div>
            </div>
            <div id="stmb-jobs-actions" class="stmb-jobs-actions"></div>
            <div id="stmb-jobs-rows" class="stmb-jobs-rows"></div>
        </div>
    `;
    topBar.appendChild(wrapper);

    topBarButton = wrapper.querySelector('#stmb-jobs-topbar-button');
    topBarBadge = wrapper.querySelector('#stmb-jobs-topbar-badge');
    jobsPanel = wrapper.querySelector('#stmb-jobs-panel');
    jobsSummary = wrapper.querySelector('#stmb-jobs-summary');
    jobsRows = wrapper.querySelector('#stmb-jobs-rows');
    jobsActions = wrapper.querySelector('#stmb-jobs-actions');

    topBarButton.addEventListener('click', handleTopBarButtonClick);
    jobsPanel.addEventListener('click', handlePanelClick);
    document.addEventListener('click', event => {
        if (!jobsPanel || jobsPanel.hidden) {
            return;
        }
        if (wrapper.contains(event.target)) {
            return;
        }
        const currentStore = getCurrentStore();
        if (currentStore?.uiState) {
            currentStore.uiState.panelOpen = false;
        }
        renderStmbJobsUi();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => renderStmbJobsUi());
    jobsUiInitialized = true;
    renderStmbJobsUi();
}

export function registerStmbJobExecutor(type, executor) {
    jobExecutors.set(String(type || ''), executor);
}

export function subscribeToStmbJobs(listener) {
    jobListeners.add(listener);
    return () => jobListeners.delete(listener);
}

export function enqueueStmbJob(input = {}) {
    const job = normalizeJobInput(input);
    const store = ensureChatStore(job.chatKey);
    store.queue.push(job);
    touchStore(store);
    syncRenderTimer();
    runNextJob(job.chatKey).catch(error => {
        console.warn('STMB job queue kickoff failed', error);
    });
    return cloneJobForView(job);
}

export function getStmbJobStoreSnapshot(chatKey = null) {
    if (chatKey) {
        return structuredClone(ensureChatStore(chatKey));
    }
    const snapshot = {};
    for (const [key, store] of jobStores.entries()) {
        snapshot[key] = structuredClone(store);
    }
    return snapshot;
}

export function hasActiveStmbJobs(chatKey = null) {
    if (chatKey) {
        const store = ensureChatStore(chatKey);
        return Boolean(store.runningJob || store.queue.length > 0);
    }
    for (const store of jobStores.values()) {
        if (store.runningJob || store.queue.length > 0) {
            return true;
        }
    }
    return false;
}

export function cancelActiveStmbJob(chatKey = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey) {
        return false;
    }

    const store = ensureChatStore(targetChatKey);
    const runningJob = store.runningJob;
    if (!runningJob?.abortController) {
        return false;
    }

    closeActiveMemoryPreviewPopups();
    runningJob.abortController.abort('stmb-job-cancel');
    runningJob.detail = 'Canceled by user';
    touchStore(store);
    return true;
}

export function cancelAllStmbJobs(chatKey = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey) {
        return 0;
    }

    const store = ensureChatStore(targetChatKey);
    let canceled = 0;

    for (const queuedJob of store.queue.splice(0)) {
        queuedJob.state = 'canceled';
        queuedJob.detail = queuedJob.detail || 'Canceled by user';
        queuedJob.finishedAt = Date.now();
        store.recentHistory.unshift(cloneJobForView(queuedJob));
        canceled += 1;
    }

    sortRecentHistory(store.recentHistory);

    if (store.runningJob?.abortController) {
        closeActiveMemoryPreviewPopups();
        store.runningJob.detail = 'Canceled by user';
        store.runningJob.abortController.abort('stmb-job-cancel');
        canceled += 1;
    }

    touchStore(store);
    return canceled;
}

export function clearCompletedStmbJobs(chatKey = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey) {
        return 0;
    }
    const store = ensureChatStore(targetChatKey);
    const before = store.recentHistory.length;
    store.recentHistory = store.recentHistory.filter(job => job.state !== 'completed');
    touchStore(store);
    return before - store.recentHistory.length;
}

export function dismissFailedStmbJobNotifications(chatKey = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey) {
        return 0;
    }

    const store = ensureChatStore(targetChatKey);
    const before = store.recentHistory.length;
    store.recentHistory = store.recentHistory.filter(job => job.state !== 'failed');
    touchStore(store);
    return before - store.recentHistory.length;
}

export function retryFailedStmbJob(chatKey = null, jobId = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey || !jobId) {
        return null;
    }

    const store = ensureChatStore(targetChatKey);
    const sourceJob = store.recentHistory.find(job => String(job.id) === String(jobId) && job.state === 'failed');
    if (!sourceJob) {
        return null;
    }

    return enqueueStmbJob({
        chatKey: sourceJob.chatKey,
        type: sourceJob.type,
        range: sourceJob.range,
        lorebookName: sourceJob.lorebookName,
        profileIndex: sourceJob.profileIndex,
        title: sourceJob.title,
        characterName: sourceJob.characterName,
        chatTitle: sourceJob.chatTitle,
        sceneContext: sourceJob.sceneContext,
        payload: sourceJob.payload,
    });
}
