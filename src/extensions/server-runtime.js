import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PUBLIC_DIRECTORIES } from '../constants.js';
import { canLoadUserThirdPartyExtension } from '../extension-policy.js';
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
const moduleLoadPromises = new Map();
const MAX_MODULE_CACHE_SIZE = 100;

/** Reduces extension failures to non-content-bearing diagnostics. */
function getSafeExtensionError(error) {
    return {
        name: String(error?.name || 'Error'),
        code: typeof error?.code === 'string' || typeof error?.code === 'number' ? String(error.code) : undefined,
        status: Number.isInteger(Number(error?.status)) ? Number(error.status) : undefined,
    };
}

function isDirectory(filePath) {
    try {
        return fs.statSync(filePath).isDirectory();
    } catch {
        return false;
    }
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
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
    if (!manifest) {
        return null;
    }

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

function discoverServerExtensions(directories, extensionSettings = {}, user = null) {
    const discovered = new Map();

    for (const entryRoot of getExtensionRoots(directories)) {
        if (!isDirectory(entryRoot.root)) {
            continue;
        }

        const dirEntries = fs.readdirSync(entryRoot.root, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .filter(dirent => !(entryRoot.scope === 'system' && dirent.name === 'third-party'));

        for (const dirent of dirEntries) {
            if (entryRoot.scope === 'local' && !canLoadUserThirdPartyExtension(user, dirent.name)) {
                continue;
            }

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
        .sort((a, b) => getLoadingOrder(a) - getLoadingOrder(b) || entryName(a).localeCompare(entryName(b)));
}

function entryName(entry) {
    return String(entry.manifest.display_name || entry.settingsKey || entry.id);
}

function getLoadingOrder(entry) {
    const loadingOrder = Number(entry?.manifest?.loading_order);
    return Number.isFinite(loadingOrder) ? loadingOrder : 0;
}

function pruneModuleCache(serverEntryPath) {
    const cachePrefix = `${serverEntryPath}:`;

    for (const key of Array.from(moduleCache.keys())) {
        if (key.startsWith(cachePrefix)) {
            moduleCache.delete(key);
        }
    }

    while (moduleCache.size >= MAX_MODULE_CACHE_SIZE) {
        const firstKey = moduleCache.keys().next().value;
        if (!firstKey) {
            break;
        }
        moduleCache.delete(firstKey);
    }
}

async function loadServerExtension(entry) {
    const stat = fs.statSync(entry.serverEntryPath);
    const cacheKey = `${entry.serverEntryPath}:${stat.mtimeMs}`;
    if (moduleCache.has(cacheKey)) {
        const cached = moduleCache.get(cacheKey);
        moduleCache.delete(cacheKey);
        moduleCache.set(cacheKey, cached);
        return cached;
    }

    if (moduleLoadPromises.has(cacheKey)) {
        return moduleLoadPromises.get(cacheKey);
    }

    const loadPromise = (async () => {
        pruneModuleCache(entry.serverEntryPath);

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

        try {
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
        } catch (error) {
            console.error(`[server-runtime] Failed to load extension ${entry.id}:`, getSafeExtensionError(error));
        }

        moduleCache.set(cacheKey, definition);
        return definition;
    })();

    moduleLoadPromises.set(cacheKey, loadPromise);

    try {
        return await loadPromise;
    } finally {
        if (moduleLoadPromises.get(cacheKey) === loadPromise) {
            moduleLoadPromises.delete(cacheKey);
        }
    }
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

    for (let index = chat.length - 1; index >= 0; index--) {
        const item = chat[index];
        if (!item || item.extra?.ignore) {
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
        const originApi = item.extra?.api;
        const originModel = item.extra?.model;
        const sameModel = originApi === promptContext.chatCompletionSource && originModel === promptContext.model;
        const invocations = Array.isArray(item.extra?.tool_invocations)
            ? structuredClone(item.extra.tool_invocations)
            : item.extra?.tool_invocations;
        if (Array.isArray(invocations) && !sameModel) {
            for (const invocation of invocations) {
                if (invocation && typeof invocation === 'object') {
                    delete invocation.signature;
                }
            }
        }

        messages.push({
            role,
            content,
            name: item.name,
            media,
            mediaDisplay,
            mediaIndex,
            invocations,
            signature: sameModel ? item.extra?.reasoning_signature : null,
            claude_tool_turn_blocks: sameModel && promptContext.chatCompletionSource === 'claude'
                ? structuredClone(item.extra?.claude_tool_turn_blocks || null)
                : null,
        });
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

function normalizeMacroName(name) {
    if (typeof name !== 'string') {
        return '';
    }

    const trimmed = name.trim();
    if (!trimmed || trimmed.startsWith('{{') || trimmed.endsWith('}}')) {
        return '';
    }

    return trimmed;
}

function registerRuntimeMacro(macroState, name, value) {
    const normalizedName = normalizeMacroName(name);
    if (!normalizedName) {
        return false;
    }

    macroState.registeredValues[normalizedName] = value;
    return true;
}

function removeRuntimeMacro(macroState, name) {
    const normalizedName = normalizeMacroName(name);
    if (!normalizedName) {
        return false;
    }

    return delete macroState.registeredValues[normalizedName];
}

function applyMacroProviderResult(macroState, result) {
    if (!result) {
        return;
    }

    const entries = result instanceof Map
        ? Array.from(result.entries())
        : Array.isArray(result)
            ? result.filter(item => Array.isArray(item) && item.length >= 2).map(([key, value]) => [key, value])
            : typeof result === 'object'
                ? Object.entries(result)
                : [];

    for (const [key, value] of entries) {
        registerRuntimeMacro(macroState, key, value);
    }
}

export async function runServerGenerationExtensions(directories, promptContext, user = null) {
    if (!promptContext || typeof promptContext !== 'object') {
        return { aborted: false, executedExtensions: [] };
    }

    const extensionSettings = promptContext.extensionSettings || {};
    const manifestEntries = discoverServerExtensions(directories, extensionSettings, user);
    if (!manifestEntries.length) {
        rebuildPromptContextFromCoreChat(promptContext);
        return { aborted: false, executedExtensions: [] };
    }

    const env = createRuntimeEnv(promptContext);
    const macroState = createMacroState(promptContext.macroSnapshot || {}, promptContext.extensionPrompts || {});
    const executedExtensions = [];
    let aborted = false;
    let exitImmediately = false;

    const setExtensionPrompt = makeSetExtensionPrompt(promptContext, macroState);
    const removeExtensionPrompt = makeRemoveExtensionPrompt(promptContext, macroState);

    try {
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
                chat: Array.isArray(promptContext.coreChat) ? structuredClone(promptContext.coreChat) : [],
                currentChatId: promptContext.currentChatId || '',
                selectedGroup: Boolean(promptContext.selectedGroup),
                groupId: promptContext.groupId ?? null,
                groupName: promptContext.groupName || '',
                groupNames: Array.isArray(promptContext.groupNames) ? [...promptContext.groupNames] : [],
                groupMembers: Array.isArray(promptContext.groupMembers) ? structuredClone(promptContext.groupMembers) : [],
                disabledGroupMembers: Array.isArray(promptContext.groupMembers)
                    ? promptContext.groupMembers.filter(member => member?.disabled === true).map(member => String(member.avatar || ''))
                    : [],
                contextSize: Number(promptContext.worldInfoRequest?.maxContext) || 0,
                type: promptContext.type || 'normal',
                extensionSettings,
                settings: extensionSettings[entry.settingsKey] || extensionSettings[entry.id] || {},
                getSettings(name = entry.settingsKey) {
                    const requestedName = typeof name === 'string' ? name : entry.settingsKey;
                    const isCurrentExtension = requestedName === entry.settingsKey || requestedName === entry.id;
                    if (isCurrentExtension) {
                        return extensionSettings[entry.settingsKey] || extensionSettings[entry.id] || {};
                    }

                    return extensionSettings[requestedName] || {};
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
                registerMacro(name, value) {
                    return registerRuntimeMacro(macroState, name, value);
                },
                removeMacro(name) {
                    return removeRuntimeMacro(macroState, name);
                },
                getMacro(name) {
                    const normalizedName = normalizeMacroName(name);
                    if (!normalizedName) {
                        return undefined;
                    }

                    return macroState.registeredValues[normalizedName] ?? macroState.values[normalizedName];
                },
                getMacros() {
                    return {
                        ...macroState.values,
                        ...macroState.registeredValues,
                    };
                },
                substituteParams(content, additional = {}) {
                    refreshMacroOutletValues(macroState, promptContext.extensionPrompts || {});
                    return evaluatePromptMacros(String(content ?? ''), env, { additional, macroState });
                },
            };

            for (const provider of definition.macroProviders) {
                try {
                    const result = await provider(context);
                    applyMacroProviderResult(macroState, result);
                } catch (error) {
                    console.error(`[server-runtime] Macro provider failed for ${entry.id}:`, getSafeExtensionError(error));
                }
                if (exitImmediately) {
                    break;
                }
            }

            if (!exitImmediately) {
                for (const provider of definition.promptProviders) {
                    try {
                        await provider(context);
                    } catch (error) {
                        console.error(`[server-runtime] Prompt provider failed for ${entry.id}:`, getSafeExtensionError(error));
                    }
                    if (exitImmediately) {
                        break;
                    }
                }
            }

            if (!exitImmediately) {
                for (const interceptor of definition.generationInterceptors) {
                    try {
                        await interceptor(context);
                    } catch (error) {
                        console.error(`[server-runtime] Generation interceptor failed for ${entry.id}:`, getSafeExtensionError(error));
                    }
                    if (exitImmediately) {
                        break;
                    }
                }
            }

            if (exitImmediately) {
                break;
            }
        }
    } finally {
        if (Array.isArray(promptContext.coreChat)) {
            rebuildPromptContextFromCoreChat(promptContext);
        }
    }

    return {
        aborted,
        executedExtensions,
    };
}
