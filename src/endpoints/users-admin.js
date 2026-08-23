import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import storage from 'node-persist';
import express from 'express';
import lodash from 'lodash';
import { checkForNewContent, CONTENT_TYPES, ensureDefaultSettingsForUser } from './content-manager.js';
import {
    KEY_PREFIX,
    toKey,
    requireAdminMiddleware,
    getUserAvatar,
    getAllUserHandles,
    getPasswordSalt,
    getPasswordHash,
    getUserDirectories,
    ensurePublicDirectoriesExist,
    updateUserRecord,
    withUserRecordLock,
} from '../users.js';
import { DEFAULT_USER, SETTINGS_FILE } from '../constants.js';
import { parse as parseCharacterCard } from '../character-card-parser.js';
import { assertSafeFileName, resolvePathUnderParent } from '../path-security.js';
import { activeSessionStore } from '../active-session-store.js';

export const router = express.Router();
const UNKNOWN_LAST_OPENED = 'Unknown';

/**
 * Slugifies a given text string into a user handle.
 * - Converts to lowercase
 * - Trims whitespace
 * - Replaces spaces and special characters with hyphens
 * - Removes leading and trailing hyphens
 * - Uses lodash.deburr to remove diacritical marks
 * @param {string} text Text to slugify
 * @returns {string} Slugified text
 */
function slugify(text) {
    return lodash.deburr(String(text ?? '').toLowerCase().trim()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Reads the display name for a saved active character key.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} activeCharacter Saved active character avatar filename
 * @returns {Promise<string>} Resolved character display name
 */
async function resolveActiveCharacterName(directories, activeCharacter) {
    const avatarFileName = assertSafeFileName(activeCharacter, 'active_character');
    if (path.extname(avatarFileName).toLowerCase() !== '.png') {
        return '';
    }

    const characterPath = resolvePathUnderParent(directories.characters, avatarFileName, 'active_character');
    if (!fs.existsSync(characterPath)) {
        return '';
    }

    const rawCharacter = await parseCharacterCard(characterPath, 'png');
    const characterCard = JSON.parse(rawCharacter);
    return String(lodash.get(characterCard, 'data.name', characterCard?.name || '') || '').trim();
}

/**
 * Reads the display name for a saved active group key.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} activeGroup Saved active group id
 * @returns {string} Resolved group display name
 */
function resolveActiveGroupName(directories, activeGroup) {
    const groupId = assertSafeFileName(activeGroup, 'active_group');
    const groupPath = resolvePathUnderParent(directories.groups, `${groupId}.json`, 'active_group');
    if (!fs.existsSync(groupPath)) {
        return '';
    }

    const group = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
    return String(group?.name || '').trim();
}

/**
 * Resolves the admin-facing last opened target from a user's saved settings.
 * @param {string} handle User handle
 * @returns {Promise<{ type: 'character' | 'group' | null, name: string }>} Last opened target
 */
async function getLastOpenedTarget(handle) {
    try {
        const directories = getUserDirectories(handle);
        const settingsPath = path.join(directories.root, SETTINGS_FILE);
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const activeCharacter = String(settings?.active_character || '').trim();
        const activeGroup = String(settings?.active_group || '').trim();

        if (activeCharacter) {
            const name = await resolveActiveCharacterName(directories, activeCharacter);
            return name
                ? { type: 'character', name }
                : { type: null, name: UNKNOWN_LAST_OPENED };
        }

        if (activeGroup) {
            const name = resolveActiveGroupName(directories, activeGroup);
            return name
                ? { type: 'group', name }
                : { type: null, name: UNKNOWN_LAST_OPENED };
        }
    } catch {
        // Last opened is admin metadata only. Do not fail the user list for stale or malformed user data.
    }

    return { type: null, name: UNKNOWN_LAST_OPENED };
}

router.post('/get', requireAdminMiddleware, async (_request, response) => {
    try {
        /** @type {import('../users.js').User[]} */
        const users = (await storage.values(x => typeof x?.key === 'string' && x.key.startsWith(KEY_PREFIX)))
            .filter(user => user && typeof user.handle === 'string');

        /** @type {Promise<import('../users.js').UserViewModel>[]} */
        const viewModelPromises = users
            .map(async user => {
                const [avatar, lastOpened] = await Promise.all([
                    getUserAvatar(user.handle),
                    getLastOpenedTarget(user.handle),
                ]);

                return {
                    handle: user.handle,
                    name: user.name,
                    avatar: avatar,
                    admin: user.admin,
                    patron: Boolean(user.patron),
                    enabled: user.enabled,
                    created: user.created,
                    lastActivityAt: user.lastActivityAt,
                    lastOpened,
                    password: !!user.password,
                };
            });

        const viewModels = await Promise.all(viewModelPromises);
        viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(viewModels);
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/disable', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Disable user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle === request.user.profile.handle) {
            console.warn('Disable user failed: Cannot disable yourself');
            return response.status(400).json({ error: 'Cannot disable yourself' });
        }

        const user = await updateUserRecord(request.body.handle, current => {
            current.enabled = false;
            return current;
        });
        if (!user) {
            console.error('Disable user failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }
        return response.sendStatus(204);
    } catch (error) {
        console.error('User disable failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/enable', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Enable user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const user = await updateUserRecord(request.body.handle, current => {
            current.enabled = true;
            return current;
        });
        if (!user) {
            console.error('Enable user failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }
        return response.sendStatus(204);
    } catch (error) {
        console.error('User enable failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/promote', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Promote user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const user = await updateUserRecord(request.body.handle, current => {
            current.admin = true;
            return current;
        });
        if (!user) {
            console.error('Promote user failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }
        return response.sendStatus(204);
    } catch (error) {
        console.error('User promote failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/demote', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Demote user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle === request.user.profile.handle) {
            console.warn('Demote user failed: Cannot demote yourself');
            return response.status(400).json({ error: 'Cannot demote yourself' });
        }

        const user = await updateUserRecord(request.body.handle, current => {
            current.admin = false;
            return current;
        });
        if (!user) {
            console.error('Demote user failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }
        return response.sendStatus(204);
    } catch (error) {
        console.error('User demote failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/patron', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle || typeof request.body.patron !== 'boolean') {
            return response.status(400).json({ error: 'A user handle and patron boolean are required' });
        }

        const user = await updateUserRecord(request.body.handle, current => {
            current.patron = request.body.patron;
            return current;
        });
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }
        return response.sendStatus(204);
    } catch (error) {
        console.error('Patron update failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/reset-session', requireAdminMiddleware, async (request, response) => {
    try {
        const handle = request.body.handle;
        if (!handle) {
            return response.status(400).json({ error: 'Missing required fields' });
        }
        if (handle === request.user.profile.handle) {
            return response.status(400).json({ error: 'Cannot reset your own session' });
        }

        const user = await updateUserRecord(handle, current => {
            current.sessionEpoch = crypto.randomUUID();
            return current;
        });
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }

        await activeSessionStore.resetUser(handle);
        return response.sendStatus(204);
    } catch (error) {
        console.error('User session reset failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/create', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle || !request.body.name) {
            console.warn('Create user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }
        if (request.body.patron !== undefined && typeof request.body.patron !== 'boolean') {
            return response.status(400).json({ error: 'Patron must be a boolean' });
        }

        const handles = await getAllUserHandles();
        const handle = slugify(request.body.handle);

        if (!handle) {
            console.warn('Create user failed: Invalid handle');
            return response.status(400).json({ error: 'Invalid handle' });
        }

        if (handles.some(x => x === handle)) {
            console.warn('Create user failed: User with that handle already exists');
            return response.status(409).json({ error: 'User already exists' });
        }

        const salt = getPasswordSalt();
        const password = request.body.password ? getPasswordHash(request.body.password, salt) : '';

        const newUser = {
            handle: handle,
            name: request.body.name || 'Anonymous',
            created: Date.now(),
            password: password,
            salt: salt,
            admin: !!request.body.admin,
            patron: request.body.patron === true,
            enabled: true,
        };

        const directories = getUserDirectories(newUser.handle);
        await ensureDefaultSettingsForUser(directories);
        const created = await withUserRecordLock(handle, async () => {
            if (await storage.getItem(toKey(handle))) {
                return false;
            }
            await storage.setItem(toKey(handle), newUser);
            return true;
        });
        if (!created) {
            return response.status(409).json({ error: 'User already exists' });
        }

        // Create user directories
        console.info('Creating data directories for', newUser.handle);
        await ensurePublicDirectoriesExist();
        await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS, CONTENT_TYPES.CHARACTER]);
        return response.json({ handle: newUser.handle });
    } catch (error) {
        console.error('User create failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/delete', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Delete user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle === request.user.profile.handle) {
            console.warn('Delete user failed: Cannot delete yourself');
            return response.status(400).json({ error: 'Cannot delete yourself' });
        }

        if (request.body.handle === DEFAULT_USER.handle) {
            console.warn('Delete user failed: Cannot delete default user');
            return response.status(400).json({ error: 'Sorry, but the default user cannot be deleted. It is required as a fallback.' });
        }

        await withUserRecordLock(request.body.handle, async () => {
            await storage.removeItem(toKey(request.body.handle));
        });

        if (request.body.purge) {
            const directories = getUserDirectories(request.body.handle);
            console.info('Deleting data directories for', request.body.handle);
            await fsPromises.rm(directories.root, { recursive: true, force: true });
        }

        return response.sendStatus(204);
    } catch (error) {
        console.error('User delete failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/slugify', requireAdminMiddleware, async (request, response) => {
    try {
        if (!request.body.text) {
            console.warn('Slugify failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const text = slugify(request.body.text);

        return response.send(text);
    } catch (error) {
        console.error('Slugify failed:', error);
        return response.sendStatus(500);
    }
});
