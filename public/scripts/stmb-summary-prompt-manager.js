import { getRequestHeaders } from '../script.js';
import { translate } from './i18n.js';
import { STMB_DEFAULT_PROMPTS } from './stmb-core.js';

const SUMMARY_PROMPTS_FILE = 'stmb-summary-prompts.json';
const SUMMARY_PROMPTS_VERSION = 1;

const SUMMARY_PROMPT_DISPLAY_NAMES = Object.freeze({
    summary: {
        text: 'Summary - Detailed beat-by-beat summaries in narrative prose',
        key: 'STMemoryBooks_DisplayName_summary',
    },
    group: {
        text: 'Group - Shared group memory with clear attribution',
        key: 'STMemoryBooks_DisplayName_group',
    },
    char: {
        text: 'Character - Targeted character memory',
        key: 'STMemoryBooks_DisplayName_char',
    },
    summarize: {
        text: 'Summarize - Bullet-point format',
        key: 'STMemoryBooks_DisplayName_summarize',
    },
    synopsis: {
        text: 'Synopsis - Long and comprehensive (beats, interactions, details) with headings',
        key: 'STMemoryBooks_DisplayName_synopsis',
    },
    sumup: {
        text: 'Sum Up - Concise story beats in narrative prose',
        key: 'STMemoryBooks_DisplayName_sumup',
    },
    minimal: {
        text: 'Minimal - Brief 1-2 sentence summary',
        key: 'STMemoryBooks_DisplayName_minimal',
    },
    northgate: {
        text: 'Northgate - Intended for creative writing. By Northgate on ST Discord',
        key: 'STMemoryBooks_DisplayName_northgate',
    },
    aelemar: {
        text: 'Aelemar - Focuses on plot points and character memories. By Aelemar on ST Discord',
        key: 'STMemoryBooks_DisplayName_aelemar',
    },
    comprehensive: {
        text: 'Comprehensive - Synopsis plus improved keywords extraction',
        key: 'STMemoryBooks_DisplayName_comprehensive',
    },
});

let cachedDoc = null;

function createMissingSummaryPromptError(key) {
    const normalizedKey = String(key || 'summary').trim() || 'summary';
    const message = `STMB summary prompt with key '${normalizedKey}' is missing from ${SUMMARY_PROMPTS_FILE}`;
    const error = new Error(message);
    error.code = 'STMB_SUMMARY_PROMPT_MISSING';
    error.promptKey = normalizedKey;
    error.expectedSource = SUMMARY_PROMPTS_FILE;
    error.stmbToastrShown = true;
    console.error(message);
    globalThis.toastr?.error?.(message, 'STMB');
    return error;
}

function toTitleCase(text) {
    return String(text || '').replace(/\w\S*/g, token => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase());
}

function safeSlug(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'custom-prompt';
}

function getDefaultDisplayName(key) {
    const normalizedKey = String(key || '').trim();
    const preset = SUMMARY_PROMPT_DISPLAY_NAMES[normalizedKey];
    if (preset) {
        return translate(preset.text, preset.key);
    }
    return toTitleCase(normalizedKey.replace(/[-_]+/g, ' ')) || 'Custom Prompt';
}

function validatePromptsFile(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.version !== 'number') return false;
    if (!data.overrides || typeof data.overrides !== 'object') return false;

    for (const [key, value] of Object.entries(data.overrides)) {
        if (!value || typeof value !== 'object') return false;
        if (typeof value.prompt !== 'string' || !value.prompt.trim()) return false;
        if (value.displayName !== undefined && typeof value.displayName !== 'string') return false;
        if (!key || typeof key !== 'string') return false;
    }

    return true;
}

function generateUniqueKey(baseName, overrides) {
    const baseSlug = safeSlug(baseName);
    const existing = overrides && typeof overrides === 'object' ? overrides : {};
    let key = baseSlug;
    let counter = 2;
    while (Object.prototype.hasOwnProperty.call(existing, key) || Object.prototype.hasOwnProperty.call(STMB_DEFAULT_PROMPTS, key)) {
        key = `${baseSlug}-${counter}`;
        counter++;
    }
    return key;
}

function buildInitialOverrides(settings = null) {
    const overrides = {};
    const timestamp = new Date().toISOString();

    for (const [key, prompt] of Object.entries(STMB_DEFAULT_PROMPTS || {})) {
        overrides[key] = {
            displayName: getDefaultDisplayName(key),
            prompt: String(prompt || ''),
            createdAt: timestamp,
        };
    }

    const legacyPromptPresets = settings?.promptPresets && typeof settings.promptPresets === 'object'
        ? settings.promptPresets
        : {};
    const legacyPromptMetadata = settings?.promptPresetMetadata && typeof settings.promptPresetMetadata === 'object'
        ? settings.promptPresetMetadata
        : {};

    for (const [key, prompt] of Object.entries(legacyPromptPresets)) {
        if (typeof prompt !== 'string' || !prompt.trim()) continue;
        overrides[key] = {
            displayName: typeof legacyPromptMetadata[key]?.displayName === 'string' && legacyPromptMetadata[key].displayName.trim()
                ? legacyPromptMetadata[key].displayName.trim()
                : getDefaultDisplayName(key),
            prompt,
            createdAt: typeof legacyPromptMetadata[key]?.createdAt === 'string'
                ? legacyPromptMetadata[key].createdAt
                : timestamp,
            updatedAt: typeof legacyPromptMetadata[key]?.updatedAt === 'string'
                ? legacyPromptMetadata[key].updatedAt
                : undefined,
        };
    }

    return overrides;
}

function buildNormalizedPromptsDoc(source = null, settings = null) {
    const normalized = {
        version: SUMMARY_PROMPTS_VERSION,
        overrides: buildInitialOverrides(settings),
    };

    const sourceOverrides = source?.overrides && typeof source.overrides === 'object'
        ? source.overrides
        : {};

    for (const [key, value] of Object.entries(sourceOverrides)) {
        if (!key || typeof key !== 'string') continue;
        if (!value || typeof value !== 'object') continue;

        const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
        if (!prompt) continue;

        normalized.overrides[key] = {
            ...value,
            displayName: typeof value.displayName === 'string' && value.displayName.trim()
                ? value.displayName.trim()
                : getDefaultDisplayName(key),
            prompt,
        };
    }

    return normalized;
}

function isMissingBuiltInPromptOverride(doc) {
    const overrides = doc?.overrides && typeof doc.overrides === 'object'
        ? doc.overrides
        : {};

    return Object.keys(STMB_DEFAULT_PROMPTS || {}).some(key => {
        const prompt = overrides[key]?.prompt;
        return typeof prompt !== 'string' || !prompt.trim();
    });
}

async function saveDoc(doc) {
    const normalizedDoc = buildNormalizedPromptsDoc(doc);
    const json = JSON.stringify(normalizedDoc, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        credentials: 'include',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            name: SUMMARY_PROMPTS_FILE,
            data: base64,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to save prompts: ${response.status} ${response.statusText}`);
    }

    cachedDoc = normalizedDoc;
}

async function loadDoc(settings = null) {
    if (cachedDoc) {
        return cachedDoc;
    }

    let data = null;
    let shouldSave = false;
    try {
        const response = await fetch(`/user/files/${SUMMARY_PROMPTS_FILE}`, {
            method: 'GET',
            credentials: 'include',
            headers: getRequestHeaders(),
        });

        if (response.status === 404) {
            data = buildNormalizedPromptsDoc(null, settings);
            shouldSave = true;
        } else if (!response.ok) {
            throw new Error(`Failed to load prompts: ${response.status} ${response.statusText}`);
        } else {
            const text = await response.text();
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (error) {
                console.warn(`Invalid JSON in ${SUMMARY_PROMPTS_FILE}; recreating built-in summary prompts.`, error);
            }
            if (!validatePromptsFile(parsed)) {
                console.warn(`Invalid ${SUMMARY_PROMPTS_FILE} structure; recreating built-in summary prompts.`);
                data = buildNormalizedPromptsDoc(parsed, settings);
                shouldSave = true;
            } else {
                data = parsed;
                if (isMissingBuiltInPromptOverride(data)) {
                    data = buildNormalizedPromptsDoc(data, settings);
                    shouldSave = true;
                }
            }
        }
    } catch (error) {
        throw error;
    }

    if (shouldSave) {
        await saveDoc(data);
    }

    cachedDoc = data;
    return cachedDoc;
}

export async function firstRunInitSummaryPromptPresets(settings = null) {
    await loadDoc(settings);
    return true;
}

export function getCachedSummaryPromptText(key, fallbackSettings = null) {
    const normalizedKey = String(key || 'summary').trim() || 'summary';
    const cachedPrompt = cachedDoc?.overrides?.[normalizedKey]?.prompt;
    if (typeof cachedPrompt === 'string' && cachedPrompt.trim()) {
        return cachedPrompt;
    }

    const fallbackPrompt = fallbackSettings?.promptPresets?.[normalizedKey];
    if (typeof fallbackPrompt === 'string' && fallbackPrompt.trim()) {
        return fallbackPrompt;
    }

    return STMB_DEFAULT_PROMPTS[normalizedKey] || STMB_DEFAULT_PROMPTS.summary;
}

export function getRequiredSummaryPromptText(key, fallbackSettings = null) {
    const normalizedKey = String(key || 'summary').trim() || 'summary';
    const cachedPrompt = cachedDoc?.overrides?.[normalizedKey]?.prompt;
    if (typeof cachedPrompt === 'string' && cachedPrompt.trim()) {
        return cachedPrompt;
    }

    const fallbackPrompt = fallbackSettings?.promptPresets?.[normalizedKey];
    if (typeof fallbackPrompt === 'string' && fallbackPrompt.trim()) {
        return fallbackPrompt;
    }

    throw createMissingSummaryPromptError(normalizedKey);
}

export function getCachedSummaryPromptDisplayName(key, fallbackSettings = null) {
    const normalizedKey = String(key || '').trim();
    const cachedDisplayName = cachedDoc?.overrides?.[normalizedKey]?.displayName;
    if (typeof cachedDisplayName === 'string' && cachedDisplayName.trim()) {
        return cachedDisplayName.trim();
    }

    const fallbackDisplayName = fallbackSettings?.promptPresetMetadata?.[normalizedKey]?.displayName;
    if (typeof fallbackDisplayName === 'string' && fallbackDisplayName.trim()) {
        return fallbackDisplayName.trim();
    }

    return getDefaultDisplayName(normalizedKey);
}

export function listCachedSummaryPromptPresets(fallbackSettings = null) {
    const overrides = cachedDoc?.overrides && typeof cachedDoc.overrides === 'object'
        ? cachedDoc.overrides
        : (fallbackSettings?.promptPresets && typeof fallbackSettings.promptPresets === 'object'
            ? Object.fromEntries(Object.entries(fallbackSettings.promptPresets).map(([key, prompt]) => [key, {
                prompt,
                displayName: fallbackSettings?.promptPresetMetadata?.[key]?.displayName || getDefaultDisplayName(key),
                createdAt: fallbackSettings?.promptPresetMetadata?.[key]?.createdAt || null,
            }]))
            : {});

    const items = [];
    for (const [key, value] of Object.entries(overrides)) {
        items.push({
            key,
            displayName: typeof value?.displayName === 'string' && value.displayName.trim()
                ? value.displayName.trim()
                : getDefaultDisplayName(key),
            createdAt: typeof value?.createdAt === 'string' ? value.createdAt : null,
            isBuiltIn: Object.prototype.hasOwnProperty.call(STMB_DEFAULT_PROMPTS, key),
            hasOverride: true,
        });
    }

    for (const key of Object.keys(STMB_DEFAULT_PROMPTS || {})) {
        if (items.some(item => item.key === key)) continue;
        items.push({
            key,
            displayName: getDefaultDisplayName(key),
            createdAt: null,
            isBuiltIn: true,
            hasOverride: false,
        });
    }

    items.sort((left, right) => {
        if (!left.createdAt) return 1;
        if (!right.createdAt) return -1;
        return new Date(right.createdAt) - new Date(left.createdAt);
    });

    return items;
}

export async function upsertSummaryPromptPresetFile(key, prompt, displayName = null) {
    const trimmedPrompt = String(prompt || '').trim();
    if (!trimmedPrompt) {
        throw new Error('Prompt cannot be empty');
    }

    const data = await loadDoc();
    const timestamp = new Date().toISOString();
    let nextKey = String(key || '').trim();
    if (!nextKey) {
        nextKey = generateUniqueKey(displayName || 'Custom Prompt', data.overrides);
    }

    const existing = data.overrides[nextKey];
    data.overrides[nextKey] = {
        displayName: String(displayName || existing?.displayName || getDefaultDisplayName(nextKey)).trim() || getDefaultDisplayName(nextKey),
        prompt: trimmedPrompt,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
    };

    await saveDoc(data);
    return nextKey;
}

export async function duplicateSummaryPromptPresetFile(sourceKey) {
    const data = await loadDoc();
    const normalizedKey = String(sourceKey || '').trim();
    const sourcePrompt = data.overrides[normalizedKey]?.prompt || STMB_DEFAULT_PROMPTS[normalizedKey];
    if (typeof sourcePrompt !== 'string' || !sourcePrompt.trim()) {
        throw new Error(`Preset "${normalizedKey}" not found`);
    }

    const displayName = `${getCachedSummaryPromptDisplayName(normalizedKey)} (Copy)`;
    return upsertSummaryPromptPresetFile(null, sourcePrompt, displayName);
}

export async function removeSummaryPromptPresetFile(key) {
    const data = await loadDoc();
    const normalizedKey = String(key || '').trim();
    if (!Object.prototype.hasOwnProperty.call(data.overrides, normalizedKey)) {
        throw new Error(`Preset "${normalizedKey}" not found`);
    }
    delete data.overrides[normalizedKey];
    await saveDoc(data);
}

export async function exportSummaryPromptPresetsJsonFile() {
    const data = await loadDoc();
    return JSON.stringify(data, null, 2);
}

export async function importSummaryPromptPresetsJsonFile(text) {
    const parsed = JSON.parse(String(text || '{}'));
    if (!validatePromptsFile(parsed)) {
        throw new Error('Invalid prompts file structure');
    }
    await saveDoc(parsed);
}

export async function recreateBuiltInSummaryPromptOverridesFile() {
    const data = await loadDoc();
    const timestamp = new Date().toISOString();
    let replaced = 0;
    for (const [key, prompt] of Object.entries(STMB_DEFAULT_PROMPTS || {})) {
        data.overrides[key] = {
            displayName: getDefaultDisplayName(key),
            prompt: String(prompt || ''),
            createdAt: data.overrides?.[key]?.createdAt || timestamp,
            updatedAt: timestamp,
        };
        replaced++;
    }
    await saveDoc(data);
    return { replaced };
}

export function clearSummaryPromptPresetCache() {
    cachedDoc = null;
}
