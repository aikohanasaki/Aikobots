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
 * Migrates a JSONL chat file to a SQLite file.
 * @param {string} jsonlPath
 * @param {string} sqlitePath
 * @returns {Promise<void>}
 */
export async function migrateFromJsonl(jsonlPath, sqlitePath) {
    await initSql();
    const db = createDatabase();
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    db.run('BEGIN TRANSACTION');
    try {
        const stmt = db.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)');
        for (let i = 0; i < lines.length; i++) {
            // Use index as order_index for initial migration
            stmt.run([i, lines[i]]);
        }
        stmt.free();
        db.run('COMMIT');
    } catch (error) {
        db.run('ROLLBACK');
        throw error;
    }

    saveDb(db, sqlitePath);
    db.close();
}

/**
 * Reindexes all messages to ensure order_index is sequential.
 * @param {import('sql.js').Database} db
 */
export function reindexChat(db) {
    const messages = getMessages(db);
    setMessages(db, messages);
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
    console.debug(`[SQLite] Loaded ${messages.length} messages (including header).`);
    return messages;
}

/**
 * Sets all messages in the database.
 * @param {import('sql.js').Database} db
 * @param {any[]} messages
 */
export function setMessages(db, messages) {
    db.run('BEGIN TRANSACTION');
    try {
        db.run('DELETE FROM messages');
        const stmt = db.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)');
        for (let i = 0; i < messages.length; i++) {
            stmt.run([i, JSON.stringify(messages[i])]);
        }
        stmt.free();
        db.run('COMMIT');
        console.debug(`[SQLite] Saved ${messages.length} messages (including header).`);
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
    if (stmt.step()) {
        result = stmt.get()[0];
    }
    stmt.free();
    return result;
}
