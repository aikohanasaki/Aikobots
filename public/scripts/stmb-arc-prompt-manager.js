import { getRequestHeaders } from '../script.js';
import {
    CONSOLIDATION_REGENERATION_PRESET_KEY,
    STMB_DEFAULT_SUMMARY_PROMPTS,
} from './stmb-summary.js';

const ARC_PROMPTS_FILE = 'stmb-arc-prompts.json';
const ARC_PROMPTS_VERSION = 1;

const ARC_PROMPT_DISPLAY_NAMES = Object.freeze({
    arc_default: 'Multi-Consolidation Analysis',
    arc_alternate: 'Single Consolidation Analysis',
    [CONSOLIDATION_REGENERATION_PRESET_KEY]: 'Regenerate Consolidation',
    arc_tiny: 'Compact Consolidation Analysis',
});

let cachedDoc = null;

/** Returns whether a preset is reserved for entry regeneration. */
export function isRegenerationOnlyPreset(key) {
    return String(key || '').trim() === CONSOLIDATION_REGENERATION_PRESET_KEY;
}

/** Selects a usable ordinary-consolidation default, never the regeneration preset. */
export function selectConsolidationDefaultPresetKey(configuredKey, presets = []) {
    const normalizedKey = String(configuredKey || '').trim();
    const keys = (Array.isArray(presets) ? presets : [])
        .map(preset => String(preset?.key || preset || '').trim())
        .filter(Boolean);
    if (normalizedKey && !isRegenerationOnlyPreset(normalizedKey) && keys.includes(normalizedKey)) {
        return normalizedKey;
    }
    return keys.find(key => key === 'arc_default')
        || keys.find(key => !isRegenerationOnlyPreset(key))
        || 'arc_default';
}

function createMissingArcPromptError(key) {
    const normalizedKey = String(key || 'arc_default').trim() || 'arc_default';
    const message = `STMB arc prompt with key '${normalizedKey}' is missing from ${ARC_PROMPTS_FILE}`;
    const error = new Error(message);
    error.code = 'STMB_ARC_PROMPT_MISSING';
    error.promptKey = normalizedKey;
    error.expectedSource = ARC_PROMPTS_FILE;
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
        .slice(0, 50) || 'arc-prompt';
}

function generateDisplayNameFromContent(prompt) {
    const lines = String(prompt || '').split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return 'Consolidation Prompt';
    }

    return toTitleCase(
        lines[0]
            .replace(/^(You are|Analyze|Create|Generate|Write)\s+/i, '')
            .replace(/[:.]/g, '')
            .trim()
            .slice(0, 50),
    ) || 'Consolidation Prompt';
}

function getDefaultDisplayName(key, prompt = '') {
    const normalizedKey = String(key || '').trim();
    return ARC_PROMPT_DISPLAY_NAMES[normalizedKey]
        || toTitleCase(normalizedKey.replace(/^arc[_-]?/i, '').replace(/[-_]+/g, ' '))
        || generateDisplayNameFromContent(prompt)
        || 'Consolidation Prompt';
}

function validatePromptsFile(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.version !== 'number') return false;
    if (!data.overrides || typeof data.overrides !== 'object') return false;

    for (const [key, value] of Object.entries(data.overrides)) {
        if (!key || typeof key !== 'string') return false;
        if (!value || typeof value !== 'object') return false;
        if (typeof value.prompt !== 'string' || !value.prompt.trim()) return false;
        if (value.displayName !== undefined && typeof value.displayName !== 'string') return false;
    }

    return true;
}

function generateUniqueKey(baseName, overrides) {
    const baseSlug = safeSlug(baseName);
    const existing = overrides && typeof overrides === 'object' ? overrides : {};
    let key = baseSlug;
    let counter = 2;
    while (Object.prototype.hasOwnProperty.call(existing, key) || Object.prototype.hasOwnProperty.call(STMB_DEFAULT_SUMMARY_PROMPTS, key)) {
        key = `${baseSlug}-${counter}`;
        counter++;
    }
    return key;
}

function buildInitialOverrides(settings = null) {
    const overrides = {};
    const timestamp = new Date().toISOString();

    for (const [key, prompt] of Object.entries(STMB_DEFAULT_SUMMARY_PROMPTS || {})) {
        overrides[key] = {
            displayName: getDefaultDisplayName(key, prompt),
            prompt: String(prompt || ''),
            createdAt: timestamp,
        };
    }

    const legacyPromptPresets = settings?.arcPromptPresets && typeof settings.arcPromptPresets === 'object'
        ? settings.arcPromptPresets
        : {};
    const legacyPromptMetadata = settings?.arcPromptPresetMetadata && typeof settings.arcPromptPresetMetadata === 'object'
        ? settings.arcPromptPresetMetadata
        : {};

    for (const [key, prompt] of Object.entries(legacyPromptPresets)) {
        if (typeof prompt !== 'string' || !prompt.trim()) continue;
        overrides[key] = {
            displayName: typeof legacyPromptMetadata[key]?.displayName === 'string' && legacyPromptMetadata[key].displayName.trim()
                ? legacyPromptMetadata[key].displayName.trim()
                : getDefaultDisplayName(key, prompt),
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

async function saveDoc(doc) {
    const json = JSON.stringify(doc, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        credentials: 'include',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            name: ARC_PROMPTS_FILE,
            data: base64,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to save consolidation prompts: ${response.status} ${response.statusText}`);
    }

    cachedDoc = doc;
}

async function loadDoc(settings = null) {
    if (cachedDoc) {
        return cachedDoc;
    }

    let data = null;
    let shouldCreate = false;
    try {
        const response = await fetch(`/user/files/${ARC_PROMPTS_FILE}`, {
            method: 'GET',
            credentials: 'include',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            if (response.status === 404) {
                shouldCreate = true;
            } else {
                throw new Error(`Failed to load consolidation prompts: ${response.status} ${response.statusText}`);
            }
        } else {
            const parsed = JSON.parse(await response.text());
            if (!validatePromptsFile(parsed)) {
                throw new Error('Invalid consolidation prompts file structure.');
            }
            data = parsed;
        }
    } catch (error) {
        if (!shouldCreate) {
            throw error;
        }
    }

    if (shouldCreate) {
        data = {
            version: ARC_PROMPTS_VERSION,
            overrides: buildInitialOverrides(settings),
        };
        await saveDoc(data);
    }

    cachedDoc = data;
    return cachedDoc;
}

export async function firstRunInitArcPromptPresets(settings = null) {
    await loadDoc(settings);
    return true;
}

export function getCachedArcPromptText(key, fallbackSettings = null) {
    const normalizedKey = String(key || 'arc_default').trim() || 'arc_default';
    const cachedPrompt = cachedDoc?.overrides?.[normalizedKey]?.prompt;
    if (typeof cachedPrompt === 'string' && cachedPrompt.trim()) {
        return cachedPrompt;
    }

    const fallbackPrompt = fallbackSettings?.arcPromptPresets?.[normalizedKey];
    if (typeof fallbackPrompt === 'string' && fallbackPrompt.trim()) {
        return fallbackPrompt;
    }

    return STMB_DEFAULT_SUMMARY_PROMPTS[normalizedKey] || STMB_DEFAULT_SUMMARY_PROMPTS.arc_default;
}

export function getRequiredArcPromptText(key) {
    const normalizedKey = String(key || 'arc_default').trim() || 'arc_default';
    const cachedPrompt = cachedDoc?.overrides?.[normalizedKey]?.prompt;
    if (typeof cachedPrompt === 'string' && cachedPrompt.trim()) {
        return cachedPrompt;
    }

    throw createMissingArcPromptError(normalizedKey);
}

export function getCachedArcPromptDisplayName(key, fallbackSettings = null) {
    const normalizedKey = String(key || '').trim();
    const cachedDisplayName = cachedDoc?.overrides?.[normalizedKey]?.displayName;
    if (typeof cachedDisplayName === 'string' && cachedDisplayName.trim()) {
        return cachedDisplayName.trim();
    }

    const fallbackDisplayName = fallbackSettings?.arcPromptPresetMetadata?.[normalizedKey]?.displayName;
    if (typeof fallbackDisplayName === 'string' && fallbackDisplayName.trim()) {
        return fallbackDisplayName.trim();
    }

    return getDefaultDisplayName(normalizedKey, getCachedArcPromptText(normalizedKey, fallbackSettings));
}

export function listCachedArcPromptPresets(fallbackSettings = null) {
    const overrides = cachedDoc?.overrides && typeof cachedDoc.overrides === 'object'
        ? cachedDoc.overrides
        : (fallbackSettings?.arcPromptPresets && typeof fallbackSettings.arcPromptPresets === 'object'
            ? Object.fromEntries(Object.entries(fallbackSettings.arcPromptPresets).map(([key, prompt]) => [key, {
                prompt,
                displayName: fallbackSettings?.arcPromptPresetMetadata?.[key]?.displayName || getDefaultDisplayName(key, prompt),
                createdAt: fallbackSettings?.arcPromptPresetMetadata?.[key]?.createdAt || null,
            }]))
            : {});

    const items = [];
    for (const [key, value] of Object.entries(overrides)) {
        items.push({
            key,
            displayName: typeof value?.displayName === 'string' && value.displayName.trim()
                ? value.displayName.trim()
                : getDefaultDisplayName(key, value?.prompt),
            createdAt: typeof value?.createdAt === 'string' ? value.createdAt : null,
            isBuiltIn: Object.prototype.hasOwnProperty.call(STMB_DEFAULT_SUMMARY_PROMPTS, key),
            hasOverride: true,
            regenerationOnly: isRegenerationOnlyPreset(key),
        });
    }

    for (const [key, prompt] of Object.entries(STMB_DEFAULT_SUMMARY_PROMPTS || {})) {
        if (items.some(item => item.key === key)) continue;
        items.push({
            key,
            displayName: getDefaultDisplayName(key, prompt),
            createdAt: null,
            isBuiltIn: true,
            hasOverride: false,
            regenerationOnly: isRegenerationOnlyPreset(key),
        });
    }

    items.sort((left, right) => {
        if (!left.createdAt && !right.createdAt) {
            return left.displayName.localeCompare(right.displayName);
        }
        if (!left.createdAt) return 1;
        if (!right.createdAt) return -1;
        return new Date(right.createdAt) - new Date(left.createdAt);
    });

    return items;
}

export async function upsertArcPromptPresetFile(key, prompt, displayName = null) {
    const trimmedPrompt = String(prompt || '').trim();
    if (!trimmedPrompt) {
        throw new Error('Prompt cannot be empty');
    }

    const doc = structuredClone(await loadDoc());
    const normalizedKey = typeof key === 'string' && key.trim() ? key.trim() : null;
    const actualKey = normalizedKey || generateUniqueKey(displayName || generateDisplayNameFromContent(trimmedPrompt), doc.overrides);
    const timestamp = new Date().toISOString();
    const existing = doc.overrides[actualKey];

    doc.overrides[actualKey] = {
        displayName: String(displayName || existing?.displayName || generateDisplayNameFromContent(trimmedPrompt)).trim() || generateDisplayNameFromContent(trimmedPrompt),
        prompt: trimmedPrompt,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
    };

    await saveDoc(doc);
    return actualKey;
}

export async function duplicateArcPromptPresetFile(key) {
    const normalizedKey = String(key || '').trim();
    if (isRegenerationOnlyPreset(normalizedKey)) {
        throw new Error('The regeneration-only consolidation prompt cannot be duplicated.');
    }
    const sourcePrompt = getCachedArcPromptText(normalizedKey);
    if (!sourcePrompt) {
        throw new Error(`Consolidation prompt "${normalizedKey}" not found`);
    }

    const displayName = `${getCachedArcPromptDisplayName(normalizedKey)} (Copy)`;
    return await upsertArcPromptPresetFile(null, sourcePrompt, displayName);
}

export async function removeArcPromptPresetFile(key) {
    const normalizedKey = String(key || '').trim();
    const doc = structuredClone(await loadDoc());
    if (!Object.prototype.hasOwnProperty.call(doc.overrides, normalizedKey)) {
        throw new Error(`Consolidation prompt "${normalizedKey}" not found`);
    }
    delete doc.overrides[normalizedKey];
    await saveDoc(doc);
}

export async function exportArcPromptPresetsJsonFile() {
    return JSON.stringify(await loadDoc(), null, 2);
}

export async function importArcPromptPresetsJsonFile(text) {
    const parsed = JSON.parse(String(text || ''));
    if (!validatePromptsFile(parsed)) {
        throw new Error('Invalid consolidation prompts file structure.');
    }
    await saveDoc(structuredClone(parsed));
}

export async function recreateBuiltInArcPromptOverridesFile() {
    const doc = structuredClone(await loadDoc());
    const timestamp = new Date().toISOString();
    let replaced = 0;
    for (const [key, prompt] of Object.entries(STMB_DEFAULT_SUMMARY_PROMPTS || {})) {
        doc.overrides[key] = {
            displayName: getDefaultDisplayName(key, prompt),
            prompt: String(prompt || ''),
            createdAt: doc.overrides?.[key]?.createdAt || timestamp,
            updatedAt: timestamp,
        };
        replaced++;
    }
    await saveDoc(doc);
    return { replaced };
}
