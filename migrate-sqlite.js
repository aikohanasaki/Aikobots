#!/usr/bin/env node
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

async function runMigration() {
    try {
        const { initUserStorage } = await import('./src/users.js');
        const { withDirectoryLock } = await import('./src/file-system-lock.js');
        const { DataMaidService } = await import('./src/endpoints/data-maid.js');

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
            await DataMaidService.recombineAllUsersSplitChats();
            await DataMaidService.migrateAllUsersChatsToSqlite();
            console.log('SQLite migration completed.');
        });
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
