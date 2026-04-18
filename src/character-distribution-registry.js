import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';

import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { withDirectoryLock } from './file-system-lock.js';

const REGISTRY_DIRECTORY = ['_system', 'character-distribution-registry'];
const REGISTRY_FILENAME = 'index.json';
const REGISTRY_LOCK_DIRECTORY = `${REGISTRY_FILENAME}.lock`;
const REGISTRY_LOCK_RETRY_MS = 50;
const REGISTRY_LOCK_TIMEOUT_MS = 10_000;
const REGISTRY_LOCK_STALE_MS = 60_000;
const REGISTRY_LOCK_HEARTBEAT_MS = 15_000;
let registryWriteQueue = Promise.resolve();

function runWithRegistryLock(operation) {
    const queuedOperation = registryWriteQueue.catch(() => { }).then(() => withRegistryFileLock(operation));
    registryWriteQueue = queuedOperation.catch(() => { });
    return queuedOperation;
}

function getRegistryRoot() {
    return path.join(path.resolve(String(globalThis.DATA_ROOT || '.')), ...REGISTRY_DIRECTORY);
}

function getRegistryPath() {
    return path.join(getRegistryRoot(), REGISTRY_FILENAME);
}

function getRegistryLockPath() {
    return path.join(getRegistryRoot(), REGISTRY_LOCK_DIRECTORY);
}

async function withRegistryFileLock(operation) {
    await ensureRegistryStore();

    return await withDirectoryLock({
        lockPath: getRegistryLockPath(),
        retryMs: REGISTRY_LOCK_RETRY_MS,
        timeoutMs: REGISTRY_LOCK_TIMEOUT_MS,
        staleMs: REGISTRY_LOCK_STALE_MS,
        heartbeatMs: REGISTRY_LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update character distribution registry.',
    }, operation);
}

function normalizePublishedFilename(value) {
    const parsedName = path.parse(String(value || '')).name || String(value || '');
    const sanitizedName = sanitize(parsedName).trim();

    if (!sanitizedName) {
        throw new Error('Invalid published filename.');
    }

    return sanitizedName;
}

function normalizeOwnerHandle(value) {
    return String(value || '').trim();
}

function normalizeCharacterKey(value) {
    return normalizePublishedFilename(value);
}

function normalizeHandles(handles) {
    return [...new Set((Array.isArray(handles) ? handles : []).map(handle => String(handle || '').trim()).filter(Boolean))];
}

function mergeHandles(...handleLists) {
    return [...new Set(handleLists.flatMap(handles => normalizeHandles(handles)))];
}

function parseRegistryKey(key) {
    const normalizedKey = String(key || '').trim();
    const separatorIndex = normalizedKey.lastIndexOf('::');

    if (separatorIndex <= 0 || separatorIndex >= normalizedKey.length - 2) {
        return null;
    }

    return {
        ownerHandle: normalizedKey.slice(0, separatorIndex),
        characterKey: '',
        publishedFilename: normalizedKey.slice(separatorIndex + 2),
    };
}

function normalizeRegistryEntry(entry) {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    return {
        blacklist: normalizeHandles(source.blacklist),
        userBlacklist: normalizeHandles(source.userBlacklist || source['user-blacklist']),
        whitelist: normalizeHandles(source.whitelist),
        updatedAt: Number(source.updatedAt) || null,
        updatedBy: String(source.updatedBy || '').trim() || null,
    };
}

async function ensureRegistryStore() {
    await fsPromises.mkdir(getRegistryRoot(), { recursive: true });
}

async function readRegistryIndex() {
    await ensureRegistryStore();
    const registryPath = getRegistryPath();

    if (!fs.existsSync(registryPath)) {
        return { version: 1, characters: {} };
    }

    try {
        const raw = await fsPromises.readFile(registryPath, 'utf8');
        const parsed = JSON.parse(raw);
        const characters = parsed?.characters && typeof parsed.characters === 'object' && !Array.isArray(parsed.characters)
            ? parsed.characters
            : {};

        return {
            version: Number(parsed?.version) || 1,
            characters,
        };
    } catch (error) {
        console.warn('Failed to read character distribution registry. Recreating it.', error);
        return { version: 1, characters: {} };
    }
}

async function writeRegistryIndex(index) {
    await ensureRegistryStore();
    await writeFileAtomic(getRegistryPath(), JSON.stringify(index, null, 4));
}

function buildPolicyResponse({ ownerHandle, characterKey, publishedFilename, entry }) {
    const normalizedEntry = normalizeRegistryEntry(entry);
    const blacklistHandles = mergeHandles(normalizedEntry.blacklist, normalizedEntry.userBlacklist);

    return {
        key: characterKey ? `${characterKey}::${publishedFilename}` : `${ownerHandle}::${publishedFilename}`,
        ownerHandle,
        characterKey,
        publishedFilename,
        blacklistHandles,
        adminBlacklistHandles: normalizedEntry.blacklist,
        userBlacklistHandles: normalizedEntry.userBlacklist,
        whitelistHandles: normalizedEntry.whitelist,
        hasBlacklist: blacklistHandles.length > 0,
        hasAdminBlacklist: normalizedEntry.blacklist.length > 0,
        hasUserBlacklist: normalizedEntry.userBlacklist.length > 0,
        hasWhitelist: normalizedEntry.whitelist.length > 0,
        updatedAt: normalizedEntry.updatedAt,
        updatedBy: normalizedEntry.updatedBy,
    };
}

export async function getCharacterDistributionPolicy({ ownerHandle, characterKey, publishedFilename }) {
    const normalizedOwnerHandle = normalizeOwnerHandle(ownerHandle);
    const normalizedCharacterKey = characterKey ? normalizeCharacterKey(characterKey) : '';
    const normalizedPublishedFilename = normalizePublishedFilename(publishedFilename);
    const index = await readRegistryIndex();
    const key = normalizedCharacterKey
        ? `${normalizedCharacterKey}::${normalizedPublishedFilename}`
        : `${normalizedOwnerHandle}::${normalizedPublishedFilename}`;
    const legacyKey = normalizedCharacterKey
        ? `${normalizedOwnerHandle}::${normalizedPublishedFilename}`
        : '';

    return buildPolicyResponse({
        ownerHandle: normalizedOwnerHandle,
        characterKey: normalizedCharacterKey,
        publishedFilename: normalizedPublishedFilename,
        entry: index.characters[key] || (legacyKey ? index.characters[legacyKey] : null),
    });
}

export async function setCharacterDistributionPolicy({ ownerHandle, characterKey, publishedFilename, blacklistHandles, userBlacklistHandles, whitelistHandles, updatedBy }) {
    const normalizedOwnerHandle = normalizeOwnerHandle(ownerHandle);
    const normalizedCharacterKey = characterKey ? normalizeCharacterKey(characterKey) : '';
    const normalizedPublishedFilename = normalizePublishedFilename(publishedFilename);
    const key = normalizedCharacterKey
        ? `${normalizedCharacterKey}::${normalizedPublishedFilename}`
        : `${normalizedOwnerHandle}::${normalizedPublishedFilename}`;
    const legacyKey = normalizedCharacterKey ? `${normalizedOwnerHandle}::${normalizedPublishedFilename}` : '';

    return runWithRegistryLock(async () => {
        const index = await readRegistryIndex();
        const nextEntry = normalizeRegistryEntry(index.characters[key] || (legacyKey ? index.characters[legacyKey] : null));

        if (blacklistHandles !== undefined) {
            nextEntry.blacklist = normalizeHandles(blacklistHandles);
        }

        if (userBlacklistHandles !== undefined) {
            nextEntry.userBlacklist = normalizeHandles(userBlacklistHandles);
        }

        if (whitelistHandles !== undefined) {
            nextEntry.whitelist = normalizeHandles(whitelistHandles);
        }

        if (nextEntry.blacklist.length === 0 && nextEntry.userBlacklist.length === 0 && nextEntry.whitelist.length === 0) {
            delete index.characters[key];
            if (legacyKey) {
                delete index.characters[legacyKey];
            }
        } else {
            nextEntry.ownerHandle = normalizedOwnerHandle;
            nextEntry.characterKey = normalizedCharacterKey;
            nextEntry.publishedFilename = normalizedPublishedFilename;
            nextEntry.updatedAt = Date.now();
            nextEntry.updatedBy = String(updatedBy || '').trim() || null;
            index.characters[key] = nextEntry;
            if (legacyKey) {
                delete index.characters[legacyKey];
            }
        }

        await writeRegistryIndex(index);

        return buildPolicyResponse({
            ownerHandle: normalizedOwnerHandle,
            characterKey: normalizedCharacterKey,
            publishedFilename: normalizedPublishedFilename,
            entry: index.characters[key],
        });
    });
}

export async function getCharacterDistributionUserBlacklistEntries(userHandle) {
    const normalizedUserHandle = String(userHandle || '').trim();
    if (!normalizedUserHandle) {
        return [];
    }

    const index = await readRegistryIndex();
    const entries = [];

    for (const [key, rawEntry] of Object.entries(index.characters || {})) {
        const normalizedEntry = normalizeRegistryEntry(rawEntry);
        if (!normalizedEntry.userBlacklist.includes(normalizedUserHandle)) {
            continue;
        }

        const parsedKey = parseRegistryKey(key);
        if (!parsedKey) {
            continue;
        }

        entries.push({
            key,
            ownerHandle: String(rawEntry?.ownerHandle || parsedKey.ownerHandle || '').trim(),
            characterKey: String(rawEntry?.characterKey || parsedKey.characterKey || '').trim(),
            publishedFilename: String(rawEntry?.publishedFilename || parsedKey.publishedFilename || '').trim(),
            characterName: String(rawEntry?.characterName || rawEntry?.publishedFilename || parsedKey.publishedFilename || '').trim(),
            addedAt: Number(rawEntry?.updatedAt) || Date.now(),
        });
    }

    return entries;
}
