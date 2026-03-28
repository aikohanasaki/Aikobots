import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import { createMacroState, evaluatePromptMacros } from '../prompting/macro-evaluator.js';
import { getRegexedString, regex_placement } from '../prompting/regex-runtime.js';
import { scanWorldInfo } from '../prompting/world-info-scan.js';
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

const world_info_insertion_strategy = {
    evenly: 0,
    character_first: 1,
    global_first: 2,
};

const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];
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

function mergeExtensionPromptSources(promptState = {}, runtimePrompts = {}, quietPrompt = '') {
    return {
        ...inflatePromptState(promptState, quietPrompt),
        ...(runtimePrompts && typeof runtimePrompts === 'object' ? runtimePrompts : {}),
    };
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

    return Object.keys(worldInfo.entries)
        .map(key => worldInfo.entries[key])
        .map(({ uid, ...rest }) => ({ uid, world: worldName, ...rest }));
}

async function readWorldEntries(user, worldName) {
    const worldInfo = await readLorebookForGeneration(user, worldName, true);
    return worldEntriesFromBook(worldInfo, worldName);
}

function sortEntriesWithStrategy(globalLore, characterLore, strategy) {
    const sortFn = (a, b) => (b.order ?? 0) - (a.order ?? 0);

    switch (Number(strategy)) {
        case world_info_insertion_strategy.evenly:
            return [...globalLore, ...characterLore].sort(sortFn);
        case world_info_insertion_strategy.character_first:
            return [...characterLore.sort(sortFn), ...globalLore.sort(sortFn)];
        case world_info_insertion_strategy.global_first:
            return [...globalLore.sort(sortFn), ...characterLore.sort(sortFn)];
        default:
            console.error('[WI] Unknown WI insertion strategy:', strategy, 'defaulting to evenly');
            return [...globalLore, ...characterLore].sort(sortFn);
    }
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
        worldInfoCharacterStrategy = world_info_insertion_strategy.character_first,
    } = body;
    const readEntries = options.readEntries ?? readWorldEntries;
    const getHiddenBooks = options.getHiddenBooks ?? getHiddenLorebooksForCharacter;
    const hasLorebook = options.hasLorebook ?? hasLorebookForGeneration;

    const selectedWorldSet = new Set(Array.isArray(selectedWorldInfo) ? selectedWorldInfo.filter(Boolean) : []);
    const excludedCharacterBooks = new Set([chatWorld, personaWorld, ...selectedWorldSet].filter(Boolean));
    const visibleCharacterBooks = new Set([characterWorld, ...(Array.isArray(characterExtraBooks) ? characterExtraBooks : [])].filter(Boolean));
    const resolvedHiddenBooks = getHiddenBooks(currentCharacterFilename);
    const hiddenCharacterBooks = new Set(
        (Array.isArray(resolvedHiddenBooks) ? resolvedHiddenBooks : [])
            .filter(Boolean)
            .filter(worldName => !visibleCharacterBooks.has(worldName)),
    );

    const globalLore = (await Promise.all([...selectedWorldSet].map(worldName => readEntries(user, worldName)))).flat();

    const visibleCharacterLore = (await Promise.all([...visibleCharacterBooks]
        .filter(worldName => !excludedCharacterBooks.has(worldName))
        .map(worldName => readEntries(user, worldName)))).flat();

    const hiddenCharacterLore = (await Promise.all([...hiddenCharacterBooks]
        .filter(worldName => !excludedCharacterBooks.has(worldName))
        .map(async worldName => {
            if (!hasLorebook(user, worldName)) {
                console.warn(`[WI] Hidden lorebook "${worldName}" not found for character "${currentCharacterFilename}". Skipping.`);
                return [];
            }

            return readEntries(user, worldName);
        }))).flat();

    const characterLore = [...visibleCharacterLore, ...hiddenCharacterLore];

    const chatLore = chatWorld && !selectedWorldSet.has(chatWorld)
        ? await readEntries(user, chatWorld)
        : [];

    const personaLore = personaWorld && personaWorld !== chatWorld && !selectedWorldSet.has(personaWorld)
        ? await readEntries(user, personaWorld)
        : [];

    let entries = sortEntriesWithStrategy(globalLore, characterLore, worldInfoCharacterStrategy);
    const sortFn = (a, b) => (b.order ?? 0) - (a.order ?? 0);
    entries = [...chatLore.sort(sortFn), ...personaLore.sort(sortFn), ...entries];

    entries = entries
        .map((entry) => {
            const [decorators, content] = parseDecorators(entry.content || '');
            return { ...entry, decorators, content };
        })
        .map((entry) => ({
            ...entry,
            hash: getStringHash(JSON.stringify(entry)),
        }));

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
    const atDepthPosition = Number(env.worldInfoPosition?.atDepth);
    return entries.map((entry) => ({
        ...structuredClone(entry),
        key: Array.isArray(entry.key) ? entry.key.map((key) => substituteParams(key, macroEnv)) : entry.key,
        keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary.map((key) => substituteParams(key, macroEnv)) : entry.keysecondary,
        content: substituteParams(getRegexedString(String(entry.content || ''), regex_placement.WORLD_INFO, regexScripts, macroEnv, {
            isMarkdown: false,
            isPrompt: true,
            depth: entry.position === atDepthPosition ? (entry.depth ?? 4) : undefined,
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

router.post('/scan', (request, response) => {
    return (async () => {
        if (!request.body) {
            return response.sendStatus(400);
        }

        try {
            const payload = { ...request.body };
            const effectiveExtensionPrompts = mergeExtensionPromptSources(
                payload.promptState || {},
                payload.extensionPrompts || {},
                payload.quietPrompt || '',
            );
            if (!Array.isArray(payload.sortedEntries)) {
                const resolved = await resolveSortedEntriesPayload(request.user, payload);
                payload.sortedEntries = prepareEntriesForScan(resolved.entries, {
                    ...(payload.substitutionEnv || {}),
                    macroSnapshot: payload.macroSnapshot || payload.substitutionEnv?.macroSnapshot,
                    extensionPrompts: effectiveExtensionPrompts,
                    regexScripts: payload.regexScripts,
                    worldInfoPosition: payload.worldInfoPosition,
                });
            }

            payload.extensionPrompts = effectiveExtensionPrompts;

            return response.send(await scanWorldInfo(payload));
        } catch (error) {
            console.error('World info scan failed', error);
            return response.status(500).send({ error: String(error?.message || error) });
        }
    })();
});
