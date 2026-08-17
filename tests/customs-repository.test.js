import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    buildCustomsDocumentFromSettings,
    getCustomsPath,
    mergeCustomsIntoSettings,
    normalizeCustomsDocument,
    readCustomsDocument,
    stripCustomsFromSettings,
    writeCustomsDocument,
} from '../src/customs-repository.js';

describe('customs repository', () => {
    let tempRoot = null;

    afterEach(() => {
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            tempRoot = null;
        }
    });

    function createDirectories() {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-customs-'));
        return { root: tempRoot };
    }

    it('normalizes Generation Lock records and allowlisted overrides', () => {
        const document = normalizeCustomsDocument({
            version: 999,
            generationLocks: {
                characters: {
                    ' avatar.png ': {
                        connectionProfileId: ' profile-id ',
                        presetName: 'Preset A',
                        overrides: {
                            temp_openai: '0.8',
                            top_p_openai: 0.95,
                            custom_prompt_post_processing: 'strict',
                            unsafe: 1,
                        },
                    },
                    '': { presetName: 'ignored' },
                },
                groups: {
                    group1: {
                        overrides: {
                            top_k_openai: '40',
                        },
                    },
                },
            },
        });

        expect(document).toEqual({
            version: 1,
            generationLocks: {
                characters: {
                    'avatar.png': {
                        version: 1,
                        connectionProfileId: 'profile-id',
                        modelId: '',
                        presetName: 'Preset A',
                        overrides: {
                            temp_openai: 0.8,
                            top_p_openai: 0.95,
                        },
                        updatedAt: '1970-01-01T00:00:00.000Z',
                    },
                },
                groups: {
                    group1: {
                        version: 1,
                        connectionProfileId: '',
                        modelId: '',
                        presetName: '',
                        overrides: {
                            top_k_openai: 40,
                        },
                        updatedAt: '1970-01-01T00:00:00.000Z',
                    },
                },
            },
        });
    });

    it('writes and reads customs.json as a normalized document', () => {
        const directories = createDirectories();
        const written = writeCustomsDocument(directories, {
            generationLocks: {
                characters: {
                    avatar: {
                        presetName: 'Preset B',
                    },
                },
            },
        });

        expect(fs.existsSync(getCustomsPath(directories))).toBe(true);
        expect(readCustomsDocument(directories)).toEqual(written);
    });

    it('merges customs into settings and strips them before settings persistence', () => {
        const settings = { power_user: {}, customs: { generationLocks: { groups: { group1: { presetName: 'Preset C' } } } } };
        const document = buildCustomsDocumentFromSettings(settings);
        const merged = mergeCustomsIntoSettings({ power_user: {} }, document);

        expect(merged.customs.generationLocks.groups.group1.presetName).toBe('Preset C');
        expect(stripCustomsFromSettings(merged)).toEqual({ power_user: {} });
    });
});
