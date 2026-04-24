import fs from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';
import writeFileAtomic from 'write-file-atomic';

import { withDirectoryLock } from './file-system-lock.js';
import { clientRelativePath, isPathUnderParent, uuidv4 } from './util.js';

const MEDIA_INDEX_FILE = '.media-index.json';
const MEDIA_INDEX_LOCK_SUFFIX = '.lock';
const MEDIA_INDEX_LOCK_RETRY_MS = 50;
const MEDIA_INDEX_LOCK_TIMEOUT_MS = 10_000;
const MEDIA_INDEX_LOCK_STALE_MS = 60_000;
const MEDIA_INDEX_LOCK_HEARTBEAT_MS = 15_000;
const MEDIA_FOLDER = 'media';
const SUPPORTED_IMAGE_SIGNATURES = Object.freeze({
    'image/png': Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
});
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);
const mediaIndexMutationQueues = new Map();

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
function getMediaIndexLockPath(directories) {
    return `${getMediaIndexPath(directories)}${MEDIA_INDEX_LOCK_SUFFIX}`;
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {string}
 */
function getMediaRootPath(directories) {
    return path.join(directories.userImages, MEDIA_FOLDER);
}

/**
 * @param {import('./users.js').UserDirectoryList} directories
 * @template T
 * @param {(lock: { assertOwnership: () => Promise<void>, run: <U>(task: () => Promise<U>) => Promise<U> }) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withMediaIndexWriteLock(directories, operation) {
    return await withDirectoryLock({
        lockPath: getMediaIndexLockPath(directories),
        retryMs: MEDIA_INDEX_LOCK_RETRY_MS,
        timeoutMs: MEDIA_INDEX_LOCK_TIMEOUT_MS,
        staleMs: MEDIA_INDEX_LOCK_STALE_MS,
        heartbeatMs: MEDIA_INDEX_LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update the media index.',
    }, async (lock) => await operation(lock));
}

/**
 * Serializes media index mutations across requests and PM2 workers.
 * @template T
 * @param {import('./users.js').UserDirectoryList} directories
 * @param {(lock: { assertOwnership: () => Promise<void>, run: <U>(task: () => Promise<U>) => Promise<U> }) => Promise<T>} operation
 * @returns {Promise<T>}
 */
function runWithMediaIndexLock(directories, operation) {
    const indexPath = getMediaIndexPath(directories);
    const previousOperation = mediaIndexMutationQueues.get(indexPath) || Promise.resolve();
    const queuedOperation = previousOperation
        .catch(() => { })
        .then(async () => await withMediaIndexWriteLock(directories, operation));
    const queueTail = queuedOperation.catch(() => { });
    mediaIndexMutationQueues.set(indexPath, queueTail);
    queueTail.finally(() => {
        if (mediaIndexMutationQueues.get(indexPath) === queueTail) {
            mediaIndexMutationQueues.delete(indexPath);
        }
    });
    return queuedOperation;
}

/**
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isSupportedImageMimeType(mimeType) {
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    return SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType);
}

/**
 * @param {Buffer | Uint8Array} buffer
 * @returns {string}
 */
export function detectSupportedImageMimeType(buffer) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);

    for (const [mimeType, signature] of Object.entries(SUPPORTED_IMAGE_SIGNATURES)) {
        if (bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature)) {
            return mimeType;
        }
    }

    const gifHeader = bytes.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
        return 'image/gif';
    }

    const isWebp = bytes.length >= 16
        && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
        && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('ascii'));
    if (isWebp) {
        return 'image/webp';
    }

    return '';
}

/**
 * @param {string} absolutePath
 * @returns {Promise<string>}
 */
export async function detectSupportedImageMimeTypeFromFile(absolutePath) {
    const fileHandle = await fs.promises.open(absolutePath, 'r');

    try {
        const header = Buffer.alloc(16);
        const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
        return detectSupportedImageMimeType(header.subarray(0, bytesRead));
    } finally {
        await fileHandle.close();
    }
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
    await writeFileAtomic(indexPath, JSON.stringify(index, null, 2));
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
    const absolutePath = path.join(directories.root, String(record?.relativePath || ''));
    if (!isPathUnderParent(directories.userImages, absolutePath)) {
        throw new Error('Stored media path is outside the internal image store');
    }

    return absolutePath;
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
 * @param {string} _mimeType Client-supplied MIME type retained for caller compatibility.
 * @param {string} [originalFilename]
 * @param {string} [sourceUrl]
 * @returns {Promise<StoredMediaRecord>}
 */
export async function ingestImageBuffer(directories, buffer, _mimeType, originalFilename = '', sourceUrl = '') {
    const normalizedMimeType = detectSupportedImageMimeType(buffer);
    if (!normalizedMimeType) {
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

    try {
        await runWithMediaIndexLock(directories, async (lock) => {
            const index = await lock.run(async () => await readMediaIndex(directories));
            index[record.mediaId] = record;
            await lock.run(async () => await writeMediaIndex(directories, index));
        });
    } catch (error) {
        try {
            await fs.promises.unlink(absolutePath);
        } catch (unlinkError) {
            if (unlinkError?.code !== 'ENOENT') {
                console.warn(`Failed to clean up stored media bytes for ${mediaId}`, unlinkError);
            }
        }

        throw error;
    }

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

    return await runWithMediaIndexLock(directories, async (lock) => {
        const stats = await lock.run(async () => await fs.promises.stat(absolutePath));
        if (!stats.isFile()) {
            throw new Error('Image URL does not point to a file');
        }

        const mimeType = await lock.run(async () => await detectSupportedImageMimeTypeFromFile(absolutePath));
        if (!mimeType) {
            throw new Error('Existing file is not a supported image');
        }

        const normalizedRelativePath = clientRelativePath(directories.root, absolutePath);
        const index = await lock.run(async () => await readMediaIndex(directories));
        const existingRecord = Object.values(index).find(record => String(record.relativePath || '') === normalizedRelativePath);
        if (existingRecord) {
            const normalizedExistingRecord = normalizeStoredMediaRecord(directories, existingRecord);
            if (normalizedExistingRecord.mimeType !== mimeType || normalizedExistingRecord.byteLength !== stats.size) {
                index[normalizedExistingRecord.mediaId] = normalizeStoredMediaRecord(directories, {
                    ...normalizedExistingRecord,
                    mimeType,
                    byteLength: stats.size,
                });
                await lock.run(async () => await writeMediaIndex(directories, index));
                return index[normalizedExistingRecord.mediaId];
            }

            return normalizedExistingRecord;
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
        await lock.run(async () => await writeMediaIndex(directories, index));
        return record;
    });
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

    return await runWithMediaIndexLock(directories, async (lock) => {
        const index = await lock.run(async () => await readMediaIndex(directories));
        const storedRecord = index[normalizedMediaId];
        if (!storedRecord) {
            return false;
        }

        delete index[normalizedMediaId];
        await lock.run(async () => await writeMediaIndex(directories, index));

        if (storedRecord?.managed) {
            try {
                await lock.run(async () => await fs.promises.unlink(resolveStoredMediaPath(directories, storedRecord)));
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    console.warn(`Failed to delete stored media bytes for ${normalizedMediaId}`, error);
                }
            }
        }

        return true;
    });
}
