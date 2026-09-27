import { HEADER_API_TYPES, OPENROUTER_HEADERS, FEATHERLESS_HEADERS } from './constants.js';
import { SECRET_KEYS, readSecret } from './endpoints/secrets.js';
import { getConfigValue } from './util.js';

/**
 * Gets the headers for the TogetherAI API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {object} Headers for the request
 */
function getTogetherAIHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.TOGETHERAI);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the OpenRouter API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {object} Headers for the request
 */
function getOpenRouterHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.OPENROUTER);
    const baseHeaders = { ...OPENROUTER_HEADERS };

    return apiKey ? Object.assign(baseHeaders, { 'Authorization': `Bearer ${apiKey}` }) : baseHeaders;
}

/**
 * Gets the headers for the vLLM API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {object} Headers for the request
 */
function getVllmHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.VLLM);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the LlamaCPP API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {object} Headers for the request
 */
function getLlamaCppHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.LLAMACPP);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Ooba API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {object} Headers for the request
 */
function getOobaHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.OOBA);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the KoboldCpp API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {object} Headers for the request
 */
function getKoboldCppHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.KOBOLDCPP);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Featherless API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {object} Headers for the request
 */
function getFeatherlessHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.FEATHERLESS);
    const baseHeaders = { ...FEATHERLESS_HEADERS };

    return apiKey ? Object.assign(baseHeaders, { 'Authorization': `Bearer ${apiKey}` }) : baseHeaders;
}

/**
 * Gets the headers for the HuggingFace API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {object} Headers for the request
 */
function getHuggingFaceHeaders(directories) {
    const apiKey = readSecret(directories, SECRET_KEYS.HUGGINGFACE);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

export function getOverrideHeaders(urlHost) {
    const requestOverrides = getConfigValue('requestOverrides', []);
    const overrideHeaders = requestOverrides?.find((e) => e.hosts?.includes(urlHost))?.headers;
    if (overrideHeaders && urlHost) {
        return overrideHeaders;
    } else {
        return {};
    }
}

/**
 * Sets additional headers for the request.
 * @param {import('express').Request} request Original request body
 * @param {object} args New request arguments
 * @param {string|null} server API server for new request
 */
export function setAdditionalHeaders(request, args, server) {
    setAdditionalHeadersByType(args.headers, request.body.api_type, server, request.user.directories);
}

/**
 *
 * @param {object} requestHeaders Request headers
 * @param {string} type API type
 * @param {string|null} server API server for new request
 * @param {import('./users.js').UserDirectoryList} directories User directories
 */
export function setAdditionalHeadersByType(requestHeaders, type, server, directories) {
    const headerGetters = {
        [HEADER_API_TYPES.VLLM]: getVllmHeaders,
        [HEADER_API_TYPES.TOGETHERAI]: getTogetherAIHeaders,
        [HEADER_API_TYPES.OOBA]: getOobaHeaders,
        [HEADER_API_TYPES.OPENROUTER]: getOpenRouterHeaders,
        [HEADER_API_TYPES.KOBOLDCPP]: getKoboldCppHeaders,
        [HEADER_API_TYPES.LLAMACPP]: getLlamaCppHeaders,
        [HEADER_API_TYPES.FEATHERLESS]: getFeatherlessHeaders,
        [HEADER_API_TYPES.HUGGINGFACE]: getHuggingFaceHeaders,
    };

    const getHeaders = headerGetters[type];
    const headers = getHeaders ? getHeaders(directories) : {};

    if (typeof server === 'string' && server.length > 0) {
        try {
            const url = new URL(server);
            const overrideHeaders = getOverrideHeaders(url.host);

            if (overrideHeaders && Object.keys(overrideHeaders).length > 0) {
                Object.assign(headers, overrideHeaders);
            }
        } catch {
            // Do nothing
        }
    }

    Object.assign(requestHeaders, headers);
}
