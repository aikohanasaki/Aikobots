let epoch = 0;
let sequence = 0;
let activeSignature = '';
let warmed = false;
let lastCompletedSequence = 0;
let lowReuseRun = 0;
let costRun = 0;
let warned = false;

const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Reads final request cache usage without treating total prompt tokens as uncached input. */
export function normalizeAutomaticCacheUsage(payload, ttl) {
    const usage = payload?.usage ?? payload?.message?.usage;
    if (!usage) return null;
    const details = usage.prompt_tokens_details ?? {};
    const reads = tokenCount(usage.cache_read_input_tokens ?? details.cached_tokens ?? usage.input_tokens_details?.cached_tokens);
    const divided = usage.cache_creation;
    const fiveMinuteWrites = tokenCount(divided?.ephemeral_5m_input_tokens);
    const oneHourWrites = tokenCount(divided?.ephemeral_1h_input_tokens);
    const totalWrites = tokenCount(usage.cache_creation_input_tokens ?? details.cache_write_tokens);
    if (reads === null || (totalWrites === null && fiveMinuteWrites === null && oneHourWrites === null)) return null;
    const hasBreakdown = fiveMinuteWrites !== null || oneHourWrites !== null;
    const writes5m = hasBreakdown ? fiveMinuteWrites ?? 0 : ttl === '5m' ? totalWrites : 0;
    const writes1h = hasBreakdown ? oneHourWrites ?? 0 : ttl === '1h' ? totalWrites : 0;
    return { input: tokenCount(usage.input_tokens), reads, writes5m, writes1h };
}

/** Drops previous comparisons when the user changes caching settings or context. */
export function resetAutomaticCacheComparisons() {
    epoch++;
    activeSignature = '';
    warmed = false;
    lastCompletedSequence = 0;
    lowReuseRun = 0;
    costRun = 0;
    warned = false;
}

/** Captures a request's immutable cache comparison context before dispatch. */
export function createAutomaticCacheComparison({ requestId, chatScope, provider, model, ttl, directAnthropic }) {
    const signature = JSON.stringify([chatScope, provider, model, ttl]);
    if (signature !== activeSignature) {
        resetAutomaticCacheComparisons();
        activeSignature = signature;
    }
    return Object.freeze({ requestId, chatScope, provider, model, ttl, directAnthropic, epoch, sequence: ++sequence, signature });
}

/** Applies a successfully completed request's final usage to the warning streaks. */
export function finishAutomaticCacheComparison(context, usage, responseModel) {
    if (!context || context.epoch !== epoch || context.signature !== activeSignature || context.sequence <= lastCompletedSequence) return null;
    lastCompletedSequence = context.sequence;
    if (!warmed) {
        warmed = true;
        return null;
    }
    if (!usage) {
        lowReuseRun = 0;
        costRun = 0;
        warned = false;
        return null;
    }
    const writes = usage.writes5m + usage.writes1h;
    const lowReuse = writes + usage.reads > 0 && usage.reads / (writes + usage.reads) < 0.2;
    lowReuseRun = lowReuse ? lowReuseRun + 1 : 0;
    // Anthropic's cache multipliers stack with model and long-context prices, so
    // dividing delta by the positive base input rate preserves its sign.
    // A proxy or unknown response model has an unknown billing context.
    const modelKnown = typeof responseModel === 'string' && /^claude-[\w.-]+$/i.test(responseModel);
    const readRatio = /claude-(?:fable|mythos)-5-1(?:$|-)/.test(responseModel) ? 0.025
        : /claude-(?:opus|sonnet)-5-5(?:$|-)/.test(responseModel) ? 0.05 : 0.1;
    const delta = context.provider === 'claude' && context.directAnthropic && modelKnown
        ? 0.25 * usage.writes5m + usage.writes1h - (1 - readRatio) * usage.reads
        : null;
    costRun = delta !== null && delta > 0 ? costRun + 1 : 0;
    if (lowReuseRun < 2 && costRun < 2) warned = false;
    if (warned) return null;
    if (lowReuseRun >= 2) {
        warned = true;
        return 'low_reuse';
    }
    if (costRun >= 2) {
        warned = true;
        return 'cost';
    }
    return null;
}
