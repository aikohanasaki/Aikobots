import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let assembleChatCompletionPrompt;
let scanWorldInfo;

const worldInfoPosition = {
    before: 0,
    after: 1,
    EMTop: 2,
    EMBottom: 3,
    ANTop: 4,
    ANBottom: 5,
    atDepth: 6,
    outlet: 7,
};

const wiAnchorPosition = {
    before: 0,
    after: 1,
};

const ACTIVATION_ONLY_SENTINEL = 'ACTIVATION_ONLY_SENTINEL_7f4d8a82';
const INSERTED_FROM_SENTINEL = 'NORMAL_ENTRY_INSERTED_FROM_ACTIVATION_ONLY_SENTINEL';

function makeActivationOnlyEntries() {
    return [
        worldInfoPosition.before,
        worldInfoPosition.after,
        worldInfoPosition.EMTop,
        worldInfoPosition.EMBottom,
        worldInfoPosition.ANTop,
        worldInfoPosition.ANBottom,
        worldInfoPosition.atDepth,
        worldInfoPosition.outlet,
    ].map((position, index) => ({
        uid: index + 1,
        world: 'ActivationOnly',
        order: 1000 - index,
        position,
        depth: 2,
        role: 0,
        outletName: 'activationOnlyOutlet',
        content: `${ACTIVATION_ONLY_SENTINEL} position ${position}`,
        decorators: ['@@activate'],
        activationOnly: true,
        lorebookSettings: { budgetMode: 'default' },
    }));
}

function makeNormalRecursiveEntry(uid = 100) {
    return {
        uid,
        world: 'Inserted',
        order: 10,
        position: worldInfoPosition.before,
        key: [ACTIVATION_ONLY_SENTINEL],
        keysecondary: [],
        selective: false,
        content: INSERTED_FROM_SENTINEL,
        lorebookSource: 'chat',
        lorebookPriority: 4,
        lorebookSettings: { budgetMode: 'default' },
    };
}

function makeScanPayload() {
    return {
        chat: [],
        maxContext: 4096,
        worldInfoPosition,
        wiAnchorPosition,
        settings: {
            world_info_budget: 100,
            world_info_budget_cap: 0,
            world_info_recursive: true,
            world_info_max_recursion_steps: 5,
        },
        sortedEntries: [
            ...makeActivationOnlyEntries(),
            makeNormalRecursiveEntry(),
        ],
    };
}

function expectNoSentinel(value) {
    expect(JSON.stringify(value)).not.toContain(ACTIVATION_ONLY_SENTINEL);
}

beforeAll(async () => {
    const scanModule = await import('../src/prompting/world-info-scan.js');
    const assemblyModule = await import('../src/prompting/chat-completion-assembly.js');
    scanWorldInfo = scanModule.scanWorldInfo;
    assembleChatCompletionPrompt = assemblyModule.assembleChatCompletionPrompt;
});

describe('activation-only world info entries', () => {
    it('activates and recursively scans without inserting activation-only content', async () => {
        const result = await scanWorldInfo(makeScanPayload());

        expect(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)).toEqual(expect.arrayContaining([
            'ActivationOnly.1',
            'Inserted.100',
        ]));
        expect(result.worldInfoBefore).toContain(INSERTED_FROM_SENTINEL);

        expectNoSentinel(result.worldInfoBefore);
        expectNoSentinel(result.worldInfoAfter);
        expectNoSentinel(result.WIDepthEntries);
        expectNoSentinel(result.ANBeforeEntries);
        expectNoSentinel(result.ANAfterEntries);
        expectNoSentinel(result.EMEntries);
        expectNoSentinel(result.outletEntries);
        expectNoSentinel(result.structuredWorldInfo);

        const activationOnlyDebugEntry = result.worldInfo.activatedEntries.find(entry => entry.book === 'ActivationOnly' && entry.uid === 1);
        expect(activationOnlyDebugEntry).toMatchObject({
            activationOnly: true,
            inserted: false,
            notInsertedReason: 'activation_only',
            status: 'admitted',
        });
        expect(activationOnlyDebugEntry.displayContent).toContain(ACTIVATION_ONLY_SENTINEL);

        const insertedDebugEntry = result.worldInfo.activatedEntries.find(entry => entry.book === 'Inserted' && entry.uid === 100);
        expect(insertedDebugEntry).toMatchObject({
            activationOnly: false,
            inserted: true,
            status: 'admitted',
            lorebookSource: 'chat',
            lorebookPriority: 4,
        });
    });

    it('does not let activation-only content consume insertion budget or crowd out normal entries', async () => {
        const result = await scanWorldInfo({
            ...makeScanPayload(),
            maxContext: 30,
            settings: {
                world_info_budget: 100,
                world_info_budget_cap: 0,
                world_info_recursive: true,
                world_info_max_recursion_steps: 5,
            },
            sortedEntries: [
                {
                    uid: 1,
                    world: 'ActivationOnly',
                    order: 300,
                    position: worldInfoPosition.before,
                    content: 'A'.repeat(200),
                    decorators: ['@@activate'],
                    activationOnly: true,
                    lorebookSettings: { budgetMode: 'default' },
                },
                {
                    uid: 2,
                    world: 'Inserted',
                    order: 200,
                    position: worldInfoPosition.before,
                    content: 'small inserted entry',
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'default' },
                },
            ],
        });

        expect(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)).toEqual([
            'ActivationOnly.1',
            'Inserted.2',
        ]);
        expect(result.worldInfoBefore).toBe('small inserted entry');
        expect(result.worldInfo.budgetUsed.global.used).toBeLessThan(result.worldInfo.budgetUsed.global.limit);
    });

    it('keeps activation-only sentinel text out of assembled messages and prompt state', async () => {
        const assembly = await assembleChatCompletionPrompt({
            model: '',
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
            worldInfoRequest: makeScanPayload(),
            messages: [
                { role: 'user', content: 'hello' },
            ],
            extensionPrompts: {
                activationOnlyOutletConsumer: {
                    value: '{{outlet::activationOnlyOutlet}}',
                    position: 0,
                    role: 0,
                    scan: false,
                },
            },
        });

        expect(JSON.stringify(assembly.chat)).toContain(INSERTED_FROM_SENTINEL);
        expectNoSentinel(assembly.chat);
        expectNoSentinel(assembly.messagesState);
        expectNoSentinel(assembly.itemization);
    });
});

describe('author note world info assembly', () => {
    it('preserves a persona inserted at the bottom of the author note', async () => {
        const assembly = await assembleChatCompletionPrompt({
            model: '',
            userName: 'User',
            charName: 'Assistant',
            serviceSettings: {
                openai_max_context: 4096,
                openai_max_tokens: 256,
                prompts: [
                    { identifier: 'main', role: 'system', content: 'Main prompt' },
                    { identifier: 'chatHistory', role: 'system', content: '' },
                ],
                prompt_order: [
                    {
                        character_id: 1,
                        order: [
                            { identifier: 'main', enabled: true },
                            { identifier: 'chatHistory', enabled: true },
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
                worldInfoPosition,
                wiAnchorPosition,
                settings: {
                    world_info_budget: 100,
                    world_info_budget_cap: 0,
                    world_info_recursive: false,
                    world_info_max_recursion_steps: 1,
                },
                sortedEntries: [
                    {
                        uid: 1,
                        world: 'AuthorNoteTest',
                        order: 100,
                        position: worldInfoPosition.ANBottom,
                        constant: true,
                        content: 'World info at bottom',
                        lorebookSettings: { budgetMode: 'default' },
                    },
                ],
            },
            promptState: {
                modules: {
                    authorsNote: {
                        value: 'Author note\nPersona at bottom',
                        position: 1,
                        depth: 4,
                        scan: false,
                        role: 0,
                    },
                },
                prompts: [],
            },
            messages: [
                { role: 'user', content: 'hello' },
            ],
        });

        expect(assembly.chat).toContainEqual({
            role: 'system',
            content: 'Author note\nPersona at bottom\nWorld info at bottom',
        });
        expect(JSON.stringify(assembly.messagesState)).not.toContain('[object Object]');
    });
});
