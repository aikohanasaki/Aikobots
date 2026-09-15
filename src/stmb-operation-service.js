import { loadDb, getChatHeader } from './sqlite-manager.js';
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
    for (const target of operation.data.targets) {
        const loaded = await getLorebookForManagement(user, target.name, false, target.storage);
        const entries = Object.values(loaded.data?.entries || {}).filter(entry => entry.STMB_operationId === operation.data.attribution);
        const previous = operation.data.plannedReceipts.find(receipt => receipt.name === loaded.metadata.name && receipt.storage === loaded.metadata.storage);
        const hashes = entries.map(entry => ({ uid: entry.uid, hash: hashStmbRollbackState(entry) }));
        if (entries.length !== target.count || !previous || JSON.stringify(previous.hashes) !== JSON.stringify(hashes)) {
            operation.state = 'conflict';
            writeStmbOperation(db, operation);
            return;
        }
        receipts.push({ name: loaded.metadata.name, storage: loaded.metadata.storage, hashes });
    }
    operation.data.receipts = receipts;
    operation.state = 'saved';
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
            if (operation.state !== 'prepared') {
                await reconcileStmbMemory(request.user, db, operation);
                if (!['saved', 'applied'].includes(operation.state)) throw stmbOperationConflict();
                return { ok: true, memorySaved: true, operation: publicStmbOperation(operation), replayed: true };
            }
            // Replaying a prepared save is resolved from attribution, never by blindly creating another entry.
            if (operation.data.started) {
                await reconcileStmbMemory(request.user, db, operation);
                if (operation.state !== 'saved') throw stmbOperationConflict();
                return { ok: true, memorySaved: true, operation: publicStmbOperation(operation), replayed: true };
            }
            validateStmbOperationSource(db, operation);
            operation.data.started = true;
            writeStmbOperation(db, operation);
            const result = await callback({ ...transaction, save: async (user, name, data, storage) => {
                const previous = before.get(`${storage}:${name}`);
                for (const [uid, entry] of Object.entries(data.entries || {})) {
                    if (previous && !previous.has(uid)) entry.STMB_operationId = operation.data.attribution;
                }
                const hashes = Object.values(data.entries || {}).filter(entry => entry.STMB_operationId === operation.data.attribution).map(entry => ({ uid: entry.uid, hash: hashStmbRollbackState(entry) }));
                const planned = operation.data.plannedReceipts.filter(receipt => receipt.name !== name || receipt.storage !== storage);
                operation.data.plannedReceipts = [...planned, { name, storage, hashes }];
                writeStmbOperation(db, operation);
                return transaction.save(user, name, data, storage);
            } });
            await reconcileStmbMemory(request.user, db, operation);
            return { ...result, memorySaved: true, operation: publicStmbOperation(operation) };
        } finally { db.close(); }
    }));
}

/** Lists durable work or resolves a saved marker under the normal lock order. */
export async function resolveStmbOperations(request, sqlitePath) {
    return withLorebookManagementTransaction(transaction => withChatSaveLock(sqlitePath, async () => {
        const db = await loadDb(sqlitePath);
        try {
            if (request.body.action === 'prepare') {
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
            const operations = readStmbOperations(db);
            const requested = request.body.id;
            const operation = operations.find(item => item.id === requested);
            if (request.body.action && !operation) throw stmbOperationConflict();
            if (operation && request.body.action === 'retry') {
                if (operation.state !== 'applied' && Number(request.body.base_revision) !== Number(getChatHeader(db).chat_revision || 0)) throw stmbOperationConflict();
                if (operation.kind === 'rollback') await executeStmbRollback(request.user, db, operation, transaction);
                else {
                    await reconcileStmbMemory(request.user, db, operation);
                    if (!['saved', 'applied'].includes(operation.state)) throw stmbOperationConflict();
                    applyStmbProgress(db, operation);
                }
            } else if (operation && request.body.action === 'ack-effects' && operation.state === 'applied') {
                operation.data.effectsPending = false;
                writeStmbOperation(db, operation);
            } else if (operation && request.body.action === 'discard') {
                operation.state = 'discarded';
                operation.data.effectsPending = false;
                writeStmbOperation(db, operation);
            } else if (request.body.action) throw stmbOperationConflict();
            const header = getChatHeader(db);
            return { ok: true, status: 'noop', chat_revision: Number(header.chat_revision || 0), highestMemoryProcessed: header.chat_metadata?.STMemoryBooks?.highestMemoryProcessed ?? null,
                highestMemoryProcessedManuallySet: header.chat_metadata?.STMemoryBooks?.highestMemoryProcessedManuallySet === true,
                hideRanges: operation?.data.hideRanges || [], clearScene: operation?.data.clearScene === true,
                postSaveLorebook: operation?.state === 'applied' && operation.data.effectsPending ? operation.data.targets?.[0]?.name : null,
                operations: readStmbOperations(db).filter(item => item.data.effectsPending || !['applied', 'discarded'].includes(item.state)).map(publicStmbOperation) };
        } finally { db.close(); }
    }));
}
