import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChatSortComparator } from '../public/scripts/chat-search.js';
import { loadDb, setMessages } from '../src/sqlite-manager.js';
import { setConfigFilePath } from '../src/util.js';

test('chat sorting compares names and exact numeric metadata in both directions', () => {
    const chats = [
        { file_name: 'zebra.sqlite', file_size: '1 KB', file_size_bytes: 1025, message_count: 2, last_mes: 200 },
        { file_name: 'Alpha.JSONL', file_size: '1 KB', file_size_bytes: 1024, message_count: 10, last_mes: 100 },
        { file_name: 'beta.sqlite', file_size: '2 KB', file_size_bytes: 2048, message_count: 0, last_mes: 300 },
    ];
    const expected = {
        file_name: ['Alpha.JSONL', 'beta.sqlite', 'zebra.sqlite'],
        file_size_bytes: ['Alpha.JSONL', 'zebra.sqlite', 'beta.sqlite'],
        message_count: ['beta.sqlite', 'zebra.sqlite', 'Alpha.JSONL'],
        last_mes: ['Alpha.JSONL', 'zebra.sqlite', 'beta.sqlite'],
    };
    for (const [field, names] of Object.entries(expected)) {
        for (const direction of ['asc', 'desc']) {
            assert.deepEqual([...chats].sort(createChatSortComparator(field, direction, 'en')).map(chat => chat.file_name),
                direction === 'asc' ? names : [...names].reverse());
        }
    }
    assert.equal(createChatSortComparator('file_name', 'asc', 'en')({ file_name: 'ALPHA.sqlite' }, { file_name: 'alpha.jsonl' }), 0);
    assert.deepEqual([...chats].sort(createChatSortComparator()).map(chat => chat.last_mes), [300, 200, 100]);
});

test('numeric ties use chat names and missing values stay last, including zero and invalid values', () => {
    for (const field of ['file_size_bytes', 'message_count', 'last_mes']) {
        const chats = [
            { file_name: 'missing-null', [field]: null },
            { file_name: 'beta', [field]: 0 },
            { file_name: 'missing-undefined' },
            { file_name: 'Alpha', [field]: 0 },
            { file_name: 'missing-nan', [field]: NaN },
            { file_name: 'missing-infinity', [field]: Infinity },
        ];
        for (const direction of ['asc', 'desc']) {
            assert.deepEqual([...chats].sort(createChatSortComparator(field, direction, 'en')).map(chat => chat.file_name),
                ['Alpha', 'beta', 'missing-infinity', 'missing-nan', 'missing-null', 'missing-undefined']);
        }
    }
});

test('regular, group and deleted chat responses expose exact bytes with and without search', async t => {
    setConfigFilePath(fs.existsSync(path.resolve('config.yaml')) ? path.resolve('config.yaml') : path.resolve('../config.yaml'));
    const { router, getChatSearchResult } = await import('../src/endpoints/chats.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manage-chats-sort-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directories = Object.fromEntries(['chats', 'groupChats', 'groups', 'characters'].map(key => [key, path.join(root, key)]));
    for (const directory of Object.values(directories)) fs.mkdirSync(directory);
    fs.mkdirSync(path.join(directories.chats, 'Deleted'));
    const direct = path.join(directories.chats, 'Deleted', 'sample.sqlite');
    const group = path.join(directories.groupChats, 'group-chat.sqlite');
    for (const file of [direct, group]) {
        const db = await loadDb(file);
        setMessages(db, [{ chat_metadata: {}, chat_revision: 1 }, { mes: 'synthetic needle', send_date: '2026-10-01T12:00:00Z' }]);
        db.close();
    }
    fs.writeFileSync(path.join(directories.groups, 'group.json'), JSON.stringify({ id: 'group', name: 'Synthetic group', members: ['Deleted.png'], chats: ['group-chat'] }));
    const sizes = [direct, group].map(file => fs.statSync(file).size);
    const invoke = async (route, body) => {
        let result;
        const response = {
            send: value => { result = value; },
            json: value => { result = value; },
            status: code => { assert.equal(code, 200); return response; },
        };
        await router.stack.find(layer => layer.route?.path === route).route.stack.at(-1).handle({ body, user: { directories } }, response);
        return result;
    };
    for (const query of ['', 'needle']) {
        for (const [body, expectedSize] of [[{ avatar_url: 'Deleted.png' }, sizes[0]], [{ group_id: 'group' }, sizes[1]]]) {
            const results = await invoke('/search', { ...body, query });
            assert.equal(results.length, 1);
            assert.equal(results[0].file_size_bytes, expectedSize);
            assert.equal(typeof results[0].file_size, 'string');
            assert.equal(results[0].message_count, 1);
        }
        const entries = await invoke('/orphaned', { query });
        assert.equal(entries.length, 1);
        assert.equal(entries[0].direct_chats[0].file_size_bytes, sizes[0]);
        assert.equal(entries[0].related_groups[0].chats[0].file_size_bytes, sizes[1]);
    }
    // The shared summary helper also supports legacy reads outside Manage Chats.
    const legacy = path.join(root, 'legacy.jsonl');
    fs.writeFileSync(legacy, '{"chat_metadata":{}}\n{"mes":"synthetic needle","send_date":1}\n');
    assert.equal((await getChatSearchResult({ path: legacy, file_name: 'legacy.jsonl', file_size: '1 KB' })).file_size_bytes, fs.statSync(legacy).size);
});

test('chat summaries use persisted last-message dates despite identical file modification times', async t => {
    setConfigFilePath(fs.existsSync(path.resolve('config.yaml')) ? path.resolve('config.yaml') : path.resolve('../config.yaml'));
    const { getChatInfo, getChatSearchResult } = await import('../src/endpoints/chats.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-summary-dates-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const fallback = Date.UTC(2026, 8, 16, 21, 26);
    const cases = [
        ['June 14, 2026 10:30am', new Date(2026, 5, 14, 10, 30).getTime()],
        ['July 7, 2026 6:38pm', new Date(2026, 6, 7, 18, 38).getTime()],
        ['July 7, 2026 12:00am', new Date(2026, 6, 7).getTime()],
        ['July 7, 2026 12:00pm', new Date(2026, 6, 7, 12).getTime()],
        ['2024-7-12@01h31m37s', Date.UTC(2024, 6, 12, 1, 31, 37)],
        ['2024-6-5 @14h 56m 50s 68ms', Date.UTC(2024, 5, 5, 14, 56, 50, 68)],
        ['2026-10-01T12:00:00Z', Date.UTC(2026, 9, 1, 12)],
        [1234, 1234],
        ['1234', 1234],
        [undefined, fallback],
        ['invalid', fallback],
    ];
    for (const [index, [send_date, expected]] of cases.entries()) {
        for (const extension of ['sqlite', 'jsonl']) {
            const file = path.join(root, `${index}.${extension}`);
            const records = [{ chat_metadata: {} }, { mes: 'synthetic needle', send_date }];
            if (extension === 'sqlite') {
                const db = await loadDb(file);
                setMessages(db, records);
                db.close();
            } else {
                fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
            }
            fs.utimesSync(file, fallback / 1000, fallback / 1000);
            for (const isGroup of [false, true]) {
                assert.equal((await getChatInfo(file, {}, isGroup)).last_mes, expected);
                for (const fragments of [[], ['needle']]) {
                    const result = await getChatSearchResult({ path: file, file_name: path.basename(file) }, fragments, { isGroup });
                    assert.equal(result.last_mes, expected);
                }
            }
        }
    }
});
