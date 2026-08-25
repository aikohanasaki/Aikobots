import fs from 'node:fs';
import path from 'node:path';

import { read as readCharacterCard } from './character-card-parser.js';
import { getDeduplicatedChatHistoryFileNames } from './chat-paths.js';
import { withChatSaveLock } from './chat-storage.js';
import { SETTINGS_FILE } from './constants.js';
import { readHiddenLorebookBindings } from './hidden-lorebook-bindings.js';
import { readHiddenLorebookTemplates } from './hidden-lorebook-templates.js';
import {
    getCanonicalLorebookName,
    listOrdinaryUserLorebooksForCleanup,
    withLorebookManagementTransaction,
} from './lorebook-repository.js';
import { readPersonasDocument } from './persona-repository.js';
import { withSettingsPersonasLock } from './settings-lock.js';
import { readStmbContextSettingsDocument } from './stmb-context-settings.js';
import { readStmbSidePrompts } from './stmb-side-prompts-repository.js';
import { getChatHeader, loadDb } from './sqlite-manager.js';

export class LorebookCleanupConflictError extends Error {
    constructor(message = 'Lorebook cleanup targets changed. Rescan before deleting.') {
        super(message);
        this.name = 'LorebookCleanupConflictError';
        this.status = 409;
    }
}

function addLorebookName(names, value) {
    const canonicalName = getCanonicalLorebookName(value);
    if (canonicalName) names.add(canonicalName);
}

function addLorebookNames(names, values) {
    for (const value of Array.isArray(values) ? values : []) addLorebookName(names, value);
}

function addWorldInfoSettingsReferences(names, worldInfo) {
    if (!worldInfo || typeof worldInfo !== 'object' || Array.isArray(worldInfo)) return;
    addLorebookNames(names, worldInfo.globalSelect);
    for (const entry of Array.isArray(worldInfo.charLore) ? worldInfo.charLore : []) {
        addLorebookNames(names, entry?.extraBooks);
    }
}

function addStmbStateReferences(names, state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    addLorebookName(names, state.manualLorebook);
    addLorebookNames(names, Object.values(state.manualCharacterLorebooks || {}));
    addLorebookNames(names, Object.values(state.sidePromptLorebookOverrides || {}));
    addLorebookNames(names, (Array.isArray(state.narratorMode?.members) ? state.narratorMode.members : [])
        .map(member => member?.lorebookName));
}

function addChatMetadataReferences(names, metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return;
    addLorebookName(names, metadata.world_info);
    addStmbStateReferences(names, metadata.STMemoryBooks);
}

function readFirstJsonlLine(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
        while (true) {
            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            const chunk = buffer.subarray(0, bytesRead);
            const newlineIndex = chunk.indexOf(0x0A);
            chunks.push(Buffer.from(newlineIndex === -1 ? chunk : chunk.subarray(0, newlineIndex)));
            if (newlineIndex !== -1) break;
        }
    } finally {
        fs.closeSync(descriptor);
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '');
}

async function readChatHeader(filePath) {
    if (path.extname(filePath).toLowerCase() !== '.sqlite') {
        const firstLine = readFirstJsonlLine(filePath);
        return firstLine ? JSON.parse(firstLine) : null;
    }

    return await withChatSaveLock(filePath, async () => {
        const db = await loadDb(filePath);
        try {
            return getChatHeader(db);
        } finally {
            db.close();
        }
    });
}

function listChatFiles(directory, { recursive = false } = {}) {
    if (!fs.existsSync(directory)) return [];
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const files = getDeduplicatedChatHistoryFileNames(entries).map(fileName => path.join(directory, fileName));
    if (!recursive) return files;

    for (const entry of entries) {
        if (entry.isDirectory()) files.push(...listChatFiles(path.join(directory, entry.name), { recursive: true }));
    }
    return files;
}

function addSettingsReferences(names, settings, personas) {
    addWorldInfoSettingsReferences(names, settings?.world_info);
    addWorldInfoSettingsReferences(names, settings?.world_info_settings?.world_info);
    if (typeof settings?.world_info === 'string') addLorebookName(names, settings.world_info);
    if (Array.isArray(settings?.world_info)) addLorebookNames(names, settings.world_info);
    addLorebookName(names, settings?.power_user?.persona_description_lorebook);
    for (const descriptor of Object.values(settings?.power_user?.persona_descriptions || {})) {
        addLorebookName(names, descriptor?.lorebook);
    }

    for (const lock of Object.values(settings?.stmb_settings?.characterMemoryBookLocks || {})) {
        addLorebookName(names, lock?.lorebookName);
    }
    for (const lock of Object.values(settings?.extension_settings?.STMemoryBooks?.characterMemoryBookLocks || {})) {
        addLorebookName(names, lock?.lorebookName);
    }
    for (const preset of settings?.extension_settings?.worldInfoPresets?.presetList || []) {
        addLorebookNames(names, preset?.worldList);
    }
    for (const persona of Object.values(personas?.personas || {})) addLorebookName(names, persona?.lorebook);
}

function addHiddenReferences(names) {
    const bindings = readHiddenLorebookBindings({ throwOnError: true });
    addLorebookNames(names, bindings.global);
    for (const values of Object.values(bindings.characters || {})) addLorebookNames(names, values);

    const templates = readHiddenLorebookTemplates({ throwOnError: true });
    addLorebookNames(names, templates.global?.add);
    addLorebookNames(names, templates.global?.remove);
    for (const template of Object.values(templates.templates || {})) {
        addLorebookNames(names, template?.add);
        addLorebookNames(names, template?.remove);
    }
    for (const character of Object.values(templates.characters || {})) {
        addLorebookNames(names, character?.add);
        addLorebookNames(names, character?.remove);
    }
}

function addStmbConfigurationReferences(names, user) {
    const contextDocument = readStmbContextSettingsDocument(user);
    for (const setting of Object.values(contextDocument.settings || {})) {
        for (const entry of Array.isArray(setting?.entries) ? setting.entries : []) addLorebookName(names, entry?.lorebookName);
    }

    const sidePrompts = readStmbSidePrompts(user).document;
    for (const prompt of Object.values(sidePrompts?.prompts || {})) {
        addLorebookName(names, prompt?.settings?.lorebook?.targetLorebookName);
    }
}

/** Collects canonical lorebook names referenced by the current user's durable data. */
export async function collectReferencedLorebookNames(user) {
    const names = new Set();
    await withSettingsPersonasLock(user.directories, async () => {
        const settingsPath = path.join(user.directories.root, SETTINGS_FILE);
        const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
        addSettingsReferences(names, settings, readPersonasDocument(user.directories));
    });

    if (fs.existsSync(user.directories.characters)) {
        for (const entry of fs.readdirSync(user.directories.characters, { withFileTypes: true })) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.png') continue;
            const character = JSON.parse(readCharacterCard(fs.readFileSync(path.join(user.directories.characters, entry.name))));
            addLorebookName(names, character?.data?.extensions?.world);
            addLorebookNames(names, character?.data?.extensions?.aikobots?.secure_lorebooks);
        }
    }

    const chatFiles = [
        ...listChatFiles(user.directories.chats, { recursive: true }),
        ...listChatFiles(user.directories.groupChats),
    ];
    for (const filePath of chatFiles) addChatMetadataReferences(names, (await readChatHeader(filePath))?.chat_metadata);

    if (fs.existsSync(user.directories.groups)) {
        for (const entry of fs.readdirSync(user.directories.groups, { withFileTypes: true })) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
            const group = JSON.parse(fs.readFileSync(path.join(user.directories.groups, entry.name), 'utf8'));
            addChatMetadataReferences(names, group?.chat_metadata);
            for (const metadata of Object.values(group?.past_metadata || {})) addChatMetadataReferences(names, metadata);
        }
    }

    addHiddenReferences(names);
    addStmbConfigurationReferences(names, user);
    return names;
}

function listOrdinaryLorebookCandidates(user) {
    return listOrdinaryUserLorebooksForCleanup(user);
}

/** Lists ordinary user lorebooks that have no known durable references. */
export async function listUnboundUserLorebooks(user) {
    const referencedNames = await collectReferencedLorebookNames(user);
    return listOrdinaryLorebookCandidates(user).filter(item => !referencedNames.has(item.name));
}

/** Revalidates and deletes an all-or-nothing batch of ordinary unbound lorebooks. */
export async function deleteUnboundUserLorebooks(user, names) {
    const targets = [...new Set((Array.isArray(names) ? names : []).map(getCanonicalLorebookName).filter(Boolean))];
    if (targets.length === 0) throw new LorebookCleanupConflictError();

    return await withLorebookManagementTransaction(async transaction => {
        let candidates;
        try {
            candidates = await listUnboundUserLorebooks(user);
        } catch {
            throw new LorebookCleanupConflictError();
        }
        const available = new Map(candidates.map(item => [item.name, item]));
        if (targets.some(name => !available.has(name))) throw new LorebookCleanupConflictError();

        const deleted = [];
        for (const name of targets) {
            if (!transaction.removeCreatedUser(user, name)) throw new LorebookCleanupConflictError();
            deleted.push(name);
        }
        return deleted;
    });
}
