import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { closeGenerationJobStore, getGenerationJob, requestGenerationCancellation } from '../src/generation-job-store.js';
import { setConfigFilePath } from '../src/util.js';
import { loadDb, setMessages } from '../src/sqlite-manager.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let createGeneration;
let normalizeGenerationPreparation;
let admitGenerationSnapshot;

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
    admitGenerationSnapshot = module.admitGenerationSnapshot;
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

    it('rejects an unavailable source before creating a job', async () => {
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

        expect(response.statusCode).toBe(409);
        expect(response.body.error).toMatchObject({ code: 'generation_source_unavailable', request_id: 'server-first-request' });
        expect(getGenerationJob(id, 'alice')).toBeNull();
    });

    async function makeSource() {
        const preparation = normalizeGenerationPreparation(makePreparation());
        const request = { user: { profile: { handle: 'alice', admin: true }, directories: { groupChats: join(dataRoot, 'groups') } } };
        const filePath = join(request.user.directories.groupChats, preparation.source.chatRef.chatId);
        const db = await loadDb(filePath);
        setMessages(db, [{ is_group_chat_header: true, chat_metadata: {}, chat_revision: 3 }, { aikobots_message_uuid: preparation.source.anchorMessageUuid, mes: 'synthetic-source' }]);
        db.close();
        const options = {
            id: '55555555-5555-4555-8555-555555555555', userHandle: 'alice', requestId: 'snapshot-request',
            requestFingerprint: createHash('sha256').update(JSON.stringify({ version: preparation.version, nonce: preparation.nonce, source: preparation.source })).digest('hex'),
        };
        return { preparation, request, filePath, options };
    }

    it('captures one snapshot before admission and acknowledges a retry after the source changes', async () => {
        const { preparation, request, filePath, options } = await makeSource();
        const admitted = await admitGenerationSnapshot(request, preparation, options);
        expect(admitted.created).toBe(true);
        expect(admitted.snapshot.messages.length).toBe(1);
        const db = await loadDb(filePath);
        setMessages(db, [{ is_group_chat_header: true, chat_metadata: {}, chat_revision: 4 }, { aikobots_message_uuid: preparation.source.anchorMessageUuid, mes: 'later-edit' }]);
        db.close();
        expect(admitted.snapshot.messages[0].mes === 'synthetic-source').toBe(true);
        const replay = await admitGenerationSnapshot(request, preparation, options, { readSnapshot: () => { throw new Error('Must not recapture'); } });
        expect(replay.created).toBe(false);
        const response = new MockResponse();
        await createGeneration({ ...request, body: { generation_id: options.id, preparation: makePreparation() } }, response);
        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({ snapshot_admitted: true, accepted_revision: 3, request_id: 'snapshot-request' });
        await expect(admitGenerationSnapshot(request, preparation, { ...options, id: '66666666-6666-4666-8666-666666666666' }))
            .rejects.toMatchObject({ status: 409, code: 'generation_source_changed' });
    });

    it('concurrent admissions publish one job only after the snapshot completes', async () => {
        const { preparation, request, options } = await makeSource();
        let release;
        let entered;
        const pending = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { entered = resolve; });
        let snapshots = 0;
        const readSnapshot = async () => { snapshots++; entered(); await pending; return { messages: [], promptContext: {} }; };
        const first = admitGenerationSnapshot(request, preparation, options, { readSnapshot });
        await started;
        const second = admitGenerationSnapshot(request, preparation, options, { readSnapshot });
        expect(getGenerationJob(options.id, 'alice')).toBeNull();
        release();
        const results = await Promise.all([first, second]);
        expect(results.filter(result => result.created)).toHaveLength(1);
        expect(snapshots).toBe(1);
    });

    it('a cancellation arriving during source preparation prevents late job publication', async () => {
        const { preparation, request, options } = await makeSource();
        await expect(admitGenerationSnapshot(request, preparation, options, {
            readSnapshot: async () => {
                expect(requestGenerationCancellation(options.id, 'alice')).toMatchObject({ id: options.id, state: 'cancelled' });
                return { messages: [], promptContext: {} };
            },
        })).rejects.toMatchObject({ status: 409, code: 'generation_cancelled' });
        expect(getGenerationJob(options.id, 'alice')).toBeNull();
        await expect(admitGenerationSnapshot(request, preparation, options)).rejects.toMatchObject({ code: 'generation_cancelled' });
        const response = new MockResponse();
        await createGeneration({ ...request, body: { generation_id: options.id, preparation: makePreparation() } }, response);
        expect(response.statusCode).toBe(409);
        expect(response.body.error).toMatchObject({ code: 'generation_cancelled', message: 'Generation was cancelled.' });
        expect(getGenerationJob(options.id, 'alice')).toBeNull();
    });

    it('waits for another worker to finish a save and rejects its newer revision', async () => {
        const { preparation, request, options, filePath } = await makeSource();
        const storageUrl = pathToFileURL(path.resolve('src/chat-storage.js')).href;
        const sqliteUrl = pathToFileURL(path.resolve('src/sqlite-manager.js')).href;
        const child = spawn(process.execPath, ['--input-type=module', '--eval', `
            const { withChatSaveLock } = await import(${JSON.stringify(storageUrl)});
            const { loadDb, getMessages, setMessages } = await import(${JSON.stringify(sqliteUrl)});
            await withChatSaveLock(process.env.TEST_CHAT_PATH, async () => {
                const release = new Promise(resolve => process.stdin.once('data', resolve));
                process.stdout.write('locked');
                await release;
                const db = await loadDb(process.env.TEST_CHAT_PATH);
                const messages = getMessages(db);
                messages[0].chat_revision++;
                setMessages(db, messages);
                db.close();
            });
            process.stdin.destroy();
        `], { env: { ...process.env, TEST_CHAT_PATH: filePath }, stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        const finished = new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
        });
        await Promise.race([new Promise(resolve => child.stdout.once('data', resolve)), finished.then(() => { throw new Error('Worker exited before locking'); })]);
        const admission = admitGenerationSnapshot(request, preparation, options);
        const rejected = expect(admission).rejects.toMatchObject({ status: 409, code: 'generation_source_changed' });
        expect(getGenerationJob(options.id, 'alice')).toBeNull();
        child.stdin.write('release');
        await Promise.all([finished, rejected]);
        expect(getGenerationJob(options.id, 'alice')).toBeNull();
    });

    it('another worker replays admission without reading or owning the sensitive snapshot', async () => {
        const { preparation, request, options } = await makeSource();
        await admitGenerationSnapshot(request, preparation, options);
        const endpointUrl = pathToFileURL(path.resolve('src/endpoints/backends/chat-completions.js')).href;
        const utilUrl = pathToFileURL(path.resolve('src/util.js')).href;
        const storeUrl = pathToFileURL(path.resolve('src/generation-job-store.js')).href;
        const child = spawn(process.execPath, ['--input-type=module', '--eval', `
            globalThis.DATA_ROOT = process.env.TEST_DATA_ROOT;
            const { setConfigFilePath } = await import(${JSON.stringify(utilUrl)});
            setConfigFilePath(${JSON.stringify(CONFIG_PATH)});
            const { admitGenerationSnapshot } = await import(${JSON.stringify(endpointUrl)});
            const result = await admitGenerationSnapshot({}, {}, JSON.parse(process.env.TEST_JOB_OPTIONS), {
                readSnapshot() { throw new Error('Replay must not read the source'); },
            });
            const { closeGenerationJobStore } = await import(${JSON.stringify(storeUrl)});
            closeGenerationJobStore();
            process.stdout.write(JSON.stringify({ created: result.created, snapshotPresent: Boolean(result.snapshot) }));
        `], { env: { ...process.env, TEST_DATA_ROOT: dataRoot, TEST_JOB_OPTIONS: JSON.stringify(options) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let stderr = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
        });
        expect(JSON.parse(output)).toEqual({ created: false, snapshotPresent: false });
    });

    it.each([
        ['generation_cancelled', 409, 'Generation was cancelled.'],
        ['generation_user_limit_reached', 429, 'Your generation queue is full. Wait for an existing generation to finish and try again.'],
        ['generation_queue_full', 503, 'The generation queue is full. Please try again later.'],
    ])('preserves %s with a fixed content-free message', async (code, status, message) => {
        const response = new MockResponse();
        await createGeneration({
            body: { generation_id: '33333333-3333-4333-8333-333333333333' },
            activeSessionOperation: { assertAllowed: () => { throw Object.assign(new Error('synthetic-sensitive-error'), { code, status }); } },
        }, response);
        expect(response.statusCode).toBe(status);
        expect(response.body.error).toMatchObject({ code, message, stage: 'generation_admission' });
        expect(JSON.stringify(response.body)).not.toContain('synthetic-sensitive-error');
        if (status === 503) expect(response.headers.get('retry-after')).toBe('1');
    });

    it('rejects mismatched retry ownership and returns content-free admission errors', async () => {
        const { preparation, request, options } = await makeSource();
        await admitGenerationSnapshot(request, preparation, options);
        await expect(admitGenerationSnapshot(request, preparation, { ...options, userHandle: 'bob' })).rejects.toMatchObject({ status: 409 });
        await expect(admitGenerationSnapshot(request, preparation, { ...options, requestFingerprint: 'different' })).rejects.toMatchObject({ status: 409 });
        const response = new MockResponse();
        await createGeneration({ ...request, activeSessionOperation: { assertAllowed: () => { throw Object.assign(new Error('synthetic-sensitive-error'), { status: 503 }); } }, body: { generation_id: options.id, preparation: makePreparation() } }, response);
        expect(response.statusCode).toBe(503);
        expect(JSON.stringify(response.body).includes('synthetic-sensitive-error')).toBe(false);
        expect(response.body.error.code).toBe('generation_admission_failed');
    });
});
