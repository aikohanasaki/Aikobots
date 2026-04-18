#!/usr/bin/env node
/*
 * Cleans stale recipient lists from globally approved character submission records.
 *
 * Usage:
 *   node .\scripts\cleanup-global-submission-distribution-lists.mjs
 *   node .\scripts\cleanup-global-submission-distribution-lists.mjs --write
 *   node .\scripts\cleanup-global-submission-distribution-lists.mjs --data-root C:\path\to\data --write
 *
 * Dry-run is the default. Pass --write to update JSON files.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

const SUBMISSIONS_DIRECTORY = ['_system', 'character-submissions'];
const DISTRIBUTION_REGISTRY_PATH = ['_system', 'character-distribution-registry', 'index.json'];

function parseArgs(argv) {
    const options = {
        dataRoot: path.resolve('data'),
        write: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--data-root':
                if (index + 1 >= argv.length || argv[index + 1]?.startsWith('--')) {
                    throw new Error('--data-root requires a path argument');
                }
                options.dataRoot = path.resolve(String(argv[++index] || ''));
                break;
            case '--write':
                options.write = true;
                break;
            case '--dry-run':
                options.write = false;
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

function printHelp() {
    console.log(`Usage:
  node .\\scripts\\cleanup-global-submission-distribution-lists.mjs [--data-root <path>] [--write]

Options:
  --data-root <path>  Data root containing _system/character-submissions. Default: ./data
  --write             Write changes. Without this, the script only reports changes.
  --dry-run           Report changes without writing. This is the default.
  --help, -h          Show this help.`);
}

function normalizeHandles(handles) {
    return [...new Set((Array.isArray(handles) ? handles : [])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
}

function normalizeFilenameStem(value) {
    return path.parse(String(value || '')).name || String(value || '').trim();
}

function readJsonFile(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getSubmissionRecordPaths(submissionsRoot) {
    if (!fs.existsSync(submissionsRoot)) {
        return [];
    }

    const queue = [submissionsRoot];
    const recordPaths = [];

    while (queue.length > 0) {
        const current = queue.shift();
        const entries = fs.readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                recordPaths.push(fullPath);
            }
        }
    }

    return recordPaths;
}

function getRegistryEntry(registry, record) {
    const publishedFilename = normalizeFilenameStem(record.publishedFilename || record.submittedFilename);
    if (!publishedFilename) {
        return null;
    }

    const ownerHandle = String(record.ownerHandle || '').trim();
    const sharedCharacterKey = normalizeFilenameStem(record.sharedCharacterKey || '');
    const key = sharedCharacterKey ? `${sharedCharacterKey}::${publishedFilename}` : `${ownerHandle}::${publishedFilename}`;
    const legacyKey = sharedCharacterKey && ownerHandle ? `${ownerHandle}::${publishedFilename}` : '';
    const characters = registry?.characters && typeof registry.characters === 'object' && !Array.isArray(registry.characters)
        ? registry.characters
        : {};

    return characters[key] || (legacyKey ? characters[legacyKey] : null);
}

function sanitizeGlobalApprovalRecord(record, registry) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return { changed: false, nextRecord: record, reasons: [] };
    }

    if (record.status !== 'approved' || record.publishMode !== 'global') {
        return { changed: false, nextRecord: record, reasons: [] };
    }

    const nextRecord = structuredClone(record);
    const reasons = [];
    const registryEntry = getRegistryEntry(registry, record);
    const registryBlacklistHandles = normalizeHandles(registryEntry?.blacklist);
    const existingBlacklistHandles = normalizeHandles(nextRecord.requestedBlacklistHandles);
    const nextBlacklistHandles = existingBlacklistHandles.length > 0
        ? existingBlacklistHandles
        : registryBlacklistHandles;
    const nextRequestedDistributionMode = nextBlacklistHandles.length > 0 ? 'global_blacklist' : 'global';

    if (normalizeHandles(nextRecord.targetHandles).length > 0) {
        nextRecord.targetHandles = [];
        reasons.push('cleared global targetHandles');
    } else if (!Array.isArray(nextRecord.targetHandles)) {
        nextRecord.targetHandles = [];
        reasons.push('normalized global targetHandles');
    }

    if (normalizeHandles(nextRecord.requestedTargetHandles).length > 0) {
        nextRecord.requestedTargetHandles = [];
        reasons.push('cleared global requestedTargetHandles');
    } else if (!Array.isArray(nextRecord.requestedTargetHandles)) {
        nextRecord.requestedTargetHandles = [];
        reasons.push('normalized global requestedTargetHandles');
    }

    if (nextRecord.requestedDistributionMode !== nextRequestedDistributionMode) {
        nextRecord.requestedDistributionMode = nextRequestedDistributionMode;
        reasons.push(`set requestedDistributionMode=${nextRequestedDistributionMode}`);
    }

    if (JSON.stringify(normalizeHandles(nextRecord.requestedBlacklistHandles)) !== JSON.stringify(nextBlacklistHandles)) {
        nextRecord.requestedBlacklistHandles = nextBlacklistHandles;
        reasons.push('normalized global blacklist exceptions');
    }

    return {
        changed: reasons.length > 0,
        nextRecord,
        reasons,
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const submissionsRoot = path.join(options.dataRoot, ...SUBMISSIONS_DIRECTORY);
    const registryPath = path.join(options.dataRoot, ...DISTRIBUTION_REGISTRY_PATH);
    const registry = readJsonFile(registryPath, { version: 1, characters: {} });
    const recordPaths = getSubmissionRecordPaths(submissionsRoot);
    let changedCount = 0;
    let scannedCount = 0;

    for (const recordPath of recordPaths) {
        scannedCount++;
        const record = readJsonFile(recordPath);
        const result = sanitizeGlobalApprovalRecord(record, registry);
        if (!result.changed) {
            continue;
        }

        changedCount++;
        console.log(`${options.write ? 'Updated' : 'Would update'} ${recordPath}`);
        for (const reason of result.reasons) {
            console.log(`  - ${reason}`);
        }

        if (options.write) {
            writeFileAtomicSync(recordPath, `${JSON.stringify(result.nextRecord, null, 4)}\n`);
        }
    }

    console.log(`${options.write ? 'Updated' : 'Would update'} ${changedCount} of ${scannedCount} submission record(s).`);
    if (!options.write) {
        console.log('Dry-run only. Re-run with --write to apply changes.');
    }
}

try {
    main();
} catch (error) {
    console.error(error?.message || error);
    process.exit(1);
}
