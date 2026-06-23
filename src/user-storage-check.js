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
});

const STORAGE_CHECK_STATE_FILE_NAME = 'storage-check-alerts.json';
const STORAGE_CHECK_LOCK_RETRY_MS = 50;
const STORAGE_CHECK_LOCK_TIMEOUT_MS = 10_000;
const STORAGE_CHECK_LOCK_STALE_MS = 60_000;
const STORAGE_CHECK_LOCK_HEARTBEAT_MS = 15_000;
const SHARED_CHARACTER_DIRECTORY = ['_secure', 'shared-characters'];

function getStorageCheckStatePath() {
    return path.join(globalThis.DATA_ROOT, '_storage', STORAGE_CHECK_STATE_FILE_NAME);
}

function getSharedCharactersDirectory() {
    return path.join(globalThis.DATA_ROOT, ...SHARED_CHARACTER_DIRECTORY);
}

function getStorageCheckDateKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}

function getEmptyStorageCheckState() {
    return {
        version: 1,
        emitted: {},
    };
}

function normalizeStorageCheckState(value) {
    const emitted = value?.emitted && typeof value.emitted === 'object' && !Array.isArray(value.emitted)
        ? value.emitted
        : {};

    return {
        version: 1,
        emitted,
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

function getUserCodeMap(state, userHandle) {
    const handle = String(userHandle || '').trim() || 'default-user';
    const emitted = state.emitted && typeof state.emitted === 'object' && !Array.isArray(state.emitted)
        ? state.emitted
        : {};

    if (!emitted[handle] || typeof emitted[handle] !== 'object' || Array.isArray(emitted[handle])) {
        emitted[handle] = {};
    }

    state.emitted = emitted;
    return emitted[handle];
}

function getDueStorageCheckCodes(evaluation, codeMap, dateKey) {
    const dueCodes = new Set();
    const items = [
        ...(evaluation.warnings || []),
        ...(evaluation.adminAlerts || []),
    ];

    for (const item of items) {
        const code = String(item?.code || '');

        if (code && codeMap[code] !== dateKey) {
            dueCodes.add(code);
        }
    }

    for (const code of dueCodes) {
        codeMap[code] = dateKey;
    }

    return dueCodes;
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
 * @param {{ chatBytes: number, imageBytes: number, characterBytes: number, sharedCharacterBytes: number }} sizes
 * @returns {{ warnings: object[], adminAlerts: object[] }}
 */
export function buildUserStorageCheckEvaluation(sizes) {
    const chatBytes = Number(sizes?.chatBytes) || 0;
    const imageBytes = Number(sizes?.imageBytes) || 0;
    const characterBytes = Number(sizes?.characterBytes) || 0;
    const sharedCharacterBytes = Number(sizes?.sharedCharacterBytes) || 0;
    const oneGb = STORAGE_CHECK_BYTES_PER_GB;
    const twoGb = STORAGE_CHECK_BYTES_PER_GB * 2;
    const warnings = [];
    const adminAlerts = [];

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
 * Applies once-per-day rate limiting to storage warnings and admin alerts.
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
        const codeMap = getUserCodeMap(state, userHandle);
        const dueCodes = getDueStorageCheckCodes(evaluation, codeMap, dateKey);
        const warnings = filterItemsByDueCodes(evaluation.warnings || [], dueCodes);
        const adminAlerts = filterItemsByDueCodes(evaluation.adminAlerts || [], dueCodes);

        await lock.run(async () => {
            await writeStorageCheckState(statePath, state);
        });

        return { warnings, adminAlerts };
    });
}

/**
 * Gets aggregate storage sizes used by the user storage check.
 * @param {import('./users.js').UserDirectoryList} directories User directories.
 * @param {{ sharedCharactersDirectory?: string }} [options]
 * @returns {Promise<{ chatBytes: number, imageBytes: number, characterBytes: number, sharedCharacterBytes: number }>}
 */
export async function getUserStorageCheckSizes(directories, options = {}) {
    const sharedCharactersDirectory = options.sharedCharactersDirectory || getSharedCharactersDirectory();
    const [chatsBytes, groupChatsBytes, imageBytes, characterBytes, sharedCharacterBytes] = await Promise.all([
        getRecursiveDirectorySize(directories.chats),
        getRecursiveDirectorySize(directories.groupChats),
        getRecursiveDirectorySize(directories.userImages),
        getRecursiveDirectorySize(directories.characters),
        getRecursiveDirectorySize(sharedCharactersDirectory),
    ]);

    return {
        chatBytes: chatsBytes + groupChatsBytes,
        imageBytes,
        characterBytes,
        sharedCharacterBytes,
    };
}

async function sendStorageCheckAdminAlerts(user, adminAlerts) {
    if (!adminAlerts.length) {
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
    const dueEvaluation = await filterDueUserStorageCheckEvaluation(userContext.profile.handle, evaluation);

    try {
        await sendStorageCheckAdminAlerts(userContext.profile, dueEvaluation.adminAlerts);
    } catch (error) {
        console.warn('Failed to send one or more storage check admin notifications.', error);
    }

    return {
        warnings: dueEvaluation.warnings,
    };
}
