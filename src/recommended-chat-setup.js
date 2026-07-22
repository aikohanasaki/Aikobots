import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { withDirectoryLock } from './file-system-lock.js';
import {
    createUserLorebookForManagement,
    getLorebookForManagement,
    LorebookRepositoryError,
} from './lorebook-repository.js';
import {
    getCharacterOwnerHandles,
    getCharacterSharedKey,
} from './character-linked-lorebooks.js';
import {
    mutateStmbSidePrompts,
    readStmbSidePrompts,
} from './stmb-side-prompts-repository.js';

const STORE_DIRECTORY = ['_secure', 'recommended-chat-setups'];
const INDEX_FILENAME = 'index.json';
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
const LOCK_HEARTBEAT_MS = 10_000;
let mutationQueue = Promise.resolve();

export class RecommendedChatSetupError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.name = type;
        this.type = type;
        this.status = status;
    }
}

function getStoreRoot() {
    if (!globalThis.DATA_ROOT) {
        throw new Error('DATA_ROOT must be defined before using recommended chat setups');
    }
    const root = path.join(globalThis.DATA_ROOT, ...STORE_DIRECTORY);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function getIndexPath() {
    return path.join(getStoreRoot(), INDEX_FILENAME);
}

function getLockPath() {
    return path.join(getStoreRoot(), `${INDEX_FILENAME}.lock`);
}

function getTemplatePath(characterKey) {
    const token = crypto.createHash('sha256').update(characterKey).digest('hex');
    return path.join(getStoreRoot(), `${token}.template.json`);
}

function normalizeIndex(parsed) {
    const setups = parsed?.setups && typeof parsed.setups === 'object' && !Array.isArray(parsed.setups)
        ? parsed.setups
        : {};
    return { version: 1, setups };
}

function readIndex() {
    if (!fs.existsSync(getIndexPath())) {
        return { version: 1, setups: {} };
    }
    try {
        return normalizeIndex(JSON.parse(fs.readFileSync(getIndexPath(), 'utf8')));
    } catch {
        throw new RecommendedChatSetupError('RecommendedSetupUnavailable', 'Recommended Chat Setup is temporarily unavailable.', 503);
    }
}

function writeIndex(index) {
    writeFileAtomicSync(getIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

async function runWithLock(operation) {
    const queued = mutationQueue.catch(() => {}).then(() => withDirectoryLock({
        lockPath: getLockPath(),
        retryMs: LOCK_RETRY_MS,
        timeoutMs: LOCK_TIMEOUT_MS,
        staleMs: LOCK_STALE_MS,
        heartbeatMs: LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update Recommended Chat Setup.',
    }, operation));
    mutationQueue = queued.catch(() => {});
    return await queued;
}

function normalizeCharacterName(card) {
    return String(card?.data?.name || card?.name || '').trim();
}

function normalizeCharacterKey(card) {
    return sanitize(getCharacterSharedKey(card)).trim();
}

function assertCanManage(user, card) {
    const owners = getCharacterOwnerHandles(card);
    const handle = String(user?.profile?.handle || '').trim();
    if (!user?.profile?.admin && (owners.length === 0 || !owners.includes(handle))) {
        throw new RecommendedChatSetupError('RecommendedSetupForbidden', 'Only botmakers and admins can configure this setup.', 403);
    }
}

function getEligibleTemplateNames(characterName) {
    const safeName = sanitize(characterName).trim();
    return new Set([
        `LTM - ${safeName} - Blank`,
        `LTM-${safeName}-Blank`,
    ]);
}

function assertEligibleTemplateName(characterName, requestedName) {
    const canonicalName = sanitize(String(requestedName || '').trim()).replace(/\.json$/i, '');
    if (!getEligibleTemplateNames(characterName).has(canonicalName)) {
        throw new RecommendedChatSetupError(
            'RecommendedSetupTemplateNameInvalid',
            'The blank lorebook template name does not match this character.',
            400,
        );
    }
    return canonicalName;
}

function snapshotSidePromptSet(user, setKey) {
    const normalizedKey = String(setKey || '').trim();
    if (!normalizedKey) return null;
    const { document } = readStmbSidePrompts(user);
    const set = document?.sets?.[normalizedKey];
    if (!set) {
        throw new RecommendedChatSetupError('RecommendedSetupSidePromptsMissing', 'The selected side-prompt set no longer exists.', 404);
    }
    if (!Array.isArray(set.items)) {
        throw new RecommendedChatSetupError('RecommendedSetupSidePromptsInvalid', 'The selected side-prompt set is invalid.', 400);
    }
    const prompts = {};
    for (const item of set.items) {
        const promptKey = String(item?.promptKey || '').trim();
        const prompt = document?.prompts?.[promptKey];
        const validPrompt = prompt
            && typeof prompt === 'object'
            && !Array.isArray(prompt)
            && typeof prompt.name === 'string'
            && typeof prompt.enabled === 'boolean'
            && typeof prompt.prompt === 'string'
            && prompt.settings && typeof prompt.settings === 'object' && !Array.isArray(prompt.settings)
            && prompt.triggers && typeof prompt.triggers === 'object' && !Array.isArray(prompt.triggers);
        if (!item || typeof item !== 'object' || Array.isArray(item) || !validPrompt) {
            throw new RecommendedChatSetupError('RecommendedSetupSidePromptsInvalid', 'The selected side-prompt set has a missing prompt.', 400);
        }
        prompts[promptKey] = structuredClone(prompt);
    }
    return {
        sourceSetKey: normalizedKey,
        sourceSetName: String(set.name || '').trim(),
        set: structuredClone(set),
        prompts,
    };
}

function buildPublicSummary(entry) {
    if (!entry) return { available: false };
    const hasTemplate = Boolean(entry.hasTemplate && fs.existsSync(getTemplatePath(entry.characterKey)));
    const sidePromptCount = Array.isArray(entry.sidePrompts?.set?.items) ? entry.sidePrompts.set.items.length : 0;
    const hasSidePrompts = Boolean(entry.sidePrompts);
    return {
        available: hasTemplate || hasSidePrompts,
        version: Number(entry.version) || 1,
        botmakerName: String(entry.botmakerName || ''),
        hasTemplate,
        hasSidePrompts,
        sidePromptSetName: hasSidePrompts ? String(entry.characterName || '') : '',
        sidePromptCount,
    };
}

function safeSlug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 45) || 'character';
}

function makeItemId(characterKey, sourceId, index) {
    const hash = crypto.createHash('sha256').update(`${characterKey}:${sourceId}:${index}`).digest('hex').slice(0, 12);
    return `recommended-${hash}`;
}

function makePromptKey(characterKey, sourceKey) {
    const hash = crypto.createHash('sha256').update(`${characterKey}:${sourceKey}`).digest('hex').slice(0, 12);
    return `recommended-${safeSlug(characterKey)}-${hash}`;
}

function findSetByCharacterName(document, characterName) {
    const target = String(characterName || '').trim().toLocaleLowerCase();
    return Object.values(document?.sets || {}).find(set => String(set?.name || '').trim().toLocaleLowerCase() === target) || null;
}

function installSidePrompts(document, entry, conflictMode) {
    const next = document && typeof document === 'object'
        ? document
        : { version: 2, prompts: {}, sets: {} };
    next.prompts ??= {};
    next.sets ??= {};
    const existing = findSetByCharacterName(next, entry.characterName);
    if (existing && conflictMode === 'keep') {
        return {
            document: next,
            setKey: existing.key,
            setName: String(existing.name || entry.characterName),
            sidePromptCount: Array.isArray(existing.items) ? existing.items.length : 0,
            keptExisting: true,
        };
    }
    if (existing && conflictMode !== 'overwrite') {
        throw new RecommendedChatSetupError('RecommendedSetupSidePromptsConflict', 'A side prompt set for this character already exists.', 409);
    }

    const targetSetKey = existing?.key || (() => {
        const base = safeSlug(entry.characterName);
        let candidate = base;
        let suffix = 2;
        while (next.sets[candidate]) candidate = `${base}-${suffix++}`;
        return candidate;
    })();
    const promptKeyMap = new Map();
    for (const [sourceKey, sourcePrompt] of Object.entries(entry.sidePrompts.prompts || {})) {
        let promptKey = makePromptKey(entry.characterKey, sourceKey);
        let suffix = 2;
        while (next.prompts[promptKey]
            && next.prompts[promptKey]?.recommendedSetup?.characterKey !== entry.characterKey) {
            promptKey = `${makePromptKey(entry.characterKey, sourceKey)}-${suffix++}`;
        }
        promptKeyMap.set(sourceKey, promptKey);
        next.prompts[promptKey] = {
            ...structuredClone(sourcePrompt),
            key: promptKey,
            recommendedSetup: { characterKey: entry.characterKey, version: entry.version },
        };
    }
    next.sets[targetSetKey] = {
        ...structuredClone(entry.sidePrompts.set),
        key: targetSetKey,
        name: entry.characterName,
        items: entry.sidePrompts.set.items.map((item, index) => ({
            ...structuredClone(item),
            id: makeItemId(entry.characterKey, item.id || item.promptKey, index),
            promptKey: promptKeyMap.get(item.promptKey),
        })),
        updatedAt: new Date().toISOString(),
        recommendedSetup: { characterKey: entry.characterKey, version: entry.version },
    };
    return {
        document: next,
        setKey: targetSetKey,
        setName: entry.characterName,
        sidePromptCount: next.sets[targetSetKey].items.length,
        keptExisting: false,
    };
}

/** Returns the private configuration state safe for the owning botmaker UI. */
export function getRecommendedChatSetupManagement(user, card) {
    assertCanManage(user, card);
    const characterKey = normalizeCharacterKey(card);
    if (!characterKey) {
        return { available: false, hasTemplate: false, sidePromptSetKey: '' };
    }
    const entry = readIndex().setups[characterKey] || null;
    return {
        available: Boolean(entry),
        hasTemplate: Boolean(entry?.hasTemplate && fs.existsSync(getTemplatePath(characterKey))),
        sidePromptSetKey: String(entry?.sidePrompts?.sourceSetKey || ''),
    };
}

/** Saves a character's private recommendation without exposing the secure template binding. */
export async function saveRecommendedChatSetup(user, card, input = {}) {
    assertCanManage(user, card);
    const characterKey = normalizeCharacterKey(card);
    const characterName = normalizeCharacterName(card);
    if (!characterKey || !characterName) {
        throw new RecommendedChatSetupError('RecommendedSetupCharacterInvalid', 'Share the character before configuring Recommended Chat Setup.', 400);
    }

    return await runWithLock(async () => {
        const index = readIndex();
        const previous = index.setups[characterKey] || null;
        const templateAction = String(input.templateAction || 'keep');
        let templateData = null;
        let hasTemplate = Boolean(previous?.hasTemplate && fs.existsSync(getTemplatePath(characterKey)));
        if (templateAction === 'replace') {
            const templateName = assertEligibleTemplateName(characterName, input.templateSourceName);
            let source;
            try {
                source = getLorebookForManagement(user, templateName, false, 'secure');
                if (!source?.data
                    || typeof source.data !== 'object'
                    || Array.isArray(source.data)
                    || !source.data.entries
                    || typeof source.data.entries !== 'object'
                    || Array.isArray(source.data.entries)) {
                    throw new Error('Invalid template');
                }
            } catch {
                throw new RecommendedChatSetupError(
                    'RecommendedSetupTemplateUnavailable',
                    'The selected secure blank lorebook template is unavailable.',
                    404,
                );
            }
            templateData = structuredClone(source.data);
            hasTemplate = true;
        } else if (templateAction === 'remove') {
            hasTemplate = false;
        } else if (templateAction !== 'keep') {
            throw new RecommendedChatSetupError('RecommendedSetupBadRequest', 'Invalid template action.', 400);
        }

        const sidePrompts = snapshotSidePromptSet(user, input.sidePromptSetKey);
        if (!hasTemplate && !sidePrompts) {
            delete index.setups[characterKey];
            writeIndex(index);
            if (fs.existsSync(getTemplatePath(characterKey))) fs.rmSync(getTemplatePath(characterKey), { force: true });
            return { available: false };
        }

        const version = Number(previous?.version || 0) + 1;
        const entry = {
            characterKey,
            characterName,
            botmakerName: String(user?.profile?.name || card?.data?.creator || user?.profile?.handle || '').trim(),
            version,
            hasTemplate,
            sidePrompts,
            updatedAt: new Date().toISOString(),
        };
        if (templateData) writeFileAtomicSync(getTemplatePath(characterKey), JSON.stringify(templateData, null, 2), 'utf8');
        index.setups[characterKey] = entry;
        writeIndex(index);
        if (!hasTemplate && fs.existsSync(getTemplatePath(characterKey))) fs.rmSync(getTemplatePath(characterKey), { force: true });
        return buildPublicSummary(entry);
    });
}

/** Returns the public, content-free recommendation summary for a character. */
export function getRecommendedChatSetupSummary(card) {
    const characterKey = normalizeCharacterKey(card);
    return characterKey ? buildPublicSummary(readIndex().setups[characterKey] || null) : { available: false };
}

/** Checks user-owned resource conflicts without returning setup contents. */
export function preflightRecommendedChatSetup(user, card, lorebookName = '') {
    const characterKey = normalizeCharacterKey(card);
    const entry = characterKey ? readIndex().setups[characterKey] : null;
    const summary = buildPublicSummary(entry);
    if (!summary.available) throw new RecommendedChatSetupError('RecommendedSetupNotFound', 'No Recommended Chat Setup is available.', 404);
    let lorebookConflict = false;
    const normalizedLorebookName = String(lorebookName || '').trim();
    if (summary.hasTemplate && normalizedLorebookName) {
        try {
            const existing = getLorebookForManagement(user, normalizedLorebookName, false, 'user');
            lorebookConflict = existing?.data?.extensions?.aikobots?.recommended_chat_setup?.characterKey !== characterKey
                || Number(existing?.data?.extensions?.aikobots?.recommended_chat_setup?.version) !== Number(entry.version);
        } catch (error) {
            if (!(error instanceof LorebookRepositoryError) || error.status !== 404) throw error;
        }
    }
    const existingSet = summary.hasSidePrompts ? findSetByCharacterName(readStmbSidePrompts(user).document, entry.characterName) : null;
    return {
        ...summary,
        lorebookConflict,
        sidePromptConflict: Boolean(existingSet),
        existingSidePromptSetKey: String(existingSet?.key || ''),
    };
}

/** Copies the recommended components into user-owned storage. */
export async function applyRecommendedChatSetup(user, card, input = {}) {
    return await runWithLock(async () => {
        const characterKey = normalizeCharacterKey(card);
        const entry = characterKey ? readIndex().setups[characterKey] : null;
        const summary = buildPublicSummary(entry);
        if (!summary.available || Number(input.version) !== Number(entry.version)) {
            throw new RecommendedChatSetupError('RecommendedSetupChanged', 'The recommendation changed. Reopen Recommended Chat Setup.', 409);
        }

        let lorebookName = '';
        if (input.installLorebook && summary.hasTemplate) {
            lorebookName = String(input.lorebookName || '').trim();
            if (!lorebookName) throw new RecommendedChatSetupError('RecommendedSetupLorebookNameRequired', 'Enter a lorebook name.', 400);
            let existing = null;
            try {
                existing = getLorebookForManagement(user, lorebookName, false, 'user');
            } catch (error) {
                if (!(error instanceof LorebookRepositoryError) || error.status !== 404) throw error;
            }
            const provenance = existing?.data?.extensions?.aikobots?.recommended_chat_setup;
            if (existing && (provenance?.characterKey !== characterKey || Number(provenance?.version) !== Number(entry.version))) {
                throw new RecommendedChatSetupError('RecommendedSetupLorebookConflict', 'A lorebook with that name already exists.', 409);
            }
            if (!existing) {
                const templateData = JSON.parse(fs.readFileSync(getTemplatePath(characterKey), 'utf8'));
                templateData.extensions ??= {};
                templateData.extensions.aikobots ??= {};
                templateData.extensions.aikobots.recommended_chat_setup = { characterKey, version: entry.version };
                await createUserLorebookForManagement(user, lorebookName, templateData);
            }
        }

        let sidePromptSetKey = '';
        let sidePromptSetName = '';
        let sidePromptCount = 0;
        let keptExistingSidePrompts = false;
        if (input.installSidePrompts && summary.hasSidePrompts) {
            await mutateStmbSidePrompts(user, document => {
                const installed = installSidePrompts(document, entry, String(input.sidePromptConflictMode || ''));
                sidePromptSetKey = installed.setKey;
                sidePromptSetName = installed.setName;
                sidePromptCount = installed.sidePromptCount;
                keptExistingSidePrompts = installed.keptExisting;
                return installed.document;
            });
        }
        return {
            lorebookName,
            sidePromptSetKey,
            sidePromptSetName,
            sidePromptCount,
            keptExistingSidePrompts,
            version: entry.version,
        };
    });
}
