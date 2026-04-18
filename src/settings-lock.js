import path from 'node:path';

import { SETTINGS_FILE } from './constants.js';
import { withDirectoryLock } from './file-system-lock.js';

const SETTINGS_PERSONAS_LOCK_RETRY_MS = 50;
const SETTINGS_PERSONAS_LOCK_TIMEOUT_MS = 10_000;
const SETTINGS_PERSONAS_LOCK_STALE_MS = 60_000;
const SETTINGS_PERSONAS_LOCK_HEARTBEAT_MS = 15_000;

function getSettingsPersonasLockPath(directories) {
    return path.join(directories.root, `${SETTINGS_FILE}.personas.lock`);
}

export async function withSettingsPersonasLock(directories, operation) {
    return await withDirectoryLock({
        lockPath: getSettingsPersonasLockPath(directories),
        retryMs: SETTINGS_PERSONAS_LOCK_RETRY_MS,
        timeoutMs: SETTINGS_PERSONAS_LOCK_TIMEOUT_MS,
        staleMs: SETTINGS_PERSONAS_LOCK_STALE_MS,
        heartbeatMs: SETTINGS_PERSONAS_LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update settings and personas.',
    }, operation);
}
