import { EventEmitter } from 'node:events';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import {
    closeGenerationJobStore,
    createGenerationJob,
    markGenerationJobRunning,
} from '../src/generation-job-store.js';
import { GenerationJobResponse } from '../src/generation-job-response.js';
import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let streamGeneration;

class MockStreamResponse extends EventEmitter {
    constructor() {
        super();
        this.headers = new Map();
        this.flushed = false;
    }

    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), String(value));
        return this;
    }

    flushHeaders() {
        this.flushed = true;
        setTimeout(() => this.emit('close'), 0);
    }

    sendStatus(status) {
        throw new Error(`Unexpected status ${status}.`);
    }

    end() {
        this.emit('close');
    }

    write() {
        return true;
    }

    flush() {}
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
        expect(response.headers.get('x-st-messages-count')).toBe('12');
        expect(response.headers.get('x-st-first-included-message-id')).toBe('34');
    });
});
