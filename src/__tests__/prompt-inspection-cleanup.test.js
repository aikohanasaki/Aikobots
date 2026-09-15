import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';

let cleanupPromptInspectionSnapshots;
let root;
let directory;
let previousRoot;

beforeAll(async () => {
    ({ cleanupPromptInspectionSnapshots } = await import('../endpoints/backends/chat-completions.js'));
});

beforeEach(async () => {
    previousRoot = globalThis.DATA_ROOT;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-expiry-'));
    globalThis.DATA_ROOT = root;
    directory = path.join(root, '_secure', 'prompt-inspection');
});

afterEach(async () => {
    jest.restoreAllMocks();
    globalThis.DATA_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
});

it('tolerates a missing directory and concurrent cleanup, retaining recent and unrelated files', async () => {
    await cleanupPromptInspectionSnapshots();
    await fs.mkdir(directory, { recursive: true });
    const old = path.join(directory, `${'a'.repeat(64)}.json`);
    const recent = `${'b'.repeat(64)}.json`;
    await fs.writeFile(old, '{}');
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(old, yesterday, yesterday);
    await fs.writeFile(path.join(directory, recent), '{}');
    await fs.writeFile(path.join(directory, 'unrelated.json'), '{}');
    await Promise.all([cleanupPromptInspectionSnapshots(), cleanupPromptInspectionSnapshots()]);
    expect((await fs.readdir(directory)).sort()).toEqual([recent, 'unrelated.json'].sort());
});

it('retains a snapshot refreshed between the initial age check and the locked check', async () => {
    await fs.mkdir(directory, { recursive: true });
    const snapshot = path.join(directory, `${'c'.repeat(64)}.json`);
    await fs.writeFile(snapshot, '{}');
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(snapshot, yesterday, yesterday);
    const lstat = fs.lstat.bind(fs);
    let checks = 0;
    jest.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
        if (args[0] === snapshot && ++checks === 2) {
            const now = new Date();
            await fs.utimes(snapshot, now, now);
        }
        return lstat(...args);
    });
    await cleanupPromptInspectionSnapshots();
    expect(checks).toBe(2);
    expect(await fs.readFile(snapshot, 'utf8')).toBe('{}');
});
