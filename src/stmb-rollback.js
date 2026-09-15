import { createHash } from 'node:crypto';
import { getChatHeader, getLogicalMessageRowByUuid, getMetadata } from './sqlite-manager.js';
import { stmbOperationConflict, writeStmbOperation } from './stmb-operations.js';
import { assertLorebookCheckoutForManagement, getCanonicalLorebookName, getLorebookForManagement } from './lorebook-repository.js';
import { getStmbMemoryRole, hasStmbSharedRoles } from '../public/scripts/stmb-group-policy.js';

const SNAPSHOT = 'STMB_sidePromptRegeneration';

/** Hashes ordinary entry state without persisting its content in the operation journal. */
export function hashStmbRollbackState(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
function affectedRange(db, operation, startUuid, endUuid) {
    const deleted = new Set(operation.data.deleted);
    if (deleted.has(startUuid) || deleted.has(endUuid)) return true;
    if (!startUuid || !endUuid) return false;
    const start = getLogicalMessageRowByUuid(db, startUuid);
    const end = getLogicalMessageRowByUuid(db, endUuid);
    if (!start || !end) return false;
    return start.logicalIndex < operation.data.start && end.logicalIndex >= operation.data.start;
}

/** Plans one ordinary book mutation without changing the supplied book. */
export function planStmbRollbackBook(db, operation, book) {
    const next = structuredClone(book);
    const entries = next.entries || {};
    const shared = hasStmbSharedRoles(Object.values(entries));
    const removed = new Set();
    if (operation.data.settings.deleteMemories !== false) {
        const parents = new Map();
        const addParent = (child, parent) => {
            const values = parents.get(String(child)) || new Set();
            values.add(String(parent));
            parents.set(String(child), values);
        };
        for (const [key, entry] of Object.entries(entries)) {
            if (entry.stmemorybooks !== true) continue;
            if (String(entry.uid) !== key || (shared && !getStmbMemoryRole(entry))) throw stmbOperationConflict();
            // Numeric-only legacy ranges cannot establish which chat owns a potentially affected memory.
            if ((!entry.STMB_startUuid || !entry.STMB_endUuid) && Number.isInteger(entry.STMB_start) && Number.isInteger(entry.STMB_end)
                && entry.STMB_start <= operation.data.end && entry.STMB_end >= operation.data.start) throw stmbOperationConflict();
            if (affectedRange(db, operation, entry.STMB_startUuid, entry.STMB_endUuid)) removed.add(key);
            if (entry.stmbSourceEntryUids !== undefined && !Array.isArray(entry.stmbSourceEntryUids)) throw stmbOperationConflict();
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
            const start = getLogicalMessageRowByUuid(db, entry.STMB_startUuid);
            const end = getLogicalMessageRowByUuid(db, entry.STMB_endUuid);
            if (start && end && start.logicalIndex <= end.logicalIndex) {
                entry.STMB_start = start.logicalIndex;
                entry.STMB_end = end.logicalIndex;
            }
        }
        const snapshot = entry[SNAPSHOT];
        if (operation.data.settings.restoreSidePrompts !== false && snapshot && affectedRange(db, operation, snapshot.sceneStartUuid, snapshot.sceneEndUuid)) {
            if (snapshot.version !== 2 || (snapshot.priorEntry !== null && (!snapshot.priorEntry || String(snapshot.priorEntry.uid) !== key))) throw stmbOperationConflict();
            const current = structuredClone(entry);
            delete current[SNAPSHOT];
            if (hashStmbRollbackState(current) !== snapshot.writtenFingerprint) throw stmbOperationConflict();
            if (snapshot.priorEntry === null) delete entries[key];
            else entries[key] = structuredClone(snapshot.priorEntry);
        }
    }
    return next;
}

/** Executes a prevalidated rollback with per-book before/after hashes for crash recovery. */
export async function executeStmbRollback(user, db, operation, transaction) {
    if (['applied', 'discarded'].includes(operation.state)) return;
    const header = getChatHeader(db);
    const baseline = header.chat_metadata?.STMemoryBooks || {};
    if ((getMetadata(db, 'stmb_marker_revision') || '') !== operation.data.markerRevision
        || (baseline.highestMemoryProcessed ?? null) !== operation.data.highest
        || (baseline.highestMemoryProcessedManuallySet === true) !== operation.data.manuallySet) throw stmbOperationConflict();
    const books = [];
    for (const name of new Set(operation.data.books.map(getCanonicalLorebookName))) {
        const loaded = await getLorebookForManagement(user, name, false, 'user');
        if (loaded.metadata.storage !== 'user') throw stmbOperationConflict();
        assertLorebookCheckoutForManagement(user, loaded.metadata);
        const hash = hashStmbRollbackState(loaded.data);
        const planned = operation.data.planned?.[name];
        if (planned && hash === planned.after) { books.push({ name, data: loaded.data, done: true }); continue; }
        if (planned && hash !== planned.before) throw stmbOperationConflict();
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
        operation.state = 'applied';
        writeStmbOperation(db, operation);
        db.run('COMMIT');
    } catch (error) { db.run('ROLLBACK'); throw error; }
}
