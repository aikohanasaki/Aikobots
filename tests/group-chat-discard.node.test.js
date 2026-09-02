import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('group chat navigation does not issue a redundant whole-chat save', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'scripts', 'group-chats.js'), 'utf8');
    const functionStart = source.indexOf('export async function openGroupChat');
    const functionEnd = source.indexOf('\nexport async function renameGroupChat', functionStart);
    const openGroupChatSource = source.slice(functionStart, functionEnd);

    assert.doesNotMatch(openGroupChatSource, /persistActiveGroupChat|saveGroupChat/u);
    assert.match(openGroupChatSource, /if \(flushPendingSave\) \{\s*const pendingSaveResult = await flushDebouncedChatSave\(\);/u);
    assert.match(openGroupChatSource, /await clearChat\(\{ flushPendingSave \}\)/u);
});

test('new group chats flush pending changes without a second whole-chat save', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'scripts', 'group-chats.js'), 'utf8');
    const functionStart = source.indexOf('export async function createNewGroupChat');
    const functionEnd = source.indexOf('\nexport async function getGroupPastChats', functionStart);
    const createNewGroupChatSource = source.slice(functionStart, functionEnd);

    assert.doesNotMatch(createNewGroupChatSource, /persistActiveGroupChat|saveGroupChat/u);
    assert.match(createNewGroupChatSource, /const pendingSaveResult = await flushDebouncedChatSave\(\)/u);
    assert.ok(createNewGroupChatSource.indexOf('flushDebouncedChatSave()') < createNewGroupChatSource.indexOf('group.chat_id = newChatName'));
});

test('group chat loading refetches a missing latest tail before recovery can inspect it', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'scripts', 'group-chats.js'), 'utf8');
    const functionStart = source.indexOf('export async function getGroupChat');
    const functionEnd = source.indexOf('\n/**\n * Retrieves the members of a group', functionStart);
    const getGroupChatSource = source.slice(functionStart, functionEnd);
    const initialLoad = getGroupChatSource.indexOf('await loadGroupChat');
    const tailCheck = getGroupChatSource.indexOf('if (!chunkedPayloadIncludesLatestTail(payload))');
    const tailRefetch = getGroupChatSource.indexOf('await fetchLatestTailForPayload');
    const payloadApply = getGroupChatSource.indexOf('applyChunkedChatPayload');

    assert.ok(initialLoad >= 0 && initialLoad < tailCheck);
    assert.ok(tailCheck < tailRefetch);
    assert.ok(tailRefetch < payloadApply);
});
