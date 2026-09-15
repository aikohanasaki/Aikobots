import { randomUUID } from 'node:crypto';
import { fingerprintStmbSource } from '../public/scripts/stmb-source.js';
import { getChatHeader, getLogicalMessageRowByUuid, getMessageRange, getMetadata, setMetadata } from './sqlite-manager.js';

/** Safe conflict shared by mutation and recovery routes. */
export function stmbOperationConflict() {
    return Object.assign(new Error('Memory Books has unresolved work or changed source messages. Open pending operations to review.'), { status: 409, type: 'StmbOperationConflict' });
}

/** Reads internal operation records; callers must hold the logical chat lock. */
export function readStmbOperations(db) {
    return (db.exec('SELECT operation_id, kind, state, data_json FROM stmb_operations')[0]?.values || [])
        .map(([id, kind, state, json]) => ({ id, kind, state, data: JSON.parse(json) }));
}

/** Persists a content-free operation record inside the caller's transaction. */
export function writeStmbOperation(db, operation) {
    db.run('INSERT INTO stmb_operations (operation_id, kind, state, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(operation_id) DO UPDATE SET state=excluded.state, data_json=excluded.data_json',
        [operation.id, operation.kind, operation.state, JSON.stringify(operation.data)]);
}

/** Captures an exact source precondition without retaining message content. */
export function captureStmbOperationSource(db, startUuid, endUuid) {
    const start = getLogicalMessageRowByUuid(db, startUuid);
    const end = getLogicalMessageRowByUuid(db, endUuid);
    if (!start || !end || start.logicalIndex > end.logicalIndex) throw stmbOperationConflict();
    return {
        startUuid, endUuid, start: start.logicalIndex, end: end.logicalIndex,
        fingerprint: fingerprintStmbSource(getMessageRange(db, start.logicalIndex, end.logicalIndex - start.logicalIndex + 1)),
    };
}

/** Starts a memory save or validates its stable retry identity. */
export function beginStmbOperation(db, input, targets) {
    if (!input || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id) || !input.fingerprint) throw stmbOperationConflict();
    const existing = readStmbOperations(db).find(operation => operation.id === input.id);
    if (existing) {
        if (existing.kind !== 'memory' || existing.data.source.fingerprint !== input.fingerprint
            || existing.data.source.startUuid !== input.startUuid || existing.data.source.endUuid !== input.endUuid
            || JSON.stringify(existing.data.targets) !== JSON.stringify(targets)) throw stmbOperationConflict();
        return existing;
    }
    if (readStmbOperations(db).some(operation => operation.data.effectsPending || !['applied', 'discarded'].includes(operation.state))) throw stmbOperationConflict();
    const source = captureStmbOperationSource(db, input.startUuid, input.endUuid);
    if (source.fingerprint !== input.fingerprint) throw stmbOperationConflict();
    const markers = getChatHeader(db)?.chat_metadata?.STMemoryBooks || {};
    const hideRanges = input.hideRanges || [];
    if (!Array.isArray(hideRanges) || hideRanges.length > 1 || hideRanges.some(range => !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > source.end)) throw stmbOperationConflict();
    const operation = {
        id: input.id, kind: 'memory', state: 'prepared',
        data: { source, targets, attribution: randomUUID(), plannedReceipts: [], hideRanges, clearScene: input.clearScene === true, effectsPending: true, highest: markers.highestMemoryProcessed ?? null, manuallySet: markers.highestMemoryProcessedManuallySet === true, markerRevision: getMetadata(db, 'stmb_marker_revision') || '', receipts: [] },
    };
    writeStmbOperation(db, operation);
    return operation;
}

/** Applies progress only while both source and baseline still match; ordinary appends are allowed. */
export function validateStmbOperationSource(db, operation) {
    const source = captureStmbOperationSource(db, operation.data.source.startUuid, operation.data.source.endUuid);
    const header = getChatHeader(db);
    const markers = header?.chat_metadata?.STMemoryBooks || {};
    if (source.fingerprint !== operation.data.source.fingerprint
        || source.start !== operation.data.source.start || source.end !== operation.data.source.end
        || (markers.highestMemoryProcessed ?? null) !== operation.data.highest
        || (markers.highestMemoryProcessedManuallySet === true) !== operation.data.manuallySet
        || (getMetadata(db, 'stmb_marker_revision') || '') !== operation.data.markerRevision) throw stmbOperationConflict();
    return { source, header, markers };
}

/** Commits the processed marker and receipt together without rewriting messages. */
export function applyStmbProgress(db, operation) {
    if (operation.state === 'applied') return;
    const { source, header, markers } = validateStmbOperationSource(db, operation);
    header.chat_metadata ||= {};
    header.chat_metadata.STMemoryBooks = { ...markers, highestMemoryProcessed: Math.max(markers.highestMemoryProcessed ?? -1, source.end) };
    delete header.chat_metadata.STMemoryBooks.highestMemoryProcessedManuallySet;
    if (operation.data.clearScene) {
        delete header.chat_metadata.STMemoryBooks.sceneStart;
        delete header.chat_metadata.STMemoryBooks.sceneEnd;
    }
    header.chat_revision = Number(header.chat_revision || 0) + 1;
    delete header.last_save_session_id;
    delete header.id;
    delete header.order_index;
    db.run('BEGIN IMMEDIATE');
    try {
        for (const range of operation.data.hideRanges || []) {
            // Update only visibility on eligible rows, retaining every message and swipe identity.
            db.run('UPDATE messages SET content = json_set(content, \'$.is_system\', json(\'true\')) WHERE id IN (SELECT id FROM messages WHERE order_index > 0 ORDER BY order_index LIMIT ? OFFSET ?)', [range.end - range.start + 1, range.start]);
        }
        db.run('UPDATE messages SET content = ? WHERE order_index = 0', [JSON.stringify(header)]);
        operation.state = 'applied';
        writeStmbOperation(db, operation);
        db.run('COMMIT');
    } catch (error) { db.run('ROLLBACK'); throw error; }
}

/** Records deletion intent atomically with message removal; never copies message text. */
export function recordStmbDeletion(db, header, start, end, operationId) {
    const settings = header?.chat_metadata?.STMemoryBooks?.autoRollbackPolicy;
    const markerRevision = randomUUID();
    setMetadata(db, 'stmb_marker_revision', markerRevision);
    if (settings?.enabled !== true || end < start) return;
    const deleted = getMessageRange(db, start, end - start + 1).map(message => message.aikobots_message_uuid);
    const markers = header.chat_metadata.STMemoryBooks;
    const books = [...new Set([markers.manualLorebook, header.chat_metadata.world_info,
        ...Object.values(markers.manualCharacterLorebooks || {}),
        ...(markers.narratorMode?.members || []).map(member => member.lorebookName),
        ...(Array.isArray(settings.books) ? settings.books : []),
        ...readStmbOperations(db).flatMap(operation => (operation.data.targets || []).filter(target => target.storage === 'user').map(target => target.name)),
    ].filter(value => typeof value === 'string' && value))];
    writeStmbOperation(db, { id: `rollback-${operationId}`, kind: 'rollback', state: 'prepared', data: {
        deleted, start, end, books, settings: {
            updateProgress: settings.updateProgress !== false,
            deleteMemories: settings.deleteMemories !== false,
            restoreSidePrompts: settings.restoreSidePrompts !== false,
        }, markerRevision, highest: markers.highestMemoryProcessed ?? null,
        manuallySet: markers.highestMemoryProcessedManuallySet === true,
    } });
}
