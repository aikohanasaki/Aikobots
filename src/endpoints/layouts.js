import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { parse as parseCss } from '@adobe/css-tools';
import express from 'express';
import mime from 'mime-types';
import sanitize from 'sanitize-filename';

import { Jimp, JimpMime } from '../jimp.js';
import { detectSupportedImageMimeType } from '../media-storage.js';
import { assertPathUnderParent, assertSafeFileName, resolvePathUnderParent } from '../path-security.js';

export const router = express.Router();

const CSS_FILE_MAX_BYTES = 5 * 1024 * 1024;
const CSS_FILE_MAX_COUNT = 25;
const IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_COUNT = 50;
const IMAGE_MAX_DIMENSION = 4096;
const LAYOUT_FILE_NAME_MAX_LENGTH = 120;
const LAYOUT_ASSET_ROUTE_PREFIX = '/api/layouts/assets/file/';
const ALLOWED_CSS_EXTENSIONS = new Set(['.css']);
const ALLOWED_STORED_IMAGE_EXTENSIONS = new Set(['.png']);
const ALLOWED_SOURCE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SAFE_LAYOUT_FILE_NAME = /^[A-Za-z0-9 _.-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const NON_CSS_MARKER_PATTERN = /<\s*(?:!doctype|html|head|body|script|style|meta|link)\b/i;
const DANGEROUS_URL_SCHEME_PATTERN = /(?:javascript|data|file|blob|ftp):|\/\/|https?:/i;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*))\s*\)/gi;
const URL_LIKE_TOKEN_PATTERN = /(?:["'(])((?:(?:https?:|javascript:|data:|file:|blob:|ftp:|\/\/)[^"'()\s;{}]+))/gi;

class LayoutValidationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'LayoutValidationError';
        this.status = status;
    }
}

function ensureDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function sendError(response, error, fallbackMessage) {
    const status = Number(error?.status) || 500;
    const message = status >= 500 ? fallbackMessage : error.message;
    if (status >= 500) {
        console.error(error);
    }
    return response.status(status).json({ error: message });
}

function assertSafeLayoutFileName(value, allowedExtensions, fieldName) {
    const fileName = assertSafeFileName(value, fieldName);
    if (!fileName || fileName.length > LAYOUT_FILE_NAME_MAX_LENGTH) {
        throw new LayoutValidationError(`Invalid ${fieldName}.`);
    }
    if (fileName.startsWith('.') || CONTROL_CHARACTER_PATTERN.test(fileName)) {
        throw new LayoutValidationError(`Invalid ${fieldName}.`);
    }
    if (!SAFE_LAYOUT_FILE_NAME.test(fileName)) {
        throw new LayoutValidationError(`Invalid ${fieldName}.`);
    }
    if (sanitize(fileName) !== fileName) {
        throw new LayoutValidationError(`Invalid ${fieldName}.`);
    }
    const extension = path.extname(fileName).toLowerCase();
    if (!allowedExtensions.has(extension)) {
        throw new LayoutValidationError(`Invalid ${fieldName} extension.`);
    }
    return fileName;
}

function resolveLayoutFilePath(directory, filename, allowedExtensions, fieldName) {
    const safeName = assertSafeLayoutFileName(filename, allowedExtensions, fieldName);
    return resolvePathUnderParent(directory, safeName, fieldName);
}

function isRegularFlatFile(directory, entry, allowedExtensions) {
    if (!entry.isFile() || entry.name.startsWith('.')) {
        return false;
    }
    try {
        assertSafeLayoutFileName(entry.name, allowedExtensions, 'layout file');
        const fullPath = resolveLayoutFilePath(directory, entry.name, allowedExtensions, 'layout file');
        const stats = fs.lstatSync(fullPath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function getDisplayName(filename) {
    return path.parse(filename).name
        .replace(/[_.-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || filename;
}

function encodeRouteFilename(filename) {
    return encodeURIComponent(filename).replaceAll('%20', '%20');
}

function getLayoutRecord(directory, filename) {
    const filePath = resolveLayoutFilePath(directory, filename, ALLOWED_CSS_EXTENSIONS, 'layout');
    const stats = fs.statSync(filePath);
    return {
        id: `custom:${filename}`,
        name: getDisplayName(filename),
        filename,
        css: `/api/layouts/file/${encodeRouteFilename(filename)}?v=${Math.trunc(stats.mtimeMs)}`,
        custom: true,
    };
}

function listLayoutFiles(directory) {
    ensureDirectory(directory);
    return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => isRegularFlatFile(directory, entry, ALLOWED_CSS_EXTENSIONS))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

function extractCssUrlToken(rawValue) {
    const value = String(rawValue || '').trim();
    const match = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)$/i.exec(value);
    if (!match) {
        throw new LayoutValidationError('Only url(...) Google Fonts imports are allowed.');
    }
    return match[1] ?? match[2] ?? match[3] ?? '';
}

function isAllowedGoogleFontsImport(rawUrl) {
    if (!rawUrl || rawUrl.startsWith('//')) {
        return false;
    }
    try {
        const url = new URL(rawUrl);
        return url.origin === 'https://fonts.googleapis.com'
            && (url.pathname === '/css' || url.pathname === '/css2');
    } catch {
        return false;
    }
}

function isAllowedLayoutAssetUrl(rawUrl) {
    if (!rawUrl || DANGEROUS_URL_SCHEME_PATTERN.test(rawUrl)) {
        return false;
    }
    let parsed;
    try {
        parsed = new URL(rawUrl, 'http://aikobots.local');
    } catch {
        return false;
    }
    if (parsed.origin !== 'http://aikobots.local' || !parsed.pathname.startsWith(LAYOUT_ASSET_ROUTE_PREFIX)) {
        return false;
    }
    const encodedFileName = parsed.pathname.slice(LAYOUT_ASSET_ROUTE_PREFIX.length);
    if (!encodedFileName || encodedFileName.includes('/')) {
        return false;
    }
    try {
        assertSafeLayoutFileName(decodeURIComponent(encodedFileName), ALLOWED_STORED_IMAGE_EXTENSIONS, 'layout image asset');
        return true;
    } catch {
        return false;
    }
}

function traverseCssAst(node, visitor) {
    if (!node || typeof node !== 'object') {
        return;
    }
    visitor(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            value.forEach(child => traverseCssAst(child, visitor));
        } else if (value && typeof value === 'object' && !('line' in value && 'column' in value)) {
            traverseCssAst(value, visitor);
        }
    }
}

function validateCssContent(cssText) {
    if (!cssText || CONTROL_CHARACTER_PATTERN.test(cssText)) {
        throw new LayoutValidationError('Invalid CSS content.');
    }
    if (NON_CSS_MARKER_PATTERN.test(cssText)) {
        throw new LayoutValidationError('Uploaded file does not look like CSS.');
    }

    let ast;
    try {
        ast = parseCss(cssText, { silent: false });
    } catch (error) {
        throw new LayoutValidationError(`Invalid CSS: ${error.message}`);
    }

    const allowedImportUrls = new Set();
    traverseCssAst(ast, node => {
        if (node.type !== 'import') {
            return;
        }
        const importUrl = extractCssUrlToken(node.import);
        if (!isAllowedGoogleFontsImport(importUrl)) {
            throw new LayoutValidationError('Only Google Fonts stylesheet imports from https://fonts.googleapis.com/css or /css2 are allowed.');
        }
        allowedImportUrls.add(importUrl);
    });

    for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
        const rawUrl = String(match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (allowedImportUrls.has(rawUrl)) {
            continue;
        }
        if (!isAllowedLayoutAssetUrl(rawUrl)) {
            throw new LayoutValidationError('CSS url(...) references may only point to this user\'s layout image assets.');
        }
    }

    for (const match of cssText.matchAll(URL_LIKE_TOKEN_PATTERN)) {
        const rawUrl = String(match[1] || '').trim();
        if (!allowedImportUrls.has(rawUrl)) {
            throw new LayoutValidationError('Remote URLs are not allowed in uploaded layout CSS.');
        }
    }
}

function getUploadTempPath(request) {
    if (!request.file) {
        throw new LayoutValidationError('No file uploaded.');
    }
    const rawUploadPath = request.file.path || path.join(request.file.destination, request.file.filename);
    return assertPathUnderParent(request.file.destination, rawUploadPath, 'upload');
}

function validateUploadSize(request, maxBytes, label) {
    const size = Number(request.file?.size || 0);
    if (!Number.isFinite(size) || size <= 0) {
        throw new LayoutValidationError(`Empty ${label} upload.`);
    }
    if (size > maxBytes) {
        throw new LayoutValidationError(`${label} upload is too large.`);
    }
}

async function getLayoutAssetRecord(directory, filename) {
    const filePath = resolveLayoutFilePath(directory, filename, ALLOWED_STORED_IMAGE_EXTENSIONS, 'layout image asset');
    const stats = fs.statSync(filePath);
    const image = await Jimp.read(filePath);
    const mimeType = mime.lookup(filePath) || 'image/png';
    return {
        filename,
        name: getDisplayName(filename),
        url: `/api/layouts/assets/file/${encodeRouteFilename(filename)}?v=${Math.trunc(stats.mtimeMs)}`,
        size: stats.size,
        width: image.bitmap.width,
        height: image.bitmap.height,
        mimeType,
    };
}

function listLayoutAssetFiles(directory) {
    ensureDirectory(directory);
    return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => isRegularFlatFile(directory, entry, ALLOWED_STORED_IMAGE_EXTENSIONS))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

function getLayoutAssetStorageStats(directory) {
    const files = listLayoutAssetFiles(directory);
    const totalBytes = files.reduce((total, filename) => {
        const filePath = resolveLayoutFilePath(directory, filename, ALLOWED_STORED_IMAGE_EXTENSIONS, 'layout image asset');
        return total + fs.statSync(filePath).size;
    }, 0);
    return { files, totalBytes };
}

function hasPngAnimationChunks(buffer) {
    return buffer.includes(Buffer.from('acTL', 'ascii')) || buffer.includes(Buffer.from('fcTL', 'ascii'));
}

function hasWebpAnimationChunks(buffer) {
    return buffer.includes(Buffer.from('ANIM', 'ascii')) || buffer.includes(Buffer.from('ANMF', 'ascii'));
}

function assertStaticRasterImage(buffer) {
    const mimeType = detectSupportedImageMimeType(buffer);
    if (!ALLOWED_SOURCE_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new LayoutValidationError('Only static PNG, JPEG, and WebP layout images are allowed.');
    }
    if (mimeType === 'image/png' && hasPngAnimationChunks(buffer)) {
        throw new LayoutValidationError('Animated PNG layout images are not allowed.');
    }
    if (mimeType === 'image/webp' && hasWebpAnimationChunks(buffer)) {
        throw new LayoutValidationError('Animated WebP layout images are not allowed.');
    }
    return mimeType;
}

function makeUniqueAssetFilename(directory, originalFilename) {
    // Layout image uploads intentionally generate a new server-side PNG filename.
    // This avoids trusting browser-provided names and avoids cross-upload overwrite ambiguity.
    const safeOriginal = assertSafeLayoutFileName(originalFilename, new Set(['.png', '.jpg', '.jpeg', '.webp']), 'layout image filename');
    const safeBase = path.parse(safeOriginal).name
        .replace(/[^A-Za-z0-9 _.-]/g, '')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 80) || 'layout-asset';
    for (let index = 0; index < 1000; index++) {
        const suffix = index === 0 ? '' : `-${index}`;
        const filename = `${safeBase}-${randomUUID()}${suffix}.png`;
        const filePath = resolveLayoutFilePath(directory, filename, ALLOWED_STORED_IMAGE_EXTENSIONS, 'layout image asset');
        if (!fs.existsSync(filePath)) {
            return filename;
        }
    }
    throw new LayoutValidationError('Unable to create a unique layout image filename.');
}

function sendPrivateFlatFile(response, directory, filename, allowedExtensions, contentType) {
    const safeName = assertSafeLayoutFileName(filename, allowedExtensions, 'layout file');
    const filePath = resolveLayoutFilePath(directory, safeName, allowedExtensions, 'layout file');
    let stats;
    try {
        stats = fs.lstatSync(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new LayoutValidationError('Layout file not found.', 404);
        }
        throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new LayoutValidationError('Layout file not found.', 404);
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', contentType || mime.lookup(filePath) || 'application/octet-stream');
    return response.sendFile(safeName, { root: directory });
}

router.get('/file/:filename', (request, response) => {
    try {
        return sendPrivateFlatFile(response, request.user.directories.layouts, request.params.filename, ALLOWED_CSS_EXTENSIONS, 'text/css; charset=utf-8');
    } catch (error) {
        return sendError(response, error, 'Failed to serve layout CSS.');
    }
});

router.get('/assets/file/:filename', (request, response) => {
    try {
        return sendPrivateFlatFile(response, request.user.directories.layoutAssets, request.params.filename, ALLOWED_STORED_IMAGE_EXTENSIONS, 'image/png');
    } catch (error) {
        return sendError(response, error, 'Failed to serve layout image asset.');
    }
});

router.post('/list', (request, response) => {
    try {
        const directory = request.user.directories.layouts;
        const records = listLayoutFiles(directory).map(filename => getLayoutRecord(directory, filename));
        return response.json({ layouts: records });
    } catch (error) {
        return sendError(response, error, 'Failed to list custom layouts.');
    }
});

router.post('/upload', (request, response) => {
    let tempPath = null;
    try {
        validateUploadSize(request, CSS_FILE_MAX_BYTES, 'CSS');
        tempPath = getUploadTempPath(request);
        const originalFilename = assertSafeLayoutFileName(request.file.originalname, ALLOWED_CSS_EXTENSIONS, 'layout CSS filename');
        const directory = request.user.directories.layouts;
        ensureDirectory(directory);

        const existingFiles = listLayoutFiles(directory);
        if (!existingFiles.includes(originalFilename) && existingFiles.length >= CSS_FILE_MAX_COUNT) {
            throw new LayoutValidationError(`Maximum custom layout CSS file count is ${CSS_FILE_MAX_COUNT}.`);
        }

        const cssText = fs.readFileSync(tempPath, 'utf8');
        validateCssContent(cssText);
        const destinationPath = resolveLayoutFilePath(directory, originalFilename, ALLOWED_CSS_EXTENSIONS, 'layout CSS filename');
        fs.copyFileSync(tempPath, destinationPath);
        return response.json({ layout: getLayoutRecord(directory, originalFilename) });
    } catch (error) {
        return sendError(response, error, 'Failed to upload layout CSS.');
    } finally {
        if (tempPath) {
            try {
                fs.rmSync(tempPath, { force: true });
            } catch (cleanupError) {
                console.warn('Failed to remove temporary layout CSS upload', cleanupError);
            }
        }
    }
});

router.post('/assets/list', async (request, response) => {
    try {
        const directory = request.user.directories.layoutAssets;
        const files = listLayoutAssetFiles(directory);
        const assets = await Promise.all(files.map(filename => getLayoutAssetRecord(directory, filename)));
        return response.json({ assets });
    } catch (error) {
        return sendError(response, error, 'Failed to list layout image assets.');
    }
});

router.post('/assets/upload', async (request, response) => {
    let tempPath = null;
    try {
        validateUploadSize(request, IMAGE_SOURCE_MAX_BYTES, 'Image');
        tempPath = getUploadTempPath(request);
        const directory = request.user.directories.layoutAssets;
        ensureDirectory(directory);

        const storageStats = getLayoutAssetStorageStats(directory);
        if (storageStats.files.length >= IMAGE_MAX_COUNT) {
            throw new LayoutValidationError(`Maximum layout image asset count is ${IMAGE_MAX_COUNT}.`);
        }

        const sourceBuffer = fs.readFileSync(tempPath);
        assertStaticRasterImage(sourceBuffer);
        const image = await Jimp.read(sourceBuffer);
        if (image.bitmap.width > IMAGE_MAX_DIMENSION || image.bitmap.height > IMAGE_MAX_DIMENSION) {
            throw new LayoutValidationError(`Layout images must be ${IMAGE_MAX_DIMENSION}x${IMAGE_MAX_DIMENSION} or smaller.`);
        }

        const outputBuffer = await image.getBuffer(JimpMime.png);
        if (outputBuffer.length > IMAGE_OUTPUT_MAX_BYTES) {
            throw new LayoutValidationError('Processed layout image is too large.');
        }
        if (storageStats.totalBytes + outputBuffer.length > IMAGE_TOTAL_MAX_BYTES) {
            throw new LayoutValidationError('Layout image asset storage limit exceeded.');
        }

        const filename = makeUniqueAssetFilename(directory, request.file.originalname);
        const destinationPath = resolveLayoutFilePath(directory, filename, ALLOWED_STORED_IMAGE_EXTENSIONS, 'layout image asset');
        fs.writeFileSync(destinationPath, outputBuffer);
        return response.json({ asset: await getLayoutAssetRecord(directory, filename) });
    } catch (error) {
        return sendError(response, error, 'Failed to upload layout image asset.');
    } finally {
        if (tempPath) {
            try {
                fs.rmSync(tempPath, { force: true });
            } catch (cleanupError) {
                console.warn('Failed to remove temporary layout image upload', cleanupError);
            }
        }
    }
});
