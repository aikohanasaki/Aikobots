import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { ACTIVE_SESSION_ERROR, activeSessionStore } from '../src/active-session-store.js';

const FIRST_TAB_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_TAB_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const USER_HANDLE = 'test-user';

async function readLeaseStore(root) {
    const storePath = path.join(root, '_active-session-leases', 'leases.json');
    return JSON.parse(await fsPromises.readFile(storePath, 'utf8'));
}

async function writeLeaseStore(root, store) {
    const storePath = path.join(root, '_active-session-leases', 'leases.json');
    await fsPromises.writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

describe('active session takeover', () => {
    let tempRoot = null;
    let previousDataRoot = null;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-active-session-'));
        globalThis.DATA_ROOT = tempRoot;
    });

    afterEach(() => {
        globalThis.DATA_ROOT = previousDataRoot;
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            tempRoot = null;
        }
    });

    it('replaces the active lease and cancels in-flight operations from older tab sessions', async () => {
        await activeSessionStore.takeOver(USER_HANDLE, FIRST_TAB_SESSION_ID, {});
        const operation = await activeSessionStore.beginOperation(USER_HANDLE, FIRST_TAB_SESSION_ID, 'POST /api/chats/save');

        const takeoverStatus = await activeSessionStore.takeOver(USER_HANDLE, SECOND_TAB_SESSION_ID, {});

        expect(takeoverStatus.active).toBe(true);
        await expect(activeSessionStore.heartbeat(USER_HANDLE, FIRST_TAB_SESSION_ID)).rejects.toMatchObject({
            code: ACTIVE_SESSION_ERROR,
            status: 423,
        });
        await expect(activeSessionStore.assertOperationAllowed(USER_HANDLE, FIRST_TAB_SESSION_ID, operation.operationId)).rejects.toMatchObject({
            code: ACTIVE_SESSION_ERROR,
            status: 423,
        });
        await expect(activeSessionStore.assertActive(USER_HANDLE, SECOND_TAB_SESSION_ID)).resolves.toBe(true);

        const store = await readLeaseStore(tempRoot);
        expect(store.operations[operation.operationId].cancelledAt).toEqual(expect.any(Number));
    });

    it('treats expired leases as unowned so the tab can reclaim them', async () => {
        await activeSessionStore.takeOver(USER_HANDLE, FIRST_TAB_SESSION_ID, {});

        const store = await readLeaseStore(tempRoot);
        const leaseKey = Object.keys(store.leases)[0];
        store.leases[leaseKey].expiresAt = Date.now() - 1;
        await writeLeaseStore(tempRoot, store);

        const expiredStatus = await activeSessionStore.heartbeat(USER_HANDLE, FIRST_TAB_SESSION_ID);
        expect(expiredStatus).toEqual({
            active: false,
            hasActiveSession: false,
            canTakeOver: true,
            lease: null,
            ttlMs: activeSessionStore.ttlMs,
        });

        const reclaimedStatus = await activeSessionStore.claim(USER_HANDLE, FIRST_TAB_SESSION_ID, {});
        expect(reclaimedStatus.active).toBe(true);
        expect(reclaimedStatus.hasActiveSession).toBe(true);
    });

    it('refreshes lease expiration on heartbeat', async () => {
        await activeSessionStore.takeOver(USER_HANDLE, FIRST_TAB_SESSION_ID, {});

        const store = await readLeaseStore(tempRoot);
        const leaseKey = Object.keys(store.leases)[0];
        store.leases[leaseKey].lastSeenAt = Date.now() - 10_000;
        store.leases[leaseKey].expiresAt = Date.now() + 10_000;
        await writeLeaseStore(tempRoot, store);

        const heartbeatStatus = await activeSessionStore.heartbeat(USER_HANDLE, FIRST_TAB_SESSION_ID);
        expect(heartbeatStatus.active).toBe(true);

        const refreshedStore = await readLeaseStore(tempRoot);
        expect(refreshedStore.leases[leaseKey].lastSeenAt).toBeGreaterThan(store.leases[leaseKey].lastSeenAt);
        expect(refreshedStore.leases[leaseKey].expiresAt).toBeGreaterThan(Date.now() + 100_000);
    });

    it('resets the active lease and cancels in-flight operations for a user', async () => {
        await activeSessionStore.takeOver(USER_HANDLE, FIRST_TAB_SESSION_ID, {});
        const operation = await activeSessionStore.beginOperation(USER_HANDLE, FIRST_TAB_SESSION_ID, 'POST /api/chats/save');

        const result = await activeSessionStore.resetUser(USER_HANDLE);

        expect(result).toEqual({ released: true, cancelled: 1 });
        await expect(activeSessionStore.assertActive(USER_HANDLE, FIRST_TAB_SESSION_ID)).rejects.toMatchObject({
            code: ACTIVE_SESSION_ERROR,
        });
        await expect(activeSessionStore.assertOperationAllowed(USER_HANDLE, FIRST_TAB_SESSION_ID, operation.operationId)).rejects.toMatchObject({
            code: ACTIVE_SESSION_ERROR,
        });
    });
});
