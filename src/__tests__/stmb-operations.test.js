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
beforeAll(async () => ({ withStmbMemoryTransaction, resolveStmbOperations } = await import('../stmb-operation-service.js')));
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
    const resolved = await resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', base_revision: 1 } }, sqlitePath);
    expect(resolved.highestMemoryProcessed).toBe(0);
    const second = await resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', base_revision: 1 } }, sqlitePath);
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
    await withStmbMemoryTransaction(request, sqlitePath, transaction => transaction.save({}, 'Book', { entries: { 1: { uid: 1, content: 'Original generated memory' } } }, 'user'));
    books.get('Book').entries[1].content = 'Manual edit';
    await expect(resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', base_revision: 1 } }, sqlitePath)).rejects.toMatchObject({ status: 409 });
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
    const resolveRequest = { user: {}, body: { id: 'rollback-delete-1', action: 'retry', base_revision: 1 } };
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
    const result = await resolveStmbOperations({ user: {}, body: { id: request.body.operation.id, action: 'retry', base_revision: 1 } }, sqlitePath);
    expect(result.retryRange).toEqual({ sceneStart: 0, sceneEnd: 0 });
    expect(result.operations).toEqual([]);
    expect(result.chat_revision).toBe(1);
    expect(transactionSave).not.toHaveBeenCalled();
});
