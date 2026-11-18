export const GENERATION_RETRY_WINDOW_MS = 180_000;

/** Owns one transport connection without cancelling its detached provider job. */
export function generationDeadline(signal, timeoutMs = 15_000) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    let timer;
    const reset = (ms = timeoutMs) => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new DOMException('Generation connection timed out.', 'TimeoutError')), ms);
    };
    signal?.addEventListener('abort', abort, { once: true });
    reset();
    if (signal?.aborted) abort();
    return {
        signal: controller.signal,
        reset,
        close() {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            controller.abort();
        },
    };
}

/** Fetches and buffers a finite generation response within one transport deadline. */
export async function fetchGenerationResponse(url, options = {}, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
    const connection = generationDeadline(options.signal, timeoutMs);
    let response;
    try {
        connection.signal.throwIfAborted();
        response = await fetchImpl(url, { cache: 'no-store', ...options, signal: connection.signal });
        const body = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
            status: response.status, statusText: response.statusText, headers: response.headers,
        });
    } catch {
        options.signal?.throwIfAborted();
        // A stalled error body cannot turn a definitive access/conflict rejection into a retry.
        if (response && !response.ok && !generationResponseError(response).retryable) {
            return new Response(null, { status: response.status, headers: response.headers });
        }
        throw Object.assign(new Error('Generation connection interrupted.'), {
            retryable: true,
            generationRecoveryAvailable: true,
            generationCancellationCode: connection.signal.reason?.name === 'TimeoutError' ? 'START_TIMEOUT' : 'START_CONNECTION',
        });
    } finally {
        connection.close();
    }
}

/** Classifies HTTP delivery failures without exposing response content. */
export function generationResponseError(response) {
    const value = response.headers.get('Retry-After');
    const retryAfterMs = value === null ? 0 : /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now());
    return Object.assign(new Error(`Generation delivery returned HTTP ${response.status}.`), {
        retryable: response.status >= 500 || [408, 425, 429].includes(response.status),
        generationRecoveryAvailable: true,
        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
        generationCancellationCode: response.status === 408 ? 'START_HTTP_408' : 'START_HTTP_5XX',
    });
}

/** Treats an unreadable finite response as uncertain delivery, without exposing its body. */
export async function readGenerationJson(response) {
    try {
        return await response.json();
    } catch {
        throw Object.assign(new Error('Generation response could not be read.'), {
            retryable: true, generationRecoveryAvailable: true,
        });
    }
}

/** Waits between delivery attempts, responding immediately to explicit Stop. */
export function generationRetryDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, ms);
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}

/** Retries only explicitly classified delivery failures, never provider generation itself. */
export async function retryGenerationTransport(operation, {
    signal, retryWindowMs = GENERATION_RETRY_WINDOW_MS, onRetry,
} = {}) {
    const deadline = Date.now() + retryWindowMs;
    let retryDelayMs = 1000;
    for (;;) {
        signal?.throwIfAborted();
        try {
            return await operation(Math.max(1, Math.min(15_000, deadline - Date.now())));
        } catch (error) {
            signal?.throwIfAborted();
            if (!error?.retryable || Date.now() >= deadline) throw error;
            onRetry?.();
            await generationRetryDelay(Math.min(Math.max(retryDelayMs, error.retryAfterMs || 0), deadline - Date.now()), signal);
            if (Date.now() >= deadline) throw error;
            retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
        }
    }
}
