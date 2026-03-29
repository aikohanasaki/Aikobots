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

    const cloningExtensionName = 'server-runtime-chat-clone-smoke';
    const cloningExtensionDir = path.join(tempRoot, cloningExtensionName);
    await fs.mkdir(cloningExtensionDir, { recursive: true });

    await fs.writeFile(
        path.join(cloningExtensionDir, 'manifest.json'),
        JSON.stringify({
            display_name: 'Server Runtime Chat Clone Smoke',
            loading_order: 3,
        }, null, 2),
        'utf8',
    );

    await fs.writeFile(
        path.join(cloningExtensionDir, 'server.js'),
        `export function setup(api) {
    api.registerGenerationInterceptor(async (context) => {
        context.chat[0].mes = 'mutated by extension';
        context.chat.push({ name: 'Intruder', mes: 'new message', is_user: false, extra: {} });
    });
}
`,
        'utf8',
    );

    const cloningPromptContext = {
        extensionSettings: {
            disabledExtensions: [
                `third-party/${extensionName}`,
                extensionName,
                `third-party/${raceExtensionName}`,
                raceExtensionName,
            ],
        },
        extensionPrompts: {},
        macroSnapshot: {},
        userName: 'User',
        charName: 'Assistant',
        groupNames: [],
        groupMacroValues: {},
        coreChat: [
            {
                name: 'Assistant',
                mes: 'original message',
                is_user: false,
                extra: {},
            },
        ],
        currentChatId: 'chat-clone',
        selectedGroup: false,
        groupId: null,
        groupName: '',
        groupMembers: [],
        type: 'normal',
        worldInfoRequest: {
            maxContext: 4096,
        },
    };

    const cloningResult = await runServerGenerationExtensions({ extensions: tempRoot }, cloningPromptContext);

    assert.equal(cloningResult.aborted, false);
    assert.equal(cloningPromptContext.coreChat[0].mes, 'original message');
    assert.equal(cloningPromptContext.coreChat.length, 1);

    console.log('PASS server runtime exposes chat as an isolated clone');

    const quotesExtensionName = 'server-runtime-wrap-quotes-smoke';
    const quotesExtensionDir = path.join(tempRoot, quotesExtensionName);
    await fs.mkdir(quotesExtensionDir, { recursive: true });

    await fs.writeFile(
        path.join(quotesExtensionDir, 'manifest.json'),
        JSON.stringify({
            display_name: 'Server Runtime Wrap Quotes Smoke',
            loading_order: 4,
        }, null, 2),
        'utf8',
    );

    await fs.writeFile(
        path.join(quotesExtensionDir, 'server.js'),
        `export function setup(api) {
    api.registerPromptProvider(async () => {});
}
`,
        'utf8',
    );

    const quotesPromptContext = {
        extensionSettings: {
            disabledExtensions: [
                `third-party/${extensionName}`,
                extensionName,
                `third-party/${raceExtensionName}`,
                raceExtensionName,
                `third-party/${cloningExtensionName}`,
                cloningExtensionName,
            ],
        },
        extensionPrompts: {},
        macroSnapshot: {},
        userName: 'User',
        charName: 'Assistant',
        groupNames: [],
        groupMacroValues: {},
        coreChat: [
            {
                name: 'User',
                mes: '"Already quoted"',
                is_user: true,
                extra: {},
            },
            {
                name: 'User',
                mes: 'Needs quotes',
                is_user: true,
                extra: {},
            },
        ],
        oaiSettings: {
            wrap_in_quotes: true,
        },
        currentChatId: 'chat-quotes',
        selectedGroup: false,
        groupId: null,
        groupName: '',
        groupMembers: [],
        type: 'normal',
        worldInfoRequest: {
            maxContext: 4096,
        },
    };

    const quotesResult = await runServerGenerationExtensions({ extensions: tempRoot }, quotesPromptContext);

    assert.equal(quotesResult.aborted, false);
    assert.equal(quotesPromptContext.messages[0].content, '"Needs quotes"');
    assert.equal(quotesPromptContext.messages[1].content, '"Already quoted"');

    console.log('PASS server runtime avoids double-wrapping quoted user content');

    const orderingExtensions = [
        {
            name: 'server-runtime-invalid-order-zeta-smoke',
            displayName: 'Zeta Invalid Order',
            loadingOrder: 'first',
        },
        {
            name: 'server-runtime-order-alpha-smoke',
            displayName: 'Alpha Ordered',
            loadingOrder: 1,
        },
        {
            name: 'server-runtime-order-beta-smoke',
            displayName: 'Beta Ordered',
            loadingOrder: 2,
        },
    ];

    for (const extension of orderingExtensions) {
        const orderingExtensionDir = path.join(tempRoot, extension.name);
        await fs.mkdir(orderingExtensionDir, { recursive: true });

        await fs.writeFile(
            path.join(orderingExtensionDir, 'manifest.json'),
            JSON.stringify({
                display_name: extension.displayName,
                loading_order: extension.loadingOrder,
            }, null, 2),
            'utf8',
        );

        await fs.writeFile(
            path.join(orderingExtensionDir, 'server.js'),
            `export function setup(api) {
    api.registerPromptProvider(async () => {});
}
`,
            'utf8',
        );
    }

    const orderingPromptContext = {
        extensionSettings: {
            disabledExtensions: [
                `third-party/${extensionName}`,
                extensionName,
                `third-party/${raceExtensionName}`,
                raceExtensionName,
                `third-party/${cloningExtensionName}`,
                cloningExtensionName,
                `third-party/${quotesExtensionName}`,
                quotesExtensionName,
            ],
        },
        extensionPrompts: {},
        macroSnapshot: {},
        userName: 'User',
        charName: 'Assistant',
        groupNames: [],
        groupMacroValues: {},
        coreChat: [],
        currentChatId: 'chat-ordering',
        selectedGroup: false,
        groupId: null,
        groupName: '',
        groupMembers: [],
        type: 'normal',
        worldInfoRequest: {
            maxContext: 4096,
        },
    };

    const orderingResult = await runServerGenerationExtensions({ extensions: tempRoot }, orderingPromptContext);

    assert.equal(orderingResult.aborted, false);
    assert.deepEqual(orderingResult.executedExtensions, [
        'third-party/server-runtime-invalid-order-zeta-smoke',
        'third-party/server-runtime-order-alpha-smoke',
        'third-party/server-runtime-order-beta-smoke',
    ]);

    console.log('PASS server runtime normalizes invalid loading_order values to zero');

    const brokenExtensionName = 'server-runtime-broken-load-smoke';
    const brokenExtensionDir = path.join(tempRoot, brokenExtensionName);
    await fs.mkdir(brokenExtensionDir, { recursive: true });

    await fs.writeFile(
        path.join(brokenExtensionDir, 'manifest.json'),
        JSON.stringify({
            display_name: 'Broken Load Smoke',
            loading_order: 5,
        }, null, 2),
        'utf8',
    );

    await fs.writeFile(
        path.join(brokenExtensionDir, 'server.js'),
        `throw new Error('broken extension load smoke');
`,
        'utf8',
    );

    const afterBrokenExtensionName = 'server-runtime-after-broken-smoke';
    const afterBrokenExtensionDir = path.join(tempRoot, afterBrokenExtensionName);
    await fs.mkdir(afterBrokenExtensionDir, { recursive: true });

    await fs.writeFile(
        path.join(afterBrokenExtensionDir, 'manifest.json'),
        JSON.stringify({
            display_name: 'After Broken Smoke',
            loading_order: 6,
        }, null, 2),
        'utf8',
    );

    await fs.writeFile(
        path.join(afterBrokenExtensionDir, 'server.js'),
        `export function setup(api) {
    api.registerPromptProvider(async (context) => {
        context.setExtensionPrompt('server_runtime_after_broken_smoke', 'loaded');
    });
}
`,
        'utf8',
    );

    const brokenLoadErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
        brokenLoadErrors.push(args.map(String).join(' '));
    };

    try {
        const brokenLoadPromptContext = {
            extensionSettings: {
                disabledExtensions: [
                    `third-party/${extensionName}`,
                    extensionName,
                    `third-party/${raceExtensionName}`,
                    raceExtensionName,
                    `third-party/${cloningExtensionName}`,
                    cloningExtensionName,
                    `third-party/${quotesExtensionName}`,
                    quotesExtensionName,
                    ...orderingExtensions.flatMap(extension => [`third-party/${extension.name}`, extension.name]),
                ],
            },
            extensionPrompts: {},
            macroSnapshot: {},
            userName: 'User',
            charName: 'Assistant',
            groupNames: [],
            groupMacroValues: {},
            coreChat: [],
            currentChatId: 'chat-broken-load',
            selectedGroup: false,
            groupId: null,
            groupName: '',
            groupMembers: [],
            type: 'normal',
            worldInfoRequest: {
                maxContext: 4096,
            },
        };

        const brokenLoadResult = await runServerGenerationExtensions({ extensions: tempRoot }, brokenLoadPromptContext);

        assert.equal(brokenLoadResult.aborted, false);
        assert.deepEqual(brokenLoadResult.executedExtensions, [
            `third-party/${afterBrokenExtensionName}`,
        ]);
        assert.equal(
            brokenLoadPromptContext.extensionPrompts.server_runtime_after_broken_smoke?.value,
            'loaded',
        );
        assert.equal(
            brokenLoadErrors.some(message => message.includes(`Failed to load extension third-party/${brokenExtensionName}:`)),
            true,
        );
    } finally {
        console.error = originalConsoleError;
    }

    console.log('PASS server runtime isolates broken extension module loads');
} finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
}
