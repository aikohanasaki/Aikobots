import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    appendGenerationEvent,
    closeGenerationJobStore,
    createGenerationJob,
    finishGenerationJob,
    getGenerationEventsAfter,
    getGenerationJob,
    markGenerationJobRunning,
    requestGenerationCancellation,
} from '../src/generation-job-store.js';
import { GenerationJobResponse } from '../src/generation-job-response.js';

describe('generation job store', () => {
    let dataRoot;
    let previousDataRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        dataRoot = mkdtempSync(join(tmpdir(), 'aikobots-generation-jobs-'));
        globalThis.DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        closeGenerationJobStore();
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
        const databaseBytes = readFileSync(join(dataRoot, '_generation-jobs', 'jobs.sqlite'));
        expect(databaseBytes.includes(Buffer.from('secret prompt text'))).toBe(false);
    });

    it('makes a cancellation order win the completion transition', () => {
        const id = '22222222-2222-4222-8222-222222222222';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-2' });
        markGenerationJobRunning(id, 'alice');
        requestGenerationCancellation(id, 'alice');

        expect(finishGenerationJob(id, 'alice', 'completed').state).toBe('cancel_requested');
        expect(finishGenerationJob(id, 'alice', 'cancelled').state).toBe('cancelled');
    });

    it('cancels an unclaimed queued job without requiring an owning worker', () => {
        const id = '55555555-5555-4555-8555-555555555555';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-5' });

        expect(requestGenerationCancellation(id, 'alice').state).toBe('cancelled');
        expect(markGenerationJobRunning(id, 'alice').claimed).toBe(false);
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
