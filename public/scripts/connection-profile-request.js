import { CONNECT_API_MAP } from '../script.js';
import { extension_settings } from './extensions.js';
import { ChatCompletionService } from './custom-request.js';
import { t, translate } from './i18n.js';
import { proxies } from './openai.js';
import { getPresetManager } from './preset-manager.js';
import {
    resolveConnectionProfileModel,
    resolveConnectionProfileTemperature,
} from './connection-profile-request-policy.js';

const REQUEST_OVERRIDE_KEYS = Object.freeze([
    'azure_base_url',
    'azure_deployment_name',
    'azure_api_version',
    'custom_include_body',
    'custom_exclude_body',
    'custom_include_headers',
    'vertexai_auth_mode',
    'vertexai_region',
    'vertexai_express_project_id',
    'zai_endpoint',
]);

function getConnectionManagerSettings() {
    return extension_settings.connectionManager || { profiles: [] };
}

function validateProfile(profile) {
    if (!profile) {
        throw new Error(translate('Could not find connection profile.'));
    }
    if (!profile.api) {
        throw new Error(translate('Select a connection profile that has an API.'));
    }

    const apiMap = CONNECT_API_MAP[profile.api];
    if (!apiMap) {
        throw new Error(`Unknown API type ${profile.api}.`);
    }
    if (apiMap.selected !== 'openai' || !apiMap.source) {
        throw new Error(`API type ${apiMap.selected} does not support chat completions.`);
    }
    return apiMap;
}

function resolveRequestModel(...candidates) {
    try {
        return resolveConnectionProfileModel(...candidates);
    } catch {
        throw new Error(translate('Enter a model ID or select a connection profile with a saved model ID.'));
    }
}

function getPresetTemperature(presetName) {
    if (!presetName) {
        return undefined;
    }
    const preset = getPresetManager(ChatCompletionService.TYPE)?.getCompletionPresetByName(presetName);
    const temperature = Number(preset?.temperature);
    return Number.isFinite(temperature) && temperature >= 0 ? temperature : undefined;
}

function copyRequestOverrides(profile) {
    const source = profile?.['request-overrides'];
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return {};
    }
    return Object.fromEntries(REQUEST_OVERRIDE_KEYS
        .filter(key => source[key] !== undefined)
        .map(key => [key, structuredClone(source[key])]));
}

/**
 * Builds a non-secret, immutable request snapshot from a saved connection profile.
 */
export function createConnectionProfileRequestSnapshot(profileId, overrides = {}) {
    const profile = getConnectionManagerSettings().profiles?.find(item => item.id === profileId);
    const apiMap = validateProfile(profile);
    const model = resolveRequestModel(overrides.model, profile.model);
    const profileTemperature = getPresetTemperature(profile.preset);
    const temperature = resolveConnectionProfileTemperature(overrides.temperature, profileTemperature);
    const proxy = profile.proxy ? proxies.find(item => item.name === profile.proxy) : null;

    return Object.freeze({
        profileId: String(profile.id),
        profileName: String(profile.name || ''),
        source: String(apiMap.source),
        model,
        temperature,
        presetName: String(profile.preset || ''),
        apiUrl: String(profile['api-url'] || ''),
        secretId: String(profile['secret-id'] || ''),
        proxyName: String(profile.proxy || ''),
        proxyUrl: String(proxy?.url || ''),
        promptPostProcessing: String(profile['prompt-post-processing'] || ''),
        requestOverrides: Object.freeze(copyRequestOverrides(profile)),
    });
}

/**
 * Returns connection profiles that can make background chat-completion requests.
 */
export function getSupportedConnectionProfiles() {
    return (getConnectionManagerSettings().profiles || []).filter(profile => {
        try {
            validateProfile(profile);
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * Applies a saved snapshot to request data without changing the active UI connection.
 */
export function applyConnectionProfileSnapshot(generateData, snapshot, overrides = {}) {
    if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Connection profile request snapshot is missing.');
    }

    const model = resolveRequestModel(overrides.model, snapshot.model);
    const temperature = resolveConnectionProfileTemperature(overrides.temperature, snapshot.temperature);
    const proxy = snapshot.proxyName ? proxies.find(item => item.name === snapshot.proxyName) : null;
    if (snapshot.proxyName && !proxy) {
        throw new Error(t`Proxy preset '${snapshot.proxyName}' not found`);
    }

    return {
        ...generateData,
        ...structuredClone(snapshot.requestOverrides || {}),
        chat_completion_source: snapshot.source,
        model,
        temperature,
        custom_url: snapshot.apiUrl || undefined,
        reverse_proxy: snapshot.proxyUrl || undefined,
        proxy_password: proxy?.password || undefined,
        custom_prompt_post_processing: snapshot.promptPostProcessing || undefined,
        secret_id: snapshot.secretId || undefined,
    };
}

/**
 * Sends a request through a saved connection profile without applying it globally.
 */
export async function sendConnectionProfileRequest(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
    const options = {
        stream: false,
        signal: null,
        extractData: true,
        includePreset: true,
        ...custom,
    };
    const snapshot = createConnectionProfileRequestSnapshot(profileId, {
        model: overridePayload.model,
        temperature: overridePayload.temperature,
    });

    const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }];
    const data = applyConnectionProfileSnapshot({
        stream: options.stream,
        messages,
        max_tokens: maxTokens,
        ...overridePayload,
    }, snapshot);

    try {
        return await ChatCompletionService.processRequest(data, {
            presetName: options.includePreset && snapshot.temperature === undefined
                ? snapshot.presetName
                : undefined,
        }, options.extractData, options.signal);
    } catch (error) {
        throw new Error(`${t`API request failed`}: ${error?.message || error}`, { cause: error });
    }
}

export const CONNECTION_PROFILE_REQUEST_OVERRIDE_KEYS = REQUEST_OVERRIDE_KEYS;
