import fs from 'node:fs';
import path from 'node:path';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import {
    listLorebooksForManagement,
    LorebookRepositoryError,
    resolveLorebookWithMetadata,
} from './lorebook-repository.js';
import { withDirectoryLock } from './file-system-lock.js';

export const STMB_CONTEXT_SETTINGS_FILE = 'stmb-context-settings.json';
export const STMB_CONTEXT_NONE_KEY = '__none__';
const CONTEXT_SETTINGS_LOCK_RETRY_MS = 100;
const CONTEXT_SETTINGS_LOCK_TIMEOUT_MS = 10_000;
const CONTEXT_SETTINGS_LOCK_STALE_MS = 30_000;
const CONTEXT_SETTINGS_LOCK_HEARTBEAT_MS = 2_000;
const contextSettingsMutationQueues = new Map();

function nowIsoString() {
    return new Date().toISOString();
}

function createRequestError(status, type, message, extra = {}) {
    const error = new Error(String(message || 'STMB context settings request failed'));
    error.status = Number(status) || 500;
    error.type = String(type || 'StmbContextSettingsError');
    Object.assign(error, extra);
    return error;
}

function normalizeStorage(value) {
    return value === 'secure' ? 'secure' : 'user';
}

function normalizeKey(value) {
    return String(value || '').trim();
}

function createContextSettingKey() {
    return `context_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getUserHandle(user) {
    return String(user?.profile?.handle || '').trim();
}

function getSettingsPath(user) {
    const filesDir = String(user?.directories?.files || '').trim();
    if (!filesDir) {
        throw createRequestError(500, 'StmbContextSettingsStorageUnavailable', 'User files directory is unavailable.');
    }

    return path.join(filesDir, STMB_CONTEXT_SETTINGS_FILE);
}

function getSettingsLockPath(user) {
    return path.join(path.dirname(getSettingsPath(user)), `${STMB_CONTEXT_SETTINGS_FILE}.lock`);
}

async function withStmbContextSettingsLock(user, operation) {
    return await withDirectoryLock({
        lockPath: getSettingsLockPath(user),
        retryMs: CONTEXT_SETTINGS_LOCK_RETRY_MS,
        timeoutMs: CONTEXT_SETTINGS_LOCK_TIMEOUT_MS,
        staleMs: CONTEXT_SETTINGS_LOCK_STALE_MS,
        heartbeatMs: CONTEXT_SETTINGS_LOCK_HEARTBEAT_MS,
        timeoutMessage: 'Timed out waiting to update STMB context settings.',
    }, async (lock) => await operation(lock));
}

function runWithStmbContextSettingsLock(user, operation) {
    const settingsPath = getSettingsPath(user);
    const previousOperation = contextSettingsMutationQueues.get(settingsPath) || Promise.resolve();
    const queuedOperation = previousOperation
        .catch(() => { })
        .then(async () => await withStmbContextSettingsLock(user, operation));
    const queueTail = queuedOperation.catch(() => { });
    contextSettingsMutationQueues.set(settingsPath, queueTail);
    queueTail.finally(() => {
        if (contextSettingsMutationQueues.get(settingsPath) === queueTail) {
            contextSettingsMutationQueues.delete(settingsPath);
        }
    });
    return queuedOperation;
}

function findLorebookEntryByUid(lorebookData, uid) {
    const uidText = String(uid);
    const directEntry = lorebookData?.entries?.[uidText];
    if (directEntry && typeof directEntry === 'object') {
        return directEntry;
    }

    return Object.values(lorebookData?.entries || {})
        .find(entry => entry && String(entry.uid) === uidText) || null;
}

function createEmptyDocument() {
    return {
        version: 1,
        settings: {},
    };
}

export function normalizeStmbContextEntries(entries = []) {
    const normalized = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const lorebookName = String(entry?.lorebookName || entry?.worldName || entry?.world || entry?.book || entry?.name || '').trim();
        const uidValue = entry?.uid ?? entry?.id;
        const uid = String(uidValue ?? '').trim();
        if (!lorebookName || !uid) {
            continue;
        }

        normalized.push({
            lorebookName,
            storage: normalizeStorage(entry?.storage),
            uid,
        });
    }

    return normalized;
}

export function normalizeStmbContextSetting(setting = {}, fallbackKey = '') {
    const createdAt = String(setting?.createdAt || '').trim() || nowIsoString();
    const updatedAt = String(setting?.updatedAt || '').trim() || createdAt;
    const key = normalizeKey(setting?.key || fallbackKey || createContextSettingKey());
    return {
        key,
        name: String(setting?.name || '').trim() || 'Untitled Context Setting',
        entries: normalizeStmbContextEntries(setting?.entries),
        createdAt,
        updatedAt,
    };
}

export function normalizeStmbContextSettingsDocument(document = {}) {
    const normalized = createEmptyDocument();
    const rawSettings = document?.settings && typeof document.settings === 'object' && !Array.isArray(document.settings)
        ? document.settings
        : {};

    for (const [key, setting] of Object.entries(rawSettings)) {
        const normalizedSetting = normalizeStmbContextSetting(setting, key);
        if (normalizedSetting.key && normalizedSetting.key !== STMB_CONTEXT_NONE_KEY) {
            normalized.settings[normalizedSetting.key] = normalizedSetting;
        }
    }

    return normalized;
}

export function readStmbContextSettingsDocument(user) {
    const filePath = getSettingsPath(user);
    if (!fs.existsSync(filePath)) {
        return createEmptyDocument();
    }

    try {
        return normalizeStmbContextSettingsDocument(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
        throw createRequestError(500, 'StmbContextSettingsReadFailed', 'Failed to read STMB context settings.', { cause: error });
    }
}

export function writeStmbContextSettingsDocument(user, document) {
    const filePath = getSettingsPath(user);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileAtomicSync(filePath, JSON.stringify(normalizeStmbContextSettingsDocument(document), null, 4), 'utf8');
}

export function userOwnsLorebookMetadata(user, metadata) {
    const handle = getUserHandle(user);
    if (!handle || !metadata || typeof metadata !== 'object') {
        return false;
    }

    const ownerHandles = Array.isArray(metadata.ownerHandles)
        ? metadata.ownerHandles.map(owner => String(owner || '').trim()).filter(Boolean)
        : [];
    const ownerHandle = String(metadata.ownerHandle || '').trim();

    if (metadata.storage === 'user') {
        return ownerHandle === handle || ownerHandles.includes(handle);
    }

    if (metadata.storage === 'secure') {
        return ownerHandle === handle || ownerHandles.includes(handle);
    }

    return false;
}

function resolveOwnedLorebookEntry(user, reference) {
    const ref = normalizeStmbContextEntries([reference])[0];
    if (!ref) {
        throw createRequestError(400, 'StmbContextEntryInvalid', 'Context entry references require lorebookName and uid.');
    }

    const resolved = resolveLorebookWithMetadata(user, ref.lorebookName, {
        storage: ref.storage,
        allowDummy: false,
        requireManageableSecure: false,
    });
    if (!userOwnsLorebookMetadata(user, resolved.metadata)) {
        throw new LorebookRepositoryError('LorebookAccessDenied', `Lorebook "${ref.lorebookName}" is not owned by the current user.`, 403);
    }

    const entry = findLorebookEntryByUid(resolved.data, ref.uid);
    if (!entry) {
        throw createRequestError(400, 'StmbContextEntryNotFound', `Lorebook entry "${ref.uid}" was not found in "${ref.lorebookName}".`);
    }

    return {
        ref: {
            lorebookName: resolved.metadata.name,
            storage: resolved.metadata.storage === 'secure' ? 'secure' : 'user',
            uid: String(entry.uid ?? ref.uid),
        },
        entry,
    };
}

export function validateStmbContextSettingEntries(user, entries = []) {
    const validated = [];
    for (const entry of normalizeStmbContextEntries(entries)) {
        validated.push(resolveOwnedLorebookEntry(user, entry).ref);
    }
    return validated;
}

export function resolveStmbContextSettingEntries(user, setting = {}) {
    const resolved = [];
    const warnings = [];

    for (const reference of normalizeStmbContextEntries(setting?.entries)) {
        try {
            const result = resolveOwnedLorebookEntry(user, reference);
            resolved.push({
                title: String(result.entry?.comment || result.entry?.title || `Entry ${result.ref.uid}`),
                content: String(result.entry?.content || ''),
                lorebookName: result.ref.lorebookName,
                uid: result.ref.uid,
            });
        } catch (error) {
            warnings.push({
                lorebookName: reference.lorebookName,
                storage: reference.storage,
                uid: reference.uid,
                reason: error?.type || error?.code || error?.name || 'StmbContextEntrySkipped',
                message: error?.message || 'Context entry was skipped.',
            });
        }
    }

    return { entries: resolved, warnings };
}

export function listOwnedStmbContextSourceEntries(user) {
    const sourceEntries = [];
    for (const item of listLorebooksForManagement(user)) {
        if (!userOwnsLorebookMetadata(user, item)) {
            continue;
        }

        let resolved;
        try {
            resolved = resolveLorebookWithMetadata(user, item.name, {
                storage: item.storage === 'secure' ? 'secure' : 'user',
                allowDummy: false,
                requireManageableSecure: false,
            });
        } catch (error) {
            console.warn(`[STMB] Skipping unavailable context source lorebook "${item.name}".`, error);
            continue;
        }

        if (!userOwnsLorebookMetadata(user, resolved.metadata)) {
            continue;
        }

        const entries = Object.values(resolved.data?.entries || {})
            .filter(entry => entry && typeof entry === 'object' && entry.uid !== undefined && entry.uid !== null)
            .map(entry => ({
                lorebookName: resolved.metadata.name,
                storage: resolved.metadata.storage === 'secure' ? 'secure' : 'user',
                uid: String(entry.uid),
                title: String(entry.comment || entry.title || `Entry ${entry.uid}`),
            }))
            .sort((a, b) => a.title.localeCompare(b.title) || a.uid.localeCompare(b.uid));
        sourceEntries.push(...entries);
    }

    return sourceEntries;
}

export function listStmbContextSettings(user) {
    const document = readStmbContextSettingsDocument(user);
    return Object.values(document.settings)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.name.localeCompare(b.name));
}

export function getStmbContextSetting(user, key) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || normalizedKey === STMB_CONTEXT_NONE_KEY) {
        return null;
    }
    const document = readStmbContextSettingsDocument(user);
    return document.settings[normalizedKey] || null;
}

export async function upsertStmbContextSetting(user, setting) {
    return await runWithStmbContextSettingsLock(user, async (lock) => {
        const document = await lock.run(async () => readStmbContextSettingsDocument(user));
        const existingKey = normalizeKey(setting?.key);
        const existing = existingKey ? document.settings[existingKey] : null;
        const timestamp = nowIsoString();
        const normalized = normalizeStmbContextSetting({
            ...setting,
            key: existingKey || createContextSettingKey(),
            createdAt: existing?.createdAt || setting?.createdAt || timestamp,
            updatedAt: timestamp,
            entries: validateStmbContextSettingEntries(user, setting?.entries),
        });

        document.settings[normalized.key] = normalized;
        await lock.run(async () => writeStmbContextSettingsDocument(user, document));
        return normalized;
    });
}

export async function duplicateStmbContextSetting(user, key) {
    return await runWithStmbContextSettingsLock(user, async (lock) => {
        const document = await lock.run(async () => readStmbContextSettingsDocument(user));
        const source = document.settings[normalizeKey(key)];
        if (!source) {
            throw createRequestError(404, 'StmbContextSettingNotFound', 'Context setting was not found.');
        }

        const timestamp = nowIsoString();
        const duplicated = normalizeStmbContextSetting({
            ...source,
            key: createContextSettingKey(),
            name: `${source.name || 'Context Setting'} Copy`,
            entries: validateStmbContextSettingEntries(user, source.entries),
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        document.settings[duplicated.key] = duplicated;
        await lock.run(async () => writeStmbContextSettingsDocument(user, document));
        return duplicated;
    });
}

export async function deleteStmbContextSetting(user, key) {
    return await runWithStmbContextSettingsLock(user, async (lock) => {
        const document = await lock.run(async () => readStmbContextSettingsDocument(user));
        const normalizedKey = normalizeKey(key);
        const deleted = Boolean(document.settings[normalizedKey]);
        if (deleted) {
            delete document.settings[normalizedKey];
            await lock.run(async () => writeStmbContextSettingsDocument(user, document));
        }
        return { deleted };
    });
}

export async function migrateStmbContextSettingsLorebookReference(user, { operation, oldName, newName = '' } = {}) {
    return await runWithStmbContextSettingsLock(user, async (lock) => {
        const normalizedOperation = String(operation || '').trim();
        const target = String(oldName || '').trim();
        const replacement = normalizedOperation === 'rename' ? String(newName || '').trim() : '';
        if (!target || !['rename', 'delete'].includes(normalizedOperation)) {
            throw createRequestError(400, 'StmbContextSettingsBadMigration', 'operation and oldName are required.');
        }

        const document = await lock.run(async () => readStmbContextSettingsDocument(user));
        let changed = false;
        const timestamp = nowIsoString();
        for (const setting of Object.values(document.settings)) {
            const nextEntries = [];
            let settingChanged = false;
            for (const entry of normalizeStmbContextEntries(setting.entries)) {
                if (entry.lorebookName !== target) {
                    nextEntries.push(entry);
                    continue;
                }
                settingChanged = true;
                if (replacement) {
                    nextEntries.push({ ...entry, lorebookName: replacement });
                }
            }

            if (settingChanged) {
                setting.entries = nextEntries;
                setting.updatedAt = timestamp;
                changed = true;
            }
        }

        if (changed) {
            await lock.run(async () => writeStmbContextSettingsDocument(user, document));
        }

        return { changed };
    });
}
