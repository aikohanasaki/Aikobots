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
export function collectStmbChatLorebookNames(chatMetadata, { soloMemoryBookLocked = false, lockedCharacterBindingKeys = [] } = {}) {
    if (!isPlainObject(chatMetadata) || !isPlainObject(chatMetadata[STMB_METADATA_KEY])) {
        return [];
    }

    const names = new Set();
    const state = chatMetadata[STMB_METADATA_KEY];
    const lockedKeys = new Set(Array.isArray(lockedCharacterBindingKeys) ? lockedCharacterBindingKeys.map(String) : []);
    if (!soloMemoryBookLocked && !String(state.manualLorebook || '').trim()) {
        addBookNameValues(names, chatMetadata.world_info);
    }
    if (!soloMemoryBookLocked) addBookName(names, state.manualLorebook);
    Object.entries(isPlainObject(state.manualCharacterLorebooks) ? state.manualCharacterLorebooks : {})
        .filter(([key]) => !lockedKeys.has(key))
        .forEach(([, value]) => addBookNameValues(names, value));
    Object.values(isPlainObject(state.sidePromptLorebookOverrides) ? state.sidePromptLorebookOverrides : {})
        .forEach(value => addBookNameValues(names, value));
    return [...names];
}

/** Identifies Side Prompt and Clip entries for the post-copy recreation notice. */
export function isStmbDerivedEntry(entry) {
    const title = String(entry?.comment || entry?.title || '').trimEnd();
    return title.endsWith(CLIP_SUFFIX) || SIDE_PROMPT_SUFFIXES.some(suffix => title.endsWith(suffix));
}

/** Clones a complete ordinary Memory Book without interpreting entry message metadata. */
export function cloneStmbLorebookForChatCopy(lorebookData) {
    if (!isPlainObject(lorebookData) || !isPlainObject(lorebookData.entries)) {
        throw new StmbChatCopyError('stmb_copy_invalid_book', 'The Memory Book is invalid.', 400);
    }
    return {
        data: structuredClone(lorebookData),
        hasDerivedEntries: Object.values(lorebookData.entries).some(isStmbDerivedEntry),
    };
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
export function rewriteStmbChatMetadataForCopy(chatMetadata, nameMap, cutoffIndex, { soloMemoryBookLocked = false, lockedCharacterBindingKeys = [] } = {}) {
    const metadata = structuredClone(isPlainObject(chatMetadata) ? chatMetadata : {});
    const state = metadata[STMB_METADATA_KEY];
    if (!isPlainObject(state)) {
        return metadata;
    }

    const lockedKeys = new Set(Array.isArray(lockedCharacterBindingKeys) ? lockedCharacterBindingKeys.map(String) : []);
    if (!soloMemoryBookLocked) {
        metadata.world_info = replaceBookReference(metadata.world_info, nameMap);
        if (typeof state.manualLorebook === 'string') state.manualLorebook = nameMap.get(state.manualLorebook) || state.manualLorebook;
    }
    if (isPlainObject(state.manualCharacterLorebooks)) {
        for (const [bindingKey, value] of Object.entries(state.manualCharacterLorebooks)) {
            if (!lockedKeys.has(bindingKey)) state.manualCharacterLorebooks[bindingKey] = replaceBookReference(value, nameMap);
        }
    }
    if (isPlainObject(state.sidePromptLorebookOverrides)) {
        for (const [bindingKey, value] of Object.entries(state.sidePromptLorebookOverrides)) {
            state.sidePromptLorebookOverrides[bindingKey] = replaceBookReference(value, nameMap);
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
export function finalizeStmbLorebookCopy(data, { nameMap, rootName, sourceName, kind, sequence, operationId }) {
    const copy = structuredClone(data);
    for (const entry of Object.values(copy.entries || {})) {
        if (!isPlainObject(entry)) continue;
        if (isStmbDerivedEntry(entry)) continue;
        if (typeof entry.STMB_canonicalLorebook === 'string') {
            entry.STMB_canonicalLorebook = nameMap.get(entry.STMB_canonicalLorebook) || entry.STMB_canonicalLorebook;
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
