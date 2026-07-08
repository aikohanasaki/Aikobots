import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { withDirectoryLock } from '../file-system-lock.js';

function makeLockOptions(lockPath, overrides = {}) {
    return {
        lockPath,
        retryMs: 5,
        timeoutMs: 250,
        staleMs: 10,
        heartbeatMs: 25,
        timeoutMessage: 'Timed out waiting for test lock.',
        ...overrides,
    };
}

describe('file system directory locks', () => {
    it('recovers stale pre-owner file locks', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-lock-stale-'));
        const lockPath = path.join(tempDir, 'chat.sqlite.lock');
        const staleTime = new Date(Date.now() - 60_000);

        try {
            fs.writeFileSync(lockPath, '', 'utf8');
            fs.utimesSync(lockPath, staleTime, staleTime);

            const result = await withDirectoryLock(makeLockOptions(lockPath), async lock => {
                expect(fs.statSync(lockPath).isDirectory()).toBe(true);
                await lock.assertOwnership();
                return 'locked';
            });

            expect(result).toBe('locked');
            expect(fs.existsSync(lockPath)).toBe(false);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('does not recover fresh pre-owner file locks', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-lock-fresh-'));
        const lockPath = path.join(tempDir, 'chat.sqlite.lock');

        try {
            fs.writeFileSync(lockPath, '', 'utf8');

            await expect(withDirectoryLock(makeLockOptions(lockPath, {
                timeoutMs: 30,
                staleMs: 60_000,
            }), async () => 'locked')).rejects.toMatchObject({
                status: 503,
            });
            expect(fs.existsSync(lockPath)).toBe(true);
            expect(fs.statSync(lockPath).isFile()).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
