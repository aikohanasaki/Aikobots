function cloneValue(value) {
    return value === undefined ? undefined : structuredClone(value);
}

const AFTER_MEMORY_JOB_TYPES = new Set(['sidePrompt', 'sidePromptBatch']);

function sortDependents(jobs) {
    return jobs.sort((left, right) => {
        const orderDelta = Number(left.parentJobOrder ?? Number.MAX_SAFE_INTEGER)
            - Number(right.parentJobOrder ?? Number.MAX_SAFE_INTEGER);
        if (orderDelta !== 0) return orderDelta;
        const createdDelta = Number(left.createdAt || 0) - Number(right.createdAt || 0);
        if (createdDelta !== 0) return createdDelta;
        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

export function isStmbJobRetryable(job = {}) {
    return ['failed', 'blocked', 'canceled'].includes(String(job.state || ''));
}

/**
 * Builds the payload for a retried job without retaining a stale dependency.
 */
export function buildStmbRetryPayload(sourceJob = {}, { includeDependents = false } = {}) {
    const payload = cloneValue(sourceJob.payload) || {};
    if (sourceJob.type === 'sidePrompt' || sourceJob.type === 'sidePromptBatch') {
        delete payload.dependsOnJobId;
    }
    if (sourceJob.type === 'memory' && !includeDependents) {
        delete payload.retryAfterMemoryJobs;
    }
    if (sourceJob.type === 'memory' && sourceJob.result) {
        payload.resumePostSaveResult = cloneValue(sourceJob.result);
    }
    return payload;
}

/**
 * Returns whether a job is an automatic side-prompt dependent of a memory job.
 */
export function isStmbAfterMemoryDependent(sourceJob = {}, job = {}) {
    return sourceJob.type === 'memory'
        && Boolean(sourceJob.id)
        && AFTER_MEMORY_JOB_TYPES.has(String(job.type || ''))
        && String(job.payload?.trigger || '') === 'onAfterMemory'
        && String(job.dependsOnJobId || job.payload?.dependsOnJobId || '') === String(sourceJob.id);
}

/**
 * Captures the complete dependent set once and preserves it across repeated retries.
 */
export function captureStmbRetryDependents(sourceJob = {}, jobs = []) {
    const carried = Array.isArray(sourceJob.payload?.retryAfterMemoryJobs)
        ? sourceJob.payload.retryAfterMemoryJobs
        : [];
    if (carried.length > 0) {
        return cloneValue(carried);
    }
    return sortDependents((Array.isArray(jobs) ? jobs : [])
        .filter(job => isStmbAfterMemoryDependent(sourceJob, job))
        .map(cloneValue));
}

/**
 * Returns the durable dependent snapshot, falling back to visible canceled history.
 */
export function collectStmbCanceledDependents(sourceJob = {}, recentHistory = []) {
    if (sourceJob.type !== 'memory' || !sourceJob.id) {
        return [];
    }
    const carried = captureStmbRetryDependents(sourceJob);
    if (carried.length > 0) {
        return carried;
    }
    return sortDependents((Array.isArray(recentHistory) ? recentHistory : [])
        .filter(job => (
            job.state === 'canceled'
            && isStmbAfterMemoryDependent(sourceJob, job)
        )));
}
