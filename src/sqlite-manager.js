import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const SQLITE_BUSY_TIMEOUT_MS = 10_000;
const SQLITE_STORAGE_VERSION = '20260711.1';
const MAX_OPERATION_RECEIPTS = 4096;

function getPersistedMessageUuid(message) {
    return typeof message?.aikobots_message_uuid === 'string' && message.aikobots_message_uuid
        ? message.aikobots_message_uuid
        : null;
}

function getBindParameters(parameters) {
    if (parameters === undefined) {
        return [];
    }

    return Array.isArray(parameters) ? parameters : [parameters];
}

class NativeStatementAdapter {
    constructor(statement) {
        this.statement = statement;
        this.boundParameters = [];
        this.iterator = null;
        this.currentRow = null;
    }

    resetIterator() {
        this.iterator?.return?.();
        this.iterator = null;
        this.currentRow = null;
    }

    bind(parameters) {
        this.resetIterator();
        this.boundParameters = getBindParameters(parameters);
        return true;
    }

    step() {
        if (!this.iterator) {
            this.iterator = this.statement.raw(true).iterate(...this.boundParameters)[Symbol.iterator]();
        }

        const next = this.iterator.next();
        this.currentRow = next.done ? null : next.value;
        return !next.done;
    }

    get() {
        return this.currentRow;
    }

    run(parameters = undefined) {
        const bindParameters = parameters === undefined ? this.boundParameters : getBindParameters(parameters);
        this.resetIterator();
        return this.statement.run(...bindParameters);
    }

    free() {
        this.resetIterator();
    }
}

/**
 * Compatibility adapter that keeps the existing chat storage helpers stable while
 * executing against a native, file-backed SQLite connection.
 */
class NativeDatabaseAdapter {
    constructor(filePath, { initialize = false, journalMode = 'WAL' } = {}) {
        this.filePath = filePath;
        this.database = new Database(filePath);
        this.database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
        this.database.pragma('synchronous = FULL');
        this.database.pragma('foreign_keys = ON');
        this.database.function('aikobots_lower', { deterministic: true }, value => String(value ?? '').toLowerCase());
        this.database.pragma(`journal_mode = ${journalMode}`);
        if (journalMode === 'WAL') {
            this.database.pragma('wal_autocheckpoint = 1000');
        }

        if (initialize) {
            this.database.exec(`
        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_index REAL,
            content TEXT,
            message_uuid TEXT
        );
        CREATE INDEX idx_messages_order_index ON messages(order_index);
        CREATE INDEX idx_messages_message_uuid ON messages(message_uuid);
        CREATE TABLE operation_receipts (
            operation_id TEXT PRIMARY KEY,
            request_fingerprint TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        INSERT INTO metadata (key, value) VALUES ('storage_version', '${SQLITE_STORAGE_VERSION}');
            `);
        } else {
            this.upgradeSchema();
        }
    }

    upgradeSchema() {
        const initialColumns = this.database.pragma('table_info(messages)');
        if (!initialColumns.length) {
            throw new Error('SQLite chat is missing the messages table.');
        }

        const initialVersion = this.database.prepare('SELECT value FROM metadata WHERE key = \'storage_version\'').pluck().get();
        const hasMessageUuidColumn = initialColumns.some(column => column.name === 'message_uuid');
        const hasMessageUuidIndex = Boolean(this.database.prepare(`
            SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_messages_message_uuid'
        `).pluck().get());
        const hasOperationReceiptsTable = Boolean(this.database.prepare(`
            SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'operation_receipts'
        `).pluck().get());
        if (initialVersion === SQLITE_STORAGE_VERSION && hasMessageUuidColumn && hasMessageUuidIndex && hasOperationReceiptsTable) {
            return;
        }

        const upgrade = this.database.transaction(() => {
            const messageColumns = this.database.pragma('table_info(messages)');
            const storedVersion = this.database.prepare('SELECT value FROM metadata WHERE key = \'storage_version\'').pluck().get();
            const addedMessageUuidColumn = !messageColumns.some(column => column.name === 'message_uuid');
            if (addedMessageUuidColumn) {
                this.database.exec('ALTER TABLE messages ADD COLUMN message_uuid TEXT');
            }

            this.database.exec('CREATE INDEX IF NOT EXISTS idx_messages_message_uuid ON messages(message_uuid)');
            this.database.exec(`
                CREATE TABLE IF NOT EXISTS operation_receipts (
                    operation_id TEXT PRIMARY KEY,
                    request_fingerprint TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
            `);
            if (addedMessageUuidColumn || storedVersion !== SQLITE_STORAGE_VERSION) {
                const missingUuidRows = this.database.prepare(`
                    SELECT id, content
                    FROM messages
                    WHERE order_index > 0 AND message_uuid IS NULL
                `).all();
                const update = this.database.prepare('UPDATE messages SET message_uuid = ? WHERE id = ?');
                for (const row of missingUuidRows) {
                    const message = JSON.parse(row.content);
                    update.run(getPersistedMessageUuid(message), row.id);
                }
            }

            if (storedVersion !== SQLITE_STORAGE_VERSION) {
                this.database.prepare(`
                    INSERT INTO metadata (key, value) VALUES ('storage_version', ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                `).run(SQLITE_STORAGE_VERSION);
            }
        });
        upgrade.immediate();
    }

    exec(sql) {
        const normalizedSql = String(sql || '').trim();
        if (!normalizedSql) {
            return [];
        }

        const returnsRows = /^(?:SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(normalizedSql);
        if (!returnsRows) {
            this.database.exec(normalizedSql);
            return [];
        }

        const statement = this.database.prepare(normalizedSql).raw(true);
        const columns = statement.columns().map(column => column.name);
        const values = statement.all();
        return values.length || columns.length ? [{ columns, values }] : [];
    }

    run(sql, parameters = undefined) {
        if (parameters === undefined) {
            this.database.exec(sql);
            return this;
        }

        this.database.prepare(sql).run(...getBindParameters(parameters));
        return this;
    }

    prepare(sql) {
        return new NativeStatementAdapter(this.database.prepare(sql));
    }

    serialize() {
        if (this.database.inTransaction) {
            throw new Error('Cannot serialize a SQLite database during an active transaction.');
        }

        this.database.pragma('wal_checkpoint(TRUNCATE)');
        return this.database.serialize();
    }

    close() {
        if (this.database.open) {
            this.database.close();
        }
    }
}

/**
 * Opens a native file-backed SQLite database, creating the chat schema when absent.
 * @param {string} filePath
 * @returns {Promise<NativeDatabaseAdapter>}
 */
export async function loadDb(filePath) {
    const resolvedPath = path.resolve(filePath);
    const initialize = !fs.existsSync(resolvedPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    return new NativeDatabaseAdapter(resolvedPath, { initialize });
}

/**
 * Compatibility persistence boundary. Native SQLite commits are already durable;
 * this now verifies that callers did not leave an open transaction.
 * @param {NativeDatabaseAdapter} db
 * @param {string} filePath
 */
export function saveDb(db, filePath) {
    void filePath;
    if (db?.database?.inTransaction) {
        throw new Error('SQLite transaction remained open at the persistence boundary.');
    }
}

/**
 * Produces a consistent SQLite file image for an explicit raw export.
 * Ordinary chat mutations never serialize the whole database.
 * @param {string} filePath
 * @returns {Promise<Buffer>}
 */
export async function exportDatabaseFile(filePath) {
    const db = await loadDb(filePath);
    try {
        return db.serialize();
    } finally {
        db.close();
    }
}

/**
 * Migrates JSONL records to a SQLite file.
 * @param {Iterable<string|{content: string, label?: string}>|AsyncIterable<string|{content: string, label?: string}>} records JSONL record strings.
 * @param {string} sqlitePath
 * @returns {Promise<void>}
 */
export async function migrateFromJsonlRecords(records, sqlitePath) {
    const resolvedSqlitePath = path.resolve(sqlitePath);
    if (fs.existsSync(resolvedSqlitePath)) {
        throw new Error(`SQLite migration target already exists: ${resolvedSqlitePath}`);
    }

    const tempPath = `${resolvedSqlitePath}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(resolvedSqlitePath), { recursive: true });
    const db = new NativeDatabaseAdapter(tempPath, { initialize: true, journalMode: 'DELETE' });
    let migrated = false;
    try {
        db.run('BEGIN TRANSACTION');
        let stmt;
        try {
            stmt = db.prepare('INSERT INTO messages (order_index, content, message_uuid) VALUES (?, ?, ?)');
            let index = 0;
            for await (const record of records) {
                const line = typeof record === 'string' ? record : record?.content;
                if (!String(line || '').trim()) {
                    continue;
                }

                // Use index as order_index for initial migration
                let parsedRecord;
                try {
                    parsedRecord = JSON.parse(line);
                } catch (error) {
                    const label = typeof record === 'object' && record?.label ? record.label : `line ${index + 1}`;
                    throw new Error(`Invalid JSONL at ${label}: ${error.message}`);
                }
                stmt.run([index, line, index > 0 ? getPersistedMessageUuid(parsedRecord) : null]);
                index++;
            }
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        } finally {
            stmt?.free();
        }

        const check = db.exec('PRAGMA integrity_check');
        if (check[0]?.values?.[0]?.[0] !== 'ok') {
            throw new Error(`Database integrity check failed: ${check[0]?.values?.[0]?.[0] ?? 'unknown'}`);
        }
        migrated = true;
    } finally {
        db.close();
        let renamed = false;
        try {
            if (migrated) {
                fs.renameSync(tempPath, resolvedSqlitePath);
                renamed = true;
            }
        } finally {
            if (!renamed && fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            for (const sidecarPath of [`${tempPath}-journal`, `${tempPath}-wal`, `${tempPath}-shm`]) {
                if (fs.existsSync(sidecarPath)) {
                    fs.unlinkSync(sidecarPath);
                }
            }
        }
    }
}

/**
 * Migrates a JSONL chat file to a SQLite file.
 * @param {string} jsonlPath
 * @param {string} sqlitePath
 * @returns {Promise<void>}
 */
export async function migrateFromJsonl(jsonlPath, sqlitePath) {
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    await migrateFromJsonlRecords(lines, sqlitePath);
}

/**
 * Reindexes all messages to ensure order_index is sequential.
 * @param {NativeDatabaseAdapter} db
 */
export function reindexChat(db) {
    const messages = getMessages(db);
    setMessages(db, messages);
}

function setMessagesWithoutTransaction(db, messages) {
    db.run('DELETE FROM messages');
    let stmt;
    try {
        stmt = db.prepare('INSERT INTO messages (order_index, content, message_uuid) VALUES (?, ?, ?)');
        for (let i = 0; i < messages.length; i++) {
            stmt.run([i, JSON.stringify(messages[i]), i > 0 ? getPersistedMessageUuid(messages[i]) : null]);
        }
    } finally {
        stmt?.free();
    }
}

/**
 * Gets all messages from the database.
 * @param {NativeDatabaseAdapter} db
 * @returns {any[]}
 */
export function getMessages(db) {
    const res = db.exec('SELECT id, order_index, content FROM messages ORDER BY order_index ASC');
    if (res.length === 0) return [];
    const messages = res[0].values.map(row => {
        const id = Number(row[0]);
        const orderIndex = Number(row[1]);
        const message = JSON.parse(row[2]);
        if (message && typeof message === 'object') {
            message.id = id;
            message.order_index = orderIndex;
        }
        return message;
    });
    return messages;
}

/**
 * Gets the chat header (first message) from the database.
 * @param {NativeDatabaseAdapter} db
 * @returns {any|null}
 */
export function getChatHeader(db) {
    const res = db.exec('SELECT id, order_index, content FROM messages WHERE order_index = 0');
    if (res.length === 0 || res[0].values.length === 0) return null;
    const row = res[0].values[0];
    const id = Number(row[0]);
    const orderIndex = Number(row[1]);
    const message = JSON.parse(row[2]);
    if (message && typeof message === 'object') {
        message.id = id;
        message.order_index = orderIndex;
    }
    return message;
}

/**
 * Gets the total number of messages (excluding header) from the database.
 * @param {NativeDatabaseAdapter} db
 * @returns {number}
 */
export function getMessageCount(db) {
    const res = db.exec('SELECT COUNT(*) FROM messages WHERE order_index > 0');
    if (res.length === 0) return 0;
    return res[0].values[0][0];
}

/**
 * Gets the last message from the database.
 * @param {NativeDatabaseAdapter} db
 * @returns {any|null}
 */
export function getLastMessage(db) {
    const res = db.exec('SELECT id, order_index, content FROM messages WHERE order_index > 0 ORDER BY order_index DESC LIMIT 1');
    if (res.length === 0 || res[0].values.length === 0) return null;
    const row = res[0].values[0];
    const id = Number(row[0]);
    const orderIndex = Number(row[1]);
    const message = JSON.parse(row[2]);
    if (message && typeof message === 'object') {
        message.id = id;
        message.order_index = orderIndex;
    }
    return message;
}

/**
 * Gets a range of messages (excluding header) from the database.
 * @param {NativeDatabaseAdapter} db
 * @param {number} offset
 * @param {number} limit
 * @returns {any[]}
 */
export function getMessageRange(db, offset, limit) {
    const stmt = db.prepare('SELECT id, order_index, content FROM messages WHERE order_index > 0 ORDER BY order_index ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const messages = [];
    try {
        while (stmt.step()) {
            const row = stmt.get();
            const id = Number(row[0]);
            const orderIndex = Number(row[1]);
            const message = JSON.parse(row[2]);
            if (message && typeof message === 'object') {
                message.id = id;
                message.order_index = orderIndex;
            }
            messages.push(message);
        }
    } finally {
        stmt.free();
    }
    return messages;
}

/**
 * Gets a logical message row by zero-based message id, excluding the header.
 * @param {NativeDatabaseAdapter} db
 * @param {number} messageId
 * @returns {{id: number, orderIndex: number, content: string, message: any}|null}
 */
export function getLogicalMessageRow(db, messageId) {
    const normalizedMessageId = Number(messageId);
    if (!Number.isInteger(normalizedMessageId) || normalizedMessageId < 0) {
        return null;
    }

    const stmt = db.prepare('SELECT id, order_index, content FROM messages WHERE order_index > 0 ORDER BY order_index ASC LIMIT 1 OFFSET ?');
    stmt.bind([normalizedMessageId]);
    try {
        if (!stmt.step()) {
            return null;
        }

        const row = stmt.get();
        const id = Number(row[0]);
        const orderIndex = Number(row[1]);
        const message = JSON.parse(row[2]);
        if (message && typeof message === 'object') {
            message.id = id;
            message.order_index = orderIndex;
        }
        return {
            id: id,
            orderIndex: orderIndex,
            content: row[2],
            message: message,
        };
    } finally {
        stmt.free();
    }
}

function getOrderedRows(db, startIndex, count) {
    const stmt = db.prepare('SELECT id, order_index, content FROM messages ORDER BY order_index ASC LIMIT ? OFFSET ?');
    stmt.bind([count, startIndex]);
    const rows = [];
    try {
        while (stmt.step()) {
            const row = stmt.get();
            rows.push({
                id: row[0],
                orderIndex: row[1],
                content: row[2],
            });
        }
    } finally {
        stmt.free();
    }

    return rows;
}

function getLastOrderIndex(db) {
    const res = db.exec('SELECT order_index FROM messages ORDER BY order_index DESC LIMIT 1');
    if (res.length === 0 || res[0].values.length === 0) {
        return -1;
    }

    return Number(res[0].values[0][0]);
}

/** Error carrying only a safe migration mismatch category. */
export class MigrationEquivalenceError extends Error {
    constructor(category) {
        super(`SQLite migration equivalence check failed: ${category}`);
        this.name = 'MigrationEquivalenceError';
        this.category = category;
    }
}

function normalizeJsonForEquivalence(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(normalizeJsonForEquivalence);
    }

    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = normalizeJsonForEquivalence(value[key]);
        return result;
    }, {});
}

function migrationValuesEqual(left, right) {
    return JSON.stringify(normalizeJsonForEquivalence(left)) === JSON.stringify(normalizeJsonForEquivalence(right));
}

/**
 * Verifies that ordered JSONL records and a SQLite chat represent the same logical chat.
 * Errors contain only a safe mismatch category and never include persisted values.
 * @param {Iterable<string|{content: string}>|AsyncIterable<string|{content: string}>} records Complete source records, including the header.
 * @param {string} sqlitePath SQLite destination path.
 * @returns {Promise<void>}
 */
export async function verifyJsonlRecordsMatchSqlite(records, sqlitePath) {
    const db = await loadDb(sqlitePath);
    let statement;
    let rowIterator;
    let sourceIndex = 0;
    try {
        const integrityResult = db.exec('PRAGMA integrity_check')?.[0]?.values?.[0]?.[0];
        if (integrityResult !== 'ok') {
            throw new MigrationEquivalenceError('integrity_check_failed');
        }

        statement = db.prepare('SELECT content FROM messages ORDER BY order_index ASC, id ASC');
        rowIterator = statement.statement.raw(true).iterate()[Symbol.iterator]();
        for await (const record of records) {
            const line = typeof record === 'string' ? record : record?.content;
            if (!String(line || '').trim()) {
                continue;
            }

            const destination = rowIterator.next();
            if (destination.done) {
                throw new MigrationEquivalenceError(sourceIndex === 0 ? 'header_mismatch' : 'message_count_mismatch');
            }

            let sourceValue;
            let destinationValue;
            try {
                sourceValue = JSON.parse(line);
                destinationValue = JSON.parse(destination.value[0]);
            } catch {
                throw new MigrationEquivalenceError(sourceIndex === 0 ? 'header_mismatch' : 'message_metadata_mismatch');
            }

            if (!migrationValuesEqual(sourceValue, destinationValue)) {
                throw new MigrationEquivalenceError(sourceIndex === 0 ? 'header_mismatch' : 'message_content_mismatch');
            }
            sourceIndex++;
        }

        if (!rowIterator.next().done) {
            throw new MigrationEquivalenceError(sourceIndex === 0 ? 'header_mismatch' : 'message_count_mismatch');
        }
    } finally {
        rowIterator?.return?.();
        statement?.free();
        db.close();
    }
}

/**
 * Gets an ordered logical message row by Aikobots message UUID.
 * @param {NativeDatabaseAdapter} db
 * @param {string} messageUuid
 * @returns {{logicalIndex: number, id: number, orderIndex: number, content: string, message: any}|null}
 */
export function getLogicalMessageRowByUuid(db, messageUuid) {
    const normalizedUuid = String(messageUuid || '').trim();
    if (!normalizedUuid) {
        return null;
    }

    const stmt = db.prepare(`
        SELECT id, order_index, content
        FROM messages
        WHERE order_index > 0 AND message_uuid = ?
        ORDER BY order_index ASC
        LIMIT 2
    `);
    stmt.bind([normalizedUuid]);
    const matches = [];
    try {
        while (stmt.step()) {
            matches.push(stmt.get());
        }
    } finally {
        stmt.free();
    }

    if (matches.length !== 1) {
        return null;
    }

    const [id, orderIndex, content] = matches[0];
    const countStmt = db.prepare('SELECT COUNT(*) FROM messages WHERE order_index > 0 AND order_index < ?');
    countStmt.bind([orderIndex]);
    let logicalIndex;
    try {
        logicalIndex = countStmt.step() ? Number(countStmt.get()[0]) : 0;
    } finally {
        countStmt.free();
    }

    const message = JSON.parse(content);
    if (message && typeof message === 'object') {
        message.id = Number(id);
        message.order_index = Number(orderIndex);
    }

    return {
        logicalIndex,
        id: Number(id),
        orderIndex: Number(orderIndex),
        content,
        message,
    };
}

/**
 * Appends one logical message after the current SQLite tail.
 * @param {NativeDatabaseAdapter} db
 * @param {any} message
 * @returns {number} Inserted logical message id.
 */
export function appendLogicalMessage(db, message) {
    const orderIndex = getLastOrderIndex(db) + 1;
    const stmt = db.prepare('INSERT INTO messages (order_index, content, message_uuid) VALUES (?, ?, ?)');
    try {
        stmt.run([orderIndex, JSON.stringify(message), getPersistedMessageUuid(message)]);
    } finally {
        stmt.free();
    }

    return getMessageCount(db) - 1;
}

/**
 * Updates a logical message row by SQLite row id.
 * @param {NativeDatabaseAdapter} db
 * @param {number} rowId
 * @param {any} message
 */
export function updateLogicalMessageRowById(db, rowId, message) {
    const id = Number(rowId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Invalid SQLite message row id.');
    }

    const stmt = db.prepare('UPDATE messages SET content = ?, message_uuid = ? WHERE id = ?');
    try {
        stmt.run([JSON.stringify(message), getPersistedMessageUuid(message), id]);
    } finally {
        stmt.free();
    }
}

/**
 * Deletes all logical rows after the supplied logical message id.
 * @param {NativeDatabaseAdapter} db
 * @param {number} messageId
 */
export function deleteLogicalMessagesAfter(db, messageId) {
    const row = getLogicalMessageRow(db, messageId);
    if (!row) {
        throw new Error('Message to truncate after was not found.');
    }

    const stmt = db.prepare('DELETE FROM messages WHERE order_index > ?');
    try {
        stmt.run([row.orderIndex]);
    } finally {
        stmt.free();
    }
}

/**
 * Deletes every logical chat message while preserving the header row.
 * @param {NativeDatabaseAdapter} db
 */
export function deleteAllLogicalMessages(db) {
    db.run('DELETE FROM messages WHERE order_index > 0');
}

/**
 * Inserts a logical message immediately after the supplied logical message id.
 * @param {NativeDatabaseAdapter} db
 * @param {number} messageId
 * @param {any} message
 * @returns {number} Inserted logical message id.
 */
export function insertLogicalMessageAfter(db, messageId, message) {
    const normalizedMessageId = Number(messageId);
    if (!Number.isInteger(normalizedMessageId) || normalizedMessageId < 0) {
        throw new Error('Invalid logical message insert id.');
    }

    const ownsTransaction = !db?.database?.inTransaction;
    if (ownsTransaction) {
        db.run('BEGIN TRANSACTION');
    }
    try {
        const sourceRow = getLogicalMessageRow(db, normalizedMessageId);
        if (!sourceRow) {
            throw new Error('Message to clone was not found.');
        }

        const nextRow = getLogicalMessageRow(db, normalizedMessageId + 1);
        let orderIndex = nextRow
            ? (Number(sourceRow.orderIndex) + Number(nextRow.orderIndex)) / 2
            : Number(sourceRow.orderIndex) + 1;

        if (!Number.isFinite(orderIndex) || orderIndex === Number(sourceRow.orderIndex) || (nextRow && orderIndex === Number(nextRow.orderIndex))) {
            setMessagesWithoutTransaction(db, getMessages(db));
            const reindexedSourceRow = getLogicalMessageRow(db, normalizedMessageId);
            const reindexedNextRow = getLogicalMessageRow(db, normalizedMessageId + 1);
            orderIndex = reindexedNextRow
                ? (Number(reindexedSourceRow.orderIndex) + Number(reindexedNextRow.orderIndex)) / 2
                : Number(reindexedSourceRow.orderIndex) + 1;
        }

        const stmt = db.prepare('INSERT INTO messages (order_index, content, message_uuid) VALUES (?, ?, ?)');
        try {
            stmt.run([orderIndex, JSON.stringify(message), getPersistedMessageUuid(message)]);
        } finally {
            stmt.free();
        }

        if (ownsTransaction) {
            db.run('COMMIT');
        }
        return normalizedMessageId + 1;
    } catch (error) {
        if (ownsTransaction && db?.database?.inTransaction) {
            db.run('ROLLBACK');
        }
        throw error;
    }
}

/**
 * Sets all messages in the database.
 * @param {NativeDatabaseAdapter} db
 * @param {any[]} messages
 */
export function setMessages(db, messages) {
    const ownsTransaction = !db?.database?.inTransaction;
    if (ownsTransaction) {
        db.run('BEGIN TRANSACTION');
    }
    try {
        setMessagesWithoutTransaction(db, messages);
        if (ownsTransaction) {
            db.run('COMMIT');
        }
    } catch (error) {
        if (ownsTransaction && db?.database?.inTransaction) {
            db.run('ROLLBACK');
        }
        throw error;
    }
}

function getOperationRequestFingerprint(requestBody) {
    return crypto.createHash('sha256').update(JSON.stringify(requestBody ?? {})).digest('hex');
}

/** Returns a persisted idempotency acknowledgement for an exact repeated operation. */
export function getOperationReceipt(db, operationId, requestBody) {
    const normalizedOperationId = String(operationId || '').trim();
    if (!normalizedOperationId) {
        return null;
    }

    const stmt = db.prepare('SELECT request_fingerprint, response_json FROM operation_receipts WHERE operation_id = ?');
    stmt.bind([normalizedOperationId]);
    try {
        if (!stmt.step()) {
            return null;
        }
        const [requestFingerprint, responseJson] = stmt.get();
        if (requestFingerprint !== getOperationRequestFingerprint(requestBody)) {
            const error = new Error('Operation UUID was reused with a different request payload.');
            error.code = 'operation_id_reused';
            throw error;
        }
        return JSON.parse(responseJson);
    } finally {
        stmt.free();
    }
}

/** Records an operation acknowledgement in the caller's active mutation transaction. */
export function recordOperationReceipt(db, operationId, requestBody, responseData) {
    const normalizedOperationId = String(operationId || '').trim();
    if (!normalizedOperationId) {
        return;
    }
    if (!db?.database?.inTransaction) {
        throw new Error('Operation receipts must be recorded inside the mutation transaction.');
    }

    const stmt = db.prepare(`
        INSERT INTO operation_receipts (operation_id, request_fingerprint, response_json, created_at)
        VALUES (?, ?, ?, ?)
    `);
    try {
        stmt.run([
            normalizedOperationId,
            getOperationRequestFingerprint(requestBody),
            JSON.stringify(responseData ?? {}),
            Date.now(),
        ]);
        db.run(`
            DELETE FROM operation_receipts
            WHERE operation_id IN (
                SELECT operation_id
                FROM operation_receipts
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ${MAX_OPERATION_RECEIPTS}
            )
        `);
    } finally {
        stmt.free();
    }
}

/**
 * Updates a range of messages in the database.
 * @param {NativeDatabaseAdapter} db
 * @param {any[]} messages
 * @param {number} startIndex
 */
export function updateMessages(db, messages, startIndex) {
    db.run('BEGIN TRANSACTION');
    try {
        if (!Number.isInteger(startIndex) || startIndex < 0) {
            throw new Error('Invalid message update start index.');
        }

        const countResult = db.exec('SELECT COUNT(*) AS count FROM messages');
        const messageRowCount = countResult[0]?.values?.[0]?.[0] ?? 0;
        if (startIndex > messageRowCount) {
            throw new Error('Message update would create a gap.');
        }

        if (messages.length === 0) {
            db.run('COMMIT');
            return;
        }

        const targetRows = getOrderedRows(db, startIndex, messages.length);
        if (targetRows.length !== messages.length && startIndex !== messageRowCount) {
            throw new Error('Message update range exceeds existing messages.');
        }

        const appendBaseOrderIndex = targetRows.length === messages.length ? null : getLastOrderIndex(db);
        let stmt;
        try {
            stmt = targetRows.length === messages.length
                ? db.prepare('UPDATE messages SET content = ?, message_uuid = ? WHERE id = ?')
                : db.prepare('INSERT INTO messages (order_index, content, message_uuid) VALUES (?, ?, ?)');

            for (let i = 0; i < messages.length; i++) {
                if (targetRows.length === messages.length) {
                    stmt.run([JSON.stringify(messages[i]), getPersistedMessageUuid(messages[i]), targetRows[i].id]);
                } else {
                    stmt.run([appendBaseOrderIndex + 1 + i, JSON.stringify(messages[i]), getPersistedMessageUuid(messages[i])]);
                }
            }
        } finally {
            stmt?.free();
        }
        db.run('COMMIT');
    } catch (error) {
        db.run('ROLLBACK');
        throw error;
    }
}
/**
 * Updates metadata in the database.
 * @param {NativeDatabaseAdapter} db
 * @param {string} key
 * @param {string} value
 */
export function setMetadata(db, key, value) {
    db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Gets metadata from the database.
 * @param {NativeDatabaseAdapter} db
 * @param {string} key
 * @returns {string|null}
 */
export function getMetadata(db, key) {
    const stmt = db.prepare('SELECT value FROM metadata WHERE key = ?');
    stmt.bind([key]);
    let result = null;
    try {
        if (stmt.step()) {
            result = stmt.get()[0];
        }
    } finally {
        stmt.free();
    }
    return result;
}
