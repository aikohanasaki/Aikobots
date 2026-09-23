import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateStmbChatRef, resolveCharacterChatFilePath, resolveGroupChatFilePath } from './chat-paths.js';
import { replaceChatStorageExtension } from './chat-storage.js';
import { loadDb, getChatHeader, getLogicalMessageRow, getLogicalMessageRowByUuid } from './sqlite-manager.js';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status = 400) => { throw Object.assign(new Error('Chat message search unavailable.'), { status }); };

/** Maps a lowercase match back to original text when case conversion expands Unicode characters. */
function originalMatchOffset(text, foldedOffset) {
    let original = 0;
    let folded = 0;
    for (const character of text) {
        if (folded >= foldedOffset) break;
        const width = character.toLowerCase().length;
        if (folded + width > foldedOffset) break;
        folded += width;
        original += character.length;
    }
    return original;
}

/** Projects ordinary active message text only; never returns swipes or arbitrary metadata. */
function project(message, index) {
    const text = typeof message?.mes === 'string' ? message.mes : '';
    return {
        index, uuid: String(message?.aikobots_message_uuid || ''),
        name: String(message?.name || ''), mes: text,
        is_system: Boolean(message?.is_system), is_user: Boolean(message?.is_user),
        send_date: message?.send_date || '',
        ...(typeof message?.original_avatar === 'string' ? { original_avatar: message.original_avatar } : {}),
        hash: digest([text, message?.name, message?.is_user, message?.is_system, message?.send_date, message?.original_avatar]),
    };
}

/** Executes a bounded search/read in one SQLite snapshot, or the existing legacy logical reader. */
export async function readChatMessageSearch(directories, body, readLegacy, selected = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
    if (!['character', 'group'].includes(body.chatRef?.type)) fail();
    const reference = validateStmbChatRef(body?.chatRef);
    if (reference.type === 'group' ? !reference.chatId : !reference.avatarUrl || !reference.fileName) fail();
    const filePath = reference.type === 'group'
        ? resolveGroupChatFilePath(directories.groupChats, reference.chatId)
        : resolveCharacterChatFilePath(directories.chats, reference.avatarUrl, reference.fileName);
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!selected && (!query || query.length > 1000 || (body.hiddenOnly !== undefined && typeof body.hiddenOnly !== 'boolean'))) fail();
    if (selected && (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 500)) fail();
    if (selected && (!['none', 'before', 'after'].includes(body.neighbor || 'none') || (body.neighbor && body.neighbor !== 'none' && body.messages.length !== 1))) fail();
    const cursor = body.cursor ?? null;
    if (cursor !== null && (!Number.isFinite(cursor) || cursor < 0)) fail();
    const limit = body.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail();
    if ((selected || cursor !== null) && (typeof body.revision !== 'string' || !body.revision)) fail();

    const run = (revision, rows, lookup, total) => {
        if (body.revision !== undefined && body.revision !== revision) fail(409);
        if (selected) {
            const result = new Map();
            for (const identity of body.messages) {
                if (!Number.isInteger(identity?.index) || identity.index < 0 || typeof identity.uuid !== 'string' || typeof identity.hash !== 'string') fail();
                const message = lookup(identity);
                if (!message || message.uuid !== identity.uuid || message.hash !== identity.hash || message.index !== identity.index) fail(409);
                if (body.neighbor && body.neighbor !== 'none') {
                    const index = message.index + (body.neighbor === 'before' ? -1 : 1);
                    if (index >= 0 && index < total) {
                        const adjacent = lookup({ index });
                        if (!adjacent) fail(409);
                        result.set(adjacent.index, adjacent);
                    }
                } else result.set(message.index, message);
            }
            return { revision, total, messages: [...result.values()].sort((a, b) => a.index - b.index) };
        }
        const matches = [];
        let scanned = 0;
        let last = cursor;
        let nextCursor = null;
        const term = query.toLowerCase();
        // Literal search is O(history size), bounded per request. Add an index only if measured latency warrants it.
        for (const row of rows()) {
            if (scanned === 500 || matches.length === limit) { nextCursor = last; break; }
            scanned++;
            last = row.cursor;
            const text = typeof row.message?.mes === 'string' ? row.message.mes : '';
            const foldedOffset = text.toLowerCase().indexOf(term);
            if (foldedOffset < 0 || (body.hiddenOnly && !row.message?.is_system)) continue;
            const message = project(row.message, row.index);
            const offset = originalMatchOffset(text, foldedOffset);
            const start = Math.max(0, offset - 100);
            const end = Math.min(message.mes.length, offset + Math.min(query.length, 200) + 200);
            const { mes, ...summary } = message;
            matches.push({ ...summary, preview: `${start ? '…' : ''}${mes.slice(start, end)}${end < mes.length ? '…' : ''}` });
        }
        return { revision, total, matches, nextCursor, scanned };
    };

    if (!fs.existsSync(sqlitePath)) {
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.jsonl'))) fail(404);
        const state = await readLegacy(directories, reference);
        if (state.storageHealthy === false || state.missingRanges?.length) fail(409);
        const messages = state.messages;
        const revision = digest([reference, state.header, messages]);
        const start = cursor === null ? 0 : cursor + 1;
        if (!Number.isInteger(start)) fail();
        return run(revision, function* () {
            for (let index = start; index < messages.length; index++) yield { index, cursor: index, message: messages[index] };
        }, identity => messages[identity.index] ? project(messages[identity.index], identity.index) : null, messages.length);
    }

    const db = await loadDb(sqlitePath, { readonly: true });
    try {
        db.run('BEGIN TRANSACTION');
        const header = getChatHeader(db);
        if (!header) fail(409);
        const revision = digest([reference, header]);
        const count = db.database.prepare('SELECT COUNT(*) FROM messages WHERE order_index > 0').pluck().get();
        const firstIndex = cursor === null ? 0 : db.database.prepare('SELECT COUNT(*) FROM messages WHERE order_index > 0 AND order_index <= ?').pluck().get(cursor);
        const result = run(revision, function* () {
            let index = firstIndex;
            for (const row of db.database.prepare('SELECT order_index, content FROM messages WHERE order_index > ? ORDER BY order_index LIMIT 501').iterate(cursor ?? 0)) {
                yield { index: index++, cursor: row.order_index, message: JSON.parse(row.content) };
            }
        }, identity => {
            const row = identity.uuid ? getLogicalMessageRowByUuid(db, identity.uuid) : getLogicalMessageRow(db, identity.index);
            return row ? project(row.message, row.logicalIndex ?? identity.index) : null;
        }, count);
        db.run('COMMIT');
        return result;
    } catch (error) {
        db.run('ROLLBACK');
        throw error;
    } finally {
        db.close();
    }
}
