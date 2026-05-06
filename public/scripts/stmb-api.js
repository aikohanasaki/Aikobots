import { extractMessageFromData, getRequestHeaders } from '../script.js';
import { getStreamingReply } from './openai.js';
import EventSourceStream from './sse-stream.js';
import { normalizeNavyReasoningEffort, parseStructuredMemoryResponse } from './stmb-core.js';
import { parseSummaryJsonResponse } from './stmb-summary.js';
import { consumeChatCompletionStream } from './chat-completion-stream.js';

const STMB_RATE_LIMIT_RETRY_DELAYS_MS = [3000, 8000];
const stmbGenerationCooldowns = new Map();
const STMB_GENERATE_DATA_FIELDS = new Set([
    'type',
    'messages',
    'prompt_context',
    'model',
    'temperature',
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
    'max_new_tokens',
    'stream',
    'chat_completion_source',
    'json_schema',
    'response_format',
    'responseMimeType',
    'responseSchema',
    'custom_url',
    'custom_api_key',
    'reverse_proxy',
    'proxy_password',
    'azure_base_url',
    'azure_deployment_name',
    'azure_api_version',
    'vertexai_auth_mode',
    'vertexai_region',
    'vertexai_express_project_id',
    'zai_endpoint',
]);

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
    const { signal = null, onRateLimitWait = null } = options;
    const providerResponse = await generateStmbProviderResponse(payload, signal, onRateLimitWait);

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
    const { signal = null, onRateLimitWait = null } = options;
    const providerResponse = await generateStmbProviderResponse(payload, signal, onRateLimitWait);

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
    const { signal = null, onRateLimitWait = null } = options;
    const providerResponse = await generateStmbProviderResponse(payload, signal, onRateLimitWait);
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

export async function createStmbEntry(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('create-entry', payload, signal) : postStmb('create-entry', payload);
}

export async function updateStmbEntryByUid(payload, options = {}) {
    const { signal = null } = options;
    return signal ? postStmbWithSignal('update-entry-by-uid', payload, signal) : postStmb('update-entry-by-uid', payload);
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

async function generateStmbProviderResponse(payload, signal = null, onRateLimitWait = null) {
    const generateData = payload?.generateData;
    if (!generateData || typeof generateData !== 'object') {
        throw new Error('generateData is required.');
    }

    const requestBody = applyStmbRequestTransport(generateData);
    const providerKey = getStmbProviderKey(requestBody);

    for (let attempt = 0; attempt <= STMB_RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
        await waitForStmbProviderCooldown(providerKey, signal, onRateLimitWait);

        try {
            return requestBody.stream === true
                ? await sendStmbStreamingRequest(requestBody, signal)
                : await sendStmbNonStreamingRequest(requestBody, signal);
        } catch (error) {
            const normalized = normalizeStmbClientError(error);
            if (!isStmbRateLimitError(normalized) || attempt >= STMB_RATE_LIMIT_RETRY_DELAYS_MS.length) {
                throw normalized;
            }

            const retryDelayMs = getStmbRetryDelayMs(normalized, attempt);
            const activeCooldown = stmbGenerationCooldowns.get(providerKey);
            const cooldownUntil = Math.max(
                Date.now() + retryDelayMs,
                Number(activeCooldown?.until || 0),
            );
            stmbGenerationCooldowns.set(providerKey, { until: cooldownUntil });
        }
    }

    throw new Error('STMB generation failed.');
}

function applyStmbRequestTransport(generateData) {
    const next = {};
    for (const key of STMB_GENERATE_DATA_FIELDS) {
        if (Object.hasOwn(generateData, key)) {
            next[key] = generateData[key];
        }
    }
    next.include_reasoning = false;

    if (String(next.chat_completion_source || '').toLowerCase() === 'navy') {
        const reasoningEffort = normalizeNavyReasoningEffort(next.reasoning_effort);
        if (reasoningEffort) {
            next.reasoning_effort = reasoningEffort;
        } else {
            delete next.reasoning_effort;
        }
    }

    return next;
}

async function sendStmbStreamingRequest(requestBody, signal = null) {
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        cache: 'no-cache',
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) {
        const text = await response.text();
        throw createStmbStreamingError(response, safeJsonParse(text), `Got response status ${response.status}`);
    }

    if (!response.body) {
        throw new Error('STMB streaming response body is missing.');
    }

    const { text, state, lastChunk } = await consumeChatCompletionStream(response, {
        createEventStream: () => new EventSourceStream(),
        createState: () => ({ reasoning: '', image: '' }),
        getReply: (parsed, streamState) => getStreamingReply(parsed, streamState, {
            chatCompletionSource: requestBody.chat_completion_source,
            overrideShowThoughts: false,
        }),
        allowSwipe: () => false,
        handleChunkError: parsed => getStmbStreamingChunkError(response, parsed),
        handleChunk: parsed => {
            if (Array.isArray(parsed?.choices) && parsed?.choices?.[0]?.index > 0) {
                return { skip: true };
            }
        },
    });
    return buildStmbStreamingResponse(text, lastChunk, state, requestBody);
}

async function sendStmbNonStreamingRequest(requestBody, signal = null) {
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        cache: 'no-cache',
        body: JSON.stringify({ ...requestBody, stream: false }),
        signal,
    });

    const text = await response.text();
    const data = safeJsonParse(text);
    if (!response.ok) {
        throw createStmbStreamingError(response, data, `Got response status ${response.status}`);
    }

    return data ?? buildStmbStreamingResponse(text, null, null, requestBody);
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function getStmbStreamingChunkError(response, data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    if (data.error || data.message || data.detail) {
        return createStmbStreamingError(response, data);
    }
    return null;
}

function createStmbStreamingError(response, data = null, fallbackMessage = null) {
    const message = String(
        data?.error?.message
        || data?.message
        || data?.detail?.error?.message
        || fallbackMessage
        || response?.statusText
        || 'STMB generation failed.',
    );

    const error = new Error(message);
    if (data && typeof data === 'object') {
        Object.assign(error, data);
        if (data.error && typeof data.error === 'object') {
            Object.assign(error, data.error);
        }
        if (data.detail && typeof data.detail === 'object') {
            Object.assign(error, data.detail);
        }
        if (data.detail?.error && typeof data.detail.error === 'object') {
            Object.assign(error, data.detail.error);
        }
    }

    const responseStatus = Number(response?.status || 0);
    if (responseStatus >= 400) {
        if (!Number.isFinite(Number(error.status))) {
            error.status = responseStatus;
        }
        if (!Number.isFinite(Number(error.upstream_status))) {
            error.upstream_status = responseStatus;
        }
        if (!error.code && responseStatus === 429) {
            error.code = '429';
        }
    }

    const retryAfterMs = getStmbRetryAfterMs(response, data);
    if (retryAfterMs > 0 && !Number.isFinite(Number(error.retry_after_ms))) {
        error.retry_after_ms = retryAfterMs;
    }

    return error;
}

function getStmbRetryAfterMs(response, data = null) {
    const parsedRetryAfterMs = Number(
        data?.retry_after_ms
        ?? data?.error?.retry_after_ms
        ?? data?.detail?.retry_after_ms
        ?? data?.detail?.error?.retry_after_ms,
    );
    if (Number.isFinite(parsedRetryAfterMs) && parsedRetryAfterMs > 0) {
        return parsedRetryAfterMs;
    }

    const retryAfterHeader = String(response?.headers?.get('retry-after') || '').trim();
    if (!retryAfterHeader) {
        return 0;
    }

    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.round(retryAfterSeconds * 1000);
    }

    const retryAfterTime = Date.parse(retryAfterHeader);
    if (Number.isFinite(retryAfterTime)) {
        return Math.max(0, retryAfterTime - Date.now());
    }

    return 0;
}

function buildStmbStreamingResponse(text, lastChunk, state, requestBody) {
    const response = {
        choices: [{
            message: { content: text },
            finish_reason: lastChunk?.choices?.[0]?.finish_reason ?? lastChunk?.finish_reason ?? null,
        }],
    };

    if (requestBody?.model) {
        response.model = requestBody.model;
    }
    if (typeof state?.reasoning === 'string' && state.reasoning) {
        response.reasoning = state.reasoning;
    }
    if (typeof state?.image === 'string' && state.image) {
        response.image = state.image;
    }
    if (lastChunk?.stop_reason !== undefined) {
        response.stop_reason = lastChunk.stop_reason;
    }
    if (lastChunk?.truncated === true) {
        response.truncated = true;
    }

    return response;
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

    const extracted = extractProviderText(providerResponse);
    if (typeof extracted === 'string' && extracted.trim()) {
        return extracted.trim();
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

function getStmbProviderKey(generateData = {}) {
    return JSON.stringify({
        provider: String(generateData?.chat_completion_source || ''),
        endpoint: String(generateData?.custom_url || generateData?.reverse_proxy || ''),
        model: String(generateData?.model || ''),
    });
}

async function waitForStmbProviderCooldown(providerKey, signal = null, onRateLimitWait = null) {
    for (;;) {
        if (signal?.aborted) {
            throw normalizeStmbClientError(signal.reason ?? 'stmb-stop');
        }

        const cooldown = stmbGenerationCooldowns.get(providerKey);
        const delayMs = Math.max(0, Number(cooldown?.until || 0) - Date.now());
        if (delayMs <= 0) {
            if (cooldown) {
                stmbGenerationCooldowns.delete(providerKey);
            }
            return;
        }

        onRateLimitWait?.({
            delayMs,
            providerKey,
        });
        await delayWithAbort(delayMs, signal);
    }
}

async function delayWithAbort(delayMs, signal = null) {
    const waitMs = Math.max(0, Math.trunc(Number(delayMs) || 0));
    if (waitMs <= 0) {
        return;
    }

    await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            resolve();
        }, waitMs);

        const onAbort = () => {
            cleanup();
            reject(normalizeStmbClientError(signal?.reason ?? 'stmb-stop'));
        };
        const cleanup = () => {
            clearTimeout(timeoutId);
            signal?.removeEventListener?.('abort', onAbort);
        };

        if (signal?.aborted) {
            cleanup();
            reject(normalizeStmbClientError(signal.reason ?? 'stmb-stop'));
            return;
        }

        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

function isStmbRateLimitError(error) {
    return Number(error?.upstream_status) === 429
        || Number(error?.status) === 429
        || String(error?.code || '').trim() === '429';
}

function getStmbRetryDelayMs(error, attempt) {
    const retryAfterMs = Number(error?.retry_after_ms);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return retryAfterMs;
    }

    return STMB_RATE_LIMIT_RETRY_DELAYS_MS[Math.max(0, Math.min(STMB_RATE_LIMIT_RETRY_DELAYS_MS.length - 1, Number(attempt) || 0))];
}
