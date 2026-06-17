import { describe, expect, it } from '@jest/globals';

import {
    assignChunkMessagesByAbsoluteId,
    ChatChunkPayloadError,
    validateChunkedChatPayload,
} from '../../public/scripts/chat-chunking.js';

function makeMessages(count) {
    return Array.from({ length: count }, (_, index) => ({
        mes: `message ${index}`,
    }));
}

describe('chunked chat payload handling', () => {
    it('assigns chunk messages to absolute sparse chat positions', () => {
        const payload = validateChunkedChatPayload({
            totalMessages: 7353,
            loadedRangeStart: 6353,
            loadedRangeEnd: 7352,
            messages: makeMessages(1000),
        }, { requireLatestTail: true });
        const chat = [];
        chat.length = payload.totalMessages;

        assignChunkMessagesByAbsoluteId(chat, payload);

        expect(chat).toHaveLength(7353);
        expect(chat[6352]).toBeUndefined();
        expect(chat[6353].mes).toBe('message 0');
        expect(chat[7352].mes).toBe('message 999');
    });

    it('rejects a prefix chunk when a live tail chunk is required', () => {
        expect(() => validateChunkedChatPayload({
            totalMessages: 7353,
            loadedRangeStart: 0,
            loadedRangeEnd: 999,
            messages: makeMessages(1000),
        }, { requireLatestTail: true })).toThrow(ChatChunkPayloadError);
    });

    it('accepts the same prefix chunk for history window loading', () => {
        const payload = validateChunkedChatPayload({
            totalMessages: 7353,
            loadedRangeStart: 0,
            loadedRangeEnd: 999,
            messages: makeMessages(1000),
        });

        expect(payload.loadedRangeStart).toBe(0);
        expect(payload.loadedRangeEnd).toBe(999);
    });

    it('rejects range metadata that does not match the message count', () => {
        expect(() => validateChunkedChatPayload({
            totalMessages: 7353,
            loadedRangeStart: 6353,
            loadedRangeEnd: 7353,
            messages: makeMessages(1000),
        })).toThrow(ChatChunkPayloadError);
    });

    it('preserves the existing empty-chat response compatibility path', () => {
        const payload = validateChunkedChatPayload({});

        expect(payload.totalMessages).toBe(0);
        expect(payload.loadedRangeStart).toBe(0);
        expect(payload.loadedRangeEnd).toBe(-1);
        expect(payload.messages).toEqual([]);
    });
});
