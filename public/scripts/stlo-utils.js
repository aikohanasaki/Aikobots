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
