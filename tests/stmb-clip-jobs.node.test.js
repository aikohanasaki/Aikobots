import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { stableHashString } from '../public/scripts/hashing.js';
import { buildStmbRetryPayload } from '../public/scripts/stmb-job-retry-policy.js';

const source = fs.readFileSync(new URL('../public/scripts/stmb-clips.js', import.meta.url), 'utf8');

function readFunction(name) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.notEqual(start, -1);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

function load(names, overrides = {}) {
    const sandbox = vm.createContext({
        structuredClone, stableHashString, tr: text => text,
        getLorebookStorageForRequest: () => 'user',
        toastr: { success() {}, error() {} },
        ...overrides,
    });
    vm.runInContext(names.map(readFunction).join('\n'), sandbox);
    return sandbox;
}

function context() {
    const controller = new AbortController();
    const states = [];
    const ctx = {
        signal: controller.signal,
        setState: (state, options) => states.push([state, options]),
        setResult: result => { ctx.result = result; },
        setDetail: detail => { ctx.detail = detail; },
    };
    return { controller, states, ctx };
}

const topicalJob = () => ({ lorebookName: 'Test Book', payload: {
    prompt: 'Synthetic prompt', profile: { name: 'Test profile' }, headline: 'Topic',
    saveContext: { mode: 'create', topic: 'Topic', lorebookName: 'Old name' },
} });

test('auto-accept waits for saving and forwards cancellation and rate-limit progress', async () => {
    const { controller, states, ctx } = context();
    let releaseSave;
    let savedContext;
    const save = new Promise(resolve => { releaseSave = resolve; });
    const sandbox = load(['clipJobGenerationOptions', 'executeTopicalClipJob'], {
        requestTopicalClipDraft: async (prompt, profile, options) => {
            assert.equal(prompt, 'Synthetic prompt');
            assert.equal(profile.name, 'Test profile');
            assert.equal(options.signal, controller.signal);
            options.onRateLimitWait({ delayMs: 100 });
            return 'Draft';
        },
        normalizeTopicalClipDraftBody: text => text,
        saveTopicalClipDraft: async (captured, draft, options) => {
            savedContext = captured;
            assert.equal(draft, 'Draft');
            assert.equal(options.signal, controller.signal);
            await save;
            return { mode: 'create' };
        },
    });
    const pending = sandbox.executeTopicalClipJob(topicalJob(), ctx);
    await setImmediate();
    assert.equal(savedContext.lorebookName, 'Test Book');
    assert.equal(ctx.result, undefined);
    assert.equal(states.at(-1)[0], 'saving');
    assert.equal(states[1][1].detail, 'Rate limited. Waiting to retry.');
    releaseSave();
    await pending;
    assert.equal(ctx.result.saved, true);
});

test('auto-accept cancels before saving and sanitizes generation/save failures', async () => {
    for (const failure of ['cancel', 'generate', 'save', 'protected']) {
        const { controller, ctx } = context();
        let saves = 0;
        const sandbox = load(['clipJobGenerationOptions', 'executeTopicalClipJob'], {
            getLorebookStorageForRequest: () => failure === 'protected' ? 'secure' : 'user',
            requestTopicalClipDraft: async () => {
                if (failure === 'generate') throw new Error('SYNTHETIC_PRIVATE_PROVIDER_BODY');
                if (failure === 'cancel') controller.abort();
                return 'Draft';
            },
            normalizeTopicalClipDraftBody: text => text,
            saveTopicalClipDraft: async () => { saves++; throw new Error('SYNTHETIC_PRIVATE_SOURCE'); },
        });
        await assert.rejects(sandbox.executeTopicalClipJob(topicalJob(), ctx), error => {
            assert.equal(error.message, failure === 'save' ? 'Failed to save Topical Clip.' : 'Topical Clip generation failed.');
            return true;
        });
        assert.equal(saves, failure === 'save' ? 1 : 0);
        assert.equal(ctx.result, undefined);
    }
});

test('waiting for a queued utility also settles on pre-execution cancellation', async () => {
    let listener;
    let unsubscribed = false;
    const store = { queue: [{ id: 'one' }], runningJobs: [], recentHistory: [] };
    const sandbox = load(['queueClipJob'], {
        enqueueStmbJob: () => ({ id: 'one', chatKey: 'chat' }),
        getStmbJobStoreSnapshot: () => store,
        subscribeToStmbJobs: callback => { listener = callback; return () => { unsubscribed = true; }; },
    });
    const queued = sandbox.queueClipJob({});
    store.queue = [];
    store.recentHistory = [{ id: 'one', state: 'canceled' }];
    listener();
    assert.equal((await queued.completion).state, 'canceled');
    assert.equal(unsubscribed, true);
});

test('compaction finishes at draft-ready; queue retry opens review without awaiting replacement', async () => {
    const { ctx } = context();
    let reviews = 0;
    const sandbox = load(['clipJobGenerationOptions', 'executeCompactionJob'], {
        requestCompaction: async (_entry, _kind, _template, profile, options) => {
            assert.equal(profile.name, 'Captured');
            assert.equal(options.signal, ctx.signal);
            return 'Short draft';
        },
        reviewCompactionDraft: () => { reviews++; return new Promise(() => {}); },
    });
    const job = { type: 'compaction', lorebookName: 'Book', payload: { profile: { name: 'Captured' } } };
    await sandbox.executeCompactionJob(job, ctx);
    assert.equal(ctx.result.compacted, 'Short draft');
    assert.equal(ctx.detail, 'Draft ready');
    assert.equal(reviews, 0);
    await sandbox.executeCompactionJob({ ...job, payload: buildStmbRetryPayload(job) }, ctx);
    assert.equal(reviews, 1);
});

test('compaction captures pending input separately from stored hash and returns review outcome', async () => {
    const entry = { uid: 7, comment: 'Test [STMB Clip]', content: 'Stored text' };
    let captured;
    let settled = 0;
    const data = { entries: { 7: entry } };
    const sandbox = load(['showCompactReviewPopup'], {
        buildStmbSceneContext: () => ({ chatId: 'Original chat' }),
        getCompactionEntryKind: () => 'clip', getCompactionProfileIndex: () => 0,
        getCompactionPromptTemplate: () => '{{ENTRY_CONTENT}}',
        validateCompactionPromptTemplate: () => null, buildCompactionPrompt: () => 'Captured prompt',
        runtime: { getProfile: () => ({ name: 'Captured' }), buildGenerateData: async () => ({ model: 'Captured model' }) },
        queueClipJob: input => {
            captured = structuredClone(input);
            entry.content = 'Concurrent edit';
            return { completion: Promise.resolve({ state: 'completed', lorebookName: 'Book', result: { compacted: 'Draft' } }) };
        },
        notifyCompactionRequestSettled: () => { settled++; },
        reviewCompactionDraft: async (name, payload, draft, lorebookData) => {
            assert.equal(name, 'Book');
            assert.equal(draft, 'Draft');
            assert.equal(lorebookData, data);
            assert.equal(settled, 1);
            assert.equal(payload.expectedContentHash, stableHashString('Stored text'));
            return false;
        },
    });
    assert.equal(await sandbox.showCompactReviewPopup('Book', data, entry, { skipPromptStep: true, pendingContent: 'Unsaved addition' }), false);
    assert.equal(captured.payload.entry.content, 'Unsaved addition');
    assert.equal(captured.sceneContext.chatId, 'Original chat');
    assert.equal(captured.payload.profile.name, 'Captured');
    assert.equal(captured.payload.generateData.model, 'Captured model');
});

test('failed or canceled compaction never opens review or reports a ready draft', async () => {
    for (const canceled of [false, true]) {
        const { controller, ctx } = context();
        let reviews = 0;
        const sandbox = load(['clipJobGenerationOptions', 'executeCompactionJob'], {
            requestCompaction: async () => {
                if (!canceled) throw new Error('SYNTHETIC_PRIVATE_PROVIDER_BODY');
                controller.abort();
                return 'Draft';
            },
            reviewCompactionDraft: () => { reviews++; },
        });
        await assert.rejects(sandbox.executeCompactionJob({ lorebookName: 'Book', payload: { reviewOnCompletion: true } }, ctx), { message: 'Compaction failed.' });
        assert.equal(reviews, 0);
        assert.equal(ctx.result, undefined);
    }
});

test('compaction retries a content conflict only after explicit overwrite, never for missing entries or denied access', async () => {
    for (const outcome of ['cancel', 'save', 'conflict', 'overwrite', 'decline', 'missing', 'denied']) {
        let writes = 0;
        let confirmations = 0;
        let errorToast = '';
        const payload = { entry: { uid: 7, content: 'Original' }, expectedContentHash: stableHashString('Original') };
        const sandbox = load(['showCompactionDraftPopup', 'reviewCompactionDraft'], {
            DOMPurify: { sanitize: text => text }, escapeHtml: text => text, estimateTokens: () => 1,
            POPUP_TYPE: { TEXT: 1, CONFIRM: 2 }, POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0 },
            Popup: class {
                constructor(_content, type, _input, options) {
                    this.confirmation = type === 2;
                    if (this.confirmation) {
                        confirmations++;
                        assert.equal(options.okButton, 'Overwrite anyway');
                        assert.equal(options.defaultResult, 0);
                    }
                }
                dlg = { querySelector: selector => selector === '#stmb-compact-content' ? { value: 'Edited compacted draft' } : { addEventListener() {} } };
                show() { return Promise.resolve(outcome === 'cancel' || (this.confirmation && outcome === 'decline') ? 0 : 1); }
            },
            loadWorldInfo: async () => ({ entries: {} }),
            updateLorebookEntryByUid: async (_book, _data, entry, options) => {
                writes++;
                assert.equal(entry.uid, 7);
                assert.equal(options.content, 'Edited compacted draft');
                assert.equal(options.expectedContentHash, writes === 1 ? stableHashString('Original') : undefined);
                if (writes === 1 && ['overwrite', 'decline', 'missing', 'denied'].includes(outcome)) {
                    throw Object.assign(new Error('SYNTHETIC_PRIVATE_ERROR'), { type: outcome === 'missing' ? 'StmbEntryNotFound' : outcome === 'denied' ? 'LorebookAccessDenied' : 'StmbEntryContentChanged' });
                }
                if (outcome === 'conflict') throw new Error('SYNTHETIC_PRIVATE_ERROR');
            },
            toastr: { success() {}, error: text => { errorToast = text; } },
        });
        assert.equal(await sandbox.reviewCompactionDraft('Book', payload, 'Generated draft'), ['save', 'overwrite'].includes(outcome));
        assert.equal(writes, outcome === 'cancel' ? 0 : outcome === 'overwrite' ? 2 : 1);
        assert.equal(confirmations, ['overwrite', 'decline'].includes(outcome) ? 1 : 0);
        assert.equal(errorToast.includes('SYNTHETIC_PRIVATE_ERROR'), false);
        if (outcome === 'conflict') assert.match(errorToast, /entry may have changed/);
    }
});

test('utility generation passes cancellation to the shared transport', async () => {
    const { ctx } = context();
    let requests = 0;
    const sandbox = load(['requestCompaction', 'requestTopicalClipDraft'], {
        validateCompactionPromptTemplate: () => null,
        buildCompactionPrompt: () => 'Prompt',
        runtime: { buildGenerateData: async () => ({ model: 'dummy' }) },
        generateStmbText: async (_request, options) => {
            assert.equal(options.signal, ctx.signal);
            requests++;
            return { text: 'Draft' };
        },
    });
    await sandbox.requestCompaction({}, 'clip', 'Template', {}, { signal: ctx.signal });
    await sandbox.requestTopicalClipDraft('Prompt', {}, { signal: ctx.signal });
    assert.equal(requests, 2);
    sandbox.runtime.buildGenerateData = () => { throw new Error('Current settings must not be read'); };
    await sandbox.requestTopicalClipDraft(undefined, undefined, { signal: ctx.signal, generateData: { model: 'Captured' } });
    await sandbox.requestCompaction({}, 'clip', 'Template', {}, { signal: ctx.signal, generateData: { model: 'Captured' } });
    assert.equal(requests, 4);
});

test('ordinary Generate stays in its editor; Auto-Accept closes only after enqueue and returns save success', async () => {
    const start = source.indexOf('const generateTopicalClipDraft = async');
    const end = source.indexOf('    let activeGenerationTask', start);
    const generateSource = source.slice(start, end).replace('const generateTopicalClipDraft =', 'globalThis.generate =');
    for (const outcome of ['manual', 'saved', 'failed', 'canceled', 'enqueue-failed']) {
        let queued = 0;
        let formatPreference = 'Synthetic format';
        let closed = 0;
        let directRequests = 0;
        let resolveJob;
        const completion = new Promise(resolve => { resolveJob = resolve; });
        const sandbox = vm.createContext({
            structuredClone, tr: text => text,
            buildStmbSceneContext: () => ({ chatId: 'Original' }),
            getClipFormat: () => formatPreference, getClipFormatKind: () => 'topical',
            entrySettingsEnabled: { checked: false }, captureEntrySettings: () => ({ enabled: false }),
            getCompactionProfileIndexFromSelect: () => 0, setCompactionProfileIndex() {},
            runtime: { getProfile: () => ({}), buildGenerateData: async () => {
                formatPreference = 'Changed after generation started';
                return { model: 'Captured model' };
            } }, buildTopicalClipEntryOverrides: () => ({}),
            getSelectedLorebookName: () => 'Book', currentLorebookName: 'Book', currentLorebookData: { entries: {} },
            getMode: () => 'create', draftRevision: 0,
            topicInput: { value: 'Topic' }, keywordsInput: { value: 'Topic' }, parseKeywords: () => ['Topic'],
            includeMemoriesInput: { checked: true }, includeMessagesInput: { checked: false }, includeHiddenMessagesInput: { checked: false },
            validateTopicalClipPromptTemplate: () => null, getTopicalClipPromptTemplate: () => 'Prompt',
            getTopicalSourceEntries: () => [{ uid: 1 }], rebuildInput: { checked: false }, selectedSourceMemoryKeys: null,
            buildTopicalClipPrompt: () => 'Prompt', estimateTokens: () => 1, getModuleSettings: () => ({}),
            renderDiagnostics() {}, formatTopicalMessage: () => '', saveButton: { disabled: true },
            makeTopicalClipHeadline: () => 'Topic', snapshotTopicalSourceEntries: () => [],
            queueClipJob: input => {
                queued++;
                assert.equal(closed, 0);
                assert.equal(input.type, 'topicalClip');
                assert.equal(input.payload.saveContext.lorebookData, undefined);
                assert.equal(input.payload.saveContext.format, 'Synthetic format');
                assert.equal(input.payload.saveContext.includeHiddenMessages, false);
                assert.equal(input.payload.generateData.model, 'Captured model');
                assert.equal(input.sceneContext.chatId, 'Original');
                if (outcome === 'enqueue-failed') throw new Error('Synthetic queue failure');
                return { completion };
            },
            popup: { completeCancelled: () => { closed++; } },
            requestTopicalClipDraft: async () => { directRequests++; return 'Draft'; },
            normalizeTopicalClipDraftBody: text => text, generationContext: null, draftTextarea: { value: '' },
            toastr: { info() {}, error() {} }, console: { error() {} }, MODULE_NAME: 'Test',
        });
        vm.runInContext(generateSource, sandbox);
        const task = sandbox.generate(outcome !== 'manual');
        await setImmediate();
        if (outcome === 'manual') {
            await task;
            assert.equal(queued, 0);
            assert.equal(closed, 0);
            assert.equal(directRequests, 1);
            assert.equal(sandbox.draftTextarea.value, 'Draft');
            assert.equal(sandbox.saveButton.disabled, false);
        } else {
            assert.equal(queued, 1);
            assert.equal(closed, outcome === 'enqueue-failed' ? 0 : 1);
            assert.equal(directRequests, 0);
            resolveJob({ state: outcome === 'saved' ? 'completed' : outcome, result: { saved: outcome === 'saved' } });
            assert.equal(await task, outcome === 'saved');
        }
    }
});

test('changed extracted messages prevent an auto-accepted save', async () => {
    const sandbox = load(['saveTopicalClipDraft'], {
        loadWorldInfo: async () => ({ entries: {} }),
        captureExtractedMessages: async () => { throw new Error('Synthetic stale selection'); },
    });
    await assert.rejects(sandbox.saveTopicalClipDraft({
        lorebookName: 'Book', mode: 'create', keywords: [], messageSelection: { revision: 1 },
    }, 'Draft'), error => error.code === 'STMB_CLIP_SOURCE_CHANGED');
});
