import {
    getSidePromptRegenerationSnapshot,
    SIDE_PROMPT_REGENERATION_METADATA_KEY,
} from '../public/scripts/stmb-regeneration.js';

const STMB_METADATA_KEY = 'STMemoryBooks';
const STMB_COPY_EXTENSION_KEY = 'stmb_chat_copy';
const SIDE_PROMPT_SUFFIXES = [
    ' (STMB SidePrompt)',
    ' (STMB Plotpoints)',
    ' (STMB Scoreboard)',
    ' (STMB Tracker)',
];
const CLIP_SUFFIX = ' [STMB Clip]';

/** Typed, content-free error returned by the coordinated chat-copy operation. */
export class StmbChatCopyError extends Error {
    constructor(code, message, status = 409) {
        super(message);
        this.name = 'StmbChatCopyError';
        this.code = code;
        this.status = status;
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addBookName(names, value) {
    if (typeof value === 'string' && value.trim()) {
        names.add(value.trim());
    }
}

function addBookNameValues(names, value) {
    if (typeof value === 'string') {
        addBookName(names, value);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(item => addBookNameValues(names, item));
        return;
    }
    if (!isPlainObject(value)) {
        return;
    }
    addBookName(names, value.lorebookName);
    addBookName(names, value.name);
}

/** Returns the distinct Memory Books referenced by authoritative chat metadata. */
export function collectStmbChatLorebookNames(chatMetadata) {
    if (!isPlainObject(chatMetadata) || !isPlainObject(chatMetadata[STMB_METADATA_KEY])) {
        return [];
    }

    const names = new Set();
    const state = chatMetadata[STMB_METADATA_KEY];
    if (!String(state.manualLorebook || '').trim()) {
        addBookNameValues(names, chatMetadata.world_info);
    }
    addBookName(names, state.manualLorebook);
    Object.values(isPlainObject(state.manualCharacterLorebooks) ? state.manualCharacterLorebooks : {})
        .forEach(value => addBookNameValues(names, value));
    Object.values(isPlainObject(state.sidePromptLorebookOverrides) ? state.sidePromptLorebookOverrides : {})
        .forEach(value => addBookNameValues(names, value));
    return [...names];
}

/** Identifies Side Prompt and Clip entries that must be copied unchanged. */
export function isStmbDerivedEntry(entry) {
    const title = String(entry?.comment || entry?.title || '').trimEnd();
    return title.endsWith(CLIP_SUFFIX) || SIDE_PROMPT_SUFFIXES.some(suffix => title.endsWith(suffix));
}

function isStmbConsolidationEntry(entry) {
    return entry?.stmbSummary === true
        || entry?.stmbArc === true
        || String(entry?.type || '').toLowerCase() === 'arc';
}

function getEntryStableId(entry) {
    const value = entry?.uid ?? entry?.id;
    return value === undefined || value === null ? '' : String(value);
}

function getSummarySourceIds(entry, entries) {
    if (Array.isArray(entry?.stmbSourceEntryUids) && entry.stmbSourceEntryUids.length > 0) {
        return [...new Set(entry.stmbSourceEntryUids.map(String))];
    }

    const summaryId = getEntryStableId(entry);
    const backlinkIds = Object.values(entries)
        .filter(candidate => String(candidate?.disabledBySummaryId ?? '') === summaryId)
        .map(getEntryStableId)
        .filter(Boolean);
    return [...new Set(backlinkIds)];
}

function getManagedEntryRange(entry, resolveMessageIndex) {
    const startUuid = String(entry?.STMB_startUuid || '').trim();
    const endUuid = String(entry?.STMB_endUuid || '').trim();
    if (startUuid || endUuid) {
        if (!startUuid || !endUuid) {
            throw new StmbChatCopyError('stmb_copy_ambiguous_legacy', 'A managed memory has an incomplete UUID range.');
        }
        const start = resolveMessageIndex(startUuid);
        const end = resolveMessageIndex(endUuid);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
            throw new StmbChatCopyError('stmb_copy_ambiguous_legacy', 'A managed memory UUID range does not resolve to this chat.');
        }
        return { start, end };
    }

    const start = Number(entry?.STMB_start);
    const end = Number(entry?.STMB_end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        throw new StmbChatCopyError('stmb_copy_ambiguous_legacy', 'A legacy managed memory has no safe message range.');
    }
    return { start, end };
}

/** Projects an ordinary Memory Book to a chat cutoff without changing derived entries. */
export function projectStmbLorebookForChatCopy(lorebookData, { cutoffIndex, resolveMessageIndex }) {
    if (!isPlainObject(lorebookData) || !isPlainObject(lorebookData.entries)) {
        throw new StmbChatCopyError('stmb_copy_invalid_book', 'The Memory Book is invalid.', 400);
    }
    if (!Number.isInteger(cutoffIndex) || cutoffIndex < 0 || typeof resolveMessageIndex !== 'function') {
        throw new TypeError('A valid chat cutoff and message UUID resolver are required.');
    }

    const projected = structuredClone(lorebookData);
    const sourceEntries = lorebookData.entries;
    const keepIds = new Set();
    const summarySourceIds = new Map();
    let hasDerivedEntries = false;

    for (const [key, entry] of Object.entries(sourceEntries)) {
        if (!isPlainObject(entry)) {
            keepIds.add(String(key));
            continue;
        }
        if (isStmbDerivedEntry(entry)) {
            hasDerivedEntries = true;
            keepIds.add(String(key));
            if (Object.hasOwn(entry, SIDE_PROMPT_REGENERATION_METADATA_KEY)) {
                const snapshot = getSidePromptRegenerationSnapshot(entry);
                const start = snapshot ? resolveMessageIndex(snapshot.sceneStartUuid) : null;
                const end = snapshot ? resolveMessageIndex(snapshot.sceneEndUuid) : null;
                const projectedEntry = projected.entries[key];
                if (!snapshot || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > cutoffIndex) {
                    delete projectedEntry[SIDE_PROMPT_REGENERATION_METADATA_KEY];
                } else {
                    projectedEntry[SIDE_PROMPT_REGENERATION_METADATA_KEY].sceneStart = start;
                    projectedEntry[SIDE_PROMPT_REGENERATION_METADATA_KEY].sceneEnd = end;
                }
            }
            continue;
        }
        if (entry.stmemorybooks !== true) {
            keepIds.add(String(key));
            continue;
        }
        if (isStmbConsolidationEntry(entry)) {
            const sources = getSummarySourceIds(entry, sourceEntries);
            if (sources.length === 0) {
                throw new StmbChatCopyError('stmb_copy_ambiguous_legacy', 'A legacy consolidation has no safe source relationship.');
            }
            summarySourceIds.set(String(key), sources);
            keepIds.add(String(key));
            continue;
        }

        const range = getManagedEntryRange(entry, resolveMessageIndex);
        if (range.end <= cutoffIndex) {
            keepIds.add(String(key));
        } else if (range.start <= cutoffIndex) {
            throw new StmbChatCopyError('stmb_copy_ambiguous_legacy', 'A managed memory overlaps the selected message.');
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        const retainedEntryIds = new Set([...keepIds].map(key => getEntryStableId(sourceEntries[key])).filter(Boolean));
        for (const [summaryKey, sources] of summarySourceIds) {
            if (keepIds.has(summaryKey) && sources.some(sourceId => !retainedEntryIds.has(sourceId))) {
                keepIds.delete(summaryKey);
                changed = true;
            }
        }
    }

    const retainedSummaryIds = new Set(
        [...summarySourceIds.keys()]
            .filter(key => keepIds.has(key))
            .map(key => getEntryStableId(sourceEntries[key])),
    );
    for (const [key, entry] of Object.entries(projected.entries)) {
        if (!keepIds.has(String(key))) {
            delete projected.entries[key];
            continue;
        }
        if (isStmbDerivedEntry(entry)) continue;
        const disabledBy = String(entry?.disabledBySummaryId ?? '');
        if (disabledBy && !retainedSummaryIds.has(disabledBy)) {
            delete entry.disabledBySummaryId;
            entry.disable = false;
        }
    }

    return { data: projected, hasDerivedEntries };
}

/** Rebinds retained normal memories to the regenerated identities in the copied chat. */
export function rewriteManagedMemoryBoundaryUuids(data, targetMessages, resolveSourceMessageIndex, { targetChatId = '' } = {}) {
    for (const entry of Object.values(data?.entries || {})) {
        if (isStmbDerivedEntry(entry)) {
            const snapshot = getSidePromptRegenerationSnapshot(entry);
            if (!snapshot) continue;
            const start = resolveSourceMessageIndex(snapshot.sceneStartUuid);
            const end = resolveSourceMessageIndex(snapshot.sceneEndUuid);
            const startUuid = targetMessages?.[start]?.aikobots_message_uuid;
            const endUuid = targetMessages?.[end]?.aikobots_message_uuid;
            if (!Number.isInteger(start) || !Number.isInteger(end) || typeof startUuid !== 'string' || typeof endUuid !== 'string') {
                delete entry[SIDE_PROMPT_REGENERATION_METADATA_KEY];
                continue;
            }
            snapshot.sceneStart = start;
            snapshot.sceneEnd = end;
            snapshot.sceneStartUuid = startUuid;
            snapshot.sceneEndUuid = endUuid;
            snapshot.chatId = String(targetChatId || snapshot.chatId);
            continue;
        }
        if (entry?.stmemorybooks !== true || isStmbConsolidationEntry(entry)) continue;
        const range = getManagedEntryRange(entry, resolveSourceMessageIndex);
        const startUuid = targetMessages?.[range.start]?.aikobots_message_uuid;
        const endUuid = targetMessages?.[range.end]?.aikobots_message_uuid;
        if (typeof startUuid !== 'string' || typeof endUuid !== 'string') {
            throw new StmbChatCopyError('stmb_copy_identity_failed', 'The copied chat message identities could not be resolved.', 500);
        }
        entry.STMB_startUuid = startUuid;
        entry.STMB_endUuid = endUuid;
    }
    return data;
}

function replaceBookReference(value, nameMap) {
    if (typeof value === 'string') {
        return nameMap.get(value) || value;
    }
    if (Array.isArray(value)) {
        return value.map(item => replaceBookReference(item, nameMap));
    }
    if (isPlainObject(value)) {
        const copy = { ...value };
        if (typeof copy.lorebookName === 'string') copy.lorebookName = nameMap.get(copy.lorebookName) || copy.lorebookName;
        if (typeof copy.name === 'string') copy.name = nameMap.get(copy.name) || copy.name;
        return copy;
    }
    return value;
}

/** Rewrites copied-chat STMB bindings and clamps point-in-time processing state. */
export function rewriteStmbChatMetadataForCopy(chatMetadata, nameMap, cutoffIndex) {
    const metadata = structuredClone(isPlainObject(chatMetadata) ? chatMetadata : {});
    const state = metadata[STMB_METADATA_KEY];
    if (!isPlainObject(state)) {
        return metadata;
    }

    metadata.world_info = replaceBookReference(metadata.world_info, nameMap);
    if (typeof state.manualLorebook === 'string') state.manualLorebook = nameMap.get(state.manualLorebook) || state.manualLorebook;
    for (const key of ['manualCharacterLorebooks', 'sidePromptLorebookOverrides']) {
        if (!isPlainObject(state[key])) continue;
        for (const [bindingKey, value] of Object.entries(state[key])) {
            state[key][bindingKey] = replaceBookReference(value, nameMap);
        }
    }

    if (Number.isInteger(state.highestMemoryProcessed)) {
        state.highestMemoryProcessed = Math.min(state.highestMemoryProcessed, cutoffIndex);
    }
    if (Number.isInteger(state.sceneStart) && state.sceneStart > cutoffIndex) state.sceneStart = null;
    if (Number.isInteger(state.sceneEnd) && state.sceneEnd > cutoffIndex) state.sceneEnd = cutoffIndex;
    if (Number.isInteger(state.sceneStart) && Number.isInteger(state.sceneEnd) && state.sceneStart > state.sceneEnd) {
        state.sceneStart = null;
        state.sceneEnd = null;
    }
    if (Number.isInteger(state.autoSummaryNextPromptAt) && state.autoSummaryNextPromptAt > cutoffIndex + 1) {
        state.autoSummaryNextPromptAt = cutoffIndex + 1;
    }
    return metadata;
}

/** Removes STMB-owned bindings when the user deliberately creates a chat-only copy. */
export function clearStmbChatMetadataBindings(chatMetadata) {
    const metadata = structuredClone(isPlainObject(chatMetadata) ? chatMetadata : {});
    const state = metadata[STMB_METADATA_KEY];
    if (!isPlainObject(state)) return metadata;
    if (!String(state.manualLorebook || '').trim()) delete metadata.world_info;
    delete state.manualLorebook;
    delete state.manualCharacterLorebooks;
    delete state.sidePromptLorebookOverrides;
    return metadata;
}

/** Rewrites copied entry references and records ordinary-book lineage metadata. */
export function finalizeStmbLorebookCopy(data, { nameMap, targetChatId, rootName, sourceName, kind, sequence, operationId }) {
    const copy = structuredClone(data);
    for (const entry of Object.values(copy.entries || {})) {
        if (!isPlainObject(entry)) continue;
        if (isStmbDerivedEntry(entry)) continue;
        if (typeof entry.STMB_canonicalLorebook === 'string') {
            entry.STMB_canonicalLorebook = nameMap.get(entry.STMB_canonicalLorebook) || entry.STMB_canonicalLorebook;
        }
        if (entry.stmemorybooks === true || Object.prototype.hasOwnProperty.call(entry, 'STMB_chatId')) {
            entry.STMB_chatId = targetChatId;
        }
    }
    copy.extensions = isPlainObject(copy.extensions) ? copy.extensions : {};
    copy.extensions.aikobots = isPlainObject(copy.extensions.aikobots) ? copy.extensions.aikobots : {};
    copy.extensions.aikobots[STMB_COPY_EXTENSION_KEY] = {
        version: 1,
        root_name: rootName,
        source_name: sourceName,
        kind,
        sequence,
        operation_id: operationId,
        created_at: new Date().toISOString(),
    };
    return copy;
}

/** Resolves the original lineage root used for nested-copy numbering. */
export function getStmbLorebookCopyRoot(data, fallbackName) {
    const root = data?.extensions?.aikobots?.[STMB_COPY_EXTENSION_KEY]?.root_name;
    return typeof root === 'string' && root.trim() ? root.trim() : String(fallbackName || '').trim();
}

/** Allocates the next branch or checkpoint name while the shared lorebook lock is held. */
export function allocateStmbLorebookCopyName(rootName, kind, existingNames) {
    const label = kind === 'checkpoint' ? 'Checkpoint' : 'Branch';
    const escapedRoot = String(rootName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedRoot} ${label} (\\d+)$`);
    let sequence = 0;
    for (const name of existingNames) {
        const match = String(name).match(pattern);
        if (match) sequence = Math.max(sequence, Number(match[1]) || 0);
    }
    sequence += 1;
    return { name: `${rootName} ${label} ${sequence}`, sequence };
}

/** Collects UUID boundaries needed for bounded authoritative source-chat lookups. */
export function collectManagedMemoryBoundaryUuids(lorebookData) {
    const uuids = new Set();
    for (const entry of Object.values(lorebookData?.entries || {})) {
        if (isStmbDerivedEntry(entry)) {
            const snapshot = getSidePromptRegenerationSnapshot(entry);
            if (snapshot) {
                uuids.add(snapshot.sceneStartUuid);
                uuids.add(snapshot.sceneEndUuid);
            }
            continue;
        }
        if (entry?.stmemorybooks !== true || isStmbConsolidationEntry(entry)) continue;
        for (const value of [entry.STMB_startUuid, entry.STMB_endUuid]) {
            if (typeof value === 'string' && value.trim()) uuids.add(value.trim());
        }
    }
    return uuids;
}
