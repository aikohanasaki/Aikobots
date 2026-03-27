import fs from 'node:fs';
import path from 'node:path';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getAllUserHandles, getUserDirectories } from './users.js';

const SECURE_LOREBOOK_DIRECTORY = ['_secure', 'worlds'];
const SECURE_INDEX_FILENAME = 'index.json';

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

function getCanonicalLorebookName(name) {
    const normalized = path.parse(sanitize(`${String(name || '').trim()}.json`)).name;
    return normalized;
}

function ensureDirectory(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getSecureLorebookDirectory() {
    return ensureDirectory(path.join(globalThis.DATA_ROOT, ...SECURE_LOREBOOK_DIRECTORY));
}

function getSecureLorebookPath(name) {
    return path.join(getSecureLorebookDirectory(), `${getCanonicalLorebookName(name)}.json`);
}

function getSecureIndexPath() {
    return path.join(getSecureLorebookDirectory(), SECURE_INDEX_FILENAME);
}

function readJsonFileSync(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSecureIndex() {
    const indexPath = getSecureIndexPath();

    if (!fs.existsSync(indexPath)) {
        return { version: 1, books: {} };
    }

    try {
        const parsed = readJsonFileSync(indexPath);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                version: Number(parsed.version) || 1,
                books: parsed.books && typeof parsed.books === 'object' && !Array.isArray(parsed.books) ? parsed.books : {},
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

function getSecureIndexEntry(name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        return null;
    }

    const index = readSecureIndex();
    const metadata = index.books[canonicalName];
    if (!metadata) {
        return null;
    }

    const filePath = getSecureLorebookPath(canonicalName);
    if (!fs.existsSync(filePath)) {
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

    return path.join(getUserDirectories(handle).worlds, `${canonicalName}.json`);
}

function getUserLorebookRecord(handle, name) {
    const canonicalName = getCanonicalLorebookName(name);
    if (!canonicalName) {
        return null;
    }

    const filePath = getUserLorebookPath(handle, canonicalName);
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

function buildListItem(record, currentHandle) {
    const isSecure = record.storage === 'secure';
    const canManage = currentHandle === record.ownerHandle;
    return {
        name: record.name,
        storage: record.storage,
        ownerHandle: record.ownerHandle,
        canEdit: canManage || isSecure,
        canDelete: canManage || isSecure,
        canPromote: !isSecure && canManage,
        canDemote: isSecure,
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

function readLorebookFromRecord(record, allowDummy) {
    const dummyObject = allowDummy ? { entries: {} } : null;
    if (!record?.path) {
        return dummyObject;
    }

    if (!fs.existsSync(record.path)) {
        return dummyObject;
    }

    return readJsonFileSync(record.path);
}

async function assertSecureNameAvailableForPromotion(name, ownerHandle) {
    const secureRecord = getSecureIndexEntry(name);
    if (secureRecord) {
        throw new LorebookRepositoryError('LorebookAlreadySecure', `Lorebook "${name}" is already secure.`, 409);
    }

    const handles = await getAllUserHandles();
    for (const handle of handles) {
        if (handle === ownerHandle) {
            continue;
        }

        const conflicting = getUserLorebookRecord(handle, name);
        if (conflicting) {
            throw new LorebookRepositoryError(
                'LorebookNameConflict',
                `Cannot promote "${name}" because another user's lorebook already uses that name.`,
                409,
            );
        }
    }
}

function writeSecureLorebook(name, data, ownerHandle, actorHandle, existingMetadata = null) {
    const index = readSecureIndex();
    const timestamp = new Date().toISOString();
    const canonicalName = assertCanonicalName(name);
    const filePath = getSecureLorebookPath(canonicalName);

    writeFileAtomicSync(filePath, JSON.stringify(data, null, 4), 'utf8');
    index.books[canonicalName] = {
        ownerHandle,
        createdAt: existingMetadata?.createdAt || timestamp,
        updatedAt: timestamp,
        createdBy: existingMetadata?.createdBy || actorHandle,
        updatedBy: actorHandle,
    };
    writeSecureIndex(index);
}

function removeSecureLorebook(name) {
    const canonicalName = assertCanonicalName(name);
    const record = getSecureIndexEntry(canonicalName);
    const index = readSecureIndex();
    delete index.books[canonicalName];
    writeSecureIndex(index);

    if (record?.path && fs.existsSync(record.path)) {
        fs.unlinkSync(record.path);
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

    const filePath = path.join(directories.worlds, `${canonicalName}.json`);
    if (!fs.existsSync(filePath)) {
        return dummyObject;
    }

    return readJsonFileSync(filePath);
}

/**
 * @param {import('./users.js').User} user
 * @returns {Promise<LorebookListItem[]>}
 */
export async function listLorebooksForManagement(user) {
    const currentHandle = user.profile.handle;
    const items = [];
    const worldsDir = user.directories.worlds;

    if (fs.existsSync(worldsDir)) {
        const worldFiles = fs.readdirSync(worldsDir)
            .filter(file => path.extname(file).toLowerCase() === '.json')
            .sort((a, b) => a.localeCompare(b));

        for (const file of worldFiles) {
            const name = path.parse(file).name;
            items.push(buildListItem({
                name,
                storage: 'user',
                ownerHandle: currentHandle,
            }, currentHandle));
        }
    }

    const secureIndex = readSecureIndex();
    for (const [name, metadata] of Object.entries(secureIndex.books)) {
        const ownerHandle = String(metadata?.ownerHandle || '');
        if (!user.profile.admin && ownerHandle !== currentHandle) {
            continue;
        }

        if (items.some(item => item.name === name)) {
            console.warn(`[Lorebooks] Skipping duplicate manageable lorebook name "${name}" in secure storage.`);
            continue;
        }

        items.push(buildListItem({
            name,
            storage: 'secure',
            ownerHandle,
        }, currentHandle));
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {boolean} [allowDummy=false]
 */
export async function getLorebookForManagement(user, name, allowDummy = false) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);

    if (secureRecord) {
        if (!canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not accessible.`, 403);
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
export async function readLorebookForGeneration(user, name, allowDummy = false) {
    const canonicalName = getCanonicalLorebookName(name);
    const dummyObject = allowDummy ? { entries: {} } : null;

    if (!canonicalName) {
        return dummyObject;
    }

    const secureRecord = getSecureIndexEntry(canonicalName);
    if (secureRecord) {
        return readLorebookFromRecord(secureRecord, allowDummy);
    }

    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    return readLorebookFromRecord(userRecord, allowDummy);
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 * @param {object} data
 */
export async function saveLorebookForManagement(user, name, data) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);

    if (secureRecord) {
        if (!canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError(
                'LorebookNameConflict',
                `Cannot save "${canonicalName}" because that name is reserved by a secure lorebook.`,
                409,
            );
        }

        writeSecureLorebook(canonicalName, data, secureRecord.ownerHandle, user.profile.handle, secureRecord);
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
    };
}

/**
 * @param {import('./users.js').User} user
 * @param {string} name
 */
export async function deleteLorebookForManagement(user, name) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);

    if (secureRecord) {
        if (!canManageSecureLorebook(user, secureRecord)) {
            throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not deletable.`, 403);
        }

        removeSecureLorebook(canonicalName);
        return {
            name: canonicalName,
            storage: 'secure',
            ownerHandle: secureRecord.ownerHandle,
        };
    }

    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    if (!userRecord) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    fs.unlinkSync(userRecord.path);
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
export async function promoteLorebook(user, name) {
    const canonicalName = assertCanonicalName(name);
    const userRecord = getUserLorebookRecord(user.profile.handle, canonicalName);
    if (!userRecord) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    await assertSecureNameAvailableForPromotion(canonicalName, user.profile.handle);

    const data = readLorebookFromRecord(userRecord, false);
    writeSecureLorebook(canonicalName, data, user.profile.handle, user.profile.handle);
    fs.unlinkSync(userRecord.path);

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
export async function demoteLorebook(user, name) {
    const canonicalName = assertCanonicalName(name);
    const secureRecord = getSecureIndexEntry(canonicalName);

    if (!secureRecord) {
        throw new LorebookRepositoryError('LorebookNotFound', `Lorebook "${canonicalName}" not found.`, 404);
    }

    if (!canManageSecureLorebook(user, secureRecord)) {
        throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${canonicalName}" is not movable.`, 403);
    }

    const destinationRecord = getUserLorebookRecord(secureRecord.ownerHandle, canonicalName);
    if (destinationRecord) {
        throw new LorebookRepositoryError(
            'LorebookDestinationConflict',
            `Cannot return "${canonicalName}" to user storage because that name already exists there.`,
            409,
        );
    }

    const data = readLorebookFromRecord(secureRecord, false);
    writeUserLorebook(secureRecord.ownerHandle, canonicalName, data);
    removeSecureLorebook(canonicalName);

    return {
        name: canonicalName,
        storage: 'user',
        ownerHandle: secureRecord.ownerHandle,
    };
}
