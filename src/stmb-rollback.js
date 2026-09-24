import { createHash, randomUUID } from 'node:crypto';
import { getChatHeader, getLogicalMessageRowByUuid, getMetadata, setMetadata } from './sqlite-manager.js';
import { stmbOperationConflict, writeStmbOperation } from './stmb-operations.js';
import { assertLorebookCheckoutForManagement, getCanonicalLorebookName, getLorebookForManagement } from './lorebook-repository.js';
import { getStmbMemoryRole, hasStmbSharedRoles } from '../public/scripts/stmb-group-policy.js';
import { SIDE_PROMPT_HISTORY_KEY } from '../public/scripts/stmb-sideprompt-history.js';

const SNAPSHOT = 'STMB_sidePromptRegeneration';

/** Hashes ordinary entry state without persisting its content in the operation journal. */
export function hashStmbRollbackState(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Keeps automatic archive changes rollback-safe without blessing prior manual edits. */
export function updateStmbSidePromptArchiveState(entry, update, allowRollback = true) {
    const snapshot = entry[SNAPSHOT];
    const state = { ...entry };
    delete state[SNAPSHOT];
    const unchanged = allowRollback && snapshot?.version === 2 && hashStmbRollbackState(state) === snapshot.writtenFingerprint;
    update();
    if (unchanged) {
        const next = { ...entry };
        delete next[SNAPSHOT];
        snapshot.writtenFingerprint = hashStmbRollbackState(next);
    }
}

/** Stores exactly one ordinary Side Prompt restoration layer at the authoritative write. */
export function stampStmbSidePromptRollback(entry, prior) {
    const snapshot = entry[SNAPSHOT];
    if (!snapshot || snapshot.version !== 1 || !snapshot.sceneStartUuid || !snapshot.sceneEndUuid) return;
    const previous = prior ? structuredClone(prior) : null;
    if (previous?.[SNAPSHOT]?.version === 2) {
        delete previous[SNAPSHOT].priorEntry;
        delete previous[SNAPSHOT].writtenFingerprint;
        previous[SNAPSHOT].version = 1;
    }
    const current = structuredClone(entry);
    delete current[SNAPSHOT];
    entry[SNAPSHOT] = { ...snapshot, version: 2, priorEntry: previous, writtenFingerprint: hashStmbRollbackState(current) };
}

/** Identifies overlap by UUID ownership, including middle deletions that leave both anchors intact. */
function affectedRange(db, operation, startUuid, endUuid, resolveMessage = uuid => getLogicalMessageRowByUuid(db, uuid)) {
    if (Number.isInteger(operation.data.copyBoundary)) {
        const start = startUuid ? resolveMessage(startUuid) : null;
        const end = endUuid ? resolveMessage(endUuid) : null;
        if (!start && !end) return false;
        if (!start || !end || start.logicalIndex > end.logicalIndex) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
        return end.logicalIndex > operation.data.copyBoundary;
    }
    const deleted = new Set(operation.data.deleted);
    if (deleted.has(startUuid) || deleted.has(endUuid)) return true;
    if (!startUuid || !endUuid) return false;
    const start = getLogicalMessageRowByUuid(db, startUuid);
    const end = getLogicalMessageRowByUuid(db, endUuid);
    if (!start || !end) return false;
    return start.logicalIndex < operation.data.start && end.logicalIndex >= operation.data.start;
}

/** Groups rollback history by stable identity, ignoring default-title display-name changes. */
function sidePromptRollbackHistoryKey(history) {
    return JSON.stringify([history.templateKey, history.chatKey, history.titleSource, history.titleSource === 'name' ? null : history.titleBase]);
}

/** Plans one ordinary book mutation without changing the supplied book. */
export function planStmbRollbackBook(db, operation, book, { resolveMessage = uuid => getLogicalMessageRowByUuid(db, uuid) } = {}) {
    const next = structuredClone(book);
    const entries = next.entries || {};
    const shared = hasStmbSharedRoles(Object.values(entries));
    const removed = new Set();
    const changedHistories = new Map();
    const isAffected = (start, end) => affectedRange(db, operation, start, end, resolveMessage);
    if (operation.data.settings.deleteMemories !== false) {
        const parents = new Map();
        const addParent = (child, parent) => {
            const values = parents.get(String(child)) || new Set();
            values.add(String(parent));
            parents.set(String(child), values);
        };
        for (const [key, entry] of Object.entries(entries)) {
            if (entry.stmemorybooks !== true) continue;
            if (String(entry.uid) !== key || (shared && !getStmbMemoryRole(entry))) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
            // Numeric-only legacy ranges cannot establish which chat owns a potentially affected memory.
            if (!Number.isInteger(operation.data.copyBoundary) && (!entry.STMB_startUuid || !entry.STMB_endUuid) && Number.isInteger(entry.STMB_start) && Number.isInteger(entry.STMB_end)
                && entry.STMB_start <= operation.data.end && entry.STMB_end >= operation.data.start) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
            if (isAffected(entry.STMB_startUuid, entry.STMB_endUuid)) removed.add(key);
            if (entry.stmbSourceEntryUids !== undefined && !Array.isArray(entry.stmbSourceEntryUids)) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
            for (const child of entry.stmbSourceEntryUids || []) addParent(child, key);
            if (entries[entry.disabledBySummaryId]?.stmemorybooks === true) addParent(key, entry.disabledBySummaryId);
        }
        // Set iteration visits newly added parents, handling arbitrarily deep consolidation chains once.
        for (const child of removed) {
            for (const parent of parents.get(child) || []) {
                if (entries[parent]?.stmemorybooks === true) removed.add(parent);
            }
        }
    }
    for (const [key, entry] of Object.entries(entries)) {
        if (removed.has(String(entry.uid))) { delete entries[key]; continue; }
        if (entry.stmemorybooks === true && removed.has(String(entry.disabledBySummaryId))) { delete entry.disabledBySummaryId; entry.disable = false; }
        if (entry.stmemorybooks === true && entry.STMB_startUuid && entry.STMB_endUuid) {
            const start = resolveMessage(entry.STMB_startUuid);
            const end = resolveMessage(entry.STMB_endUuid);
            if (start && end && start.logicalIndex <= end.logicalIndex) {
                entry.STMB_start = start.logicalIndex;
                entry.STMB_end = end.logicalIndex;
            }
        }
        const snapshot = entry[SNAPSHOT];
        if (operation.data.settings.restoreSidePrompts !== false && snapshot && isAffected(snapshot.sceneStartUuid, snapshot.sceneEndUuid)) {
            if (snapshot.version !== 2 || (snapshot.priorEntry !== null && (!snapshot.priorEntry || String(snapshot.priorEntry.uid) !== key))) throw stmbOperationConflict('StmbRecoverySnapshotUnavailable');
            const current = structuredClone(entry);
            delete current[SNAPSHOT];
            if (hashStmbRollbackState(current) !== snapshot.writtenFingerprint) throw stmbOperationConflict('StmbRecoverySidePromptChanged');
            const history = entry[SIDE_PROMPT_HISTORY_KEY];
            if (history) changedHistories.set(sidePromptRollbackHistoryKey(history), []);
            if (snapshot.priorEntry === null) delete entries[key];
            else {
                entries[key] = structuredClone(snapshot.priorEntry);
                if (history) updateStmbSidePromptArchiveState(entries[key], () => {
                    entries[key][SIDE_PROMPT_HISTORY_KEY] = history;
                    entries[key].comment = entry.comment;
                    entries[key].group = entry.group;
                });
            }
        }
    }
    for (const entry of Object.values(entries)) {
        const history = entry[SIDE_PROMPT_HISTORY_KEY];
        if (history?.version === 1) changedHistories.get(sidePromptRollbackHistoryKey(history))?.push(entry);
    }
    for (const surviving of changedHistories.values()) {
        const newest = surviving.reduce((latest, entry) => !latest || entry[SIDE_PROMPT_HISTORY_KEY].sequence > latest[SIDE_PROMPT_HISTORY_KEY].sequence ? entry : latest, null);
        for (const entry of surviving) updateStmbSidePromptArchiveState(entry, () => { entry.disable = entry !== newest; });
    }
    return next;
}

/** Rolls back an isolated copy against source UUIDs, then remaps only proven source-owned identities. */
export function planStmbChatCopyBook(book, { sourceChatId, targetChatId, boundary, settings, resolveMessage, uuidMap }) {
    const owned = (start, end, chatId) => {
        const first = start ? resolveMessage(start) : null;
        const last = end ? resolveMessage(end) : null;
        if (!first && !last && chatId && chatId !== sourceChatId) return false;
        if (!first || !last || first.logicalIndex > last.logicalIndex || (chatId && chatId !== sourceChatId)) {
            throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
        }
        return true;
    };
    const histories = new Map();
    const memoryOwners = new Map();
    const visiting = new Set();
    const validateMemory = entry => {
        const key = String(entry.uid);
        if (memoryOwners.has(key)) return memoryOwners.get(key);
        if (visiting.has(key)) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
        visiting.add(key);
        let belongs;
        if (entry.stmbSummary === true) {
            if (!Array.isArray(entry.stmbSourceEntryUids) || entry.stmbSourceEntryUids.length === 0) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
            const ownership = entry.stmbSourceEntryUids.map(uid => {
                const child = book.entries[String(uid)];
                if (child?.stmemorybooks !== true) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
                return validateMemory(child);
            });
            belongs = ownership.some(Boolean);
        } else belongs = owned(entry.STMB_startUuid, entry.STMB_endUuid, entry.STMB_chatId);
        visiting.delete(key);
        memoryOwners.set(key, belongs);
        return belongs;
    };
    for (const entry of Object.values(book.entries || {})) {
        if (settings.deleteMemories !== false && entry.stmemorybooks === true) validateMemory(entry);
        const snapshot = entry[SNAPSHOT];
        const history = entry[SIDE_PROMPT_HISTORY_KEY];
        if (settings.restoreSidePrompts !== false && (snapshot || history || / \(STMB (?:SidePrompt|Tracker|Plotpoints|Scoreboard)\)$/.test(String(entry.comment || '')))) {
            if (!snapshot) throw stmbOperationConflict('StmbRecoverySnapshotUnavailable');
            owned(snapshot.sceneStartUuid, snapshot.sceneEndUuid, snapshot.chatId);
        }
        if (history?.chatId === sourceChatId) {
            const key = sidePromptRollbackHistoryKey(history);
            const sequences = histories.get(key) || new Set();
            if (history.version !== 1 || !Number.isSafeInteger(history.sequence) || history.sequence < 1 || sequences.has(history.sequence)) {
                throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
            }
            sequences.add(history.sequence);
            histories.set(key, sequences);
        }
    }
    const operation = { data: { copyBoundary: boundary, settings } };
    const next = planStmbRollbackBook(null, operation, book, { resolveMessage });
    let highest = -1;
    const remapGroup = group => {
        if (typeof group !== 'string') return group;
        const suffix = sourceChatId.replace(/\s/g, '').replace(/,/g, '-');
        return suffix && group.endsWith(`-${suffix}`)
            ? group.slice(0, -suffix.length) + targetChatId.replace(/\s/g, '').replace(/,/g, '-') : group;
    };
    const remap = entry => {
        const snapshot = entry[SNAPSHOT];
        const history = entry[SIDE_PROMPT_HISTORY_KEY];
        const before = { ...entry };
        delete before[SNAPSHOT];
        const validSnapshot = snapshot?.version === 2 && hashStmbRollbackState(before) === snapshot.writtenFingerprint;
        if (entry.STMB_startUuid && uuidMap.has(entry.STMB_startUuid) && uuidMap.has(entry.STMB_endUuid)) {
            entry.STMB_startUuid = uuidMap.get(entry.STMB_startUuid);
            entry.STMB_endUuid = uuidMap.get(entry.STMB_endUuid);
            entry.STMB_chatId = targetChatId;
            if (entry.STMB_inclusionGroup) {
                const priorGroup = entry.STMB_inclusionGroup;
                entry.STMB_inclusionGroup = `STMB-${hashStmbRollbackState([targetChatId, priorGroup]).slice(0, 24)}`;
                if (entry.group === priorGroup) entry.group = entry.STMB_inclusionGroup;
            }
        }
        const remappableSnapshot = snapshot?.chatId === sourceChatId && uuidMap.has(snapshot.sceneStartUuid) && uuidMap.has(snapshot.sceneEndUuid);
        if (history?.chatId === sourceChatId && remappableSnapshot) {
            let identity;
            try { identity = JSON.parse(history.chatKey); } catch { throw stmbOperationConflict('StmbRecoveryOwnershipUnclear'); }
            if (!Array.isArray(identity) || identity.length !== 3 || identity[2] !== sourceChatId) throw stmbOperationConflict('StmbRecoveryOwnershipUnclear');
            identity[2] = targetChatId;
            history.chatKey = JSON.stringify(identity);
            history.chatId = targetChatId;
            history.group = remapGroup(history.group);
            entry.group = remapGroup(entry.group);
        }
        if (snapshot?.chatId === sourceChatId) {
            if (snapshot.priorEntry) remap(snapshot.priorEntry);
            if (remappableSnapshot) {
                snapshot.chatId = targetChatId;
                if (snapshot.chatRef?.type === 'character') snapshot.chatRef.fileName = targetChatId;
                if (snapshot.chatRef?.type === 'group') snapshot.chatRef.chatId = targetChatId;
                snapshot.sceneStartUuid = uuidMap.get(snapshot.sceneStartUuid);
                snapshot.sceneEndUuid = uuidMap.get(snapshot.sceneEndUuid);
            }
        }
        if (validSnapshot) {
            const current = { ...entry };
            delete current[SNAPSHOT];
            snapshot.writtenFingerprint = hashStmbRollbackState(current);
        }
    };
    for (const entry of Object.values(next.entries || {})) {
        const snapshot = entry[SNAPSHOT];
        // Only one unversioned restoration layer exists; never pretend a later prior state fits the branch.
        if (settings.restoreSidePrompts !== false && snapshot && affectedRange(null, operation, snapshot.sceneStartUuid, snapshot.sceneEndUuid, resolveMessage)) {
            throw stmbOperationConflict('StmbRecoverySnapshotUnavailable');
        }
        if (entry.stmemorybooks && entry.STMB_startUuid && entry.STMB_endUuid) {
            const start = resolveMessage(entry.STMB_startUuid);
            const end = resolveMessage(entry.STMB_endUuid);
            if (start && end && end.logicalIndex <= boundary) highest = Math.max(highest, end.logicalIndex);
        }
        remap(entry);
    }
    return { data: next, highest };
}

/** Executes a prevalidated rollback with per-book before/after hashes for crash recovery. */
export async function executeStmbRollback(user, db, operation, transaction) {
    if (['applied', 'discarded'].includes(operation.state)) return;
    const header = getChatHeader(db);
    const baseline = header.chat_metadata?.STMemoryBooks || {};
    if ((getMetadata(db, 'stmb_marker_revision') || '') !== operation.data.markerRevision
        || (baseline.highestMemoryProcessed ?? null) !== operation.data.highest
        || (baseline.highestMemoryProcessedManuallySet === true) !== operation.data.manuallySet) throw stmbOperationConflict('StmbRecoveryProgressChanged');
    const books = [];
    for (const name of new Set(operation.data.books.map(getCanonicalLorebookName))) {
        const loaded = await getLorebookForManagement(user, name, false, 'user');
        if (loaded.metadata.storage !== 'user') throw stmbOperationConflict();
        assertLorebookCheckoutForManagement(user, loaded.metadata);
        const hash = hashStmbRollbackState(loaded.data);
        const planned = operation.data.planned?.[name];
        if (planned && hash === planned.after) { books.push({ name, data: loaded.data, done: true }); continue; }
        if (planned && hash !== planned.before) throw stmbOperationConflict('StmbRecoveryBookChanged');
        const next = planStmbRollbackBook(db, operation, loaded.data);
        books.push({ name, data: next, before: hash, after: hashStmbRollbackState(next) });
    }
    operation.data.planned ||= {};
    for (const book of books) {
        if (!book.done) operation.data.planned[book.name] = { before: book.before, after: book.after };
    }
    writeStmbOperation(db, operation);
    for (const book of books) {
        if (!book.done && book.before !== book.after) await transaction.save(user, book.name, book.data, 'user');
    }
    if (operation.data.settings.updateProgress !== false) {
        let highest = -1;
        for (const book of books) for (const entry of Object.values(book.data.entries || {})) {
            if (!entry.stmemorybooks || !entry.STMB_startUuid || !entry.STMB_endUuid
                || affectedRange(db, operation, entry.STMB_startUuid, entry.STMB_endUuid)) continue;
            const start = getLogicalMessageRowByUuid(db, entry.STMB_startUuid);
            const row = getLogicalMessageRowByUuid(db, entry.STMB_endUuid);
            if (start && row && start.logicalIndex <= row.logicalIndex) highest = Math.max(highest, row.logicalIndex);
        }
        header.chat_metadata ||= {};
        header.chat_metadata.STMemoryBooks ||= {};
        const markers = header.chat_metadata.STMemoryBooks;
        if (highest < 0) delete markers.highestMemoryProcessed;
        else markers.highestMemoryProcessed = highest;
        delete markers.highestMemoryProcessedManuallySet;
    }
    header.chat_revision = Number(header.chat_revision || 0) + 1;
    delete header.last_save_session_id;
    delete header.id;
    delete header.order_index;
    db.run('BEGIN IMMEDIATE');
    try {
        db.run('UPDATE messages SET content = ? WHERE order_index = 0', [JSON.stringify(header)]);
        if (operation.data.settings.updateProgress !== false) setMetadata(db, 'stmb_progress_revision', randomUUID());
        operation.state = 'applied';
        operation.data.appliedRevision = header.chat_revision;
        writeStmbOperation(db, operation);
        db.run('COMMIT');
    } catch (error) { db.run('ROLLBACK'); throw error; }
}
