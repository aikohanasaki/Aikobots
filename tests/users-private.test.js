import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import storage from 'node-persist';

import { getPasswordHash, getPasswordSalt, initUserStorage, toKey } from '../src/users.js';

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'users-private-'));
const previousDataRoot = globalThis.DATA_ROOT;
const previousContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
const previousScaffoldRoot = globalThis.DEFAULT_SCAFFOLD_ROOT;
globalThis.DEFAULT_CONTENT_ROOT = dataRoot;
globalThis.DEFAULT_SCAFFOLD_ROOT = dataRoot;
const { router } = await import('../src/endpoints/users-private.js');

beforeAll(async () => {
    globalThis.DATA_ROOT = dataRoot;
    await initUserStorage(dataRoot);
});

afterAll(async () => {
    globalThis.DATA_ROOT = previousDataRoot;
    globalThis.DEFAULT_CONTENT_ROOT = previousContentRoot;
    globalThis.DEFAULT_SCAFFOLD_ROOT = previousScaffoldRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('change-password returns forbidden without changing a disabled account', async () => {
    const salt = getPasswordSalt();
    const user = {
        handle: 'disabled-user',
        name: 'Disabled User',
        enabled: false,
        admin: false,
        password: getPasswordHash('current-password', salt),
        salt,
    };
    await storage.setItem(toKey(user.handle), user);

    const request = {
        body: {
            handle: user.handle,
            oldPassword: 'wrong-password',
            newPassword: 'replacement-password',
        },
        user: { profile: { handle: user.handle, admin: false } },
    };
    const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        sendStatus: jest.fn().mockReturnThis(),
    };
    const handler = router.stack.find(layer => layer.route?.path === '/change-password').route.stack[0].handle;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => { });

    try {
        await handler(request, response);
    } finally {
        consoleError.mockRestore();
    }

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: 'User is disabled' });
    expect(response.sendStatus).not.toHaveBeenCalled();
    expect(await storage.getItem(toKey(user.handle))).toEqual(user);
});
