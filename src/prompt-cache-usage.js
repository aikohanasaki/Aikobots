/**
 * Normalizes provider-reported prompt cache usage for prompt snapshots.
 * @param {unknown} value Provider token count.
 * @returns {{ cachedInputTokens: number, scope: 'request' } | null}
 */
export function normalizePromptCacheUsage(value) {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') {
        return null;
    }

    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) {
        return null;
    }

    return {
        cachedInputTokens: count,
        scope: 'request',
    };
}

/**
 * Extracts cached input tokens from supported provider response shapes.
 * @param {any} payload Provider response or streaming event payload.
 * @returns {{ cachedInputTokens: number, scope: 'request' } | null}
 */
export function extractPromptCacheUsage(payload) {
    const candidates = [
        payload?.usage?.prompt_tokens_details?.cached_tokens,
        payload?.usage?.input_tokens_details?.cached_tokens,
        payload?.usage?.cache_read_input_tokens,
        payload?.message?.usage?.cache_read_input_tokens,
        payload?.response?.usage?.input_tokens_details?.cached_tokens,
        payload?.response?.usage?.prompt_tokens_details?.cached_tokens,
        payload?.usage?.total_cached_tokens,
        payload?.usageMetadata?.cachedContentTokenCount,
    ];

    for (const candidate of candidates) {
        const cacheUsage = normalizePromptCacheUsage(candidate);
        if (cacheUsage) {
            return cacheUsage;
        }
    }

    return null;
}

/**
 * Extracts prompt cache usage from one server-sent event block.
 * @param {string} eventBlock Complete SSE event block without its trailing separator.
 * @returns {{ cachedInputTokens: number, scope: 'request' } | null}
 */
export function extractPromptCacheUsageFromSseEvent(eventBlock) {
    const data = String(eventBlock || '')
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim();

    if (!data || data === '[DONE]') {
        return null;
    }

    try {
        return extractPromptCacheUsage(JSON.parse(data));
    } catch {
        return null;
    }
}

/** Resolves an explicit cache choice while preserving requests from older clients. */
export function getClaudeCacheMode(body, serverCachingEnabled) {
    const mode = body?.automatic_prompt_cache_mode;
    if (mode !== undefined) {
        if (!['inherit', 'automatic', 'off'].includes(mode)) return { error: 'Invalid Claude cache mode.' };
        if (mode === 'automatic' && !['5m', '1h'].includes(body.automatic_prompt_cache_ttl)) {
            return { error: 'Invalid Claude cache lifetime.' };
        }
        return { mode };
    }
    return { mode: !serverCachingEnabled && body?.automatic_prompt_cache === true
        && ['5m', '1h'].includes(body.automatic_prompt_cache_ttl) ? 'automatic' : 'inherit' };
}

/** Validates a requested automatic cache lifetime against the Claude model source. */
export function getAutomaticClaudeCacheTTL(body, serverCachingEnabled) {
    if (getClaudeCacheMode(body, serverCachingEnabled).mode !== 'automatic') return null;
    const model = String(body.model || '');
    const source = body.chat_completion_source;
    const eligible = source === 'claude'
        ? /^claude-[\w.-]+$/i.test(model)
        : source === 'openrouter'
            ? /^~?anthropic\/claude-[\w.-]+$/i.test(model)
            : source === 'electronhub' && /^(?:anthropic\/)?claude-[\w.-]+$/i.test(model);
    return eligible && ['5m', '1h'].includes(body.automatic_prompt_cache_ttl)
        ? body.automatic_prompt_cache_ttl
        : null;
}
