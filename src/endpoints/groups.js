import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { humanizedISO8601DateTime } from '../util.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';
import { createFavoritesState, flushFavoritesState, getGroupFavorite, setGroupFavorite } from '../favorites-repository.js';
import { isChatPathValidationError, resolveGroupChatStoragePaths } from '../chat-paths.js';
import { withDirectoryLock } from '../file-system-lock.js';

export const router = express.Router();

const DEFAULT_GROUP_CHAT_MAX_TURNS = 0;
const GROUP_METADATA_LOCK_RETRY_MS = 25;
const GROUP_METADATA_LOCK_TIMEOUT_MS = 10_000;
const GROUP_METADATA_LOCK_STALE_MS = 10 * 60_000;
const GROUP_METADATA_LOCK_HEARTBEAT_MS = 1_000;

async function withGroupMetadataLock(groupPath, callback) {
    const lockPath = `${groupPath}.lock`;

    return await withDirectoryLock({
        lockPath,
        retryMs: GROUP_METADATA_LOCK_RETRY_MS,
        timeoutMs: GROUP_METADATA_LOCK_TIMEOUT_MS,
        staleMs: GROUP_METADATA_LOCK_STALE_MS,
        heartbeatMs: GROUP_METADATA_LOCK_HEARTBEAT_MS,
        timeoutMessage: `Timed out waiting for group metadata lock: ${groupPath}`,
    }, async lock => await lock.run(callback));
}

async function withGroupChatStorageLock(chatPaths, callback) {
    const lockPath = `${chatPaths.sqlitePath}.lock`;

    return await withDirectoryLock({
        lockPath,
        retryMs: GROUP_METADATA_LOCK_RETRY_MS,
        timeoutMs: GROUP_METADATA_LOCK_TIMEOUT_MS,
        staleMs: GROUP_METADATA_LOCK_STALE_MS,
        heartbeatMs: GROUP_METADATA_LOCK_HEARTBEAT_MS,
        timeoutMessage: `Timed out waiting for group chat storage lock: ${chatPaths.sqlitePath}`,
    }, async lock => await lock.run(callback));
}

/** Normalizes the per-group speaker cap. 0 means unlimited. */
const normalizeGroupChatMaxTurns = (value) => {
    const maxTurns = Number(value);

    if (!Number.isFinite(maxTurns) || !Number.isInteger(maxTurns) || maxTurns < 0) {
        return DEFAULT_GROUP_CHAT_MAX_TURNS;
    }

    return maxTurns;
};

const sanitizeGroupPayload = (group, { stripFavorite = true } = {}) => {
    if (!group || typeof group !== 'object') {
        return group;
    }

    const sanitizedGroup = JSON.parse(JSON.stringify(group));
    sanitizedGroup.group_chat_max_turns = normalizeGroupChatMaxTurns(sanitizedGroup.group_chat_max_turns);
    delete sanitizedGroup.chat_metadata;
    delete sanitizedGroup.past_metadata;
    if (stripFavorite) {
        delete sanitizedGroup.fav;
    }
    return sanitizedGroup;
};

const coerceFavoriteValue = (value) => value === true || value === 'true';

const setAndFlushGroupFavorite = (directories, { id, value }) => {
    const favoritesState = createFavoritesState(directories);
    const favorite = setGroupFavorite(favoritesState, { id, value });
    flushFavoritesState(favoritesState);
    return favorite;
};

router.post('/all', (request, response) => {
    const favoritesState = createFavoritesState(request.user.directories);
    const groups = [];

    try {
        if (!fs.existsSync(request.user.directories.groups)) {
            fs.mkdirSync(request.user.directories.groups);
        }

        const files = fs.readdirSync(request.user.directories.groups).filter(x => path.extname(x) === '.json');

        files.forEach(function (file) {
            try {
                const filePath = path.join(request.user.directories.groups, file);
                const fileContents = fs.readFileSync(filePath, 'utf8');
                const rawGroup = JSON.parse(fileContents);
                const group = sanitizeGroupPayload(rawGroup, { stripFavorite: false });
                const groupStat = fs.statSync(filePath);
                group['date_added'] = groupStat.birthtimeMs;
                group['create_date'] = humanizedISO8601DateTime(groupStat.birthtimeMs);
                group['fav'] = getGroupFavorite(favoritesState, {
                    id: String(group.id || ''),
                    legacyFavorite: coerceFavoriteValue(rawGroup?.fav),
                });

                let chat_size = 0;
                let date_last_chat = 0;

                if (Array.isArray(group.chats)) {
                    for (const chatId of group.chats) {
                        let chatPaths;
                        try {
                            chatPaths = resolveGroupChatStoragePaths(request.user.directories.groupChats, chatId);
                        } catch (error) {
                            if (isChatPathValidationError(error)) {
                                continue;
                            }
                            throw error;
                        }

                        let chatPath = null;
                        if (fs.existsSync(chatPaths.sqlitePath)) chatPath = chatPaths.sqlitePath;
                        else if (fs.existsSync(chatPaths.jsonlPath)) chatPath = chatPaths.jsonlPath;

                        if (chatPath) {
                            const chatStat = fs.statSync(chatPath);
                            chat_size += chatStat.size;
                            date_last_chat = Math.max(date_last_chat, chatStat.mtimeMs);
                        }
                    }
                }

                group['date_last_chat'] = date_last_chat;
                group['chat_size'] = chat_size;
                groups.push(group);
            }
            catch (error) {
                console.error(error);
            }
        });

        return response.send(groups);
    } finally {
        flushFavoritesState(favoritesState);
    }
});

router.post('/create', async (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    const id = String(Date.now());
    const requestedFavorite = coerceFavoriteValue(request.body.fav);
    const groupMetadata = sanitizeGroupPayload({
        id: id,
        name: request.body.name ?? 'New Group',
        members: request.body.members ?? [],
        avatar_url: request.body.avatar_url,
        allow_self_responses: !!request.body.allow_self_responses,
        activation_strategy: request.body.activation_strategy ?? 0,
        generation_mode: request.body.generation_mode ?? 0,
        disabled_members: request.body.disabled_members ?? [],
        fav: request.body.fav,
        chat_id: request.body.chat_id ?? id,
        chats: request.body.chats ?? [id],
        auto_mode_delay: request.body.auto_mode_delay ?? 5,
        group_chat_max_turns: request.body.group_chat_max_turns ?? 0,
        generation_mode_join_prefix: request.body.generation_mode_join_prefix ?? '',
        generation_mode_join_suffix: request.body.generation_mode_join_suffix ?? '',
    });
    const pathToFile = path.join(request.user.directories.groups, sanitize(`${id}.json`));
    const fileData = JSON.stringify(groupMetadata, null, 4);

    try {
        return await withGroupMetadataLock(pathToFile, async () => {
            if (!fs.existsSync(request.user.directories.groups)) {
                fs.mkdirSync(request.user.directories.groups);
            }

            if (fs.existsSync(pathToFile)) {
                return response.status(409).send({ error: 'group_exists' });
            }

            groupMetadata.fav = setAndFlushGroupFavorite(request.user.directories, { id, value: requestedFavorite });
            writeFileAtomicSync(pathToFile, fileData);
            return response.send(groupMetadata);
        });
    } catch (error) {
        console.error(error);
        return response.status(error?.status || 500).send({ error: 'group_create_failed' });
    }
});

router.post('/edit', getFileNameValidationFunction('id'), async (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }
    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groups, sanitize(`${id}.json`));
    const fileData = JSON.stringify(sanitizeGroupPayload(request.body), null, 4);

    try {
        return await withGroupMetadataLock(pathToFile, async () => {
            if (request.body.fav !== undefined) {
                setAndFlushGroupFavorite(request.user.directories, { id, value: coerceFavoriteValue(request.body.fav) });
            }
            writeFileAtomicSync(pathToFile, fileData);
            return response.send({ ok: true });
        });
    } catch (error) {
        console.error(error);
        return response.status(error?.status || 500).send({ error: 'group_edit_failed' });
    }
});

router.post('/delete', getFileNameValidationFunction('id'), async (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }

    const id = request.body.id;
    const pathToGroup = path.join(request.user.directories.groups, sanitize(`${id}.json`));

    try {
        return await withGroupMetadataLock(pathToGroup, async () => {
            try {
                // Delete group chats
                const group = JSON.parse(fs.readFileSync(pathToGroup, 'utf8'));

                if (group && Array.isArray(group.chats)) {
                    for (const chat of group.chats) {
                        console.info('Deleting group chat', chat);
                        let chatPaths;
                        try {
                            chatPaths = resolveGroupChatStoragePaths(request.user.directories.groupChats, chat);
                        } catch (error) {
                            if (isChatPathValidationError(error)) {
                                continue;
                            }
                            throw error;
                        }

                        await withGroupChatStorageLock(chatPaths, async () => {
                            if (fs.existsSync(chatPaths.jsonlPath)) {
                                fs.unlinkSync(chatPaths.jsonlPath);
                            }

                            if (fs.existsSync(chatPaths.sqlitePath)) {
                                fs.unlinkSync(chatPaths.sqlitePath);
                            }

                            if (fs.existsSync(chatPaths.walPath)) {
                                fs.unlinkSync(chatPaths.walPath);
                            }

                            if (fs.existsSync(chatPaths.shmPath)) {
                                fs.unlinkSync(chatPaths.shmPath);
                            }
                        });
                    }
                }
            } catch (error) {
                console.error('Could not delete group chats. Clean them up manually.', error);
            }

            if (fs.existsSync(pathToGroup)) {
                fs.unlinkSync(pathToGroup);
            }

            return response.send({ ok: true });
        });
    } catch (error) {
        console.error(error);
        return response.status(error?.status || 500).send({ error: 'group_delete_failed' });
    }
});
