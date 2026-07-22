import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { withDirectoryLock } from './file-system-lock.js';

export const STMB_SIDE_PROMPTS_FILENAME = 'stmb-side-prompts.json';

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
const LOCK_HEARTBEAT_MS = 10_000;
const mutationQueues = new Map();

function getDocumentPath(user) {
    return path.join(user.directories.files, STMB_SIDE_PROMPTS_FILENAME);
}

function getLockPath(user) {
    const handleHash = crypto.createHash('sha256').update(String(user?.profile?.handle || '')).digest('hex');
    return path.join(String(globalThis.DATA_ROOT || '.'), '_locks', 'stmb-side-prompts', `${handleHash}.lock`);
}

function getRevision(raw) {
    return raw === null ? 'missing' : crypto.createHash('sha256').update(raw).digest('hex');
}

function parseDocument(raw) {
    const document = JSON.parse(raw);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new StmbSidePromptsRepositoryError('StmbSidePromptsInvalid', 'Side prompt data is invalid.', 400);
    }
    if (!document.prompts || typeof document.prompts !== 'object' || Array.isArray(document.prompts)) {
        throw new StmbSidePromptsRepositoryError('StmbSidePromptsInvalid', 'Side prompt data is invalid.', 400);
    }
    if (document.sets != null && (typeof document.sets !== 'object' || Array.isArray(document.sets))) {
        throw new StmbSidePromptsRepositoryError('StmbSidePromptsInvalid', 'Side prompt data is invalid.', 400);
    }
    return document;
}

function readUnlocked(user) {
    const filePath = getDocumentPath(user);
    if (!fs.existsSync(filePath)) {
        return { document: null, revision: 'missing' };
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    return { document: parseDocument(raw), revision: getRevision(raw) };
}

function writeUnlocked(user, document) {
    const raw = JSON.stringify(document, null, 2);
    fs.mkdirSync(user.directories.files, { recursive: true });
    writeFileAtomicSync(getDocumentPath(user), raw, 'utf8');
    return { document, revision: getRevision(raw) };
}

async function runWithLock(user, operation) {
    const lockPath = getLockPath(user);
    const previous = mutationQueues.get(lockPath) || Promise.resolve();
    const queued = previous.catch(() => {}).then(() => withDirectoryLock({
        lockPath,
        retryMs: LOCK_RETRY_MS,
        timeoutMs: LOCK_TIMEOUT_MS,
        staleMs: LOCK_STALE_MS,
        heartbeatMs: LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update side prompts.',
    }, operation));
    mutationQueues.set(lockPath, queued);
    try {
        return await queued;
    } finally {
        if (mutationQueues.get(lockPath) === queued) mutationQueues.delete(lockPath);
    }
}

export class StmbSidePromptsRepositoryError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.name = type;
        this.type = type;
        this.status = status;
    }
}

/** Reads the user's side-prompt document and its content revision. */
export function readStmbSidePrompts(user) {
    return readUnlocked(user);
}

/** Replaces the user's side-prompt document after checking its content revision. */
export async function saveStmbSidePrompts(user, document, expectedRevision) {
    return await runWithLock(user, async () => {
        const current = readUnlocked(user);
        if (String(expectedRevision || '') !== current.revision) {
            throw new StmbSidePromptsRepositoryError(
                'StmbSidePromptsConflict',
                'Side prompts changed in another tab. Reload them before saving.',
                409,
            );
        }
        parseDocument(JSON.stringify(document));
        return writeUnlocked(user, structuredClone(document));
    });
}

/** Mutates the user's side-prompt document under the cross-worker file lock. */
export async function mutateStmbSidePrompts(user, operation) {
    return await runWithLock(user, async () => {
        const current = readUnlocked(user);
        const next = await operation(structuredClone(current.document), current.revision);
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
            throw new StmbSidePromptsRepositoryError('StmbSidePromptsInvalid', 'Side prompt data is invalid.', 400);
        }
        parseDocument(JSON.stringify(next));
        return writeUnlocked(user, next);
    });
}
