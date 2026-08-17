import { getRequestHeaders } from '../script.js';
import { getCurrentLocale, translate } from './i18n.js';
import {
    applySidePromptMacros,
    collectTemplateRuntimeMacros,
    hasTemplateRuntimeMacros,
    isValidMacroToken,
} from './stmb-sideprompt-macros.js';
import { syncStmbLocalizedPromptFields } from './stmb-prompt-default-migration.js';
import {
    CLIP_REVIEW_TEMPLATE_KEY,
    DEFAULT_CLIP_REVIEW_PROMPT,
    DEFAULT_CLIP_SUGGESTIONS_PROMPT,
} from './stmb-clip-review-policy.js';

const BUILTIN_CAST_KEY = 'cast';
const LEGACY_BUILTIN_CAST_KEY = 'cast-of-characters';
let cachedDoc = null;
let cachedRevision = 'missing';
let loadPromise = null;
let cacheGeneration = 0;

function nowIso() {
    return new Date().toISOString();
}

function safeSlug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50) || 'sideprompt';
}

function makeSetItemId() {
    return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSetItem(item) {
    const rawId = String(item?.id || '').trim();
    const runtimeMacros = {};
    if (item?.runtimeMacros && typeof item.runtimeMacros === 'object' && !Array.isArray(item.runtimeMacros)) {
        for (const [token, value] of Object.entries(item.runtimeMacros)) {
            if (isValidMacroToken(token)) {
                runtimeMacros[token] = String(value ?? '');
            }
        }
    }

    return {
        id: rawId && !rawId.startsWith('draft-') ? rawId : makeSetItemId(),
        promptKey: String(item?.promptKey || '').trim(),
        label: String(item?.label || '').trim(),
        runtimeMacros,
    };
}

function normalizeSet(raw, key, timestamp = nowIso()) {
    return {
        key,
        name: String(raw?.name || '').trim() || 'Untitled Side Prompt Set',
        items: Array.isArray(raw?.items)
            ? raw.items.map(normalizeSetItem).filter(item => item.promptKey)
            : [],
        createdAt: String(raw?.createdAt || timestamp),
        updatedAt: String(raw?.updatedAt || timestamp),
        ...(raw?.recommendedSetup && typeof raw.recommendedSetup === 'object'
            ? { recommendedSetup: structuredClone(raw.recommendedSetup) }
            : {}),
    };
}

function normalizeSidePromptsDocument(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }

    if (!data.sets || typeof data.sets !== 'object' || Array.isArray(data.sets)) {
        data.sets = {};
    }

    const normalizedSets = {};
    for (const [key, set] of Object.entries(data.sets || {})) {
        const finalKey = String(set?.key || key || '').trim();
        if (!finalKey) continue;
        normalizedSets[finalKey] = normalizeSet(set, finalKey, set?.updatedAt || nowIso());
    }
    data.sets = normalizedSets;
    const builtin = getBuiltinTemplates()[CLIP_REVIEW_TEMPLATE_KEY];
    const existing = data.prompts?.[CLIP_REVIEW_TEMPLATE_KEY];
    if (data.prompts && !existing) {
        data.prompts[CLIP_REVIEW_TEMPLATE_KEY] = builtin;
    } else if (existing) {
        data.prompts[CLIP_REVIEW_TEMPLATE_KEY] = {
            ...existing,
            key: CLIP_REVIEW_TEMPLATE_KEY,
            name: 'Memory Assistance',
            enabled: false,
            specialKind: 'clipReview',
            settings: {
                ...(existing.settings || {}),
                suggestionsPrompt: String(existing.settings?.suggestionsPrompt || '').trim()
                    || builtin.settings.suggestionsPrompt,
            },
            triggers: {},
        };
    }
    for (const set of Object.values(data.sets)) {
        set.items = set.items.filter(item => item.promptKey !== CLIP_REVIEW_TEMPLATE_KEY);
    }
    return data;
}

function normalizeTemplateTriggers(template) {
    const hadExplicitTriggers = template.triggers && typeof template.triggers === 'object';
    template.triggers = hadExplicitTriggers
        ? { ...template.triggers }
        : { commands: ['sideprompt'] };
    const strippedAutoTriggers = [];

    if (template.triggers.onInterval) {
        const visibleMessages = Math.max(1, Number(template.triggers.onInterval.visibleMessages ?? 50));
        template.triggers.onInterval = { visibleMessages };
    }
    if (template.triggers.onAfterMemory) {
        template.triggers.onAfterMemory = { enabled: Boolean(template.triggers.onAfterMemory.enabled) };
    }
    if ('commands' in template.triggers) {
        if (Array.isArray(template.triggers.commands)) {
            template.triggers.commands = template.triggers.commands
                .filter(command => typeof command === 'string' && command.trim())
                .map(command => String(command).trim());
        } else {
            template.triggers.commands = [];
        }
    } else if (!hadExplicitTriggers) {
        template.triggers.commands = ['sideprompt'];
    }

    if (hasTemplateRuntimeMacros(template)) {
        if (template.triggers.onInterval) strippedAutoTriggers.push('onInterval');
        if (template.triggers.onAfterMemory) strippedAutoTriggers.push('onAfterMemory');
        delete template.triggers.onInterval;
        delete template.triggers.onAfterMemory;
        if (!template.triggers.commands.some(command => command.toLowerCase() === 'sideprompt')) {
            template.triggers.commands.push('sideprompt');
        }
    }

    return { strippedAutoTriggers };
}

function validateSidePromptsFileV2(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.version !== 'number') return false;
    if (!data.prompts || typeof data.prompts !== 'object') return false;

    for (const [key, prompt] of Object.entries(data.prompts)) {
        if (!prompt || typeof prompt !== 'object') return false;
        if (prompt.key !== key) return false;
        if (typeof prompt.name !== 'string' || !prompt.name.trim()) return false;
        if (typeof prompt.enabled !== 'boolean') return false;
        if (typeof prompt.prompt !== 'string') return false;
        if (!prompt.settings || typeof prompt.settings !== 'object') return false;
        if (prompt.specialKind != null && typeof prompt.specialKind !== 'string') return false;
        if (!prompt.triggers || typeof prompt.triggers !== 'object') return false;
        if (prompt.triggers.onInterval != null) {
            const visibleMessages = Number(prompt.triggers.onInterval.visibleMessages);
            if (!Number.isFinite(visibleMessages) || visibleMessages < 1) return false;
        }
        if (prompt.triggers.onAfterMemory != null && typeof prompt.triggers.onAfterMemory.enabled !== 'boolean') {
            return false;
        }
        if (prompt.triggers.commands != null) {
            if (!Array.isArray(prompt.triggers.commands)) return false;
            if (prompt.triggers.commands.some(command => typeof command !== 'string' || !command.trim())) return false;
        }
    }

    if (data.sets != null) {
        if (typeof data.sets !== 'object' || Array.isArray(data.sets)) return false;
        for (const [key, set] of Object.entries(data.sets)) {
            if (!set || typeof set !== 'object') return false;
            if (set.key !== key) return false;
            if (typeof set.name !== 'string' || !set.name.trim()) return false;
            if (!Array.isArray(set.items)) return false;
            for (const item of set.items) {
                if (!item || typeof item !== 'object') return false;
                if (typeof item.id !== 'string' || !item.id.trim()) return false;
                if (typeof item.promptKey !== 'string' || !item.promptKey.trim()) return false;
                if (item.label != null && typeof item.label !== 'string') return false;
                if (item.runtimeMacros != null) {
                    if (typeof item.runtimeMacros !== 'object' || Array.isArray(item.runtimeMacros)) return false;
                    for (const [token, value] of Object.entries(item.runtimeMacros)) {
                        if (!isValidMacroToken(token)) return false;
                        if (typeof value !== 'string') return false;
                    }
                }
            }
        }
    }

    return true;
}

function looksLikeV1SidePrompts(data) {
    if (!data || typeof data !== 'object' || !data.prompts || typeof data.prompts !== 'object') {
        return false;
    }
    return Object.values(data.prompts).some(prompt => prompt && typeof prompt === 'object' && 'type' in prompt && !('triggers' in prompt));
}

function migrateV1toV2(data) {
    const migrated = {
        version: 2,
        prompts: {},
        sets: {},
    };
    const createdAt = nowIso();

    for (const [key, prompt] of Object.entries(data.prompts || {})) {
        const type = String(prompt?.type || '').toLowerCase();
        const next = {
            key,
            name: String(prompt?.name || 'Untitled Side Prompt'),
            enabled: Boolean(prompt?.enabled),
            prompt: String(prompt?.prompt ?? ''),
            responseFormat: String(prompt?.responseFormat ?? ''),
            settings: { ...(prompt?.settings || {}) },
            triggers: { commands: ['sideprompt'] },
            createdAt: String(prompt?.createdAt || createdAt),
            updatedAt: createdAt,
        };

        if (type === 'tracker') {
            const visibleMessages = Math.max(1, Number(prompt?.settings?.intervalVisibleMessages ?? 50));
            next.triggers.onInterval = { visibleMessages };
        } else if (type === 'plotpoints') {
            next.triggers.onAfterMemory = { enabled: true };
        } else if (type === 'scoreboard' && prompt?.settings?.withMemories) {
            next.triggers.onAfterMemory = { enabled: true };
        }

        normalizeTemplateTriggers(next);
        migrated.prompts[key] = next;
    }

    return migrated;
}

function getBuiltinTemplates(localized = true) {
    const createdAt = nowIso();
    const prompts = {};
    const localize = (text, key) => localized ? translate(text, key) : text;

    const define = (name, prompt, responseFormat, settings, triggers, keyOverride = null) => {
        const key = String(keyOverride || safeSlug(name)).trim() || safeSlug(name);
        prompts[key] = {
            key,
            name,
            enabled: false,
            prompt,
            responseFormat,
            settings,
            triggers,
            createdAt,
            updatedAt: createdAt,
        };
    };

    define(
        'Plotpoints',
        localize('Analyze the accompanying scene for plot threads, story arcs, and other narrative movements. The previous scenes are there to provide context. Generate a story thread report. If a report already exists in context, update it instead of recreating.', 'STMemoryBooks_PlotpointsPrompt'),
        localize('=== Plot Points ===\n(as of [point in the story when this analysis was done])\n\n[Overarching Plot Arc]\n(2-3 sentence summary of the superobjective or major plot)\n\n[Thread #1 Title]\n- Summary: (1 sentence)\n- Status: (active / on hold)\n- At Stake: (how resolution will affect the ongoing story)\n- Last Known: (location or time)\n- Key Characters: ...\n\n\n[Thread #2 Title]\n- Summary: (1 sentence)\n- Status: (active / on hold)\n- At Stake: (how resolution will affect the ongoing story)\n- Last Known: (location or time)\n- Key Characters: ...\n\n...\n\n-- Plot Hooks --\n- (new or potential plot hooks)\n\n-- Character Dynamics --\n- current status of {{user}}\'s/{{char}}\'s relationships with NPCs\n\n===End Plot Points===\n', 'STMemoryBooks_PlotpointsResponseFormat'),
        {
            overrideProfileEnabled: false,
            lorebook: {
                constVectMode: 'blue',
                position: 2,
                orderMode: 'manual',
                orderValue: 25,
                preventRecursion: true,
                delayUntilRecursion: false,
                ignoreBudget: false,
            },
        },
        { onAfterMemory: { enabled: true }, commands: ['sideprompt'] },
    );

    define(
        'Status',
        localize('Analyze all context (previous scenes, memories, lore, history, interactions) to generate a detailed analysis of {{user}} and {{char}} (including abbreviated !lovefactor and !lustfactor commands). Note: If there is a pre-existing !status report, update it, do not regurgitate it.', 'STMemoryBooks_StatusPrompt'),
        localize('Follow this general format:\n\n## Witty Headline or Summary\n\n### AFFINITY (0-100, have some relationship with !lovefactor and !lustfactor)\n- Score with evidence\n- Recent changes \n- Supporting quotes\n- Anything else that might be illustrative of the current affinity\n\n### LOVEFACTOR and LUSTFACTOR\n(!lovefactor and !lustfactor reports go here)\n\n### RELATIONSHIP STATUS (negative = enemies, 0 = strangers, 100 = life partners)\n- Trust/boundaries/communication\n- Key events\n- Issues\n- Any other pertinent points\n\n### GOALS\n- Short/long-term objectives\n- Progress/obstacles\n- Growth areas\n- Any other pertinent points\n\n### ANALYSIS\n- Psychology/POV\n- Development/triggers\n- Story suggestions\n- Any other pertinent points\n\n### WRAP-UP\n- OOC Summary (1 paragraph)', 'STMemoryBooks_StatusResponseFormat'),
        {
            overrideProfileEnabled: false,
            lorebook: {
                constVectMode: 'link',
                position: 3,
                orderMode: 'manual',
                orderValue: 25,
                preventRecursion: true,
                delayUntilRecursion: false,
                ignoreBudget: false,
            },
        },
        { onAfterMemory: { enabled: true }, commands: ['sideprompt'] },
    );

    define(
        'Cast of Characters',
        localize('You are a skilled reporter with a clear eye for judging the importance of NPCs to the plot. \nStep 1: Review the scene and either add or update plot-related NPCs to the NPC WHO\'S WHO report. Please note that {{char}} and {{user}} are major characters and do NOT need to be included in this report.\nStep 2: This list should be kept in order of importance to the plot, so it may need to be reordered.\nStep 3: If your response would be more than 2000 tokens long, remove NPCs with the least impact to the plot.', 'STMemoryBooks_CastOfCharactersPrompt'),
        localize('===NPC WHO\'S WHO===\n(In order of importance to the plot)\n\nPerson 1: 1-2 sentence desription\nPerson 2: 1-2 sentence desription\n===END NPC WHO\'S WHO===', 'STMemoryBooks_CastOfCharactersResponseFormat'),
        {
            overrideProfileEnabled: false,
            lorebook: {
                constVectMode: 'blue',
                position: 3,
                orderMode: 'manual',
                orderValue: 15,
                preventRecursion: true,
                delayUntilRecursion: false,
                ignoreBudget: false,
            },
        },
        { onAfterMemory: { enabled: true }, commands: ['sideprompt'] },
        BUILTIN_CAST_KEY,
    );

    define(
        'Assess',
        localize('Assess the interaction between {{char}} and {{user}} to date. List all the information {{char}} has learned about {{user}} through observation, questioning, or drawing conclusions from interaction (similar to a mental "note to self"). If there is already a list, update it. Try to keep it token-efficient and compact, focused on the important things.', 'STMemoryBooks_AssessPrompt'),
        localize('Use this format: \n=== Things {{char}} has learned about {{user}} ===\n(detailed list, in {{char}}\'s POV/tone of voice)\n===', 'STMemoryBooks_AssessResponseFormat'),
        {
            overrideProfileEnabled: false,
            lorebook: {
                constVectMode: 'blue',
                position: 2,
                orderMode: 'manual',
                orderValue: 30,
                preventRecursion: true,
                delayUntilRecursion: false,
                ignoreBudget: false,
            },
        },
        { onAfterMemory: { enabled: true }, commands: ['sideprompt'] },
    );

    prompts[CLIP_REVIEW_TEMPLATE_KEY] = {
        key: CLIP_REVIEW_TEMPLATE_KEY,
        name: 'Memory Assistance',
        enabled: false,
        specialKind: 'clipReview',
        prompt: localize(DEFAULT_CLIP_REVIEW_PROMPT, 'STMemoryBooks_ClipReview_DefaultPrompt'),
        responseFormat: '',
        settings: {
            overrideProfileEnabled: false,
            suggestionsPrompt: localize(DEFAULT_CLIP_SUGGESTIONS_PROMPT, 'STMemoryBooks_ClipSuggestions_DefaultPrompt'),
        },
        triggers: {},
        createdAt,
        updatedAt: createdAt,
    };

    return prompts;
}

function migrateBuiltinTemplateKeys(document) {
    const prompts = document?.prompts;
    if (!prompts || typeof prompts !== 'object') {
        return false;
    }

    let changed = false;
    if (!prompts[BUILTIN_CAST_KEY] && prompts[LEGACY_BUILTIN_CAST_KEY]) {
        prompts[BUILTIN_CAST_KEY] = {
            ...prompts[LEGACY_BUILTIN_CAST_KEY],
            key: BUILTIN_CAST_KEY,
        };
        delete prompts[LEGACY_BUILTIN_CAST_KEY];
        changed = true;
    }

    const sets = document?.sets;
    if (sets && typeof sets === 'object') {
        for (const set of Object.values(sets)) {
            if (!Array.isArray(set?.items)) continue;
            for (const item of set.items) {
                if (item?.promptKey === LEGACY_BUILTIN_CAST_KEY) {
                    item.promptKey = BUILTIN_CAST_KEY;
                    changed = true;
                }
            }
        }
    }

    return changed;
}

function createBaseDoc() {
    const document = {
        version: 2,
        prompts: getBuiltinTemplates(),
        sets: {},
    };
    syncBuiltinPromptLocale(document);
    return document;
}

function syncBuiltinPromptLocale(document) {
    const result = syncStmbLocalizedPromptFields(
        document?.prompts,
        getBuiltinTemplates(),
        getBuiltinTemplates(false),
        document?.builtinPromptState,
        getCurrentLocale(),
        ['prompt', 'responseFormat'],
    );
    document.builtinPromptState = result.state;
    const clipReview = document?.prompts?.[CLIP_REVIEW_TEMPLATE_KEY];
    if (!clipReview) return result.changed;
    const suggestionRecords = {
        [CLIP_REVIEW_TEMPLATE_KEY]: {
            suggestionsPrompt: String(clipReview.settings?.suggestionsPrompt || ''),
        },
    };
    const suggestionResult = syncStmbLocalizedPromptFields(
        suggestionRecords,
        { [CLIP_REVIEW_TEMPLATE_KEY]: { suggestionsPrompt: getBuiltinTemplates()[CLIP_REVIEW_TEMPLATE_KEY].settings.suggestionsPrompt } },
        { [CLIP_REVIEW_TEMPLATE_KEY]: { suggestionsPrompt: DEFAULT_CLIP_SUGGESTIONS_PROMPT } },
        document?.builtinSuggestionPromptState,
        getCurrentLocale(),
        ['suggestionsPrompt'],
    );
    clipReview.settings.suggestionsPrompt = suggestionRecords[CLIP_REVIEW_TEMPLATE_KEY].suggestionsPrompt;
    document.builtinSuggestionPromptState = suggestionResult.state;
    return result.changed || suggestionResult.changed;
}

async function saveDoc(document) {
    const response = await fetch('/api/stmb/side-prompts', {
        method: 'PUT',
        credentials: 'include',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            document,
            revision: cachedRevision,
        }),
    });

    if (!response.ok) {
        if (response.status === 409) {
            cachedDoc = null;
            cachedRevision = 'missing';
        }
        throw new Error(`Failed to save side prompts: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    cachedRevision = String(result?.revision || 'missing');
    cachedDoc = document;
}

async function loadSidePromptsUncached() {
    const response = await fetch('/api/stmb/side-prompts', {
        method: 'GET',
        credentials: 'include',
        headers: getRequestHeaders(),
    });

    let data = null;
    if (response.status === 404) {
        data = createBaseDoc();
        cachedRevision = 'missing';
        await saveDoc(data);
    } else if (!response.ok) {
        throw new Error(`Failed to load side prompts: ${response.status} ${response.statusText}`);
    } else {
        const payload = await response.json();
        const parsed = payload?.document;
        cachedRevision = String(payload?.revision || 'missing');

        if (looksLikeV1SidePrompts(parsed)) {
            data = normalizeSidePromptsDocument(migrateV1toV2(parsed));
            migrateBuiltinTemplateKeys(data);
            syncBuiltinPromptLocale(data);
            await saveDoc(data);
        } else if (!validateSidePromptsFileV2(parsed)) {
            throw new Error('Invalid side prompts file structure');
        } else {
            const beforeNormalize = JSON.stringify(parsed);
            const needsSetNormalization = !parsed.sets || typeof parsed.sets !== 'object' || Array.isArray(parsed.sets);
            data = normalizeSidePromptsDocument(parsed);
            const normalizedChanged = JSON.stringify(data) !== beforeNormalize;
            const keysMigrated = migrateBuiltinTemplateKeys(data);
            const localeMigrated = syncBuiltinPromptLocale(data);
            if (keysMigrated || needsSetNormalization || normalizedChanged || localeMigrated) {
                await saveDoc(data);
            }
        }
    }

    cachedDoc = data;
    return cachedDoc;
}

export async function loadSidePrompts() {
    if (cachedDoc) return cachedDoc;
    const generation = cacheGeneration;
    if (!loadPromise) {
        loadPromise = loadSidePromptsUncached().finally(() => {
            loadPromise = null;
        });
    }
    const document = await loadPromise;
    if (generation !== cacheGeneration) {
        cachedDoc = null;
        cachedRevision = 'missing';
        return await loadSidePrompts();
    }
    return document;
}

export async function firstRunInitSidePrompts() {
    await loadSidePrompts();
    return true;
}

export async function listTemplates() {
    const data = await loadSidePrompts();
    const templates = Object.values(data.prompts);
    templates.sort((left, right) => {
        const leftUpdated = left.updatedAt || left.createdAt || '';
        const rightUpdated = right.updatedAt || right.createdAt || '';
        return rightUpdated.localeCompare(leftUpdated);
    });
    return templates;
}

export function getCachedTemplateSnapshot() {
    const prompts = cachedDoc?.prompts;
    if (!prompts || typeof prompts !== 'object') {
        return [];
    }

    const templates = Object.values(prompts);
    templates.sort((left, right) => {
        const leftUpdated = left.updatedAt || left.createdAt || '';
        const rightUpdated = right.updatedAt || right.createdAt || '';
        return rightUpdated.localeCompare(leftUpdated);
    });
    return templates;
}

export function getCachedSetSnapshot() {
    const sets = cachedDoc?.sets;
    if (!sets || typeof sets !== 'object') {
        return [];
    }

    const list = Object.values(sets);
    list.sort((left, right) => {
        const leftUpdated = left.updatedAt || left.createdAt || '';
        const rightUpdated = right.updatedAt || right.createdAt || '';
        return rightUpdated.localeCompare(leftUpdated);
    });
    return list;
}

export async function getTemplate(key) {
    const data = await loadSidePrompts();
    return data.prompts?.[String(key || '')] || null;
}

export async function listSets() {
    const data = await loadSidePrompts();
    const sets = Object.values(data.sets || {});
    sets.sort((left, right) => {
        const leftUpdated = left.updatedAt || left.createdAt || '';
        const rightUpdated = right.updatedAt || right.createdAt || '';
        return rightUpdated.localeCompare(leftUpdated);
    });
    return sets;
}

export async function getSet(key) {
    const data = await loadSidePrompts();
    return data.sets?.[String(key || '')] || null;
}

export async function findSetByName(name) {
    const data = await loadSidePrompts();
    const raw = String(name || '').trim();
    if (!raw) return null;

    const targetLower = raw.toLowerCase();
    const targetSlug = safeSlug(raw);
    const sets = Object.values(data.sets || {});

    for (const set of sets) {
        const nameLower = String(set.name || '').toLowerCase();
        const keyLower = String(set.key || '').toLowerCase();
        const nameSlug = safeSlug(set.name || '');
        if (nameLower === targetLower || keyLower === targetLower || nameSlug === targetSlug) {
            return set;
        }
    }

    for (const set of sets) {
        const nameLower = String(set.name || '').toLowerCase();
        const keyLower = String(set.key || '').toLowerCase();
        const nameSlug = safeSlug(set.name || '');
        if (nameLower.startsWith(targetLower) || keyLower.startsWith(targetLower) || nameSlug.startsWith(targetSlug)) {
            return set;
        }
    }

    return null;
}

export async function findTemplateByName(name) {
    const data = await loadSidePrompts();
    const raw = String(name || '').trim();
    if (!raw) return null;

    const targetLower = raw.toLowerCase();
    const targetSlug = safeSlug(raw);
    const targetNormalized = targetLower.replace(/[^a-z0-9]+/g, ' ').trim();
    const templates = Object.values(data.prompts);

    for (const template of templates) {
        const nameLower = String(template.name || '').toLowerCase();
        const keyLower = String(template.key || '').toLowerCase();
        const nameSlug = safeSlug(template.name || '');
        if (nameLower === targetLower || keyLower === targetLower || nameSlug === targetSlug) {
            return template;
        }
    }
    for (const template of templates) {
        const nameLower = String(template.name || '').toLowerCase();
        const keyLower = String(template.key || '').toLowerCase();
        const nameSlug = safeSlug(template.name || '');
        if (nameLower.startsWith(targetLower) || keyLower.startsWith(targetLower) || nameSlug.startsWith(targetSlug)) {
            return template;
        }
    }
    for (const template of templates) {
        const nameLower = String(template.name || '').toLowerCase();
        const nameSlug = safeSlug(template.name || '');
        const nameNormalized = nameLower.replace(/[^a-z0-9]+/g, ' ').trim();
        if (nameLower.includes(targetLower) || nameSlug.includes(targetSlug) || (targetNormalized && nameNormalized.includes(targetNormalized))) {
            return template;
        }
    }

    return null;
}

export async function upsertTemplate(input) {
    const data = await loadSidePrompts();
    const isNew = !input.key;
    const timestamp = nowIso();
    const previous = isNew ? null : data.prompts[input.key];
    const requestedName = String(input.name ?? '').trim();
    const finalName = requestedName || (previous?.name || 'Untitled Side Prompt');

    let key;
    if (input.key) {
        key = input.key;
    } else {
        const base = safeSlug(finalName);
        key = base;
        let suffix = 2;
        while (data.prompts[key]) {
            key = safeSlug(`${finalName} ${suffix}`);
            suffix++;
        }
    }

    const isEnabledOnlyUpdate = Boolean(previous)
        && typeof input.enabled === 'boolean'
        && Object.keys(input).every(field => field === 'key' || field === 'enabled');
    const next = isEnabledOnlyUpdate
        ? { ...previous, enabled: input.enabled, updatedAt: timestamp }
        : {
            key,
            name: finalName,
            enabled: typeof input.enabled === 'boolean' ? input.enabled : (previous?.enabled ?? false),
            prompt: String(input.prompt ?? previous?.prompt ?? ''),
            responseFormat: String(input.responseFormat ?? previous?.responseFormat ?? ''),
            settings: { ...(previous?.settings || {}), ...(input.settings || {}) },
            triggers: input.triggers ? input.triggers : (previous?.triggers || { commands: ['sideprompt'] }),
            createdAt: previous?.createdAt || timestamp,
            updatedAt: timestamp,
            ...(previous?.recommendedSetup && typeof previous.recommendedSetup === 'object'
                ? { recommendedSetup: structuredClone(previous.recommendedSetup) }
                : {}),
            ...(input.specialKind || previous?.specialKind
                ? { specialKind: String(input.specialKind || previous.specialKind) }
                : {}),
        };

    if (!isEnabledOnlyUpdate) {
        normalizeTemplateTriggers(next);
    }
    if (key === CLIP_REVIEW_TEMPLATE_KEY) {
        next.name = 'Memory Assistance';
        next.specialKind = 'clipReview';
        next.enabled = false;
        next.triggers = {};
    }
    data.prompts[key] = next;
    try {
        await saveDoc(data);
    } catch (error) {
        if (previous) data.prompts[key] = previous;
        else delete data.prompts[key];
        throw error;
    }
    return key;
}

export async function duplicateTemplate(sourceKey) {
    const data = await loadSidePrompts();
    const source = data.prompts?.[String(sourceKey || '')];
    if (!source) {
        throw new Error(`Template "${sourceKey}" not found`);
    }
    if (String(sourceKey || '') === CLIP_REVIEW_TEMPLATE_KEY || source.specialKind === 'clipReview') {
        throw new Error(translate('Memory Assistance cannot be duplicated.', 'STMemoryBooks_ClipReview_CannotDuplicate'));
    }

    const copyName = `${source.name} (Copy)`;
    let key = safeSlug(copyName);
    let suffix = 2;
    while (data.prompts[key]) {
        key = safeSlug(`${copyName} ${suffix}`);
        suffix++;
    }

    const timestamp = nowIso();
    data.prompts[key] = {
        ...source,
        key,
        name: copyName,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    await saveDoc(data);
    return key;
}

export async function removeTemplate(key) {
    const data = await loadSidePrompts();
    const normalizedKey = String(key || '').trim();
    if (normalizedKey === CLIP_REVIEW_TEMPLATE_KEY) {
        throw new Error(translate('Memory Assistance cannot be deleted.', 'STMemoryBooks_ClipReview_CannotDelete'));
    }
    if (!data.prompts[normalizedKey]) {
        throw new Error(`Template "${normalizedKey}" not found`);
    }
    delete data.prompts[normalizedKey];
    await saveDoc(data);
}

export async function upsertSet(input) {
    const data = await loadSidePrompts();
    if (!data.sets || typeof data.sets !== 'object') {
        data.sets = {};
    }

    const isNew = !input.key;
    const timestamp = nowIso();
    const previous = isNew ? null : data.sets[input.key];
    const requestedName = String(input.name ?? '').trim();
    const finalName = requestedName || (previous?.name || 'Untitled Side Prompt Set');

    let key;
    if (input.key) {
        key = String(input.key).trim();
    } else {
        const base = safeSlug(finalName || 'sideprompt-set') || 'sideprompt-set';
        key = base;
        let suffix = 2;
        while (data.sets[key]) {
            key = safeSlug(`${finalName} ${suffix}`);
            suffix++;
        }
    }

    data.sets[key] = normalizeSet({
        key,
        name: finalName,
        items: (Array.isArray(input.items) ? input.items : (previous?.items || []))
            .filter(item => String(item?.promptKey || '') !== CLIP_REVIEW_TEMPLATE_KEY),
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp,
        recommendedSetup: previous?.recommendedSetup,
    }, key, timestamp);
    await saveDoc(data);
    return key;
}

export async function duplicateSet(sourceKey) {
    const data = await loadSidePrompts();
    const source = data.sets?.[String(sourceKey || '')];
    if (!source) {
        throw new Error(`Set "${sourceKey}" not found`);
    }

    const copyName = `${source.name} (Copy)`;
    let key = safeSlug(copyName) || 'sideprompt-set';
    let suffix = 2;
    while (data.sets[key]) {
        key = safeSlug(`${copyName} ${suffix}`);
        suffix++;
    }

    const timestamp = nowIso();
    data.sets[key] = normalizeSet({
        ...source,
        key,
        name: copyName,
        items: (source.items || []).map(item => ({ ...item, id: makeSetItemId() })),
        createdAt: timestamp,
        updatedAt: timestamp,
    }, key, timestamp);
    await saveDoc(data);
    return key;
}

export async function removeSet(key) {
    const data = await loadSidePrompts();
    const normalizedKey = String(key || '').trim();
    if (!data.sets?.[normalizedKey]) {
        throw new Error(`Set "${normalizedKey}" not found`);
    }
    delete data.sets[normalizedKey];
    await saveDoc(data);
}

function resolveSetItemRuntimeMacros(item, commandRuntimeMacros = {}) {
    const resolved = {};
    for (const [token, value] of Object.entries(item?.runtimeMacros || {})) {
        resolved[token] = applySidePromptMacros(String(value ?? ''), commandRuntimeMacros);
    }
    return resolved;
}

function uniqueTokens(values = []) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        output.push(value);
    }
    return output;
}

export async function collectSetRuntimeMacros(setKeyOrSet, commandRuntimeMacros = {}) {
    const data = await loadSidePrompts();
    const set = typeof setKeyOrSet === 'string'
        ? data.sets?.[setKeyOrSet]
        : setKeyOrSet;
    if (!set) return [];

    const required = [];
    for (const item of set.items || []) {
        const template = data.prompts?.[item.promptKey];
        if (!template) continue;
        const itemRuntimeMacros = {
            ...commandRuntimeMacros,
            ...resolveSetItemRuntimeMacros(item, commandRuntimeMacros),
        };
        required.push(...collectTemplateRuntimeMacros(template, itemRuntimeMacros));
    }
    return uniqueTokens(required);
}

export async function resolveSetItemsForRun(setKey, commandRuntimeMacros = {}, options = {}) {
    const data = await loadSidePrompts();
    const set = data.sets?.[String(setKey || '')] || null;
    const allowUnresolved = Boolean(options.allowUnresolved);
    const runnable = [];
    const skipped = [];

    if (!set) {
        return { set: null, runnable, skipped: [{ reason: 'missing-set', setKey }] };
    }

    for (const item of set.items || []) {
        const template = data.prompts?.[item.promptKey];
        if (!template) {
            skipped.push({ reason: 'missing-template', item });
            continue;
        }

        const runtimeMacros = {
            ...commandRuntimeMacros,
            ...resolveSetItemRuntimeMacros(item, commandRuntimeMacros),
        };
        const missingRuntimeMacros = collectTemplateRuntimeMacros(template, runtimeMacros);
        if (missingRuntimeMacros.length > 0 && !allowUnresolved) {
            skipped.push({ reason: 'missing-macros', item, template, missingRuntimeMacros });
            continue;
        }

        const effectiveTemplate = structuredClone(template);
        const label = String(item.label || '').trim();
        if (label && !String(effectiveTemplate?.settings?.lorebook?.entryTitleOverride || '').trim()) {
            effectiveTemplate.settings = { ...(effectiveTemplate.settings || {}) };
            effectiveTemplate.settings.lorebook = {
                ...(effectiveTemplate.settings.lorebook || {}),
                entryTitleOverride: label,
            };
        }

        runnable.push({
            set,
            item,
            template: effectiveTemplate,
            baseTemplate: template,
            runtimeMacros,
            missingRuntimeMacros,
            name: label ? `${set.name}: ${label}` : `${set.name}: ${template.name}`,
        });
    }

    return { set, runnable, skipped };
}

export async function exportSidePromptsJson() {
    const data = await loadSidePrompts();
    return JSON.stringify(data, null, 2);
}

export async function importSidePromptsJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    let incoming = null;
    if (validateSidePromptsFileV2(parsed)) {
        incoming = normalizeSidePromptsDocument(parsed);
    } else if (looksLikeV1SidePrompts(parsed)) {
        incoming = normalizeSidePromptsDocument(migrateV1toV2(parsed));
    } else {
        throw new Error('Invalid side prompts file structure');
    }
    migrateBuiltinTemplateKeys(incoming);

    const existing = await loadSidePrompts();
    const merged = {
        version: Math.max(2, Number(existing.version ?? 2), Number(incoming.version ?? 2)),
        prompts: { ...(existing.prompts || {}) },
        sets: { ...(existing.sets || {}) },
    };

    let added = 0;
    let renamed = 0;
    let setsAdded = 0;
    let setsRenamed = 0;
    const strippedDetails = [];
    const promptKeyMap = new Map();
    for (const [key, prompt] of Object.entries(incoming.prompts || {})) {
        const desiredKey = String(key || '').trim();
        if (desiredKey === CLIP_REVIEW_TEMPLATE_KEY || prompt?.specialKind === 'clipReview') {
            if (desiredKey) promptKeyMap.set(desiredKey, CLIP_REVIEW_TEMPLATE_KEY);
            continue;
        }
        const baseName = String(prompt?.name || desiredKey || 'Untitled Side Prompt');
        let nextKey = desiredKey || safeSlug(baseName);
        let suffix = 2;
        while (merged.prompts[nextKey]) {
            nextKey = safeSlug(`${baseName} ${suffix}`);
            suffix++;
        }
        if (nextKey !== desiredKey) {
            renamed++;
        }
        if (desiredKey) {
            promptKeyMap.set(desiredKey, nextKey);
        }

        const next = {
            key: nextKey,
            name: baseName,
            enabled: Boolean(prompt?.enabled),
            prompt: String(prompt?.prompt ?? ''),
            responseFormat: String(prompt?.responseFormat ?? ''),
            settings: { ...(prompt?.settings || {}) },
            triggers: prompt?.triggers ? { ...prompt.triggers } : { commands: ['sideprompt'] },
            createdAt: String(prompt?.createdAt || nowIso()),
            updatedAt: nowIso(),
        };
        const { strippedAutoTriggers } = normalizeTemplateTriggers(next);
        if (strippedAutoTriggers.length > 0) {
            strippedDetails.push({
                name: next.name,
                triggers: strippedAutoTriggers,
            });
        }
        merged.prompts[nextKey] = next;
        added++;
    }

    for (const [key, set] of Object.entries(incoming.sets || {})) {
        const desiredKey = String(key || '').trim();
        const baseName = String(set?.name || desiredKey || 'Untitled Side Prompt Set');
        let nextKey = desiredKey || safeSlug(baseName) || 'sideprompt-set';
        let suffix = 2;
        while (merged.sets[nextKey]) {
            nextKey = safeSlug(`${baseName} ${suffix}`);
            suffix++;
        }
        if (nextKey !== desiredKey) {
            setsRenamed++;
        }

        const timestamp = nowIso();
        merged.sets[nextKey] = normalizeSet({
            ...set,
            key: nextKey,
            items: (set.items || []).map(item => ({
                ...item,
                id: makeSetItemId(),
                promptKey: promptKeyMap.get(item.promptKey) || item.promptKey,
            })).filter(item => String(item.promptKey || '') !== CLIP_REVIEW_TEMPLATE_KEY),
            createdAt: String(set?.createdAt || timestamp),
            updatedAt: timestamp,
        }, nextKey, timestamp);
        setsAdded++;
    }

    await saveDoc(merged);
    return { added, renamed, setsAdded, setsRenamed, strippedDetails };
}

export async function recreateBuiltInSidePrompts(mode = 'overwrite') {
    const data = await loadSidePrompts();
    const builtins = getBuiltinTemplates();
    if (mode !== 'overwrite') {
        throw new Error('Only overwrite mode is supported');
    }

    let replaced = 0;
    for (const [key, prompt] of Object.entries(builtins)) {
        data.prompts[key] = prompt;
        replaced++;
    }

    syncBuiltinPromptLocale(data);
    await saveDoc(data);
    return { replaced };
}

/** Recreates one built-in Side Prompt without changing other templates. */
export async function recreateBuiltInSidePrompt(key) {
    const normalizedKey = String(key || '').trim();
    const builtin = getBuiltinTemplates()[normalizedKey];
    if (!builtin) throw new Error(`Template "${normalizedKey}" not found`);
    const data = await loadSidePrompts();
    data.prompts[normalizedKey] = builtin;
    syncBuiltinPromptLocale(data);
    await saveDoc(data);
    return { replaced: 1 };
}

export async function listByTrigger(kind) {
    const all = await listTemplates();
    if (kind === 'onInterval') {
        return all.filter(template =>
            template.enabled &&
            template.triggers?.onInterval &&
            Number(template.triggers.onInterval.visibleMessages) >= 1 &&
            !hasTemplateRuntimeMacros(template),
        );
    }
    if (kind === 'onAfterMemory') {
        return all.filter(template =>
            template.enabled &&
            template.triggers?.onAfterMemory?.enabled &&
            !hasTemplateRuntimeMacros(template),
        );
    }
    if (typeof kind === 'string' && kind.startsWith('command:')) {
        const command = kind.slice('command:'.length).trim().toLowerCase();
        return all.filter(template =>
            Array.isArray(template.triggers?.commands) &&
            template.triggers.commands.some(item => String(item).toLowerCase() === command),
        );
    }
    return [];
}

export function clearSidePromptsCache() {
    cacheGeneration++;
    cachedDoc = null;
    cachedRevision = 'missing';
}
