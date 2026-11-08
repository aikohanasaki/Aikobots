import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const extensions = fs.readFileSync(new URL('../public/scripts/extensions.js', import.meta.url), 'utf8');
const openai = fs.readFileSync(new URL('../public/scripts/openai.js', import.meta.url), 'utf8');
const presets = fs.readFileSync(new URL('../public/scripts/world-info-locks.js', import.meta.url), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function section(source, start, end) {
    source = source.replace(/\r\n/g, '\n');
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to).replaceAll('export ', '');
}

function makeContext() {
    const timers = new Map();
    let timerId = 0;
    const source = { generationType: 'normal', expectedRevision: 3, anchorMessageUuid: 'anchor', chatRef: { type: 'group', chatId: 'chat' } };
    const context = vm.createContext({
        Promise, structuredClone, AbortController, Response, JSON,
        console: { debug() {}, warn() {} },
        CHAT_SAVE_RESULT: { SAVED: 'saved', FAILED: 'failed' },
        chatRevisionOperationQueue: Promise.resolve(),
        chat_metadata: {}, chat: [{ mes: 'original tail' }], generationPreparationMetadata: new WeakMap(),
        t: strings => strings.join(''),
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id),
        debounce_timeout: { relaxed: 1000 },
        getActiveChatRevisionKey: () => 'chat',
        getServerGenerationSource: () => {
            const captured = structuredClone(source);
            context.generationPreparationMetadata.set(captured, JSON.stringify([context.chat_metadata, context.chat.at(-1)]));
            return captured;
        },
        getContext: () => ({ chatId: 'chat', saveMetadata: () => context.queueChatRevisionOperation(() => { source.expectedRevision++; return 'saved'; }) }),
    });
    context.generationPreparationMetadata.set(source, JSON.stringify([context.chat_metadata, context.chat.at(-1)]));
    vm.runInContext(section(extensions, 'let saveMetadataTimeout =', '/**\n * Provides an ability'), context);
    vm.runInContext(section(script, 'export function queueChatRevisionOperation(', 'function getSyncCurrentChatCooldownSeconds('), context);
    context.flushDebouncedChatSave = async () => {
        const result = await context.flushDebouncedMetadataSave();
        await vm.runInContext('chatRevisionOperationQueue', context);
        return result;
    };
    return { context, source, timers };
}

test('admission errors display fixed specific messages without exposing response content', () => {
    const context = vm.createContext({
        t: strings => strings.join(''), translate: value => value,
        checkQuotaError() {}, checkModerationError() {},
        formatProviderErrorMessage: error => error.message,
        toastr: { error() {} },
    });
    vm.runInContext(section(openai, 'export function tryParseStreamingError(', 'function getResponseErrorMessage('), context);
    for (const [code, message] of [
        ['generation_cancelled', 'Generation was cancelled.'],
        ['generation_user_limit_reached', 'Your generation queue is full. Wait for an existing generation to finish and try again.'],
        ['generation_queue_full', 'The generation queue is full. Please try again later.'],
        ['unknown', 'Generation could not start. Check the chat and try again.'],
    ]) {
        assert.throws(() => context.tryParseStreamingError({ status: 409 }, JSON.stringify({
            error: { code, stage: 'generation_admission', message: 'synthetic-sensitive-error' },
        })), error => error.message === message);
    }
});

test('deferred metadata precedes admission, and later saves wait only for snapshot acknowledgement', async () => {
    const { context, source } = makeContext();
    const original = context.getServerGenerationSource();
    context.saveMetadataDebounced();
    const entered = deferred();
    const acknowledged = deferred();
    const admission = context.queueGenerationAdmission(original, current => {
        assert.equal(current.expectedRevision, 4);
        entered.resolve();
        return acknowledged.promise;
    });
    await entered.promise;
    let saved = false;
    const laterSave = context.queueChatRevisionOperation(() => { saved = true; source.expectedRevision++; });
    await Promise.resolve();
    assert.equal(saved, false);
    acknowledged.resolve('admitted');
    assert.equal(await admission, 'admitted');
    await laterSave;
    assert.equal(saved, true);
    assert.equal(source.expectedRevision, 5);
});

test('in-flight metadata and newly scheduled metadata both finish, while failures remain retryable', async () => {
    const { context, timers } = makeContext();
    const first = deferred();
    let calls = 0;
    context.getContext = () => ({ chatId: 'chat', saveMetadata: () => ++calls === 1 ? first.promise : 'saved' });
    context.saveMetadataDebounced();
    [...timers.values()][0]();
    await Promise.resolve();
    context.saveMetadataDebounced();
    const flushed = context.flushDebouncedMetadataSave();
    first.resolve('saved');
    assert.equal(await flushed, 'saved');
    assert.equal(calls, 2);
    let fail = true;
    context.getContext = () => ({ chatId: 'chat', saveMetadata: () => fail ? 'failed' : 'saved' });
    context.saveMetadataDebounced();
    assert.equal(await context.flushDebouncedMetadataSave(), 'failed');
    fail = false;
    assert.equal(await context.flushDebouncedMetadataSave(), 'saved');
});

test('failed saves, changed anchors, cancellation and admission errors never strand the queue', async () => {
    for (const mode of ['save', 'anchor', 'cancel', 'admission', 'chat']) {
        const { context, source } = makeContext();
        const original = context.getServerGenerationSource();
        const controller = new AbortController();
        let called = false;
        if (mode === 'save') context.flushDebouncedChatSave = async () => 'failed';
        if (mode === 'anchor') source.anchorMessageUuid = 'changed';
        if (mode === 'cancel') controller.abort();
        if (mode === 'chat') context.flushDebouncedChatSave = async () => { context.getActiveChatRevisionKey = () => 'other'; return 'saved'; };
        await assert.rejects(context.queueGenerationAdmission(original, () => {
            called = true;
            throw new Error('Rejected');
        }, controller.signal));
        assert.equal(called, mode === 'admission');
        assert.equal(await context.queueChatRevisionOperation(() => 'released'), 'released');
    }
});

test('lost or invalid admission acknowledgements release the save queue and retain cancellation', async () => {
    const { context, source } = makeContext();
    vm.runInContext(section(openai, 'async function createDetachedGeneration(', '/** Bridges a reload'), context);
    context.uuidv4 = () => 'nonce';
    context.getRequestHeaders = () => ({});
    const cancelled = [];
    context.cancelGenerationWithConfirmation = id => { cancelled.push(id); return new Promise(() => {}); };
    const bodies = [];
    context.fetch = async (_url, options) => {
        bodies.push(options.body);
        if (bodies.length === 1) throw new Error('Lost acknowledgement');
        return Response.json({ id: 'job', snapshot_admitted: true, accepted_revision: 3 });
    };
    await assert.rejects(context.createDetachedGeneration('/generations', 'job', { prompt_context: { generationSource: source } }), /could not be confirmed/);
    assert.equal(bodies.length, 1);
    assert.equal(await context.queueChatRevisionOperation(() => 'saved'), 'saved');
    const requests = [];
    context.fetch = async url => { requests.push(url); return Response.json({ id: 'job' }); };
    await assert.rejects(context.createDetachedGeneration('/generations', 'job', { prompt_context: { generationSource: source } }), /could not be verified\. Reload the page before trying again\./);
    assert.deepEqual(requests, ['/generations']);
    assert.deepEqual(cancelled, ['job', 'job']);
});

test('Stop aborts admission immediately without waiting for cancellation, and failed preparation leaves no recovery record', async () => {
    const { context, source } = makeContext();
    vm.runInContext(section(openai, 'async function createDetachedGeneration(', '/** Bridges a reload'), context);
    const controller = new AbortController();
    const requests = [];
    let recoveries = 0;
    let cancellations = 0;
    Object.assign(context, {
        uuidv4: () => 'nonce', getRequestHeaders: () => ({}), delay: async () => {},
        savePendingGeneration: () => recoveries++,
        cancelGenerationWithConfirmation: () => { cancellations++; return new Promise(() => {}); },
        fetch: async (url, options) => {
            requests.push({ url, body: options.body });
            if (requests.length === 1) { controller.abort(); throw new Error('Connection lost'); }
            return Response.json({ id: 'job', snapshot_admitted: true, accepted_revision: 3 });
        },
    });
    await assert.rejects(context.createDetachedGeneration('/generations', 'job', { prompt_context: { generationSource: source } }, {}, controller.signal));
    assert.equal(recoveries, 1);
    assert.equal(requests.length, 1);
    assert.equal(cancellations, 1);
    assert.equal(await context.queueChatRevisionOperation(() => 'saved'), 'saved');
    context.flushDebouncedChatSave = async () => 'failed';
    await assert.rejects(context.createDetachedGeneration('/generations', 'other', { prompt_context: { generationSource: source } }, {}));
    assert.equal(recoveries, 1);
});

test('a metadata change during preparation cannot be relabelled with a newer revision', async () => {
    const { context, source } = makeContext();
    const original = context.getServerGenerationSource();
    context.flushDebouncedChatSave = async () => {
        context.chat_metadata.world_info = 'synthetic-new-book';
        source.expectedRevision++;
        return 'saved';
    };
    let admitted = false;
    await assert.rejects(context.queueGenerationAdmission(original, () => { admitted = true; }), /chat changed/);
    assert.equal(admitted, false);
});

test('an admission with no response times out and releases queued saves', async () => {
    const { context, source, timers } = makeContext();
    vm.runInContext(section(openai, 'async function createDetachedGeneration(', '/** Bridges a reload'), context);
    const started = deferred();
    let cancellations = 0;
    Object.assign(context, {
        uuidv4: () => 'nonce', getRequestHeaders: () => ({}),
        cancelGenerationWithConfirmation: () => { cancellations++; return new Promise(() => {}); },
        fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            started.resolve();
        }),
    });
    const admission = context.createDetachedGeneration('/generations', 'job', { prompt_context: { generationSource: source } });
    const rejected = assert.rejects(admission, /could not be confirmed/);
    await started.promise;
    const laterSave = context.queueChatRevisionOperation(() => 'saved');
    [...timers.values()][0]();
    await rejected;
    assert.equal(await laterSave, 'saved');
    assert.equal(cancellations, 1);
});

test('preset readiness awaits loading and rejects stale context completion', async () => {
    const { context } = makeContext();
    const refreshed = deferred();
    let current = 'first';
    let applied = 0;
    Object.assign(context, {
        getPresetContextKey: () => current,
        refreshStandaloneUniverses: () => refreshed.promise,
        getContextLock: () => 'locked', findPreset: () => ({ name: 'locked' }),
        getPresetEligibleNames: () => [], applyWorldInfoPresetSelection: () => applied++,
        settings: {}, saveSettingsDebounced() {}, renderPresetSelect() {}, showNotification() {},
    });
    vm.runInContext('let contextRefreshTimer = null; let contextRefreshPromise = Promise.resolve(true); let presetApplicationPromise = Promise.resolve(true); let presetApplicationVersion = 0; let presetReadinessFailed = false;'
        + section(presets, 'function activatePreset(', 'function makeCheckbox('), context);
    context.scheduleContextRefresh();
    const ready = context.waitForWorldInfoPreset();
    assert.equal(applied, 0);
    refreshed.resolve(true);
    await ready;
    assert.equal(applied, 1);
    const second = deferred();
    context.refreshStandaloneUniverses = () => second.promise;
    context.scheduleContextRefresh();
    const stale = context.waitForWorldInfoPreset();
    current = 'second';
    second.resolve(true);
    await assert.rejects(stale, /chat changed/);
    assert.equal(applied, 1);
});

test('same-identity tail edits cannot adopt a newer revision with stale continuation text', async () => {
    const { context, source } = makeContext();
    const original = context.getServerGenerationSource();
    context.chat[0].mes = 'edited tail';
    source.expectedRevision++;
    let admitted = false;
    await assert.rejects(context.queueGenerationAdmission(original, () => { admitted = true; }), /chat changed/);
    assert.equal(admitted, false);
    assert.equal(await context.queueChatRevisionOperation(() => 'released'), 'released');
});

test('a missing locked preset falls back to no preset without blocking generation', async () => {
    const { context } = makeContext();
    const warnings = [];
    const errors = [];
    let renders = 0;
    let current = 'previous-chat';
    let selectedNames;
    Object.assign(context, {
        getPresetContextKey: () => current,
        getContextLock: () => 'synthetic-missing-preset', findPreset: () => null,
        refreshStandaloneUniverses: async () => true,
        getPresetEligibleNames: preset => preset?.worldList || [],
        applyWorldInfoPresetSelection: names => { selectedNames = names; },
        settings: {}, saveSettingsDebounced() {},
        renderPresetSelect: () => renders++,
        showNotification: (message, level) => warnings.push({ message, level }),
        toastr: { warning: message => warnings.push({ message, level: 'warning' }), error: message => errors.push(message) },
    });
    vm.runInContext('let contextRefreshTimer = null; let contextRefreshPromise = Promise.resolve(true); let presetApplicationPromise = Promise.resolve(true); let presetApplicationVersion = 0; let presetReadinessFailed = false;'
        + section(presets, 'function activatePreset(', 'function makeCheckbox('), context);
    await context.activatePreset({ name: 'previous', worldList: ['synthetic-previous-book'] }, { skipLockPrompt: true });
    current = 'current-chat';
    context.scheduleContextRefresh();
    await context.waitForWorldInfoPreset();
    await context.waitForWorldInfoPreset();
    assert.equal(context.settings.presetName, '');
    assert.deepEqual(selectedNames, []);
    assert.equal(renders, 2);
    assert.deepEqual(warnings, [{ message: 'The locked World Info preset no longer exists. Trying the default preset instead.', level: 'warning' }]);
    assert.deepEqual(errors, []);

    context.findPreset = () => ({ name: 'synthetic-missing-preset', worldList: ['synthetic-restored-book'] });
    context.scheduleContextRefresh();
    await context.waitForWorldInfoPreset();
    assert.equal(context.settings.presetName, 'synthetic-missing-preset');
    assert.deepEqual(selectedNames, ['synthetic-restored-book']);
});

test('a missing lock warns and waits for the default preset, retrying failed fallback application', async () => {
    const { context } = makeContext();
    const refreshed = deferred();
    const warnings = [];
    let available = false;
    let selectedNames = ['synthetic-previous-book'];
    Object.assign(context, {
        getPresetContextKey: () => 'current-chat',
        getContextLock: () => 'synthetic-missing-preset',
        findPreset: name => available && name === 'default' ? { name, worldList: ['synthetic-default-book'] } : null,
        refreshStandaloneUniverses: () => refreshed.promise,
        getPresetEligibleNames: preset => preset?.worldList || [],
        applyWorldInfoPresetSelection: names => { selectedNames = names; },
        settings: { presetName: 'previous', globalDefaultPreset: 'default', showLockNotifications: false },
        saveSettingsDebounced() {}, renderPresetSelect() {}, showNotification() {},
        toastr: { warning: message => warnings.push(message), error() {} },
    });
    vm.runInContext('let contextRefreshTimer = null; let contextRefreshPromise = Promise.resolve(true); let presetApplicationPromise = Promise.resolve(true); let presetApplicationVersion = 0; let presetReadinessFailed = false;'
        + section(presets, 'function activatePreset(', 'function makeCheckbox('), context);
    context.scheduleContextRefresh();
    await context.waitForWorldInfoPreset();
    assert.equal(context.settings.presetName, '');
    assert.deepEqual(selectedNames, []);
    available = true;
    context.scheduleContextRefresh();
    let ready = false;
    const pending = context.waitForWorldInfoPreset().then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false);
    assert.deepEqual(selectedNames, []);
    refreshed.resolve(false);
    await assert.rejects(pending, /preset could not be applied/);
    context.refreshStandaloneUniverses = async () => true;
    await context.waitForWorldInfoPreset();
    assert.equal(context.settings.presetName, 'default');
    assert.deepEqual(selectedNames, ['synthetic-default-book']);
    assert.equal(context.getContextLock(), 'synthetic-missing-preset');
    assert.ok(warnings.includes('The locked World Info preset no longer exists. Trying the default preset instead.'));
});

test('a failed preset refresh is retried by the next generation attempt', async () => {
    const { context } = makeContext();
    let calls = 0;
    Object.assign(context, {
        getPresetContextKey: () => 'same-chat',
        refreshStandaloneUniverses: async () => ++calls > 1,
        getContextLock: () => 'locked', findPreset: () => ({ name: 'locked' }),
        getPresetEligibleNames: () => [], applyWorldInfoPresetSelection() {},
        settings: {}, saveSettingsDebounced() {}, renderPresetSelect() {}, showNotification() {},
        toastr: { warning() {} },
    });
    vm.runInContext('let contextRefreshTimer = null; let contextRefreshPromise = Promise.resolve(true); let presetApplicationPromise = Promise.resolve(true); let presetApplicationVersion = 0; let presetReadinessFailed = false;'
        + section(presets, 'function activatePreset(', 'function makeCheckbox('), context);
    context.scheduleContextRefresh();
    await assert.rejects(context.waitForWorldInfoPreset(), /preset could not be applied/);
    await context.waitForWorldInfoPreset();
    assert.equal(calls, 2);
});

test('Stop during preparation cannot be replaced by a fresh controller', async () => {
    const { context } = makeContext();
    const preparing = deferred();
    const controller = new AbortController();
    Object.assign(context, {
        console: { log() {} }, enforceChatCompletionsOnlyMode() {}, blockIfEditing: () => false,
        setGenerationProgress() {}, unblockGeneration() {},
        waitForCurrentConnectionProfileTransition: () => preparing.promise,
        waitForWorldInfoPreset: async () => {}, abortController: controller,
        streamingProcessor: null, hideStopButton() {}, eventSource: { emit() {} }, event_types: {},
    });
    const prefix = section(script, 'async function generateInternal(', '    const isImpersonate =');
    vm.runInContext(prefix + 'return signal.aborted; }', context);
    vm.runInContext(section(script, 'export function stopGeneration()', '/**\n * Unblocks the UI'), context);
    const pending = context.generateInternal('normal', { signal: controller.signal });
    context.stopGeneration();
    preparing.resolve();
    await assert.rejects(pending, reason => reason === controller.signal.reason);
    assert.equal(controller.signal.aborted, true);
    assert.equal(context.abortController, controller);
});

test('streaming retains preparation cancellation alongside processor cancellation', async () => {
    const { context } = makeContext();
    const preparation = new AbortController();
    const processor = new AbortController();
    let requestSignal;
    Object.assign(context, {
        AbortSignal, main_api: 'openai', abortController: new AbortController(),
        streamingProcessor: { abortController: processor },
        sendOpenAIRequest: async (_type, _data, signal) => { requestSignal = signal; },
    });
    vm.runInContext(section(script, 'export async function sendStreamingRequest(', '/**\n * Gets the generation endpoint'), context);
    await context.sendStreamingRequest('normal', {}, { signal: preparation.signal });
    preparation.abort();
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(context.sendStreamingRequest('normal', {}, { signal: preparation.signal }));
});

test('recovery discovery cannot resume a job with pending or confirmed cancellation', async () => {
    const id = 'synthetic-cancelled-job';
    const context = vm.createContext({
        Set,
        listPendingGenerationCancellations: () => [id],
        cancelGenerationWithConfirmation: async () => false,
        getRequestHeaders: () => ({}),
        normalizePendingGeneration: record => record,
        fetch: async () => ({ ok: true, json: async () => ({ jobs: [{ generation_id: id, state: 'running', recovery: {} }] }) }),
    });
    vm.runInContext(section(script, 'async function getServerGenerationRecoveries(', '/** Detects a chat mutation'), context);
    assert.equal((await context.getServerGenerationRecoveries()).length, 0);
});
