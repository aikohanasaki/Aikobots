import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import crypto from 'node:crypto';

import storage from 'node-persist';
import express from 'express';

import { getUserAvatar, toKey, getPasswordHash, getPasswordSalt, createBackupArchive, ensurePublicDirectoriesExist, toAvatarKey, updateUserRecord } from '../users.js';
import { SETTINGS_FILE } from '../constants.js';
import { getPersonasPath } from '../persona-repository.js';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import { color, getConfigValue } from '../util.js';
import { clearUserFlowState, getUserFlowState, setUserFlowState } from './user-flow-state.js';
import { runUserStorageCheck } from '../user-storage-check.js';

const ACCOUNT_RESET_FLOW = 'account-reset';

export const router = express.Router();

export async function logoutUser(request, response) {
    try {
        if (!request.session) {
            console.error('Session not available');
            return response.sendStatus(500);
        }

        request.session.handle = null;
        request.session.csrfToken = null;
        request.session = null;
        return response.sendStatus(204);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
}

router.post('/logout', logoutUser);

router.get('/me', async (request, response) => {
    try {
        if (!request.user) {
            return response.sendStatus(403);
        }

        const user = request.user.profile;
        const viewModel = {
            handle: user.handle,
            name: user.name,
            avatar: await getUserAvatar(user.handle),
            admin: user.admin,
            patron: Boolean(user.patron),
            password: !!user.password,
            created: user.created,
        };

        return response.json(viewModel);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/storage-check', async (request, response) => {
    try {
        if (!request.user) {
            return response.sendStatus(403);
        }

        return response.json(await runUserStorageCheck(request.user));
    } catch (error) {
        console.warn('Failed to run user storage check.', error);
        return response.sendStatus(500);
    }
});

router.post('/change-avatar', async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Change avatar failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle !== request.user.profile.handle && !request.user.profile.admin) {
            console.error('Change avatar failed: Unauthorized');
            return response.status(403).json({ error: 'Unauthorized' });
        }

        // Avatar is not a data URL or not an empty string
        if (!request.body.avatar.startsWith('data:image/') && request.body.avatar !== '') {
            console.warn('Change avatar failed: Invalid data URL');
            return response.status(400).json({ error: 'Invalid data URL' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.error('Change avatar failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }

        await storage.setItem(toAvatarKey(request.body.handle), request.body.avatar);

        return response.sendStatus(204);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/change-password', async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Change password failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle !== request.user.profile.handle && !request.user.profile.admin) {
            console.error('Change password failed: Unauthorized');
            return response.status(403).json({ error: 'Unauthorized' });
        }

        const existingUser = await storage.getItem(toKey(request.body.handle));
        let disabled = false;
        const user = existingUser && await updateUserRecord(request.body.handle, current => {
            if (!current.enabled) {
                disabled = true;
                return current;
            }
            if (!request.user.profile.admin && current.password && current.password !== getPasswordHash(request.body.oldPassword, current.salt)) {
                return null;
            }
            if (request.body.newPassword) {
                const salt = getPasswordSalt();
                current.password = getPasswordHash(request.body.newPassword, salt);
                current.salt = salt;
            } else {
                current.password = '';
                current.salt = '';
            }
            return current;
        });
        if (disabled) {
            console.error('Change password failed: User is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }
        if (!user) {
            if (!existingUser) {
                console.error('Change password failed: User not found');
                return response.status(404).json({ error: 'User not found' });
            }
            console.error('Change password failed: Incorrect password');
            return response.status(403).json({ error: 'Incorrect password' });
        }

        return response.sendStatus(204);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/backup', async (request, response) => {
    try {
        if (!getConfigValue('backups.allowFullDataBackup', true, 'boolean')) {
            return response.status(403).json({ error: 'Full data backup is disabled' });
        }

        const handle = request.body.handle;

        if (!handle) {
            console.warn('Backup failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (handle !== request.user.profile.handle && !request.user.profile.admin) {
            console.error('Backup failed: Unauthorized');
            return response.status(403).json({ error: 'Unauthorized' });
        }

        await createBackupArchive(handle, response);
    } catch (error) {
        console.error('Backup failed', error);
        return response.sendStatus(500);
    }
});

router.post('/reset-settings', async (request, response) => {
    try {
        const password = request.body.password;

        if (request.user.profile.password && request.user.profile.password !== getPasswordHash(password, request.user.profile.salt)) {
            console.warn('Reset settings failed: Incorrect password');
            return response.status(403).json({ error: 'Incorrect password' });
        }

        const pathToFile = path.join(request.user.directories.root, SETTINGS_FILE);
        const pathToPersonas = getPersonasPath(request.user.directories);
        await fsPromises.rm(pathToFile, { force: true });
        await fsPromises.rm(pathToPersonas, { force: true });
        await checkForNewContent([request.user.directories], [CONTENT_TYPES.SETTINGS]);

        return response.sendStatus(204);
    } catch (error) {
        console.error('Reset settings failed', error);
        return response.sendStatus(500);
    }
});

router.post('/change-name', async (request, response) => {
    try {
        if (!request.body.name || !request.body.handle) {
            console.warn('Change name failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle !== request.user.profile.handle && !request.user.profile.admin) {
            console.error('Change name failed: Unauthorized');
            return response.status(403).json({ error: 'Unauthorized' });
        }

        const user = await updateUserRecord(request.body.handle, current => {
            current.name = request.body.name;
            return current;
        });
        if (!user) {
            console.warn('Change name failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }
        return response.sendStatus(204);
    } catch (error) {
        console.error('Change name failed', error);
        return response.sendStatus(500);
    }
});

router.post('/reset-step1', async (request, response) => {
    try {
        const resetCode = String(crypto.randomInt(1000, 9999));
        console.log();
        console.log(color.magenta(`${request.user.profile.name}, your account reset code is: `) + color.red(resetCode));
        console.log();
        await setUserFlowState(ACCOUNT_RESET_FLOW, request.user.profile.handle, resetCode);
        return response.sendStatus(204);
    } catch (error) {
        console.error('Recover step 1 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/reset-step2', async (request, response) => {
    try {
        if (!request.body.code) {
            console.warn('Recover step 2 failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.user.profile.password && request.user.profile.password !== getPasswordHash(request.body.password, request.user.profile.salt)) {
            console.warn('Recover step 2 failed: Incorrect password');
            return response.status(400).json({ error: 'Incorrect password' });
        }

        const code = await getUserFlowState(ACCOUNT_RESET_FLOW, request.user.profile.handle);

        if (!code || code !== request.body.code) {
            console.warn('Recover step 2 failed: Incorrect code');
            return response.status(400).json({ error: 'Incorrect code' });
        }

        console.info('Resetting account data:', request.user.profile.handle);
        await fsPromises.rm(request.user.directories.root, { recursive: true, force: true });

        await ensurePublicDirectoriesExist();
        await checkForNewContent([request.user.directories]);

        await clearUserFlowState(ACCOUNT_RESET_FLOW, request.user.profile.handle);
        return response.sendStatus(204);
    } catch (error) {
        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});
