import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { isActiveSessionError, sendActiveSessionRequired } from '../active-session-store.js';
import { parse } from '../character-card-parser.js';
import { assertSafeFileName, resolvePathUnderParent } from '../path-security.js';
import {
    applyRecommendedChatSetup,
    getRecommendedChatSetupManagement,
    getRecommendedChatSetupSummary,
    preflightRecommendedChatSetup,
    RecommendedChatSetupError,
    saveRecommendedChatSetup,
} from '../recommended-chat-setup.js';

export const router = express.Router();

async function readCharacterCard(request) {
    const avatar = assertSafeFileName(request.body?.avatar_url, 'avatar');
    const filePath = resolvePathUnderParent(request.user.directories.characters, avatar, 'avatar');
    if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== '.png') {
        throw new RecommendedChatSetupError('RecommendedSetupCharacterNotFound', 'Character not found.', 404);
    }
    return JSON.parse(await parse(filePath, 'png'));
}

function sendError(response, error) {
    if (isActiveSessionError(error)) {
        return sendActiveSessionRequired(response);
    }
    if (Number.isInteger(error?.status)) {
        return response.status(error.status).send({ error: { type: error.type || error.name, message: error.message } });
    }
    console.error('[Recommended Chat Setup] Unexpected error');
    return response.status(500).send({ error: { type: 'RecommendedSetupInternalError', message: 'Recommended Chat Setup failed.' } });
}

router.post('/manage/get', async (request, response) => {
    try {
        return response.send(getRecommendedChatSetupManagement(request.user, await readCharacterCard(request)));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/manage/save', async (request, response) => {
    try {
        await request.activeSessionOperation?.assertAllowed();
        return response.send(await saveRecommendedChatSetup(request.user, await readCharacterCard(request), request.body));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/summary', async (request, response) => {
    try {
        return response.send(getRecommendedChatSetupSummary(await readCharacterCard(request)));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/preflight', async (request, response) => {
    try {
        return response.send(preflightRecommendedChatSetup(request.user, await readCharacterCard(request), request.body?.lorebookName));
    } catch (error) {
        return sendError(response, error);
    }
});

router.post('/apply', async (request, response) => {
    try {
        await request.activeSessionOperation?.assertAllowed();
        return response.send(await applyRecommendedChatSetup(request.user, await readCharacterCard(request), request.body));
    } catch (error) {
        return sendError(response, error);
    }
});
