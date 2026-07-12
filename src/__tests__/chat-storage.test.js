import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

let applyLoadedMessageRange;
let backupSqliteDatabaseFile;
let appendSqliteMessage;
let buildChunkedChatPayload;
let calculateStats;
let cloneSqliteMessageAfter;
let compileScene;
let deleteSqliteMessageByUuid;
let deleteChatStorageCompanions;
let exportDatabaseFile;
let getLogicalChatData;
let getNewChatTargetConflict;
let getChatSearchResult;
let hasValidGroupChatPayload;
let insertLogicalMessageAfter;
let loadDb;
let migrateChatHeaderReferences;
let resolveSqliteLogicalChatReference;
let truncateSqliteChatAfterUuid;
let updateSqliteLoadedMessageRange;
let updateSqliteMessageByUuid;
let updateGroupChatMessageRow;
let updateSqliteMessageVisibility;
let updateSqliteParticipantHistory;
let updateSqliteUserPersonaMessages;
let validateMessageSwipeState;
let writeLogicalChat;
let withChatSaveLock;

function getConfigPath() {
    const localPath = path.resolve(process.cwd(), 'config.yaml');
    if (fs.existsSync(localPath)) {
        return localPath;
    }

    return path.resolve(process.cwd(), '..', 'config.yaml');
}

function makeHeader(overrides = {}) {
    return {
        user_name: 'User',
        character_name: 'Character',
        create_date: '2026-04-20',
        chat_metadata: {},
        ...overrides,
    };
}

function makeMessages(count) {
    return Array.from({ length: count }, (_, index) => ({
        aikobots_message_uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: index % 2 === 0 ? 'User' : 'Character',
        is_user: index % 2 === 0,
        mes: `message ${index}`,
        send_date: index,
    }));
}

function makeMultiSwipeAssistant() {
    return {
        aikobots_message_uuid: '11111111-1111-4111-8111-111111111111',
        name: 'Character',
        is_user: false,
        mes: 'selected text',
        swipe_id: 1,
        swipes: ['other text', 'selected text'],
        send_date: 'June 14, 2026 10:30am',
        gen_started: '2026-06-14T17:30:40.886Z',
        gen_finished: '2026-06-14T17:31:00.052Z',
        extra: { model: 'test-model', bias: null },
        swipe_info: [
            {
                aikobots_swipe_uuid: '22222222-2222-4222-8222-222222222222',
                send_date: 'June 14, 2026 10:29am',
                gen_started: '2026-06-14T17:29:46.906Z',
                gen_finished: '2026-06-14T17:30:03.746Z',
                extra: { model: 'test-model' },
            },
            {
                aikobots_swipe_uuid: '33333333-3333-4333-8333-333333333333',
                send_date: 'June 14, 2026 10:30am',
                gen_started: '2026-06-14T17:30:40.886Z',
                gen_finished: '2026-06-14T17:31:00.052Z',
                extra: { model: 'test-model' },
            },
        ],
    };
}

function getSqliteRows(chatPath) {
    const sqlitePath = String(chatPath).replace(/\.(?:jsonl|sqlite)$/i, '.sqlite');
    const db = new Database(sqlitePath, { readonly: true });
    try {
        return db.prepare('SELECT content FROM messages ORDER BY order_index ASC')
            .pluck()
            .all()
            .map(content => JSON.parse(content));
    } finally {
        db.close();
    }
}

function stripSqliteMessageUuids(chatPath) {
    const sqlitePath = String(chatPath).replace(/\.(?:jsonl|sqlite)$/i, '.sqlite');
    const db = new Database(sqlitePath);
    try {
        const rows = db.prepare('SELECT id, content FROM messages WHERE order_index > 0 ORDER BY order_index ASC').all();
        const stmt = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
        const update = db.transaction(() => {
            for (const row of rows) {
                const message = JSON.parse(row.content);
                delete message.aikobots_message_uuid;
                stmt.run(JSON.stringify(message), row.id);
            }
            db.prepare('DELETE FROM metadata WHERE key = \'identity_scan_version\'').run();
        });
        update();
    } finally {
        db.close();
    }
}

function mutateSqliteMessage(chatPath, logicalIndex, mutate) {
    const sqlitePath = String(chatPath).replace(/\.(?:jsonl|sqlite)$/i, '.sqlite');
    const db = new Database(sqlitePath);
    try {
        const row = db.prepare('SELECT id, content FROM messages WHERE order_index = ?').get(logicalIndex + 1);
        const message = JSON.parse(row.content);
        mutate(message);
        db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(JSON.stringify(message), row.id);
    } finally {
        db.close();
    }
}

describe('SQLite chat length handling', () => {
    beforeAll(async () => {
        const utilModule = await import('../util.js');
        utilModule.setConfigFilePath(getConfigPath());

        const chatsModule = await import('../endpoints/chats.js');
        const identityModule = await import('../../public/scripts/chat-identities.js');
        const sqliteModule = await import('../sqlite-manager.js');
        const statsModule = await import('../endpoints/stats.js');
        const lorebookModule = await import('../lorebook-repository.js');
        const chatStorageModule = await import('../chat-storage.js');
        const stmbCoreModule = await import('../../public/scripts/stmb-core.js');
        applyLoadedMessageRange = chatsModule.applyLoadedMessageRange;
        backupSqliteDatabaseFile = chatStorageModule.backupSqliteDatabaseFile;
        deleteChatStorageCompanions = chatStorageModule.deleteChatStorageCompanions;
        getNewChatTargetConflict = chatStorageModule.getNewChatTargetConflict;
        withChatSaveLock = chatStorageModule.withChatSaveLock;
        appendSqliteMessage = chatsModule.appendSqliteMessage;
        buildChunkedChatPayload = chatsModule.buildChunkedChatPayload;
        calculateStats = statsModule.calculateStats;
        cloneSqliteMessageAfter = chatsModule.cloneSqliteMessageAfter;
        compileScene = stmbCoreModule.compileScene;
        deleteSqliteMessageByUuid = chatsModule.deleteSqliteMessageByUuid;
        exportDatabaseFile = sqliteModule.exportDatabaseFile;
        getLogicalChatData = chatsModule.getLogicalChatData;
        getChatSearchResult = chatsModule.getChatSearchResult;
        hasValidGroupChatPayload = chatsModule.hasValidGroupChatPayload;
        resolveSqliteLogicalChatReference = chatsModule.resolveSqliteLogicalChatReference;
        truncateSqliteChatAfterUuid = chatsModule.truncateSqliteChatAfterUuid;
        updateSqliteLoadedMessageRange = chatsModule.updateSqliteLoadedMessageRange;
        updateSqliteMessageByUuid = chatsModule.updateSqliteMessageByUuid;
        updateGroupChatMessageRow = chatsModule.updateGroupChatMessageRow;
        updateSqliteMessageVisibility = chatsModule.updateSqliteMessageVisibility;
        updateSqliteParticipantHistory = chatsModule.updateSqliteParticipantHistory;
        updateSqliteUserPersonaMessages = chatsModule.updateSqliteUserPersonaMessages;
        validateMessageSwipeState = identityModule.validateMessageSwipeState;
        insertLogicalMessageAfter = sqliteModule.insertLogicalMessageAfter;
        loadDb = sqliteModule.loadDb;
        migrateChatHeaderReferences = lorebookModule.migrateChatHeaderReferences;
        writeLogicalChat = chatsModule.writeLogicalChat;
    });

    it('classifies save-prefix targets without changing an existing chat', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-prefix-target-'));
        const sourcePath = path.join(tempDir, 'source.sqlite');
        const targetPath = path.join(tempDir, 'target.jsonl');
        const originalTarget = '{"header":"unchanged"}\n{"mes":"unchanged","swipes":["also unchanged"]}\n';
        try {
            fs.writeFileSync(targetPath, originalTarget);

            expect(getNewChatTargetConflict(sourcePath, path.join(tempDir, 'new.sqlite'))).toBeNull();
            expect(getNewChatTargetConflict(sourcePath, targetPath)).toBe('target_chat_exists');
            expect(getNewChatTargetConflict(sourcePath, sourcePath)).toBe('source_target_collision');
            expect(fs.readFileSync(targetPath, 'utf8')).toBe(originalTarget);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('upgrades legacy SQLite chats with an indexed message UUID column', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-native-upgrade-'));
        const sqlitePath = path.join(tempDir, 'chat.sqlite');

        try {
            const legacyDb = new Database(sqlitePath);
            legacyDb.exec(`
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, order_index REAL, content TEXT);
                CREATE INDEX idx_messages_order_index ON messages(order_index);
            `);
            legacyDb.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('storage_version', '20260530');
            legacyDb.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)').run(0, JSON.stringify(makeHeader()));
            const message = makeMessages(1)[0];
            legacyDb.prepare('INSERT INTO messages (order_index, content) VALUES (?, ?)').run(1, JSON.stringify(message));
            legacyDb.close();

            const upgradedDb = await loadDb(sqlitePath);
            upgradedDb.close();

            const verifyDb = new Database(sqlitePath, { readonly: true });
            const columns = verifyDb.pragma('table_info(messages)');
            const storedUuid = verifyDb.prepare('SELECT message_uuid FROM messages WHERE order_index = 1').pluck().get();
            const storageVersion = verifyDb.prepare('SELECT value FROM metadata WHERE key = \'storage_version\'').pluck().get();
            const hasOperationReceipts = Boolean(verifyDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'operation_receipts'").pluck().get());
            const queryPlan = verifyDb.prepare('EXPLAIN QUERY PLAN SELECT id FROM messages WHERE message_uuid = ?')
                .get(message.aikobots_message_uuid);
            verifyDb.close();

            expect(columns.some(column => column.name === 'message_uuid')).toBe(true);
            expect(storedUuid).toBe(message.aikobots_message_uuid);
            expect(storageVersion).toBe('20260711.1');
            expect(hasOperationReceipts).toBe(true);
            expect(queryPlan.detail).toContain('idx_messages_message_uuid');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('exports committed WAL state as a standalone SQLite image', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-native-export-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const sqlitePath = path.join(tempDir, 'chat.sqlite');
        const exportedPath = path.join(tempDir, 'exported.sqlite');
        let openDb = null;

        try {
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, makeHeader(), messages);

            openDb = await loadDb(sqlitePath);
            openDb.run('BEGIN TRANSACTION');
            openDb.run('UPDATE messages SET content = ? WHERE order_index = 2', [
                JSON.stringify({ ...messages[1], mes: 'committed in WAL' }),
            ]);
            openDb.run('COMMIT');

            const exported = await exportDatabaseFile(sqlitePath);
            fs.writeFileSync(exportedPath, exported);
            const verifyDb = new Database(exportedPath, { readonly: true });
            const content = verifyDb.prepare('SELECT content FROM messages WHERE order_index = 2').pluck().get();
            verifyDb.close();
            openDb.close();

            expect(JSON.parse(content).mes).toBe('committed in WAL');
        } finally {
            openDb?.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('creates a consistent atomic SQLite lifecycle snapshot', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-lifecycle-snapshot-'));
        const sourcePath = path.join(tempDir, 'source.sqlite');
        const targetPath = path.join(tempDir, 'target.sqlite');
        let writerDb;
        try {
            await writeLogicalChat(sourcePath, makeHeader(), makeMessages(8));
            writerDb = new Database(sourcePath);
            writerDb.pragma('journal_mode = WAL');
            writerDb.pragma('wal_autocheckpoint = 0');
            const walMessage = { ...makeMessages(1)[0], aikobots_message_uuid: '99999999-9999-4999-8999-999999999999', mes: 'committed WAL row' };
            writerDb.prepare('INSERT INTO messages (order_index, content, message_uuid) VALUES (?, ?, ?)')
                .run(9, JSON.stringify(walMessage), walMessage.aikobots_message_uuid);
            await backupSqliteDatabaseFile(sourcePath, targetPath);
            const targetDb = new Database(targetPath, { readonly: true });
            expect(targetDb.pragma('integrity_check', { simple: true })).toBe('ok');
            expect(targetDb.prepare('SELECT COUNT(*) FROM messages').pluck().get()).toBe(10);
            targetDb.close();
            writerDb.close();
            writerDb = null;
            expect(fs.readdirSync(tempDir).some(file => file.startsWith('target.sqlite.') && file.endsWith('.tmp'))).toBe(false);
        } finally {
            writerDb?.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('deletes every chat storage companion under the shared lock', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-companion-delete-'));
        const chatPath = path.join(tempDir, 'chat.sqlite');
        const companionPaths = [chatPath, chatPath.replace('.sqlite', '.jsonl'), `${chatPath}-wal`, `${chatPath}-shm`];
        try {
            for (const companionPath of companionPaths) {
                fs.writeFileSync(companionPath, 'test');
            }
            await withChatSaveLock(chatPath, async () => deleteChatStorageCompanions(chatPath));
            expect(companionPaths.every(companionPath => !fs.existsSync(companionPath))).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('accepts only dense group chat message payloads', () => {
        const densePayload = makeMessages(3);
        const sparsePayload = [];
        sparsePayload.length = 3;
        sparsePayload[0] = densePayload[0];
        sparsePayload[2] = densePayload[2];

        expect(hasValidGroupChatPayload(densePayload)).toBe(true);
        expect(hasValidGroupChatPayload([])).toBe(true);
        expect(hasValidGroupChatPayload(sparsePayload)).toBe(false);
        expect(hasValidGroupChatPayload([densePayload[0], undefined])).toBe(false);
        expect(hasValidGroupChatPayload([densePayload[0], null])).toBe(false);
        expect(hasValidGroupChatPayload([densePayload[0], []])).toBe(false);
        expect(hasValidGroupChatPayload({ 0: densePayload[0], length: 1 })).toBe(false);
    });

    it('uses display count as the initial latest-message window only', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-display-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(1000));

            const payload = await buildChunkedChatPayload(chatPath, {
                displayCount: 123,
            });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(logicalChat).toHaveLength(1001);
            expect(payload.mode).toBe('full');
            expect(payload.totalMessages).toBe(1000);
            expect(payload.loadedRangeStart).toBe(877);
            expect(payload.loadedRangeEnd).toBe(999);
            expect(payload.messages).toHaveLength(123);
            expect(payload.messages[0].mes).toBe('message 877');
            expect(payload.messages.at(-1).mes).toBe('message 999');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('preserves dotted chat names when resolving SQLite storage paths', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-dotted-name-'));
        const chatPath = path.join(tempDir, 'foo.jsonl.sqlite');
        const incorrectPath = path.join(tempDir, 'foo.sqlite.sqlite');

        try {
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(3));
            const logicalChat = await getLogicalChatData(chatPath);

            expect(fs.existsSync(chatPath)).toBe(true);
            expect(fs.existsSync(incorrectPath)).toBe(false);
            expect(logicalChat).toHaveLength(4);
            expect(logicalChat[1].mes).toBe('message 0');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('clamps initial display count below the supported minimum', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-display-min-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(100));

            const payload = await buildChunkedChatPayload(chatPath, {
                displayCount: 1,
            });

            expect(payload.totalMessages).toBe(100);
            expect(payload.loadedRangeStart).toBe(75);
            expect(payload.loadedRangeEnd).toBe(99);
            expect(payload.messages).toHaveLength(25);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('uses explicit range and count for internal chunked reads', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-range-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(1000));

            const payload = await buildChunkedChatPayload(chatPath, {
                rangeStart: 400,
                count: 200,
                displayCount: 50,
            });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(logicalChat).toHaveLength(1001);
            expect(payload.mode).toBe('full');
            expect(payload.totalMessages).toBe(1000);
            expect(payload.loadedRangeStart).toBe(400);
            expect(payload.loadedRangeEnd).toBe(599);
            expect(payload.messages).toHaveLength(200);
            expect(payload.messages[0].mes).toBe('message 400');
            expect(payload.messages.at(-1).mes).toBe('message 599');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('uses the latest absolute tail window for large SQLite chats', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-large-tail-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(7353));

            const payload = await buildChunkedChatPayload(chatPath, {
                count: 1000,
                displayCount: 100,
            });

            expect(payload.totalMessages).toBe(7353);
            expect(payload.loadedRangeStart).toBe(6353);
            expect(payload.loadedRangeEnd).toBe(7352);
            expect(payload.messages).toHaveLength(1000);
            expect(payload.messages[0].mes).toBe('message 6353');
            expect(payload.messages.at(-1).mes).toBe('message 7352');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('resolves SQLite chat range metadata without loading the full chat', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-stmb-range-info-'));
        const chatsDir = path.join(tempDir, 'chats');
        const groupChatsDir = path.join(tempDir, 'group chats');
        const chatPath = path.join(chatsDir, 'avatar', 'chat.jsonl');

        try {
            fs.mkdirSync(path.dirname(chatPath), { recursive: true });
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(1000));

            const chatState = await resolveSqliteLogicalChatReference({
                chats: chatsDir,
                groupChats: groupChatsDir,
            }, {
                type: 'character',
                avatarUrl: 'avatar.png',
                fileName: 'chat',
            });

            expect(chatState.sqliteMissing).toBe(false);
            expect(chatState.totalMessages).toBe(1000);
            expect(chatState.lastAvailableMessageId).toBe(999);
            expect(chatState.messages).toHaveLength(0);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('loads only the requested SQLite range into sparse logical positions', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-stmb-range-capture-'));
        const chatsDir = path.join(tempDir, 'chats');
        const groupChatsDir = path.join(tempDir, 'group chats');
        const chatPath = path.join(chatsDir, 'avatar', 'chat.jsonl');

        try {
            fs.mkdirSync(path.dirname(chatPath), { recursive: true });
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(1000));

            const chatState = await resolveSqliteLogicalChatReference({
                chats: chatsDir,
                groupChats: groupChatsDir,
            }, {
                type: 'character',
                avatarUrl: 'avatar.png',
                fileName: 'chat',
            }, {
                rangeStart: 901,
                rangeEnd: 999,
                includeMessages: true,
            });

            expect(chatState.totalMessages).toBe(1000);
            expect(chatState.messages).toHaveLength(1000);
            expect(chatState.messages[900]).toBeUndefined();
            expect(chatState.messages[901].mes).toBe('message 901');
            expect(chatState.messages[999].mes).toBe('message 999');
            expect(chatState.missingRanges).toEqual([]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('compiles an unloaded SQLite range from sparse logical storage reads', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-stmb-range-compile-'));
        const chatsDir = path.join(tempDir, 'chats');
        const groupChatsDir = path.join(tempDir, 'group chats');
        const chatPath = path.join(chatsDir, 'avatar', 'chat.jsonl');

        try {
            fs.mkdirSync(path.dirname(chatPath), { recursive: true });
            await writeLogicalChat(chatPath, makeHeader(), makeMessages(1000));

            const chatState = await resolveSqliteLogicalChatReference({
                chats: chatsDir,
                groupChats: groupChatsDir,
            }, {
                type: 'character',
                avatarUrl: 'avatar.png',
                fileName: 'chat',
            }, {
                rangeStart: 901,
                rangeEnd: 999,
                includeMessages: true,
            });
            const compiledScene = compileScene(chatState.messages, {
                sceneStart: 901,
                sceneEnd: 999,
                chatId: 'chat',
                characterName: 'Character',
                userName: 'User',
            });

            expect(compiledScene.metadata.sceneStart).toBe(901);
            expect(compiledScene.metadata.sceneEnd).toBe(999);
            expect(compiledScene.metadata.totalChatLength).toBe(1000);
            expect(compiledScene.messages[0].id).toBe(901);
            expect(compiledScene.messages.at(-1).id).toBe(999);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('searches SQLite substrings across the filename and different message rows', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-search-'));
        const chatPath = path.join(tempDir, 'Dragon Tale.sqlite');
        try {
            const messages = makeMessages(3);
            messages[0].mes = 'First café clue';
            messages[2].mes = 'Final treasure';
            await writeLogicalChat(chatPath, makeHeader(), messages);
            const chatFile = { path: chatPath, file_name: 'Dragon Tale.sqlite', file_size: '1kb' };

            await expect(getChatSearchResult(chatFile, ['dragon', 'CAFÉ', 'treasure'].map(value => value.toLowerCase())))
                .resolves.toMatchObject({ file_name: 'Dragon Tale.sqlite', message_count: 3, preview_message: 'Final treasure' });
            await expect(getChatSearchResult(chatFile, ['missing'])).resolves.toBeNull();
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('calculates equivalent message statistics from SQLite and legacy JSONL chats', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-stats-'));
        const sqliteDir = path.join(tempDir, 'SqliteBot');
        const jsonlDir = path.join(tempDir, 'JsonlBot');
        fs.mkdirSync(sqliteDir);
        fs.mkdirSync(jsonlDir);
        try {
            const messages = makeMessages(3).map((message, index) => ({
                ...message,
                mes: `stats message ${index}`,
                send_date: `July ${index + 1}, 2026 1:00pm`,
            }));
            await writeLogicalChat(path.join(sqliteDir, 'chat.sqlite'), makeHeader(), messages);
            fs.writeFileSync(path.join(sqliteDir, 'chat.jsonl'), 'legacy duplicate that must not be counted');
            fs.writeFileSync(path.join(jsonlDir, 'chat.jsonl'), [makeHeader(), ...messages].map(value => JSON.stringify(value)).join('\n'));

            const sqliteStats = (await calculateStats(tempDir, 'SqliteBot.png'))['SqliteBot.png'];
            const jsonlStats = (await calculateStats(tempDir, 'JsonlBot.png'))['JsonlBot.png'];
            for (const key of ['total_gen_time', 'user_word_count', 'non_user_word_count', 'user_msg_count', 'non_user_msg_count', 'total_swipe_count', 'date_first_chat']) {
                expect(sqliteStats[key]).toBe(jsonlStats[key]);
            }
            expect(sqliteStats.chat_size).toBe(fs.statSync(path.join(sqliteDir, 'chat.sqlite')).size);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('preserves group avatar identity and participant filters in SQLite range capture', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-stmb-group-capture-'));
        const chatsDir = path.join(tempDir, 'chats');
        const groupChatsDir = path.join(tempDir, 'group chats');
        const chatPath = path.join(groupChatsDir, 'group.jsonl');

        try {
            fs.mkdirSync(groupChatsDir, { recursive: true });
            await writeLogicalChat(chatPath, {
                is_group_chat_header: true,
                group_chat_header_version: 1,
                create_date: '2026-07-09',
                chat_metadata: {},
            }, [
                { ...makeMessages(1)[0], name: 'Alice', is_user: false, original_avatar: 'alice.png' },
                { ...makeMessages(2)[1], name: 'Bob', is_user: false, original_avatar: 'bob.webp' },
            ]);

            const chatState = await resolveSqliteLogicalChatReference({
                chats: chatsDir,
                groupChats: groupChatsDir,
            }, {
                type: 'group',
                chatId: 'group',
            }, {
                rangeStart: 0,
                rangeEnd: 1,
                includeMessages: true,
            });
            const compiledScene = compileScene(chatState.messages, {
                sceneStart: 0,
                sceneEnd: 1,
                groupName: 'Party',
            }, {
                groupParticipants: [
                    { key: 'alice.png', avatar: 'alice.png', name: 'Alice' },
                    { key: 'bob.webp', avatar: 'bob.webp', name: 'Bob' },
                ],
            });

            expect(compiledScene.messages.map(message => message.original_avatar)).toEqual(['alice.png', 'bob.webp']);
            expect(compiledScene.metadata.characterFilterNames).toEqual(['alice', 'bob']);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('reports missing SQLite storage without falling back to JSONL', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-stmb-missing-'));
        const chatsDir = path.join(tempDir, 'chats');
        const groupChatsDir = path.join(tempDir, 'group chats');
        const jsonlPath = path.join(chatsDir, 'avatar', 'chat.jsonl');

        try {
            fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
            fs.writeFileSync(jsonlPath, [makeHeader(), ...makeMessages(3)].map(record => JSON.stringify(record)).join('\n'), 'utf8');

            const chatState = await resolveSqliteLogicalChatReference({
                chats: chatsDir,
                groupChats: groupChatsDir,
            }, {
                type: 'character',
                avatarUrl: 'avatar.png',
                fileName: 'chat',
            });

            expect(chatState.sqliteMissing).toBe(true);
            expect(chatState.totalMessages).toBe(0);
            expect(chatState.lastAvailableMessageId).toBe(-1);
            expect(chatState.messages).toEqual([]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('preserves existing suffix data when applying a loaded range', () => {
        const existing = [makeHeader(), ...makeMessages(1000)];
        const rangeMessages = existing.slice(101, 151).map((message, index) => ({
            ...message,
            mes: `updated ${100 + index}`,
        }));

        const result = applyLoadedMessageRange(existing, 100, rangeMessages, 149);

        expect(result.ok).toBe(true);
        expect(result.chatData).toHaveLength(1001);
        expect(result.chatData[101].mes).toBe('updated 100');
        expect(result.chatData[150].mes).toBe('updated 149');
        expect(result.chatData[151].mes).toBe('message 150');
        expect(result.chatData.at(-1).mes).toBe('message 999');
    });

    it('rejects a stale loaded range that extends beyond the server tail', () => {
        const existing = [makeHeader(), ...makeMessages(100)];
        const rangeMessages = Array.from({ length: 20 }, (_, index) => ({
            ...makeMessages(110)[90 + index],
            mes: `stale duplicate ${90 + index}`,
        }));

        const result = applyLoadedMessageRange(existing, 90, rangeMessages, 109);

        expect(result.ok).toBe(false);
        expect(result.error).toBe('loaded_range_exceeds_tail');
    });

    it('rejects a loaded range when submitted UUID continuity does not match server state', () => {
        const existing = [makeHeader(), ...makeMessages(100)];
        const rangeMessages = makeMessages(5).map((message, index) => ({
            ...message,
            aikobots_message_uuid: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
            mes: `wrong message ${index}`,
        }));

        const result = applyLoadedMessageRange(existing, 10, rangeMessages, 14);

        expect(result.ok).toBe(false);
        expect(result.error).toBe('loaded_range_identity_mismatch');
    });

    it('rejects ordinary full replacement of an existing SQLite chat before deleting rows', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-full-replace-reject-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 5061 });
            await writeLogicalChat(chatPath, header, makeMessages(3900));

            const greeting = {
                aikobots_message_uuid: '11111111-1111-4111-8111-111111111111',
                name: 'Character',
                is_user: false,
                mes: 'starter greeting',
                send_date: 'July 7, 2026 6:38pm',
            };

            await expect(writeLogicalChat(chatPath, makeHeader({ chat_revision: 5063 }), [greeting], {
                routeName: '/api/chats/save',
                operationType: 'ordinary_full_replace',
                requestBody: {
                    base_revision: 5061,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    full_chat: true,
                },
            })).rejects.toMatchObject({ error: 'sqlite_full_replacement_forbidden' });

            const rows = getSqliteRows(chatPath);
            expect(rows).toHaveLength(3901);
            expect(rows[0].chat_revision).toBe(5061);
            expect(rows[1].mes).toBe('message 0');
            expect(rows.at(-1).mes).toBe('message 3899');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects sparse tail payloads mislabeled as full SQLite chats', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-sparse-full-reject-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 12 });
            const messages = makeMessages(3900);
            await writeLogicalChat(chatPath, header, messages);

            const submittedTail = messages.slice(3875);
            await expect(writeLogicalChat(chatPath, makeHeader({ chat_revision: 13 }), submittedTail, {
                routeName: '/api/chats/save',
                operationType: 'ordinary_full_replace',
                requestBody: {
                    base_revision: 12,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    full_chat: true,
                },
            })).rejects.toMatchObject({ error: 'sqlite_full_replacement_forbidden' });

            const rows = getSqliteRows(chatPath);
            expect(rows).toHaveLength(3901);
            expect(rows[1].mes).toBe('message 0');
            expect(rows.at(-1).mes).toBe('message 3899');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('allows explicit privileged SQLite full replacement operations', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-full-replace-privileged-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 1 }), makeMessages(20));

            const replacement = {
                aikobots_message_uuid: '22222222-2222-4222-8222-222222222222',
                name: 'Character',
                is_user: false,
                mes: 'recovered replacement',
                send_date: 'July 7, 2026 6:38pm',
            };
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 2 }), [replacement], {
                allowExistingSqliteFullReplacement: true,
                routeName: '/api/chats/import',
                operationType: 'import_recovery',
                requestBody: {
                    full_chat: true,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                isPrivilegedOperation: true,
            });

            const rows = getSqliteRows(chatPath);
            expect(rows).toHaveLength(2);
            expect(rows[0].chat_revision).toBe(2);
            expect(rows[1].mes).toBe('recovered replacement');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('updates an existing SQLite message by UUID without appending duplicated text', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-update-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 7 });
            const messages = makeMessages(6);
            await writeLogicalChat(chatPath, header, messages);

            const updatedMessage = { ...messages[2], mes: 'edited historical text' };
            const payload = await updateSqliteMessageByUuid({
                filePath: chatPath,
                requestBody: {
                    message_uuid: messages[2].aikobots_message_uuid,
                    message: updatedMessage,
                    base_revision: 7,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(payload.chat_revision).toBe(8);
            expect(logicalChat).toHaveLength(7);
            expect(logicalChat[3].mes).toBe('edited historical text');
            expect(logicalChat.at(-1).mes).toBe('message 5');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('atomically updates selected swipe text and metadata without changing sibling swipes', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-swipe-text-update-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const message = makeMultiSwipeAssistant();
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 7 }), [message]);

            const updatedMessage = structuredClone(message);
            updatedMessage.mes = 'edited selected text';
            updatedMessage.swipes[1] = 'edited selected text';
            updatedMessage.swipe_info[1].extra.bias = null;
            const payload = await updateSqliteMessageByUuid({
                filePath: chatPath,
                requestBody: {
                    message_uuid: message.aikobots_message_uuid,
                    message: updatedMessage,
                    mutation_type: 'ordinary_text_edit',
                    selected_swipe_uuid: message.swipe_info[1].aikobots_swipe_uuid,
                    base_revision: 7,
                    save_session_id: '44444444-4444-4444-8444-444444444444',
                },
                saveSessionId: '44444444-4444-4444-8444-444444444444',
                displayCount: 10,
            });

            const savedMessage = (await getLogicalChatData(chatPath))[1];
            expect(payload.chat_revision).toBe(8);
            expect(savedMessage.mes).toBe('edited selected text');
            expect(savedMessage.swipes[1]).toBe('edited selected text');
            expect(savedMessage.swipe_info[1].aikobots_swipe_uuid).toBe(message.swipe_info[1].aikobots_swipe_uuid);
            expect(savedMessage.swipes[0]).toBe(message.swipes[0]);
            expect(savedMessage.swipe_info[0]).toEqual(message.swipe_info[0]);
            expect(validateMessageSwipeState(savedMessage)).toMatchObject({ ok: true });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('edits a user message without replacing its following multi-swipe assistant response', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-user-before-swipes-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const userMessage = {
                aikobots_message_uuid: '66666666-6666-4666-8666-666666666666',
                name: 'User',
                is_user: true,
                mes: 'original user text',
                send_date: 'June 14, 2026 10:29am',
            };
            const assistantMessage = makeMultiSwipeAssistant();
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 7 }), [userMessage, assistantMessage]);

            await updateSqliteMessageByUuid({
                filePath: chatPath,
                requestBody: {
                    message_uuid: userMessage.aikobots_message_uuid,
                    message: { ...userMessage, mes: 'edited user text' },
                    mutation_type: 'ordinary_text_edit',
                    selected_swipe_uuid: null,
                    base_revision: 7,
                    save_session_id: '77777777-7777-4777-8777-777777777777',
                },
                saveSessionId: '77777777-7777-4777-8777-777777777777',
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            const savedAssistant = logicalChat[2];
            delete savedAssistant.id;
            delete savedAssistant.order_index;
            expect(logicalChat[1].mes).toBe('edited user text');
            expect(savedAssistant).toEqual(assistantMessage);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it.each([
        ['out-of-bounds swipe id', message => { message.swipe_id = 2; }, 'swipe_id_out_of_bounds'],
        ['active text mismatch', message => { message.mes = 'wrong active text'; }, 'active_swipe_text_mismatch'],
    ])('detects %s before a swipe message save', (_label, mutate, reason) => {
        const message = makeMultiSwipeAssistant();
        mutate(message);
        expect(validateMessageSwipeState(message)).toMatchObject({ ok: false, reason });
    });

    it.each([
        ['short legacy swipe metadata', message => { message.swipe_info.pop(); }, 'repairableDifferences'],
        ['active timestamp conflict', message => { message.gen_finished = 'wrong timestamp'; }, 'ambiguousConflicts'],
        ['active metadata conflict', message => { message.extra.model = 'wrong-model'; }, 'ambiguousConflicts'],
    ])('reports non-fatal %s before a swipe message save', (_label, mutate, bucket) => {
        const message = makeMultiSwipeAssistant();
        mutate(message);
        const validation = validateMessageSwipeState(message);
        expect(validation.ok).toBe(true);
        expect(validation[bucket]).not.toHaveLength(0);
    });

    it.each([
        ['selected swipe UUID replacement', message => {
            message.swipe_info[1].aikobots_swipe_uuid = '55555555-5555-4555-8555-555555555555';
        }, 'ordinary_text_edit_swipe_mutation'],
        ['sibling swipe replacement', message => {
            message.swipes[0] = 'silently replaced sibling';
        }, 'ordinary_text_edit_swipe_mutation'],
        ['swipe reordering', message => {
            message.swipes.reverse();
            message.swipe_info.reverse();
            message.swipe_id = 0;
            message.mes = message.swipes[0];
            message.send_date = message.swipe_info[0].send_date;
            message.gen_started = message.swipe_info[0].gen_started;
            message.gen_finished = message.swipe_info[0].gen_finished;
            message.extra = structuredClone(message.swipe_info[0].extra);
        }, 'ordinary_text_edit_swipe_mutation'],
    ])('rejects %s during an ordinary SQLite text edit', async (_label, mutate, expectedError) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-swipe-edit-reject-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const message = makeMultiSwipeAssistant();
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 7 }), [message]);
            const updatedMessage = structuredClone(message);
            mutate(updatedMessage);

            await expect(updateSqliteMessageByUuid({
                filePath: chatPath,
                requestBody: {
                    message_uuid: message.aikobots_message_uuid,
                    message: updatedMessage,
                    mutation_type: 'ordinary_text_edit',
                    selected_swipe_uuid: message.swipe_info[1].aikobots_swipe_uuid,
                    base_revision: 7,
                    save_session_id: '44444444-4444-4444-8444-444444444444',
                },
                saveSessionId: '44444444-4444-4444-8444-444444444444',
                displayCount: 10,
            })).rejects.toMatchObject({ error: expectedError });

            const savedMessage = (await getLogicalChatData(chatPath))[1];
            delete savedMessage.id;
            delete savedMessage.order_index;
            expect(savedMessage).toEqual(message);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects UUID updates without a base revision', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-update-revision-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 7 });
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, header, messages);

            await expect(updateSqliteMessageByUuid({
                filePath: chatPath,
                requestBody: {
                    message_uuid: messages[0].aikobots_message_uuid,
                    message: { ...messages[0], mes: 'should fail' },
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            })).rejects.toMatchObject({ error: 'base_revision_required' });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects explicit appends when the expected tail UUID is stale', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-append-tail-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 1 });
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, header, messages);

            await expect(appendSqliteMessage({
                filePath: chatPath,
                requestBody: {
                    message: {
                        name: 'Character',
                        is_user: false,
                        mes: 'new explicit append',
                        send_date: 99,
                    },
                    expected_tail_uuid: messages[0].aikobots_message_uuid,
                    base_revision: 1,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            })).rejects.toMatchObject({ error: 'tail_mismatch' });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('repairs modern SQLite chats whose message rows are missing UUIDs on load', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-identity-repair-load-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const saveSessionId = '33333333-3333-4333-8333-333333333333';

        try {
            await writeLogicalChat(
                chatPath,
                makeHeader({ chat_revision: 7, last_save_session_id: saveSessionId }),
                makeMessages(3),
            );
            stripSqliteMessageUuids(chatPath);

            const repairedPayload = await buildChunkedChatPayload(chatPath, { displayCount: 10 });
            const repairedRows = getSqliteRows(chatPath);
            const repairedUuids = repairedRows.slice(1).map(message => message.aikobots_message_uuid);

            expect(repairedPayload.chat_repaired).toBe(true);
            expect(repairedPayload.reload_required).toBe(true);
            expect(repairedPayload.header.chat_revision).toBe(7);
            expect(repairedPayload.header.last_save_session_id).toBe(saveSessionId);
            expect(repairedUuids.every(uuid => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid))).toBe(true);
            expect(new Set(repairedUuids).size).toBe(3);

            const stablePayload = await buildChunkedChatPayload(chatPath, { displayCount: 10 });
            const stableRows = getSqliteRows(chatPath);
            expect(stablePayload.chat_repaired).toBe(false);
            expect(stableRows.slice(1).map(message => message.aikobots_message_uuid)).toEqual(repairedUuids);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('returns chat_repaired before tail validation when a modern SQLite chat lacks message UUIDs', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-identity-repair-append-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const saveSessionId = '33333333-3333-4333-8333-333333333333';

        try {
            await writeLogicalChat(
                chatPath,
                makeHeader({ chat_revision: 1, last_save_session_id: saveSessionId }),
                makeMessages(2),
            );
            stripSqliteMessageUuids(chatPath);

            await expect(appendSqliteMessage({
                filePath: chatPath,
                requestBody: {
                    message: {
                        name: 'Character',
                        is_user: false,
                        mes: 'new explicit append',
                        send_date: 99,
                    },
                    expected_tail_uuid: '11111111-1111-4111-8111-111111111111',
                    base_revision: 1,
                    save_session_id: saveSessionId,
                },
                saveSessionId,
                displayCount: 10,
            })).rejects.toMatchObject({
                error: 'chat_repaired',
                status: 409,
                details: {
                    chat_repaired: true,
                    reload_required: true,
                },
            });

            const repairedRows = getSqliteRows(chatPath);
            expect(repairedRows).toHaveLength(3);
            expect(repairedRows.slice(1).every(message => message.aikobots_message_uuid)).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects explicit appends that reuse an existing message UUID', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-append-conflict-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 1 });
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, header, messages);

            await expect(appendSqliteMessage({
                filePath: chatPath,
                requestBody: {
                    message: {
                        aikobots_message_uuid: messages[0].aikobots_message_uuid,
                        name: 'Character',
                        is_user: false,
                        mes: 'duplicate UUID append',
                        send_date: 99,
                    },
                    expected_tail_uuid: messages[1].aikobots_message_uuid,
                    base_revision: 1,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            })).rejects.toMatchObject({ error: 'message_uuid_conflict' });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(logicalChat).toHaveLength(3);
            expect(logicalChat.at(-1).aikobots_message_uuid).toBe(messages[1].aikobots_message_uuid);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('explicitly appends a SQLite message and assigns a UUID when missing', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-append-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 1 });
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, header, messages);

            const payload = await appendSqliteMessage({
                filePath: chatPath,
                requestBody: {
                    message: {
                        name: 'Character',
                        is_user: false,
                        mes: 'new explicit append',
                        send_date: 99,
                    },
                    expected_tail_uuid: messages[1].aikobots_message_uuid,
                    base_revision: 1,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(payload.chat_revision).toBe(2);
            expect(payload.message_uuid).toMatch(/^[0-9a-f-]{36}$/i);
            expect(payload.totalMessages).toBe(3);
            expect(logicalChat).toHaveLength(4);
            expect(logicalChat.at(-1).mes).toBe('new explicit append');
            expect(logicalChat.at(-1).aikobots_message_uuid).toBe(payload.message_uuid);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('acknowledges a retried append operation UUID without applying it twice', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-idempotent-append-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 1 }), messages);
            const requestBody = {
                operation_id: '88888888-8888-4888-8888-888888888888',
                message: {
                    aikobots_message_uuid: '99999999-9999-4999-8999-999999999999',
                    name: 'Character',
                    is_user: false,
                    mes: 'retry-safe append',
                    send_date: 99,
                },
                expected_tail_uuid: messages[1].aikobots_message_uuid,
                base_revision: 1,
                save_session_id: '33333333-3333-4333-8333-333333333333',
            };

            const first = await appendSqliteMessage({
                filePath: chatPath,
                requestBody,
                saveSessionId: requestBody.save_session_id,
                displayCount: 10,
            });
            const retry = await appendSqliteMessage({
                filePath: chatPath,
                requestBody: structuredClone(requestBody),
                saveSessionId: requestBody.save_session_id,
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(first.chat_revision).toBe(2);
            expect(retry).toMatchObject({
                chat_revision: 2,
                storage_mode: 'sqlite',
                duplicate_operation: true,
            });
            expect(retry).not.toHaveProperty('storageMode');
            expect(logicalChat.filter(message => message.mes === 'retry-safe append')).toHaveLength(1);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects an operation UUID reused with a different payload', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-operation-reuse-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const messages = makeMessages(1);
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 1 }), messages);
            const requestBody = {
                operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                message: {
                    aikobots_message_uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                    name: 'Character',
                    is_user: false,
                    mes: 'original payload',
                },
                base_revision: 1,
                save_session_id: '33333333-3333-4333-8333-333333333333',
            };
            await appendSqliteMessage({ filePath: chatPath, requestBody, saveSessionId: requestBody.save_session_id, displayCount: 10 });

            await expect(appendSqliteMessage({
                filePath: chatPath,
                requestBody: {
                    ...structuredClone(requestBody),
                    message: { ...requestBody.message, mes: 'different payload' },
                },
                saveSessionId: requestBody.save_session_id,
                displayCount: 10,
            })).rejects.toMatchObject({ error: 'operation_id_reused' });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('deletes a SQLite message by UUID and repairs shifted positional metadata', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-delete-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 9 });
            const messages = makeMessages(4);
            messages[2].extra = {
                promptSnapshotKey: 'chat|2|0|abc',
                timedWorldInfoCheckpoint: {
                    version: 1,
                    messageId: 2,
                    timedWorldInfo: {
                        sticky: { entry: { start: 2, end: 3 } },
                        cooldown: {},
                    },
                },
            };
            await writeLogicalChat(chatPath, header, messages);

            const payload = await deleteSqliteMessageByUuid({
                filePath: chatPath,
                requestBody: {
                    message_uuid: messages[1].aikobots_message_uuid,
                    base_revision: 9,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            const shiftedMessage = logicalChat[2];
            expect(payload.chat_revision).toBe(10);
            expect(logicalChat.map(message => message.mes)).toEqual([
                undefined,
                'message 0',
                'message 2',
                'message 3',
            ]);
            expect(shiftedMessage.extra.promptSnapshotKey).toBeUndefined();
            expect(shiftedMessage.extra.timedWorldInfoCheckpoint.messageId).toBe(1);
            expect(shiftedMessage.extra.timedWorldInfoCheckpoint.timedWorldInfo.sticky.entry.start).toBe(1);
            expect(shiftedMessage.extra.timedWorldInfoCheckpoint.timedWorldInfo.sticky.entry.end).toBe(2);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('truncates descendants after a stable SQLite message UUID', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-uuid-truncate-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const messages = makeMessages(5);
            await writeLogicalChat(chatPath, header, messages);

            const payload = await truncateSqliteChatAfterUuid({
                filePath: chatPath,
                requestBody: {
                    branch_point_uuid: messages[1].aikobots_message_uuid,
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(payload.chat_revision).toBe(5);
            expect(logicalChat.map(message => message.mes)).toEqual([
                undefined,
                'message 0',
                'message 1',
            ]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('truncates every SQLite message while preserving the header and advancing revision', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-truncate-all-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 7, chat_metadata: { tainted: true } });
            await writeLogicalChat(chatPath, header, makeMessages(3));

            const payload = await truncateSqliteChatAfterUuid({
                filePath: chatPath,
                requestBody: {
                    truncate_all: true,
                    base_revision: 7,
                    save_session_id: '44444444-4444-4444-8444-444444444444',
                },
                saveSessionId: '44444444-4444-4444-8444-444444444444',
                displayCount: 10,
            });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(payload.chat_revision).toBe(8);
            expect(payload.totalMessages).toBe(0);
            expect(payload.messages).toEqual([]);
            expect(payload.loadedRangeEnd).toBe(-1);
            expect(logicalChat).toHaveLength(1);
            expect(logicalChat[0].chat_revision).toBe(8);
            expect(logicalChat[0].chat_metadata).toEqual({ tainted: true });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('updates a targeted SQLite message range without dropping unseen messages', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-patch-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader();
            await writeLogicalChat(chatPath, header, makeMessages(1000));

            const patchMessages = makeMessages(5).map((message, index) => ({
                ...message,
                mes: `patched ${100 + index}`,
            }));
            await expect(writeLogicalChat(chatPath, header, patchMessages, { startIndex: 101 }))
                .rejects.toThrow('messageStartId');
            await writeLogicalChat(chatPath, header, patchMessages, { messageStartId: 100 });

            const logicalChat = await getLogicalChatData(chatPath);

            expect(logicalChat).toHaveLength(1001);
            expect(logicalChat[100].mes).toBe('message 99');
            expect(logicalChat[101].mes).toBe('patched 100');
            expect(logicalChat[105].mes).toBe('patched 104');
            expect(logicalChat[106].mes).toBe('message 105');
            expect(logicalChat.at(-1).mes).toBe('message 999');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('applies direct loaded-range saves through SQLite without hydrating unseen messages', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-direct-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 6 });
            const messages = makeMessages(20);
            await writeLogicalChat(chatPath, header, messages);

            const patchMessages = messages.slice(5, 8).map((message, index) => ({
                ...message,
                mes: `patched direct ${5 + index}`,
            }));
            const payload = await updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 5,
                    loaded_range_end: 7,
                    base_revision: 6,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 20,
                },
                incomingHeader: header,
                rangeMessages: patchMessages,
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(payload.chat_revision).toBe(7);
            expect(payload.storage_mode).toBe('sqlite');
            expect(payload.tailCount).toBe(20);
            expect(payload.fullJsonl).toBeNull();
            expect(logicalChat).toHaveLength(21);
            expect(logicalChat[5].mes).toBe('message 4');
            expect(logicalChat[6].mes).toBe('patched direct 5');
            expect(logicalChat[8].mes).toBe('patched direct 7');
            expect(logicalChat[9].mes).toBe('message 8');
            expect(logicalChat.at(-1).mes).toBe('message 19');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('does not active-swipe validate an unrelated out-of-range SQLite row', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-swipe-isolation-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const messages = [makeMultiSwipeAssistant(), ...makeMessages(4)];
            await writeLogicalChat(chatPath, header, messages);
            mutateSqliteMessage(chatPath, 0, message => { message.mes = 'legacy contradictory active text'; });

            const patchMessages = structuredClone(messages.slice(2, 4));
            patchMessages[0].mes = 'range edit';
            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 2,
                    loaded_range_end: 3,
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: messages.length,
                },
                incomingHeader: header,
                rangeMessages: patchMessages,
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).resolves.toMatchObject({ result: 'ok', changed: 2 });

            const saved = await getLogicalChatData(chatPath);
            expect(saved[1].mes).toBe('legacy contradictory active text');
            expect(saved[3].mes).toBe('range edit');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('writes only the header and changed rows for a fully loaded SQLite range', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-write-audit-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const sqlitePath = chatPath.replace('.jsonl', '.sqlite');
        const saveSessionId = '33333333-3333-4333-8333-333333333333';

        try {
            const header = makeHeader({ chat_revision: 2 });
            const messages = makeMessages(6);
            await writeLogicalChat(chatPath, header, messages);

            const auditDb = new Database(sqlitePath);
            auditDb.exec(`
                CREATE TABLE write_audit (row_id INTEGER NOT NULL);
                CREATE TRIGGER audit_message_update AFTER UPDATE ON messages
                BEGIN
                    INSERT INTO write_audit (row_id) VALUES (new.id);
                END;
            `);
            auditDb.close();

            const rangeMessages = messages.map(message => ({ ...message }));
            rangeMessages[3].mes = 'only changed row';
            const payload = await updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 0,
                    loaded_range_end: 5,
                    base_revision: 2,
                    save_session_id: saveSessionId,
                    saved_message_count: 6,
                },
                incomingHeader: header,
                rangeMessages,
                saveSessionId,
            });

            const verifyDb = new Database(sqlitePath, { readonly: true });
            const updatedOrderIndexes = verifyDb.prepare(`
                SELECT messages.order_index
                FROM write_audit
                JOIN messages ON messages.id = write_audit.row_id
                ORDER BY messages.order_index
            `).pluck().all();
            verifyDb.close();

            expect(payload.changed).toBe(6);
            expect(updatedOrderIndexes).toEqual([0, 4]);

            const resetDb = new Database(sqlitePath);
            resetDb.prepare('DELETE FROM write_audit').run();
            resetDb.close();
            await updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 0,
                    loaded_range_end: 5,
                    base_revision: 3,
                    save_session_id: saveSessionId,
                    saved_message_count: 6,
                },
                incomingHeader: makeHeader({ chat_revision: 3, chat_metadata: { title: 'metadata only' } }),
                rangeMessages,
                saveSessionId,
            });
            const metadataDb = new Database(sqlitePath, { readonly: true });
            const metadataUpdatedIndexes = metadataDb.prepare(`
                SELECT messages.order_index
                FROM write_audit
                JOIN messages ON messages.id = write_audit.row_id
            `).pluck().all();
            metadataDb.close();
            expect(metadataUpdatedIndexes).toEqual([0]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects a submitted loaded-range message with a fatal active-text mismatch', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-swipe-reject-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const message = makeMultiSwipeAssistant();
            const leadingMessage = makeMessages(1)[0];
            await writeLogicalChat(chatPath, header, [leadingMessage, message]);
            const contradictory = structuredClone(message);
            contradictory.mes = 'contradictory active text';

            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 1,
                    loaded_range_end: 1,
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 2,
                },
                incomingHeader: header,
                rangeMessages: [contradictory],
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toMatchObject({
                status: 409,
                error: 'invalid_message_swipe_state',
                details: {
                    reason: 'active_swipe_text_mismatch',
                    comparison: {
                        fatalMismatches: [expect.objectContaining({
                            messageRelativeIndex: 0,
                            logicalChatIndex: 1,
                            selectedSwipeIndex: 1,
                        })],
                    },
                },
            });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it.each([
        ['missing', message => { delete message.swipe_info[1].aikobots_swipe_uuid; }],
        ['malformed', message => { message.swipe_info[1].aikobots_swipe_uuid = 'legacy-swipe-id'; }],
    ])('accepts a submitted loaded-range message with a %s legacy swipe UUID', async (_label, mutate) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-legacy-swipe-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const message = makeMultiSwipeAssistant();
            await writeLogicalChat(chatPath, header, [message]);
            const legacyMessage = structuredClone(message);
            mutate(legacyMessage);

            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 0,
                    loaded_range_end: 0,
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 1,
                },
                incomingHeader: header,
                rangeMessages: [legacyMessage],
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).resolves.toMatchObject({ result: 'ok' });

            const savedUuid = (await getLogicalChatData(chatPath))[1].swipe_info[1].aikobots_swipe_uuid;
            expect(savedUuid).toMatch(/^[0-9a-f-]{36}$/i);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects conflicting valid active-swipe UUIDs in a submitted loaded range', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-swipe-uuid-conflict-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const message = makeMultiSwipeAssistant();
            await writeLogicalChat(chatPath, header, [message]);
            const contradictory = structuredClone(message);
            contradictory.aikobots_swipe_uuid = '55555555-5555-4555-8555-555555555555';

            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 0,
                    loaded_range_end: 0,
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 1,
                },
                incomingHeader: header,
                rangeMessages: [contradictory],
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toMatchObject({
                error: 'invalid_message_swipe_state',
                details: { reason: 'active_swipe_uuid_conflict' },
            });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('preserves imported metadata through a non-fatal loaded-range save', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-metadata-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const message = makeMultiSwipeAssistant();
            message.extra.branches = [{ id: 'top-branch' }];
            message.extra.bookmark_link = 'bookmark-name';
            message.swipe_info[1].extra.imported_vendor_field = { preserved: true };
            await writeLogicalChat(chatPath, header, [message]);

            const updated = structuredClone(message);
            updated.mes = 'edited selected text';
            updated.swipes[1] = 'edited selected text';
            await updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 0,
                    loaded_range_end: 0,
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 1,
                },
                incomingHeader: header,
                rangeMessages: [updated],
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            });

            const saved = (await getLogicalChatData(chatPath))[1];
            expect(saved.extra.branches).toEqual([{ id: 'top-branch' }]);
            expect(saved.extra.bookmark_link).toBe('bookmark-name');
            expect(saved.swipe_info[1].extra.imported_vendor_field).toEqual({ preserved: true });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('validates every submitted message in a full-chat write', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-full-swipe-validation-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const message = makeMultiSwipeAssistant();
            message.mes = 'contradictory active text';
            await expect(writeLogicalChat(chatPath, makeHeader(), [makeMessages(1)[0], message]))
                .rejects.toMatchObject({ error: 'invalid_message_swipe_state' });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects stale SQLite loaded-range saves before accepting no-op payloads', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-stale-noop-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 8 });
            const messages = makeMessages(6);
            await writeLogicalChat(chatPath, header, messages);

            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 2,
                    loaded_range_end: 3,
                    base_revision: 7,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 6,
                },
                incomingHeader: header,
                rangeMessages: messages.slice(2, 4),
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toMatchObject({ status: 409, error: 'stale_revision' });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(logicalChat[0].chat_revision).toBe(8);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects sparse or ambiguous SQLite loaded-range saves', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-invalid-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 2 });
            const messages = makeMessages(6);
            await writeLogicalChat(chatPath, header, messages);

            const sparseMessages = [];
            sparseMessages.length = 2;
            sparseMessages[0] = messages[1];

            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 1,
                    loaded_range_end: 2,
                    base_revision: 2,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 6,
                },
                incomingHeader: header,
                rangeMessages: sparseMessages,
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toMatchObject({ status: 400, error: 'invalid_loaded_range' });

            await expect(updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 1,
                    base_revision: 2,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 6,
                },
                incomingHeader: header,
                rangeMessages: messages.slice(1, 3),
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toMatchObject({ status: 400, error: 'invalid_loaded_range' });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('does not serialize a JSONL backup for complete loaded-range SQLite saves', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-backup-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const saveSessionId = '33333333-3333-4333-8333-333333333333';

        try {
            const header = makeHeader({ chat_revision: 3, chat_metadata: { title: 'before' } });
            const nextHeader = makeHeader({ chat_revision: 3, chat_metadata: { title: 'after' } });
            const messages = makeMessages(4);
            await writeLogicalChat(chatPath, header, messages);

            const nextMessages = messages.map((message, index) => ({
                ...message,
                mes: `complete save ${index}`,
            }));
            const payload = await updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 0,
                    loaded_range_end: 3,
                    base_revision: 3,
                    save_session_id: saveSessionId,
                    saved_message_count: 4,
                },
                incomingHeader: nextHeader,
                rangeMessages: nextMessages,
                saveSessionId,
            });
            const savedRows = await getLogicalChatData(chatPath);

            expect(payload.chat_revision).toBe(4);
            expect(payload.fullJsonl).toBeNull();
            expect(savedRows).toHaveLength(5);
            expect(savedRows[0].chat_revision).toBe(4);
            expect(savedRows[0].last_save_session_id).toBe(saveSessionId);
            expect(savedRows[0].chat_metadata).toEqual({ title: 'after' });
            expect(savedRows[1].mes).toBe('complete save 0');
            expect(savedRows.at(-1).mes).toBe('complete save 3');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('applies group loaded-range saves while preserving group header metadata', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-loaded-range-group-'));
        const chatPath = path.join(tempDir, 'group.jsonl');

        try {
            const header = {
                is_group_chat_header: true,
                group_chat_header_version: 1,
                create_date: '2026-04-20',
                chat_revision: 2,
                chat_metadata: { title: 'group metadata' },
            };
            const messages = makeMessages(10);
            await writeLogicalChat(chatPath, header, messages);

            const patchMessages = messages.slice(2, 5).map((message, index) => ({
                ...message,
                mes: `patched group ${2 + index}`,
            }));
            await updateSqliteLoadedMessageRange({
                filePath: chatPath,
                requestBody: {
                    loaded_range_start: 2,
                    loaded_range_end: 4,
                    base_revision: 2,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                    saved_message_count: 10,
                },
                incomingHeader: header,
                rangeMessages: patchMessages,
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(logicalChat[0].is_group_chat_header).toBe(true);
            expect(logicalChat[0].chat_metadata).toEqual({ title: 'group metadata' });
            expect(logicalChat[0].chat_revision).toBe(3);
            expect(logicalChat[2].mes).toBe('message 1');
            expect(logicalChat[3].mes).toBe('patched group 2');
            expect(logicalChat[5].mes).toBe('patched group 4');
            expect(logicalChat[6].mes).toBe('message 5');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('updates SQLite message visibility for only the requested range and matching name', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-visibility-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 1 });
            const messages = makeMessages(8).map((message, index) => ({
                ...message,
                name: index === 3 ? 'Other' : message.name,
                is_system: false,
            }));
            await writeLogicalChat(chatPath, header, messages);

            const payload = await updateSqliteMessageVisibility({
                filePath: chatPath,
                requestBody: {
                    operation_id: '11111111-1111-4111-8111-111111111111',
                    base_revision: 1,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                start: 2,
                end: 5,
                hide: true,
                nameFilter: 'User',
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(payload.changed).toBe(2);
            expect(payload.chat_revision).toBe(2);
            expect(logicalChat[0].chat_revision).toBe(2);
            expect(logicalChat[2].is_system).toBe(false);
            expect(logicalChat[3].is_system).toBe(true);
            expect(logicalChat[4].is_system).toBe(false);
            expect(logicalChat[5].is_system).toBe(true);
            expect(logicalChat[6].is_system).toBe(false);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('renames participant history with targeted row updates', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-participant-rename-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const sqlitePath = chatPath.replace('.jsonl', '.sqlite');

        try {
            const header = makeHeader({ chat_revision: 4 });
            const messages = makeMessages(5);
            messages[1].force_avatar = '/thumbnail?type=avatar&file=old%20avatar.png';
            messages[1].original_avatar = 'old avatar.png';
            messages[3].force_avatar = '/thumbnail?type=avatar&file=other.png';
            await writeLogicalChat(chatPath, header, messages);

            const auditDb = new Database(sqlitePath);
            auditDb.exec(`
                CREATE TABLE rename_audit (row_id INTEGER NOT NULL);
                CREATE TRIGGER audit_rename_update AFTER UPDATE ON messages
                BEGIN
                    INSERT INTO rename_audit (row_id) VALUES (new.id);
                END;
            `);
            auditDb.close();

            const payload = await updateSqliteParticipantHistory({
                filePath: chatPath,
                oldAvatar: 'old avatar.png',
                newAvatar: 'new avatar.png',
                newName: 'Renamed',
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            });
            const saved = await getLogicalChatData(chatPath);
            const verifyDb = new Database(sqlitePath, { readonly: true });
            const updateCount = verifyDb.prepare('SELECT COUNT(*) FROM rename_audit').pluck().get();
            verifyDb.close();

            expect(payload).toMatchObject({ changed: 1, chat_revision: 5 });
            expect(updateCount).toBe(2);
            expect(saved[2]).toMatchObject({ name: 'Renamed', original_avatar: 'new avatar.png' });
            expect(saved[2].force_avatar).toContain('new%20avatar.png');
            expect(saved[4].name).toBe('Character');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('updates lorebook references in only the SQLite chat header', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-lorebook-reference-'));
        const chatPath = path.join(tempDir, 'chat.sqlite');
        try {
            await writeLogicalChat(chatPath, makeHeader({
                chat_revision: 9,
                last_save_session_id: '33333333-3333-4333-8333-333333333333',
                chat_metadata: { world_info: 'Old Lorebook' },
            }), makeMessages(3));
            const auditDb = new Database(chatPath);
            auditDb.exec(`
                CREATE TABLE lorebook_audit (order_index REAL NOT NULL);
                CREATE TRIGGER audit_lorebook_update AFTER UPDATE ON messages
                BEGIN
                    INSERT INTO lorebook_audit (order_index) VALUES (new.order_index);
                END;
            `);
            auditDb.close();

            await expect(migrateChatHeaderReferences(chatPath, 'test-user', 'Old Lorebook', 'New Lorebook'))
                .resolves.toMatchObject({ changed: true });
            const saved = await getLogicalChatData(chatPath);
            const verifyDb = new Database(chatPath, { readonly: true });
            const updatedIndexes = verifyDb.prepare('SELECT order_index FROM lorebook_audit').pluck().all();
            verifyDb.close();

            expect(updatedIndexes).toEqual([0]);
            expect(saved[0].chat_metadata.world_info).toBe('New Lorebook');
            expect(saved[0].chat_revision).toBe(10);
            expect(saved[0].last_save_session_id).toBeUndefined();

            const legacyPath = path.join(tempDir, 'legacy.jsonl');
            fs.writeFileSync(legacyPath, [
                JSON.stringify(makeHeader({ chat_metadata: { world_info: 'Old Lorebook' } })),
                JSON.stringify(makeMessages(1)[0]),
            ].join('\n'));
            await expect(migrateChatHeaderReferences(legacyPath, 'test-user', 'Old Lorebook', 'New Lorebook'))
                .resolves.toMatchObject({ changed: true });
            const legacyRows = fs.readFileSync(legacyPath, 'utf8').split('\n').map(line => JSON.parse(line));
            expect(legacyRows[0].chat_metadata.world_info).toBe('New Lorebook');
            expect(legacyRows[1].mes).toBe('message 0');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects stale SQLite visibility updates without mutating messages', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-visibility-stale-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 3 }), makeMessages(4));

            await expect(updateSqliteMessageVisibility({
                filePath: chatPath,
                requestBody: {
                    operation_id: '22222222-2222-4222-8222-222222222222',
                    base_revision: 2,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                start: 1,
                end: 1,
                hide: true,
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toMatchObject({ status: 409, error: 'stale_revision' });

            const logicalChat = await getLogicalChatData(chatPath);
            expect(logicalChat[0].chat_revision).toBe(3);
            expect(logicalChat[2].is_system).toBeUndefined();
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('syncs SQLite user persona messages in place and increments revision', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-persona-sync-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const messages = makeMessages(6).map((message) => ({
                ...message,
                name: message.is_user ? 'Old User' : message.name,
                force_avatar: message.is_user ? '/old-avatar.png' : message.force_avatar,
            }));
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 4 }), messages);

            const payload = await updateSqliteUserPersonaMessages({
                filePath: chatPath,
                requestBody: {
                    operation_id: '55555555-5555-4555-8555-555555555555',
                    base_revision: 4,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                userName: 'New User',
                forceAvatar: '/thumbnail?type=persona&file=new.png',
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(payload.matched).toBe(3);
            expect(payload.changed).toBe(3);
            expect(payload.chat_revision).toBe(5);
            expect(logicalChat[0].chat_revision).toBe(5);
            expect(logicalChat[1].name).toBe('New User');
            expect(logicalChat[1].force_avatar).toBe('/thumbnail?type=persona&file=new.png');
            expect(logicalChat[2].name).toBe('Character');
            expect(logicalChat[3].name).toBe('New User');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('replays visibility and persona receipts before stale revision validation', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-p1-replay-'));
        try {
            const visibilityPath = path.join(tempDir, 'visibility.jsonl');
            await writeLogicalChat(visibilityPath, makeHeader({ chat_revision: 4 }), makeMessages(3));
            const visibilityBody = {
                operation_id: '66666666-6666-4666-8666-666666666666',
                base_revision: 4,
                save_session_id: '33333333-3333-4333-8333-333333333333',
            };
            const visibilityOptions = { filePath: visibilityPath, requestBody: visibilityBody, start: 0, end: 0, hide: true, saveSessionId: visibilityBody.save_session_id };
            await expect(updateSqliteMessageVisibility(visibilityOptions)).resolves.toMatchObject({ status: 'applied', chat_revision: 5 });
            await expect(updateSqliteMessageVisibility(visibilityOptions)).resolves.toMatchObject({ status: 'replayed', chat_revision: 5 });

            const personaPath = path.join(tempDir, 'persona.jsonl');
            await writeLogicalChat(personaPath, makeHeader({ chat_revision: 4 }), makeMessages(3));
            const personaBody = {
                operation_id: '77777777-7777-4777-8777-777777777777',
                base_revision: 4,
                save_session_id: '33333333-3333-4333-8333-333333333333',
            };
            const personaOptions = { filePath: personaPath, requestBody: personaBody, userName: 'New User', forceAvatar: '/new.png', saveSessionId: personaBody.save_session_id };
            await expect(updateSqliteUserPersonaMessages(personaOptions)).resolves.toMatchObject({ status: 'applied', chat_revision: 5 });
            await expect(updateSqliteUserPersonaMessages(personaOptions)).resolves.toMatchObject({ status: 'replayed', chat_revision: 5 });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects a group positional and wrapper UUID mismatch without mutation or receipt', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-group-identity-mismatch-'));
        const chatPath = path.join(tempDir, 'group.jsonl');
        try {
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 4, is_group_chat_header: true }), messages);
            const requestBody = {
                id: 'group-chat',
                operation_id: '88888888-8888-4888-8888-888888888888',
                base_revision: 4,
                save_session_id: '33333333-3333-4333-8333-333333333333',
                message_uuid: messages[0].aikobots_message_uuid,
                message_id: 1,
                message: { ...messages[0], mes: 'must not persist' },
            };
            await expect(updateGroupChatMessageRow({ filePath: chatPath, requestBody, saveSessionId: requestBody.save_session_id }))
                .rejects.toMatchObject({ status: 409, error: 'message_identity_mismatch' });

            const saved = await getLogicalChatData(chatPath);
            expect(saved[0].chat_revision).toBe(4);
            expect(saved[1].mes).toBe('message 0');
            expect(saved[2].mes).toBe('message 1');
            const db = new Database(chatPath.replace('.jsonl', '.sqlite'), { readonly: true });
            expect(db.prepare('SELECT COUNT(*) FROM operation_receipts').pluck().get()).toBe(0);
            db.close();
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('replays a group incremental receipt and rejects a distinct stale operation', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-group-p1-replay-'));
        const chatPath = path.join(tempDir, 'group.jsonl');
        try {
            const messages = makeMessages(2);
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 4, is_group_chat_header: true }), messages);
            const requestBody = {
                id: 'group-chat',
                operation_id: '99999999-9999-4999-8999-999999999999',
                base_revision: 4,
                save_session_id: '33333333-3333-4333-8333-333333333333',
                message_uuid: messages[0].aikobots_message_uuid,
                message_id: 0,
                message: { ...messages[0], mes: 'updated once' },
            };
            const options = { filePath: chatPath, requestBody, saveSessionId: requestBody.save_session_id };
            await expect(updateGroupChatMessageRow(options)).resolves.toMatchObject({ status: 'applied', chat_revision: 5 });
            await expect(updateGroupChatMessageRow(options)).resolves.toMatchObject({ status: 'replayed', chat_revision: 5 });

            await expect(updateGroupChatMessageRow({
                ...options,
                requestBody: { ...requestBody, operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            })).rejects.toMatchObject({ status: 409, error: 'stale_revision' });
            const saved = await getLogicalChatData(chatPath);
            expect(saved[0].chat_revision).toBe(5);
            expect(saved[1].mes).toBe('updated once');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('keeps loaded-range updates position-based after fractional inserts', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-fractional-update-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const sqliteModule = await import('../sqlite-manager.js');
            const header = makeHeader();
            await writeLogicalChat(chatPath, header, makeMessages(5));

            const db = await sqliteModule.loadDb(chatPath.replace('.jsonl', '.sqlite'));
            insertLogicalMessageAfter(db, 2, {
                name: 'Character',
                is_user: false,
                mes: 'inserted',
                send_date: 99,
            });
            sqliteModule.saveDb(db, chatPath.replace('.jsonl', '.sqlite'));
            db.close();

            await writeLogicalChat(chatPath, header, [{ ...makeMessages(1)[0], mes: 'patched inserted' }], { messageStartId: 3 });
            const logicalChat = await getLogicalChatData(chatPath);

            expect(logicalChat.map(message => message.mes)).toEqual([
                undefined,
                'message 0',
                'message 1',
                'message 2',
                'patched inserted',
                'message 3',
                'message 4',
            ]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('clones a SQLite message after the target and invalidates prompt snapshots', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-clone-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 2 });
            const messages = makeMessages(4);
            messages[1] = {
                ...messages[1],
                aikobots_message_uuid: '11111111-1111-4111-8111-111111111111',
                swipes: ['message 1'],
                swipe_id: 0,
                swipe_info: [{
                    aikobots_swipe_uuid: '22222222-2222-4222-8222-222222222222',
                    extra: {
                        promptSnapshotKey: 'user|chat:test|1|0',
                        branches: [{ id: 'swipe-only-branch' }],
                        imported_vendor_field: 'swipe-value',
                        timedWorldInfoCheckpoint: {
                            version: 1,
                            messageId: 1,
                            timedWorldInfo: {
                                sticky: { a: { start: 1, end: 3 } },
                                cooldown: {},
                            },
                        },
                    },
                }],
                extra: {
                    promptSnapshotKey: 'user|chat:test|1|0',
                    bookmark_link: 'top-only-bookmark',
                    imported_vendor_field: 'top-value',
                    timedWorldInfoCheckpoint: {
                        version: 1,
                        messageId: 1,
                        timedWorldInfo: {
                            sticky: { a: { start: 1, end: 3 } },
                            cooldown: {},
                        },
                    },
                },
            };
            messages[2] = {
                ...messages[2],
                extra: {
                    promptSnapshotKey: 'user|chat:test|2|0',
                    timedWorldInfoCheckpoint: {
                        version: 1,
                        messageId: 2,
                        timedWorldInfo: {
                            sticky: { b: { start: 2, end: 3 } },
                            cooldown: {},
                        },
                    },
                },
            };
            await writeLogicalChat(chatPath, header, messages);

            const payload = await cloneSqliteMessageAfter({
                filePath: chatPath,
                requestBody: {
                    message_id: 1,
                    text_override: 'cloned text',
                    bias_override: null,
                    base_revision: 2,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
                displayCount: 10,
            });
            const logicalChat = await getLogicalChatData(chatPath);
            const clone = logicalChat[3];
            const shifted = logicalChat[4];

            expect(payload.inserted_message_id).toBe(2);
            expect(payload.chat_revision).toBe(3);
            expect(logicalChat).toHaveLength(6);
            expect(clone.mes).toBe('cloned text');
            expect(clone.aikobots_message_uuid).not.toBe(messages[1].aikobots_message_uuid);
            expect(clone.swipe_info[0].aikobots_swipe_uuid).not.toBe(messages[1].swipe_info[0].aikobots_swipe_uuid);
            expect(clone.extra.promptSnapshotKey).toBeUndefined();
            expect(clone.extra.timedWorldInfoCheckpoint).toBeUndefined();
            expect(clone.extra.bookmark_link).toBe('top-only-bookmark');
            expect(clone.extra.imported_vendor_field).toBe('top-value');
            expect(clone.swipe_info[0].extra.branches).toEqual([{ id: 'swipe-only-branch' }]);
            expect(clone.swipe_info[0].extra.imported_vendor_field).toBe('swipe-value');
            expect(shifted.extra.promptSnapshotKey).toBeUndefined();
            expect(shifted.extra.timedWorldInfoCheckpoint.messageId).toBe(3);
            expect(shifted.extra.timedWorldInfoCheckpoint.timedWorldInfo.sticky.b.start).toBe(3);
            expect(shifted.extra.timedWorldInfoCheckpoint.timedWorldInfo.sticky.b.end).toBe(4);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rolls back clone insertion when shifted-message repair fails', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-clone-rollback-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');
        const sqlitePath = chatPath.replace('.jsonl', '.sqlite');

        try {
            const header = makeHeader({ chat_revision: 7 });
            const messages = makeMessages(4);
            await writeLogicalChat(chatPath, header, messages);

            const corruptDb = new Database(sqlitePath);
            corruptDb.prepare('UPDATE messages SET content = ? WHERE order_index = 3').run('{invalid json');
            const countBefore = corruptDb.prepare('SELECT COUNT(*) FROM messages').pluck().get();
            corruptDb.close();

            await expect(cloneSqliteMessageAfter({
                filePath: chatPath,
                requestBody: {
                    message_uuid: messages[0].aikobots_message_uuid,
                    base_revision: 7,
                    save_session_id: '33333333-3333-4333-8333-333333333333',
                },
                saveSessionId: '33333333-3333-4333-8333-333333333333',
            })).rejects.toThrow();

            const verifyDb = new Database(sqlitePath, { readonly: true });
            const countAfter = verifyDb.prepare('SELECT COUNT(*) FROM messages').pluck().get();
            const savedHeader = JSON.parse(verifyDb.prepare('SELECT content FROM messages WHERE order_index = 0').pluck().get());
            verifyDb.close();
            expect(countAfter).toBe(countBefore);
            expect(savedHeader.chat_revision).toBe(7);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('clones a SQLite message addressed by UUID without a message id', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-clone-uuid-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({ chat_revision: 5 });
            const messages = makeMessages(3);
            await writeLogicalChat(chatPath, header, messages);

            const payload = await cloneSqliteMessageAfter({
                filePath: chatPath,
                requestBody: {
                    message_uuid: messages[1].aikobots_message_uuid,
                    text_override: 'uuid clone',
                    base_revision: 5,
                    save_session_id: '44444444-4444-4444-8444-444444444444',
                },
                saveSessionId: '44444444-4444-4444-8444-444444444444',
                displayCount: 10,
            });
            const logicalChat = await getLogicalChatData(chatPath);
            const clone = logicalChat[3];

            expect(payload.inserted_message_id).toBe(2);
            expect(payload.chat_revision).toBe(6);
            expect(logicalChat).toHaveLength(5);
            expect(clone.mes).toBe('uuid clone');
            expect(clone.aikobots_message_uuid).not.toBe(messages[1].aikobots_message_uuid);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects legacy split-tail JSONL clearly', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-split-tail-chat-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            const header = makeHeader({
                chat_storage: {
                    mode: 'split-tail',
                    head_count: 900,
                },
            });
            const records = [header, ...makeMessages(100)]
                .map(record => JSON.stringify(record))
                .join('\n');
            fs.writeFileSync(chatPath, `${records}\n`, 'utf8');

            await expect(buildChunkedChatPayload(chatPath, {
                displayCount: 50,
            })).rejects.toMatchObject({
                code: 'unsupported_split_tail',
            });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
