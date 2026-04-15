/**
 * Consume a chat-completion SSE stream and accumulate text, swipes, state, and the final chunk.
 * Caller-specific behavior remains callback-driven.
 *
 * @param {Response} response
 * @param {object} options
 * @param {() => { readable: ReadableStream, writable: WritableStream }} options.createEventStream
 * @param {() => any} options.createState
 * @param {(parsed: any, state: any) => string} options.getReply
 * @param {(parsed: any) => boolean} [options.allowSwipe]
 * @param {(parsed: any, response: Response) => Error | null} [options.handleChunkError]
 * @param {(parsed: any, context: object) => ({ skip?: boolean, afterAccumulate?: (context: object) => void } | void)} [options.handleChunk]
 * @returns {Promise<{ text: string, swipes: string[], state: any, lastChunk: any }>}
 */
export async function consumeChatCompletionStream(response, options) {
    const {
        createEventStream,
        createState,
        getReply,
        allowSwipe,
        handleChunkError,
        handleChunk,
    } = options;

    const eventStream = createEventStream();
    response.body.pipeThrough(eventStream);
    const reader = eventStream.readable.getReader();
    const state = createState();
    const swipes = [];
    let text = '';
    let lastChunk = null;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const rawData = value?.data;
            if (rawData === '[DONE]') {
                break;
            }

            const parsed = JSON.parse(rawData);
            const chunkError = typeof handleChunkError === 'function' ? handleChunkError(parsed, response) : null;
            if (chunkError) {
                throw chunkError;
            }

            const action = typeof handleChunk === 'function'
                ? (handleChunk(parsed, { response, rawData, text, swipes, state, lastChunk }) || {})
                : {};
            if (action.skip) {
                continue;
            }

            const reply = getReply(parsed, state);
            const isSwipe = typeof allowSwipe === 'function' ? Boolean(allowSwipe(parsed)) : false;
            const swipeIndex = Number(parsed?.choices?.[0]?.index) - 1;

            lastChunk = parsed;

            if (isSwipe && Number.isInteger(swipeIndex) && swipeIndex >= 0) {
                swipes[swipeIndex] = (swipes[swipeIndex] || '') + reply;
            } else {
                text += reply;
            }

            if (typeof action.afterAccumulate === 'function') {
                action.afterAccumulate({
                    response,
                    rawData,
                    parsed,
                    reply,
                    text,
                    swipes,
                    state,
                    lastChunk,
                    isSwipe,
                    swipeIndex,
                });
            }
        }
    } finally {
        reader.releaseLock();
    }

    return { text, swipes, state, lastChunk };
}
