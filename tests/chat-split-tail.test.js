import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

let applyLoadedMessageRange;
let buildChunkedChatPayload;
let ensureSplitTailStorage;
let getLogicalChatData;
let validateTailSavePayload;
let writeLogicalChat;

function getConfigPath() {
    const localPath = path.resolve(process.cwd(), 'config.yaml');
    if (fs.existsSync(localPath)) {
        return localPath;
    }

    return path.resolve(process.cwd(), '..', 'config.yaml');
}

function makeHeader() {
    return {
        user_name: 'User',
        character_name: 'Character',
        create_date: '2026-04-20',
        chat_metadata: {},
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

describe('split-tail chat storage', () => {
    beforeAll(async () => {
        const utilModule = await import('../src/util.js');
        utilModule.setConfigFilePath(getConfigPath());

        const chatsModule = await import('../src/endpoints/chats.js');
        applyLoadedMessageRange = chatsModule.applyLoadedMessageRange;
        buildChunkedChatPayload = chatsModule.buildChunkedChatPayload;
        ensureSplitTailStorage = chatsModule.ensureSplitTailStorage;
        getLogicalChatData = chatsModule.getLogicalChatData;
        validateTailSavePayload = chatsModule.validateTailSavePayload;
        writeLogicalChat = chatsModule.writeLogicalChat;
    });

    it('rejects sparse collapsed tail saves that would drop a middle range', () => {
        const result = validateTailSavePayload({
            existingMessageCount: 1000,
            absoluteStartId: 578,
            rangeMessages: makeMessages(300),
            savedMessageCount: 1000,
        });

        expect(result).toEqual({ ok: false, error: 'incomplete_tail_save' });
    });

    it('allows legitimate contiguous tail truncation', () => {
        const result = validateTailSavePayload({
            existingMessageCount: 1000,
            absoluteStartId: 578,
            rangeMessages: makeMessages(421),
            savedMessageCount: 999,
        });

        expect(result).toEqual({ ok: true });
    });

    it('allows deleting the entire writable tail', () => {
        const result = validateTailSavePayload({
            existingMessageCount: 1000,
            absoluteStartId: 578,
            rangeMessages: [],
            savedMessageCount: 578,
        });

        expect(result).toEqual({ ok: true });
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

    it('compacts an overlarge existing tail before serving chunked chat data', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-tail-chat-'));
        const chatPath = path.join(tempDir, 'chat.jsonl');

        try {
            writeLogicalChat(chatPath, makeHeader(), makeMessages(1000), {
                displayCount: 200,
                bufferMax: 500,
                tailStartId: 578,
            });

            ensureSplitTailStorage(chatPath, { displayCount: 100, bufferMax: 200 });
            const payload = buildChunkedChatPayload(chatPath, {
                count: 200,
                displayCount: 100,
                bufferMax: 200,
                includeParentPromptCache: true,
            });
            const logicalChat = getLogicalChatData(chatPath);

            expect(logicalChat).toHaveLength(1001);
            expect(payload.mode).toBe('split-tail');
            expect(payload.tailCount).toBe(100);
            expect(payload.loadedRangeStart).toBe(900);
            expect(payload.loadedRangeEnd).toBe(999);
            expect(payload.messages).toHaveLength(100);
            expect(payload.messages[0].mes).toBe('message 900');
            expect(payload.messages.at(-1).mes).toBe('message 999');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
