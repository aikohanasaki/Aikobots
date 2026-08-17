import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

const { readRequestSecret, SECRET_KEYS } = await import('../src/endpoints/secrets.js');

test('readRequestSecret falls back to the active secret for a bodyless request', () => {
    const request = {
        user: {
            directories: {
                root: path.join(os.tmpdir(), `aikobots-request-secret-${randomUUID()}`),
            },
        },
    };

    assert.equal(readRequestSecret(request, SECRET_KEYS.OPENAI), '');
});
