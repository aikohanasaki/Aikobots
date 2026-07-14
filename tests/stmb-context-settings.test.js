import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

const user = { profile: { handle: 'alice' } };
let normalizeStmbContextEntries;
let userOwnsLorebookMetadata;

beforeAll(async () => {
    ({ normalizeStmbContextEntries, userOwnsLorebookMetadata } = await import('../src/stmb-context-settings.js'));
});

describe('STMB context setting ownership helpers', () => {
    it('accepts user lorebooks owned by the current user', () => {
        expect(userOwnsLorebookMetadata(user, {
            storage: 'user',
            ownerHandle: 'alice',
            ownerHandles: ['alice'],
        })).toBe(true);
    });

    it('accepts secure and shared secure lorebooks owned by the current user', () => {
        expect(userOwnsLorebookMetadata(user, {
            storage: 'secure',
            ownerHandle: 'alice',
            ownerHandles: ['alice'],
            sharingMode: 'single',
        })).toBe(true);

        expect(userOwnsLorebookMetadata(user, {
            storage: 'secure',
            ownerHandle: 'bob',
            ownerHandles: ['bob', 'alice'],
            sharingMode: 'shared',
        })).toBe(true);
    });

    it('rejects secure lorebooks not owned by the current user', () => {
        expect(userOwnsLorebookMetadata(user, {
            storage: 'secure',
            ownerHandle: 'bob',
            ownerHandles: ['bob'],
        })).toBe(false);
    });

    it('normalizes legacy context entry shapes without trusting missing identifiers', () => {
        expect(normalizeStmbContextEntries([
            { worldName: 'Book A', storage: 'secure', id: 5 },
            { lorebookName: '', uid: 2 },
            { lorebookName: 'Book B' },
        ])).toEqual([
            { lorebookName: 'Book A', storage: 'secure', uid: '5' },
        ]);
    });
});
