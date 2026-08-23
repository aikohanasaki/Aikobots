import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import {
    appendGenerationEvent,
    claimScheduledGenerationJob,
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

    function claimFromChildProcess(id, userHandle, limits) {
        const moduleUrl = pathToFileURL(join(process.cwd(), 'src', 'generation-job-store.js')).href;
        const source = `
            globalThis.DATA_ROOT = process.env.AIKOBOTS_TEST_DATA_ROOT;
            const store = await import(${JSON.stringify(moduleUrl)});
            const result = store.claimScheduledGenerationJob(
                process.env.AIKOBOTS_TEST_JOB_ID,
                process.env.AIKOBOTS_TEST_USER,
                JSON.parse(process.env.AIKOBOTS_TEST_LIMITS),
            );
            store.closeGenerationJobStore();
            process.stdout.write(JSON.stringify(result));
        `;
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
                env: {
                    ...process.env,
                    AIKOBOTS_TEST_DATA_ROOT: dataRoot,
                    AIKOBOTS_TEST_JOB_ID: id,
                    AIKOBOTS_TEST_USER: userHandle,
                    AIKOBOTS_TEST_LIMITS: JSON.stringify(limits),
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            let errorOutput = '';
            child.stdout.on('data', chunk => { output += chunk; });
            child.stderr.on('data', chunk => { errorOutput += chunk; });
            child.on('error', reject);
            child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errorOutput)));
        });
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
                chatIdentity: { groupId: '', characterId: '2', characterAvatar: 'alice.png', chatId: 'chat-1' },
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
            resolvedAt: null,
        }));
        expect(appendGenerationEvent(id, 'alice', 'data: late')).toBeNull();
        expect(listGenerationRecoveries('alice')).toEqual([expect.objectContaining({ id, state: 'failed' })]);
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
                chatIdentity: { groupId: '', characterId: '2', characterAvatar: 'alice.png', chatId: 'chat-1' },
                anchorMessageUuid: '77777777-7777-4777-8777-777777777777',
                outputMessageUuid: '88888888-8888-4888-8888-888888888888',
                createdAt: now,
                startedAt: now,
                stream: false,
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
                recovery: expect.objectContaining({ stream: false }),
                resolvedAt: null,
            }),
        ]);
        expect(listGenerationRecoveries('alice')[0].recovery).not.toHaveProperty('prompt');
        expect(listGenerationRecoveries('alice')[0].recovery.chatIdentity.characterAvatar).toBe('alice.png');
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

    it('keeps failed recovery records visible until the user acknowledges them', () => {
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

        expect(finishGenerationJob(id, 'alice', 'failed').resolvedAt).toBeNull();
        expect(listGenerationRecoveries('alice')).toEqual([expect.objectContaining({ id, state: 'failed' })]);
        resolveGenerationRecovery(id, 'alice');
        expect(listGenerationRecoveries('alice')).toEqual([]);
    });

    it('reserves capacity for first generations and dynamically promotes a user second job', () => {
        const limits = {
            maxConcurrentGlobal: 2,
            reservedFirstGenerationSlots: 1,
            secondaryPriorityAgeMs: 60_000,
        };
        jest.spyOn(Date, 'now').mockReturnValue(10);
        const aliceFirst = '01010101-0101-4101-8101-010101010101';
        const aliceSecond = '02020202-0202-4202-8202-020202020202';
        const bobFirst = '03030303-0303-4303-8303-030303030303';
        createGenerationJob({ id: aliceFirst, userHandle: 'alice', requestFingerprint: 'a1', requestId: 'a1' });
        Date.now.mockReturnValue(20);
        createGenerationJob({ id: aliceSecond, userHandle: 'alice', requestFingerprint: 'a2', requestId: 'a2' });
        Date.now.mockReturnValue(30);
        createGenerationJob({ id: bobFirst, userHandle: 'bob', requestFingerprint: 'b1', requestId: 'b1' });

        expect(claimScheduledGenerationJob(aliceFirst, 'alice', limits)).toEqual(expect.objectContaining({ claimed: true }));
        expect(getGenerationJob(aliceFirst, 'alice').slotType).toBe('reserved');
        expect(claimScheduledGenerationJob(aliceSecond, 'alice', limits).claimed).toBe(false);
        expect(claimScheduledGenerationJob(bobFirst, 'bob', limits).claimed).toBe(true);
        expect(getGenerationJob(bobFirst, 'bob').slotType).toBe('general');

        finishGenerationJob(aliceFirst, 'alice', 'completed');
        expect(claimScheduledGenerationJob(aliceSecond, 'alice', limits).claimed).toBe(true);
        expect(getGenerationJob(aliceSecond, 'alice').slotType).toBe('reserved');
    });

    it('ages a waiting second generation into normal general-pool FIFO priority', () => {
        const limits = {
            maxConcurrentPerUser: 2,
            maxConcurrentGlobal: 2,
            reservedFirstGenerationSlots: 0,
            secondaryPriorityAgeMs: 50,
        };
        jest.spyOn(Date, 'now').mockReturnValue(10);
        const aliceFirst = '04040404-0404-4404-8404-040404040404';
        const aliceSecond = '05050505-0505-4505-8505-050505050505';
        const bobFirst = '06060606-0606-4606-8606-060606060606';
        createGenerationJob({ id: aliceFirst, userHandle: 'alice', requestFingerprint: 'a1', requestId: 'a1' });
        markGenerationJobRunning(aliceFirst, 'alice');
        Date.now.mockReturnValue(20);
        createGenerationJob({ id: aliceSecond, userHandle: 'alice', requestFingerprint: 'a2', requestId: 'a2' });
        Date.now.mockReturnValue(30);
        createGenerationJob({ id: bobFirst, userHandle: 'bob', requestFingerprint: 'b1', requestId: 'b1' });
        Date.now.mockReturnValue(100);

        expect(claimScheduledGenerationJob(aliceSecond, 'alice', limits).claimed).toBe(true);
        expect(claimScheduledGenerationJob(bobFirst, 'bob', limits).claimed).toBe(false);
    });

    it('applies admission caps after resolving an idempotent retry', () => {
        const first = '07070707-0707-4707-8707-070707070707';
        const second = '08080808-0808-4808-8808-080808080808';
        const limits = { maxConcurrentPerUser: 1, maxQueuedPerUser: 0, maxQueuedGlobal: 10 };
        const initial = createGenerationJob({ id: first, userHandle: 'alice', requestFingerprint: 'same', requestId: 'same', limits });
        expect(initial.created).toBe(true);
        expect(createGenerationJob({ id: first, userHandle: 'alice', requestFingerprint: 'same', requestId: 'same', limits }).created).toBe(false);
        let admissionError;
        try {
            createGenerationJob({ id: second, userHandle: 'alice', requestFingerprint: 'second', requestId: 'second', limits });
        } catch (error) {
            admissionError = error;
        }
        expect(admissionError).toMatchObject({ status: 429, code: 'generation_user_limit_reached' });
    });

    it('separates per-user running capacity from waiting capacity', () => {
        const limits = {
            maxConcurrentPerUser: 1,
            maxQueuedPerUser: 2,
            maxConcurrentGlobal: 4,
            reservedFirstGenerationSlots: 0,
            maxQueuedGlobal: 10,
            secondaryPriorityAgeMs: 60_000,
        };
        const ids = [
            '09090909-0909-4909-8909-090909090909',
            '10101010-1010-4010-8010-101010101010',
            '11111111-1111-4111-8111-111111111111',
        ];
        for (const [index, id] of ids.entries()) {
            createGenerationJob({
                id,
                userHandle: 'alice',
                requestFingerprint: `alice-${index}`,
                requestId: `alice-${index}`,
                limits,
            });
        }

        expect(claimScheduledGenerationJob(ids[0], 'alice', limits).claimed).toBe(true);
        expect(claimScheduledGenerationJob(ids[1], 'alice', limits).claimed).toBe(false);
        expect(claimScheduledGenerationJob(ids[2], 'alice', limits).claimed).toBe(false);
        expect(() => createGenerationJob({
            id: '12121212-1212-4212-8212-121212121212',
            userHandle: 'alice',
            requestFingerprint: 'alice-3',
            requestId: 'alice-3',
            limits,
        })).toThrow(expect.objectContaining({ status: 429, code: 'generation_user_limit_reached' }));

        finishGenerationJob(ids[0], 'alice', 'completed');
        expect(claimScheduledGenerationJob(ids[1], 'alice', limits).claimed).toBe(true);
    });

    it('rejects global queue saturation with a retryable service error', () => {
        const limits = { maxConcurrentPerUser: 2, maxQueuedGlobal: 1 };
        createGenerationJob({
            id: '18181818-1818-4181-8181-181818181818',
            userHandle: 'alice',
            requestFingerprint: 'alice',
            requestId: 'alice',
            limits,
        });
        let admissionError;
        try {
            createGenerationJob({
                id: '19191919-1919-4191-8191-191919191919',
                userHandle: 'bob',
                requestFingerprint: 'bob',
                requestId: 'bob',
                limits,
            });
        } catch (error) {
            admissionError = error;
        }
        expect(admissionError).toMatchObject({ status: 503, code: 'generation_queue_full' });
    });

    it('releases scheduling capacity after cancellation and stale owner failure', () => {
        const limits = {
            maxConcurrentGlobal: 1,
            reservedFirstGenerationSlots: 0,
            secondaryPriorityAgeMs: 60_000,
            staleOwnerMs: 50,
        };
        const alice = '20202020-2020-4202-8202-202020202020';
        const bob = '21212121-2121-4212-8212-212121212121';
        const carol = '23232323-2323-4232-8232-232323232323';
        jest.spyOn(Date, 'now').mockReturnValue(10);
        createGenerationJob({ id: alice, userHandle: 'alice', requestFingerprint: 'a', requestId: 'a' });
        expect(claimScheduledGenerationJob(alice, 'alice', limits).claimed).toBe(true);
        Date.now.mockReturnValue(20);
        createGenerationJob({ id: bob, userHandle: 'bob', requestFingerprint: 'b', requestId: 'b' });
        requestGenerationCancellation(alice, 'alice');
        expect(claimScheduledGenerationJob(bob, 'bob', limits).claimed).toBe(false);
        finishGenerationJob(alice, 'alice', 'cancelled');
        expect(claimScheduledGenerationJob(bob, 'bob', limits).claimed).toBe(true);

        Date.now.mockReturnValue(30);
        createGenerationJob({ id: carol, userHandle: 'carol', requestFingerprint: 'c', requestId: 'c' });
        Date.now.mockReturnValue(100);
        touchGenerationJob(carol, 'carol');
        expect(claimScheduledGenerationJob(carol, 'carol', limits).claimed).toBe(true);
        expect(getGenerationJob(bob, 'bob').state).toBe('failed');
    });

    it('allows only one atomic winner when separate Node processes claim one shared slot', async () => {
        const alice = '24242424-2424-4242-8242-242424242424';
        const bob = '25252525-2525-4252-8252-252525252525';
        const limits = {
            maxConcurrentGlobal: 1,
            reservedFirstGenerationSlots: 0,
            secondaryPriorityAgeMs: 60_000,
            staleOwnerMs: 45_000,
        };
        createGenerationJob({ id: alice, userHandle: 'alice', requestFingerprint: 'alice', requestId: 'alice' });
        createGenerationJob({ id: bob, userHandle: 'bob', requestFingerprint: 'bob', requestId: 'bob' });
        closeGenerationJobStore();

        const results = await Promise.all([
            claimFromChildProcess(alice, 'alice', limits),
            claimFromChildProcess(bob, 'bob', limits),
        ]);
        expect(results.map(result => result.claimed).sort()).toEqual([false, true]);
        expect([getGenerationJob(alice, 'alice'), getGenerationJob(bob, 'bob')]
            .filter(job => job.state === 'running')).toHaveLength(1);
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
