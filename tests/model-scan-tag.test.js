import { beforeAll, describe, expect, it } from '@jest/globals';

const MODEL_ID = 'gpt-model-scan-test';
const MODEL_KEY = `MODEL=${MODEL_ID}`;
const MATCHED_CONTENT = 'MODEL_SPECIFIC_WORLD_INFO_MATCHED';
const STALE_CONTENT = 'STALE_MODEL_WORLD_INFO_MATCHED';

let assembleChatCompletionPrompt;

function makeWorldInfoEntry(uid, key, content) {
    return {
        uid,
        world: 'ModelScan',
        order: 100 - uid,
        position: 0,
        key: [key],
        keysecondary: [],
        selective: false,
        content,
        lorebookSettings: { budgetMode: 'default' },
    };
}

describe('core model World Info scan tag', () => {
    beforeAll(async () => {
        ({ assembleChatCompletionPrompt } = await import('../src/prompting/chat-completion-assembly.js'));
    });

    it('activates model-specific World Info without exposing the tag to the model', async () => {
        const assembly = await assembleChatCompletionPrompt({
            model: MODEL_ID,
            userName: 'User',
            charName: 'Assistant',
            serviceSettings: {
                openai_max_context: 4096,
                openai_max_tokens: 256,
                prompts: [
                    { identifier: 'main', role: 'system', content: '' },
                ],
                prompt_order: [
                    {
                        character_id: 1,
                        order: [
                            { identifier: 'main', enabled: true },
                        ],
                    },
                ],
            },
            activeCharacter: { id: 1 },
            oaiSettings: {
                wi_format: '',
                squash_system_messages: false,
            },
            worldInfoRequest: {
                chat: [],
                maxContext: 4096,
                worldInfoPosition: { before: 0, after: 1, EMTop: 2, EMBottom: 3, ANTop: 4, ANBottom: 5, atDepth: 6, outlet: 7 },
                wiAnchorPosition: { before: 0, after: 1 },
                settings: {
                    world_info_budget: 100,
                    world_info_budget_cap: 0,
                    world_info_recursive: false,
                    world_info_max_recursion_steps: 1,
                },
                sortedEntries: [
                    makeWorldInfoEntry(1, MODEL_KEY, MATCHED_CONTENT),
                    makeWorldInfoEntry(2, 'MODEL=stale-model', STALE_CONTENT),
                ],
            },
            messages: [
                { role: 'user', content: 'hello' },
            ],
            extensionPrompts: {
                'script_inject_core-model-tag': {
                    value: 'MODEL=stale-model',
                    position: -1,
                    depth: 4,
                    scan: true,
                    role: 0,
                },
            },
        });

        const serializedPrompt = JSON.stringify({ chat: assembly.chat, messagesState: assembly.messagesState });
        expect(serializedPrompt).toContain(MATCHED_CONTENT);
        expect(serializedPrompt).not.toContain(STALE_CONTENT);
        expect(serializedPrompt).not.toContain(MODEL_KEY);
    });
});
