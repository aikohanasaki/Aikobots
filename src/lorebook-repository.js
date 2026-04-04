import fs from 'node:fs';
import path from 'node:path';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getUserDirectories } from './users.js';

const SECURE_LOREBOOK_DIRECTORY = ['_secure', 'worlds'];
const SECURE_INDEX_FILENAME = 'index.json';
const SECURE_INDEX_LOCK_SUFFIX = '.lock';
const SECURE_INDEX_LOCK_RETRY_MS = 50;
const SECURE_INDEX_LOCK_TIMEOUT_MS = 10_000;
const SECURE_INDEX_LOCK_STALE_MS = 60_000;

export class LorebookRepositoryError extends Error {
    /**
     * @param {string} type
     * @param {string} message
     * @param {number} [status=400]
     */
    constructor(type, message, status = 400) {
        super(message);
        this.name = type;
        this.type = type;
        this.status = status;
    }
}

/**
 * @typedef {object} LorebookListItem
 * @property {string} name
 * @property {'user'|'secure'} storage
 * @property {string} ownerHandle
 * @property {boolean} canEdit
 * @property {boolean} canDelete
 * @property {boolean} canPromote
 * @property {boolean} canDemote
 */

function hasTrailingJsonExtension(name) {
    return /\.json$/i.test(String(name || '').trim());
}

function stripTrailingJsonExtension(name) {
    return String(name || '').replace(/\.json$/i, '');
}

function getCanonicalLorebookName(name) {
    const sanitizedName = sanitize(String(name || '').trim());
    return stripTrailingJsonExtension(sanitizedName);
}

function getLegacyLorebookName(canonicalName) {
    return canonicalName ? `${canonicalName}.json` : '';
}

function getLorebookPathFromCanonical(directory, canonicalName) {
    return path.join(directory, `${canonicalName}.json`);
}

function getLegacyLorebookPathFromCanonical(directory, canonicalName) {
    const legacyName = getLegacyLorebookName(canonicalName);
    return legacyName ? getLorebookPathFromCanonical(directory, legacyName) : '';
}

function normalizeSecureIndexBooks(books) {
    const sourceBooks = books && typeof books === 'object' && !Array.isArray(books) ? books : {};
    const normalizedBooks = {};

    for (const [name, metadata] of Object.entries(sourceBooks)) {
        if (hasTrailingJsonExtension(name)) {
            continue;
        }

        const canonicalName = getCanonicalLorebookName(name);
        if (!canonicalName) {
            continue;
        }

        normalizedBooks[canonicalName] = metadata;
    }

    for (const [name, metadata] of Object.entries(sourceBooks)) {
        if (!hasTrailingJsonExtension(name)) {
            continue;
        }

        const canonicalName = getCanonicalLorebookName(name);
        if (!canonicalName) {
            continue;
        }

        if (normalizedBooks[canonicalName]) {
            console.warn(`[Lorebooks] Found both canonical and legacy secure index entries for "${canonicalName}". Keeping the canonical entry.`);
            continue;
        }

        normalizedBooks[canonicalName] = metadata;
    }

    return normalizedBooks;
}

function ensureDirectory(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getSecureLorebookDirectory() {
    if (!globalThis.DATA_ROOT) {
        throw new Error('DATA_ROOT must be defined before using lorebook repository');
    }

    return ensureDirectory(path.join(globalThis.DATA_ROOT, ...SECURE_LOREBOOK_DIRECTORY));
}

function getSecureLorebookPath(name) {
    return getLorebookPathFromCanonical(getSecureLorebookDirectory(), getCanonicalLorebookName(name));
}

function getSecureIndexPath() {
    return path.join(getSecureLorebookDirectory(), SECURE_INDEX_FILENAME);
}

function getSecureIndexLockPath() {
    return `${getSecureIndexPath()}${SECURE_INDEX_LOCK_SUFFIX}`;
}

function getSecureIndexMetadata(name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        return null;
    }

    const index = readSecureIndex();
    const metadata = index.books[canonicalName];
    if (!metadata) {
        return null;
    }

    return {
        name: canonicalName,
        metadata,
        path: getSecureLorebookPath(canonicalName),
    };
}

function readJsonFileSync(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function tryReadJsonFileSync(filePath, fallbackValue, label) {
    try {
        return readJsonFileSync(filePath);
    } catch (error) {
        console.warn(`[Lorebooks] Failed to read ${label}: ${filePath}`, error);
        return fallbackValue;
    }
}

function readSecureIndex() {
    const indexPath = getSecureIndexPath();

    if (!fs.existsSync(indexPath)) {
        return { version: 1, books: {} };
    }

    try {
        const parsed = readJsonFileSync(indexPath);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const isValidBooks = parsed.books && typeof parsed.books === 'object' && !Array.isArray(parsed.books);
            return {
                version: Number(parsed.version) || 1,
                books: normalizeSecureIndexBooks(isValidBooks ? parsed.books : {}),
            };
        }
    } catch (error) {
        console.error('[Lorebooks] Failed to read secure lorebook index', error);
    }

    return { version: 1, books: {} };
}

function writeSecureIndex(index) {
    writeFileAtomicSync(getSecureIndexPath(), JSON.stringify(index, null, 4), 'utf8');
}

function repairLegacyLorebookFile(directory, canonicalName, label) {
    if (!canonicalName || !directory || !fs.existsSync(directory)) {
        return;
    }

    const canonicalPath = getLorebookPathFromCanonical(directory, canonicalName);
    const legacyPath = getLegacyLorebookPathFromCanonical(directory, canonicalName);
    if (!legacyPath || !fs.existsSync(legacyPath)) {
        return;
    }

    if (fs.existsSync(canonicalPath)) {
        console.warn(`[Lorebooks] Found both canonical and legacy ${label} files for "${canonicalName}". Leaving legacy file in place for manual cleanup.`);
        return;
    }

    fs.renameSync(legacyPath, canonicalPath);
}

function repairLegacyLorebookDirectory(directory, label) {
    if (!directory || !fs.existsSync(directory)) {
        return;
    }

    const legacyFiles = fs.readdirSync(directory).filter(file => /\.json\.json$/i.test(file));
    for (const file of legacyFiles) {
        const canonicalName = getCanonicalLorebookName(path.parse(file).name);
        if (!canonicalName) {
            continue;
        }

        repairLegacyLorebookFile(directory, canonicalName, label);
    }
}

function sleepSync(ms) {
    if (ms <= 0) {
        return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isSecureIndexLockStale(lockPath) {
    try {
        const stats = fs.statSync(lockPath);
        return Date.now() - stats.mtimeMs > SECURE_INDEX_LOCK_STALE_MS;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

function removeSecureIndexLock(lockPath) {
    try {
        fs.rmdirSync(lockPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }

        if (error?.code === 'ENOTEMPTY') {
            fs.rmSync(lockPath, { recursive: true, force: false });
            return;
        }

        throw error;
    }
}

function acquireSecureIndexWriteLock() {
    const lockPath = getSecureIndexLockPath();
    ensureDirectory(path.dirname(lockPath));
    const deadline = Date.now() + SECURE_INDEX_LOCK_TIMEOUT_MS;

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            return () => removeSecureIndexLock(lockPath);
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            if (isSecureIndexLockStale(lockPath)) {
                removeSecureIndexLock(lockPath);
                continue;
            }

            if (Date.now() >= deadline) {
                throw new LorebookRepositoryError('LorebookIndexBusy', 'Timed out waiting to update the secure lorebook index.', 503);
            }

            sleepSync(SECURE_INDEX_LOCK_RETRY_MS);
        }
    }
}

function mutateSecureIndex(mutate) {
    // Only writers acquire the lock so readers can continue to inspect the index.
    const release = acquireSecureIndexWriteLock();
    try {
        const index = readSecureIndex();
        const result = mutate(index);
        writeSecureIndex(index);
        return result;
    } finally {
        release();
    }
}

function createSecureLorebookSymlink(linkPath, targetPath, canonicalName) {
    ensureDirectory(path.dirname(linkPath));
    const relativeTargetPath = path.relative(path.dirname(linkPath), targetPath) || path.basename(targetPath);

    try {
        fs.symlinkSync(relativeTargetPath, linkPath, 'file');
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new LorebookRepositoryError('LorebookAlreadySecure', `Lorebook "${canonicalName}" already has a secure link.`, 409);
        }

        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
            const message = process.platform === 'win32'
                ? 'Could not create the secure lorebook link. On Windows, enable Developer Mode or run the server with permission to create symlinks.'
                : 'Could not create the secure lorebook link. Check filesystem permissions and symlink support.';
            throw new LorebookRepositoryError('LorebookSymlinkCreationFailed', message, 500);
        }

        throw error;
    }
}

function getSecureIndexEntry(name) {
    const secureEntry = getSecureIndexMetadata(name);
    if (!secureEntry) {
        return null;
    }

    const { name: canonicalName, metadata, path: filePath } = secureEntry;
    let stats;
    repairLegacyLorebookFile(getSecureLorebookDirectory(), canonicalName, 'secure lorebook');

    try {
        stats = fs.lstatSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`[Lorebooks] Failed to inspect secure lorebook "${canonicalName}"`, error);
        } else {
            console.warn(`[Lorebooks] Secure lorebook "${canonicalName}" is missing its symlink.`);
        }
        return null;
    }

    if (!stats.isSymbolicLink()) {
        console.warn(`[Lorebooks] Secure lorebook "${canonicalName}" is not stored as a symlink.`);
        return null;
    }

    try {
        fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
        console.warn(`[Lorebooks] Secure lorebook "${canonicalName}" points to an unreadable target.`, error);
        return null;
    }

    return {
        name: canonicalName,
        storage: 'secure',
        ownerHandle: String(metadata.ownerHandle || ''),
        createdAt: metadata.createdAt || null,
        updatedAt: metadata.updatedAt || null,
        createdBy: metadata.createdBy || null,
        updatedBy: metadata.updatedBy || null,
        path: filePath,
    };
}

function getUserLorebookPath(handle, name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        return '';
    }

    return getLorebookPathFromCanonical(getUserDirectories(handle).worlds, canonicalName);
}

function getUserLorebookRecord(handle, name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        return null;
    }

    const worldsDir = getUserDirectories(handle).worlds;
    repairLegacyLorebookFile(worldsDir, canonicalName, 'lorebook');
    const filePath = getLorebookPathFromCanonical(worldsDir, canonicalName);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: handle,
        path: filePath,
    };
}

function buildListItem(record, currentHandle, isAdmin) {
    const isSecure = record.storage === 'secure';
    const canManage = currentHandle === record.ownerHandle;
    const canManageSecure = isAdmin || canManage;
    return {
        name: record.name,
        storage: record.storage,
        ownerHandle: record.ownerHandle,
        canEdit: isSecure ? canManageSecure : canManage,
        canDelete: !isSecure && canManage,
        canPromote: !isSecure && canManage,
        canDemote: isSecure && canManageSecure,
    };
}

function canManageSecureLorebook(user, record) {
    return Boolean(user?.profile?.admin) || record.ownerHandle === user?.profile?.handle;
}

function assertCanonicalName(name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        throw new LorebookRepositoryError('LorebookInvalidName', 'Lorebook must have a valid name.', 400);
    }

    return canonicalName;
}

function assertLorebookSaveNameAllowed(name) {
    if (hasTrailingJsonExtension(name)) {
        throw new LorebookRepositoryError('LorebookInvalidName', 'World/Lorebook names must not end with ".json". Enter the name without the file extension.', 400);
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertLorebookData(data, name) {
    if (!isPlainObject(data) || !isPlainObject(data.entries)) {
        throw new LorebookRepositoryError('LorebookInvalidData', `Lorebook "${name}" must be an object with an entries map.`, 400);
    }
}

function readLorebookFromRecord(record, allowDummy) {
    const dummyObject = allowDummy ? { entries: {} } : null;
    if (!record?.path) {
        return dummyObject;
    }

    if (!fs.existsSync(record.path)) {
        return dummyObject;
    }

    return tryReadJsonFileSync(record.path, dummyObject, 'lorebook file');
}

function assertSecureNameAvailableForPromotion(name) {
    const secureEntry = getSecureIndexMetadata(name);
    if (secureEntry) {
        throw new LorebookRepositoryError('LorebookAlreadySecure', `Lorebook "${name}" is already secure.`, 409);
    }
}

function assertSecurePromotionNameAllowed(user, canonicalName) {
    if (user?.profile?.admin) {
        if (!canonicalName.startsWith('9Z')) {
            throw new LorebookRepositoryError('LorebookNameInvalid', 'Admin secure lorebooks must start with "9Z". Capitalization matters.', 400);
        }
        return;
    }

    const requiredPrefix = `Z-${user?.profile?.handle || ''}-`;
    if (!canonicalName.startsWith(requiredPrefix) || canonicalName.length <= requiredPrefix.length) {
        throw new LorebookRepositoryError('LorebookNameInvalid', `Secure lorebooks must start with "${requiredPrefix}". Use your username. Capitalization must match exactly.`, 400);
    }
}

function writeSecureLorebookMetadata(name, ownerHandle, actorHandle, existingMetadata = null) {
    const timestamp = new Date().toISOString();
    const canonicalName = assertCanonicalName(name);
    mutateSecureIndex(index => {
        index.books[canonicalName] = {
            ownerHandle,
            createdAt: existingMetadata?.createdAt || timestamp,
            updatedAt: timestamp,
            createdBy: existingMetadata?.createdBy || actorHandle,
            updatedBy: actorHandle,
        };
    });
}

function createSecureLorebookLink(name, ownerHandle) {
    const canonicalName = assertCanonicalName(name);
    const targetPath = getUserLorebookPath(ownerHandle, canonicalName);
    const linkPath = getSecureLorebookPath(canonicalName);

    if (!targetPath || !fs.existsSync(targetPath)) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    createSecureLorebookSymlink(linkPath, targetPath, canonicalName);
}

function removeSecureLorebook(name) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getSecureLorebookPath(canonicalName);
    const removedMetadata = mutateSecureIndex(index => {
        const metadata = index.books[canonicalName] || null;
        delete index.books[canonicalName];
        return metadata;
    });

    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }

        try {
            if (removedMetadata) {
                mutateSecureIndex(index => {
                    index.books[canonicalName] = removedMetadata;
                });
            }
        } catch (restoreError) {
            console.error(`[Lorebooks] Failed to restore secure lorebook index entry for "${canonicalName}" after demotion failed.`, restoreError);
            throw new LorebookRepositoryError('LorebookStateRepairFailed', `Failed to demote secure lorebook "${canonicalName}" cleanly. Manual repair may be required.`, 500);
        }

        throw error;
    }
}

function writeUserLorebook(handle, name, data) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getUserLorebookPath(handle, canonicalName);
    ensureDirectory(path.dirname(filePath));
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

export function readWorldInfoFile(directories, worldInfoName, allowDummy) {
    const dummyObject = allowDummy ? { entries: {} } : null;
    const canonicalName = getCanonicalLorebookName(worldInfoName);

    if (!canonicalName) {
        return dummyObject;
    }

    repairLegacyLorebookFile(directories.worlds, canonicalName, 'world info');
    const filePath = getLorebookPathFromCanonical(directories.worlds, canonicalName);
    if (!fs.existsSync(filePath)) {
        return dummyObject;
    }

    return tryReadJsonFileSync(filePath, dummyObject, 'world info file');
}

/**
 * @param {import('./users.js').User} user
 * @returns {LorebookListItem[]}
 */
export function listLorebooksForManagement(user) {
    const currentHandle = user.profile.handle;
    const isAdmin = Boolean(user.profile.admin);
    const items = [];
    const seenNames = new Set();
    const worldsDir = user.directories.worlds;
    const secureIndex = readSecureIndex();
    const secureRecords = new Map();

    for (const name of Object.keys(secureIndex.books)) {
        const secureRecord = getSecureIndexEntry(name);

        if (!secureRecord) {
            continue;
        }

        secureRecords.set(name, secureRecord);
    }

    if (fs.existsSync(worldsDir)) {
        repairLegacyLorebookDirectory(worldsDir, 'lorebook');
        const worldFiles = fs.readdirSync(worldsDir)
            .filter(file => path.extname(file).toLowerCase() === '.json')
            .sort((a, b) => a.localeCompare(b));

        for (const file of worldFiles) {
            const name = path.parse(file).name;
            const secureRecord = secureRecords.get(name);
            const effectiveRecord = secureRecord?.ownerHandle === currentHandle
                ? secureRecord
                : {
                    name,
                    storage: 'user',
                    ownerHandle: currentHandle,
                };

            items.push(buildListItem(effectiveRecord, currentHandle, isAdmin));
            seenNames.add(name);
        }
    }

    if (isAdmin) {
        for (const [name, secureRecord] of secureRecords.entries()) {
            if (seenNames.has(name)) {
                if (secureRecord.ownerHandle !== currentHandle) {
                    console.error(`[Lorebooks] Lorebook name conflict "${name}" exists in both local storage and secure storage owned by "${secureRecord.ownerHandle}".`);
                }
                continue;
            }

            items.push(buildListItem(secureRecord, currentHandle, isAdmin));
            seenNames.add(name);
        }
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {boolean} [allowDummy=false]
 * @param {'user'|'secure'|null} [storage=null] Preferred storage location to read from
 */
export function getLorebookForManagement(user, name, allowDummy = false, storage = null) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);
    const preferredStorage = storage === 'secure' ? 'secure' : (storage === 'user' ? 'user' : null);
    const shouldUseSecure = preferredStorage === 'secure' || (!preferredStorage && secureRecord);

    if (shouldUseSecure) {
        if (!secureRecord || !canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        return {
            data: readLorebookFromRecord(secureRecord, allowDummy),
            metadata: {
                name: secureRecord.name,
                storage: 'secure',
                ownerHandle: secureRecord.ownerHandle,
            },
        };
    }

    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    if (!userRecord) {
        if (allowDummy) {
            return {
                data: { entries: {} },
                metadata: {
                    name: canonicalName,
                    storage: 'user',
                    ownerHandle: user.profile.handle,
                },
            };
        }

        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    return {
        data: readLorebookFromRecord(userRecord, allowDummy),
        metadata: {
            name: userRecord.name,
            storage: 'user',
            ownerHandle: userRecord.ownerHandle,
        },
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {boolean} [allowDummy=false]
 */
export function readLorebookForGenerationWithMetadata(user, name, allowDummy = false) {
    const canonicalName = getCanonicalLorebookName(name);
    const dummyObject = allowDummy ? { entries: {} } : null;

    if (!canonicalName) {
        return {
            data: dummyObject,
            metadata: null,
        };
    }

    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    if (userRecord) {
        return {
            data: readLorebookFromRecord(userRecord, allowDummy),
            metadata: {
                name: userRecord.name,
                storage: 'user',
                ownerHandle: userRecord.ownerHandle,
            },
        };
    }

    const secureRecord = getSecureIndexEntry(canonicalName);
    return {
        data: readLorebookFromRecord(secureRecord, allowDummy),
        metadata: secureRecord ? {
            name: secureRecord.name,
            storage: 'secure',
            ownerHandle: secureRecord.ownerHandle,
        } : {
            name: canonicalName,
            storage: 'user',
            ownerHandle: user.profile.handle,
        },
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {boolean} [allowDummy=false]
 */
export function readLorebookForGeneration(user, name, allowDummy = false) {
    return readLorebookForGenerationWithMetadata(user, name, allowDummy).data;
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @returns {boolean}
 */
export function hasLorebookForGeneration(user, name) {
    const canonicalName = getCanonicalLorebookName(name);

    if (!canonicalName) {
        return false;
    }

    return Boolean(
        getUserLorebookRecord(user.profile.handle, canonicalName) ||
        getSecureIndexEntry(canonicalName),
    );
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {object} data
 * @param {'user'|'secure'} [storage='user'] Target storage location for the save
 */
export function saveLorebookForManagement(user, name, data, storage = 'user') {
    assertLorebookSaveNameAllowed(name);
    const canonicalName = assertCanonicalName(name);
    assertLorebookData(data, canonicalName);
    const secureRecord = getSecureIndexEntry(canonicalName);
    const preferredStorage = storage === 'secure' ? 'secure' : 'user';

    if (preferredStorage === 'secure') {
        if (!secureRecord || !canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        writeUserLorebook(secureRecord.ownerHandle, canonicalName, data);
        writeSecureLorebookMetadata(canonicalName, secureRecord.ownerHandle, user.profile.handle, secureRecord);
        return {
            name: canonicalName,
            storage: 'secure',
            ownerHandle: secureRecord.ownerHandle,
        };
    }

    writeUserLorebook(user.profile.handle, canonicalName, data);
    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: user.profile.handle,
        // True when an admin saves a user-storage lorebook that shadows another user's secure lorebook.
        shadowingSecure: Boolean(secureRecord && secureRecord.ownerHandle !== user.profile.handle && canManageSecureLorebook(user, secureRecord)),
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export function deleteLorebookForManagement(user, name) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);

    if (secureRecord) {
        if (!canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not deletable.`, 403);
        }

        throw new LorebookRepositoryError('LorebookAccessDenied', `Secure lorebook "${canonicalName}" must be demoted before deletion.`, 403);
    }

    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    if (!userRecord) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    try {
        fs.unlinkSync(userRecord.path);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        throw new LorebookRepositoryError('LorebookDeleteFailed', `Failed to delete lorebook "${canonicalName}".`, 500);
    }

    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: user.profile.handle,
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export function promoteLorebook(user, name) {
    const canonicalName = assertCanonicalName(name);
    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    if (!userRecord) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    assertSecurePromotionNameAllowed(user, canonicalName);
    assertSecureNameAvailableForPromotion(canonicalName);

    createSecureLorebookLink(canonicalName, user.profile.handle);
    try {
        writeSecureLorebookMetadata(canonicalName, user.profile.handle, user.profile.handle);
    } catch (error) {
        try {
            fs.unlinkSync(getSecureLorebookPath(canonicalName));
        } catch (cleanupError) {
            if (cleanupError?.code !== 'ENOENT') {
                console.error(`[Lorebooks] Failed to remove secure lorebook link for "${canonicalName}" after promotion metadata write failed.`, cleanupError);
                throw new LorebookRepositoryError('LorebookStateRepairFailed', `Failed to promote secure lorebook "${canonicalName}" cleanly. Manual repair may be required.`, 500);
            }
        }

        throw error;
    }

    return {
        name: canonicalName,
        storage: 'secure',
        ownerHandle: user.profile.handle,
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export function demoteLorebook(user, name) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);

    if (!secureRecord) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    if (!canManageSecureLorebook(user, secureRecord)) {
        throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not movable.`, 403);
    }

    removeSecureLorebook(canonicalName);

    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: secureRecord.ownerHandle,
    };
}
