const WORLD_INFO_SETTING_TYPES = Object.freeze({
    world_info_depth: 'number',
    world_info_min_activations: 'number',
    world_info_min_activations_depth_max: 'number',
    world_info_budget: 'number',
    world_info_include_names: 'boolean',
    world_info_recursive: 'boolean',
    world_info_overflow_alert: 'boolean',
    world_info_case_sensitive: 'boolean',
    world_info_match_whole_words: 'boolean',
    world_info_budget_cap: 'number',
    world_info_use_group_scoring: 'boolean',
    world_info_max_recursion_steps: 'number',
});

export const WORLD_INFO_LOCKS_EXPORT_VERSION = 2;

/** Identifies the canonical legacy World Info Locks package now supplied by core. */
export function isCoreWorldInfoLocksExtension(name, manifest) {
    const folderName = String(name || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
    const homePage = String(manifest?.homePage || '').replace(/\/$/, '').toLowerCase();
    return folderName === 'sillytavern-worldinfolocks'
        || homePage === 'https://github.com/aikohanasaki/sillytavern-worldinfolocks';
}

/** Returns the backward-compatible defaults for World Info Locks settings. */
export function createDefaultWorldInfoLocksSettings() {
    return {
        presetName: '',
        presetList: [],
        characterLocks: {},
        characterLockIds: {},
        groupLocks: {},
        preferChatOverCharacterLocks: false,
        enableCharacterLocks: true,
        enableChatLocks: true,
        enableGroupLocks: true,
        showLockNotifications: true,
        globalDefaultPreset: '',
    };
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringRecord(value) {
    if (!isPlainObject(value)) {
        return {};
    }

    return Object.fromEntries(Object.entries(value)
        .filter(([key, item]) => typeof key === 'string' && key && typeof item === 'string' && item));
}

/** Filters a saved engine-settings object to supported, type-safe values. */
export function filterWorldInfoEngineSettings(value) {
    if (!isPlainObject(value)) {
        return null;
    }

    const filtered = {};
    for (const [key, type] of Object.entries(WORLD_INFO_SETTING_TYPES)) {
        if (!Object.hasOwn(value, key) || typeof value[key] !== type) {
            continue;
        }
        if (type === 'number' && !Number.isFinite(value[key])) {
            continue;
        }
        filtered[key] = value[key];
    }
    return filtered;
}

/** Normalizes one legacy or current World Info preset without dropping unknown fields. */
export function normalizeWorldInfoPreset(value) {
    if (!isPlainObject(value) || typeof value.name !== 'string' || !value.name.trim()) {
        return null;
    }

    const preset = {
        ...value,
        name: value.name.trim(),
        worldList: Array.isArray(value.worldList)
            ? [...new Set(value.worldList.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))]
            : [],
    };

    if (Object.hasOwn(value, 'worldInfoSettings')) {
        preset.worldInfoSettings = value.worldInfoSettings === null
            ? null
            : isPlainObject(value.worldInfoSettings) ? { ...value.worldInfoSettings } : null;
    }
    return preset;
}

/** Validates a legacy or current preset import before any import side effects occur. */
export function validateWorldInfoPresetImport(value) {
    if (!isPlainObject(value)) {
        throw new TypeError('The preset file must contain an object.');
    }
    if (typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.worldList)
        || value.worldList.some(name => typeof name !== 'string' || !name.trim())) {
        throw new TypeError('The preset file is missing a valid name or world list.');
    }
    if (value.worldInfoSettings !== undefined && value.worldInfoSettings !== null && !isPlainObject(value.worldInfoSettings)) {
        throw new TypeError('The preset file contains invalid World Info settings.');
    }
    for (const key of ['characterLocks', 'characterLockIds', 'groupLocks']) {
        if (value[key] !== undefined && (!isPlainObject(value[key])
            || Object.entries(value[key]).some(([id, presetName]) => !id || typeof presetName !== 'string' || !presetName))) {
            throw new TypeError('The preset file contains invalid lock data.');
        }
    }
    if (value.characterLockRecords !== undefined && (!Array.isArray(value.characterLockRecords)
        || value.characterLockRecords.some(record => !isPlainObject(record)
            || typeof record.presetName !== 'string'
            || (record.id !== undefined && typeof record.id !== 'string')
            || (record.name !== undefined && typeof record.name !== 'string')))) {
        throw new TypeError('The preset file contains invalid lock data.');
    }
    if (value.isGlobalDefault !== undefined && typeof value.isGlobalDefault !== 'boolean') {
        throw new TypeError('The preset file contains an invalid default setting.');
    }
    if (value.books !== undefined && !isPlainObject(value.books)) {
        throw new TypeError('The preset books field is invalid.');
    }
    if (Object.keys(value.books || {}).some(name => !name.trim())) {
        throw new TypeError('The preset books field is invalid.');
    }
    for (const book of Object.values(value.books || {})) {
        if (!isPlainObject(book) || (book.entries !== undefined && !Array.isArray(book.entries) && !isPlainObject(book.entries))) {
            throw new TypeError('The preset contains invalid lorebook data.');
        }
        const entries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});
        const containsProtectedData = book.hidden === true
            || book.storage === 'secure'
            || book.metadata?.storage === 'secure'
            || book._metadata?.storage === 'secure'
            || entries.some(entry => entry?.storage === 'secure' || entry?.hidden === true);
        if (containsProtectedData) {
            throw new TypeError('Secure or hidden lorebook data cannot be imported with a preset.');
        }
    }
    const preset = normalizeWorldInfoPreset(value);
    if (!preset) {
        throw new TypeError('The preset file is invalid.');
    }
    return preset;
}

/** Returns whether a management response is an ordinary lorebook with no protected entry markers. */
export function isSafeOrdinaryLorebookExportResponse(value) {
    if (!isPlainObject(value?.data)
        || value?.metadata?.storage !== 'user'
        || value.data.hidden === true
        || value.metadata?.hidden === true
        || (value.data.entries !== undefined && !Array.isArray(value.data.entries) && !isPlainObject(value.data.entries))) {
        return false;
    }
    const entries = Array.isArray(value.data.entries) ? value.data.entries : Object.values(value.data.entries || {});
    return !entries.some(entry => entry?.storage === 'secure' || entry?.hidden === true);
}

/** Normalizes saved World Info Locks data while retaining unknown compatibility fields. */
export function normalizeWorldInfoLocksSettings(value) {
    const source = isPlainObject(value) ? value : {};
    const defaults = createDefaultWorldInfoLocksSettings();
    const presetList = Array.isArray(source.presetList)
        ? source.presetList.map(normalizeWorldInfoPreset).filter(Boolean)
        : [];
    const presetNames = new Set(presetList.map(preset => preset.name));

    return {
        ...source,
        presetName: presetNames.has(source.presetName) ? source.presetName : defaults.presetName,
        presetList,
        characterLocks: normalizeStringRecord(source.characterLocks),
        characterLockIds: normalizeStringRecord(source.characterLockIds),
        groupLocks: normalizeStringRecord(source.groupLocks),
        preferChatOverCharacterLocks: typeof source.preferChatOverCharacterLocks === 'boolean'
            ? source.preferChatOverCharacterLocks
            : defaults.preferChatOverCharacterLocks,
        enableCharacterLocks: typeof source.enableCharacterLocks === 'boolean'
            ? source.enableCharacterLocks
            : defaults.enableCharacterLocks,
        enableChatLocks: typeof source.enableChatLocks === 'boolean'
            ? source.enableChatLocks
            : defaults.enableChatLocks,
        enableGroupLocks: typeof source.enableGroupLocks === 'boolean'
            ? source.enableGroupLocks
            : defaults.enableGroupLocks,
        showLockNotifications: typeof source.showLockNotifications === 'boolean'
            ? source.showLockNotifications
            : defaults.showLockNotifications,
        globalDefaultPreset: presetNames.has(source.globalDefaultPreset) ? source.globalDefaultPreset : defaults.globalDefaultPreset,
    };
}

/** Selects and normalizes the persisted legacy namespace independently of extension loading. */
export function loadWorldInfoLocksSettingsSource(rawSettings, fallbackSettings = {}) {
    const hasRawSettings = rawSettings && typeof rawSettings === 'object';
    const source = hasRawSettings
        ? rawSettings?.extension_settings?.worldInfoPresets ?? {}
        : fallbackSettings;
    return normalizeWorldInfoLocksSettings(source);
}

/** Resolves a preset lock using stable identities before legacy character names. */
export function resolveWorldInfoPresetLock(settings, context, chatLock = '') {
    const enabledChatLock = settings.enableChatLocks ? chatLock : '';
    let entityLock = '';

    if (context.isGroupChat) {
        entityLock = settings.enableGroupLocks
            ? settings.groupLocks[context.groupId]
                || (context.legacyGroupNameUnique ? settings.characterLocks[context.groupName] : '')
                || ''
            : '';
    } else if (settings.enableCharacterLocks) {
        entityLock = settings.characterLockIds[context.characterId]
            || (context.legacyNameUnique !== false ? settings.characterLocks[context.characterName] : '')
            || '';
    }

    return settings.preferChatOverCharacterLocks
        ? enabledChatLock || entityLock
        : entityLock || enabledChatLock;
}

/** Adds unambiguous legacy name locks to the stable identity map without deleting legacy data. */
export function migrateLegacyCharacterLockIds(settings, characters = []) {
    const charactersByName = new Map();
    for (const character of characters) {
        const name = String(character?.name || '').trim();
        const avatar = String(character?.avatar || '').trim();
        if (!name || !avatar) {
            continue;
        }
        const matches = charactersByName.get(name) || [];
        matches.push(avatar);
        charactersByName.set(name, matches);
    }

    let changed = false;
    for (const [name, presetName] of Object.entries(settings.characterLocks)) {
        const matches = charactersByName.get(name) || [];
        if (matches.length !== 1 || settings.characterLockIds[matches[0]]) {
            continue;
        }
        settings.characterLockIds[matches[0]] = presetName;
        changed = true;
    }
    return changed;
}

/** Adds unambiguous legacy group-name locks to the stable group-ID map without deleting legacy data. */
export function migrateLegacyGroupLockIds(settings, groups = [], characterNames = []) {
    const groupsByName = new Map();
    const characterNameSet = new Set(characterNames.map(name => String(name || '').trim()).filter(Boolean));
    for (const group of groups) {
        const name = String(group?.name || '').trim();
        const id = String(group?.id || '').trim();
        if (!name || !id) {
            continue;
        }
        const matches = groupsByName.get(name) || [];
        matches.push(id);
        groupsByName.set(name, matches);
    }

    let changed = false;
    for (const [name, presetName] of Object.entries(settings.characterLocks)) {
        const matches = groupsByName.get(name) || [];
        if (characterNameSet.has(name) || matches.length !== 1 || settings.groupLocks[matches[0]]) {
            continue;
        }
        settings.groupLocks[matches[0]] = presetName;
        changed = true;
    }
    return changed;
}

/** Moves a stable character lock when Aikobots renames the character file identity. */
export function moveCharacterLockId(settings, oldId, newId) {
    if (!oldId || !newId || oldId === newId || !settings.characterLockIds[oldId]) {
        return false;
    }
    if (!settings.characterLockIds[newId]) {
        settings.characterLockIds[newId] = settings.characterLockIds[oldId];
    }
    delete settings.characterLockIds[oldId];
    return true;
}

/** Returns the unique preset names currently eligible for ordinary-user selection. */
export function getEligiblePresetWorldNames(worldList, eligibleWorldNames) {
    const eligible = eligibleWorldNames instanceof Set ? eligibleWorldNames : new Set(eligibleWorldNames || []);
    return [...new Set((Array.isArray(worldList) ? worldList : []).filter(name => eligible.has(name)))];
}

/** Combines a preset's ordinary selections with protected secure and hidden selections. */
export function mergeWorldInfoPresetSelection(currentNames, requestedNames, eligibleNames, secureNames, listedNames) {
    const eligible = eligibleNames instanceof Set ? eligibleNames : new Set(eligibleNames || []);
    const secure = secureNames instanceof Set ? secureNames : new Set(secureNames || []);
    const listed = listedNames instanceof Set ? listedNames : new Set(listedNames || []);
    const requested = getEligiblePresetWorldNames(requestedNames, eligible);
    const protectedNames = (Array.isArray(currentNames) ? currentNames : [])
        .filter(name => secure.has(name) || !listed.has(name));
    return [...new Set([...requested, ...protectedNames])];
}

/** Renames lock and default references to a renamed preset. */
export function renamePresetReferences(settings, oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
        return false;
    }

    let changed = false;
    for (const record of [settings.characterLocks, settings.characterLockIds, settings.groupLocks]) {
        for (const key of Object.keys(record)) {
            if (record[key] === oldName) {
                record[key] = newName;
                changed = true;
            }
        }
    }
    if (settings.globalDefaultPreset === oldName) {
        settings.globalDefaultPreset = newName;
        changed = true;
    }
    return changed;
}

/** Removes lock and default references to a deleted preset. */
export function removePresetReferences(settings, presetName) {
    for (const record of [settings.characterLocks, settings.characterLockIds, settings.groupLocks]) {
        for (const key of Object.keys(record)) {
            if (record[key] === presetName) {
                delete record[key];
            }
        }
    }
    if (settings.globalDefaultPreset === presetName) {
        settings.globalDefaultPreset = '';
    }
}
