import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let requireGenerationUserHandle;

beforeAll(async () => {
    const { router } = await import('../src/endpoints/backends/chat-completions.js');
    requireGenerationUserHandle = router.stack.find(layer =>
        layer.handle?.name === 'requireGenerationUserHandle',
    ).handle;
});

describe('generation user ownership', () => {
    it('rejects a generation request without a user handle', () => {
        const request = { user: { profile: {} } };
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

    it('allows a generation request with a user handle', () => {
        const next = jest.fn();

        requireGenerationUserHandle({ user: { profile: { handle: 'alice' } } }, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
    });
});
