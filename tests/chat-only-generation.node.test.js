import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');

// Exercise the production assembly boundary without booting the browser UI.
const assemblyStart = source.indexOf('    // Determine token limit', source.indexOf('async function generateInternal('));
const assemblyEnd = source.indexOf('    if (dryRun) {', source.indexOf('    await eventSource.emit(event_types.GENERATE_AFTER_DATA', assemblyStart));
assert.ok(assemblyStart > 0 && assemblyEnd > assemblyStart);
const assembly = source.slice(assemblyStart, assemblyEnd);
const maxContextStart = source.indexOf('export function getMaxContextSize(');
const maxContextEnd = source.indexOf('\n}\n', maxContextStart) + 3;
const maxContext = source.slice(maxContextStart, maxContextEnd).replace('export ', '');

function contextFor(type, prepared, stream) {
    const messages = [
        { uuid: 'user-id', name: 'User', mes: 'Hello', is_user: true },
        { uuid: 'assistant-id', name: 'Assistant', mes: 'A reply', swipes: ['A reply', 'Another reply'], swipe_id: 0 },
    ];
    const context = {
        console: { log() {}, debug() {}, warn() {} }, structuredClone,
        type, dryRun: false, isContinue: type === 'continue', serverPreparationSource: prepared ? { generationType: type } : null,
        serverPreflightCompleted: prepared, serverPreparedContinueBase: prepared && type === 'continue' ? 'A reply' : '',
        preparedOpenAIRequest: { generateData: { model: 'test-model', tools: [{ type: 'function' }], tool_choice: 'auto' } },
        coreChat: prepared ? [] : structuredClone(messages), chat: messages,
        oai_settings: { openai_max_context: 8192, openai_max_tokens: 512, continue_postfix: '\n', stream_openai: stream },
        power_user: { strip_examples: false, persona_description_lorebook: '' },
        // Old settings must neither affect the budget nor be erased.
        extension_settings: { cfg: { global: { guidance_scale: 4, negative_prompt: 'Old negative prompt' } } },
        getGuidanceScale: () => { throw new Error('Legacy CFG must not run'); },
        getTokenCountAsync: () => { throw new Error('Legacy string prompt must not be tokenized'); },
        chat_metadata: { cfg_guidance_scale: 4, timedWorldInfo: {} },
        runGenerationInterceptors: async () => false,
        setFloatingPrompt() {}, addPersonaDescriptionExtensionPrompt() {}, setExtensionPrompt() {},
        parseMesExamples: text => [text], setOpenAIMessages: chat => chat.map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.mes })),
        setOpenAIMessageExamples: examples => examples,
        getCoreChatPayloadForAssembly: (chat, preparation) => preparation ? [] : chat,
        buildServerAssemblyPayload: async payload => payload,
        getTagKeyForEntity: () => 'character', getCharaFilename: () => 'assistant',
        getPromptSnapshotTarget: () => ({ mesId: 1, swipeId: type === 'swipe' ? 1 : 0 }),
        getPromptSnapshotChatScope: () => 'test-chat', getWorldInfoRegexScripts: () => [],
        getCharacterExtraBooks: () => [], getForcedActivationEntriesSnapshot: () => [], getRegexScripts: () => [],
        getTokenizerModel: () => 'test-model',
        eventSource: { emit: async () => {} }, event_types: { GENERATE_AFTER_DATA: 'data' },
        inject_ids: { STORY_STRING: 'story' }, extension_prompt_types: { IN_CHAT: 1 }, METADATA_KEY: 'world',
        GENERATION_TYPE_TRIGGERS: ['normal', 'continue', 'swipe', 'quiet', 'impersonate', 'regenerate'],
        characters: [{ name: 'Assistant', avatar: 'assistant.png', data: { extensions: {} } }], this_chid: 0,
        selected_group: 'group-id', tag_map: {}, selected_world_info: [], world_info_include_names: true,
        world_info_depth: 2, world_info_min_activations: 0, world_info_min_activations_depth_max: 0,
        world_info_budget: 25, world_info_recursive: false, world_info_case_sensitive: false,
        world_info_match_whole_words: false, world_info_budget_cap: 0, world_info_use_group_scoring: false,
        world_info_max_recursion_steps: 0, world_info_position: 0, wi_anchor_position: 0,
        persona: 'Persona', description: 'Description', personality: 'Personality', charDepthPrompt: '',
        scenario: 'Scene', creatorNotes: '', mesExamples: 'Example dialogue', name2: 'Assistant',
        promptBias: '', quiet_prompt: 'Quiet instruction', quietImage: null, system: 'System', jailbreak: '',
        skipWIAN: false, swipeTarget: null,
    };
    return context;
}

for (const type of ['normal', 'continue', 'swipe', 'regenerate', 'quiet', 'impersonate']) {
    test(`${type} preserves chat assembly and identities for streamed and non-streamed requests`, async () => {
        for (const prepared of [false, true]) {
            for (const stream of [false, true]) {
                const context = contextFor(type, prepared, stream);
                const before = structuredClone({ chat: context.chat, metadata: context.chat_metadata, settings: context.extension_settings });
                const result = await vm.runInNewContext(`${maxContext}\n(async () => { ${assembly}\nreturn { generate_data, continue_mag }; })()`, context);
                const payload = result.generate_data.promptContext;
                assert.equal(payload.worldInfoRequest.maxContext, 7680);
                assert.equal(payload.worldInfoRequest.selectedGroup, true);
                assert.equal(payload.worldInfoRequest.activeSpeaker.name, 'Assistant');
                assert.equal(payload.type, type);
                assert.equal(payload.quietPrompt, 'Quiet instruction');
                assert.equal(payload.mesExamples, 'Example dialogue');
                assert.equal(payload.coreChat.length, prepared ? 0 : 2);
                if (!prepared) assert.equal(payload.messages[1].content, 'A reply');
                if (prepared) assert.equal(payload.toolBudgetData.tool_choice, 'auto');
                if (type === 'continue') {
                    assert.equal(result.continue_mag, 'A reply\n');
                    assert.equal(payload.cyclePrompt, 'A reply\n');
                }
                assert.equal(Boolean(payload.promptInspection), !['quiet', 'impersonate'].includes(type));
                if (type === 'swipe') assert.equal(payload.promptInspection.swipeId, 1);
                assert.deepEqual({ chat: context.chat, metadata: context.chat_metadata, settings: context.extension_settings }, before);
            }
        }
    });
}

test('continuations preserve an existing trailing space without adding the postfix', async () => {
    for (const prepared of [false, true]) {
        for (const stream of [false, true]) {
            const context = contextFor('continue', prepared, stream);
            const base = 'A reply ';
            context.chat.at(-1).mes = base;
            if (prepared) {
                context.serverPreparedContinueBase = base;
            } else {
                context.coreChat.at(-1).mes = base;
            }
            const result = await vm.runInNewContext(`${maxContext}\n(async () => { ${assembly}\nreturn { generate_data, continue_mag }; })()`, context);
            assert.equal(result.continue_mag, base);
            assert.equal(result.generate_data.promptContext.cyclePrompt, base);
        }
    }
});

test('raw text becomes chat messages and unsupported API selections fail before dispatch', async () => {
    const start = source.indexOf('export function createRawPrompt(');
    const end = source.indexOf('\n}\n', start) + 3;
    const create = vm.runInNewContext(source.slice(start, end).replace('export ', '') + '; createRawPrompt', { substituteParams: value => value });
    assert.deepEqual(JSON.parse(JSON.stringify(create(' Hello ', 'openai', false, ' Rules ', 'Answer:'))), [
        { role: 'system', content: 'Rules' }, { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Answer:' },
    ]);
    assert.throws(() => create('Hello', 'textgenerationwebui', false), /Unsupported API/);
    const calls = [];
    const rawStart = source.indexOf('export async function generateRaw(');
    const rawEnd = source.indexOf('\nclass TempResponseLength', rawStart);
    const generate = vm.runInNewContext(source.slice(rawStart, rawEnd).replace('export ', '') + '; generateRaw', {
        createRawPrompt: create, AbortController, main_api: 'openai',
        event_types: { GENERATION_STOPPED: 'stop', CHAT_COMPLETION_PROMPT_READY: 'ready' },
        eventSource: { on() {}, removeListener() {}, emit: async (event, payload) => { calls.push([event, payload]); } },
        sendOpenAIRequest: async (_type, messages) => { calls.push(['request', messages]); return 'Reply'; },
        extractMessageFromData: value => value, cleanUpMessage: ({ getMessage }) => getMessage,
    });
    assert.equal(await generate({ prompt: 'Hello' }), 'Reply');
    assert.equal(calls[0][0], 'ready');
    assert.equal(calls[1][0], 'request');
    assert.equal(calls[1][1][0].role, 'user');
    await assert.rejects(generate({ prompt: 'Hello', api: 'novel' }), /Unsupported API/);
    assert.equal(calls.length, 2);
});

test('overlapping response-length overrides restore the original chat setting', () => {
    const start = source.indexOf('class TempResponseLength {');
    const end = source.indexOf('\n}\n', start) + 3;
    const settings = { openai_max_tokens: 512 };
    const lengths = vm.runInNewContext(source.slice(start, end) + '; TempResponseLength', {
        oai_settings: settings, console: { log() {} },
    });
    const first = lengths.save('openai', 128);
    const second = lengths.save('openai', 256);
    lengths.restore(first);
    assert.equal(settings.openai_max_tokens, 256);
    lengths.restore(second);
    assert.equal(settings.openai_max_tokens, 512);
    assert.throws(() => lengths.save('novel', 100), /Unsupported API/);
    assert.equal(settings.openai_max_tokens, 512);
});
