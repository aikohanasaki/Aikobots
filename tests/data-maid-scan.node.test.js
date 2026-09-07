import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setConfigFilePath } from '../src/util.js';

setConfigFilePath(fs.existsSync(path.resolve('config.yaml')) ? path.resolve('config.yaml') : path.resolve('../config.yaml'));
const { getUserDirectories } = await import('../src/users.js');
const { migrateFromJsonlRecords } = await import('../src/sqlite-manager.js');
const { advanceDataMaidScan, getDataMaidScanPaths, finalizeDataMaidScan } = await import('../src/data-maid-scan.js');
const { DataMaidService, router } = await import('../src/endpoints/data-maid.js');

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-maid-scan-'));
    const previousRoot = globalThis.DATA_ROOT;
    globalThis.DATA_ROOT = root;
    const handle = `scanner-${crypto.randomUUID()}`;
    const user = { profile: { handle }, directories: getUserDirectories(handle) };
    for (const directory of Object.values(user.directories)) fs.mkdirSync(directory, { recursive: true });
    return { user, restore() { globalThis.DATA_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); } };
}

async function request(routePath, user, body, targetRouter = router) {
    const handler = targetRouter.stack.find(layer => layer.route?.path === routePath).route.stack.at(-1).handle;
    const response = {
        statusCode: 200, payload: null,
        json(value) { this.payload = value; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
        status(code) { this.statusCode = code; return this; },
    };
    await handler({ user, body }, response);
    return response;
}

test('batches SQLite and UTF-8 JSONL once, continues on another worker, and preserves cleanup authorization', async () => {
    const { user, restore } = fixture();
    try {
        const directory = path.join(user.directories.chats, 'Bot');
        fs.mkdirSync(directory);
        const sqlitePath = path.join(directory, 'large.sqlite');
        const jsonlPath = path.join(directory, 'legacy.jsonl');
        const records = [
            { chat_metadata: { chat_backgrounds: ['user/images/background.png'], attachments: [{ url: 'user/files/header.txt' }] } },
            ...Array.from({ length: 1200 }, () => ({ mes: 'ordinary message text must not be persisted in scan state' })),
            { extra: { media: [{ url: 'user/images/current.png' }], files: [{ url: 'user/files/current.txt' }] },
                swipe_info: [{ extra: { image: 'user/images/swipe.png', file: { url: 'user/files/swipe.txt' } } }] },
        ];
        await migrateFromJsonlRecords(records.map(record => JSON.stringify(record)), sqlitePath);
        const legacyRecords = [{ chat_metadata: {} }, ...Array.from({ length: 1200 }, () => ({ mes: '日本語'.repeat(100) })),
            { mes: 'last record without newline', extra: { image: 'user/images/日本語.png' } }];
        fs.writeFileSync(jsonlPath, legacyRecords.map(record => JSON.stringify(record)).join('\r\n'));
        // A JSONL companion is stale and must not be scanned in addition to SQLite.
        fs.writeFileSync(path.join(directory, 'large.jsonl'), 'invalid companion');
        for (const name of ['background.png', 'current.png', 'swipe.png', '日本語.png', 'unused.png']) {
            fs.writeFileSync(path.join(user.directories.userImages, name), name);
        }
        for (const name of ['header.txt', 'current.txt', 'swipe.txt', 'unused.txt']) fs.writeFileSync(path.join(user.directories.files, name), name);
        const originalJsonl = fs.readFileSync(jsonlPath);
        const secondWorker = await import(`../src/endpoints/data-maid.js?worker=${Date.now()}`);
        let response = await request('/report', user, { batched: true });
        assert.equal(response.statusCode, 200);
        const token = response.payload.token;
        assert.equal(await getDataMaidScanPaths(user, token), null, 'partial scans cannot authorize deletion');
        let calls = 0;
        while (!response.payload.done && calls++ < 40) {
            response = await request('/report', user, { batched: true, token }, secondWorker.router);
            assert.equal(response.statusCode, 200);
        }
        assert.equal(response.payload.done, true);
        assert.ok(calls > 6, 'large chats span multiple requests');
        assert.deepEqual(response.payload.report.images.map(item => item.name), ['unused.png']);
        assert.deepEqual(response.payload.report.files.map(item => item.name), ['unused.txt']);
        assert.deepEqual(response.payload.unavailableCategories, []);
        const userKey = crypto.createHash('sha256').update(user.profile.handle).digest('hex');
        const state = fs.readFileSync(path.join(globalThis.DATA_ROOT, '_data-maid-scans', `${userKey}.json`), 'utf8');
        assert.ok(!state.includes('ordinary message text'));
        assert.ok(!state.includes('chat_metadata'));
        assert.deepEqual(fs.readFileSync(jsonlPath), originalJsonl);
        DataMaidService.TOKENS.clear();
        const deletion = await request('/delete', user, { token, hashes: [response.payload.report.files[0].hash] }, secondWorker.router);
        assert.equal(deletion.statusCode, 204);
        assert.equal(fs.existsSync(path.join(user.directories.files, 'unused.txt')), false);
        assert.equal(fs.existsSync(path.join(user.directories.files, 'current.txt')), true);
        await request('/finalize', user, { token }, secondWorker.router);
        assert.equal(await getDataMaidScanPaths(user, token), null);
        assert.equal((await request('/report', user, { batched: true, token })).statusCode, 409);
    } finally {
        restore();
    }
});

test('unreadable or changed chat references withhold media cleanup, including new chats', async () => {
    const { user, restore } = fixture();
    try {
        const chat = path.join(user.directories.groupChats, 'history.jsonl');
        const collect = async () => ({ paths: ['candidate'], report: [{ name: 'candidate' }] });
        const advance = token => advanceDataMaidScan(user, token, ['lorebooks', 'images', 'files'], collect, raw => raw.files || []);
        for (const failure of ['malformed', 'changed', 'new', 'split-tail']) {
            fs.writeFileSync(chat, failure === 'malformed' ? '{broken' : '{"chat_metadata":{}}\n{"mes":"original"}\n');
            if (failure === 'split-tail') fs.writeFileSync(chat, '{"chat_storage":{"mode":"split-tail"}}');
            let result = await advance();
            result = await advance(result.token);
            if (failure === 'changed') fs.appendFileSync(chat, '{"extra":{"file":{"url":"candidate"}}}\n');
            if (failure === 'new') fs.writeFileSync(path.join(user.directories.groupChats, 'new.jsonl'), '{"chat_metadata":{}}');
            for (let i = 0; !result.done && i < 10; i++) result = await advance(result.token);
            assert.equal(result.done, true);
            assert.ok(result.unavailableCategories.includes('images'));
            assert.ok(result.unavailableCategories.includes('files'));
            assert.deepEqual(result.report.images, []);
            assert.deepEqual(result.report.files, []);
            assert.deepEqual(await getDataMaidScanPaths(user, result.token), []);
        }
    } finally {
        restore();
    }
});

test('oversized records fail closed and preserve an existing unavailable-category warning', async () => {
    const { user, restore } = fixture();
    try {
        fs.writeFileSync(path.join(user.directories.groupChats, 'large.jsonl'), JSON.stringify({ mes: 'x'.repeat(16 * 1024 * 1024) }));
        const collect = async category => ({ paths: [], report: [], unavailable: category === 'lorebooks' });
        const advance = token => advanceDataMaidScan(user, token, ['lorebooks', 'images', 'files'], collect, () => []);
        let result = await advance();
        for (let i = 0; !result.done && i < 10; i++) result = await advance(result.token);
        assert.equal(result.done, true);
        assert.deepEqual(new Set(result.unavailableCategories), new Set(['lorebooks', 'images', 'files']));
    } finally {
        restore();
    }
});

test('session ownership, concurrent continuation, and cancellation cannot widen authorization', async () => {
    const { user, restore } = fixture();
    try {
        const collect = async () => ({ paths: [], report: [] });
        const advance = token => advanceDataMaidScan(user, token, ['lorebooks', 'images', 'files'], collect, () => []);
        const first = await advance();
        const responses = await Promise.all([advance(first.token), advance(first.token)]);
        assert.ok(responses.every(result => result.token === first.token));
        assert.equal(await getDataMaidScanPaths({ ...user, profile: { handle: 'other' } }, first.token), null);
        const second = await advance();
        await finalizeDataMaidScan(user, first.token);
        assert.ok(await advance(second.token));
        assert.equal(await advance(first.token), null);
        assert.equal(await advance('../invalid'), null);
        await finalizeDataMaidScan(user, second.token);
        assert.equal(await advance(second.token), null);
    } finally {
        restore();
    }
});

test('attachment settings changed before publication withhold file cleanup', async () => {
    const { user, restore } = fixture();
    try {
        const collect = async () => ({ paths: ['candidate'], report: [{ name: 'candidate' }] });
        const advance = token => advanceDataMaidScan(user, token, ['lorebooks', 'images', 'files'], collect, raw => raw.files || []);
        let result = await advance();
        for (let i = 0; result.progress.phase !== 'verify' && i < 10; i++) result = await advance(result.token);
        fs.writeFileSync(path.join(user.directories.root, 'settings.json'), '{"extension_settings":{"attachments":[{"url":"candidate"}]}}');
        result = await advance(result.token);
        assert.equal(result.done, true);
        assert.deepEqual(result.unavailableCategories, ['files']);
        assert.deepEqual(result.report.files, []);
        assert.deepEqual(await getDataMaidScanPaths(user, result.token), []);
    } finally {
        restore();
    }
});
