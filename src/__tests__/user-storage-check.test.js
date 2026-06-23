import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    buildUserStorageCheckEvaluation,
    filterDueUserStorageCheckEvaluation,
    getRecursiveDirectorySize,
    getUserStorageCheckSizes,
    STORAGE_CHECK_BYTES_PER_GB,
    STORAGE_CHECK_CODES,
} from '../user-storage-check.js';

const tempDirs = [];

function makeTempDir(prefix) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(tempDir);
    return tempDir;
}

function writeSizedFile(filePath, size) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(size));
}

afterEach(() => {
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
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
            chats: path.join(tempDir, 'chats'),
            groupChats: path.join(tempDir, 'group chats'),
            userImages: path.join(tempDir, 'user', 'images'),
            characters: path.join(tempDir, 'characters'),
        };
        const sharedCharactersDirectory = path.join(tempDir, '_secure', 'shared-characters');

        writeSizedFile(path.join(directories.chats, 'bot', 'chat.sqlite'), 7);
        writeSizedFile(path.join(directories.groupChats, 'group.sqlite'), 11);
        writeSizedFile(path.join(directories.userImages, 'image.png'), 13);
        writeSizedFile(path.join(directories.characters, 'bot.png'), 17);
        writeSizedFile(path.join(sharedCharactersDirectory, 'shared.png'), 19);

        await expect(getUserStorageCheckSizes(directories, { sharedCharactersDirectory })).resolves.toEqual({
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

    it('suppresses repeated warning and admin alert codes once per day', async () => {
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
        expect(second.adminAlerts).toHaveLength(0);
        expect(nextDay.warnings).toHaveLength(1);
        expect(nextDay.adminAlerts).toHaveLength(1);
    });
});
