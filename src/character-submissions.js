import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';

import _ from 'lodash';
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { parse, write } from './character-card-parser.js';
import { getCharacterDistributionPolicy, setCharacterDistributionPolicy } from './character-distribution-registry.js';
import { getCharacterOwnerHandles, getCharacterSharedKey, validateSubmittedCharacterLinkedLorebooks } from './character-linked-lorebooks.js';
import { getSharedCharacterKeyForFilePath } from './character-sharing-repository.js';
import { invalidateThumbnail } from './endpoints/thumbnails.js';
import { getAllEnabledUsers, getUserDirectories } from './users.js';
import { clearCharacterFavoriteState, getCharacterFavorite, getLegacyCharacterFavoriteState } from './favorites-repository.js';

export const SUBMISSION_STATUSES = Object.freeze({
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
});

export const PUBLISH_MODES = Object.freeze({
    SELECTED: 'selected',
    GLOBAL: 'global',
});

export const SUBMISSION_DISTRIBUTION_MODES = Object.freeze({
    WHITELIST: 'whitelist',
    GLOBAL: 'global',
    GLOBAL_BLACKLIST: 'global_blacklist',
});

const AUTO_APPROVED_REVIEWED_BY = 'Automatic';

export const SUBMISSION_CLEANUP_MODES = Object.freeze({
    ASSET: 'asset',
    ALL: 'all',
});

export const DISTRIBUTION_SOURCE_TYPES = Object.freeze({
    CHARACTER: 'character',
    SUBMISSION: 'submission',
});

const DEFAULT_CONTENT_ROOT = globalThis.DEFAULT_CONTENT_ROOT;
const DEFAULT_CONTENT_INDEX = path.join(DEFAULT_CONTENT_ROOT, 'index.json');
const DEFAULT_CONTENT_INDEX_LOCK_SUFFIX = '.lock';
const DEFAULT_CONTENT_INDEX_LOCK_RETRY_MS = 50;
const DEFAULT_CONTENT_INDEX_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_CONTENT_INDEX_LOCK_STALE_MS = 60_000;
let defaultContentIndexWriteQueue = Promise.resolve();

/**
 * Serializes mutations to the shared default content index to avoid lost updates.
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
function runWithDefaultContentIndexLock(operation) {
    const queuedOperation = defaultContentIndexWriteQueue.catch(() => { }).then(async () => {
        const release = acquireDefaultContentIndexWriteLock();

        try {
            return await operation();
        } finally {
            release();
        }
    });
    defaultContentIndexWriteQueue = queuedOperation.catch(() => { });
    return queuedOperation;
}

function getDefaultContentIndexLockPath() {
    return `${DEFAULT_CONTENT_INDEX}${DEFAULT_CONTENT_INDEX_LOCK_SUFFIX}`;
}

function sleepSync(ms) {
    if (ms <= 0) {
        return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isDefaultContentIndexLockStale(lockPath) {
    try {
        const stats = fs.statSync(lockPath);
        return Date.now() - stats.mtimeMs > DEFAULT_CONTENT_INDEX_LOCK_STALE_MS;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

function removeDefaultContentIndexLock(lockPath) {
    try {
        fs.rmdirSync(lockPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }

        if (error?.code === 'ENOTEMPTY') {
            fs.rmSync(lockPath, { recursive: true, force: false });
            return;
        }

        throw error;
    }
}

function acquireDefaultContentIndexWriteLock() {
    const lockPath = getDefaultContentIndexLockPath();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + DEFAULT_CONTENT_INDEX_LOCK_TIMEOUT_MS;

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            return () => removeDefaultContentIndexLock(lockPath);
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            if (isDefaultContentIndexLockStale(lockPath)) {
                removeDefaultContentIndexLock(lockPath);
                continue;
            }

            if (Date.now() >= deadline) {
                throw new Error('Timed out waiting to update the default content index.');
            }

            sleepSync(DEFAULT_CONTENT_INDEX_LOCK_RETRY_MS);
        }
    }
}

/**
 * Gets the submission root directory.
 * @returns {string}
 */
function getSubmissionsRoot() {
    return path.join(path.resolve(String(globalThis.DATA_ROOT || '.')), '_system', 'character-submissions');
}

/**
 * @typedef {object} SubmissionRecord
 * @property {string} id
 * @property {'pending'|'approved'|'rejected'} status
 * @property {string} ownerHandle
 * @property {string[]} [ownerHandles]
 * @property {string} [sharedCharacterKey]
 * @property {number} submittedAt
 * @property {string} submittedFilename
 * @property {number | null} reviewedAt
 * @property {string | null} reviewedBy
 * @property {string} reviewNote
 * @property {'selected'|'global'|null} publishMode
 * @property {string[]} targetHandles
 * @property {string | null} publishedFilename
 * @property {string} [adminQueueReason]
 * @property {'whitelist'|'global'|'global_blacklist'} [requestedDistributionMode]
 * @property {string[]} [requestedTargetHandles]
 * @property {string[]} [requestedBlacklistHandles]
 */

/**
 * Ensures the submission store exists.
 * @returns {Promise<void>}
 */
export async function ensureSubmissionStore() {
    await fsPromises.mkdir(getSubmissionsRoot(), { recursive: true });
}

/**
 * Gets the submission paths for a submission id.
 * @param {string} submissionId
 * @returns {{basePath: string, cardPath: string, recordPath: string}}
 */
export function getSubmissionPaths(submissionId) {
    const root = path.resolve(getSubmissionsRoot());
    const id = String(submissionId || '').trim();
    const parts = id.split('|');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error('Invalid submission id.');
    }

    const normalizedId = buildSubmissionId({
        ownerHandle: parts[0],
        submittedFilename: parts[1],
    });

    if (normalizedId !== id) {
        throw new Error('Invalid submission id.');
    }

    const ownerDirectoryName = normalizeSubmissionOwnerHandle(parts[0]);
    const submissionFileName = normalizeSubmissionFileName(parts[1]);
    const basePath = path.resolve(root, ownerDirectoryName);
    const relativePath = path.relative(root, basePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Invalid submission id.');
    }

    return {
        basePath,
        cardPath: path.join(basePath, `${submissionFileName}.png`),
        recordPath: path.join(basePath, `${submissionFileName}.json`),
    };
}

/**
 * Normalizes a user-provided character file name.
 * @param {string | undefined | null} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeCharacterFileName(value, fallback = 'character') {
    const parsedName = path.parse(String(value || fallback)).name || fallback;
    const sanitizedName = sanitize(parsedName).trim();

    if (!sanitizedName) {
        throw new Error('Invalid character file name.');
    }

    return sanitizedName;
}

/**
 * Normalizes the owner handle used for submission storage directories.
 * @param {string | undefined | null} value
 * @returns {string}
 */
function normalizeSubmissionOwnerHandle(value) {
    const sanitizedValue = sanitize(String(value || '').replaceAll('|', '')).trim();

    if (!sanitizedValue) {
        throw new Error('Invalid submission id.');
    }

    return sanitizedValue;
}

/**
 * Normalizes the bot name used for submission card/record filenames.
 * @param {string | undefined | null} value
 * @returns {string}
 */
function normalizeSubmissionFileName(value) {
    return normalizeCharacterFileName(value, 'character');
}

function normalizeHandleList(value) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
}

function normalizeSubmissionRequestedDistributionMode(value, fallback = null) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const normalizedValue = String(value).trim().toLowerCase();
    return Object.values(SUBMISSION_DISTRIBUTION_MODES).includes(normalizedValue)
        ? normalizedValue
        : fallback;
}

function normalizeSubmissionRecord(record) {
    const normalizedRequestedDistributionMode = normalizeSubmissionRequestedDistributionMode(record?.requestedDistributionMode, null);
    const normalizedTargetHandles = normalizeHandleList(record?.targetHandles);
    const normalizedRequestedTargetHandles = normalizeHandleList(record?.requestedTargetHandles);
    const normalizedRequestedBlacklistHandles = normalizeHandleList(record?.requestedBlacklistHandles);

    return {
        ...record,
        status: Object.values(SUBMISSION_STATUSES).includes(record?.status) ? record.status : SUBMISSION_STATUSES.PENDING,
        ownerHandle: String(record?.ownerHandle || '').trim(),
        ownerHandles: normalizeHandleList(record?.ownerHandles).length > 0
            ? normalizeHandleList(record?.ownerHandles)
            : normalizeHandleList([record?.ownerHandle]),
        sharedCharacterKey: String(record?.sharedCharacterKey || '').trim(),
        submittedFilename: String(record?.submittedFilename || '').trim(),
        reviewedAt: Number.isFinite(record?.reviewedAt) ? record.reviewedAt : null,
        reviewedBy: record?.reviewedBy ? String(record.reviewedBy).trim() : null,
        reviewNote: String(record?.reviewNote || ''),
        publishMode: Object.values(PUBLISH_MODES).includes(record?.publishMode) ? record.publishMode : null,
        targetHandles: normalizedTargetHandles,
        publishedFilename: record?.publishedFilename ? String(record.publishedFilename).trim() : null,
        adminQueueReason: String(record?.adminQueueReason || '').trim(),
        requestedDistributionMode: normalizedRequestedDistributionMode,
        requestedTargetHandles: normalizedRequestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.WHITELIST
            ? normalizedRequestedTargetHandles
            : [],
        requestedBlacklistHandles: normalizedRequestedDistributionMode === SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST
            ? normalizedRequestedBlacklistHandles
            : [],
    };
}

function areHandleListsEqual(left, right) {
    const normalizedLeft = normalizeHandleList(left).sort();
    const normalizedRight = normalizeHandleList(right).sort();

    if (normalizedLeft.length !== normalizedRight.length) {
        return false;
    }

    return normalizedLeft.every((handle, index) => handle === normalizedRight[index]);
}

/**
 * Builds the deterministic submission id from owner + bot name.
 * @param {{ ownerHandle: string, submittedFilename: string }} params
 * @returns {string}
 */
function buildSubmissionId({ ownerHandle, submittedFilename }) {
    const normalizedOwnerHandle = normalizeSubmissionOwnerHandle(ownerHandle);
    const normalizedSubmittedFilename = normalizeSubmissionFileName(submittedFilename);
    return `${normalizedOwnerHandle}|${normalizedSubmittedFilename}`;
}

async function removeSubmissionOwnerDirectoryIfEmpty(directoryPath) {
    try {
        const entries = await fsPromises.readdir(directoryPath);
        if (entries.length === 0) {
            await fsPromises.rmdir(directoryPath);
        }
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }

        throw error;
    }
}

/**
 * Reads the PNG card and parsed JSON metadata.
 * @param {string} filePath
 * @returns {Promise<{ rawBuffer: Buffer, card: object }>}
 */
async function readCharacterCardFile(filePath) {
    const [rawBuffer, rawCard] = await Promise.all([
        fsPromises.readFile(filePath),
        parse(filePath, 'png'),
    ]);

    return {
        rawBuffer,
        card: JSON.parse(rawCard),
    };
}

/**
 * Writes a card object back into a PNG.
 * @param {Buffer} rawBuffer
 * @param {object} card
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
async function writeCharacterCardFile(rawBuffer, card, outputPath) {
    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
    const outputBuffer = write(rawBuffer, JSON.stringify(card));
    await writeFileAtomic(outputPath, outputBuffer);
}

/**
 * Gets the character name stored in the card data.
 * @param {object} card
 * @returns {string}
 */
function getCharacterName(card) {
    return String(_.get(card, 'data.name', _.get(card, 'name', '')) || '');
}

/**
 * Removes chat/private session fields before sharing.
 * @param {object} card
 */
function stripPrivateShareFields(card) {
    _.unset(card, 'chat');
    _.unset(card, 'data.extensions.chat');
}

/**
 * Downgrades shared-management behavior for distributed copies while preserving owner metadata.
 * @param {object} card
 * @param {string} [fallbackSharedCharacterKey='']
 */
function normalizeDistributedCharacterCard(card, fallbackSharedCharacterKey = '') {
    const sharedCharacterKey = getCharacterSharedKey(card) || String(fallbackSharedCharacterKey || '').trim();
    if (!sharedCharacterKey) {
        return;
    }

    _.set(card, 'data.extensions.aikobots.shared_character_key', sharedCharacterKey);
    _.set(card, 'data.extensions.aikobots.sharing_mode', 'single');
}

/**
 * Sets ownership metadata on a card.
 * @param {object} card
 * @param {{ ownerHandle: string, submissionId: string }} params
 */
function setSubmissionMetadata(card, { ownerHandle, submissionId }) {
    _.set(card, 'data.extensions.aikobots.owner_handle', ownerHandle);
    _.set(card, 'data.extensions.aikobots.submission_id', submissionId);
}

/**
 * Sets ownership metadata on a card without changing submission metadata.
 * @param {object} card
 * @param {string} ownerHandle
 */
function setCharacterOwnerHandle(card, ownerHandle) {
    _.set(card, 'data.extensions.aikobots.owner_handle', String(ownerHandle || '').trim());
}

/**
 * Gets the ownership metadata stored on a card.
 * @param {object} card
 * @returns {string}
 */
function getSubmissionOwnerHandle(card) {
    return String(_.get(card, 'data.extensions.aikobots.owner_handle', '') || '').trim();
}

/**
 * Gets the ownership metadata stored on a card.
 * @param {object} card
 * @returns {string[]}
 */
function getSubmissionOwnerHandles(card) {
    return getCharacterOwnerHandles(card);
}

/**
 * Writes/updates the managed content index for globally-published characters.
 * @param {string} relativeFilename
 * @returns {Promise<void>}
 */
async function upsertDefaultContentCharacter(relativeFilename) {
    return runWithDefaultContentIndexLock(async () => {
        await fsPromises.mkdir(path.dirname(DEFAULT_CONTENT_INDEX), { recursive: true });

        /** @type {{filename: string, type: string}[]} */
        let contentIndex = [];
        if (fs.existsSync(DEFAULT_CONTENT_INDEX)) {
            try {
                const raw = await fsPromises.readFile(DEFAULT_CONTENT_INDEX, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    contentIndex = parsed;
                }
            } catch (error) {
                console.warn('Failed to read default content index. Recreating it.', error);
            }
        }

        const existingIndex = contentIndex.findIndex(item => item.filename === relativeFilename);
        if (existingIndex === -1) {
            contentIndex.push({ filename: relativeFilename, type: 'character' });
        } else {
            contentIndex[existingIndex].type = 'character';
        }

        await writeFileAtomic(DEFAULT_CONTENT_INDEX, JSON.stringify(contentIndex, null, 4));
    });
}

/**
 * Resolves enabled publish targets. Falls back to the acting user in single-user mode.
 * @param {string} actingUserHandle
 * @returns {Promise<string[]>}
 */
async function getEnabledPublishTargets(actingUserHandle) {
    const users = await getAllEnabledUsers();
    const handles = users.map(user => user.handle);
    return handles.length > 0 ? handles : [actingUserHandle];
}

/**
 * Validates selected targets against enabled users.
 * @param {string[]} targetHandles
 * @param {string} actingUserHandle
 * @returns {Promise<string[]>}
 */
async function validateDistributionHandles(targetHandles, actingUserHandle, { requireAtLeastOne = false } = {}) {
    const requested = [...new Set((Array.isArray(targetHandles) ? targetHandles : []).map(handle => String(handle || '').trim()).filter(Boolean))];
    if (requireAtLeastOne && requested.length === 0) {
        throw new Error('At least one target user is required.');
    }

    const enabledHandles = new Set(await getEnabledPublishTargets(actingUserHandle));
    const invalidHandles = requested.filter(handle => !enabledHandles.has(handle));
    if (invalidHandles.length > 0) {
        throw new Error(`Invalid or disabled target users: ${invalidHandles.join(', ')}`);
    }

    return requested;
}

async function validateSelectedTargets(targetHandles, actingUserHandle) {
    return validateDistributionHandles(targetHandles, actingUserHandle, { requireAtLeastOne: true });
}

async function normalizeSubmissionDistributionRequest({
    requestedDistributionMode,
    requestedTargetHandles = [],
    requestedBlacklistHandles = [],
    actingUserHandle,
}) {
    const normalizedRequestedDistributionMode = normalizeSubmissionRequestedDistributionMode(
        requestedDistributionMode,
        SUBMISSION_DISTRIBUTION_MODES.GLOBAL,
    );

    switch (normalizedRequestedDistributionMode) {
        case SUBMISSION_DISTRIBUTION_MODES.WHITELIST:
            return {
                requestedDistributionMode: normalizedRequestedDistributionMode,
                requestedTargetHandles: await validateSelectedTargets(requestedTargetHandles, actingUserHandle),
                requestedBlacklistHandles: [],
            };
        case SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST:
            return {
                requestedDistributionMode: normalizedRequestedDistributionMode,
                requestedTargetHandles: [],
                requestedBlacklistHandles: await validateDistributionHandles(requestedBlacklistHandles, actingUserHandle, { requireAtLeastOne: true }),
            };
        default:
            return {
                requestedDistributionMode: SUBMISSION_DISTRIBUTION_MODES.GLOBAL,
                requestedTargetHandles: [],
                requestedBlacklistHandles: [],
            };
    }
}

async function findExistingApprovedSubmissionRecord({ submissionId, ownerHandle, sharedCharacterKey }) {
    try {
        const existingRecord = await getSubmissionRecord(submissionId);
        if (existingRecord.status === SUBMISSION_STATUSES.APPROVED) {
            return existingRecord;
        }
    } catch {
        // No previous record for this submission id.
    }

    const normalizedOwnerHandle = String(ownerHandle || '').trim();
    const normalizedSharedCharacterKey = String(sharedCharacterKey || '').trim();
    if (!normalizedSharedCharacterKey) {
        return null;
    }

    const records = await listSubmissionRecords();
    return records.find(record =>
        record.status === SUBMISSION_STATUSES.APPROVED
        && String(record.sharedCharacterKey || '').trim() === normalizedSharedCharacterKey
        && (String(record.ownerHandle || '').trim() === normalizedOwnerHandle
            || (Array.isArray(record.ownerHandles) && record.ownerHandles.includes(normalizedOwnerHandle))),
    ) || null;
}

async function getExistingApprovedDistributionConfiguration(record) {
    if (!record || record.status !== SUBMISSION_STATUSES.APPROVED || !record.publishMode) {
        return null;
    }

    const publishedFilename = normalizeCharacterFileName(record.publishedFilename || record.submittedFilename, 'character');
    const distributionPolicy = await getCharacterDistributionPolicy({
        ownerHandle: record.ownerHandle,
        characterKey: record.sharedCharacterKey,
        publishedFilename,
    });

    if (record.publishMode === PUBLISH_MODES.SELECTED) {
        const targetHandles = distributionPolicy.hasWhitelist
            ? distributionPolicy.whitelistHandles
            : normalizeHandleList(record.targetHandles);

        return {
            requestedDistributionMode: SUBMISSION_DISTRIBUTION_MODES.WHITELIST,
            requestedTargetHandles: targetHandles,
            requestedBlacklistHandles: [],
            distributeParams: {
                publishedFilename,
                publishMode: PUBLISH_MODES.SELECTED,
                targetHandles,
                persistWhitelist: distributionPolicy.hasWhitelist,
                whitelistHandles: distributionPolicy.hasWhitelist ? distributionPolicy.whitelistHandles : [],
            },
        };
    }

    if (record.publishMode === PUBLISH_MODES.GLOBAL) {
        if (distributionPolicy.hasBlacklist) {
            return {
                requestedDistributionMode: SUBMISSION_DISTRIBUTION_MODES.GLOBAL_BLACKLIST,
                requestedTargetHandles: [],
                requestedBlacklistHandles: distributionPolicy.blacklistHandles,
                distributeParams: {
                    publishedFilename,
                    publishMode: PUBLISH_MODES.GLOBAL,
                    applyBlacklist: true,
                    blacklistHandles: distributionPolicy.blacklistHandles,
                },
            };
        }

        return {
            requestedDistributionMode: SUBMISSION_DISTRIBUTION_MODES.GLOBAL,
            requestedTargetHandles: [],
            requestedBlacklistHandles: [],
            distributeParams: {
                publishedFilename,
                publishMode: PUBLISH_MODES.GLOBAL,
                applyBlacklist: false,
                blacklistHandles: [],
            },
        };
    }

    return null;
}

function isRequestedDistributionUnchanged(requestedDistribution, existingDistribution) {
    if (!requestedDistribution || !existingDistribution) {
        return false;
    }

    return requestedDistribution.requestedDistributionMode === existingDistribution.requestedDistributionMode
        && areHandleListsEqual(requestedDistribution.requestedTargetHandles, existingDistribution.requestedTargetHandles)
        && areHandleListsEqual(requestedDistribution.requestedBlacklistHandles, existingDistribution.requestedBlacklistHandles);
}

function buildAdminQueueReason({
    existingApprovedRecord,
    existingApprovedDistribution,
    requestedDistribution,
    autoApprovalError = null,
}) {
    if (autoApprovalError) {
        const errorMessage = String(autoApprovalError?.message || '').trim();
        return errorMessage
            ? `Automatic redistribution failed: ${errorMessage}`
            : 'Automatic redistribution failed.';
    }

    if (!existingApprovedRecord) {
        return 'First submission.';
    }

    if (!existingApprovedDistribution) {
        return 'Previous approval could not be reused.';
    }

    if (!isRequestedDistributionUnchanged(requestedDistribution, existingApprovedDistribution)) {
        return 'Distribution list changed.';
    }

    return '';
}

/**
 * Reads a source card once and prepares the shared payload used for distribution.
 * The distributed copy should preserve owner and lorebook metadata while stripping
 * private session fields consistently for every destination.
 * @param {string} sourcePath
 * @returns {Promise<{ rawBuffer: Buffer, card: object }>}
 */
async function prepareCharacterCardForDistribution(sourcePath) {
    const { rawBuffer, card } = await readCharacterCardFile(sourcePath);
    stripPrivateShareFields(card);
    normalizeDistributedCharacterCard(card, getSharedCharacterKeyForFilePath(sourcePath));
    clearCharacterFavoriteState(card);
    return { rawBuffer, card };
}

/**
 * Persists owner metadata to a source character card when it is missing.
 * Used by direct admin distribution so pushed characters carry an owner forward.
 * @param {{ filePath: string, ownerHandle?: string }} params
 * @returns {Promise<void>}
 */
async function persistCharacterOwnerIfMissing({ filePath, ownerHandle = '' }) {
    const normalizedOwnerHandle = String(ownerHandle || '').trim();
    if (!normalizedOwnerHandle) {
        return;
    }

    const { rawBuffer, card } = await readCharacterCardFile(filePath);
    const existingOwnerHandle = getSubmissionOwnerHandle(card);

    if (existingOwnerHandle) {
        return;
    }

    setCharacterOwnerHandle(card, normalizedOwnerHandle);
    await writeCharacterCardFile(rawBuffer, card, filePath);
}

/**
 * Writes a prepared distributed character card to a destination with favorite fields cleared.
 * @param {{ rawBuffer: Buffer, card: object }} preparedCard
 * @param {string} destinationPath
 * @returns {Promise<void>}
 */
async function writePreparedCharacterCard(preparedCard, destinationPath) {
    const card = structuredClone(preparedCard.card);
    clearCharacterFavoriteState(card);
    await writeCharacterCardFile(preparedCard.rawBuffer, card, destinationPath);
}

/**
 * Copies a prepared distribution card to a destination with favorite fields cleared.
 * @param {{ rawBuffer: Buffer, card: object }} preparedCard
 * @param {string} destinationPath
 * @returns {Promise<void>}
 */
async function copyPreparedCharacterCard(preparedCard, destinationPath) {
    await writePreparedCharacterCard(preparedCard, destinationPath);
}

/**
 * Creates the destination card used for global/selected distribution.
 * @param {string} sourcePath
 * @returns {Promise<{ rawBuffer: Buffer, card: object }>}
 */
async function buildDistributionPayload(sourcePath, { sourceOwnerHandle = '' } = {}) {
    await persistCharacterOwnerIfMissing({ filePath: sourcePath, ownerHandle: sourceOwnerHandle });
    return await prepareCharacterCardForDistribution(sourcePath);
}

/**
 * Gets a submission record by id.
 * @param {string} submissionId
 * @returns {Promise<SubmissionRecord>}
 */
export async function getSubmissionRecord(submissionId) {
    const { recordPath } = getSubmissionPaths(submissionId);
    const raw = await fsPromises.readFile(recordPath, 'utf8');
    return normalizeSubmissionRecord(JSON.parse(raw));
}

/**
 * Writes a submission record to disk.
 * @param {SubmissionRecord} record
 * @returns {Promise<void>}
 */
export async function writeSubmissionRecord(record) {
    const normalizedRecord = normalizeSubmissionRecord(record);
    const { basePath, recordPath } = getSubmissionPaths(normalizedRecord.id);
    await fsPromises.mkdir(basePath, { recursive: true });
    await writeFileAtomic(recordPath, JSON.stringify(normalizedRecord, null, 4));
}

/**
 * Cleans up stored submission data.
 * @param {{ submissionId: string, deleteMode: 'asset'|'all' }} params
 * @returns {Promise<void>}
 */
export async function cleanupSubmission({ submissionId, deleteMode }) {
    const { basePath, cardPath, recordPath } = getSubmissionPaths(submissionId);

    switch (deleteMode) {
        case SUBMISSION_CLEANUP_MODES.ASSET:
            await fsPromises.rm(cardPath, { force: true }).catch(() => { });
            return;
        case SUBMISSION_CLEANUP_MODES.ALL:
            await fsPromises.rm(cardPath, { force: true }).catch(() => { });
            await fsPromises.rm(recordPath, { force: true }).catch(() => { });
            await removeSubmissionOwnerDirectoryIfEmpty(basePath);
            return;
        default:
            throw new Error('Invalid submission cleanup mode.');
    }
}

/**
 * Creates a new character submission from an uploaded PNG.
 * @param {{ uploadPath: string, user: import('./users.js').User, ownerHandle: string, originalFilename: string }} params
 * @returns {Promise<SubmissionRecord>}
 */
export async function createCharacterSubmission({
    uploadPath,
    user,
    ownerHandle,
    originalFilename,
    requestedDistributionMode,
    requestedTargetHandles,
    requestedBlacklistHandles,
}) {
    await ensureSubmissionStore();

    const { rawBuffer, card } = await readCharacterCardFile(uploadPath);
    const fallbackName = normalizeCharacterFileName(originalFilename, 'character');
    const characterName = normalizeCharacterFileName(getCharacterName(card), fallbackName);
    const submittedFilename = `${characterName}.png`;
    const submissionId = buildSubmissionId({ ownerHandle, submittedFilename });
    const { basePath, cardPath } = getSubmissionPaths(submissionId);
    const existingOwnerHandle = getSubmissionOwnerHandle(card);
    const existingOwnerHandles = getSubmissionOwnerHandles(card);
    const existingSharedCharacterKey = getCharacterSharedKey(card) || getSharedCharacterKeyForFilePath(uploadPath);

    if (existingOwnerHandles.length > 0 && !existingOwnerHandles.includes(ownerHandle)) {
        throw new Error(`This character is owned by ${existingOwnerHandle} and cannot be submitted by ${ownerHandle}.`);
    }

    validateSubmittedCharacterLinkedLorebooks(user, card);
    setSubmissionMetadata(card, { ownerHandle, submissionId });
    if (existingSharedCharacterKey) {
        _.set(card, 'data.extensions.aikobots.shared_character_key', existingSharedCharacterKey);
    }
    clearCharacterFavoriteState(card);
    stripPrivateShareFields(card);

    const requestedDistribution = await normalizeSubmissionDistributionRequest({
        requestedDistributionMode,
        requestedTargetHandles,
        requestedBlacklistHandles,
        actingUserHandle: String(user?.profile?.handle || ownerHandle || '').trim(),
    });

    await fsPromises.mkdir(basePath, { recursive: true });
    await writeCharacterCardFile(rawBuffer, card, cardPath);

    const existingApprovedRecord = await findExistingApprovedSubmissionRecord({
        submissionId,
        ownerHandle,
        sharedCharacterKey: existingSharedCharacterKey || '',
    });
    const existingApprovedDistribution = existingApprovedRecord
        ? await getExistingApprovedDistributionConfiguration(existingApprovedRecord)
        : null;

    /** @type {SubmissionRecord} */
    let record = {
        id: submissionId,
        status: SUBMISSION_STATUSES.PENDING,
        ownerHandle: existingOwnerHandle || ownerHandle,
        ownerHandles: existingOwnerHandles.length > 0 ? existingOwnerHandles : [ownerHandle],
        sharedCharacterKey: existingSharedCharacterKey || '',
        submittedAt: Date.now(),
        submittedFilename,
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: '',
        publishMode: null,
        targetHandles: [],
        publishedFilename: null,
        adminQueueReason: '',
        requestedDistributionMode: requestedDistribution.requestedDistributionMode,
        requestedTargetHandles: requestedDistribution.requestedTargetHandles,
        requestedBlacklistHandles: requestedDistribution.requestedBlacklistHandles,
    };

    let autoApproved = false;
    let autoApprovalDistribution = null;
    let autoApprovalError = null;
    if (existingApprovedDistribution && isRequestedDistributionUnchanged(requestedDistribution, existingApprovedDistribution)) {
        try {
            autoApprovalDistribution = await distributeCharacterFile({
                sourcePath: cardPath,
                actingUserHandle: ownerHandle,
                sourceOwnerHandle: existingOwnerHandle || ownerHandle,
                ...existingApprovedDistribution.distributeParams,
            });

            record = {
                ...record,
                status: SUBMISSION_STATUSES.APPROVED,
                reviewedAt: Date.now(),
                reviewedBy: AUTO_APPROVED_REVIEWED_BY,
                publishMode: existingApprovedDistribution.distributeParams.publishMode || PUBLISH_MODES.GLOBAL,
                targetHandles: autoApprovalDistribution.targetHandles,
                publishedFilename: autoApprovalDistribution.publishedFilename,
            };
            autoApproved = true;
        } catch (error) {
            autoApprovalError = error;
            console.warn(`Automatic submission approval failed for ${submissionId}. Falling back to pending admin distribution.`, error);
        }
    }

    if (!autoApproved) {
        record.adminQueueReason = buildAdminQueueReason({
            existingApprovedRecord,
            existingApprovedDistribution,
            requestedDistribution,
            autoApprovalError,
        });
    }

    await writeSubmissionRecord(record);
    return {
        ...record,
        autoApproved,
        skippedHandles: autoApprovalDistribution?.skippedHandles || [],
        distributionPolicy: autoApprovalDistribution?.distributionPolicy || null,
    };
}

/**
 * Persists the character ownership metadata back to a source character file.
 * @param {{ filePath: string, ownerHandle: string }} params
 * @returns {Promise<void>}
 */
export async function persistCharacterSubmissionOwner({ filePath, ownerHandle }) {
    const { rawBuffer, card } = await readCharacterCardFile(filePath);
    const existingOwnerHandle = getSubmissionOwnerHandle(card);
    const existingOwnerHandles = getSubmissionOwnerHandles(card);

    if (existingOwnerHandles.length > 0 && !existingOwnerHandles.includes(ownerHandle)) {
        throw new Error(`This character is owned by ${existingOwnerHandle} and cannot be submitted by ${ownerHandle}.`);
    }

    if (existingOwnerHandles.includes(ownerHandle) || existingOwnerHandle === ownerHandle) {
        return;
    }

    setCharacterOwnerHandle(card, ownerHandle);
    await writeCharacterCardFile(rawBuffer, card, filePath);
}

/**
 * Gets the card preview/summary metadata for a submission.
 * @param {SubmissionRecord} record
 * @returns {Promise<object>}
 */
export async function buildSubmissionSummary(record) {
    const { cardPath } = getSubmissionPaths(record.id);
    const hasStoredCard = fs.existsSync(cardPath);

    if (!hasStoredCard) {
        return {
            ...record,
            characterName: '',
            creator: '',
            creatorNotes: '',
            adminQueueReason: String(record.adminQueueReason || '').trim(),
            tags: [],
            ownerMetadata: '',
            sharedCharacterKey: String(record.sharedCharacterKey || '').trim(),
            hasStoredCard: false,
        };
    }

    try {
        const { card } = await readCharacterCardFile(cardPath);

        return {
            ...record,
            characterName: getCharacterName(card),
            creator: String(_.get(card, 'data.creator', _.get(card, 'creator', '')) || ''),
            creatorNotes: String(_.get(card, 'data.creator_notes', _.get(card, 'creatorcomment', '')) || ''),
            adminQueueReason: String(record.adminQueueReason || '').trim(),
            tags: _.get(card, 'data.tags', _.get(card, 'tags', [])) || [],
            ownerMetadata: String(_.get(card, 'data.extensions.aikobots.owner_handle', '')),
            ownerHandles: getSubmissionOwnerHandles(card),
            sharedCharacterKey: getCharacterSharedKey(card) || String(record.sharedCharacterKey || '').trim(),
            hasStoredCard: true,
        };
    } catch (error) {
        console.warn(`Failed to read submission card metadata for ${record.id}.`, error);
        return {
            ...record,
            characterName: '',
            creator: '',
            creatorNotes: '',
            adminQueueReason: String(record.adminQueueReason || '').trim(),
            tags: [],
            ownerMetadata: '',
            ownerHandles: Array.isArray(record.ownerHandles) ? record.ownerHandles : [record.ownerHandle].filter(Boolean),
            sharedCharacterKey: String(record.sharedCharacterKey || '').trim(),
            hasStoredCard: true,
        };
    }
}

/**
 * Lists submissions from the store.
 * @returns {Promise<SubmissionRecord[]>}
 */
export async function listSubmissionRecords() {
    await ensureSubmissionStore();
    const ownerEntries = await fsPromises.readdir(getSubmissionsRoot(), { withFileTypes: true });
    const records = [];

    for (const ownerEntry of ownerEntries) {
        if (!ownerEntry.isDirectory()) {
            continue;
        }

        const ownerPath = path.join(getSubmissionsRoot(), ownerEntry.name);
        const fileEntries = await fsPromises.readdir(ownerPath, { withFileTypes: true }).catch(() => []);

        for (const fileEntry of fileEntries) {
            if (!fileEntry.isFile() || path.extname(fileEntry.name).toLowerCase() !== '.json' || fileEntry.name === 'record.json') {
                continue;
            }

            const submissionName = path.parse(fileEntry.name).name;
            const submissionId = buildSubmissionId({
                ownerHandle: ownerEntry.name,
                submittedFilename: submissionName,
            });

            try {
                const record = await getSubmissionRecord(submissionId);
                records.push(record);
            } catch (error) {
                console.warn(`Skipping unreadable submission record: ${submissionId}`, error);
            }
        }
    }

    records.sort((a, b) => Number(b.submittedAt || 0) - Number(a.submittedAt || 0));
    return records;
}

/**
 * Determines whether a user can access a submission.
 * @param {SubmissionRecord} record
 * @param {{ handle: string, admin: boolean }} user
 * @returns {boolean}
 */
export function canAccessSubmission(record, user) {
    const ownerHandles = [...new Set((Array.isArray(record.ownerHandles) ? record.ownerHandles : [record.ownerHandle])
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];
    return Boolean(user.admin) || ownerHandles.includes(user.handle);
}

/**
 * Distributes a character PNG to selected users or globally.
 * @param {{ sourcePath: string, publishedFilename?: string, publishMode: 'selected'|'global', targetHandles?: string[], actingUserHandle: string, sourceOwnerHandle?: string, applyBlacklist?: boolean, blacklistHandles?: string[], persistWhitelist?: boolean, whitelistHandles?: string[] }} params
 * @returns {Promise<{ publishedFilename: string, targetHandles: string[], skippedHandles: string[], distributionPolicy: object }>}
 */
export async function distributeCharacterFile({
    sourcePath,
    publishedFilename,
    publishMode,
    targetHandles = [],
    actingUserHandle,
    sourceOwnerHandle = '',
    applyBlacklist,
    blacklistHandles = [],
    persistWhitelist,
    whitelistHandles = [],
}) {
    if (!fs.existsSync(sourcePath)) {
        throw new Error('Character source file was not found.');
    }

    const sourceName = normalizeCharacterFileName(publishedFilename, path.parse(sourcePath).name);
    const outputFilename = `${sourceName}.png`;
    const distributionPayload = await buildDistributionPayload(sourcePath, { sourceOwnerHandle });
    const resolvedOwnerHandle = getSubmissionOwnerHandle(distributionPayload.card) || String(sourceOwnerHandle || actingUserHandle || '').trim();
    const resolvedCharacterKey = getCharacterSharedKey(distributionPayload.card) || getSharedCharacterKeyForFilePath(sourcePath);
    let distributionPolicy = await getCharacterDistributionPolicy({
        ownerHandle: resolvedOwnerHandle,
        characterKey: resolvedCharacterKey,
        publishedFilename: sourceName,
    });

    /** @type {string[]} */
    let recipients = [];
    /** @type {string[]} */
    let skippedHandles = [];
    if (publishMode === PUBLISH_MODES.GLOBAL) {
        const nextBlacklistHandles = typeof applyBlacklist === 'boolean'
            ? await validateDistributionHandles(blacklistHandles, actingUserHandle)
            : undefined;

        if (typeof applyBlacklist === 'boolean') {
            distributionPolicy = await setCharacterDistributionPolicy({
                ownerHandle: resolvedOwnerHandle,
                characterKey: resolvedCharacterKey,
                publishedFilename: sourceName,
                blacklistHandles: applyBlacklist ? nextBlacklistHandles : [],
                updatedBy: actingUserHandle,
            });
        }

        recipients = await getEnabledPublishTargets(actingUserHandle);
        if (distributionPolicy.blacklistHandles.length > 0) {
            const blacklist = new Set(distributionPolicy.blacklistHandles);
            skippedHandles = recipients.filter(handle => blacklist.has(handle));
            recipients = recipients.filter(handle => !blacklist.has(handle));
        }
    } else if (publishMode === PUBLISH_MODES.SELECTED) {
        recipients = await validateSelectedTargets(targetHandles, actingUserHandle);

        if (typeof persistWhitelist === 'boolean') {
            distributionPolicy = await setCharacterDistributionPolicy({
                ownerHandle: resolvedOwnerHandle,
                characterKey: resolvedCharacterKey,
                publishedFilename: sourceName,
                whitelistHandles: persistWhitelist
                    ? (Array.isArray(whitelistHandles) && whitelistHandles.length > 0
                        ? await validateDistributionHandles(whitelistHandles, actingUserHandle)
                        : recipients)
                    : [],
                updatedBy: actingUserHandle,
            });
        }
    } else {
        throw new Error('Invalid publish mode.');
    }

    for (const handle of recipients) {
        const directories = getUserDirectories(handle);
        const destinationPath = path.join(directories.characters, outputFilename);

        if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
            continue;
        }

        if (fs.existsSync(destinationPath)) {
            const { card } = await readCharacterCardFile(destinationPath);
            getCharacterFavorite(directories, {
                avatar: outputFilename,
                sharedCharacterKey: resolvedCharacterKey,
                legacyFavorite: getLegacyCharacterFavoriteState(card),
            });
        }

        await copyPreparedCharacterCard(distributionPayload, destinationPath);
        invalidateThumbnail(directories, 'avatar', outputFilename);
    }

    if (publishMode === PUBLISH_MODES.GLOBAL) {
        const defaultContentPath = path.join(DEFAULT_CONTENT_ROOT, 'characters', outputFilename);
        await copyPreparedCharacterCard(distributionPayload, defaultContentPath);
        await upsertDefaultContentCharacter(path.join('characters', outputFilename).replaceAll('\\', '/'));
    }

    return {
        publishedFilename: outputFilename,
        targetHandles: recipients,
        skippedHandles,
        distributionPolicy,
    };
}
