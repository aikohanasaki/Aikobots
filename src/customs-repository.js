import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const CUSTOMS_FILE = 'customs.json';
export const CUSTOMS_VERSION = 1;

const CUSTOMS_SETTINGS_FIELD = 'customs';
const OVERRIDE_KEYS = Object.freeze([
    'temp_openai',
    'top_p_openai',
    'top_k_openai',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeOverrides(overrides) {
    if (!isPlainObject(overrides)) {
        return {};
    }

    const normalized = {};
    for (const key of OVERRIDE_KEYS) {
        if (!Object.hasOwn(overrides, key)) {
            continue;
        }

        const value = Number(overrides[key]);
        if (Number.isFinite(value)) {
            normalized[key] = value;
        }
    }

    return normalized;
}

function normalizeGenerationLockRecord(record) {
    const source = isPlainObject(record) ? record : {};
    const connectionProfileId = toOptionalString(source.connectionProfileId);
    const presetName = typeof source.presetName === 'string' ? source.presetName : '';
    const overrides = normalizeOverrides(source.overrides);
    const updatedAt = toOptionalString(source.updatedAt) || new Date(0).toISOString();

    return {
        version: CUSTOMS_VERSION,
        connectionProfileId,
        presetName,
        overrides,
        updatedAt,
    };
}

function normalizeLockMap(map) {
    if (!isPlainObject(map)) {
        return {};
    }

    const normalized = {};
    for (const [id, record] of Object.entries(map)) {
        const normalizedId = String(id || '').trim();
        if (!normalizedId) {
            continue;
        }

        normalized[normalizedId] = normalizeGenerationLockRecord(record);
    }

    return normalized;
}

export function createEmptyCustomsDocument() {
    return {
        version: CUSTOMS_VERSION,
        generationLocks: {
            characters: {},
            groups: {},
        },
    };
}

export function normalizeCustomsDocument(document) {
    const source = isPlainObject(document) ? document : {};
    const generationLocks = isPlainObject(source.generationLocks) ? source.generationLocks : {};

    return {
        version: CUSTOMS_VERSION,
        generationLocks: {
            characters: normalizeLockMap(generationLocks.characters),
            groups: normalizeLockMap(generationLocks.groups),
        },
    };
}

export function getCustomsPath(directories) {
    return path.join(directories.root, CUSTOMS_FILE);
}

export function readCustomsDocument(directories) {
    const pathToCustoms = getCustomsPath(directories);

    if (!fs.existsSync(pathToCustoms)) {
        return createEmptyCustomsDocument();
    }

    try {
        const rawDocument = JSON.parse(fs.readFileSync(pathToCustoms, 'utf8'));
        return normalizeCustomsDocument(rawDocument);
    } catch (error) {
        throw new Error(`Failed to read customs file "${pathToCustoms}": ${error.message}`);
    }
}

export function writeCustomsDocument(directories, document) {
    const pathToCustoms = getCustomsPath(directories);
    const normalizedDocument = normalizeCustomsDocument(document);
    writeFileAtomicSync(pathToCustoms, JSON.stringify(normalizedDocument, null, 4), 'utf8');
    return normalizedDocument;
}

export function buildCustomsDocumentFromSettings(settings, fallbackDocument = null) {
    if (isPlainObject(settings?.[CUSTOMS_SETTINGS_FIELD])) {
        return normalizeCustomsDocument(settings[CUSTOMS_SETTINGS_FIELD]);
    }

    return normalizeCustomsDocument(fallbackDocument || createEmptyCustomsDocument());
}

export function mergeCustomsIntoSettings(settings, document) {
    settings[CUSTOMS_SETTINGS_FIELD] = normalizeCustomsDocument(document);
    return settings;
}

export function stripCustomsFromSettings(settings) {
    if (isPlainObject(settings)) {
        delete settings[CUSTOMS_SETTINGS_FIELD];
    }

    return settings;
}

export function isEmptyCustomsDocument(document) {
    const normalized = normalizeCustomsDocument(document);
    return !Object.keys(normalized.generationLocks.characters).length
        && !Object.keys(normalized.generationLocks.groups).length;
}
