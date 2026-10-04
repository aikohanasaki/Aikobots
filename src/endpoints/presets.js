import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getDefaultPresetFile, getDefaultPresets } from './content-manager.js';
import { requireAdminMiddleware } from '../users.js';
import { processPresetUpdate } from '../admin-preset-updates.js';
import { withSettingsPersonasLock } from '../settings-lock.js';
import { isActiveSessionError, sendActiveSessionRequired } from '../active-session-store.js';

/**
 * Gets the folder and extension for the preset settings based on the API source ID.
 * @param {string} apiId API source ID
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {{folder: string?, extension: string?}} Object containing the folder and extension for the preset settings
 */
function getPresetSettingsByAPI(apiId, directories) {
    switch (apiId) {
        case 'openai':
            return { folder: directories.openAI_Settings, extension: '.json' };
        case 'reasoning':
            return { folder: directories.reasoning, extension: '.json' };
        default:
            return { folder: null, extension: null };
    }
}

export const router = express.Router();

/** Keep mutation failures generic: preset content must never enter error responses or logs. */
function presetMutation(handler) {
    return async (request, response) => {
        try {
            return await handler(request, response);
        } catch (error) {
            if (isActiveSessionError(error)) return sendActiveSessionRequired(response);
            return response.sendStatus(error.status || 500);
        }
    };
}

for (const action of ['publish', 'accept', 'skip']) {
    const middleware = action === 'publish' ? [requireAdminMiddleware] : [];
    router.post(`/admin-update/${action}`, ...middleware, presetMutation(async (request, response) => {
        const result = await processPresetUpdate(action, request.user.directories, request.body, {
            assertAllowed: () => request.activeSessionOperation?.assertAllowed(),
        });
        return response.json(result);
    }));
}

router.post('/save', presetMutation(async function (request, response) {
    const name = sanitize(request.body.name);
    if (!request.body.preset || !name) {
        return response.sendStatus(400);
    }

    const settings = getPresetSettingsByAPI(request.body.apiId, request.user.directories);
    const filename = name + settings.extension;

    if (!settings.folder) {
        return response.sendStatus(400);
    }

    const fullpath = path.join(settings.folder, filename);
    await withSettingsPersonasLock(request.user.directories, async lock => {
        await request.activeSessionOperation?.assertAllowed();
        await lock.run(() => writeFileAtomicSync(fullpath, JSON.stringify(request.body.preset, null, 4), 'utf-8'));
    });
    return response.send({ name });
}));

router.post('/delete', presetMutation(async function (request, response) {
    const name = sanitize(request.body.name);
    if (!name) {
        return response.sendStatus(400);
    }

    const settings = getPresetSettingsByAPI(request.body.apiId, request.user.directories);
    const filename = name + settings.extension;

    if (!settings.folder) {
        return response.sendStatus(400);
    }

    const fullpath = path.join(settings.folder, filename);

    return withSettingsPersonasLock(request.user.directories, async lock => {
        await request.activeSessionOperation?.assertAllowed();
        if (!fs.existsSync(fullpath)) return response.sendStatus(404);
        await lock.run(() => fs.unlinkSync(fullpath));
        return response.sendStatus(200);
    });
}));

router.post('/restore', function (request, response) {
    try {
        const name = sanitize(request.body.name);
        if (!name) {
            return response.sendStatus(400);
        }

        const settings = getPresetSettingsByAPI(request.body.apiId, request.user.directories);
        if (!settings.folder) {
            return response.sendStatus(400);
        }

        const defaultPresets = getDefaultPresets(request.user.directories);

        const defaultPreset = defaultPresets.find(p => p.name === name && p.folder === settings.folder);

        const result = { isDefault: false, preset: {} };

        if (defaultPreset) {
            result.isDefault = true;
            result.preset = getDefaultPresetFile(defaultPreset.filename) || {};
        }

        return response.send(result);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
