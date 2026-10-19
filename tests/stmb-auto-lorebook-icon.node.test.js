import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scripts/stmb-lorebook.js', import.meta.url), 'utf8');
const start = source.indexOf('async function autoCreateAndBindLorebook(');
const end = source.indexOf('export async function getLorebookStats(', start);
assert.ok(start >= 0 && end > start);

test('auto-created lorebook icon reflects a saved binding only in its originating chat', async () => {
    for (const outcome of ['saved', 'failed', 'switched']) {
        const metadata = {};
        let currentMetadata = metadata;
        let chatId = 'chat-a';
        let iconUpdates = 0;
        const context = vm.createContext({
            getCurrentChatId: () => chatId,
            getContext: () => ({ characterId: 1, groupId: null }),
            generateAutoLorebookName: async () => 'Test Book',
            METADATA_KEY: 'world',
            createNewWorldInfo: async () => true,
            saveMetadata: async () => {
                if (outcome === 'switched') {
                    chatId = 'chat-b';
                    currentMetadata = {};
                }
                return outcome === 'failed' ? 'failed' : 'saved';
            },
            document: { querySelectorAll: () => [{ classList: { add: () => { iconUpdates++; } } }] },
            CHAT_SAVE_RESULT: { SAVED: 'saved' },
        });
        Object.defineProperty(context, 'chat_metadata', { get: () => currentMetadata });
        const create = vm.runInContext(`${source.slice(start, end)}; autoCreateAndBindLorebook`, context);
        if (outcome === 'failed') await assert.rejects(create('Test Book'), /could not be saved/);
        else await create('Test Book');
        assert.equal(iconUpdates, outcome === 'saved' ? 1 : 0);
    }
});

test('failed auto-create saves restore only their own binding on the original metadata', async () => {
    for (const initial of [{}, { world: 'Previous Book' }, { world: undefined }]) {
        for (const outcome of ['failed', 'rejected', 'reselected', 'switched']) {
            const metadata = { ...initial };
            let currentMetadata = metadata;
            const context = vm.createContext({
                getCurrentChatId: () => currentMetadata === metadata ? 'chat-a' : 'chat-b',
                getContext: () => ({ characterId: 1, groupId: null }),
                generateAutoLorebookName: async () => 'Test Book',
                METADATA_KEY: 'world',
                createNewWorldInfo: async () => true,
                saveMetadata: async () => {
                    assert.equal(metadata.world, 'Test Book');
                    if (outcome === 'rejected') throw new Error('Save rejected');
                    if (outcome === 'reselected') metadata.world = 'Newer Book';
                    if (outcome === 'switched') currentMetadata = { world: 'Test Book' };
                    return 'failed';
                },
                CHAT_SAVE_RESULT: { SAVED: 'saved' },
            });
            Object.defineProperty(context, 'chat_metadata', { get: () => currentMetadata });
            const create = vm.runInContext(`${source.slice(start, end)}; autoCreateAndBindLorebook`, context);
            await assert.rejects(create('Test Book'), outcome === 'rejected' ? /Save rejected/ : /could not be saved/);
            assert.deepEqual(metadata, outcome === 'reselected' ? { world: 'Newer Book' } : initial);
            if (outcome === 'switched') assert.deepEqual(currentMetadata, { world: 'Test Book' });
        }
    }
});
