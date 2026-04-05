import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    deleteLorebookForManagement,
    LorebookRepositoryError,
    readLorebookForGeneration,
    readWorldInfoFile,
    saveLorebookForManagement,
} from '../src/lorebook-repository.js';

describe('lorebook repository json name normalization', () => {
    let dataRoot;
    let previousDataRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-lorebooks-'));
        globalThis.DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        globalThis.DATA_ROOT = previousDataRoot;
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    it('rejects manual lorebook saves whose names end with .json', () => {
        const user = {
            profile: {
                handle: 'alice',
            },
        };

        let error = null;
        try {
            saveLorebookForManagement(user, 'mybook.json', { entries: {} });
        } catch (caughtError) {
            error = caughtError;
        }

        expect(error).toBeInstanceOf(LorebookRepositoryError);
        expect(error?.type).toBe('LorebookInvalidName');
    });

    it('repairs legacy world info files named *.json.json when reading from a directory', () => {
        const worldsDir = path.join(dataRoot, 'worlds');
        fs.mkdirSync(worldsDir, { recursive: true });
        const legacyPath = path.join(worldsDir, 'mybook.json.json');
        const canonicalPath = path.join(worldsDir, 'mybook.json');
        fs.writeFileSync(legacyPath, JSON.stringify({ entries: { 1: { uid: 1, content: 'legacy' } } }), 'utf8');

        const lorebook = readWorldInfoFile({ worlds: worldsDir }, 'mybook', false);

        expect(lorebook).toEqual({ entries: { 1: { uid: 1, content: 'legacy' } } });
        expect(fs.existsSync(canonicalPath)).toBe(true);
        expect(fs.existsSync(legacyPath)).toBe(false);
    });

    it('resolves legacy user lorebook files even when the requested name still ends with .json', () => {
        const worldsDir = path.join(dataRoot, 'alice', 'worlds');
        fs.mkdirSync(worldsDir, { recursive: true });
        const legacyPath = path.join(worldsDir, 'mybook.json.json');
        const canonicalPath = path.join(worldsDir, 'mybook.json');
        fs.writeFileSync(legacyPath, JSON.stringify({ entries: { 2: { uid: 2, content: 'generation' } } }), 'utf8');

        const lorebook = readLorebookForGeneration({ profile: { handle: 'alice' } }, 'mybook.json', false);

        expect(lorebook).toEqual({ entries: { 2: { uid: 2, content: 'generation' } } });
        expect(fs.existsSync(canonicalPath)).toBe(true);
        expect(fs.existsSync(legacyPath)).toBe(false);
    });

    it('deletes a user lorebook shadow even when another user owns a secure lorebook with the same name', () => {
        const user = {
            profile: {
                handle: 'alice',
                admin: false,
            },
        };
        const userWorldsDir = path.join(dataRoot, 'alice', 'worlds');
        const secureWorldsDir = path.join(dataRoot, '_secure', 'worlds');
        const userLorebookPath = path.join(userWorldsDir, 'shadowed.json');
        const secureLorebookPath = path.join(secureWorldsDir, 'shadowed.json');
        const secureIndexPath = path.join(secureWorldsDir, 'index.json');

        fs.mkdirSync(userWorldsDir, { recursive: true });
        fs.mkdirSync(secureWorldsDir, { recursive: true });
        fs.writeFileSync(userLorebookPath, JSON.stringify({ entries: { 1: { uid: 1, content: 'user copy' } } }), 'utf8');
        fs.writeFileSync(secureLorebookPath, JSON.stringify({ entries: { 2: { uid: 2, content: 'secure copy' } } }), 'utf8');
        fs.writeFileSync(secureIndexPath, JSON.stringify({
            version: 1,
            books: {
                shadowed: {
                    ownerHandle: 'bob',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                    createdBy: 'bob',
                    updatedBy: 'bob',
                },
            },
        }), 'utf8');

        const originalLstatSync = fs.lstatSync;
        const lstatSpy = jest.spyOn(fs, 'lstatSync').mockImplementation((targetPath, options) => {
            if (path.resolve(String(targetPath)) === path.resolve(secureLorebookPath)) {
                return {
                    isSymbolicLink: () => true,
                };
            }

            return originalLstatSync(targetPath, options);
        });

        try {
            const result = deleteLorebookForManagement(user, 'shadowed');

            expect(result).toEqual({
                name: 'shadowed',
                storage: 'user',
                ownerHandle: 'alice',
            });
            expect(fs.existsSync(userLorebookPath)).toBe(false);
            expect(fs.existsSync(secureLorebookPath)).toBe(true);
        } finally {
            lstatSpy.mockRestore();
        }
    });
});
