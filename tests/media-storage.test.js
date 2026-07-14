import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
    detectSupportedImageMimeType,
    ingestImageBuffer,
    registerExistingImageUrl,
} from '../src/media-storage.js';

const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from('png body'),
]);
const GIF_BYTES = Buffer.from('GIF89a image body', 'ascii');
const HTML_BYTES = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
const tempRoots = [];

async function createUserDirectories() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'st-media-storage-'));
    const userImages = path.join(root, 'user-images');
    tempRoots.push(root);
    await fs.promises.mkdir(userImages, { recursive: true });
    return { root, userImages };
}

afterEach(async () => {
    while (tempRoots.length > 0) {
        await fs.promises.rm(tempRoots.pop(), { recursive: true, force: true });
    }
});

describe('media storage image MIME validation', () => {
    it('detects supported image MIME types from bytes', () => {
        expect(detectSupportedImageMimeType(PNG_BYTES)).toBe('image/png');
        expect(detectSupportedImageMimeType(GIF_BYTES)).toBe('image/gif');
        expect(detectSupportedImageMimeType(HTML_BYTES)).toBe('');
    });

    it('stores the detected upload MIME type instead of the client-supplied value', async () => {
        const directories = await createUserDirectories();
        const record = await ingestImageBuffer(directories, GIF_BYTES, 'text/html', 'spoof.html');

        expect(record.mimeType).toBe('image/gif');
        expect(record.relativePath.endsWith('.gif')).toBe(true);
    });

    it('rejects uploaded active content even when the client claims it is an image', async () => {
        const directories = await createUserDirectories();

        await expect(ingestImageBuffer(directories, HTML_BYTES, 'image/png', 'spoof.png'))
            .rejects.toThrow('Unsupported image MIME type');
    });

    it('registers existing images by detected bytes instead of extension', async () => {
        const directories = await createUserDirectories();
        const imagePath = path.join(directories.userImages, 'spoof.png');
        await fs.promises.writeFile(imagePath, GIF_BYTES);

        const record = await registerExistingImageUrl(directories, path.relative(directories.root, imagePath));

        expect(record.mimeType).toBe('image/gif');
    });

    it('rejects existing active content even when the extension looks like an image', async () => {
        const directories = await createUserDirectories();
        const imagePath = path.join(directories.userImages, 'spoof.png');
        await fs.promises.writeFile(imagePath, HTML_BYTES);

        await expect(registerExistingImageUrl(directories, path.relative(directories.root, imagePath)))
            .rejects.toThrow('Existing file is not a supported image');
    });
});
