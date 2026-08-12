import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import {
    HIDDEN_LOREBOOK_REGISTRY_DIRECTORY,
    writeHiddenLorebookBindings,
} from './hidden-lorebook-bindings.js';

export const HIDDEN_LOREBOOK_TEMPLATES_FILE = 'hidden-lorebook-templates.json';
const HIDDEN_LOREBOOK_COMPILE_PENDING_FILE = 'hidden-lorebook-compile.pending';
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

function getCompilePendingPath(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    return path.join(getRegistryDirectory(rootDir), HIDDEN_LOREBOOK_COMPILE_PENDING_FILE);
}

function ensureRegistryDirectory(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    const directoryPath = getRegistryDirectory(rootDir);
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
}

/** Persists retry intent before changed template source is written. */
function markHiddenLorebookCompilationPending(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    ensureRegistryDirectory(rootDir);
    writeFileAtomicSync(getCompilePendingPath(rootDir), '', 'utf8');
}

/** Clears retry intent only after compiled bindings have been written. */
function clearHiddenLorebookCompilationPending(rootDir = globalThis.DATA_ROOT || process.cwd()) {
    try {
        fs.unlinkSync(getCompilePendingPath(rootDir));
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

/** Returns whether persisted hidden-template source still needs compilation. */
export function isHiddenLorebookCompilationPending({ rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    try {
        fs.statSync(getCompilePendingPath(rootDir));
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
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

function hasAssignmentData(value) {
    return value.templates.length > 0 || value.add.length > 0 || value.remove.length > 0;
}

function applyAssignmentEntry(baseBooks, entry, templates) {
    const templateAdds = new Set();
    const templateRemoves = new Set();
    const unresolvedTemplates = new Set();

    for (const templateName of entry.templates) {
        const templateEntry = templates[templateName];
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

    const compiledBooks = new Set(Array.isArray(baseBooks) ? baseBooks : []);

    for (const bookName of templateAdds) {
        compiledBooks.add(bookName);
    }

    for (const bookName of templateRemoves) {
        compiledBooks.delete(bookName);
    }

    for (const bookName of entry.add) {
        compiledBooks.add(bookName);
    }

    for (const bookName of entry.remove) {
        compiledBooks.delete(bookName);
    }

    return {
        books: [...compiledBooks].sort(compareStrings),
        unresolvedTemplates: [...unresolvedTemplates].sort(compareStrings),
    };
}

export function normalizeHiddenLorebookTemplates(data = {}) {
    const templates = {};
    const global = normalizeCharacterEntry(data?.global);
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

        if (normalizedKey && hasAssignmentData(normalizedValue)) {
            characters[normalizedKey] = normalizedValue;
        }
    }

    return { templates, global, characters };
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

export function readHiddenLorebookTemplates({ rootDir = globalThis.DATA_ROOT || process.cwd(), throwOnError = false } = {}) {
    return readHiddenLorebookTemplatesEntry({ rootDir, throwOnError }).data;
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

function migrateTemplateLorebookArray(values, oldName, newName = '') {
    const target = normalizeName(oldName);
    const replacement = normalizeName(newName);
    const next = [];
    let changed = false;

    for (const value of normalizeStringArray(values)) {
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

    return { values: next.sort(compareStrings), changed };
}

function migrateTemplateAssignmentEntry(entry, oldName, newName = '') {
    const migratedAdd = migrateTemplateLorebookArray(entry.add, oldName, newName);
    const migratedRemove = migrateTemplateLorebookArray(entry.remove, oldName, newName);
    if (migratedAdd.changed) {
        entry.add = migratedAdd.values;
    }
    if (migratedRemove.changed) {
        entry.remove = migratedRemove.values;
    }
    return migratedAdd.changed || migratedRemove.changed;
}

export function migrateHiddenLorebookTemplateReferences({ oldName, newName = '', rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    const target = normalizeName(oldName);
    if (!target) {
        return { changed: false, data: readHiddenLorebookTemplates({ rootDir }) };
    }

    const registry = readHiddenLorebookTemplates({ rootDir });
    let changed = false;

    for (const entry of Object.values(registry.templates || {})) {
        changed = migrateTemplateAssignmentEntry(entry, target, newName) || changed;
    }

    changed = migrateTemplateAssignmentEntry(registry.global, target, newName) || changed;

    for (const [characterKey, entry] of Object.entries(registry.characters || {})) {
        if (migrateTemplateAssignmentEntry(entry, target, newName)) {
            changed = true;
            if (!hasAssignmentData(entry)) {
                delete registry.characters[characterKey];
            }
        }
    }

    if (!changed) {
        return { changed: false, data: registry };
    }

    markHiddenLorebookCompilationPending(rootDir);
    return {
        changed: true,
        data: writeHiddenLorebookTemplates(registry, { rootDir }),
    };
}

export function compileHiddenLorebookTemplateRegistry(data = {}) {
    const normalized = normalizeHiddenLorebookTemplates(data);
    const compiledCharacters = {};
    const missingTemplates = {};
    const resolvedGlobal = applyAssignmentEntry([], normalized.global, normalized.templates);

    if (resolvedGlobal.unresolvedTemplates.length > 0) {
        missingTemplates.global = resolvedGlobal.unresolvedTemplates;
    }

    for (const characterKey of Object.keys(normalized.characters).sort(compareStrings)) {
        const characterEntry = normalized.characters[characterKey];
        const resolvedCharacter = applyAssignmentEntry(resolvedGlobal.books, characterEntry, normalized.templates);
        compiledCharacters[characterKey] = resolvedCharacter.books;

        if (resolvedCharacter.unresolvedTemplates.length > 0) {
            missingTemplates[characterKey] = resolvedCharacter.unresolvedTemplates;
        }
    }

    return {
        source: normalized,
        compiled: {
            global: resolvedGlobal.books,
            characters: compiledCharacters,
        },
        missingTemplates,
    };
}

export function compileAndWriteHiddenLorebookTemplates({ rootDir = globalThis.DATA_ROOT || process.cwd() } = {}) {
    const source = readHiddenLorebookTemplatesEntry({ rootDir, throwOnError: true }).data;
    const result = compileHiddenLorebookTemplateRegistry(source);
    const compiled = writeHiddenLorebookBindings(result.compiled, { rootDir });
    clearHiddenLorebookCompilationPending(rootDir);

    return {
        ...result,
        compiled,
    };
}
