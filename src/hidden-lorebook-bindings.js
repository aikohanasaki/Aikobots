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
        return structuredClone(entry.data);
    }

    if (stat && entry.mtimeMs === stat.mtimeMs) {
        return structuredClone(entry.data);
    }

    return null;
}

function setCachedRegistry(filePath, data, mtimeMs) {
    cache.set(filePath, {
        mtimeMs,
        data: structuredClone(data),
    });
}

export function readHiddenLorebookBindings({ rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
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
        return cached;
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
        console.warn('[Lorebooks] Failed to read hidden lorebook bindings registry. Falling back to an empty registry.', error);
        const emptyRegistry = normalizeHiddenLorebookBindings();
        setCachedRegistry(filePath, emptyRegistry, stat.mtimeMs);
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

export function getHiddenLorebooksForCharacter(characterKey, { rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    const normalizedKey = normalizeCharacterKey(characterKey);
    const registry = readHiddenLorebookBindings({ rootDir });
    if (normalizedKey && Object.prototype.hasOwnProperty.call(registry.characters, normalizedKey)) {
        return [...registry.characters[normalizedKey]];
    }

    return [...(registry.global ?? [])];
}
