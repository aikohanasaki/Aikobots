import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

let SQL = null;

/**
 * Initializes the sql.js library.
 * @returns {Promise<void>}
 */
async function initSql() {
    if (SQL) return;
    SQL = await initSqlJs();
}

/**
 * Creates a new database with the required schema.
 * @returns {import('sql.js').Database}
 */
function createDatabase() {
    const db = new SQL.Database();
    db.run(`
        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_index REAL,
            content TEXT
        );
        CREATE INDEX idx_messages_order_index ON messages(order_index);
        INSERT INTO metadata (key, value) VALUES ('storage_version', '20260530');
    `);
    return db;
}

/**
 * Loads a database from a file.
 * @param {string} filePath
 * @returns {Promise<import('sql.js').Database>}
 */
export async function loadDb(filePath) {
    await initSql();
    if (!fs.existsSync(filePath)) {
        return createDatabase();
    }
    const fileBuffer = fs.readFileSync(filePath);
    return new SQL.Database(fileBuffer);
}

/**
 * Saves a database to a file.
 * @param {import('sql.js').Database} db
 * @param {string} filePath
 */
export function saveDb(db, filePath) {
    // Integrity check
    const check = db.exec('PRAGMA integrity_check');
    if (check[0].values[0][0] !== 'ok') {
        throw new Error(`Database integrity check failed: ${check[0].values[0][0]}`);
    }

    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileAtomicSync(filePath, buffer);
}

/**
 * Migrates JSONL records to a SQLite file.
 * @param {Iterable<string|{content: string, label?: string}>|AsyncIterable<string|{content: string, label?: string}>} records JSONL record strings.
 * @param {string} sqlitePath
 * @returns {Promise<void>}
 */
export async function migrateFromJsonlRecords(records, sqlitePath) {
    await initSql();
    const db = createDatabase();
    try {
        db.run('BEGIN TRANSACTION');
        let stmt;
        try {
            stmt = db.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)');
            let index = 0;
            for await (const record of records) {
                const line = typeof record === 'string' ? record : record?.content;
                if (!String(line || '').trim()) {
                    continue;
                }

                // Use index as order_index for initial migration
                try {
                    JSON.parse(line);
                } catch (error) {
                    const label = typeof record === 'object' && record?.label ? record.label : `line ${index + 1}`;
                    throw new Error(`Invalid JSONL at ${label}: ${error.message}`);
                }
                stmt.run([index, line]);
                index++;
            }
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        } finally {
            stmt?.free();
        }

        saveDb(db, sqlitePath);
    } finally {
        db.close();
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
 * @param {import('sql.js').Database} db
 */
export function reindexChat(db) {
    const messages = getMessages(db);
    setMessages(db, messages);
}

function setMessagesWithoutTransaction(db, messages) {
    db.run('DELETE FROM messages');
    let stmt;
    try {
        stmt = db.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)');
        for (let i = 0; i < messages.length; i++) {
            stmt.run([i, JSON.stringify(messages[i])]);
        }
    } finally {
        stmt?.free();
    }
}

/**
 * Gets all messages from the database.
 * @param {import('sql.js').Database} db
 * @returns {any[]}
 */
export function getMessages(db) {
    const res = db.exec('SELECT content FROM messages ORDER BY order_index ASC');
    if (res.length === 0) return [];
    const messages = res[0].values.map(row => JSON.parse(row[0]));
    return messages;
}

/**
 * Gets the chat header (first message) from the database.
 * @param {import('sql.js').Database} db
 * @returns {any|null}
 */
export function getChatHeader(db) {
    const res = db.exec('SELECT content FROM messages WHERE order_index = 0');
    if (res.length === 0 || res[0].values.length === 0) return null;
    return JSON.parse(res[0].values[0][0]);
}

/**
 * Gets the total number of messages (excluding header) from the database.
 * @param {import('sql.js').Database} db
 * @returns {number}
 */
export function getMessageCount(db) {
    const res = db.exec('SELECT COUNT(*) FROM messages WHERE order_index > 0');
    if (res.length === 0) return 0;
    return res[0].values[0][0];
}

/**
 * Gets the last message from the database.
 * @param {import('sql.js').Database} db
 * @returns {any|null}
 */
export function getLastMessage(db) {
    const res = db.exec('SELECT content FROM messages WHERE order_index > 0 ORDER BY order_index DESC LIMIT 1');
    if (res.length === 0 || res[0].values.length === 0) return null;
    return JSON.parse(res[0].values[0][0]);
}

/**
 * Gets a range of messages (excluding header) from the database.
 * @param {import('sql.js').Database} db
 * @param {number} offset
 * @param {number} limit
 * @returns {any[]}
 */
export function getMessageRange(db, offset, limit) {
    const stmt = db.prepare('SELECT content FROM messages WHERE order_index > 0 ORDER BY order_index ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const messages = [];
    try {
        while (stmt.step()) {
            messages.push(JSON.parse(stmt.get()[0]));
        }
    } finally {
        stmt.free();
    }
    return messages;
}

/**
 * Gets a logical message row by zero-based message id, excluding the header.
 * @param {import('sql.js').Database} db
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
        return {
            id: row[0],
            orderIndex: row[1],
            content: row[2],
            message: JSON.parse(row[2]),
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

/**
 * Inserts a logical message immediately after the supplied logical message id.
 * @param {import('sql.js').Database} db
 * @param {number} messageId
 * @param {any} message
 * @returns {number} Inserted logical message id.
 */
export function insertLogicalMessageAfter(db, messageId, message) {
    const normalizedMessageId = Number(messageId);
    if (!Number.isInteger(normalizedMessageId) || normalizedMessageId < 0) {
        throw new Error('Invalid logical message insert id.');
    }

    db.run('BEGIN TRANSACTION');
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

        const stmt = db.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)');
        try {
            stmt.run([orderIndex, JSON.stringify(message)]);
        } finally {
            stmt.free();
        }

        db.run('COMMIT');
        return normalizedMessageId + 1;
    } catch (error) {
        db.run('ROLLBACK');
        throw error;
    }
}

/**
 * Sets all messages in the database.
 * @param {import('sql.js').Database} db
 * @param {any[]} messages
 */
export function setMessages(db, messages) {
    db.run('BEGIN TRANSACTION');
    try {
        setMessagesWithoutTransaction(db, messages);
        db.run('COMMIT');
    } catch (error) {
        db.run('ROLLBACK');
        throw error;
    }
}

/**
 * Updates a range of messages in the database.
 * @param {import('sql.js').Database} db
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
                ? db.prepare('UPDATE messages SET content = ? WHERE id = ?')
                : db.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)');

            for (let i = 0; i < messages.length; i++) {
                if (targetRows.length === messages.length) {
                    stmt.run([JSON.stringify(messages[i]), targetRows[i].id]);
                } else {
                    stmt.run([appendBaseOrderIndex + 1 + i, JSON.stringify(messages[i])]);
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
 * @param {import('sql.js').Database} db
 * @param {string} key
 * @param {string} value
 */
export function setMetadata(db, key, value) {
    db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Gets metadata from the database.
 * @param {import('sql.js').Database} db
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
