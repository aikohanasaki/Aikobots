import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
    mutateStmbSidePrompts,
    readStmbSidePrompts,
    saveStmbSidePrompts,
} from '../stmb-side-prompts-repository.js';

let tempRoot;
let user;

beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stmb-side-prompts-'));
    globalThis.DATA_ROOT = tempRoot;
    user = {
        profile: { handle: 'alice' },
        directories: { files: path.join(tempRoot, 'users', 'alice', 'files') },
    };
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('STMB side-prompt repository', () => {
    it('rejects a stale whole-document save without replacing newer data', async () => {
        const base = { version: 2, prompts: {}, sets: {} };
        const first = await saveStmbSidePrompts(user, base, 'missing');
        await saveStmbSidePrompts(user, { ...base, marker: 'newer' }, first.revision);

        await expect(saveStmbSidePrompts(user, { ...base, marker: 'stale' }, first.revision))
            .rejects.toMatchObject({ type: 'StmbSidePromptsConflict', status: 409 });
        expect(readStmbSidePrompts(user).document.marker).toBe('newer');
    });

    it('serializes concurrent mutations so neither update is lost', async () => {
        const current = readStmbSidePrompts(user);
        await saveStmbSidePrompts(user, { version: 2, prompts: {}, sets: {}, updates: [] }, current.revision);

        await Promise.all([
            mutateStmbSidePrompts(user, document => {
                document.updates.push('one');
                return document;
            }),
            mutateStmbSidePrompts(user, document => {
                document.updates.push('two');
                return document;
            }),
        ]);

        expect(readStmbSidePrompts(user).document.updates).toEqual(['one', 'two']);
    });
});
