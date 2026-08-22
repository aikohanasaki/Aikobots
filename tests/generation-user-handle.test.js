import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let requireGenerationUserHandle;
let getGenerationJobLimits;
let getDetachedGenerationClaimDelay;

beforeAll(async () => {
    const module = await import('../src/endpoints/backends/chat-completions.js');
    const { router } = module;
    getGenerationJobLimits = module.getGenerationJobLimits;
    getDetachedGenerationClaimDelay = module.getDetachedGenerationClaimDelay;
    requireGenerationUserHandle = router.stack.find(layer =>
        layer.handle?.name === 'requireGenerationUserHandle',
    ).handle;
});

describe('generation user ownership', () => {
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
