import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDb, setMessages, getChatHeader, getMessageRange, setMetadata } from '../src/sqlite-manager.js';
import { beginStmbOperation, captureStmbOperationSource, applyStmbProgress, recordStmbDeletion, readStmbOperations, validateStmbOperationSource } from '../src/stmb-operations.js';
import { setConfigFilePath } from '../src/util.js';

setConfigFilePath(fs.existsSync(path.resolve('config.yaml')) ? path.resolve('config.yaml') : path.resolve('../config.yaml'));
const { planStmbRollbackBook, stampStmbSidePromptRollback } = await import('../src/stmb-rollback.js');

async function createChat(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-operation-test-'));
    const file = path.join(directory, 'chat.sqlite');
    const db = await loadDb(file);
    const messages = Array.from({ length: 5 }, (_, index) => ({ aikobots_message_uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, mes: `Message ${index}`, name: 'Test', swipes: [`Message ${index}`] }));
    setMessages(db, [{ chat_revision: 1, chat_metadata: { STMemoryBooks: { autoRollbackPolicy: { enabled: true } } } }, ...messages]);
    t.after(() => {
        db.close();
        for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
        fs.rmdirSync(directory);
    });
    return { db, file, messages };
}

test('durable progress survives reopening and acknowledges the same save only once', async t => {
    const { db, file, messages } = await createChat(t);
    const source = captureStmbOperationSource(db, messages[0].aikobots_message_uuid, messages[2].aikobots_message_uuid);
    const input = { id: 'memory-1', ...source };
    const targets = [{ name: 'Ordinary Book', storage: 'user', count: 1 }];
    const operation = beginStmbOperation(db, input, targets);
    const second = await loadDb(file);
    try {
        assert.equal(readStmbOperations(second)[0].id, operation.id);
        applyStmbProgress(second, operation);
        applyStmbProgress(second, operation);
        assert.equal(getChatHeader(second).chat_revision, 2);
        assert.equal(getChatHeader(second).chat_metadata.STMemoryBooks.highestMemoryProcessed, 2);
        assert.deepEqual(getMessageRange(second, 0, 5).map(({ id, order_index, ...message }) => message), messages);
        assert.equal(beginStmbOperation(second, input, targets).state, 'applied');
    } finally { second.close(); }
});

test('source edits between generation and save reject the mutation', async t => {
    const { db, messages } = await createChat(t);
    const source = captureStmbOperationSource(db, messages[0].aikobots_message_uuid, messages[2].aikobots_message_uuid);
    const operation = beginStmbOperation(db, { id: 'memory-1', ...source }, []);
    db.run('UPDATE messages SET content = ? WHERE message_uuid = ?', [JSON.stringify({ ...messages[1], mes: 'Edited' }), messages[1].aikobots_message_uuid]);
    assert.throws(() => validateStmbOperationSource(db, operation), { code: 'StmbRecoverySourceChanged', status: 409 });
    assert.equal(getChatHeader(db).chat_revision, 1);
});

test('recovery distinguishes changed progress from missing source messages', async t => {
    const { db, messages } = await createChat(t);
    const source = captureStmbOperationSource(db, messages[0].aikobots_message_uuid, messages[2].aikobots_message_uuid);
    const operation = beginStmbOperation(db, { id: 'memory-1', ...source }, []);
    recordStmbDeletion(db, getChatHeader(db), 4, 4, 'delete-1');
    assert.doesNotThrow(() => validateStmbOperationSource(db, operation));
    setMetadata(db, 'stmb_progress_revision', 'explicit-progress-edit');
    assert.throws(() => validateStmbOperationSource(db, operation), { code: 'StmbRecoveryProgressChanged' });
    db.run('DELETE FROM messages WHERE message_uuid = ?', [messages[0].aikobots_message_uuid]);
    assert.throws(() => validateStmbOperationSource(db, operation), { code: 'StmbRecoverySourceChanged' });
});

test('middle deletion removes dependent summaries, releases surviving sources, and preserves unrelated entries', async t => {
    const { db, messages } = await createChat(t);
    recordStmbDeletion(db, getChatHeader(db), 2, 2, 'delete-1');
    db.run('DELETE FROM messages WHERE message_uuid = ?', [messages[2].aikobots_message_uuid]);
    const operation = readStmbOperations(db)[0];
    const book = { entries: {
        1: { uid: 1, stmemorybooks: true, STMB_startUuid: messages[1].aikobots_message_uuid, STMB_endUuid: messages[3].aikobots_message_uuid, disabledBySummaryId: 3 },
        2: { uid: 2, stmemorybooks: true, STMB_startUuid: messages[0].aikobots_message_uuid, STMB_endUuid: messages[0].aikobots_message_uuid, disabledBySummaryId: 3, disable: true },
        3: { uid: 3, stmemorybooks: true, stmbSourceEntryUids: [1, 2] },
        4: { uid: 4, content: 'Unrelated ordinary entry' },
    } };
    const result = planStmbRollbackBook(db, operation, book);
    assert.deepEqual(Object.keys(result.entries), ['2', '4']);
    assert.equal(result.entries[2].disable, false);
    assert.equal(result.entries[2].disabledBySummaryId, undefined);
    assert.deepEqual(result.entries[4], book.entries[4]);
    assert.ok(book.entries[1]);
});

test('Side Prompt rollback restores one server snapshot and rejects edits and v1 snapshots', async t => {
    const { db, messages } = await createChat(t);
    recordStmbDeletion(db, getChatHeader(db), 2, 2, 'delete-1');
    const operation = readStmbOperations(db)[0];
    const prior = { uid: 1, comment: 'State', content: 'Before' };
    const entry = { ...prior, content: 'After', STMB_sidePromptRegeneration: { version: 1, sceneStartUuid: messages[2].aikobots_message_uuid, sceneEndUuid: messages[2].aikobots_message_uuid } };
    stampStmbSidePromptRollback(entry, prior);
    assert.deepEqual(planStmbRollbackBook(db, operation, { entries: { 1: entry } }).entries[1], prior);
    assert.throws(() => planStmbRollbackBook(db, operation, { entries: { 1: { ...entry, content: 'Manually edited' } } }), { code: 'StmbRecoverySidePromptChanged' });
    entry.STMB_sidePromptRegeneration.version = 1;
    assert.throws(() => planStmbRollbackBook(db, operation, { entries: { 1: entry } }), { code: 'StmbRecoverySnapshotUnavailable' });
});

test('rollback rejects ambiguous legacy ownership and does not treat unrelated entry metadata as a dependency', async t => {
    const { db, messages } = await createChat(t);
    recordStmbDeletion(db, getChatHeader(db), 2, 2, 'delete-1');
    const operation = readStmbOperations(db)[0];
    assert.throws(() => planStmbRollbackBook(db, operation, { entries: { 1: { uid: 1, stmemorybooks: true, STMB_start: 1, STMB_end: 4 } } }), { code: 'StmbRecoveryOwnershipUnclear' });
    const unrelated = { uid: 2, content: 'Ordinary note', stmbSourceEntryUids: [1], disabledBySummaryId: 1 };
    const result = planStmbRollbackBook(db, operation, { entries: {
        1: { uid: 1, stmemorybooks: true, STMB_startUuid: messages[2].aikobots_message_uuid, STMB_endUuid: messages[2].aikobots_message_uuid },
        2: unrelated,
    } });
    assert.deepEqual(result.entries, { 2: unrelated });
});

test('authoritative truncation journals actual removal but not a no-op', async t => {
    const { db, file, messages } = await createChat(t);
    const clean = messages.map(({ swipes, ...message }) => message);
    setMessages(db, [getChatHeader(db), ...clean]);
    const { truncateSqliteChatAfterUuid } = await import('../src/endpoints/chats.js');
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const first = await truncateSqliteChatAfterUuid({ filePath: file, saveSessionId: sessionId, displayCount: 10, requestBody: {
        base_revision: 1, save_session_id: sessionId, operation_id: '11111111-1111-4111-8111-111111111111', branch_point_uuid: messages[4].aikobots_message_uuid,
    } });
    assert.equal(readStmbOperations(db).length, 0);
    await truncateSqliteChatAfterUuid({ filePath: file, saveSessionId: sessionId, displayCount: 10, requestBody: {
        base_revision: first.chat_revision, save_session_id: sessionId, operation_id: '22222222-2222-4222-8222-222222222222', branch_point_uuid: messages[2].aikobots_message_uuid,
    } });
    assert.deepEqual(readStmbOperations(db)[0].data.deleted, messages.slice(3).map(message => message.aikobots_message_uuid));
    assert.deepEqual(getMessageRange(db, 0, 3).map(message => message.aikobots_message_uuid), messages.slice(0, 3).map(message => message.aikobots_message_uuid));
});
