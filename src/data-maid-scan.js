import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import writeFileAtomic from 'write-file-atomic';
import { getDeduplicatedChatHistoryFileNames } from './chat-paths.js';
import { withChatSaveLock } from './chat-storage.js';
import { withDirectoryLock } from './file-system-lock.js';
import { SETTINGS_FILE } from './constants.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_RECORDS = 500;
const PAGE_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const BATCH_MS = 1000;

/** Hashes a normalized local media path without persisting its source metadata. */
export function hashDataMaidReference(filePath) {
    const normalized = path.normalize(filePath);
    return crypto.createHash('sha256').update(process.platform === 'win32' ? normalized.toLowerCase() : normalized).digest('hex');
}

/** Lists logical chats, preferring SQLite to an accompanying legacy JSONL file. */
function listChats(directories) {
    const files = [];
    const visit = directory => {
        const entries = fs.readdirSync(directory, { withFileTypes: true });
        files.push(...getDeduplicatedChatHistoryFileNames(entries).map(name => path.join(directory, name)));
        for (const entry of entries) {
            if (entry.isDirectory()) visit(path.join(directory, entry.name));
        }
    };
    visit(directories.chats);
    visit(directories.groupChats);
    return files.sort();
}

/** Includes WAL changes and file replacement; called while holding the chat lock when reading. */
function fingerprint(filePath) {
    const paths = filePath.endsWith('.sqlite') ? [filePath, `${filePath}-wal`] : [filePath];
    return JSON.stringify(paths.map((target, index) => {
        try {
            const stat = fs.statSync(target);
            if (index > 0 && stat.size === 0) return null;
            return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino];
        } catch (error) {
            if (index > 0 && error.code === 'ENOENT') return null;
            throw error;
        }
    }));
}

/** Captures attachment settings without reading or persisting their contents. */
function settingsFingerprint(directories) {
    try {
        return fingerprint(path.join(directories.root, SETTINGS_FILE));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

/** Extracts only media references. Chat text and lorebook metadata never enter scan state. */
function collectReferences(record, root, references) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid chat record');
    // Unsupported split-tail histories must not authorize cleanup of their unseen head.
    if (record.chat_storage?.mode === 'split-tail') throw new Error('Unsupported chat storage');
    const add = (category, value) => {
        if (value === undefined || value === null || value === '') return;
        if (typeof value !== 'string') throw new Error('Invalid media reference');
        if (/^(?:https?:|data:)/i.test(value)) return;
        references[category].add(hashDataMaidReference(path.join(root, value)));
    };
    const array = value => {
        if (value === undefined || value === null) return [];
        if (!Array.isArray(value)) throw new Error('Invalid reference list');
        return value;
    };
    const extra = value => {
        if (!value) return;
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message extras');
        add('images', value.image);
        add('images', value.video);
        for (const image of array(value.image_swipes)) add('images', image);
        for (const media of array(value.media)) add('images', media?.url);
        add('files', value.file?.url);
        for (const file of array(value.files)) add('files', file?.url);
    };
    extra(record.extra);
    for (const swipe of array(record.swipe_info)) extra(swipe?.extra);
    for (const image of array(record.chat_metadata?.chat_backgrounds)) add('images', image);
    for (const file of array(record.chat_metadata?.attachments)) add('files', file?.url);
}

/** Reads a bounded SQLite page by primary key without migration, export, or chat writes. */
function readSqlitePage(filePath, cursor, consume, deadline) {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    let bytes = 0;
    let count = 0;
    try {
        for (const row of db.prepare('SELECT id, content FROM messages WHERE id > ? ORDER BY id LIMIT ?').iterate(cursor, PAGE_RECORDS)) {
            const size = Buffer.byteLength(row.content);
            if (size > MAX_RECORD_BYTES) throw new Error('Chat record exceeds scan limit');
            consume(JSON.parse(row.content));
            cursor = row.id;
            bytes += size;
            count++;
            if (bytes >= PAGE_BYTES || Date.now() >= deadline) return { cursor, done: false, count };
        }
        return { cursor, done: count < PAGE_RECORDS, count };
    } finally {
        db.close();
    }
}

/** Reads complete JSONL records from a byte cursor, including UTF-8 and a final unterminated line. */
function readJsonlPage(filePath, cursor, consume, deadline) {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const start = cursor;
    let position = cursor;
    let pending = Buffer.alloc(0);
    let count = 0;
    try {
        while (true) {
            const read = fs.readSync(fd, buffer, 0, buffer.length, position);
            position += read;
            pending = Buffer.concat([pending, buffer.subarray(0, read)]);
            let newline;
            while ((newline = pending.indexOf(10)) !== -1 || (read === 0 && pending.length)) {
                const length = newline === -1 ? pending.length : newline;
                if (length > MAX_RECORD_BYTES) throw new Error('Chat record exceeds scan limit');
                const line = pending.subarray(0, length).toString('utf8').trim();
                const consumed = length + (newline === -1 ? 0 : 1);
                pending = pending.subarray(consumed);
                cursor += consumed;
                if (line) {
                    consume(JSON.parse(line));
                    count++;
                }
                if (count >= PAGE_RECORDS || cursor - start >= PAGE_BYTES || Date.now() >= deadline) {
                    return { cursor, done: false, count };
                }
            }
            if (!read) return { cursor, done: true, count };
            // A single record is the indivisible unit. Oversized records withhold cleanup;
            // supporting larger records requires a streaming JSON parser, not full-file reads.
            if (pending.length > MAX_RECORD_BYTES) throw new Error('Chat record exceeds scan limit');
        }
    } finally {
        fs.closeSync(fd);
    }
}

/** Serializes session updates across workers using the existing filesystem lock. */
async function withSession(user, operation) {
    const userKey = crypto.createHash('sha256').update(user.profile.handle).digest('hex');
    const filePath = path.join(globalThis.DATA_ROOT, '_data-maid-scans', `${userKey}.json`);
    return await withDirectoryLock({
        lockPath: `${filePath}.lock`, retryMs: 25, timeoutMs: 10_000,
        staleMs: 10 * 60_000, heartbeatMs: 1000,
        timeoutMessage: 'Data Maid scan is busy.',
    }, async lock => await lock.run(async () => await operation(filePath)));
}

/** Loads only this user's matching, unexpired session; missing tokens never trigger a rescan. */
function readSession(filePath, user, token) {
    if (typeof token !== 'string' || !/^scan-[a-f0-9]{64}$/.test(token)) return null;
    if (!fs.existsSync(filePath)) return null;
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return state.token === token && state.handle === user.profile.handle && state.expires > Date.now() ? state : null;
}

/** Advances chat references, one report category, or verification, then atomically saves progress. */
export async function advanceDataMaidScan(user, token, categories, collectCategory, complete) {
    return await withSession(user, async filePath => {
        let state;
        if (token === undefined) {
            state = {
                token: `scan-${crypto.randomBytes(32).toString('hex')}`, handle: user.profile.handle,
                expires: Date.now() + SESSION_TTL_MS, phase: 'categories', index: 0, cursor: 0, records: 0,
                chats: [], stamps: {}, references: { images: [], files: [] }, unavailable: [],
                authorizations: {}, report: {}, categoryIndex: 0, verifyIndex: 0,
            };
            try {
                state.chats = listChats(user.directories);
            } catch {
                state.unavailable = ['images', 'files'];
                state.phase = 'categories';
            }
        } else {
            state = readSession(filePath, user, token);
            if (!state) return null;
        }
        const deadline = Date.now() + BATCH_MS;
        if (state.phase === 'chats') {
            const references = { images: new Set(state.references.images), files: new Set(state.references.files) };
            const initialRecords = state.records;
            let pages = 0;
            do {
                const chat = state.chats[state.index];
                if (!chat) {
                    state.phase = 'categories';
                    break;
                }
                try {
                    const page = await withChatSaveLock(chat, async () => {
                        const before = fingerprint(chat);
                        if (state.stamps[chat] && state.stamps[chat] !== before) throw new Error('Chat changed');
                        const consume = record => collectReferences(record, user.directories.root, references);
                        const result = chat.endsWith('.sqlite')
                            ? readSqlitePage(chat, state.cursor, consume, deadline)
                            : readJsonlPage(chat, state.cursor, consume, deadline);
                        const after = fingerprint(chat);
                        if (before !== after) throw new Error('Chat changed');
                        state.stamps[chat] = after;
                        return result;
                    });
                    state.records += page.count;
                    state.cursor = page.cursor;
                    if (page.done) {
                        state.index++;
                        state.cursor = 0;
                    }
                } catch {
                    // Never treat an unreadable/changed chat as having no references.
                    state.unavailable.push('images', 'files');
                    state.phase = 'categories';
                    break;
                }
            } while (++pages < 8 && state.records - initialRecords < PAGE_RECORDS && Date.now() < deadline);
            state.references = { images: [...references.images], files: [...references.files] };
        } else if (state.phase === 'categories') {
            const category = categories[state.categoryIndex++];
            if (category) {
                if (category === 'files') state.settingsStamp = settingsFingerprint(user.directories);
                const result = state.unavailable.includes(category)
                    ? { paths: [], report: [] }
                    : await collectCategory(category, state.references);
                // Capture candidate identity at collection time, including lorebook stat
                // information used by the existing deletion revalidation.
                state.authorizations[category] = complete({ [category]: result.paths });
                state.report[category] = result.report;
                if (result.unavailable) state.unavailable.push(category);
                if (category === 'files' && state.settingsStamp !== settingsFingerprint(user.directories)) state.unavailable.push('files');
            }
            // The existing lorebook header reader may upgrade/checkpoint SQLite. Run it
            // before capturing media-scan fingerprints, never between read and verification.
            if (category === 'lorebooks') state.phase = 'chats';
            if (state.categoryIndex >= categories.length) state.phase = 'verify';
        } else if (state.phase === 'verify') {
            try {
                do {
                    const chat = state.chats[state.verifyIndex++];
                    if (!chat) break;
                    if (state.stamps[chat] !== fingerprint(chat)) throw new Error('Chat changed');
                } while (Date.now() < deadline);
                if (state.verifyIndex >= state.chats.length) {
                    if (JSON.stringify(listChats(user.directories)) !== JSON.stringify(state.chats)) throw new Error('Chat inventory changed');
                    if (state.settingsStamp !== settingsFingerprint(user.directories)) state.unavailable.push('files');
                    state.phase = 'done';
                }
            } catch {
                state.unavailable.push('images', 'files');
                state.phase = 'done';
            }
            if (state.phase === 'done') {
                state.unavailable = [...new Set(state.unavailable)];
                for (const category of state.unavailable) {
                    state.authorizations[category] = [];
                    state.report[category] = [];
                }
                state.paths = Object.values(state.authorizations).flat();
                delete state.authorizations;
                delete state.references;
            }
        }
        // One session per user bounds abandoned state. JSON rewrites scale with reference
        // count, not chat text; move this scratch state to SQLite if reference sets grow large.
        await writeFileAtomic(filePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
        return state.phase === 'done'
            ? { done: true, token: state.token, report: state.report, unavailableCategories: state.unavailable }
            : { done: false, token: state.token, progress: { phase: state.phase, completed: state.index, total: state.chats.length, records: state.records } };
    });
}

/** Reads completed authorization on any worker without repeating the scan. */
export async function getDataMaidScanPaths(user, token) {
    return await withSession(user, async filePath => {
        const state = readSession(filePath, user, token);
        return state?.phase === 'done' ? state.paths : null;
    });
}

/** Cancels/finalizes only the matching session; an old dialog cannot remove a newer scan. */
export async function finalizeDataMaidScan(user, token) {
    return await withSession(user, async filePath => {
        if (readSession(filePath, user, token)) await fs.promises.unlink(filePath);
    });
}
