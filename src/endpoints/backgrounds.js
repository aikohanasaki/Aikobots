import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';

import { dimensions, invalidateThumbnail } from './thumbnails.js';
import { getImages } from '../util.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';
import { assertPathUnderParent, assertSafeFileName, PathSecurityError, resolvePathUnderParent } from '../path-security.js';

export const router = express.Router();
const ALLOWED_BACKGROUND_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function resolveBackgroundPath(backgroundsDirectory, name) {
    const fileName = assertSafeFileName(name, 'background');
    if (sanitize(fileName) !== fileName) {
        throw new PathSecurityError('Invalid background name.');
    }

    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_BACKGROUND_EXTENSIONS.has(extension)) {
        throw new PathSecurityError('Invalid background extension.');
    }

    return resolvePathUnderParent(backgroundsDirectory, fileName, 'background');
}

router.post('/all', function (request, response) {
    const images = getImages(request.user.directories.backgrounds);
    const config = { width: dimensions.bg[0], height: dimensions.bg[1] };
    response.json({ images, config });
});

router.post('/delete', getFileNameValidationFunction('bg'), function (request, response) {
    if (!request.body) return response.sendStatus(400);

    if (request.body.bg !== sanitize(request.body.bg)) {
        console.error('Malicious bg name prevented');
        return response.sendStatus(403);
    }

    let fileName;
    try {
        fileName = resolveBackgroundPath(request.user.directories.backgrounds, request.body.bg);
    } catch (error) {
        console.error('Invalid BG delete path prevented', error);
        return response.sendStatus(400);
    }

    if (!fs.existsSync(fileName)) {
        console.error('BG file not found');
        return response.sendStatus(400);
    }

    fs.unlinkSync(fileName);
    invalidateThumbnail(request.user.directories, 'bg', request.body.bg);
    return response.send('ok');
});

router.post('/rename', function (request, response) {
    if (!request.body) return response.sendStatus(400);

    let oldFileName;
    let newFileName;
    try {
        oldFileName = resolveBackgroundPath(request.user.directories.backgrounds, request.body.old_bg);
        newFileName = resolveBackgroundPath(request.user.directories.backgrounds, request.body.new_bg);
    } catch (error) {
        console.error('Invalid BG rename path prevented', error);
        return response.sendStatus(400);
    }

    if (!fs.existsSync(oldFileName)) {
        console.error('BG file not found');
        return response.sendStatus(400);
    }

    if (fs.existsSync(newFileName)) {
        console.error('New BG file already exists');
        return response.sendStatus(400);
    }

    fs.copyFileSync(oldFileName, newFileName);
    fs.unlinkSync(oldFileName);
    invalidateThumbnail(request.user.directories, 'bg', request.body.old_bg);
    return response.send('ok');
});

router.post('/upload', function (request, response) {
    if (!request.body || !request.file) return response.sendStatus(400);

    const rawUploadPath = request.file?.path || path.join(request.file.destination, request.file.filename);
    let img_path = null;
    try {
        img_path = assertPathUnderParent(request.file.destination, rawUploadPath, 'upload');
        const filename = assertSafeFileName(request.file.originalname, 'background');
        const destinationPath = resolveBackgroundPath(request.user.directories.backgrounds, filename);

        fs.copyFileSync(img_path, destinationPath);
        invalidateThumbnail(request.user.directories, 'bg', filename);
        response.send(filename);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            console.error('Invalid BG upload path prevented', err);
            return response.sendStatus(400);
        }
        console.error(err);
        response.sendStatus(500);
    } finally {
        const cleanupPath = img_path || rawUploadPath;
        if (cleanupPath) {
            try {
                fs.rmSync(cleanupPath, { force: true });
            } catch (error) {
                console.warn('Failed to remove temporary background upload', error);
            }
        }
    }
});
