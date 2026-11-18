import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { closeGenerationJobStore, createGenerationJob, getGenerationJob } from '../src/generation-job-store.js';

import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let requireGenerationUserHandle;
let getGenerationJobLimits;
let getDetachedGenerationClaimDelay;
let generationRouter;

beforeAll(async () => {
    const module = await import('../src/endpoints/backends/chat-completions.js');
    const { router } = module;
    generationRouter = router;
    getGenerationJobLimits = module.getGenerationJobLimits;
    getDetachedGenerationClaimDelay = module.getDetachedGenerationClaimDelay;
    requireGenerationUserHandle = router.stack.find(layer =>
        layer.handle?.name === 'requireGenerationUserHandle',
    ).handle;
});

describe('generation user ownership', () => {
    it('lists and cancels only the authenticated account jobs, ignoring client ownership claims', async () => {
        const previousRoot = globalThis.DATA_ROOT;
        const root = fs.mkdtempSync(path.join(tmpdir(), 'generation-account-test-'));
        globalThis.DATA_ROOT = root;
        const own = '11111111-1111-4111-8111-111111111111';
        const other = '22222222-2222-4222-8222-222222222222';
        const request = { user: { profile: { handle: 'alice' } }, query: { userHandle: 'bob' }, body: { userHandle: 'bob' }, params: { id: own } };
        const response = { setHeader: jest.fn(), send: jest.fn(), status: jest.fn().mockReturnThis() };
        const route = (url, method) => generationRouter.stack.find(layer => layer.route?.path === url && layer.route.methods[method]).route.stack[0].handle;
        try {
            createGenerationJob({ id: own, userHandle: 'alice', requestFingerprint: 'synthetic' });
            createGenerationJob({ id: other, userHandle: 'bob', requestFingerprint: 'synthetic' });
            route('/generations/active', 'get')(request, response);
            const payload = response.send.mock.calls[0][0];
            expect(payload.jobs).toEqual([{ id: own, state: 'queued', createdAt: expect.any(Number), updatedAt: expect.any(Number) }]);
            expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
            expect(payload.limits.outstanding).toBeGreaterThanOrEqual(payload.limits.concurrent);
            await route('/generations/:id/cancel', 'post')(request, response);
            expect(getGenerationJob(own, 'alice').state).toBe('cancelled');
            expect(getGenerationJob(other, 'bob').state).toBe('queued');
            request.params.id = other;
            await route('/generations/:id/cancel', 'post')(request, response);
            expect(getGenerationJob(other, 'bob').state).toBe('queued');
        } finally {
            closeGenerationJobStore();
            globalThis.DATA_ROOT = previousRoot;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a client-claimed handle without a server-authenticated handle', () => {
        const request = {
            body: { userHandle: 'alice' },
            user: { profile: {} },
        };
        const response = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        requireGenerationUserHandle(request, response, next);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.send).toHaveBeenCalledWith({
            error: { message: 'Generation jobs require an authenticated user handle.' },
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('allows a generation request with a server-authenticated user handle', () => {
        const next = jest.fn();

        requireGenerationUserHandle({ user: { profile: { handle: 'alice' } } }, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('uses one slot for standard users and configured slots for entitled accounts', () => {
        const readConfig = (key, fallback) => ({
            enableUserAccounts: true,
            'generationJobs.maxConcurrentPerUser': 3,
            'generationJobs.maxQueuedPerUser': 4,
        })[key] ?? fallback;

        expect(getGenerationJobLimits({ user: { profile: { handle: 'standard' } } }, readConfig).maxConcurrentPerUser).toBe(1);
        expect(getGenerationJobLimits({ user: { profile: { handle: 'patron', patron: true } } }, readConfig).maxConcurrentPerUser).toBe(3);
        expect(getGenerationJobLimits({ user: { profile: { handle: 'admin', admin: true } } }, readConfig).maxConcurrentPerUser).toBe(3);
        expect(getGenerationJobLimits({ user: { profile: { handle: 'standard' } } }, readConfig).maxQueuedPerUser).toBe(4);
        for (const profile of [{}, { patron: true }, { admin: true }]) {
            expect(getGenerationJobLimits({ user: { profile } }, readConfig).patronConcurrentLimit).toBe(3);
        }
    });

    it('entitles accounts-disabled local installations without requiring PM2', () => {
        const readConfig = (key, fallback) => ({
            enableUserAccounts: false,
            'generationJobs.maxConcurrentPerUser': 2,
        })[key] ?? fallback;

        expect(getGenerationJobLimits({ user: { profile: { handle: 'default-user' } } }, readConfig).maxConcurrentPerUser).toBe(2);
    });

    it('backs off failed generation claims with bounded jitter', () => {
        expect([0, 1, 2, 20].map(attempt => getDetachedGenerationClaimDelay(attempt, () => 0)))
            .toEqual([250, 400, 800, 800]);
        expect([0, 1, 2, 20].map(attempt => getDetachedGenerationClaimDelay(attempt, () => 1)))
            .toEqual([250, 500, 1000, 1000]);
    });
});
