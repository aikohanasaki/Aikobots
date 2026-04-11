/*
 * One-time migration tool for importing lorebooks from /data/Z-worlds into
 * owner-backed secure lorebooks.
 *
 * Usage:
 *   node .\scripts\convert-z-worlds-to-secure.mjs --data-root .\data --source .\data\Z-worlds
 *   node .\scripts\convert-z-worlds-to-secure.mjs --data-root .\data --source .\data\Z-worlds --dry-run
 *
 * What this script does:
 * - Reads .json lorebooks from the source directory.
 * - Resolves ownership from the filename:
 *   - 9Z*         => default-user
 *   - Z-<handle>-* => <handle>
 * - Writes each successful source lorebook into the owner's normal worlds
 *   directory as a regular file, then promotes it through the existing secure
 *   single-lorebook flow.
 * - Performs a cleanup pass that removes user-directory symlinks for successful
 *   conversions, while leaving regular files in place.
 *
 * Important notes:
 * - 9Z* lorebooks are assigned to default-user.
 * - Invalid or disabled Z-<handle>-* owners are skipped and reported.
 * - If the owner target already exists and is not a symlink, the lorebook is
 *   skipped.
 * - The secure symlink under _secure/worlds is kept intact.
 * - Source files under /data/Z-worlds are never deleted by this script.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { DEFAULT_USER } from '../src/constants.js';
import { getConfigValue, setConfigFilePath } from '../src/util.js';

function parseArgs(argv) {
    const options = {
        dataRoot: undefined,
        source: undefined,
        adminOwner: DEFAULT_USER.handle,
        dryRun: false,
        report: undefined,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--data-root':
                options.dataRoot = argv[++index] ?? undefined;
                break;
            case '--source':
                options.source = argv[++index] ?? undefined;
                break;
            case '--admin-owner':
                options.adminOwner = argv[++index] ?? DEFAULT_USER.handle;
                break;
            case '--report':
                options.report = argv[++index] ?? undefined;
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
    console.log('  node .\\scripts\\convert-z-worlds-to-secure.mjs --data-root .\\data --source .\\data\\Z-worlds');
    console.log('  node .\\scripts\\convert-z-worlds-to-secure.mjs --data-root .\\data --source .\\data\\Z-worlds --dry-run');
}

function canonicalizeLorebookName(name) {
    return String(sanitize(String(name || '').trim())).replace(/\.json$/i, '');
}

function inspectPathKind(filePath) {
    try {
        const stats = fs.lstatSync(filePath);
        if (stats.isSymbolicLink()) {
            return 'symlink';
        }
        if (stats.isFile()) {
            return 'file';
        }
        return 'other';
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return 'missing';
        }
        throw error;
    }
}

function ensureParentDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readValidatedSourceFile(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    JSON.parse(text);
    return text;
}

function resolveOwnerHandle(canonicalName, adminOwner) {
    if (!canonicalName) {
        return { ownerHandle: '', reason: 'invalid_name' };
    }

    if (canonicalName.startsWith('9Z')) {
        return { ownerHandle: adminOwner, reason: null };
    }

    const match = canonicalName.match(/^Z-([^-]+)-.+$/);
    if (!match) {
        return { ownerHandle: '', reason: 'invalid_name' };
    }

    return { ownerHandle: match[1], reason: null };
}

function createSummary(options) {
    return {
        options: {
            dataRoot: options.dataRoot,
            source: options.source,
            adminOwner: options.adminOwner,
            dryRun: Boolean(options.dryRun),
        },
        counts: {
            converted: 0,
            dryRunReady: 0,
            skippedInvalidName: 0,
            skippedInvalidOwner: 0,
            skippedSecureExists: 0,
            skippedTargetNotSymlink: 0,
            failed: 0,
        },
        results: [],
        cleanup: {
            removedSymlinks: [],
            repairedOwnerFiles: [],
            regularCopiesLeftInPlace: [],
            errors: [],
        },
    };
}

function pushResult(summary, result) {
    summary.results.push(result);
    switch (result.status) {
        case 'converted':
            summary.counts.converted++;
            break;
        case 'dry_run_ready':
            summary.counts.dryRunReady++;
            break;
        case 'skipped_invalid_name':
            summary.counts.skippedInvalidName++;
            break;
        case 'skipped_invalid_owner':
            summary.counts.skippedInvalidOwner++;
            break;
        case 'skipped_secure_exists':
            summary.counts.skippedSecureExists++;
            break;
        case 'skipped_target_not_symlink':
            summary.counts.skippedTargetNotSymlink++;
            break;
        case 'failed':
            summary.counts.failed++;
            break;
    }
}

async function loadRuntime(dataRoot) {
    globalThis.DATA_ROOT = dataRoot;
    const usersModule = await import('../src/users.js');
    const lorebookModule = await import('../src/lorebook-repository.js');
    const storageModule = await import('node-persist');
    await usersModule.initUserStorage(dataRoot);

    return {
        ...usersModule,
        ...lorebookModule,
        storage: storageModule.default,
    };
}

function makeUserContext(user, directories) {
    return {
        profile: user,
        directories,
    };
}

function secureLorebookExists(runtime, userContext, canonicalName) {
    try {
        runtime.resolveLorebookWithMetadata(userContext, canonicalName, { storage: 'secure' });
        return true;
    } catch (error) {
        if (error instanceof runtime.LorebookRepositoryError && error.type === 'LorebookNotFound') {
            return false;
        }
        throw error;
    }
}

function writeRegularFile(filePath, text) {
    ensureParentDirectory(filePath);
    writeFileAtomicSync(filePath, text, 'utf8');
}

function replaceSymlinkWithRegularFile(filePath, text) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    ensureParentDirectory(filePath);
    writeFileAtomicSync(tempPath, text, 'utf8');

    try {
        fs.unlinkSync(filePath);
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        if (fs.existsSync(tempPath) && !fs.existsSync(filePath)) {
            try {
                fs.renameSync(tempPath, filePath);
                return;
            } catch {
                // Fall through to surface the original error.
            }
        }

        if (fs.existsSync(tempPath)) {
            fs.rmSync(tempPath, { force: true });
        }

        throw error;
    }
}

function listSourceFiles(sourceDirectory) {
    return fs.readdirSync(sourceDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

async function cleanupUserWorldSymlinks(runtime, cleanupItems, summary) {
    if (!cleanupItems.length) {
        return;
    }

    const allUserHandles = (await runtime.getAllUserHandles())
        .map(handle => String(handle || '').trim())
        .filter(Boolean);

    for (const item of cleanupItems) {
        for (const handle of allUserHandles) {
            const userPath = path.join(runtime.getUserDirectories(handle).worlds, `${item.canonicalName}.json`);
            const kind = inspectPathKind(userPath);

            try {
                if (kind === 'symlink') {
                    if (handle === item.ownerHandle) {
                        replaceSymlinkWithRegularFile(userPath, item.sourceText);
                        summary.cleanup.repairedOwnerFiles.push({
                            canonicalName: item.canonicalName,
                            handle,
                            path: userPath,
                        });
                    } else {
                        fs.unlinkSync(userPath);
                        summary.cleanup.removedSymlinks.push({
                            canonicalName: item.canonicalName,
                            handle,
                            path: userPath,
                        });
                    }
                    continue;
                }

                if (kind === 'file' && handle !== item.ownerHandle) {
                    summary.cleanup.regularCopiesLeftInPlace.push({
                        canonicalName: item.canonicalName,
                        handle,
                        path: userPath,
                    });
                }
            } catch (error) {
                summary.cleanup.errors.push({
                    canonicalName: item.canonicalName,
                    handle,
                    path: userPath,
                    message: String(error?.message || error),
                });
            }
        }
    }
}

export async function runZWorldsToSecureConversion({
    dataRoot = path.resolve(process.cwd(), 'data'),
    source = path.resolve(dataRoot, 'Z-worlds'),
    adminOwner = DEFAULT_USER.handle,
    dryRun = false,
    report = null,
} = {}) {
    const options = {
        dataRoot: path.resolve(dataRoot),
        source: path.resolve(source),
        adminOwner: String(adminOwner || DEFAULT_USER.handle).trim() || DEFAULT_USER.handle,
        dryRun: Boolean(dryRun),
        report: report ? path.resolve(report) : null,
    };

    const summary = createSummary(options);

    if (!fs.existsSync(options.source)) {
        throw new Error(`Source directory not found: ${options.source}`);
    }

    const runtime = await loadRuntime(options.dataRoot);
    const accountsEnabled = Boolean(getConfigValue('enableUserAccounts', false, 'boolean'));
    const enabledUsers = accountsEnabled ? await runtime.getAllEnabledUsers() : [];
    const enabledHandles = new Set(enabledUsers.map(user => String(user.handle || '').trim()).filter(Boolean));
    const cleanupItems = [];

    for (const fileName of listSourceFiles(options.source)) {
        const sourcePath = path.join(options.source, fileName);
        const rawBaseName = path.parse(fileName).name;
        const canonicalName = canonicalizeLorebookName(rawBaseName);
        const baseResult = {
            sourceFile: fileName,
            sourcePath,
            canonicalName,
            ownerHandle: '',
            status: '',
            message: '',
        };

        try {
            const { ownerHandle, reason } = resolveOwnerHandle(canonicalName, options.adminOwner);
            if (reason || !ownerHandle) {
                pushResult(summary, {
                    ...baseResult,
                    status: 'skipped_invalid_name',
                    message: 'Name does not match 9Z* or Z-<handle>-* secure naming rules.',
                });
                continue;
            }

            baseResult.ownerHandle = ownerHandle;

            if (accountsEnabled) {
                if (!enabledHandles.has(ownerHandle)) {
                    pushResult(summary, {
                        ...baseResult,
                        status: 'skipped_invalid_owner',
                        message: `Owner "${ownerHandle}" does not exist or is disabled.`,
                    });
                    continue;
                }
            } else if (ownerHandle !== DEFAULT_USER.handle) {
                pushResult(summary, {
                    ...baseResult,
                    status: 'skipped_invalid_owner',
                    message: `Accounts are disabled, so only "${DEFAULT_USER.handle}" is a valid owner.`,
                });
                continue;
            }

            const ownerUser = await runtime.storage.getItem(runtime.toKey(ownerHandle));
            if (!ownerUser) {
                pushResult(summary, {
                    ...baseResult,
                    status: 'skipped_invalid_owner',
                    message: `Owner "${ownerHandle}" was not found in storage.`,
                });
                continue;
            }

            const userDirectories = runtime.getUserDirectories(ownerHandle);
            const userContext = makeUserContext(ownerUser, userDirectories);
            if (secureLorebookExists(runtime, userContext, canonicalName)) {
                pushResult(summary, {
                    ...baseResult,
                    status: 'skipped_secure_exists',
                    message: `Secure lorebook "${canonicalName}" already exists.`,
                });
                continue;
            }

            const sourceText = readValidatedSourceFile(sourcePath);
            const ownerTargetPath = path.join(userDirectories.worlds, `${canonicalName}.json`);
            const ownerTargetKind = inspectPathKind(ownerTargetPath);

            if (ownerTargetKind !== 'missing' && ownerTargetKind !== 'symlink') {
                pushResult(summary, {
                    ...baseResult,
                    status: 'skipped_target_not_symlink',
                    message: `Owner target "${ownerTargetPath}" already exists and is not a symlink.`,
                });
                continue;
            }

            if (!options.dryRun) {
                if (ownerTargetKind === 'symlink') {
                    replaceSymlinkWithRegularFile(ownerTargetPath, sourceText);
                } else {
                    writeRegularFile(ownerTargetPath, sourceText);
                }
                runtime.promoteLorebook(userContext, canonicalName);
                cleanupItems.push({ canonicalName, ownerHandle, sourceText });
            }

            pushResult(summary, {
                ...baseResult,
                status: options.dryRun ? 'dry_run_ready' : 'converted',
                message: options.dryRun
                    ? `Lorebook "${canonicalName}" is ready to convert.`
                    : `Lorebook "${canonicalName}" was converted successfully.`,
            });
        } catch (error) {
            pushResult(summary, {
                ...baseResult,
                status: 'failed',
                message: String(error?.message || error),
            });
        }
    }

    if (!options.dryRun) {
        await cleanupUserWorldSymlinks(runtime, cleanupItems, summary);
    }

    if (options.report) {
        ensureParentDirectory(options.report);
        writeFileAtomicSync(options.report, JSON.stringify(summary, null, 4), 'utf8');
    }

    return summary;
}

function printSummary(summary) {
    console.log('Conversion complete.');
    console.log(JSON.stringify(summary.counts, null, 4));

    if (summary.cleanup.removedSymlinks.length > 0) {
        console.log(`Removed ${summary.cleanup.removedSymlinks.length} user-directory symlinks during cleanup.`);
    }

    if (summary.cleanup.regularCopiesLeftInPlace.length > 0) {
        console.warn(`Left ${summary.cleanup.regularCopiesLeftInPlace.length} non-symlink user copies in place.`);
    }

    if (summary.cleanup.errors.length > 0) {
        console.warn(`Encountered ${summary.cleanup.errors.length} cleanup errors.`);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }

    setConfigFilePath(path.resolve(process.cwd(), 'config.yaml'));
    const summary = await runZWorldsToSecureConversion(args);
    printSummary(summary);
    if (summary.counts.failed > 0 || summary.cleanup.errors.length > 0) {
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
