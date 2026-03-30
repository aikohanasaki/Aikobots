import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    compileAndWriteHiddenLorebookTemplates,
    HIDDEN_LOREBOOK_TEMPLATES_FILE,
    normalizeHiddenLorebookTemplates,
    readHiddenLorebookTemplates,
    writeHiddenLorebookTemplates,
} from '../src/hidden-lorebook-templates.js';
import { readHiddenLorebookBindings } from '../src/hidden-lorebook-bindings.js';

const tempRoots = [];

function createRootDir() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-hidden-template-bindings-'));
    tempRoots.push(rootDir);
    return rootDir;
}

afterEach(() => {
    while (tempRoots.length) {
        const rootDir = tempRoots.pop();
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

describe('hidden lorebook templates registry', () => {
    it('returns an empty registry when the file is missing', () => {
        const rootDir = createRootDir();

        expect(readHiddenLorebookTemplates({ rootDir })).toEqual({ templates: {}, characters: {} });
    });

    it('normalizes template and character entries', () => {
        expect(normalizeHiddenLorebookTemplates({
            templates: {
                ' AIKOBOTS ': {
                    add: [' Lorebook B ', 'Lorebook A', 'Lorebook B'],
                    remove: [' Lorebook C ', '', 'Lorebook C'],
                },
            },
            characters: {
                'char_a.png': {
                    templates: [' LADS ', 'AIKOBOTS', 'LADS'],
                    add: [' Extra ', 'Extra'],
                    remove: [' Remove Me ', 'Remove Me'],
                },
                'char_b': [],
            },
        })).toEqual({
            templates: {
                AIKOBOTS: {
                    add: ['Lorebook A', 'Lorebook B'],
                    remove: ['Lorebook C'],
                },
            },
            characters: {
                char_a: {
                    templates: ['AIKOBOTS', 'LADS'],
                    add: ['Extra'],
                    remove: ['Remove Me'],
                },
            },
        });
    });

    it('compiles template assignments into the flat runtime bindings file', () => {
        const rootDir = createRootDir();
        writeHiddenLorebookTemplates({
            templates: {
                AIKOBOTS: {
                    add: ['9Z Universal Commands', '9Z Aikobots'],
                    remove: ['9Z Omegaverse'],
                },
                LADS: {
                    add: ['9Z LaDS World Info', '9Z Omegaverse'],
                    remove: ['9Z Universal Commands'],
                },
            },
            characters: {
                char_a: {
                    templates: ['LADS', 'AIKOBOTS', 'Missing'],
                    add: ['Character Specific Book'],
                    remove: ['9Z Aikobots'],
                },
                char_b: {
                    templates: ['AIKOBOTS'],
                    add: [],
                    remove: [],
                },
            },
        }, { rootDir });

        const result = compileAndWriteHiddenLorebookTemplates({ rootDir });

        expect(result.source).toEqual({
            templates: {
                AIKOBOTS: {
                    add: ['9Z Aikobots', '9Z Universal Commands'],
                    remove: ['9Z Omegaverse'],
                },
                LADS: {
                    add: ['9Z LaDS World Info', '9Z Omegaverse'],
                    remove: ['9Z Universal Commands'],
                },
            },
            characters: {
                char_a: {
                    templates: ['AIKOBOTS', 'LADS', 'Missing'],
                    add: ['Character Specific Book'],
                    remove: ['9Z Aikobots'],
                },
                char_b: {
                    templates: ['AIKOBOTS'],
                    add: [],
                    remove: [],
                },
            },
        });

        expect(result.compiled).toEqual({
            characters: {
                char_a: ['9Z LaDS World Info', 'Character Specific Book'],
                char_b: ['9Z Aikobots', '9Z Universal Commands'],
            },
        });

        expect(result.missingTemplates).toEqual({
            char_a: ['Missing'],
        });

        expect(readHiddenLorebookBindings({ rootDir })).toEqual({
            characters: {
                char_a: ['9Z LaDS World Info', 'Character Specific Book'],
                char_b: ['9Z Aikobots', '9Z Universal Commands'],
            },
        });
    });

    it('reloads manual source edits when the source file changes on disk', () => {
        const rootDir = createRootDir();
        const registryPath = path.join(rootDir, HIDDEN_LOREBOOK_TEMPLATES_FILE);

        writeHiddenLorebookTemplates({
            templates: {
                AIKOBOTS: { add: ['Lorebook A'], remove: [] },
            },
            characters: {},
        }, { rootDir });

        expect(readHiddenLorebookTemplates({ rootDir })).toEqual({
            templates: {
                AIKOBOTS: { add: ['Lorebook A'], remove: [] },
            },
            characters: {},
        });

        fs.writeFileSync(registryPath, JSON.stringify({
            templates: {
                LADS: { add: ['Lorebook B'], remove: [] },
            },
            characters: {
                char_a: {
                    templates: ['LADS'],
                    add: [],
                    remove: [],
                },
            },
        }, null, 4));

        const nextTime = new Date(Date.now() + 1000);
        fs.utimesSync(registryPath, nextTime, nextTime);

        expect(readHiddenLorebookTemplates({ rootDir })).toEqual({
            templates: {
                LADS: { add: ['Lorebook B'], remove: [] },
            },
            characters: {
                char_a: {
                    templates: ['LADS'],
                    add: [],
                    remove: [],
                },
            },
        });
    });
});
