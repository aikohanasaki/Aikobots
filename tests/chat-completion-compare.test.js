import { describe, expect, it } from '@jest/globals';
import { compareChatCompletionMessages } from '../src/prompting/chat-completion-compare.js';

describe('compareChatCompletionMessages', () => {
    it('reports a match for identical chats', () => {
        const chat = [
            { role: 'system', content: 'A' },
            { role: 'user', content: 'B', name: 'User_1' },
        ];

        const result = compareChatCompletionMessages(chat, structuredClone(chat));

        expect(result.matches).toBe(true);
        expect(result.differences).toEqual([]);
        expect(result.clientLength).toBe(2);
        expect(result.serverLength).toBe(2);
    });

    it('reports nested message differences with paths', () => {
        const clientChat = [
            {
                role: 'assistant',
                content: 'hello',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
            },
        ];
        const serverChat = [
            {
                role: 'assistant',
                content: 'hello',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }],
            },
        ];

        const result = compareChatCompletionMessages(clientChat, serverChat);

        expect(result.matches).toBe(false);
        expect(result.differences).toHaveLength(1);
        expect(result.differences).toEqual([
            expect.objectContaining({
                path: 'chat[0].tool_calls[0].function.name',
                reason: 'value_mismatch',
                client: 'lookup',
                server: 'search',
            }),
        ]);
    });

    it('caps the number of reported differences', () => {
        const clientChat = [
            { role: 'system', content: 'A' },
            { role: 'user', content: 'B' },
        ];
        const serverChat = [
            { role: 'assistant', content: 'X' },
            { role: 'tool', content: 'Y' },
        ];

        const result = compareChatCompletionMessages(clientChat, serverChat, { maxDifferences: 2 });

        expect(result.matches).toBe(false);
        expect(result.truncated).toBe(true);
        expect(result.differences).toHaveLength(2);
    });
});
