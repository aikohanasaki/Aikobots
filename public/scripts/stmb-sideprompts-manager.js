import { getRequestHeaders } from '../script.js';
import { hasTemplateRuntimeMacros } from './stmb-sideprompt-macros.js';

const SIDE_PROMPTS_FILE = 'stmb-side-prompts.json';
let cachedDoc = null;

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

function normalizeTemplateTriggers(template) {
    const hadExplicitTriggers = template.triggers && typeof template.triggers === 'object';
    template.triggers = hadExplicitTriggers
        ? { ...template.triggers }
        : { commands: ['sideprompt'] };

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
        delete template.triggers.onInterval;
        delete template.triggers.onAfterMemory;
        if (!template.triggers.commands.some(command => command.toLowerCase() === 'sideprompt')) {
            template.triggers.commands.push('sideprompt');
        }
    }
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

function getBuiltinTemplates() {
    const createdAt = nowIso();
    const prompts = {};

    const define = (name, prompt, responseFormat, settings, triggers) => {
        const key = safeSlug(name);
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
        'Analyze the accompanying scene for plot threads, story arcs, and other narrative movements. The previous scenes are there to provide context. Generate a story thread report. If a report already exists in context, update it instead of recreating.',
        "=== Plot Points ===\n(as of [point in the story when this analysis was done])\n\n[Overarching Plot Arc]\n(2-3 sentence summary of the superobjective or major plot)\n\n[Thread #1 Title]\n- Summary: (1 sentence)\n- Status: (active / on hold)\n- At Stake: (how resolution will affect the ongoing story)\n- Last Known: (location or time)\n- Key Characters: ...\n\n\n[Thread #2 Title]\n- Summary: (1 sentence)\n- Status: (active / on hold)\n- At Stake: (how resolution will affect the ongoing story)\n- Last Known: (location or time)\n- Key Characters: ...\n\n...\n\n-- Plot Hooks --\n- (new or potential plot hooks)\n\n-- Character Dynamics --\n- current status of {{user}}'s/{{char}}'s relationships with NPCs\n\n===End Plot Points===\n",
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
        'Analyze all context (previous scenes, memories, lore, history, interactions) to generate a detailed analysis of {{user}} and {{char}} (including abbreviated !lovefactor and !lustfactor commands). Note: If there is a pre-existing !status report, update it, do not regurgitate it.',
        "Follow this general format:\n\n## Witty Headline or Summary\n\n### AFFINITY (0-100, have some relationship with !lovefactor and !lustfactor)\n- Score with evidence\n- Recent changes \n- Supporting quotes\n- Anything else that might be illustrative of the current affinity\n\n### LOVEFACTOR and LUSTFACTOR\n(!lovefactor and !lustfactor reports go here)\n\n### RELATIONSHIP STATUS (negative = enemies, 0 = strangers, 100 = life partners)\n- Trust/boundaries/communication\n- Key events\n- Issues\n- Any other pertinent points\n\n### GOALS\n- Short/long-term objectives\n- Progress/obstacles\n- Growth areas\n- Any other pertinent points\n\n### ANALYSIS\n- Psychology/POV\n- Development/triggers\n- Story suggestions\n- Any other pertinent points\n\n### WRAP-UP\n- OOC Summary (1 paragraph)",
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
        "You are a skilled reporter with a clear eye for judging the importance of NPCs to the plot. \nStep 1: Review the scene and either add or update plot-related NPCs to the NPC WHO'S WHO report. Please note that {{char}} and {{user}} are major characters and do NOT need to be included in this report.\nStep 2: This list should be kept in order of importance to the plot, so it may need to be reordered.\nStep 3: If your response would be more than 2000 tokens long, remove NPCs with the least impact to the plot.",
        "===NPC WHO'S WHO===\n(In order of importance to the plot)\n\nPerson 1: 1-2 sentence desription\nPerson 2: 1-2 sentence desription\n===END NPC WHO'S WHO===",
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
    );

    define(
        'Assess',
        'Assess the interaction between {{char}} and {{user}} to date. List all the information {{char}} has learned about {{user}} through observation, questioning, or drawing conclusions from interaction (similar to a mental "note to self"). If there is already a list, update it. Try to keep it token-efficient and compact, focused on the important things.',
        'Use this format: \n=== Things {{char}} has learned about {{user}} ===\n(detailed list, in {{char}}\'s POV/tone of voice)\n===',
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

    return prompts;
}

function createBaseDoc() {
    return {
        version: 2,
        prompts: getBuiltinTemplates(),
    };
}

async function saveDoc(document) {
    const json = JSON.stringify(document, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        credentials: 'include',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            name: SIDE_PROMPTS_FILE,
            data: base64,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to save side prompts: ${response.status} ${response.statusText}`);
    }

    cachedDoc = document;
}

export async function loadSidePrompts() {
    if (cachedDoc) return cachedDoc;

    let data = null;
    try {
        const response = await fetch(`/user/files/${SIDE_PROMPTS_FILE}`, {
            method: 'GET',
            credentials: 'include',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            data = createBaseDoc();
            await saveDoc(data);
        } else {
            const text = await response.text();
            const parsed = JSON.parse(text);
            if (looksLikeV1SidePrompts(parsed)) {
                data = migrateV1toV2(parsed);
                await saveDoc(data);
            } else if (!validateSidePromptsFileV2(parsed)) {
                data = createBaseDoc();
                await saveDoc(data);
            } else {
                data = parsed;
            }
        }
    } catch {
        data = createBaseDoc();
        await saveDoc(data);
    }

    cachedDoc = data;
    return cachedDoc;
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

export async function getTemplate(key) {
    const data = await loadSidePrompts();
    return data.prompts?.[String(key || '')] || null;
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

    const next = {
        key,
        name: finalName,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : (previous?.enabled ?? false),
        prompt: String(input.prompt ?? previous?.prompt ?? ''),
        responseFormat: String(input.responseFormat ?? previous?.responseFormat ?? ''),
        settings: { ...(previous?.settings || {}), ...(input.settings || {}) },
        triggers: input.triggers ? input.triggers : (previous?.triggers || { commands: ['sideprompt'] }),
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp,
    };

    normalizeTemplateTriggers(next);
    data.prompts[key] = next;
    await saveDoc(data);
    return key;
}

export async function duplicateTemplate(sourceKey) {
    const data = await loadSidePrompts();
    const source = data.prompts?.[String(sourceKey || '')];
    if (!source) {
        throw new Error(`Template "${sourceKey}" not found`);
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
    if (!data.prompts[normalizedKey]) {
        throw new Error(`Template "${normalizedKey}" not found`);
    }
    delete data.prompts[normalizedKey];
    await saveDoc(data);
}

export async function exportSidePromptsJson() {
    const data = await loadSidePrompts();
    return JSON.stringify(data, null, 2);
}

export async function importSidePromptsJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    let incoming = null;
    if (validateSidePromptsFileV2(parsed)) {
        incoming = parsed;
    } else if (looksLikeV1SidePrompts(parsed)) {
        incoming = migrateV1toV2(parsed);
    } else {
        throw new Error('Invalid side prompts file structure');
    }

    const existing = await loadSidePrompts();
    const merged = {
        version: Math.max(2, Number(existing.version ?? 2), Number(incoming.version ?? 2)),
        prompts: { ...(existing.prompts || {}) },
    };

    let added = 0;
    let renamed = 0;
    const strippedDetails = [];
    for (const [key, prompt] of Object.entries(incoming.prompts || {})) {
        const desiredKey = String(key || '').trim();
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

    await saveDoc(merged);
    return { added, renamed, strippedDetails };
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

    await saveDoc(data);
    return { replaced };
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
    cachedDoc = null;
}
