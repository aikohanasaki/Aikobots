import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

import { fetchChatSearchResults, findChatMessages, getChatMessagePreview } from '../public/scripts/chat-search.js';
import { validateChunkedChatPayload } from '../public/scripts/chat-chunking.js';

test('find popup includes unloaded history without changing chat and rejects a switched chat', async () => {
    const source = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function searchCurrentChatMessages()');
    const end = source.indexOf('function initTopChatUi()', start);
    assert.ok(start >= 0 && end > start);
    for (const switchChat of [false, true]) {
        const elements = [];
        const chat = [, { name: 'User', mes: 'local needle' }];
        let key = 'original';
        let popup;
        const createElement = tag => {
            const element = {
                tag, children: [], value: '', listeners: {},
                append(...children) { this.children.push(...children); },
                replaceChildren() { this.children = []; },
                setAttribute() {}, focus() {},
                addEventListener(event, handler) { this.listeners[event] = handler; },
            };
            elements.push(element);
            return element;
        };
        const context = vm.createContext({
            document: { createElement, createDocumentFragment: () => createElement('fragment') },
            translate: text => text,
            t: (strings, value) => strings[0] + value,
            getActiveChatRevisionKey: () => key,
            isChatFullyHydrated: () => false,
            getTotalChatMessages: () => 2,
            chat, findChatMessages, getChatMessagePreview, validateChunkedChatPayload,
            clearTimeout() {}, setTimeout: callback => callback(),
            fetchChunkedChat: async options => {
                assert.equal(options.hydrateFull, true);
                if (switchChat) key = 'another';
                return { revisionChatKey: 'original', totalMessages: 2, loadedRangeStart: 0, loadedRangeEnd: 1,
                    messages: [{ name: 'Bot', mes: '<img src=x> needle' }, { name: 'User', mes: 'old text' }] };
            },
            POPUP_TYPE: { TEXT: 1 },
            Popup: class {
                constructor(_content, _type, _value, options) { popup = options; }
                async show() { await popup.onOpen(); }
            },
        });
        await vm.runInContext(source.slice(start, end) + '; searchCurrentChatMessages()', context);
        const input = elements.find(element => element.tag === 'input');
        assert.equal(input.disabled, switchChat);
        if (!switchChat) {
            input.value = 'needle';
            input.listeners.input();
            assert.deepEqual(elements.filter(element => element.tag === 'details').map(row => row.children[0].children[1].textContent),
                ['<img src=x> needle', 'local needle']);
        } else {
            assert.ok(elements.some(element => element.textContent === 'Could not search this chat. Close and try again.'));
        }
        assert.equal(0 in chat, false);
        assert.equal(chat[1].mes, 'local needle');
        popup.onClose();
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
