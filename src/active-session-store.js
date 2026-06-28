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
const OPERATION_TTL_MS = 60 * 60_000;
export const TAB_SESSION_HEADER = 'x-tab-session-id';
export const ACTIVE_SESSION_ERROR = 'active_session_required';
export const ACTIVE_SESSION_LOCK_MESSAGE = 'Aikobots is open in another tab or browser session. This session is now read-only. Reload this page to make this tab active.';

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

function normalizeTabSessionId(tabSessionId) {
    const normalized = String(tabSessionId || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : '';
}

function sanitizeMetadata(metadata) {
    return {
        userAgent: String(metadata?.userAgent || '').slice(0, 512),
        clientInstallId: normalizeTabSessionId(metadata?.clientInstallId),
        runtimeId: normalizeTabSessionId(metadata?.runtimeId),
    };
}

function getStoredTabSessionId(record) {
    return record?.tabSessionId || record?.browserSessionId || '';
}

function createLease(userHandle, tabSessionId, metadata, now = Date.now()) {
    return {
        userHandle,
        tabSessionId,
        claimedAt: now,
        lastTakeoverAt: now,
        lastSeenAt: now,
        expiresAt: now + LEASE_TTL_MS,
        metadata: sanitizeMetadata(metadata),
    };
}

function isLeaseActive(lease, now = Date.now()) {
    return Boolean(getStoredTabSessionId(lease)) && Number(lease?.expiresAt || 0) > now;
}

function refreshLease(lease, now = Date.now()) {
    lease.lastSeenAt = now;
    lease.expiresAt = now + LEASE_TTL_MS;
}

function pruneExpiredLease(store, key, now = Date.now()) {
    const lease = store.leases[key];
    if (!lease || isLeaseActive(lease, now)) {
        return false;
    }

    delete store.leases[key];
    return true;
}

function normalizeStore(data) {
    if (!data || typeof data !== 'object') {
        return { leases: {}, operations: {} };
    }

    if (data.leases && typeof data.leases === 'object') {
        return {
            leases: data.leases,
            operations: data.operations && typeof data.operations === 'object' ? data.operations : {},
        };
    }

    return {
        leases: data,
        operations: {},
    };
}

function pruneExpiredOperations(store, now = Date.now()) {
    let pruned = false;
    for (const [operationId, operation] of Object.entries(store.operations || {})) {
        if (!operation || Number(operation.expiresAt || 0) <= now) {
            delete store.operations[operationId];
            pruned = true;
        }
    }
    return pruned;
}

function createOperation(userHandle, tabSessionId, operationType, now = Date.now()) {
    return {
        operationId: randomUUID(),
        userHandle,
        tabSessionId,
        operationType: String(operationType || 'write').slice(0, 128),
        startedAt: now,
        lastSeenAt: now,
        expiresAt: now + OPERATION_TTL_MS,
        cancelledAt: null,
    };
}

function assertLeaseAndOperationAllowed(store, userHandle, tabSessionId, operationId, now = Date.now()) {
    const key = getLeaseKey(userHandle);
    const lease = store.leases[key];

    if (!isLeaseActive(lease, now)) {
        throw createActiveSessionError();
    }

    if (getStoredTabSessionId(lease) !== tabSessionId) {
        throw createActiveSessionError();
    }

    const operation = store.operations[operationId];
    if (!operation
        || operation.userHandle !== userHandle
        || getStoredTabSessionId(operation) !== tabSessionId
        || operation.cancelledAt) {
        throw createActiveSessionError();
    }

    operation.lastSeenAt = now;
    operation.expiresAt = now + OPERATION_TTL_MS;
    refreshLease(lease, now);
    return operation;
}

function toPublicStatus(lease, tabSessionId, now = Date.now()) {
    if (!isLeaseActive(lease, now)) {
        return {
            active: false,
            hasActiveSession: false,
            canTakeOver: true,
            lease: null,
            ttlMs: LEASE_TTL_MS,
        };
    }

    const active = getStoredTabSessionId(lease) === tabSessionId;
    return {
        active,
        hasActiveSession: true,
        canTakeOver: !active,
        lease: {
            claimedAt: lease.claimedAt,
            lastTakeoverAt: lease.lastTakeoverAt,
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
        return normalizeStore(data);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return normalizeStore(null);
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

    getTabSessionId(request) {
        return normalizeTabSessionId(request.headers[TAB_SESSION_HEADER]);
    },

    getMetadata(request) {
        return {
            userAgent: request.headers['user-agent'],
            clientInstallId: request.headers['x-client-install-id'],
            runtimeId: request.headers['x-tab-runtime-id'],
        };
    },

    async getStatus(userHandle, tabSessionId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const now = Date.now();
            const prunedOperations = pruneExpiredOperations(store, now);
            const prunedLease = pruneExpiredLease(store, key, now);
            const pruned = prunedOperations || prunedLease;

            return {
                write: pruned,
                value: toPublicStatus(store.leases[key], normalizedSessionId, now),
            };
        });
    },

    async verify(userHandle, tabSessionId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const now = Date.now();
            const pruned = pruneExpiredLease(store, key, now);
            const lease = store.leases[key];
            return {
                write: pruned,
                value: {
                    active: Boolean(normalizedSessionId) && isLeaseActive(lease, now) && getStoredTabSessionId(lease) === normalizedSessionId,
                    hasActiveSession: isLeaseActive(lease, now),
                },
            };
        });
    },

    async claim(userHandle, tabSessionId, metadata) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const now = Date.now();
            const prunedOperations = pruneExpiredOperations(store, now);
            const prunedLease = pruneExpiredLease(store, key, now);
            const pruned = prunedOperations || prunedLease;

            if (!isLeaseActive(store.leases[key], now) || getStoredTabSessionId(store.leases[key]) === normalizedSessionId) {
                store.leases[key] = createLease(userHandle, normalizedSessionId, metadata, now);
                return {
                    write: true,
                    value: toPublicStatus(store.leases[key], normalizedSessionId, now),
                };
            }

            return {
                write: pruned,
                value: toPublicStatus(store.leases[key], normalizedSessionId, now),
            };
        });
    },

    async takeOver(userHandle, tabSessionId, metadata) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const now = Date.now();
            const key = getLeaseKey(userHandle);
            store.leases[key] = createLease(userHandle, normalizedSessionId, metadata, now);
            for (const operation of Object.values(store.operations || {})) {
                if (operation?.userHandle === userHandle && getStoredTabSessionId(operation) !== normalizedSessionId && !operation.cancelledAt) {
                    operation.cancelledAt = now;
                    operation.expiresAt = now + OPERATION_TTL_MS;
                }
            }
            return {
                write: true,
                value: toPublicStatus(store.leases[key], normalizedSessionId, now),
            };
        });
    },

    async heartbeat(userHandle, tabSessionId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const now = Date.now();
            const key = getLeaseKey(userHandle);
            const lease = store.leases[key];
            if (!isLeaseActive(lease, now)) {
                pruneExpiredLease(store, key, now);
                throw createActiveSessionError();
            }

            if (getStoredTabSessionId(lease) !== normalizedSessionId) {
                throw createActiveSessionError();
            }

            refreshLease(lease, now);
            return {
                write: true,
                value: toPublicStatus(lease, normalizedSessionId, now),
            };
        });
    },

    async assertActive(userHandle, tabSessionId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const now = Date.now();
            const key = getLeaseKey(userHandle);
            const lease = store.leases[key];
            if (!isLeaseActive(lease, now)) {
                pruneExpiredLease(store, key, now);
                throw createActiveSessionError();
            }

            if (getStoredTabSessionId(lease) !== normalizedSessionId) {
                throw createActiveSessionError();
            }

            return {
                write: false,
                value: true,
            };
        });
    },

    async release(userHandle, tabSessionId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId) {
            return false;
        }

        return await withStoreLock(async (store) => {
            const key = getLeaseKey(userHandle);
            const lease = store.leases[key];

            if (getStoredTabSessionId(lease) !== normalizedSessionId) {
                return {
                    write: false,
                    value: false,
                };
            }

            delete store.leases[key];
            return {
                write: true,
                value: true,
            };
        });
    },

    async beginOperation(userHandle, tabSessionId, operationType) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const now = Date.now();
            pruneExpiredOperations(store, now);
            const key = getLeaseKey(userHandle);
            const lease = store.leases[key];

            if (!isLeaseActive(lease, now)) {
                pruneExpiredLease(store, key, now);
                throw createActiveSessionError();
            }

            if (getStoredTabSessionId(lease) !== normalizedSessionId) {
                throw createActiveSessionError();
            }

            const operation = createOperation(userHandle, normalizedSessionId, operationType, now);
            store.operations[operation.operationId] = operation;
            refreshLease(lease, now);
            return {
                write: true,
                value: structuredClone(operation),
            };
        });
    },

    async endOperation(userHandle, tabSessionId, operationId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId || !operationId) {
            return false;
        }

        return await withStoreLock(async (store) => {
            const operation = store.operations[operationId];
            if (!operation || operation.userHandle !== userHandle || getStoredTabSessionId(operation) !== normalizedSessionId) {
                return {
                    write: false,
                    value: false,
                };
            }

            delete store.operations[operationId];
            return {
                write: true,
                value: true,
            };
        });
    },

    async cancelOperationsForUserExcept(userHandle, activeTabSessionId) {
        const normalizedSessionId = normalizeTabSessionId(activeTabSessionId);
        const now = Date.now();

        return await withStoreLock(async (store) => {
            let cancelled = 0;
            for (const operation of Object.values(store.operations || {})) {
                if (operation?.userHandle === userHandle && getStoredTabSessionId(operation) !== normalizedSessionId && !operation.cancelledAt) {
                    operation.cancelledAt = now;
                    operation.expiresAt = now + OPERATION_TTL_MS;
                    cancelled++;
                }
            }

            return {
                write: cancelled > 0,
                value: cancelled,
            };
        });
    },

    async assertOperationAllowed(userHandle, tabSessionId, operationId) {
        const normalizedSessionId = normalizeTabSessionId(tabSessionId);
        if (!normalizedSessionId || !operationId) {
            throw createActiveSessionError();
        }

        return await withStoreLock(async (store) => {
            const now = Date.now();
            assertLeaseAndOperationAllowed(store, userHandle, normalizedSessionId, operationId, now);
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
