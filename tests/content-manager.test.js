import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

describe('default user settings', () => {
    let root;
    let contentRoot;
    let ensureDefaultSettingsForUser;
    let previousContentRoot;
    let previousScaffoldRoot;

    beforeAll(async () => {
        previousContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
        previousScaffoldRoot = globalThis.DEFAULT_SCAFFOLD_ROOT;
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-user-settings-'));
        contentRoot = path.join(root, 'default-content');
        globalThis.DEFAULT_CONTENT_ROOT = contentRoot;
        globalThis.DEFAULT_SCAFFOLD_ROOT = path.join(root, 'default-scaffold');
        fs.mkdirSync(contentRoot, { recursive: true });
        fs.writeFileSync(path.join(contentRoot, 'settings.json'), '{"source":"default"}', 'utf8');
        ({ ensureDefaultSettingsForUser } = await import('../src/endpoints/content-manager.js'));
    });

    afterAll(() => {
        globalThis.DEFAULT_CONTENT_ROOT = previousContentRoot;
        globalThis.DEFAULT_SCAFFOLD_ROOT = previousScaffoldRoot;
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('copies default settings for a new user', async () => {
        const newUserRoot = path.join(root, 'new-user');

        await ensureDefaultSettingsForUser({ root: newUserRoot });

        expect(fs.readFileSync(path.join(newUserRoot, 'settings.json'), 'utf8')).toBe('{"source":"default"}');
    });

    it('does not replace existing user settings', async () => {
        const existingUserRoot = path.join(root, 'existing-user');
        fs.mkdirSync(existingUserRoot, { recursive: true });
        fs.writeFileSync(path.join(existingUserRoot, 'settings.json'), '{"source":"user"}', 'utf8');

        await ensureDefaultSettingsForUser({ root: existingUserRoot });

        expect(fs.readFileSync(path.join(existingUserRoot, 'settings.json'), 'utf8')).toBe('{"source":"user"}');
    });
});
