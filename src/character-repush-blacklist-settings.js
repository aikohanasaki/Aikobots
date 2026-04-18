import path from 'node:path';
import fs from 'node:fs';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { SETTINGS_FILE } from './constants.js';
import { withSettingsPersonasLock } from './settings-lock.js';

export const REPUSH_BLACKLIST_SETTINGS_KEY = 'character_repush_blacklist';
const SETTINGS_MUTATION_GUARD = Symbol('repush blacklist settings mutation');

function getSettingsPath(directories) {
    return path.join(directories.root, SETTINGS_FILE);
}

function normalizePublishedFilename(value) {
    const parsedName = path.parse(String(value || '')).name || String(value || '');
    return sanitize(parsedName).trim();
}

function normalizeCharacterKey(value) {
    return value ? normalizePublishedFilename(value) : '';
}

function buildRepushBlacklistEntryKey({ ownerHandle, characterKey, publishedFilename }) {
    const normalizedCharacterKey = normalizeCharacterKey(characterKey);
    const normalizedOwnerHandle = String(ownerHandle || '').trim();
    const normalizedPublishedFilename = normalizePublishedFilename(publishedFilename);

    if (!normalizedPublishedFilename) {
        return '';
    }

    return normalizedCharacterKey
        ? `${normalizedCharacterKey}::${normalizedPublishedFilename}`
        : `${normalizedOwnerHandle}::${normalizedPublishedFilename}`;
}

export function normalizeCharacterRepushBlacklistEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }

    const ownerHandle = String(entry.ownerHandle || '').trim();
    const characterKey = normalizeCharacterKey(entry.characterKey);
    const publishedFilename = normalizePublishedFilename(entry.publishedFilename);
    const key = String(entry.key || buildRepushBlacklistEntryKey({ ownerHandle, characterKey, publishedFilename })).trim();

    if (!key || !publishedFilename || (!ownerHandle && !characterKey)) {
        return null;
    }

    const characterName = String(entry.characterName || publishedFilename).trim() || publishedFilename;

    return {
        key,
        ownerHandle,
        characterKey,
        publishedFilename,
        characterName,
        addedAt: Number(entry.addedAt) || Date.now(),
    };
}

export function getCharacterRepushBlacklistEntriesFromSettings(settings) {
    const rawEntries = Array.isArray(settings?.[REPUSH_BLACKLIST_SETTINGS_KEY])
        ? settings[REPUSH_BLACKLIST_SETTINGS_KEY]
        : [];
    const entriesByKey = new Map();

    for (const rawEntry of rawEntries) {
        const entry = normalizeCharacterRepushBlacklistEntry(rawEntry);
        if (!entry) {
            continue;
        }

        entriesByKey.set(entry.key, entry);
    }

    return Array.from(entriesByKey.values()).sort((left, right) => right.addedAt - left.addedAt);
}

function readUserSettings(directories) {
    const settingsPath = getSettingsPath(directories);

    if (!fs.existsSync(settingsPath)) {
        return {};
    }

    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function writeUserSettings(directories, settings, guard) {
    if (guard !== SETTINGS_MUTATION_GUARD) {
        throw new Error('Repush blacklist settings writes must hold the settings lock.');
    }

    const settingsPath = getSettingsPath(directories);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
}

async function withRepushBlacklistSettingsMutation(directories, mutation) {
    return await withSettingsPersonasLock(directories, () => {
        const settings = readUserSettings(directories);
        const result = mutation(settings);

        if (result?.write !== false) {
            writeUserSettings(directories, settings, SETTINGS_MUTATION_GUARD);
        }

        return result?.value;
    });
}

export async function upsertCharacterRepushBlacklistEntry(directories, entry) {
    const normalizedEntry = normalizeCharacterRepushBlacklistEntry(entry);
    if (!normalizedEntry) {
        throw new Error('Invalid repush blacklist entry.');
    }

    return await withRepushBlacklistSettingsMutation(directories, (settings) => {
        const entries = getCharacterRepushBlacklistEntriesFromSettings(settings)
            .filter(existingEntry => existingEntry.key !== normalizedEntry.key);

        settings[REPUSH_BLACKLIST_SETTINGS_KEY] = [normalizedEntry, ...entries];

        return { value: settings[REPUSH_BLACKLIST_SETTINGS_KEY] };
    });
}

export async function reconcileCharacterRepushBlacklistEntries(directories, entries) {
    return await withRepushBlacklistSettingsMutation(directories, (settings) => {
        const existingEntries = getCharacterRepushBlacklistEntriesFromSettings(settings);
        const entriesByKey = new Map();

        for (const rawEntry of entries) {
            const entry = normalizeCharacterRepushBlacklistEntry(rawEntry);
            if (!entry) {
                continue;
            }

            const existingEntry = existingEntries.find(cachedEntry => cachedEntry.key === entry.key);
            if (existingEntry && existingEntry.characterName !== existingEntry.publishedFilename && entry.characterName === entry.publishedFilename) {
                entriesByKey.set(entry.key, { ...entry, characterName: existingEntry.characterName });
            } else {
                entriesByKey.set(entry.key, entry);
            }
        }

        const nextEntries = Array.from(entriesByKey.values()).sort((left, right) => right.addedAt - left.addedAt);

        if (JSON.stringify(nextEntries) !== JSON.stringify(existingEntries)) {
            settings[REPUSH_BLACKLIST_SETTINGS_KEY] = nextEntries;
            return { value: nextEntries };
        }

        return { value: nextEntries, write: false };
    });
}

export async function removeCharacterRepushBlacklistEntry(directories, key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
        throw new Error('Missing repush blacklist entry key.');
    }

    return await withRepushBlacklistSettingsMutation(directories, (settings) => {
        const entries = getCharacterRepushBlacklistEntriesFromSettings(settings);
        const nextEntries = entries.filter(entry => entry.key !== normalizedKey);
        const removedEntry = entries.find(entry => entry.key === normalizedKey) || null;

        settings[REPUSH_BLACKLIST_SETTINGS_KEY] = nextEntries;

        return { value: {
            removedEntry,
            entries: nextEntries,
        } };
    });
}

export function preserveCharacterRepushBlacklistSettings(nextSettings, existingSettings) {
    const preservedEntries = getCharacterRepushBlacklistEntriesFromSettings(existingSettings);

    if (preservedEntries.length > 0 || Object.prototype.hasOwnProperty.call(existingSettings || {}, REPUSH_BLACKLIST_SETTINGS_KEY)) {
        nextSettings[REPUSH_BLACKLIST_SETTINGS_KEY] = preservedEntries;
    } else {
        delete nextSettings[REPUSH_BLACKLIST_SETTINGS_KEY];
    }

    return nextSettings;
}
