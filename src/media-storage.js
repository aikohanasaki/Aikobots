import fs from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import { clientRelativePath, isPathUnderParent, uuidv4 } from './util.js';

const MEDIA_INDEX_FILE = '.media-index.json';
const MEDIA_FOLDER = 'media';

/**
 * @typedef {object} StoredMediaRecord
 * @property {string} mediaId
 * @property {string} relativePath
 * @property {string} mimeType
 * @property {number} byteLength
 * @property {number} createdAt
 * @property {string} originalFilename
 * @property {boolean} [managed]
 * @property {string} [sourceUrl]
 */

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {string}
 */
function getMediaIndexPath(directories) {
    return path.join(directories.userImages, MEDIA_INDEX_FILE);
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {string}
 */
function getMediaRootPath(directories) {
    return path.join(directories.userImages, MEDIA_FOLDER);
}

/**
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isSupportedImageMimeType(mimeType) {
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    const extension = mime.extension(normalizedMimeType);
    return normalizedMimeType.startsWith('image/') && typeof extension === 'string' && extension.length > 0;
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {Promise<Record<string, StoredMediaRecord>>}
 */
export async function readMediaIndex(directories) {
    const indexPath = getMediaIndexPath(directories);

    try {
        const indexText = await fs.promises.readFile(indexPath, 'utf8');
        const parsed = JSON.parse(indexText);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {};
        }

        console.error('Failed to read media index', error);
        return {};
    }
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {Record<string, StoredMediaRecord>} index
 * @returns {Promise<void>}
 */
export async function writeMediaIndex(directories, index) {
    const indexPath = getMediaIndexPath(directories);
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {StoredMediaRecord} record
 * @returns {StoredMediaRecord}
 */
export function normalizeStoredMediaRecord(directories, record) {
    const mediaRootRelativePath = clientRelativePath(directories.root, getMediaRootPath(directories));
    const relativePath = String(record.relativePath || '');
    const managed = typeof record.managed === 'boolean'
        ? record.managed
        : relativePath === mediaRootRelativePath || relativePath.startsWith(`${mediaRootRelativePath}/`) || relativePath.startsWith(`${mediaRootRelativePath}\\`);

    return {
        mediaId: String(record.mediaId || ''),
        relativePath,
        mimeType: String(record.mimeType || '').toLowerCase(),
        byteLength: Number(record.byteLength || 0),
        createdAt: Number(record.createdAt || Date.now()),
        originalFilename: String(record.originalFilename || ''),
        managed,
        ...(record.sourceUrl ? { sourceUrl: String(record.sourceUrl) } : {}),
    };
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {StoredMediaRecord} record
 * @returns {string}
 */
export function resolveStoredMediaPath(directories, record) {
    return path.join(directories.root, record.relativePath);
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {StoredMediaRecord} record
 * @returns {string}
 */
export function getStoredMediaContentUrl(_directories, record) {
    return `/api/media/${encodeURIComponent(record.mediaId)}/content`;
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {string} mediaId
 * @returns {Promise<StoredMediaRecord | null>}
 */
export async function getStoredMediaRecord(directories, mediaId) {
    const index = await readMediaIndex(directories);
    const record = index[String(mediaId || '')];
    return record ? normalizeStoredMediaRecord(directories, record) : null;
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [originalFilename]
 * @param {string} [sourceUrl]
 * @returns {Promise<StoredMediaRecord>}
 */
export async function ingestImageBuffer(directories, buffer, mimeType, originalFilename = '', sourceUrl = '') {
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    if (!isSupportedImageMimeType(normalizedMimeType)) {
        throw new Error('Unsupported image MIME type');
    }

    const mediaId = uuidv4();
    const extension = String(mime.extension(normalizedMimeType) || 'bin');
    const mediaDirectory = getMediaRootPath(directories);
    const fileName = `${mediaId}.${extension}`;
    const absolutePath = path.join(mediaDirectory, fileName);

    await fs.promises.mkdir(mediaDirectory, { recursive: true });
    await fs.promises.writeFile(absolutePath, buffer);

    const record = normalizeStoredMediaRecord(directories, {
        mediaId,
        relativePath: clientRelativePath(directories.root, absolutePath),
        mimeType: normalizedMimeType,
        byteLength: buffer.length,
        createdAt: Date.now(),
        originalFilename: String(originalFilename || fileName),
        managed: true,
        ...(sourceUrl ? { sourceUrl: String(sourceUrl) } : {}),
    });

    const index = await readMediaIndex(directories);
    index[record.mediaId] = record;
    await writeMediaIndex(directories, index);
    return record;
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {string} url
 * @returns {Promise<StoredMediaRecord>}
 */
export async function registerExistingImageUrl(directories, url) {
    const relativeUrl = String(url || '');
    if (!relativeUrl) {
        throw new Error('No image URL provided');
    }

    const absolutePath = path.join(directories.root, relativeUrl);
    if (!isPathUnderParent(directories.userImages, absolutePath)) {
        throw new Error('Image URL is outside the internal image store');
    }

    const stats = await fs.promises.stat(absolutePath);
    if (!stats.isFile()) {
        throw new Error('Image URL does not point to a file');
    }

    const mimeType = String(mime.lookup(absolutePath) || '').toLowerCase();
    if (!isSupportedImageMimeType(mimeType)) {
        throw new Error('Existing file is not a supported image');
    }

    const normalizedRelativePath = clientRelativePath(directories.root, absolutePath);
    const index = await readMediaIndex(directories);
    const existingRecord = Object.values(index).find(record => String(record.relativePath || '') === normalizedRelativePath);
    if (existingRecord) {
        return normalizeStoredMediaRecord(directories, existingRecord);
    }

    const record = normalizeStoredMediaRecord(directories, {
        mediaId: uuidv4(),
        relativePath: normalizedRelativePath,
        mimeType,
        byteLength: stats.size,
        createdAt: Date.now(),
        originalFilename: path.basename(absolutePath),
        managed: false,
    });

    index[record.mediaId] = record;
    await writeMediaIndex(directories, index);
    return record;
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {string} mediaId
 * @returns {Promise<boolean>}
 */
export async function deleteStoredMedia(directories, mediaId) {
    const normalizedMediaId = String(mediaId || '');
    if (!normalizedMediaId) {
        return false;
    }

    const index = await readMediaIndex(directories);
    const record = index[normalizedMediaId];
    if (!record) {
        return false;
    }

    delete index[normalizedMediaId];
    await writeMediaIndex(directories, index);

    if (record?.managed) {
        try {
            await fs.promises.unlink(resolveStoredMediaPath(directories, record));
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn(`Failed to delete stored media bytes for ${normalizedMediaId}`, error);
            }
        }
    }

    return true;
}
