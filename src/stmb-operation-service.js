import { loadDb, getChatHeader, getOperationReceipt, recordOperationReceipt } from './sqlite-manager.js';
import { withChatSaveLock } from './chat-storage.js';
import { getLorebookForManagement, withLorebookManagementTransaction } from './lorebook-repository.js';
import { beginStmbOperation, readStmbOperations, writeStmbOperation, applyStmbProgress, validateStmbOperationSource, stmbOperationConflict } from './stmb-operations.js';
import { executeStmbRollback, hashStmbRollbackState } from './stmb-rollback.js';

/** Returns the public status of an operation without exposing its internal targets. */
export function publicStmbOperation(operation) {
    return { id: operation.id, kind: operation.kind, state: operation.state };
}

/** Runs deletion follow-up after its response; the durable intent survives a stopped worker. */
export async function recoverStmbRollback(user, sqlitePath) {
    return withLorebookManagementTransaction(transaction => withChatSaveLock(sqlitePath, async () => {
        const db = await loadDb(sqlitePath);
        try {
            for (const operation of readStmbOperations(db).filter(item => item.kind === 'rollback' && !['applied', 'discarded'].includes(item.state))) {
                try { await executeStmbRollback(user, db, operation, transaction); }
                catch {
                    operation.state = 'conflict';
                    writeStmbOperation(db, operation);
                }
            }
        } finally { db.close(); }
    }));
}

/** Resolves saved attribution after a worker stopped between a book write and its receipt. */
export async function reconcileStmbMemory(user, db, operation) {
    if (['applied', 'discarded'].includes(operation.state)) return;
    const receipts = [];
    let matches = true;
    let hasAttributedEntries = false;
    for (const target of operation.data.targets) {
        const loaded = await getLorebookForManagement(user, target.name, false, target.storage);
        const entries = Object.values(loaded.data?.entries || {}).filter(entry => entry.STMB_operationId === operation.data.attribution);
        hasAttributedEntries ||= entries.length > 0;
        const previous = operation.data.plannedReceipts.find(receipt => receipt.name === loaded.metadata.name && receipt.storage === loaded.metadata.storage);
        const hashes = entries.map(entry => ({ uid: entry.uid, hash: hashStmbRollbackState(entry) }));
        if (entries.length !== target.count || !previous || JSON.stringify(previous.hashes) !== JSON.stringify(hashes)) {
            matches = false;
        }
        receipts.push({ name: loaded.metadata.name, storage: loaded.metadata.storage, hashes });
    }
    // Older workers marked started before validation. No write intent and no attribution proves no write occurred.
    if (!hasAttributedEntries && operation.data.plannedReceipts.length === 0) {
        operation.data.started = false;
        operation.state = 'prepared';
    } else {
        operation.state = matches ? 'saved' : 'conflict';
    }
    operation.data.receipts = receipts;
    writeStmbOperation(db, operation);
}

/** Saves an attributed memory under lorebook then chat locks, leaving recoverable progress. */
export async function withStmbMemoryTransaction(request, sqlitePath, callback) {
    if (!request.body.operation) return withLorebookManagementTransaction(callback);
    return withLorebookManagementTransaction(transaction => withChatSaveLock(sqlitePath, async () => {
        const db = await loadDb(sqlitePath);
        try {
            const raw = request.body.primary ? [request.body.primary, ...(request.body.targets || [])] : [{ lorebookName: request.body.lorebookName, storage: request.body.storage }];
            const unique = new Map();
            const before = new Map();
            for (const target of raw) {
                const book = await getLorebookForManagement(request.user, target.lorebookName, false, target.storage || 'user');
                if (book.metadata.storage !== 'user') throw stmbOperationConflict();
                const key = `${book.metadata.storage}:${book.metadata.name}`;
                const existing = unique.get(key);
                unique.set(key, { name: book.metadata.name, storage: book.metadata.storage, count: (existing?.count || 0) + 1 });
                before.set(key, new Set(Object.keys(book.data.entries || {})));
            }
            const operation = beginStmbOperation(db, request.body.operation, [...unique.values()]);
            if (operation.state === 'discarded') throw stmbOperationConflict();
            if (operation.data.started || operation.state !== 'prepared') {
                await reconcileStmbMemory(request.user, db, operation);
                if (['saved', 'applied'].includes(operation.state)) {
                    await request.activeSessionOperation?.assertAllowed();
                    applyStmbProgress(db, operation);
                    return { ...buildStmbOperationResult(db, operation), memorySaved: true, operation: publicStmbOperation(operation), replayed: true };
                }
                if (operation.state !== 'prepared') throw stmbOperationConflict();
            }
            validateStmbOperationSource(db, operation);
            const result = await callback({ ...transaction, save: async (user, name, data, storage) => {
                const previous = before.get(`${storage}:${name}`);
                for (const [uid, entry] of Object.entries(data.entries || {})) {
                    if (previous && !previous.has(uid)) entry.STMB_operationId = operation.data.attribution;
                }
                const hashes = Object.values(data.entries || {}).filter(entry => entry.STMB_operationId === operation.data.attribution).map(entry => ({ uid: entry.uid, hash: hashStmbRollbackState(entry) }));
                const planned = operation.data.plannedReceipts.filter(receipt => receipt.name !== name || receipt.storage !== storage);
                operation.data.plannedReceipts = [...planned, { name, storage, hashes }];
                operation.data.started = true;
                writeStmbOperation(db, operation);
                return transaction.save(user, name, data, storage);
            } });
            await reconcileStmbMemory(request.user, db, operation);
            if (operation.state !== 'saved') throw stmbOperationConflict();
            await request.activeSessionOperation?.assertAllowed();
            applyStmbProgress(db, operation);
            return { ...result, ...buildStmbOperationResult(db, operation), memorySaved: true, operation: publicStmbOperation(operation) };
        } finally { db.close(); }
    }));
}

/** Builds an acknowledgement from current state without exposing the operation journal. */
function buildStmbOperationResult(db, operation, retryRange = null) {
    const header = getChatHeader(db);
    return { ok: true, status: 'noop', chat_revision: Number(header.chat_revision || 0),
        memorySaved: operation?.kind === 'memory' && ['saved', 'applied'].includes(operation.state),
        previous_revision: operation?.data.appliedRevision ? operation.data.appliedRevision - 1 : Number(header.chat_revision || 0),
        highestMemoryProcessed: header.chat_metadata?.STMemoryBooks?.highestMemoryProcessed ?? null,
        highestMemoryProcessedManuallySet: header.chat_metadata?.STMemoryBooks?.highestMemoryProcessedManuallySet === true,
        previousProgress: operation ? { highest: operation.data.highest ?? null, manuallySet: operation.data.manuallySet === true } : null,
        retryRange,
        hideRanges: operation?.state === 'applied' ? operation.data.hideRanges || [] : [],
        clearScene: operation?.state === 'applied' && operation.data.clearSceneApplied === true,
        sceneStartBefore: operation?.data.sceneStart ?? null, sceneEndBefore: operation?.data.sceneEnd ?? null,
        postSaveLorebook: operation?.state === 'applied' && operation.data.effectsPending ? operation.data.targets?.[0]?.name : null,
        operations: readStmbOperations(db).filter(item => !['applied', 'discarded'].includes(item.state)).map(publicStmbOperation),
    };
}

/** Records journal-only transitions and their reply in the same SQLite transaction. */
function acknowledgeStmbOperation(db, request, operation, retryRange = null) {
    db.run('BEGIN IMMEDIATE');
    try {
        writeStmbOperation(db, operation);
        const result = buildStmbOperationResult(db, operation, retryRange);
        recordOperationReceipt(db, request.body.operation_id, request.body, result);
        db.run('COMMIT');
        return result;
    } catch (error) { db.run('ROLLBACK'); throw error; }
}

/** Lists durable work or resolves a saved marker under the normal lock order. */
export async function resolveStmbOperations(request, sqlitePath) {
    return withLorebookManagementTransaction(transaction => withChatSaveLock(sqlitePath, async () => {
        const db = await loadDb(sqlitePath);
        try {
            await request.activeSessionOperation?.assertAllowed();
            const action = request.body.action;
            if (action === 'prepare') {
                const targets = request.body.targets;
                if (!Array.isArray(targets) || targets.length === 0 || targets.length > 101) throw stmbOperationConflict();
                const normalized = new Map();
                for (const target of targets) {
                    const book = await getLorebookForManagement(request.user, target.name, false, target.storage || 'user');
                    if (book.metadata.storage !== 'user') throw stmbOperationConflict();
                    const key = `${book.metadata.storage}:${book.metadata.name}`;
                    const previous = normalized.get(key);
                    normalized.set(key, { name: book.metadata.name, storage: book.metadata.storage, count: (previous?.count || 0) + 1 });
                }
                const operation = beginStmbOperation(db, request.body.operation, [...normalized.values()]);
                if (operation.data.started) await reconcileStmbMemory(request.user, db, operation);
                if (operation.state === 'conflict' || operation.state === 'discarded') throw stmbOperationConflict();
                return { ok: true, operation: publicStmbOperation(operation) };
            }
            const operation = readStmbOperations(db).find(item => item.id === request.body.id);
            if (action === 'cancel-unstarted') {
                // Cancellation never removes evidence of a possible write or revives a discarded operation.
                if (operation?.data.started) await reconcileStmbMemory(request.user, db, operation);
                if (operation?.state === 'prepared' && !operation.data.started && operation.data.plannedReceipts.length === 0) {
                    operation.state = 'discarded';
                    operation.data.effectsPending = false;
                    operation.data.canceledBeforeWrite = true;
                    writeStmbOperation(db, operation);
                }
                return { ok: true, canceled: operation?.data.canceledBeforeWrite === true, operation: operation ? publicStmbOperation(operation) : null };
            }
            if (action) {
                if (typeof request.body.operation_id !== 'string' || !/^[\w-]{1,100}$/.test(request.body.operation_id)) throw stmbOperationConflict();
                let receipt;
                try { receipt = getOperationReceipt(db, request.body.operation_id, request.body); }
                catch (error) {
                    if (error?.code === 'operation_id_reused') throw stmbOperationConflict();
                    throw error;
                }
                if (receipt) return receipt;
                if (!operation) throw stmbOperationConflict('StmbRecoveryOperationMissing');
            }
            if (action === 'retry') {
                if (operation.kind === 'rollback') {
                    // Rollbacks retain their broader deletion and book preconditions.
                    await executeStmbRollback(request.user, db, operation, transaction);
                } else {
                    if (operation.data.started) await reconcileStmbMemory(request.user, db, operation);
                    if (operation.state === 'prepared' && !operation.data.started) {
                        const { source } = validateStmbOperationSource(db, operation);
                        operation.state = 'discarded';
                        operation.data.effectsPending = false;
                        return acknowledgeStmbOperation(db, request, operation, { sceneStart: source.start, sceneEnd: source.end });
                    }
                    await reconcileStmbMemory(request.user, db, operation);
                    if (!['saved', 'applied'].includes(operation.state)) throw stmbOperationConflict('StmbRecoverySavedEntriesChanged');
                    await request.activeSessionOperation?.assertAllowed();
                    applyStmbProgress(db, operation);
                }
            } else if (action === 'ack-effects' && operation.state === 'applied') {
                operation.data.effectsPending = false;
            } else if (action === 'discard') {
                operation.state = 'discarded';
                operation.data.effectsPending = false;
            } else if (action) throw stmbOperationConflict();
            // Applied state is durable before this acknowledgement: a crash here cannot repeat a write.
            return action ? acknowledgeStmbOperation(db, request, operation) : buildStmbOperationResult(db);
        } finally { db.close(); }
    }));
}
