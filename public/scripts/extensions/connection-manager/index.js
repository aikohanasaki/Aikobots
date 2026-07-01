import { DOMPurify, Fuse } from '../../../lib.js';

import { event_types, eventSource, main_api, online_status, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { callGenericPopup, Popup, POPUP_RESULT, POPUP_TYPE } from '../../popup.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { SlashCommandAbortController } from '../../slash-commands/SlashCommandAbortController.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders, enumIcons } from '../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandDebugController } from '../../slash-commands/SlashCommandDebugController.js';
import { enumTypes, SlashCommandEnumValue } from '../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommandScope } from '../../slash-commands/SlashCommandScope.js';
import { collapseSpaces, getUniqueName, isFalseBoolean, uuidv4, waitUntilCondition } from '../../utils.js';
import { t } from '../../i18n.js';
import { getSecretLabelById } from '../../secrets.js';
import { oai_settings } from '../../openai.js';

const MODULE_NAME = 'connection-manager';
const NONE = '<None>';
const EMPTY = '<Empty>';
const PROMPT_POST_PROCESSING_COMMAND = 'prompt-post-processing';
const PROMPT_POST_PROCESSING_DISABLED_TITLE = 'changing this is disabled by "Use Global Prompt Post-Processing Modes".';
const CONNECTION_PROFILE_DEBUG_PREFIX = '[ConnectionProfileDebug]';
const CONNECTION_PROFILE_DEBUG_GRACE_MS = 10_000;
const CONNECTION_PROFILE_DEBUG_MAX_BODY_LENGTH = 5_000;
const CONNECTION_PROFILE_DEBUG_REDACTED = '[redacted]';
const CONNECTION_PROFILE_DEBUG_TRUNCATED = '[truncated]';

const CONNECTION_PROFILE_DEBUG_SENSITIVE_KEYS = [
    'authorization',
    'cookie',
    'csrf',
    'key',
    'secret',
    'token',
    'password',
    'auth',
];

const CONNECTION_PROFILE_DEBUG_TEXT_KEYS = [
    'chat',
    'content',
    'entries',
    'entry',
    'message',
    'messages',
    'prompt',
    'text',
    'world_info',
    'worldinfo',
];

const DEFAULT_SETTINGS = {
    profiles: [],
    selectedProfile: null,
};

// Commands that can record an empty value into the profile
const ALLOW_EMPTY = [
    'stop-strings',
    'start-reply-with',
];

const CC_COMMANDS = [
    'api',
    'preset',
    // Do not fix; CC needs to set the API twice because it could be overridden by the preset
    'api',
    'api-url',
    'model',
    'proxy',
    'stop-strings',
    'start-reply-with',
    'reasoning-template',
    'prompt-post-processing',
    'secret-id',
    'regex-preset',
];

const TC_COMMANDS = [
    'api',
    'preset',
    'api-url',
    'model',
    'tokenizer',
    'stop-strings',
    'start-reply-with',
    'reasoning-template',
    'secret-id',
    'regex-preset',
];

const FANCY_NAMES = {
    'api': 'API',
    'api-url': 'Server URL',
    'preset': 'Settings Preset',
    'model': 'Model',
    'proxy': 'Proxy Preset',
    'tokenizer': 'Tokenizer',
    'stop-strings': 'Custom Stopping Strings',
    'start-reply-with': 'Start Reply With',
    'reasoning-template': 'Reasoning Template',
    [PROMPT_POST_PROCESSING_COMMAND]: 'Prompt Post-Processing',
    'secret-id': 'Secret',
    'regex-preset': 'Regex Preset',
};

function isGlobalPromptPostProcessingEnabled() {
    return Boolean(oai_settings.use_global_prompt_post_processing_modes);
}

function shouldSkipPromptPostProcessingCommand(command) {
    return command === PROMPT_POST_PROCESSING_COMMAND && isGlobalPromptPostProcessingEnabled();
}

/**
 * Disables profile Prompt Post-Processing controls while the global override owns the setting.
 * @param {JQuery<HTMLElement>} template Connection profile popup template
 */
function disablePromptPostProcessingProfileControls(template) {
    if (!isGlobalPromptPostProcessingEnabled()) {
        return;
    }

    template.find('input[name="exclude"]').filter(function () {
        return String($(this).val()) === FANCY_NAMES[PROMPT_POST_PROCESSING_COMMAND];
    }).prop('disabled', true)
        .attr('title', PROMPT_POST_PROCESSING_DISABLED_TITLE)
        .closest('label')
        .attr('title', PROMPT_POST_PROCESSING_DISABLED_TITLE);
}

/**
 * A wrapper for the connection manager spinner.
 */
class ConnectionManagerSpinner {
    /**
     * @type {AbortController[]}
     */
    static abortControllers = [];

    /** @type {HTMLElement} */
    spinnerElement;

    /** @type {AbortController} */
    abortController = new AbortController();

    constructor() {
        // @ts-ignore
        this.spinnerElement = document.getElementById('connection_profile_spinner');
        this.abortController = new AbortController();
    }

    start() {
        ConnectionManagerSpinner.abortControllers.push(this.abortController);
        this.spinnerElement.classList.remove('hidden');
    }

    stop() {
        this.spinnerElement.classList.add('hidden');
    }

    isAborted() {
        return this.abortController.signal.aborted;
    }

    static abort() {
        for (const controller of ConnectionManagerSpinner.abortControllers) {
            controller.abort();
        }
        ConnectionManagerSpinner.abortControllers = [];
    }
}

/**
 * Get named arguments for the command callback.
 * @param {object} [args] Additional named arguments
 * @param {string} [args.force] Whether to force setting the value
 * @returns {object} Named arguments
 */
function getNamedArguments(args = {}) {
    // None of the commands here use underscored args, but better safe than sorry
    return {
        _scope: new SlashCommandScope(),
        _abortController: new SlashCommandAbortController(),
        _debugController: new SlashCommandDebugController(),
        _parserFlags: {},
        _hasUnnamedArgument: false,
        quiet: 'true',
        ...args,
    };
}

/** @type {() => SlashCommandEnumValue[]} */
const profilesProvider = () => [
    new SlashCommandEnumValue(NONE),
    ...extension_settings.connectionManager.profiles.map(p => new SlashCommandEnumValue(p.name, null, enumTypes.name, enumIcons.server)),
];

function isConnectionProfileDebugSensitiveKey(key) {
    const normalizedKey = String(key || '').toLowerCase();
    return CONNECTION_PROFILE_DEBUG_SENSITIVE_KEYS.some(part => normalizedKey.includes(part));
}

function isConnectionProfileDebugTextKey(key) {
    const normalizedKey = String(key || '').toLowerCase();
    return CONNECTION_PROFILE_DEBUG_TEXT_KEYS.some(part => normalizedKey.includes(part));
}

function truncateConnectionProfileDebugString(value) {
    if (value.length <= CONNECTION_PROFILE_DEBUG_MAX_BODY_LENGTH) {
        return value;
    }

    return `${value.slice(0, CONNECTION_PROFILE_DEBUG_MAX_BODY_LENGTH)} ${CONNECTION_PROFILE_DEBUG_TRUNCATED} ${value.length} chars`;
}

function redactConnectionProfileDebugHeaders(headers) {
    if (!headers) {
        return {};
    }

    const entries = headers instanceof Headers
        ? Array.from(headers.entries())
        : Array.isArray(headers)
            ? headers
            : Object.entries(headers);

    return entries.reduce((acc, [key, value]) => {
        acc[key] = isConnectionProfileDebugSensitiveKey(key)
            ? CONNECTION_PROFILE_DEBUG_REDACTED
            : redactConnectionProfileDebugValue(value, key);
        return acc;
    }, {});
}

function redactConnectionProfileDebugValue(value, key = '', seen = new WeakSet()) {
    if (isConnectionProfileDebugSensitiveKey(key)) {
        return CONNECTION_PROFILE_DEBUG_REDACTED;
    }

    if (typeof value === 'string') {
        if (isConnectionProfileDebugTextKey(key)) {
            return value ? `${CONNECTION_PROFILE_DEBUG_REDACTED} ${value.length} chars` : '';
        }

        return truncateConnectionProfileDebugString(value);
    }

    if (value === null || value === undefined || typeof value !== 'object') {
        return value;
    }

    if (value instanceof Headers) {
        return redactConnectionProfileDebugHeaders(value);
    }

    if (value instanceof FormData) {
        const formData = {};
        for (const [formKey, formValue] of value.entries()) {
            formData[formKey] = formValue instanceof File
                ? { name: formValue.name, size: formValue.size, type: formValue.type }
                : redactConnectionProfileDebugValue(String(formValue), formKey, seen);
        }
        return formData;
    }

    if (value instanceof URLSearchParams) {
        const params = {};
        for (const [paramKey, paramValue] of value.entries()) {
            params[paramKey] = redactConnectionProfileDebugValue(paramValue, paramKey, seen);
        }
        return params;
    }

    if (value instanceof Blob) {
        return { type: value.type, size: value.size };
    }

    if (value instanceof ArrayBuffer) {
        return { type: 'ArrayBuffer', byteLength: value.byteLength };
    }

    if (ArrayBuffer.isView(value)) {
        return { type: value.constructor.name, byteLength: value.byteLength };
    }

    if (seen.has(value)) {
        return '[circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => redactConnectionProfileDebugValue(item, key, seen));
    }

    return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
        acc[entryKey] = redactConnectionProfileDebugValue(entryValue, entryKey, seen);
        return acc;
    }, {});
}

function parseConnectionProfileDebugBodyText(text) {
    if (!text) {
        return '';
    }

    try {
        return redactConnectionProfileDebugValue(JSON.parse(text));
    } catch {
        return truncateConnectionProfileDebugString(text);
    }
}

function getConnectionProfileDebugRequestBody(init) {
    if (!init || !Object.prototype.hasOwnProperty.call(init, 'body')) {
        return undefined;
    }

    const body = init.body;
    if (typeof body === 'string') {
        return parseConnectionProfileDebugBodyText(body);
    }

    return redactConnectionProfileDebugValue(body, 'body');
}

function redactConnectionProfileDebugCommandArgument(command, argument) {
    return redactConnectionProfileDebugValue(argument, command);
}

class ConnectionProfileDebugSession {
    static active = null;
    static originalFetch = null;
    static originalJQueryAjax = null;
    static nextSessionId = 1;

    constructor(profile, source, previousProfileId) {
        this.id = ConnectionProfileDebugSession.nextSessionId++;
        this.profile = profile;
        this.source = source;
        this.previousProfileId = previousProfileId ?? null;
        this.requestCounter = 0;
        this.stopTimer = null;
        this.startedAt = performance.now();
        this.closed = false;
    }

    static start(profile, source, previousProfileId) {
        ConnectionProfileDebugSession.active?.stopNow('replaced by a new profile diagnostic session');
        const session = new ConnectionProfileDebugSession(profile, source, previousProfileId);
        ConnectionProfileDebugSession.active = session;
        ConnectionProfileDebugSession.installFetchWrapper();
        ConnectionProfileDebugSession.installJQueryAjaxWrapper();
        session.logStart();
        return session;
    }

    static installFetchWrapper() {
        if (ConnectionProfileDebugSession.originalFetch || typeof window.fetch !== 'function') {
            return;
        }

        ConnectionProfileDebugSession.originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const session = ConnectionProfileDebugSession.active;
            if (!session) {
                return ConnectionProfileDebugSession.originalFetch.apply(this, args);
            }

            const requestId = session.nextRequestId('fetch');
            const startedAt = performance.now();
            session.logFetchRequest(requestId, args);

            try {
                const response = await ConnectionProfileDebugSession.originalFetch.apply(this, args);
                void session.logFetchResponse(requestId, response, startedAt);
                return response;
            } catch (error) {
                session.logRequestError(requestId, error, startedAt);
                throw error;
            }
        };
    }

    static installJQueryAjaxWrapper() {
        if (ConnectionProfileDebugSession.originalJQueryAjax || !window.jQuery?.ajax) {
            return;
        }

        ConnectionProfileDebugSession.originalJQueryAjax = window.jQuery.ajax;
        window.jQuery.ajax = function (...args) {
            const session = ConnectionProfileDebugSession.active;
            if (!session) {
                return ConnectionProfileDebugSession.originalJQueryAjax.apply(this, args);
            }

            const requestId = session.nextRequestId('ajax');
            const startedAt = performance.now();
            session.logJQueryAjaxRequest(requestId, args);

            const jqXHR = ConnectionProfileDebugSession.originalJQueryAjax.apply(this, args);
            jqXHR.done((data, textStatus, xhr) => {
                session.logJQueryAjaxResponse(requestId, data, textStatus, xhr, startedAt);
            });
            jqXHR.fail((xhr, textStatus, errorThrown) => {
                session.logJQueryAjaxError(requestId, xhr, textStatus, errorThrown, startedAt);
            });
            return jqXHR;
        };
    }

    static restoreWrappers() {
        if (ConnectionProfileDebugSession.originalFetch) {
            window.fetch = ConnectionProfileDebugSession.originalFetch;
            ConnectionProfileDebugSession.originalFetch = null;
        }

        if (ConnectionProfileDebugSession.originalJQueryAjax && window.jQuery?.ajax) {
            window.jQuery.ajax = ConnectionProfileDebugSession.originalJQueryAjax;
            ConnectionProfileDebugSession.originalJQueryAjax = null;
        }
    }

    nextRequestId(type) {
        this.requestCounter += 1;
        return `${this.id}:${type}:${this.requestCounter}`;
    }

    getElapsedMs(startedAt = this.startedAt) {
        return Math.round(performance.now() - startedAt);
    }

    logStart() {
        console.groupCollapsed(`${CONNECTION_PROFILE_DEBUG_PREFIX} Profile change #${this.id}: ${this.profile?.name || '(unnamed profile)'}`);
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} Started`, redactConnectionProfileDebugValue({
            source: this.source,
            previousProfileId: this.previousProfileId,
            selectedProfileId: this.profile?.id,
            selectedProfileName: this.profile?.name,
            mode: this.profile?.mode,
            onlineStatus: online_status,
            commands: this.getCommandLogList(),
        }));
    }

    getCommandLogList() {
        const commands = this.profile?.mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
        return commands.map(command => ({
            command,
            skipped: shouldSkipPromptPostProcessingCommand(command)
                || (!this.profile?.[command] && !(ALLOW_EMPTY.includes(command) && this.profile?.[command] === '')),
            value: redactConnectionProfileDebugCommandArgument(command, this.profile?.[command] ?? null),
        }));
    }

    logCommandStart(command, argument) {
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} Command start`, {
            command,
            argument: redactConnectionProfileDebugCommandArgument(command, argument),
        });
    }

    logCommandSuccess(command, elapsedMs) {
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} Command success`, { command, elapsedMs });
    }

    logCommandSkipped(command, reason) {
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} Command skipped`, { command, reason });
    }

    logCommandError(command, argument, error) {
        console.error(`${CONNECTION_PROFILE_DEBUG_PREFIX} Command error`, {
            command,
            argument: redactConnectionProfileDebugCommandArgument(command, argument),
        }, error);
    }

    logProfileLoaded(profileName) {
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} CONNECTION_PROFILE_LOADED`, {
            profileName,
            onlineStatus: online_status,
            elapsedMs: this.getElapsedMs(),
        });
    }

    scheduleStop(reason = 'profile loaded') {
        clearTimeout(this.stopTimer);
        this.stopTimer = setTimeout(() => this.stopNow(reason), CONNECTION_PROFILE_DEBUG_GRACE_MS);
    }

    stopNow(reason = 'stopped') {
        if (this.closed) {
            return;
        }

        this.closed = true;
        clearTimeout(this.stopTimer);
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} Stopped`, {
            reason,
            onlineStatus: online_status,
            elapsedMs: this.getElapsedMs(),
            graceMs: CONNECTION_PROFILE_DEBUG_GRACE_MS,
        });
        console.groupEnd();

        if (ConnectionProfileDebugSession.active === this) {
            ConnectionProfileDebugSession.active = null;
            ConnectionProfileDebugSession.restoreWrappers();
        }
    }

    logFetchRequest(requestId, args) {
        const [input, init] = args;
        const request = input instanceof Request ? input : null;
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} API request`, redactConnectionProfileDebugValue({
            requestId,
            type: 'fetch',
            method: init?.method || request?.method || 'GET',
            url: request?.url || String(input),
            timestamp: new Date().toISOString(),
            headers: redactConnectionProfileDebugHeaders(init?.headers || request?.headers),
            body: getConnectionProfileDebugRequestBody(init),
        }));
    }

    async logFetchResponse(requestId, response, startedAt) {
        let body = '[unavailable]';
        try {
            body = parseConnectionProfileDebugBodyText(await response.clone().text());
        } catch (error) {
            body = `Failed to read response body: ${error?.message || error}`;
        }

        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} API response`, redactConnectionProfileDebugValue({
            requestId,
            type: 'fetch',
            url: response.url,
            status: response.status,
            statusText: response.statusText,
            elapsedMs: this.getElapsedMs(startedAt),
            body,
        }));
    }

    logJQueryAjaxRequest(requestId, args) {
        const [firstArg, secondArg] = args;
        const options = typeof firstArg === 'string'
            ? { ...(secondArg || {}), url: firstArg }
            : { ...(firstArg || {}) };

        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} API request`, redactConnectionProfileDebugValue({
            requestId,
            type: 'jQuery.ajax',
            method: options.type || options.method || 'GET',
            url: options.url,
            timestamp: new Date().toISOString(),
            headers: redactConnectionProfileDebugHeaders(options.headers),
            body: typeof options.data === 'string'
                ? parseConnectionProfileDebugBodyText(options.data)
                : redactConnectionProfileDebugValue(options.data, 'data'),
        }));
    }

    logJQueryAjaxResponse(requestId, data, textStatus, xhr, startedAt) {
        console.info(`${CONNECTION_PROFILE_DEBUG_PREFIX} API response`, redactConnectionProfileDebugValue({
            requestId,
            type: 'jQuery.ajax',
            status: xhr?.status,
            statusText: xhr?.statusText || textStatus,
            elapsedMs: this.getElapsedMs(startedAt),
            body: data,
        }));
    }

    logRequestError(requestId, error, startedAt) {
        console.error(`${CONNECTION_PROFILE_DEBUG_PREFIX} API error`, {
            requestId,
            elapsedMs: this.getElapsedMs(startedAt),
            error,
        });
    }

    logJQueryAjaxError(requestId, xhr, textStatus, errorThrown, startedAt) {
        console.error(`${CONNECTION_PROFILE_DEBUG_PREFIX} API error`, redactConnectionProfileDebugValue({
            requestId,
            type: 'jQuery.ajax',
            status: xhr?.status,
            statusText: xhr?.statusText || textStatus,
            elapsedMs: this.getElapsedMs(startedAt),
            responseText: xhr?.responseText,
            error: errorThrown?.message || errorThrown || textStatus,
        }));
    }
}

async function emitConnectionProfileLoadedWithDebug(session, profileName) {
    session?.logProfileLoaded(profileName);
    await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profileName);
    session?.scheduleStop();
}

/**
 * @typedef {Object} ConnectionProfile
 * @property {string} id Unique identifier
 * @property {string} mode Mode of the connection profile
 * @property {string} [name] Name of the connection profile
 * @property {string} [api] API
 * @property {string} [preset] Settings Preset
 * @property {string} [model] Model
 * @property {string} [proxy] Proxy Preset
 * @property {string} [tokenizer] Tokenizer
 * @property {string} [stop-strings] Custom Stopping Strings
 * @property {string} [start-reply-with] Start Reply With
 * @property {string} [reasoning-template] Reasoning Template
 * @property {string} [prompt-post-processing] Prompt Post-Processing
 * @property {string} [api-url] Server URL
 * @property {string} [secret-id] Secret ID
 * @property {string} [regex-preset] Regex Preset ID
 * @property {string[]} [exclude] Commands to exclude
 */

/**
 * Finds the best match for the search value.
 * @param {string} value Search value
 * @returns {ConnectionProfile|null} Best match or null
 */
function findProfileByName(value) {
    // Try to find exact match
    const profile = extension_settings.connectionManager.profiles.find(p => p.name === value);

    if (profile) {
        return profile;
    }

    // Try to find fuzzy match
    const fuse = new Fuse(extension_settings.connectionManager.profiles, { keys: ['name'] });
    const results = fuse.search(value);

    if (results.length === 0) {
        return null;
    }

    const bestMatch = results[0];
    return bestMatch.item;
}

/**
 * Reads the connection profile from the commands.
 * @param {string} mode Mode of the connection profile
 * @param {ConnectionProfile} profile Connection profile
 * @param {boolean} [cleanUp] Whether to clean up the profile
 */
async function readProfileFromCommands(mode, profile, cleanUp = false) {
    const commands = mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
    const opposingCommands = mode === 'cc' ? TC_COMMANDS : CC_COMMANDS;
    const excludeList = Array.isArray(profile.exclude) ? profile.exclude : [];
    for (const command of commands) {
        try {
            if (shouldSkipPromptPostProcessingCommand(command)) {
                continue;
            }

            if (excludeList.includes(command)) {
                continue;
            }

            const allowEmpty = ALLOW_EMPTY.includes(command);
            const args = getNamedArguments();
            const result = await SlashCommandParser.commands[command].callback(args, '');
            if (result || (allowEmpty && result === '')) {
                profile[command] = result;
                continue;
            }
        } catch (error) {
            console.error(`Failed to execute command: ${command}`, error);
        }
    }

    if (cleanUp) {
        for (const command of commands) {
            if (command.endsWith('-state') && profile[command] === 'false') {
                delete profile[command.replace('-state', '')];
            }
        }
        for (const command of opposingCommands) {
            if (commands.includes(command)) {
                continue;
            }

            delete profile[command];
        }
    }
}

/**
 * Creates a new connection profile.
 * @param {string} [forceName] Name of the connection profile
 * @returns {Promise<ConnectionProfile>} Created connection profile
 */
async function createConnectionProfile(forceName = null) {
    const mode = main_api === 'openai' ? 'cc' : 'tc';
    const id = uuidv4();
    /** @type {ConnectionProfile} */
    const profile = {
        id,
        mode,
        exclude: [],
    };

    await readProfileFromCommands(mode, profile);

    const profileForDisplay = makeFancyProfile(profile);
    if (mode === 'cc' && isGlobalPromptPostProcessingEnabled() && !profileForDisplay[FANCY_NAMES[PROMPT_POST_PROCESSING_COMMAND]]) {
        profileForDisplay[FANCY_NAMES[PROMPT_POST_PROCESSING_COMMAND]] = EMPTY;
    }
    const template = $(await renderExtensionTemplateAsync(MODULE_NAME, 'profile', { profile: profileForDisplay }));
    disablePromptPostProcessingProfileControls(template);
    template.find('input[name="exclude"]').on('input', function () {
        const fancyName = String($(this).val());
        const keyName = Object.entries(FANCY_NAMES).find(x => x[1] === fancyName)?.[0];
        if (!keyName) {
            console.warn('Key not found for fancy name:', fancyName);
            return;
        }

        if (!Array.isArray(profile.exclude)) {
            profile.exclude = [];
        }

        const excludeState = !$(this).prop('checked');
        if (excludeState) {
            profile.exclude.push(keyName);
        } else {
            const index = profile.exclude.indexOf(keyName);
            index !== -1 && profile.exclude.splice(index, 1);
        }
    });
    const isNameTaken = (n) => extension_settings.connectionManager.profiles.some(p => p.name === n);
    const suggestedName = getUniqueName(collapseSpaces(`${profile.api ?? ''} ${profile.model ?? ''} - ${profile.preset ?? ''}`), isNameTaken);
    let name = forceName ?? await callGenericPopup(template, POPUP_TYPE.INPUT, suggestedName);
    // If it's cancelled, it will be false
    if (!name) {
        return null;
    }
    name = DOMPurify.sanitize(String(name));
    if (!name) {
        toastr.error('Name cannot be empty.');
        return null;
    }

    if (isNameTaken(name) || name === NONE) {
        toastr.error('A profile with the same name already exists.');
        return null;
    }

    if (Array.isArray(profile.exclude)) {
        for (const command of profile.exclude) {
            delete profile[command];
        }
    }

    profile.name = String(name);
    return profile;
}

/**
 * Deletes the selected connection profile.
 * @returns {Promise<void>}
 */
async function deleteConnectionProfile() {
    const selectedProfile = extension_settings.connectionManager.selectedProfile;
    if (!selectedProfile) {
        return;
    }

    const index = extension_settings.connectionManager.profiles.findIndex(p => p.id === selectedProfile);
    if (index === -1) {
        return;
    }

    const profile = extension_settings.connectionManager.profiles[index];
    const name = profile.name;
    const confirm = await Popup.show.confirm(t`Are you sure you want to delete the selected profile?`, name);

    if (!confirm) {
        return;
    }

    extension_settings.connectionManager.profiles.splice(index, 1);
    extension_settings.connectionManager.selectedProfile = null;
    saveSettingsDebounced();

    await eventSource.emit(event_types.CONNECTION_PROFILE_DELETED, profile);
}

/**
 * Formats the connection profile for display.
 * @param {ConnectionProfile} profile Connection profile
 * @returns {Object} Fancy profile
 */
function makeFancyProfile(profile) {
    return Object.entries(FANCY_NAMES).reduce((acc, [key, value]) => {
        const allowEmpty = ALLOW_EMPTY.includes(key);
        if (!profile[key]) {
            if (profile[key] === '' && allowEmpty) {
                acc[value] = EMPTY;
            }
            return acc;
        }

        // UUID is not very useful in the UI, so we replace it with a label (if available)
        if (key === 'secret-id') {
            const label = getSecretLabelById(profile[key]);
            if (label) {
                acc[value] = label;
                return acc;
            }
        }

        if (key === 'regex-preset') {
            const label = extension_settings.regex_presets?.find(p => p.id === profile[key])?.name;
            if (label) {
                acc[value] = label;
                return acc;
            }
        }

        acc[value] = profile[key];
        return acc;
    }, {});
}

/**
 * Applies the connection profile.
 * @param {ConnectionProfile} profile Connection profile
 * @returns {Promise<void>}
 */
export async function applyConnectionProfile(profile) {
    if (!profile) {
        return;
    }

    // Abort any ongoing profile application
    ConnectionManagerSpinner.abort();

    const mode = profile.mode;
    const commands = mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
    const spinner = new ConnectionManagerSpinner();
    const debugSession = ConnectionProfileDebugSession.active;
    spinner.start();

    for (const command of commands) {
        if (spinner.isAborted()) {
            debugSession?.logCommandError(command, profile[command], new Error('Profile application aborted'));
            throw new Error('Profile application aborted');
        }

        const argument = profile[command];
        const allowEmpty = ALLOW_EMPTY.includes(command);
        if (shouldSkipPromptPostProcessingCommand(command)) {
            debugSession?.logCommandSkipped(command, 'global prompt post-processing override is enabled');
            continue;
        }

        if (!argument && !(allowEmpty && argument === '')) {
            debugSession?.logCommandSkipped(command, 'profile has no value for this command');
            continue;
        }
        try {
            const args = getNamedArguments(allowEmpty ? { force: 'true' } : {});
            const commandStartedAt = performance.now();
            debugSession?.logCommandStart(command, argument);
            await SlashCommandParser.commands[command].callback(args, argument);
            debugSession?.logCommandSuccess(command, Math.round(performance.now() - commandStartedAt));
        } catch (error) {
            debugSession?.logCommandError(command, argument, error);
            console.error(`Failed to execute command: ${command} ${argument}`, error);
        }
    }

    spinner.stop();
}

/**
 * Finds a connection profile by id.
 * @param {string} profileId Profile id
 * @returns {ConnectionProfile|null} Connection profile
 */
export function findConnectionProfileById(profileId) {
    if (!profileId) {
        return null;
    }

    return extension_settings.connectionManager?.profiles?.find(p => p.id === profileId) ?? null;
}

/**
 * Applies a connection profile by id.
 * @param {string} profileId Profile id
 * @returns {Promise<ConnectionProfile|null>} Applied profile or null
 */
export async function applyConnectionProfileById(profileId) {
    const profile = findConnectionProfileById(profileId);
    if (!profile) {
        return null;
    }

    const previousProfileId = extension_settings.connectionManager.selectedProfile;
    extension_settings.connectionManager.selectedProfile = profile.id;
    const profiles = document.getElementById('connection_profiles');
    if (profiles instanceof HTMLSelectElement) {
        profiles.value = profile.id;
    }
    saveSettingsDebounced();

    const debugSession = ConnectionProfileDebugSession.start(profile, 'applyConnectionProfileById', previousProfileId);
    try {
        await applyConnectionProfile(profile);
        await emitConnectionProfileLoadedWithDebug(debugSession, profile.name);
    } catch (error) {
        debugSession.stopNow('profile application failed');
        throw error;
    }
    return profile;
}

/**
 * Reads the currently selected model through the connection profile command path.
 * @returns {Promise<string>} Current model id, or an empty string when unavailable.
 */
export async function readCurrentConnectionModel() {
    try {
        const result = await SlashCommandParser.commands.model.callback(getNamedArguments(), '');
        return typeof result === 'string' ? result.trim() : '';
    } catch (error) {
        console.error('Failed to read current model', error);
        return '';
    }
}

/**
 * Applies a model through the connection profile command path.
 * @param {string} modelId Model id
 * @returns {Promise<boolean>} True if a model was applied.
 */
export async function applyConnectionModel(modelId) {
    const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
    if (!normalizedModelId) {
        return false;
    }

    try {
        await SlashCommandParser.commands.model.callback(getNamedArguments(), normalizedModelId);
        return true;
    } catch (error) {
        console.error(`Failed to execute command: model ${normalizedModelId}`, error);
        return false;
    }
}

/**
 * Updates the selected connection profile.
 * @param {ConnectionProfile} profile Connection profile
 * @returns {Promise<void>}
 */
async function updateConnectionProfile(profile) {
    profile.mode = main_api === 'openai' ? 'cc' : 'tc';
    await readProfileFromCommands(profile.mode, profile, true);
}

/**
 * Renders the connection profile details.
 * @param {HTMLSelectElement} profiles Select element containing connection profiles
 */
function renderConnectionProfiles(profiles) {
    profiles.innerHTML = '';
    const noneOption = document.createElement('option');

    noneOption.value = '';
    noneOption.textContent = NONE;
    noneOption.selected = !extension_settings.connectionManager.selectedProfile;
    profiles.appendChild(noneOption);

    for (const profile of extension_settings.connectionManager.profiles.sort((a, b) => a.name.localeCompare(b.name))) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        option.selected = profile.id === extension_settings.connectionManager.selectedProfile;
        profiles.appendChild(option);
    }
}

/**
 * Renders the content of the details element.
 * @param {HTMLElement} detailsContent Content element of the details
 */
async function renderDetailsContent(detailsContent) {
    detailsContent.innerHTML = '';
    if (detailsContent.classList.contains('hidden')) {
        return;
    }
    const selectedProfile = extension_settings.connectionManager.selectedProfile;
    const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
    if (profile) {
        const profileForDisplay = makeFancyProfile(profile);
        const templateParams = { profile: profileForDisplay };
        if (Array.isArray(profile.exclude) && profile.exclude.length > 0) {
            templateParams.omitted = profile.exclude.map(e => FANCY_NAMES[e]).join(', ');
        }
        const template = await renderExtensionTemplateAsync(MODULE_NAME, 'view', templateParams);
        detailsContent.innerHTML = template;
    } else {
        detailsContent.textContent = t`No profile selected`;
    }
}

(async function () {
    extension_settings.connectionManager = extension_settings.connectionManager || structuredClone(DEFAULT_SETTINGS);

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (extension_settings.connectionManager[key] === undefined) {
            extension_settings.connectionManager[key] = DEFAULT_SETTINGS[key];
        }
    }

    const container = document.getElementById('rm_api_block');
    const settings = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    container.insertAdjacentHTML('afterbegin', settings);

    /** @type {HTMLSelectElement} */
    // @ts-ignore
    const profiles = document.getElementById('connection_profiles');
    renderConnectionProfiles(profiles);

    function toggleProfileSpecificButtons() {
        const profileId = extension_settings.connectionManager.selectedProfile;
        const profileSpecificButtons = ['update_connection_profile', 'reload_connection_profile', 'delete_connection_profile'];
        profileSpecificButtons.forEach(id => document.getElementById(id).classList.toggle('disabled', !profileId));
    }
    toggleProfileSpecificButtons();

    profiles.addEventListener('change', async function () {
        const selectedProfile = profiles.selectedOptions[0];
        if (!selectedProfile) {
            // Safety net for preventing the command getting stuck
            await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, NONE);
            return;
        }

        const profileId = selectedProfile.value;
        const previousProfileId = extension_settings.connectionManager.selectedProfile;
        extension_settings.connectionManager.selectedProfile = profileId;
        saveSettingsDebounced();
        await renderDetailsContent(detailsContent);

        toggleProfileSpecificButtons();

        // None option selected
        if (!profileId) {
            await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, NONE);
            return;
        }

        const profile = extension_settings.connectionManager.profiles.find(p => p.id === profileId);

        if (!profile) {
            console.log(`Profile not found: ${profileId}`);
            return;
        }

        const debugSession = ConnectionProfileDebugSession.start(profile, 'select change', previousProfileId);
        try {
            await applyConnectionProfile(profile);
            await emitConnectionProfileLoadedWithDebug(debugSession, profile.name);
        } catch (error) {
            debugSession.stopNow('profile application failed');
            throw error;
        }
    });

    const reloadButton = document.getElementById('reload_connection_profile');
    reloadButton.addEventListener('click', async () => {
        const selectedProfile = extension_settings.connectionManager.selectedProfile;
        const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
        if (!profile) {
            console.log('No profile selected');
            return;
        }
        const debugSession = ConnectionProfileDebugSession.start(profile, 'reload button', selectedProfile);
        try {
            await applyConnectionProfile(profile);
            await renderDetailsContent(detailsContent);
            await emitConnectionProfileLoadedWithDebug(debugSession, profile.name);
        } catch (error) {
            debugSession.stopNow('profile application failed');
            throw error;
        }
        toastr.success('Connection profile reloaded', '', { timeOut: 1500 });
    });

    const createButton = document.getElementById('create_connection_profile');
    createButton.addEventListener('click', async () => {
        const profile = await createConnectionProfile();
        if (!profile) {
            return;
        }
        extension_settings.connectionManager.profiles.push(profile);
        extension_settings.connectionManager.selectedProfile = profile.id;
        saveSettingsDebounced();
        renderConnectionProfiles(profiles);
        await renderDetailsContent(detailsContent);
        await eventSource.emit(event_types.CONNECTION_PROFILE_CREATED, profile);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
    });

    const updateButton = document.getElementById('update_connection_profile');
    updateButton.addEventListener('click', async () => {
        const selectedProfile = extension_settings.connectionManager.selectedProfile;
        const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
        if (!profile) {
            console.log('No profile selected');
            return;
        }
        const oldProfile = structuredClone(profile);
        await updateConnectionProfile(profile);
        await renderDetailsContent(detailsContent);
        saveSettingsDebounced();
        await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
        toastr.success('Connection profile updated', '', { timeOut: 1500 });
    });

    const deleteButton = document.getElementById('delete_connection_profile');
    deleteButton.addEventListener('click', async () => {
        await deleteConnectionProfile();
        renderConnectionProfiles(profiles);
        await renderDetailsContent(detailsContent);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, NONE);
    });

    const editButton = document.getElementById('edit_connection_profile');
    editButton.addEventListener('click', async () => {
        const selectedProfile = extension_settings.connectionManager.selectedProfile;
        const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
        if (!profile) {
            console.log('No profile selected');
            return;
        }
        if (!Array.isArray(profile.exclude)) {
            profile.exclude = [];
        }

        let saveChanges = false;
        const sortByViewOrder = (a, b) => Object.keys(FANCY_NAMES).indexOf(a) - Object.keys(FANCY_NAMES).indexOf(b);
        const commands = profile.mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;
        const settings = commands.slice().sort(sortByViewOrder).reduce((acc, command) => {
            const fancyName = FANCY_NAMES[command];
            acc[fancyName] = !profile.exclude.includes(command);
            return acc;
        }, {});
        const template = $(await renderExtensionTemplateAsync(MODULE_NAME, 'edit', { name: profile.name, settings }));
        disablePromptPostProcessingProfileControls(template);
        let newName = await callGenericPopup(template, POPUP_TYPE.INPUT, profile.name, {
            customButtons: [{
                text: t`Save and Update`,
                classes: ['popup-button-ok'],
                result: POPUP_RESULT.AFFIRMATIVE,
                action: () => {
                    saveChanges = true;
                },
            }],
        });

        // If it's cancelled, it will be false
        if (!newName) {
            return;
        }
        newName = DOMPurify.sanitize(String(newName));
        if (!newName) {
            toastr.error('Name cannot be empty.');
            return;
        }

        if (profile.name !== newName && extension_settings.connectionManager.profiles.some(p => p.name === newName)) {
            toastr.error('A profile with the same name already exists.');
            return;
        }

        const newExcludeList = template.find('input[name="exclude"]:not(:checked)').map(function () {
            return Object.entries(FANCY_NAMES).find(x => x[1] === String($(this).val()))?.[0];
        }).get();

        const oldProfile = structuredClone(profile);
        if (newExcludeList.length !== profile.exclude.length || !newExcludeList.every(e => profile.exclude.includes(e))) {
            profile.exclude = newExcludeList;
            for (const command of newExcludeList) {
                delete profile[command];
            }
            if (saveChanges) {
                await updateConnectionProfile(profile);
            } else {
                toastr.info('Press "Update" to record them into the profile.', 'Included settings list updated');
            }
        }

        if (profile.name !== newName) {
            toastr.success('Connection profile renamed.');
            profile.name = newName;
        }

        saveSettingsDebounced();
        await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
        renderConnectionProfiles(profiles);
        await renderDetailsContent(detailsContent);
    });

    /** @type {HTMLElement} */
    const viewDetails = document.getElementById('view_connection_profile');
    const detailsContent = document.getElementById('connection_profile_details_content');
    viewDetails.addEventListener('click', async () => {
        viewDetails.classList.toggle('active');
        detailsContent.classList.toggle('hidden');
        await renderDetailsContent(detailsContent);
    });

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile',
        helpString: 'Switch to a connection profile or return the name of the current profile in no argument is provided. Use <code>&lt;None&gt;</code> to switch to no profile.',
        returns: 'name of the profile',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Name of the connection profile',
                enumProvider: profilesProvider,
                isRequired: false,
            }),
        ],
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'await',
                description: 'Wait for the connection profile to be applied before returning.',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'true',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'timeout',
                description: 'Maximum time to wait for the API connection to be established, in milliseconds. Set to 0 to disable. Only applies when await=true.',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.NUMBER],
                defaultValue: '2000',
            }),
        ],
        callback: async (args, value) => {
            if (!value || typeof value !== 'string') {
                const selectedProfile = extension_settings.connectionManager.selectedProfile;
                const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
                if (!profile) {
                    return NONE;
                }
                return profile.name;
            }

            if (value === NONE) {
                profiles.selectedIndex = 0;
                profiles.dispatchEvent(new Event('change'));
                return NONE;
            }

            const profile = findProfileByName(value);

            if (!profile) {
                return '';
            }

            const shouldAwait = !isFalseBoolean(String(args?.await));
            const awaitPromise = new Promise((resolve) => eventSource.once(event_types.CONNECTION_PROFILE_LOADED, resolve));

            profiles.selectedIndex = Array.from(profiles.options).findIndex(o => o.value === profile.id);
            profiles.dispatchEvent(new Event('change'));

            if (shouldAwait) {
                await awaitPromise;

                // We should also await the connection to be established
                const parsedTimeout = parseInt(args?.timeout?.toString());
                const timeout = !isNaN(parsedTimeout) ? Math.max(0, parsedTimeout) : 2000;
                if (timeout > 0) {
                    await waitUntilCondition(() => online_status !== 'no_connection', timeout, 100, { rejectOnTimeout: false });
                }
            }

            return profile.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-list',
        helpString: 'List all connection profile names.',
        returns: 'list of profile names',
        callback: () => JSON.stringify(extension_settings.connectionManager.profiles.map(p => p.name)),
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-create',
        returns: 'name of the new profile',
        helpString: 'Create a new connection profile using the current settings.',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'name of the new connection profile',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
        callback: async (_args, name) => {
            if (!name || typeof name !== 'string') {
                toastr.warning('Please provide a name for the new connection profile.');
                return '';
            }
            const profile = await createConnectionProfile(name);
            if (!profile) {
                return '';
            }
            extension_settings.connectionManager.profiles.push(profile);
            extension_settings.connectionManager.selectedProfile = profile.id;
            saveSettingsDebounced();
            renderConnectionProfiles(profiles);
            await renderDetailsContent(detailsContent);
            await eventSource.emit(event_types.CONNECTION_PROFILE_CREATED, profile);
            return profile.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-update',
        helpString: 'Update the selected connection profile.',
        callback: async () => {
            const selectedProfile = extension_settings.connectionManager.selectedProfile;
            const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
            if (!profile) {
                toastr.warning('No profile selected.');
                return '';
            }
            const oldProfile = structuredClone(profile);
            await updateConnectionProfile(profile);
            await renderDetailsContent(detailsContent);
            saveSettingsDebounced();
            await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, oldProfile, profile);
            return profile.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'profile-get',
        helpString: 'Get the details of the connection profile. Returns the selected profile if no argument is provided.',
        returns: 'object of the selected profile',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Name of the connection profile',
                enumProvider: profilesProvider,
                isRequired: false,
            }),
        ],
        callback: async (_args, value) => {
            if (!value || typeof value !== 'string') {
                const selectedProfile = extension_settings.connectionManager.selectedProfile;
                const profile = extension_settings.connectionManager.profiles.find(p => p.id === selectedProfile);
                if (!profile) {
                    return '';
                }
                return JSON.stringify(profile);
            }

            const profile = findProfileByName(value);
            if (!profile) {
                return '';
            }
            return JSON.stringify(profile);
        },
    }));
})();
