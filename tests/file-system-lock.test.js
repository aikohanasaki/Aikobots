import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { afterEach, describe, expect, it } from '@jest/globals';

import { withDirectoryLock } from '../src/file-system-lock.js';

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('file system lock ownership recovery', () => {
    let tempRoot = null;

    afterEach(() => {
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            tempRoot = null;
        }
    });

    it('rejects the stale owner before its next guarded write after the lock is reclaimed', async () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-file-lock-'));
        const lockPath = path.join(tempRoot, 'index.json.lock');
        const indexPath = path.join(tempRoot, 'index.json');
        const lockOptions = {
            lockPath,
            retryMs: 10,
            timeoutMs: 2_000,
            staleMs: 75,
            heartbeatMs: 500,
            timeoutMessage: 'Timed out waiting for the test lock.',
        };
        const firstWriteSteps = [];
        let resolveFirstAcquired;
        const firstAcquired = new Promise(resolve => {
            resolveFirstAcquired = resolve;
        });

        const firstOperation = withDirectoryLock(lockOptions, async (lock) => {
            resolveFirstAcquired();
            await wait(200);
            await lock.run(async () => {
                firstWriteSteps.push('first-write');
                await fsPromises.writeFile(indexPath, 'first', 'utf8');
            });
        });
        const firstFailure = expect(firstOperation).rejects.toMatchObject({
            code: 'ELOCKLOST',
            status: 503,
        });

        await firstAcquired;
        await wait(100);

        await withDirectoryLock(lockOptions, async (lock) => {
            await lock.run(async () => {
                await fsPromises.writeFile(indexPath, 'second', 'utf8');
            });
        });

        await firstFailure;
        expect(firstWriteSteps).toEqual([]);
        await expect(fsPromises.readFile(indexPath, 'utf8')).resolves.toBe('second');
    });
});
