import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const books = new Map();
const save = jest.fn(async (_user, name, data) => { books.set(name, structuredClone(data)); });
jest.unstable_mockModule('../lorebook-repository.js', () => ({
    getLorebookForManagement: async (_user, name) => ({ data: structuredClone(books.get(name)), metadata: { name, storage: 'user' } }),
    withLorebookManagementTransaction: callback => callback({ save }),
    getCanonicalLorebookName: name => name,
    assertLorebookCheckoutForManagement: () => {},
}));

let service, sqlite, operations, db, file, directory, messages, input;
beforeAll(async () => {
    sqlite = await import('../sqlite-manager.js');
    operations = await import('../stmb-operations.js');
    service = await import('../stmb-operation-service.js');
});
beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-recovery-'));
    file = path.join(directory, 'chat.sqlite');
    db = await sqlite.loadDb(file);
    messages = Array.from({ length: 5 }, (_, index) => ({ aikobots_message_uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, mes: `Message ${index}` }));
    sqlite.setMessages(db, [{ chat_revision: 1, chat_metadata: { STMemoryBooks: { sceneStart: 0, sceneEnd: 2 } } }, ...messages]);
    input = { id: 'memory-1', ...operations.captureStmbOperationSource(db, messages[0].aikobots_message_uuid, messages[2].aikobots_message_uuid), clearScene: true };
    books.clear();
    books.set('Book', { entries: {} });
    save.mockClear();
});
afterEach(() => {
    db.close();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
});

function request(action, extra = {}) {
    return { body: { action, id: input.id, operation_id: `${action}-request`, base_revision: 1, ...extra }, activeSessionOperation: { assertAllowed: async () => {} } };
}
function prepare() {
    return operations.beginStmbOperation(db, input, [{ name: 'Book', storage: 'user', count: 1 }]);
}
async function commit(callback = async transaction => {
    const data = structuredClone(books.get('Book'));
    data.entries[1] = { uid: 1, content: 'Ordinary generated memory' };
    await transaction.save({}, 'Book', data, 'user');
    return { entry: data.entries[1] };
}) {
    return service.withStmbMemoryTransaction({ ...request('save'), body: { operation: input, lorebookName: 'Book', storage: 'user' } }, file, callback);
}

it('cancels pre-write failures durably, but a delayed save cannot revive the canceled identity', async () => {
    prepare();
    await expect(commit(async () => { throw new Error('validation failed'); })).rejects.toThrow('validation failed');
    expect(save).not.toHaveBeenCalled();
    expect(await service.resolveStmbOperations(request('cancel-unstarted'), file)).toMatchObject({ canceled: true });
    expect(await service.resolveStmbOperations(request('cancel-unstarted'), file)).toMatchObject({ canceled: true });
    await expect(commit()).rejects.toMatchObject({ type: 'StmbOperationConflict' });
    input.id = 'memory-2';
    expect(prepare().state).toBe('prepared');
});

it('finishes progress before replying and concurrent repeated saves create only one entry', async () => {
    input.hideRanges = [{ start: 0, end: 2 }];
    prepare();
    const results = await Promise.all([commit(), commit()]);
    expect(results.every(result => result.operation.state === 'applied')).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(sqlite.getChatHeader(db)).toMatchObject({ chat_revision: 2, chat_metadata: { STMemoryBooks: { highestMemoryProcessed: 2 } } });
    expect(sqlite.getChatHeader(db).chat_metadata.STMemoryBooks.sceneStart).toBeUndefined();
    expect(sqlite.getMessageRange(db, 0, 5).map(message => message.aikobots_message_uuid)).toEqual(messages.map(message => message.aikobots_message_uuid));
    expect(sqlite.getMessageRange(db, 0, 5).map(message => Boolean(message.is_system))).toEqual([true, true, true, false, false]);
    expect(await service.resolveStmbOperations(request('cancel-unstarted'), file)).toMatchObject({ canceled: false });
});

it('reconciles a write that completed before its acknowledgement without writing again', async () => {
    prepare();
    save.mockImplementationOnce(async (_user, name, data) => { books.set(name, structuredClone(data)); throw new Error('lost acknowledgement'); });
    await expect(commit()).rejects.toThrow('lost acknowledgement');
    expect(sqlite.getChatHeader(db).chat_revision).toBe(1);
    expect(await commit()).toMatchObject({ memorySaved: true, operation: { state: 'applied' } });
    expect(save).toHaveBeenCalledTimes(1);
    expect(sqlite.getChatHeader(db).chat_revision).toBe(2);
});

it('does not guess that a write intent without matching entries is safe to cancel or regenerate', async () => {
    prepare();
    save.mockImplementationOnce(async () => { throw new Error('uncertain write'); });
    await expect(commit()).rejects.toThrow('uncertain write');
    expect(await service.resolveStmbOperations(request('cancel-unstarted'), file)).toMatchObject({ canceled: false });
    await expect(service.resolveStmbOperations(request('retry'), file)).rejects.toMatchObject({ code: 'StmbRecoverySavedEntriesChanged' });
    expect(save).toHaveBeenCalledTimes(1);
});

it('recovers old started records only when no write intent or attributed entry exists', async () => {
    const operation = prepare();
    operation.data.started = true;
    operations.writeStmbOperation(db, operation);
    expect(await service.resolveStmbOperations(request('cancel-unstarted'), file)).toMatchObject({ canceled: true });
});

it('replays a lost Retry reply after reopening SQLite, and rejects reuse for a different action', async () => {
    prepare();
    const first = await service.resolveStmbOperations(request('retry'), file);
    expect(first.retryRange).toEqual({ sceneStart: 0, sceneEnd: 2 });
    db.close();
    db = await sqlite.loadDb(file);
    expect(await service.resolveStmbOperations(request('retry'), file)).toEqual(first);
    await expect(service.resolveStmbOperations(request('discard', { operation_id: 'retry-request' }), file)).rejects.toMatchObject({ type: 'StmbOperationConflict' });
});

it('repeats discard and applied Retry without advancing progress twice', async () => {
    prepare();
    await commit();
    const first = await service.resolveStmbOperations(request('retry'), file);
    expect(await service.resolveStmbOperations(request('retry'), file)).toEqual(first);
    expect(sqlite.getChatHeader(db).chat_revision).toBe(2);
    const discarded = await service.resolveStmbOperations(request('discard'), file);
    expect(await service.resolveStmbOperations(request('discard'), file)).toEqual(discarded);
});

it('allows unrelated tail edits/deletions and newer chat revisions without clearing newer scene markers', async () => {
    prepare();
    operations.recordStmbDeletion(db, sqlite.getChatHeader(db), 4, 4, 'tail-delete');
    db.run('DELETE FROM messages WHERE message_uuid = ?', [messages[4].aikobots_message_uuid]);
    db.run('UPDATE messages SET content = ? WHERE message_uuid = ?', [JSON.stringify({ ...messages[3], mes: 'Unrelated edit' }), messages[3].aikobots_message_uuid]);
    const header = sqlite.getChatHeader(db);
    header.chat_revision = 7;
    header.chat_metadata.STMemoryBooks.sceneStart = 3;
    header.chat_metadata.STMemoryBooks.sceneEnd = 3;
    db.run('UPDATE messages SET content = ? WHERE order_index = 0', [JSON.stringify(header)]);
    expect(await commit()).toMatchObject({ chat_revision: 8, previous_revision: 7, clearScene: false });
    expect(sqlite.getChatHeader(db).chat_metadata.STMemoryBooks.sceneStart).toBe(3);
    expect(sqlite.getMessageRange(db, 0, 5).at(-1).mes).toBe('Unrelated edit');
});

it('rejects changes inside the captured source and explicit progress edits before any write', async () => {
    prepare();
    db.run('UPDATE messages SET content = ? WHERE message_uuid = ?', [JSON.stringify({ ...messages[1], mes: 'Changed source' }), messages[1].aikobots_message_uuid]);
    await expect(commit()).rejects.toMatchObject({ code: 'StmbRecoverySourceChanged' });
    db.run('UPDATE messages SET content = ? WHERE message_uuid = ?', [JSON.stringify(messages[1]), messages[1].aikobots_message_uuid]);
    sqlite.setMetadata(db, 'stmb_progress_revision', 'explicit-edit');
    await expect(commit()).rejects.toMatchObject({ code: 'StmbRecoveryProgressChanged' });
    expect(save).not.toHaveBeenCalled();
});

it('optional follow-up effects on an applied operation do not block a new memory', async () => {
    prepare();
    await commit();
    const operation = operations.readStmbOperations(db)[0];
    operation.data.effectsPending = true;
    operations.writeStmbOperation(db, operation);
    expect((await service.resolveStmbOperations(request(''), file)).operations).toEqual([]);
    input.id = 'memory-2';
    expect(prepare().state).toBe('prepared');
});

it('keeps partial group writes pending instead of recreating a saved target', async () => {
    books.set('Second', { entries: {} });
    operations.beginStmbOperation(db, input, [{ name: 'Book', storage: 'user', count: 1 }, { name: 'Second', storage: 'user', count: 1 }]);
    const req = { ...request('save'), body: { operation: input, primary: { lorebookName: 'Book', storage: 'user' }, targets: [{ lorebookName: 'Second', storage: 'user' }] } };
    const callback = async transaction => {
        await transaction.save({}, 'Book', { entries: { 1: { uid: 1, content: 'First ordinary memory' } } }, 'user');
        await transaction.save({}, 'Second', { entries: { 1: { uid: 1, content: 'Second ordinary memory' } } }, 'user');
    };
    save.mockImplementationOnce(async (_user, name, data) => { books.set(name, structuredClone(data)); });
    save.mockImplementationOnce(async () => { throw new Error('interrupted group save'); });
    await expect(service.withStmbMemoryTransaction(req, file, callback)).rejects.toThrow('interrupted group save');
    await expect(service.withStmbMemoryTransaction(req, file, callback)).rejects.toMatchObject({ type: 'StmbOperationConflict' });
    expect(save).toHaveBeenCalledTimes(2);
    expect(Object.keys(books.get('Book').entries)).toEqual(['1']);
    expect(sqlite.getChatHeader(db).chat_revision).toBe(1);
});

it('replays completed rollback recovery without applying a second mutation', async () => {
    const header = sqlite.getChatHeader(db);
    header.chat_metadata.STMemoryBooks.autoRollbackPolicy = { enabled: true, books: ['Book'] };
    operations.recordStmbDeletion(db, header, 4, 4, 'deletion');
    db.run('DELETE FROM messages WHERE message_uuid = ?', [messages[4].aikobots_message_uuid]);
    const req = request('retry', { id: 'rollback-deletion' });
    const first = await service.resolveStmbOperations(req, file);
    expect(first.chat_revision).toBe(2);
    expect(await service.resolveStmbOperations(req, file)).toEqual(first);
    expect(sqlite.getChatHeader(db).chat_revision).toBe(2);
});
