import { EventEmitter } from 'node:events';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    appendGenerationEvent,
    closeGenerationJobStore,
    createGenerationJob,
    finishGenerationJob,
    markGenerationJobRunning,
    setGenerationJobResponseHeaders,
} from '../src/generation-job-store.js';
import { GenerationJobResponse } from '../src/generation-job-response.js';
import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let streamGeneration;

class MockStreamResponse extends EventEmitter {
    constructor({ closeOnHeaders = true } = {}) {
        super();
        this.headers = new Map();
        this.flushed = false;
        this.closeOnHeaders = closeOnHeaders;
        this.bodyFlushes = 0;
        this.writes = [];
        this.ended = false;
    }

    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), String(value));
        return this;
    }

    flushHeaders() {
        this.flushed = true;
        if (this.closeOnHeaders) {
            setTimeout(() => this.emit('close'), 0);
        }
    }

    sendStatus(status) {
        throw new Error(`Unexpected status ${status}.`);
    }

    end() {
        this.ended = true;
        this.emit('close');
    }

    write(chunk) {
        this.writes.push(String(chunk));
        return true;
    }

    flush() {
        this.bodyFlushes++;
    }
}

beforeAll(async () => {
    const { router } = await import('../src/endpoints/backends/chat-completions.js');
    streamGeneration = router.stack.find(layer =>
        layer.route?.path === '/generations/:id/stream'
        && layer.route.methods?.get,
    ).route.stack[0].handle;
});

describe('generation stream response headers', () => {
    let dataRoot;
    let previousDataRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        dataRoot = mkdtempSync(join(tmpdir(), 'aikobots-generation-stream-'));
        globalThis.DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        closeGenerationJobStore();
        globalThis.DATA_ROOT = previousDataRoot;
        rmSync(dataRoot, { recursive: true, force: true });
    });

    it('waits for persisted assembly metadata before flushing the replay response', async () => {
        const id = '12121212-1212-4121-8121-121212121212';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-ready' });
        markGenerationJobRunning(id, 'alice');
        const response = new MockStreamResponse();
        const request = {
            params: { id },
            user: { profile: { handle: 'alice' } },
            query: {},
            get: () => '',
        };

        const pendingStream = streamGeneration(request, response);
        expect(response.flushed).toBe(false);

        const sink = new GenerationJobResponse(id, 'alice', true);
        sink.setHeader('X-Request-Id', 'request-ready');
        sink.setHeader('X-ST-Messages-Count', '12');
        sink.setHeader('X-ST-First-Included-Message-Id', '34');
        sink.flushHeaders();
        await pendingStream;

        expect(response.flushed).toBe(true);
        expect(response.ended).toBe(false);
        expect(response.headers.get('x-st-messages-count')).toBe('12');
        expect(response.headers.get('x-st-first-included-message-id')).toBe('34');
    });

    it('flushes replayed events before ending a completed stream', async () => {
        const id = '23232323-2323-4232-8232-232323232323';
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-event' });
        markGenerationJobRunning(id, 'alice');
        setGenerationJobResponseHeaders(id, 'alice', { 'x-request-id': 'request-event' });
        appendGenerationEvent(id, 'alice', 'data: token');
        finishGenerationJob(id, 'alice', 'completed');
        const response = new MockStreamResponse({ closeOnHeaders: false });
        const request = {
            params: { id },
            user: { profile: { handle: 'alice' } },
            query: {},
            get: () => '',
        };

        await streamGeneration(request, response);

        expect(response.writes).toEqual(['id: 1\ndata: token\n\n']);
        expect(response.bodyFlushes).toBe(1);
        expect(response.ended).toBe(true);
    });

    it('ends a stale generation while waiting for response headers', async () => {
        const id = '34343434-3434-4343-8343-343434343434';
        jest.spyOn(Date, 'now').mockReturnValue(1);
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-stale-headers' });
        markGenerationJobRunning(id, 'alice');
        Date.now.mockReturnValue(60_000);
        const response = new MockStreamResponse({ closeOnHeaders: false });
        const request = {
            params: { id },
            user: { profile: { handle: 'alice' } },
            query: {},
            get: () => '',
        };

        await streamGeneration(request, response);

        expect(response.flushed).toBe(false);
        expect(response.ended).toBe(true);
    });

    it('ends a stale generation after response headers are available', async () => {
        const id = '45454545-4545-4454-8454-454545454545';
        jest.spyOn(Date, 'now').mockReturnValue(1);
        createGenerationJob({ id, userHandle: 'alice', requestFingerprint: 'hash', requestId: 'request-stale-events' });
        markGenerationJobRunning(id, 'alice');
        setGenerationJobResponseHeaders(id, 'alice', { 'x-request-id': 'request-stale-events' });
        Date.now.mockReturnValue(60_000);
        const response = new MockStreamResponse({ closeOnHeaders: false });
        const request = {
            params: { id },
            user: { profile: { handle: 'alice' } },
            query: {},
            get: () => '',
        };

        await streamGeneration(request, response);

        expect(response.flushed).toBe(true);
        expect(response.ended).toBe(true);
    });
});
