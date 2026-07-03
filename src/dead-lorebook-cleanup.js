import fs from 'node:fs';
import path from 'node:path';

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

function removeDeadLorebookSettingsReferences(settings, deadLorebookNames) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || deadLorebookNames.length === 0) {
        return { changed: false, removedCount: 0 };
    }

    const deadNames = new Set(deadLorebookNames);
    let changed = false;
    let removedCount = 0;

    if (typeof settings.world_info === 'string') {
        const migrated = removeDeadLorebookScalarReference(settings.world_info, deadNames);
        if (migrated.changed) {
            delete settings.world_info;
            changed = true;
            removedCount++;
        }
    } else if (Array.isArray(settings.world_info)) {
        const previousLength = settings.world_info.length;
        const migrated = removeDeadLorebookArrayReferences(settings.world_info, deadNames);
        if (migrated.changed) {
            settings.world_info = migrated.values;
            changed = true;
            removedCount += previousLength - migrated.values.length;
        }
    }

    if (settings.world_info && typeof settings.world_info === 'object' && !Array.isArray(settings.world_info)) {
        if (Array.isArray(settings.world_info.globalSelect)) {
            const previousLength = settings.world_info.globalSelect.length;
            const migrated = removeDeadLorebookArrayReferences(settings.world_info.globalSelect, deadNames);
            if (migrated.changed) {
                settings.world_info.globalSelect = migrated.values;
                changed = true;
                removedCount += previousLength - migrated.values.length;
            }
        }

        if (Array.isArray(settings.world_info.charLore)) {
            const nextCharLore = [];
            for (const entry of settings.world_info.charLore) {
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

            if (nextCharLore.length !== settings.world_info.charLore.length) {
                settings.world_info.charLore = nextCharLore;
            }
        }
    }

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
 * @returns {Promise<{changed: boolean, removedCount: number, deadLorebookNames: string[]}>}
 */
export async function cleanupDeadLorebookSettingsReferences(directories) {
    const deadLorebookNames = getDeadLorebookNames();
    if (deadLorebookNames.length === 0) {
        return { changed: false, removedCount: 0, deadLorebookNames };
    }

    return await withSettingsPersonasLock(directories, async (lock) => {
        const settings = await lock.run(() => readUserSettings(directories));
        const result = removeDeadLorebookSettingsReferences(settings, deadLorebookNames);

        if (result.changed) {
            await lock.run(() => writeUserSettings(directories, settings, SETTINGS_MUTATION_GUARD));
        }

        return { ...result, deadLorebookNames };
    });
}
