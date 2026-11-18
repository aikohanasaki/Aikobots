import { generationDeadline, generationRetryDelay, generationResponseError, GENERATION_RETRY_WINDOW_MS } from './generation-transport.js';

const FORWARDED_RESPONSE_HEADERS = [
    'X-ST-Messages-Count',
    'X-ST-First-Included-Message-Id',
];

/**
 * Creates a fetch-backed SSE response that resumes from the last durable event ID.
 */
export function createResumableGenerationResponse({
    url,
    requestId,
    signal,
    getHeaders,
    onHeaders,
    onClose,
    onRetry,
    onActivity,
    checkStatus,
    fetchImpl = fetch,
    reconnectDelayMs = 1000,
    maxEmptyReconnects = Infinity,
    maxReconnectDelayMs = 10_000,
    retryWindowMs = GENERATION_RETRY_WINDOW_MS,
    headerTimeoutMs = 15_000,
    idleTimeoutMs = 45_000,
}) {
    const encoder = new TextEncoder();
    let cancelConnection = () => {};
    let abortFetch = () => {};
    let stopped = false;
    let forwardedHeaders = false;
    let resumableResponse;
    const lifetime = new AbortController();
    const stream = new ReadableStream({
        start(controller) {
            let lastEventId = '';
            const close = (error = null) => {
                if (stopped) {
                    return;
                }
                stopped = true;
                lifetime.abort();
                abortFetch();
                signal.removeEventListener('abort', cancelConnection);
                onClose?.();
                if (error) {
                    controller.error(error);
                } else {
                    controller.close();
                }
            };
            cancelConnection = () => close(signal.reason || new DOMException('Generation cancelled.', 'AbortError'));
            signal.addEventListener('abort', cancelConnection, { once: true });
            let emptyReconnects = 0;
            let retryDeadline = Date.now() + retryWindowMs;

            void (async () => {
                while (!stopped) {
                    let receivedEvent = false;
                    let receivedHeaders = false;
                    let retryAfterMs = 0;
                    const connection = generationDeadline(lifetime.signal, Math.min(headerTimeoutMs, Math.max(1, retryDeadline - Date.now())));
                    abortFetch = () => connection.close();
                    try {
                        const headers = getHeaders();
                        if (lastEventId) {
                            headers['Last-Event-ID'] = lastEventId;
                        }
                        const response = await fetchImpl(url, {
                            headers,
                            signal: connection.signal,
                        });
                        receivedHeaders = true;
                        if (!response.ok || !response.body) {
                            throw generationResponseError(response);
                        }
                        if (!forwardedHeaders) {
                            for (const name of FORWARDED_RESPONSE_HEADERS) {
                                const value = response.headers.get(name);
                                if (value !== null) {
                                    resumableResponse.headers.set(name, value);
                                }
                            }
                            forwardedHeaders = true;
                            onHeaders?.(resumableResponse.headers);
                        }

                        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                        connection.reset(Math.min(idleTimeoutMs, Math.max(1, retryDeadline - Date.now())));
                        let buffer = '';
                        while (!stopped) {
                            const next = await reader.read();
                            if (next.done) {
                                break;
                            }
                            retryDeadline = Date.now() + retryWindowMs;
                            onActivity?.();
                            connection.reset(idleTimeoutMs);
                            receivedEvent = true;
                            buffer += next.value;
                            const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n');
                            buffer = blocks.pop() || '';
                            for (const block of blocks) {
                                const idLine = block.split('\n').find(line => line.startsWith('id:'));
                                if (idLine) {
                                    lastEventId = idLine.slice(3).trimStart();
                                }
                                controller.enqueue(encoder.encode(`${block}\n\n`));
                                const data = block.split('\n')
                                    .filter(line => line.startsWith('data:'))
                                    .map(line => line.slice(5).trimStart())
                                    .join('\n');
                                if (data === '[DONE]') {
                                    close();
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        if (signal.aborted || stopped) {
                            close(signal.reason || error);
                            return;
                        }
                        if (error?.retryable === false) {
                            close(error);
                            return;
                        }
                        retryAfterMs = error?.retryAfterMs || 0;
                        if (!receivedHeaders && checkStatus) {
                            try {
                                const status = await checkStatus(lifetime.signal);
                                if (['queued', 'running'].includes(status?.state)) {
                                    retryDeadline = Date.now() + retryWindowMs;
                                    receivedEvent = true;
                                }
                            } catch (statusError) {
                                if (statusError?.retryable === false) { close(statusError); return; }
                            }
                        }
                    } finally {
                        connection.close();
                    }
                    if (stopped) return;
                    emptyReconnects = receivedEvent ? 0 : emptyReconnects + 1;
                    if (emptyReconnects >= maxEmptyReconnects || Date.now() >= retryDeadline) {
                        const error = new Error('Generation stream ended without a terminal event.');
                        error.generationRecoveryAvailable = true;
                        close(error);
                        return;
                    }
                    const delayMs = Math.min(
                        Math.max(Math.min(reconnectDelayMs * (2 ** Math.max(0, emptyReconnects - 1)), maxReconnectDelayMs), retryAfterMs),
                        Math.max(0, retryDeadline - Date.now()),
                    );
                    onRetry?.();
                    await generationRetryDelay(delayMs, lifetime.signal).catch(() => {});
                }
            })();

            if (signal.aborted) {
                cancelConnection();
            }
        },
        cancel() {
            if (!stopped) {
                stopped = true;
                lifetime.abort();
                abortFetch();
                signal.removeEventListener('abort', cancelConnection);
                onClose?.();
            }
        },
    });
    resumableResponse = new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-Request-Id': requestId,
        },
    });
    return resumableResponse;
}
