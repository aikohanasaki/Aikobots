import { beforeAll, beforeEach, afterEach, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDb, setMessages, getChatHeader } from '../sqlite-manager.js';
import { captureStmbOperationSource, recordStmbDeletion, readStmbOperations } from '../stmb-operations.js';

const books = new Map();
const transactionSave = jest.fn();
jest.unstable_mockModule('../lorebook-repository.js', () => ({
    getCanonicalLorebookName: name => name,
    getLorebookForManagement: jest.fn(async (_user, name) => ({ data: structuredClone(books.get(name)), metadata: { name, storage: 'user' } })),
    assertLorebookCheckoutForManagement: jest.fn(),
    withLorebookManagementTransaction: callback => callback({ save: transactionSave }),
}));
jest.unstable_mockModule('../chat-storage.js', () => ({ withChatSaveLock: (_file, callback) => callback() }));

let withStmbMemoryTransaction;
let resolveStmbOperations;
let directory;
let sqlitePath;
let request;
let planStmbChatCopyBook;
let stampStmbSidePromptRollback;
let hashStmbRollbackState;
beforeAll(async () => ({ withStmbMemoryTransaction, resolveStmbOperations } = await import('../stmb-operation-service.js')));
beforeAll(async () => ({ planStmbChatCopyBook, stampStmbSidePromptRollback, hashStmbRollbackState } = await import('../stmb-rollback.js')));
beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-save-recovery-'));
    sqlitePath = path.join(directory, 'chat.sqlite');
    const db = await loadDb(sqlitePath);
    setMessages(db, [{ chat_revision: 1, chat_metadata: {} },
        { aikobots_message_uuid: '00000000-0000-4000-8000-000000000001', name: 'Test', mes: 'Ordinary chat' }]);
    const source = captureStmbOperationSource(db, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');
    db.close();
    request = { user: {}, body: { lorebookName: 'Book', storage: 'user', operation: { ...source, id: 'memory-save-1' } } };
    books.clear();
    books.set('Book', { entries: {} });
    books.set('Other', { entries: {} });
    transactionSave.mockReset();
    transactionSave.mockImplementation(async (_user, name, data) => { books.set(name, structuredClone(data)); return { name, storage: 'user' }; });
});
afterEach(() => {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
});

it('recognizes a persisted write after response loss without generating another entry', async () => {
    const create = jest.fn(async transaction => {
        await transaction.save({}, 'Book', { entries: { 1: { uid: 1, content: 'Generated ordinary memory' } } }, 'user');
        throw new Error('response lost');
    });
    await expect(withStmbMemoryTransaction(request, sqlitePath, create)).rejects.toThrow('response lost');
    const replay = await withStmbMemoryTransaction(request, sqlitePath, create);
    expect(replay.memorySaved).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const resolved = await resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', operation_id: 'recovery-request', base_revision: 1 } }, sqlitePath);
    expect(resolved.highestMemoryProcessed).toBe(0);
    const second = await resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', operation_id: 'recovery-request', base_revision: 1 } }, sqlitePath);
    expect(second.chat_revision).toBe(2);
    expect(Object.keys(books.get('Book').entries)).toEqual(['1']);
});

it('keeps a partially written multi-book operation unresolved and never advances progress', async () => {
    request.body.primary = { lorebookName: 'Book', storage: 'user' };
    request.body.targets = [{ lorebookName: 'Other', storage: 'user' }];
    const create = jest.fn(async transaction => {
        await transaction.save({}, 'Book', { entries: { 1: { uid: 1, content: 'Ordinary memory' } } }, 'user');
        throw new Error('worker stopped before second book');
    });
    await expect(withStmbMemoryTransaction(request, sqlitePath, create)).rejects.toThrow('worker stopped');
    await expect(withStmbMemoryTransaction(request, sqlitePath, create)).rejects.toMatchObject({ status: 409 });
    const db = await loadDb(sqlitePath);
    try {
        expect(readStmbOperations(db)[0].state).toBe('conflict');
        expect(getChatHeader(db).chat_revision).toBe(1);
    } finally { db.close(); }
    expect(create).toHaveBeenCalledTimes(1);
});

it('rejects edited saved entries before acknowledging progress', async () => {
    await expect(withStmbMemoryTransaction(request, sqlitePath, async transaction => {
        await transaction.save({}, 'Book', { entries: { 1: { uid: 1, content: 'Original generated memory' } } }, 'user');
        throw new Error('stopped before progress');
    })).rejects.toThrow('stopped before progress');
    books.get('Book').entries[1].content = 'Manual edit';
    await expect(resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', operation_id: 'recovery-request', base_revision: 1 } }, sqlitePath)).rejects.toMatchObject({ status: 409 });
});

it('resumes rollback after the first book was written without restoring or deleting unrelated entries', async () => {
    const db = await loadDb(sqlitePath);
    try {
        const header = getChatHeader(db);
        header.chat_metadata.STMemoryBooks = { autoRollbackPolicy: { enabled: true, books: ['Book', 'Other'] } };
        db.run('UPDATE messages SET content = ? WHERE order_index = 0', [JSON.stringify(header)]);
        recordStmbDeletion(db, header, 0, 0, 'delete-1');
        db.run('DELETE FROM messages WHERE order_index > 0');
    } finally { db.close(); }
    for (const name of ['Book', 'Other']) books.set(name, { entries: {
        1: { uid: 1, stmemorybooks: true, STMB_startUuid: request.body.operation.startUuid, STMB_endUuid: request.body.operation.endUuid },
        2: { uid: 2, content: 'Unrelated ordinary entry' },
    } });
    let interrupted = false;
    transactionSave.mockImplementation(async (_user, name, data) => {
        if (name === 'Other' && !interrupted) { interrupted = true; throw new Error('interrupted'); }
        books.set(name, structuredClone(data));
    });
    const resolveRequest = { user: {}, body: { id: 'rollback-delete-1', action: 'retry', operation_id: 'recovery-request', base_revision: 1 } };
    await expect(resolveStmbOperations(resolveRequest, sqlitePath)).rejects.toThrow('interrupted');
    const result = await resolveStmbOperations(resolveRequest, sqlitePath);
    expect(result.chat_revision).toBe(2);
    expect(result.operations).toEqual([]);
    expect(transactionSave.mock.calls.filter(([, name]) => name === 'Book')).toHaveLength(1);
    expect(books.get('Book').entries).toEqual({ 2: { uid: 2, content: 'Unrelated ordinary entry' } });
    expect(books.get('Other')).toEqual(books.get('Book'));
});

it('offers safe generation retry only for an intent whose save never started', async () => {
    await resolveStmbOperations({ ...request, body: { action: 'prepare', operation: request.body.operation, targets: [{ name: 'Book', storage: 'user' }] } }, sqlitePath);
    const result = await resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', operation_id: 'recovery-request', base_revision: 1 } }, sqlitePath);
    expect(result.retryRange).toEqual({ sceneStart: 0, sceneEnd: 0 });
    expect(result.operations).toEqual([]);
    expect(result.chat_revision).toBe(1);
    expect(transactionSave).not.toHaveBeenCalled();
});

it('rolls back an isolated book before remapping retained UUIDs, versions and linked groups', () => {
    const history = { version: 1, templateKey: 'tracker', chatId: 'parent', chatKey: '["character","a.png","parent"]', titleSource: 'name', titleBase: 'Tracker', group: 'Tracker-parent' };
    const sidePrompt = (uid, sequence, start, end, disable) => {
        const entry = { uid, comment: 'Tracker (STMB SidePrompt)', content: `Ordinary version ${sequence}`, disable, group: history.group,
            STMB_sidePromptHistory: { ...history, sequence },
            STMB_sidePromptRegeneration: { version: 1, templateKey: 'tracker', chatId: 'parent', sceneStartUuid: `u${start}`, sceneEndUuid: `u${end}` } };
        stampStmbSidePromptRollback(entry, null);
        return entry;
    };
    const original = { entries: {
        1: { uid: 1, stmemorybooks: true, STMB_startUuid: 'u0', STMB_endUuid: 'u1', STMB_chatId: 'parent', disable: true, disabledBySummaryId: 3, group: 'Cast-Memory-001', STMB_inclusionGroup: 'Cast-Memory-001', STMB_memoryRole: 'group' },
        2: { uid: 2, stmemorybooks: true, STMB_startUuid: 'u1', STMB_endUuid: 'u3', STMB_memoryRole: 'group' },
        3: { uid: 3, stmemorybooks: true, stmbSummary: true, stmbSourceEntryUids: [1, 2], STMB_memoryRole: 'group' },
        4: { uid: 4, comment: 'Unrelated ordinary entry', content: 'Retain' },
        5: sidePrompt(5, 1, 0, 1, true),
        6: sidePrompt(6, 2, 2, 3, false),
        7: { uid: 7, stmemorybooks: true, STMB_chatId: 'other', STMB_startUuid: 'foreign-start', STMB_endUuid: 'foreign-end', STMB_memoryRole: 'group' },
    } };
    const before = structuredClone(original);
    const options = { sourceChatId: 'parent', targetChatId: 'child', boundary: 1, settings: {},
        resolveMessage: uuid => /^u\d$/.test(uuid) ? { logicalIndex: Number(uuid.slice(1)) } : null,
        uuidMap: new Map([['u0', 'child0'], ['u1', 'child1']]) };
    const { data, highest } = planStmbChatCopyBook(original, options);
    expect(Object.keys(data.entries)).toEqual(['1', '4', '5', '7']);
    expect(data.entries[1]).toMatchObject({ STMB_startUuid: 'child0', STMB_endUuid: 'child1', STMB_chatId: 'child', disable: false });
    expect(data.entries[1].disabledBySummaryId).toBeUndefined();
    expect(data.entries[1].group).toBe(data.entries[1].STMB_inclusionGroup);
    expect(data.entries[1].group).not.toBe(original.entries[1].group);
    expect(data.entries[5].STMB_sidePromptHistory).toMatchObject({ chatId: 'child', chatKey: '["character","a.png","child"]', group: 'Tracker-child' });
    expect(data.entries[5].disable).toBe(false);
    const { STMB_sidePromptRegeneration: snapshot, ...written } = data.entries[5];
    expect(snapshot.writtenFingerprint).toBe(hashStmbRollbackState(written));
    expect(snapshot.sceneEndUuid).toBe('child1');
    expect(highest).toBe(1);
    expect(original).toEqual(before);
    expect(data.entries[7]).toEqual(original.entries[7]);
    const malformed = structuredClone(original);
    malformed.entries[6].STMB_sidePromptHistory.sequence = 1;
    expect(() => planStmbChatCopyBook(malformed, options)).toThrow();
    const legacy = structuredClone(original);
    delete legacy.entries[1].STMB_startUuid;
    expect(() => planStmbChatCopyBook(legacy, options)).toThrow();
    const disconnected = structuredClone(original);
    disconnected.entries[3].stmbSourceEntryUids = [99];
    expect(() => planStmbChatCopyBook(disconnected, options)).toThrow();
});

it('restores one exact Side Prompt layer and refuses edited or still-future prior states', () => {
    const prior = { uid: 1, content: 'Earlier ordinary output', STMB_sidePromptRegeneration: { version: 1, chatId: 'parent', sceneStartUuid: 'u0', sceneEndUuid: 'u1' } };
    const current = { uid: 1, content: 'Later ordinary output', STMB_sidePromptRegeneration: { version: 1, chatId: 'parent', sceneStartUuid: 'u2', sceneEndUuid: 'u3' } };
    stampStmbSidePromptRollback(current, prior);
    const options = { sourceChatId: 'parent', targetChatId: 'child', boundary: 1, settings: {},
        resolveMessage: uuid => ({ logicalIndex: Number(uuid.slice(1)) }), uuidMap: new Map([['u0', 'c0'], ['u1', 'c1']]) };
    const result = planStmbChatCopyBook({ entries: { 1: current } }, options);
    expect(result.data.entries[1]).toMatchObject({ content: prior.content, STMB_sidePromptRegeneration: { version: 1, chatId: 'child', sceneEndUuid: 'c1' } });
    expect(() => planStmbChatCopyBook({ entries: { 1: { ...current, content: 'Manual edit' } } }, options)).toThrow();
    const future = structuredClone(current);
    future.STMB_sidePromptRegeneration.priorEntry.STMB_sidePromptRegeneration.sceneEndUuid = 'u2';
    expect(() => planStmbChatCopyBook({ entries: { 1: future } }, options)).toThrow();
    expect(() => planStmbChatCopyBook({ entries: { 1: { uid: 1, comment: 'Legacy (STMB SidePrompt)' } } }, options)).toThrow();
});
