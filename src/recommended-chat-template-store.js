import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { withDirectoryLock } from './file-system-lock.js';

const STORE_DIRECTORY = ['_templates', 'recommended-chat-setups'];
const INDEX_FILENAME = 'index.json';
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
const LOCK_HEARTBEAT_MS = 10_000;
let mutationQueue = Promise.resolve();
let cachedIndex = null;
let cachedIndexSignature = '';
let cachedRoot = '';

function getStoreRoot() {
    if (!globalThis.DATA_ROOT) {
        throw new Error('DATA_ROOT must be defined before using recommended chat templates');
    }

    const root = path.join(globalThis.DATA_ROOT, ...STORE_DIRECTORY);
    if (root !== cachedRoot || !fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
        cachedRoot = root;
        cachedIndex = null;
        cachedIndexSignature = '';
    }
    return root;
}

function getIndexPath() {
    return path.join(getStoreRoot(), INDEX_FILENAME);
}

function getLockPath() {
    return path.join(getStoreRoot(), `${INDEX_FILENAME}.lock`);
}

function getArtifactToken(characterKey, revision = '') {
    return crypto.createHash('sha256').update(`${String(characterKey || '')}:${String(revision || '')}`).digest('hex');
}

/** Returns the private artifact path for a published template revision. */
export function getPublishedTemplatePath(characterKey, revision = '') {
    return path.join(getStoreRoot(), `${getArtifactToken(characterKey, revision)}.template.json`);
}

/** Returns the private artifact path for a published side-prompt revision. */
export function getPublishedSidePromptsPath(characterKey, revision = '') {
    return path.join(getStoreRoot(), `${getArtifactToken(characterKey, revision)}.side-prompts.json`);
}

function normalizeIndex(parsed) {
    return {
        version: 2,
        drafts: parsed?.drafts && typeof parsed.drafts === 'object' && !Array.isArray(parsed.drafts) ? parsed.drafts : {},
        published: parsed?.published && typeof parsed.published === 'object' && !Array.isArray(parsed.published) ? parsed.published : {},
    };
}

/** Reads the private draft and publication index from persistent storage. */
export function readRecommendedTemplateIndex() {
    const indexPath = getIndexPath();
    if (!fs.existsSync(indexPath)) {
        cachedIndex = normalizeIndex(null);
        cachedIndexSignature = 'missing';
        return structuredClone(cachedIndex);
    }

    try {
        const stat = fs.statSync(indexPath, { bigint: true });
        const signature = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
        if (cachedIndex && cachedIndexSignature === signature) return structuredClone(cachedIndex);
        cachedIndex = normalizeIndex(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
        cachedIndexSignature = signature;
        return structuredClone(cachedIndex);
    } catch {
        throw new Error('Recommended Chat Setup storage is temporarily unavailable.');
    }
}

function writeIndex(index) {
    const indexPath = getIndexPath();
    const normalized = normalizeIndex(index);
    writeFileAtomicSync(indexPath, JSON.stringify(normalized, null, 2), 'utf8');
    const stat = fs.statSync(indexPath, { bigint: true });
    cachedIndex = structuredClone(normalized);
    cachedIndexSignature = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

/** Runs a cross-worker-safe mutation of draft and published setup state. */
export async function mutateRecommendedTemplateStore(operation) {
    return await withRecommendedTemplateStoreLock(async () => {
        const index = readRecommendedTemplateIndex();
        const result = await operation(index);
        writeIndex(index);
        return result;
    });
}

/** Runs an operation while publication and draft mutations are excluded across workers. */
export async function withRecommendedTemplateStoreLock(operation) {
    const queued = mutationQueue.catch(() => {}).then(() => withDirectoryLock({
        lockPath: getLockPath(),
        retryMs: LOCK_RETRY_MS,
        timeoutMs: LOCK_TIMEOUT_MS,
        staleMs: LOCK_STALE_MS,
        heartbeatMs: LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update Recommended Chat Setup.',
    }, operation));
    mutationQueue = queued.catch(() => {});
    return await queued;
}

/** Returns a private draft binding by stable character key. */
export function getRecommendedTemplateDraft(characterKey) {
    return readRecommendedTemplateIndex().drafts[String(characterKey || '').trim()] || null;
}

/** Returns content-free published setup metadata by stable character key. */
export function getPublishedRecommendedSetup(characterKey) {
    const normalizedKey = String(characterKey || '').trim();
    const entry = readRecommendedTemplateIndex().published[normalizedKey] || null;
    if (!entry) return null;

    const hasTemplate = Boolean(entry.hasTemplate && fs.existsSync(getPublishedTemplatePath(normalizedKey, entry.revision)));
    const hasSidePrompts = Boolean(entry.hasSidePrompts && fs.existsSync(getPublishedSidePromptsPath(normalizedKey, entry.revision)));
    return hasTemplate || hasSidePrompts ? { ...entry, hasTemplate, hasSidePrompts } : null;
}

/** Returns whether a user lorebook is protected as a designated template draft. */
export function isReservedRecommendedTemplateSource(ownerHandle, lorebookName) {
    const normalizedOwner = String(ownerHandle || '').trim();
    const normalizedName = String(lorebookName || '').trim();
    if (!normalizedOwner || !normalizedName) return false;

    return Object.values(readRecommendedTemplateIndex().drafts).some(draft =>
        String(draft?.templateSourceOwnerHandle || '').trim() === normalizedOwner
        && String(draft?.templateSourceName || '').trim() === normalizedName,
    );
}

/** Reads a published template artifact for an already validated revision. */
export function readPublishedTemplate(characterKey, revision) {
    return JSON.parse(fs.readFileSync(getPublishedTemplatePath(characterKey, revision), 'utf8'));
}

/** Reads a published side-prompt artifact for an already validated revision. */
export function readPublishedSidePrompts(characterKey, revision) {
    return JSON.parse(fs.readFileSync(getPublishedSidePromptsPath(characterKey, revision), 'utf8'));
}

function snapshotFile(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function restoreFile(filePath, snapshot) {
    if (snapshot === null) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
        return;
    }
    writeFileAtomicSync(filePath, snapshot);
}

/** Publishes staged components and returns a rollback callback for the approval transaction. */
export async function publishRecommendedSetup(characterKey, staged) {
    const normalizedKey = String(characterKey || '').trim();
    if (!normalizedKey) throw new Error('Recommended Chat Setup key is missing.');

    const revision = String(staged.revision || '').trim();
    if (!revision) throw new Error('Recommended Chat Setup revision is missing.');
    const templatePath = getPublishedTemplatePath(normalizedKey, revision);
    const sidePromptsPath = getPublishedSidePromptsPath(normalizedKey, revision);
    let beforeTemplate = null;
    let beforeSidePrompts = null;
    let oldTemplatePath = '';
    let oldSidePromptsPath = '';
    let beforeOldTemplate = null;
    let beforeOldSidePrompts = null;
    let beforeEntry = null;
    let mutationStarted = false;

    try {
        await mutateRecommendedTemplateStore(index => {
            mutationStarted = true;
            beforeEntry = index.published[normalizedKey] ? structuredClone(index.published[normalizedKey]) : null;
            beforeTemplate = snapshotFile(templatePath);
            beforeSidePrompts = snapshotFile(sidePromptsPath);
            if (beforeEntry?.revision) {
                oldTemplatePath = getPublishedTemplatePath(normalizedKey, beforeEntry.revision);
                oldSidePromptsPath = getPublishedSidePromptsPath(normalizedKey, beforeEntry.revision);
                beforeOldTemplate = snapshotFile(oldTemplatePath);
                beforeOldSidePrompts = snapshotFile(oldSidePromptsPath);
            }

            if (staged.hasTemplate) {
                writeFileAtomicSync(templatePath, JSON.stringify(staged.templateData, null, 2), 'utf8');
            } else if (fs.existsSync(templatePath)) {
                fs.rmSync(templatePath, { force: true });
            }

            if (staged.hasSidePrompts) {
                writeFileAtomicSync(sidePromptsPath, JSON.stringify(staged.sidePrompts, null, 2), 'utf8');
            } else if (fs.existsSync(sidePromptsPath)) {
                fs.rmSync(sidePromptsPath, { force: true });
            }

            if (!staged.hasTemplate && !staged.hasSidePrompts) {
                delete index.published[normalizedKey];
                return;
            }

            index.published[normalizedKey] = {
                characterKey: normalizedKey,
                characterName: String(staged.characterName || ''),
                botmakerName: String(staged.botmakerName || ''),
                hasTemplate: Boolean(staged.hasTemplate),
                hasSidePrompts: Boolean(staged.hasSidePrompts),
                sidePromptSetName: staged.hasSidePrompts ? String(staged.characterName || '') : '',
                sidePromptCount: staged.hasSidePrompts && Array.isArray(staged.sidePrompts?.set?.items)
                    ? staged.sidePrompts.set.items.length
                    : 0,
                revision,
                publishedAt: new Date().toISOString(),
            };
        });
    } catch (error) {
        if (mutationStarted) {
            await mutateRecommendedTemplateStore(index => {
                restoreFile(templatePath, beforeTemplate);
                restoreFile(sidePromptsPath, beforeSidePrompts);
                if (oldTemplatePath && oldTemplatePath !== templatePath) restoreFile(oldTemplatePath, beforeOldTemplate);
                if (oldSidePromptsPath && oldSidePromptsPath !== sidePromptsPath) restoreFile(oldSidePromptsPath, beforeOldSidePrompts);
                if (beforeEntry) index.published[normalizedKey] = beforeEntry;
                else delete index.published[normalizedKey];
            });
        }
        throw error;
    }

    const rollback = async () => {
        await mutateRecommendedTemplateStore(index => {
            restoreFile(templatePath, beforeTemplate);
            restoreFile(sidePromptsPath, beforeSidePrompts);
            if (oldTemplatePath && oldTemplatePath !== templatePath) restoreFile(oldTemplatePath, beforeOldTemplate);
            if (oldSidePromptsPath && oldSidePromptsPath !== sidePromptsPath) restoreFile(oldSidePromptsPath, beforeOldSidePrompts);
            if (beforeEntry) index.published[normalizedKey] = beforeEntry;
            else delete index.published[normalizedKey];
        });
    };
    rollback.commit = async () => {
        await withRecommendedTemplateStoreLock(async () => {
            if (oldTemplatePath && oldTemplatePath !== templatePath && fs.existsSync(oldTemplatePath)) {
                fs.rmSync(oldTemplatePath, { force: true });
            }
            if (oldSidePromptsPath && oldSidePromptsPath !== sidePromptsPath && fs.existsSync(oldSidePromptsPath)) {
                fs.rmSync(oldSidePromptsPath, { force: true });
            }
        });
    };
    return rollback;
}
