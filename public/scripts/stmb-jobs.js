import { t, translate } from './i18n.js';
import {
    eventSource,
    event_types,
} from '../script.js';
import { closeActiveMemoryPreviewPopups, showFailedAIResponsePopup } from './stmb-popups.js';
import { buildStmbSceneContext, getStmbChatKey } from './stmb-scene.js';
import {
    buildStmbRetryPayload,
    captureStmbRetryDependents,
    collectStmbCanceledDependents,
    isStmbAfterMemoryDependent,
    isStmbJobRetryable,
} from './stmb-job-retry-policy.js';
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
const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'blocked', 'canceled', 'skipped']);
const RECENT_HISTORY_LIMIT = 20;
const RENDER_INTERVAL_MS = 1000;
const CONCURRENT_JOB_TYPES = new Set(['sidePrompt']);
const pendingApprovals = new Map();

let topBarButton = null;
let topBarBadge = null;
let jobsPanel = null;
let jobsSummary = null;
let jobsRows = null;
let jobsActions = null;
let jobsUiInitialized = false;
let jobsRenderTimer = null;
let jobsPanelOpen = false;
const OPEN_APPROVAL_EVENT = 'stmb:open-job-approval';

function nextJobId() {
    const ts = Date.now().toString(16);
    const rand = Math.floor(Math.random() * 0x1_0000_0000)
        .toString(16)
        .padStart(8, '0');
    return `stmb-job-${ts}-${rand}`;
}

function ensureChatStore(chatKey) {
    const normalizedKey = String(chatKey || '').trim();
    if (!normalizedKey) {
        throw new Error('STMB job chatKey is required.');
    }

    if (!jobStores.has(normalizedKey)) {
        jobStores.set(normalizedKey, {
            queue: [],
            runningJobs: [],
            recentHistory: [],
            lastUpdated: Date.now(),
            runnerActive: false,
        });
    }

    return jobStores.get(normalizedKey);
}

function getRunningJobs(store) {
    if (!store) {
        return [];
    }

    if (Array.isArray(store.runningJobs)) {
        return store.runningJobs;
    }

    store.runningJobs = store.runningJob ? [store.runningJob] : [];
    delete store.runningJob;
    return store.runningJobs;
}

function getLegacyRunningJob(store) {
    return getRunningJobs(store)[0] || null;
}

function clampInt(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

function getSidePromptJobLimit(job = {}) {
    return clampInt(job?.payload?.settings?.moduleSettings?.sidePromptsMaxConcurrent ?? 1, 1, 5, 1);
}

function canStartQueuedJob(store, job) {
    if (!job) {
        return false;
    }

    const runningJobs = getRunningJobs(store);
    const jobType = String(job.type || '');
    const isConcurrentType = CONCURRENT_JOB_TYPES.has(jobType);

    if (!isConcurrentType) {
        return runningJobs.length === 0;
    }

    if (runningJobs.some(running => !CONCURRENT_JOB_TYPES.has(String(running.type || '')))) {
        return false;
    }

    const runningSameType = runningJobs.filter(running => String(running.type || '') === jobType).length;
    return runningSameType < getSidePromptJobLimit(job);
}

function cloneJobForView(job = {}) {
    return {
        id: String(job.id || ''),
        chatKey: String(job.chatKey || ''),
        type: String(job.type || 'memory'),
        dependsOnJobId: String(job.dependsOnJobId || ''),
        parentJobOrder: job.parentJobOrder !== null && job.parentJobOrder !== undefined && Number.isFinite(Number(job.parentJobOrder))
            ? Number(job.parentJobOrder)
            : null,
        range: job.range ? { ...job.range } : null,
        lorebookName: String(job.lorebookName || ''),
        profileIndex: Number.isFinite(Number(job.profileIndex)) ? Number(job.profileIndex) : null,
        state: String(job.state || 'queued'),
        createdAt: Number(job.createdAt || 0),
        startedAt: Number(job.startedAt || 0),
        finishedAt: Number(job.finishedAt || 0),
        updatedAt: Number(job.updatedAt || job.finishedAt || job.startedAt || job.createdAt || 0),
        error: job.error ? { ...job.error } : null,
        result: job.result ? structuredClone(job.result) : null,
        detail: String(job.detail || ''),
        title: String(job.title || ''),
        chatTitle: String(job.chatTitle || ''),
        characterName: String(job.characterName || ''),
        payload: job.payload ? structuredClone(job.payload) : {},
        approvalRequest: job.approvalRequest ? structuredClone(job.approvalRequest) : null,
        sceneContext: job.sceneContext ? structuredClone(job.sceneContext) : null,
    };
}

function markJobUpdated(job, timestamp = Date.now()) {
    if (job && typeof job === 'object') {
        job.updatedAt = Number(timestamp) || Date.now();
    }
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
        case 'skipped': return t`Skipped`;
        default: return state || 'Queued';
    }
}

function getJobTypeLabel(type = '') {
    switch (String(type || '')) {
        case 'sidePrompt': return t`Side Prompt`;
        case 'sidePromptBatch': return t`Side Prompt`;
        case 'memoryAssistance': return t`Memory Assistance`;
        case 'consolidation': return t`Consolidation`;
        case 'regeneration': return t`Regenerate memory`;
        case 'memory':
        default:
            return t`Memory`;
    }
}

function getJobDisplayLabel(job = {}) {
    const typeLabel = getJobTypeLabel(job.type);
    const title = String(job.title || '').trim();
    if (!title) {
        return typeLabel;
    }

    if (job.type === 'sidePrompt' || job.type === 'sidePromptBatch') {
        return /^side prompt/i.test(title) || /^set:/i.test(title)
            ? title
            : `Side Prompt: ${title}`;
    }

    return title === typeLabel ? typeLabel : `${typeLabel}: ${title}`;
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
    if (job.state === 'skipped') return 'stmb-jobs-tone-canceled';
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
        ...getRunningJobs(store),
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

function getDismissibleNotificationCount(store) {
    const recentJobs = Array.isArray(store?.recentHistory) ? store.recentHistory : [];
    return recentJobs.filter(job => TERMINAL_JOB_STATES.has(job?.state) && job?.state !== 'completed').length;
}

function getCompletedCount(store) {
    const recentJobs = Array.isArray(store?.recentHistory) ? store.recentHistory : [];
    return recentJobs.filter(job => job?.state === 'completed').length;
}

function getRecentHistoryCount(store) {
    return Array.isArray(store?.recentHistory) ? store.recentHistory.length : 0;
}

function summarizeAllStores() {
    const summary = {
        running: 0,
        queued: 0,
        awaitingApproval: 0,
        recentFailures: 0,
        recentHistory: 0,
    };

    for (const store of jobStores.values()) {
        const storeSummary = summarizeStore(store);
        summary.running += storeSummary.running;
        summary.queued += storeSummary.queued;
        summary.awaitingApproval += storeSummary.awaitingApproval;
        summary.recentFailures += getRecentFailureCount(store);
        summary.recentHistory += getRecentHistoryCount(store);
    }

    return summary;
}

function getActiveJobCount(store) {
    const summary = summarizeStore(store);
    return summary.running + summary.queued + summary.awaitingApproval;
}

function getJobStoreRecordsForView(currentChatKey = '') {
    const records = [];

    for (const [chatKey, store] of jobStores.entries()) {
        const activeCount = getActiveJobCount(store);
        const recentFailureCount = getRecentFailureCount(store);
        const recentHistoryCount = getRecentHistoryCount(store);
        if (activeCount === 0 && recentHistoryCount === 0) {
            continue;
        }

        records.push({
            chatKey,
            store,
            activeCount,
            recentFailureCount,
            recentHistoryCount,
            isCurrent: Boolean(currentChatKey && chatKey === currentChatKey),
        });
    }

    records.sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) {
            return left.isCurrent ? -1 : 1;
        }
        if (left.activeCount !== right.activeCount) {
            return right.activeCount - left.activeCount;
        }
        if (left.recentFailureCount !== right.recentFailureCount) {
            return right.recentFailureCount - left.recentFailureCount;
        }
        if (left.recentHistoryCount !== right.recentHistoryCount) {
            return right.recentHistoryCount - left.recentHistoryCount;
        }
        return Number(right.store?.lastUpdated || 0) - Number(left.store?.lastUpdated || 0);
    });

    return records;
}

function isJobAwaitingApproval(job = {}) {
    return String(job?.state || '') === 'awaiting_approval'
        && job?.approvalRequest
        && typeof job.approvalRequest === 'object';
}

function findFirstAwaitingApprovalJob() {
    const records = getJobStoreRecordsForView(getCurrentChatKey());

    for (const record of records) {
        const runningJob = getRunningJobs(record.store);
        const queuedJobs = Array.isArray(record.store?.queue) ? record.store.queue : [];
        const job = [...runningJob, ...queuedJobs].find(isJobAwaitingApproval);
        if (job) {
            return job;
        }
    }

    return null;
}

function getAwaitingApprovalCount() {
    let count = 0;

    for (const store of jobStores.values()) {
        const runningJob = getRunningJobs(store);
        const queuedJobs = Array.isArray(store?.queue) ? store.queue : [];
        count += [...runningJob, ...queuedJobs].filter(isJobAwaitingApproval).length;
    }

    return count;
}

function dispatchOpenApprovalEvent(job = {}) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) {
        return false;
    }

    window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_EVENT, {
        detail: { jobId },
    }));
    return true;
}

function getStoreDisplayLabel(record = {}) {
    if (record.isCurrent) {
        return 'This chat';
    }

    const jobs = [
        ...getRunningJobs(record.store),
        ...(Array.isArray(record.store?.queue) ? record.store.queue : []),
        ...(Array.isArray(record.store?.recentHistory) ? record.store.recentHistory : []),
    ];
    const job = jobs.find(candidate => String(candidate?.characterName || candidate?.chatTitle || '').trim()) || jobs[0] || {};
    const characterName = String(job?.characterName || '').trim();
    const chatTitle = String(job?.chatTitle || '').trim();
    return [characterName, chatTitle].filter(Boolean).join(' - ') || 'Other chat';
}

function shouldKeepRenderTimer() {
    for (const store of jobStores.values()) {
        if (getRunningJobs(store).length > 0 || (Array.isArray(store.queue) && store.queue.length > 0)) {
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

function findJobInStoreById(store, jobId) {
    const targetId = String(jobId || '').trim();
    if (!targetId) {
        return null;
    }

    const runningJob = getRunningJobs(store).find(job => String(job?.id || '') === targetId);
    if (runningJob) {
        return runningJob;
    }

    const queuedJob = Array.isArray(store?.queue)
        ? store.queue.find(job => String(job?.id || '') === targetId)
        : null;
    if (queuedJob) {
        return queuedJob;
    }

    return Array.isArray(store?.recentHistory)
        ? store.recentHistory.find(job => String(job?.id || '') === targetId) || null
        : null;
}

function getBlockedDependencyDetail(store, job = {}) {
    const dependencyId = String(job?.dependsOnJobId || job?.payload?.dependsOnJobId || '').trim();
    if (!dependencyId) {
        return '';
    }

    const dependencyJob = findJobInStoreById(store, dependencyId);
    const dependencyState = String(dependencyJob?.state || '').trim();
    if (dependencyState === 'completed') {
        return '';
    }

    if (TERMINAL_JOB_STATES.has(dependencyState)) {
        return `${getJobTypeLabel(dependencyJob?.type || 'memory')} job ${dependencyState}.`;
    }

    return dependencyJob ? 'Waiting for prerequisite job.' : 'Prerequisite job was not found.';
}

function cancelQueuedJob(store, job, detail) {
    job.state = 'canceled';
    job.detail = String(detail || 'Canceled by dependency.');
    job.finishedAt = Date.now();
    markJobUpdated(job, job.finishedAt);
    store.recentHistory.unshift(cloneJobForView(job));
    sortRecentHistory(store.recentHistory);
    touchStore(store);
}

/**
 * Cancels a terminal memory's queued automatic dependents after preserving their retry snapshots.
 */
function cancelQueuedMemoryDependents(store, memoryJob, { force = false } = {}) {
    if (memoryJob.type !== 'memory' || (!force && !isStmbJobRetryable(memoryJob))) {
        return 0;
    }

    const dependents = store.queue.filter(job => isStmbAfterMemoryDependent(memoryJob, job));
    if (dependents.length === 0) {
        return 0;
    }

    memoryJob.payload = {
        ...(memoryJob.payload || {}),
        retryAfterMemoryJobs: captureStmbRetryDependents(memoryJob, dependents)
            .map(job => cloneJobForView(job)),
    };

    const canceledIds = new Set(dependents.map(job => String(job.id)));
    const finishedAt = Date.now();
    for (const dependent of dependents) {
        dependent.state = 'canceled';
        dependent.detail = 'Canceled by dependency.';
        dependent.finishedAt = finishedAt;
        markJobUpdated(dependent, finishedAt);
        store.recentHistory.unshift(cloneJobForView(dependent));
    }
    store.queue = store.queue.filter(job => !canceledIds.has(String(job.id)));
    return dependents.length;
}

function startQueuedJob(chatKey, store, nextJob) {
    try {
        const executor = jobExecutors.get(String(nextJob.type || ''));
        if (typeof executor !== 'function') {
            throw new Error(`No STMB job executor registered for "${nextJob.type}".`);
        }

        executeRunningJob(chatKey, store, nextJob, executor).catch(error => {
            console.warn('STMB queued job failed outside executor wrapper', error);
        });
    } catch (error) {
        nextJob.state = 'failed';
        nextJob.error = {
            message: String(error?.message || 'Unknown STMB job failure'),
        };
        finishRunningJob(chatKey, store, nextJob);
    }
}

async function executeRunningJob(chatKey, store, nextJob, executor) {
    try {
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
            if (!error?.stmbToastrShown) {
                const failureMessage = `${getJobTypeLabel(nextJob.type)} job failed: ${nextJob.error.message}`;
                const canReviewRawResponse = nextJob.type === 'memory'
                    && error?.code === 'EMPTY_OR_INVALID'
                    && Boolean(String(error?.rawResponse || '').trim());
                if (canReviewRawResponse) {
                    const rawResponseLabel = translate('Raw response from AI');
                    const toast = globalThis.toastr?.error?.(
                        `${escapeHtml(failureMessage)}<br><a href="#" class="stmb-raw-response-link">${escapeHtml(rawResponseLabel)}</a>`,
                        'STMB',
                        {
                            timeOut: 0,
                            extendedTimeOut: 0,
                            closeButton: true,
                            tapToDismiss: false,
                            escapeHtml: false,
                        },
                    );
                    toast?.find('.stmb-raw-response-link')?.on('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        showFailedAIResponsePopup(error);
                    });
                } else {
                    globalThis.toastr?.error?.(failureMessage, 'STMB');
                }
            }
        }
    } finally {
        finishRunningJob(chatKey, store, nextJob);
    }
}

function finishRunningJob(chatKey, store, nextJob) {
    const pendingApproval = pendingApprovals.get(String(nextJob.id || ''));
    if (pendingApproval) {
        pendingApprovals.delete(String(nextJob.id || ''));
        pendingApproval.cleanup?.();
        try {
            pendingApproval.resolve({
                decision: 'cancel',
                aborted: true,
            });
        } catch (error) {
            console.warn('STMB approval cleanup failed', error);
        }
    }

    cancelQueuedMemoryDependents(store, nextJob);
    nextJob.finishedAt = Date.now();
    delete nextJob.approvalRequest;
    markJobUpdated(nextJob, nextJob.finishedAt);
    delete nextJob.abortController;
    store.runningJobs = getRunningJobs(store).filter(job => String(job?.id || '') !== String(nextJob.id));
    removeFromQueueById(store, nextJob.id);
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

async function runNextJob(chatKey) {
    const store = ensureChatStore(chatKey);
    if (store.runnerActive || store.queue.length === 0) {
        syncRenderTimer();
        return;
    }

    store.runnerActive = true;
    try {
        while (store.queue.length > 0) {
            const nextJob = store.queue[0];
            const dependencyDetail = getBlockedDependencyDetail(store, nextJob);
            if (dependencyDetail && dependencyDetail !== 'Waiting for prerequisite job.') {
                store.queue.shift();
                cancelQueuedJob(store, nextJob, dependencyDetail);
                continue;
            }
            if (dependencyDetail === 'Waiting for prerequisite job.') {
                syncRenderTimer();
                setTimeout(() => {
                    runNextJob(chatKey).catch(error => {
                        console.warn('STMB client job runner failed', error);
                    });
                }, 100);
                break;
            }
            if (!canStartQueuedJob(store, nextJob)) {
                break;
            }

            store.queue.shift();
            nextJob.startedAt = Date.now();
            nextJob.state = ACTIVE_JOB_STATES.has(nextJob.state) ? nextJob.state : 'queued';
            nextJob.abortController = new AbortController();
            markJobUpdated(nextJob, nextJob.startedAt);
            getRunningJobs(store).push(nextJob);
            touchStore(store);
            startQueuedJob(chatKey, store, nextJob);
        }
    } finally {
        store.runnerActive = false;
        syncRenderTimer();
    }
}

function createJobContext(store, job) {
    return {
        store,
        job,
        signal: job.abortController.signal,
        setState(state, options = {}) {
            job.state = String(state || job.state || 'queued');
            if (typeof options.detail === 'string') {
                job.detail = options.detail;
            }
            markJobUpdated(job);
            touchStore(store);
        },
        setDetail(detail) {
            job.detail = String(detail || '');
            markJobUpdated(job);
            touchStore(store);
        },
        setResult(result) {
            job.result = structuredClone(result);
            markJobUpdated(job);
            touchStore(store);
        },
        patch(patch = {}) {
            Object.assign(job, patch);
            markJobUpdated(job);
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
        dependsOnJobId: String(input.dependsOnJobId || input.payload?.dependsOnJobId || ''),
        parentJobOrder: input.parentJobOrder !== null && input.parentJobOrder !== undefined && Number.isFinite(Number(input.parentJobOrder))
            ? Number(input.parentJobOrder)
            : null,
        range: input.range ? structuredClone(input.range) : null,
        lorebookName: String(input.lorebookName || ''),
        profileIndex: Number.isFinite(Number(input.profileIndex)) ? Number(input.profileIndex) : null,
        state: 'queued',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        updatedAt: Date.now(),
        error: null,
        result: null,
        detail: String(input.detail || ''),
        title: String(input.title || ''),
        chatTitle: String(input.chatTitle || ''),
        characterName: String(input.characterName || sceneContext?.characterName || ''),
        payload: input.payload ? structuredClone(input.payload) : {},
        approvalRequest: input.approvalRequest ? structuredClone(input.approvalRequest) : null,
        sceneContext,
    };
}

function getRangeIdentity(range = null) {
    const sceneStart = Number(range?.sceneStart);
    const sceneEnd = Number(range?.sceneEnd);
    return Number.isInteger(sceneStart) && Number.isInteger(sceneEnd)
        ? `${sceneStart}:${sceneEnd}`
        : '';
}

function getSidePromptBatchTemplateIdentity(job = {}) {
    const templates = Array.isArray(job?.payload?.templates) ? job.payload.templates : [];
    return templates
        .map(template => String(template?.templateKey || template?.templateName || '').trim())
        .filter(Boolean)
        .sort()
        .join('|');
}

function getSidePromptJobIdentity(job = {}) {
    return {
        type: String(job?.type || ''),
        trigger: String(job?.payload?.trigger || ''),
        range: getRangeIdentity(job?.range || job?.payload?.range),
        templateKey: String(job?.payload?.templateKey || ''),
        templates: getSidePromptBatchTemplateIdentity(job),
        lorebookName: String(job?.lorebookName || job?.payload?.lorebookName || '').trim(),
    };
}

function areJobsEquivalentForDedupe(left = {}, right = {}) {
    const leftIdentity = getSidePromptJobIdentity(left);
    const rightIdentity = getSidePromptJobIdentity(right);
    if (!leftIdentity.type || !rightIdentity.type || leftIdentity.type !== rightIdentity.type) {
        return false;
    }

    if (leftIdentity.trigger !== rightIdentity.trigger || leftIdentity.range !== rightIdentity.range || leftIdentity.lorebookName !== rightIdentity.lorebookName) {
        return false;
    }

    if (leftIdentity.type === 'sidePromptBatch' && leftIdentity.trigger === 'onAfterMemory') {
        return Boolean(leftIdentity.templates) && leftIdentity.templates === rightIdentity.templates;
    }

    if (leftIdentity.type === 'sidePrompt' && (leftIdentity.trigger === 'onInterval' || leftIdentity.trigger === 'onAfterMemory')) {
        return Boolean(leftIdentity.templateKey) && leftIdentity.templateKey === rightIdentity.templateKey;
    }

    if (leftIdentity.type === 'memoryAssistance' && leftIdentity.trigger === 'onAfterMemory') {
        return Boolean(leftIdentity.range) && leftIdentity.range === rightIdentity.range;
    }

    return false;
}

function findDuplicateActiveOrQueuedJob(store, job) {
    const activeJobs = [
        ...getRunningJobs(store),
        ...(Array.isArray(store?.queue) ? store.queue : []),
    ];

    return activeJobs.find(candidate => areJobsEquivalentForDedupe(candidate, job)) || null;
}

function findMutableJobRecordById(jobId) {
    const targetId = String(jobId || '').trim();
    if (!targetId) {
        return null;
    }

    for (const [chatKey, store] of jobStores.entries()) {
        const runningJob = getRunningJobs(store).find(job => String(job?.id || '') === targetId);
        if (runningJob) {
            return { chatKey, store, job: runningJob, source: 'runningJob' };
        }

        const queuedJob = Array.isArray(store?.queue)
            ? store.queue.find(job => String(job?.id || '') === targetId)
            : null;
        if (queuedJob) {
            return { chatKey, store, job: queuedJob, source: 'queue' };
        }

        const recentJob = Array.isArray(store?.recentHistory)
            ? store.recentHistory.find(job => String(job?.id || '') === targetId)
            : null;
        if (recentJob) {
            return { chatKey, store, job: recentJob, source: 'recentHistory' };
        }
    }

    return null;
}

export async function awaitStmbJobApproval(context, approvalRequest = {}, options = {}) {
    const store = context?.store || null;
    const job = context?.job || null;
    const signal = context?.signal || null;
    const jobId = String(job?.id || '').trim();
    if (!store || !job || !jobId) {
        throw new Error('STMB approval request requires a live job context.');
    }

    const previousApproval = pendingApprovals.get(jobId);
    if (previousApproval) {
        pendingApprovals.delete(jobId);
        previousApproval.cleanup?.();
        previousApproval.resolve({
            decision: 'cancel',
            superseded: true,
        });
    }

    return await new Promise(resolve => {
        const settle = response => {
            if (pendingApprovals.get(jobId)?.resolve !== resolve) {
                return;
            }
            pendingApprovals.delete(jobId);
            cleanup();
            delete job.approvalRequest;
            markJobUpdated(job);
            touchStore(store);
            resolve(response ? structuredClone(response) : null);
        };

        const onAbort = () => settle({
            decision: 'cancel',
            aborted: true,
        });
        const cleanup = () => signal?.removeEventListener?.('abort', onAbort);

        job.approvalRequest = structuredClone(approvalRequest || {});
        job.state = 'awaiting_approval';
        if (typeof options.detail === 'string') {
            job.detail = options.detail;
        }
        markJobUpdated(job);
        pendingApprovals.set(jobId, { resolve, cleanup });
        if (signal?.aborted) {
            settle({
                decision: 'cancel',
                aborted: true,
            });
            return;
        }
        signal?.addEventListener?.('abort', onAbort, { once: true });
        touchStore(store);
    });
}

export function respondToStmbJobApproval(input = {}) {
    const jobId = String(input?.jobId || '').trim();
    if (!jobId) {
        return { ok: false, error: 'jobId is required.' };
    }

    const pendingApproval = pendingApprovals.get(jobId);
    if (!pendingApproval) {
        return { ok: false, error: 'No pending approval for this job.' };
    }

    const record = findMutableJobRecordById(jobId);
    if (!record?.job || !record?.store) {
        pendingApprovals.delete(jobId);
        pendingApproval.cleanup?.();
        return { ok: false, error: 'Approval job is no longer active.' };
    }

    const decision = String(input?.decision || '').trim().toLowerCase();
    if (!['approve', 'retry', 'reject', 'cancel'].includes(decision)) {
        return { ok: false, error: `Unsupported approval decision "${decision || 'unknown'}".` };
    }

    const job = record.job;
    delete job.approvalRequest;
    if (decision === 'approve') {
        job.state = 'saving';
    } else if (decision === 'retry') {
        job.state = 'generating';
    } else {
        job.state = 'canceled';
        job.detail = 'Canceled in approval';
    }

    markJobUpdated(job);
    touchStore(record.store);

    pendingApprovals.delete(jobId);
    pendingApproval.cleanup?.();
    pendingApproval.resolve({
        decision,
        editedData: input?.editedData ? structuredClone(input.editedData) : null,
    });

    return {
        ok: true,
        status: job.state,
    };
}

function renderJobRows(records = []) {
    if (!jobsRows || !jobsActions) {
        return;
    }

    const esc = value => escapeHtml(String(value ?? ''));
    const sections = [];

    for (const record of records) {
        const runningJob = getRunningJobs(record.store);
        const queuedJobs = Array.isArray(record.store?.queue) ? record.store.queue : [];
        const recentJobs = Array.isArray(record.store?.recentHistory) ? record.store.recentHistory : [];
        const orderedJobs = [
            ...runningJob.map(job => ({ job, source: 'running' })),
            ...queuedJobs.map(job => ({ job, source: 'queue' })),
            ...recentJobs.map(job => ({ job, source: 'history' })),
        ];

        if (orderedJobs.length === 0) {
            continue;
        }

        if (records.length > 1 || !record.isCurrent) {
            sections.push(`<div class="stmb-jobs-store-label">${esc(getStoreDisplayLabel(record))}</div>`);
        }

        sections.push(...orderedJobs.map(({ job, source }) => {
            const rangeLabel = getRangeLabel(job.range);
            const elapsedLabel = formatElapsed(job);
            const isAwaitingApproval = isJobAwaitingApproval(job);
            const canDismissNotification = source === 'history' && TERMINAL_JOB_STATES.has(job.state) && job.state !== 'completed';
            const approvalAttrs = isAwaitingApproval
                ? ` data-action="open-approval" data-job-id="${esc(job.id)}" role="button" tabindex="0" title="Review approval request"`
                : '';
            const retryButton = isStmbJobRetryable(job)
                ? (job.type === 'memory'
                    ? `<div class="flex-container flexGap5">
                        <button type="button" class="menu_button stmb-jobs-row-action" data-action="retry-all" data-chat-key="${esc(record.chatKey)}" data-job-id="${esc(job.id)}" data-i18n="Retry all">Retry all</button>
                        <button type="button" class="menu_button stmb-jobs-row-action" data-action="retry-memory" data-chat-key="${esc(record.chatKey)}" data-job-id="${esc(job.id)}" data-i18n="Retry memory">Retry memory</button>
                    </div>`
                    : `<button type="button" class="menu_button stmb-jobs-row-action" data-action="retry" data-chat-key="${esc(record.chatKey)}" data-job-id="${esc(job.id)}" data-i18n="Retry">Retry</button>`)
                : '';
            const dismissButton = canDismissNotification
                ? `<button type="button" class="stmb-jobs-row-dismiss" data-action="dismiss-job" data-chat-key="${esc(record.chatKey)}" data-job-id="${esc(job.id)}" title="Dismiss notification" aria-label="Dismiss notification" data-i18n="[title]Dismiss notification;[aria-label]Dismiss notification">&times;</button>`
                : '';
            return `
                <div class="stmb-jobs-row ${getStatusToneClass(job)}"${approvalAttrs}>
                    <div class="stmb-jobs-row-main">
                        <div class="stmb-jobs-row-header">
                            <span class="stmb-jobs-row-icon"></span>
                            <strong>${esc(getJobDisplayLabel(job))}</strong>
                            <span class="stmb-jobs-row-status">${esc(getJobStateLabel(job))}</span>
                        </div>
                        ${rangeLabel ? `<div class="stmb-jobs-row-meta">${esc(rangeLabel)}</div>` : ''}
                        <div class="stmb-jobs-row-meta">${esc(job.characterName)}${job.chatTitle ? ` - ${esc(job.chatTitle)}` : ''}</div>
                        <div class="stmb-jobs-row-meta">${job.lorebookName ? `<span data-i18n="Lorebook:">Lorebook:</span> ${esc(job.lorebookName)}` : ''}${elapsedLabel ? ` - ${esc(elapsedLabel)}` : ''}</div>
                        ${job.detail ? `<div class="stmb-jobs-row-detail">${esc(job.detail)}</div>` : ''}
                        ${job.error?.message ? `<div class="stmb-jobs-row-error">${esc(job.error.message)}</div>` : ''}
                    </div>
                    ${retryButton}
                    ${dismissButton}
                </div>
            `;
        }));
    }

    jobsRows.innerHTML = sections.join('') || '<div class="stmb-jobs-empty" data-i18n="No Memory Books jobs.">No Memory Books jobs.</div>';

    const currentChatKey = getCurrentChatKey();
    const currentRecord = records.find(record => record.chatKey === currentChatKey);
    const hasCurrentRunningJob = getRunningJobs(currentRecord?.store).length > 0;
    const hasAnyActiveJobs = records.some(record => record.activeCount > 0);
    const completedCount = records.reduce((count, record) => count + getCompletedCount(record.store), 0);
    const notificationCount = records.reduce((count, record) => count + getDismissibleNotificationCount(record.store), 0);
    jobsActions.innerHTML = `
        <button type="button" class="menu_button" data-action="cancel-active" ${hasCurrentRunningJob ? '' : 'disabled'} data-i18n="Cancel current active job">Cancel current active job</button>
        <button type="button" class="menu_button" data-action="cancel-all-active" ${hasAnyActiveJobs ? '' : 'disabled'} data-i18n="Cancel all jobs">Cancel all jobs</button>
        <button type="button" class="menu_button" data-action="clear-completed" ${completedCount > 0 ? '' : 'disabled'}>Clear completed</button>
        ${notificationCount > 0 ? '<button type="button" class="stmb-jobs-action-link" data-action="dismiss-notifications" data-i18n="Dismiss all notifications">Dismiss all notifications</button>' : ''}
    `;
}

function renderStmbJobsUi() {
    if (!jobsUiInitialized || !topBarButton || !jobsPanel || !jobsSummary) {
        return;
    }

    const currentChatKey = getCurrentChatKey();
    const summary = summarizeAllStores();
    const activeCount = summary.running + summary.queued + summary.awaitingApproval;
    const hasActiveJobs = activeCount > 0;
    const recentFailureCount = summary.recentFailures;
    const recentHistoryCount = summary.recentHistory;
    const isPanelOpen = Boolean(jobsPanelOpen);
    const tooltip = hasActiveJobs
        ? buildTooltip(summary)
        : (recentFailureCount > 0
            ? (recentFailureCount === 1 ? '1 recent failure' : `${recentFailureCount} recent failures`)
            : (recentHistoryCount > 0 ? `${recentHistoryCount} recent ${recentHistoryCount === 1 ? 'job' : 'jobs'}` : 'No Memory Books jobs'));

    topBarButton.disabled = false;
    topBarButton.classList.toggle('disabled', false);
    topBarButton.classList.toggle('active', isPanelOpen);
    topBarButton.title = tooltip;
    topBarButton.setAttribute('aria-label', t`Memory Books Jobs. ${tooltip}`);
    topBarButton.setAttribute('aria-expanded', String(isPanelOpen));
    topBarBadge.textContent = hasActiveJobs ? String(activeCount) : (recentFailureCount > 0 ? String(recentFailureCount) : '');
    topBarBadge.style.display = hasActiveJobs || recentFailureCount > 0 ? 'inline-flex' : 'none';
    topBarBadge.classList.toggle('stmb-jobs-badge-failed', !hasActiveJobs && recentFailureCount > 0);
    jobsSummary.textContent = hasActiveJobs
        ? `${summary.running} running, ${summary.queued} queued${summary.awaitingApproval > 0 ? `, ${summary.awaitingApproval} awaiting approval` : ''}${recentFailureCount > 0 ? `, ${recentFailureCount} recent ${recentFailureCount === 1 ? 'failure' : 'failures'}` : ''}`
        : (recentFailureCount > 0
            ? `${recentFailureCount} recent ${recentFailureCount === 1 ? 'failure' : 'failures'}`
            : (recentHistoryCount > 0 ? `${recentHistoryCount} recent ${recentHistoryCount === 1 ? 'job' : 'jobs'}` : 'No active jobs'));
    jobsPanel.classList.toggle('visible', isPanelOpen);
    jobsPanel.setAttribute('aria-hidden', String(!isPanelOpen));

    renderJobRows(getJobStoreRecordsForView(currentChatKey));
    syncRenderTimer();
}

function handleTopBarButtonClick() {
    if (getAwaitingApprovalCount() === 1) {
        const approvalJob = findFirstAwaitingApprovalJob();
        if (approvalJob && dispatchOpenApprovalEvent(approvalJob)) {
            return;
        }
    }

    jobsPanelOpen = !jobsPanelOpen;
    renderStmbJobsUi();
}

function handlePanelClick(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
        return;
    }

    const action = String(actionButton.dataset.action || '');
    const currentChatKey = getCurrentChatKey();

    if (action === 'cancel-active') {
        if (!currentChatKey) {
            return;
        }
        cancelActiveStmbJob(currentChatKey);
        return;
    }
    if (action === 'cancel-all-active') {
        for (const key of jobStores.keys()) {
            cancelAllStmbJobs(key);
        }
        return;
    }
    if (action === 'clear-completed') {
        for (const key of jobStores.keys()) {
            clearCompletedStmbJobs(key);
        }
        return;
    }
    if (action === 'dismiss-notifications') {
        for (const key of jobStores.keys()) {
            dismissStmbJobNotifications(key);
        }
        return;
    }
    if (action === 'dismiss-job') {
        const dismissChatKey = actionButton.dataset.chatKey || currentChatKey;
        if (dismissChatKey) {
            dismissStmbJobNotification(dismissChatKey, actionButton.dataset.jobId);
        }
        return;
    }
    if (action === 'open-approval') {
        const record = findMutableJobRecordById(actionButton.dataset.jobId);
        if (record?.job && isJobAwaitingApproval(record.job)) {
            dispatchOpenApprovalEvent(record.job);
        }
        return;
    }
    if (action === 'retry') {
        const retryChatKey = actionButton.dataset.chatKey || currentChatKey;
        if (retryChatKey) {
            retryFailedStmbJob(retryChatKey, actionButton.dataset.jobId);
        }
        return;
    }
    if (action === 'retry-memory' || action === 'retry-all') {
        const retryChatKey = actionButton.dataset.chatKey || currentChatKey;
        if (retryChatKey) {
            retryFailedStmbJob(retryChatKey, actionButton.dataset.jobId, {
                includeDependents: action === 'retry-all',
            });
        }
    }
}

function handlePanelKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    const actionButton = event.target.closest?.('[data-action="open-approval"]');
    if (!actionButton) {
        return;
    }

    event.preventDefault();
    actionButton.click();
}

export function initStmbJobsUi() {
    if (jobsUiInitialized) {
        renderStmbJobsUi();
        return;
    }

    const wrapper = document.getElementById('stmb-jobs-topbar');
    const drawer = document.getElementById('top_chat_stmb_jobs');
    if (!wrapper) {
        setTimeout(() => initStmbJobsUi(), 250);
        return;
    }

    topBarButton = wrapper.querySelector('#stmb-jobs-topbar-button');
    topBarBadge = wrapper.querySelector('#stmb-jobs-topbar-badge');
    jobsPanel = drawer;
    jobsSummary = drawer?.querySelector('#stmb-jobs-summary');
    jobsRows = drawer?.querySelector('#stmb-jobs-rows');
    jobsActions = drawer?.querySelector('#stmb-jobs-actions');
    if (!topBarButton || !topBarBadge || !jobsPanel || !jobsSummary || !jobsRows || !jobsActions) {
        setTimeout(() => initStmbJobsUi(), 250);
        return;
    }

    topBarButton.setAttribute('aria-controls', 'top_chat_stmb_jobs');
    topBarButton.setAttribute('aria-expanded', 'false');
    topBarButton.addEventListener('click', handleTopBarButtonClick);
    jobsPanel.addEventListener('click', handlePanelClick);
    jobsPanel.addEventListener('keydown', handlePanelKeydown);

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
    const duplicateJob = findDuplicateActiveOrQueuedJob(store, job);
    if (duplicateJob) {
        return cloneJobForView(duplicateJob);
    }
    store.queue.push(job);
    touchStore(store);
    syncRenderTimer();
    runNextJob(job.chatKey).catch(error => {
        console.warn('STMB job queue kickoff failed', error);
    });
    return cloneJobForView(job);
}

export function getStmbJobStoreSnapshot(chatKey = null) {
    const cloneStore = (store) => ({
        queue: Array.isArray(store?.queue) ? store.queue.map(job => cloneJobForView(job)) : [],
        runningJob: getLegacyRunningJob(store) ? cloneJobForView(getLegacyRunningJob(store)) : null,
        runningJobs: getRunningJobs(store).map(job => cloneJobForView(job)),
        recentHistory: Array.isArray(store?.recentHistory) ? store.recentHistory.map(job => cloneJobForView(job)) : [],
        lastUpdated: Number(store?.lastUpdated || 0),
    });

    if (chatKey) {
        return cloneStore(ensureChatStore(chatKey));
    }
    const snapshot = {};
    for (const [key, store] of jobStores.entries()) {
        snapshot[key] = cloneStore(store);
    }
    return snapshot;
}

export function hasActiveStmbJobs(chatKey = null) {
    if (chatKey) {
        const store = ensureChatStore(chatKey);
        return Boolean(getRunningJobs(store).length > 0 || store.queue.length > 0);
    }
    for (const store of jobStores.values()) {
        if (getRunningJobs(store).length > 0 || store.queue.length > 0) {
            return true;
        }
    }
    return false;
}

export function cancelActiveStmbJob(chatKey = null, jobId = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey) {
        return false;
    }

    const store = ensureChatStore(targetChatKey);
    const targetJobId = String(jobId || '').trim();
    const runningJob = targetJobId
        ? getRunningJobs(store).find(job => String(job?.id || '') === targetJobId)
        : getLegacyRunningJob(store);
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

    for (const runningJob of getRunningJobs(store)) {
        canceled += cancelQueuedMemoryDependents(store, runningJob, { force: true });
    }
    for (const queuedJob of store.queue.splice(0)) {
        queuedJob.state = 'canceled';
        queuedJob.detail = queuedJob.detail || 'Canceled by user';
        queuedJob.finishedAt = Date.now();
        store.recentHistory.unshift(cloneJobForView(queuedJob));
        canceled += 1;
    }

    sortRecentHistory(store.recentHistory);

    const runningJobs = getRunningJobs(store).filter(job => job?.abortController);
    if (runningJobs.length > 0) {
        closeActiveMemoryPreviewPopups();
        for (const runningJob of runningJobs) {
            runningJob.detail = 'Canceled by user';
            runningJob.abortController.abort('stmb-job-cancel');
            canceled += 1;
        }
    }

    touchStore(store);
    return canceled;
}

export function updateStmbJobsForLorebookReference({ operation, oldName, newName = '' } = {}) {
    const target = String(oldName || '').trim();
    const replacement = String(newName || '').trim();
    if (!target || (operation !== 'rename' && operation !== 'delete')) {
        return { updated: 0, canceled: 0 };
    }

    let updated = 0;
    let canceled = 0;

    for (const store of jobStores.values()) {
        let storeChanged = false;

        for (const runningJob of getRunningJobs(store)) {
            const runningJobLorebookName = String(runningJob?.lorebookName || '').trim();
            const runningPayloadLorebookName = String(runningJob?.payload?.lorebookName || '').trim();
            const runningMatches = runningJobLorebookName === target || runningPayloadLorebookName === target;

            if (runningMatches) {
                if (operation === 'rename') {
                    if (runningJobLorebookName === target) {
                        runningJob.lorebookName = replacement;
                    }
                    if (runningPayloadLorebookName === target && runningJob.payload && typeof runningJob.payload === 'object') {
                        runningJob.payload.lorebookName = replacement;
                    }
                    runningJob.detail = runningJob.detail || 'Lorebook renamed while job was running';
                    markJobUpdated(runningJob);
                    updated++;
                } else {
                    runningJob.detail = 'Canceled because its lorebook was deleted';
                    if (runningJob.abortController) {
                        runningJob.abortController.abort('stmb-lorebook-deleted');
                    } else {
                        runningJob.state = 'canceled';
                        runningJob.finishedAt = Date.now();
                    }
                    markJobUpdated(runningJob);
                    canceled++;
                }
                storeChanged = true;
            }
        }

        const nextQueue = [];

        for (const job of Array.isArray(store.queue) ? store.queue : []) {
            const jobLorebookName = String(job?.lorebookName || '').trim();
            const payloadLorebookName = String(job?.payload?.lorebookName || '').trim();
            const matches = jobLorebookName === target || payloadLorebookName === target;

            if (!matches) {
                nextQueue.push(job);
                continue;
            }

            if (operation === 'rename') {
                if (jobLorebookName === target) {
                    job.lorebookName = replacement;
                }
                if (payloadLorebookName === target && job.payload && typeof job.payload === 'object') {
                    job.payload.lorebookName = replacement;
                }
                markJobUpdated(job);
                updated++;
                storeChanged = true;
                nextQueue.push(job);
                continue;
            }

            job.state = 'canceled';
            job.detail = job.detail || 'Canceled because its lorebook was deleted';
            job.finishedAt = Date.now();
            markJobUpdated(job);
            store.recentHistory.unshift(cloneJobForView(job));
            canceled++;
            storeChanged = true;
        }

        if (storeChanged) {
            store.queue = nextQueue;
            sortRecentHistory(store.recentHistory);
            touchStore(store);
        }
    }

    return { updated, canceled };
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
    return dismissStmbJobNotifications(chatKey);
}

export function dismissStmbJobNotifications(chatKey = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey) {
        return 0;
    }

    const store = ensureChatStore(targetChatKey);
    const before = store.recentHistory.length;
    store.recentHistory = store.recentHistory.filter(job => !TERMINAL_JOB_STATES.has(job.state) || job.state === 'completed');
    touchStore(store);
    return before - store.recentHistory.length;
}

export function dismissStmbJobNotification(chatKey = null, jobId = null) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    const targetJobId = String(jobId || '').trim();
    if (!targetChatKey || !targetJobId) {
        return false;
    }

    const store = ensureChatStore(targetChatKey);
    const before = store.recentHistory.length;
    store.recentHistory = store.recentHistory.filter(job => {
        if (String(job?.id || '') !== targetJobId) {
            return true;
        }
        return !TERMINAL_JOB_STATES.has(job.state) || job.state === 'completed';
    });
    if (store.recentHistory.length === before) {
        return false;
    }

    touchStore(store);
    return true;
}

export function retryFailedStmbJob(chatKey = null, jobId = null, options = {}) {
    const targetChatKey = String(chatKey || getCurrentChatKey() || '').trim();
    if (!targetChatKey || !jobId) {
        return null;
    }

    const store = ensureChatStore(targetChatKey);
    const sourceJob = store.recentHistory.find(job => String(job.id) === String(jobId) && isStmbJobRetryable(job));
    if (!sourceJob) {
        return null;
    }

    const includeDependents = options.includeDependents && sourceJob.type === 'memory';
    const dependentJobs = includeDependents
        ? collectStmbCanceledDependents(sourceJob, store.recentHistory)
        : [];
    const currentDependentIds = includeDependents
        ? store.recentHistory
            .filter(job => isStmbAfterMemoryDependent(sourceJob, job))
            .map(job => String(job.id))
        : [];
    const consumedJobIds = new Set([
        String(sourceJob.id),
        ...dependentJobs.map(job => String(job.id)),
        ...currentDependentIds,
    ]);
    store.recentHistory = store.recentHistory.filter(job => !consumedJobIds.has(String(job.id)));
    touchStore(store);

    const payload = buildStmbRetryPayload(sourceJob, { includeDependents });
    const retriedJob = enqueueStmbJob({
        chatKey: sourceJob.chatKey,
        type: sourceJob.type,
        range: sourceJob.range,
        lorebookName: sourceJob.lorebookName,
        profileIndex: sourceJob.profileIndex,
        title: sourceJob.title,
        characterName: sourceJob.characterName,
        chatTitle: sourceJob.chatTitle,
        sceneContext: sourceJob.sceneContext,
        payload,
    });
    if (!includeDependents) {
        return retriedJob;
    }

    for (const dependent of dependentJobs) {
        const dependentPayload = structuredClone(dependent.payload || {});
        dependentPayload.dependsOnJobId = retriedJob.id;
        enqueueStmbJob({
            chatKey: dependent.chatKey,
            type: dependent.type,
            dependsOnJobId: retriedJob.id,
            parentJobOrder: dependent.parentJobOrder,
            range: dependent.range,
            lorebookName: dependent.lorebookName,
            profileIndex: dependent.profileIndex,
            title: dependent.title,
            characterName: dependent.characterName,
            chatTitle: dependent.chatTitle,
            sceneContext: dependent.sceneContext,
            payload: dependentPayload,
        });
    }
    return retriedJob;
}
