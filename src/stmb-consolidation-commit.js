import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { fingerprintLorebookEntry, migrateLorebookSummarySchema } from '../public/scripts/stmb-summary.js';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Hashes commit state without retaining lorebook content or metadata in receipts. */
function hash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Rejects uncertain saves without disclosing the source or receipt. */
function conflict() {
    return Object.assign(new Error('Consolidation recovery requires review. Reload the lorebook and review saved summaries before starting again.'), {
        status: 409, type: 'StmbConsolidationCommitConflict',
    });
}

function recoveryDirectory(userHandle) {
    return path.join(globalThis.DATA_ROOT, '_stmb', 'consolidation-recovery', hash(userHandle));
}

function recoveryPath(userHandle, id) {
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) throw conflict();
    return path.join(recoveryDirectory(userHandle), `${id}.json`);
}

/** Reads an ordinary-book recovery record. Callers hold the lorebook lock and recheck access. */
export function readStmbConsolidationRecovery(userHandle, id) {
    try { return JSON.parse(fs.readFileSync(recoveryPath(userHandle, id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Atomically checkpoints one ordinary-book save under the caller's shared lorebook lock. */
export function writeStmbConsolidationRecovery(userHandle, record) {
    const filename = recoveryPath(userHandle, record.id);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    writeFileAtomicSync(filename, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
}

/** Lists internal unfinished records; the endpoint authorizes each target before projecting details. */
export function listStmbConsolidationRecoveries(userHandle) {
    let names;
    try { names = fs.readdirSync(recoveryDirectory(userHandle)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return names.filter(name => /^[\w-]{1,100}\.json$/.test(name))
        .map(name => readStmbConsolidationRecovery(userHandle, name.slice(0, -5)))
        .filter(record => record && !['completed', 'dismissed'].includes(record.state));
}

/** Reviews an unsaved ordinary-book batch under the caller's authorized lorebook lock. */
export function reviewStmbConsolidationSources(userHandle, record, data, token = null) {
    if (record.state !== 'sourceChanged') throw conflict();
    const beforeHash = hash(data);
    migrateLorebookSummarySchema(data);
    const ids = [...new Set([
        ...(record.input.sourceIds || Object.keys(record.input.sourceFingerprints || {})),
        ...record.input.summaryCandidates.flatMap(candidate => candidate.memberIds || []),
    ].map(String))];
    const entries = new Map(Object.values(data.entries || {}).map(entry => [String(entry.uid), entry]));
    const sources = ids.map(uid => entries.get(uid));
    const reviewToken = hash([record.requestHash, data]);
    const canSave = sources.every(Boolean);
    if (token === null) return {
        reviewToken, canSave, disableOriginals: Boolean(record.input.disableOriginals),
        sources: sources.map((entry, index) => ({ uid: ids[index], title: entry?.comment || '', content: entry?.content || '', missing: !entry })),
    };
    if (!canSave || token !== reviewToken) throw conflict();
    // Only sourceChanged records have never reached receipt creation. Reusing their ID
    // prevents duplicate saves; the new request hash rejects old browser retries.
    record.input = { ...record.input, batchCreatedAt: Date.now(), sourceIds: ids,
        sourceFingerprints: Object.fromEntries(sources.map(entry => [String(entry.uid), fingerprintLorebookEntry(entry)])) };
    record.requestHash = hash(['user', record.lorebookName, record.input]);
    record.beforeHash = beforeHash;
    record.state = 'prepared';
    record.updatedAt = Date.now();
    writeStmbConsolidationRecovery(userHandle, record);
    return record;
}

/**
 * Commits or reconciles one batch. The caller must hold the shared lorebook mutation lock
 * and load the book with current management authorization before calling this function.
 */
export async function commitStmbConsolidation({ userHandle, metadata, data, input, build, save }) {
    if (typeof input.batchId !== 'string' || !/^[\w-]{1,100}$/.test(input.batchId)) throw conflict();
    const directory = path.join(globalThis.DATA_ROOT, '_stmb', 'consolidation-commits');
    const filename = path.join(directory, `${hash([userHandle, input.batchId])}.json`);
    const requestHash = hash([metadata.storage, metadata.name, input]);
    const beforeHash = hash(data);
    let recovery = metadata.storage === 'user' ? readStmbConsolidationRecovery(userHandle, input.batchId) : null;
    if (recovery && (recovery.requestHash !== requestHash || ['dismissed', 'needsReview', 'sourceChanged'].includes(recovery.state))) throw conflict();
    const checkpoint = state => {
        if (metadata.storage !== 'user') return;
        recovery ||= { version: 1, id: input.batchId, lorebookName: metadata.name, input: structuredClone(input), requestHash, beforeHash, createdAt: now };
        if (recovery.state === 'completed') return;
        recovery.state = state;
        recovery.updatedAt = Date.now();
        writeStmbConsolidationRecovery(userHandle, recovery);
    };
    let receipt;
    try {
        receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    // Legacy retries require their original receipt. Never recreate an expired batch.
    const now = Date.now();
    if (!receipt && recovery && (recovery.state !== 'prepared' || recovery.beforeHash !== beforeHash)) {
        checkpoint('needsReview');
        throw conflict();
    }
    if ((!receipt || input.batchCreatedAt !== undefined)
        && (!Number.isSafeInteger(input.batchCreatedAt) || input.batchCreatedAt <= 0
            || input.batchCreatedAt > now + CLOCK_SKEW_MS
            || input.batchCreatedAt <= now - RETENTION_MS)) throw conflict();
    const writeReceipt = () => {
        fs.mkdirSync(directory, { recursive: true });
        writeFileAtomicSync(filename, JSON.stringify(receipt), { encoding: 'utf8', mode: 0o600 });
    };
    if (receipt) {
        if (receipt.requestHash !== requestHash) throw conflict();
        const entriesByHash = new Map(Object.values(data.entries || {}).map(entry => [hash(entry), entry]));
        const createdEntries = receipt.outputHashes.map(value => entriesByHash.get(value));
        if (createdEntries.length > 0 && createdEntries.every(Boolean)) {
            if (receipt.state !== 'saved') {
                receipt.state = 'saved';
                receipt.savedAt = now;
                writeReceipt();
            }
            checkpoint('saved');
            return { createdEntries, orderClampNotifications: [], replayed: true };
        }
        // An uncertain write can resume only from the exact pre-save book. Unrelated edits
        // require review; entry-level write intent could relax this if it becomes necessary.
        if (receipt.state !== 'planned' || receipt.beforeHash !== beforeHash) {
            checkpoint('needsReview');
            throw conflict();
        }
    }
    let result;
    try {
        result = build();
    } catch (error) {
        if (!receipt && error?.type === 'StmbSourceChanged' && metadata.storage === 'user') {
            checkpoint('sourceChanged');
            throw Object.assign(new Error('Consolidation sources changed. Open Pending Actions in Memory Books to review and save the generated summaries.'), {
                status: 409, type: 'StmbConsolidationSourceChanged',
            });
        }
        throw error;
    }
    if (result.createdEntries.length === 0) {
        await save();
        return result;
    }
    receipt = {
        state: 'planned', requestHash, beforeHash,
        outputHashes: result.createdEntries.map(hash),
    };
    checkpoint('prepared');
    writeReceipt();
    await save();
    receipt.state = 'saved';
    receipt.savedAt = Date.now();
    writeReceipt();
    checkpoint('saved');
    return result;
}

/** Expires completed receipts under the same cross-worker lock as their writers. */
export async function cleanupStmbConsolidationReceipts(withLock, now = Date.now()) {
    const directory = path.join(globalThis.DATA_ROOT, '_stmb', 'consolidation-commits');
    // Cover accepted client clock skew before removing duplicate-write protection.
    const cutoff = now - RETENTION_MS - CLOCK_SKEW_MS;
    try {
        // Stream the directory: memory stays bounded even on the first cleanup.
        const entries = await fs.promises.opendir(directory);
        for await (const entry of entries) {
            if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
            const filename = path.join(directory, entry.name);
            try {
                const stat = await fs.promises.lstat(filename);
                if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
                await withLock(async () => {
                    const current = await fs.promises.lstat(filename);
                    if (!current.isFile() || current.mtimeMs > cutoff) return;
                    const receipt = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
                    const savedAt = receipt?.savedAt ?? current.mtimeMs;
                    const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
                    if (receipt?.state === 'saved' && validHash(receipt.requestHash) && validHash(receipt.beforeHash)
                        && Array.isArray(receipt.outputHashes) && receipt.outputHashes.length > 0 && receipt.outputHashes.every(validHash)
                        && Number.isFinite(savedAt) && savedAt > 0 && savedAt <= cutoff) {
                        await fs.promises.unlink(filename);
                    }
                });
            } catch (error) {
                if (error?.code !== 'ENOENT') console.warn('Failed to expire a consolidation receipt.');
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') console.warn('Failed to scan consolidation receipts for expiry.');
    }
    await cleanupConsolidationRecoveries(withLock, cutoff);
}

/** Keeps unfinished recovery records; terminal records follow the receipt retention window. */
async function cleanupConsolidationRecoveries(withLock, cutoff) {
    const root = path.join(globalThis.DATA_ROOT, '_stmb', 'consolidation-recovery');
    try {
        const users = await fs.promises.opendir(root);
        for await (const user of users) {
            if (!user.isDirectory() || !/^[a-f0-9]{64}$/.test(user.name)) continue;
            const entries = await fs.promises.opendir(path.join(root, user.name));
            for await (const entry of entries) {
                if (!entry.isFile() || !/^[\w-]{1,100}\.json$/.test(entry.name)) continue;
                const filename = path.join(root, user.name, entry.name);
                await withLock(async () => {
                    try {
                        const record = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
                        if (['completed', 'dismissed'].includes(record.state) && Number.isFinite(record.updatedAt) && record.updatedAt <= cutoff) {
                            await fs.promises.unlink(filename);
                        }
                    } catch (error) {
                        if (error?.code !== 'ENOENT') console.warn('Failed to expire a consolidation recovery record.');
                    }
                });
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') console.warn('Failed to scan consolidation recovery records for expiry.');
    }
}
