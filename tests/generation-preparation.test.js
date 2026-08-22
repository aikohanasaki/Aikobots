import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { closeGenerationJobStore, getGenerationJob } from '../src/generation-job-store.js';
import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let createGeneration;
let normalizeGenerationPreparation;

function makePreparation() {
    return {
        version: 1,
        nonce: '11111111-1111-4111-8111-111111111111',
        source: {
            generationType: 'normal',
            expectedRevision: 3,
            anchorMessageUuid: '22222222-2222-4222-8222-222222222222',
            chatRef: { type: 'group', chatId: 'missing-chat.sqlite' },
        },
        provider_request: { stream: true, model: 'test-model' },
        prompt_context: { coreChat: [], messages: [], worldInfoRequest: {} },
    };
}

class MockResponse {
    statusCode = 200;
    body = null;
    headers = new Map();

    status(value) {
        this.statusCode = value;
        return this;
    }

    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), String(value));
    }

    send(value) {
        this.body = value;
        return this;
    }
}

beforeAll(async () => {
    const module = await import('../src/endpoints/backends/chat-completions.js');
    normalizeGenerationPreparation = module.normalizeGenerationPreparation;
    createGeneration = module.router.stack.find(layer =>
        layer.route?.path === '/generations'
        && layer.route.methods?.post,
    ).route.stack[0].handle;
});

describe('server-first generation preparation', () => {
    let dataRoot;
    let previousDataRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        dataRoot = mkdtempSync(join(tmpdir(), 'aikobots-generation-preparation-'));
        globalThis.DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        closeGenerationJobStore();
        globalThis.DATA_ROOT = previousDataRoot;
        rmSync(dataRoot, { recursive: true, force: true });
    });

    it('rejects prepared chat and lorebook content', () => {
        const withChat = makePreparation();
        withChat.prompt_context.coreChat.push({ mes: 'must not cross this boundary' });
        expect(() => normalizeGenerationPreparation(withChat)).toThrow('Chat or resolved lorebook content');

        const withLorebook = makePreparation();
        withLorebook.prompt_context.worldInfoRequest.sortedEntries = [{ content: 'must remain server-side' }];
        expect(() => normalizeGenerationPreparation(withLorebook)).toThrow('Chat or resolved lorebook content');
    });

    it('rejects the removed prepared-request contract', async () => {
        const response = new MockResponse();
        await createGeneration({
            body: {
                generation_id: '33333333-3333-4333-8333-333333333333',
                request: { stream: true, messages: [] },
            },
            user: { profile: { handle: 'alice' }, directories: {} },
        }, response);
        expect(response.statusCode).toBe(400);
        expect(response.body.error.code).toBe('invalid_generation_preparation');
    });

    it('admits the job before source snapshot preparation finishes', async () => {
        const id = '44444444-4444-4444-8444-444444444444';
        const response = new MockResponse();
        await createGeneration({
            body: { generation_id: id, preparation: makePreparation(), recovery: null },
            requestId: 'server-first-request',
            user: {
                profile: { handle: 'alice', admin: true },
                directories: {
                    chats: join(dataRoot, 'chats'),
                    groupChats: join(dataRoot, 'group chats'),
                    files: join(dataRoot, 'files'),
                    extensions: join(dataRoot, 'extensions'),
                },
            },
        }, response);

        expect(response.statusCode).toBe(202);
        expect(response.body).toMatchObject({ id, state: 'queued' });

        for (let attempt = 0; attempt < 20 && getGenerationJob(id, 'alice')?.state === 'queued'; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(getGenerationJob(id, 'alice')?.state).toBe('failed');
    });
});
