import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

const SQLITE_BUSY_TIMEOUT_MS = 10_000;
const JOB_RETENTION_MS = 24 * 60 * 60_000;
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed']);

let databasePath = null;
let database = null;

function getDatabasePath() {
    return path.join(globalThis.DATA_ROOT, '_generation-jobs', 'jobs.sqlite');
}

function getUserKey(userHandle) {
    return createHash('sha256').update(String(userHandle || '')).digest('hex');
}

function openDatabase() {
    const nextPath = getDatabasePath();
    if (database?.open && databasePath === nextPath) {
        return database;
    }

    database?.close();
    databasePath = nextPath;
    mkdirSync(path.dirname(databasePath), { recursive: true });
    database = new Database(databasePath);
    database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('foreign_keys = ON');
    database.exec(`
        CREATE TABLE IF NOT EXISTS generation_jobs (
            id TEXT PRIMARY KEY,
            user_key TEXT NOT NULL,
            request_fingerprint TEXT NOT NULL,
            state TEXT NOT NULL,
            request_id TEXT,
            response_headers_json TEXT,
            result_json TEXT,
            cancel_requested_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            last_event_sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_updated
            ON generation_jobs(user_key, updated_at);
        CREATE TABLE IF NOT EXISTS generation_events (
            job_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            event_block TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (job_id, sequence),
            FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
        );
    `);
    return database;
}

function parseJson(value, fallback = null) {
    if (typeof value !== 'string' || !value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function serializeJob(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        state: row.state,
        requestId: row.request_id || null,
        responseHeaders: parseJson(row.response_headers_json, {}),
        result: parseJson(row.result_json),
        cancelRequestedAt: row.cancel_requested_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finishedAt: row.finished_at || null,
        lastEventSequence: row.last_event_sequence,
    };
}

function getAuthorizedRow(db, id, userHandle) {
    return db.prepare(`
        SELECT * FROM generation_jobs WHERE id = ? AND user_key = ?
    `).get(String(id || ''), getUserKey(userHandle));
}

function pruneExpiredJobs(db, now = Date.now()) {
    db.prepare(`
        DELETE FROM generation_jobs
        WHERE COALESCE(finished_at, updated_at) < ?
    `).run(now - JOB_RETENTION_MS);
}

/**
 * Creates an idempotent detached generation job without persisting prompt content.
 */
export function createGenerationJob({ id, userHandle, requestFingerprint, requestId }) {
    const db = openDatabase();
    const now = Date.now();
    const userKey = getUserKey(userHandle);
    pruneExpiredJobs(db, now);

    const inserted = db.prepare(`
        INSERT OR IGNORE INTO generation_jobs (
            id, user_key, request_fingerprint, state, request_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).run(id, userKey, requestFingerprint, requestId, now, now);
    const row = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id);
    if (row?.user_key !== userKey || row?.request_fingerprint !== requestFingerprint) {
        const error = new Error(row?.user_key === userKey
            ? 'Generation ID was already used for a different request.'
            : 'Generation ID is not available.');
        error.status = 409;
        throw error;
    }

    return { created: inserted.changes === 1, job: serializeJob(row) };
}

/** Returns a generation job only when it belongs to the authenticated user. */
export function getGenerationJob(id, userHandle) {
    return serializeJob(getAuthorizedRow(openDatabase(), id, userHandle));
}

/** Marks a queued job as running. */
export function markGenerationJobRunning(id, userHandle) {
    const now = Date.now();
    const db = openDatabase();
    const result = db.prepare(`
        UPDATE generation_jobs SET state = 'running', updated_at = ?
        WHERE id = ? AND user_key = ? AND state = 'queued'
    `).run(now, id, getUserKey(userHandle));
    return { claimed: result.changes === 1, job: serializeJob(getAuthorizedRow(db, id, userHandle)) };
}

/** Refreshes the owner heartbeat without changing externally visible state. */
export function touchGenerationJob(id, userHandle) {
    openDatabase().prepare(`
        UPDATE generation_jobs SET updated_at = ? WHERE id = ? AND user_key = ?
    `).run(Date.now(), id, getUserKey(userHandle));
}

/** Persists safe response headers needed by a reconnecting client. */
export function setGenerationJobResponseHeaders(id, userHandle, headers) {
    openDatabase().prepare(`
        UPDATE generation_jobs SET response_headers_json = ?, updated_at = ?
        WHERE id = ? AND user_key = ?
    `).run(JSON.stringify(headers || {}), Date.now(), id, getUserKey(userHandle));
}

/** Appends one complete SSE event block and returns its durable sequence. */
export function appendGenerationEvent(id, userHandle, eventBlock) {
    const db = openDatabase();
    const userKey = getUserKey(userHandle);
    const append = db.transaction(() => {
        const row = db.prepare(`
            SELECT last_event_sequence FROM generation_jobs WHERE id = ? AND user_key = ?
        `).get(id, userKey);
        if (!row) {
            return null;
        }

        const sequence = Number(row.last_event_sequence) + 1;
        const now = Date.now();
        db.prepare(`
            INSERT INTO generation_events (job_id, sequence, event_block, created_at)
            VALUES (?, ?, ?, ?)
        `).run(id, sequence, String(eventBlock), now);
        db.prepare(`
            UPDATE generation_jobs SET last_event_sequence = ?, updated_at = ?
            WHERE id = ? AND user_key = ?
        `).run(sequence, now, id, userKey);
        return sequence;
    });
    return append.immediate();
}

/** Reads a bounded ordered page of replayable SSE events. */
export function getGenerationEventsAfter(id, userHandle, afterSequence, limit = 256) {
    const db = openDatabase();
    const job = getAuthorizedRow(db, id, userHandle);
    if (!job) {
        return null;
    }

    const events = db.prepare(`
        SELECT sequence, event_block AS eventBlock
        FROM generation_events
        WHERE job_id = ? AND sequence > ?
        ORDER BY sequence
        LIMIT ?
    `).all(id, Math.max(0, Number(afterSequence) || 0), Math.min(1024, Math.max(1, Number(limit) || 256)));
    return { job: serializeJob(job), events };
}

/** Stores a non-stream provider result for resumable retrieval. */
export function setGenerationJobResult(id, userHandle, result) {
    openDatabase().prepare(`
        UPDATE generation_jobs SET result_json = ?, updated_at = ?
        WHERE id = ? AND user_key = ?
    `).run(JSON.stringify(result), Date.now(), id, getUserKey(userHandle));
}

/** Durably requests cancellation from whichever PM2 worker owns the provider call. */
export function requestGenerationCancellation(id, userHandle) {
    const db = openDatabase();
    const row = getAuthorizedRow(db, id, userHandle);
    if (!row) {
        return null;
    }
    if (TERMINAL_STATES.has(row.state)) {
        return serializeJob(row);
    }

    const now = Date.now();
    const userKey = getUserKey(userHandle);
    const queued = db.prepare(`
        UPDATE generation_jobs
        SET state = 'cancelled', cancel_requested_at = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND user_key = ? AND state = 'queued'
    `).run(now, now, now, id, userKey);
    if (queued.changes === 1) {
        return serializeJob(getAuthorizedRow(db, id, userHandle));
    }

    db.prepare(`
        UPDATE generation_jobs
        SET state = 'cancel_requested', cancel_requested_at = COALESCE(cancel_requested_at, ?), updated_at = ?
        WHERE id = ? AND user_key = ? AND state IN ('running', 'cancel_requested')
    `).run(now, now, id, userKey);
    return serializeJob(getAuthorizedRow(db, id, userHandle));
}

/** Returns whether a durable cancellation order is pending. */
export function isGenerationCancellationRequested(id, userHandle) {
    const row = getAuthorizedRow(openDatabase(), id, userHandle);
    return Boolean(row?.cancel_requested_at) || row?.state === 'cancel_requested';
}

/** Performs a compare-and-set terminal transition. */
export function finishGenerationJob(id, userHandle, state) {
    if (!TERMINAL_STATES.has(state)) {
        throw new TypeError(`Invalid terminal generation state: ${state}`);
    }

    const db = openDatabase();
    const now = Date.now();
    const terminalUpdate = state !== 'cancelled' ? db.prepare(`
        UPDATE generation_jobs
        SET state = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND user_key = ?
          AND state IN ('queued', 'running')
    `) : db.prepare(`
        UPDATE generation_jobs
        SET state = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND user_key = ?
          AND state IN ('queued', 'running', 'cancel_requested')
    `);
    terminalUpdate.run(state, now, now, id, getUserKey(userHandle));
    return serializeJob(getAuthorizedRow(db, id, userHandle));
}

/** Closes the process-local SQLite handle, primarily for shutdown and tests. */
export function closeGenerationJobStore() {
    database?.close();
    database = null;
    databasePath = null;
}
