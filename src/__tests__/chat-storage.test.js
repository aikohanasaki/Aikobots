import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';
import initSqlJs from 'sql.js';

let SQL;
let applyLoadedMessageRange;
let appendSqliteMessage;
let buildChunkedChatPayload;
let cloneSqliteMessageAfter;
let compileScene;
let deleteSqliteMessageByUuid;
let getLogicalChatData;
let hasValidGroupChatPayload;
let insertLogicalMessageAfter;
let resolveSqliteLogicalChatReference;
let truncateSqliteChatAfterUuid;
let updateSqliteLoadedMessageRange;
let updateSqliteMessageByUuid;
let updateSqliteMessageVisibility;
let updateSqliteUserPersonaMessages;
let writeLogicalChat;

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

function getSqliteRows(chatPath) {
    const sqlitePath = String(chatPath).replace(/\.(?:jsonl|sqlite)$/i, '.sqlite');
    const db = new SQL.Database(fs.readFileSync(sqlitePath));
    try {
        const result = db.exec('SELECT order_index, content FROM messages ORDER BY order_index ASC');
        return result[0]?.values?.map(row => JSON.parse(row[1])) || [];
    } finally {
        db.close();
    }
}

function stripSqliteMessageUuids(chatPath) {
    const sqlitePath = String(chatPath).replace(/\.(?:jsonl|sqlite)$/i, '.sqlite');
    const db = new SQL.Database(fs.readFileSync(sqlitePath));
    try {
        const rows = db.exec('SELECT id, order_index, content FROM messages WHERE order_index > 0 ORDER BY order_index ASC')[0]?.values || [];
        const stmt = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
        try {
            for (const row of rows) {
                const message = JSON.parse(row[2]);
                delete message.aikobots_message_uuid;
                stmt.run([JSON.stringify(message), row[0]]);
            }
        } finally {
            stmt.free();
        }
        fs.writeFileSync(sqlitePath, Buffer.from(db.export()));
    } finally {
        db.close();
    }
}

describe('SQLite chat length handling', () => {
    beforeAll(async () => {
        SQL = await initSqlJs();
        const utilModule = await import('../util.js');
        utilModule.setConfigFilePath(getConfigPath());

        const chatsModule = await import('../endpoints/chats.js');
        const sqliteModule = await import('../sqlite-manager.js');
        const stmbCoreModule = await import('../../public/scripts/stmb-core.js');
        applyLoadedMessageRange = chatsModule.applyLoadedMessageRange;
        appendSqliteMessage = chatsModule.appendSqliteMessage;
        buildChunkedChatPayload = chatsModule.buildChunkedChatPayload;
        cloneSqliteMessageAfter = chatsModule.cloneSqliteMessageAfter;
        compileScene = stmbCoreModule.compileScene;
        deleteSqliteMessageByUuid = chatsModule.deleteSqliteMessageByUuid;
        getLogicalChatData = chatsModule.getLogicalChatData;
        hasValidGroupChatPayload = chatsModule.hasValidGroupChatPayload;
        resolveSqliteLogicalChatReference = chatsModule.resolveSqliteLogicalChatReference;
        truncateSqliteChatAfterUuid = chatsModule.truncateSqliteChatAfterUuid;
        updateSqliteLoadedMessageRange = chatsModule.updateSqliteLoadedMessageRange;
        updateSqliteMessageByUuid = chatsModule.updateSqliteMessageByUuid;
        updateSqliteMessageVisibility = chatsModule.updateSqliteMessageVisibility;
        updateSqliteUserPersonaMessages = chatsModule.updateSqliteUserPersonaMessages;
        insertLogicalMessageAfter = sqliteModule.insertLogicalMessageAfter;
        writeLogicalChat = chatsModule.writeLogicalChat;
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

    it('returns a JSONL backup payload for complete loaded-range SQLite saves', async () => {
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
                },
                incomingHeader: nextHeader,
                rangeMessages: nextMessages,
                saveSessionId,
            });
            const backupRows = payload.fullJsonl.split('\n').map(line => JSON.parse(line));

            expect(payload.chat_revision).toBe(4);
            expect(backupRows).toHaveLength(5);
            expect(backupRows[0].chat_revision).toBe(4);
            expect(backupRows[0].last_save_session_id).toBe(saveSessionId);
            expect(backupRows[0].chat_metadata).toEqual({ title: 'after' });
            expect(backupRows[1].mes).toBe('complete save 0');
            expect(backupRows.at(-1).mes).toBe('complete save 3');
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
                requestBody: { base_revision: 1 },
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

    it('rejects stale SQLite visibility updates without mutating messages', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-chat-visibility-stale-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            await writeLogicalChat(chatPath, makeHeader({ chat_revision: 3 }), makeMessages(4));

            await expect(updateSqliteMessageVisibility({
                filePath: chatPath,
                requestBody: { base_revision: 2 },
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
                requestBody: { base_revision: 4 },
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
            expect(shifted.extra.promptSnapshotKey).toBeUndefined();
            expect(shifted.extra.timedWorldInfoCheckpoint.messageId).toBe(3);
            expect(shifted.extra.timedWorldInfoCheckpoint.timedWorldInfo.sticky.b.start).toBe(3);
            expect(shifted.extra.timedWorldInfoCheckpoint.timedWorldInfo.sticky.b.end).toBe(4);
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
