import crypto from 'node:crypto';
import fs from 'node:fs';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import {
    createUserLorebookForManagement,
    getLorebookForManagement,
    listLorebooksForManagement,
    LorebookRepositoryError,
    withLorebookManagementTransaction,
} from './lorebook-repository.js';
import {
    getCharacterOwnerHandles,
    getRecommendedChatSetupKey,
} from './character-linked-lorebooks.js';
import {
    getPublishedRecommendedSetup,
    getRecommendedTemplateDraft,
    mutateRecommendedTemplateStore,
    publishRecommendedSetup,
    readPublishedSidePrompts,
    readPublishedTemplate,
    withRecommendedTemplateStoreLock,
} from './recommended-chat-template-store.js';
import {
    mutateStmbSidePrompts,
    readStmbSidePrompts,
} from './stmb-side-prompts-repository.js';
import { getUserDirectories } from './users.js';

export class RecommendedChatSetupError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.name = type;
        this.type = type;
        this.status = status;
    }
}

function normalizeCharacterName(card) {
    return String(card?.data?.name || card?.name || '').trim();
}

function normalizeCharacterKey(card) {
    return String(getRecommendedChatSetupKey(card) || '').trim();
}

function assertCanManage(user, card) {
    const owners = getCharacterOwnerHandles(card);
    const handle = String(user?.profile?.handle || '').trim();
    if (!user?.profile?.admin && owners.length > 0 && !owners.includes(handle)) {
        throw new RecommendedChatSetupError('RecommendedSetupForbidden', 'Only botmakers and admins can configure this setup.', 403);
    }
}

function assertCanManageDraft(user, card, draft) {
    assertCanManage(user, card);
    if (!draft || user?.profile?.admin) return;
    const handle = String(user?.profile?.handle || '').trim();
    const managerHandles = Array.isArray(draft.managerHandles) ? draft.managerHandles : [];
    if (!managerHandles.includes(handle)) {
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

/** Normalizes only the case-insensitive reserved Blank suffix. */
function normalizeTemplateBlankSuffix(name) {
    return String(name || '').replace(/Blank$/i, 'Blank');
}

function assertEligibleTemplateName(characterName, requestedName) {
    const canonicalName = sanitize(String(requestedName || '').trim()).replace(/\.json$/i, '');
    if (!getEligibleTemplateNames(characterName).has(normalizeTemplateBlankSuffix(canonicalName))) {
        throw new RecommendedChatSetupError(
            'RecommendedSetupTemplateNameInvalid',
            'The blank lorebook template name does not match this character.',
            400,
        );
    }
    return canonicalName;
}

function getUserForHandle(user, handle) {
    const normalizedHandle = String(handle || '').trim();
    if (normalizedHandle === String(user?.profile?.handle || '').trim()) return user;
    return {
        profile: { handle: normalizedHandle, admin: false },
        directories: getUserDirectories(normalizedHandle),
    };
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
    return {
        available: Boolean(entry.hasTemplate || entry.hasSidePrompts),
        revision: String(entry.revision || ''),
        botmakerName: String(entry.botmakerName || ''),
        hasTemplate: Boolean(entry.hasTemplate),
        hasSidePrompts: Boolean(entry.hasSidePrompts),
        sidePromptSetName: entry.hasSidePrompts ? String(entry.sidePromptSetName || entry.characterName || '') : '',
        sidePromptCount: entry.hasSidePrompts ? Number(entry.sidePromptCount || 0) : 0,
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

function installSidePrompts(document, entry, sidePrompts, conflictMode) {
    const next = document && typeof document === 'object' ? document : { version: 2, prompts: {}, sets: {} };
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
    for (const [sourceKey, sourcePrompt] of Object.entries(sidePrompts.prompts || {})) {
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
            recommendedSetup: { characterKey: entry.characterKey, revision: entry.revision },
        };
    }
    next.sets[targetSetKey] = {
        ...structuredClone(sidePrompts.set),
        key: targetSetKey,
        name: entry.characterName,
        items: sidePrompts.set.items.map((item, index) => ({
            ...structuredClone(item),
            id: makeItemId(entry.characterKey, item.id || item.promptKey, index),
            promptKey: promptKeyMap.get(item.promptKey),
        })),
        updatedAt: new Date().toISOString(),
        recommendedSetup: { characterKey: entry.characterKey, revision: entry.revision },
    };
    return {
        document: next,
        setKey: targetSetKey,
        setName: entry.characterName,
        sidePromptCount: next.sets[targetSetKey].items.length,
        keptExisting: false,
    };
}

/** Returns draft configuration state to an authorized botmaker. */
export function getRecommendedChatSetupManagement(user, card) {
    const characterKey = normalizeCharacterKey(card);
    const draft = characterKey ? getRecommendedTemplateDraft(characterKey) : null;
    assertCanManageDraft(user, card, draft);
    const eligibleNames = getEligibleTemplateNames(normalizeCharacterName(card));
    const eligibleTemplateNames = listLorebooksForManagement(user)
        .filter(item => item.storage === 'user' && eligibleNames.has(normalizeTemplateBlankSuffix(item.name)))
        .map(item => item.name);
    return {
        available: Boolean(draft?.templateSourceName || draft?.sidePromptSetKey),
        characterKey,
        templateSourceName: String(draft?.templateSourceName || ''),
        sidePromptSetKey: String(draft?.sidePromptSetKey || ''),
        eligibleTemplateNames,
    };
}

/** Saves private draft bindings without copying their contents. */
export async function saveRecommendedChatSetup(user, card, input = {}) {
    assertCanManage(user, card);
    const characterKey = normalizeCharacterKey(card);
    const characterName = normalizeCharacterName(card);
    if (!characterKey || !characterName) {
        throw new RecommendedChatSetupError('RecommendedSetupCharacterInvalid', 'Recommended Chat Setup identity is missing.', 400);
    }

    const actorHandle = String(user?.profile?.handle || '').trim();
    return await withLorebookManagementTransaction(async () => await mutateRecommendedTemplateStore(index => {
        const previous = index.drafts[characterKey] || null;
        assertCanManageDraft(user, card, previous);
        const templateAction = String(input.templateAction || 'keep');
        let templateSourceName = String(previous?.templateSourceName || '');
        let templateSourceOwnerHandle = String(previous?.templateSourceOwnerHandle || '');
        if (templateAction === 'replace') {
            templateSourceName = assertEligibleTemplateName(characterName, input.templateSourceName);
            const eligibleOrdinarySource = listLorebooksForManagement(user)
                .some(item => item.name === templateSourceName && item.storage === 'user');
            if (!eligibleOrdinarySource) {
                throw new RecommendedChatSetupError('RecommendedSetupTemplateUnavailable', 'The selected blank lorebook template is unavailable.', 404);
            }
            const source = getLorebookForManagement(user, templateSourceName, false, 'user');
            if (source?.metadata?.storage !== 'user') {
                throw new RecommendedChatSetupError('RecommendedSetupTemplateUnavailable', 'The selected blank lorebook template is unavailable.', 404);
            }
            const reservedElsewhere = Object.entries(index.drafts).some(([key, draft]) =>
                key !== characterKey
                && String(draft?.templateSourceOwnerHandle || '') === actorHandle
                && String(draft?.templateSourceName || '') === templateSourceName,
            );
            if (reservedElsewhere) {
                throw new RecommendedChatSetupError('RecommendedSetupTemplateReserved', 'That lorebook is already designated for another character.', 409);
            }
            templateSourceOwnerHandle = actorHandle;
        } else if (templateAction === 'remove') {
            templateSourceName = '';
            templateSourceOwnerHandle = '';
        } else if (templateAction !== 'keep') {
            throw new RecommendedChatSetupError('RecommendedSetupBadRequest', 'Invalid template action.', 400);
        }

        let sidePromptSetKey = String(previous?.sidePromptSetKey || '');
        let sidePromptSourceOwnerHandle = String(previous?.sidePromptSourceOwnerHandle || '');
        if (Object.hasOwn(input, 'sidePromptSetKey')) {
            sidePromptSetKey = String(input.sidePromptSetKey || '').trim();
            if (sidePromptSetKey) snapshotSidePromptSet(user, sidePromptSetKey);
            sidePromptSourceOwnerHandle = sidePromptSetKey ? actorHandle : '';
        }

        index.drafts[characterKey] = {
            characterKey,
            characterName,
            ownerHandles: getCharacterOwnerHandles(card),
            managerHandles: previous?.managerHandles || [...new Set([...getCharacterOwnerHandles(card), actorHandle].filter(Boolean))],
            botmakerName: String(user?.profile?.name || card?.data?.creator || user?.profile?.handle || '').trim(),
            templateSourceName,
            templateSourceOwnerHandle,
            sidePromptSetKey,
            sidePromptSourceOwnerHandle,
            updatedAt: new Date().toISOString(),
        };

        return {
            available: Boolean(templateSourceName || sidePromptSetKey),
            characterKey,
            templateSourceName,
            sidePromptSetKey,
        };
    }));
}

/** Stages the current draft contents for a character submission. */
export function stageRecommendedChatSetupForSubmission(user, card, stagingPath) {
    const characterKey = normalizeCharacterKey(card);
    if (!characterKey) return null;
    const draft = getRecommendedTemplateDraft(characterKey);
    if (!draft) return null;
    assertCanManageDraft(user, card, draft);

    const characterName = normalizeCharacterName(card);
    let templateData = null;
    if (draft.templateSourceName) {
        assertEligibleTemplateName(characterName, draft.templateSourceName);
        const sourceUser = getUserForHandle(user, draft.templateSourceOwnerHandle);
        let source;
        try {
            source = getLorebookForManagement(sourceUser, draft.templateSourceName, false, 'user');
        } catch {
            throw new RecommendedChatSetupError('RecommendedSetupTemplateUnavailable', 'The designated blank lorebook template is unavailable.', 400);
        }
        if (!source?.data?.entries || typeof source.data.entries !== 'object' || Array.isArray(source.data.entries)) {
            throw new RecommendedChatSetupError('RecommendedSetupTemplateUnavailable', 'The designated blank lorebook template is invalid.', 400);
        }
        templateData = structuredClone(source.data);
    }

    let sidePrompts = null;
    if (draft.sidePromptSetKey) {
        sidePrompts = snapshotSidePromptSet(getUserForHandle(user, draft.sidePromptSourceOwnerHandle), draft.sidePromptSetKey);
    }

    const staged = {
        characterKey,
        characterName,
        botmakerName: String(user?.profile?.name || card?.data?.creator || draft.botmakerName || '').trim(),
        hasTemplate: Boolean(templateData),
        hasSidePrompts: Boolean(sidePrompts),
        templateData,
        sidePrompts,
    };
    staged.revision = crypto.createHash('sha256').update(JSON.stringify(staged)).digest('hex');
    writeFileAtomicSync(stagingPath, JSON.stringify(staged, null, 2), 'utf8');
    return { characterKey, revision: staged.revision };
}

/** Publishes a previously staged setup during character approval. */
export async function publishStagedRecommendedChatSetup(stagingPath) {
    if (!stagingPath || !fs.existsSync(stagingPath)) return null;
    const staged = JSON.parse(fs.readFileSync(stagingPath, 'utf8'));
    return await publishRecommendedSetup(staged.characterKey, staged);
}

/** Deletes a submission-scoped setup snapshot without changing publication. */
export function removeStagedRecommendedChatSetup(stagingPath) {
    if (stagingPath && fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { force: true });
}

/** Returns the content-free current publication summary for consumers. */
export function getRecommendedChatSetupSummary(card) {
    const characterKey = normalizeCharacterKey(card);
    return buildPublicSummary(characterKey ? getPublishedRecommendedSetup(characterKey) : null);
}

/** Reports consumer conflicts against the current published revision. */
export function preflightRecommendedChatSetup(user, card, lorebookName = '') {
    const characterKey = normalizeCharacterKey(card);
    const entry = characterKey ? getPublishedRecommendedSetup(characterKey) : null;
    const summary = buildPublicSummary(entry);
    if (!summary.available) throw new RecommendedChatSetupError('RecommendedSetupNotFound', 'No Recommended Chat Setup is available.', 404);
    let lorebookConflict = false;
    const normalizedLorebookName = String(lorebookName || '').trim();
    if (summary.hasTemplate && normalizedLorebookName) {
        try {
            const existing = getLorebookForManagement(user, normalizedLorebookName, false, 'user');
            const provenance = existing?.data?.extensions?.aikobots?.recommended_chat_setup;
            lorebookConflict = provenance?.characterKey !== characterKey || provenance?.revision !== entry.revision;
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

/** Copies the latest published components into user-owned storage. */
export async function applyRecommendedChatSetup(user, card, input = {}) {
    const published = await withRecommendedTemplateStoreLock(async () => {
        const characterKey = normalizeCharacterKey(card);
        const entry = characterKey ? getPublishedRecommendedSetup(characterKey) : null;
        const summary = buildPublicSummary(entry);
        if (!summary.available || String(input.revision || '') !== String(entry?.revision || '')) {
            throw new RecommendedChatSetupError('RecommendedSetupChanged', 'The recommendation changed. Reopen Recommended Chat Setup.', 409);
        }
        return {
            characterKey,
            entry,
            summary,
            templateData: summary.hasTemplate ? readPublishedTemplate(characterKey, entry.revision) : null,
            sidePrompts: summary.hasSidePrompts ? readPublishedSidePrompts(characterKey, entry.revision) : null,
        };
    });
    const { characterKey, entry, summary, templateData, sidePrompts } = published;

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
        if (existing && (provenance?.characterKey !== characterKey || provenance?.revision !== entry.revision)) {
            throw new RecommendedChatSetupError('RecommendedSetupLorebookConflict', 'A lorebook with that name already exists.', 409);
        }
        if (!existing) {
            templateData.extensions ??= {};
            templateData.extensions.aikobots ??= {};
            templateData.extensions.aikobots.recommended_chat_setup = { characterKey, revision: entry.revision };
            await createUserLorebookForManagement(user, lorebookName, templateData);
        }
    }

    let sidePromptSetKey = '';
    let sidePromptSetName = '';
    let sidePromptCount = 0;
    let keptExistingSidePrompts = false;
    if (input.installSidePrompts && summary.hasSidePrompts) {
        await mutateStmbSidePrompts(user, document => {
            const installed = installSidePrompts(document, entry, sidePrompts, String(input.sidePromptConflictMode || ''));
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
        revision: entry.revision,
    };
}
