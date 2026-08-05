import { describe, expect, it } from '@jest/globals';

import {
    clearPendingGeneration,
    getPendingGeneration,
    savePendingGeneration,
} from '../public/scripts/generation-recovery.js';

function createStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}

function createRecord(createdAt = Date.now()) {
    return {
        generationId: '11111111-1111-4111-8111-111111111111',
        type: 'normal',
        chatIdentity: { groupId: '', characterId: '2', chatId: 'chat-1' },
        anchorMessageUuid: '22222222-2222-4222-8222-222222222222',
        createdAt,
        startedAt: createdAt - 100,
        canMultiSwipe: false,
        serverRequestId: 'request-1',
        forceChid: null,
        swipeTarget: null,
    };
}

describe('pending generation recovery', () => {
    it('round-trips only the opaque state needed to reattach after a reload', () => {
        const storage = createStorage();
        const record = {
            ...createRecord(),
            prompt: 'secure lorebook content',
            generatedText: 'private provider output',
        };

        const saved = savePendingGeneration(record, storage);
        expect(saved).toEqual(createRecord(record.createdAt));
        expect(getPendingGeneration(storage)).toEqual(saved);
        expect(JSON.stringify(saved)).not.toContain('secure lorebook content');
        expect(JSON.stringify(saved)).not.toContain('private provider output');
    });

    it('discards expired and malformed recovery records', () => {
        const storage = createStorage();
        const expired = createRecord(Date.now() - 24 * 60 * 60_000 - 1);

        expect(savePendingGeneration(expired, storage)).toBeNull();
        expect(savePendingGeneration({ ...createRecord(), type: 'swipe' }, storage)).toBeNull();
        storage.setItem('aikobots.pending-generation.v1', '{bad json');
        expect(getPendingGeneration(storage)).toBeNull();
        expect(storage.getItem('aikobots.pending-generation.v1')).toBeNull();
    });

    it('does not clear a newer generation owned by the same tab', () => {
        const storage = createStorage();
        const record = createRecord();
        savePendingGeneration(record, storage);

        clearPendingGeneration('33333333-3333-4333-8333-333333333333', storage);
        expect(getPendingGeneration(storage)).toEqual(record);
        clearPendingGeneration(record.generationId, storage);
        expect(getPendingGeneration(storage)).toBeNull();
    });
});
