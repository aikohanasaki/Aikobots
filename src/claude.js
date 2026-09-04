import { createHash } from 'node:crypto';

import fetch from 'node-fetch';

export const CLAUDE_API_VERSION = '2023-06-01';
const SUCCESS_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function positiveInteger(value) {
    return Number.isInteger(value) && value > 0 ? value : undefined;
}

function supported(value) {
    return value === true || value?.supported === true;
}

function sanitizeThinking(capability) {
    if (!capability || typeof capability !== 'object') {
        return undefined;
    }

    const types = capability.types && typeof capability.types === 'object' ? capability.types : capability;
    const thinking = {
        supported: supported(capability),
        types: {
            adaptive: supported(types.adaptive),
            enabled: supported(types.enabled),
        },
    };
    return thinking;
}

function sanitizeEffort(capability) {
    if (!capability || typeof capability !== 'object') {
        return undefined;
    }

    const source = capability.levels && typeof capability.levels === 'object' ? capability.levels : capability;
    const levels = Object.fromEntries(EFFORT_LEVELS.map(level => [level, supported(source[level])]));
    const effort = { supported: supported(capability), levels };
    return effort;
}

/** Returns the public, low-risk subset of an Anthropic model record. */
export function sanitizeClaudeModel(model) {
    if (!model || typeof model.id !== 'string' || !model.id.trim()) {
        return null;
    }

    const capabilities = model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {};
    const result = { id: model.id.trim() };
    if (typeof model.display_name === 'string' && model.display_name) result.display_name = model.display_name;
    if (typeof model.created_at === 'string' && model.created_at) result.created_at = model.created_at;
    const maxInputTokens = positiveInteger(model.max_input_tokens);
    const maxTokens = positiveInteger(model.max_tokens);
    if (maxInputTokens) result.max_input_tokens = maxInputTokens;
    if (maxTokens) result.max_tokens = maxTokens;

    const sanitizedCapabilities = {};
    if (capabilities.image_input !== undefined) sanitizedCapabilities.image_input = { supported: supported(capabilities.image_input) };
    if (capabilities.structured_outputs !== undefined) sanitizedCapabilities.structured_outputs = { supported: supported(capabilities.structured_outputs) };
    const thinking = sanitizeThinking(capabilities.thinking);
    const effort = sanitizeEffort(capabilities.effort);
    if (thinking) sanitizedCapabilities.thinking = thinking;
    if (effort) sanitizedCapabilities.effort = effort;
    if (Object.keys(sanitizedCapabilities).length) result.capabilities = sanitizedCapabilities;
    return result;
}

function normalizeEndpoint(endpoint) {
    return new URL(endpoint).toString().replace(/\/$/, '');
}

function cacheKey(endpoint, credential) {
    const digest = createHash('sha256').update(String(credential)).digest('hex');
    return `${normalizeEndpoint(endpoint)}:${digest}`;
}

/** Creates a credential-scoped, request-coalescing Claude model catalog resolver. */
export function createClaudeCatalogResolver({ fetchImpl = fetch, now = Date.now } = {}) {
    const cache = new Map();

    async function fetchCatalog(endpoint, credential, signal) {
        const url = new URL(`${normalizeEndpoint(endpoint)}/models`);
        url.searchParams.set('limit', '1000');
        const response = await fetchImpl(url, {
            method: 'GET',
            signal,
            headers: {
                'accept': 'application/json',
                'anthropic-version': CLAUDE_API_VERSION,
                ...(credential ? { 'x-api-key': credential } : {}),
            },
        });
        if (!response.ok) throw new Error(`Claude model catalog returned HTTP ${response.status}.`);
        const payload = await response.json();
        return Array.isArray(payload?.data) ? payload.data.map(sanitizeClaudeModel).filter(Boolean) : [];
    }

    return async function resolveClaudeCatalog(endpoint, credential, { signal } = {}) {
        const key = cacheKey(endpoint, credential);
        const cached = cache.get(key);
        const time = now();
        if (cached?.models && cached.expiresAt > time) return { data: cached.models, stale: false };
        if (cached?.failureExpiresAt > time) {
            if (cached.models) return { data: cached.models, stale: true, error: true };
            throw cached.error;
        }
        if (cached?.pending) return cached.pending;

        const pending = fetchCatalog(endpoint, credential, signal).then((models) => {
            cache.set(key, { models, expiresAt: now() + SUCCESS_TTL_MS });
            return { data: models, stale: false };
        }).catch((error) => {
            const previous = cache.get(key);
            cache.set(key, {
                models: previous?.models,
                expiresAt: 0,
                failureExpiresAt: now() + FAILURE_TTL_MS,
                error,
            });
            if (previous?.models) return { data: previous.models, stale: true, error: true };
            throw error;
        });
        cache.set(key, { ...cached, pending });
        return pending;
    };
}

export const resolveClaudeCatalog = createClaudeCatalogResolver();

function supportedEfforts(model) {
    const levels = model?.capabilities?.effort?.levels || {};
    return EFFORT_LEVELS.filter(level => levels[level] === true);
}

function mapEffort(model, requested) {
    const levels = supportedEfforts(model);
    if (!requested || requested === 'auto' || !levels.length) return undefined;
    if (requested === 'min') return levels[0];
    if (requested === 'max') return levels.at(-1);
    return levels.includes(requested) ? requested : undefined;
}

/** Computes Claude request features from one sanitized model record. */
export function getClaudeRequestPolicy({ model, reasoningEffort, includeReasoning, maxTokens, stream, temperature, topP, topK, prefill, hasTools, jsonSchema, calculateBudget }) {
    if (!model) {
        return {
            prefill: '',
            body: {},
            error: jsonSchema ? 'Structured output is unavailable because this Claude model’s capabilities could not be verified.' : undefined,
        };
    }

    const thinking = model.capabilities?.thinking;
    const adaptive = thinking?.types?.adaptive === true;
    const manual = thinking?.types?.enabled === true;
    const requestedThinking = Boolean(reasoningEffort && reasoningEffort !== 'auto' && (adaptive || manual));
    const body = {};

    if (requestedThinking) {
        if (adaptive) {
            body.thinking = { type: 'adaptive', display: includeReasoning ? 'summarized' : 'omitted' };
        } else {
            const budget = calculateBudget(maxTokens, reasoningEffort, stream, false);
            if (Number.isInteger(budget)) {
                body.thinking = { type: 'enabled', budget_tokens: budget, display: includeReasoning ? 'summarized' : 'omitted' };
            }
        }
        const effort = mapEffort(model, reasoningEffort);
        if (effort) body.output_config = { effort };
    }

    if (!adaptive && !body.thinking) {
        if (Number.isFinite(temperature)) body.temperature = temperature;
        else if (Number.isFinite(topP)) body.top_p = topP;
        if (Number.isFinite(topK)) body.top_k = topK;
    }

    const structured = model.capabilities?.structured_outputs?.supported === true;
    if (jsonSchema && structured) {
        body.output_config = { ...(body.output_config || {}), format: { type: 'json_schema', schema: jsonSchema.value } };
    } else if (jsonSchema && thinking && !adaptive && !body.thinking) {
        body.jsonTool = {
            name: jsonSchema.name,
            description: jsonSchema.description || 'Well-formed JSON object',
            input_schema: jsonSchema.value,
        };
    } else if (jsonSchema) {
        return { prefill: '', body, error: 'Structured output is not supported by this Claude model.' };
    }

    const canPrefill = Boolean(prefill && !adaptive && !body.thinking && !hasTools && !jsonSchema);
    return { prefill: canPrefill ? prefill : '', body };
}
