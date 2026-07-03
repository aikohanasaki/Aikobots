import fs from 'node:fs';
import path from 'node:path';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { SETTINGS_FILE } from './constants.js';
import { withSettingsPersonasLock } from './settings-lock.js';
import { getConfigValue } from './util.js';

const DEFAULT_DEAD_LOREBOOK_NAMES = Object.freeze([
    '9Z Exclusives',
]);
const SETTINGS_MUTATION_GUARD = Symbol('dead lorebook settings cleanup');

function getSettingsPath(directories) {
    return path.join(directories.root, SETTINGS_FILE);
}

function normalizeDeadLorebookNames(value) {
    const source = Array.isArray(value) ? value : [];
    return [...new Set(source
        .map(name => String(name || '').trim())
        .filter(Boolean))];
}

function getDeadLorebookNames() {
    return normalizeDeadLorebookNames(getConfigValue('deadLorebooks.names', DEFAULT_DEAD_LOREBOOK_NAMES));
}

function removeDeadLorebookArrayReferences(values, deadNames) {
    if (!Array.isArray(values)) {
        return { changed: false, values };
    }

    const nextValues = values.filter(value => !deadNames.has(String(value || '').trim()));
    return {
        changed: nextValues.length !== values.length,
        values: nextValues,
    };
}

function removeDeadLorebookScalarReference(value, deadNames) {
    const normalized = String(value || '').trim();
    if (!normalized || !deadNames.has(normalized)) {
        return { changed: false, value };
    }

    return { changed: true, value: '' };
}

function normalizeCharacterName(value) {
    const parsedName = path.parse(String(value || '')).name || String(value || '');
    const sanitizedName = sanitize(parsedName).trim();

    if (!sanitizedName) {
        throw new Error('Character must have a valid filename.');
    }

    return sanitizedName;
}

function getWorldInfoContainers(settings) {
    const containers = [];
    const addContainer = (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && !containers.includes(value)) {
            containers.push(value);
        }
    };

    addContainer(settings?.world_info_settings?.world_info);
    addContainer(settings?.world_info);
    return containers;
}

function removeDeadLorebookWorldInfoReferences(worldInfo, deadNames) {
    let changed = false;
    let removedCount = 0;

    if (Array.isArray(worldInfo.globalSelect)) {
        const previousLength = worldInfo.globalSelect.length;
        const migrated = removeDeadLorebookArrayReferences(worldInfo.globalSelect, deadNames);
        if (migrated.changed) {
            worldInfo.globalSelect = migrated.values;
            changed = true;
            removedCount += previousLength - migrated.values.length;
        }
    }

    if (Array.isArray(worldInfo.charLore)) {
        const nextCharLore = [];
        for (const entry of worldInfo.charLore) {
            const currentExtraBooks = Array.isArray(entry?.extraBooks) ? entry.extraBooks : [];
            const migrated = removeDeadLorebookArrayReferences(currentExtraBooks, deadNames);

            if (migrated.changed) {
                entry.extraBooks = migrated.values;
                changed = true;
                removedCount += currentExtraBooks.length - migrated.values.length;
            }

            if (entry.extraBooks?.length > 0 || currentExtraBooks.length === 0) {
                nextCharLore.push(entry);
            } else {
                changed = true;
            }
        }

        if (nextCharLore.length !== worldInfo.charLore.length) {
            worldInfo.charLore = nextCharLore;
        }
    }

    return { changed, removedCount };
}

function removeOrphanedCharacterCharLoreReferences(worldInfo, characterNames) {
    if (!Array.isArray(worldInfo?.charLore)) {
        return { changed: false, removedCount: 0 };
    }

    const nextCharLore = worldInfo.charLore.filter((entry) => {
        try {
            return characterNames.has(normalizeCharacterName(entry?.name));
        } catch {
            return false;
        }
    });
    const removedCount = worldInfo.charLore.length - nextCharLore.length;
    if (removedCount === 0) {
        return { changed: false, removedCount: 0 };
    }

    worldInfo.charLore = nextCharLore;
    return { changed: true, removedCount };
}

function hasExistingCharacterName(characterNames, value) {
    try {
        return characterNames.has(normalizeCharacterName(value));
    } catch {
        return false;
    }
}

function removeOrphanedNamedCharacterArrayEntries(entries, characterNames) {
    if (!Array.isArray(entries)) {
        return { changed: false, removedCount: 0 };
    }

    const nextEntries = entries.filter(entry => hasExistingCharacterName(characterNames, entry?.name));
    const removedCount = entries.length - nextEntries.length;
    return {
        changed: removedCount > 0,
        removedCount,
        entries: nextEntries,
    };
}

function removeOrphanedCharacterMapEntries(map, characterNames) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return { changed: false, removedCount: 0 };
    }

    let removedCount = 0;
    for (const key of Object.keys(map)) {
        if (hasExistingCharacterName(characterNames, key)) {
            continue;
        }

        delete map[key];
        removedCount++;
    }

    return { changed: removedCount > 0, removedCount };
}

function removeDeadLorebookSettingsReferences(settings, deadLorebookNames) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return { changed: false, removedCount: 0 };
    }

    const deadNames = new Set(deadLorebookNames);
    let changed = false;
    let removedCount = 0;

    if (deadNames.size > 0 && typeof settings.world_info === 'string') {
        const migrated = removeDeadLorebookScalarReference(settings.world_info, deadNames);
        if (migrated.changed) {
            delete settings.world_info;
            changed = true;
            removedCount++;
        }
    } else if (deadNames.size > 0 && Array.isArray(settings.world_info)) {
        const previousLength = settings.world_info.length;
        const migrated = removeDeadLorebookArrayReferences(settings.world_info, deadNames);
        if (migrated.changed) {
            settings.world_info = migrated.values;
            changed = true;
            removedCount += previousLength - migrated.values.length;
        }
    }

    if (deadNames.size > 0) {
        for (const worldInfo of getWorldInfoContainers(settings)) {
            const result = removeDeadLorebookWorldInfoReferences(worldInfo, deadNames);
            changed ||= result.changed;
            removedCount += result.removedCount;
        }
    }

    if (deadNames.size > 0) {
        const personaLorebook = removeDeadLorebookScalarReference(settings?.power_user?.persona_description_lorebook, deadNames);
        if (personaLorebook.changed) {
            settings.power_user = settings.power_user && typeof settings.power_user === 'object' ? settings.power_user : {};
            settings.power_user.persona_description_lorebook = personaLorebook.value;
            changed = true;
            removedCount++;
        }

        const personaDescriptions = settings?.power_user?.persona_descriptions;
        if (personaDescriptions && typeof personaDescriptions === 'object' && !Array.isArray(personaDescriptions)) {
            for (const descriptor of Object.values(personaDescriptions)) {
                if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
                    continue;
                }

                const migrated = removeDeadLorebookScalarReference(descriptor.lorebook, deadNames);
                if (migrated.changed) {
                    descriptor.lorebook = migrated.value;
                    changed = true;
                    removedCount++;
                }
            }
        }
    }

    return { changed, removedCount };
}

function getCharacterNamesFromDirectory(charactersDirectory) {
    const characterNames = new Set();
    if (!charactersDirectory || !fs.existsSync(charactersDirectory)) {
        return null;
    }

    let files = [];
    try {
        if (!fs.statSync(charactersDirectory).isDirectory()) {
            return null;
        }

        files = fs.readdirSync(charactersDirectory);
    } catch {
        return null;
    }

    for (const fileName of files) {
        if (path.extname(fileName).toLowerCase() !== '.png') {
            continue;
        }

        try {
            characterNames.add(normalizeCharacterName(fileName));
        } catch {
            // Ignore unusable character file names while pruning stale settings.
        }
    }

    return characterNames;
}

function removeOrphanedCharacterLorebookSettingsReferences(settings, charactersDirectory) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return { changed: false, removedCount: 0 };
    }

    const characterNames = getCharacterNamesFromDirectory(charactersDirectory);
    if (!characterNames) {
        return { changed: false, removedCount: 0 };
    }

    let changed = false;
    let removedCount = 0;

    for (const worldInfo of getWorldInfoContainers(settings)) {
        const result = removeOrphanedCharacterCharLoreReferences(worldInfo, characterNames);
        changed ||= result.changed;
        removedCount += result.removedCount;
    }

    return { changed, removedCount };
}

function removeOrphanedCharacterExtensionSettingsReferences(settings, charactersDirectory) {
    const extensionSettings = settings?.extension_settings;
    if (!extensionSettings || typeof extensionSettings !== 'object' || Array.isArray(extensionSettings)) {
        return { changed: false, removedCount: 0 };
    }

    const characterNames = getCharacterNamesFromDirectory(charactersDirectory);
    if (!characterNames) {
        return { changed: false, removedCount: 0 };
    }

    let changed = false;
    let removedCount = 0;

    const noteChara = removeOrphanedNamedCharacterArrayEntries(extensionSettings.note?.chara, characterNames);
    if (noteChara.changed) {
        extensionSettings.note.chara = noteChara.entries;
        changed = true;
        removedCount += noteChara.removedCount;
    }

    const cfgChara = removeOrphanedNamedCharacterArrayEntries(extensionSettings.cfg?.chara, characterNames);
    if (cfgChara.changed) {
        extensionSettings.cfg.chara = cfgChara.entries;
        changed = true;
        removedCount += cfgChara.removedCount;
    }

    const expressionOverrides = removeOrphanedNamedCharacterArrayEntries(extensionSettings.expressionOverrides, characterNames);
    if (expressionOverrides.changed) {
        extensionSettings.expressionOverrides = expressionOverrides.entries;
        changed = true;
        removedCount += expressionOverrides.removedCount;
    }

    for (const map of [
        extensionSettings.character_attachments,
        extensionSettings.gallery?.folders,
        extensionSettings.quickReplyV2?.characterConfigs,
    ]) {
        const result = removeOrphanedCharacterMapEntries(map, characterNames);
        changed ||= result.changed;
        removedCount += result.removedCount;
    }

    return { changed, removedCount };
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
        throw new Error('Dead lorebook cleanup writes must hold the settings lock.');
    }

    const settingsPath = getSettingsPath(directories);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
}

/**
 * Removes explicitly declared dead lorebook names from a user's saved settings.
 * This only mutates exact configured matches and does not inspect secure lorebook content.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<{changed: boolean, removedCount: number, deadLorebookNames: string[], orphanedCharacterRemovedCount: number, orphanedCharacterSettingsRemovedCount: number}>}
 */
export async function cleanupDeadLorebookSettingsReferences(directories) {
    const deadLorebookNames = getDeadLorebookNames();

    return await withSettingsPersonasLock(directories, async (lock) => {
        const settings = await lock.run(() => readUserSettings(directories));
        const deadLorebookResult = removeDeadLorebookSettingsReferences(settings, deadLorebookNames);
        const orphanedCharacterResult = removeOrphanedCharacterLorebookSettingsReferences(settings, directories.characters);
        const orphanedCharacterSettingsResult = removeOrphanedCharacterExtensionSettingsReferences(settings, directories.characters);
        const result = {
            changed: deadLorebookResult.changed || orphanedCharacterResult.changed || orphanedCharacterSettingsResult.changed,
            removedCount: deadLorebookResult.removedCount + orphanedCharacterResult.removedCount + orphanedCharacterSettingsResult.removedCount,
            deadLorebookNames,
            orphanedCharacterRemovedCount: orphanedCharacterResult.removedCount,
            orphanedCharacterSettingsRemovedCount: orphanedCharacterSettingsResult.removedCount,
        };

        if (result.changed) {
            await lock.run(() => writeUserSettings(directories, settings, SETTINGS_MUTATION_GUARD));
        }

        return result;
    });
}
