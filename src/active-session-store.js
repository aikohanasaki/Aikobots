import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

import { withDirectoryLock } from './file-system-lock.js';

const LEASE_TTL_MS = 120_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 2_000;
const STORE_DIRECTORY_NAME = '_active-session-leases';
const STORE_FILE_NAME = 'leases.json';
const LOCK_DIRECTORY_NAME = 'leases.lock';
export const BROWSER_SESSION_HEADER = 'x-browser-session-id';
export const ACTIVE_SESSION_ERROR = 'active_session_required';
export const ACTIVE_SESSION_LOCK_MESSAGE = 'Aikobots is open in another browser session. This session is now read-only.';

function getStoreDirectory() {
    return path.join(globalThis.DATA_ROOT, STORE_DIRECTORY_NAME);
}

function getStorePath() {
    return path.join(getStoreDirectory(), STORE_FILE_NAME);
}

function getLockPath() {
    return path.join(getStoreDirectory(), LOCK_DIRECTORY_NAME);
}

function getLeaseKey(userHandle) {
    return createHash('sha256').update(String(userHandle || '')).digest('hex');
}

function normalizeBrowserSessionId(browserSessionId) {
    const normalized = String(browserSessionId || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : '';
}

function sanitizeMetadata(metadata) {
    return {
        userAgent: String(metadata?.userAgent || '').slice(0, 512),
    };
}

function createLease(userHandle, browserSessionId, metadata, now = Date.now()) {
    return {
        userHandle,
        browserSessionId,
        claimedAt: now,
        lastSeenAt: now,
        expiresAt: now + LEASE_TTL_MS,
        metadata: sanitizeMetadata(metadata),
    };
}

function isLeaseActive(lease, now = Date.now()) {
    return Boolean(lease?.browserSessionId) && Number(lease.expiresAt || 0) > now;
}

function toPublicStatus(lease, browserSessionId, now = Date.now()) {
    if (!isLeaseActive(lease, now)) {
        return {
            active: false,
            hasActiveSession: false,
            canTakeOver: true,
            lease: null,
            ttlMs: LEASE_TTL_MS,
        };
    }

    const active = lease.browserSessionId === browserSessionId;
    return {
        active,
        hasActiveSession: true,
        canTakeOver: !active,
        lease: {
            claimedAt: lease.claimedAt,
            lastSeenAt: lease.lastSeenAt,
            expiresAt: lease.expiresAt,
            metadata: lease.metadata || {},
        },
        ttlMs: LEASE_TTL_MS,
    };
}

function createActiveSessionError(message = ACTIVE_SESSION_LOCK_MESSAGE) {
    const error = new Error(message);
    error.status = 423;
    error.code = ACTIVE_SESSION_ERROR;
    error.canTakeOver = true;
    return error;
}

async function readStore() {
    try {
        const raw = await fsPromises.readFile(getStorePath(), 'utf8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {};
        }

        throw error;
    }
}

async function writeStore(data) {
    const storeDirectory = getStoreDirectory();
    await fsPromises.mkdir(storeDirectory, { recursive: true });

    const tempPath = path.join(storeDirectory, `${STORE_FILE_NAME}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
    await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fsPromises.rename(tempPath, getStorePath());
}

async function withStoreLock(operation) {
    return await withDirectoryLock({
        lockPath: getLockPath(),
        retryMs: LOCK_RETRY_MS,
        timeoutMs: LOCK_TIMEOUT_MS,
        staleMs: LOCK_STALE_MS,
        heartbeatMs: LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting for active session lease store lock.',
    }, async () => {
        const store = await readStore();
        const result = await operation(store);
        if (result?.write) {
            await writeStore(store);
        }
        return result?.value;
    });
}

export const activeSessionStore = {
    ttlMs: LEASE_TTL_MS,

    getBrowserSessionId(request) {
        return normalizeBrowserSessionId(request.headers[BROWSER_SESSION_HEADER]);
    },

    getMetadata(request) {
        return {
            userAgent: request.headers['user-agent'],
        };
    },

    async getStatus(userHandle, browserSessionId) {
        const normalizedSessionId = normalizeBrowserSessionId(browserSessionId);
        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const lease = store[key];
            const now = Date.now();
            const expired = lease && !isLeaseActive(lease, now);

            if (expired) {
                delete store[key];
            }

            return {
                write: expired,
                value: toPublicStatus(store[key], normalizedSessionId, now),
            };
        });
    },

    async claim(userHandle, browserSessionId, metadata) {
        const normalizedSessionId = normalizeBrowserSessionId(browserSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const existingLease = store[key];
            const now = Date.now();

            if (!isLeaseActive(existingLease, now) || existingLease.browserSessionId === normalizedSessionId) {
                store[key] = createLease(userHandle, normalizedSessionId, metadata, now);
                return {
                    write: true,
                    value: toPublicStatus(store[key], normalizedSessionId, now),
                };
            }

            return {
                write: false,
                value: toPublicStatus(existingLease, normalizedSessionId, now),
            };
        });
    },

    async takeOver(userHandle, browserSessionId, metadata) {
        const normalizedSessionId = normalizeBrowserSessionId(browserSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const now = Date.now();
            const key = getLeaseKey(userHandle);
            store[key] = createLease(userHandle, normalizedSessionId, metadata, now);
            return {
                write: true,
                value: toPublicStatus(store[key], normalizedSessionId, now),
            };
        });
    },

    async heartbeat(userHandle, browserSessionId) {
        const normalizedSessionId = normalizeBrowserSessionId(browserSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const lease = store[key];
            const now = Date.now();

            if (!isLeaseActive(lease, now)) {
                delete store[key];
                throw createActiveSessionError();
            }

            if (lease.browserSessionId !== normalizedSessionId) {
                throw createActiveSessionError();
            }

            lease.lastSeenAt = now;
            lease.expiresAt = now + LEASE_TTL_MS;
            return {
                write: true,
                value: toPublicStatus(lease, normalizedSessionId, now),
            };
        });
    },

    async assertActive(userHandle, browserSessionId) {
        const normalizedSessionId = normalizeBrowserSessionId(browserSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const lease = store[key];
            const now = Date.now();

            if (!isLeaseActive(lease, now)) {
                delete store[key];
                throw createActiveSessionError();
            }

            if (lease.browserSessionId !== normalizedSessionId) {
                throw createActiveSessionError();
            }

            lease.lastSeenAt = now;
            lease.expiresAt = now + LEASE_TTL_MS;
            return {
                write: true,
                value: true,
            };
        });
    },

    async release(userHandle, browserSessionId) {
        const normalizedSessionId = normalizeBrowserSessionId(browserSessionId);
        if (!normalizedSessionId) {
            return false;
        }

        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const lease = store[key];

            if (lease?.browserSessionId !== normalizedSessionId) {
                return {
                    write: false,
                    value: false,
                };
            }

            delete store[key];
            return {
                write: true,
                value: true,
            };
        });
    },
};

export function sendActiveSessionRequired(response) {
    return response.status(423).json({
        error: ACTIVE_SESSION_ERROR,
        message: ACTIVE_SESSION_LOCK_MESSAGE,
        canTakeOver: true,
    });
}

export function isActiveSessionError(error) {
    return error?.code === ACTIVE_SESSION_ERROR || error?.status === 423;
}
