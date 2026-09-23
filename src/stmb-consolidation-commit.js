import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

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

/**
 * Commits or reconciles one batch. The caller must hold the shared lorebook mutation lock
 * and load the book with current management authorization before calling this function.
 */
export async function commitStmbConsolidation({ userHandle, metadata, data, input, build, save }) {
    if (input.batchId == null) {
        const result = build();
        await save();
        return result;
    }
    if (typeof input.batchId !== 'string' || !/^[\w-]{1,100}$/.test(input.batchId)) throw conflict();
    const directory = path.join(globalThis.DATA_ROOT, '_stmb', 'consolidation-commits');
    const filename = path.join(directory, `${hash([userHandle, input.batchId])}.json`);
    const requestHash = hash([metadata.storage, metadata.name, input]);
    const beforeHash = hash(data);
    let receipt;
    try {
        receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const writeReceipt = () => {
        fs.mkdirSync(directory, { recursive: true });
        writeFileAtomicSync(filename, JSON.stringify(receipt), { encoding: 'utf8', mode: 0o600 });
    };
    if (receipt) {
        if (receipt.requestHash !== requestHash) throw conflict();
        const entriesByHash = new Map(Object.values(data.entries || {}).map(entry => [hash(entry), entry]));
        const createdEntries = receipt.outputHashes.map(value => entriesByHash.get(value));
        if (createdEntries.length > 0 && createdEntries.every(Boolean)) {
            receipt.state = 'saved';
            writeReceipt();
            return { createdEntries, orderClampNotifications: [], replayed: true };
        }
        // An uncertain write can resume only from the exact pre-save book. Unrelated edits
        // require review; entry-level write intent could relax this if it becomes necessary.
        if (receipt.state !== 'planned' || receipt.beforeHash !== beforeHash) throw conflict();
    }
    const result = build();
    if (result.createdEntries.length === 0) {
        await save();
        return result;
    }
    receipt = {
        state: 'planned', requestHash, beforeHash,
        outputHashes: result.createdEntries.map(hash),
    };
    writeReceipt();
    await save();
    receipt.state = 'saved';
    writeReceipt();
    return result;
}
