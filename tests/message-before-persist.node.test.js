import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const scriptSource = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const eventsSource = fs.readFileSync(new URL('../public/scripts/events.js', import.meta.url), 'utf8');
const stmbSource = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');

test('assistant persistence exposes one public pre-persistence event for streaming and non-streaming replies', () => {
    assert.match(eventsSource, /MESSAGE_BEFORE_PERSIST:\s*'message_before_persist'/);

    const streamingStart = scriptSource.indexOf('async onFinishStreaming');
    const streamingEnd = scriptSource.indexOf('async onErrorStreaming', streamingStart);
    const streamingBody = scriptSource.slice(streamingStart, streamingEnd);
    assert.ok(streamingBody.indexOf('event_types.MESSAGE_BEFORE_PERSIST') >= 0);
    assert.ok(streamingBody.indexOf('event_types.MESSAGE_BEFORE_PERSIST') < streamingBody.indexOf('saveSqliteReplyMutation'));

    const finalSaveStart = scriptSource.indexOf('if (replyResult) {');
    const finalSaveBody = scriptSource.slice(finalSaveStart, scriptSource.indexOf('const isAborted', finalSaveStart));
    assert.ok(finalSaveBody.indexOf('event_types.MESSAGE_BEFORE_PERSIST') >= 0);
    assert.ok(finalSaveBody.indexOf('event_types.MESSAGE_BEFORE_PERSIST') < finalSaveBody.indexOf('saveSqliteReplyMutation'));
});

test('Narrator hooks stamp users before persistence and merge continuation assistant snapshots', () => {
    assert.match(stmbSource, /event_types\.MESSAGE_SENT[\s\S]*stampNarratorCast/);
    assert.match(stmbSource, /event_types\.MESSAGE_BEFORE_PERSIST[\s\S]*merge:\s*type === 'continue'/);
    assert.match(stmbSource, /event_types\.MESSAGE_SWIPED[\s\S]*restoreNarratorCastFromTimeline/);
});
