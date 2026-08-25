import fs from 'node:fs';
import path from 'node:path';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { write as writeCharacterCard, read as readCharacterCard } from './character-card-parser.js';
import { SETTINGS_FILE } from './constants.js';
import { migrateHiddenLorebookBindingReferences } from './hidden-lorebook-bindings.js';
import {
    compileAndWriteHiddenLorebookTemplates,
    isHiddenLorebookCompilationPending,
    migrateHiddenLorebookTemplateReferences,
} from './hidden-lorebook-templates.js';
import { getUserDirectories } from './users.js';
import { assertPathUnderParent, hasUnsafePathSegment } from './path-security.js';
import { withDirectoryLock } from './file-system-lock.js';
import { getDeduplicatedChatHistoryFileNames } from './chat-paths.js';
import { replaceChatStorageExtension, withChatSaveLock } from './chat-storage.js';
import { getChatHeader, loadDb } from './sqlite-manager.js';
import { isReservedRecommendedTemplateSource } from './recommended-chat-template-store.js';

const SECURE_LOREBOOK_DIRECTORY = ['_secure', 'worlds'];
const SHARED_SECURE_LOREBOOK_DIRECTORY = ['_secure', 'shared-worlds'];
const SECURE_DELETE_MARKER_DIRECTORY = ['_secure', 'delete-markers'];
const SECURE_INDEX_FILENAME = 'index.json';
const SHARED_SECURE_INDEX_FILENAME = 'index.json';
const SECURE_INDEX_LOCK_SUFFIX = '.lock';
const SECURE_INDEX_LOCK_STALE_MS = 60_000;
let secureLorebookMutationQueue = Promise.resolve();
const LOREBOOK_MUTATION_LOCK_RETRY_MS = 50;
const LOREBOOK_MUTATION_LOCK_TIMEOUT_MS = 30_000;
const LOREBOOK_MUTATION_LOCK_STALE_MS = 120_000;
const LOREBOOK_MUTATION_LOCK_HEARTBEAT_MS = 10_000;

export class LorebookRepositoryError extends Error {
    /**
     * @param {string} type
     * @param {string} message
     * @param {number} [status=400]
     * @param {Record<string, any>|null} [details=null]
     */
    constructor(type, message, status = 400, details = null) {
        super(message);
        this.name = type;
        this.type = type;
        this.status = status;
        this.details = details;
    }
}

function runWithSecureLorebookMutationLock(operation) {
    const queuedOperation = secureLorebookMutationQueue.catch(() => { }).then(async () => {
        if (!globalThis.DATA_ROOT) {
            throw new Error('DATA_ROOT must be defined before mutating lorebooks');
        }
        return await withDirectoryLock({
            lockPath: path.join(globalThis.DATA_ROOT, '_locks', 'lorebooks.mutation.lock'),
            retryMs: LOREBOOK_MUTATION_LOCK_RETRY_MS,
            timeoutMs: LOREBOOK_MUTATION_LOCK_TIMEOUT_MS,
            staleMs: LOREBOOK_MUTATION_LOCK_STALE_MS,
            heartbeatMs: LOREBOOK_MUTATION_LOCK_HEARTBEAT_MS,
            timeoutMessage: 'Timed out waiting for the lorebook mutation lock.',
        }, operation);
    });
    secureLorebookMutationQueue = queuedOperation.catch(() => { });
    return queuedOperation;
}

/**
 * @typedef {object} LorebookListItem
 * @property {string} name
 * @property {'user'|'secure'} storage
 * @property {string} ownerHandle
 * @property {string[]} [ownerHandles]
 * @property {'single'|'shared'} [sharingMode]
 * @property {string|null} [checkedOutBy]
 * @property {string|null} [checkedOutAt]
 * @property {'available'|'self'|'other'} [checkoutState]
 * @property {boolean} canEdit
 * @property {boolean} canDelete
 * @property {boolean} canPromote
 * @property {boolean} canDemote
 * @property {boolean} [canCheckOut]
 * @property {boolean} [canCheckIn]
 * @property {boolean} [canForceCheckout]
 * @property {boolean} [canManageOwners]
 */

function hasTrailingJsonExtension(name) {
    return /\.json$/i.test(String(name || '').trim());
}

function stripTrailingJsonExtension(name) {
    return String(name || '').replace(/\.json$/i, '');
}

export function getCanonicalLorebookName(name) {
    const sanitizedName = sanitize(String(name || '').trim());
    return stripTrailingJsonExtension(sanitizedName);
}

function getLegacyLorebookName(canonicalName) {
    return canonicalName ? `${canonicalName}.json` : '';
}

function getLorebookPathFromCanonical(directory, canonicalName) {
    return assertPathUnderParent(directory, path.join(directory, `${canonicalName}.json`), 'lorebook');
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

function normalizeOwnerHandles(ownerHandles) {
    return [...new Set((Array.isArray(ownerHandles) ? ownerHandles : [])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
}

function getPrimaryOwnerHandle(ownerHandles) {
    return normalizeOwnerHandles(ownerHandles)[0] || '';
}

function normalizeSharedSecureIndexBooks(books) {
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

        const owners = normalizeOwnerHandles(metadata?.owners);
        if (!owners.length) {
            continue;
        }

        normalizedBooks[canonicalName] = {
            owners,
            createdAt: metadata?.createdAt || null,
            updatedAt: metadata?.updatedAt || null,
            createdBy: metadata?.createdBy || null,
            updatedBy: metadata?.updatedBy || null,
            checkedOutBy: String(metadata?.checkedOutBy || '').trim() || null,
            checkedOutAt: metadata?.checkedOutAt || null,
        };
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

function getSharedSecureLorebookDirectory() {
    if (!globalThis.DATA_ROOT) {
        throw new Error('DATA_ROOT must be defined before using lorebook repository');
    }

    return ensureDirectory(path.join(globalThis.DATA_ROOT, ...SHARED_SECURE_LOREBOOK_DIRECTORY));
}

function getSecureDeleteMarkerDirectory() {
    if (!globalThis.DATA_ROOT) {
        throw new Error('DATA_ROOT must be defined before using lorebook repository');
    }

    return ensureDirectory(path.join(globalThis.DATA_ROOT, ...SECURE_DELETE_MARKER_DIRECTORY));
}

function getSecureLorebookPath(name) {
    return getLorebookPathFromCanonical(getSecureLorebookDirectory(), getCanonicalLorebookName(name));
}

function getSharedSecureLorebookPath(name) {
    return getLorebookPathFromCanonical(getSharedSecureLorebookDirectory(), getCanonicalLorebookName(name));
}

function getSecureDeleteMarkerPath(name) {
    return getLorebookPathFromCanonical(getSecureDeleteMarkerDirectory(), getCanonicalLorebookName(name));
}

function getSecureIndexPath() {
    return path.join(getSecureLorebookDirectory(), SECURE_INDEX_FILENAME);
}

function getSharedSecureIndexPath() {
    return path.join(getSharedSecureLorebookDirectory(), SHARED_SECURE_INDEX_FILENAME);
}

function getSecureIndexLockPath() {
    return `${getSecureIndexPath()}${SECURE_INDEX_LOCK_SUFFIX}`;
}

function getSharedSecureIndexLockPath() {
    return `${getSharedSecureIndexPath()}${SECURE_INDEX_LOCK_SUFFIX}`;
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

function getSharedSecureIndexMetadata(name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        return null;
    }

    const index = readSharedSecureIndex();
    const metadata = index.books[canonicalName];
    if (!metadata) {
        return null;
    }

    return {
        name: canonicalName,
        metadata,
        path: getSharedSecureLorebookPath(canonicalName),
    };
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

function readSharedSecureIndex() {
    const indexPath = getSharedSecureIndexPath();

    if (!fs.existsSync(indexPath)) {
        return { version: 1, books: {} };
    }

    try {
        const parsed = readJsonFileSync(indexPath);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const isValidBooks = parsed.books && typeof parsed.books === 'object' && !Array.isArray(parsed.books);
            return {
                version: Number(parsed.version) || 1,
                books: normalizeSharedSecureIndexBooks(isValidBooks ? parsed.books : {}),
            };
        }
    } catch (error) {
        console.error('[Lorebooks] Failed to read shared secure lorebook index', error);
    }

    return { version: 1, books: {} };
}

function writeSecureIndex(index) {
    writeFileAtomicSync(getSecureIndexPath(), JSON.stringify(index, null, 4), 'utf8');
}

function writeSharedSecureIndex(index) {
    writeFileAtomicSync(getSharedSecureIndexPath(), JSON.stringify(index, null, 4), 'utf8');
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

function acquireIndexWriteLock(lockPath) {
    ensureDirectory(path.dirname(lockPath));

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

            throw new LorebookRepositoryError('LorebookIndexBusy', 'The secure lorebook index is busy. Retry the request shortly.', 503);
        }
    }
}

function acquireSecureIndexWriteLock() {
    return acquireIndexWriteLock(getSecureIndexLockPath());
}

function acquireSharedSecureIndexWriteLock() {
    return acquireIndexWriteLock(getSharedSecureIndexLockPath());
}

function mutateIndex({ readIndex, writeIndex, acquireLock, mutate }) {
    const release = acquireLock();
    try {
        const index = readIndex();
        const result = mutate(index);
        writeIndex(index);
        return result;
    } finally {
        release();
    }
}

function mutateSecureIndex(mutate) {
    return mutateIndex({
        readIndex: readSecureIndex,
        writeIndex: writeSecureIndex,
        acquireLock: acquireSecureIndexWriteLock,
        mutate,
    });
}

function mutateSharedSecureIndex(mutate) {
    return mutateIndex({
        readIndex: readSharedSecureIndex,
        writeIndex: writeSharedSecureIndex,
        acquireLock: acquireSharedSecureIndexWriteLock,
        mutate,
    });
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

    const { name: canonicalName, metadata } = secureEntry;
    let filePath = secureEntry.path;
    let usingBackingFile = false;
    let stats;
    repairLegacyLorebookFile(getSecureLorebookDirectory(), canonicalName, 'secure lorebook');

    try {
        stats = fs.lstatSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn('[Lorebooks] Failed to inspect a secure lorebook link.');
            return null;
        }

        const ownerHandle = String(metadata.ownerHandle || '').trim();
        const backingPath = ownerHandle ? getUserLorebookPath(ownerHandle, canonicalName) : '';
        try {
            stats = backingPath ? fs.statSync(backingPath) : null;
            if (!stats?.isFile()) {
                return null;
            }
            fs.accessSync(backingPath, fs.constants.R_OK);
            filePath = backingPath;
            usingBackingFile = true;
        } catch {
            return null;
        }
    }

    if (!usingBackingFile && !stats.isSymbolicLink()) {
        console.warn('[Lorebooks] A secure lorebook link is not a symbolic link.');
        return null;
    }

    if (!usingBackingFile) {
        try {
            fs.accessSync(filePath, fs.constants.R_OK);
        } catch {
            console.warn('[Lorebooks] A secure lorebook link points to an unreadable target.');
            return null;
        }
    }

    return {
        name: canonicalName,
        storage: 'secure',
        sharingMode: 'single',
        ownerHandle: String(metadata.ownerHandle || ''),
        ownerHandles: [String(metadata.ownerHandle || '')].filter(Boolean),
        createdAt: metadata.createdAt || null,
        updatedAt: metadata.updatedAt || null,
        createdBy: metadata.createdBy || null,
        updatedBy: metadata.updatedBy || null,
        checkedOutBy: null,
        checkedOutAt: null,
        path: filePath,
    };
}

function getSharedSecureIndexEntry(name) {
    const sharedEntry = getSharedSecureIndexMetadata(name);
    if (!sharedEntry) {
        return null;
    }

    const { name: canonicalName, metadata, path: filePath } = sharedEntry;
    let stats;
    repairLegacyLorebookFile(getSharedSecureLorebookDirectory(), canonicalName, 'shared secure lorebook');

    try {
        stats = fs.statSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`[Lorebooks] Failed to inspect shared secure lorebook "${canonicalName}"`, error);
        } else {
            console.warn(`[Lorebooks] Shared secure lorebook "${canonicalName}" is missing its backing file.`);
        }
        return null;
    }

    if (!stats.isFile()) {
        console.warn(`[Lorebooks] Shared secure lorebook "${canonicalName}" is not stored as a file.`);
        return null;
    }

    try {
        fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
        console.warn(`[Lorebooks] Shared secure lorebook "${canonicalName}" is unreadable.`, error);
        return null;
    }

    const ownerHandles = normalizeOwnerHandles(metadata.owners);
    return {
        name: canonicalName,
        storage: 'secure',
        sharingMode: 'shared',
        ownerHandle: getPrimaryOwnerHandle(ownerHandles),
        ownerHandles,
        createdAt: metadata.createdAt || null,
        updatedAt: metadata.updatedAt || null,
        createdBy: metadata.createdBy || null,
        updatedBy: metadata.updatedBy || null,
        checkedOutBy: String(metadata.checkedOutBy || '').trim() || null,
        checkedOutAt: metadata.checkedOutAt || null,
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

function findUserLorebookFile(directory, name) {
    const requestedName = stripTrailingJsonExtension(String(name || ''));
    if (!requestedName || !directory || !fs.existsSync(directory)) {
        return null;
    }

    const canonicalName = getCanonicalLorebookName(requestedName);
    if (canonicalName) {
        repairLegacyLorebookFile(directory, canonicalName, 'lorebook');
    }

    const worldFiles = fs.readdirSync(directory)
        .filter(file => path.extname(file).toLowerCase() === '.json');

    const exactMatch = worldFiles.find(file => path.parse(file).name === requestedName);
    if (exactMatch) {
        return {
            name: path.parse(exactMatch).name,
            path: path.join(directory, exactMatch),
        };
    }

    if (!canonicalName) {
        return null;
    }

    const canonicalMatch = worldFiles.find(file => getCanonicalLorebookName(path.parse(file).name) === canonicalName);
    if (!canonicalMatch) {
        return null;
    }

    return {
        name: path.parse(canonicalMatch).name,
        path: path.join(directory, canonicalMatch),
    };
}

function getUserLorebookRecord(handle, name) {
    const worldsDir = getUserDirectories(handle).worlds;
    const matchedLorebook = findUserLorebookFile(worldsDir, name);
    if (!matchedLorebook) {
        return null;
    }

    return {
        name: matchedLorebook.name,
        storage: 'user',
        sharingMode: 'single',
        ownerHandle: handle,
        ownerHandles: [handle].filter(Boolean),
        checkedOutBy: null,
        checkedOutAt: null,
        path: matchedLorebook.path,
    };
}

function getCheckoutState(user, record) {
    if (record?.sharingMode !== 'shared') {
        return 'available';
    }

    const currentHandle = String(user?.profile?.handle || '').trim();
    const checkedOutBy = String(record?.checkedOutBy || '').trim();
    if (!checkedOutBy) {
        return 'available';
    }

    return checkedOutBy === currentHandle ? 'self' : 'other';
}

function isSharedLorebookCheckedOutByUser(user, record) {
    return getCheckoutState(user, record) === 'self';
}

function buildLorebookMetadata(record, user = null) {
    const ownerHandles = normalizeOwnerHandles(record?.ownerHandles || [record?.ownerHandle]);
    const sharingMode = record?.sharingMode === 'shared' ? 'shared' : 'single';
    const checkoutState = getCheckoutState(user, record);
    const isAdmin = Boolean(user?.profile?.admin);
    const canManageSecure = record?.storage === 'secure' ? canManageSecureLorebook(user, record) : false;

    return {
        name: record?.name || '',
        storage: record?.storage === 'secure' ? 'secure' : 'user',
        ownerHandle: getPrimaryOwnerHandle(ownerHandles) || String(record?.ownerHandle || '').trim(),
        ownerHandles,
        sharingMode,
        checkedOutBy: sharingMode === 'shared' ? (String(record?.checkedOutBy || '').trim() || null) : null,
        checkedOutAt: sharingMode === 'shared' ? (record?.checkedOutAt || null) : null,
        checkoutState,
        canCheckOut: sharingMode === 'shared' && canManageSecure && checkoutState !== 'self',
        canCheckIn: sharingMode === 'shared' && checkoutState === 'self',
        canForceCheckout: sharingMode === 'shared' && isAdmin && checkoutState === 'other',
        canManageOwners: sharingMode === 'shared' && canManageSecure && checkoutState === 'self',
    };
}

function buildListItem(record, user) {
    const currentHandle = String(user?.profile?.handle || '').trim();
    const isSecure = record.storage === 'secure';
    const canManage = currentHandle === record.ownerHandle;
    const canManageSecure = canManageSecureLorebook(user, record);
    const isShared = record.sharingMode === 'shared';
    const canMutateShared = isSharedLorebookCheckedOutByUser(user, record);
    const metadata = buildLorebookMetadata(record, user);
    const reservedTemplate = !isSecure && isReservedRecommendedTemplateSource(currentHandle, record.name);
    return {
        name: record.name,
        storage: record.storage,
        ownerHandle: metadata.ownerHandle,
        ownerHandles: metadata.ownerHandles,
        sharingMode: metadata.sharingMode,
        checkedOutBy: metadata.checkedOutBy,
        checkedOutAt: metadata.checkedOutAt,
        checkoutState: metadata.checkoutState,
        canEdit: isSecure ? (isShared ? canMutateShared : canManageSecure) : canManage,
        canDelete: reservedTemplate ? false : (isSecure ? (isShared ? canMutateShared : canManageSecure) : canManage),
        canPromote: !reservedTemplate && !isSecure && canManage,
        canDemote: isSecure && !isShared && canManageSecure,
        canCheckOut: metadata.canCheckOut,
        canCheckIn: metadata.canCheckIn,
        canForceCheckout: metadata.canForceCheckout,
        canManageOwners: metadata.canManageOwners && (isShared ? canMutateShared : false),
        reservedTemplate,
    };
}

function canManageSecureLorebook(user, record) {
    if (!record || record.storage !== 'secure') {
        return false;
    }

    if (user?.profile?.admin) {
        return true;
    }

    const handle = String(user?.profile?.handle || '').trim();
    if (!handle) {
        return false;
    }

    if (record.sharingMode === 'shared') {
        return normalizeOwnerHandles(record.ownerHandles).includes(handle);
    }

    return record.ownerHandle === handle;
}

function assertCanonicalName(name) {
    if (hasUnsafePathSegment(name)) {
        throw new LorebookRepositoryError('LorebookInvalidName', 'Lorebook name must not contain path separators or traversal.', 400);
    }

    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        throw new LorebookRepositoryError('LorebookInvalidName', 'Lorebook must have a valid name.', 400);
    }

    return canonicalName;
}

function assertLorebookSaveNameAllowed(name) {
    if (hasUnsafePathSegment(name)) {
        throw new LorebookRepositoryError('LorebookInvalidName', 'World/Lorebook names must not contain path separators or traversal.', 400);
    }

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
    const sharedEntry = getSharedSecureIndexMetadata(name);
    if (secureEntry || sharedEntry) {
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
        throw new LorebookRepositoryError('LorebookNameInvalid', `Name must start with "${requiredPrefix}" and include at least one character after it.`, 400);
    }
}

function assertLorebookNotReservedAsTemplate(user, canonicalName) {
    if (isReservedRecommendedTemplateSource(user?.profile?.handle, canonicalName)) {
        throw new LorebookRepositoryError(
            'LorebookReservedForTemplate',
            'This lorebook is designated as a Recommended Chat Setup template. Select another template or None before changing it.',
            409,
        );
    }
}

function assertSharedSecurePromotionNameAllowed(canonicalName) {
    if (!canonicalName.startsWith('Y-') || canonicalName.length <= 2) {
        throw new LorebookRepositoryError('LorebookNameInvalid', 'Name must start with "Y-" and include at least one character after it.', 400);
    }
}


function assertUserLorebookNameAvailable(canonicalName) {
    const secureRecord = getSecureIndexEntry(canonicalName);
    const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
    if (secureRecord || sharedSecureRecord) {
        throw new LorebookRepositoryError('LorebookAlreadyExists', `Lorebook "${canonicalName}" already exists in secure storage.`, 409);
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

function writeSharedSecureLorebookMetadata(name, ownerHandles, actorHandle, existingMetadata = null) {
    const timestamp = new Date().toISOString();
    const canonicalName = assertCanonicalName(name);
    const normalizedOwners = normalizeOwnerHandles(ownerHandles);

    if (normalizedOwners.length < 2) {
        throw new LorebookRepositoryError('LorebookOwnersInvalid', 'Shared secure lorebooks must have at least two owners.', 400);
    }

    mutateSharedSecureIndex(index => {
        const nextCheckedOutBy = String(existingMetadata?.checkedOutBy || '').trim() || null;
        const preserveCheckout = nextCheckedOutBy && normalizedOwners.includes(nextCheckedOutBy);
        index.books[canonicalName] = {
            owners: normalizedOwners,
            createdAt: existingMetadata?.createdAt || timestamp,
            updatedAt: timestamp,
            createdBy: existingMetadata?.createdBy || actorHandle,
            updatedBy: actorHandle,
            checkedOutBy: preserveCheckout ? nextCheckedOutBy : null,
            checkedOutAt: preserveCheckout ? (existingMetadata?.checkedOutAt || timestamp) : null,
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
        const metadataMissing = !getSecureIndexMetadata(canonicalName);
        const fileMissing = !fs.existsSync(filePath);
        if (metadataMissing && fileMissing) {
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

function removeSharedSecureLorebook(name) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getSharedSecureLorebookPath(canonicalName);
    const removedMetadata = mutateSharedSecureIndex(index => {
        const metadata = index.books[canonicalName] || null;
        delete index.books[canonicalName];
        return metadata;
    });

    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        const metadataMissing = !getSharedSecureIndexMetadata(canonicalName);
        const fileMissing = !fs.existsSync(filePath);
        if (metadataMissing && fileMissing) {
            return;
        }

        try {
            if (removedMetadata) {
                mutateSharedSecureIndex(index => {
                    index.books[canonicalName] = removedMetadata;
                });
            }
        } catch (restoreError) {
            console.error(`[Lorebooks] Failed to restore shared secure lorebook index entry for "${canonicalName}" after deletion failed.`, restoreError);
            throw new LorebookRepositoryError('LorebookStateRepairFailed', `Failed to delete shared secure lorebook "${canonicalName}" cleanly. Manual repair may be required.`, 500);
        }

        throw error;
    }
}

function removeUserLorebookCopy(handle, name) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getUserLorebookPath(handle, canonicalName);
    if (!filePath || !fs.existsSync(filePath)) {
        return false;
    }

    try {
        fs.unlinkSync(filePath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        if (!fs.existsSync(filePath)) {
            return true;
        }

        throw new LorebookRepositoryError('LorebookDeleteFailed', `Failed to delete lorebook "${canonicalName}" for user "${handle}".`, 500);
    }
}

function sanitizeLorebookDataForStorage(data) {
    const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return { ...source };
}

function inspectLorebookCopyState(name, userHandles = []) {
    const canonicalName = assertCanonicalName(name);
    const normalizedUserHandles = [...new Set((Array.isArray(userHandles) ? userHandles : []).map(handle => String(handle || '').trim()).filter(Boolean))];
    const secureMetadata = getSecureIndexMetadata(canonicalName);
    const sharedMetadata = getSharedSecureIndexMetadata(canonicalName);
    const securePath = getSecureLorebookPath(canonicalName);
    const sharedPath = getSharedSecureLorebookPath(canonicalName);

    return {
        securePresent: Boolean(secureMetadata || fs.existsSync(securePath)),
        sharedPresent: Boolean(sharedMetadata || fs.existsSync(sharedPath)),
        userHandlesWithCopies: normalizedUserHandles.filter(handle => {
            const userPath = getUserLorebookPath(handle, canonicalName);
            return Boolean(userPath && fs.existsSync(userPath));
        }),
    };
}

function hasAnyLorebookCopies(state) {
    return Boolean(state?.securePresent || state?.sharedPresent || (Array.isArray(state?.userHandlesWithCopies) && state.userHandlesWithCopies.length > 0));
}

function doesLorebookReferenceMatch(reference, canonicalName) {
    return getCanonicalLorebookName(reference) === canonicalName;
}

function readFirstJsonlLine(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
        while (true) {
            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            const chunk = buffer.subarray(0, bytesRead);
            const newlineIndex = chunk.indexOf(0x0A);
            chunks.push(newlineIndex === -1 ? Buffer.from(chunk) : Buffer.from(chunk.subarray(0, newlineIndex)));
            if (newlineIndex !== -1) break;
        }
    } finally {
        fs.closeSync(descriptor);
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '');
}

async function inspectLorebookReferenceState(name, userHandles = []) {
    const canonicalName = assertCanonicalName(name);
    const normalizedUserHandles = [...new Set((Array.isArray(userHandles) ? userHandles : []).map(handle => String(handle || '').trim()).filter(Boolean))];
    const settingsReferences = [];
    const characterReferences = [];
    const settingsReadErrors = [];
    const characterReadErrors = [];
    const chatReferences = [];
    const chatReadErrors = [];

    for (const handle of normalizedUserHandles) {
        const directories = getUserDirectories(handle);
        const settingsPath = path.join(directories.root, SETTINGS_FILE);
        if (fs.existsSync(settingsPath)) {
            try {
                const settings = readJsonFileSync(settingsPath);
                const globalSelectMatches = (Array.isArray(settings?.world_info?.globalSelect) ? settings.world_info.globalSelect : [])
                    .filter(value => doesLorebookReferenceMatch(value, canonicalName));
                if (globalSelectMatches.length > 0) {
                    settingsReferences.push({ handle, path: settingsPath, field: 'world_info.globalSelect', matches: globalSelectMatches });
                }

                for (const entry of Array.isArray(settings?.world_info?.charLore) ? settings.world_info.charLore : []) {
                    const matches = (Array.isArray(entry?.extraBooks) ? entry.extraBooks : [])
                        .filter(value => doesLorebookReferenceMatch(value, canonicalName));
                    if (matches.length > 0) {
                        settingsReferences.push({
                            handle,
                            path: settingsPath,
                            field: 'world_info.charLore[].extraBooks',
                            matches,
                            character: String(entry?.name || '').trim(),
                        });
                    }
                }

                const personaLorebook = String(settings?.power_user?.persona_description_lorebook || '').trim();
                if (doesLorebookReferenceMatch(personaLorebook, canonicalName)) {
                    settingsReferences.push({
                        handle,
                        path: settingsPath,
                        field: 'power_user.persona_description_lorebook',
                        matches: [personaLorebook],
                    });
                }
            } catch (error) {
                settingsReadErrors.push({
                    handle,
                    path: settingsPath,
                    message: String(error?.message || error),
                });
            }
        }

        if (!fs.existsSync(directories.characters)) {
            continue;
        }

        for (const entry of fs.readdirSync(directories.characters, { withFileTypes: true })) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.png') {
                continue;
            }

            const filePath = path.join(directories.characters, entry.name);
            try {
                const rawBuffer = fs.readFileSync(filePath);
                const character = JSON.parse(readCharacterCard(rawBuffer));
                const primaryLorebook = String(character?.data?.extensions?.world || '').trim();
                if (doesLorebookReferenceMatch(primaryLorebook, canonicalName)) {
                    characterReferences.push({
                        handle,
                        path: filePath,
                        field: 'data.extensions.world',
                        matches: [primaryLorebook],
                    });
                }

                const linkedLorebooks = (Array.isArray(character?.data?.extensions?.aikobots?.secure_lorebooks)
                    ? character.data.extensions.aikobots.secure_lorebooks
                    : [])
                    .filter(value => doesLorebookReferenceMatch(value, canonicalName));
                if (linkedLorebooks.length > 0) {
                    characterReferences.push({
                        handle,
                        path: filePath,
                        field: 'data.extensions.aikobots.secure_lorebooks',
                        matches: linkedLorebooks,
                    });
                }
            } catch (error) {
                characterReadErrors.push({
                    handle,
                    path: filePath,
                    message: String(error?.message || error),
                });
            }
        }
    }

    for (const handle of normalizedUserHandles) {
        const directories = getUserDirectories(handle);
        const chatFiles = [
            ...listChatFiles(directories.chats, { recursive: true }),
            ...listChatFiles(directories.groupChats, { recursive: false }),
        ];
        for (const filePath of chatFiles) {
            try {
                let header;
                if (path.extname(filePath).toLowerCase() === '.sqlite') {
                    header = await withChatSaveLock(filePath, async () => {
                        const db = await loadDb(filePath);
                        try {
                            return getChatHeader(db);
                        } finally {
                            db.close();
                        }
                    });
                } else {
                    const firstLine = readFirstJsonlLine(filePath);
                    header = firstLine ? JSON.parse(firstLine) : null;
                }
                const metadata = header?.chat_metadata ? JSON.parse(JSON.stringify(header.chat_metadata)) : null;
                if (migrateChatMetadataReferences(metadata, canonicalName, '')) {
                    chatReferences.push({ handle, path: filePath, field: 'chat_metadata', matches: [canonicalName] });
                }
            } catch (error) {
                chatReadErrors.push({ handle, path: filePath, message: String(error?.message || error) });
            }
        }
    }

    return {
        settingsReferences,
        characterReferences,
        chatReferences,
        settingsReadErrors,
        characterReadErrors,
        chatReadErrors,
    };
}

function hasAnyLorebookReferences(state) {
    return Boolean(
        (Array.isArray(state?.settingsReferences) && state.settingsReferences.length > 0)
        || (Array.isArray(state?.characterReferences) && state.characterReferences.length > 0)
        || (Array.isArray(state?.chatReferences) && state.chatReferences.length > 0),
    );
}

function buildDeletedSecureLorebookResponse(recordOrName, user, deletedUserHandles = []) {
    const metadata = typeof recordOrName === 'string'
        ? {
            name: assertCanonicalName(recordOrName),
            storage: 'secure',
            ownerHandle: '',
            ownerHandles: [],
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
        }
        : buildLorebookMetadata(recordOrName, user);

    return {
        ...metadata,
        deletedAllCopies: true,
        deletedUserHandles,
    };
}

function buildSecureDeleteMarkerMetadata(recordOrName) {
    const canonicalName = assertCanonicalName(typeof recordOrName === 'string' ? recordOrName : recordOrName?.name);
    const ownerHandles = normalizeOwnerHandles(
        typeof recordOrName === 'string'
            ? []
            : (recordOrName?.ownerHandles || [recordOrName?.ownerHandle]),
    );

    return {
        name: canonicalName,
        storage: 'secure',
        ownerHandle: typeof recordOrName === 'string' ? '' : String(recordOrName?.ownerHandle || '').trim(),
        ownerHandles,
        sharingMode: typeof recordOrName === 'string'
            ? 'single'
            : (recordOrName?.sharingMode === 'shared' ? 'shared' : 'single'),
        checkedOutBy: typeof recordOrName === 'string' ? null : (String(recordOrName?.checkedOutBy || '').trim() || null),
        checkedOutAt: typeof recordOrName === 'string' ? null : (recordOrName?.checkedOutAt || null),
    };
}

function readSecureDeleteMarker(name) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getSecureDeleteMarkerPath(canonicalName);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const marker = tryReadJsonFileSync(filePath, null, 'secure delete marker');
    if (!marker || typeof marker !== 'object') {
        return null;
    }

    return buildSecureDeleteMarkerMetadata(marker);
}

function writeSecureDeleteMarker(recordOrName) {
    const marker = buildSecureDeleteMarkerMetadata(recordOrName);
    writeFileAtomicSync(getSecureDeleteMarkerPath(marker.name), JSON.stringify(marker, null, 4), 'utf8');
    return marker;
}

function removeSecureDeleteMarker(name) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getSecureDeleteMarkerPath(canonicalName);
    if (!fs.existsSync(filePath)) {
        return;
    }

    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }

        if (fs.existsSync(filePath)) {
            throw new LorebookRepositoryError(
                'LorebookStateRepairFailed',
                `Failed to remove secure delete marker for lorebook "${canonicalName}". Manual repair may be required.`,
                500,
            );
        }
    }
}

async function removeAllLorebookArtifacts(name, userHandles = [], options = {}) {
    const canonicalName = assertCanonicalName(name);
    const removeSecureBacking = options?.removeSecureBacking !== false;
    const referenceState = options?.referenceState && typeof options.referenceState === 'object' ? options.referenceState : null;
    const referenceUserHandles = Array.isArray(options?.referenceUserHandles) ? options.referenceUserHandles : userHandles;
    const copyState = inspectLorebookCopyState(canonicalName, userHandles);

    for (const handle of copyState.userHandlesWithCopies) {
        removeUserLorebookCopy(handle, canonicalName);
    }

    const cleanupResult = await cleanupLorebookReferences(canonicalName, referenceUserHandles, referenceState, options?.user || null);
    if ((Array.isArray(cleanupResult?.settingsCleanupErrors) && cleanupResult.settingsCleanupErrors.length > 0)
        || (Array.isArray(cleanupResult?.characterCleanupErrors) && cleanupResult.characterCleanupErrors.length > 0)
        || (Array.isArray(cleanupResult?.chatCleanupErrors) && cleanupResult.chatCleanupErrors.length > 0)
        || (Array.isArray(cleanupResult?.hiddenCleanupErrors) && cleanupResult.hiddenCleanupErrors.length > 0)) {
        throw new LorebookRepositoryError(
            'LorebookDeleteFailed',
            `Failed to remove known references for lorebook "${canonicalName}".`,
            500,
            cleanupResult,
        );
    }

    const postCleanupCopyState = inspectLorebookCopyState(canonicalName, userHandles);
    const postCleanupReferenceState = await inspectLorebookReferenceState(canonicalName, referenceUserHandles);
    if ((Array.isArray(postCleanupCopyState.userHandlesWithCopies) && postCleanupCopyState.userHandlesWithCopies.length > 0)
        || hasAnyLorebookReferences(postCleanupReferenceState)) {
        throw new LorebookRepositoryError(
            'LorebookDeleteFailed',
            `Failed to remove all user copies or references for lorebook "${canonicalName}".`,
            500,
            {
                afterState: postCleanupCopyState,
                afterReferenceState: postCleanupReferenceState,
            },
        );
    }

    if (removeSecureBacking) {
        if (postCleanupCopyState.sharedPresent) {
            removeSharedSecureLorebook(canonicalName);
        }

        if (postCleanupCopyState.securePresent) {
            removeSecureLorebook(canonicalName);
        }
    }

    return {
        deletedUserHandles: copyState.userHandlesWithCopies,
        cleanupResult,
    };
}

async function deleteResidualSecureLorebookArtifacts(user, name, userHandles = []) {
    const canonicalName = assertCanonicalName(name);
    const beforeState = inspectLorebookCopyState(canonicalName, userHandles);
    const beforeReferenceState = await inspectLorebookReferenceState(canonicalName, userHandles);
    const deleteMarker = readSecureDeleteMarker(canonicalName);

    if (deleteMarker ? !canManageSecureLorebook(user, deleteMarker) : !user?.profile?.admin) {
        throw new LorebookRepositoryError(
            'LorebookAccessDenied',
            deleteMarker
                ? `Secure lorebook "${canonicalName}" is already partially deleted. Only its owners and admins can finish cleanup.`
                : `Secure lorebook "${canonicalName}" is already partially deleted. Admin cleanup is required to remove remaining copies or references.`,
            403,
            {
                beforeState,
                beforeReferenceState,
                deleteMarker,
            },
        );
    }

    try {
        const { deletedUserHandles, cleanupResult } = await removeAllLorebookArtifacts(canonicalName, userHandles, {
            removeSecureBacking: true,
            referenceState: beforeReferenceState,
            user,
        });
        const finalState = inspectLorebookCopyState(canonicalName, userHandles);
        const finalReferenceState = await inspectLorebookReferenceState(canonicalName, userHandles);
        if (hasAnyLorebookCopies(finalState) || hasAnyLorebookReferences(finalReferenceState)) {
            throw new LorebookRepositoryError(
                'LorebookStateRepairFailed',
                `Failed to clean up remaining secure lorebook artifacts for "${canonicalName}". Manual repair may be required.`,
                500,
                {
                    beforeState,
                    afterState: finalState,
                    beforeReferenceState,
                    afterReferenceState: finalReferenceState,
                },
            );
        }

        removeSecureDeleteMarker(canonicalName);
        return {
            ...buildDeletedSecureLorebookResponse(canonicalName, user, deletedUserHandles),
            referenceCleanup: cleanupResult,
        };
    } catch (error) {
        const afterFailureState = inspectLorebookCopyState(canonicalName, userHandles);
        const afterFailureReferenceState = await inspectLorebookReferenceState(canonicalName, userHandles);
        if (!hasAnyLorebookCopies(afterFailureState) && !hasAnyLorebookReferences(afterFailureReferenceState)) {
            removeSecureDeleteMarker(canonicalName);
            return buildDeletedSecureLorebookResponse(canonicalName, user, beforeState.userHandlesWithCopies);
        }

        if (error instanceof LorebookRepositoryError) {
            throw error;
        }

        throw new LorebookRepositoryError(
            'LorebookStateRepairFailed',
            `Failed to clean up remaining secure lorebook artifacts for "${canonicalName}". Manual repair may be required.`,
            500,
            {
                beforeState,
                afterState: afterFailureState,
                beforeReferenceState,
                afterReferenceState: afterFailureReferenceState,
            },
        );
    }
}

function normalizeReferenceUserHandles(userHandles = []) {
    return [...new Set((Array.isArray(userHandles) ? userHandles : [])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
}

function migrateLorebookReferenceScalar(value, oldCanonicalName, newCanonicalName = '') {
    if (!doesLorebookReferenceMatch(value, oldCanonicalName)) {
        return { value, changed: false };
    }

    return { value: newCanonicalName || '', changed: true };
}

function migrateLorebookReferenceArray(values, oldCanonicalName, newCanonicalName = '') {
    const source = Array.isArray(values) ? values : [];
    const next = [];
    let changed = false;

    for (const value of source) {
        if (!doesLorebookReferenceMatch(value, oldCanonicalName)) {
            if (!next.some(item => doesLorebookReferenceMatch(item, getCanonicalLorebookName(value)))) {
                next.push(value);
            }
            continue;
        }

        changed = true;
        if (newCanonicalName && !next.some(item => doesLorebookReferenceMatch(item, newCanonicalName))) {
            next.push(newCanonicalName);
        }
    }

    return { values: next, changed };
}

function migrateStmbStateReferences(state, oldCanonicalName, newCanonicalName = '') {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return false;
    }

    let changed = false;
    const manualLorebook = migrateLorebookReferenceScalar(state.manualLorebook, oldCanonicalName, newCanonicalName);
    if (manualLorebook.changed) {
        if (manualLorebook.value) {
            state.manualLorebook = manualLorebook.value;
        } else {
            delete state.manualLorebook;
        }
        if (!manualLorebook.value && state.narratorMode && typeof state.narratorMode === 'object') {
            state.narratorMode.enabled = false;
        }
        changed = true;
    }

    if (state.manualCharacterLorebooks && typeof state.manualCharacterLorebooks === 'object' && !Array.isArray(state.manualCharacterLorebooks)) {
        for (const [memberKey, value] of Object.entries(state.manualCharacterLorebooks)) {
            const migrated = migrateLorebookReferenceScalar(value, oldCanonicalName, newCanonicalName);
            if (!migrated.changed) continue;
            if (migrated.value) state.manualCharacterLorebooks[memberKey] = migrated.value;
            else delete state.manualCharacterLorebooks[memberKey];
            changed = true;
        }
        if (Object.keys(state.manualCharacterLorebooks).length === 0) delete state.manualCharacterLorebooks;
    }

    if (state.sidePromptLorebookOverrides && typeof state.sidePromptLorebookOverrides === 'object' && !Array.isArray(state.sidePromptLorebookOverrides)) {
        for (const [key, value] of Object.entries(state.sidePromptLorebookOverrides)) {
            const migrated = migrateLorebookReferenceScalar(value, oldCanonicalName, newCanonicalName);
            if (migrated.changed) {
                if (migrated.value) {
                    state.sidePromptLorebookOverrides[key] = migrated.value;
                } else {
                    delete state.sidePromptLorebookOverrides[key];
                }
                changed = true;
            }
        }

        if (Object.keys(state.sidePromptLorebookOverrides).length === 0) {
            delete state.sidePromptLorebookOverrides;
        }
    }

    if (state.narratorMode && typeof state.narratorMode === 'object' && !Array.isArray(state.narratorMode)) {
        const members = Array.isArray(state.narratorMode.members) ? state.narratorMode.members : [];
        for (const member of members) {
            if (!member || typeof member !== 'object' || Array.isArray(member)) continue;
            const migrated = migrateLorebookReferenceScalar(member.lorebookName, oldCanonicalName, newCanonicalName);
            if (!migrated.changed) continue;
            member.lorebookName = migrated.value || '';
            if (!migrated.value) state.narratorMode.enabled = false;
            changed = true;
        }
    }

    return changed;
}

function migrateChatMetadataReferences(chatMetadata, oldCanonicalName, newCanonicalName = '') {
    if (!chatMetadata || typeof chatMetadata !== 'object' || Array.isArray(chatMetadata)) {
        return false;
    }

    let changed = false;
    const chatWorld = migrateLorebookReferenceScalar(chatMetadata.world_info, oldCanonicalName, newCanonicalName);
    if (chatWorld.changed) {
        if (chatWorld.value) {
            chatMetadata.world_info = chatWorld.value;
        } else {
            delete chatMetadata.world_info;
        }
        changed = true;
    }

    if (migrateStmbStateReferences(chatMetadata.STMemoryBooks, oldCanonicalName, newCanonicalName)) {
        changed = true;
    }

    return changed;
}

function migrateLorebookSettingsReferences(name, newName, userHandles = [], referenceState = null) {
    const oldCanonicalName = assertCanonicalName(name);
    const newCanonicalName = newName ? assertCanonicalName(newName) : '';
    const normalizedUserHandles = normalizeReferenceUserHandles(userHandles);
    const cleanedSettingsHandles = [];
    const errors = [];
    const referencedSettingsPaths = referenceState && typeof referenceState === 'object'
        ? new Set((Array.isArray(referenceState.settingsReferences) ? referenceState.settingsReferences : []).map(reference => String(reference?.path || '')).filter(Boolean))
        : null;

    for (const handle of normalizedUserHandles) {
        const directories = getUserDirectories(handle);
        const settingsPath = path.join(directories.root, SETTINGS_FILE);
        if (!fs.existsSync(settingsPath)) {
            continue;
        }

        if (referencedSettingsPaths && !referencedSettingsPaths.has(settingsPath)) {
            continue;
        }

        try {
            const settings = readJsonFileSync(settingsPath);
            let modified = false;

            if (Array.isArray(settings?.world_info?.globalSelect)) {
                const migrated = migrateLorebookReferenceArray(settings.world_info.globalSelect, oldCanonicalName, newCanonicalName);
                if (migrated.changed) {
                    settings.world_info.globalSelect = migrated.values;
                    modified = true;
                }
            }

            if (Array.isArray(settings?.world_info?.charLore)) {
                const nextCharLore = [];
                for (const entry of settings.world_info.charLore) {
                    const currentExtraBooks = Array.isArray(entry?.extraBooks) ? entry.extraBooks : [];
                    const migrated = migrateLorebookReferenceArray(currentExtraBooks, oldCanonicalName, newCanonicalName);
                    if (migrated.changed) {
                        entry.extraBooks = migrated.values;
                        modified = true;
                    }

                    if (entry.extraBooks?.length > 0 || currentExtraBooks.length === 0) {
                        nextCharLore.push(entry);
                    } else {
                        modified = true;
                    }
                }

                if (nextCharLore.length !== settings.world_info.charLore.length) {
                    settings.world_info.charLore = nextCharLore;
                }
            }

            const personaLorebook = migrateLorebookReferenceScalar(settings?.power_user?.persona_description_lorebook, oldCanonicalName, newCanonicalName);
            if (personaLorebook.changed) {
                settings.power_user = settings.power_user && typeof settings.power_user === 'object' ? settings.power_user : {};
                settings.power_user.persona_description_lorebook = personaLorebook.value;
                modified = true;
            }

            const personaDescriptions = settings?.power_user?.persona_descriptions;
            if (personaDescriptions && typeof personaDescriptions === 'object' && !Array.isArray(personaDescriptions)) {
                for (const descriptor of Object.values(personaDescriptions)) {
                    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
                        continue;
                    }

                    const migrated = migrateLorebookReferenceScalar(descriptor.lorebook, oldCanonicalName, newCanonicalName);
                    if (migrated.changed) {
                        descriptor.lorebook = migrated.value;
                        modified = true;
                    }
                }
            }

            if (modified) {
                writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
                cleanedSettingsHandles.push(handle);
            }
        } catch (error) {
            errors.push({
                handle,
                path: settingsPath,
                message: String(error?.message || error),
            });
        }
    }

    return { cleanedSettingsHandles, settingsCleanupErrors: errors };
}

function migrateLorebookCharacterReferences(name, newName, userHandles = [], referenceState = null) {
    const oldCanonicalName = assertCanonicalName(name);
    const newCanonicalName = newName ? assertCanonicalName(newName) : '';
    const normalizedUserHandles = normalizeReferenceUserHandles(userHandles);
    const cleanedCharacterFiles = [];
    const errors = [];
    const referencedCharacterPaths = referenceState && typeof referenceState === 'object'
        ? new Set((Array.isArray(referenceState.characterReferences) ? referenceState.characterReferences : []).map(reference => String(reference?.path || '')).filter(Boolean))
        : null;

    for (const handle of normalizedUserHandles) {
        const directories = getUserDirectories(handle);
        if (!fs.existsSync(directories.characters)) {
            continue;
        }

        for (const entry of fs.readdirSync(directories.characters, { withFileTypes: true })) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.png') {
                continue;
            }

            const filePath = path.join(directories.characters, entry.name);
            if (referencedCharacterPaths && !referencedCharacterPaths.has(filePath)) {
                continue;
            }

            try {
                const rawBuffer = fs.readFileSync(filePath);
                const character = JSON.parse(readCharacterCard(rawBuffer));
                let modified = false;

                const primary = migrateLorebookReferenceScalar(character?.data?.extensions?.world, oldCanonicalName, newCanonicalName);
                if (primary.changed && character?.data?.extensions && typeof character.data.extensions === 'object') {
                    character.data.extensions.world = primary.value;
                    modified = true;
                }

                const linkedLorebooks = Array.isArray(character?.data?.extensions?.aikobots?.secure_lorebooks)
                    ? character.data.extensions.aikobots.secure_lorebooks
                    : null;
                if (linkedLorebooks) {
                    const migrated = migrateLorebookReferenceArray(linkedLorebooks, oldCanonicalName, newCanonicalName);
                    if (migrated.changed) {
                        if (migrated.values.length > 0) {
                            character.data.extensions.aikobots.secure_lorebooks = migrated.values;
                        } else {
                            delete character.data.extensions.aikobots.secure_lorebooks;
                            if (Object.keys(character.data.extensions.aikobots).length === 0) {
                                delete character.data.extensions.aikobots;
                            }
                        }
                        modified = true;
                    }
                }

                if (modified) {
                    writeFileAtomicSync(filePath, writeCharacterCard(rawBuffer, JSON.stringify(character)));
                    cleanedCharacterFiles.push({ handle, path: filePath });
                }
            } catch (error) {
                errors.push({
                    handle,
                    path: filePath,
                    message: String(error?.message || error),
                });
            }
        }
    }

    return { cleanedCharacterFiles, characterCleanupErrors: errors };
}

function listChatFiles(directory, { recursive = false } = {}) {
    const files = [];
    if (!directory || !fs.existsSync(directory)) {
        return files;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory() && recursive) {
            files.push(...listChatFiles(entryPath, { recursive }));
        }
    }

    for (const fileName of getDeduplicatedChatHistoryFileNames(fs.readdirSync(directory, { withFileTypes: true }))) {
        files.push(path.join(directory, fileName));
    }

    return files;
}

function migrateChatJsonlHeaderReferences(filePath, handle, oldCanonicalName, newCanonicalName = '') {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    if (!lines[0]) {
        return { changed: false };
    }

    const header = JSON.parse(lines[0]);
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
        return { changed: false };
    }

    if (!migrateChatMetadataReferences(header.chat_metadata, oldCanonicalName, newCanonicalName)) {
        return { changed: false };
    }

    lines[0] = JSON.stringify(header);
    writeFileAtomicSync(filePath, lines.join('\n'), 'utf8');
    return { changed: true, handle, path: filePath };
}

/** Migrates lorebook references in one locked chat header without reading message rows. */
export async function migrateChatHeaderReferences(filePath, handle, oldCanonicalName, newCanonicalName = '') {
    if (path.extname(filePath).toLowerCase() !== '.sqlite') {
        return migrateChatJsonlHeaderReferences(filePath, handle, oldCanonicalName, newCanonicalName);
    }

    return await withChatSaveLock(filePath, async () => {
        const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
        const db = await loadDb(sqlitePath);
        try {
            const header = getChatHeader(db);
            if (!header || typeof header !== 'object' || Array.isArray(header)) {
                return { changed: false };
            }
            const nextHeader = JSON.parse(JSON.stringify(header));
            if (!migrateChatMetadataReferences(nextHeader.chat_metadata, oldCanonicalName, newCanonicalName)) {
                return { changed: false };
            }
            delete nextHeader.id;
            delete nextHeader.order_index;
            nextHeader.chat_revision = Math.max(0, Number.isInteger(Number(nextHeader.chat_revision)) ? Number(nextHeader.chat_revision) : 0) + 1;
            delete nextHeader.last_save_session_id;

            db.run('BEGIN TRANSACTION');
            try {
                db.run('UPDATE messages SET content = ? WHERE order_index = 0', [JSON.stringify(nextHeader)]);
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            return { changed: true, handle, path: sqlitePath };
        } finally {
            db.close();
        }
    });
}

async function migrateLorebookChatReferences(name, newName, userHandles = []) {
    const oldCanonicalName = assertCanonicalName(name);
    const newCanonicalName = newName ? assertCanonicalName(newName) : '';
    const normalizedUserHandles = normalizeReferenceUserHandles(userHandles);
    const cleanedChatFiles = [];
    const chatCleanupErrors = [];

    for (const handle of normalizedUserHandles) {
        const directories = getUserDirectories(handle);
        const chatFiles = [
            ...listChatFiles(directories.chats, { recursive: true }),
            ...listChatFiles(directories.groupChats, { recursive: false }),
        ];

        for (const filePath of chatFiles) {
            try {
                const result = await migrateChatHeaderReferences(filePath, handle, oldCanonicalName, newCanonicalName);
                if (result.changed) {
                    cleanedChatFiles.push({ handle, path: filePath });
                }
            } catch (error) {
                chatCleanupErrors.push({
                    handle,
                    path: filePath,
                    message: String(error?.message || error),
                });
            }
        }

        if (fs.existsSync(directories.groups)) {
            for (const entry of fs.readdirSync(directories.groups, { withFileTypes: true })) {
                if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
                    continue;
                }

                const filePath = path.join(directories.groups, entry.name);
                try {
                    const group = readJsonFileSync(filePath);
                    let modified = false;
                    if (migrateChatMetadataReferences(group?.chat_metadata, oldCanonicalName, newCanonicalName)) {
                        modified = true;
                    }
                    if (group?.past_metadata && typeof group.past_metadata === 'object' && !Array.isArray(group.past_metadata)) {
                        for (const metadata of Object.values(group.past_metadata)) {
                            if (migrateChatMetadataReferences(metadata, oldCanonicalName, newCanonicalName)) {
                                modified = true;
                            }
                        }
                    }
                    if (modified) {
                        writeFileAtomicSync(filePath, JSON.stringify(group, null, 4), 'utf8');
                        cleanedChatFiles.push({ handle, path: filePath });
                    }
                } catch (error) {
                    chatCleanupErrors.push({
                        handle,
                        path: filePath,
                        message: String(error?.message || error),
                    });
                }
            }
        }
    }

    return { cleanedChatFiles, chatCleanupErrors };
}

function migrateLorebookHiddenReferences(name, newName) {
    const hiddenCleanupErrors = [];
    let cleanedHiddenBindings = false;
    let cleanedHiddenTemplates = false;

    try {
        cleanedHiddenBindings = migrateHiddenLorebookBindingReferences({ oldName: name, newName }).changed;
    } catch (error) {
        hiddenCleanupErrors.push({ field: 'hidden-lorebook-bindings', message: String(error?.message || error) });
    }

    try {
        const result = migrateHiddenLorebookTemplateReferences({ oldName: name, newName });
        cleanedHiddenTemplates = result.changed;
        if (result.changed) {
            compileAndWriteHiddenLorebookTemplates();
        }
    } catch (error) {
        hiddenCleanupErrors.push({ field: 'hidden-lorebook-templates', message: String(error?.message || error) });
    }

    return { cleanedHiddenBindings, cleanedHiddenTemplates, hiddenCleanupErrors };
}

/**
 * Removes configured dead lorebook names from hidden template source and compiled bindings.
 * @param {string[]} deadLorebookNames Exact lorebook names to remove
 * @returns {Promise<{changed: boolean, cleanedHiddenBindings: boolean, cleanedHiddenTemplates: boolean}>}
 */
export async function cleanupDeadLorebookHiddenReferences(deadLorebookNames = []) {
    const names = [...new Set((Array.isArray(deadLorebookNames) ? deadLorebookNames : [])
        .map(name => String(name || '').trim())
        .filter(Boolean))];

    return runWithSecureLorebookMutationLock(() => {
        let cleanedHiddenBindings = false;
        let cleanedHiddenTemplates = false;
        let cleanupFailed = false;

        for (const name of names) {
            try {
                cleanedHiddenBindings = migrateHiddenLorebookBindingReferences({ oldName: name }).changed || cleanedHiddenBindings;
            } catch {
                cleanupFailed = true;
            }

            try {
                cleanedHiddenTemplates = migrateHiddenLorebookTemplateReferences({ oldName: name }).changed || cleanedHiddenTemplates;
            } catch {
                cleanupFailed = true;
            }
        }

        let compilationPending = false;
        try {
            compilationPending = isHiddenLorebookCompilationPending();
        } catch {
            cleanupFailed = true;
        }
        if (cleanedHiddenTemplates || compilationPending) {
            try {
                compileAndWriteHiddenLorebookTemplates();
            } catch {
                cleanupFailed = true;
            }
        }

        if (cleanupFailed) {
            throw new LorebookRepositoryError(
                'DeadLorebookHiddenCleanupFailed',
                'Failed to remove one or more dead lorebook references from the hidden registry.',
                500,
            );
        }

        return {
            changed: cleanedHiddenBindings || cleanedHiddenTemplates || compilationPending,
            cleanedHiddenBindings,
            cleanedHiddenTemplates,
        };
    });
}

export async function migrateLorebookGenerationReferences({ operation, oldName, newName = '', userHandles = [], user = null, referenceState = null } = {}) {
    if (operation !== 'rename' && operation !== 'delete') {
        throw new LorebookRepositoryError('LorebookInvalidReferenceMigration', 'Lorebook reference migration operation must be "rename" or "delete".', 400);
    }

    const oldCanonicalName = assertCanonicalName(oldName);
    const newCanonicalName = operation === 'rename' ? assertCanonicalName(newName) : '';

    return {
        operation,
        oldName: oldCanonicalName,
        newName: newCanonicalName,
        ...migrateLorebookSettingsReferences(oldCanonicalName, newCanonicalName, userHandles, referenceState),
        ...migrateLorebookCharacterReferences(oldCanonicalName, newCanonicalName, userHandles, referenceState),
        ...await migrateLorebookChatReferences(oldCanonicalName, newCanonicalName, userHandles),
        ...migrateLorebookHiddenReferences(oldCanonicalName, newCanonicalName),
    };
}

function getLorebookReferenceMigrationErrors(result) {
    return [
        ...(Array.isArray(result?.settingsCleanupErrors) ? result.settingsCleanupErrors : []),
        ...(Array.isArray(result?.characterCleanupErrors) ? result.characterCleanupErrors : []),
        ...(Array.isArray(result?.chatCleanupErrors) ? result.chatCleanupErrors : []),
        ...(Array.isArray(result?.hiddenCleanupErrors) ? result.hiddenCleanupErrors : []),
    ];
}

async function cleanupLorebookReferences(name, userHandles = [], referenceState = null, user = null) {
    return await migrateLorebookGenerationReferences({
        operation: 'delete',
        oldName: name,
        userHandles,
        referenceState,
        user,
    });
}

function areOwnerHandleSetsEqual(left = [], right = []) {
    const normalize = (values) => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))].sort();
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function didPromoteSingleSecureLorebookSucceed(name, ownerHandle) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);
    return Boolean(secureRecord && secureRecord.ownerHandle === ownerHandle && fs.existsSync(getSecureLorebookPath(canonicalName)));
}

function didPromoteLorebookToSharedSucceed({ sourceCanonicalName, sharedCanonicalName, normalizedOwners, secureSourceRecord, localSourceRecord }) {
    const targetRecord = getSharedSecureIndexEntry(sharedCanonicalName);
    if (!targetRecord || !fs.existsSync(getSharedSecureLorebookPath(sharedCanonicalName)) || !areOwnerHandleSetsEqual(targetRecord.ownerHandles, normalizedOwners)) {
        return false;
    }

    if (secureSourceRecord) {
        const sourceSecureRemoved = !getSecureIndexMetadata(sourceCanonicalName) && !fs.existsSync(getSecureLorebookPath(sourceCanonicalName));
        const sourceBackingPath = getUserLorebookPath(secureSourceRecord.ownerHandle, sourceCanonicalName);
        const sourceBackingRemoved = !sourceBackingPath || !fs.existsSync(sourceBackingPath);
        return sourceSecureRemoved && sourceBackingRemoved;
    }

    if (localSourceRecord?.path && fs.existsSync(localSourceRecord.path)) {
        return false;
    }

    return true;
}

function didUnshareLorebookSucceed(sharedName, targetName, targetOwnerHandle) {
    const canonicalSharedName = assertCanonicalName(sharedName);
    const canonicalTargetName = assertCanonicalName(targetName);
    const targetSecureRecord = getSecureIndexEntry(canonicalTargetName);
    const targetUserRecord = getUserLorebookRecord(targetOwnerHandle, canonicalTargetName);
    const sharedRemoved = !getSharedSecureIndexMetadata(canonicalSharedName) && !fs.existsSync(getSharedSecureLorebookPath(canonicalSharedName));
    return Boolean(targetSecureRecord && targetSecureRecord.ownerHandle === targetOwnerHandle && targetUserRecord && sharedRemoved);
}

function writeUserLorebook(handle, name, data) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getUserLorebookPath(handle, canonicalName);
    ensureDirectory(path.dirname(filePath));
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

function writeSharedSecureLorebook(name, data) {
    const canonicalName = assertCanonicalName(name);
    const filePath = getSharedSecureLorebookPath(canonicalName);
    ensureDirectory(path.dirname(filePath));
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

function assertSharedLorebookCheckedOutForEdit(user, record) {
    if (record?.sharingMode !== 'shared') {
        return;
    }

    const currentHandle = String(user?.profile?.handle || '').trim();
    const checkedOutBy = String(record?.checkedOutBy || '').trim();
    if (!checkedOutBy) {
        throw new LorebookRepositoryError('LorebookCheckoutRequired', `Lorebook "${record.name}" must be checked out before editing.`, 423);
    }

    if (checkedOutBy !== currentHandle) {
        throw new LorebookRepositoryError('LorebookCheckedOut', `Lorebook "${record.name}" is checked out by ${checkedOutBy}.`, 423);
    }
}

export function readWorldInfoFile(directories, worldInfoName, allowDummy) {
    const dummyObject = allowDummy ? { entries: {} } : null;
    const matchedLorebook = findUserLorebookFile(directories.worlds, worldInfoName);
    if (!matchedLorebook) {
        const sharedSecureRecord = getSharedSecureIndexEntry(worldInfoName);
        return sharedSecureRecord ? readLorebookFromRecord(sharedSecureRecord, allowDummy) : dummyObject;
    }

    return tryReadJsonFileSync(matchedLorebook.path, dummyObject, 'world info file');
}

/**
 * @param {import('./users.js').User} user
 * @returns {LorebookListItem[]}
 */
export function listLorebooksForManagement(user) {
    const isAdmin = Boolean(user.profile.admin);
    const items = [];
    const seenNames = new Set();
    const worldsDir = user.directories.worlds;
    const secureIndex = readSecureIndex();
    const sharedSecureIndex = readSharedSecureIndex();
    const secureRecords = new Map();
    const sharedSecureRecords = new Map();

    for (const name of Object.keys(secureIndex.books)) {
        const secureRecord = getSecureIndexEntry(name);

        if (!secureRecord) {
            continue;
        }

        secureRecords.set(name, secureRecord);
    }

    for (const name of Object.keys(sharedSecureIndex.books)) {
        const sharedSecureRecord = getSharedSecureIndexEntry(name);
        if (!sharedSecureRecord || !canManageSecureLorebook(user, sharedSecureRecord)) {
            continue;
        }

        sharedSecureRecords.set(name, sharedSecureRecord);
    }

    if (fs.existsSync(worldsDir)) {
        repairLegacyLorebookDirectory(worldsDir, 'lorebook');
        const worldFiles = fs.readdirSync(worldsDir)
            .filter(file => path.extname(file).toLowerCase() === '.json')
            .sort((a, b) => a.localeCompare(b));

        for (const file of worldFiles) {
            const name = path.parse(file).name;

            try {
                const secureRecord = secureRecords.get(name);
                const sharedSecureRecord = sharedSecureRecords.get(name);
                const resolved = sharedSecureRecord
                    ? resolveLorebookWithMetadata(user, name, {
                        storage: 'secure',
                        requireManageableSecure: true,
                    })
                    : secureRecord?.ownerHandle === user.profile.handle
                        ? resolveLorebookWithMetadata(user, name, {
                            storage: 'secure',
                            requireManageableSecure: true,
                        })
                        : resolveLorebookWithMetadata(user, name, {
                            storage: 'user',
                        });

                items.push(buildListItem(resolved.metadata, user));
                seenNames.add(name);
                seenNames.add(getCanonicalLorebookName(resolved.metadata.name) || resolved.metadata.name);
            } catch (error) {
                console.warn(`[Lorebooks] Skipping unreadable local lorebook "${name}" for "${user.profile.handle}".`, error);
            }
        }
    }

    for (const [name] of sharedSecureRecords.entries()) {
        if (seenNames.has(name)) {
            continue;
        }

        const resolved = resolveLorebookWithMetadata(user, name, {
            storage: 'secure',
            requireManageableSecure: true,
        });
        items.push(buildListItem(resolved.metadata, user));
        seenNames.add(name);
    }

    for (const [name, secureRecord] of secureRecords.entries()) {
        if (!canManageSecureLorebook(user, secureRecord)) {
            continue;
        }

        if (seenNames.has(name)) {
            if (isAdmin && secureRecord.ownerHandle !== user.profile.handle) {
                console.error(`[Lorebooks] Lorebook name conflict "${name}" exists in both local storage and secure storage owned by "${secureRecord.ownerHandle}".`);
            }
            continue;
        }

        const resolved = resolveLorebookWithMetadata(user, name, {
            storage: 'secure',
            requireManageableSecure: true,
        });
        items.push(buildListItem(resolved.metadata, user));
        seenNames.add(name);
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns content-free occupied lorebook names for allocation under the mutation lock. */
export function listLorebookNamesForAllocation(user) {
    const names = new Set([
        ...Object.keys(readSecureIndex().books),
        ...Object.keys(readSharedSecureIndex().books),
    ]);
    if (fs.existsSync(user.directories.worlds)) {
        for (const file of fs.readdirSync(user.directories.worlds)) {
            if (path.extname(file).toLowerCase() === '.json') names.add(path.parse(file).name);
        }
    }

    return [...names];
}

/** Returns content-free ordinary lorebook records eligible for cleanup assessment. */
export function listOrdinaryUserLorebooksForCleanup(user) {
    const handle = String(user?.profile?.handle || '').trim();
    const worldsDirectory = user?.directories?.worlds;
    if (!handle || !worldsDirectory || !fs.existsSync(worldsDirectory)) return [];

    for (const indexPath of [getSecureIndexPath(), getSharedSecureIndexPath()]) {
        if (!fs.existsSync(indexPath)) continue;
        const index = readJsonFileSync(indexPath);
        if (!index || typeof index !== 'object' || Array.isArray(index)
            || !index.books || typeof index.books !== 'object' || Array.isArray(index.books)) {
            throw new LorebookRepositoryError('LorebookCleanupUnavailable', 'Lorebook cleanup storage is unavailable.', 503);
        }
    }

    const records = [];
    for (const entry of fs.readdirSync(worldsDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
        const name = getCanonicalLorebookName(path.parse(entry.name).name);
        if (!name || entry.name !== `${name}.json`) continue;

        const secureRecord = getSecureIndexEntry(name);
        const sharedSecureRecord = getSharedSecureIndexEntry(name);
        const isSecureBacking = Boolean(secureRecord || sharedSecureRecord);
        if (isSecureBacking || isReservedRecommendedTemplateSource(handle, name)) continue;
        records.push({ name, path: path.join(worldsDirectory, entry.name) });
    }

    return records.sort((left, right) => left.name.localeCompare(right.name));
}

/** Checks whether generation would resolve a name to an eligible ordinary user lorebook without reading its content. */
export function hasOrdinaryUserLorebookForGeneration(user, name) {
    const canonicalName = assertCanonicalName(name);
    return !isReservedRecommendedTemplateSource(user?.profile?.handle, canonicalName)
        && Boolean(getUserLorebookRecord(user?.profile?.handle, canonicalName));
}

/**
 * Resolves a lorebook using a consistent repository-level access policy.
 * `preferUser` is used by generation to allow local shadowing. `storage='secure'`
 * can be used by validation paths that need to confirm a secure binding exists
 * without requiring the current actor to manage the secure lorebook directly.
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {{
 *   allowDummy?: boolean,
 *   storage?: 'user'|'secure'|null,
 *   preferUser?: boolean,
 *   requireManageableSecure?: boolean,
 * }} [options]
 */
export function resolveLorebookWithMetadata(user, name, {
    allowDummy = false,
    storage = null,
    preferUser = false,
    requireManageableSecure = false,
} = {}) {
    const canonicalName = assertCanonicalName(name);
    const dummyData = allowDummy ? { entries: {} } : null;
    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    const secureRecord = getSecureIndexEntry(canonicalName);
    const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
    const preferredStorage = storage === 'secure' ? 'secure' : (storage === 'user' ? 'user' : null);

    const buildSecureResponse = (record) => ({
        data: readLorebookFromRecord(record, allowDummy),
        metadata: buildLorebookMetadata(record, user),
    });

    const buildUserResponse = () => ({
        data: readLorebookFromRecord(userRecord, allowDummy),
        metadata: {
            name: userRecord.name,
            storage: 'user',
            ownerHandle: userRecord.ownerHandle,
            ownerHandles: userRecord.ownerHandles,
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
        },
    });

    const buildDummyResponse = () => ({
        data: dummyData,
        metadata: {
            name: canonicalName,
            storage: 'user',
            ownerHandle: user.profile.handle,
            ownerHandles: [user.profile.handle].filter(Boolean),
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
        },
    });

    if (preferredStorage === 'secure') {
        const preferredSecureRecord = sharedSecureRecord || secureRecord;
        if (!preferredSecureRecord || (requireManageableSecure && !canManageSecureLorebook(user, preferredSecureRecord))) {
            if (!preferredSecureRecord || requireManageableSecure) {
                throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
            }
        }

        return buildSecureResponse(preferredSecureRecord);
    }

    if (preferredStorage === 'user') {
        if (userRecord) {
            return buildUserResponse();
        }

        if (allowDummy) {
            return buildDummyResponse();
        }

        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    if (preferUser && userRecord) {
        return buildUserResponse();
    }

    if (sharedSecureRecord) {
        if (requireManageableSecure && !canManageSecureLorebook(user, sharedSecureRecord)) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        return buildSecureResponse(sharedSecureRecord);
    }

    if (secureRecord) {
        if (requireManageableSecure && !canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        return buildSecureResponse(secureRecord);
    }

    if (userRecord) {
        return buildUserResponse();
    }

    if (allowDummy) {
        return buildDummyResponse();
    }

    throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
}

async function deleteAllSecureLorebookCopies(user, record, userHandles = [], options = {}) {
    const canonicalName = assertCanonicalName(record?.name);
    const isShared = record?.sharingMode === 'shared';
    const referenceUserHandles = Array.isArray(options?.referenceUserHandles) ? options.referenceUserHandles : userHandles;
    const beforeState = inspectLorebookCopyState(canonicalName, userHandles);
    const beforeReferenceState = await inspectLorebookReferenceState(canonicalName, referenceUserHandles);

    if (!canManageSecureLorebook(user, record)) {
        throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not deletable.`, 403);
    }

    let cleanupArtifactResult = null;
    try {
        if (isShared) {
            assertSharedLorebookCheckedOutForEdit(user, record);
        }

        writeSecureDeleteMarker(record);
        cleanupArtifactResult = await removeAllLorebookArtifacts(canonicalName, userHandles, {
            removeSecureBacking: true,
            referenceState: beforeReferenceState,
            referenceUserHandles,
            user,
        });
    } catch (error) {
        const afterFailureState = inspectLorebookCopyState(canonicalName, userHandles);
        const afterFailureReferenceState = await inspectLorebookReferenceState(canonicalName, referenceUserHandles);
        if (!hasAnyLorebookCopies(afterFailureState) && !hasAnyLorebookReferences(afterFailureReferenceState)) {
            removeSecureDeleteMarker(canonicalName);
            return buildDeletedSecureLorebookResponse(record, user, beforeState.userHandlesWithCopies);
        }

        if (error instanceof LorebookRepositoryError) {
            throw error;
        }

        throw new LorebookRepositoryError(
            'LorebookStateRepairFailed',
            `Failed to delete all copies of secure lorebook "${canonicalName}" cleanly. Manual repair may be required.`,
            500,
            {
                beforeState,
                afterState: afterFailureState,
                beforeReferenceState,
                afterReferenceState: afterFailureReferenceState,
            },
        );
    }

    const finalState = inspectLorebookCopyState(canonicalName, userHandles);
    const finalReferenceState = await inspectLorebookReferenceState(canonicalName, referenceUserHandles);
    if (hasAnyLorebookCopies(finalState) || hasAnyLorebookReferences(finalReferenceState)) {
        throw new LorebookRepositoryError(
            'LorebookStateRepairFailed',
            `Failed to delete all copies of secure lorebook "${canonicalName}" cleanly. Manual repair may be required.`,
            500,
            {
                beforeState,
                afterState: finalState,
                beforeReferenceState,
                afterReferenceState: finalReferenceState,
            },
        );
    }

    removeSecureDeleteMarker(canonicalName);
    return {
        ...buildDeletedSecureLorebookResponse(record, user, beforeState.userHandlesWithCopies),
        referenceCleanup: cleanupArtifactResult?.cleanupResult,
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {boolean} [allowDummy=false]
 * @param {'user'|'secure'|null} [storage=null] Preferred storage location to read from
 */
export function getLorebookForManagement(user, name, allowDummy = false, storage = null) {
    return resolveLorebookWithMetadata(user, name, {
        allowDummy,
        storage,
        preferUser: false,
        requireManageableSecure: true,
    });
}

/**
 * Validates the shared-secure checkout state before a management transaction writes anything.
 * Management reads already validate ownership and permissions.
 * @param {import('./users.js').User} user
 * @param {object} metadata Lorebook metadata returned by getLorebookForManagement.
 */
export function assertLorebookCheckoutForManagement(user, metadata) {
    if (metadata?.storage === 'secure') {
        assertSharedLorebookCheckedOutForEdit(user, metadata);
    }
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

    if (isReservedRecommendedTemplateSource(user?.profile?.handle, canonicalName)) {
        return { data: dummyObject, metadata: null };
    }

    return resolveLorebookWithMetadata(user, canonicalName, {
        allowDummy,
        preferUser: true,
        requireManageableSecure: false,
    });
}

/**
 * Determines whether a lorebook has a readable secure record, regardless of who owns it.
 * This is used by validation paths that need to accept admin-determined secure lorebooks
 * without requiring the current actor to manage them directly.
 * @param {string} name
 * @returns {boolean}
 */
export function hasReadableSecureLorebook(name) {
    try {
        return Boolean(resolveLorebookWithMetadata(
            { profile: { handle: '', admin: false } },
            name,
            { storage: 'secure', allowDummy: false, requireManageableSecure: false },
        ));
    } catch {
        return false;
    }
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

    if (isReservedRecommendedTemplateSource(user?.profile?.handle, canonicalName)) {
        return false;
    }

    try {
        return Boolean(resolveLorebookWithMetadata(user, canonicalName, {
            allowDummy: false,
            preferUser: true,
            requireManageableSecure: false,
        }));
    } catch {
        return false;
    }
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {object} data
 * @param {'user'|'secure'} [storage='user'] Target storage location for the save
 */
function saveLorebookForManagementUnlocked(user, name, data, storage = 'user') {
    assertLorebookSaveNameAllowed(name);
    const canonicalName = assertCanonicalName(name);
    assertLorebookData(data, canonicalName);
    const sanitizedData = sanitizeLorebookDataForStorage(data);
    const secureRecord = getSecureIndexEntry(canonicalName);
    const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
    const preferredStorage = storage === 'secure' ? 'secure' : 'user';

    if (preferredStorage === 'secure') {
        if (sharedSecureRecord) {
            if (!canManageSecureLorebook(user, sharedSecureRecord)) {
                throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
            }

            assertSharedLorebookCheckedOutForEdit(user, sharedSecureRecord);
            writeSharedSecureLorebook(canonicalName, sanitizedData);
            writeSharedSecureLorebookMetadata(canonicalName, sharedSecureRecord.ownerHandles, user.profile.handle, sharedSecureRecord);
            const updatedRecord = getSharedSecureIndexEntry(canonicalName);
            return buildLorebookMetadata(updatedRecord || sharedSecureRecord, user);
        }

        if (!secureRecord || !canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        writeUserLorebook(secureRecord.ownerHandle, canonicalName, sanitizedData);
        writeSecureLorebookMetadata(canonicalName, secureRecord.ownerHandle, user.profile.handle, secureRecord);
        return buildLorebookMetadata(getSecureIndexEntry(canonicalName) || secureRecord, user);
    }

    assertUserLorebookNameAvailable(canonicalName);
    writeUserLorebook(user.profile.handle, canonicalName, sanitizedData);
    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: user.profile.handle,
        ownerHandles: [user.profile.handle].filter(Boolean),
        sharingMode: 'single',
        checkedOutBy: null,
        checkedOutAt: null,
        checkoutState: 'available',
        canCheckOut: false,
        canCheckIn: false,
        canForceCheckout: false,
        canManageOwners: false,
        shadowingSecure: false,
    };
}

function createUserLorebookForManagementUnlocked(user, name, data) {
    assertLorebookSaveNameAllowed(name);
    const canonicalName = assertCanonicalName(name);
    assertLorebookData(data, canonicalName);
    if (getUserLorebookRecord(user.profile.handle, canonicalName)) {
        throw new LorebookRepositoryError('LorebookAlreadyExists', `Lorebook "${canonicalName}" already exists.`, 409);
    }
    assertUserLorebookNameAvailable(canonicalName);
    writeUserLorebook(user.profile.handle, canonicalName, sanitizeLorebookDataForStorage(data));
    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: user.profile.handle,
        ownerHandles: [user.profile.handle].filter(Boolean),
        sharingMode: 'single',
        checkedOutBy: null,
        checkedOutAt: null,
        checkoutState: 'available',
        canCheckOut: false,
        canCheckIn: false,
        canForceCheckout: false,
        canManageOwners: false,
        shadowingSecure: false,
    };
}

/** Creates an ordinary user lorebook without overwriting an existing book. */
export async function createUserLorebookForManagement(user, name, data) {
    return runWithSecureLorebookMutationLock(() => createUserLorebookForManagementUnlocked(user, name, data));
}

/**
 * Saves a manageable lorebook while holding the shared mutation lock.
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {object} data
 * @param {'user'|'secure'} [storage='user']
 * @returns {Promise<object>}
 */
export async function saveLorebookForManagement(user, name, data, storage = 'user') {
    return runWithSecureLorebookMutationLock(() => saveLorebookForManagementUnlocked(user, name, data, storage));
}

/**
 * Runs a multi-lorebook management operation under the shared mutation lock.
 * The callback must use the supplied save function to avoid reacquiring the lock.
 * @param {(transaction: {
 *   save: typeof saveLorebookForManagementUnlocked,
 *   createUser: typeof createUserLorebookForManagementUnlocked,
 *   removeCreatedUser: (user: import('./users.js').User, name: string) => boolean,
 * }) => Promise<any>} operation
 * @returns {Promise<any>}
 */
export async function withLorebookManagementTransaction(operation) {
    if (typeof operation !== 'function') {
        throw new TypeError('Lorebook management transaction callback is required.');
    }
    return runWithSecureLorebookMutationLock(() => operation({
        save: saveLorebookForManagementUnlocked,
        createUser: createUserLorebookForManagementUnlocked,
        removeCreatedUser(user, name) {
            return removeUserLorebookCopy(user?.profile?.handle, name);
        },
    }));
}

/**
 * @param {import('./users.js').User} user
 * @param {string} oldName
 * @param {string} newName
 * @param {{storage?: 'user'|'secure'|null, referenceUserHandles?: string[]}} [options]
 */
export async function renameLorebookForManagement(user, oldName, newName, options = {}) {
    return runWithSecureLorebookMutationLock(async () => {
        assertLorebookSaveNameAllowed(oldName);
        assertLorebookSaveNameAllowed(newName);
        const oldCanonicalName = assertCanonicalName(oldName);
        const newCanonicalName = assertCanonicalName(newName);
        assertLorebookNotReservedAsTemplate(user, oldCanonicalName);

        if (oldCanonicalName === newCanonicalName) {
            throw new LorebookRepositoryError('LorebookAlreadyExists', `Lorebook "${newCanonicalName}" already exists.`, 409);
        }

        const preferredStorage = options?.storage === 'secure' ? 'secure' : (options?.storage === 'user' ? 'user' : null);
        if (preferredStorage === 'secure') {
            throw new LorebookRepositoryError('LorebookRenameNotAllowed', 'Secure lorebooks cannot be renamed here.', 403);
        }

        const secureRecord = getSecureIndexEntry(oldCanonicalName);
        const sharedSecureRecord = getSharedSecureIndexEntry(oldCanonicalName);
        const userRecord = getUserLorebookRecord(user.profile.handle, oldCanonicalName);
        const isSecureBackingLorebook = Boolean(userRecord && secureRecord && secureRecord.ownerHandle === user.profile.handle);

        if ((secureRecord || sharedSecureRecord) && (!userRecord || isSecureBackingLorebook)) {
            throw new LorebookRepositoryError('LorebookRenameNotAllowed', 'Secure lorebooks cannot be renamed here.', 403);
        }

        if (!userRecord || isSecureBackingLorebook) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${oldCanonicalName}" not found.`, 404);
        }

        if (getUserLorebookRecord(user.profile.handle, newCanonicalName) || getSecureIndexEntry(newCanonicalName) || getSharedSecureIndexEntry(newCanonicalName)) {
            throw new LorebookRepositoryError('LorebookAlreadyExists', `Lorebook "${newCanonicalName}" already exists.`, 409);
        }

        const data = readLorebookFromRecord(userRecord, false);
        assertLorebookData(data, oldCanonicalName);
        const targetPath = getUserLorebookPath(user.profile.handle, newCanonicalName);
        ensureDirectory(path.dirname(targetPath));

        try {
            fs.renameSync(userRecord.path, targetPath);
        } catch (error) {
            throw new LorebookRepositoryError('LorebookRenameFailed', `Failed to rename lorebook "${oldCanonicalName}".`, 500, {
                message: String(error?.message || error),
            });
        }

        const referenceMigration = await migrateLorebookGenerationReferences({
            operation: 'rename',
            oldName: oldCanonicalName,
            newName: newCanonicalName,
            userHandles: options?.referenceUserHandles || [user.profile.handle],
            user,
        });
        const referenceMigrationErrors = getLorebookReferenceMigrationErrors(referenceMigration);
        if (referenceMigrationErrors.length > 0) {
            throw new LorebookRepositoryError(
                'LorebookRenameReferenceMigrationFailed',
                `Failed to update known references for lorebook "${oldCanonicalName}".`,
                500,
                {
                    referenceMigration,
                    referenceMigrationErrors,
                },
            );
        }

        return {
            name: newCanonicalName,
            storage: 'user',
            ownerHandle: user.profile.handle,
            ownerHandles: [user.profile.handle].filter(Boolean),
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
            shadowingSecure: false,
            referenceMigration,
        };
    });
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export async function deleteLorebookForManagement(user, name, options = {}) {
    return runWithSecureLorebookMutationLock(async () => {
        const canonicalName = assertCanonicalName(name);
        const secureRecord = getSecureIndexEntry(canonicalName);
        const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
        const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
        const preferredStorage = options?.storage === 'secure' ? 'secure' : (options?.storage === 'user' ? 'user' : null);
        const allUserHandles = Array.isArray(options?.allUserHandles) ? options.allUserHandles : [];
        const referenceUserHandles = Array.isArray(options?.referenceUserHandles) ? options.referenceUserHandles : [user.profile.handle];
        const secureReferenceUserHandles = allUserHandles.length > 0 ? allUserHandles : referenceUserHandles;
        const isSecureBackingLorebook = Boolean(userRecord && secureRecord && secureRecord.ownerHandle === user.profile.handle);
        if (userRecord && !isSecureBackingLorebook) {
            assertLorebookNotReservedAsTemplate(user, canonicalName);
        }

        if (preferredStorage === 'secure') {
            const secureTarget = sharedSecureRecord || secureRecord;
            if (!secureTarget) {
                const residualCopyState = inspectLorebookCopyState(canonicalName, allUserHandles);
                const residualReferenceState = await inspectLorebookReferenceState(canonicalName, allUserHandles);
                if (hasAnyLorebookCopies(residualCopyState) || hasAnyLorebookReferences(residualReferenceState)) {
                    return await deleteResidualSecureLorebookArtifacts(user, canonicalName, allUserHandles);
                }

                throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
            }

            return await deleteAllSecureLorebookCopies(user, secureTarget, allUserHandles, { referenceUserHandles: secureReferenceUserHandles });
        }

        if (preferredStorage === 'user') {
            if (!userRecord || isSecureBackingLorebook) {
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

            const referenceCleanup = await migrateLorebookGenerationReferences({
                operation: 'delete',
                oldName: canonicalName,
                userHandles: referenceUserHandles,
                user,
            });

            return {
                name: canonicalName,
                storage: 'user',
                ownerHandle: user.profile.handle,
                referenceCleanup,
            };
        }

        if (sharedSecureRecord) {
            return await deleteAllSecureLorebookCopies(user, sharedSecureRecord, allUserHandles, { referenceUserHandles: secureReferenceUserHandles });
        }

        if (secureRecord) {
            return await deleteAllSecureLorebookCopies(user, secureRecord, allUserHandles, { referenceUserHandles: secureReferenceUserHandles });
        }

        if (userRecord && !isSecureBackingLorebook) {
            try {
                fs.unlinkSync(userRecord.path);
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
                }

                throw new LorebookRepositoryError('LorebookDeleteFailed', `Failed to delete lorebook "${canonicalName}".`, 500);
            }

            const referenceCleanup = await migrateLorebookGenerationReferences({
                operation: 'delete',
                oldName: canonicalName,
                userHandles: referenceUserHandles,
                user,
            });

            return {
                name: canonicalName,
                storage: 'user',
                ownerHandle: user.profile.handle,
                referenceCleanup,
            };
        }

        if (!userRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }
    });
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export async function promoteLorebook(user, name) {
    return runWithSecureLorebookMutationLock(() => {
        const canonicalName = assertCanonicalName(name);
        const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
        if (!userRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        assertLorebookNotReservedAsTemplate(user, canonicalName);

        assertSecurePromotionNameAllowed(user, canonicalName);
        assertSecureNameAvailableForPromotion(canonicalName);

        try {
            createSecureLorebookLink(canonicalName, user.profile.handle);
            writeSecureLorebookMetadata(canonicalName, user.profile.handle, user.profile.handle);
        } catch (error) {
            if (didPromoteSingleSecureLorebookSucceed(canonicalName, user.profile.handle)) {
                return buildLorebookMetadata(getSecureIndexEntry(canonicalName) || {
                    name: canonicalName,
                    storage: 'secure',
                    sharingMode: 'single',
                    ownerHandle: user.profile.handle,
                    ownerHandles: [user.profile.handle].filter(Boolean),
                }, user);
            }

            try {
                if (getSecureIndexMetadata(canonicalName) || fs.existsSync(getSecureLorebookPath(canonicalName))) {
                    removeSecureLorebook(canonicalName);
                }
            } catch (cleanupError) {
                console.error(`[Lorebooks] Failed to remove secure lorebook link for "${canonicalName}" after promotion metadata write failed.`, cleanupError);
                throw new LorebookRepositoryError('LorebookStateRepairFailed', `Failed to promote secure lorebook "${canonicalName}" cleanly. Manual repair may be required.`, 500);
            }

            throw error;
        }

        return {
            name: canonicalName,
            storage: 'secure',
            ownerHandle: user.profile.handle,
            ownerHandles: [user.profile.handle].filter(Boolean),
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
        };
    });
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export async function demoteLorebook(user, name) {
    return runWithSecureLorebookMutationLock(() => {
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
            ownerHandles: [secureRecord.ownerHandle].filter(Boolean),
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
        };
    });
}

export async function promoteLorebookToShared(user, sourceName, sharedName, ownerHandles, options = {}) {
    return runWithSecureLorebookMutationLock(() => {
        const sourceCanonicalName = assertCanonicalName(sourceName);
        const sharedCanonicalName = assertCanonicalName(sharedName);
        const localSourceRecord = getUserLorebookRecord(user.profile.handle, sourceCanonicalName);
        const secureSourceRecord = getSecureIndexEntry(sourceCanonicalName);
        const normalizedOwners = normalizeOwnerHandles(ownerHandles);
        assertLorebookNotReservedAsTemplate(user, sourceCanonicalName);
        const overwriteExistingShared = Boolean(options?.overwriteExistingShared);

        assertLorebookSaveNameAllowed(sharedName);
        assertSharedSecurePromotionNameAllowed(sharedCanonicalName);

        if (normalizedOwners.length < 2) {
            throw new LorebookRepositoryError('LorebookOwnersInvalid', 'Shared secure lorebooks must have at least two owners.', 400);
        }

        if (!localSourceRecord && !secureSourceRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${sourceCanonicalName}" not found.`, 404);
        }

        if (secureSourceRecord && !canManageSecureLorebook(user, secureSourceRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${sourceCanonicalName}" is not movable.`, 403);
        }

        const existingSharedTarget = getSharedSecureIndexEntry(sharedCanonicalName);
        const existingSecureTarget = getSecureIndexEntry(sharedCanonicalName);
        const existingUserTarget = getUserLorebookRecord(user.profile.handle, sharedCanonicalName);
        if (existingSharedTarget) {
            const existingOwnerHandles = normalizeOwnerHandles(existingSharedTarget.ownerHandles);
            const overwriteDetails = {
                name: sharedCanonicalName,
                ownerHandle: existingSharedTarget.ownerHandle,
                ownerHandles: existingOwnerHandles,
                checkedOutBy: String(existingSharedTarget.checkedOutBy || '').trim() || null,
                canOverwrite: canManageSecureLorebook(user, existingSharedTarget),
            };
            if (!overwriteExistingShared) {
                throw new LorebookRepositoryError(
                    'LorebookSharedOverwriteConfirmationRequired',
                    `Shared lorebook "${sharedCanonicalName}" already exists and is owned by ${existingOwnerHandles.join(', ')}.`,
                    409,
                    overwriteDetails,
                );
            }

            if (!overwriteDetails.canOverwrite) {
                throw new LorebookRepositoryError(
                    'LorebookAccessDenied',
                    `Shared lorebook "${sharedCanonicalName}" is already owned by ${existingOwnerHandles.join(', ')}.`,
                    403,
                    overwriteDetails,
                );
            }

            assertSharedLorebookCheckedOutForEdit(user, existingSharedTarget);
        }

        if (existingSecureTarget || (existingUserTarget && sharedCanonicalName !== sourceCanonicalName)) {
            throw new LorebookRepositoryError('LorebookAlreadyExists', `Lorebook "${sharedCanonicalName}" already exists.`, 409);
        }

        const sourceRecord = secureSourceRecord || localSourceRecord;
        const data = readLorebookFromRecord(sourceRecord, false);
        assertLorebookData(data, sourceCanonicalName);

        try {
            writeSharedSecureLorebook(sharedCanonicalName, data);
            writeSharedSecureLorebookMetadata(sharedCanonicalName, normalizedOwners, user.profile.handle, existingSharedTarget);
            if (secureSourceRecord) {
                removeSecureLorebook(sourceCanonicalName);
                const sourceBackingPath = getUserLorebookPath(secureSourceRecord.ownerHandle, sourceCanonicalName);
                if (sourceBackingPath && fs.existsSync(sourceBackingPath)) {
                    fs.unlinkSync(sourceBackingPath);
                }
            } else if (localSourceRecord?.path && fs.existsSync(localSourceRecord.path)) {
                fs.unlinkSync(localSourceRecord.path);
            }
        } catch (error) {
            if (didPromoteLorebookToSharedSucceed({ sourceCanonicalName, sharedCanonicalName, normalizedOwners, secureSourceRecord, localSourceRecord })) {
                const completedRecord = getSharedSecureIndexEntry(sharedCanonicalName);
                return buildLorebookMetadata(completedRecord || {
                    name: sharedCanonicalName,
                    storage: 'secure',
                    sharingMode: 'shared',
                    ownerHandle: getPrimaryOwnerHandle(normalizedOwners),
                    ownerHandles: normalizedOwners,
                    checkedOutBy: null,
                    checkedOutAt: null,
                }, user);
            }

            try {
                if (getSharedSecureIndexMetadata(sharedCanonicalName) || fs.existsSync(getSharedSecureLorebookPath(sharedCanonicalName))) {
                    removeSharedSecureLorebook(sharedCanonicalName);
                }
            } catch (cleanupError) {
                console.error(`[Lorebooks] Failed to clean up shared secure lorebook "${sharedCanonicalName}" after promotion failed.`, cleanupError);
                throw new LorebookRepositoryError('LorebookStateRepairFailed', `Failed to promote shared secure lorebook "${sharedCanonicalName}" cleanly. Manual repair may be required.`, 500);
            }

            throw error;
        }

        const nextRecord = getSharedSecureIndexEntry(sharedCanonicalName);
        return buildLorebookMetadata(nextRecord || {
            name: sharedCanonicalName,
            storage: 'secure',
            sharingMode: 'shared',
            ownerHandle: getPrimaryOwnerHandle(normalizedOwners),
            ownerHandles: normalizedOwners,
            checkedOutBy: null,
            checkedOutAt: null,
        }, user);
    });
}

export async function updateSharedLorebookOwners(user, name, ownerHandles) {
    return runWithSecureLorebookMutationLock(() => {
        const canonicalName = assertCanonicalName(name);
        const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
        const normalizedOwners = normalizeOwnerHandles(ownerHandles);

        if (!sharedSecureRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        if (!canManageSecureLorebook(user, sharedSecureRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not editable.`, 403);
        }

        assertSharedLorebookCheckedOutForEdit(user, sharedSecureRecord);
        writeSharedSecureLorebookMetadata(canonicalName, normalizedOwners, user.profile.handle, sharedSecureRecord);
        return buildLorebookMetadata(getSharedSecureIndexEntry(canonicalName) || sharedSecureRecord, user);
    });
}

export async function checkoutSharedLorebook(user, name, force = false) {
    return runWithSecureLorebookMutationLock(() => {
        const canonicalName = assertCanonicalName(name);
        const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
        if (!sharedSecureRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        if (!canManageSecureLorebook(user, sharedSecureRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not accessible.`, 403);
        }

        const currentHandle = String(user?.profile?.handle || '').trim();
        const checkedOutBy = String(sharedSecureRecord.checkedOutBy || '').trim();
        if (checkedOutBy && checkedOutBy !== currentHandle && !force) {
            throw new LorebookRepositoryError('LorebookCheckedOut', `Lorebook "${canonicalName}" is checked out by ${checkedOutBy}.`, 423);
        }

        if (checkedOutBy && checkedOutBy !== currentHandle && force && !user?.profile?.admin) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is checked out by ${checkedOutBy}.`, 403);
        }

        const timestamp = new Date().toISOString();
        mutateSharedSecureIndex(index => {
            const record = index.books[canonicalName];
            if (!record) {
                throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
            }
            record.checkedOutBy = currentHandle;
            record.checkedOutAt = timestamp;
            record.updatedAt = timestamp;
            record.updatedBy = currentHandle;
        });

        return buildLorebookMetadata(getSharedSecureIndexEntry(canonicalName) || sharedSecureRecord, user);
    });
}

export async function checkinSharedLorebook(user, name, force = false) {
    return runWithSecureLorebookMutationLock(() => {
        const canonicalName = assertCanonicalName(name);
        const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
        if (!sharedSecureRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        if (!canManageSecureLorebook(user, sharedSecureRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not accessible.`, 403);
        }

        const currentHandle = String(user?.profile?.handle || '').trim();
        const checkedOutBy = String(sharedSecureRecord.checkedOutBy || '').trim();
        if (checkedOutBy && checkedOutBy !== currentHandle && !force) {
            throw new LorebookRepositoryError('LorebookCheckedOut', `Lorebook "${canonicalName}" is checked out by ${checkedOutBy}.`, 423);
        }

        if (checkedOutBy && checkedOutBy !== currentHandle && force && !user?.profile?.admin) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is checked out by ${checkedOutBy}.`, 403);
        }

        const timestamp = new Date().toISOString();
        mutateSharedSecureIndex(index => {
            const record = index.books[canonicalName];
            if (!record) {
                throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
            }
            record.checkedOutBy = null;
            record.checkedOutAt = null;
            record.updatedAt = timestamp;
            record.updatedBy = currentHandle;
        });

        return buildLorebookMetadata(getSharedSecureIndexEntry(canonicalName) || sharedSecureRecord, user);
    });
}

export async function unshareLorebook(user, name, targetOwnerHandle) {
    return runWithSecureLorebookMutationLock(() => {
        const canonicalName = assertCanonicalName(name);
        const sharedSecureRecord = getSharedSecureIndexEntry(canonicalName);
        const normalizedTargetOwnerHandle = String(targetOwnerHandle || '').trim();
        if (!normalizedTargetOwnerHandle) {
            throw new LorebookRepositoryError('LorebookOwnersInvalid', 'Target owner handle is required.', 400);
        }
        const sharedSlug = canonicalName.startsWith('Y-') ? canonicalName.slice(2) : canonicalName;
        const targetName = `Z-${normalizedTargetOwnerHandle}-${sharedSlug}`;

        if (!user?.profile?.admin) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not movable.`, 403);
        }

        if (!sharedSecureRecord) {
            throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
        }

        const existingTargetUser = getUserLorebookRecord(normalizedTargetOwnerHandle, targetName);
        const existingTargetSecure = getSecureIndexEntry(targetName);
        const existingTargetShared = getSharedSecureIndexEntry(targetName);
        if (existingTargetUser || existingTargetSecure || existingTargetShared) {
            throw new LorebookRepositoryError('LorebookAlreadyExists', `Lorebook "${targetName}" already exists.`, 409);
        }

        const data = readLorebookFromRecord(sharedSecureRecord, false);
        assertLorebookData(data, canonicalName);

        try {
            writeUserLorebook(normalizedTargetOwnerHandle, targetName, data);
            createSecureLorebookLink(targetName, normalizedTargetOwnerHandle);
            writeSecureLorebookMetadata(targetName, normalizedTargetOwnerHandle, user.profile.handle);
            removeSharedSecureLorebook(canonicalName);
        } catch (error) {
            if (didUnshareLorebookSucceed(canonicalName, targetName, normalizedTargetOwnerHandle)) {
                return buildLorebookMetadata(getSecureIndexEntry(targetName) || {
                    name: targetName,
                    storage: 'secure',
                    sharingMode: 'single',
                    ownerHandle: normalizedTargetOwnerHandle,
                    ownerHandles: [normalizedTargetOwnerHandle].filter(Boolean),
                }, user);
            }

            try {
                if (getSecureIndexMetadata(targetName) || fs.existsSync(getSecureLorebookPath(targetName))) {
                    removeSecureLorebook(targetName);
                }
                removeUserLorebookCopy(normalizedTargetOwnerHandle, targetName);
            } catch (cleanupError) {
                console.error(`[Lorebooks] Failed to clean up secure lorebook "${targetName}" after unshare failed.`, cleanupError);
                throw new LorebookRepositoryError('LorebookStateRepairFailed', `Failed to unshare lorebook "${canonicalName}" cleanly. Manual repair may be required.`, 500);
            }
            throw error;
        }

        return {
            name: targetName,
            storage: 'secure',
            ownerHandle: normalizedTargetOwnerHandle,
            ownerHandles: [normalizedTargetOwnerHandle].filter(Boolean),
            sharingMode: 'single',
            checkedOutBy: null,
            checkedOutAt: null,
            checkoutState: 'available',
            canCheckOut: false,
            canCheckIn: false,
            canForceCheckout: false,
            canManageOwners: false,
        };
    });
}
