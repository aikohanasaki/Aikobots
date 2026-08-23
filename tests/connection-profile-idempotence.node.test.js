import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('reapplying the effective proxy does not reconnect', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'scripts', 'openai.js'), 'utf8');
    const functionStart = source.indexOf('function setProxyPreset');
    const functionEnd = source.indexOf('\nfunction onProxyPresetChange', functionStart);
    const setProxyPresetSource = source.slice(functionStart, functionEnd);

    assert.match(setProxyPresetSource, /const connectionChanged = oai_settings\.reverse_proxy !== url \|\| oai_settings\.proxy_password !== password;/u);
    assert.match(setProxyPresetSource, /if \(connectionChanged\) \{\s*reconnectOpenAi\(\);\s*\}/u);
});

test('reselecting the active secret does not rotate it', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'scripts', 'secrets.js'), 'utf8');
    const commandStart = source.indexOf("name: 'secret-id'");
    const commandEnd = source.indexOf("name: 'secret-delete'", commandStart);
    const secretIdCommandSource = source.slice(commandStart, commandEnd);

    assert.match(secretIdCommandSource, /if \(savedSecret\.active\) \{\s*return savedSecret\.id;\s*\}\s*\/\/ Set the secret as active\s*await rotateSecret\(key, savedSecret\.id\);/u);
});
