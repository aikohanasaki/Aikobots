import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

import { fetchChatSearchResults, findChatMessages, getChatMessagePreview, showChatMessagePicker } from '../public/scripts/chat-search.js';

test('every Topical Clip save revalidates its captured selection before a write', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb-clips.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function saveTopicalClipDraft(');
    const end = source.indexOf('/** Applies one reviewed Clip suggestion', start);
    const events = [];
    let stale = true;
    const save = vm.runInNewContext(source.slice(start, end) + '; saveTopicalClipDraft', {
        tr: text => text,
        loadWorldInfo: async () => ({ entries: { 1: { uid: 1, comment: 'About topic [STMB Clip]' } } }),
        captureExtractedMessages: async selection => { events.push(selection); if (stale) throw new Error('changed source'); },
        findEntryByStableId: () => ({ uid: 1, comment: 'About topic [STMB Clip]' }),
        getClipHeadlineFromTitle: () => 'About topic', makeTopicalClipHeadline: () => 'About topic',
        createTopicalClipRunMetadata: () => ({}), createTopicalClipEntryContent: (_headline, draft) => draft,
        buildEntryDataWithTopicalMetadata: () => ({}),
        updateLorebookEntryByUid: async () => { events.push('update'); return { uid: 1 }; },
        createClipLorebookEntry: async () => { events.push('create'); return { uid: 2 }; },
        createUniqueTopicalClipTitle: () => 'About topic',
    });
    const selection = { messages: [{ uuid: 'original', hash: 'captured' }] };
    for (const [mode, forceCreateNew] of [['create', false], ['update', false], ['update', true]]) {
        await assert.rejects(save({ lorebookName: 'Book', mode, messageSelection: selection }, 'Keep this draft', { forceCreateNew }), { code: 'STMB_CLIP_SOURCE_CHANGED' });
    }
    assert.deepEqual(events, [selection, selection, selection]);
    stale = false;
    await save({ lorebookName: 'Book', mode: 'update', messageSelection: selection }, 'Accepted draft');
    assert.equal(events.at(-1), 'update');
});

test('floating Extract bounds the first non-empty line and handles rejected actions', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb-clips.js', import.meta.url), 'utf8');
    const start = source.indexOf('function createFloatingClipButton()');
    const end = source.indexOf('function updateFloatingClipButton()', start);
    const actions = [];
    const calls = [];
    const errors = [];
    const context = vm.createContext({
        document: {
            createElement: () => ({
                classList: { add() {} }, addEventListener(event, handler) { this[event] = handler; },
                append(action) { actions.push(action); },
            }),
            body: { appendChild() {} },
        },
        tr: text => text, MODULE_NAME: 'STMB Clips',
        getFloatingSelectionState: () => null, floatingClipSelection: '', hideFloatingClipButton() {},
        openChatMessageExtractor: async options => { calls.push(options); },
        openClipModalFromSelection: async options => { calls.push(options); },
        console: { error() {} }, toastr: { error: message => errors.push(message) },
    });
    vm.runInContext(source.slice(start, end) + '; createFloatingClipButton()', context);
    const event = { preventDefault() {}, stopPropagation() {} };
    for (const [selection, expected] of [
        ['\n  \n line one \n\nline two', 'line one'],
        ['x'.repeat(1001) + '\nsecond line', 'x'.repeat(1000)],
    ]) {
        context.floatingClipSelection = selection;
        await actions[1].click(event);
        assert.equal(calls.at(-1).query, expected);
        await actions[0].click(event);
        assert.equal(calls.at(-1).selectedText, selection);
        assert.equal(calls.at(-1).source, 'floating');
    }
    context.openChatMessageExtractor = async () => { throw new Error('Extractor failed'); };
    context.openClipModalFromSelection = async () => { throw new Error(); };
    await actions[1].click(event);
    await actions[0].click(event);
    assert.deepEqual(errors, ['Extractor failed', 'Could not read messages. Search again to retry.']);
});

/** Supplies the DOM operations used by the picker while retaining real async event handlers. */
function pickerHarness(t, options = {}) {
    const elements = [];
    const createElement = tag => {
        const node = {
            tag, children: [], value: '', listeners: {}, attributes: {},
            append(...children) { this.children.push(...children); },
            replaceChildren() { this.children = []; },
            insertBefore(child, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); },
            setAttribute(key, value) { this.attributes[key] = value; }, focus() {},
            addEventListener(event, callback) { this.listeners[event] = callback; },
        };
        elements.push(node);
        return node;
    };
    t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
    const originalDocument = globalThis.document;
    globalThis.document = { createElement, createTextNode: text => Object.assign(createElement('#text'), { textContent: text }) };
    t.after(() => { globalThis.document = originalDocument; });
    let popup;
    let opened;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const pending = showChatMessagePicker({
        Popup: class {
            constructor(_content, _type, _value, callbacks) { popup = callbacks; }
            show() { opened = Promise.resolve(popup.onOpen()); return done; }
            async completeAffirmative() { popup.onClose(); finish(); }
            async completeCancelled() { popup.onClose(); finish(); }
        },
        popupType: 1, translate: text => text, prepare: async () => {}, isCurrent: () => true,
        acceptLabel: 'Use selected messages', ...options,
    });
    return { elements, pending, opened, close: () => { popup.onClose(); finish(); }, find: text => elements.find(node => node.textContent === text) };
}

test('typed picker searches paged history, selects neighbors once and returns sources without opening another editor', async t => {
    const records = [0, 2].map(index => ({ index, uuid: `id-${index}`, hash: `hash-${index}`, name: 'Speaker', preview: '<literal needle>', is_system: index === 0 }));
    const calls = [];
    const harness = pickerHarness(t, { request: async (endpoint, body) => {
        calls.push({ endpoint, body });
        if (endpoint === 'find-messages') return body.cursor === null
            ? { revision: 'r1', matches: [records[0]], nextCursor: 1 }
            : { revision: 'r1', matches: [records[1]], nextCursor: null };
        if (body.neighbor) return { messages: [{ index: 1, uuid: 'id-1', hash: 'hash-1', name: 'User', mes: 'neighbor' }] };
        return { messages: body.messages.map(message => ({ ...message, mes: 'full needle <literal>' })) };
    } });
    await harness.opened;
    assert.equal(calls.length, 0);
    const input = harness.elements.find(node => node.type === 'search');
    input.value = 'needle';
    await input.listeners.keydown({ key: 'Enter', preventDefault() {} });
    // loadPage is intentionally fire-and-forget for browser events.
    for (let index = 0; index < 10; index++) await Promise.resolve();
    assert.deepEqual(calls.filter(call => call.endpoint === 'find-messages').map(call => call.body.limit), [50, 49]);
    assert.equal(harness.find('Use selected messages').disabled, true);
    const details = harness.elements.find(node => node.tag === 'details');
    details.open = true;
    await details.listeners.toggle();
    assert.ok(harness.elements.some(node => node.tag === 'mark' && node.textContent === 'needle'));
    assert.ok(harness.elements.some(node => node.tag === '#text' && node.textContent === ' <literal>'));
    await harness.find('Next message').listeners.click();
    assert.equal(harness.elements.filter(node => node.tag === 'details').length, 3);
    harness.find('Select loaded results').listeners.click();
    assert.equal(harness.find('Use selected messages').disabled, false);
    await harness.find('Use selected messages').listeners.click();
    const selected = await harness.pending;
    assert.deepEqual(selected.messages.map(message => message.index).sort(), [0, 1, 2]);
    assert.equal(selected.query, 'needle');
    assert.equal(selected.revision, 'r1');
    assert.equal(selected.messages.some(message => 'mes' in message), false);
});

test('picker rejects stale sources and aborts outstanding requests when its chat changes', async t => {
    const signal = new AbortController();
    let requestSignal;
    const harness = pickerHarness(t, { query: 'needle', signal: signal.signal, request: async (_endpoint, _body, activeSignal) => {
        requestSignal = activeSignal;
        throw Object.assign(new Error('stale'), { status: 409 });
    } });
    await harness.opened;
    assert.ok(harness.find('Chat changed. Search again to refresh the results.'));
    assert.equal(harness.find('Use selected messages').disabled, true);
    signal.abort();
    assert.equal(await harness.pending, null);
    assert.equal(requestSignal.aborted, true);
});

test('changing the phrase cancels the old response instead of mixing results', async t => {
    let finishOld;
    let oldSignal;
    const harness = pickerHarness(t, { query: 'old', request: async (_endpoint, body, signal) => {
        if (body.query === 'old') {
            oldSignal = signal;
            return new Promise(resolve => { finishOld = resolve; });
        }
        return { revision: 'new-revision', matches: [{ index: 2, uuid: 'new', hash: 'new', name: 'New', preview: 'new match' }], nextCursor: null };
    } });
    await Promise.resolve();
    const input = harness.elements.find(node => node.type === 'search');
    input.value = 'new';
    input.listeners.keydown({ key: 'Enter', preventDefault() {} });
    finishOld({ revision: 'old-revision', matches: [{ index: 0, uuid: 'old', hash: 'old', name: 'Old', preview: 'old match' }], nextCursor: null });
    await harness.opened;
    for (let index = 0; index < 10; index++) await Promise.resolve();
    assert.equal(oldSignal.aborted, true);
    assert.equal(harness.elements.filter(node => node.tag === 'details').length, 1);
    assert.ok(harness.find('new match'));
    harness.close();
    assert.equal(await harness.pending, null);
});

test('Topical Clip extraction preserves configured fields, cancels without changes and invalidates accepted sources', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb-clips.js', import.meta.url), 'utf8');
    const start = source.indexOf('const extractMessages = async');
    const end = source.indexOf("dlg.querySelector('#stmb-topical-clip-extract')", start);
    for (const cancel of [true, false]) {
        const topicInput = { value: 'Existing topic' };
        const keywordsInput = { value: 'existing, keys' };
        const includeMessagesInput = { checked: false };
        const messageMode = { value: 'range' };
        let cleared = 0;
        const selection = { query: 'needle', messages: [{ index: 7 }] };
        const context = vm.createContext({
            topicInput, keywordsInput, includeMessagesInput, messageMode, selectedMessages: null,
            openChatMessageExtractor: async options => { assert.equal(options.selectOnly, true); return cancel ? null : selection; },
            clearDraft: () => { cleared++; }, renderSourceVisibility() {},
        });
        await vm.runInContext(source.slice(start, end) + '; extractMessages()', context);
        assert.equal(topicInput.value, 'Existing topic');
        assert.equal(keywordsInput.value, 'existing, keys');
        assert.equal(cleared, cancel ? 0 : 1);
        assert.equal(messageMode.value, cancel ? 'range' : 'selection');
        if (!cancel) {
            topicInput.value = '';
            keywordsInput.value = '';
            await vm.runInContext('extractMessages()', context);
            assert.equal(topicInput.value, 'needle');
            assert.equal(keywordsInput.value, 'needle');
        }
    }
});

test('previews use 40 words and retain short, Japanese, and literal text', () => {
    const longText = Array.from({ length: 41 }, (_, index) => `word${index}`).join(' ');
    const preview = getChatMessagePreview(longText);
    assert.equal(preview.truncated, true);
    assert.equal(preview.text.split(/\s+/u).length, 40);
    assert.deepEqual(getChatMessagePreview('short message'), { text: 'short message', truncated: false });
    assert.equal(getChatMessagePreview('日本語の文章です').text, '日本語の文章です');
});

test('find-all searches literal current text with absolute indices, excluding swipes and metadata', () => {
    const messages = [
        { name: 'A', mes: 'A DRAGON.* appears' },
        { name: 'dragon.*', mes: 'No match', swipes: ['dragon.*'], extra: { note: 'dragon.*' } },
        ,
        { name: 'B', mes: '<b>dragon.*</b> again dragon.*' },
        { mes: null },
    ];
    assert.deepEqual(findChatMessages(messages, ' Dragon.* '), [
        { index: 0, name: 'A', text: 'A DRAGON.* appears' },
        { index: 3, name: 'B', text: '<b>dragon.*</b> again dragon.*' },
    ]);
    assert.deepEqual(findChatMessages(messages, '  '), []);
    assert.deepEqual(findChatMessages(messages, 'missing'), []);
    assert.deepEqual(findChatMessages([{ mes: '日本語の文章' }], '日本語'), [{ index: 0, name: '', text: '日本語の文章' }]);
});

test('chat search sends the Manage Chats request shape', async () => {
    let request;
    const results = [{ file_name: 'chat-1' }];
    const response = await fetchChatSearchResults({
        query: 'dragon',
        avatarUrl: 'character.png',
        requestHeaders: { 'Content-Type': 'application/json' },
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => results };
        },
    });

    assert.deepEqual(response, results);
    assert.equal(request.url, '/api/chats/search');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(request.options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(request.options.body), {
        query: 'dragon',
        avatar_url: 'character.png',
        group_id: null,
    });
});

test('chat search scopes group requests without an avatar', async () => {
    let payload;
    await fetchChatSearchResults({
        groupId: 'group-1',
        requestHeaders: {},
        fetchImpl: async (_url, options) => {
            payload = JSON.parse(options.body);
            return { ok: true, json: async () => [] };
        },
    });

    assert.deepEqual(payload, {
        query: '',
        avatar_url: null,
        group_id: 'group-1',
    });
});

test('chat search rejects failed and malformed responses', async () => {
    const requestHeaders = { 'Content-Type': 'application/json' };

    await assert.rejects(
        fetchChatSearchResults({ requestHeaders, fetchImpl: async () => ({ ok: false }) }),
        /Chat search failed/,
    );
    await assert.rejects(
        fetchChatSearchResults({ requestHeaders, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
        /invalid response/,
    );
});
