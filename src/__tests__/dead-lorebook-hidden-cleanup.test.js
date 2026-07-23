import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

let cleanupDeadLorebookHiddenReferences;
let compileAndWriteHiddenLorebookTemplates;
let readHiddenLorebookBindings;
let readHiddenLorebookTemplates;
let tempRoot;
let writeHiddenLorebookTemplates;

beforeAll(async () => {
    const utilModule = await import('../util.js');
    const configPath = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
        ? path.resolve(process.cwd(), 'config.yaml')
        : path.resolve(process.cwd(), '..', 'config.yaml');
    utilModule.setConfigFilePath(configPath);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-lorebook-hidden-cleanup-'));
    globalThis.DATA_ROOT = tempRoot;

    ({
        cleanupDeadLorebookHiddenReferences,
    } = await import('../lorebook-repository.js'));
    ({
        compileAndWriteHiddenLorebookTemplates,
        readHiddenLorebookTemplates,
        writeHiddenLorebookTemplates,
    } = await import('../hidden-lorebook-templates.js'));
    ({
        readHiddenLorebookBindings,
    } = await import('../hidden-lorebook-bindings.js'));
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('dead hidden lorebook cleanup', () => {
    it('removes exact dead names from template source and compiled bindings', async () => {
        writeHiddenLorebookTemplates({
            templates: {
                Core: {
                    add: ['Dead Book', 'Dead Book Extended'],
                    remove: ['Dead Book'],
                },
            },
            global: {
                templates: ['Core'],
                add: ['Dead Book', 'Live Book'],
                remove: [],
            },
            characters: {
                Aiko: {
                    templates: [],
                    add: ['Dead Book', 'Dead Book Extended'],
                    remove: ['Dead Book'],
                },
            },
        });
        compileAndWriteHiddenLorebookTemplates();

        const result = await cleanupDeadLorebookHiddenReferences(['Dead Book']);
        const source = readHiddenLorebookTemplates();
        const compiled = readHiddenLorebookBindings();

        expect(result).toEqual({
            changed: true,
            cleanedHiddenBindings: true,
            cleanedHiddenTemplates: true,
        });
        expect(source.templates.Core.add).toEqual(['Dead Book Extended']);
        expect(source.templates.Core.remove).toEqual([]);
        expect(source.global.add).toEqual(['Live Book']);
        expect(source.characters.Aiko.add).toEqual(['Dead Book Extended']);
        expect(source.characters.Aiko.remove).toEqual([]);
        expect(compiled.global).toEqual(['Dead Book Extended', 'Live Book']);
        expect(compiled.characters.Aiko).toEqual(['Dead Book Extended', 'Live Book']);
    });
});
