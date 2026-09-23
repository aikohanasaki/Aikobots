import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDb, setMessages } from '../src/sqlite-manager.js';
import { readChatMessageSearch } from '../src/chat-message-search.js';
import { compileScene, compiledSceneToText } from '../public/scripts/stmb-core.js';

/** Creates disposable ordinary chat data using the production SQLite writer. */
async function setup(t, messages) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-extract-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directories = { chats: root, groupChats: root };
    const chatRef = { type: 'group', chatId: 'sample' };
    const db = await loadDb(path.join(root, 'sample.sqlite'));
    setMessages(db, [{ chat_metadata: {}, chat_revision: 1 }, ...messages.map(message => ({ aikobots_message_uuid: randomUUID(), ...message }))]);
    db.close();
    return { root, directories, chatRef, request: (body, selected = false) => readChatMessageSearch(directories, { chatRef, ...body }, null, selected) };
}

test('server search pages hidden/current text only and reads exact selections without changing storage', async t => {
    const fixture = await setup(t, [
        { mes: 'İ'.repeat(600) + 'DRAGON.* 日本語', is_system: true },
        { name: 'dragon.*', mes: 'other', swipes: ['dragon.*'], extra: { note: 'dragon.*' } },
        { mes: 'dragon.* again' },
    ]);
    const before = fs.readFileSync(path.join(fixture.root, 'sample.sqlite'));
    const first = await fixture.request({ query: ' Dragon.* ', limit: 1 });
    assert.deepEqual(first.matches.map(item => item.index), [0]);
    assert.match(first.matches[0].preview, /DRAGON\.\*/);
    assert.ok(first.matches[0].preview.length < 350);
    assert.equal('mes' in first.matches[0], false);
    const second = await fixture.request({ query: 'dragon.*', revision: first.revision, cursor: first.nextCursor });
    assert.deepEqual(second.matches.map(item => item.index), [2]);
    assert.equal(second.nextCursor, null);
    assert.equal((await fixture.request({ query: 'dragon.*', hiddenOnly: true })).matches.length, 1);
    assert.equal((await fixture.request({ query: '日本語' })).matches.length, 1);
    const captured = await fixture.request({ revision: first.revision, messages: [...second.matches, ...first.matches, ...first.matches] }, true);
    assert.deepEqual(captured.messages.map(item => item.index), [0, 2]);
    assert.equal(captured.messages[0].is_system, true);
    assert.equal('extra' in captured.messages[0], false);
    assert.equal('swipes' in captured.messages[0], false);
    const neighbor = await fixture.request({ revision: first.revision, messages: first.matches, neighbor: 'after' }, true);
    assert.equal(neighbor.messages[0].mes, 'other');
    assert.equal((await fixture.request({ revision: first.revision, messages: first.matches, neighbor: 'before' }, true)).messages.length, 0);
    assert.deepEqual(fs.readFileSync(path.join(fixture.root, 'sample.sqlite')), before);
});

test('search bounds scanning and rejects stale pages, changed identities and invalid references', async t => {
    const fixture = await setup(t, Array.from({ length: 503 }, (_, index) => ({ mes: index === 502 ? 'needle' : 'ordinary' })));
    const first = await fixture.request({ query: 'needle' });
    assert.equal(first.scanned, 500);
    assert.equal(first.matches.length, 0);
    const second = await fixture.request({ query: 'needle', cursor: first.nextCursor, revision: first.revision });
    assert.equal(second.matches[0].index, 502);
    const db = await loadDb(path.join(fixture.root, 'sample.sqlite'));
    db.database.prepare('UPDATE messages SET content = ? WHERE order_index = 0').run(JSON.stringify({ chat_revision: 2 }));
    db.close();
    await assert.rejects(fixture.request({ query: 'needle', cursor: first.nextCursor, revision: first.revision }), { status: 409 });
    await assert.rejects(fixture.request({ messages: second.matches, revision: first.revision }, true), { status: 409 });
    const fresh = await fixture.request({ query: 'needle' , cursor: null });
    const page = await fixture.request({ query: 'needle', cursor: fresh.nextCursor, revision: fresh.revision });
    await assert.rejects(fixture.request({ messages: [{ ...page.matches[0], uuid: randomUUID() }], revision: fresh.revision }, true), { status: 409 });
    await assert.rejects(fixture.request({ query: '' }), { status: 400 });
    await assert.rejects(fixture.request({ query: 'needle', limit: 51 }), { status: 400 });
    await assert.rejects(fixture.request({ chatRef: { type: 'group', chatId: '../outside' }, query: 'needle' }));
    await assert.rejects(fixture.request({ chatRef: { type: 'group', chatId: 'missing' }, query: 'needle' }), { status: 404 });
});

test('legacy search uses fingerprint-bound indices without assigning identities', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-extract-legacy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'legacy.jsonl'), '{}\n');
    const messages = [{ mes: 'needle', is_system: true }, { mes: 'next' }];
    const request = (body, selected = false) => readChatMessageSearch({ groupChats: root }, { chatRef: { type: 'group', chatId: 'legacy' }, ...body }, async () => ({ messages, storageHealthy: true }), selected);
    const found = await request({ query: 'needle' });
    assert.equal(found.matches[0].uuid, '');
    assert.equal((await request({ revision: found.revision, messages: found.matches }, true)).messages[0].mes, 'needle');
    assert.equal('aikobots_message_uuid' in messages[0], false);
    messages[0].mes = 'edited';
    await assert.rejects(request({ revision: found.revision, messages: found.matches }, true), { status: 409 });
});

test('read-only database opens cannot recreate deleted chats or mutate existing messages', async t => {
    const fixture = await setup(t, [{ mes: 'ordinary' }]);
    const db = await loadDb(path.join(fixture.root, 'sample.sqlite'), { readonly: true });
    try {
        assert.throws(() => db.run('DELETE FROM messages'), /readonly/i);
    } finally { db.close(); }
    const missing = path.join(fixture.root, 'missing.sqlite');
    await assert.rejects(loadDb(missing, { readonly: true }));
    assert.equal(fs.existsSync(missing), false);
});

test('explicit scene selection preserves hidden sources, numbering and chronology without filling gaps', () => {
    const messages = [{ mes: 'first', is_system: true }, { mes: 'not selected' }, { mes: 'last' }];
    const before = structuredClone(messages);
    const scene = compileScene(messages, { sceneStart: 0, sceneEnd: 2 }, { messageIndices: [2, 0, 2], skipSystemMessages: false });
    assert.deepEqual(scene.messages.map(message => message.id), [0, 2]);
    assert.match(compiledSceneToText(scene), /Selected messages \(may be noncontiguous\): 0, 2/);
    assert.doesNotMatch(compiledSceneToText(scene), /not selected|Range:/);
    assert.deepEqual(messages, before);
    assert.deepEqual(compileScene(messages, { sceneStart: 0, sceneEnd: 2 }).messages.map(message => message.id), [1, 2]);
    assert.throws(() => compileScene(messages, { sceneStart: 0, sceneEnd: 2 }, { messageIndices: [3] }));
});
