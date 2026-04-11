/*
 * One-time generator for building a hidden lorebook template SOURCE file from
 * an st_config.py character/template registry.
 *
 * Usage:
 *   node .\scripts\generate-hidden-lorebook-template-source.mjs --input C:\path\to\st_config.py
 *   node .\scripts\generate-hidden-lorebook-template-source.mjs --input C:\path\to\st_config.py --output .\hidden-lorebook-templates.generated.json
 *   node .\scripts\generate-hidden-lorebook-template-source.mjs --input C:\path\to\st_config.py --include-remove
 *
 * What this script does:
 * - Reads template definitions from st_config.py.
 * - Reads CHARACTER_LORE assignments that use merge_book_configs(...).
 * - Converts that data into the hidden-lorebook source registry shape used by
 *   _system\hidden-lorebooks\hidden-lorebook-templates.json.
 * - Ignores remove rules by default to match the current cleanup request.
 *
 * Important notes:
 * - Character keys are written from the card names in st_config.py.
 * - Secure lorebooks are taken from each card's inline add list.
 * - Hidden templates are taken from the named merge_book_configs(...) args.
 * - Use --include-remove if you want remove arrays preserved in the output.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { normalizeHiddenLorebookTemplates } from '../src/hidden-lorebook-templates.js';

const DEFAULT_OUTPUT_FILE = 'hidden-lorebook-templates.generated.json';

function parseArgs(argv) {
    const options = {
        input: undefined,
        output: undefined,
        includeRemove: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--input':
                options.input = argv[++index] ?? undefined;
                break;
            case '--output':
                options.output = argv[++index] ?? undefined;
                break;
            case '--include-remove':
                options.includeRemove = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function printUsage() {
    console.log('Usage:');
    console.log('  node .\\scripts\\generate-hidden-lorebook-template-source.mjs --input C:\\path\\to\\st_config.py');
    console.log('  node .\\scripts\\generate-hidden-lorebook-template-source.mjs --input C:\\path\\to\\st_config.py --output .\\hidden-lorebook-templates.generated.json');
    console.log('  node .\\scripts\\generate-hidden-lorebook-template-source.mjs --input C:\\path\\to\\st_config.py --include-remove');
}

function decodePythonString(value) {
    return value
        .replace(/\\\\/g, '\\')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, '\'');
}

function parsePythonStringList(listText) {
    const values = [];
    const stringPattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
    let match = null;

    while ((match = stringPattern.exec(listText)) !== null) {
        const raw = match[1] ?? match[2] ?? '';
        values.push(decodePythonString(raw));
    }

    return values;
}

function extractPythonListValue(dictText, key) {
    const pattern = new RegExp(`["']${key}["']\\s*:\\s*\\[(?<items>[\\s\\S]*?)\\]`);
    const match = dictText.match(pattern);
    return match?.groups?.items ? parsePythonStringList(match.groups.items) : [];
}

function parsePythonConfigObject(dictText, { includeRemove = false } = {}) {
    return {
        add: extractPythonListValue(dictText, 'add'),
        remove: includeRemove ? extractPythonListValue(dictText, 'remove') : [],
    };
}

function splitTopLevelArgs(text) {
    const parts = [];
    let buffer = '';
    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;

    for (const char of text) {
        if (inString) {
            buffer += char;
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === quote) {
                inString = false;
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === '\'') {
            inString = true;
            quote = char;
            buffer += char;
            continue;
        }

        if (char === '{' || char === '[' || char === '(') {
            depth++;
            buffer += char;
            continue;
        }

        if (char === '}' || char === ']' || char === ')') {
            depth--;
            buffer += char;
            continue;
        }

        if (char === ',' && depth === 0) {
            const value = buffer.trim();
            if (value) {
                parts.push(value);
            }
            buffer = '';
            continue;
        }

        buffer += char;
    }

    const tail = buffer.trim();
    if (tail) {
        parts.push(tail);
    }

    return parts;
}

function parseTemplateDefinitions(source, { includeRemove = false } = {}) {
    const templates = {};
    const reserved = new Set([
        'REQUIRE_ROOT',
        'BASE_DIR',
        'DATA_DIR',
        'DEFAULT_USER_DIR',
        'DEFAULT_CONTENT_DIR',
        'SETTINGS_SOURCE',
        'SETTINGS_DEST',
        'INDEX_PATH',
        'CHARACTERS_PATH',
        'WORLDS_PATH',
        'SYMLINKED_WORLDS',
    ]);
    const pattern = /^([A-Z][A-Z0-9_]*)\s*=\s*\{\r?\n([\s\S]*?)^\}/gm;
    let match = null;

    while ((match = pattern.exec(source)) !== null) {
        const name = match[1];
        if (reserved.has(name)) {
            continue;
        }

        templates[name] = parsePythonConfigObject(match[0], { includeRemove });
    }

    return templates;
}

function extractCharacterLoreBlock(source) {
    const marker = 'CHARACTER_LORE = [';
    const startIndex = source.indexOf(marker);
    if (startIndex === -1) {
        throw new Error('Could not find CHARACTER_LORE block in st_config.py.');
    }

    const lines = source.slice(startIndex + marker.length).split(/\r?\n/);
    const collected = [];

    for (const line of lines) {
        if (line.trim() === ']') {
            break;
        }
        collected.push(line);
    }

    return collected;
}

function parseCharacterEntries(source, { includeRemove = false } = {}) {
    const characters = {};
    const lines = extractCharacterLoreBlock(source);
    const entryPattern = /^\s*\("(?<card>(?:[^"\\]|\\.)*)",\s*merge_book_configs\((?<args>.*)\)\),?\s*$/;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const match = trimmed.match(entryPattern);
        if (!match) {
            continue;
        }

        const card = decodePythonString(match.groups.card);
        const argParts = splitTopLevelArgs(match.groups.args);
        const inlineConfigText = argParts.find(part => part.startsWith('{'));
        const templateNames = argParts
            .filter(part => !part.startsWith('{'))
            .map(part => String(part || '').trim())
            .filter(Boolean);
        const inlineConfig = inlineConfigText
            ? parsePythonConfigObject(inlineConfigText, { includeRemove })
            : { add: [], remove: [] };

        characters[card] = {
            templates: templateNames,
            add: inlineConfig.add,
            remove: inlineConfig.remove,
        };
    }

    return characters;
}

export function buildHiddenLorebookTemplateSource(stConfigText, { includeRemove = false } = {}) {
    if (!String(stConfigText || '').trim()) {
        throw new Error('st_config.py is empty.');
    }

    const data = {
        templates: parseTemplateDefinitions(stConfigText, { includeRemove }),
        characters: parseCharacterEntries(stConfigText, { includeRemove }),
    };

    return normalizeHiddenLorebookTemplates(data);
}

export function generateHiddenLorebookTemplateSourceFile({
    inputPath,
    outputPath,
    includeRemove = false,
} = {}) {
    const resolvedInputPath = path.resolve(String(inputPath || ''));
    if (!fs.existsSync(resolvedInputPath)) {
        throw new Error(`Input file does not exist: ${resolvedInputPath}`);
    }

    const sourceText = fs.readFileSync(resolvedInputPath, 'utf8');
    const generated = buildHiddenLorebookTemplateSource(sourceText, { includeRemove });
    const resolvedOutputPath = path.resolve(outputPath || DEFAULT_OUTPUT_FILE);

    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, JSON.stringify(generated, null, 4), 'utf8');

    return {
        outputPath: resolvedOutputPath,
        generated,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    if (!options.input) {
        printUsage();
        throw new Error('Missing required --input argument.');
    }

    const result = generateHiddenLorebookTemplateSourceFile({
        inputPath: options.input,
        outputPath: options.output,
        includeRemove: options.includeRemove,
    });

    console.log(`Wrote hidden lorebook template source to ${result.outputPath}`);
    console.log(`Templates: ${Object.keys(result.generated.templates).length}`);
    console.log(`Characters: ${Object.keys(result.generated.characters).length}`);
    if (!options.includeRemove) {
        console.log('Remove arrays were omitted by default.');
    }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
