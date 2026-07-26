export const DEFAULT_STLO_SETTINGS = Object.freeze({
    priority: null,
    budget: null,
    budgetMode: 'default',
    orderAdjustment: 0,
    orderAdjustmentGroupOnly: false,
    characterOverrides: {},
    onlyWhenSpeaking: false,
    randomTrim: false,
});

function clonePlainObject(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

export function normalizeStloPriority(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
        return null;
    }

    return Math.max(1, Math.min(5, Math.trunc(number)));
}

export function normalizeStloBudgetMode(value) {
    const mode = String(value || 'default').trim().toLowerCase();
    return ['default', 'percentage_context', 'percentage_budget', 'fixed'].includes(mode)
        ? mode
        : 'default';
}

export function normalizeStloBudgetValue(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function normalizeStloCharacterOverrides(value, { normalizeKeys = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.entries(value).reduce((result, [key, override]) => {
        const normalizedKey = String(key || '').trim();
        const resultKey = normalizeKeys ? normalizedKey.toLowerCase() : normalizedKey;
        if (!resultKey || !override || typeof override !== 'object' || Array.isArray(override)) {
            return result;
        }

        result[resultKey] = {
            ...(override.priority !== undefined ? { priority: normalizeStloPriority(override.priority) } : {}),
            ...(override.orderAdjustment !== undefined ? { orderAdjustment: Number(override.orderAdjustment) || 0 } : {}),
            ...(override.budgetMode !== undefined ? { budgetMode: normalizeStloBudgetMode(override.budgetMode) } : {}),
            ...(override.budget !== undefined ? { budget: normalizeStloBudgetValue(override.budget) } : {}),
        };
        return result;
    }, {});
}

export function normalizeStloSettings(settings = {}, { normalizeCharacterKeys = false } = {}) {
    const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    return {
        ...DEFAULT_STLO_SETTINGS,
        priority: normalizeStloPriority(source.priority),
        budget: normalizeStloBudgetValue(source.budget),
        budgetMode: normalizeStloBudgetMode(source.budgetMode),
        orderAdjustment: Number(source.orderAdjustment) || 0,
        orderAdjustmentGroupOnly: Boolean(source.orderAdjustmentGroupOnly),
        characterOverrides: normalizeStloCharacterOverrides(source.characterOverrides, { normalizeKeys: normalizeCharacterKeys }),
        onlyWhenSpeaking: Boolean(source.onlyWhenSpeaking),
        randomTrim: Boolean(source.randomTrim),
    };
}

export function getStloSettingsFromLorebook(data = {}, options = {}) {
    const raw = data?.stlo && typeof data.stlo === 'object'
        ? data.stlo
        : (data?.extensions?.stlo && typeof data.extensions.stlo === 'object' ? data.extensions.stlo : {});

    return normalizeStloSettings(raw, options);
}

export function isDefaultStloSettings(settings = {}, options = {}) {
    const normalized = normalizeStloSettings(settings, options);
    return normalized.priority === null
        && normalized.budget === null
        && normalized.budgetMode === 'default'
        && normalized.orderAdjustment === 0
        && !normalized.orderAdjustmentGroupOnly
        && !normalized.onlyWhenSpeaking
        && !normalized.randomTrim
        && Object.keys(normalized.characterOverrides).length === 0;
}

export function cloneStloSettings(settings = {}, { omitDefault = false, normalizeCharacterKeys = false } = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return null;
    }

    const normalized = normalizeStloSettings(settings, { normalizeCharacterKeys });
    if (omitDefault && isDefaultStloSettings(normalized, { normalizeCharacterKeys })) {
        return null;
    }

    return clonePlainObject(normalized);
}

export function setStloSettingsOnLorebook(data = {}, settings = {}, options = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return;
    }

    if (data.extensions && typeof data.extensions === 'object' && data.extensions.stlo) {
        delete data.extensions.stlo;
    }

    const nextSettings = cloneStloSettings(settings, options);
    if (!nextSettings || isDefaultStloSettings(nextSettings, options)) {
        delete data.stlo;
        return;
    }

    data.stlo = nextSettings;
}

export function applyStloDefaultsToLorebook(data = {}, defaults = null) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !defaults) {
        return data;
    }

    const clonedDefaults = cloneStloSettings(defaults, { omitDefault: true });
    if (clonedDefaults) {
        data.stlo = clonedDefaults;
    }

    return data;
}

/**
 * Adds speaking-character overrides without replacing existing STLO metadata.
 * @param {object} data Lorebook document.
 * @param {string[]} characterNames STLO character filter names.
 * @returns {{changed: boolean, addedNames: string[]}}
 */
export function applyStloCharacterFilters(data, characterNames = []) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Lorebook data must be an object.');
    }
    if (Object.hasOwn(data, 'stlo') && (!data.stlo || typeof data.stlo !== 'object' || Array.isArray(data.stlo))) {
        throw new TypeError('Lorebook STLO metadata must be an object.');
    }
    if (data.stlo && Object.hasOwn(data.stlo, 'characterOverrides')
        && (!data.stlo.characterOverrides || typeof data.stlo.characterOverrides !== 'object' || Array.isArray(data.stlo.characterOverrides))) {
        throw new TypeError('STLO characterOverrides metadata must be an object.');
    }

    const names = [...new Set((Array.isArray(characterNames) ? characterNames : [])
        .map(name => String(name || '').trim())
        .filter(Boolean))];
    if (names.length === 0) {
        return { changed: false, addedNames: [] };
    }

    const stlo = data.stlo || {};
    const characterOverrides = stlo.characterOverrides || {};
    const defaultPriority = normalizeStloPriority(stlo.priority) ?? 3;
    const defaultOrderAdjustment = Number(stlo.orderAdjustment) || 0;
    const addedNames = [];
    for (const name of names) {
        if (Object.hasOwn(characterOverrides, name)) continue;
        Object.defineProperty(characterOverrides, name, {
            value: { priority: defaultPriority, orderAdjustment: defaultOrderAdjustment },
            enumerable: true,
            configurable: true,
            writable: true,
        });
        addedNames.push(name);
    }

    data.stlo = stlo;
    stlo.characterOverrides = characterOverrides;
    const changedSpeakingFilter = stlo.onlyWhenSpeaking !== true;
    stlo.onlyWhenSpeaking = true;
    return { changed: addedNames.length > 0 || changedSpeakingFilter, addedNames };
}
