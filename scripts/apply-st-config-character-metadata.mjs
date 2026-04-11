/*
 * One-time migration tool for applying owner + lorebook metadata from
 * st_config.py onto existing character PNG cards.
 *
 * Usage:
 *   node .\scripts\apply-st-config-character-metadata.mjs --input C:\path\to\st_config.py --characters-dir C:\path\to\characters
 *   node .\scripts\apply-st-config-character-metadata.mjs --input C:\path\to\st_config.py --characters-dir C:\path\to\characters --data-root C:\path\to\data
 *   node .\scripts\apply-st-config-character-metadata.mjs --input C:\path\to\st_config.py --characters-dir C:\path\to\characters --data-root C:\path\to\data --dry-run
 *
 * What this script does:
 * - Reads hidden template + character assignment data from st_config.py.
 * - Recursively scans a character directory for PNG cards whose filenames match
 *   the card names in st_config.py.
 * - Updates each matched card in place with:
 *   - data.extensions.aikobots.owner_handle
 *   - data.extensions.aikobots.owner_handles
 *   - data.extensions.aikobots.sharing_mode = "single"
 *   - data.extensions.aikobots.shared_character_key
 *   - data.extensions.aikobots.secure_lorebooks
 * - Optionally updates the hidden template source registry under a DATA_ROOT and
 *   compiles the runtime bindings file.
 *
 * Important notes:
 * - This script treats these cards as single-owner pushed characters, not true
 *   multi-owner shared characters.
 * - Owner handles are inferred from secure lorebook names:
 *   - 9Z* / 9ZZ* lorebooks => default owner
 *   - Z-<handle>-* lorebooks => <handle>
 * - Hidden template assignments live in the hidden lorebook source registry,
 *   not inside the PNG card metadata.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import writeFileAtomic, { sync as writeFileAtomicSync } from 'write-file-atomic';
import yaml from 'yaml';

import { parse, write } from '../src/character-card-parser.js';
import {
    compileAndWriteHiddenLorebookTemplates,
    normalizeHiddenLorebookTemplates,
    readHiddenLorebookTemplates,
    writeHiddenLorebookTemplates,
} from '../src/hidden-lorebook-templates.js';
import { serverDirectory } from '../src/server-directory.js';
import { buildHiddenLorebookTemplateSource } from './generate-hidden-lorebook-template-source.mjs';

function getConfiguredDefaultScaffoldRoot(configPath = path.join(serverDirectory, 'config.yaml')) {
    try {
        if (!fs.existsSync(configPath)) {
            return './default/scaffold';
        }

        const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
        return String(config?.defaultScaffoldRoot || './default/scaffold');
    } catch {
        return './default/scaffold';
    }
}

const configuredDefaultScaffoldRoot = getConfiguredDefaultScaffoldRoot();

function parseArgs(argv) {
    const options = {
        input: undefined,
        charactersDir: undefined,
        dataRoot: undefined,
        scaffoldRoot: configuredDefaultScaffoldRoot,
        defaultOwner: 'default-user',
        dryRun: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--input':
                options.input = argv[++index] ?? undefined;
                break;
            case '--characters-dir':
                options.charactersDir = argv[++index] ?? undefined;
                break;
            case '--data-root':
                options.dataRoot = argv[++index] ?? undefined;
                break;
            case '--scaffold-root':
                options.scaffoldRoot = argv[++index] ?? undefined;
                break;
            case '--default-owner':
                options.defaultOwner = argv[++index] ?? options.defaultOwner;
                break;
            case '--dry-run':
                options.dryRun = true;
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
    console.log('  node .\\scripts\\apply-st-config-character-metadata.mjs --input C:\\path\\to\\st_config.py --characters-dir C:\\path\\to\\characters');
    console.log('  node .\\scripts\\apply-st-config-character-metadata.mjs --input C:\\path\\to\\st_config.py --characters-dir C:\\path\\to\\characters --data-root C:\\path\\to\\data');
    console.log('  node .\\scripts\\apply-st-config-character-metadata.mjs --input C:\\path\\to\\st_config.py --characters-dir C:\\path\\to\\characters --scaffold-root C:\\path\\to\\scaffold');
    console.log('  node .\\scripts\\apply-st-config-character-metadata.mjs --input C:\\path\\to\\st_config.py --characters-dir C:\\path\\to\\characters --data-root C:\\path\\to\\data --dry-run');
}

function assertDirectoryExists(dirPath, label) {
    const resolvedPath = path.resolve(String(dirPath || ''));
    if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        throw new Error(`${label} does not exist or is not a directory: ${resolvedPath}`);
    }

    return resolvedPath;
}

function assertFileExists(filePath, label) {
    const resolvedPath = path.resolve(String(filePath || ''));
    if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        throw new Error(`${label} does not exist or is not a file: ${resolvedPath}`);
    }

    return resolvedPath;
}

function compareStrings(a, b) {
    return String(a).localeCompare(String(b));
}

function readContentIndex(indexPath) {
    if (!fs.existsSync(indexPath)) {
        return [];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function upsertScaffoldCharacterIndex(scaffoldRoot, fileName) {
    const indexPath = path.join(scaffoldRoot, 'index.json');
    const relativeFilename = path.join('characters', fileName).replaceAll('\\', '/');
    const index = readContentIndex(indexPath);
    const existingIndex = index.findIndex(item => item?.filename === relativeFilename);
    const nextEntry = { filename: relativeFilename, type: 'character' };

    if (existingIndex === -1) {
        index.push(nextEntry);
    } else {
        index[existingIndex] = nextEntry;
    }

    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    writeFileAtomicSync(indexPath, JSON.stringify(index, null, 4), 'utf8');
}

function collectPngFiles(rootDir) {
    const files = [];
    const queue = [rootDir];

    while (queue.length > 0) {
        const currentDir = queue.shift();
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }

            if (entry.isFile() && /\.png$/i.test(entry.name)) {
                files.push(fullPath);
            }
        }
    }

    return files.sort(compareStrings);
}

function indexCharacterFilesByName(filePaths) {
    const index = new Map();
    const duplicates = new Map();

    for (const filePath of filePaths) {
        const fileName = path.basename(filePath);
        if (!index.has(fileName)) {
            index.set(fileName, filePath);
            continue;
        }

        const duplicateList = duplicates.get(fileName) ?? [index.get(fileName)];
        duplicateList.push(filePath);
        duplicates.set(fileName, duplicateList);
    }

    return { index, duplicates };
}

function inferOwnerHandle(characterEntry, defaultOwner) {
    const secureLorebooks = Array.isArray(characterEntry?.add) ? characterEntry.add : [];

    for (const lorebookName of secureLorebooks) {
        const match = String(lorebookName || '').match(/^Z-([^-]+)-.+$/);
        if (match?.[1]) {
            return match[1];
        }
    }

    return String(defaultOwner || '').trim() || 'default-user';
}

function buildCharacterAssignments(templateSource, { defaultOwner = 'default-user' } = {}) {
    const assignments = new Map();

    for (const [characterName, characterEntry] of Object.entries(templateSource.characters || {})) {
        assignments.set(characterName, {
            characterName,
            fileName: `${characterName}.png`,
            ownerHandle: inferOwnerHandle(characterEntry, defaultOwner),
            ownerHandles: [inferOwnerHandle(characterEntry, defaultOwner)],
            sharingMode: 'single',
            sharedCharacterKey: characterName,
            secureLorebooks: Array.isArray(characterEntry.add) ? [...characterEntry.add] : [],
            hiddenTemplates: Array.isArray(characterEntry.templates) ? [...characterEntry.templates] : [],
        });
    }

    return assignments;
}

export function buildCharacterMetadataMigrationPlan(templateSource, discoveredFiles, { defaultOwner = 'default-user' } = {}) {
    const { index, duplicates } = indexCharacterFilesByName(discoveredFiles);
    const assignments = buildCharacterAssignments(templateSource, { defaultOwner });
    const matched = [];
    const missing = [];
    const duplicateMatches = [];

    for (const assignment of assignments.values()) {
        const duplicatePaths = duplicates.get(assignment.fileName);
        if (duplicatePaths) {
            duplicateMatches.push({
                characterName: assignment.characterName,
                fileName: assignment.fileName,
                paths: duplicatePaths,
            });
            continue;
        }

        const filePath = index.get(assignment.fileName);
        if (!filePath) {
            missing.push({
                characterName: assignment.characterName,
                fileName: assignment.fileName,
            });
            continue;
        }

        matched.push({
            ...assignment,
            filePath,
        });
    }

    matched.sort((a, b) => compareStrings(a.characterName, b.characterName));
    missing.sort((a, b) => compareStrings(a.characterName, b.characterName));
    duplicateMatches.sort((a, b) => compareStrings(a.characterName, b.characterName));

    return {
        matched,
        missing,
        duplicateMatches,
    };
}

async function readCharacterCardFile(filePath) {
    const rawBuffer = await fs.promises.readFile(filePath);
    const rawCard = await parse(filePath, 'png');
    return {
        rawBuffer,
        card: JSON.parse(rawCard),
    };
}

async function writeCharacterCardFile(rawBuffer, card, outputPath) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const outputBuffer = write(rawBuffer, JSON.stringify(card));
    await writeFileAtomic(outputPath, outputBuffer);
}

export function applySingleOwnerPushedMetadata(card, assignment) {
    const ownerHandle = String(assignment.ownerHandle || '').trim();
    const ownerHandles = Array.isArray(assignment.ownerHandles)
        ? [...new Set(assignment.ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean))]
        : ownerHandle ? [ownerHandle] : [];
    const secureLorebooks = Array.isArray(assignment.secureLorebooks)
        ? [...new Set(assignment.secureLorebooks.map(name => String(name || '').trim()).filter(Boolean))]
        : [];
    const sharedCharacterKey = String(assignment.sharedCharacterKey || assignment.characterName || '').trim();

    card.data ??= {};
    card.data.extensions ??= {};
    card.data.extensions.aikobots ??= {};

    card.data.extensions.aikobots.owner_handle = ownerHandle;
    card.data.extensions.aikobots.owner_handles = ownerHandles.length > 0 ? ownerHandles : (ownerHandle ? [ownerHandle] : []);
    card.data.extensions.aikobots.sharing_mode = 'single';

    if (sharedCharacterKey) {
        card.data.extensions.aikobots.shared_character_key = sharedCharacterKey;
    } else {
        delete card.data.extensions.aikobots.shared_character_key;
    }

    if (secureLorebooks.length > 0) {
        card.data.extensions.aikobots.secure_lorebooks = secureLorebooks;
    } else {
        delete card.data.extensions.aikobots.secure_lorebooks;
    }

    return card;
}

function buildHiddenTemplateRegistryPatch(templateSource, matchedAssignments) {
    const usedTemplateNames = new Set();
    const characters = {};

    for (const assignment of matchedAssignments) {
        const characterEntry = templateSource.characters?.[assignment.characterName];
        if (!characterEntry) {
            continue;
        }

        characters[assignment.characterName] = structuredClone(characterEntry);
        for (const templateName of characterEntry.templates || []) {
            usedTemplateNames.add(templateName);
        }
    }

    const templates = {};
    for (const templateName of [...usedTemplateNames].sort(compareStrings)) {
        if (templateSource.templates?.[templateName]) {
            templates[templateName] = structuredClone(templateSource.templates[templateName]);
        }
    }

    return normalizeHiddenLorebookTemplates({ templates, characters });
}

function mergeHiddenTemplateRegistry(existingRegistry, patchRegistry) {
    const merged = {
        templates: {
            ...(existingRegistry?.templates || {}),
        },
        characters: {
            ...(existingRegistry?.characters || {}),
        },
    };

    for (const [templateName, templateEntry] of Object.entries(patchRegistry.templates || {})) {
        merged.templates[templateName] = templateEntry;
    }

    for (const [characterName, characterEntry] of Object.entries(patchRegistry.characters || {})) {
        merged.characters[characterName] = characterEntry;
    }

    return normalizeHiddenLorebookTemplates(merged);
}

export async function runStConfigCharacterMetadataMigration({
    inputPath,
    charactersDir,
    dataRoot,
    scaffoldRoot = configuredDefaultScaffoldRoot,
    defaultOwner = 'default-user',
    dryRun = false,
} = {}) {
    const resolvedInputPath = assertFileExists(inputPath, 'Input file');
    const resolvedCharactersDir = assertDirectoryExists(charactersDir, 'Characters directory');
    const resolvedDataRoot = dataRoot ? assertDirectoryExists(dataRoot, 'Data root') : '';
    const resolvedScaffoldRoot = scaffoldRoot ? path.resolve(String(scaffoldRoot)) : '';
    const stConfigText = await fs.promises.readFile(resolvedInputPath, 'utf8');
    const templateSource = buildHiddenLorebookTemplateSource(stConfigText);
    const discoveredFiles = collectPngFiles(resolvedCharactersDir);
    const plan = buildCharacterMetadataMigrationPlan(templateSource, discoveredFiles, { defaultOwner });
    const updated = [];
    const scaffoldUpdated = [];

    if (plan.duplicateMatches.length > 0) {
        throw new Error(`Found duplicate PNG filenames for ${plan.duplicateMatches.length} character(s). Resolve duplicates before running this migration.`);
    }

    for (const assignment of plan.matched) {
        if (!dryRun) {
            const { rawBuffer, card } = await readCharacterCardFile(assignment.filePath);
            applySingleOwnerPushedMetadata(card, assignment);
            await writeCharacterCardFile(rawBuffer, card, assignment.filePath);

            if (resolvedScaffoldRoot) {
                const scaffoldCharactersDir = path.join(resolvedScaffoldRoot, 'characters');
                const scaffoldPath = path.join(scaffoldCharactersDir, assignment.fileName);
                await writeCharacterCardFile(rawBuffer, card, scaffoldPath);
                upsertScaffoldCharacterIndex(resolvedScaffoldRoot, assignment.fileName);
            }
        }

        updated.push({
            characterName: assignment.characterName,
            filePath: assignment.filePath,
            ownerHandle: assignment.ownerHandle,
            secureLorebooks: assignment.secureLorebooks,
            hiddenTemplates: assignment.hiddenTemplates,
        });

        if (resolvedScaffoldRoot) {
            scaffoldUpdated.push({
                characterName: assignment.characterName,
                filePath: path.join(resolvedScaffoldRoot, 'characters', assignment.fileName),
            });
        }
    }

    let hiddenTemplatePatch = null;
    let hiddenTemplateSource = null;
    let hiddenTemplateCompiled = null;

    if (resolvedDataRoot) {
        hiddenTemplatePatch = buildHiddenTemplateRegistryPatch(templateSource, plan.matched);
        const existingRegistry = readHiddenLorebookTemplates({ rootDir: resolvedDataRoot });
        hiddenTemplateSource = mergeHiddenTemplateRegistry(existingRegistry, hiddenTemplatePatch);

        if (!dryRun) {
            writeHiddenLorebookTemplates(hiddenTemplateSource, { rootDir: resolvedDataRoot });
            hiddenTemplateCompiled = compileAndWriteHiddenLorebookTemplates({ rootDir: resolvedDataRoot }).compiled;
        }
    }

    return {
        options: {
            inputPath: resolvedInputPath,
            charactersDir: resolvedCharactersDir,
            dataRoot: resolvedDataRoot || null,
            scaffoldRoot: resolvedScaffoldRoot || null,
            defaultOwner,
            dryRun: Boolean(dryRun),
        },
        counts: {
            scannedPngFiles: discoveredFiles.length,
            matchedCharacters: plan.matched.length,
            missingCharacters: plan.missing.length,
            updatedCharacters: updated.length,
            scaffoldCharacters: scaffoldUpdated.length,
        },
        updated,
        scaffoldUpdated,
        missing: plan.missing,
        hiddenTemplatePatch,
        hiddenTemplateSource,
        hiddenTemplateCompiled,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printUsage();
        return;
    }

    if (!options.input || !options.charactersDir) {
        printUsage();
        throw new Error('Missing required --input or --characters-dir argument.');
    }

    const result = await runStConfigCharacterMetadataMigration({
        inputPath: options.input,
        charactersDir: options.charactersDir,
        dataRoot: options.dataRoot,
        scaffoldRoot: options.scaffoldRoot,
        defaultOwner: options.defaultOwner,
        dryRun: options.dryRun,
    });

    console.log(`Scanned PNG files: ${result.counts.scannedPngFiles}`);
    console.log(`Matched characters: ${result.counts.matchedCharacters}`);
    console.log(`Updated characters: ${result.counts.updatedCharacters}`);
    console.log(`Scaffold characters: ${result.counts.scaffoldCharacters}`);
    console.log(`Missing characters: ${result.counts.missingCharacters}`);

    if (result.options.dataRoot) {
        const templateCount = Object.keys(result.hiddenTemplatePatch?.templates || {}).length;
        const characterCount = Object.keys(result.hiddenTemplatePatch?.characters || {}).length;
        console.log(`Hidden template source patch: ${templateCount} templates, ${characterCount} characters`);
        if (!options.dryRun) {
            console.log('Hidden template source registry and compiled bindings were updated.');
        }
    } else {
        console.log('Hidden template registry was not updated because --data-root was not provided.');
    }

    if (result.missing.length > 0) {
        console.log('Missing character files:');
        for (const item of result.missing) {
            console.log(`  ${item.fileName}`);
        }
    }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
