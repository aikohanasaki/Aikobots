import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(import.meta.dirname, '..', 'public', 'scripts', 'model-tag-injection.js');

test('model tag refresh remains runtime-only', async () => {
    const source = await readFile(sourcePath, 'utf8');

    assert.match(source, /executeSlashCommandsWithOptions\('\/model'/);
    assert.match(source, /setExtensionPrompt\(MODEL_TAG_PROMPT_KEY,/);
    assert.doesNotMatch(source, /\/inject\b|saveMetadata/);
});
