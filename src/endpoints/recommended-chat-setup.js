import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { isActiveSessionError, sendActiveSessionRequired } from '../active-session-store.js';
import { parse, write } from '../character-card-parser.js';
import { withDirectoryLock } from '../file-system-lock.js';
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
const CHARACTER_LOCK_OPTIONS = Object.freeze({
    retryMs: 50,
    timeoutMs: 30_000,
    staleMs: 120_000,
    heartbeatMs: 10_000,
});

async function readCharacterCardRecord(request) {
    const avatar = assertSafeFileName(request.body?.avatar_url, 'avatar');
    const filePath = resolvePathUnderParent(request.user.directories.characters, avatar, 'avatar');
    if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== '.png') {
        throw new RecommendedChatSetupError('RecommendedSetupCharacterNotFound', 'Character not found.', 404);
    }
    return {
        card: JSON.parse(await parse(filePath, 'png')),
        filePath,
        rawBuffer: fs.readFileSync(filePath),
    };
}

async function readCharacterCard(request) {
    return (await readCharacterCardRecord(request)).card;
}

async function ensureRecommendedSetupKey(record) {
    return await withDirectoryLock({
        lockPath: `${record.filePath}.recommended-setup.lock`,
        ...CHARACTER_LOCK_OPTIONS,
        timeoutMessage: 'Timed out waiting to configure Recommended Chat Setup.',
    }, async () => {
        record.rawBuffer = fs.readFileSync(record.filePath);
        record.card = JSON.parse(await parse(record.filePath, 'png'));
        record.card.data ??= {};
        record.card.data.extensions ??= {};
        record.card.data.extensions.aikobots ??= {};
        const aikobots = record.card.data.extensions.aikobots;
        if (!String(aikobots.recommended_chat_setup_key || '').trim()) {
            aikobots.recommended_chat_setup_key = `recommended-${randomUUID()}`;
            writeFileAtomicSync(record.filePath, write(record.rawBuffer, JSON.stringify(record.card)));
        }
        return String(aikobots.recommended_chat_setup_key);
    });
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
        const record = await readCharacterCardRecord(request);
        getRecommendedChatSetupManagement(request.user, record.card);
        await ensureRecommendedSetupKey(record);
        return response.send(await saveRecommendedChatSetup(request.user, record.card, request.body));
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
