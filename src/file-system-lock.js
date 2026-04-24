import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { delay } from './util.js';

const LOCK_OWNER_FILENAME = 'owner.json';

function createLockOwnershipLostError(lockPath, cause) {
    const error = new Error(`Lost directory lock ownership for "${lockPath}" while running a protected operation.`);
    error.code = 'ELOCKLOST';
    error.status = 503;
    if (cause) {
        error.cause = cause;
    }
    return error;
}

function getOwnerPath(lockPath) {
    return path.join(lockPath, LOCK_OWNER_FILENAME);
}

function createOwner(token, createdAt = Date.now()) {
    return {
        token,
        pid: process.pid,
        createdAt,
        updatedAt: createdAt,
    };
}

async function writeOwner(lockPath, owner) {
    owner.updatedAt = Date.now();
    await fsPromises.writeFile(getOwnerPath(lockPath), JSON.stringify(owner), 'utf8');
}

async function readOwner(lockPath) {
    const ownerPath = getOwnerPath(lockPath);

    try {
        const rawOwner = await fsPromises.readFile(ownerPath, 'utf8');
        const owner = JSON.parse(rawOwner);
        const token = String(owner?.token || '').trim();
        const updatedAt = Number(owner?.updatedAt) || 0;

        if (token && updatedAt > 0) {
            return { token, updatedAt };
        }
    } catch {
        // Fall back to mtime below for pre-owner locks or a partially-written owner file.
    }

    try {
        const stats = await fsPromises.stat(ownerPath);
        return { token: '', updatedAt: stats.mtimeMs };
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }

    try {
        const stats = await fsPromises.stat(lockPath);
        return { token: '', updatedAt: stats.mtimeMs };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

function isSameObservedOwner(left, right) {
    return Boolean(left && right)
        && left.token === right.token
        && left.updatedAt === right.updatedAt;
}

async function tryRecoverStaleLock(lockPath, staleMs) {
    const observedOwner = await readOwner(lockPath);
    if (!observedOwner || Date.now() - observedOwner.updatedAt <= staleMs) {
        return false;
    }

    const currentOwner = await readOwner(lockPath);
    if (!isSameObservedOwner(observedOwner, currentOwner)) {
        return false;
    }

    const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}-${randomUUID()}`;

    try {
        await fsPromises.rename(lockPath, stalePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        if (['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) {
            return false;
        }

        throw error;
    }

    const movedOwner = await readOwner(stalePath);
    if (!isSameObservedOwner(observedOwner, movedOwner)) {
        try {
            await fsPromises.rename(stalePath, lockPath);
        } catch {
            // If restore fails, do not delete the moved path; preserving data is safer than force removal.
        }

        return false;
    }

    await fsPromises.rm(stalePath, { recursive: true, force: true });
    return true;
}

async function acquireDirectoryLock({ lockPath, retryMs, timeoutMs, staleMs, heartbeatMs, timeoutMessage }) {
    await fsPromises.mkdir(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + timeoutMs;
    const token = randomUUID();

    while (true) {
        try {
            await fsPromises.mkdir(lockPath);
            const owner = createOwner(token);

            try {
                await writeOwner(lockPath, owner);
            } catch (error) {
                await fsPromises.rm(lockPath, { recursive: true, force: true });
                throw error;
            }

            let released = false;
            let ownershipLostError = null;
            let heartbeatInFlight = Promise.resolve();
            let ownerStateInFlight = Promise.resolve();
            const markOwnershipLost = (cause) => {
                if (!ownershipLostError) {
                    ownershipLostError = createLockOwnershipLostError(lockPath, cause);
                }

                return ownershipLostError;
            };
            const runOwnerStateTask = async (task) => {
                const nextTask = ownerStateInFlight.then(async () => await task());
                ownerStateInFlight = nextTask.catch(() => { });
                return await nextTask;
            };
            const assertOwnership = async () => {
                if (ownershipLostError) {
                    throw ownershipLostError;
                }

                await runOwnerStateTask(async () => {
                    if (ownershipLostError) {
                        throw ownershipLostError;
                    }

                    const currentOwner = await readOwner(lockPath);
                    if (currentOwner?.token !== token) {
                        throw markOwnershipLost();
                    }
                });
            };
            const heartbeatOnce = async () => {
                if (released || ownershipLostError) {
                    return;
                }

                await runOwnerStateTask(async () => {
                    if (released || ownershipLostError) {
                        return;
                    }

                    const currentOwner = await readOwner(lockPath);
                    if (currentOwner?.token !== token) {
                        throw markOwnershipLost();
                    }

                    await writeOwner(lockPath, owner);
                });
            };
            const heartbeat = setInterval(() => {
                heartbeatInFlight = heartbeatInFlight
                    .then(heartbeatOnce)
                    .catch(error => {
                        markOwnershipLost(error);
                    });
            }, heartbeatMs);
            heartbeat.unref?.();

            return {
                lock: {
                    async assertOwnership() {
                        await heartbeatInFlight.catch(() => { });
                        await assertOwnership();
                    },
                    async run(task) {
                        await this.assertOwnership();
                        const result = await task();
                        await this.assertOwnership();
                        return result;
                    },
                },
                release: async () => {
                    released = true;
                    clearInterval(heartbeat);
                    await heartbeatInFlight.catch(() => { });
                    await ownerStateInFlight.catch(() => { });

                    const currentOwner = await readOwner(lockPath);
                    if (currentOwner?.token !== token) {
                        return;
                    }

                    await fsPromises.rm(lockPath, { recursive: true, force: true });
                },
            };
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            await tryRecoverStaleLock(lockPath, staleMs);

            if (Date.now() >= deadline) {
                const timeoutError = new Error(timeoutMessage);
                timeoutError.status = 503;
                throw timeoutError;
            }

            await delay(retryMs);
        }
    }
}

export async function withDirectoryLock(options, operation) {
    const { lock, release } = await acquireDirectoryLock(options);

    try {
        return await operation(lock);
    } finally {
        await release();
    }
}
