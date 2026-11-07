import { describe, expect, it } from '@jest/globals';

import {
    clearPendingGeneration,
    cancelGenerationWithConfirmation,
    listPendingGenerationCancellations,
    getSupersededFailedGenerationIds,
    getPendingGeneration,
    isSameGenerationRecoveryChatIdentity,
    isTerminalGenerationRecovery,
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
        chatIdentity: { groupId: '', characterId: '2', characterAvatar: 'alice.png', chatId: 'chat-1' },
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
    it('retains cancellation and recovery across rejected replies, then suppresses stale discovery after confirmation', async () => {
        const storage = createStorage();
        const record = { ...createRecord(), generationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
        savePendingGeneration(record, storage);
        for (const status of [503, 423, 404]) {
            const confirmed = await cancelGenerationWithConfirmation(record.generationId, {
                storage, getHeaders: () => ({}), fetchImpl: async () => Response.json({ error: true }, { status }),
            });
            expect(confirmed).toBe(false);
            expect(getPendingGeneration(storage)?.generationId).toBe(record.generationId);
            expect(listPendingGenerationCancellations(storage)).toContain(record.generationId);
        }
        expect(await cancelGenerationWithConfirmation(record.generationId, {
            storage, getHeaders: () => ({}), fetchImpl: async () => Response.json({ id: record.generationId, state: 'cancel_requested' }),
        })).toBe(true);
        expect(getPendingGeneration(storage)).toBeNull();
        expect(listPendingGenerationCancellations(storage)).toContain(record.generationId);
        expect(await cancelGenerationWithConfirmation(record.generationId, {
            storage, getHeaders: () => ({}), fetchImpl: () => { throw new Error('Confirmed cancellation must not send again'); },
        })).toBe(true);
    });

    it('restores content-free cancellation intent even without a pending generation record', async () => {
        const storage = createStorage();
        const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        storage.setItem('aikobots.pending-generation-cancellations.v1', JSON.stringify([{ id, createdAt: Date.now(), confirmed: false }]));
        expect(listPendingGenerationCancellations(storage)).toContain(id);
        let requested = false;
        expect(await cancelGenerationWithConfirmation(id, {
            storage, getHeaders: () => ({}), fetchImpl: async () => {
                requested = true;
                return Response.json({ id, state: 'cancelled' });
            },
        })).toBe(true);
        expect(requested).toBe(true);
    });
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

    it('matches new character recoveries by avatar and legacy recoveries by index', () => {
        const current = { groupId: '', characterId: '7', characterAvatar: 'alice.png', chatId: 'chat-1' };

        expect(isSameGenerationRecoveryChatIdentity(
            { groupId: '', characterId: '2', characterAvatar: 'alice.png', chatId: 'chat-1' },
            current,
        )).toBe(true);
        expect(isSameGenerationRecoveryChatIdentity(
            { groupId: '', characterId: '7', characterAvatar: 'bob.png', chatId: 'chat-1' },
            current,
        )).toBe(false);
        expect(isSameGenerationRecoveryChatIdentity(
            { groupId: '', characterId: '7', chatId: 'chat-1' },
            current,
        )).toBe(true);
    });

    it('treats failed and cancelled jobs as terminal, but keeps completed output recoverable', () => {
        expect(isTerminalGenerationRecovery({ state: 'failed' })).toBe(true);
        expect(isTerminalGenerationRecovery({ state: 'cancelled' })).toBe(true);
        expect(isTerminalGenerationRecovery({ state: 'completed' })).toBe(false);
        expect(isTerminalGenerationRecovery({ state: 'running' })).toBe(false);
    });

    it('supersedes only older failures for the successfully saved chat', () => {
        const success = { ...createRecord(20), generationId: 'success' };
        const sameChatFailure = { ...createRecord(10), generationId: 'old-failure', state: 'failed' };
        const newerFailure = { ...createRecord(30), generationId: 'new-failure', state: 'failed' };
        const otherChatFailure = {
            ...createRecord(10),
            generationId: 'other-failure',
            state: 'failed',
            chatIdentity: { ...success.chatIdentity, chatId: 'chat-2' },
        };

        expect(getSupersededFailedGenerationIds(success, [sameChatFailure, newerFailure, otherChatFailure]))
            .toEqual(['old-failure']);
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
            chatIdentity: { groupId: '', characterId: '3', characterAvatar: 'bob.png', chatId: 'chat-2' },
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
