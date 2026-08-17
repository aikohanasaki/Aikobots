import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

let applyLoadedMessageRange;
let buildChunkedChatPayload;
let getLogicalChatData;
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

describe('SQLite chat length handling', () => {
    beforeAll(async () => {
        const utilModule = await import('../src/util.js');
        utilModule.setConfigFilePath(getConfigPath());

        const chatsModule = await import('../src/endpoints/chats.js');
        applyLoadedMessageRange = chatsModule.applyLoadedMessageRange;
        buildChunkedChatPayload = chatsModule.buildChunkedChatPayload;
        getLogicalChatData = chatsModule.getLogicalChatData;
        writeLogicalChat = chatsModule.writeLogicalChat;
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
