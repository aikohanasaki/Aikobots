export class ChatChunkPayloadError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ChatChunkPayloadError';
        this.code = 'invalid_chunk_payload';
    }
}

/**
 * Validates and normalizes chunked chat payload range metadata.
 * @param {object} response Chunked chat payload from the server.
 * @param {object} [options] Validation options.
 * @param {boolean} [options.requireLatestTail=false] Whether the chunk must include the latest logical message.
 * @returns {{header: object|null, messages: object[], totalMessages: number, loadedRangeStart: number, loadedRangeEnd: number}}
 */
export function validateChunkedChatPayload(response, { requireLatestTail = false } = {}) {
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    const hasTotalMessages = response?.totalMessages !== undefined && response?.totalMessages !== null;
    const totalMessages = hasTotalMessages ? Number(response.totalMessages) : 0;

    if ((!hasTotalMessages && messages.length > 0) || !Number.isInteger(totalMessages) || totalMessages < 0) {
        throw new ChatChunkPayloadError('Chunked chat payload has an invalid total message count.');
    }

    if (messages.length === 0) {
        if (totalMessages > 0) {
            throw new ChatChunkPayloadError('Chunked chat payload is missing messages for a non-empty chat.');
        }

        return {
            header: response?.header ?? null,
            messages,
            totalMessages,
            loadedRangeStart: 0,
            loadedRangeEnd: -1,
        };
    }

    const loadedRangeStart = Number(response?.loadedRangeStart);
    const loadedRangeEnd = Number(response?.loadedRangeEnd);

    if (!Number.isInteger(loadedRangeStart) || loadedRangeStart < 0) {
        throw new ChatChunkPayloadError('Chunked chat payload has an invalid loaded range start.');
    }

    if (!Number.isInteger(loadedRangeEnd) || loadedRangeEnd < loadedRangeStart) {
        throw new ChatChunkPayloadError('Chunked chat payload has an invalid loaded range end.');
    }

    const expectedRangeEnd = loadedRangeStart + messages.length - 1;
    if (loadedRangeEnd !== expectedRangeEnd) {
        throw new ChatChunkPayloadError('Chunked chat payload range does not match its message count.');
    }

    if (loadedRangeEnd >= totalMessages) {
        throw new ChatChunkPayloadError('Chunked chat payload range exceeds the total message count.');
    }

    if (requireLatestTail && loadedRangeEnd !== totalMessages - 1) {
        throw new ChatChunkPayloadError('Chunked chat payload does not include the latest tail message.');
    }

    return {
        header: response?.header ?? null,
        messages,
        totalMessages,
        loadedRangeStart,
        loadedRangeEnd,
    };
}

/**
 * Assigns chunk messages into their absolute logical positions in a sparse chat array.
 * @param {any[]} chat Target sparse chat array.
 * @param {{messages: object[], loadedRangeStart: number}} payload Validated chunked chat payload.
 * @param {(message: object) => void} [onAssign] Optional callback for each assigned message.
 */
export function assignChunkMessagesByAbsoluteId(chat, payload, onAssign = null) {
    const loadedRangeStart = Number(payload?.loadedRangeStart);
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];

    if (!Array.isArray(chat) || !Number.isInteger(loadedRangeStart) || loadedRangeStart < 0) {
        throw new ChatChunkPayloadError('Cannot assign chunk messages without a valid target and range start.');
    }

    for (let i = 0; i < messages.length; i++) {
        const absoluteId = loadedRangeStart + i;
        chat[absoluteId] = messages[i];
        onAssign?.(chat[absoluteId]);
    }
}
