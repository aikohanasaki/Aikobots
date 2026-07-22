import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

let tempRoot;
let user;
let worldsDirectory;
let hasLorebookForGeneration;
let promoteLorebook;
let readLorebookForGeneration;
let getInvalidSecureLinkedLorebooks;
let listOwnedStmbContextSourceEntries;

beforeAll(async () => {
    const utilModule = await import('../util.js');
    const configPath = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
        ? path.resolve(process.cwd(), 'config.yaml')
        : path.resolve(process.cwd(), '..', 'config.yaml');
    utilModule.setConfigFilePath(configPath);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lorebook-template-security-'));
    globalThis.DATA_ROOT = tempRoot;
    user = { profile: { handle: 'template-maker-test', admin: false } };
    const repositoryModule = await import('../lorebook-repository.js');
    const { getUserDirectories } = await import('../users.js');
    ({ getInvalidSecureLinkedLorebooks } = await import('../character-linked-lorebooks.js'));
    ({ listOwnedStmbContextSourceEntries } = await import('../stmb-context-settings.js'));
    ({ hasLorebookForGeneration, promoteLorebook, readLorebookForGeneration } = repositoryModule);
    user.directories = getUserDirectories(user.profile.handle);
    worldsDirectory = user.directories.worlds;
    fs.mkdirSync(worldsDirectory, { recursive: true });
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('secure LTM template lorebooks', () => {
    it.each(['LTM - Aiko - Blank', 'LTM-Aiko-Blank'])('allows %s to be promoted to secure storage', async name => {
        fs.writeFileSync(path.join(worldsDirectory, `${name}.json`), JSON.stringify({ entries: {} }), 'utf8');
        const symlinkSpy = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {});
        try {
            await expect(promoteLorebook(user, name)).resolves.toMatchObject({ name, storage: 'secure' });
        } finally {
            symlinkSpy.mockRestore();
        }
    });

    it('never exposes a secure LTM template to generation', () => {
        const name = 'LTM - Secure Aiko - Blank';
        const secureDirectory = path.join(tempRoot, '_secure', 'shared-worlds');
        fs.mkdirSync(secureDirectory, { recursive: true });
        fs.writeFileSync(path.join(secureDirectory, `${name}.json`), JSON.stringify({ entries: {} }), 'utf8');
        fs.writeFileSync(path.join(secureDirectory, 'index.json'), JSON.stringify({
            version: 1,
            books: { [name]: { owners: [user.profile.handle] } },
        }), 'utf8');

        expect(readLorebookForGeneration(user, name, false)).toBeNull();
        expect(hasLorebookForGeneration(user, name)).toBe(false);
    });

    it('does not apply the generation block to an ordinary user lorebook', () => {
        const name = 'LTM-Ordinary-Aiko-Blank';
        const data = { entries: { 0: { uid: 0 } } };
        fs.writeFileSync(path.join(worldsDirectory, `${name}.json`), JSON.stringify(data), 'utf8');

        expect(readLorebookForGeneration(user, name, false)).toEqual(data);
        expect(hasLorebookForGeneration(user, name)).toBe(true);
    });

    it('rejects secure LTM templates as character links and STMB context sources', () => {
        const name = 'LTM - Secure Aiko - Blank';
        const character = {
            data: { extensions: { aikobots: { secure_lorebooks: [name] } } },
        };
        expect(getInvalidSecureLinkedLorebooks(user, character)).toEqual([name]);

        const secureIndexPath = path.join(tempRoot, '_secure', 'worlds', 'index.json');
        fs.writeFileSync(secureIndexPath, JSON.stringify({ version: 1, books: {} }), 'utf8');
        expect(listOwnedStmbContextSourceEntries(user).map(item => item.lorebookName)).not.toContain(name);
    });
});
