import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

let cleanupDeadLorebookHiddenReferences;
let cleanupDeadLorebookSettingsReferences;
let compileAndWriteHiddenLorebookTemplates;
let isHiddenLorebookCompilationPending;
let migrateHiddenLorebookTemplateReferences;
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
        isHiddenLorebookCompilationPending,
        migrateHiddenLorebookTemplateReferences,
        readHiddenLorebookTemplates,
        writeHiddenLorebookTemplates,
    } = await import('../hidden-lorebook-templates.js'));
    ({
        readHiddenLorebookBindings,
    } = await import('../hidden-lorebook-bindings.js'));
    ({ cleanupDeadLorebookSettingsReferences } = await import('../dead-lorebook-cleanup.js'));
});

beforeEach(() => {
    fs.rmSync(path.join(tempRoot, '_system'), { recursive: true, force: true });
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('dead hidden lorebook cleanup', () => {
    it('cleans both legacy settings layouts only for explicitly assigned characters and is repeatable', async () => {
        writeHiddenLorebookTemplates({
            templates: { Core: { add: ['Synthetic Core'] } },
            global: { templates: ['Core'] },
            characters: { 'Dr. Synthetic.png': { templates: ['Core'] } },
        });
        const directories = { root: path.join(tempRoot, 'synthetic-user') };
        fs.mkdirSync(directories.root, { recursive: true });
        const settingsPath = path.join(directories.root, 'settings.json');
        const worldInfo = {
            globalSelect: ['Synthetic Optional'],
            charLore: [
                { name: 'Dr. Synthetic', extraBooks: ['Synthetic Optional'] },
                { name: ' Dr. Synthetic.webp ', extraBooks: ['Synthetic Other'] },
                { name: 'Dr. Synthetic Extended', extraBooks: ['Synthetic Keep'] },
                { name: 'Unassigned', extraBooks: ['Synthetic Keep'] },
            ],
        };
        const settings = {
            world_info: structuredClone(worldInfo),
            world_info_settings: { world_info: structuredClone(worldInfo) },
            power_user: { persona_description_lorebook: 'Synthetic Persona' },
            unrelated: { keep: true },
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings));
        const result = await cleanupDeadLorebookSettingsReferences(directories);
        expect(result.changed).toBe(true);
        expect(result.removedCount).toBe(4);
        const expected = structuredClone(settings);
        expected.world_info.charLore = worldInfo.charLore.slice(2);
        expected.world_info_settings.world_info.charLore = worldInfo.charLore.slice(2);
        expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual(expected);
        const cleaned = fs.readFileSync(settingsPath, 'utf8');
        expect((await cleanupDeadLorebookSettingsReferences(directories)).changed).toBe(false);
        expect(fs.readFileSync(settingsPath, 'utf8')).toBe(cleaned);
    });

    it('leaves settings intact and reports a content-free error when template reading fails', async () => {
        const directories = { root: path.join(tempRoot, 'synthetic-failure-user') };
        fs.mkdirSync(directories.root, { recursive: true });
        const settingsPath = path.join(directories.root, 'settings.json');
        const settings = JSON.stringify({ world_info: { charLore: [{ name: 'Synthetic', extraBooks: ['Synthetic Keep'] }] } });
        fs.writeFileSync(settingsPath, settings);
        const originalStatSync = fs.statSync;
        const statSpy = jest.spyOn(fs, 'statSync').mockImplementation((filePath, ...args) => {
            if (String(filePath).includes('hidden-lorebooks')) throw new Error('Synthetic private registry payload');
            return originalStatSync(filePath, ...args);
        });
        try {
            await expect(cleanupDeadLorebookSettingsReferences(directories)).rejects.toThrow(
                'Unable to read hidden template assignments for settings cleanup.',
            );
            expect(fs.readFileSync(settingsPath, 'utf8')).toBe(settings);
        } finally {
            statSpy.mockRestore();
        }
    });

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

    it('retries compilation when cleaned source has a durable pending marker', async () => {
        writeHiddenLorebookTemplates({
            global: {
                add: ['Dead Book', 'Live Book'],
            },
        });
        compileAndWriteHiddenLorebookTemplates();

        const migration = migrateHiddenLorebookTemplateReferences({ oldName: 'Dead Book' });

        expect(migration.changed).toBe(true);
        expect(isHiddenLorebookCompilationPending()).toBe(true);
        expect(readHiddenLorebookTemplates().global.add).toEqual(['Live Book']);
        expect(readHiddenLorebookBindings().global).toEqual(['Dead Book', 'Live Book']);

        const result = await cleanupDeadLorebookHiddenReferences([]);

        expect(result.changed).toBe(true);
        expect(result.cleanedHiddenBindings).toBe(false);
        expect(result.cleanedHiddenTemplates).toBe(false);
        expect(isHiddenLorebookCompilationPending()).toBe(false);
        expect(readHiddenLorebookBindings().global).toEqual(['Live Book']);
    });

    it('wraps pending marker read failures as hidden cleanup failures', async () => {
        const originalStatSync = fs.statSync;
        const pendingMarkerPath = path.join(
            tempRoot,
            '_system',
            'hidden-lorebooks',
            'hidden-lorebook-compile.pending',
        );
        const statSpy = jest.spyOn(fs, 'statSync').mockImplementation((filePath, ...args) => {
            if (path.resolve(String(filePath)) === pendingMarkerPath) {
                const error = new Error('Pending marker is not readable.');
                error.code = 'EACCES';
                throw error;
            }

            return originalStatSync(filePath, ...args);
        });

        try {
            await expect(cleanupDeadLorebookHiddenReferences([])).rejects.toMatchObject({
                type: 'DeadLorebookHiddenCleanupFailed',
                status: 500,
            });
        } finally {
            statSpy.mockRestore();
        }
    });
});
