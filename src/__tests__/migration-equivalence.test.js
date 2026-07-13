import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    migrateFromJsonlRecords,
    verifyJsonlRecordsMatchSqlite,
} from '../sqlite-manager.js';

const temporaryDirectories = [];

function makeRecords() {
    return [
        JSON.stringify({ user_name: 'User', character_name: 'Character', chat_metadata: { scenario: 'test' } }),
        JSON.stringify({ aikobots_message_uuid: 'message-1', name: 'User', is_user: true, mes: 'private first' }),
        JSON.stringify({
            aikobots_message_uuid: 'message-2',
            name: 'Character',
            is_user: false,
            mes: 'private selected',
            swipe_id: 1,
            swipes: ['private alternate', 'private selected'],
            swipe_info: [{ aikobots_swipe_uuid: 'swipe-1' }, { aikobots_swipe_uuid: 'swipe-2' }],
        }),
    ];
}

async function makeSqlite(records = makeRecords()) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-migration-equivalence-'));
    temporaryDirectories.push(directory);
    const sqlitePath = path.join(directory, 'chat.sqlite');
    await migrateFromJsonlRecords(records, sqlitePath);
    return sqlitePath;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('JSONL migration equivalence', () => {
    it('accepts equivalent structured records despite object key order', async () => {
        const records = makeRecords();
        const sqlitePath = await makeSqlite(records);
        const reordered = records.map(line => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(line)).reverse())));

        await expect(verifyJsonlRecordsMatchSqlite(reordered, sqlitePath)).resolves.toBeUndefined();
    });

    it.each([
        ['message content', records => { records[1].mes = 'different'; }],
        ['message order', records => { [records[1], records[2]] = [records[2], records[1]]; }],
        ['speaker metadata', records => { records[1].name = 'Different'; }],
        ['role metadata', records => { records[1].is_user = false; }],
        ['swipe count', records => { records[2].swipes.pop(); }],
        ['swipe content', records => { records[2].swipes[0] = 'different'; }],
        ['selected swipe', records => { records[2].swipe_id = 0; }],
        ['swipe metadata', records => { records[2].swipe_info[0].aikobots_swipe_uuid = 'different'; }],
    ])('rejects different %s without disclosing values', async (_label, mutate) => {
        const sqlitePath = await makeSqlite();
        const values = makeRecords().map(line => JSON.parse(line));
        mutate(values);

        await expect(verifyJsonlRecordsMatchSqlite(values.map(JSON.stringify), sqlitePath)).rejects.toMatchObject({
            category: 'message_content_mismatch',
            message: 'SQLite migration equivalence check failed: message_content_mismatch',
        });
    });

    it('rejects a different logical message count', async () => {
        const sqlitePath = await makeSqlite();
        await expect(verifyJsonlRecordsMatchSqlite(makeRecords().slice(0, 2), sqlitePath)).rejects.toMatchObject({
            category: 'message_count_mismatch',
        });
    });

    it('leaves the JSONL source byte-for-byte unchanged after verification failure', async () => {
        const sqlitePath = await makeSqlite();
        const jsonlPath = path.join(path.dirname(sqlitePath), 'chat.jsonl');
        const sourceBytes = Buffer.from(`${makeRecords().join('\r\n')}\r\n`, 'utf8');
        fs.writeFileSync(jsonlPath, sourceBytes);
        const divergentRecords = makeRecords();
        divergentRecords[1] = JSON.stringify({ ...JSON.parse(divergentRecords[1]), mes: 'different' });

        await expect(verifyJsonlRecordsMatchSqlite(divergentRecords, sqlitePath)).rejects.toMatchObject({
            category: 'message_content_mismatch',
        });
        expect(fs.readFileSync(jsonlPath)).toEqual(sourceBytes);
    });
});
