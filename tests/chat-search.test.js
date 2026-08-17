import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchChatSearchResults } from '../public/scripts/chat-search.js';

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
