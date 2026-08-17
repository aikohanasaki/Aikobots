#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';

const INITIAL_LONG_CHAT_DISPLAY_COUNT = 100;
const CHAT_STORAGE_KEY = 'chat_storage';
const CHAT_STORAGE_MODE_SPLIT_TAIL = 'split-tail';
const CHAT_HEAD_FILE_SUFFIX = '.head.jsonl';

// config.yaml will be set when parsing command line arguments
const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.DEFAULT_CONTENT_ROOT = cliArgs.defaultContentRoot;
globalThis.DEFAULT_SCAFFOLD_ROOT = cliArgs.defaultScaffoldRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
process.chdir(serverDirectory);

/**
 * Reads the first non-empty JSONL record without loading long chats into memory.
 * @param {string} filePath JSONL file path.
 * @returns {Promise<object|null>} Parsed first record, or null for an empty file.
 */
async function readJsonlHeader(filePath) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
        for await (const line of lines) {
            if (line.trim()) {
                return JSON.parse(line);
            }
        }
    } finally {
        lines.close();
        stream.destroy();
    }

    return null;
}

function isLegacySplitTailHeader(header) {
    return header?.[CHAT_STORAGE_KEY]?.mode === CHAT_STORAGE_MODE_SPLIT_TAIL;
}

function isUnsafeLegacyHeadFileName(fileName) {
    const normalized = String(fileName || '').trim();
    return !normalized
        || normalized === '.'
        || normalized === '..'
        || normalized.includes('\0')
        || normalized.includes('/')
        || normalized.includes('\\')
        || path.posix.isAbsolute(normalized)
        || path.win32.isAbsolute(normalized)
        || /^[a-zA-Z]:/.test(normalized)
        || !normalized.toLowerCase().endsWith(CHAT_HEAD_FILE_SUFFIX);
}

function resolveLegacySplitHeadPath(filePath, storage) {
    const defaultHeadFileName = `${path.parse(filePath).name}${CHAT_HEAD_FILE_SUFFIX}`;
    const headFileName = String(storage?.head_file || defaultHeadFileName).trim();

    if (isUnsafeLegacyHeadFileName(headFileName)) {
        throw new Error(`Invalid legacy split chat head file reference: ${headFileName || '(empty)'}`);
    }

    return path.join(path.dirname(path.resolve(filePath)), headFileName);
}

function stripLegacySplitMetadata(header) {
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
        return header;
    }

    const result = { ...header };
    delete result[CHAT_STORAGE_KEY];
    delete result.split_part;
    return result;
}

/**
 * Builds a migration plan for a JSONL chat, including legacy split-tail companions.
 * @param {string} filePath Tail or complete JSONL chat path.
 * @returns {Promise<{type: 'full-jsonl', header: object|null}|{type: 'legacy-split-tail', tailPath: string, header: object, storage: object, headPath: string}>}
 */
async function createJsonlMigrationPlan(filePath) {
    const header = await readJsonlHeader(filePath);
    if (!header) {
        return { type: 'full-jsonl', header };
    }

    if (!isLegacySplitTailHeader(header)) {
        if (header.split_part) {
            throw new Error(`Legacy split chat storage is no longer supported; refusing to migrate partial JSONL: ${filePath}`);
        }
        return { type: 'full-jsonl', header };
    }

    const storage = header[CHAT_STORAGE_KEY];
    const headPath = resolveLegacySplitHeadPath(filePath, storage);
    if (!fs.existsSync(headPath)) {
        throw new Error(`Legacy split chat head file is missing: ${headPath}`);
    }

    const headHeader = await readJsonlHeader(headPath);
    if (!headHeader) {
        throw new Error(`Legacy split chat head file is empty: ${headPath}`);
    }

    if (headHeader[CHAT_STORAGE_KEY]?.mode === CHAT_STORAGE_MODE_SPLIT_TAIL || (headHeader.split_part && headHeader.split_part !== 'head')) {
        throw new Error(`Legacy split chat head file has invalid split metadata: ${headPath}`);
    }

    return {
        type: 'legacy-split-tail',
        tailPath: filePath,
        header,
        storage,
        headPath,
    };
}

/**
 * Streams non-header JSONL records from a chat segment and counts yielded messages.
 * @param {string} filePath JSONL segment path.
 * @param {{count: number}} counter Mutable yielded-message counter.
 */
async function* readJsonlRecordsAfterHeader(filePath, counter) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let foundHeader = false;
    let lineNumber = 0;

    try {
        for await (const line of lines) {
            lineNumber++;
            if (!line.trim()) {
                continue;
            }

            if (!foundHeader) {
                foundHeader = true;
                continue;
            }

            counter.count++;
            yield {
                content: line,
                label: `${filePath}:${lineNumber}`,
            };
        }
    } finally {
        lines.close();
        stream.destroy();
    }
}

/**
 * Counts valid non-header JSONL records without retaining chat message contents.
 * @param {string} filePath JSONL segment path.
 * @returns {Promise<number>}
 */

/**
 * Rejects split chats whose declared head or tail message counts cannot be satisfied.
 * @param {{storage: object, headPath: string, tailPath: string}} plan Split migration plan.
 * @param {{head: number, tail: number}} counts Actual message counts.
 */
function assertLegacySplitCounts(plan, counts) {
    const declaredHeadCount = Number.isInteger(plan.storage?.head_count) ? Math.max(0, plan.storage.head_count) : null;
    const declaredTailCount = Number.isInteger(plan.storage?.tail_count) ? Math.max(0, plan.storage.tail_count) : null;

    if (declaredHeadCount !== null && counts.head < declaredHeadCount) {
        throw new Error(`Legacy split chat head is incomplete: expected at least ${declaredHeadCount} message(s), found ${counts.head}: ${plan.headPath}`);
    }

    if (declaredTailCount !== null && counts.tail < declaredTailCount) {
        throw new Error(`Legacy split chat tail is incomplete: expected at least ${declaredTailCount} message(s), found ${counts.tail}: ${plan.tailPath}`);
    }
}

/**
 * Streams a complete logical chat from a legacy head segment plus tail segment.
 * @param {{tailPath: string, headPath: string, header: object, storage: object}} plan Split migration plan.
 */
async function* readLegacySplitChatRecords(plan) {
    const headCounter = { count: 0 };
    const tailCounter = { count: 0 };

    yield {
        content: JSON.stringify(stripLegacySplitMetadata(plan.header)),
        label: `${plan.tailPath}:header`,
    };

    yield* readJsonlRecordsAfterHeader(plan.headPath, headCounter);
    yield* readJsonlRecordsAfterHeader(plan.tailPath, tailCounter);

    assertLegacySplitCounts(plan, {
        head: headCounter.count,
        tail: tailCounter.count,
    });
}

async function* readCompleteJsonlRecords(filePath) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            if (line.trim()) {
                yield { content: line };
            }
        }
    } finally {
        lines.close();
        stream.destroy();
    }
}

function getMigrationPlanRecords(plan, entryPath) {
    return plan.type === 'legacy-split-tail'
        ? readLegacySplitChatRecords(plan)
        : readCompleteJsonlRecords(entryPath);
}

/**
 * Converts all users' legacy JSONL chats to SQLite files.
 * @returns {Promise<void>}
 */
async function migrateAllUsersChatsToSqlite() {
    const { getAllUserHandles, getUserDirectories } = await import('./src/users.js');
    const { isHeadChatFile } = await import('./src/chat-paths.js');
    const { loadDb, migrateFromJsonl, migrateFromJsonlRecords, verifyJsonlRecordsMatchSqlite } = await import('./src/sqlite-manager.js');
    const handles = await getAllUserHandles();
    let totalMigrated = 0;
    let totalRemovedExisting = 0;
    let totalFailed = 0;
    const allEntries = [];

    for (const handle of handles) {
        const directories = getUserDirectories(handle);
        const scanDirectory = async (directory) => {
            if (!fs.existsSync(directory)) return;
            const entries = await fs.promises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                const entryPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    await scanDirectory(entryPath);
                } else if (entry.isFile() && entry.name.endsWith('.jsonl') && !isHeadChatFile(entry.name)) {
                    const sqlitePath = entryPath.replace(/\.jsonl$/, '.sqlite');
                    const stat = await fs.promises.stat(entryPath);
                    allEntries.push({
                        entryPath,
                        sqlitePath,
                        time: stat.birthtimeMs || stat.mtimeMs,
                    });
                }
            }
        };

        await scanDirectory(directories.chats);
        await scanDirectory(directories.groupChats);
    }

    allEntries.sort((a, b) => a.time - b.time);

    const verifySqliteIntegrity = async (sqlitePath) => {
        const db = await loadDb(sqlitePath);
        try {
            const check = db.exec('PRAGMA integrity_check');
            const result = check?.[0]?.values?.[0]?.[0];
            if (result !== 'ok') {
                throw new Error(`SQLite integrity check failed: ${result || 'no result'}`);
            }
        } finally {
            db.close();
        }
    };

    const verifySqliteMatchesMigrationPlan = async (sqlitePath, migrationPlan, entryPath) => {
        await verifyJsonlRecordsMatchSqlite(getMigrationPlanRecords(migrationPlan, entryPath), sqlitePath);
    };

    for (const { entryPath, sqlitePath } of allEntries) {
        if (!fs.existsSync(sqlitePath)) {
            try {
                const migrationPlan = await createJsonlMigrationPlan(entryPath);
                if (migrationPlan.type === 'legacy-split-tail') {
                    console.info(`[Data Maid] Recombining legacy split chat ${migrationPlan.headPath} + ${entryPath} to SQLite...`);
                    await migrateFromJsonlRecords(readLegacySplitChatRecords(migrationPlan), sqlitePath);
                } else {
                    console.info(`[Data Maid] Migrating ${entryPath} to SQLite...`);
                    await migrateFromJsonl(entryPath, sqlitePath);
                }
                await verifySqliteIntegrity(sqlitePath);
                await verifySqliteMatchesMigrationPlan(sqlitePath, migrationPlan, entryPath);
                // Remove the verified legacy JSONL source after successful migration.
                await fs.promises.unlink(entryPath);
                if (migrationPlan.type === 'legacy-split-tail' && fs.existsSync(migrationPlan.headPath)) {
                    await fs.promises.unlink(migrationPlan.headPath);
                }
                totalMigrated++;
            } catch (error) {
                totalFailed++;
                console.error(`[Data Maid] Failed to migrate ${entryPath} to SQLite:`, error);
            }
        } else {
            // SQLite already exists (e.g. from recombination or previous run)
            // If the original JSONL is still here, remove the legacy storage duplicate.
            if (fs.existsSync(entryPath)) {
                try {
                    const migrationPlan = await createJsonlMigrationPlan(entryPath);
                    await verifySqliteIntegrity(sqlitePath);
                    await verifySqliteMatchesMigrationPlan(sqlitePath, migrationPlan, entryPath);
                    const legacyHeadPath = migrationPlan.type === 'legacy-split-tail' && fs.existsSync(migrationPlan.headPath)
                        ? migrationPlan.headPath
                        : null;
                    console.info(`[Data Maid] ${sqlitePath} already exists and passed integrity/content checks, removing legacy JSONL ${entryPath}...`);
                    await fs.promises.unlink(entryPath);
                    if (legacyHeadPath) {
                        console.info(`[Data Maid] Removing legacy split head JSONL ${legacyHeadPath}...`);
                        await fs.promises.unlink(legacyHeadPath);
                    }
                    totalRemovedExisting++;
                } catch (error) {
                    totalFailed++;
                    console.error(`[Data Maid] Refusing to remove legacy JSONL ${entryPath}; existing SQLite failed cleanup verification:`, error);
                }
            }
        }
    }

    if (totalFailed > 0) {
        throw new Error(`SQLite migration failed for ${totalFailed} chat file(s).`);
    }

    if (totalMigrated > 0 || totalRemovedExisting > 0) {
        console.info(`[Data Maid] SQLite migration: ${totalMigrated} new migrations, ${totalRemovedExisting} previously migrated legacy JSONL files removed.`);
    }
}

/**
 * Reads and validates a user settings JSON document.
 * @param {string} settingsPath Settings file path.
 * @returns {object}
 */
function readUserSettings(settingsPath) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error(`Invalid settings file: ${settingsPath}`);
    }

    return settings;
}

/**
 * Sets the initial long-chat display count for all existing user settings files.
 * @returns {Promise<void>}
 */
async function migrateAllUsersInitialMessagesToShow() {
    const { SETTINGS_FILE } = await import('./src/constants.js');
    const { withSettingsPersonasLock } = await import('./src/settings-lock.js');
    const { getAllUserHandles, getUserDirectories } = await import('./src/users.js');
    const handles = await getAllUserHandles();
    let totalUpdated = 0;
    let totalAlreadySet = 0;
    let totalSkipped = 0;

    for (const handle of handles) {
        const directories = getUserDirectories(handle);
        const settingsPath = path.join(directories.root, SETTINGS_FILE);

        if (!fs.existsSync(settingsPath)) {
            totalSkipped++;
            console.warn(`[Data Maid] Skipping initial messages migration for ${handle}; settings file does not exist: ${settingsPath}`);
            continue;
        }

        await withSettingsPersonasLock(directories, async (lock) => {
            await lock.run(() => {
                const settings = readUserSettings(settingsPath);

                if (!settings.power_user || typeof settings.power_user !== 'object' || Array.isArray(settings.power_user)) {
                    settings.power_user = {};
                }

                if (settings.power_user.long_chat_display_count === INITIAL_LONG_CHAT_DISPLAY_COUNT) {
                    totalAlreadySet++;
                    return;
                }

                settings.power_user.long_chat_display_count = INITIAL_LONG_CHAT_DISPLAY_COUNT;
                writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
                totalUpdated++;
            });
        });
    }

    if (totalUpdated > 0 || totalSkipped > 0) {
        console.info(`[Data Maid] Initial messages migration: ${totalUpdated} user setting(s) updated, ${totalAlreadySet} already set, ${totalSkipped} skipped.`);
    }
}

/**
 * Groups pushed shared-character keys by owning user handle.
 * @param {object} sharedIndex Shared-character index snapshot.
 * @returns {Map<string, Set<string>>}
 */
function getPushedCharacterNamesByHandle(sharedIndex) {
    const namesByHandle = new Map();
    const characters = sharedIndex?.characters && typeof sharedIndex.characters === 'object' && !Array.isArray(sharedIndex.characters)
        ? sharedIndex.characters
        : {};

    for (const [characterName, record] of Object.entries(characters)) {
        const ownerHandles = Array.isArray(record?.ownerHandles) ? record.ownerHandles : [];
        for (const ownerHandle of ownerHandles) {
            const handle = String(ownerHandle || '').trim();
            if (!handle) {
                continue;
            }

            if (!namesByHandle.has(handle)) {
                namesByHandle.set(handle, new Set());
            }

            namesByHandle.get(handle).add(characterName);
        }
    }

    return namesByHandle;
}

/**
 * Removes legacy per-character lorebook settings for pushed shared characters.
 * @returns {Promise<void>}
 */
async function migratePushedCharacterCharLoreSettings() {
    const { SETTINGS_FILE } = await import('./src/constants.js');
    const { withSettingsPersonasLock } = await import('./src/settings-lock.js');
    const { getAllUserHandles, getUserDirectories } = await import('./src/users.js');
    const { normalizeCharacterName, readSharedCharacterIndexSnapshot } = await import('./src/character-sharing-repository.js');
    const sharedIndex = await readSharedCharacterIndexSnapshot();
    const pushedNamesByHandle = getPushedCharacterNamesByHandle(sharedIndex);
    const handles = await getAllUserHandles();
    let totalUpdated = 0;
    let totalRemoved = 0;
    let totalSkipped = 0;

    for (const handle of handles) {
        const pushedNames = pushedNamesByHandle.get(handle);
        if (!pushedNames?.size) {
            continue;
        }

        const directories = getUserDirectories(handle);
        const settingsPath = path.join(directories.root, SETTINGS_FILE);

        if (!fs.existsSync(settingsPath)) {
            totalSkipped++;
            console.warn(`[Data Maid] Skipping pushed character charLore migration for ${handle}; settings file does not exist: ${settingsPath}`);
            continue;
        }

        await withSettingsPersonasLock(directories, async (lock) => {
            await lock.run(() => {
                const settings = readUserSettings(settingsPath);
                const worldInfo = settings?.world_info_settings?.world_info;
                if (!Array.isArray(worldInfo?.charLore)) {
                    return;
                }

                const nextCharLore = worldInfo.charLore.filter((entry) => {
                    try {
                        return !pushedNames.has(normalizeCharacterName(entry?.name));
                    } catch {
                        return true;
                    }
                });
                const removed = worldInfo.charLore.length - nextCharLore.length;
                if (removed === 0) {
                    return;
                }

                worldInfo.charLore = nextCharLore;
                writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
                totalUpdated++;
                totalRemoved += removed;
            });
        });
    }

    if (totalRemoved > 0 || totalSkipped > 0) {
        console.info(`[Data Maid] Pushed character charLore migration: ${totalRemoved} entr${totalRemoved === 1 ? 'y' : 'ies'} removed from ${totalUpdated} user setting(s), ${totalSkipped} skipped.`);
    }
}

/**
 * Lists canonical character names from a user's character directory.
 * @param {string} charactersDirectory User character directory.
 * @param {(value: string) => string} normalizeCharacterName Character name normalizer.
 * @returns {Set<string>}
 */
function getCharacterNamesFromDirectory(charactersDirectory, normalizeCharacterName) {
    const characterNames = new Set();
    const files = fs.existsSync(charactersDirectory)
        ? fs.readdirSync(charactersDirectory)
        : [];

    for (const fileName of files) {
        if (path.extname(fileName).toLowerCase() !== '.png') {
            continue;
        }

        try {
            characterNames.add(normalizeCharacterName(fileName));
        } catch {
            // Ignore unusable character file names while pruning stale settings.
        }
    }

    return characterNames;
}

/**
 * Removes per-character lorebook settings for characters that no longer exist.
 * @returns {Promise<void>}
 */
async function migrateOrphanedCharacterCharLoreSettings() {
    const { SETTINGS_FILE } = await import('./src/constants.js');
    const { withSettingsPersonasLock } = await import('./src/settings-lock.js');
    const { getAllUserHandles, getUserDirectories } = await import('./src/users.js');
    const { normalizeCharacterName } = await import('./src/character-sharing-repository.js');
    const handles = await getAllUserHandles();
    let totalUpdated = 0;
    let totalRemoved = 0;
    let totalSkipped = 0;

    for (const handle of handles) {
        const directories = getUserDirectories(handle);
        const settingsPath = path.join(directories.root, SETTINGS_FILE);

        if (!fs.existsSync(settingsPath)) {
            totalSkipped++;
            console.warn(`[Data Maid] Skipping orphaned charLore migration for ${handle}; settings file does not exist: ${settingsPath}`);
            continue;
        }

        const characterNames = getCharacterNamesFromDirectory(directories.characters, normalizeCharacterName);

        await withSettingsPersonasLock(directories, async (lock) => {
            await lock.run(() => {
                const settings = readUserSettings(settingsPath);
                const worldInfo = settings?.world_info_settings?.world_info;
                if (!Array.isArray(worldInfo?.charLore)) {
                    return;
                }

                const nextCharLore = worldInfo.charLore.filter((entry) => {
                    try {
                        return characterNames.has(normalizeCharacterName(entry?.name));
                    } catch {
                        return false;
                    }
                });
                const removed = worldInfo.charLore.length - nextCharLore.length;
                if (removed === 0) {
                    return;
                }

                worldInfo.charLore = nextCharLore;
                writeFileAtomicSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
                totalUpdated++;
                totalRemoved += removed;
            });
        });
    }

    if (totalRemoved > 0 || totalSkipped > 0) {
        console.info(`[Data Maid] Orphaned charLore migration: ${totalRemoved} entr${totalRemoved === 1 ? 'y' : 'ies'} removed from ${totalUpdated} user setting(s), ${totalSkipped} skipped.`);
    }
}

async function runMigration() {
    try {
        const { initUserStorage } = await import('./src/users.js');
        const { withDirectoryLock } = await import('./src/file-system-lock.js');

        await initUserStorage(globalThis.DATA_ROOT);

        const lockPath = path.join(globalThis.DATA_ROOT, 'migration.lock');
        const lockOptions = {
            lockPath,
            retryMs: 1000,
            timeoutMs: 10 * 60 * 1000, // 10 minutes
            staleMs: 5 * 60 * 1000, // 5 minutes
            heartbeatMs: 10 * 1000, // 10 seconds
            timeoutMessage: 'Could not acquire migration lock. Another instance might be running the migration.',
        };

        await withDirectoryLock(lockOptions, async () => {
            console.log('Starting SQLite migration...');
            await migrateAllUsersChatsToSqlite();
            await migrateAllUsersInitialMessagesToShow();
            await migratePushedCharacterCharLoreSettings();
            await migrateOrphanedCharacterCharLoreSettings();
            console.log('SQLite migration completed.');
        });
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
