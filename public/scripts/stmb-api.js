import { getRequestHeaders } from '../script.js';

async function postStmb(path, payload) {
    const response = await fetch(`/api/stmb/${path}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const message = data?.error?.message || `STMB request failed: ${response.status}`;
        const error = new Error(message);
        if (data?.error && typeof data.error === 'object') {
            Object.assign(error, data.error);
        }
        throw error;
    }

    return data;
}

export async function saveStmbMemoryEntry(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('save-memory', payload, signal) : postStmb('save-memory', payload);
}

export async function getStmbChatRangeInfo(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('chat-range-info', payload, signal) : postStmb('chat-range-info', payload);
}

export async function captureStmbScene(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('capture-scene', payload, signal) : postStmb('capture-scene', payload);
}

export async function prepareStmbMemoryMessages(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('prepare-memory-messages', payload, signal) : postStmb('prepare-memory-messages', payload);
}

export async function prepareStmbSummaryPrompt(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('prepare-summary-prompt', payload, signal) : postStmb('prepare-summary-prompt', payload);
}

export async function prepareStmbSidePrompt(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('prepare-sideprompt', payload, signal) : postStmb('prepare-sideprompt', payload);
}

export async function generateStmbMemory(payload, options = {}) {
    const { signal = null } = options;
    return postStmbWithSignal('generate-memory', payload, signal);
}

export async function generateStmbSummary(payload, options = {}) {
    const { signal = null } = options;
    return postStmbWithSignal('generate-summary', payload, signal);
}

export async function generateStmbText(payload, options = {}) {
    const { signal = null } = options;
    return postStmbWithSignal('generate-text', payload, signal);
}

export async function commitStmbSummaries(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('commit-summaries', payload, signal) : postStmb('commit-summaries', payload);
}

export async function upsertStmbEntryByTitle(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('upsert-entry-by-title', payload, signal) : postStmb('upsert-entry-by-title', payload);
}

export async function upsertStmbEntriesBatch(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('upsert-entries-batch', payload, signal) : postStmb('upsert-entries-batch', payload);
}

export async function getStmbPlannerChatState(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('planner/chat-state', payload, signal) : postStmb('planner/chat-state', payload);
}

export async function updateStmbPlannerChatState(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('planner/update-chat-state', payload, signal) : postStmb('planner/update-chat-state', payload);
}

export async function enqueueStmbPlannerWave(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('planner/enqueue-wave', payload, signal) : postStmb('planner/enqueue-wave', payload);
}

export async function listStmbPlannerJobs(payload = {}, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('planner/list-jobs', payload, signal) : postStmb('planner/list-jobs', payload);
}

export async function cancelStmbPlannerJobs(payload = {}, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('planner/cancel', payload, signal) : postStmb('planner/cancel', payload);
}

async function postStmbWithSignal(path, payload, signal) {
    const response = await fetch(`/api/stmb/${path}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
        signal,
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const message = data?.error?.message || `STMB request failed: ${response.status}`;
        const error = new Error(message);
        if (data?.error && typeof data.error === 'object') {
            Object.assign(error, data.error);
        }
        throw error;
    }

    return data;
}
