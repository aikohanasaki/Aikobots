import { beforeAll, describe, expect, it } from '@jest/globals';

let assembleChatCompletionPrompt;
let scanWorldInfo;

const worldInfoPosition = { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 };

beforeAll(async () => {
    ({ assembleChatCompletionPrompt } = await import('../src/prompting/chat-completion-assembly.js'));
    ({ scanWorldInfo } = await import('../src/prompting/world-info-scan.js'));
});

describe('world info entry separators', () => {
    it.each(['before', 'after', 'ANTop', 'ANBottom', 'atDepth', 'outlet'])('preserves string-path separators for %s', async (placement) => {
        const request = {
            chat: [],
            maxContext: 4096,
            worldInfoPosition,
            wiAnchorPosition: { before: 0, after: 1 },
            settings: { world_info_budget: 100, world_info_recursive: false },
            sortedEntries: [1, 2].map(uid => ({
                uid, world: 'SyntheticSeparators', order: 100 + uid,
                position: worldInfoPosition[placement], constant: true, depth: 2, role: 0,
                outletName: 'separatorTest', content: `ENTRY_${uid}.`,
                lorebookSettings: { budgetMode: 'default' },
            })),
        };
        const scan = await scanWorldInfo(request);
        const expected = {
            before: scan.worldInfoBefore,
            after: scan.worldInfoAfter,
            ANTop: scan.ANBeforeEntries.join('\n'),
            ANBottom: scan.ANAfterEntries.join('\n'),
            atDepth: scan.WIDepthEntries[0]?.entries.join('\n'),
            outlet: scan.outletEntries.separatorTest?.join('\n'),
        }[placement];
        expect(expected).toMatch(/ENTRY_\d\.\nENTRY_\d\./);

        const identifiers = ['main', 'worldInfoBefore', 'worldInfoAfter', 'chatHistory'];
        const assembly = await assembleChatCompletionPrompt({
            model: '', userName: 'User', charName: 'Assistant',
            serviceSettings: {
                openai_max_context: 4096, openai_max_tokens: 256,
                prompts: identifiers.map(identifier => ({ identifier, role: 'system', content: identifier === 'main' ? 'Main {{outlet::separatorTest}}' : '' })),
                prompt_order: [{ character_id: 1, order: identifiers.map(identifier => ({ identifier, enabled: true })) }],
            },
            activeCharacter: { id: 1 },
            oaiSettings: { wi_format: '', squash_system_messages: false },
            worldInfoRequest: request,
            extensionPrompts: { '2_floating_prompt': { value: 'Author note', position: 1, depth: 1, role: 0, scan: false } },
            messages: [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }],
        });

        expect(assembly.chat.some(message => message.content.includes(expected))).toBe(true);
    });
});
