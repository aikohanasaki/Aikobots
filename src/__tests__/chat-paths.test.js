import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
    ChatPathValidationError,
    resolveGroupChatStoragePaths,
} from '../chat-paths.js';

describe('chat path helpers', () => {
    it('resolves group chat storage companions inside the group chat directory', () => {
        const groupChatsDirectory = path.resolve('data', 'group chats');
        const paths = resolveGroupChatStoragePaths(groupChatsDirectory, 'chat-123');

        expect(paths.chatId).toBe('chat-123');
        expect(paths.jsonlPath).toBe(path.join(groupChatsDirectory, 'chat-123.jsonl'));
        expect(paths.sqlitePath).toBe(path.join(groupChatsDirectory, 'chat-123.sqlite'));
        expect(paths.headPath).toBe(path.join(groupChatsDirectory, 'chat-123.head.jsonl'));
    });

    it('normalizes existing group chat file names to the same storage companions', () => {
        const groupChatsDirectory = path.resolve('data', 'group chats');
        const jsonlPaths = resolveGroupChatStoragePaths(groupChatsDirectory, 'chat-123.jsonl');
        const sqlitePaths = resolveGroupChatStoragePaths(groupChatsDirectory, 'chat-123.sqlite');

        expect(jsonlPaths).toEqual(sqlitePaths);
        expect(jsonlPaths.jsonlPath).toBe(path.join(groupChatsDirectory, 'chat-123.jsonl'));
        expect(jsonlPaths.sqlitePath).toBe(path.join(groupChatsDirectory, 'chat-123.sqlite'));
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
