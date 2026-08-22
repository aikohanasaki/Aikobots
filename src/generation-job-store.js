import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

const SQLITE_BUSY_TIMEOUT_MS = 10_000;
const TERMINAL_JOB_RETENTION_MS = 24 * 60 * 60_000;
const UNRESOLVED_COMPLETED_JOB_RETENTION_MS = 7 * 24 * 60 * 60_000;
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed']);
const RECOVERABLE_TYPES = new Set(['normal', 'regenerate', 'continue', 'swipe']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ROUTING_VALUE_LENGTH = 1024;

let databasePath = null;
let database = null;

function getDatabasePath() {
    return path.join(globalThis.DATA_ROOT, '_generation-jobs', 'jobs.sqlite');
}

function getUserKey(userHandle) {
    if (typeof userHandle !== 'string' || !userHandle) {
        throw new TypeError('Generation job user handle is required.');
    }
    return createHash('sha256').update(userHandle).digest('hex');
}

/** Adds one generation-job column while the caller holds the migration transaction. */
function ensureGenerationJobColumn(db, name, definition) {
    const columns = db.prepare('PRAGMA table_info(generation_jobs)').all();
    if (!columns.some(column => column.name === name)) {
        db.exec(`ALTER TABLE generation_jobs ADD COLUMN ${definition}`);
    }
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
            recovery_json TEXT,
            resolved_at INTEGER,
            cancel_requested_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            last_event_sequence INTEGER NOT NULL DEFAULT 0,
            slot_type TEXT
        );
        CREATE TABLE IF NOT EXISTS generation_events (
            job_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            event_block TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (job_id, sequence),
            FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
        );
    `);
    const migrate = database.transaction(() => {
        ensureGenerationJobColumn(database, 'recovery_json', 'recovery_json TEXT');
        ensureGenerationJobColumn(database, 'resolved_at', 'resolved_at INTEGER');
        ensureGenerationJobColumn(database, 'slot_type', 'slot_type TEXT');
    });
    migrate.immediate();
    database.exec(`
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_updated
            ON generation_jobs(user_key, updated_at);
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_recovery
            ON generation_jobs(user_key, resolved_at, created_at)
            WHERE recovery_json IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_generation_jobs_scheduler
            ON generation_jobs(state, created_at);
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
        recovery: parseJson(row.recovery_json),
        resolvedAt: row.resolved_at || null,
        cancelRequestedAt: row.cancel_requested_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finishedAt: row.finished_at || null,
        lastEventSequence: row.last_event_sequence,
        slotType: row.slot_type || null,
    };
}

function isValidRoutingValue(value, required = false) {
    const normalized = String(value || '');
    return normalized.length <= MAX_ROUTING_VALUE_LENGTH && (!required || normalized.length > 0);
}

/** Strips untrusted recovery metadata down to content-free routing fields. */
function normalizeGenerationRecovery(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const type = String(value.type || 'normal');
    const chatIdentity = value.chatIdentity;
    const anchorMessageUuid = String(value.anchorMessageUuid || '');
    const outputMessageUuid = String(value.outputMessageUuid || '');
    const createdAt = Number(value.createdAt);
    const startedAt = Number(value.startedAt);
    if (!RECOVERABLE_TYPES.has(type)
        || !chatIdentity || typeof chatIdentity !== 'object' || Array.isArray(chatIdentity)
        || !isValidRoutingValue(chatIdentity.chatId, true)
        || !isValidRoutingValue(chatIdentity.groupId)
        || !isValidRoutingValue(chatIdentity.characterId)
        || !UUID_PATTERN.test(anchorMessageUuid)
        || !Number.isFinite(createdAt) || createdAt <= 0
        || !Number.isFinite(startedAt) || startedAt <= 0
        || (['normal', 'regenerate'].includes(type) && !UUID_PATTERN.test(outputMessageUuid))
        || (!['normal', 'regenerate'].includes(type) && outputMessageUuid)) {
        return null;
    }

    const swipeTarget = value.swipeTarget && typeof value.swipeTarget === 'object' && !Array.isArray(value.swipeTarget)
        ? {
            messageId: Number(value.swipeTarget.messageId),
            swipeId: Number(value.swipeTarget.swipeId),
            swipeUuid: String(value.swipeTarget.swipeUuid || ''),
            previousSwipeId: Number(value.swipeTarget.previousSwipeId),
        }
        : null;
    if (swipeTarget && (!Number.isInteger(swipeTarget.messageId) || swipeTarget.messageId < 0
        || !Number.isInteger(swipeTarget.swipeId) || swipeTarget.swipeId < 0
        || !UUID_PATTERN.test(swipeTarget.swipeUuid)
        || !Number.isInteger(swipeTarget.previousSwipeId) || swipeTarget.previousSwipeId < 0)) {
        return null;
    }
    if ((type === 'swipe') !== Boolean(swipeTarget)) {
        return null;
    }

    const forceChid = value.forceChid === null || value.forceChid === undefined
        ? null
        : Number(value.forceChid);
    if (forceChid !== null && (!Number.isInteger(forceChid) || forceChid < 0)) {
        return null;
    }

    return {
        type,
        chatIdentity: {
            groupId: String(chatIdentity.groupId || ''),
            characterId: String(chatIdentity.characterId || ''),
            chatId: String(chatIdentity.chatId),
        },
        anchorMessageUuid,
        outputMessageUuid,
        createdAt,
        startedAt,
        stream: value.stream !== false,
        canMultiSwipe: Boolean(value.canMultiSwipe),
        forceChid,
        swipeTarget,
    };
}

function getAuthorizedRow(db, id, userHandle) {
    return db.prepare(`
        SELECT * FROM generation_jobs WHERE id = ? AND user_key = ?
    `).get(String(id || ''), getUserKey(userHandle));
}

/** Applies terminal and unresolved-recovery retention without deleting healthy work. */
function pruneExpiredJobs(db, now = Date.now()) {
    db.prepare(`
        DELETE FROM generation_jobs
        WHERE (state = 'completed' AND recovery_json IS NOT NULL AND resolved_at IS NULL AND finished_at < @unresolvedCutoff)
           OR (state = 'completed' AND recovery_json IS NOT NULL AND resolved_at < @terminalCutoff)
           OR (state = 'completed' AND recovery_json IS NULL AND finished_at < @terminalCutoff)
           OR (state IN ('cancelled', 'failed') AND finished_at < @terminalCutoff)
           OR (state IN ('queued', 'running', 'cancel_requested') AND updated_at < @terminalCutoff)
    `).run({
        unresolvedCutoff: now - UNRESOLVED_COMPLETED_JOB_RETENTION_MS,
        terminalCutoff: now - TERMINAL_JOB_RETENTION_MS,
    });
}

/**
 * Creates an idempotent detached generation job without persisting prompt content.
 */
export function createGenerationJob({ id, userHandle, requestFingerprint, requestId, recovery = null, limits = null }) {
    const db = openDatabase();
    const now = Date.now();
    const userKey = getUserKey(userHandle);
    const normalizedRecovery = recovery === null ? null : normalizeGenerationRecovery(recovery);
    if (recovery !== null && !normalizedRecovery) {
        const error = new Error('Generation recovery metadata is invalid.');
        error.status = 400;
        throw error;
    }
    const recoveryJson = normalizedRecovery ? JSON.stringify(normalizedRecovery) : null;
    const admit = db.transaction(() => {
        pruneExpiredJobs(db, now);
        const existing = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id);
        if (existing) {
            if (existing.user_key !== userKey || existing.request_fingerprint !== requestFingerprint || existing.recovery_json !== recoveryJson) {
                const error = new Error(existing.user_key === userKey
                    ? 'Generation ID was already used for a different request or recovery target.'
                    : 'Generation ID is not available.');
                error.status = 409;
                throw error;
            }
            return { created: false, job: serializeJob(existing) };
        }

        const maxConcurrentPerUser = Number(limits?.maxConcurrentPerUser);
        const configuredQueuedPerUser = Number(limits?.maxQueuedPerUser);
        const maxQueuedPerUser = Number.isInteger(configuredQueuedPerUser) && configuredQueuedPerUser >= 0
            ? configuredQueuedPerUser
            : 0;
        if (Number.isInteger(maxConcurrentPerUser) && maxConcurrentPerUser > 0
            && maxQueuedPerUser >= 0) {
            const userActive = db.prepare(`
                SELECT COUNT(*) AS count FROM generation_jobs
                WHERE user_key = ? AND state IN ('queued', 'running', 'cancel_requested')
            `).get(userKey).count;
            if (userActive >= maxConcurrentPerUser + maxQueuedPerUser) {
                const error = new Error('Per-user generation queue is full.');
                error.status = 429;
                error.code = 'generation_user_limit_reached';
                throw error;
            }
        }

        const maxQueuedGlobal = Number(limits?.maxQueuedGlobal);
        if (Number.isInteger(maxQueuedGlobal) && maxQueuedGlobal >= 0) {
            const queued = db.prepare('SELECT COUNT(*) AS count FROM generation_jobs WHERE state = ?').get('queued').count;
            if (queued >= maxQueuedGlobal) {
                const error = new Error('Generation queue is full.');
                error.status = 503;
                error.code = 'generation_queue_full';
                throw error;
            }
        }

        db.prepare(`
            INSERT INTO generation_jobs (
                id, user_key, request_fingerprint, state, request_id, recovery_json, created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
        `).run(id, userKey, requestFingerprint, requestId, recoveryJson, now, now);
        return { created: true, job: serializeJob(db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id)) };
    });
    return admit.immediate();
}

/** Returns a generation job only when it belongs to the authenticated user. */
export function getGenerationJob(id, userHandle) {
    return serializeJob(getAuthorizedRow(openDatabase(), id, userHandle));
}

/** Lists unresolved content-free recovery records for the authenticated user. */
export function listGenerationRecoveries(userHandle, limit = 100) {
    const db = openDatabase();
    pruneExpiredJobs(db);
    // Recovery is currently single-generation UI state; paginate if users can retain over 100 concurrent jobs.
    return db.prepare(`
        SELECT * FROM generation_jobs
        WHERE user_key = ? AND recovery_json IS NOT NULL AND resolved_at IS NULL
        ORDER BY created_at
        LIMIT ?
    `).all(getUserKey(userHandle), Math.min(100, Math.max(1, Number(limit) || 100))).map(serializeJob);
}

/** Marks a recovery record as durably handled by the chat mutation path. */
export function resolveGenerationRecovery(id, userHandle) {
    const db = openDatabase();
    const now = Date.now();
    db.prepare(`
        UPDATE generation_jobs SET resolved_at = COALESCE(resolved_at, ?), updated_at = ?
        WHERE id = ? AND user_key = ? AND recovery_json IS NOT NULL
    `).run(now, now, id, getUserKey(userHandle));
    return serializeJob(getAuthorizedRow(db, id, userHandle));
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

/**
 * Atomically selects the next fair job and claims the requested job only when it wins.
 */
export function claimScheduledGenerationJob(id, userHandle, limits) {
    const db = openDatabase();
    const now = Date.now();
    const userKey = getUserKey(userHandle);
    const maxConcurrentGlobal = Math.max(1, Number(limits?.maxConcurrentGlobal) || 1);
    const reservedFirstGenerationSlots = Math.min(
        maxConcurrentGlobal,
        Math.max(0, Number(limits?.reservedFirstGenerationSlots) || 0),
    );
    const generalCapacity = maxConcurrentGlobal - reservedFirstGenerationSlots;
    const maxConcurrentPerUser = Math.max(1, Number(limits?.maxConcurrentPerUser) || 1);
    const secondaryPriorityAgeMs = Math.max(0, Number(limits?.secondaryPriorityAgeMs) || 0);
    const staleOwnerMs = Math.max(1, Number(limits?.staleOwnerMs) || 45_000);

    finalizeStaleGenerationJobs(now - staleOwnerMs);

    const claim = db.transaction(() => {
        const requested = db.prepare(`
            SELECT * FROM generation_jobs WHERE id = ? AND user_key = ?
        `).get(id, userKey);
        if (!requested || requested.state !== 'queued') {
            return { claimed: false, job: serializeJob(requested) };
        }

        const runningRows = db.prepare(`
            SELECT user_key, slot_type FROM generation_jobs
            WHERE state IN ('running', 'cancel_requested')
        `).all();
        if (runningRows.length >= maxConcurrentGlobal) {
            return { claimed: false, job: serializeJob(requested) };
        }

        const runningByUser = new Map();
        let reservedUsed = 0;
        let generalUsed = 0;
        for (const row of runningRows) {
            runningByUser.set(row.user_key, (runningByUser.get(row.user_key) || 0) + 1);
            if (row.slot_type === 'reserved') {
                reservedUsed++;
            } else {
                generalUsed++;
            }
        }

        if ((runningByUser.get(userKey) || 0) >= maxConcurrentPerUser) {
            return { claimed: false, job: serializeJob(requested) };
        }

        const queuedRows = db.prepare(`
            SELECT id, user_key, created_at FROM generation_jobs
            WHERE state = 'queued'
            ORDER BY created_at, id
        `).all();
        const oldestQueuedByUser = new Map();
        for (const row of queuedRows) {
            if (!oldestQueuedByUser.has(row.user_key)) {
                oldestQueuedByUser.set(row.user_key, row.id);
            }
        }
        const candidates = queuedRows
            .filter(row => (runningByUser.get(row.user_key) || 0) < maxConcurrentPerUser)
            .map(row => ({
                ...row,
                first: !runningByUser.has(row.user_key) && oldestQueuedByUser.get(row.user_key) === row.id,
                aged: now - row.created_at >= secondaryPriorityAgeMs,
            }));

        let reservedWinner = null;
        if (reservedUsed < reservedFirstGenerationSlots) {
            reservedWinner = candidates.find(candidate => candidate.first) || null;
        }
        if (reservedWinner?.id === id) {
            const updated = db.prepare(`
                UPDATE generation_jobs SET state = 'running', slot_type = 'reserved', updated_at = ?
                WHERE id = ? AND user_key = ? AND state = 'queued'
            `).run(now, id, userKey);
            return { claimed: updated.changes === 1, job: serializeJob(getAuthorizedRow(db, id, userHandle)) };
        }

        if (generalUsed >= generalCapacity) {
            return { claimed: false, job: serializeJob(requested) };
        }
        const generalWinner = candidates
            .filter(candidate => candidate.id !== reservedWinner?.id)
            .sort((left, right) => {
                const leftPriority = left.first || left.aged ? 0 : 1;
                const rightPriority = right.first || right.aged ? 0 : 1;
                return leftPriority - rightPriority || left.created_at - right.created_at || left.id.localeCompare(right.id);
            })[0];
        if (generalWinner?.id !== id) {
            return { claimed: false, job: serializeJob(requested) };
        }

        const updated = db.prepare(`
            UPDATE generation_jobs SET state = 'running', slot_type = 'general', updated_at = ?
            WHERE id = ? AND user_key = ? AND state = 'queued'
        `).run(now, id, userKey);
        return { claimed: updated.changes === 1, job: serializeJob(getAuthorizedRow(db, id, userHandle)) };
    });
    return claim.immediate();
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
            SELECT state, last_event_sequence FROM generation_jobs WHERE id = ? AND user_key = ?
        `).get(id, userKey);
        if (!row || TERMINAL_STATES.has(row.state)) {
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

function finalizeStaleRow(db, row) {
    const cancelled = Boolean(row.cancel_requested_at) || row.state === 'cancel_requested';
    const eventBlocks = cancelled
        ? ['data: {"error":{"message":"Generation was cancelled."}}', 'data: [DONE]']
        : ['data: {"error":{"message":"Generation worker stopped before completion."}}', 'data: [DONE]'];
    const now = Date.now();
    let sequence = Number(row.last_event_sequence);
    const insertEvent = db.prepare(`
        INSERT INTO generation_events (job_id, sequence, event_block, created_at)
        VALUES (?, ?, ?, ?)
    `);
    for (const eventBlock of eventBlocks) {
        insertEvent.run(row.id, ++sequence, eventBlock, now);
    }
    db.prepare(`
        UPDATE generation_jobs
        SET state = ?, last_event_sequence = ?,
            resolved_at = CASE WHEN ? = 'cancelled' AND recovery_json IS NOT NULL
                THEN COALESCE(resolved_at, ?) ELSE resolved_at END,
            updated_at = ?, finished_at = ?
        WHERE id = ? AND user_key = ?
    `).run(cancelled ? 'cancelled' : 'failed', sequence, cancelled ? 'cancelled' : 'failed', now, now, now, row.id, row.user_key);
    return serializeJob(db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(row.id));
}

/** Marks every abandoned queued or running owner failed so its slots cannot remain stuck. */
export function finalizeStaleGenerationJobs(staleBefore) {
    const db = openDatabase();
    const finalize = db.transaction(() => db.prepare(`
        SELECT * FROM generation_jobs
        WHERE state IN ('queued', 'running', 'cancel_requested') AND updated_at <= ?
        ORDER BY created_at, id
    `).all(staleBefore).map(row => finalizeStaleRow(db, row)));
    return finalize.immediate();
}

/** Atomically turns an abandoned owner into a replayable terminal failure. */
export function finalizeStaleGenerationJob(id, userHandle, staleBefore) {
    const db = openDatabase();
    const finalize = db.transaction(() => {
        const row = getAuthorizedRow(db, id, userHandle);
        if (!row || TERMINAL_STATES.has(row.state) || row.updated_at > staleBefore) {
            return serializeJob(row);
        }

        return finalizeStaleRow(db, row);
    });
    return finalize.immediate();
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
        if (row.recovery_json && !row.resolved_at) {
            const now = Date.now();
            db.prepare(`
                UPDATE generation_jobs SET resolved_at = ?, updated_at = ?
                WHERE id = ? AND user_key = ?
            `).run(now, now, id, getUserKey(userHandle));
            return serializeJob(getAuthorizedRow(db, id, userHandle));
        }
        return serializeJob(row);
    }

    const now = Date.now();
    const userKey = getUserKey(userHandle);
    const queued = db.prepare(`
        UPDATE generation_jobs
        SET state = 'cancelled', cancel_requested_at = ?, resolved_at = COALESCE(resolved_at, ?), updated_at = ?, finished_at = ?
        WHERE id = ? AND user_key = ? AND state = 'queued'
    `).run(now, now, now, now, id, userKey);
    if (queued.changes === 1) {
        return serializeJob(getAuthorizedRow(db, id, userHandle));
    }

    db.prepare(`
        UPDATE generation_jobs
        SET state = 'cancel_requested', cancel_requested_at = COALESCE(cancel_requested_at, ?),
            resolved_at = COALESCE(resolved_at, ?), updated_at = ?
        WHERE id = ? AND user_key = ? AND state IN ('running', 'cancel_requested')
    `).run(now, now, now, id, userKey);
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
        SET state = ?, resolved_at = CASE WHEN recovery_json IS NOT NULL
                THEN COALESCE(resolved_at, ?) ELSE resolved_at END,
            updated_at = ?, finished_at = ?
        WHERE id = ? AND user_key = ?
          AND state IN ('queued', 'running', 'cancel_requested')
    `);
    if (state === 'cancelled') {
        terminalUpdate.run(state, now, now, now, id, getUserKey(userHandle));
    } else {
        terminalUpdate.run(state, now, now, id, getUserKey(userHandle));
    }
    return serializeJob(getAuthorizedRow(db, id, userHandle));
}

/** Closes the process-local SQLite handle, primarily for shutdown and tests. */
export function closeGenerationJobStore() {
    database?.close();
    database = null;
    databasePath = null;
}
