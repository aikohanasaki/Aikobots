import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('discarding pending group chat state skips active-chat persistence', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'scripts', 'group-chats.js'), 'utf8');
    const functionStart = source.indexOf('export async function openGroupChat');
    const functionEnd = source.indexOf('\nexport async function renameGroupChat', functionStart);
    const openGroupChatSource = source.slice(functionStart, functionEnd);

    assert.equal(openGroupChatSource.match(/persistActiveGroupChat\(groupId\)/gu)?.length, 1);
    assert.match(openGroupChatSource, /persistCurrentChat = true/u);
    assert.match(openGroupChatSource, /if \(flushPendingSave && persistCurrentChat\) \{\s*await persistActiveGroupChat\(groupId\);\s*\}/u);
});

test('switching to an unloaded group owner skips destination persistence', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'script.js'), 'utf8');
    const functionStart = source.indexOf('export async function openManageChatsOwnerChat');
    const functionEnd = source.indexOf('\nasync function createNewManageChatsOwnerChat', functionStart);
    const openOwnerChatSource = source.slice(functionStart, functionEnd);

    assert.match(openOwnerChatSource, /persistCurrentChat: ownerAlreadyActive/u);
});
