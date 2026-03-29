import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const HIDDEN_LOREBOOK_BINDINGS_FILE = 'hidden-lorebook-bindings.json';

const cache = new Map();

function getRegistryPath(rootDir = process.cwd()) {
    return path.join(rootDir, HIDDEN_LOREBOOK_BINDINGS_FILE);
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

function normalizeCharacterKey(value) {
    return path.parse(String(value || '').trim()).name;
}

export function normalizeHiddenLorebookBindings(data = {}) {
    const characters = {};
    const source = data?.characters && typeof data.characters === 'object' && !Array.isArray(data.characters)
        ? data.characters
        : {};

    for (const [key, value] of Object.entries(source)) {
        const normalizedKey = normalizeCharacterKey(key);
        const normalizedBooks = normalizeLorebookNames(value);

        if (normalizedKey && normalizedBooks.length) {
            characters[normalizedKey] = normalizedBooks;
        }
    }

    return { characters };
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

export function readHiddenLorebookBindings({ rootDir = process.cwd() } = {}) {
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

export function writeHiddenLorebookBindings(data = {}, { rootDir = process.cwd() } = {}) {
    const filePath = getRegistryPath(rootDir);
    const normalized = normalizeHiddenLorebookBindings(data);
    writeFileAtomicSync(filePath, JSON.stringify(normalized, null, 4), 'utf8');
    const stat = fs.statSync(filePath);
    setCachedRegistry(filePath, normalized, stat.mtimeMs);
    return normalized;
}

export function getHiddenLorebooksForCharacter(characterKey, { rootDir = process.cwd() } = {}) {
    const normalizedKey = normalizeCharacterKey(characterKey);
    if (!normalizedKey) {
        return [];
    }

    const registry = readHiddenLorebookBindings({ rootDir });
    return [...(registry.characters[normalizedKey] ?? [])];
}
