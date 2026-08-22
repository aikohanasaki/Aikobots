import { describe, expect, it } from '@jest/globals';

import {
    clearPendingGeneration,
    getPendingGeneration,
    listPendingGenerations,
    recordGenerationAdmission,
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
        outputMessageUuid: '33333333-3333-4333-8333-333333333333',
        createdAt,
        startedAt: createdAt - 100,
        stream: true,
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
            prompt: 'unexpected-prompt-field-sentinel',
            generatedText: 'unexpected-output-field-sentinel',
        };

        const saved = savePendingGeneration(record, storage);
        expect(saved).toEqual(createRecord(record.createdAt));
        expect(getPendingGeneration(storage)).toEqual(saved);
        expect(JSON.stringify(saved)).not.toContain('unexpected-prompt-field-sentinel');
        expect(JSON.stringify(saved)).not.toContain('unexpected-output-field-sentinel');
    });

    it('discards expired and malformed recovery records', () => {
        const storage = createStorage();
        const expired = createRecord(Date.now() - 7 * 24 * 60 * 60_000 - 1);

        expect(savePendingGeneration(expired, storage)).toBeNull();
        expect(savePendingGeneration({ ...createRecord(), type: 'swipe', outputMessageUuid: '' }, storage)).toBeNull();
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

    it('keeps multiple content-free jobs and clears only the requested generation', () => {
        const storage = createStorage();
        const first = createRecord(Date.now() - 100);
        const second = {
            ...createRecord(),
            generationId: '44444444-4444-4444-8444-444444444444',
            outputMessageUuid: '55555555-5555-4555-8555-555555555555',
            chatIdentity: { groupId: '', characterId: '3', chatId: 'chat-2' },
            state: 'queued',
        };
        savePendingGeneration(first, storage);
        savePendingGeneration(second, storage);

        expect(listPendingGenerations(storage)).toEqual([first, expect.objectContaining(second)]);
        clearPendingGeneration(first.generationId, storage);
        expect(listPendingGenerations(storage)).toEqual([expect.objectContaining(second)]);
    });

    it('publishes durable admission immediately after storing its content-free recovery route', () => {
        const storage = createStorage();
        const observed = [];
        const record = { ...createRecord(), stream: false, state: 'running' };

        recordGenerationAdmission(record, generationId => {
            observed.push({ generationId, stored: getPendingGeneration(storage) });
        }, storage);

        expect(observed).toEqual([{
            generationId: record.generationId,
            stored: record,
        }]);
    });
});
