import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import _ from 'lodash';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { SETTINGS_FILE } from '../constants.js';
import {
    buildPersonasDocumentFromLegacySettings,
    getPersonasPath,
    mergePersonasIntoSettings,
    readOrMigratePersonasDocument,
    stripPersonaRegistryFromSettings,
    writePersonasDocument,
} from '../persona-repository.js';
import { delay, getConfigValue, generateTimestamp, removeOldBackups } from '../util.js';
import { getAllUserHandles, getUserDirectories } from '../users.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';
import { listLorebooksForManagement } from '../lorebook-repository.js';

const ENABLE_EXTENSIONS = !!getConfigValue('extensions.enabled', true, 'boolean');
const ENABLE_EXTENSIONS_AUTO_UPDATE = !!getConfigValue('extensions.autoUpdate', true, 'boolean');
const ENABLE_ACCOUNTS = !!getConfigValue('enableUserAccounts', false, 'boolean');

// 10 minutes
const AUTOSAVE_INTERVAL = 10 * 60 * 1000;
const SETTINGS_PERSONAS_LOCK_RETRY_MS = 50;
const SETTINGS_PERSONAS_LOCK_TIMEOUT_MS = 10_000;
const SETTINGS_PERSONAS_LOCK_STALE_MS = 60_000;

/**
 * Map of functions to trigger settings autosave for a user.
 * @type {Map<string, function>}
 */
const AUTOSAVE_FUNCTIONS = new Map();

/**
 * Triggers autosave for a user every 10 minutes.
 * @param {string} handle User handle
 * @returns {void}
 */
function triggerAutoSave(handle) {
    if (!AUTOSAVE_FUNCTIONS.has(handle)) {
        const throttledAutoSave = _.throttle(() => backupUserSettings(handle, true), AUTOSAVE_INTERVAL);
        AUTOSAVE_FUNCTIONS.set(handle, throttledAutoSave);
    }

    const functionToCall = AUTOSAVE_FUNCTIONS.get(handle);
    if (functionToCall && typeof functionToCall === 'function') {
        functionToCall();
    }
}

/**
 * Reads and parses files from a directory.
 * @param {string} directoryPath Path to the directory
 * @param {string} fileExtension File extension
 * @returns {Array} Parsed files
 */
function readAndParseFromDirectory(directoryPath, fileExtension = '.json') {
    const files = fs
        .readdirSync(directoryPath)
        .filter(x => path.parse(x).ext == fileExtension)
        .sort();

    const parsedFiles = [];

    files.forEach(item => {
        try {
            const file = fs.readFileSync(path.join(directoryPath, item), 'utf-8');
            parsedFiles.push(fileExtension == '.json' ? JSON.parse(file) : file);
        }
        catch {
            // skip
        }
    });

    return parsedFiles;
}

/**
 * Reads a settings resource directory with a fallback value if the read fails.
 * @template T
 * @param {() => T} readFn Reader callback
 * @param {T} fallbackValue Value to return on failure
 * @param {string} label Log label
 * @returns {T} Parsed resource data or fallback value
 */
function safeRead(readFn, fallbackValue, label) {
    try {
        return readFn();
    } catch (error) {
        console.error(`Failed to load ${label}:`, error);
        return fallbackValue;
    }
}

/**
 * Gets a sort function for sorting strings.
 * @param {*} _
 * @returns {(a: string, b: string) => number} Sort function
 */
function sortByName(_) {
    return (a, b) => a.localeCompare(b);
}

/**
 * Gets backup file prefix for user settings.
 * @param {string} handle User handle
 * @returns {string} File prefix
 */
export function getSettingsBackupFilePrefix(handle) {
    return `settings_${handle}_`;
}

function getPersonasBackupFilePrefix(handle) {
    return `personas_${handle}_`;
}

function getSnapshotTimestamp(fileName, prefix) {
    if (!fileName.startsWith(prefix) || !fileName.endsWith('.json')) {
        return '';
    }

    return fileName.slice(prefix.length, -'.json'.length);
}

function getPairedPersonasBackupPath(handle, settingsSnapshotPathOrName) {
    const settingsSnapshotName = path.basename(settingsSnapshotPathOrName);
    const timestamp = getSnapshotTimestamp(settingsSnapshotName, getSettingsBackupFilePrefix(handle));
    if (!timestamp) {
        return null;
    }

    const userDirectories = getUserDirectories(handle);
    return path.join(userDirectories.backups, `${getPersonasBackupFilePrefix(handle)}${timestamp}.json`);
}

function readPresetsFromDirectory(directoryPath, options = {}) {
    const {
        sortFunction,
        removeFileExtension = false,
        fileExtension = '.json',
    } = options;

    const files = fs.readdirSync(directoryPath).sort(sortFunction).filter(x => path.parse(x).ext == fileExtension);
    const fileContents = [];
    const fileNames = [];

    files.forEach(item => {
        try {
            const file = fs.readFileSync(path.join(directoryPath, item), 'utf8');
            JSON.parse(file);
            fileContents.push(file);
            fileNames.push(removeFileExtension ? item.replace(/\.[^/.]+$/, '') : item);
        } catch {
            // skip
            console.warn(`${item} is not a valid JSON`);
        }
    });

    return { fileContents, fileNames };
}

async function backupSettings() {
    try {
        const userHandles = await getAllUserHandles();

        for (const handle of userHandles) {
            backupUserSettings(handle, true);
        }
    } catch (err) {
        console.error('Could not backup settings file', err);
    }
}

/**
 * Makes a backup of the user's settings file.
 * @param {string} handle User handle
 * @param {boolean} preventDuplicates Prevent duplicate backups
 * @returns {void}
 */
function backupUserSettings(handle, preventDuplicates) {
    const userDirectories = getUserDirectories(handle);

    if (!fs.existsSync(userDirectories.root)) {
        return;
    }

    const sourceFile = path.join(userDirectories.root, SETTINGS_FILE);
    const personasSourceFile = getPersonasPath(userDirectories);

    if (preventDuplicates && isDuplicateBackup(handle, sourceFile, personasSourceFile)) {
        return;
    }

    if (!fs.existsSync(sourceFile)) {
        return;
    }

    const timestamp = generateTimestamp();
    const backupFile = path.join(userDirectories.backups, `${getSettingsBackupFilePrefix(handle)}${timestamp}.json`);
    const personasBackupFile = path.join(userDirectories.backups, `${getPersonasBackupFilePrefix(handle)}${timestamp}.json`);

    fs.copyFileSync(sourceFile, backupFile);
    if (fs.existsSync(personasSourceFile)) {
        fs.copyFileSync(personasSourceFile, personasBackupFile);
    } else {
        fs.rmSync(personasBackupFile, { force: true });
    }

    removeOldBackups(userDirectories.backups, `settings_${handle}`);
    removeOldBackups(userDirectories.backups, `personas_${handle}`);
}

/**
 * Checks if the backup would be a duplicate.
 * @param {string} handle User handle
 * @param {string} sourceFile Source settings file path
 * @param {string} personasSourceFile Source personas file path
 * @returns {boolean} True if the backup is a duplicate
 */
function isDuplicateBackup(handle, sourceFile, personasSourceFile) {
    const latestBackup = getLatestBackup(handle);
    if (!latestBackup) {
        return false;
    }

    return areFilesEquivalent(latestBackup, sourceFile)
        && areFilesEquivalent(getPairedPersonasBackupPath(handle, latestBackup), personasSourceFile);
}

/**
 * Returns true if the two files are equal.
 * @param {string} file1 File path
 * @param {string} file2 File path
 */
function areFilesEqual(file1, file2) {
    if (!fs.existsSync(file1) || !fs.existsSync(file2)) {
        return false;
    }

    const content1 = fs.readFileSync(file1);
    const content2 = fs.readFileSync(file2);
    return content1.toString() === content2.toString();
}

/**
 * Returns true if both file states match, including when both files are absent.
 * @param {string|null} file1 File path
 * @param {string|null} file2 File path
 * @returns {boolean} True if both files are absent or their contents match
 */
function areFilesEquivalent(file1, file2) {
    const file1Exists = Boolean(file1) && fs.existsSync(file1);
    const file2Exists = Boolean(file2) && fs.existsSync(file2);

    if (!file1Exists && !file2Exists) {
        return true;
    }

    if (!file1Exists || !file2Exists) {
        return false;
    }

    return areFilesEqual(file1, file2);
}

function buildMergedSettingsString(settings, personasDocument) {
    const mergedSettings = mergePersonasIntoSettings(stripPersonaRegistryFromSettings(settings), personasDocument);
    return JSON.stringify(mergedSettings, null, 4);
}

function parseSnapshotSettings(content, label) {
    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to parse ${label}: ${error.message}`);
    }
}

function getSettingsPath(directories) {
    return path.join(directories.root, SETTINGS_FILE);
}

function getSettingsPersonasLockPath(directories) {
    return path.join(directories.root, `${SETTINGS_FILE}.personas.lock`);
}

function isSettingsPersonasLockStale(lockPath) {
    try {
        const stats = fs.statSync(lockPath);
        return Date.now() - stats.mtimeMs > SETTINGS_PERSONAS_LOCK_STALE_MS;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

function removeSettingsPersonasLock(lockPath) {
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

async function acquireSettingsPersonasLock(directories) {
    const lockPath = getSettingsPersonasLockPath(directories);
    const deadline = Date.now() + SETTINGS_PERSONAS_LOCK_TIMEOUT_MS;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    while (true) {
        try {
            fs.mkdirSync(lockPath);
            return () => removeSettingsPersonasLock(lockPath);
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            if (isSettingsPersonasLockStale(lockPath)) {
                removeSettingsPersonasLock(lockPath);
                continue;
            }

            if (Date.now() >= deadline) {
                const timeoutError = new Error('Timed out waiting to update settings and personas.');
                timeoutError.status = 503;
                throw timeoutError;
            }

            await delay(SETTINGS_PERSONAS_LOCK_RETRY_MS);
        }
    }
}

async function withSettingsPersonasLock(directories, operation) {
    const release = await acquireSettingsPersonasLock(directories);

    try {
        return await operation();
    } finally {
        release();
    }
}

function readFileSnapshot(filePath) {
    if (!fs.existsSync(filePath)) {
        return { exists: false, content: null };
    }

    return { exists: true, content: fs.readFileSync(filePath) };
}

function restoreFileSnapshot(filePath, snapshot) {
    if (snapshot.exists) {
        writeFileAtomicSync(filePath, snapshot.content);
        return;
    }

    fs.rmSync(filePath, { force: true });
}

async function withSettingsPersonasTransaction(directories, operation) {
    return await withSettingsPersonasLock(directories, async () => {
        const pathToSettings = getSettingsPath(directories);
        const pathToPersonas = getPersonasPath(directories);
        const settingsSnapshot = readFileSnapshot(pathToSettings);
        const personasSnapshot = readFileSnapshot(pathToPersonas);

        try {
            return await operation({ pathToSettings, pathToPersonas });
        } catch (error) {
            try {
                restoreFileSnapshot(pathToSettings, settingsSnapshot);
                restoreFileSnapshot(pathToPersonas, personasSnapshot);
            } catch (rollbackError) {
                console.error('Failed to rollback settings/personas state:', rollbackError);
                throw rollbackError;
            }

            throw error;
        }
    });
}

function isEmptyPersonasDocument(document) {
    return !Object.keys(document?.personas || {}).length && !document?.defaultPersona;
}

/**
 * Gets the latest backup file for a user.
 * @param {string} handle User handle
 * @returns {string|null} Latest backup file. Null if no backup exists.
 */
function getLatestBackup(handle) {
    const userDirectories = getUserDirectories(handle);
    const backupFiles = fs.readdirSync(userDirectories.backups)
        .filter(x => x.startsWith(getSettingsBackupFilePrefix(handle)))
        .map(x => ({ name: x, ctime: fs.statSync(path.join(userDirectories.backups, x)).ctimeMs }));
    const latestBackup = backupFiles.sort((a, b) => b.ctime - a.ctime)[0]?.name;
    if (!latestBackup) {
        return null;
    }
    return path.join(userDirectories.backups, latestBackup);
}

export const router = express.Router();

router.post('/save', async function (request, response) {
    try {
        const settings = structuredClone(request.body ?? {});
        const personasDocument = buildPersonasDocumentFromLegacySettings(settings);
        const strippedSettings = stripPersonaRegistryFromSettings(settings);

        await withSettingsPersonasTransaction(request.user.directories, ({ pathToSettings }) => {
            writePersonasDocument(request.user.directories, personasDocument);
            writeFileAtomicSync(pathToSettings, JSON.stringify(strippedSettings, null, 4), 'utf8');
        });
        triggerAutoSave(request.user.profile.handle);
        response.send({ result: 'ok' });
    } catch (err) {
        console.error(err);
        response.status(err.status || 500).send({ error: err.message || String(err) });
    }
});

// Wintermute's code
router.post('/get', async (request, response) => {
    let settingsString;
    try {
        settingsString = await withSettingsPersonasLock(request.user.directories, () => {
            const pathToSettings = getSettingsPath(request.user.directories);
            const settings = JSON.parse(fs.readFileSync(pathToSettings, 'utf8'));
            const personasDocument = readOrMigratePersonasDocument(request.user.directories, settings);
            return buildMergedSettingsString(settings, personasDocument);
        });
    } catch (error) {
        console.error('Failed to load settings/personas payload:', error);
        return response.sendStatus(error.status || 500);
    }

    // OpenAI Settings
    const { fileContents: openai_settings, fileNames: openai_setting_names }
        = readPresetsFromDirectory(request.user.directories.openAI_Settings, {
            sortFunction: sortByName(request.user.directories.openAI_Settings), removeFileExtension: true,
        });

    let worldInfoItems = [];
    let world_names = [];
    try {
        worldInfoItems = await listLorebooksForManagement(request.user) ?? [];
        world_names = worldInfoItems.map(item => item.name);
    } catch (error) {
        console.error('Failed to load lorebooks for management:', error);
    }

    const themes = safeRead(() => readAndParseFromDirectory(request.user.directories.themes), [], 'themes');
    const movingUIPresets = safeRead(() => readAndParseFromDirectory(request.user.directories.movingUI), [], 'moving UI presets');
    const quickReplyPresets = safeRead(() => readAndParseFromDirectory(request.user.directories.quickreplies), [], 'quick reply presets');

    const reasoning = safeRead(() => readAndParseFromDirectory(request.user.directories.reasoning), [], 'reasoning presets');

    response.send({
        settings: settingsString,
        world_names,
        world_info_items: worldInfoItems,
        openai_settings,
        openai_setting_names,
        themes,
        movingUIPresets,
        quickReplyPresets,
        reasoning,
        enable_extensions: ENABLE_EXTENSIONS,
        enable_extensions_auto_update: ENABLE_EXTENSIONS_AUTO_UPDATE,
        enable_accounts: ENABLE_ACCOUNTS,
    });
});

// Aikobots config endpoint (just provides a true/false value for aikobotsEnabled from config.yaml)
router.get('/config', (request, response) => {
    try {
        const config = {
            aikobotsEnabled: getConfigValue('enableAikobots', false, 'boolean'),
        };
        return response.send(config);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/get-snapshots', async (request, response) => {
    try {
        const snapshots = fs.readdirSync(request.user.directories.backups);
        const userFilesPattern = getSettingsBackupFilePrefix(request.user.profile.handle);
        const userSnapshots = snapshots.filter(x => x.startsWith(userFilesPattern));

        const result = userSnapshots.map(x => {
            const stat = fs.statSync(path.join(request.user.directories.backups, x));
            return { date: stat.ctimeMs, name: x, size: stat.size };
        });

        response.json(result);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/load-snapshot', getFileNameValidationFunction('name'), async (request, response) => {
    try {
        const userFilesPattern = getSettingsBackupFilePrefix(request.user.profile.handle);

        if (!request.body.name || !request.body.name.startsWith(userFilesPattern)) {
            return response.status(400).send({ error: 'Invalid snapshot name' });
        }

        const snapshotName = request.body.name;
        const snapshotPath = path.join(request.user.directories.backups, snapshotName);
        const personasSnapshotPath = getPairedPersonasBackupPath(request.user.profile.handle, snapshotName);

        if (!fs.existsSync(snapshotPath)) {
            return response.sendStatus(404);
        }

        const settingsContent = fs.readFileSync(snapshotPath, 'utf8');
        const settings = parseSnapshotSettings(settingsContent, `settings snapshot "${snapshotName}"`);
        const personasDocument = fs.existsSync(personasSnapshotPath)
            ? JSON.parse(fs.readFileSync(personasSnapshotPath, 'utf8'))
            : buildPersonasDocumentFromLegacySettings(settings);

        response.send(buildMergedSettingsString(settings, personasDocument));
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/make-snapshot', async (request, response) => {
    try {
        backupUserSettings(request.user.profile.handle, false);
        response.sendStatus(204);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/restore-snapshot', getFileNameValidationFunction('name'), async (request, response) => {
    try {
        const userFilesPattern = getSettingsBackupFilePrefix(request.user.profile.handle);

        if (!request.body.name || !request.body.name.startsWith(userFilesPattern)) {
            return response.status(400).send({ error: 'Invalid snapshot name' });
        }

        const snapshotName = request.body.name;
        const snapshotPath = path.join(request.user.directories.backups, snapshotName);
        const personasSnapshotPath = getPairedPersonasBackupPath(request.user.profile.handle, snapshotName);

        if (!fs.existsSync(snapshotPath)) {
            return response.sendStatus(404);
        }

        const settingsContent = fs.readFileSync(snapshotPath, 'utf8');
        const settings = parseSnapshotSettings(settingsContent, `settings snapshot "${snapshotName}"`);
        const personasDocument = fs.existsSync(personasSnapshotPath)
            ? JSON.parse(fs.readFileSync(personasSnapshotPath, 'utf8'))
            : buildPersonasDocumentFromLegacySettings(settings);
        const strippedSettings = stripPersonaRegistryFromSettings(settings);

        await withSettingsPersonasTransaction(request.user.directories, ({ pathToSettings, pathToPersonas }) => {
            writePersonasDocument(request.user.directories, personasDocument);
            writeFileAtomicSync(pathToSettings, JSON.stringify(strippedSettings, null, 4), 'utf8');
            if (isEmptyPersonasDocument(personasDocument)) {
                fs.rmSync(pathToPersonas, { force: true });
            }
        });

        response.sendStatus(204);
    } catch (error) {
        console.error(error);
        response.sendStatus(error.status || 500);
    }
});

/**
 * Initializes the settings endpoint
 */
export async function init() {
    await backupSettings();
}
