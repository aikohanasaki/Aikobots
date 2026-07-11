import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import Database from 'better-sqlite3';

import { withDirectoryLock } from './file-system-lock.js';

const CHAT_SAVE_LOCK_RETRY_MS = 25;
const CHAT_SAVE_LOCK_TIMEOUT_MS = 10_000;
const CHAT_SAVE_LOCK_STALE_MS = 10 * 60_000;
const CHAT_SAVE_LOCK_HEARTBEAT_MS = 1_000;

/** Replaces only the terminal chat storage extension. */
export function replaceChatStorageExtension(filePath, extension) {
    return String(filePath).replace(/\.(?:jsonl|sqlite)$/i, extension);
}

/** Returns every on-disk companion for one logical chat. */
export function getChatStorageCompanionPaths(filePath) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    return {
        jsonlPath: replaceChatStorageExtension(filePath, '.jsonl'),
        sqlitePath,
        walPath: `${sqlitePath}-wal`,
        shmPath: `${sqlitePath}-shm`,
    };
}

/** Returns whether either supported primary chat file exists. */
export function hasPrimaryChatStorageFile(filePath) {
    const { jsonlPath, sqlitePath } = getChatStorageCompanionPaths(filePath);
    return fs.existsSync(sqlitePath) || fs.existsSync(jsonlPath);
}

/** Runs one operation under the established cross-process logical-chat lock. */
export async function withChatSaveLock(filePath, callback) {
    const lockTargetPath = replaceChatStorageExtension(filePath, '.sqlite');
    const lockPath = `${lockTargetPath}.lock`;

    return await withDirectoryLock({
        lockPath,
        retryMs: CHAT_SAVE_LOCK_RETRY_MS,
        timeoutMs: CHAT_SAVE_LOCK_TIMEOUT_MS,
        staleMs: CHAT_SAVE_LOCK_STALE_MS,
        heartbeatMs: CHAT_SAVE_LOCK_HEARTBEAT_MS,
        timeoutMessage: `Timed out waiting for chat save lock: ${lockTargetPath}`,
    }, async lock => await lock.run(callback));
}

/** Acquires multiple logical-chat locks in deterministic order. */
export async function withChatSaveLocks(filePaths, callback) {
    const uniqueFilePaths = Array.from(new Map(
        filePaths.map(filePath => [replaceChatStorageExtension(filePath, '.sqlite'), filePath]),
    ).values()).sort((left, right) => replaceChatStorageExtension(left, '.sqlite').localeCompare(replaceChatStorageExtension(right, '.sqlite')));

    const runAt = async index => index >= uniqueFilePaths.length
        ? await callback()
        : await withChatSaveLock(uniqueFilePaths[index], async () => await runAt(index + 1));

    return await runAt(0);
}

/** Deletes all storage companions. The caller must hold the logical-chat lock. */
export function deleteChatStorageCompanions(filePath) {
    const companions = getChatStorageCompanionPaths(filePath);
    for (const companionPath of Object.values(companions)) {
        if (fs.existsSync(companionPath)) {
            fs.unlinkSync(companionPath);
        }
    }
}

/** Creates a consistent SQLite snapshot and atomically publishes it at the target path. */
export async function backupSqliteDatabaseFile(sourcePath, targetPath) {
    const resolvedSource = path.resolve(sourcePath);
    const resolvedTarget = path.resolve(targetPath);
    if (!fs.existsSync(resolvedSource)) {
        throw new Error('SQLite snapshot source does not exist.');
    }
    if (Object.values(getChatStorageCompanionPaths(resolvedTarget)).some(companionPath => fs.existsSync(companionPath))) {
        throw new Error('SQLite snapshot target storage already exists.');
    }

    fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
    const tempPath = `${resolvedTarget}.${process.pid}.${Date.now()}.tmp`;
    const db = new Database(resolvedSource, { readonly: true, fileMustExist: true });
    let published = false;
    try {
        await db.backup(tempPath);
        fs.renameSync(tempPath, resolvedTarget);
        published = true;
    } finally {
        db.close();
        if (!published && fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
}

/** Copies legacy JSONL atomically. The caller must hold source and target locks. */
export function copyLegacyJsonlFile(sourcePath, targetPath) {
    const resolvedTarget = path.resolve(targetPath);
    if (Object.values(getChatStorageCompanionPaths(resolvedTarget)).some(companionPath => fs.existsSync(companionPath))) {
        throw new Error('Legacy chat copy target storage already exists.');
    }
    fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
    const tempPath = `${resolvedTarget}.${process.pid}.${Date.now()}.tmp`;
    let published = false;
    try {
        fs.copyFileSync(sourcePath, tempPath);
        fs.renameSync(tempPath, resolvedTarget);
        published = true;
    } finally {
        if (!published && fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
}
