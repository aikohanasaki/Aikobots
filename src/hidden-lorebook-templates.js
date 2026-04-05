import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import {
    HIDDEN_LOREBOOK_REGISTRY_DIRECTORY,
    writeHiddenLorebookBindings,
} from './hidden-lorebook-bindings.js';

export const HIDDEN_LOREBOOK_TEMPLATES_FILE = 'hidden-lorebook-templates.json';
const CHARACTER_AVATAR_EXTENSION_REGEX = /\.(?:png|webp|jpe?g|gif|bmp|avif)$/i;

const cache = new Map();

function getRegistryRootDir(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.resolve(String(rootDir || '.'));
}

function getRegistryDirectory(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.join(getRegistryRootDir(rootDir), ...HIDDEN_LOREBOOK_REGISTRY_DIRECTORY);
}

function getRegistryPath(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.join(getRegistryDirectory(rootDir), HIDDEN_LOREBOOK_TEMPLATES_FILE);
}

function ensureRegistryDirectory(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    const directoryPath = getRegistryDirectory(rootDir);
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
}

function compareStrings(a, b) {
    return String(a).localeCompare(String(b));
}

function normalizeName(value) {
    return String(value || '').trim();
}

function normalizeCharacterKey(value) {
    return normalizeName(value).replace(CHARACTER_AVATAR_EXTENSION_REGEX, '');
}

function normalizeStringArray(value) {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const unique = new Set();

    for (const item of items) {
        const normalized = normalizeName(item);
        if (normalized) {
            unique.add(normalized);
        }
    }

    return [...unique].sort(compareStrings);
}

function normalizeTemplateEntry(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        add: normalizeStringArray(source.add),
        remove: normalizeStringArray(source.remove),
    };
}

function normalizeCharacterEntry(value) {
    if (Array.isArray(value) || typeof value === 'string') {
        return {
            templates: [],
            add: normalizeStringArray(value),
            remove: [],
        };
    }

    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        templates: normalizeStringArray(source.templates),
        add: normalizeStringArray(source.add),
        remove: normalizeStringArray(source.remove),
    };
}

function hasCharacterData(value) {
    return value.templates.length > 0 || value.add.length > 0 || value.remove.length > 0;
}

export function normalizeHiddenLorebookTemplates(data = {}) {
    const templates = {};
    const characters = {};
    const templateSource = data?.templates && typeof data.templates === 'object' && !Array.isArray(data.templates)
        ? data.templates
        : {};
    const characterSource = data?.characters && typeof data.characters === 'object' && !Array.isArray(data.characters)
        ? data.characters
        : {};

    for (const key of Object.keys(templateSource).sort(compareStrings)) {
        const normalizedKey = normalizeName(key);
        if (!normalizedKey) {
            continue;
        }

        templates[normalizedKey] = normalizeTemplateEntry(templateSource[key]);
    }

    for (const key of Object.keys(characterSource).sort(compareStrings)) {
        const normalizedKey = normalizeCharacterKey(key);
        const normalizedValue = normalizeCharacterEntry(characterSource[key]);

        if (normalizedKey && hasCharacterData(normalizedValue)) {
            characters[normalizedKey] = normalizedValue;
        }
    }

    return { templates, characters };
}

function getCachedRegistryEntry(filePath, stat) {
    const entry = cache.get(filePath);
    if (!entry) {
        return null;
    }

    if (!stat && entry.mtimeMs === null) {
        return {
            ...entry,
            data: structuredClone(entry.data),
        };
    }

    if (stat && entry.mtimeMs === stat.mtimeMs) {
        return {
            ...entry,
            data: structuredClone(entry.data),
        };
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

function readHiddenLorebookTemplatesEntry({ rootDir = globalThis.DATA_ROOT || process.cwd(), throwOnError = false } = {}) {
    const filePath = getRegistryPath(rootDir);
    let stat = null;
    try {
        stat = fs.statSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
    const cachedEntry = getCachedRegistryEntry(filePath, stat);

    if (cachedEntry) {
        if (cachedEntry.loadFailed && throwOnError) {
            throw new Error(cachedEntry.loadErrorMessage || 'Failed to read hidden lorebook template registry.');
        }

        return cachedEntry;
    }

    if (!stat) {
        const emptyRegistry = normalizeHiddenLorebookTemplates();
        setCachedRegistry(filePath, emptyRegistry, null);
        return {
            data: emptyRegistry,
            loadFailed: false,
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const normalized = normalizeHiddenLorebookTemplates(parsed);
        setCachedRegistry(filePath, normalized, stat.mtimeMs);
        return {
            data: normalized,
            loadFailed: false,
        };
    } catch (error) {
        if (throwOnError) {
            throw error;
        }

        console.warn('[Lorebooks] Failed to read hidden lorebook template registry. Falling back to an empty registry.', error);
        const emptyRegistry = normalizeHiddenLorebookTemplates();
        setCachedRegistry(filePath, emptyRegistry, stat.mtimeMs, {
            loadFailed: true,
            loadErrorMessage: String(error?.message || error),
        });
        return {
            data: emptyRegistry,
            loadFailed: true,
        };
    }
}

export function readHiddenLorebookTemplates({ rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    return readHiddenLorebookTemplatesEntry({ rootDir }).data;
}

export function writeHiddenLorebookTemplates(data = {}, { rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    ensureRegistryDirectory(rootDir);
    const filePath = getRegistryPath(rootDir);
    const normalized = normalizeHiddenLorebookTemplates(data);
    writeFileAtomicSync(filePath, JSON.stringify(normalized, null, 4), 'utf8');
    const stat = fs.statSync(filePath);
    setCachedRegistry(filePath, normalized, stat.mtimeMs);
    return normalized;
}

export function compileHiddenLorebookTemplateRegistry(data = {}) {
    const normalized = normalizeHiddenLorebookTemplates(data);
    const compiledCharacters = {};
    const missingTemplates = {};

    for (const characterKey of Object.keys(normalized.characters).sort(compareStrings)) {
        const characterEntry = normalized.characters[characterKey];
        const templateAdds = new Set();
        const templateRemoves = new Set();
        const unresolvedTemplates = new Set();

        for (const templateName of characterEntry.templates) {
            const templateEntry = normalized.templates[templateName];
            if (!templateEntry) {
                unresolvedTemplates.add(templateName);
                continue;
            }

            for (const bookName of templateEntry.add) {
                templateAdds.add(bookName);
            }

            for (const bookName of templateEntry.remove) {
                templateRemoves.add(bookName);
            }
        }

        const compiledBooks = new Set(templateAdds);

        for (const bookName of templateRemoves) {
            compiledBooks.delete(bookName);
        }

        for (const bookName of characterEntry.add) {
            compiledBooks.add(bookName);
        }

        for (const bookName of characterEntry.remove) {
            compiledBooks.delete(bookName);
        }

        const finalBooks = [...compiledBooks].sort(compareStrings);

        if (finalBooks.length > 0) {
            compiledCharacters[characterKey] = finalBooks;
        }

        if (unresolvedTemplates.size > 0) {
            missingTemplates[characterKey] = [...unresolvedTemplates].sort(compareStrings);
        }
    }

    return {
        source: normalized,
        compiled: { characters: compiledCharacters },
        missingTemplates,
    };
}

export function compileAndWriteHiddenLorebookTemplates({ rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    const source = readHiddenLorebookTemplatesEntry({ rootDir, throwOnError: true }).data;
    const result = compileHiddenLorebookTemplateRegistry(source);
    const compiled = writeHiddenLorebookBindings(result.compiled, { rootDir });

    return {
        ...result,
        compiled,
    };
}
