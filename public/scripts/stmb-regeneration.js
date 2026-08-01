import { stableHashString } from './hashing.js';
import { isValidAikobotsUuid } from './chat-identities.js';
import { parseSequenceFromTitle, STMB_MANAGED_FLAG } from './stmb-core.js';
import { getEntrySummaryTier } from './stmb-summary.js';

export const SIDE_PROMPT_REGENERATION_METADATA_KEY = 'STMB_sidePromptRegeneration';
export const SIDE_PROMPT_REGENERATION_SNAPSHOT_VERSION = 1;

const SIDE_PROMPT_TITLE_SUFFIXES = [
    ' (STMB SidePrompt)',
    ' (STMB Plotpoints)',
    ' (STMB Scoreboard)',
    ' (STMB Tracker)',
];

/** Returns whether an entry title belongs to a side-prompt output. */
export function isSidePromptRegenerationEntry(entry) {
    const title = String(entry?.comment || entry?.title || '').trimEnd();
    return SIDE_PROMPT_TITLE_SUFFIXES.some(suffix => title.endsWith(suffix));
}

/** Captures the compact inputs needed to repeat one side-prompt run. */
export function buildSidePromptRegenerationSnapshot({
    templateKey,
    priorContent = '',
    compiledScene,
    runtimeMacros = {},
} = {}) {
    const metadata = compiledScene?.metadata || {};
    return {
        version: SIDE_PROMPT_REGENERATION_SNAPSHOT_VERSION,
        templateKey: String(templateKey || '').trim(),
        priorContent: String(priorContent || ''),
        sceneStart: Number(metadata.sceneStart),
        sceneEnd: Number(metadata.sceneEnd),
        sceneStartUuid: String(metadata.sceneStartUuid || ''),
        sceneEndUuid: String(metadata.sceneEndUuid || ''),
        chatId: String(metadata.chatId || ''),
        runtimeMacros: Object.fromEntries(
            Object.entries(runtimeMacros || {}).map(([key, value]) => [String(key), String(value ?? '')]),
        ),
    };
}

/** Returns a valid persisted side-prompt run snapshot, or null. */
export function getSidePromptRegenerationSnapshot(entry) {
    const snapshot = entry?.[SIDE_PROMPT_REGENERATION_METADATA_KEY];
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    if (snapshot.version !== SIDE_PROMPT_REGENERATION_SNAPSHOT_VERSION) return null;
    if (typeof snapshot.templateKey !== 'string' || !snapshot.templateKey.trim()) return null;
    if (typeof snapshot.priorContent !== 'string' || snapshot.priorContent.length > 1_000_000) return null;
    if (!Number.isInteger(snapshot.sceneStart) || snapshot.sceneStart < 0) return null;
    if (!Number.isInteger(snapshot.sceneEnd) || snapshot.sceneEnd < snapshot.sceneStart) return null;
    if (!isValidAikobotsUuid(snapshot.sceneStartUuid) || !isValidAikobotsUuid(snapshot.sceneEndUuid)) return null;
    if (typeof snapshot.chatId !== 'string' || !snapshot.chatId.trim()) return null;
    if (!snapshot.runtimeMacros || typeof snapshot.runtimeMacros !== 'object' || Array.isArray(snapshot.runtimeMacros)) return null;
    const macroEntries = Object.entries(snapshot.runtimeMacros);
    if (macroEntries.length > 100 || macroEntries.some(([key, value]) => key.length > 500 || typeof value !== 'string' || value.length > 10_000)) return null;
    return snapshot;
}

/** Returns a stable string UID for a lorebook entry. */
export function getRegenerationEntryUid(entry) {
    const uid = entry?.uid;
    return uid === undefined || uid === null ? null : String(uid);
}

/** Builds the entry and parent-link indexes used by regeneration checks. */
export function buildRegenerationIndexes(lorebookData) {
    const entries = Object.values(lorebookData?.entries || {});
    const entriesByUid = new Map();
    const legacySourceUidsByParentUid = new Map();

    for (const entry of entries) {
        const uid = getRegenerationEntryUid(entry);
        if (uid === null) continue;
        entriesByUid.set(uid, entry);

        const parentUid = entry?.disabledBySummaryId;
        if (parentUid === undefined || parentUid === null || parentUid === '') continue;
        const normalizedParentUid = String(parentUid);
        const sourceUids = legacySourceUidsByParentUid.get(normalizedParentUid) || [];
        sourceUids.push(uid);
        legacySourceUidsByParentUid.set(normalizedParentUid, sourceUids);
    }

    const parentConsolidationsBySourceUid = new Map();
    for (const parent of entries) {
        if (getEntrySummaryTier(parent) <= 0) continue;
        const parentUid = getRegenerationEntryUid(parent);
        if (parentUid === null) continue;
        const sourceUids = new Set([
            ...(Array.isArray(parent.stmbSourceEntryUids) ? parent.stmbSourceEntryUids.map(String) : []),
            ...(legacySourceUidsByParentUid.get(parentUid) || []),
        ]);
        for (const sourceUid of sourceUids) {
            const parents = parentConsolidationsBySourceUid.get(sourceUid) || [];
            parents.push(parent);
            parentConsolidationsBySourceUid.set(sourceUid, parents);
        }
    }

    return { entriesByUid, legacySourceUidsByParentUid, parentConsolidationsBySourceUid };
}

/** Finds a lorebook entry by its stored UID. */
export function getRegenerationEntryByUid(lorebookData, uid, indexes = null) {
    const normalizedUid = uid === undefined || uid === null ? null : String(uid);
    if (normalizedUid === null) return null;
    if (indexes?.entriesByUid instanceof Map) {
        return indexes.entriesByUid.get(normalizedUid) || null;
    }
    return Object.values(lorebookData?.entries || {})
        .find(entry => getRegenerationEntryUid(entry) === normalizedUid) || null;
}

/** Recovers the original sequence number without allocating a new identity. */
export function getRegenerationSequenceNumber(entry) {
    const directValue = entry?.STMB_canonicalMemoryNumber ?? entry?.STMB_memoryNumber;
    const directNumber = Number(directValue);
    if (directValue !== undefined && directValue !== null && directValue !== '' && Number.isFinite(directNumber) && directNumber >= 0) {
        return Math.trunc(directNumber);
    }
    const parsed = parseSequenceFromTitle(entry?.comment || entry?.title || '');
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

/** Resolves explicit consolidation sources, falling back to legacy disable backlinks. */
export function getRegenerationSourceUids(entry, indexes) {
    const explicit = Array.isArray(entry?.stmbSourceEntryUids)
        ? [...new Set(entry.stmbSourceEntryUids.map(String).filter(Boolean))]
        : [];
    if (explicit.length > 0) {
        return { uids: explicit, source: 'stored' };
    }

    const uid = getRegenerationEntryUid(entry);
    const legacy = uid === null || !(indexes?.legacySourceUidsByParentUid instanceof Map)
        ? []
        : [...new Set(indexes.legacySourceUidsByParentUid.get(uid) || [])];
    return { uids: legacy, source: legacy.length > 0 ? 'legacy-backlinks' : 'missing' };
}

/** Determines whether an entry can be safely regenerated from recoverable inputs. */
export function getRegenerationEligibility(entry, lorebookData, indexes = null) {
    if (entry && Object.hasOwn(entry, SIDE_PROMPT_REGENERATION_METADATA_KEY)) {
        const snapshot = getSidePromptRegenerationSnapshot(entry);
        if (!snapshot || !isSidePromptRegenerationEntry(entry)) {
            return { eligible: false, reason: 'invalid-sideprompt-snapshot' };
        }
        return {
            eligible: true,
            kind: 'sidePrompt',
            sceneStart: snapshot.sceneStart,
            sceneEnd: snapshot.sceneEnd,
            snapshot,
        };
    }
    if (!entry || entry[STMB_MANAGED_FLAG] !== true) {
        return { eligible: false, reason: 'not-memory' };
    }

    const sequenceNumber = getRegenerationSequenceNumber(entry);
    if (!Number.isFinite(sequenceNumber)) {
        return { eligible: false, reason: 'missing-number' };
    }

    const resolvedIndexes = indexes || buildRegenerationIndexes(lorebookData);
    const uid = getRegenerationEntryUid(entry);
    const activeParents = uid === null
        ? []
        : resolvedIndexes.parentConsolidationsBySourceUid.get(uid) || [];
    if (activeParents.length > 0) {
        return { eligible: false, reason: 'active-parent', sequenceNumber };
    }

    const tier = getEntrySummaryTier(entry);
    if (tier > 0) {
        const sourceResult = getRegenerationSourceUids(entry, resolvedIndexes);
        const sources = sourceResult.uids.map(sourceUid => getRegenerationEntryByUid(lorebookData, sourceUid, resolvedIndexes));
        if (sources.length === 0 || sources.some(source => !source)) {
            return { eligible: false, reason: 'missing-sources', tier, sequenceNumber };
        }
        if (sources.some(source => getEntrySummaryTier(source) !== tier - 1)) {
            return { eligible: false, reason: 'wrong-source-tier', tier, sequenceNumber };
        }
        return {
            eligible: true,
            kind: 'consolidation',
            tier,
            sequenceNumber,
            sourceUids: sourceResult.uids,
            sourceResolution: sourceResult.source,
        };
    }

    const sceneStart = Number(entry.STMB_start);
    const sceneEnd = Number(entry.STMB_end);
    if (!Number.isInteger(sceneStart) || !Number.isInteger(sceneEnd) || sceneStart < 0 || sceneEnd < sceneStart) {
        return { eligible: false, reason: 'missing-range', tier: 0, sequenceNumber };
    }
    return { eligible: true, kind: 'memory', tier: 0, sequenceNumber, sceneStart, sceneEnd };
}

/** Selects base memories preceding the target without including later entries. */
export function selectPreviousRegenerationMemories(lorebookData, targetUid, count) {
    const requestedCount = Math.max(0, Math.trunc(Number(count) || 0));
    if (requestedCount === 0) {
        return { summaries: [], actualCount: 0, requestedCount };
    }

    const target = getRegenerationEntryByUid(lorebookData, targetUid);
    const targetNumber = getRegenerationSequenceNumber(target);
    if (!target || !Number.isFinite(targetNumber)) {
        return { summaries: [], actualCount: 0, requestedCount };
    }

    const preceding = Object.values(lorebookData?.entries || {})
        .filter(entry => entry?.[STMB_MANAGED_FLAG] === true && getEntrySummaryTier(entry) === 0 && getRegenerationEntryUid(entry) !== String(targetUid))
        .map((entry, index) => ({ entry, index, number: getRegenerationSequenceNumber(entry) }))
        .filter(item => Number.isFinite(item.number) && item.number < targetNumber)
        .sort((left, right) => left.number - right.number || left.index - right.index)
        .slice(-requestedCount);

    return {
        summaries: preceding.map(({ entry, number }) => ({
            number,
            title: String(entry.comment || ''),
            content: String(entry.content || ''),
            keywords: Array.isArray(entry.key) ? [...entry.key] : [],
            uid: getRegenerationEntryUid(entry),
        })),
        actualCount: preceding.length,
        requestedCount,
    };
}

/** Hashes the complete entry so any concurrent metadata change rejects replacement. */
export function hashRegenerationEntry(entry) {
    const normalize = value => {
        if (Array.isArray(value)) return value.map(normalize);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
    };
    return entry && typeof entry === 'object'
        ? stableHashString(JSON.stringify(normalize(entry)))
        : '';
}

/** Applies an approved replacement while preserving the entry identity and unrelated metadata. */
export function applyRegenerationReplacement(entry, replacement, options = {}) {
    if (options.contentOnly === true) {
        entry.content = String(replacement?.content || '').trim();
        return entry;
    }
    entry.comment = String(replacement?.title || '').trim();
    entry.content = String(replacement?.content || '').trim();
    entry.key = Array.isArray(replacement?.keywords)
        ? replacement.keywords.map(keyword => String(keyword || '').trim()).filter(Boolean)
        : [];

    const hasSourceUids = Object.hasOwn(options, 'sourceUids');
    const sourceUids = Array.isArray(options.sourceUids)
        ? [...new Set(options.sourceUids.map(String).filter(Boolean))]
        : [];
    if (hasSourceUids) {
        if (sourceUids.length > 0) entry.stmbSourceEntryUids = sourceUids;
        else delete entry.stmbSourceEntryUids;
    }

    const parentUid = entry.disabledBySummaryId;
    if (parentUid !== undefined && parentUid !== null && !getRegenerationEntryByUid(options.lorebookData, parentUid)) {
        delete entry.disabledBySummaryId;
        entry.disable = false;
    }
    return entry;
}

/** Checks that a base memory belongs to the currently open chat and one of its visible books. */
export function isRegenerationSourceChatCurrent(entry, lorebookName, currentChatId, currentLorebookNames) {
    const storedChatId = entry?.STMB_chatId;
    if (storedChatId !== undefined && storedChatId !== null && storedChatId !== '' && String(storedChatId) !== String(currentChatId || '')) {
        return false;
    }
    const names = new Set(Array.from(currentLorebookNames || []).map(name => String(name || '').trim()).filter(Boolean));
    return names.has(String(lorebookName || '').trim());
}
