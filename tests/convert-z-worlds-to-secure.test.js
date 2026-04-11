import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';

const supportsFileSymlinks = (() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-z-worlds-symlink-support-'));
    const target = path.join(root, 'target.txt');
    const link = path.join(root, 'link.txt');

    try {
        fs.writeFileSync(target, 'x', 'utf8');
        fs.symlinkSync(target, link, 'file');
        return fs.lstatSync(link).isSymbolicLink();
    } catch {
        return false;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
})();

describe('convert-z-worlds-to-secure script', () => {
    let setConfigFilePath;
    let initUserStorage;
    let getUserDirectories;
    let toKey;
    let storage;
    let runZWorldsToSecureConversion;
    const itIfSymlinks = supportsFileSymlinks ? it : it.skip;

    /** @type {string[]} */
    const tempRoots = [];

    beforeAll(async () => {
        process.env.SILLYTAVERN_ENABLEUSERACCOUNTS = 'true';

        const utilModule = await import('../src/util.js');
        setConfigFilePath = utilModule.setConfigFilePath;
        setConfigFilePath(path.resolve(process.cwd(), 'config.yaml'));

        const usersModule = await import('../src/users.js');
        initUserStorage = usersModule.initUserStorage;
        getUserDirectories = usersModule.getUserDirectories;
        toKey = usersModule.toKey;

        storage = (await import('node-persist')).default;
        runZWorldsToSecureConversion = (await import('../scripts/convert-z-worlds-to-secure.mjs')).runZWorldsToSecureConversion;
    });

    afterEach(() => {
        for (const tempRoot of tempRoots.splice(0)) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    async function createDataRoot() {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-z-worlds-'));
        tempRoots.push(dataRoot);
        globalThis.DATA_ROOT = dataRoot;
        await initUserStorage(dataRoot);
        return dataRoot;
    }

    async function seedUser(handle, { admin = false, enabled = true } = {}) {
        await storage.setItem(toKey(handle), {
            handle,
            name: handle,
            created: Date.now(),
            password: '',
            enabled,
            admin,
            salt: '',
        });
        return getUserDirectories(handle);
    }

    function writeJson(filePath, value) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(value, null, 4), 'utf8');
    }

    it('includes a usage comment block at the top of the script', () => {
        const scriptPath = path.join(process.cwd(), 'scripts', 'convert-z-worlds-to-secure.mjs');
        const scriptText = fs.readFileSync(scriptPath, 'utf8');

        expect(scriptText.startsWith('/*')).toBe(true);
        expect(scriptText).toContain('node .\\scripts\\convert-z-worlds-to-secure.mjs --data-root .\\data --source .\\data\\Z-worlds');
        expect(scriptText).toContain('--dry-run');
        expect(scriptText).toContain('9Z* lorebooks are assigned to default-user');
    });

    itIfSymlinks('converts 9Z lorebooks, creates a secure symlink, and removes user-directory symlink copies', async () => {
        const dataRoot = await createDataRoot();
        const defaultDirectories = getUserDirectories('default-user');
        const bobDirectories = await seedUser('bob');
        const sourceDirectory = path.join(dataRoot, 'Z-worlds');
        const sourcePath = path.join(sourceDirectory, '9Z-admin-book.json');
        const bobCopyPath = path.join(bobDirectories.worlds, '9Z-admin-book.json');

        writeJson(sourcePath, { entries: { 1: { uid: 1, content: 'admin lorebook' } } });
        fs.mkdirSync(path.dirname(bobCopyPath), { recursive: true });
        fs.symlinkSync(sourcePath, bobCopyPath, 'file');

        const summary = await runZWorldsToSecureConversion({ dataRoot, source: sourceDirectory });

        const ownerPath = path.join(defaultDirectories.worlds, '9Z-admin-book.json');
        const securePath = path.join(dataRoot, '_secure', 'worlds', '9Z-admin-book.json');
        const secureIndexPath = path.join(dataRoot, '_secure', 'worlds', 'index.json');

        expect(summary.counts.converted).toBe(1);
        expect(inspectKind(ownerPath)).toBe('file');
        expect(inspectKind(securePath)).toBe('symlink');
        expect(fs.existsSync(bobCopyPath)).toBe(false);
        expect(JSON.parse(fs.readFileSync(secureIndexPath, 'utf8')).books['9Z-admin-book']).toMatchObject({
            ownerHandle: 'default-user',
        });
    });

    itIfSymlinks('overwrites an owner-path symlink with a regular file before promotion', async () => {
        const dataRoot = await createDataRoot();
        const aliceDirectories = await seedUser('alice');
        const sourceDirectory = path.join(dataRoot, 'Z-worlds');
        const sourcePath = path.join(sourceDirectory, 'Z-alice-book.json');
        const ownerPath = path.join(aliceDirectories.worlds, 'Z-alice-book.json');
        const placeholderPath = path.join(dataRoot, 'placeholder.json');

        writeJson(sourcePath, { entries: { 2: { uid: 2, content: 'alice lorebook' } } });
        writeJson(placeholderPath, { placeholder: true });
        fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
        fs.symlinkSync(placeholderPath, ownerPath, 'file');

        const summary = await runZWorldsToSecureConversion({ dataRoot, source: sourceDirectory });
        const securePath = path.join(dataRoot, '_secure', 'worlds', 'Z-alice-book.json');

        expect(summary.counts.converted).toBe(1);
        expect(inspectKind(ownerPath)).toBe('file');
        expect(JSON.parse(fs.readFileSync(ownerPath, 'utf8')).entries['2'].content).toBe('alice lorebook');
        expect(inspectKind(securePath)).toBe('symlink');
    });

    it('skips when the owner target already exists and is not a symlink', async () => {
        const dataRoot = await createDataRoot();
        const aliceDirectories = await seedUser('alice');
        const sourceDirectory = path.join(dataRoot, 'Z-worlds');
        const sourcePath = path.join(sourceDirectory, 'Z-alice-skip.json');
        const ownerPath = path.join(aliceDirectories.worlds, 'Z-alice-skip.json');

        writeJson(sourcePath, { entries: { 3: { uid: 3, content: 'source lorebook' } } });
        writeJson(ownerPath, { entries: { 9: { uid: 9, content: 'existing lorebook' } } });

        const summary = await runZWorldsToSecureConversion({ dataRoot, source: sourceDirectory });
        const securePath = path.join(dataRoot, '_secure', 'worlds', 'Z-alice-skip.json');

        expect(summary.counts.skippedTargetNotSymlink).toBe(1);
        expect(inspectKind(ownerPath)).toBe('file');
        expect(fs.existsSync(securePath)).toBe(false);
        expect(JSON.parse(fs.readFileSync(ownerPath, 'utf8')).entries['9'].content).toBe('existing lorebook');
    });

    itIfSymlinks('leaves non-symlink user copies in place and reports them during cleanup', async () => {
        const dataRoot = await createDataRoot();
        const aliceDirectories = await seedUser('alice');
        const bobDirectories = await seedUser('bob');
        const sourceDirectory = path.join(dataRoot, 'Z-worlds');
        const sourcePath = path.join(sourceDirectory, 'Z-alice-cleanup.json');
        const bobCopyPath = path.join(bobDirectories.worlds, 'Z-alice-cleanup.json');

        writeJson(sourcePath, { entries: { 4: { uid: 4, content: 'cleanup lorebook' } } });
        writeJson(bobCopyPath, { entries: { 5: { uid: 5, content: 'leave me alone' } } });

        const summary = await runZWorldsToSecureConversion({ dataRoot, source: sourceDirectory });
        const ownerPath = path.join(aliceDirectories.worlds, 'Z-alice-cleanup.json');

        expect(summary.counts.converted).toBe(1);
        expect(inspectKind(ownerPath)).toBe('file');
        expect(inspectKind(bobCopyPath)).toBe('file');
        expect(summary.cleanup.regularCopiesLeftInPlace).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    canonicalName: 'Z-alice-cleanup',
                    handle: 'bob',
                    path: bobCopyPath,
                }),
            ]),
        );
    });

    function inspectKind(filePath) {
        try {
            const stats = fs.lstatSync(filePath);
            if (stats.isSymbolicLink()) {
                return 'symlink';
            }
            if (stats.isFile()) {
                return 'file';
            }
            return 'other';
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return 'missing';
            }
            throw error;
        }
    }
});
