import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const HIDDEN_LOREBOOK_BINDINGS_FILE = 'hidden-lorebook-bindings.json';
export const HIDDEN_LOREBOOK_REGISTRY_DIRECTORY = ['_system', 'hidden-lorebooks'];
const CHARACTER_AVATAR_EXTENSION_REGEX = /\.(?:png|webp|jpe?g|gif|bmp|avif)$/i;

const cache = new Map();

function getRegistryRootDir(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.resolve(String(rootDir || '.'));
}

function getRegistryDirectory(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.join(getRegistryRootDir(rootDir), ...HIDDEN_LOREBOOK_REGISTRY_DIRECTORY);
}

function getRegistryPath(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.join(getRegistryDirectory(rootDir), HIDDEN_LOREBOOK_BINDINGS_FILE);
}

function ensureRegistryDirectory(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    const directoryPath = getRegistryDirectory(rootDir);
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
}

function normalizeLorebookNames(value) {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const unique = new Set();

    for (const item of items) {
        const normalized = String(item || '').trim();
        if (normalized) {
            unique.add(normalized);
        }
    }

    return [...unique];
}

function normalizeName(value) {
    return String(value || '').trim();
}

function normalizeCharacterKey(value) {
    return normalizeName(value).replace(CHARACTER_AVATAR_EXTENSION_REGEX, '');
}

export function normalizeHiddenLorebookBindings(data = {}) {
    const global = normalizeLorebookNames(data?.global);
    const characters = {};
    const source = data?.characters && typeof data.characters === 'object' && !Array.isArray(data.characters)
        ? data.characters
        : {};

    for (const [key, value] of Object.entries(source)) {
        const normalizedKey = normalizeCharacterKey(key);
        const isValidBindingValue = Array.isArray(value) || typeof value === 'string';

        if (normalizedKey && isValidBindingValue) {
            characters[normalizedKey] = normalizeLorebookNames(value);
        }
    }

    return { global, characters };
}

function getCachedRegistry(filePath, stat) {
    const entry = cache.get(filePath);
    if (!entry) {
        return null;
    }

    if (!stat && entry.mtimeMs === null) {
        return { ...entry, data: structuredClone(entry.data) };
    }

    if (stat && entry.mtimeMs === stat.mtimeMs) {
        return { ...entry, data: structuredClone(entry.data) };
    }

    return null;
}

function setCachedRegistry(filePath, data, mtimeMs, { loadFailed = false, loadErrorMessage = '' } = {}) {
    cache.set(filePath, {
        mtimeMs,
        data: structuredClone(data),
        loadFailed,
        loadErrorMessage,
    });
}

export function readHiddenLorebookBindings({ rootDir = globalThis.DATA_ROOT || process.cwd(), throwOnError = false } = {}) {
    const filePath = getRegistryPath(rootDir);
    let stat = null;
    try {
        stat = fs.statSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
    const cached = getCachedRegistry(filePath, stat);

    if (cached) {
        if (cached.loadFailed && throwOnError) {
            throw new Error(cached.loadErrorMessage || 'Failed to read hidden lorebook bindings registry.');
        }
        return cached.data;
    }

    if (!stat) {
        const emptyRegistry = normalizeHiddenLorebookBindings();
        setCachedRegistry(filePath, emptyRegistry, null);
        return emptyRegistry;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const normalized = normalizeHiddenLorebookBindings(parsed);
        setCachedRegistry(filePath, normalized, stat.mtimeMs);
        return normalized;
    } catch (error) {
        if (throwOnError) {
            throw error;
        }
        console.warn('[Lorebooks] Failed to read hidden lorebook bindings registry. Falling back to an empty registry.', error);
        const emptyRegistry = normalizeHiddenLorebookBindings();
        setCachedRegistry(filePath, emptyRegistry, stat.mtimeMs, {
            loadFailed: true,
            loadErrorMessage: String(error?.message || error),
        });
        return emptyRegistry;
    }
}

export function writeHiddenLorebookBindings(data = {}, { rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    ensureRegistryDirectory(rootDir);
    const filePath = getRegistryPath(rootDir);
    const normalized = normalizeHiddenLorebookBindings(data);
    writeFileAtomicSync(filePath, JSON.stringify(normalized, null, 4), 'utf8');
    const stat = fs.statSync(filePath);
    setCachedRegistry(filePath, normalized, stat.mtimeMs);
    return normalized;
}

function migrateLorebookNameArray(values, oldName, newName = '') {
    const target = normalizeName(oldName);
    const replacement = normalizeName(newName);
    const next = [];
    let changed = false;

    for (const value of normalizeLorebookNames(values)) {
        if (value !== target) {
            if (!next.includes(value)) {
                next.push(value);
            }
            continue;
        }

        changed = true;
        if (replacement && !next.includes(replacement)) {
            next.push(replacement);
        }
    }

    return { values: next, changed };
}

export function migrateHiddenLorebookBindingReferences({ oldName, newName = '', rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    const target = normalizeName(oldName);
    if (!target) {
        return { changed: false, data: readHiddenLorebookBindings({ rootDir }) };
    }

    const registry = readHiddenLorebookBindings({ rootDir });
    let changed = false;

    const migratedGlobal = migrateLorebookNameArray(registry.global, target, newName);
    if (migratedGlobal.changed) {
        registry.global = migratedGlobal.values;
        changed = true;
    }

    for (const [characterKey, values] of Object.entries(registry.characters || {})) {
        const migrated = migrateLorebookNameArray(values, target, newName);
        if (migrated.changed) {
            if (migrated.values.length > 0) {
                registry.characters[characterKey] = migrated.values;
            } else {
                delete registry.characters[characterKey];
            }
            changed = true;
        }
    }

    return {
        changed,
        data: changed ? writeHiddenLorebookBindings(registry, { rootDir }) : registry,
    };
}

export function getHiddenLorebooksForCharacter(characterKey, { rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    const normalizedKey = normalizeCharacterKey(characterKey);
    const registry = readHiddenLorebookBindings({ rootDir });
    if (normalizedKey && Object.prototype.hasOwnProperty.call(registry.characters, normalizedKey)) {
        return [...registry.characters[normalizedKey]];
    }

    return [...(registry.global ?? [])];
}
