import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import { createMacroState, evaluatePromptMacros } from '../prompting/macro-evaluator.js';
import { getRegexedString, regex_placement } from '../prompting/regex-runtime.js';
import { getHiddenLorebooksForCharacter } from '../hidden-lorebook-bindings.js';
import {
    hasLorebookForGeneration,
    LorebookRepositoryError,
    deleteLorebookForManagement,
    demoteLorebook,
    getLorebookForManagement,
    listLorebooksForManagement,
    promoteLorebook,
    readLorebookForGeneration,
    readWorldInfoFile as readUserWorldInfoFile,
    saveLorebookForManagement,
} from '../lorebook-repository.js';

export const readWorldInfoFile = readUserWorldInfoFile;

export const router = express.Router();

const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];
const DEFAULT_LOREBOOK_PRIORITY = 3;
const PRIORITY_BAND_SIZE = 10000;
const DEFAULT_LOREBOOK_SETTINGS = Object.freeze({
    priority: null,
    budget: null,
    budgetMode: 'default',
    orderAdjustment: 0,
    orderAdjustmentGroupOnly: false,
    characterOverrides: {},
    onlyWhenSpeaking: false,
});
const promptStateModuleMap = {
    summary: '1_memory',
    authorsNote: '2_floating_prompt',
    vectorsMemory: '3_vectors',
    vectorsDataBank: '4_vectors_data_bank',
    smartContext: 'chromadb',
};

function inflatePromptState(promptState = {}, quietPrompt = '') {
    const extensionPrompts = {};

    for (const [moduleKey, legacyKey] of Object.entries(promptStateModuleMap)) {
        if (!promptState?.modules?.[moduleKey]) {
            continue;
        }

        extensionPrompts[legacyKey] = {
            key: legacyKey,
            value: String(promptState.modules[moduleKey]?.value ?? ''),
            position: promptState.modules[moduleKey]?.position,
            depth: promptState.modules[moduleKey]?.depth,
            scan: Boolean(promptState.modules[moduleKey]?.scan),
            role: Number(promptState.modules[moduleKey]?.role ?? 0),
        };
    }

    for (const prompt of Array.isArray(promptState?.prompts) ? promptState.prompts : []) {
        const key = String(prompt?.key || '');
        if (!key) {
            continue;
        }

        extensionPrompts[key] = {
            key,
            value: String(prompt?.value ?? ''),
            position: prompt?.position,
            depth: prompt?.depth,
            scan: Boolean(prompt?.scan),
            role: Number(prompt?.role ?? 0),
        };
    }

    extensionPrompts.QUIET_PROMPT = {
        key: 'QUIET_PROMPT',
        value: String(quietPrompt || ''),
        position: 0,
        depth: 0,
        scan: true,
        role: 0,
    };

    return extensionPrompts;
}

function getStringHash(str, seed = 0) {
    if (typeof str !== 'string') {
        return 0;
    }

    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let index = 0; index < str.length; index++) {
        const ch = str.charCodeAt(index);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function parseDecorators(content) {
    const isKnownDecorator = (data) => {
        if (data.startsWith('@@@')) {
            data = data.substring(1);
        }

        return KNOWN_DECORATORS.some(decorator => data.startsWith(decorator));
    };

    if (!String(content || '').startsWith('@@')) {
        return [[], content];
    }

    let newContent = content;
    const lines = String(content).split('\n');
    const decorators = [];
    let fallbacked = false;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line.startsWith('@@')) {
            newContent = lines.slice(index).join('\n');
            break;
        }

        if (line.startsWith('@@@') && !fallbacked) {
            continue;
        }

        if (isKnownDecorator(line)) {
            decorators.push(line.startsWith('@@@') ? line.substring(1) : line);
            fallbacked = false;
        } else {
            fallbacked = true;
        }
    }

    return [decorators, newContent];
}

function worldEntriesFromBook(worldInfo, worldName) {
    if (!worldInfo?.entries || typeof worldInfo.entries !== 'object') {
        return [];
    }

    const lorebookSettings = extractLorebookSettings(worldInfo);

    return Object.keys(worldInfo.entries)
        .map(key => worldInfo.entries[key])
        .map(({ uid, ...rest }) => ({ uid, world: worldName, lorebookSettings, ...rest }));
}

async function readWorldEntries(user, worldName) {
    const worldInfo = await readLorebookForGeneration(user, worldName, true);
    return worldEntriesFromBook(worldInfo, worldName);
}

function normalizeSpeakerIdentifier(value) {
    return String(value || '').trim().toLowerCase();
}

function stripExtension(value) {
    return String(value || '').replace(/\.[^/.]+$/, '');
}

function normalizePriority(value) {
    if (value === null || value === undefined || value === '') {
        return DEFAULT_LOREBOOK_PRIORITY;
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
        return DEFAULT_LOREBOOK_PRIORITY;
    }

    return Math.max(1, Math.min(5, Math.trunc(number)));
}

function normalizeBudgetMode(value) {
    const mode = String(value || 'default').trim().toLowerCase();
    return ['default', 'percentage_context', 'percentage_budget', 'fixed'].includes(mode)
        ? mode
        : 'default';
}

function normalizeOptionalNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizeCharacterOverrides(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.entries(value).reduce((result, [key, override]) => {
        const normalizedKey = normalizeSpeakerIdentifier(key);
        if (!normalizedKey || !override || typeof override !== 'object' || Array.isArray(override)) {
            return result;
        }

        const normalizedOverride = {};
        if (override.priority !== undefined && override.priority !== null && override.priority !== '') {
            normalizedOverride.priority = normalizePriority(override.priority);
        }
        if (override.orderAdjustment !== undefined && override.orderAdjustment !== null && override.orderAdjustment !== '') {
            normalizedOverride.orderAdjustment = Number(override.orderAdjustment) || 0;
        }
        if (override.budget !== undefined) {
            normalizedOverride.budget = normalizeOptionalNumber(override.budget);
        }
        if (override.budgetMode !== undefined) {
            normalizedOverride.budgetMode = normalizeBudgetMode(override.budgetMode);
        }

        result[normalizedKey] = normalizedOverride;
        return result;
    }, {});
}

function normalizeLorebookSettings(value) {
    const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        priority: settings.priority === null ? null : normalizeOptionalNumber(settings.priority),
        budget: normalizeOptionalNumber(settings.budget),
        budgetMode: normalizeBudgetMode(settings.budgetMode),
        orderAdjustment: Number(settings.orderAdjustment) || 0,
        orderAdjustmentGroupOnly: Boolean(settings.orderAdjustmentGroupOnly),
        characterOverrides: normalizeCharacterOverrides(settings.characterOverrides),
        onlyWhenSpeaking: Boolean(settings.onlyWhenSpeaking),
    };
}

function extractLorebookSettings(worldInfo) {
    const topLevel = worldInfo && typeof worldInfo === 'object' ? worldInfo.stlo : null;
    const extensionLevel = worldInfo?.extensions && typeof worldInfo.extensions === 'object' ? worldInfo.extensions.stlo : null;
    return {
        ...DEFAULT_LOREBOOK_SETTINGS,
        ...normalizeLorebookSettings(topLevel ?? extensionLevel ?? {}),
    };
}

function getActiveSpeakerKeys(activeSpeaker = {}) {
    const keys = new Set();
    const normalizedName = normalizeSpeakerIdentifier(activeSpeaker?.name);
    const normalizedAvatar = normalizeSpeakerIdentifier(stripExtension(activeSpeaker?.avatar));
    const normalizedFilename = normalizeSpeakerIdentifier(stripExtension(activeSpeaker?.filename));

    if (normalizedName) {
        keys.add(normalizedName);
    }
    if (normalizedAvatar) {
        keys.add(normalizedAvatar);
    }
    if (normalizedFilename) {
        keys.add(normalizedFilename);
    }

    return keys;
}

function resolveLorebookSettings(entry, activeSpeaker = {}, isGroupChat = false) {
    const base = {
        ...DEFAULT_LOREBOOK_SETTINGS,
        ...normalizeLorebookSettings(entry?.lorebookSettings),
    };
    const activeSpeakerKeys = getActiveSpeakerKeys(activeSpeaker);
    let matchedOverride = null;

    for (const [key, override] of Object.entries(base.characterOverrides || {})) {
        if (activeSpeakerKeys.has(normalizeSpeakerIdentifier(key))) {
            matchedOverride = override;
            break;
        }
    }

    const resolved = {
        priority: normalizePriority(base.priority),
        budget: base.budget,
        budgetMode: base.budgetMode,
        orderAdjustment: base.orderAdjustment,
        onlyWhenSpeaking: base.onlyWhenSpeaking,
    };

    if (matchedOverride) {
        if (matchedOverride.priority !== undefined) {
            resolved.priority = normalizePriority(matchedOverride.priority);
        }
        if (matchedOverride.orderAdjustment !== undefined) {
            resolved.orderAdjustment = Number(matchedOverride.orderAdjustment) || 0;
        }
        if (matchedOverride.budget !== undefined) {
            resolved.budget = normalizeOptionalNumber(matchedOverride.budget);
        }
        if (matchedOverride.budgetMode !== undefined) {
            resolved.budgetMode = normalizeBudgetMode(matchedOverride.budgetMode);
        }
    }

    if (base.orderAdjustmentGroupOnly && !isGroupChat) {
        resolved.orderAdjustment = 0;
    }

    return {
        excluded: Boolean(base.onlyWhenSpeaking && !matchedOverride),
        settings: resolved,
    };
}

function substituteParams(content, env = {}) {
    return evaluatePromptMacros(content, env, {
        macroState: env?.__macroState || null,
    });
}

export async function resolveSortedEntriesPayload(user, body = {}, options = {}) {
    const {
        selectedWorldInfo = [],
        chatWorld = '',
        personaWorld = '',
        characterWorld = '',
        characterExtraBooks = [],
        currentCharacterFilename = '',
        selectedGroup = false,
        activeSpeaker = {},
    } = body;
    const readEntries = options.readEntries ?? readWorldEntries;
    const getHiddenBooks = options.getHiddenBooks ?? getHiddenLorebooksForCharacter;
    const hasLorebook = options.hasLorebook ?? hasLorebookForGeneration;

    const selectedWorldSet = new Set(Array.isArray(selectedWorldInfo) ? selectedWorldInfo.filter(Boolean) : []);
    const visibleCharacterBooks = new Set([characterWorld, ...(Array.isArray(characterExtraBooks) ? characterExtraBooks : [])].filter(Boolean));
    const resolvedHiddenBooks = getHiddenBooks(currentCharacterFilename);
    const hiddenCharacterBooks = new Set((Array.isArray(resolvedHiddenBooks) ? resolvedHiddenBooks : []).filter(Boolean));
    const claimedWorldNames = new Set();

    /**
     * Claims lorebook names once so duplicate bindings do not load the same lorebook multiple times.
     * Preserves the input order and the effective priority implied by the order of calls below.
     * @param {Iterable<string>} worldNames
     * @returns {string[]}
     */
    function claimWorldNames(worldNames) {
        const claimed = [];

        for (const worldName of worldNames) {
            if (!worldName || claimedWorldNames.has(worldName)) {
                continue;
            }

            claimedWorldNames.add(worldName);
            claimed.push(worldName);
        }

        return claimed;
    }

    const globalWorldNames = claimWorldNames(selectedWorldSet);
    const chatWorldNames = claimWorldNames(chatWorld ? [chatWorld] : []);
    const personaWorldNames = claimWorldNames(personaWorld ? [personaWorld] : []);
    const visibleCharacterWorldNames = claimWorldNames(visibleCharacterBooks);
    const hiddenCharacterWorldNames = claimWorldNames(hiddenCharacterBooks);

    const globalLore = (await Promise.all(globalWorldNames.map(worldName => readEntries(user, worldName)))).flat();

    const visibleCharacterLore = (await Promise.all(visibleCharacterWorldNames
        .map(worldName => readEntries(user, worldName)))).flat();

    const hiddenCharacterLore = (await Promise.all(hiddenCharacterWorldNames
        .map(async worldName => {
            if (!hasLorebook(user, worldName)) {
                console.warn(`[WI] Hidden lorebook "${worldName}" not found for character "${currentCharacterFilename}". Skipping.`);
                return [];
            }

            try {
                return await readEntries(user, worldName);
            } catch (error) {
                if (error instanceof LorebookRepositoryError && error.type === 'LorebookNotFound') {
                    return [];
                }
                throw error;
            }
        }))).flat();

    const characterLore = [...visibleCharacterLore, ...hiddenCharacterLore];

    const chatLore = chatWorldNames.length
        ? await readEntries(user, chatWorldNames[0])
        : [];

    const personaLore = personaWorldNames.length
        ? await readEntries(user, personaWorldNames[0])
        : [];

    let entries = [...globalLore, ...characterLore, ...chatLore, ...personaLore]
        .map((entry, index) => {
            const resolved = resolveLorebookSettings(entry, activeSpeaker, Boolean(selectedGroup));
            if (resolved.excluded) {
                return null;
            }

            const originalOrder = Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100;
            const effectiveOrder = resolved.settings.priority * PRIORITY_BAND_SIZE
                + resolved.settings.orderAdjustment
                + Math.min(originalOrder, PRIORITY_BAND_SIZE - 1);

            return {
                ...entry,
                lorebookSettings: resolved.settings,
                order: effectiveOrder,
                sourceIndex: index,
            };
        })
        .filter(Boolean)
        .sort((left, right) =>
            (right.order ?? 0) - (left.order ?? 0)
            || (left.uid ?? 0) - (right.uid ?? 0)
            || String(left.world ?? '').localeCompare(String(right.world ?? ''))
            || (left.sourceIndex ?? 0) - (right.sourceIndex ?? 0),
        );

    entries = entries
        .map((entry) => {
            const [decorators, content] = parseDecorators(entry.content || '');
            return { ...entry, decorators, content };
        })
        .map((entry) => {
            const { sourceIndex, ...rest } = entry;
            void sourceIndex;
            return {
                ...rest,
                hash: getStringHash(JSON.stringify(rest)),
            };
        });

    return {
        globalLore,
        characterLore,
        chatLore,
        personaLore,
        entries,
    };
}

export function prepareEntriesForScan(entries = [], env = {}) {
    const extensionPrompts = env.extensionPrompts || inflatePromptState(env.promptState || {}, env.quietPrompt || '');
    const macroState = createMacroState(env.macroSnapshot || {}, extensionPrompts);
    const macroEnv = { ...env, __macroState: macroState };
    const regexScripts = Array.isArray(env.regexScripts) ? env.regexScripts : [];
    const atDepthPosition = env.worldInfoPosition?.atDepth != null
        ? Number(env.worldInfoPosition.atDepth)
        : null;
    return entries.map((entry) => ({
        ...structuredClone(entry),
        key: Array.isArray(entry.key) ? entry.key.map((key) => substituteParams(key, macroEnv)) : entry.key,
        keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary.map((key) => substituteParams(key, macroEnv)) : entry.keysecondary,
        content: substituteParams(getRegexedString(String(entry.content || ''), regex_placement.WORLD_INFO, regexScripts, macroEnv, {
            isMarkdown: false,
            isPrompt: true,
            depth: atDepthPosition !== null && entry.position === atDepthPosition ? (entry.depth ?? 4) : undefined,
            macroState,
        }), macroEnv),
    }));
}

function sendLorebookError(response, error) {
    if (error instanceof LorebookRepositoryError) {
        return response.status(error.status).send({
            error: {
                type: error.type,
                message: error.message,
            },
        });
    }

    console.error('[Lorebooks] Unexpected error', error);
    return response.status(500).send({
        error: {
            type: 'LorebookInternalError',
            message: String(error?.message || error),
        },
    });
}

router.post('/list', async (request, response) => {
    try {
        const items = await listLorebooksForManagement(request.user);
        return response.send({ items, world_info_items: items, world_names: items.map(item => item.name) });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/get', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const { data, metadata } = await getLorebookForManagement(request.user, request.body.name, true, request.body.storage || null);
        return response.send({ ...data, name: metadata.name, storage: metadata.storage, ownerHandle: metadata.ownerHandle });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/delete', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const result = await deleteLorebookForManagement(request.user, request.body.name);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/import', async (request, response) => {
    if (!request.file) return response.sendStatus(400);

    const filename = `${path.parse(sanitize(request.file.originalname)).name}.json`;

    let fileContents = null;

    if (request.body.convertedData) {
        fileContents = request.body.convertedData;
    } else {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        fileContents = fs.readFileSync(pathToUpload, 'utf8');
        fs.unlinkSync(pathToUpload);
    }

    try {
        const worldContent = JSON.parse(fileContents);
        if (!('entries' in worldContent)) {
            throw new Error('File must contain a world info entries list');
        }
    } catch (err) {
        return response.status(400).send('Is not a valid world info file');
    }

    const worldName = path.parse(filename).name;

    if (!worldName) {
        return response.status(400).send('World file must have a name');
    }

    try {
        const metadata = await saveLorebookForManagement(request.user, worldName, JSON.parse(fileContents), request.body.storage || 'user');
        return response.send({ name: metadata.name, storage: metadata.storage, ownerHandle: metadata.ownerHandle, shadowingSecure: Boolean(metadata.shadowingSecure) });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/edit', async (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    if (!request.body.name) {
        return response.status(400).send('World file must have a name');
    }

    try {
        if (!('entries' in request.body.data)) {
            throw new Error('World info must contain an entries list');
        }
    } catch (err) {
        return response.status(400).send('Is not a valid world info file');
    }

    try {
        const metadata = await saveLorebookForManagement(request.user, request.body.name, request.body.data, request.body.storage || 'user');
        return response.send({ ok: true, name: metadata.name, storage: metadata.storage, ownerHandle: metadata.ownerHandle, shadowingSecure: Boolean(metadata.shadowingSecure) });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/promote', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const result = await promoteLorebook(request.user, request.body.name);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/demote', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const result = await demoteLorebook(request.user, request.body.name);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/sorted-entries', async (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    try {
        return response.send(await resolveSortedEntriesPayload(request.user, request.body));
    } catch (error) {
        return sendLorebookError(response, error);
    }
});
