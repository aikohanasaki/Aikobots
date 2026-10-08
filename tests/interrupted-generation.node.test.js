import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const reasoning = fs.readFileSync(new URL('../public/scripts/reasoning.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const openai = fs.readFileSync(new URL('../public/scripts/openai.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const fallback = 'Only reasoning tokens were returned. No response text was generated.';

// Exercise production stream consumption, reasoning, finalization and save ordering without browser boot.
function declaration(source, signature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, signature);
    return source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
}

function setup({ type = 'normal', strip = false, saveFails = false, stale = false, prefixIncomplete = false } = {}) {
    const original = { mes: type === 'continue' ? 'Original. ' : '', extra: {}, uuid: 'message', swipes: ['Original. ', 'Other'], swipe_info: [{ uuid: 'first' }, { uuid: 'second' }], swipe_id: 0 };
    let saved = structuredClone(original);
    const calls = [];
    const context = {
        AbortController, Date, console: { error() {}, warn() {}, debug() {} },
        document: { querySelector: () => null }, HTMLElement: class {},
        power_user: { streaming_fps: 30, trim_sentences: true, auto_swipe: true, strip_ai_thinking_from_response: strip,
            allow_name1_display: true, allow_name2_display: true,
            reasoning: { auto_parse: true, prefix: '<think>', suffix: '</think>' } },
        chat: [structuredClone(original)], selected_group: null, scrollLock: true,
        name1: 'User', name2: 'Assistant', t: strings => strings.join(''),
        getStoppingStrings: () => [], getRegexedString: text => text, regex_placement: {},
        trimSpaces: value => String(value || '').trim(),
        trimToEndSentence: text => text.slice(0, text.lastIndexOf('.') + 1),
        shouldStripAiThinkingFromResponses: () => strip,
        THINK_TAG_REGEX: /<think\b[^>]*>[\s\S]*?<\/think>/gi,
        ReasoningType: { Model: 'model', Parsed: 'parsed' },
        ReasoningState: { None: 'none', Thinking: 'thinking', Done: 'done' },
        isHiddenReasoningModel: () => false,
        countOccurrences: () => 0, isOdd: () => false,
        messageFormatting: text => text, formatGenerationTimer: () => ({}),
        Stopwatch: class { async tick(fn) { await fn(); } },
        getCompletedClaudeToolTurnBlocks: () => [],
        eventSource: { emit: async event => { calls.push(event); } },
        event_types: { MESSAGE_BEFORE_PERSIST: 'before-save', MESSAGE_RECEIVED: 'received' },
        validateSwipeTarget: () => ({ ok: !stale, message: context.chat[0], messageId: 0, swipeId: 1, reason: 'stale' }),
        rejectStaleSwipeTarget: async () => { throw new Error('stale target'); },
        ensureSwipeTargetSlot: () => ({ ok: true }),
        createSwipeInfoExtra: extra => structuredClone(extra),
        replaceSwipeInfoPreservingIdentity: (old, value) => ({ ...old, ...value }), uuidv4: () => 'new-id',
        AIKOBOTS_SWIPE_UUID_KEY: 'uuid', GENERATION_RECOVERY_MARKER_KEY: 'generation', isValidAikobotsUuid: () => true,
        chatElement: { find: () => null }, addCopyToCodeBlocks() {},
        consumeOpenAIResponseData: () => ({}), applyTimedWorldInfoToMessage() {},
        applyPromptInspectionResponseDataToMessage() {}, applyWorldInfoResponseDataToMessage() {},
        commitLatestPromptInspectorRecord: async () => {}, syncMesToSwipe() {}, saveLogprobsForActiveMessage() {},
        CHAT_SAVE_RESULT: { SAVED: 'saved', FAILED: 'failed' },
        saveSqliteReplyMutation: async mutation => {
            calls.push(mutation.mutation);
            if (saveFails) return 'failed';
            saved = structuredClone(context.chat[0]);
            context.chat[0] = structuredClone(saved);
            return 'saved';
        },
        reloadCurrentChat: async () => { context.chat[0] = structuredClone(saved); calls.push('reload'); },
        acknowledgeGenerationRecovery: async () => { calls.push('ack'); },
        clearPendingGeneration: () => { calls.push('clear'); },
        isPendingStreamingSqliteMutationActive: () => true,
        clearPendingStreamingSqliteMutation: () => {},
        exhaustedGenerationRecoveries: new Set(),
        unblockGeneration: () => { calls.push('unblock'); },
        playMessageSound() {}, generatedTextFiltered: () => true,
        swipe: async () => { throw new Error('must not auto-swipe'); },
    };
    vm.createContext(context);
    const helpers = ['stripThinkTagsFromString', 'clearStoredReasoningFields', 'stripThinkingFromMessage', 'prepareInterruptedResponse']
        .map(name => declaration(reasoning, `${name === 'prepareInterruptedResponse' ? 'export ' : ''}function ${name}(`));
    vm.runInContext(`${helpers.join('\n')}\n${declaration(reasoning, 'export class ReasoningHandler')}\n${declaration(script, 'export function cleanUpMessage(')}\n${declaration(script, 'class StreamingProcessor')}\nthis.Processor = StreamingProcessor;`, context);
    const processor = new context.Processor(type, new Date(), original.mes, { prefixIncomplete, prefixReasoningFormatted: '<think>old', prefixReasoning: 'old' }, { swipeUuid: 'second' });
    processor.messageId = 0;
    processor.messageDom = {};
    processor.messageTextDom = {};
    processor.reasoningHandler.updateDom = () => {};
    processor.setFirstSwipe = () => {};
    if (prefixIncomplete) processor.reasoningHandler.initContinue(processor.promptReasoning);
    return { processor, context, calls, original, saved: () => saved };
}

async function failStream(env, { text = '', state = {}, error = new Error('HTTP 503'), renderFailure = false } = {}) {
    env.processor.generator = async function* () {
        yield { text, state, toolCalls: [{ incomplete: true }] };
        throw error;
    };
    env.processor.generator.generationId = 'job';
    if (renderFailure) env.context.messageFormatting = () => { throw new Error('render failure'); };
    return env.processor.generate();
}

test('503 retains an unfinished answer through production finalization and reload', async () => {
    const env = setup();
    const text = await failStream(env, { text: 'A useful unfinished sentence' });
    assert.equal(env.processor.interrupted, true);
    assert.equal(env.processor.isStopped, false);
    assert.equal(env.calls.includes('ack'), false);
    await env.processor.onFinishStreaming(0, text);
    await env.context.reloadCurrentChat();
    assert.equal(env.context.chat[0].mes, text);
    assert.deepEqual(env.calls.filter(x => ['before-save', 'append', 'ack', 'received'].includes(x)), ['before-save', 'append', 'ack', 'received']);
});

test('reasoning-only errors honor stripping, including interrupted inline blocks', async () => {
    for (const strip of [false, true]) {
        for (const text of ['', '<think>Some reasoning', '<think>Some reasoning</think>']) {
            const env = setup({ strip });
            const result = await failStream(env, { text, state: text ? {} : { reasoning: 'Some reasoning', signature: 'signature' } });
            await env.processor.onFinishStreaming(0, result);
            if (strip) {
                assert.equal(env.saved().mes, fallback);
                assert.equal(env.saved().extra.reasoning, undefined);
                assert.equal(env.saved().extra.reasoning_signature, undefined);
            } else {
                assert.equal(env.saved().mes, '');
                assert.equal(env.saved().extra.reasoning, 'Some reasoning');
            }
        }
    }
});

test('mixed answer and reasoning strips reasoning without trimming the answer', async () => {
    const env = setup({ strip: true });
    const result = await failStream(env, { text: '<think>Some reasoning</think>Useful partial', state: { signature: 'signature' } });
    await env.processor.onFinishStreaming(0, result);
    assert.equal(env.saved().mes, 'Useful partial');
    assert.equal(env.saved().extra.reasoning_signature, undefined);
});

test('stripped reasoning detection handles custom delimiters and disabled auto-parsing', async () => {
    for (const autoParse of [false, true]) {
        const env = setup({ strip: true });
        env.context.power_user.reasoning.auto_parse = autoParse;
        const prefix = autoParse ? '[reason]' : '<think>';
        env.context.power_user.reasoning.prefix = prefix;
        env.context.power_user.reasoning.suffix = '[/reason]';
        const result = await failStream(env, { text: prefix + 'Some reasoning' });
        await env.processor.onFinishStreaming(0, result);
        assert.equal(env.saved().mes, fallback);
    }
});

test('Continue and swipe use existing messages and preserve other variants', async () => {
    for (const type of ['continue', 'swipe']) {
        const env = setup({ type });
        const result = await failStream(env, { text: 'More text' });
        await env.processor.onFinishStreaming(0, env.processor.continueMessage + result);
        assert.equal(env.saved().mes, type === 'continue' ? 'Original. More text' : 'More text');
        assert.equal(env.saved().uuid, 'message');
        assert.equal(env.saved().swipe_info[1].uuid, 'second');
        assert.equal(env.saved().swipes[type === 'continue' ? 1 : 0], type === 'continue' ? 'Other' : 'Original. ');
        assert.equal(env.calls.filter(x => x === 'update').length, 1);
    }
    const env = setup({ type: 'continue', strip: true, prefixIncomplete: true });
    const result = await failStream(env, { text: 'more reasoning' });
    await env.processor.onFinishStreaming(0, env.processor.continueMessage + result);
    assert.equal(env.saved().mes, 'Original. ' + fallback);
});

test('empty responses, render failures and recovery disconnects do not become saved answers', async () => {
    for (const options of [{ text: '' }, { text: '  ' }, { text: 'Useful', renderFailure: true },
        { text: 'Useful', error: Object.assign(new Error('reconnect'), { generationRecoveryAvailable: true }) }]) {
        const env = setup();
        await failStream(env, options);
        assert.equal(env.processor.interrupted, false);
        assert.equal(env.processor.isStopped, true);
        assert.equal(env.calls.includes('append'), false);
        if (options.error) assert.equal(env.calls.includes('ack'), false);
    }
    const env = setup({ type: 'continue', prefixIncomplete: true });
    await failStream(env);
    assert.equal(env.processor.interrupted, false, 'old reasoning cannot qualify an empty continuation');
});

test('normal completion and manual Stop retain their existing finalization behavior', async () => {
    for (const stopped of [false, true]) {
        const env = setup();
        env.context.power_user.auto_swipe = false;
        env.processor.generator = async function* () {
            yield { text: 'Complete. Incomplete', state: {}, toolCalls: [] };
            if (stopped) {
                env.processor.onStopStreaming();
                throw new Error('stopped');
            }
        };
        const result = await env.processor.generate();
        assert.equal(env.processor.interrupted, false);
        await env.processor.onFinishStreaming(0, result);
        assert.equal(env.saved().mes, 'Complete.');
    }
});

test('failed persistence and stale swipes never acknowledge or overwrite saved output', async () => {
    const env = setup({ saveFails: true });
    const result = await failStream(env, { text: 'Useful' });
    assert.equal(await env.processor.onFinishStreaming(0, result), false);
    assert.equal(env.calls.includes('ack'), false);
    assert.deepEqual(env.saved(), env.original);
    const stale = setup({ type: 'swipe', stale: true });
    await failStream(stale, { text: 'Useful' });
    assert.equal(stale.processor.interrupted, false);
    assert.deepEqual(stale.saved(), stale.original);
});

test('provider reasoning presence survives disabled reasoning display', () => {
    const env = setup({ strip: true });
    Object.assign(env.context, { oai_settings: { show_thoughts: false }, chat_completion_sources: { CUSTOM: 'custom' } });
    vm.runInContext(`${declaration(openai, 'export function getStreamingReply(')}\nthis.reply = getStreamingReply;`, env.context);
    const state = {};
    env.context.reply({ choices: [{ delta: { reasoning_content: 'Some reasoning' } }] }, state, { chatCompletionSource: 'custom' });
    assert.equal(state.receivedReasoning, true);
    assert.equal(state.reasoning, '');
});

test('interrupted finalization excludes tool calls and auto-continue', () => {
    assert.match(script, /canPerformToolCalls && isStreamFinished && !streamingProcessor\.interrupted/);
    assert.match(script, /finishedStreamingProcessor\.interrupted \|\| !transferGenerationToAutoContinue/);
});
