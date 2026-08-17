import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';

import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { parse, write } from './character-card-parser.js';
import { getCharacterOwnerHandle, getCharacterOwnerHandles, getCharacterSharedKey } from './character-linked-lorebooks.js';
import { getUserDirectories } from './users.js';

const SHARED_CHARACTER_DIRECTORY = ['_secure', 'shared-characters'];
const SHARED_CHARACTER_INDEX_FILENAME = 'index.json';
const SHARED_CHARACTER_INDEX_LOCK_SUFFIX = '.lock';
const SHARED_CHARACTER_INDEX_LOCK_RETRY_MS = 50;
const SHARED_CHARACTER_INDEX_LOCK_TIMEOUT_MS = 10_000;
const SHARED_CHARACTER_INDEX_LOCK_STALE_MS = 60_000;
const SHARED_CHARACTER_INDEX_LOCK_HEARTBEAT_MS = 15_000;
const SHARED_CHARACTER_INDEX_LOCK_OWNER_FILENAME = 'owner.json';
let sharedCharacterWriteQueue = Promise.resolve();

export class CharacterSharingRepositoryError extends Error {
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

function runWithSharedCharacterLock(operation) {
    const queuedOperation = sharedCharacterWriteQueue.catch(() => { }).then(async () => {
        const release = await acquireSharedCharacterWriteLock();

        try {
            return await operation();
        } finally {
            await release();
        }
    });
    sharedCharacterWriteQueue = queuedOperation.catch(() => { });
    return queuedOperation;
}

function ensureDirectory(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getSharedCharacterDirectory() {
    if (!globalThis.DATA_ROOT) {
        throw new Error('DATA_ROOT must be defined before using character sharing repository');
    }

    return ensureDirectory(path.join(globalThis.DATA_ROOT, ...SHARED_CHARACTER_DIRECTORY));
}

function getSharedCharacterIndexPath() {
    return path.join(getSharedCharacterDirectory(), SHARED_CHARACTER_INDEX_FILENAME);
}

function getSharedCharacterIndexLockPath() {
    return `${getSharedCharacterIndexPath()}${SHARED_CHARACTER_INDEX_LOCK_SUFFIX}`;
}

function getSharedCharacterIndexLockOwnerPath(lockPath) {
    return path.join(lockPath, SHARED_CHARACTER_INDEX_LOCK_OWNER_FILENAME);
}

function sleep(ms) {
    if (ms <= 0) {
        return Promise.resolve();
    }

    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readSharedCharacterIndexLockOwner(lockPath) {
    try {
        const raw = await fsPromises.readFile(getSharedCharacterIndexLockOwnerPath(lockPath), 'utf8');
        const owner = JSON.parse(raw);
        return {
            token: String(owner?.token || ''),
            pid: Number(owner?.pid) || null,
            createdAt: owner?.createdAt || null,
        };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }

        if (error instanceof SyntaxError) {
            return null;
        }

        throw error;
    }
}

async function writeSharedCharacterIndexLockOwner(lockPath, token) {
    const timestamp = new Date().toISOString();
    const owner = {
        token,
        pid: process.pid,
        createdAt: timestamp,
    };
    await fsPromises.writeFile(getSharedCharacterIndexLockOwnerPath(lockPath), JSON.stringify(owner), { flag: 'wx' });
}

async function ownsSharedCharacterIndexLock(lockPath, token) {
    const owner = await readSharedCharacterIndexLockOwner(lockPath);
    return owner?.token === token;
}

async function refreshSharedCharacterIndexLock(lockPath, token) {
    if (!await ownsSharedCharacterIndexLock(lockPath, token)) {
        return false;
    }

    const now = new Date();
    await fsPromises.utimes(getSharedCharacterIndexLockOwnerPath(lockPath), now, now);
    return true;
}

function startSharedCharacterIndexLockHeartbeat(lockPath, token) {
    let pending = false;
    let stopped = false;
    let timer = null;
    const stop = () => {
        stopped = true;
        if (timer) {
            clearInterval(timer);
        }
    };
    const beat = () => {
        if (pending || stopped) {
            return;
        }

        pending = true;
        refreshSharedCharacterIndexLock(lockPath, token)
            .then(ownsLock => {
                if (!ownsLock) {
                    stop();
                }
            })
            .catch(error => {
                if (error?.code !== 'ENOENT') {
                    console.warn('[Characters] Failed to refresh shared character index lock.', error);
                }
            })
            .finally(() => {
                pending = false;
            });
    };

    timer = setInterval(beat, SHARED_CHARACTER_INDEX_LOCK_HEARTBEAT_MS);
    timer.unref?.();
    return stop;
}

async function isSharedCharacterIndexLockStale(lockPath) {
    try {
        const ownerPath = getSharedCharacterIndexLockOwnerPath(lockPath);
        const stats = fs.existsSync(ownerPath)
            ? await fsPromises.stat(ownerPath)
            : await fsPromises.stat(lockPath);
        return Date.now() - stats.mtimeMs > SHARED_CHARACTER_INDEX_LOCK_STALE_MS;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

async function removeSharedCharacterIndexLock(lockPath, token = null) {
    try {
        if (token) {
            if (!await ownsSharedCharacterIndexLock(lockPath, token)) {
                return;
            }

            await fsPromises.unlink(getSharedCharacterIndexLockOwnerPath(lockPath));
        }

        await fsPromises.rmdir(lockPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }

        if (error?.code === 'ENOTEMPTY') {
            if (token) {
                throw error;
            }

            await fsPromises.rm(lockPath, { recursive: true, force: false });
            return;
        }

        throw error;
    }
}

async function acquireSharedCharacterWriteLock() {
    const lockPath = getSharedCharacterIndexLockPath();
    ensureDirectory(path.dirname(lockPath));
    const deadline = Date.now() + SHARED_CHARACTER_INDEX_LOCK_TIMEOUT_MS;

    while (true) {
        try {
            await fsPromises.mkdir(lockPath);
            const token = randomUUID();
            try {
                await writeSharedCharacterIndexLockOwner(lockPath, token);
            } catch (error) {
                await removeSharedCharacterIndexLock(lockPath);
                throw error;
            }
            const stopHeartbeat = startSharedCharacterIndexLockHeartbeat(lockPath, token);
            return async () => {
                stopHeartbeat();
                await removeSharedCharacterIndexLock(lockPath, token);
            };
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            if (await isSharedCharacterIndexLockStale(lockPath)) {
                await removeSharedCharacterIndexLock(lockPath);
                continue;
            }

            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                throw new CharacterSharingRepositoryError('CharacterIndexBusy', 'Timed out waiting to update the shared character index.', 503);
            }

            await sleep(Math.min(SHARED_CHARACTER_INDEX_LOCK_RETRY_MS, remainingMs));
        }
    }
}

/**
 * Normalizes a character avatar or shared-character key to its canonical filename stem.
 * @param {string} value Character file name or key.
 * @returns {string}
 */
export function normalizeCharacterName(value) {
    const parsedName = path.parse(String(value || '')).name || String(value || '');
    const sanitizedName = sanitize(parsedName).trim();

    if (!sanitizedName) {
        throw new CharacterSharingRepositoryError('CharacterNameInvalid', 'Character must have a valid filename.', 400);
    }

    return sanitizedName;
}

function normalizeOptionalCharacterName(value) {
    const normalizedValue = String(value || '').trim();
    return normalizedValue ? normalizeCharacterName(normalizedValue) : '';
}

function getSharedCharacterPath(name) {
    return path.join(getSharedCharacterDirectory(), `${normalizeCharacterName(name)}.png`);
}

export function getSharedCharacterKeyForFilePath(filePath) {
    try {
        const resolvedPath = fs.realpathSync(filePath);
        const sharedDirectory = path.resolve(getSharedCharacterDirectory());
        if (path.dirname(resolvedPath) !== sharedDirectory) {
            return '';
        }

        return normalizeCharacterName(path.parse(resolvedPath).name);
    } catch {
        return '';
    }
}

function normalizeOwnerHandles(ownerHandles) {
    return [...new Set((Array.isArray(ownerHandles) ? ownerHandles : [])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
}

function getPrimaryOwnerHandle(ownerHandles) {
    return normalizeOwnerHandles(ownerHandles)[0] || '';
}

function normalizeSharedCharacterIndex(index) {
    const characters = index?.characters && typeof index.characters === 'object' && !Array.isArray(index.characters)
        ? index.characters
        : {};
    const normalizedCharacters = {};

    for (const [name, metadata] of Object.entries(characters)) {
        const canonicalName = normalizeCharacterName(name);
        const ownerHandles = normalizeOwnerHandles(metadata?.ownerHandles || [metadata?.ownerHandle]);
        if (ownerHandles.length < 2) {
            continue;
        }

        normalizedCharacters[canonicalName] = {
            ownerHandles,
            checkedOutBy: String(metadata?.checkedOutBy || '').trim() || null,
            checkedOutAt: metadata?.checkedOutAt || null,
            createdAt: metadata?.createdAt || null,
            updatedAt: metadata?.updatedAt || null,
            createdBy: metadata?.createdBy || null,
            updatedBy: metadata?.updatedBy || null,
        };
    }

    return {
        version: Number(index?.version) || 1,
        characters: normalizedCharacters,
    };
}

async function readSharedCharacterIndex() {
    const indexPath = getSharedCharacterIndexPath();
    if (!fs.existsSync(indexPath)) {
        return { version: 1, characters: {} };
    }

    try {
        const raw = await fsPromises.readFile(indexPath, 'utf8');
        return normalizeSharedCharacterIndex(JSON.parse(raw));
    } catch (error) {
        console.warn('[Characters] Failed to read shared character index. Recreating it.', error);
        return { version: 1, characters: {} };
    }
}

export async function readSharedCharacterIndexSnapshot() {
    return await readSharedCharacterIndex();
}

async function writeSharedCharacterIndex(index) {
    await writeFileAtomic(getSharedCharacterIndexPath(), JSON.stringify(index, null, 4));
}


async function withSharedCharacterTransaction(transaction, { onRollback = null, rollbackMessage = 'Failed to restore shared character state.' } = {}) {
    return runWithSharedCharacterLock(async () => {
        const index = await readSharedCharacterIndex();

        try {
            const result = await transaction(index);
            await writeSharedCharacterIndex(index);
            return result;
        } catch (error) {
            if (typeof onRollback === 'function') {
                try {
                    await onRollback(error);
                } catch (rollbackError) {
                    console.error('[Characters] Shared character rollback failed.', rollbackError);
                    throw new CharacterSharingRepositoryError('CharacterStateRepairFailed', rollbackMessage, 500);
                }
            }

            throw error;
        }
    });
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

export function canManageSharedCharacter(user, record) {
    if (!record || record.sharingMode !== 'shared') {
        return false;
    }

    if (user?.profile?.admin) {
        return true;
    }

    const currentHandle = String(user?.profile?.handle || '').trim();
    return currentHandle ? normalizeOwnerHandles(record.ownerHandles).includes(currentHandle) : false;
}

function buildCharacterMetadata(record, user = null) {
    const ownerHandles = normalizeOwnerHandles(record?.ownerHandles || [record?.ownerHandle]);
    const sharingMode = record?.sharingMode === 'shared' ? 'shared' : 'single';
    const sharedCharacterKey = sharingMode === 'shared'
        ? normalizeCharacterName(record?.sharedCharacterKey || record?.name || '')
        : normalizeOptionalCharacterName(record?.sharedCharacterKey);
    const checkoutState = getCheckoutState(user, record);
    const canManage = canManageSharedCharacter(user, {
        ...record,
        ownerHandles,
        sharingMode,
    });
    const isAdmin = Boolean(user?.profile?.admin);

    return {
        name: normalizeCharacterName(record?.name || ''),
        ownerHandle: getPrimaryOwnerHandle(ownerHandles) || String(record?.ownerHandle || '').trim(),
        ownerHandles,
        sharingMode,
        sharedCharacterKey,
        checkedOutBy: sharingMode === 'shared' ? (String(record?.checkedOutBy || '').trim() || null) : null,
        checkedOutAt: sharingMode === 'shared' ? (record?.checkedOutAt || null) : null,
        checkoutState,
        canCheckOut: sharingMode === 'shared' && canManage && checkoutState === 'available',
        canCheckIn: sharingMode === 'shared' && checkoutState === 'self',
        canForceCheckout: sharingMode === 'shared' && isAdmin && checkoutState === 'other',
        canManageOwners: sharingMode === 'shared' && (isAdmin || (canManage && checkoutState === 'self')),
    };
}

function getUserCharacterPath(handle, name) {
    const directories = getUserDirectories(String(handle || '').trim());
    return path.join(directories.characters, `${normalizeCharacterName(name)}.png`);
}

function createSharedCharacterSymlink(linkPath, targetPath, canonicalName) {
    ensureDirectory(path.dirname(linkPath));
    const relativeTargetPath = path.relative(path.dirname(linkPath), targetPath) || path.basename(targetPath);

    try {
        fs.symlinkSync(relativeTargetPath, linkPath, 'file');
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new CharacterSharingRepositoryError('CharacterAlreadyShared', `Character "${canonicalName}" already has a shared link.`, 409);
        }

        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
            const message = process.platform === 'win32'
                ? 'Could not create the shared character link. On Windows, enable Developer Mode or run the server with permission to create symlinks.'
                : 'Could not create the shared character link. Check filesystem permissions and symlink support.';
            throw new CharacterSharingRepositoryError('CharacterSymlinkCreationFailed', message, 500);
        }

        throw error;
    }
}

function assertSharedCharacterCheckedOutForEdit(user, record) {
    if (record?.sharingMode !== 'shared') {
        return;
    }

    if (user?.profile?.admin) {
        return;
    }

    const currentHandle = String(user?.profile?.handle || '').trim();
    const checkedOutBy = String(record?.checkedOutBy || '').trim();
    if (!checkedOutBy) {
        throw new CharacterSharingRepositoryError('CharacterCheckedOut', `Character "${record.name}" must be checked out before editing shared ownership.`, 423);
    }

    if (checkedOutBy !== currentHandle) {
        throw new CharacterSharingRepositoryError('CharacterCheckedOut', `Character "${record.name}" is checked out by ${checkedOutBy}.`, 423);
    }
}

async function readCharacterCardFile(filePath) {
    const [rawBuffer, rawCard] = await Promise.all([
        fsPromises.readFile(filePath),
        parse(filePath, 'png'),
    ]);

    return {
        rawBuffer,
        card: JSON.parse(rawCard),
    };
}

async function writeCharacterCardFile(rawBuffer, card, outputPath) {
    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
    const outputBuffer = write(rawBuffer, JSON.stringify(card));
    await writeFileAtomic(outputPath, outputBuffer);
}

export function setCharacterSharingMetadata(characterCard, { ownerHandles, sharingMode = 'single', sharedCharacterKey = '' }) {
    const normalizedOwnerHandles = normalizeOwnerHandles(ownerHandles);
    const normalizedSharingMode = sharingMode === 'shared' ? 'shared' : 'single';
    const primaryOwnerHandle = getPrimaryOwnerHandle(normalizedOwnerHandles);
    const normalizedSharedCharacterKey = normalizedSharingMode === 'shared'
        ? normalizeCharacterName(sharedCharacterKey || 'character')
        : normalizeOptionalCharacterName(sharedCharacterKey);

    if (normalizedSharingMode === 'shared' && normalizedOwnerHandles.length < 2) {
        throw new CharacterSharingRepositoryError('CharacterOwnersInvalid', 'Shared characters must have at least two owners.', 400);
    }

    characterCard.data ??= {};
    characterCard.data.extensions ??= {};
    characterCard.data.extensions.aikobots ??= {};
    characterCard.data.extensions.aikobots.owner_handle = primaryOwnerHandle;
    characterCard.data.extensions.aikobots.owner_handles = normalizedSharingMode === 'shared'
        ? normalizedOwnerHandles
        : normalizedOwnerHandles.slice(0, 1);
    characterCard.data.extensions.aikobots.sharing_mode = normalizedSharingMode;
    if (normalizedSharedCharacterKey) {
        characterCard.data.extensions.aikobots.shared_character_key = normalizedSharedCharacterKey;
    } else {
        delete characterCard.data.extensions.aikobots.shared_character_key;
    }
}



function canPromoteCharacter(user, characterCard) {
    if (user?.profile?.admin) {
        return true;
    }

    const ownerHandles = getCharacterOwnerHandles(characterCard);
    if (ownerHandles.length === 0) {
        return true;
    }

    const currentHandle = String(user?.profile?.handle || '').trim();
    return currentHandle ? ownerHandles.includes(currentHandle) : false;
}

function getSharedCharacterIndexRecord(index, name) {
    const canonicalName = normalizeCharacterName(name);
    const record = index.characters[canonicalName];
    if (!record) {
        return null;
    }

    return {
        name: canonicalName,
        ownerHandle: getPrimaryOwnerHandle(record.ownerHandles),
        ownerHandles: normalizeOwnerHandles(record.ownerHandles),
        sharingMode: 'shared',
        sharedCharacterKey: canonicalName,
        checkedOutBy: String(record.checkedOutBy || '').trim() || null,
        checkedOutAt: record.checkedOutAt || null,
        createdAt: record.createdAt || null,
        updatedAt: record.updatedAt || null,
        createdBy: record.createdBy || null,
        updatedBy: record.updatedBy || null,
    };
}

export async function getSharedCharacterRecord(name, { sharedIndex = null } = {}) {
    const index = sharedIndex || await readSharedCharacterIndex();
    return getSharedCharacterIndexRecord(index, name);
}

export async function getCharacterMetadata({ characterCard = null, filenameStem = '', user = null, sharedIndex = null } = {}) {
    const fallbackName = normalizeCharacterName(filenameStem || 'character');
    const sharedRecord = await getSharedCharacterRecord(fallbackName, { sharedIndex });
    if (sharedRecord) {
        return buildCharacterMetadata(sharedRecord, user);
    }

    const ownerHandles = getCharacterOwnerHandles(characterCard);
    const ownerHandle = getPrimaryOwnerHandle(ownerHandles) || getCharacterOwnerHandle(characterCard);
    return buildCharacterMetadata({
        name: fallbackName,
        ownerHandle,
        ownerHandles,
        sharingMode: 'single',
        sharedCharacterKey: getCharacterSharedKey(characterCard),
        checkedOutBy: null,
        checkedOutAt: null,
    }, user);
}

export async function promoteCharacterToShared(user, avatarName, ownerHandles) {
    const canonicalName = normalizeCharacterName(avatarName);
    const normalizedOwners = normalizeOwnerHandles(ownerHandles);
    const promoterHandle = String(user?.profile?.handle || '').trim();
    if (!promoterHandle || !normalizedOwners.includes(promoterHandle)) {
        throw new CharacterSharingRepositoryError('CharacterOwnersInvalid', 'Promoting users must be included in shared character owners.', 400);
    }

    if (normalizedOwners.length < 2) {
        throw new CharacterSharingRepositoryError('CharacterOwnersInvalid', 'Shared characters must have at least two owners.', 400);
    }

    const sourcePath = path.join(user.directories.characters, `${canonicalName}.png`);
    if (!fs.existsSync(sourcePath)) {
        throw new CharacterSharingRepositoryError('CharacterNotFound', `Character "${canonicalName}" not found.`, 404);
    }

    const destinationPath = getSharedCharacterPath(canonicalName);
    const createdLinks = [];
    let originalRawBuffer = null;
    let originalCard = null;
    let wroteCanonicalCharacter = false;

    return withSharedCharacterTransaction(async index => {
        const existingSharedRecord = getSharedCharacterIndexRecord(index, canonicalName);
        if (existingSharedRecord) {
            throw new CharacterSharingRepositoryError(
                'CharacterAlreadyShared',
                `Character "${canonicalName}" is already shared by ${existingSharedRecord.ownerHandles.join(', ')}.`,
                409,
                { ownerHandles: existingSharedRecord.ownerHandles, checkedOutBy: existingSharedRecord.checkedOutBy },
            );
        }

        for (const handle of normalizedOwners) {
            const targetPath = getUserCharacterPath(handle, canonicalName);
            if (handle !== promoterHandle && fs.existsSync(targetPath)) {
                throw new CharacterSharingRepositoryError('CharacterAlreadyExists', `Character "${canonicalName}" already exists for ${handle}.`, 409);
            }
        }

        const { rawBuffer, card } = await readCharacterCardFile(sourcePath);
        originalRawBuffer = rawBuffer;
        originalCard = structuredClone(card);

        if (!canPromoteCharacter(user, card)) {
            const ownerLabel = normalizeOwnerHandles(getCharacterOwnerHandles(card)).join(', ') || getCharacterOwnerHandle(card) || 'the current owner';
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Only ${ownerLabel} and admins can share this character.`, 403);
        }

        setCharacterSharingMetadata(card, { ownerHandles: normalizedOwners, sharingMode: 'shared', sharedCharacterKey: canonicalName });
        await writeCharacterCardFile(rawBuffer, card, destinationPath);
        wroteCanonicalCharacter = true;

        const linkHandles = [
            ...normalizedOwners.filter(handle => handle !== promoterHandle),
            ...normalizedOwners.filter(handle => handle === promoterHandle),
        ];

        for (const handle of linkHandles) {
            const targetPath = getUserCharacterPath(handle, canonicalName);
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
            }

            createSharedCharacterSymlink(targetPath, destinationPath, canonicalName);
            createdLinks.push(targetPath);
        }

        const timestamp = new Date().toISOString();
        index.characters[canonicalName] = {
            ownerHandles: normalizedOwners,
            checkedOutBy: null,
            checkedOutAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: promoterHandle,
            updatedBy: promoterHandle,
        };

        return buildCharacterMetadata(getSharedCharacterIndexRecord(index, canonicalName), user);
    }, {
        onRollback: async () => {
            if (!wroteCanonicalCharacter && createdLinks.length === 0) {
                return;
            }

            for (const linkPath of createdLinks) {
                if (fs.existsSync(linkPath)) {
                    fs.unlinkSync(linkPath);
                }
            }

            if (normalizedOwners.includes(promoterHandle) && !fs.existsSync(sourcePath) && originalRawBuffer && originalCard) {
                await writeCharacterCardFile(originalRawBuffer, originalCard, sourcePath);
            }

            if (wroteCanonicalCharacter && fs.existsSync(destinationPath)) {
                fs.unlinkSync(destinationPath);
            }
        },
        rollbackMessage: `Failed to promote shared character "${canonicalName}" cleanly. Manual repair may be required.`,
    });
}

export async function updateSharedCharacterOwners(user, name, ownerHandles) {
    const canonicalName = normalizeCharacterName(name);
    const normalizedOwners = normalizeOwnerHandles(ownerHandles);
    const destinationPath = getSharedCharacterPath(canonicalName);
    const createdLinks = [];
    const removedLinks = [];
    let originalCanonicalRawBuffer = null;
    let originalCanonicalCard = null;
    let updatedCanonicalCharacter = false;

    return withSharedCharacterTransaction(async index => {
        const sharedRecord = getSharedCharacterIndexRecord(index, canonicalName);
        if (!sharedRecord) {
            throw new CharacterSharingRepositoryError('CharacterNotFound', `Character "${canonicalName}" not found.`, 404);
        }

        if (normalizedOwners.length < 2) {
            throw new CharacterSharingRepositoryError('CharacterOwnersInvalid', 'Shared characters must have at least two owners.', 400);
        }

        if (!canManageSharedCharacter(user, sharedRecord)) {
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Character "${canonicalName}" is not editable.`, 403);
        }

        assertSharedCharacterCheckedOutForEdit(user, sharedRecord);

        for (const handle of normalizedOwners) {
            const targetPath = getUserCharacterPath(handle, canonicalName);
            if (!sharedRecord.ownerHandles.includes(handle) && fs.existsSync(targetPath)) {
                throw new CharacterSharingRepositoryError('CharacterAlreadyExists', `Character "${canonicalName}" already exists for ${handle}.`, 409);
            }
        }

        const { rawBuffer, card } = await readCharacterCardFile(destinationPath);
        originalCanonicalRawBuffer = rawBuffer;
        originalCanonicalCard = structuredClone(card);

        for (const handle of normalizedOwners.filter(handle => !sharedRecord.ownerHandles.includes(handle))) {
            const linkPath = getUserCharacterPath(handle, canonicalName);
            createSharedCharacterSymlink(linkPath, destinationPath, canonicalName);
            createdLinks.push(linkPath);
        }

        setCharacterSharingMetadata(card, { ownerHandles: normalizedOwners, sharingMode: 'shared', sharedCharacterKey: canonicalName });
        await writeCharacterCardFile(rawBuffer, card, destinationPath);
        updatedCanonicalCharacter = true;

        for (const handle of sharedRecord.ownerHandles.filter(handle => !normalizedOwners.includes(handle))) {
            const targetPath = getUserCharacterPath(handle, canonicalName);
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
                removedLinks.push(targetPath);
            }
        }

        const record = index.characters[canonicalName];
        if (!record) {
            throw new CharacterSharingRepositoryError('CharacterNotFound', `Character "${canonicalName}" not found.`, 404);
        }

        record.ownerHandles = normalizedOwners;
        record.updatedAt = new Date().toISOString();
        record.updatedBy = user.profile.handle;
        if (!normalizedOwners.includes(String(record.checkedOutBy || '').trim())) {
            record.checkedOutBy = null;
            record.checkedOutAt = null;
        }

        return buildCharacterMetadata(getSharedCharacterIndexRecord(index, canonicalName), user);
    }, {
        onRollback: async () => {
            if (!updatedCanonicalCharacter && createdLinks.length === 0 && removedLinks.length === 0) {
                return;
            }

            for (const linkPath of createdLinks) {
                if (fs.existsSync(linkPath)) {
                    fs.unlinkSync(linkPath);
                }
            }

            if (updatedCanonicalCharacter && originalCanonicalRawBuffer && originalCanonicalCard) {
                await writeCharacterCardFile(originalCanonicalRawBuffer, originalCanonicalCard, destinationPath);
            }

            for (const linkPath of removedLinks) {
                if (!fs.existsSync(linkPath)) {
                    createSharedCharacterSymlink(linkPath, destinationPath, canonicalName);
                }
            }
        },
        rollbackMessage: `Failed to update shared character "${canonicalName}" cleanly. Manual repair may be required.`,
    });
}

export async function checkoutSharedCharacter(user, name, force = false) {
    const canonicalName = normalizeCharacterName(name);
    return withSharedCharacterTransaction(async index => {
        const sharedRecord = getSharedCharacterIndexRecord(index, canonicalName);
        if (!sharedRecord) {
            throw new CharacterSharingRepositoryError('CharacterNotFound', `Character "${canonicalName}" not found.`, 404);
        }

        if (!canManageSharedCharacter(user, sharedRecord)) {
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Character "${canonicalName}" is not accessible.`, 403);
        }

        const currentHandle = String(user?.profile?.handle || '').trim();
        const checkedOutBy = String(sharedRecord.checkedOutBy || '').trim();
        if (checkedOutBy && checkedOutBy !== currentHandle && !force) {
            throw new CharacterSharingRepositoryError('CharacterCheckedOut', `Character "${canonicalName}" is checked out by ${checkedOutBy}.`, 423);
        }

        if (checkedOutBy && checkedOutBy !== currentHandle && force && !user?.profile?.admin) {
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Character "${canonicalName}" is checked out by ${checkedOutBy}.`, 403);
        }

        const record = index.characters[canonicalName];
        const timestamp = new Date().toISOString();
        record.checkedOutBy = currentHandle;
        record.checkedOutAt = timestamp;
        record.updatedAt = timestamp;
        record.updatedBy = currentHandle;

        return buildCharacterMetadata(getSharedCharacterIndexRecord(index, canonicalName), user);
    });
}

export async function checkinSharedCharacter(user, name, force = false) {
    const canonicalName = normalizeCharacterName(name);
    return withSharedCharacterTransaction(async index => {
        const sharedRecord = getSharedCharacterIndexRecord(index, canonicalName);
        if (!sharedRecord) {
            throw new CharacterSharingRepositoryError('CharacterNotFound', `Character "${canonicalName}" not found.`, 404);
        }

        if (!canManageSharedCharacter(user, sharedRecord)) {
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Character "${canonicalName}" is not accessible.`, 403);
        }

        const currentHandle = String(user?.profile?.handle || '').trim();
        const checkedOutBy = String(sharedRecord.checkedOutBy || '').trim();
        if (checkedOutBy && checkedOutBy !== currentHandle && !force) {
            throw new CharacterSharingRepositoryError('CharacterCheckedOut', `Character "${canonicalName}" is checked out by ${checkedOutBy}.`, 423);
        }

        if (checkedOutBy && checkedOutBy !== currentHandle && force && !user?.profile?.admin) {
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Character "${canonicalName}" is checked out by ${checkedOutBy}.`, 403);
        }

        const record = index.characters[canonicalName];
        const timestamp = new Date().toISOString();
        record.checkedOutBy = null;
        record.checkedOutAt = null;
        record.updatedAt = timestamp;
        record.updatedBy = currentHandle;

        return buildCharacterMetadata(getSharedCharacterIndexRecord(index, canonicalName), user);
    });
}

export async function deleteSharedCharacter(user, name) {
    const canonicalName = normalizeCharacterName(name);
    const destinationPath = getSharedCharacterPath(canonicalName);
    const removedLinks = [];
    let originalCanonicalRawBuffer = null;
    let originalCanonicalCard = null;

    return withSharedCharacterTransaction(async index => {
        const sharedRecord = getSharedCharacterIndexRecord(index, canonicalName);
        if (!sharedRecord) {
            throw new CharacterSharingRepositoryError('CharacterNotFound', `Character "${canonicalName}" not found.`, 404);
        }

        if (!user?.profile?.admin) {
            throw new CharacterSharingRepositoryError('CharacterAccessDenied', `Character "${canonicalName}" is not deletable.`, 403);
        }

        if (fs.existsSync(destinationPath)) {
            const { rawBuffer, card } = await readCharacterCardFile(destinationPath);
            originalCanonicalRawBuffer = rawBuffer;
            originalCanonicalCard = structuredClone(card);
        }

        for (const handle of sharedRecord.ownerHandles) {
            const linkPath = getUserCharacterPath(handle, canonicalName);
            if (fs.existsSync(linkPath)) {
                fs.unlinkSync(linkPath);
                removedLinks.push(linkPath);
            }
        }

        if (fs.existsSync(destinationPath)) {
            fs.unlinkSync(destinationPath);
        }

        delete index.characters[canonicalName];
        return true;
    }, {
        onRollback: async () => {
            if (originalCanonicalRawBuffer && originalCanonicalCard && !fs.existsSync(destinationPath)) {
                await writeCharacterCardFile(originalCanonicalRawBuffer, originalCanonicalCard, destinationPath);
            }

            if (!fs.existsSync(destinationPath)) {
                return;
            }

            for (const linkPath of removedLinks) {
                if (!fs.existsSync(linkPath)) {
                    createSharedCharacterSymlink(linkPath, destinationPath, canonicalName);
                }
            }
        },
        rollbackMessage: `Failed to delete shared character "${canonicalName}" cleanly. Manual repair may be required.`,
    });
}
