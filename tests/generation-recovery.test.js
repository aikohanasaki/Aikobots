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
    reportGenerationCancellation,
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
    it('keeps a selectable, content-free reference visible for uncertain starts', () => {
        const previousDocument = globalThis.document;
        const elements = [];
        let appended;
        let noticeOptions;
        globalThis.document = { createElement: tag => {
            const element = { tag, append(child) { this.child = child; },
                addEventListener(event, handler) { this[event] = handler; },
                select() { this.selected = true; } };
            elements.push(element);
            return element;
        } };
        try {
            const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
            const notice = { find: () => ({ append: element => { appended = element; } }) };
            const options = { t: strings => strings.join(''), notify: (message, title, options) => {
                expect(message).not.toContain('synthetic-private-sentinel');
                noticeOptions = options;
                return notice;
            } };
            reportGenerationCancellation(id, { generationCancellationCode: 'START_TIMEOUT', message: 'synthetic-private-sentinel' }, options);
            expect(noticeOptions).toMatchObject({ timeOut: 0, extendedTimeOut: 0, tapToDismiss: false, closeButton: true });
            expect(appended.textContent).toBe('Reference ID (select and copy)');
            expect(appended.child).toMatchObject({ tag: 'input', value: id, readOnly: true });
            appended.child.click();
            expect(appended.child.selected).toBe(true);
            reportGenerationCancellation('synthetic-private-sentinel', { generationCancellationCode: 'START_TIMEOUT' }, options);
            expect(elements).toHaveLength(2);
            expect(noticeOptions.timeOut).toBe(10000);
        } finally {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        }
    });
    it('reports uncertain acknowledgements as recoverable rather than cancelled', () => {
        const notices = [];
        const t = strings => strings.join('');
        for (const code of ['START_TIMEOUT', 'START_CONNECTION', 'START_HTTP_408', 'START_HTTP_5XX', 'START_INVALID_REPLY', 'START_NOT_ADMITTED']) {
            const error = reportGenerationCancellation(`pending-${code}`, { generationCancellationCode: code }, {
                t, notify: (message, title) => notices.push({ message, title }),
            });
            expect(error.generationRecoveryAvailable).toBe(true);
            expect(error.generationId).toBe(`pending-${code}`);
            expect(notices.at(-1).title).toBe('Generation recovery pending');
            expect(notices.at(-1).message).toContain(`[${code}]`);
            expect(notices.at(-1).message).not.toContain('Cancellation requested');
        }
    });
    it('reports only fixed cancellation causes once per generation and keeps retry diagnostics out of storage', async () => {
        const storage = createStorage();
        const notices = [];
        const t = (strings, ...values) => strings.reduce((text, part, i) => text + part + (values[i] ?? ''), '');
        const notify = (text, title) => notices.push({ text, title });
        const id = 'abababab-abab-4bab-8bab-abababababab';
        const record = { ...createRecord(), generationId: id };
        savePendingGeneration(record, storage);
        const options = { storage, getHeaders: () => ({}), t, notify,
            fetchImpl: async () => new Response('', { status: 503 }),
            reason: { generationCancellationCode: 'RECOVERY_ANCHOR_CHANGED', message: 'synthetic-private-sentinel' } };
        expect(await cancelGenerationWithConfirmation(id, options)).toBe(false);
        expect(await cancelGenerationWithConfirmation(id, options)).toBe(false);
        const { reason, ...retryOptions } = options;
        expect(await cancelGenerationWithConfirmation(id, retryOptions)).toBe(false);
        expect(notices).toHaveLength(1);
        expect(notices[0].text).toContain('[RECOVERY_ANCHOR_CHANGED]');
        expect(notices[0].title).toBe('Generation cancellation requested');
        expect(getPendingGeneration(storage)?.generationId).toBe(id);
        expect(storage.getItem('aikobots.pending-generation-cancellations.v1')).not.toContain('RECOVERY_ANCHOR_CHANGED');
        for (const code of ['RECOVERY_SWIPE_CHANGED', 'SESSION_LOCKED', 'SCRIPT_STOP', 'APPLICATION_ABORT']) {
            const error = reportGenerationCancellation(`diagnostic-${code}`, { generationCancellationCode: code, message: 'synthetic-private-sentinel' }, { t, notify });
            expect(error.message).toContain(`[${code}]`);
            expect(error.generationCancellationReported).toBe(true);
        }
        const count = notices.length;
        expect(reportGenerationCancellation('user', { generationCancellationCode: 'USER_STOP' }, { t, notify })).toBeNull();
        expect(reportGenerationCancellation('parked', { generationParked: true }, { t, notify })).toBeNull();
        expect(notices).toHaveLength(count);
        reportGenerationCancellation('unknown', { generationCancellationCode: 'synthetic-private-sentinel' }, { t, notify });
        expect(notices.at(-1).text).toContain('[APPLICATION_ABORT]');
        expect(JSON.stringify(notices)).not.toContain('synthetic-private-sentinel');
    });
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
