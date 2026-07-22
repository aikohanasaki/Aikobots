import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import writeFileAtomic from 'write-file-atomic';

import { withDirectoryLock } from './file-system-lock.js';

export const STORAGE_CHECK_BYTES_PER_GB = 1024 ** 3;

export const STORAGE_CHECK_CODES = Object.freeze({
    CHAT_1GB: 'chat_1gb',
    CHAT_2GB: 'chat_2gb',
    IMAGES_1GB: 'images_1gb',
    IMAGES_2GB: 'images_2gb',
    CHARACTERS_2X_SHARED: 'characters_2x_shared',
    USER_DIRECTORY_3GB: 'user_directory_3gb',
});

const STORAGE_CHECK_STATE_FILE_NAME = 'storage-check-alerts.json';
const STORAGE_CHECK_STATE_DIRECTORY = '_storage-check';
const LEGACY_STORAGE_CHECK_STATE_DIRECTORY = '_storage';
const STORAGE_CHECK_LOCK_RETRY_MS = 50;
const STORAGE_CHECK_LOCK_TIMEOUT_MS = 10_000;
const STORAGE_CHECK_LOCK_STALE_MS = 60_000;
const STORAGE_CHECK_LOCK_HEARTBEAT_MS = 15_000;
const SHARED_CHARACTER_DIRECTORY = ['_secure', 'shared-characters'];

function getStorageCheckStatePath(dataRoot = globalThis.DATA_ROOT) {
    return path.join(dataRoot, STORAGE_CHECK_STATE_DIRECTORY, STORAGE_CHECK_STATE_FILE_NAME);
}

function getLegacyStorageCheckStatePath(dataRoot) {
    return path.join(dataRoot, LEGACY_STORAGE_CHECK_STATE_DIRECTORY, STORAGE_CHECK_STATE_FILE_NAME);
}

function getSharedCharactersDirectory() {
    return path.join(globalThis.DATA_ROOT, ...SHARED_CHARACTER_DIRECTORY);
}

function getStorageCheckDateKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}

function getEmptyStorageCheckState() {
    return {
        version: 2,
        emitted: {},
        adminEmitted: {},
    };
}

function normalizeStorageCheckCodeMaps(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function cloneStorageCheckCodeMaps(value) {
    const clone = {};

    for (const [userHandle, codeMap] of Object.entries(normalizeStorageCheckCodeMaps(value))) {
        if (codeMap && typeof codeMap === 'object' && !Array.isArray(codeMap)) {
            clone[userHandle] = { ...codeMap };
        }
    }

    return clone;
}

function normalizeStorageCheckState(value) {
    const emitted = normalizeStorageCheckCodeMaps(value?.emitted);
    const adminEmitted = Object.prototype.hasOwnProperty.call(value || {}, 'adminEmitted')
        ? normalizeStorageCheckCodeMaps(value?.adminEmitted)
        : cloneStorageCheckCodeMaps(emitted);

    return {
        version: 2,
        emitted,
        adminEmitted,
    };
}

async function readStorageCheckState(statePath) {
    try {
        const raw = await fsPromises.readFile(statePath, 'utf8');
        return normalizeStorageCheckState(JSON.parse(raw));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return getEmptyStorageCheckState();
        }

        if (error instanceof SyntaxError) {
            return getEmptyStorageCheckState();
        }

        throw error;
    }
}

async function writeStorageCheckState(statePath, state) {
    await fsPromises.mkdir(path.dirname(statePath), { recursive: true });
    await writeFileAtomic(statePath, JSON.stringify(normalizeStorageCheckState(state), null, 4), 'utf8');
}

async function withStorageCheckStateLock(statePath, operation) {
    return await withDirectoryLock({
        lockPath: `${statePath}.lock`,
        retryMs: STORAGE_CHECK_LOCK_RETRY_MS,
        timeoutMs: STORAGE_CHECK_LOCK_TIMEOUT_MS,
        staleMs: STORAGE_CHECK_LOCK_STALE_MS,
        heartbeatMs: STORAGE_CHECK_LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting for storage check state lock.',
    }, operation);
}

/**
 * Moves the legacy alert state out of the node-persist storage directory without replacing newer state.
 * @param {string} dataRoot Root directory for persistent application data.
 * @returns {Promise<void>}
 */
export async function migrateLegacyStorageCheckState(dataRoot) {
    const statePath = getStorageCheckStatePath(dataRoot);
    const legacyStatePath = getLegacyStorageCheckStatePath(dataRoot);

    await withStorageCheckStateLock(statePath, async lock => {
        await lock.run(async () => {
            try {
                await fsPromises.access(statePath);
                return;
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }

            try {
                await fsPromises.rename(legacyStatePath, statePath);
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
        });
    });
}

function getUserCodeMap(state, stateKey, userHandle) {
    const handle = String(userHandle || '').trim() || 'default-user';
    const emitted = state[stateKey] && typeof state[stateKey] === 'object' && !Array.isArray(state[stateKey])
        ? state[stateKey]
        : {};

    if (!emitted[handle] || typeof emitted[handle] !== 'object' || Array.isArray(emitted[handle])) {
        emitted[handle] = {};
    }

    state[stateKey] = emitted;
    return emitted[handle];
}

function getDueStorageCheckCodes(items, codeMap, dateKey) {
    const dueCodes = new Set();

    for (const item of items) {
        const code = String(item?.code || '');

        if (code && codeMap[code] !== dateKey) {
            dueCodes.add(code);
        }
    }

    return dueCodes;
}

function markStorageCheckCodesEmitted(items, codeMap, dateKey) {
    for (const item of items) {
        const code = String(item?.code || '');

        if (code) {
            codeMap[code] = dateKey;
        }
    }
}

function filterItemsByDueCodes(items, dueCodes) {
    return items.filter(item => dueCodes.has(String(item?.code || '')));
}

/**
 * Recursively totals regular files in a directory without following symlinks.
 * @param {string} directoryPath Directory to scan.
 * @returns {Promise<number>} Total byte size.
 */
export async function getRecursiveDirectorySize(directoryPath) {
    try {
        const rootStats = await fsPromises.lstat(directoryPath);
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
            return rootStats.isFile() ? rootStats.size : 0;
        }
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return 0;
        }

        throw error;
    }

    let total = 0;
    const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isSymbolicLink()) {
            continue;
        }

        const entryPath = path.join(directoryPath, entry.name);

        try {
            const stats = await fsPromises.lstat(entryPath);

            if (stats.isSymbolicLink()) {
                continue;
            }

            if (stats.isDirectory()) {
                total += await getRecursiveDirectorySize(entryPath);
            } else if (stats.isFile()) {
                total += stats.size;
            }
        } catch (error) {
            if (error?.code === 'ENOENT') {
                continue;
            }

            throw error;
        }
    }

    return total;
}

/**
 * Builds storage warnings and admin alerts from aggregate byte counts.
 * @param {{ rootBytes?: number, chatBytes: number, imageBytes: number, characterBytes: number, sharedCharacterBytes: number }} sizes
 * @returns {{ warnings: object[], adminAlerts: object[] }}
 */
export function buildUserStorageCheckEvaluation(sizes) {
    const rootBytes = Number(sizes?.rootBytes) || 0;
    const chatBytes = Number(sizes?.chatBytes) || 0;
    const imageBytes = Number(sizes?.imageBytes) || 0;
    const characterBytes = Number(sizes?.characterBytes) || 0;
    const sharedCharacterBytes = Number(sizes?.sharedCharacterBytes) || 0;
    const oneGb = STORAGE_CHECK_BYTES_PER_GB;
    const twoGb = STORAGE_CHECK_BYTES_PER_GB * 2;
    const threeGb = STORAGE_CHECK_BYTES_PER_GB * 3;
    const warnings = [];
    const adminAlerts = [];

    if (rootBytes > threeGb) {
        adminAlerts.push({
            code: STORAGE_CHECK_CODES.USER_DIRECTORY_3GB,
            message: `Automated Aiko storage alert: entire user directory is over 3GB (${rootBytes} bytes).`,
        });
    }

    if (chatBytes > twoGb) {
        warnings.push({
            code: STORAGE_CHECK_CODES.CHAT_2GB,
            severity: 'error',
            title: 'Chat storage limit',
            message: 'Aiko has set a 2GB chat limit. Please talk to Aiko ASAP if you do not want to export or archive your chat files.',
        });
        adminAlerts.push({
            code: STORAGE_CHECK_CODES.CHAT_2GB,
            message: `Automated Aiko storage alert: chat files are over 2GB (${chatBytes} bytes).`,
        });
    } else if (chatBytes > oneGb) {
        warnings.push({
            code: STORAGE_CHECK_CODES.CHAT_1GB,
            severity: 'warning',
            title: 'Chat storage',
            message: 'You have more than 1GB of chat files. Please consider exporting some chats. The chat manager has an HTML download option that includes profile pictures.',
        });
    }

    if (imageBytes > twoGb) {
        warnings.push({
            code: STORAGE_CHECK_CODES.IMAGES_2GB,
            severity: 'error',
            title: 'Image storage',
            message: 'You have saved more than 2GB of images. Please clean out your image galleries. Aiko may be contacting you about your storage usage.',
        });
        adminAlerts.push({
            code: STORAGE_CHECK_CODES.IMAGES_2GB,
            message: `Automated Aiko storage alert: saved images are over 2GB (${imageBytes} bytes).`,
        });
    } else if (imageBytes > oneGb) {
        warnings.push({
            code: STORAGE_CHECK_CODES.IMAGES_1GB,
            severity: 'warning',
            title: 'Image storage',
            message: 'You have saved more than 1GB of images. Please clean out your image galleries.',
        });
    }

    if (sharedCharacterBytes > 0 && characterBytes >= sharedCharacterBytes * 2) {
        adminAlerts.push({
            code: STORAGE_CHECK_CODES.CHARACTERS_2X_SHARED,
            message: `Automated Aiko storage alert: user character files are at least 2x the global pushed shared-character storage (${characterBytes} bytes user characters vs ${sharedCharacterBytes} bytes shared characters).`,
        });
    }

    return { warnings, adminAlerts };
}

/**
 * Applies once-per-day rate limiting to storage warnings and already-delivered admin alerts.
 * @param {string} userHandle User handle.
 * @param {{ warnings: object[], adminAlerts: object[] }} evaluation Evaluation to filter.
 * @param {{ now?: number, statePath?: string }} [options]
 * @returns {Promise<{ warnings: object[], adminAlerts: object[] }>}
 */
export async function filterDueUserStorageCheckEvaluation(userHandle, evaluation, options = {}) {
    const statePath = options.statePath || getStorageCheckStatePath();
    const dateKey = getStorageCheckDateKey(options.now);

    return await withStorageCheckStateLock(statePath, async lock => {
        const state = await readStorageCheckState(statePath);
        const warningCodeMap = getUserCodeMap(state, 'emitted', userHandle);
        const adminCodeMap = getUserCodeMap(state, 'adminEmitted', userHandle);
        const warningDueCodes = getDueStorageCheckCodes(evaluation.warnings || [], warningCodeMap, dateKey);
        const adminDueCodes = getDueStorageCheckCodes(evaluation.adminAlerts || [], adminCodeMap, dateKey);
        const warnings = filterItemsByDueCodes(evaluation.warnings || [], warningDueCodes);
        const adminAlerts = filterItemsByDueCodes(evaluation.adminAlerts || [], adminDueCodes);

        await lock.run(async () => {
            markStorageCheckCodesEmitted(warnings, warningCodeMap, dateKey);
            await writeStorageCheckState(statePath, state);
        });

        return { warnings, adminAlerts };
    });
}

/**
 * Filters due storage notifications and records admin alert codes after delivery succeeds.
 * @param {import('./users.js').User} user User profile.
 * @param {{ warnings: object[], adminAlerts: object[] }} evaluation Evaluation to filter.
 * @param {{ now?: number, statePath?: string }} [options]
 * @returns {Promise<{ warnings: object[], adminAlertError: Error|null }>}
 */
async function runDueUserStorageCheckEvaluation(user, evaluation, options = {}) {
    const statePath = options.statePath || getStorageCheckStatePath();
    const dateKey = getStorageCheckDateKey(options.now);
    let adminAlertError = null;

    return await withStorageCheckStateLock(statePath, async lock => {
        const state = await readStorageCheckState(statePath);
        const warningCodeMap = getUserCodeMap(state, 'emitted', user.handle);
        const adminCodeMap = getUserCodeMap(state, 'adminEmitted', user.handle);
        const warningDueCodes = getDueStorageCheckCodes(evaluation.warnings || [], warningCodeMap, dateKey);
        const adminDueCodes = getDueStorageCheckCodes(evaluation.adminAlerts || [], adminCodeMap, dateKey);
        const warnings = filterItemsByDueCodes(evaluation.warnings || [], warningDueCodes);
        const adminAlerts = filterItemsByDueCodes(evaluation.adminAlerts || [], adminDueCodes);

        await lock.run(async () => {
            markStorageCheckCodesEmitted(warnings, warningCodeMap, dateKey);

            try {
                await sendStorageCheckAdminAlerts(user, adminAlerts, alert => {
                    markStorageCheckCodesEmitted([alert], adminCodeMap, dateKey);
                });
            } catch (error) {
                adminAlertError = error;
            }

            await writeStorageCheckState(statePath, state);
        });

        return { warnings, adminAlertError };
    });
}

/**
 * Gets aggregate storage sizes used by the user storage check.
 * @param {import('./users.js').UserDirectoryList} directories User directories.
 * @param {{ sharedCharactersDirectory?: string }} [options]
 * @returns {Promise<{ rootBytes: number, chatBytes: number, imageBytes: number, characterBytes: number, sharedCharacterBytes: number }>}
 */
export async function getUserStorageCheckSizes(directories, options = {}) {
    const sharedCharactersDirectory = options.sharedCharactersDirectory || getSharedCharactersDirectory();
    const [rootBytes, chatsBytes, groupChatsBytes, imageBytes, characterBytes, sharedCharacterBytes] = await Promise.all([
        getRecursiveDirectorySize(directories.root),
        getRecursiveDirectorySize(directories.chats),
        getRecursiveDirectorySize(directories.groupChats),
        getRecursiveDirectorySize(directories.userImages),
        getRecursiveDirectorySize(directories.characters),
        getRecursiveDirectorySize(sharedCharactersDirectory),
    ]);

    return {
        rootBytes,
        chatBytes: chatsBytes + groupChatsBytes,
        imageBytes,
        characterBytes,
        sharedCharacterBytes,
    };
}

async function sendStorageCheckAdminAlerts(user, adminAlerts, onAlertSent) {
    if (!adminAlerts.length) {
        return;
    }

    if (user?.admin) {
        for (const alert of adminAlerts) {
            onAlertSent?.(alert);
        }

        return;
    }

    const { appendUserAdminUserMessage } = await import('./user-admin-messages.js');

    for (const alert of adminAlerts) {
        await appendUserAdminUserMessage({
            userHandle: user.handle,
            senderHandle: user.handle,
            senderName: user.name || user.handle,
            body: String(alert.message || ''),
        });
        onAlertSent?.(alert);
    }
}

/**
 * Scans user storage and returns due page-load warnings.
 * @param {{ profile: import('./users.js').User, directories: import('./users.js').UserDirectoryList }} userContext
 * @returns {Promise<{ warnings: object[] }>}
 */
export async function runUserStorageCheck(userContext) {
    const sizes = await getUserStorageCheckSizes(userContext.directories);
    const evaluation = buildUserStorageCheckEvaluation(sizes);
    const dueEvaluation = await runDueUserStorageCheckEvaluation(userContext.profile, evaluation);

    if (dueEvaluation.adminAlertError) {
        console.warn('Failed to send one or more storage check admin notifications.', dueEvaluation.adminAlertError);
    }

    return {
        warnings: dueEvaluation.warnings,
    };
}
