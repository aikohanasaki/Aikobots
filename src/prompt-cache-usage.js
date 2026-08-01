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
