import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
    ChatPathValidationError,
    resolveDirectChatFilePath,
    resolveGroupChatFilePath,
    resolveGroupChatStoragePaths,
} from '../chat-paths.js';

describe('chat path helpers', () => {
    it('resolves group chat storage companions inside the group chat directory', () => {
        const groupChatsDirectory = path.resolve('data', 'group chats');
        const paths = resolveGroupChatStoragePaths(groupChatsDirectory, 'chat-123');

        expect(paths.chatId).toBe('chat-123');
        expect(paths.jsonlPath).toBe(path.join(groupChatsDirectory, 'chat-123.jsonl'));
        expect(paths.sqlitePath).toBe(path.join(groupChatsDirectory, 'chat-123.sqlite'));
    });

    it('normalizes existing group chat file names to the same storage companions', () => {
        const groupChatsDirectory = path.resolve('data', 'group chats');
        const jsonlPaths = resolveGroupChatStoragePaths(groupChatsDirectory, 'chat-123.jsonl');
        const sqlitePaths = resolveGroupChatStoragePaths(groupChatsDirectory, 'chat-123.sqlite');

        expect(jsonlPaths).toEqual(sqlitePaths);
        expect(jsonlPaths.jsonlPath).toBe(path.join(groupChatsDirectory, 'chat-123.jsonl'));
        expect(jsonlPaths.sqlitePath).toBe(path.join(groupChatsDirectory, 'chat-123.sqlite'));
    });

    it('resolves valid direct and group chat file names', () => {
        const chatsDirectory = path.resolve('data', 'chats');
        const groupChatsDirectory = path.resolve('data', 'group chats');

        expect(resolveDirectChatFilePath(chatsDirectory, 'avatar.png', 'chat-123'))
            .toBe(path.join(chatsDirectory, 'avatar', 'chat-123.sqlite'));
        expect(resolveDirectChatFilePath(chatsDirectory, 'avatar.png', 'chat-123.jsonl'))
            .toBe(path.join(chatsDirectory, 'avatar', 'chat-123.jsonl'));
        expect(resolveGroupChatFilePath(groupChatsDirectory, 'chat-123.sqlite'))
            .toBe(path.join(groupChatsDirectory, 'chat-123.sqlite'));
    });

    it('rejects split-head chat files for direct and group chat paths', () => {
        expect(() => resolveDirectChatFilePath(path.resolve('data', 'chats'), 'avatar.png', 'foo.head.jsonl'))
            .toThrow(ChatPathValidationError);
        expect(() => resolveGroupChatFilePath(path.resolve('data', 'group chats'), 'foo.head.jsonl'))
            .toThrow(ChatPathValidationError);
    });

    it('rejects split-head group chat IDs before normalizing file names', () => {
        expect(() => resolveGroupChatStoragePaths(path.resolve('data', 'group chats'), 'foo.head.jsonl'))
            .toThrow(ChatPathValidationError);
    });

    it.each([
        '',
        '.',
        '..',
        '../outside',
        '..\\outside',
        '/outside',
        'C:\\outside',
        'safe/../outside',
        '%2e%2e%2foutside',
        'safe%5coutside',
        'safe\0outside',
    ])('rejects unsafe group chat IDs before path resolution: %s', (chatId) => {
        expect(() => resolveGroupChatStoragePaths(path.resolve('data', 'group chats'), chatId))
            .toThrow(ChatPathValidationError);
    });
});
