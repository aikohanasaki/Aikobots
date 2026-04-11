import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    buildHiddenLorebookTemplateSource,
    generateHiddenLorebookTemplateSourceFile,
} from '../scripts/generate-hidden-lorebook-template-source.mjs';

const tempRoots = [];

function createTempRoot() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-config-template-source-'));
    tempRoots.push(rootDir);
    return rootDir;
}

afterEach(() => {
    while (tempRoots.length) {
        fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
    }
});

describe('generate hidden lorebook template source from st_config.py', () => {
    it('builds normalized template source while ignoring remove arrays by default', () => {
        const source = `
AIKOBOTS = {
    "add": ["9Z Universal Commands", "9Z Aikobots"],
    "remove": []
}

NOOMEGA = {
    "add": ["9Z Celebrations"],
    "remove": ["9Z Omegaverse"]
}

def merge_book_configs(*configs):
    return {"add": [], "remove": []}

CHARACTER_LORE = [
    ("Zee", merge_book_configs({"add": ["9ZZ Zee"], "remove": ["Ignore Me"]}, AIKOBOTS)),
    ("Isamu", merge_book_configs({"add": ["Z-kaiyazure-Isamu"]}, NOOMEGA)),
]
`;

        expect(buildHiddenLorebookTemplateSource(source)).toEqual({
            templates: {
                AIKOBOTS: {
                    add: ['9Z Aikobots', '9Z Universal Commands'],
                    remove: [],
                },
                NOOMEGA: {
                    add: ['9Z Celebrations'],
                    remove: [],
                },
            },
            characters: {
                Isamu: {
                    templates: ['NOOMEGA'],
                    add: ['Z-kaiyazure-Isamu'],
                    remove: [],
                },
                Zee: {
                    templates: ['AIKOBOTS'],
                    add: ['9ZZ Zee'],
                    remove: [],
                },
            },
        });
    });

    it('can preserve remove arrays when requested and writes a file', () => {
        const rootDir = createTempRoot();
        const inputPath = path.join(rootDir, 'st_config.py');
        const outputPath = path.join(rootDir, 'hidden-lorebook-templates.generated.json');

        fs.writeFileSync(inputPath, `
UNIVERSAL = {
    "add": ["9Z Universal Commands"],
    "remove": ["9Z Omegaverse"]
}

def merge_book_configs(*configs):
    return {"add": [], "remove": []}

CHARACTER_LORE = [
    ("Xaden Riorson", merge_book_configs({"add": ["Z-missluckii-xaden"], "remove": ["Z-ravenh-TheEmpyrean"]}, UNIVERSAL)),
]
`, 'utf8');

        const result = generateHiddenLorebookTemplateSourceFile({
            inputPath,
            outputPath,
            includeRemove: true,
        });

        expect(result.generated).toEqual({
            templates: {
                UNIVERSAL: {
                    add: ['9Z Universal Commands'],
                    remove: ['9Z Omegaverse'],
                },
            },
            characters: {
                'Xaden Riorson': {
                    templates: ['UNIVERSAL'],
                    add: ['Z-missluckii-xaden'],
                    remove: ['Z-ravenh-TheEmpyrean'],
                },
            },
        });

        expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(result.generated);
    });
});
