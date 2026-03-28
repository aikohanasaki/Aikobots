import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    getHiddenLorebooksForCharacter,
    HIDDEN_LOREBOOK_BINDINGS_FILE,
    readHiddenLorebookBindings,
    writeHiddenLorebookBindings,
} from '../src/hidden-lorebook-bindings.js';

const tempRoots = [];

function createRootDir() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-hidden-bindings-'));
    tempRoots.push(rootDir);
    return rootDir;
}

afterEach(() => {
    while (tempRoots.length) {
        const rootDir = tempRoots.pop();
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

describe('hidden lorebook bindings registry', () => {
    it('returns an empty registry when the file is missing', () => {
        const rootDir = createRootDir();

        expect(readHiddenLorebookBindings({ rootDir })).toEqual({ characters: {} });
        expect(getHiddenLorebooksForCharacter('char_a', { rootDir })).toEqual([]);
    });

    it('normalizes entries and reloads manual file edits', () => {
        const rootDir = createRootDir();
        const registryPath = path.join(rootDir, HIDDEN_LOREBOOK_BINDINGS_FILE);

        fs.writeFileSync(registryPath, JSON.stringify({
            characters: {
                char_a: [' Lorebook A ', 'Lorebook A', '', 'Lorebook B'],
            },
        }, null, 4));

        expect(getHiddenLorebooksForCharacter('char_a', { rootDir })).toEqual(['Lorebook A', 'Lorebook B']);

        fs.writeFileSync(registryPath, JSON.stringify({
            characters: {
                char_b: ['Lorebook C'],
            },
        }, null, 4));

        const nextTime = new Date(Date.now() + 1000);
        fs.utimesSync(registryPath, nextTime, nextTime);

        expect(getHiddenLorebooksForCharacter('char_a', { rootDir })).toEqual([]);
        expect(getHiddenLorebooksForCharacter('char_b', { rootDir })).toEqual(['Lorebook C']);
    });
});
