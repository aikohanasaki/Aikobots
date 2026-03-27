import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PUBLIC_DIRECTORIES } from '../constants.js';
import { createMacroState, evaluatePromptMacros, refreshMacroOutletValues } from '../prompting/macro-evaluator.js';

const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

const extension_prompt_types = {
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

const character_names_behavior = {
    NONE: -1,
    DEFAULT: 0,
    COMPLETION: 1,
    CONTENT: 2,
};

const NARRATOR_MESSAGE_TYPE = 'narrator';
const moduleCache = new Map();

function isDirectory(filePath) {
    try {
        return fs.statSync(filePath).isDirectory();
    } catch {
        return false;
    }
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getExtensionRoots(directories) {
    return [
        { root: path.resolve(PUBLIC_DIRECTORIES.extensions), scope: 'system', prefix: '' },
        { root: path.resolve(PUBLIC_DIRECTORIES.globalExtensions), scope: 'global', prefix: 'third-party/' },
        { root: path.resolve(directories.extensions), scope: 'local', prefix: 'third-party/' },
    ];
}

function getServerEntryPath(extensionPath, manifest) {
    const candidates = [];
    if (typeof manifest.server_js === 'string' && manifest.server_js.trim()) {
        candidates.push(manifest.server_js.trim());
    }

    candidates.push('server.js', 'server.mjs');

    const extensionRoot = path.resolve(extensionPath);
    for (const candidate of candidates) {
        const resolved = path.resolve(extensionRoot, candidate);
        const isInsideRoot = resolved === extensionRoot || resolved.startsWith(`${extensionRoot}${path.sep}`);
        if (!isInsideRoot) {
            continue;
        }

        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            return resolved;
        }
    }

    return null;
}

function getManifestEntry(entryRoot, directoryEntry) {
    const extensionPath = path.join(entryRoot.root, directoryEntry.name);
    const manifestPath = path.join(extensionPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    const manifest = readJson(manifestPath);
    const serverEntryPath = getServerEntryPath(extensionPath, manifest);
    if (!serverEntryPath) {
        return null;
    }

    return {
        id: `${entryRoot.prefix}${directoryEntry.name}`,
        settingsKey: directoryEntry.name,
        extensionPath,
        manifest,
        serverEntryPath,
        scope: entryRoot.scope,
    };
}

function discoverServerExtensions(directories, extensionSettings = {}) {
    const discovered = new Map();

    for (const entryRoot of getExtensionRoots(directories)) {
        if (!isDirectory(entryRoot.root)) {
            continue;
        }

        const dirEntries = fs.readdirSync(entryRoot.root, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .filter(dirent => !(entryRoot.scope === 'system' && dirent.name === 'third-party'));

        for (const dirent of dirEntries) {
            const manifestEntry = getManifestEntry(entryRoot, dirent);
            if (!manifestEntry) {
                continue;
            }

            discovered.set(manifestEntry.id, manifestEntry);
        }
    }

    const disabled = new Set(Array.isArray(extensionSettings.disabledExtensions) ? extensionSettings.disabledExtensions : []);
    const manifests = Array.from(discovered.values());
    const availableNames = new Set(manifests.flatMap(entry => [entry.id, entry.settingsKey]));

    return manifests
        .filter(entry => !disabled.has(entry.id) && !disabled.has(entry.settingsKey))
        .filter(entry => {
            const deps = Array.isArray(entry.manifest.dependencies) ? entry.manifest.dependencies : [];
            return deps.every(dep => availableNames.has(dep) && !disabled.has(dep));
        })
        .sort((a, b) => Number(a.manifest.loading_order || 0) - Number(b.manifest.loading_order || 0) || entryName(entry).localeCompare(entryName(b)));
}

function entryName(entry) {
    return String(entry.manifest.display_name || entry.settingsKey || entry.id);
}

async function loadServerExtension(entry) {
    const stat = fs.statSync(entry.serverEntryPath);
    const cacheKey = `${entry.serverEntryPath}:${stat.mtimeMs}`;
    if (moduleCache.has(cacheKey)) {
        return moduleCache.get(cacheKey);
    }

    const definition = {
        generationInterceptors: [],
        promptProviders: [],
        macroProviders: [],
    };

    const registrationApi = {
        registerGenerationInterceptor(interceptor) {
            if (typeof interceptor === 'function') {
                definition.generationInterceptors.push(interceptor);
            }
        },
        registerPromptProvider(provider) {
            if (typeof provider === 'function') {
                definition.promptProviders.push(provider);
            }
        },
        registerMacroProvider(provider) {
            if (typeof provider === 'function') {
                definition.macroProviders.push(provider);
            }
        },
    };

    const moduleUrl = `${pathToFileURL(entry.serverEntryPath).href}?mtime=${stat.mtimeMs}`;
    const imported = await import(moduleUrl);
    const setup = imported.setup || imported.register || imported.default;

    if (typeof setup === 'function') {
        await setup(registrationApi, {
            id: entry.id,
            settingsKey: entry.settingsKey,
            manifest: entry.manifest,
            scope: entry.scope,
        });
    } else {
        if (Array.isArray(imported.generationInterceptors)) {
            for (const interceptor of imported.generationInterceptors) {
                registrationApi.registerGenerationInterceptor(interceptor);
            }
        }

        if (Array.isArray(imported.promptProviders)) {
            for (const provider of imported.promptProviders) {
                registrationApi.registerPromptProvider(provider);
            }
        }

        if (Array.isArray(imported.macroProviders)) {
            for (const provider of imported.macroProviders) {
                registrationApi.registerMacroProvider(provider);
            }
        }
    }

    moduleCache.set(cacheKey, definition);
    return definition;
}

function createRuntimeEnv(promptContext) {
    const groupMacroValues = promptContext.groupMacroValues || {};
    const groupNames = Array.isArray(promptContext.groupNames) ? promptContext.groupNames : [];

    return {
        user: promptContext.userName || '',
        char: promptContext.charName || promptContext.name2 || '',
        charIfNotGroup: groupMacroValues.group || (groupNames.length ? groupNames.join(', ') : (promptContext.charName || promptContext.name2 || '')),
        group: groupMacroValues.group || groupNames.join(', '),
        groupNotMuted: groupMacroValues.groupNotMuted || groupNames.join(', '),
        notChar: groupMacroValues.notChar || promptContext.userName || '',
    };
}

function buildOpenAIMessagesFromCoreChat(promptContext) {
    const chat = Array.isArray(promptContext.coreChat) ? promptContext.coreChat : [];
    const messages = [];
    const namesBehavior = Number(promptContext.oaiSettings?.names_behavior);
    const wrapInQuotes = Boolean(promptContext.oaiSettings?.wrap_in_quotes);
    const selectedGroup = Boolean(promptContext.selectedGroup);
    const userName = promptContext.userName || '';
    let j = 0;

    for (let index = chat.length - 1; index >= 0; index--) {
        const item = chat[j];
        if (!item || item.extra?.ignore) {
            j++;
            continue;
        }

        let role = item.is_user ? 'user' : 'assistant';
        let content = String(item.mes || '');

        if (item.extra?.type === NARRATOR_MESSAGE_TYPE) {
            role = 'system';
        }

        switch (namesBehavior) {
            case character_names_behavior.DEFAULT:
                if ((selectedGroup && item.name !== userName) || (item.force_avatar && item.name !== userName && item.extra?.type !== NARRATOR_MESSAGE_TYPE)) {
                    content = `${item.name}: ${content}`;
                }
                break;
            case character_names_behavior.CONTENT:
                if (item.extra?.type !== NARRATOR_MESSAGE_TYPE) {
                    content = `${item.name}: ${content}`;
                }
                break;
            default:
                break;
        }

        content = content.replace(/\r/gm, '');

        if (role === 'user' && wrapInQuotes) {
            content = `"${content}"`;
        }

        const media = item.extra?.media;
        const mediaDisplayValue = item.extra?.media_display || item.mediaDisplay || promptContext.powerUser?.media_display || 'list';
        const mediaDisplay = ['list', 'gallery'].includes(mediaDisplayValue) ? mediaDisplayValue : 'list';
        const mediaIndexValue = Number(item.extra?.media_index ?? item.mediaIndex);
        const mediaIndex = Array.isArray(media) && Number.isInteger(mediaIndexValue) && mediaIndexValue >= 0 && mediaIndexValue < media.length
            ? mediaIndexValue
            : 0;

        messages[index] = {
            role,
            content,
            name: item.name,
            media,
            mediaDisplay,
            mediaIndex,
            invocations: item.extra?.tool_invocations,
        };
        j++;
    }

    return messages;
}

function rebuildPromptContextFromCoreChat(promptContext) {
    if (!Array.isArray(promptContext.coreChat)) {
        return;
    }

    promptContext.messages = buildOpenAIMessagesFromCoreChat(promptContext);

    if (promptContext.worldInfoRequest && typeof promptContext.worldInfoRequest === 'object') {
        const includeNames = Boolean(promptContext.worldInfoRequest.includeNames);
        promptContext.worldInfoRequest.chat = promptContext.coreChat
            .map(message => includeNames ? `${message.name}: ${message.mes}` : message.mes)
            .reverse();
    }
}

function makeSetExtensionPrompt(promptContext, macroState) {
    return (key, value, position = extension_prompt_types.IN_PROMPT, depth = 0, scan = false, role = extension_prompt_roles.SYSTEM, filter = null) => {
        if (!promptContext.extensionPrompts || typeof promptContext.extensionPrompts !== 'object') {
            promptContext.extensionPrompts = {};
        }

        const stringValue = String(value ?? '');
        promptContext.extensionPrompts[key] = {
            value: stringValue,
            resolvedValue: stringValue,
            position,
            depth,
            scan,
            role,
            filter,
        };

        refreshMacroOutletValues(macroState, promptContext.extensionPrompts);
        return promptContext.extensionPrompts[key];
    };
}

function makeRemoveExtensionPrompt(promptContext, macroState) {
    return (key) => {
        if (promptContext.extensionPrompts && typeof promptContext.extensionPrompts === 'object') {
            delete promptContext.extensionPrompts[key];
            refreshMacroOutletValues(macroState, promptContext.extensionPrompts);
        }
    };
}

export async function runServerGenerationExtensions(directories, promptContext) {
    if (!promptContext || typeof promptContext !== 'object') {
        return { aborted: false, executedExtensions: [] };
    }

    const extensionSettings = promptContext.extensionSettings || {};
    const manifestEntries = discoverServerExtensions(directories, extensionSettings);
    if (!manifestEntries.length) {
        return { aborted: false, executedExtensions: [] };
    }

    const env = createRuntimeEnv(promptContext);
    const macroState = createMacroState(promptContext.macroSnapshot || {}, promptContext.extensionPrompts || {});
    const executedExtensions = [];
    let aborted = false;
    let exitImmediately = false;

    const setExtensionPrompt = makeSetExtensionPrompt(promptContext, macroState);
    const removeExtensionPrompt = makeRemoveExtensionPrompt(promptContext, macroState);

    for (const entry of manifestEntries) {
        const definition = await loadServerExtension(entry);
        if (!definition.generationInterceptors.length && !definition.promptProviders.length && !definition.macroProviders.length) {
            continue;
        }

        executedExtensions.push(entry.id);

        const context = {
            id: entry.id,
            settingsKey: entry.settingsKey,
            manifest: entry.manifest,
            directories,
            promptContext,
            chat: Array.isArray(promptContext.coreChat) ? promptContext.coreChat : [],
            currentChatId: promptContext.currentChatId || '',
            contextSize: Number(promptContext.worldInfoRequest?.maxContext) || 0,
            type: promptContext.type || 'normal',
            extensionSettings,
            settings: extensionSettings[entry.settingsKey] || extensionSettings[entry.id] || {},
            getSettings(name = entry.settingsKey) {
                return extensionSettings[name] || extensionSettings[entry.id] || {};
            },
            getExtensionPrompt(key) {
                return promptContext.extensionPrompts?.[key] || null;
            },
            setExtensionPrompt,
            removeExtensionPrompt,
            abort(immediately = false) {
                aborted = true;
                exitImmediately = Boolean(immediately);
            },
            substituteParams(content, additional = {}) {
                refreshMacroOutletValues(macroState, promptContext.extensionPrompts || {});
                return evaluatePromptMacros(String(content ?? ''), env, { additional, macroState });
            },
        };

        for (const provider of definition.promptProviders) {
            await provider(context);
            if (exitImmediately) {
                break;
            }
        }

        if (!exitImmediately) {
            for (const interceptor of definition.generationInterceptors) {
                await interceptor(context);
                if (exitImmediately) {
                    break;
                }
            }
        }

        if (exitImmediately) {
            break;
        }
    }

    if (Array.isArray(promptContext.coreChat)) {
        rebuildPromptContextFromCoreChat(promptContext);
    }

    return {
        aborted,
        executedExtensions,
    };
}
