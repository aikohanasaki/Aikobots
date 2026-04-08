import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const PERSONAS_FILE = 'personas.json';
export const PERSONAS_VERSION = 1;

export const PERSONA_REGISTRY_FIELDS = Object.freeze([
    'personas',
    'persona_descriptions',
    'default_persona',
]);

const DEFAULT_POSITION = 0;
const DEFAULT_DEPTH = 2;
const DEFAULT_ROLE = 0;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toOptionalString(value, fallbackValue = '') {
    if (typeof value === 'string') {
        return value;
    }

    return fallbackValue;
}

function toOptionalNumber(value, fallbackValue) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function normalizeConnections(connections) {
    if (!Array.isArray(connections)) {
        return [];
    }

    return connections
        .map(connection => {
            if (!isPlainObject(connection)) {
                return null;
            }

            const type = String(connection.type || '').trim();
            const id = String(connection.id || '').trim();
            if (!id || !['character', 'group'].includes(type)) {
                return null;
            }

            return { type, id };
        })
        .filter(Boolean);
}

function createEmptyPersonasDocument() {
    return {
        version: PERSONAS_VERSION,
        defaultPersona: null,
        personas: {},
    };
}

function normalizePersonaRecord(avatarId, record, fallbackName = '') {
    const source = isPlainObject(record) ? record : {};

    return {
        name: toOptionalString(source.name, fallbackName),
        avatar: String(avatarId || '').trim(),
        description: toOptionalString(source.description, ''),
        position: toOptionalNumber(source.position, DEFAULT_POSITION),
        depth: toOptionalNumber(source.depth, DEFAULT_DEPTH),
        role: toOptionalNumber(source.role, DEFAULT_ROLE),
        lorebook: toOptionalString(source.lorebook, ''),
        title: toOptionalString(source.title, ''),
        connections: normalizeConnections(source.connections),
    };
}

function normalizePersonasDocument(document) {
    const source = isPlainObject(document) ? document : {};
    const sourcePersonas = isPlainObject(source.personas) ? source.personas : {};
    const personas = {};

    for (const [avatarId, record] of Object.entries(sourcePersonas)) {
        const normalizedAvatarId = String(avatarId || '').trim();
        if (!normalizedAvatarId) {
            continue;
        }

        personas[normalizedAvatarId] = normalizePersonaRecord(normalizedAvatarId, record);
    }

    const defaultPersona = String(source.defaultPersona || '').trim();

    return {
        version: PERSONAS_VERSION,
        defaultPersona: personas[defaultPersona] ? defaultPersona : null,
        personas,
    };
}

function getLegacyPersonasMap(settings) {
    return isPlainObject(settings?.power_user?.personas) ? settings.power_user.personas : {};
}

function getLegacyPersonaDescriptions(settings) {
    return isPlainObject(settings?.power_user?.persona_descriptions) ? settings.power_user.persona_descriptions : {};
}

function hasPersonaEntries(settings) {
    return Object.keys(getLegacyPersonasMap(settings)).length > 0
        || Object.keys(getLegacyPersonaDescriptions(settings)).length > 0;
}

export function hasLegacyPersonaRegistry(settings) {
    const defaultPersona = String(settings?.power_user?.default_persona || '').trim();
    return hasPersonaEntries(settings) || Boolean(defaultPersona);
}

export function getPersonasPath(directories) {
    return path.join(directories.root, PERSONAS_FILE);
}

export function readPersonasDocument(directories) {
    const pathToPersonas = getPersonasPath(directories);

    if (!fs.existsSync(pathToPersonas)) {
        return createEmptyPersonasDocument();
    }

    try {
        const rawDocument = JSON.parse(fs.readFileSync(pathToPersonas, 'utf8'));
        return normalizePersonasDocument(rawDocument);
    } catch (error) {
        console.error(`Failed to read personas file: ${pathToPersonas}`, error);
        return createEmptyPersonasDocument();
    }
}

export function writePersonasDocument(directories, document) {
    const pathToPersonas = getPersonasPath(directories);
    const normalizedDocument = normalizePersonasDocument(document);
    writeFileAtomicSync(pathToPersonas, JSON.stringify(normalizedDocument, null, 4), 'utf8');
    return normalizedDocument;
}

export function buildPersonasDocumentFromLegacySettings(settings) {
    const personasMap = getLegacyPersonasMap(settings);
    const personaDescriptions = getLegacyPersonaDescriptions(settings);
    const avatarIds = new Set([
        ...Object.keys(personasMap),
        ...Object.keys(personaDescriptions),
    ]);
    const document = createEmptyPersonasDocument();

    for (const avatarId of avatarIds) {
        const normalizedAvatarId = String(avatarId || '').trim();
        if (!normalizedAvatarId) {
            continue;
        }

        const descriptor = isPlainObject(personaDescriptions[normalizedAvatarId]) ? personaDescriptions[normalizedAvatarId] : {};
        const name = toOptionalString(personasMap[normalizedAvatarId], '');
        document.personas[normalizedAvatarId] = normalizePersonaRecord(normalizedAvatarId, {
            ...descriptor,
            name,
            avatar: normalizedAvatarId,
        }, name);
    }

    const defaultPersona = String(settings?.power_user?.default_persona || '').trim();
    document.defaultPersona = document.personas[defaultPersona] ? defaultPersona : null;
    return document;
}

export function readOrMigratePersonasDocument(directories, settings) {
    const pathToPersonas = getPersonasPath(directories);

    if (fs.existsSync(pathToPersonas)) {
        return readPersonasDocument(directories);
    }

    const document = buildPersonasDocumentFromLegacySettings(settings);
    if (Object.keys(document.personas).length > 0 || document.defaultPersona) {
        return writePersonasDocument(directories, document);
    }

    return document;
}

export function mergePersonasIntoSettings(settings, document) {
    const normalizedDocument = normalizePersonasDocument(document);
    const personas = {};
    const personaDescriptions = {};

    settings.power_user = isPlainObject(settings?.power_user) ? settings.power_user : {};

    for (const [avatarId, persona] of Object.entries(normalizedDocument.personas)) {
        personas[avatarId] = persona.name;
        personaDescriptions[avatarId] = {
            description: persona.description,
            position: persona.position,
            depth: persona.depth,
            role: persona.role,
            lorebook: persona.lorebook,
            title: persona.title,
            connections: persona.connections,
        };
    }

    settings.power_user.personas = personas;
    settings.power_user.persona_descriptions = personaDescriptions;
    settings.power_user.default_persona = normalizedDocument.defaultPersona;

    return settings;
}

export function stripPersonaRegistryFromSettings(settings) {
    if (!isPlainObject(settings?.power_user)) {
        return settings;
    }

    for (const field of PERSONA_REGISTRY_FIELDS) {
        delete settings.power_user[field];
    }

    return settings;
}
