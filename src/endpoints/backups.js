import express from 'express';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';

import { CHAT_BACKUPS_PREFIX, getChatInfo } from './chats.js';

export const router = express.Router();

function normalizeBackupOwnerKey(ownerKey) {
    const normalized = sanitize(String(ownerKey || ''))
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();
    return normalized;
}

/**
 * Normalizes the requested primary and compatibility backup owner keys.
 */
function normalizeBackupOwnerKeys(ownerKey, additionalOwnerKeys) {
    const rawKeys = [
        ownerKey,
        ...(Array.isArray(additionalOwnerKeys) ? additionalOwnerKeys : []),
    ];
    const normalizedKeys = new Set();

    for (const rawKey of rawKeys) {
        const normalizedKey = normalizeBackupOwnerKey(rawKey);
        if (normalizedKey) {
            normalizedKeys.add(normalizedKey);
        }
        if (normalizedKeys.size >= 100) {
            break;
        }
    }

    return [...normalizedKeys];
}

function getRequestedChatBackupPath(request, name) {
    const rawName = String(name || '');
    const sanitizedName = sanitize(rawName);
    const backupsDirectory = path.resolve(request.user.directories.backups);
    const filePath = path.resolve(backupsDirectory, sanitizedName);

    if (!sanitizedName
        || sanitizedName !== rawName
        || path.dirname(filePath) !== backupsDirectory
        || path.extname(sanitizedName).toLowerCase() !== '.jsonl'
        || !sanitizedName.startsWith(CHAT_BACKUPS_PREFIX)) {
        return null;
    }

    return filePath;
}

router.post('/chat/list', async (request, response) => {
    try {
        const ownerKeys = normalizeBackupOwnerKeys(request.body?.owner_key, request.body?.owner_keys);
        if (!ownerKeys.length) {
            return response.status(400).json([]);
        }

        const backupPrefixes = ownerKeys.map(ownerKey => `${CHAT_BACKUPS_PREFIX}${ownerKey}_`);
        const directoryEntries = await fsPromises.readdir(request.user.directories.backups, { withFileTypes: true });
        const backupFiles = directoryEntries
            .filter(entry => entry.isFile()
                && path.extname(entry.name).toLowerCase() === '.jsonl'
                && backupPrefixes.some(prefix => entry.name.startsWith(prefix)))
            .map(entry => entry.name);

        const backupModels = (await Promise.all(backupFiles.map(async (name) => {
            const filePath = path.join(request.user.directories.backups, name);
            return await getChatInfo(filePath);
        }))).filter(info => info?.file_name);

        return response.json(backupModels);
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return response.json([]);
        }

        console.error('Failed to list chat backups:', error);
        return response.sendStatus(500);
    }
});

router.post('/chat/download', async (request, response) => {
    try {
        const filePath = getRequestedChatBackupPath(request, request.body?.name);
        if (!filePath) {
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        return response.download(filePath);
    } catch (error) {
        console.error('Failed to download chat backup:', error);
        return response.sendStatus(500);
    }
});

router.post('/chat/delete', async (request, response) => {
    try {
        const filePath = getRequestedChatBackupPath(request, request.body?.name);
        if (!filePath) {
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        await fsPromises.unlink(filePath);
        return response.sendStatus(204);
    } catch (error) {
        console.error('Failed to delete chat backup:', error);
        return response.sendStatus(500);
    }
});
