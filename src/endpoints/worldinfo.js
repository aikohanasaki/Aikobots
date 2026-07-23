import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import { createMacroState, evaluatePromptMacros } from '../prompting/macro-evaluator.js';
import { getRegexedString, regex_placement } from '../prompting/regex-runtime.js';
import { getHiddenLorebooksForCharacter } from '../hidden-lorebook-bindings.js';
import { assertPathUnderParent, assertSafeFileName, PathSecurityError } from '../path-security.js';
import {
    compileAndWriteHiddenLorebookTemplates,
    readHiddenLorebookTemplates,
    writeHiddenLorebookTemplates,
} from '../hidden-lorebook-templates.js';
import {
    checkinSharedLorebook,
    checkoutSharedLorebook,
    hasLorebookForGeneration,
    LorebookRepositoryError,
    deleteLorebookForManagement,
    demoteLorebook,
    getLorebookForManagement,
    listLorebooksForManagement,
    promoteLorebook,
    promoteLorebookToShared,
    readLorebookForGenerationWithMetadata,
    readWorldInfoFile as readUserWorldInfoFile,
    renameLorebookForManagement,
    saveLorebookForManagement,
    unshareLorebook,
    updateSharedLorebookOwners,
    withLorebookManagementTransaction,
} from '../lorebook-repository.js';
import { getAllEnabledUsers, getAllUserHandles, requireAdminMiddleware } from '../users.js';
import {
    DEFAULT_STLO_SETTINGS,
    getStloSettingsFromLorebook,
    normalizeStloBudgetMode,
    normalizeStloBudgetValue,
    normalizeStloSettings,
} from '../../public/scripts/stlo-utils.js';
import {
    normalizeWorldInfoSortOrder,
    setWorldInfoSortOrder,
} from '../../public/scripts/world-info-sort-order.js';

export const readWorldInfoFile = readUserWorldInfoFile;

export const router = express.Router();

function resolveUploadedWorldInfoPath(file) {
    return assertPathUnderParent(file.destination, file.path || path.join(file.destination, file.filename), 'upload');
}

function cleanupUploadedWorldInfoFile(file, validatedPath) {
    let uploadPath = validatedPath;
    if (!uploadPath && file?.destination) {
        const rawUploadPath = file.path || (file.filename ? path.join(file.destination, file.filename) : null);
        try {
            uploadPath = rawUploadPath ? assertPathUnderParent(file.destination, rawUploadPath, 'upload') : null;
        } catch {
            try {
                const safeFileName = file.filename ? assertSafeFileName(path.basename(file.filename), 'upload') : '';
                uploadPath = safeFileName ? assertPathUnderParent(file.destination, path.join(file.destination, safeFileName), 'upload') : null;
            } catch {
                uploadPath = null;
            }
        }
    }

    if (!uploadPath) {
        return;
    }

    try {
        fs.rmSync(uploadPath, { force: true });
    } catch (error) {
        console.warn('Failed to remove temporary world info upload', error);
    }
}

const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];
const DEFAULT_LOREBOOK_PRIORITY = 3;
const PRIORITY_BAND_SIZE = 10000;
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
            newContent = [line.substring(1), ...lines.slice(index + 1)].join('\n');
            break;
        }

        if (isKnownDecorator(line)) {
            decorators.push(line.startsWith('@@@') ? line.substring(1) : line);
            fallbacked = false;
        } else {
            fallbacked = true;
        }
    }

    if (newContent === content && lines.every(line => line.startsWith('@@'))) {
        newContent = '';
    }

    return [decorators, newContent];
}

function worldEntriesFromBook(worldInfo, worldName, lorebookMetadata = null) {
    if (!worldInfo?.entries || typeof worldInfo.entries !== 'object') {
        return [];
    }

    const lorebookSettings = extractLorebookSettings(worldInfo);
    const storage = lorebookMetadata?.storage === 'secure' ? 'secure' : 'user';
    const ownerHandle = String(lorebookMetadata?.ownerHandle || '');
    const ownerHandles = Array.isArray(lorebookMetadata?.ownerHandles) ? lorebookMetadata.ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean) : [];
    const sharingMode = lorebookMetadata?.sharingMode === 'shared' ? 'shared' : 'single';

    return Object.keys(worldInfo.entries)
        .map(key => worldInfo.entries[key])
        .map(({ uid, ...rest }) => ({ uid, world: worldName, lorebookSettings, storage, ownerHandle, ownerHandles, sharingMode, ...rest }));
}

async function readWorldEntries(user, worldName) {
    const { data: worldInfo, metadata } = await readLorebookForGenerationWithMetadata(user, worldName, true);
    return worldEntriesFromBook(worldInfo, worldName, metadata);
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

function extractLorebookSettings(worldInfo) {
    return getStloSettingsFromLorebook(worldInfo, { normalizeCharacterKeys: true });
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
        ...DEFAULT_STLO_SETTINGS,
        ...normalizeStloSettings(entry?.lorebookSettings, { normalizeCharacterKeys: true }),
    };
    const activeSpeakerKeys = isGroupChat ? getActiveSpeakerKeys(activeSpeaker) : new Set();
    let matchedOverride = null;

    for (const [key, override] of Object.entries(base.characterOverrides || {})) {
        if (activeSpeakerKeys.has(key)) {
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
        randomTrim: base.randomTrim,
    };

    if (matchedOverride) {
        if (matchedOverride.priority !== undefined) {
            resolved.priority = normalizePriority(matchedOverride.priority);
        }
        if (matchedOverride.orderAdjustment !== undefined) {
            resolved.orderAdjustment = Number(matchedOverride.orderAdjustment) || 0;
        }
        if (matchedOverride.budget !== undefined) {
            resolved.budget = normalizeStloBudgetValue(matchedOverride.budget);
        }
        if (matchedOverride.budgetMode !== undefined) {
            resolved.budgetMode = normalizeStloBudgetMode(matchedOverride.budgetMode);
        }
    }

    if (base.orderAdjustmentGroupOnly && !isGroupChat) {
        resolved.orderAdjustment = 0;
    }

    return {
        excluded: Boolean(isGroupChat && base.onlyWhenSpeaking && !matchedOverride),
        settings: resolved,
    };
}

function substituteParams(content, env = {}) {
    return evaluatePromptMacros(content, env, {
        macroState: env?.__macroState || null,
    });
}

function isSortedEntryHiddenForUser(user, entry) {
    if (Boolean(user?.profile?.admin)) {
        return false;
    }

    if (!entry || entry.storage !== 'secure') {
        return false;
    }

    const requestHandle = String(user?.profile?.handle || '');
    const ownerHandles = Array.isArray(entry.ownerHandles) ? entry.ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean) : [];
    if (ownerHandles.length > 0) {
        return !requestHandle || !ownerHandles.includes(requestHandle);
    }

    const ownerHandle = String(entry.ownerHandle || '');
    return !requestHandle || !ownerHandle || requestHandle !== ownerHandle;
}

function sanitizeSortedEntriesPayloadForResponse(user, payload) {
    if (!payload || typeof payload !== 'object') {
        return payload;
    }

    const filterVisibleEntries = (entries) => Array.isArray(entries)
        ? entries.filter(entry => !isSortedEntryHiddenForUser(user, entry))
        : [];

    return {
        ...payload,
        globalLore: filterVisibleEntries(payload.globalLore),
        characterLore: filterVisibleEntries(payload.characterLore),
        chatLore: filterVisibleEntries(payload.chatLore),
        personaLore: filterVisibleEntries(payload.personaLore),
        entries: filterVisibleEntries(payload.entries),
    };
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

    const hiddenCharacterLoreResults = await Promise.all(hiddenCharacterWorldNames
        .map(async worldName => {
            if (!hasLorebook(user, worldName)) {
                console.warn(`[WI] Hidden lorebook "${worldName}" not found for character "${currentCharacterFilename}". Skipping.`);
                return { worldName, entries: [], included: false };
            }

            try {
                return { worldName, entries: await readEntries(user, worldName), included: true };
            } catch (error) {
                if (error instanceof LorebookRepositoryError && error.type === 'LorebookNotFound') {
                    return { worldName, entries: [], included: false };
                }
                throw error;
            }
        }));
    const hiddenCharacterLorebookNames = hiddenCharacterLoreResults
        .filter(result => result.included)
        .map(result => result.worldName);
    const hiddenCharacterLore = hiddenCharacterLoreResults.flatMap(result => result.entries);

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
        hiddenCharacterLorebookNames,
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
                details: error.details || null,
            },
        });
    }

    console.error('[Lorebooks] Unexpected error', error);
    return response.status(500).send({
        error: {
            type: 'LorebookInternalError',
            message: String(error?.message || error),
            details: null,
        },
    });
}

/**
 * Updates only the display sort metadata on the latest persisted lorebook data.
 * @param {import('../users.js').User} user Acting user
 * @param {object} body Request body
 * @param {object} [dependencies={}] Injectable repository operations for tests
 * @returns {Promise<{data: object, metadata: object, sortOrder: string}>} Updated lorebook state
 */
export async function updateWorldInfoSortOrder(user, body = {}, dependencies = {}) {
    const name = String(body?.name || '');
    const storage = body?.storage || null;
    const sortOrder = normalizeWorldInfoSortOrder(body?.sortOrder);
    if (!name) {
        throw new LorebookRepositoryError('LorebookInvalidName', 'World file must have a name.', 400);
    }
    if (storage !== null && storage !== 'user' && storage !== 'secure') {
        throw new LorebookRepositoryError('LorebookStorageInvalid', 'Lorebook storage must be user or secure.', 400);
    }
    if (sortOrder === null) {
        throw new LorebookRepositoryError('LorebookSortOrderInvalid', 'Lorebook sort order is invalid.', 400);
    }

    const getLorebook = dependencies.getLorebookForManagement || getLorebookForManagement;
    const withTransaction = dependencies.withLorebookManagementTransaction || withLorebookManagementTransaction;

    return await withTransaction(async transaction => {
        const loaded = await getLorebook(user, name, false, storage);
        const data = structuredClone(loaded.data);

        try {
            setWorldInfoSortOrder(data, sortOrder);
        } catch (error) {
            throw new LorebookRepositoryError('LorebookInvalidData', error.message, 400);
        }

        const metadata = await transaction.save(user, loaded.metadata.name, data, loaded.metadata.storage);
        return { data, metadata, sortOrder };
    });
}

function getTimedWorldInfoReplayGenerationBoundary(message) {
    const promptSnapshotKey = message?.extra?.promptSnapshotKey;
    if (typeof promptSnapshotKey === 'string' && promptSnapshotKey) {
        return true;
    }

    return Boolean(message && !message.is_user && !message.is_system);
}

function formatTimedWorldInfoReplayChat(messages = [], includeNames = false) {
    return messages.map(message => {
        const text = String(message?.mes ?? '');
        if (includeNames && message?.name) {
            return `${message.name}: ${text}`;
        }

        return text;
    }).reverse();
}

export async function recomputeTimedWorldInfoFromChat(user, body = {}, options = {}) {
    const { scanWorldInfo } = await import('../prompting/world-info-scan.js');
    const payload = await resolveSortedEntriesPayload(user, body, options);
    const extensionPrompts = inflatePromptState(body.promptState || {}, body.quietPrompt || '');
    const sortedEntries = prepareEntriesForScan(payload.entries, {
        promptState: body.promptState || {},
        quietPrompt: body.quietPrompt || '',
        macroSnapshot: body.macroSnapshot || {},
        regexScripts: body.regexScripts,
        worldInfoPosition: body.worldInfoPosition,
    });
    const chatMessages = Array.isArray(body.chatMessages)
        ? structuredClone(body.chatMessages).filter(message => message && typeof message === 'object')
        : [];

    /** @type {Record<string, any>} */
    let timedWorldInfo = {};
    const replayMessages = [];

    for (const message of chatMessages) {
        if (getTimedWorldInfoReplayGenerationBoundary(message)) {
            const scanResult = await scanWorldInfo({
                chat: formatTimedWorldInfoReplayChat(replayMessages, body.includeNames),
                includeNames: Boolean(body.includeNames),
                maxContext: Number(body.maxContext) || 0,
                globalScanData: structuredClone(body.globalScanData || {}),
                extensionPrompts,
                currentCharacterFilename: String(body.currentCharacterFilename || ''),
                currentCharacterTags: Array.isArray(body.currentCharacterTags) ? structuredClone(body.currentCharacterTags) : [],
                sortedEntries,
                forcedActivations: Array.isArray(body.forcedActivations) ? structuredClone(body.forcedActivations) : [],
                timedWorldInfo,
                settings: structuredClone(body.settings || {}),
                worldInfoPosition: structuredClone(body.worldInfoPosition || {}),
                tokenizerModel: body.tokenizerModel ?? null,
                includeDebugInfo: false,
            });
            timedWorldInfo = structuredClone(scanResult.timedWorldInfo || {});
        }

        replayMessages.push({
            name: String(message?.name || ''),
            mes: String(message?.mes ?? ''),
            is_user: Boolean(message?.is_user),
            is_system: Boolean(message?.is_system),
            extra: message?.extra && typeof message.extra === 'object' ? structuredClone(message.extra) : {},
        });
    }

    return timedWorldInfo;
}

async function validateSharedOwnerHandles(ownerHandles = [], actingHandle = '') {
    const normalizedActingHandle = String(actingHandle || '').trim();
    const normalizedOwnerHandles = [...new Set([
        ...(Array.isArray(ownerHandles) ? ownerHandles : []),
        normalizedActingHandle,
    ]
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];

    if (normalizedOwnerHandles.length < 2) {
        throw new LorebookRepositoryError('LorebookOwnersInvalid', 'Shared secure lorebooks must have at least two owners.', 400);
    }

    const enabledUsers = await getAllEnabledUsers();
    const enabledHandles = new Set(enabledUsers.map(user => String(user.handle || '').trim()).filter(Boolean));
    const invalidOwnerHandles = normalizedOwnerHandles.filter(handle => !enabledHandles.has(handle));
    if (invalidOwnerHandles.length > 0) {
        throw new LorebookRepositoryError('LorebookOwnersInvalid', `Invalid owner handles: ${invalidOwnerHandles.join(', ')}.`, 400);
    }

    return normalizedOwnerHandles;
}

async function validateEnabledHandle(handle) {
    const normalizedHandle = String(handle || '').trim();
    if (!normalizedHandle) {
        throw new LorebookRepositoryError('LorebookOwnersInvalid', 'A valid owner handle is required.', 400);
    }

    const enabledUsers = await getAllEnabledUsers();
    if (!enabledUsers.some(user => String(user.handle || '').trim() === normalizedHandle)) {
        throw new LorebookRepositoryError('LorebookOwnersInvalid', `Invalid owner handle: ${normalizedHandle}.`, 400);
    }

    return normalizedHandle;
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
        return response.send({ data, metadata });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/delete', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const allUserHandles = (await getAllUserHandles()).map(handle => String(handle || '').trim()).filter(Boolean);
        const result = await deleteLorebookForManagement(request.user, request.body.name, {
            storage: request.body.storage || null,
            allUserHandles,
            referenceUserHandles: [request.user.profile.handle].filter(Boolean),
        });
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/import', async (request, response) => {
    if (!request.file) return response.sendStatus(400);

    let pathToUpload = null;
    try {
        pathToUpload = resolveUploadedWorldInfoPath(request.file);

        const importedName = path.parse(sanitize(assertSafeFileName(request.file.originalname, 'world file'))).name;
        const worldName = importedName.replace(/\.json$/i, '');
        const removedTrailingJsonSuffix = worldName !== importedName;

        let fileContents = null;
        if (request.body.convertedData) {
            fileContents = request.body.convertedData;
        } else {
            fileContents = fs.readFileSync(pathToUpload, 'utf8');
        }

        try {
            const worldContent = JSON.parse(fileContents);
            if (!('entries' in worldContent)) {
                throw new Error('File must contain a world info entries list');
            }
        } catch (err) {
            return response.status(400).send('Is not a valid world info file');
        }

        if (!worldName) {
            return response.status(400).send('World file must have a name');
        }

        const metadata = await saveLorebookForManagement(request.user, worldName, JSON.parse(fileContents), request.body.storage || 'user');
        return response.send({
            name: metadata.name,
            storage: metadata.storage,
            ownerHandle: metadata.ownerHandle,
            shadowingSecure: Boolean(metadata.shadowingSecure),
            removedTrailingJsonSuffix,
            metadata,
        });
    } catch (error) {
        if (error instanceof PathSecurityError) {
            return response.status(400).send(error.message);
        }
        return sendLorebookError(response, error);
    } finally {
        cleanupUploadedWorldInfoFile(request.file, pathToUpload);
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
        return response.send({
            ok: true,
            name: metadata.name,
            storage: metadata.storage,
            ownerHandle: metadata.ownerHandle,
            shadowingSecure: Boolean(metadata.shadowingSecure),
            metadata,
        });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/sort-order', async (request, response) => {
    try {
        const result = await updateWorldInfoSortOrder(request.user, request.body);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/rename', async (request, response) => {
    if (!request.body?.oldName || !request.body?.newName) {
        return response.sendStatus(400);
    }

    try {
        const result = await renameLorebookForManagement(request.user, request.body.oldName, request.body.newName, {
            storage: request.body.storage || null,
            referenceUserHandles: [request.user.profile.handle].filter(Boolean),
        });
        return response.send({ ok: true, ...result });
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

router.post('/promote-shared', async (request, response) => {
    if (!request.body?.name || !request.body?.sharedName) {
        return response.sendStatus(400);
    }

    try {
        const ownerHandles = await validateSharedOwnerHandles(request.body.ownerHandles, request.user?.profile?.handle);
        const result = await promoteLorebookToShared(request.user, request.body.name, request.body.sharedName, ownerHandles, {
            overwriteExistingShared: Boolean(request.body.forceOverwriteShared),
        });
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

router.post('/shared/owners', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const ownerHandles = await validateSharedOwnerHandles(request.body.ownerHandles, request.user?.profile?.handle);
        const result = await updateSharedLorebookOwners(request.user, request.body.name, ownerHandles);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/checkout', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const result = await checkoutSharedLorebook(request.user, request.body.name, Boolean(request.body.force));
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/checkin', async (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    try {
        const result = await checkinSharedLorebook(request.user, request.body.name, Boolean(request.body.force));
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/unshare', requireAdminMiddleware, async (request, response) => {
    if (!request.body?.name || !request.body?.targetOwnerHandle) {
        return response.sendStatus(400);
    }

    try {
        const targetOwnerHandle = await validateEnabledHandle(request.body.targetOwnerHandle);
        const result = await unshareLorebook(request.user, request.body.name, targetOwnerHandle);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/hidden-templates/get', requireAdminMiddleware, async (_request, response) => {
    try {
        const data = readHiddenLorebookTemplates();
        return response.send({ ok: true, data });
    } catch (error) {
        return response.status(500).send({
            error: {
                message: String(error?.message || error),
            },
        });
    }
});

router.post('/hidden-templates/save', requireAdminMiddleware, async (request, response) => {
    try {
        const data = await withLorebookManagementTransaction(() => writeHiddenLorebookTemplates(request.body ?? {}));
        return response.send({ ok: true, data });
    } catch (error) {
        return response.status(500).send({
            error: {
                message: String(error?.message || error),
            },
        });
    }
});

router.post('/hidden-templates/compile', requireAdminMiddleware, async (_request, response) => {
    try {
        const result = await withLorebookManagementTransaction(() => compileAndWriteHiddenLorebookTemplates());
        return response.send({ ok: true, ...result });
    } catch (error) {
        return response.status(500).send({
            error: {
                message: String(error?.message || error),
            },
        });
    }
});

router.post('/sorted-entries', async (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    try {
        const payload = await resolveSortedEntriesPayload(request.user, request.body);
        return response.send(sanitizeSortedEntriesPayloadForResponse(request.user, payload));
    } catch (error) {
        return sendLorebookError(response, error);
    }
});

router.post('/timed-effects/recompute', async (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    try {
        const timedWorldInfo = await recomputeTimedWorldInfoFromChat(request.user, request.body);
        return response.send({ timedWorldInfo });
    } catch (error) {
        return sendLorebookError(response, error);
    }
});
