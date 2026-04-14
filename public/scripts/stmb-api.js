import { extractMessageFromData, getRequestHeaders } from '../script.js';
import { ChatCompletionService } from './custom-request.js';
import { parseStructuredMemoryResponse } from './stmb-core.js';
import { parseSummaryJsonResponse } from './stmb-summary.js';

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

export async function generateStmbMemory(payload, options = {}) {
    const { signal = null } = options;
    const providerResponse = await generateStmbProviderResponse(payload, signal);

    try {
        return {
            ok: true,
            memory: parseStructuredMemoryResponse(providerResponse),
            providerResponse,
        };
    } catch (error) {
        throw decorateStmbParseError(error, providerResponse);
    }
}

export async function generateStmbSummary(payload, options = {}) {
    const { signal = null } = options;
    const providerResponse = await generateStmbProviderResponse(payload, signal);

    try {
        return {
            ok: true,
            parsed: parseSummaryJsonResponse(providerResponse),
            providerResponse,
        };
    } catch (error) {
        throw decorateStmbParseError(error, providerResponse);
    }
}

export async function generateStmbText(payload, options = {}) {
    const { signal = null } = options;
    const providerResponse = await generateStmbProviderResponse(payload, signal);
    return {
        ok: true,
        text: extractProviderText(providerResponse),
        providerResponse,
    };
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

async function generateStmbProviderResponse(payload, signal = null) {
    const generateData = payload?.generateData;
    if (!generateData || typeof generateData !== 'object') {
        throw new Error('generateData is required.');
    }

    try {
        return await ChatCompletionService.sendRequest({ ...generateData, stream: false }, false, signal);
    } catch (error) {
        throw normalizeStmbClientError(error);
    }
}

function extractProviderText(providerResponse) {
    if (typeof providerResponse === 'string') {
        return providerResponse;
    }
    if (!providerResponse || typeof providerResponse !== 'object') {
        return String(providerResponse ?? '');
    }

    const extracted = extractMessageFromData(providerResponse, 'openai');
    if (typeof extracted === 'string' && extracted) {
        return extracted;
    }
    if (Array.isArray(extracted)) {
        const joined = extracted.map(part => typeof part?.text === 'string' ? part.text : '').join('');
        if (joined) {
            return joined;
        }
    }

    const geminiParts = providerResponse?.candidates?.[0]?.content?.parts;
    if (Array.isArray(geminiParts)) {
        return geminiParts
            .map(part => typeof part?.text === 'string' ? part.text : '')
            .join('');
    }

    return '';
}

function serializeProviderBody(providerResponse) {
    if (typeof providerResponse === 'string' && providerResponse.trim()) {
        return providerResponse.trim();
    }

    try {
        return JSON.stringify(providerResponse ?? {}, null, 2);
    } catch {
        return String(providerResponse ?? '').trim();
    }
}

function normalizeStmbClientError(error) {
    if (error instanceof Error) {
        return error;
    }

    const message = String(error?.error?.message || error?.message || 'STMB generation failed.');
    const normalized = new Error(message);
    if (error && typeof error === 'object') {
        Object.assign(normalized, error);
        if (error.error && typeof error.error === 'object') {
            Object.assign(normalized, error.error);
        }
    }
    return normalized;
}

function decorateStmbParseError(error, providerResponse) {
    const normalized = normalizeStmbClientError(error);
    if (!normalized.rawResponse) {
        normalized.rawResponse = serializeProviderBody(providerResponse);
    }
    if (!normalized.providerBody) {
        normalized.providerBody = serializeProviderBody(providerResponse);
    }
    return normalized;
}
