/*
 * Versioned v1 -> v2 data conversion runner.
 *
 * Usage:
 *   node ".\scripts\v1 to v2 conversion.mjs" --data-root .\data
 *   node ".\scripts\v1 to v2 conversion.mjs" --data-root .\data --only convert-z-worlds
 *   node ".\scripts\v1 to v2 conversion.mjs" --data-root .\data --source .\data\Z-worlds --dry-run
 *
 * What this script does:
 * - Runs ordered v1 -> v2 cleanup and migration steps.
 * - Starts with the legacy /data/Z-worlds import and secure-lorebook promotion.
 * - Produces a single summary that can grow as more cleanup steps are added.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { DEFAULT_USER } from '../src/constants.js';
import { setConfigFilePath } from '../src/util.js';
import { runZWorldsToSecureConversion } from './convert-z-worlds-to-secure.mjs';

const CONVERSION_ID = 'v1_to_v2';
const CONVERT_Z_WORLDS_STEP_ID = 'convert-z-worlds';

export const V1_TO_V2_CONVERSION_STEPS = Object.freeze([
    {
        id: CONVERT_Z_WORLDS_STEP_ID,
        title: 'Convert legacy Z-worlds lorebooks into secure owner-backed lorebooks',
    },
]);

function ensureConfigPath() {
    setConfigFilePath(path.resolve(process.cwd(), 'config.yaml'));
}

function normalizeOnlySteps(only) {
    if (Array.isArray(only)) {
        return [...new Set(only.map(step => String(step || '').trim()).filter(Boolean))];
    }

    const normalized = String(only || '').trim();
    return normalized ? [normalized] : [];
}

function parseArgs(argv) {
    const options = {
        dataRoot: undefined,
        source: undefined,
        adminOwner: DEFAULT_USER.handle,
        dryRun: false,
        report: undefined,
        only: [],
        listSteps: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--data-root':
                options.dataRoot = argv[++index] ?? undefined;
                break;
            case '--source':
            case '--z-worlds-source':
                options.source = argv[++index] ?? undefined;
                break;
            case '--admin-owner':
                options.adminOwner = argv[++index] ?? DEFAULT_USER.handle;
                break;
            case '--report':
                options.report = argv[++index] ?? undefined;
                break;
            case '--only': {
                const stepId = String(argv[++index] ?? '').trim();
                if (!stepId) {
                    throw new Error('Missing value for --only.');
                }
                options.only.push(stepId);
                break;
            }
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--list-steps':
                options.listSteps = true;
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
    console.log('  node ".\\scripts\\v1 to v2 conversion.mjs" --data-root .\\data');
    console.log('  node ".\\scripts\\v1 to v2 conversion.mjs" --data-root .\\data --only convert-z-worlds');
    console.log('  node ".\\scripts\\v1 to v2 conversion.mjs" --data-root .\\data --source .\\data\\Z-worlds --dry-run');
    console.log('  node ".\\scripts\\v1 to v2 conversion.mjs" --data-root .\\data --report .\\reports\\v1-to-v2.json');
}

function printStepList() {
    console.log('Available v1 -> v2 conversion steps:');
    for (const step of V1_TO_V2_CONVERSION_STEPS) {
        console.log(`  ${step.id} - ${step.title}`);
    }
}

function getSelectedSteps(onlySteps) {
    const knownStepIds = new Set(V1_TO_V2_CONVERSION_STEPS.map(step => step.id));

    for (const stepId of onlySteps) {
        if (!knownStepIds.has(stepId)) {
            throw new Error(`Unknown conversion step: ${stepId}`);
        }
    }

    if (onlySteps.length > 0) {
        return V1_TO_V2_CONVERSION_STEPS.filter(step => onlySteps.includes(step.id));
    }

    return [...V1_TO_V2_CONVERSION_STEPS];
}

function normalizeOptions(options = {}) {
    const dataRoot = path.resolve(options.dataRoot || path.resolve(process.cwd(), 'data'));

    return {
        dataRoot,
        source: path.resolve(options.source || path.resolve(dataRoot, 'Z-worlds')),
        adminOwner: String(options.adminOwner || DEFAULT_USER.handle).trim() || DEFAULT_USER.handle,
        dryRun: Boolean(options.dryRun),
        report: options.report ? path.resolve(options.report) : null,
        only: normalizeOnlySteps(options.only),
    };
}

function createSummary(options, selectedSteps) {
    return {
        conversion: CONVERSION_ID,
        options: {
            dataRoot: options.dataRoot,
            source: options.source,
            adminOwner: options.adminOwner,
            dryRun: Boolean(options.dryRun),
            report: options.report,
            only: selectedSteps,
        },
        counts: {
            stepsSelected: selectedSteps.length,
            stepsCompleted: 0,
            stepsFailed: 0,
        },
        steps: [],
    };
}

function getZWorldsStepError(result) {
    const failedLorebooks = Number(result?.counts?.failed || 0);
    const cleanupErrors = Array.isArray(result?.cleanup?.errors) ? result.cleanup.errors.length : 0;

    if (failedLorebooks < 1 && cleanupErrors < 1) {
        return '';
    }

    return `${failedLorebooks} lorebook failure(s), ${cleanupErrors} cleanup error(s)`;
}

export async function runV1ToV2Conversion(options = {}) {
    ensureConfigPath();

    const normalizedOptions = normalizeOptions(options);
    const selectedSteps = getSelectedSteps(normalizedOptions.only);
    const summary = createSummary(normalizedOptions, selectedSteps.map(step => step.id));

    for (const step of selectedSteps) {
        if (step.id !== CONVERT_Z_WORLDS_STEP_ID) {
            continue;
        }

        try {
            const result = await runZWorldsToSecureConversion({
                dataRoot: normalizedOptions.dataRoot,
                source: normalizedOptions.source,
                adminOwner: normalizedOptions.adminOwner,
                dryRun: normalizedOptions.dryRun,
                report: null,
            });
            const stepError = getZWorldsStepError(result);

            summary.steps.push({
                id: step.id,
                title: step.title,
                status: stepError ? 'failed' : 'completed',
                result,
                ...(stepError ? { error: stepError } : {}),
            });
            if (stepError) {
                summary.counts.stepsFailed++;
            } else {
                summary.counts.stepsCompleted++;
            }
        } catch (error) {
            summary.steps.push({
                id: step.id,
                title: step.title,
                status: 'failed',
                error: String(error?.message || error),
            });
            summary.counts.stepsFailed++;
        }
    }

    if (normalizedOptions.report) {
        fs.mkdirSync(path.dirname(normalizedOptions.report), { recursive: true });
        writeFileAtomicSync(normalizedOptions.report, JSON.stringify(summary, null, 4), 'utf8');
    }

    return summary;
}

function printSummary(summary) {
    console.log('v1 -> v2 conversion complete.');
    console.log(JSON.stringify(summary.counts, null, 4));

    for (const step of summary.steps) {
        console.log(`[${step.status}] ${step.id}`);

        if (step.status === 'completed' && step.result?.counts) {
            console.log(JSON.stringify(step.result.counts, null, 4));
        }

        if (step.status === 'failed') {
            if (step.result?.counts) {
                console.log(JSON.stringify(step.result.counts, null, 4));
            }
            console.error(step.error);
        }
    }
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);

    if (args.help) {
        printUsage();
        return;
    }

    if (args.listSteps) {
        printStepList();
        return;
    }

    const summary = await runV1ToV2Conversion(args);
    printSummary(summary);

    if (summary.counts.stepsFailed > 0) {
        process.exitCode = 1;
    }
}

const executedDirectly = process.argv[1]
    && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (executedDirectly) {
    main().catch(error => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    });
}
