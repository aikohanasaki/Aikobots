#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';

// config.yaml will be set when parsing command line arguments
const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.DEFAULT_CONTENT_ROOT = cliArgs.defaultContentRoot;
globalThis.DEFAULT_SCAFFOLD_ROOT = cliArgs.defaultScaffoldRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
process.chdir(serverDirectory);

/**
 * Recombines split chats across all users before converting legacy chats to SQLite.
 * @returns {Promise<void>}
 */
async function recombineAllUsersSplitChats() {
    const { getAllUserHandles, getUserDirectories } = await import('./src/users.js');
    const { DataMaidService } = await import('./src/endpoints/data-maid.js');
    const handles = await getAllUserHandles();
    const allEntries = [];

    for (const handle of handles) {
        const directories = getUserDirectories(handle);
        const dataMaid = new DataMaidService(handle, directories);
        const paths = await dataMaid.getSplitChatPaths();
        for (const entryPath of paths) {
            const stat = await fs.promises.stat(entryPath);
            allEntries.push({
                path: entryPath,
                dataMaid,
                time: stat.birthtimeMs || stat.mtimeMs,
            });
        }
    }

    if (allEntries.length === 0) {
        return;
    }

    allEntries.sort((a, b) => a.time - b.time);

    console.info(`[Data Maid] Found ${allEntries.length} split chats to recombine:`);
    for (const entry of allEntries) {
        console.info(`  - ${entry.path}`);
    }

    let totalConverted = 0;

    for (const { dataMaid, path: entryPath } of allEntries) {
        const count = await dataMaid.recombineAllSplitChats([entryPath]);
        totalConverted += count;
    }

    if (totalConverted > 0) {
        console.info(`[Data Maid] Successfully recombined and migrated ${totalConverted} split chats to SQLite.`);
    }
}

/**
 * Converts all users' legacy JSONL chats to SQLite files.
 * @returns {Promise<void>}
 */
async function migrateAllUsersChatsToSqlite() {
    const { getAllUserHandles, getUserDirectories } = await import('./src/users.js');
    const { isHeadChatFile } = await import('./src/endpoints/chats.js');
    const { loadDb, migrateFromJsonl } = await import('./src/sqlite-manager.js');
    const handles = await getAllUserHandles();
    let totalMigrated = 0;
    let totalRemovedExisting = 0;
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
                    const sqlitePath = entryPath.replace('.jsonl', '.sqlite');
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

    for (const { entryPath, sqlitePath } of allEntries) {
        if (!fs.existsSync(sqlitePath)) {
            try {
                console.info(`[Data Maid] Migrating ${entryPath} to SQLite...`);
                await migrateFromJsonl(entryPath, sqlitePath);
                await verifySqliteIntegrity(sqlitePath);
                // Remove the verified legacy JSONL source after successful migration.
                fs.unlinkSync(entryPath);
                totalMigrated++;
            } catch (error) {
                console.error(`[Data Maid] Failed to migrate ${entryPath} to SQLite:`, error);
            }
        } else {
            // SQLite already exists (e.g. from recombination or previous run)
            // If the original JSONL is still here, remove the legacy storage duplicate.
            if (fs.existsSync(entryPath)) {
                try {
                    await verifySqliteIntegrity(sqlitePath);
                    console.info(`[Data Maid] ${sqlitePath} already exists and passed integrity check, removing legacy JSONL ${entryPath}...`);
                    fs.unlinkSync(entryPath);
                    totalRemovedExisting++;
                } catch (error) {
                    console.error(`[Data Maid] Refusing to remove legacy JSONL ${entryPath}; existing SQLite failed integrity verification:`, error);
                }
            }
        }
    }

    if (totalMigrated > 0 || totalRemovedExisting > 0) {
        console.info(`[Data Maid] SQLite migration: ${totalMigrated} new migrations, ${totalRemovedExisting} previously migrated legacy JSONL files removed.`);
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
            await recombineAllUsersSplitChats();
            await migrateAllUsersChatsToSqlite();
            console.log('SQLite migration completed.');
        });
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
