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
});
