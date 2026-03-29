import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { runServerGenerationExtensions } = await import('../src/extensions/server-runtime.js');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'st-server-runtime-'));

try {
    const extensionName = 'server-runtime-macro-smoke';
    const extensionDir = path.join(tempRoot, extensionName);
    await fs.mkdir(extensionDir, { recursive: true });

    await fs.writeFile(
        path.join(extensionDir, 'manifest.json'),
        JSON.stringify({
            display_name: 'Server Runtime Macro Smoke',
            loading_order: 1,
        }, null, 2),
        'utf8',
    );

    await fs.writeFile(
        path.join(extensionDir, 'server.js'),
        `export function setup(api) {
    api.registerMacroProvider(async (context) => {
        if (context.getSettings().enabled !== true) {
            throw new Error('current extension settings were not resolved');
        }

        if (context.getSettings('third-party/server-runtime-macro-smoke').enabled !== true) {
            throw new Error('current extension id alias was not resolved');
        }

        if (Object.keys(context.getSettings('missing-extension')).length !== 0) {
            throw new Error('missing extension settings should resolve to an empty object');
        }

        context.registerMacro('foo', 'Alpha');
        return { bar: 'Beta' };
    });

    api.registerPromptProvider(async (context) => {
        context.setExtensionPrompt('server_runtime_macro_smoke', context.substituteParams('Hello {{foo}} {{bar}}'));
    });
}
`,
        'utf8',
    );

    const promptContext = {
        extensionSettings: {
            'server-runtime-macro-smoke': {
                enabled: true,
            },
        },
        extensionPrompts: {},
        macroSnapshot: {},
        userName: 'User',
        charName: 'Assistant',
        groupNames: [],
        groupMacroValues: {},
        coreChat: [],
        currentChatId: 'chat-1',
        selectedGroup: false,
        groupId: null,
        groupName: '',
        groupMembers: [],
        type: 'normal',
        worldInfoRequest: {
            maxContext: 4096,
        },
    };

    const result = await runServerGenerationExtensions({ extensions: tempRoot }, promptContext);

    assert.equal(result.aborted, false);
    assert.deepEqual(result.executedExtensions, [`third-party/${extensionName}`]);
    assert.equal(
        promptContext.extensionPrompts.server_runtime_macro_smoke?.value,
        'Hello Alpha Beta',
    );

    console.log('PASS server runtime macro providers execute and register macros');

    const raceExtensionName = 'server-runtime-race-smoke';
    const raceExtensionDir = path.join(tempRoot, raceExtensionName);
    await fs.mkdir(raceExtensionDir, { recursive: true });

    await fs.writeFile(
        path.join(raceExtensionDir, 'manifest.json'),
        JSON.stringify({
            display_name: 'Server Runtime Race Smoke',
            loading_order: 2,
        }, null, 2),
        'utf8',
    );

    await fs.writeFile(
        path.join(raceExtensionDir, 'server.js'),
        `export async function setup(api) {
    globalThis.__serverRuntimeRaceSetupCount = (globalThis.__serverRuntimeRaceSetupCount || 0) + 1;
    await new Promise(resolve => setTimeout(resolve, 25));
    api.registerPromptProvider(async (context) => {
        context.setExtensionPrompt('server_runtime_race_smoke', 'ok');
    });
}
`,
        'utf8',
    );

    globalThis.__serverRuntimeRaceSetupCount = 0;

    const makeRacePromptContext = () => ({
        extensionSettings: {
            disabledExtensions: [
                `third-party/${extensionName}`,
                extensionName,
            ],
        },
        extensionPrompts: {},
        macroSnapshot: {},
        userName: 'User',
        charName: 'Assistant',
        groupNames: [],
        groupMacroValues: {},
        coreChat: [],
        currentChatId: 'chat-race',
        selectedGroup: false,
        groupId: null,
        groupName: '',
        groupMembers: [],
        type: 'normal',
        worldInfoRequest: {
            maxContext: 4096,
        },
    });

    const [raceResultA, raceResultB] = await Promise.all([
        runServerGenerationExtensions({ extensions: tempRoot }, makeRacePromptContext()),
        runServerGenerationExtensions({ extensions: tempRoot }, makeRacePromptContext()),
    ]);

    assert.equal(raceResultA.aborted, false);
    assert.equal(raceResultB.aborted, false);
    assert.equal(globalThis.__serverRuntimeRaceSetupCount, 1);

    console.log('PASS server runtime extension loads are deduplicated in flight');
} finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
}
