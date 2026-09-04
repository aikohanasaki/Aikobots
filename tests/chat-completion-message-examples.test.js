import { beforeAll, describe, expect, it } from '@jest/globals';

let assembleChatCompletionPrompt;

function makePayload(mesExamples) {
    return {
        model: '',
        userName: 'User',
        charName: 'Assistant',
        mesExamples,
        serviceSettings: {
            openai_max_context: 4096,
            openai_max_tokens: 256,
            prompts: [
                { identifier: 'main', role: 'system', content: '{{mesExamples}}' },
                { identifier: 'dialogueExamples', role: 'system', content: '' },
            ],
            prompt_order: [
                {
                    character_id: 1,
                    order: [
                        { identifier: 'main', enabled: true },
                        { identifier: 'dialogueExamples', enabled: true },
                    ],
                },
            ],
        },
        activeCharacter: { id: 1 },
        oaiSettings: {
            new_example_chat_prompt: 'Example boundary',
            squash_system_messages: false,
        },
    };
}

describe('chat completion message examples', () => {
    beforeAll(async () => {
        ({ assembleChatCompletionPrompt } = await import('../src/prompting/chat-completion-assembly.js'));
    });

    it('normalizes a missing initial marker and parses every example block', async () => {
        const result = await assembleChatCompletionPrompt(makePayload([
            'User: first question',
            'Assistant: first answer',
            '<START>',
            'User: second question',
            'Assistant: second answer',
        ].join('\n')));

        expect(result.examplesCount).toBe(2);
        expect(result.chat.map(message => message.content)).toEqual(expect.arrayContaining([
            'first question',
            'first answer',
            'second question',
            'second answer',
        ]));
        expect(result.chat.map(message => message.content)).toContain([
            '<START>',
            'User: first question',
            'Assistant: first answer',
            '<START>',
            'User: second question',
            'Assistant: second answer',
            '',
        ].join('\n'));
    });

    it('does not create an example block from an empty source or a lone marker', async () => {
        for (const mesExamples of ['', '<START>']) {
            const result = await assembleChatCompletionPrompt(makePayload(mesExamples));
            expect(result.examplesCount).toBe(0);
        }
    });

    it('preserves ordered Claude tool-turn blocks through prompt assembly', async () => {
        const blocks = [
            { type: 'thinking', thinking: 'synthetic thought', signature: 'synthetic signature' },
            { type: 'redacted_thinking', data: 'synthetic redacted data' },
            { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: 'test' } },
        ];
        const payload = makePayload('');
        payload.chatCompletionSource = 'claude';
        payload.canUseTools = true;
        payload.serviceSettings.prompts.push({ identifier: 'chatHistory', role: 'system', content: '' });
        payload.serviceSettings.prompt_order[0].order.push({ identifier: 'chatHistory', enabled: true });
        payload.messages = [{
            role: 'assistant',
            content: '',
            invocations: [{ id: 'tool-1', name: 'lookup', parameters: '{"q":"test"}', result: 'result' }],
            claude_tool_turn_blocks: blocks,
        }];

        const result = await assembleChatCompletionPrompt(payload);
        const toolMessage = result.chat.find(message => Array.isArray(message.tool_calls));
        expect(toolMessage.claude_tool_turn_blocks).toEqual(blocks);
    });
});
