import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeStmbSettings } from '../public/scripts/stmb-core.js';
import { SIDE_PROMPT_HISTORY_KEY, buildSidePromptHistoryRequest, formatSidePromptVersionTitle, resolveSidePromptHistory, validateSidePromptHistoryRequest } from '../public/scripts/stmb-sideprompt-history.js';

const template = { key: 'assess', name: 'Assess State', settings: { saveAllVersions: true } };
const scene = { chatId: 'My Chat, One', chatRef: { type: 'character', avatarUrl: 'alice.png', fileName: 'My Chat, One' } };
const settings = { moduleSettings: { sidePromptVersioningEnabled: true } };
const makeRequest = (prompt = template, config = settings, context = scene, title = 'Assess') => buildSidePromptHistoryRequest(prompt, config, context, title, ['Assess (STMB SidePrompt)']);
const makeEntry = (request, sequence, overrides = {}) => ({
    uid: sequence, content: `Output ${sequence}`, comment: formatSidePromptVersionTitle(request.titleBase, sequence),
    [SIDE_PROMPT_HISTORY_KEY]: { ...request, version: 1, sequence }, ...overrides,
});

test('both checkboxes are required, default off, and the group is a single whitespace-free name', () => {
    assert.equal(normalizeStmbSettings({}).moduleSettings.sidePromptVersioningEnabled, false);
    assert.equal(normalizeStmbSettings(settings).moduleSettings.sidePromptVersioningEnabled, true);
    assert.equal(makeRequest().append, true);
    assert.equal(makeRequest(template, {}).append, false);
    assert.equal(makeRequest({ ...template, settings: {} }).append, false);
    assert.equal(makeRequest().group, 'AssessState-MyChat-One');
    assert.equal(formatSidePromptVersionTitle('Assess', 1000), 'Assess-1000 (STMB SidePrompt)');
});

test('latest output and checkpoint are independent of enabled states and display names', () => {
    const request = makeRequest();
    const latest = makeEntry(request, 2, { disable: true, STMB_lastProcessedMessageId: 55 });
    const book = { entries: { 1: makeEntry(request, 1), 2: latest } };
    const renamed = makeRequest({ ...template, name: 'New display name' }, {}, scene, 'New display name');
    assert.equal(resolveSidePromptHistory(book, renamed).latest, latest);
    assert.equal(resolveSidePromptHistory(book, renamed).latest.STMB_lastProcessedMessageId, 55);
    const anotherChat = makeRequest(template, settings, { ...scene, chatRef: { ...scene.chatRef, avatarUrl: 'bob.png' } });
    assert.equal(resolveSidePromptHistory(book, anotherChat).latest, null);
});

test('macro-resolved title overrides remain separate streams', () => {
    const prompt = { ...template, settings: { ...template.settings, lorebook: { entryTitleOverride: '{{person}}' } } };
    const first = makeRequest(prompt, settings, scene, 'Alice');
    const second = makeRequest(prompt, settings, scene, 'Bob');
    const book = { entries: { 1: makeEntry(first, 1) } };
    assert.equal(resolveSidePromptHistory(book, second).latest, null);
    assert.equal(resolveSidePromptHistory(book, first).latest.uid, 1);
});

test('ambiguous legacy titles and malformed or duplicate sequences fail closed', () => {
    const request = makeRequest();
    const legacy = { comment: request.legacyTitles[0], content: 'ordinary output' };
    assert.throws(() => resolveSidePromptHistory({ entries: { 1: legacy, 2: legacy } }, request), { status: 409 });
    assert.throws(() => resolveSidePromptHistory({ entries: { 1: makeEntry(request, 1), 2: makeEntry(request, 1) } }, request), { status: 409 });
    assert.throws(() => resolveSidePromptHistory({ entries: { 1: makeEntry(request, -1) } }, request), { status: 409 });
    assert.equal(resolveSidePromptHistory({ entries: { 1: { ...legacy, STMB_sidePromptRegeneration: { templateKey: 'other', chatId: scene.chatId } } } }, request).latest, null);
    for (const patch of [{ append: 'true' }, { chatKey: '["character",null,"chat"]' }, { group: 'two,groups' }, { legacyTitles: {} }]) {
        assert.throws(() => validateSidePromptHistoryRequest({ ...request, ...patch }), { status: 400 });
    }
});

test('legacy lookup prefers the unified title over older output kinds without merging them', () => {
    const request = { ...makeRequest(), legacyTitles: ['Assess (STMB SidePrompt)', 'Assess (STMB Tracker)'] };
    const primary = { uid: 1, comment: request.legacyTitles[0], content: 'Current ordinary output' };
    const older = { uid: 2, comment: request.legacyTitles[1], content: 'Earlier ordinary output' };
    assert.equal(resolveSidePromptHistory({ entries: { 1: primary, 2: older, 3: { ...older, uid: 3 } } }, request).latest, primary);
    assert.equal(resolveSidePromptHistory({ entries: { 2: older } }, request).latest, older);
    assert.throws(() => resolveSidePromptHistory({ entries: { 2: older, 3: { ...older, uid: 3 } } }, request), { status: 409 });
});

test('an ambiguous tracker reports its conflict while an independent tracker is still queued', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb-sideprompts.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function evaluateTrackers(');
    const end = source.indexOf('export async function runAfterMemory(', start);
    const queued = [];
    const errors = [];
    const evaluate = vm.runInNewContext('let trackerEvaluationPromise = null;\n' + source.slice(start, end).replace('export ', '') + '; evaluateTrackers', {
        getSelectedAfterMemorySetKey: () => '', listByTrigger: async () => [{ key: 'conflict' }, { key: 'valid' }],
        fetchStmbChatRangeInfo: async () => ({ lastAvailableMessageId: 60, visibleMessageCount: 60 }),
        resolveSidePromptLorebook: async () => ({ name: 'Book', data: { entries: {} } }),
        findLatestSidePromptEntry: (_book, template) => { if (template.key === 'conflict') throw Object.assign(new Error('Ambiguous'), { type: 'StmbSidePromptHistoryConflict' }); return null; },
        reportSidePromptHistoryConflict: error => { errors.push(error.type); return true; },
        resolveSidePromptCheckpoint: () => ({ lastMsgId: -1, lastRunAt: 0 }),
        compileRange: async () => ({ metadata: { sceneEnd: 60 } }), buildSidePromptCheckpointMetadata: () => ({}),
        buildQueuedSidePromptJob: async job => job, enqueueStmbJob: job => queued.push(job),
        ensureSidePromptJobExecutorRegistered() {}, throwIfStmbAborted() {},
        isStmbAbortError: () => false, isStmbLorebookHandledError: () => false,
        console: { warn: (...args) => assert.fail(String(args)) },
    });
    await evaluate({}, { signal: new AbortController().signal, contextSettingKey: 'none' });
    assert.deepEqual(errors, ['StmbSidePromptHistoryConflict']);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].template.key, 'valid');
});
