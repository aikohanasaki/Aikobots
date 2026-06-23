import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';

import {
    buildUserStorageCheckEvaluation,
    filterDueUserStorageCheckEvaluation,
    getRecursiveDirectorySize,
    getUserStorageCheckSizes,
    runUserStorageCheck,
    STORAGE_CHECK_BYTES_PER_GB,
    STORAGE_CHECK_CODES,
} from '../user-storage-check.js';
import { setConfigFilePath } from '../util.js';

const tempDirs = [];
const originalDataRoot = globalThis.DATA_ROOT;
const configTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-check-config-'));
const configPath = path.join(configTempDir, 'config.yaml');

fs.writeFileSync(configPath, '{}\n', 'utf8');
setConfigFilePath(configPath);

function makeTempDir(prefix) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(tempDir);
    return tempDir;
}

function writeSizedFile(filePath, size) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(size));
}

function writeSparseFile(filePath, size) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const fd = fs.openSync(filePath, 'w');

    try {
        fs.writeSync(fd, Buffer.from([0]), 0, 1, size - 1);
    } finally {
        fs.closeSync(fd);
    }
}

function countAdminMessageRecords(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(line => JSON.parse(line).type === 'message')
        .length;
}

afterEach(() => {
    jest.restoreAllMocks();

    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }

    if (originalDataRoot === undefined) {
        delete globalThis.DATA_ROOT;
    } else {
        globalThis.DATA_ROOT = originalDataRoot;
    }
});

afterAll(() => {
    fs.rmSync(configTempDir, { recursive: true, force: true });
});

describe('user storage checks', () => {
    it('treats missing directories as empty', async () => {
        const tempDir = makeTempDir('storage-check-missing-');
        await expect(getRecursiveDirectorySize(path.join(tempDir, 'missing'))).resolves.toBe(0);
    });

    it('counts nested regular files', async () => {
        const tempDir = makeTempDir('storage-check-nested-');
        writeSizedFile(path.join(tempDir, 'one.bin'), 3);
        writeSizedFile(path.join(tempDir, 'nested', 'two.bin'), 5);

        await expect(getRecursiveDirectorySize(tempDir)).resolves.toBe(8);
    });

    it('does not follow symlinks', async () => {
        const tempDir = makeTempDir('storage-check-symlink-');
        const targetFile = path.join(tempDir, 'target.bin');
        const linkFile = path.join(tempDir, 'link.bin');
        writeSizedFile(path.join(tempDir, 'regular.bin'), 2);
        writeSizedFile(targetFile, 9);

        try {
            fs.symlinkSync(targetFile, linkFile);
        } catch {
            return;
        }

        await expect(getRecursiveDirectorySize(tempDir)).resolves.toBe(11);
    });

    it('includes direct chats and group chats in chat storage', async () => {
        const tempDir = makeTempDir('storage-check-sizes-');
        const directories = {
            root: path.join(tempDir, 'user-root'),
            chats: path.join(tempDir, 'user-root', 'chats'),
            groupChats: path.join(tempDir, 'user-root', 'group chats'),
            userImages: path.join(tempDir, 'user-root', 'user', 'images'),
            characters: path.join(tempDir, 'user-root', 'characters'),
        };
        const sharedCharactersDirectory = path.join(tempDir, '_secure', 'shared-characters');

        writeSizedFile(path.join(directories.chats, 'bot', 'chat.sqlite'), 7);
        writeSizedFile(path.join(directories.groupChats, 'group.sqlite'), 11);
        writeSizedFile(path.join(directories.userImages, 'image.png'), 13);
        writeSizedFile(path.join(directories.characters, 'bot.png'), 17);
        writeSizedFile(path.join(directories.root, 'settings.json'), 23);
        writeSizedFile(path.join(sharedCharactersDirectory, 'shared.png'), 19);

        await expect(getUserStorageCheckSizes(directories, { sharedCharactersDirectory })).resolves.toEqual({
            rootBytes: 71,
            chatBytes: 18,
            imageBytes: 13,
            characterBytes: 17,
            sharedCharacterBytes: 19,
        });
    });

    it('uses the 2GB chat warning instead of the 1GB warning and creates an admin alert', () => {
        const result = buildUserStorageCheckEvaluation({
            chatBytes: (2 * STORAGE_CHECK_BYTES_PER_GB) + 1,
            imageBytes: 0,
            characterBytes: 0,
            sharedCharacterBytes: 0,
        });

        expect(result.warnings.map(warning => warning.code)).toEqual([STORAGE_CHECK_CODES.CHAT_2GB]);
        expect(result.adminAlerts.map(alert => alert.code)).toContain(STORAGE_CHECK_CODES.CHAT_2GB);
    });

    it('uses the 2GB image warning instead of the 1GB warning and creates an admin alert', () => {
        const result = buildUserStorageCheckEvaluation({
            chatBytes: 0,
            imageBytes: (2 * STORAGE_CHECK_BYTES_PER_GB) + 1,
            characterBytes: 0,
            sharedCharacterBytes: 0,
        });

        expect(result.warnings.map(warning => warning.code)).toEqual([STORAGE_CHECK_CODES.IMAGES_2GB]);
        expect(result.adminAlerts.map(alert => alert.code)).toContain(STORAGE_CHECK_CODES.IMAGES_2GB);
    });

    it('creates a character ratio admin alert at 2x shared character storage', () => {
        const result = buildUserStorageCheckEvaluation({
            chatBytes: 0,
            imageBytes: 0,
            characterBytes: 200,
            sharedCharacterBytes: 100,
        });

        expect(result.warnings).toHaveLength(0);
        expect(result.adminAlerts.map(alert => alert.code)).toEqual([STORAGE_CHECK_CODES.CHARACTERS_2X_SHARED]);
    });

    it('creates an admin-only alert when the whole user directory is over 3GB', () => {
        const result = buildUserStorageCheckEvaluation({
            rootBytes: (3 * STORAGE_CHECK_BYTES_PER_GB) + 1,
            chatBytes: 0,
            imageBytes: 0,
            characterBytes: 0,
            sharedCharacterBytes: 0,
        });

        expect(result.warnings).toHaveLength(0);
        expect(result.adminAlerts.map(alert => alert.code)).toEqual([STORAGE_CHECK_CODES.USER_DIRECTORY_3GB]);
    });

    it('suppresses repeated warnings once per day and leaves admin alerts due until delivered', async () => {
        const tempDir = makeTempDir('storage-check-state-');
        const statePath = path.join(tempDir, 'state.json');
        const evaluation = buildUserStorageCheckEvaluation({
            chatBytes: (2 * STORAGE_CHECK_BYTES_PER_GB) + 1,
            imageBytes: 0,
            characterBytes: 0,
            sharedCharacterBytes: 0,
        });

        const first = await filterDueUserStorageCheckEvaluation('user-a', evaluation, {
            now: Date.UTC(2026, 5, 22),
            statePath,
        });
        const second = await filterDueUserStorageCheckEvaluation('user-a', evaluation, {
            now: Date.UTC(2026, 5, 22, 12),
            statePath,
        });
        const nextDay = await filterDueUserStorageCheckEvaluation('user-a', evaluation, {
            now: Date.UTC(2026, 5, 23),
            statePath,
        });

        expect(first.warnings).toHaveLength(1);
        expect(first.adminAlerts).toHaveLength(1);
        expect(second.warnings).toHaveLength(0);
        expect(second.adminAlerts).toHaveLength(1);
        expect(nextDay.warnings).toHaveLength(1);
        expect(nextDay.adminAlerts).toHaveLength(1);
    });

    it('does not write admin alert messages for admin users', async () => {
        const tempDir = makeTempDir('storage-check-admin-user-');
        const handle = 'admin-user';
        const directories = {
            root: path.join(tempDir, handle),
            chats: path.join(tempDir, handle, 'chats'),
            groupChats: path.join(tempDir, handle, 'group chats'),
            userImages: path.join(tempDir, handle, 'user', 'images'),
            characters: path.join(tempDir, handle, 'characters'),
        };
        globalThis.DATA_ROOT = tempDir;

        writeSizedFile(path.join(directories.characters, 'character.png'), 2);
        writeSizedFile(path.join(tempDir, '_secure', 'shared-characters', 'shared.png'), 1);

        await expect(runUserStorageCheck({
            profile: { handle, name: 'Admin User', admin: true },
            directories,
        })).resolves.toEqual({ warnings: [] });

        expect(fs.existsSync(path.join(tempDir, handle, 'messages', 'admin.jsonl'))).toBe(false);
    });

    it('still writes admin alert messages for regular users', async () => {
        const tempDir = makeTempDir('storage-check-regular-user-');
        const handle = 'regular-user';
        const directories = {
            root: path.join(tempDir, handle),
            chats: path.join(tempDir, handle, 'chats'),
            groupChats: path.join(tempDir, handle, 'group chats'),
            userImages: path.join(tempDir, handle, 'user', 'images'),
            characters: path.join(tempDir, handle, 'characters'),
        };
        const messagePath = path.join(tempDir, handle, 'messages', 'admin.jsonl');
        globalThis.DATA_ROOT = tempDir;

        writeSizedFile(path.join(directories.characters, 'character.png'), 2);
        writeSizedFile(path.join(tempDir, '_secure', 'shared-characters', 'shared.png'), 1);

        await expect(runUserStorageCheck({
            profile: { handle, name: 'Regular User', admin: false },
            directories,
        })).resolves.toEqual({ warnings: [] });

        expect(fs.readFileSync(messagePath, 'utf8')).toContain('user character files are at least 2x');
    });

    it('retries failed admin alerts without repeating the shared user warning', async () => {
        const tempDir = makeTempDir('storage-check-admin-retry-');
        const handle = 'admin-retry-user';
        const directories = {
            root: path.join(tempDir, handle),
            chats: path.join(tempDir, handle, 'chats'),
            groupChats: path.join(tempDir, handle, 'group chats'),
            userImages: path.join(tempDir, handle, 'user', 'images'),
            characters: path.join(tempDir, handle, 'characters'),
        };
        const messagesPath = path.join(tempDir, handle, 'messages');
        const messagePath = path.join(messagesPath, 'admin.jsonl');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        globalThis.DATA_ROOT = tempDir;

        writeSparseFile(path.join(directories.chats, 'bot', 'chat.sqlite'), (2 * STORAGE_CHECK_BYTES_PER_GB) + 1);
        writeSizedFile(messagesPath, 1);

        await expect(runUserStorageCheck({
            profile: { handle, name: 'Admin Retry User', admin: false },
            directories,
        })).resolves.toEqual({
            warnings: [expect.objectContaining({ code: STORAGE_CHECK_CODES.CHAT_2GB })],
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);

        fs.rmSync(messagesPath, { force: true });

        await expect(runUserStorageCheck({
            profile: { handle, name: 'Admin Retry User', admin: false },
            directories,
        })).resolves.toEqual({ warnings: [] });
        expect(fs.readFileSync(messagePath, 'utf8')).toContain('chat files are over 2GB');

        await expect(runUserStorageCheck({
            profile: { handle, name: 'Admin Retry User', admin: false },
            directories,
        })).resolves.toEqual({ warnings: [] });
        expect(countAdminMessageRecords(messagePath)).toBe(1);
    });
});
