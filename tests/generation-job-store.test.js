import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    appendGenerationEvent,
    closeGenerationJobStore,
    createGenerationJob,
    finalizeStaleGenerationJob,
    finishGenerationJob,
    getGenerationEventsAfter,
    getGenerationJob,
    listGenerationRecoveries,
    markGenerationJobRunning,
    requestGenerationCancellation,
    resolveGenerationRecovery,
    touchGenerationJob,
} from '../src/generation-job-store.js';
import { GenerationJobResponse } from '../src/generation-job-response.js';

describe('generation job store', () => {
    let dataRoot;
    let previousDataRoot;

    function readGenerationDatabaseBytes() {
        const databasePath = join(dataRoot, '_generation-jobs', 'jobs.sqlite');
        return Buffer.concat([databasePath, `${databasePath}-wal`]
            .filter(existsSync)
            .map(filePath => readFileSync(filePath)));
    }

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        dataRoot = mkdtempSync(join(tmpdir(), 'aikobots-generation-jobs-'));
        globalThis.DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        closeGenerationJobStore();
        jest.restoreAllMocks();
        globalThis.DATA_ROOT = previousDataRoot;
        rmSync(dataRoot, { recursive: true, force: true });
    });

    it('replays ordered events only to the owning user without storing prompt text', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'opaque-hash', requestId: 'request-1' });
        markGenerationJobRunning(id, 'alice');
        appendGenerationEvent(id, 'alice', 'data: {"choices":[]}');
        appendGenerationEvent(id, 'alice', 'data: [DONE]');
        finishGenerationJob(id, 'alice', 'completed');

        expect(getGenerationEventsAfter(id, 'alice', 1).events).toEqual([
            { sequence: 2, eventBlock: 'data: [DONE]' },
        ]);
        expect(getGenerationJob(id, 'bob')).toBeNull();
        const databaseBytes = readGenerationDatabaseBytes();
        expect(databaseBytes.includes(Buffer.from('unexpected-field-sentinel'))).toBe(false);
    });

    it('rejects a missing user handle instead of sharing an ownership key', () => {
        expect(() => createGenerationJob({
            id: 'abababab-abab-4bab-8bab-abababababab',
            userHandle: undefined,
            requestFingerprint: 'hash',
            requestId: 'request-missing-user',
        })).toThrow('Generation job user handle is required.');
    });

    it('makes a cancellation order win the completion transition', () => {
        const id = '22222222-2222-4222-8222-222222222222';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-2' });
        markGenerationJobRunning(id, 'alice');
        requestGenerationCancellation(id, 'alice');

        expect(finishGenerationJob(id, 'alice', 'completed').state).toBe('cancel_requested');
        expect(finishGenerationJob(id, 'alice', 'cancelled').state).toBe('cancelled');
    });

    it('atomically finalizes an abandoned owner and rejects its late events', () => {
        const id = '12121212-1212-4121-8121-121212121212';
        jest.spyOn(Date, 'now').mockReturnValue(10);
        createGenerationJob({
            id,
            userHandle: 'alice',
            requestFingerprint: 'hash',
            requestId: 'request-stale',
            recovery: {
                type: 'normal',
                chatIdentity: { groupId: '', characterId: '2', chatId: 'chat-1' },
                anchorMessageUuid: '13131313-1313-4131-8131-131313131313',
                outputMessageUuid: '14141414-1414-4141-8141-141414141414',
                createdAt: 10,
                startedAt: 10,
                canMultiSwipe: false,
                forceChid: null,
                swipeTarget: null,
            },
        });
        markGenerationJobRunning(id, 'alice');

        Date.now.mockReturnValue(100);
        expect(finalizeStaleGenerationJob(id, 'alice', 50)).toEqual(expect.objectContaining({
            state: 'failed',
            resolvedAt: 100,
        }));
        expect(appendGenerationEvent(id, 'alice', 'data: late')).toBeNull();
        expect(listGenerationRecoveries('alice')).toEqual([]);
        expect(getGenerationEventsAfter(id, 'alice', 0).events.map(event => event.eventBlock)).toEqual([
            'data: {"error":{"message":"Generation worker stopped before completion."}}',
            'data: [DONE]',
        ]);
    });

    it('discovers only the owner\'s unresolved content-free recovery records', () => {
        const id = '66666666-6666-4666-8666-666666666666';
        const now = Date.now();
        createGenerationJob({
            id,
            userHandle: 'alice',
            requestFingerprint: 'hash',
            requestId: 'request-6',
            recovery: {
                type: 'normal',
                chatIdentity: { groupId: '', characterId: '2', chatId: 'chat-1' },
                anchorMessageUuid: '77777777-7777-4777-8777-777777777777',
                outputMessageUuid: '88888888-8888-4888-8888-888888888888',
                createdAt: now,
                startedAt: now,
                canMultiSwipe: false,
                forceChid: null,
                swipeTarget: null,
                prompt: 'unexpected-field-sentinel',
            },
        });

        expect(listGenerationRecoveries('bob')).toEqual([]);
        expect(listGenerationRecoveries('alice')).toEqual([
            expect.objectContaining({
                id,
                recovery: expect.not.objectContaining({ prompt: expect.anything() }),
                resolvedAt: null,
            }),
        ]);
        expect(readGenerationDatabaseBytes().includes(Buffer.from('unexpected-field-sentinel'))).toBe(false);

        expect(resolveGenerationRecovery(id, 'alice').resolvedAt).toEqual(expect.any(Number));
        expect(listGenerationRecoveries('alice')).toEqual([]);
    });

    it('cancels an unclaimed queued job without requiring an owning worker', () => {
        const id = '55555555-5555-4555-8555-555555555555';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-5' });

        expect(requestGenerationCancellation(id, 'alice').state).toBe('cancelled');
        expect(markGenerationJobRunning(id, 'alice').claimed).toBe(false);
    });

    it('resolves recovery records that finish without committable output', () => {
        const id = '15151515-1515-4151-8151-151515151515';
        const now = Date.now();
        createGenerationJob({
            id,
            userHandle: 'alice',
            requestFingerprint: 'hash',
            requestId: 'request-failed',
            recovery: {
                type: 'normal',
                chatIdentity: { groupId: '', characterId: '2', chatId: 'chat-1' },
                anchorMessageUuid: '16161616-1616-4161-8161-161616161616',
                outputMessageUuid: '17171717-1717-4171-8171-171717171717',
                createdAt: now,
                startedAt: now,
                canMultiSwipe: false,
                forceChid: null,
                swipeTarget: null,
            },
        });

        expect(finishGenerationJob(id, 'alice', 'failed').resolvedAt).toEqual(expect.any(Number));
        expect(listGenerationRecoveries('alice')).toEqual([]);
    });

    it('keeps healthy work and gives unresolved completions the seven-day window', () => {
        const baseTime = 1_800_000_000_000;
        const now = jest.spyOn(Date, 'now').mockReturnValue(baseTime);
        const recovery = {
            type: 'normal',
            chatIdentity: { groupId: '', characterId: '2', chatId: 'chat-1' },
            anchorMessageUuid: '99999999-9999-4999-8999-999999999999',
            outputMessageUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            createdAt: baseTime,
            startedAt: baseTime,
            canMultiSwipe: false,
            forceChid: null,
            swipeTarget: null,
        };
        const unresolvedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const resolvedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const runningId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const failedId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

        createGenerationJob({ id: unresolvedId, userHandle: 'alice', requestFingerprint: 'u', requestId: 'u', recovery });
        finishGenerationJob(unresolvedId, 'alice', 'completed');
        createGenerationJob({ id: resolvedId, userHandle: 'alice', requestFingerprint: 'r', requestId: 'r', recovery: { ...recovery, outputMessageUuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } });
        finishGenerationJob(resolvedId, 'alice', 'completed');
        resolveGenerationRecovery(resolvedId, 'alice');
        createGenerationJob({ id: runningId, userHandle: 'alice', requestFingerprint: 'running', requestId: 'running' });
        markGenerationJobRunning(runningId, 'alice');
        createGenerationJob({ id: failedId, userHandle: 'alice', requestFingerprint: 'failed', requestId: 'failed' });
        finishGenerationJob(failedId, 'alice', 'failed');

        now.mockReturnValue(baseTime + 2 * 24 * 60 * 60_000);
        touchGenerationJob(runningId, 'alice');
        expect(listGenerationRecoveries('alice').map(job => job.id)).toContain(unresolvedId);
        expect(getGenerationJob(resolvedId, 'alice')).toBeNull();
        expect(getGenerationJob(failedId, 'alice')).toBeNull();
        expect(getGenerationJob(runningId, 'alice')).not.toBeNull();

        now.mockReturnValue(baseTime + 8 * 24 * 60 * 60_000);
        touchGenerationJob(runningId, 'alice');
        listGenerationRecoveries('alice');
        expect(getGenerationJob(unresolvedId, 'alice')).toBeNull();
        expect(getGenerationJob(runningId, 'alice')).not.toBeNull();
    });

    it('records complete SSE blocks and appends a terminal event', () => {
        const id = '33333333-3333-4333-8333-333333333333';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-3' });
        const response = new GenerationJobResponse(id, 'alice', true);

        response.write('data: {"choices":');
        response.write('[]}\n\n: heartbeat\n\n');
        response.ensureDoneEvent();

        expect(getGenerationEventsAfter(id, 'alice', 0).events.map(event => event.eventBlock)).toEqual([
            'data: {"choices":[]}',
            'data: [DONE]',
        ]);
    });

    it('converts an early streaming error response into replayable SSE', () => {
        const id = '44444444-4444-4444-8444-444444444444';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-4' });
        const response = new GenerationJobResponse(id, 'alice', true);

        response.status(400).send({ error: { message: 'Invalid request.' } });
        response.ensureDoneEvent();

        expect(response.failed).toBe(true);
        expect(getGenerationEventsAfter(id, 'alice', 0).events.map(event => event.eventBlock)).toEqual([
            'data: {"error":{"message":"Invalid request."}}',
            'data: [DONE]',
        ]);
    });
});
