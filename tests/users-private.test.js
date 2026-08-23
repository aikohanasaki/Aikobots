import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import storage from 'node-persist';

import { activeSessionStore } from '../src/active-session-store.js';
import { getPasswordHash, getPasswordSalt, initUserStorage, setUserDataMiddleware, setUserSession, toKey } from '../src/users.js';

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'users-private-'));
const previousDataRoot = globalThis.DATA_ROOT;
const previousContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
const previousScaffoldRoot = globalThis.DEFAULT_SCAFFOLD_ROOT;
globalThis.DEFAULT_CONTENT_ROOT = dataRoot;
globalThis.DEFAULT_SCAFFOLD_ROOT = dataRoot;
const { router } = await import('../src/endpoints/users-private.js');
const { router: adminRouter } = await import('../src/endpoints/users-admin.js');

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

test('stale session epochs are cleared before a user is authenticated', async () => {
    const user = {
        handle: 'reset-user',
        name: 'Reset User',
        enabled: true,
        admin: false,
        password: '',
        salt: '',
        sessionEpoch: 'current-epoch',
    };
    await storage.setItem(toKey(user.handle), user);
    const request = {
        method: 'GET',
        path: '/',
        session: { handle: user.handle, sessionEpoch: 'stale-epoch' },
    };
    const response = { sendStatus: jest.fn() };
    const next = jest.fn();

    await setUserDataMiddleware(request, response, next);

    expect(request.session).toBeNull();
    expect(request.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.sendStatus).not.toHaveBeenCalled();
});

test('new logins copy the current user session epoch', () => {
    const request = { session: {} };
    const user = { handle: 'reset-user', sessionEpoch: 'current-epoch' };

    setUserSession(request, user);

    expect(request.session).toEqual({ handle: user.handle, sessionEpoch: user.sessionEpoch });
});

test('legacy sessions remain valid until an admin rotates the user epoch', async () => {
    const user = {
        handle: 'legacy-session-user',
        name: 'Legacy Session User',
        enabled: true,
        admin: false,
        password: '',
        salt: '',
    };
    await storage.setItem(toKey(user.handle), user);
    const request = {
        method: 'GET',
        path: '/api/users/me',
        session: { handle: user.handle },
    };
    const response = { sendStatus: jest.fn() };
    const next = jest.fn();

    await setUserDataMiddleware(request, response, next);

    expect(request.user.profile).toMatchObject({ handle: user.handle });
    expect(request.session).not.toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
});

test('admin session reset rotates the login epoch and clears the active-tab lease', async () => {
    const user = {
        handle: 'admin-reset-user',
        name: 'Admin Reset User',
        enabled: true,
        admin: false,
        password: '',
        salt: '',
    };
    await storage.setItem(toKey(user.handle), user);
    const tabSessionId = '33333333-3333-4333-8333-333333333333';
    await activeSessionStore.takeOver(user.handle, tabSessionId, {});
    const request = {
        body: { handle: user.handle },
        user: { profile: { handle: 'admin-user', admin: true } },
    };
    const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        sendStatus: jest.fn().mockReturnThis(),
    };
    const handler = adminRouter.stack.find(layer => layer.route?.path === '/reset-session').route.stack.at(-1).handle;

    await handler(request, response);

    expect(response.sendStatus).toHaveBeenCalledWith(204);
    expect((await storage.getItem(toKey(user.handle))).sessionEpoch).toEqual(expect.any(String));
    expect((await activeSessionStore.getStatus(user.handle, tabSessionId)).hasActiveSession).toBe(false);
});
