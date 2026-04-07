import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';

import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

const REGISTRY_DIRECTORY = ['_system', 'character-distribution-registry'];
const REGISTRY_FILENAME = 'index.json';
let registryWriteQueue = Promise.resolve();

function runWithRegistryLock(operation) {
    const queuedOperation = registryWriteQueue.catch(() => { }).then(operation);
    registryWriteQueue = queuedOperation.catch(() => { });
    return queuedOperation;
}

function getRegistryRoot() {
    return path.join(path.resolve(String(globalThis.DATA_ROOT || '.')), ...REGISTRY_DIRECTORY);
}

function getRegistryPath() {
    return path.join(getRegistryRoot(), REGISTRY_FILENAME);
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

function normalizeRegistryEntry(entry) {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    return {
        blacklist: normalizeHandles(source.blacklist),
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
    return {
        key: characterKey ? `${characterKey}::${publishedFilename}` : `${ownerHandle}::${publishedFilename}`,
        ownerHandle,
        characterKey,
        publishedFilename,
        blacklistHandles: normalizedEntry.blacklist,
        whitelistHandles: normalizedEntry.whitelist,
        hasBlacklist: normalizedEntry.blacklist.length > 0,
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

export async function setCharacterDistributionPolicy({ ownerHandle, characterKey, publishedFilename, blacklistHandles, whitelistHandles, updatedBy }) {
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

        if (whitelistHandles !== undefined) {
            nextEntry.whitelist = normalizeHandles(whitelistHandles);
        }

        if (nextEntry.blacklist.length === 0 && nextEntry.whitelist.length === 0) {
            delete index.characters[key];
            if (legacyKey) {
                delete index.characters[legacyKey];
            }
        } else {
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
