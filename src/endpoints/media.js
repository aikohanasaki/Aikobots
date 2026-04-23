import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import express from 'express';

import {
    deleteStoredMedia,
    detectSupportedImageMimeTypeFromFile,
    getStoredMediaContentUrl,
    getStoredMediaRecord,
    ingestImageBuffer,
    registerExistingImageUrl,
    resolveStoredMediaPath,
} from '../media-storage.js';

export const router = express.Router();

router.post('/ingest-image', async (request, response) => {
    try {
        const data = String(request.body?.data || '');
        const mimeType = String(request.body?.mimeType || '');
        const filename = String(request.body?.filename || '');
        const sourceUrl = String(request.body?.sourceUrl || '');

        if (!data) {
            return response.status(400).send({ error: 'No image data provided' });
        }

        const record = await ingestImageBuffer(
            request.user.directories,
            Buffer.from(data, 'base64'),
            mimeType,
            filename,
            sourceUrl,
        );

        return response.send({
            mediaId: record.mediaId,
            mimeType: record.mimeType,
            contentUrl: getStoredMediaContentUrl(request.user.directories, record),
        });
    } catch (error) {
        console.error('Failed to ingest image media', error);
        return response.status(400).send({ error: error?.message || 'Failed to ingest image media' });
    }
});

router.post('/register-existing-image', async (request, response) => {
    try {
        const url = String(request.body?.url || '');
        if (!url) {
            return response.status(400).send({ error: 'No image URL provided' });
        }

        const record = await registerExistingImageUrl(request.user.directories, url);
        return response.send({
            mediaId: record.mediaId,
            mimeType: record.mimeType,
            contentUrl: getStoredMediaContentUrl(request.user.directories, record),
        });
    } catch (error) {
        console.error('Failed to register existing image media', error);
        return response.status(400).send({ error: error?.message || 'Failed to register existing image media' });
    }
});

router.get('/:mediaId/content', async (request, response) => {
    try {
        const record = await getStoredMediaRecord(request.user.directories, request.params.mediaId);
        if (!record) {
            return response.sendStatus(404);
        }

        const absolutePath = resolveStoredMediaPath(request.user.directories, record);
        if (!fs.existsSync(absolutePath)) {
            return response.sendStatus(404);
        }

        const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
        if (!mimeType) {
            return response.sendStatus(415);
        }

        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Type', mimeType);
        await pipeline(fs.createReadStream(absolutePath), response);
        return;
    } catch (error) {
        console.error('Failed to stream media content', error);
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        return response.sendStatus(500);
    }
});

router.post('/delete', async (request, response) => {
    try {
        const mediaId = String(request.body?.mediaId || '');
        if (!mediaId) {
            return response.status(400).send('No mediaId specified');
        }

        const deleted = await deleteStoredMedia(request.user.directories, mediaId);
        if (!deleted) {
            return response.status(404).send('Media not found');
        }

        return response.sendStatus(200);
    } catch (error) {
        console.error('Failed to delete stored media', error);
        return response.sendStatus(500);
    }
});
