import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

let applyLoadedMessageRange;
let buildChunkedChatPayload;
let cloneSqliteMessageAfter;
let compileScene;
let getLogicalChatData;
let hasValidGroupChatPayload;
let insertLogicalMessageAfter;
let resolveSqliteLogicalChatReference;
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
        name: index % 2 === 0 ? 'User' : 'Character',
        is_user: index % 2 === 0,
        mes: `message ${index}`,
        send_date: index,
    }));
}

describe('SQLite chat length handling', () => {
    beforeAll(async () => {
        const utilModule = await import('../util.js');
        utilModule.setConfigFilePath(getConfigPath());

        const chatsModule = await import('../endpoints/chats.js');
        const sqliteModule = await import('../sqlite-manager.js');
        const stmbCoreModule = await import('../../public/scripts/stmb-core.js');
        applyLoadedMessageRange = chatsModule.applyLoadedMessageRange;
        buildChunkedChatPayload = chatsModule.buildChunkedChatPayload;
        cloneSqliteMessageAfter = chatsModule.cloneSqliteMessageAfter;
        compileScene = stmbCoreModule.compileScene;
        getLogicalChatData = chatsModule.getLogicalChatData;
        hasValidGroupChatPayload = chatsModule.hasValidGroupChatPayload;
        resolveSqliteLogicalChatReference = chatsModule.resolveSqliteLogicalChatReference;
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
        const rangeMessages = makeMessages(50).map((message, index) => ({
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
