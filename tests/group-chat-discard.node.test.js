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
    assert.match(openGroupChatSource, /if \(flushPendingSave\) \{\s*await persistActiveGroupChat\(groupId\);\s*\}/u);
});
