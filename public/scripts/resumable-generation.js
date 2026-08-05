function reconnectDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
    fetchImpl = fetch,
    reconnectDelayMs = 500,
    maxEmptyReconnects = 5,
    maxReconnectDelayMs = 5_000,
}) {
    const encoder = new TextEncoder();
    let cancelConnection = () => {};
    let abortFetch = () => {};
    let stopped = false;
    let forwardedHeaders = false;
    let resumableResponse;
    const stream = new ReadableStream({
        start(controller) {
            const connectionController = new AbortController();
            abortFetch = () => connectionController.abort();
            let lastEventId = '';
            const close = (error = null) => {
                if (stopped) {
                    return;
                }
                stopped = true;
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

            void (async () => {
                while (!stopped) {
                    let receivedEvent = false;
                    try {
                        const headers = getHeaders();
                        if (lastEventId) {
                            headers['Last-Event-ID'] = lastEventId;
                        }
                        const response = await fetchImpl(url, {
                            headers,
                            signal: connectionController.signal,
                        });
                        if (!response.ok || !response.body) {
                            const error = new Error(`Generation stream returned HTTP ${response.status}.`);
                            error.retryable = response.status >= 500;
                            throw error;
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
                        let buffer = '';
                        while (!stopped) {
                            const next = await reader.read();
                            if (next.done) {
                                break;
                            }
                            buffer += next.value;
                            const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n');
                            buffer = blocks.pop() || '';
                            for (const block of blocks) {
                                receivedEvent ||= block.split('\n').some(line => line.startsWith('data:'));
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
                    }
                    emptyReconnects = receivedEvent ? 0 : emptyReconnects + 1;
                    if (emptyReconnects >= maxEmptyReconnects) {
                        const error = new Error('Generation stream ended without a terminal event.');
                        error.generationRecoveryAvailable = true;
                        close(error);
                        return;
                    }
                    const delayMs = Math.min(
                        reconnectDelayMs * (2 ** Math.max(0, emptyReconnects - 1)),
                        maxReconnectDelayMs,
                    );
                    await reconnectDelay(delayMs);
                }
            })();

            if (signal.aborted) {
                cancelConnection();
            }
        },
        cancel() {
            if (!stopped) {
                stopped = true;
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
