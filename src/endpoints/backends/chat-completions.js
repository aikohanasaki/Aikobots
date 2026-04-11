import process from 'node:process';
import util from 'node:util';
import express from 'express';
import fetch from 'node-fetch';
import urlJoin from 'url-join';

import {
    AIMLAPI_HEADERS,
    AZURE_OPENAI_KEYS,
    CHAT_COMPLETION_SOURCES,
    GEMINI_SAFETY,
    OPENAI_REASONING_EFFORT_MAP,
    OPENAI_REASONING_EFFORT_MODELS,
    OPENROUTER_HEADERS,
    VERTEX_SAFETY,
    ZANITY_ENDPOINT,
    ZAI_ENDPOINT,
} from '../../constants.js';
import {
    getConfigValue,
    tryParse,
    uuidv4,
    mergeObjectWithYaml,
    excludeKeysByYaml,
    color,
    trimTrailingSlash,
    flattenSchema,
} from '../../util.js';
import {
    convertClaudeMessages,
    convertGooglePrompt,
    convertCohereMessages,
    convertMistralMessages,
    convertAI21Messages,
    convertXAIMessages,
    cachingAtDepthForOpenRouterClaude,
    cachingAtDepthForClaude,
    getPromptNames,
    calculateClaudeBudgetTokens,
    calculateGoogleBudgetTokens,
    postProcessPrompt,
    PROMPT_PROCESSING_TYPE,
    addAssistantPrefix,
    embedOpenRouterMedia,
} from '../../prompt-converters.js';
import { assembleChatCompletionPrompt } from '../../prompting/chat-completion-assembly.js';
import { compareChatCompletionMessages } from '../../prompting/chat-completion-compare.js';
import { runServerGenerationExtensions } from '../../extensions/server-runtime.js';
import { prepareEntriesForScan, resolveSortedEntriesPayload } from '../worldinfo.js';
import { resolveSplitCoreChatPayload } from '../chats.js';

import { readSecret, SECRET_KEYS } from '../secrets.js';
import {
    getTokenizerModel,
    getSentencepieceTokenizer,
    getTiktokenTokenizer,
    sentencepieceTokenizers,
    TEXT_COMPLETION_MODELS,
    webTokenizers,
    getWebTokenizer,
} from '../tokenizers.js';
import { getVertexAIAuth, getProjectIdFromServiceAccount } from '../google.js';

const API_OPENAI = 'https://api.openai.com/v1';
const API_CLAUDE = 'https://api.anthropic.com/v1';
const API_MISTRAL = 'https://api.mistral.ai/v1';
const API_COHERE_V1 = 'https://api.cohere.ai/v1';
const API_COHERE_V2 = 'https://api.cohere.ai/v2';
const API_PERPLEXITY = 'https://api.perplexity.ai';
const API_GROQ = 'https://api.groq.com/openai/v1';
const API_MAKERSUITE = 'https://generativelanguage.googleapis.com';
const API_VERTEX_AI = 'https://us-central1-aiplatform.googleapis.com';
const API_AI21 = 'https://api.ai21.com/studio/v1';
const API_ELECTRONHUB = 'https://api.electronhub.ai/v1';
const API_NAVY = 'https://api.navy/v1';
const API_NANOGPT = 'https://nano-gpt.com/api/v1';
const API_DEEPSEEK = 'https://api.deepseek.com/beta';
const API_XAI = 'https://api.x.ai/v1';
const API_AIMLAPI = 'https://api.aimlapi.com/v1';
const API_POLLINATIONS = 'https://text.pollinations.ai/openai';
const API_MOONSHOT = 'https://api.moonshot.ai/v1';
const API_FIREWORKS = 'https://api.fireworks.ai/inference/v1';
const API_COMETAPI = 'https://api.cometapi.com/v1';
const API_ZANITY_STANDARD = 'https://api.zanity.xyz/v1';
const API_ZANITY_ALTERNATE = 'https://api.zanity.xyz/rp';
const API_ZAI_COMMON = 'https://api.z.ai/api/paas/v4';
const API_ZAI_CODING = 'https://api.z.ai/api/coding/paas/v4';
const API_SILICONFLOW = 'https://api.siliconflow.com/v1';
const MAX_PROMPT_INSPECTION_SNAPSHOTS = 100;
const promptInspectionSnapshots = new Map();

// blocked due to site policy, unblocking august 2026
const BLOCKED_CUSTOM_ENDPOINT_HOSTNAME = 'voidai.app';

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isVoidaiAppHostname(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    return normalized === BLOCKED_CUSTOM_ENDPOINT_HOSTNAME || normalized.endsWith(`.${BLOCKED_CUSTOM_ENDPOINT_HOSTNAME}`);
}

/**
 * @param {string} urlString
 * @returns {boolean}
 */
function isVoidaiAppUrl(urlString) {
    if (!urlString) return false;
    try {
        return isVoidaiAppHostname(new URL(urlString).hostname);
    } catch {
        return false;
    }
}

/**
 * @param {any} model
 * @returns {boolean}
 */
function isNavyChatModel(model) {
    if (!model || typeof model !== 'object') {
        return false;
    }

    const endpoint = typeof model.endpoint === 'string' ? model.endpoint : '';
    return endpoint.includes('/chat/completions');
}

/**
 * @param {string} endpoint
 * @returns {string}
 */
function getZanityApiUrl(endpoint) {
    return endpoint === ZANITY_ENDPOINT.ALTERNATE ? API_ZANITY_ALTERNATE : API_ZANITY_STANDARD;
}

/**
 * Gets OpenRouter transforms based on the request.
 * @param {import('express').Request} request Express request
 * @returns {string[] | undefined} OpenRouter transforms
 */
function getOpenRouterTransforms(request) {
    switch (request.body.middleout) {
        case 'on':
            return ['middle-out'];
        case 'off':
            return [];
        case 'auto':
            return undefined;
    }
}

/**
 * Gets OpenRouter plugins based on the request.
 * @param {import('express').Request} request
 * @returns {any[]} OpenRouter plugins
 */
function getOpenRouterPlugins(request) {
    const plugins = [];

    if (request.body.enable_web_search) {
        plugins.push({ 'id': 'web' });
    }

    return plugins;
}

/**
 * Hacky way to use JSON schema only if json_object format is supported.
 * @param {object} bodyParams Additional body parameters
 * @param {object[]} messages Array of messages
 * @param {object} jsonSchema JSON schema object
 */
function setJsonObjectFormat(bodyParams, messages, jsonSchema) {
    bodyParams['response_format'] = {
        type: 'json_object',
    };
    const message = {
        role: 'user',
        content: `JSON schema for the response:\n${JSON.stringify(jsonSchema.value, null, 4)}`,
    };
    messages.push(message);
}

function createProviderJsonResult(body, { status = 200, ok = true } = {}) {
    return {
        kind: 'json',
        ok: Boolean(ok),
        status,
        body,
    };
}

function createProviderStreamResult(fetchResponse) {
    return {
        kind: 'stream',
        ok: Boolean(fetchResponse?.ok),
        response: fetchResponse,
    };
}

const MAX_ERROR_MESSAGE_LENGTH = 300;
const MAX_FLAGGED_INPUT_LENGTH = 200;

/**
 * @param {number} status
 * @returns {number}
 */
function getClientResponseStatus(status) {
    return status === 401 ? 400 : status;
}

/**
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncateErrorText(value, maxLength) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();

    if (!normalized) {
        return '';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeProviderErrorMessage(value, fallback = 'Unknown error occurred') {
    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();

    if (!normalized) {
        return fallback;
    }

    const bodyMarkerMatch = normalized.match(/^(.*?)(?:\bbody\b\s*[:=]\s*)([\s\S]*)$/i);
    if (bodyMarkerMatch) {
        const prefix = truncateErrorText(bodyMarkerMatch[1], MAX_ERROR_MESSAGE_LENGTH);
        return prefix ? `${prefix} (body omitted)` : fallback;
    }

    return truncateErrorText(normalized, MAX_ERROR_MESSAGE_LENGTH);
}

/**
 * @param {any} source
 * @param {string} fallback
 * @returns {string}
 */
function extractProviderErrorMessage(source, fallback = 'Unknown error occurred') {
    const candidates = [
        source?.error?.message,
        source?.detail?.error?.message,
        source?.message,
        typeof source?.detail === 'string' ? source.detail : null,
        typeof source?.error === 'string' ? source.error : null,
        typeof source === 'string' ? source : null,
    ];

    const candidate = candidates.find(value => typeof value === 'string' && value.trim());
    return sanitizeProviderErrorMessage(candidate, fallback);
}

/**
 * @param {any} metadata
 * @returns {Record<string, any> | undefined}
 */
function sanitizeProviderErrorMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return undefined;
    }

    const sanitized = {};

    if (Array.isArray(metadata.reasons)) {
        sanitized.reasons = metadata.reasons.filter(reason => typeof reason === 'string');
    }

    if (typeof metadata.flagged_input === 'string') {
        sanitized.flagged_input = truncateErrorText(metadata.flagged_input, MAX_FLAGGED_INPUT_LENGTH);
    }

    return Object.keys(sanitized).length ? sanitized : undefined;
}

/**
 * @param {any} payload
 * @param {string} fallbackMessage
 * @returns {{ error: Record<string, any>, quota_error?: boolean }}
 */
function sanitizeProviderErrorPayload(payload, fallbackMessage = 'Unknown error occurred') {
    const parsedPayload = typeof payload === 'string' ? tryParse(payload) : payload;
    const source = parsedPayload && typeof parsedPayload === 'object' ? parsedPayload : payload;
    const errorSource = source?.error && typeof source.error === 'object' ? source.error : null;
    const message = extractProviderErrorMessage(source, fallbackMessage);
    const error = { message };

    if (typeof errorSource?.type === 'string') {
        error.type = errorSource.type;
    }

    if (typeof errorSource?.code === 'string' || typeof errorSource?.code === 'number') {
        error.code = errorSource.code;
    }

    if (typeof errorSource?.param === 'string') {
        error.param = errorSource.param;
    }

    const metadata = sanitizeProviderErrorMetadata(errorSource?.metadata);
    if (metadata) {
        error.metadata = metadata;
    }

    const quotaError = Boolean(source?.quota_error) || errorSource?.type === 'insufficient_quota';

    return quotaError ? { error, quota_error: true } : { error };
}

/**
 * @param {import('node-fetch').Response} fetchResponse
 * @returns {Promise<{ status: number, body: { error: Record<string, any>, quota_error?: boolean } }>}
 */
async function buildSanitizedErrorResponse(fetchResponse) {
    let responseText = '';

    try {
        responseText = await fetchResponse.text();
    } catch {
        responseText = '';
    }

    const fallbackMessage = fetchResponse.statusText || 'Unknown error occurred';
    const summarizedBody = responseText ? sanitizeProviderErrorMessage(responseText, fallbackMessage) : '';

    console.error(
        'Chat completion request error:',
        fetchResponse.status,
        fallbackMessage,
        summarizedBody || '(empty response body)',
    );

    return {
        status: getClientResponseStatus(fetchResponse.status || 500),
        body: sanitizeProviderErrorPayload(responseText || null, fallbackMessage),
    };
}

async function sendProviderDispatchResult(result, request, response, {
    timedWorldInfo = null,
    worldInfoOverflowed = false,
    worldInfo = null,
    promptSnapshotKey = null,
} = {}) {
    if (!result || typeof result !== 'object') {
        return response.status(500).send({ error: true });
    }

    if (result.kind === 'stream') {
        if (!result.response) {
            return response.status(500).send({ error: true });
        }

        if (!result.ok) {
            const sanitizedError = await buildSanitizedErrorResponse(result.response);
            return response.status(sanitizedError.status).send(sanitizedError.body);
        }

        return await forwardFetchResponseWithWorldInfo(
            result.response,
            response,
            request,
            timedWorldInfo,
            worldInfoOverflowed,
            worldInfo,
            promptSnapshotKey,
        );
    }

    if (result.kind !== 'json') {
        return response.status(500).send({ error: true });
    }

    const payload = result.ok
        ? attachWorldInfoResponseData(result.body, request, timedWorldInfo, worldInfoOverflowed, worldInfo, promptSnapshotKey)
        : sanitizeProviderErrorPayload(result.body);

    return response.status(result.status || 200).send(payload);
}

/**
 * Sends a request to Claude API.
 * @param {express.Request} request Express request
 */
async function sendClaudeRequest(request) {
    const apiUrl = new URL(request.body.reverse_proxy || API_CLAUDE).toString();
    const apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.CLAUDE);
    const divider = '-'.repeat(process.stdout.columns);
    const enableSystemPromptCache = getConfigValue('claude.enableSystemPromptCache', false, 'boolean');
    let cachingAtDepth = getConfigValue('claude.cachingAtDepth', -1, 'number');
    // Disabled if not an integer or negative
    if (!Number.isInteger(cachingAtDepth) || cachingAtDepth < 0) {
        cachingAtDepth = -1;
    }

    if (!apiKey) {
        console.warn(color.red(`Claude API key is missing.\n${divider}`));
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    try {
        const controller = new AbortController();
        request.socket.removeAllListeners('close');
        request.socket.on('close', function () {
            controller.abort();
        });
        const additionalHeaders = {};
        const betaHeaders = ['output-128k-2025-02-19'];
        const useTools = Array.isArray(request.body.tools) && request.body.tools.length > 0;
        const useSystemPrompt = Boolean(request.body.claude_use_sysprompt);
        const convertedPrompt = convertClaudeMessages(request.body.messages, request.body.assistant_prefill, useSystemPrompt, useTools, getPromptNames(request));
        const useThinking = /^claude-(3-7|opus-4|sonnet-4|haiku-4-5)/.test(request.body.model);
        const useWebSearch = /^claude-(3-5|3-7|opus-4|sonnet-4|haiku-4-5)/.test(request.body.model) && Boolean(request.body.enable_web_search);
        const isLimitedSampling = /^claude-(opus-4-1|sonnet-4-5|haiku-4-5)/.test(request.body.model);
        const cacheTTL = getConfigValue('claude.extendedTTL', false, 'boolean') ? '1h' : '5m';
        let fixThinkingPrefill = false;
        // Add custom stop sequences
        const stopSequences = [];
        if (Array.isArray(request.body.stop)) {
            stopSequences.push(...request.body.stop);
        }

        const requestBody = {
            /** @type {any} */ system: [],
            messages: convertedPrompt.messages,
            model: request.body.model,
            max_tokens: request.body.max_tokens,
            stop_sequences: stopSequences,
            temperature: request.body.temperature,
            top_p: request.body.top_p,
            top_k: request.body.top_k,
            stream: request.body.stream,
        };
        if (useSystemPrompt) {
            if (enableSystemPromptCache && Array.isArray(convertedPrompt.systemPrompt) && convertedPrompt.systemPrompt.length) {
                convertedPrompt.systemPrompt[convertedPrompt.systemPrompt.length - 1]['cache_control'] = { type: 'ephemeral', ttl: cacheTTL };
            }

            requestBody.system = convertedPrompt.systemPrompt;
        } else {
            delete requestBody.system;
        }
        if (useTools) {
            betaHeaders.push('tools-2024-05-16');
            requestBody.tool_choice = { type: request.body.tool_choice };
            requestBody.tools = request.body.tools
                .filter(tool => tool.type === 'function')
                .map(tool => tool.function)
                .map(fn => ({ name: fn.name, description: fn.description, input_schema: flattenSchema(fn.parameters, request.body.chat_completion_source) }));

            if (enableSystemPromptCache && requestBody.tools.length) {
                requestBody.tools[requestBody.tools.length - 1]['cache_control'] = { type: 'ephemeral', ttl: cacheTTL };
            }
        }

        // Structured output is a forced tool
        if (request.body.json_schema) {
            const jsonTool = {
                name: request.body.json_schema.name,
                description: request.body.json_schema.description || 'Well-formed JSON object',
                input_schema: request.body.json_schema.value,
            };
            requestBody.tools = [...(requestBody.tools || []), jsonTool];
            requestBody.tool_choice = { type: 'tool', name: request.body.json_schema.name };
        }

        if (useWebSearch) {
            const webSearchTool = [{
                'type': 'web_search_20250305',
                'name': 'web_search',
            }];
            requestBody.tools = [...webSearchTool, ...(requestBody.tools || [])];
        }

        if (cachingAtDepth !== -1) {
            cachingAtDepthForClaude(convertedPrompt.messages, cachingAtDepth, cacheTTL);
        }

        if (enableSystemPromptCache || cachingAtDepth !== -1) {
            betaHeaders.push('prompt-caching-2024-07-31');
            betaHeaders.push('extended-cache-ttl-2025-04-11');
        }

        if (isLimitedSampling) {
            if (requestBody.top_p < 1) {
                delete requestBody.temperature;
            } else {
                delete requestBody.top_p;
            }
        }

        const reasoningEffort = request.body.reasoning_effort;
        const budgetTokens = calculateClaudeBudgetTokens(requestBody.max_tokens, reasoningEffort, requestBody.stream);

        if (useThinking && Number.isInteger(budgetTokens)) {
            // No prefill when thinking
            fixThinkingPrefill = true;
            const minThinkTokens = 1024;
            if (requestBody.max_tokens <= minThinkTokens) {
                const newValue = requestBody.max_tokens + minThinkTokens;
                console.warn(color.yellow(`Claude thinking requires a minimum of ${minThinkTokens} response tokens.`));
                console.info(color.blue(`Increasing response length to ${newValue}.`));
                requestBody.max_tokens = newValue;
            }
            requestBody.thinking = {
                type: 'enabled',
                budget_tokens: budgetTokens,
            };

            // NO I CAN'T SILENTLY IGNORE THE TEMPERATURE.
            delete requestBody.temperature;
            delete requestBody.top_p;
            delete requestBody.top_k;
        }

        if (fixThinkingPrefill && convertedPrompt.messages.length && convertedPrompt.messages[convertedPrompt.messages.length - 1].role === 'assistant') {
            convertedPrompt.messages[convertedPrompt.messages.length - 1].role = 'user';
        }

        if (betaHeaders.length) {
            additionalHeaders['anthropic-beta'] = betaHeaders.join(',');
        }

        console.debug('Claude request:', requestBody);

        const generateResponse = await fetch(apiUrl + '/messages', {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify(requestBody),
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': apiKey,
                ...additionalHeaders,
            },
        });

        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const generateResponseText = await generateResponse.text();
                console.warn(color.red(`Claude API returned error: ${generateResponse.status} ${generateResponse.statusText}\n${generateResponseText}\n${divider}`));
                return createProviderJsonResult({ error: true }, { status: 500, ok: false });
            }

            /** @type {any} */
            const generateResponseJson = await generateResponse.json();
            const responseText = generateResponseJson?.content?.[0]?.text || '';
            console.debug('Claude response:', generateResponseJson);

            // Wrap it back to OAI format + save the original content
            const reply = { choices: [{ 'message': { 'content': responseText } }], content: generateResponseJson.content };
            return createProviderJsonResult(reply);
        }
    } catch (error) {
        console.error(color.red(`Error communicating with Claude: ${error}\n${divider}`));
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to Google AI API.
 * @param {express.Request} request Express request
 */
async function sendMakerSuiteRequest(request) {
    const useVertexAi = request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.VERTEXAI;
    const apiName = useVertexAi ? 'Google Vertex AI' : 'Google AI Studio';
    let apiUrl;
    let apiKey;

    let authHeader;
    let authType;

    if (useVertexAi) {
        apiUrl = new URL(request.body.reverse_proxy || API_VERTEX_AI);

        try {
            const auth = await getVertexAIAuth(request);
            authHeader = auth.authHeader;
            authType = auth.authType;
            console.debug(`Using Vertex AI authentication type: ${authType}`);
        } catch (error) {
            console.warn(`${apiName} authentication failed: ${error.message}`);
            return createProviderJsonResult({ error: true, message: error.message }, { status: 400, ok: false });
        }
    } else {
        apiUrl = new URL(request.body.reverse_proxy || API_MAKERSUITE);
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.MAKERSUITE);

        if (!request.body.reverse_proxy && !apiKey) {
            console.warn(`${apiName} API key is missing.`);
            return createProviderJsonResult({ error: true }, { status: 400, ok: false });
        }

        authHeader = `Bearer ${apiKey}`;
        authType = 'api_key';
    }

    const model = String(request.body.model);
    const stream = Boolean(request.body.stream);
    const enableWebSearch = Boolean(request.body.enable_web_search);
    const requestImages = Boolean(request.body.request_images);
    const reasoningEffort = String(request.body.reasoning_effort);
    const includeReasoning = Boolean(request.body.include_reasoning);
    const isGemma = model.includes('gemma');
    const isLearnLM = model.includes('learnlm');

    const responseMimeType = request.body.responseMimeType ?? (request.body.json_schema ? 'application/json' : undefined);
    const responseSchema = request.body.responseSchema ?? (request.body.json_schema ? request.body.json_schema.value : undefined);

    const generationConfig = {
        stopSequences: request.body.stop,
        candidateCount: 1,
        maxOutputTokens: request.body.max_tokens,
        temperature: request.body.temperature,
        topP: request.body.top_p,
        topK: request.body.top_k || undefined,
        responseMimeType: responseMimeType,
        responseSchema: responseSchema,
        seed: request.body.seed,
    };

    function getGeminiBody() {
        // #region UGLY MODEL LISTS AREA
        const imageGenerationModels = [
            'gemini-2.0-flash-exp',
            'gemini-2.0-flash-exp-image-generation',
            'gemini-2.0-flash-preview-image-generation',
            'gemini-2.5-flash-image-preview',
            'gemini-2.5-flash-image',
            'gemini-3-pro-image-preview',
        ];

        const isThinkingConfigModel = m => (/^gemini-2.5-(flash|pro)/.test(m) && !/-image(-preview)?$/.test(m)) || (/^gemini-3-pro/.test(m));

        const noSearchModels = [
            'gemini-2.0-flash-lite',
            'gemini-2.0-flash-lite-001',
            'gemini-2.0-flash-lite-preview-02-05',
            'gemini-robotics-er-1.5-preview',
        ];
        // #endregion

        if (!Array.isArray(generationConfig.stopSequences) || !generationConfig.stopSequences.length) {
            delete generationConfig.stopSequences;
        }

        const enableImageModality = requestImages && imageGenerationModels.includes(model);
        if (enableImageModality) {
            generationConfig.responseModalities = ['text', 'image'];
        }

        const useSystemPrompt = !enableImageModality && !isGemma && request.body.use_makersuite_sysprompt;

        const tools = [];
        const prompt = convertGooglePrompt(request.body.messages, model, useSystemPrompt, getPromptNames(request));
        const safetySettings = [...GEMINI_SAFETY, ...(useVertexAi ? VERTEX_SAFETY : [])];

        if (enableWebSearch && !enableImageModality && !isGemma && !isLearnLM && !noSearchModels.includes(model)) {
            tools.push({ google_search: {} });
        }

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0 && !enableImageModality && !isGemma) {
            const functionDeclarations = [];
            for (const tool of request.body.tools) {
                if (tool.type === 'function') {
                    if (tool.function.parameters?.$schema) {
                        delete tool.function.parameters.$schema;
                    }
                    if (tool.function.parameters?.properties && Object.keys(tool.function.parameters.properties).length === 0) {
                        delete tool.function.parameters;
                    }
                    functionDeclarations.push(tool.function);
                }
            }
            tools.push({ function_declarations: functionDeclarations });
        }

        if (isThinkingConfigModel(model)) {
            const thinkingConfig = { includeThoughts: includeReasoning };

            const thinkingBudget = calculateGoogleBudgetTokens(generationConfig.maxOutputTokens, reasoningEffort, model);
            if (Number.isInteger(thinkingBudget)) {
                thinkingConfig.thinkingBudget = thinkingBudget;
            }

            // Vertex doesn't allow mixing disabled thinking with includeThoughts
            if (useVertexAi && thinkingBudget === 0 && thinkingConfig.includeThoughts) {
                console.info('Thinking budget is 0, but includeThoughts is true. Thoughts will not be included in the response.');
                thinkingConfig.includeThoughts = false;
            }

            generationConfig.thinkingConfig = thinkingConfig;
        }

        let body = {
            contents: prompt.contents,
            safetySettings: safetySettings,
            generationConfig: generationConfig,
        };

        if (useSystemPrompt && Array.isArray(prompt.system_instruction.parts) && prompt.system_instruction.parts.length) {
            body.systemInstruction = prompt.system_instruction;
        }

        if (tools.length) {
            body.tools = tools;
        }

        return body;
    }

    const body = getGeminiBody();
    console.debug(`${apiName} request:`, body);

    try {
        const controller = new AbortController();
        request.socket.removeAllListeners('close');
        request.socket.on('close', function () {
            controller.abort();
        });

        const apiVersion = getConfigValue('gemini.apiVersion', 'v1beta');
        const responseType = (stream ? 'streamGenerateContent' : 'generateContent');

        let url;
        let headers = {
            'Content-Type': 'application/json',
        };

        if (useVertexAi) {
            if (authType === 'express') {
                // For Express mode (API key authentication), use the key parameter
                const keyParam = authHeader.replace('Bearer ', '');
                const region = request.body.vertexai_region || 'us-central1';
                const projectId = request.body.vertexai_express_project_id;
                const baseUrl = region === 'global'
                    ? 'https://aiplatform.googleapis.com'
                    : `https://${region}-aiplatform.googleapis.com`;
                url = projectId
                    ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:${responseType}?key=${keyParam}${stream ? '&alt=sse' : ''}`
                    : `${baseUrl}/v1/publishers/google/models/${model}:${responseType}?key=${keyParam}${stream ? '&alt=sse' : ''}`;
            } else if (authType === 'full') {
                // For Full mode (service account authentication), use project-specific URL
                // Get project ID from Service Account JSON
                const serviceAccountJson = readSecret(request.user.directories, SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT);
                if (!serviceAccountJson) {
                    console.warn('Vertex AI Service Account JSON is missing.');
                    return createProviderJsonResult({ error: true }, { status: 400, ok: false });
                }

                let projectId;
                try {
                    const serviceAccount = JSON.parse(serviceAccountJson);
                    projectId = getProjectIdFromServiceAccount(serviceAccount);
                } catch (error) {
                    console.error('Failed to extract project ID from Service Account JSON:', error);
                    return createProviderJsonResult({ error: true }, { status: 400, ok: false });
                }
                const region = request.body.vertexai_region || 'us-central1';
                // Handle global region differently - no region prefix in hostname
                if (region === 'global') {
                    url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:${responseType}${stream ? '?alt=sse' : ''}`;
                } else {
                    url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:${responseType}${stream ? '?alt=sse' : ''}`;
                }
                headers['Authorization'] = authHeader;
            } else {
                // For proxy mode, use the original URL with Authorization header
                url = `${apiUrl.toString().replace(/\/$/, '')}/v1/publishers/google/models/${model}:${responseType}${stream ? '?alt=sse' : ''}`;
                headers['Authorization'] = authHeader;
            }
        } else {
            url = `${apiUrl.toString().replace(/\/$/, '')}/${apiVersion}/models/${model}:${responseType}?key=${apiKey}${stream ? '&alt=sse' : ''}`;
        }

        const generateResponse = await fetch(url, {
            body: JSON.stringify(body),
            method: 'POST',
            headers: headers,
            signal: controller.signal,
        });

        if (stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`${apiName} API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }

            /** @type {any} */
            const generateResponseJson = await generateResponse.json();

            const candidates = generateResponseJson?.candidates;
            if (!candidates || candidates.length === 0) {
                let message = `${apiName} API returned no candidate`;
                console.warn(message, generateResponseJson);
                if (generateResponseJson?.promptFeedback?.blockReason) {
                    message += `\nPrompt was blocked due to : ${generateResponseJson.promptFeedback.blockReason}`;
                }
                return createProviderJsonResult({ error: { message } }, { ok: false });
            }

            const responseContent = candidates[0].content ?? candidates[0].output;
            const functionCall = (candidates?.[0]?.content?.parts ?? []).some(part => part.functionCall);
            const inlineData = (candidates?.[0]?.content?.parts ?? []).some(part => part.inlineData);
            console.debug(`${apiName} response:`, util.inspect(generateResponseJson, { depth: 5, colors: true }));

            const responseText = typeof responseContent === 'string' ? responseContent : responseContent?.parts?.filter(part => !part.thought)?.map(part => part.text)?.join('\n\n');
            if (!responseText && !functionCall && !inlineData) {
                let message = `${apiName} Candidate text empty`;
                console.warn(message, generateResponseJson);
                return createProviderJsonResult({ error: { message } }, { ok: false });
            }

            // Wrap it back to OAI format
            const reply = { choices: [{ 'message': { 'content': responseText } }], responseContent };
            return createProviderJsonResult(reply);
        }
    } catch (error) {
        console.error(`Error communicating with ${apiName} API:`, error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to AI21 API.
 * @param {express.Request} request Express request
 */
async function sendAI21Request(request) {
    if (!request.body) return createProviderJsonResult({ error: true }, { status: 400, ok: false });

    const apiKey = readSecret(request.user.directories, SECRET_KEYS.AI21);
    if (!apiKey) {
        console.warn('AI21 API key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    const bodyParams = {};
    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });
    // Hack to support JSON schema
    if (request.body.json_schema) {
        bodyParams.response_format = {
            type: 'json_object',
        };
        const message = {
            role: 'user',
            content: `JSON schema for the response:\n${JSON.stringify(request.body.json_schema.value, null, 4)}`,
        };
        request.body.messages.push(message);
    }
    const convertedPrompt = convertAI21Messages(request.body.messages, getPromptNames(request));
    const body = {
        messages: convertedPrompt,
        model: request.body.model,
        max_tokens: request.body.max_tokens,
        temperature: request.body.temperature,
        top_p: request.body.top_p,
        stop: request.body.stop,
        stream: request.body.stream,
        tools: request.body.tools,
        ...bodyParams,
    };
    const options = {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
    };

    console.debug('AI21 request:', body);

    try {
        const generateResponse = await fetch(API_AI21 + '/chat/completions', options);
        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`AI21 API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('AI21 response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    } catch (error) {
        console.error('Error communicating with AI21 API: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to MistralAI API.
 * @param {express.Request} request Express request
 */
async function sendMistralAIRequest(request) {
    const apiUrl = new URL(request.body.reverse_proxy || API_MISTRAL).toString();
    const apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.MISTRALAI);

    if (!apiKey) {
        console.warn('MistralAI API key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    try {
        const messages = convertMistralMessages(request.body.messages, getPromptNames(request));
        const controller = new AbortController();
        request.socket.removeAllListeners('close');
        request.socket.on('close', function () {
            controller.abort();
        });

        const requestBody = {
            'model': request.body.model,
            'messages': messages,
            'temperature': request.body.temperature,
            'top_p': request.body.top_p,
            'frequency_penalty': request.body.frequency_penalty,
            'presence_penalty': request.body.presence_penalty,
            'max_tokens': request.body.max_tokens,
            'stream': request.body.stream,
            'safe_prompt': request.body.safe_prompt,
            'random_seed': request.body.seed === -1 ? undefined : request.body.seed,
            'stop': Array.isArray(request.body.stop) && request.body.stop.length > 0 ? request.body.stop : undefined,
        };

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
            requestBody['tools'] = request.body.tools;
            requestBody['tool_choice'] = request.body.tool_choice;
        }

        if (request.body.json_schema) {
            requestBody['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    description: request.body.json_schema.description,
                    schema: request.body.json_schema.value,
                    strict: request.body.json_schema.strict ?? true,
                },
            };
        }

        const config = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
            timeout: 0,
        };

        console.debug('MisralAI request:', requestBody);

        const generateResponse = await fetch(apiUrl + '/chat/completions', config);
        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`MistralAI API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('MistralAI response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    } catch (error) {
        console.error('Error communicating with MistralAI API: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to Cohere API.
 * @param {express.Request} request Express request
 */
async function sendCohereRequest(request) {
    const apiKey = readSecret(request.user.directories, SECRET_KEYS.COHERE);
    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    if (!apiKey) {
        console.warn('Cohere API key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    try {
        const convertedHistory = convertCohereMessages(request.body.messages, getPromptNames(request));
        const tools = [];

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
            tools.push(...request.body.tools);
            tools.forEach(tool => {
                if (tool?.function?.parameters?.$schema) {
                    delete tool.function.parameters.$schema;
                }
            });
        }

        // https://docs.cohere.com/reference/chat
        const requestBody = {
            stream: Boolean(request.body.stream),
            model: request.body.model,
            messages: convertedHistory.chatHistory,
            temperature: request.body.temperature,
            max_tokens: request.body.max_tokens,
            k: request.body.top_k,
            p: request.body.top_p,
            seed: request.body.seed,
            stop_sequences: request.body.stop,
            frequency_penalty: request.body.frequency_penalty,
            presence_penalty: request.body.presence_penalty,
            documents: [],
            tools: tools,
        };

        const canDoSafetyMode = String(request.body.model).endsWith('08-2024');
        if (canDoSafetyMode) {
            requestBody.safety_mode = 'OFF';
        }

        if (request.body.json_schema) {
            requestBody.response_format = {
                type: 'json_schema',
                schema: request.body.json_schema.value,
            };
        }

        console.debug('Cohere request:', requestBody);

        const config = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
            timeout: 0,
        };

        const apiUrl = API_COHERE_V2 + '/chat';

        if (request.body.stream) {
            const stream = await fetch(apiUrl, config);
            return createProviderStreamResult(stream);
        } else {
            const generateResponse = await fetch(apiUrl, config);
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`Cohere API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('Cohere response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    } catch (error) {
        console.error('Error communicating with Cohere API: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to DeepSeek API.
 * @param {express.Request} request Express request
 */
async function sendDeepSeekRequest(request) {
    const apiUrl = new URL(request.body.reverse_proxy || API_DEEPSEEK).toString();
    const apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.DEEPSEEK);

    if (!apiKey && !request.body.reverse_proxy) {
        console.warn('DeepSeek API key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    try {
        let bodyParams = {};

        if (request.body.logprobs > 0) {
            bodyParams['top_logprobs'] = request.body.logprobs;
            bodyParams['logprobs'] = true;
        }

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
            bodyParams['tools'] = request.body.tools;
            bodyParams['tool_choice'] = request.body.tool_choice;

            // DeepSeek doesn't permit empty required arrays
            bodyParams.tools.forEach(tool => {
                const required = tool?.function?.parameters?.required;
                if (Array.isArray(required) && required.length === 0) {
                    delete tool.function.parameters.required;
                }
            });
        }

        // Hack to support JSON schema
        if (request.body.json_schema) {
            bodyParams.response_format = {
                type: 'json_object',
            };
            const message = {
                role: 'user',
                content: `JSON schema for the response:\n${JSON.stringify(request.body.json_schema.value, null, 4)}`,
            };
            request.body.messages.push(message);
        }

        const processedMessages = addAssistantPrefix(postProcessPrompt(request.body.messages, PROMPT_PROCESSING_TYPE.SEMI_TOOLS, getPromptNames(request)), bodyParams.tools, 'prefix');

        const requestBody = {
            'messages': processedMessages,
            'model': request.body.model,
            'temperature': request.body.temperature,
            'max_tokens': request.body.max_tokens,
            'stream': request.body.stream,
            'presence_penalty': request.body.presence_penalty,
            'frequency_penalty': request.body.frequency_penalty,
            'top_p': request.body.top_p,
            'stop': request.body.stop,
            'seed': request.body.seed,
            ...bodyParams,
        };

        const config = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        };

        console.debug('DeepSeek request:', requestBody);

        const generateResponse = await fetch(apiUrl + '/chat/completions', config);

        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`DeepSeek API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('DeepSeek response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    } catch (error) {
        console.error('Error communicating with DeepSeek API: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to XAI API.
 * @param {express.Request} request Express request
 */
async function sendXaiRequest(request) {
    const apiUrl = new URL(request.body.reverse_proxy || API_XAI).toString();
    const apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.XAI);

    if (!apiKey && !request.body.reverse_proxy) {
        console.warn('xAI API key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    try {
        let bodyParams = {};

        if (request.body.logprobs > 0) {
            bodyParams['top_logprobs'] = request.body.logprobs;
            bodyParams['logprobs'] = true;
        }

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
            bodyParams['tools'] = request.body.tools;
            bodyParams['tool_choice'] = request.body.tool_choice;
        }

        if (Array.isArray(request.body.stop) && request.body.stop.length > 0) {
            bodyParams['stop'] = request.body.stop;
        }

        if (request.body.reasoning_effort) {
            bodyParams['reasoning_effort'] = request.body.reasoning_effort === 'high' ? 'high' : 'low';
        }

        if (request.body.enable_web_search) {
            bodyParams['search_parameters'] = {
                mode: 'on',
                sources: [
                    { type: 'web', safe_search: false },
                    { type: 'news', safe_search: false },
                    { type: 'x' },
                ],
            };
        }

        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    strict: request.body.json_schema.strict ?? true,
                    schema: request.body.json_schema.value,
                },
            };
        }

        const processedMessages = request.body.messages = convertXAIMessages(request.body.messages, getPromptNames(request));

        const requestBody = {
            'messages': processedMessages,
            'model': request.body.model,
            'temperature': request.body.temperature,
            'max_tokens': request.body.max_tokens,
            'max_completion_tokens': request.body.max_completion_tokens,
            'stream': request.body.stream,
            'presence_penalty': request.body.presence_penalty,
            'frequency_penalty': request.body.frequency_penalty,
            'top_p': request.body.top_p,
            'seed': request.body.seed,
            'n': request.body.n,
            ...bodyParams,
        };

        const config = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        };

        console.debug('xAI request:', requestBody);

        const generateResponse = await fetch(apiUrl + '/chat/completions', config);

        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`xAI API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('xAI response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    } catch (error) {
        console.error('Error communicating with xAI API: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to AI/ML API.
 * @param {express.Request} request Express request
 */
async function sendAimlapiRequest(request) {
    const apiUrl = API_AIMLAPI;
    const apiKey = readSecret(request.user.directories, SECRET_KEYS.AIMLAPI);

    if (!apiKey) {
        console.warn('AI/ML API key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    try {
        let bodyParams = {};

        if (request.body.logprobs > 0) {
            bodyParams['top_logprobs'] = request.body.logprobs;
            bodyParams['logprobs'] = true;
        }

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
            bodyParams['tools'] = request.body.tools;
            bodyParams['tool_choice'] = request.body.tool_choice;
        }

        if (Array.isArray(request.body.stop) && request.body.stop.length > 0) {
            bodyParams['stop'] = request.body.stop;
        }

        if (request.body.reasoning_effort) {
            bodyParams['reasoning_effort'] = request.body.reasoning_effort;
        }

        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    description: request.body.json_schema.description,
                    schema: request.body.json_schema.value,
                    strict: request.body.json_schema.strict ?? true,
                },
            };
        }

        const requestBody = {
            'messages': request.body.messages,
            'model': request.body.model,
            'temperature': request.body.temperature,
            'max_tokens': request.body.max_tokens,
            'stream': request.body.stream,
            'presence_penalty': request.body.presence_penalty,
            'frequency_penalty': request.body.frequency_penalty,
            'top_p': request.body.top_p,
            'seed': request.body.seed,
            'n': request.body.n,
            ...bodyParams,
        };

        const config = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
                ...AIMLAPI_HEADERS,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        };

        console.debug('AI/ML API request:', requestBody);

        const generateResponse = await fetch(apiUrl + '/chat/completions', config);

        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn(`AI/ML API returned error: ${generateResponse.status} ${generateResponse.statusText} ${errorText}`);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('AI/ML API response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    } catch (error) {
        console.error('Error communicating with AI/ML API: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a request to Electron Hub.
 * @param {express.Request} request Express request
 */
async function sendElectronHubRequest(request) {
    const apiUrl = API_ELECTRONHUB;
    const apiKey = readSecret(request.user.directories, SECRET_KEYS.ELECTRONHUB);

    if (!apiKey) {
        console.warn('Electron Hub key is missing.');
        return createProviderJsonResult({ error: true }, { status: 400, ok: false });
    }

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    try {
        let bodyParams = {};

        if (request.body.enable_web_search) {
            bodyParams['web_search'] = true;
        }

        if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
            bodyParams['tools'] = request.body.tools;
            bodyParams['tool_choice'] = request.body.tool_choice;
        }

        if (request.body.reasoning_effort) {
            bodyParams['reasoning_effort'] = request.body.reasoning_effort;
        }

        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    description: request.body.json_schema.description,
                    schema: request.body.json_schema.value,
                    strict: request.body.json_schema.strict ?? true,
                },
            };
        }

        const requestBody = {
            'messages': request.body.messages,
            'model': request.body.model,
            'temperature': request.body.temperature,
            'max_tokens': request.body.max_tokens,
            'stream': request.body.stream,
            'presence_penalty': request.body.presence_penalty,
            'frequency_penalty': request.body.frequency_penalty,
            'top_p': request.body.top_p,
            'top_k': request.body.top_k,
            'logit_bias': request.body.logit_bias,
            'seed': request.body.seed,
            ...bodyParams,
        };

        const config = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        };

        console.debug('Electron Hub request:', requestBody);

        const generateResponse = await fetch(apiUrl + '/chat/completions', config);

        if (request.body.stream) {
            return createProviderStreamResult(generateResponse);
        } else {
            if (!generateResponse.ok) {
                const errorText = await generateResponse.text();
                console.warn('Electron Hub returned error: ', errorText);
                const errorJson = tryParse(errorText) ?? { error: true };
                return createProviderJsonResult(errorJson, { status: 500, ok: false });
            }
            const generateResponseJson = await generateResponse.json();
            console.debug('Electron Hub response:', generateResponseJson);
            return createProviderJsonResult(generateResponseJson);
        }
    }
    catch (error) {
        console.error('Error communicating with Electron Hub: ', error);
        return createProviderJsonResult({ error: true }, { status: 500, ok: false });
    }
}

/**
 * Sends a chat completion request to Azure OpenAI.
 * @param {express.Request} request Express request object (contains request.body with all generate_data)
 */
async function sendAzureOpenAIRequest(request) {
    // 1. GATHER & VALIDATE SETTINGS
    const { azure_base_url, azure_deployment_name, azure_api_version } = request.body;
    const apiKey = typeof request.body.azure_api_key === 'string'
        ? request.body.azure_api_key
        : readSecret(request.user.directories, SECRET_KEYS.AZURE_OPENAI);
    if (!azure_base_url || !azure_deployment_name || !azure_api_version || !apiKey) {
        return createProviderJsonResult({
            error: {
                message: 'Azure OpenAI configuration is incomplete. Please provide Base URL, Deployment Name, API Version, and API Key in the connection settings.',
            },
        }, { status: 400, ok: false });
    }

    // 2. PREPARE THE REQUEST
    const url = new URL(`/openai/deployments/${azure_deployment_name}/chat/completions`, azure_base_url);
    url.searchParams.set('api-version', azure_api_version);
    const endpointUrl = url.toString();

    // Create the base payload with all standard parameters
    const apiRequestBody = /** @type {any} */ ({});
    for (const key of AZURE_OPENAI_KEYS) {
        if (Object.hasOwn(request.body, key)) {
            apiRequestBody[key] = request.body[key];
        }
    }

    // Handle Structured Output (JSON Mode) by translating the custom `json_schema` object.
    if (request.body.json_schema) {
        apiRequestBody['response_format'] = {
            type: 'json_schema',
            json_schema: {
                name: request.body.json_schema.name,
                strict: request.body.json_schema.strict ?? true,
                schema: request.body.json_schema.value,
            },
        };
    }

    // Adjust logprobs for Azure OpenAI, which follows the OpenAI Chat Completions API spec.
    if (typeof apiRequestBody.logprobs === 'number' && apiRequestBody.logprobs > 0) {
        apiRequestBody.top_logprobs = apiRequestBody.logprobs;
        apiRequestBody.logprobs = true;
    }

    // Do not send reasoning effort to models which do not support it
    apiRequestBody['reasoning_effort'] = OPENAI_REASONING_EFFORT_MODELS.includes(request.body.model)
        ? OPENAI_REASONING_EFFORT_MAP[request.body.reasoning_effort] ?? request.body.reasoning_effort
        : undefined;

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', () => controller.abort());

    const config = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
        },
        body: JSON.stringify(apiRequestBody),
        signal: controller.signal,
    };

    console.info(`Sending request to Azure OpenAI: ${endpointUrl}`);
    console.debug('Azure OpenAI Request Body:', apiRequestBody);
    try {
        const fetchResponse = await fetch(endpointUrl, config);

        if (request.body.stream) {
            return createProviderStreamResult(fetchResponse);
        }

        if (fetchResponse.ok) {
            /** @type {any} */
            const json = await fetchResponse.json();
            console.debug('Azure OpenAI response:', json);
            return createProviderJsonResult(json);
        }

        const text = await fetchResponse.text();
        const data = tryParse(text) || { error: { message: fetchResponse.statusText || 'Unknown error occurred' } };
        return createProviderJsonResult(data, { status: 500, ok: false });
    } catch (error) {
        const message = error.name === 'AbortError'
            ? 'Request was aborted by the client.'
            : (error.message || 'An unknown network error occurred.');
        return createProviderJsonResult({ error: { message } }, { status: 500, ok: false });
    }
}

export const router = express.Router();

async function prepareServerPromptContext(user, directories, promptContext) {
    if (!promptContext || typeof promptContext !== 'object') {
        return { aborted: false, executedExtensions: [] };
    }

    if (!Array.isArray(promptContext.coreChat) && promptContext.coreChat && typeof promptContext.coreChat === 'object') {
        promptContext.coreChat = resolveSplitCoreChatPayload(directories.chats, promptContext.coreChat);
    }

    const runtimeResult = await runServerGenerationExtensions(directories, promptContext);
    if (runtimeResult.aborted) {
        throw new Error('Generation aborted by server extension runtime.');
    }

    const worldInfoRequest = promptContext.worldInfoRequest;
    if (worldInfoRequest && !Array.isArray(worldInfoRequest.sortedEntries)) {
        const promptState = promptContext.promptState && typeof promptContext.promptState === 'object'
            && !Array.isArray(promptContext.promptState)
            ? promptContext.promptState
            : null;
        const resolved = await resolveSortedEntriesPayload(user, worldInfoRequest);
        // Persist the prepared scan list on the request object so later assembly stages reuse it.
        worldInfoRequest.sortedEntries = prepareEntriesForScan(resolved.entries, {
            ...(worldInfoRequest.substitutionEnv || {}),
            macroSnapshot: worldInfoRequest.macroSnapshot || promptContext.macroSnapshot,
            extensionPrompts: promptContext.extensionPrompts || undefined,
            regexScripts: worldInfoRequest.regexScripts,
            promptState,
            quietPrompt: promptContext.quietPrompt || '',
            worldInfoPosition: worldInfoRequest.worldInfoPosition,
        });
    }

    return runtimeResult;
}

function getPromptAssemblyErrorStatus(error) {
    const errorName = String(error?.name || '');
    if (['TokenBudgetExceededError', 'IdentifierNotFoundError'].includes(errorName)) {
        return 422;
    }

    return 500;
}

function rewriteSystemMessagesForO1Model(model, chatCompletionSource, messages) {
    const normalizedModel = String(model || '');
    const normalizedSource = String(chatCompletionSource || '');
    if (
        !normalizedModel.startsWith('o1') ||
        ![
            CHAT_COMPLETION_SOURCES.OPENAI,
            CHAT_COMPLETION_SOURCES.AZURE_OPENAI,
        ].includes(normalizedSource) ||
        !Array.isArray(messages)
    ) {
        return messages;
    }

    for (const message of messages) {
        if (message?.role === 'system') {
            message.role = 'user';
        }
    }

    return messages;
}

/**
 * @param {any} user
 * @returns {boolean}
 */
function canViewPromptParityRawDebugData(user) {
    return Boolean(user?.profile?.admin);
}

function clonePromptInspectionSnapshot(snapshot) {
    return snapshot && typeof snapshot === 'object'
        ? structuredClone(snapshot)
        : null;
}

function sanitizePromptSnapshotKeyPart(value) {
    return String(value ?? '').replace(/\|/g, '').trim();
}

function buildPromptSnapshotKey(username, chatScope, mesId, swipeId) {
    const normalizedUsername = sanitizePromptSnapshotKeyPart(username);
    const normalizedChatScope = sanitizePromptSnapshotKeyPart(chatScope);
    const normalizedMesId = Number(mesId);
    const normalizedSwipeId = Number(swipeId);

    if (!normalizedUsername || !normalizedChatScope || !Number.isFinite(normalizedMesId) || normalizedMesId < 0 || !Number.isFinite(normalizedSwipeId) || normalizedSwipeId < 0) {
        return null;
    }

    return `${normalizedUsername}|${normalizedChatScope}|${normalizedMesId}|${normalizedSwipeId}`;
}

function parsePromptSnapshotKey(key) {
    const parts = String(key || '').split('|');
    if (parts.length !== 4) {
        return null;
    }

    const [username, chatScope, mesIdText, swipeIdText] = parts;
    const mesId = Number(mesIdText);
    const swipeId = Number(swipeIdText);
    if (!username || !chatScope || !Number.isFinite(mesId) || mesId < 0 || !Number.isFinite(swipeId) || swipeId < 0) {
        return null;
    }

    return { username, chatScope, mesId, swipeId };
}

function getPromptInspectionUserHandle(request) {
    return sanitizePromptSnapshotKeyPart(request?.user?.profile?.handle || '');
}

function getPromptInspectionInfo(request) {
    const promptInspection = request?.body?.prompt_context?.promptInspection;
    if (!promptInspection || typeof promptInspection !== 'object') {
        return null;
    }

    const username = getPromptInspectionUserHandle(request);
    const chatScope = sanitizePromptSnapshotKeyPart(promptInspection.chatScope || request?.body?.prompt_context?.currentChatId || '');
    const mesId = Number(promptInspection.mesId);
    const swipeId = Number(promptInspection.swipeId);
    const key = buildPromptSnapshotKey(username, chatScope, mesId, swipeId);

    if (!key) {
        return null;
    }

    return { key, username, chatScope, mesId, swipeId };
}

function setPromptInspectionSnapshot(key, snapshot) {
    if (!key) {
        return;
    }

    if (promptInspectionSnapshots.has(key)) {
        promptInspectionSnapshots.delete(key);
    }

    promptInspectionSnapshots.set(key, clonePromptInspectionSnapshot(snapshot));

    while (promptInspectionSnapshots.size > MAX_PROMPT_INSPECTION_SNAPSHOTS) {
        const oldestKey = promptInspectionSnapshots.keys().next().value;
        promptInspectionSnapshots.delete(oldestKey);
    }
}

function getPromptInspectionSnapshot(key) {
    if (!key || !promptInspectionSnapshots.has(key)) {
        return null;
    }

    const snapshot = promptInspectionSnapshots.get(key);
    promptInspectionSnapshots.delete(key);
    promptInspectionSnapshots.set(key, snapshot);
    return clonePromptInspectionSnapshot(snapshot);
}

function deletePromptInspectionSnapshot(key) {
    if (!key) {
        return false;
    }

    return promptInspectionSnapshots.delete(key);
}

function rekeyPromptInspectionSnapshot(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey || !promptInspectionSnapshots.has(fromKey)) {
        return false;
    }

    const snapshot = promptInspectionSnapshots.get(fromKey);
    promptInspectionSnapshots.delete(fromKey);

    const parsedKey = parsePromptSnapshotKey(toKey);
    const rekeyedSnapshot = clonePromptInspectionSnapshot(snapshot);
    if (rekeyedSnapshot && parsedKey) {
        rekeyedSnapshot.key = toKey;
        rekeyedSnapshot.username = parsedKey.username;
        rekeyedSnapshot.chatScope = parsedKey.chatScope;
        rekeyedSnapshot.mesId = parsedKey.mesId;
        rekeyedSnapshot.swipeId = parsedKey.swipeId;
    }

    setPromptInspectionSnapshot(toKey, rekeyedSnapshot);
    return true;
}

function isPromptSnapshotAuthorizedForRequest(request, key) {
    const parsedKey = parsePromptSnapshotKey(key);
    if (!parsedKey) {
        return false;
    }

    return parsedKey.username === getPromptInspectionUserHandle(request);
}

function shouldRewriteSystemMessagesForO1Model(model, chatCompletionSource) {
    const normalizedModel = String(model || '');
    const normalizedSource = String(chatCompletionSource || '');

    return normalizedModel.startsWith('o1') && [
        CHAT_COMPLETION_SOURCES.OPENAI,
        CHAT_COMPLETION_SOURCES.AZURE_OPENAI,
    ].includes(normalizedSource);
}

function createPromptInspectionSnapshot(request, assembled, promptInspectionInfo) {
    if (!assembled || !promptInspectionInfo) {
        return null;
    }

    const model = request?.body?.prompt_context?.model ?? request?.body?.model ?? null;
    const source = request?.body?.prompt_context?.chatCompletionSource ?? request?.body?.chat_completion_source ?? null;

    return {
        key: promptInspectionInfo.key,
        username: promptInspectionInfo.username,
        chatScope: promptInspectionInfo.chatScope,
        mesId: promptInspectionInfo.mesId,
        swipeId: promptInspectionInfo.swipeId,
        createdAt: new Date().toISOString(),
        type: request?.body?.prompt_context?.type ?? request?.body?.type ?? null,
        source,
        model,
        assembly: structuredClone(assembled),
        worldInfo: structuredClone(assembled?.worldInfo || null),
        itemization: structuredClone(assembled?.itemization || null),
        dispatchMetadata: {
            source,
            model,
            custom_prompt_post_processing: request?.body?.custom_prompt_post_processing ?? null,
            willRewriteSystemMessagesForO1: shouldRewriteSystemMessagesForO1Model(model, source),
        },
    };
}

function getSecureLorebookOwnerHandleFromName(bookName) {
    const normalizedBookName = String(bookName || '').trim();
    const match = /^Z-([^-]+)-.+$/.exec(normalizedBookName);
    return match ? match[1] : '';
}

function getWorldInfoEntryOwnerHandle(entry) {
    const directOwnerHandle = String(entry?.ownerHandle || '').trim();
    if (directOwnerHandle) {
        return directOwnerHandle;
    }

    return entry?.storage === 'secure'
        ? getSecureLorebookOwnerHandleFromName(entry?.book)
        : '';
}

function getWorldInfoEntryOwnerHandles(entry) {
    const ownerHandles = Array.isArray(entry?.ownerHandles)
        ? entry.ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean)
        : [];

    if (ownerHandles.length > 0) {
        return ownerHandles;
    }

    const ownerHandle = getWorldInfoEntryOwnerHandle(entry);
    return ownerHandle ? [ownerHandle] : [];
}

function isWorldInfoEntryHiddenForUser(user, entry) {
    if (Boolean(user?.profile?.admin)) {
        return false;
    }

    if (!entry || entry.storage !== 'secure') {
        return false;
    }

    const requestHandle = String(user?.profile?.handle || '');
    const ownerHandles = getWorldInfoEntryOwnerHandles(entry);
    return !requestHandle || ownerHandles.length === 0 || !ownerHandles.includes(requestHandle);
}

function canViewWorldInfoEntry(user, entry) {
    return !isWorldInfoEntryHiddenForUser(user, entry);
}

function sanitizeWorldInfoEntryForResponse(entry, user) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const canView = canViewWorldInfoEntry(user, entry);
    const sanitizedEntry = structuredClone(entry);

    sanitizedEntry.storage = entry.storage === 'secure' ? 'secure' : 'user';
    sanitizedEntry.ownerHandle = canView ? getWorldInfoEntryOwnerHandle(entry) : '';
    sanitizedEntry.ownerHandles = canView ? getWorldInfoEntryOwnerHandles(entry) : [];
    sanitizedEntry.hidden = !canView;
    sanitizedEntry.displayContent = canView
        ? String(entry.displayContent ?? entry.content ?? '')
        : '(hidden entry)';
    sanitizedEntry.content = canView ? String(entry.content ?? '') : '';

    if (!canView) {
        sanitizedEntry.key = null;
        sanitizedEntry.uid = null;
        sanitizedEntry.book = null;
        sanitizedEntry.displayName = null;
        sanitizedEntry.comment = null;
        sanitizedEntry.matchedPrimaryKey = null;
        sanitizedEntry.matchedSecondaryKeys = [];
    }

    return sanitizedEntry;
}

function sanitizeWorldInfoDebugDataForResponse(worldInfo, user) {
    if (!worldInfo || typeof worldInfo !== 'object') {
        return null;
    }

    const activatedEntries = Array.isArray(worldInfo.activatedEntries)
        ? worldInfo.activatedEntries.map(entry => sanitizeWorldInfoEntryForResponse(entry, user)).filter(Boolean)
        : [];
    const admittedEntries = activatedEntries.filter(entry => entry.status === 'admitted');
    const rounds = Array.isArray(worldInfo.rounds)
        ? worldInfo.rounds.map(round => {
            const roundIndex = Number(round?.roundIndex ?? 0) || 0;
            const roundEntries = activatedEntries.filter(entry => (Number(entry.roundIndex ?? 0) || 0) === roundIndex);
            return {
                roundIndex,
                scanState: round?.scanState ?? null,
                entries: roundEntries,
                admittedEntries: roundEntries.filter(entry => entry.status === 'admitted').length,
                droppedEntries: roundEntries.filter(entry => entry.status !== 'admitted').length,
            };
        })
        : [];

    return {
        activatedEntries,
        beforeEntries: admittedEntries.filter(entry => entry.placement === 'before'),
        afterEntries: admittedEntries.filter(entry => entry.placement === 'after'),
        depthEntries: admittedEntries.filter(entry => String(entry.placement || '').startsWith('depth:')),
        exampleEntries: admittedEntries.filter(entry => String(entry.placement || '').startsWith('example_')),
        timedState: structuredClone(worldInfo.timedState || {}),
        overflowed: Boolean(worldInfo.overflowed),
        rounds,
        budgetUsed: structuredClone(worldInfo.budgetUsed || {}),
    };
}

function normalizeContentSegmentsForResponse(segments = []) {
    const normalizedSegments = [];

    for (const segment of Array.isArray(segments) ? segments : []) {
        if (!segment || typeof segment !== 'object') {
            continue;
        }

        const text = String(segment.text ?? '');
        if (!text) {
            continue;
        }

        const normalizedSegment = segment.type === 'worldInfo'
            ? {
                type: 'worldInfo',
                text,
                storage: segment.storage === 'secure' ? 'secure' : 'user',
                ownerHandle: getWorldInfoEntryOwnerHandle(segment),
                book: segment.book ?? null,
                uid: segment.uid ?? null,
                placement: segment.placement ?? null,
                roundIndex: Number(segment.roundIndex ?? 0) || 0,
                status: segment.status ?? null,
            }
            : {
                type: 'text',
                text,
            };

        const previousSegment = normalizedSegments[normalizedSegments.length - 1];
        if (previousSegment && previousSegment.type === 'text' && normalizedSegment.type === 'text') {
            previousSegment.text += normalizedSegment.text;
        } else {
            normalizedSegments.push(normalizedSegment);
        }
    }

    return normalizedSegments;
}

function flattenContentSegmentsForResponse(segments = []) {
    return normalizeContentSegmentsForResponse(segments)
        .map(segment => String(segment.text ?? ''))
        .join('');
}

function sanitizePromptContentSegmentsForResponse(segments, user) {
    const sanitizedSegments = [];

    for (const segment of normalizeContentSegmentsForResponse(segments)) {
        if (segment.type !== 'worldInfo') {
            sanitizedSegments.push(segment);
            continue;
        }

        if (canViewWorldInfoEntry(user, segment)) {
            sanitizedSegments.push(segment);
            continue;
        }

        sanitizedSegments.push({
            type: 'text',
            text: '(hidden entry)',
        });
    }

    return normalizeContentSegmentsForResponse(sanitizedSegments);
}

function sanitizePromptMessageContentForResponse(content, contentSegments, user) {
    if (!Array.isArray(contentSegments) || !contentSegments.length) {
        return {
            content: structuredClone(content),
            contentSegments: undefined,
        };
    }

    const sanitizedSegments = sanitizePromptContentSegmentsForResponse(contentSegments, user);
    return {
        content: flattenContentSegmentsForResponse(sanitizedSegments),
        contentSegments: sanitizedSegments,
    };
}

function sanitizeMessagesStateForResponse(node, user) {
    if (!node || typeof node !== 'object') {
        return null;
    }

    if (node.type === 'collection') {
        const sanitizedCollection = structuredClone(node);
        sanitizedCollection.collection = Array.isArray(node.collection)
            ? node.collection
                .map(child => sanitizeMessagesStateForResponse(child, user))
                .filter(Boolean)
            : [];
        return sanitizedCollection;
    }

    if (node.type !== 'message') {
        return structuredClone(node);
    }

    const sanitizedMessage = structuredClone(node);
    const sanitizedContent = sanitizePromptMessageContentForResponse(sanitizedMessage.content, sanitizedMessage.contentSegments, user);
    sanitizedMessage.content = sanitizedContent.content;
    sanitizedMessage.contentSegments = sanitizedContent.contentSegments;
    return sanitizedMessage;
}

function buildChatFromMessagesState(node, result = []) {
    if (!node || typeof node !== 'object') {
        return result;
    }

    if (node.type === 'collection') {
        const collection = Array.isArray(node.collection) ? node.collection : [];
        collection.forEach(child => buildChatFromMessagesState(child, result));
        return result;
    }

    if (node.type !== 'message') {
        return result;
    }

    const message = {
        role: node.role,
        content: typeof node.content === 'string' || Array.isArray(node.content)
            ? structuredClone(node.content)
            : String(node.content ?? ''),
    };

    if (node.name !== undefined) {
        message.name = node.name;
    }

    if (node.tool_calls !== undefined) {
        message.tool_calls = structuredClone(node.tool_calls);
    }

    if (node.tool_call_id !== undefined) {
        message.tool_call_id = node.tool_call_id;
    }

    result.push(message);
    return result;
}

function buildPromptTextFromChat(chat = []) {
    return Array.isArray(chat)
        ? chat.map(message => String(message?.content ?? '')).join('\n')
        : '';
}

function buildRedactedChatForResponse(assembly, user) {
    const sourceMessagesState = assembly?.messagesState;

    if (sourceMessagesState && typeof sourceMessagesState === 'object') {
        const messagesState = sanitizeMessagesStateForResponse(sourceMessagesState, user);
        return {
            messagesState,
            chat: buildChatFromMessagesState(messagesState, []),
        };
    }

    return {
        messagesState: null,
        chat: Boolean(user?.profile?.admin) && Array.isArray(assembly?.chat)
            ? structuredClone(assembly.chat)
            : [],
    };
}

function sanitizePromptAssemblyForSnapshotResponse(assembly, user) {
    if (!assembly || typeof assembly !== 'object') {
        return assembly;
    }

    const sanitizedAssembly = structuredClone(assembly);
    const sanitizedWorldInfo = sanitizeWorldInfoDebugDataForResponse(assembly.worldInfo, user);
    const sanitizedPromptData = buildRedactedChatForResponse(assembly, user);

    sanitizedAssembly.worldInfo = sanitizedWorldInfo;
    sanitizedAssembly.messagesState = sanitizedPromptData.messagesState;
    sanitizedAssembly.chat = Array.isArray(sanitizedPromptData.chat) ? sanitizedPromptData.chat : [];
    sanitizedAssembly.redactedPromptText = buildPromptTextFromChat(sanitizedAssembly.chat);
    delete sanitizedAssembly.overriddenPrompts;
    delete sanitizedAssembly.comparison;

    return sanitizedAssembly;
}

function sanitizePromptAssemblyForResponse(assembly, user) {
    if (!assembly || typeof assembly !== 'object') {
        return assembly;
    }

    const canViewRawDebugData = canViewPromptParityRawDebugData(user);
    const sanitizedAssembly = sanitizePromptAssemblyForSnapshotResponse(assembly, user);

    if (!canViewRawDebugData) {
        delete sanitizedAssembly.chat;
    }

    return sanitizedAssembly;
}

function sanitizePromptInspectionSnapshotForResponse(snapshot, user) {
    if (!snapshot || typeof snapshot !== 'object') {
        return snapshot;
    }

    const assembly = sanitizePromptAssemblyForSnapshotResponse(snapshot.assembly, user);
    const { worldInfoSummary, worldInfoReport } = buildWorldInfoSummaryResponseData(assembly?.worldInfo, user);

    return {
        key: snapshot.key ?? null,
        username: snapshot.username ?? null,
        chatScope: snapshot.chatScope ?? null,
        mesId: snapshot.mesId ?? null,
        swipeId: snapshot.swipeId ?? null,
        createdAt: snapshot.createdAt ?? null,
        type: snapshot.type ?? null,
        source: snapshot.source ?? null,
        model: snapshot.model ?? null,
        assembly,
        worldInfo: structuredClone(assembly?.worldInfo || null),
        worldInfoSummary,
        worldInfoReport,
        itemization: structuredClone(assembly?.itemization || snapshot.itemization || null),
        dispatchMetadata: structuredClone(snapshot.dispatchMetadata || null),
    };
}

function buildWorldInfoSummaryResponseData(worldInfo, user) {
    const sanitizedWorldInfo = sanitizeWorldInfoDebugDataForResponse(worldInfo, user);
    if (!sanitizedWorldInfo) {
        return { sanitizedWorldInfo: null, worldInfoSummary: null, worldInfoReport: null };
    }

    const activatedEntries = sanitizedWorldInfo.activatedEntries;
    const admittedEntries = activatedEntries.filter(entry => entry.status === 'admitted');
    const worldInfoReport = structuredClone(sanitizedWorldInfo);

    const worldInfoSummary = {
        activeEntries: admittedEntries.map(entry => ({
            key: entry.key,
            book: entry.book,
            uid: entry.uid,
            storage: entry.storage,
            ownerHandle: entry.ownerHandle,
            displayName: entry.displayName,
            displayContent: entry.displayContent,
            hidden: entry.hidden,
            tokens: Number(entry.tokens ?? 0) || 0,
            placement: entry.placement ?? null,
            roundIndex: Number(entry.roundIndex ?? 0) || 0,
            status: entry.status ?? null,
        })),
        overflowed: Boolean(sanitizedWorldInfo.overflowed),
        totalTokens: admittedEntries.reduce((total, entry) => total + (Number(entry.tokens ?? 0) || 0), 0),
        activeEntriesCount: admittedEntries.length,
        budgetUsed: structuredClone(sanitizedWorldInfo.budgetUsed || {}),
    };

    return { sanitizedWorldInfo, worldInfoSummary, worldInfoReport };
}

function buildXSillyTavernPayload(request, timedWorldInfo, worldInfoOverflowed = false, worldInfo = null, promptSnapshotKey = null) {
    const xSillyTavern = {};
    const { worldInfoSummary, worldInfoReport } = buildWorldInfoSummaryResponseData(worldInfo, request?.user);

    if (typeof promptSnapshotKey === 'string' && promptSnapshotKey) {
        xSillyTavern.promptSnapshotKey = promptSnapshotKey;
    }
    if (timedWorldInfo && typeof timedWorldInfo === 'object') {
        xSillyTavern.timedWorldInfo = timedWorldInfo;
    }
    if (worldInfoOverflowed) {
        xSillyTavern.worldInfoOverflowed = true;
    }
    if (worldInfoSummary) {
        xSillyTavern.worldInfoSummary = worldInfoSummary;
    }
    if (worldInfoReport) {
        xSillyTavern.worldInfoReport = worldInfoReport;
    }

    return xSillyTavern;
}

function attachWorldInfoResponseData(payload, request, timedWorldInfo, worldInfoOverflowed = false, worldInfo = null, promptSnapshotKey = null) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }

    const xSillyTavern = {
        ...(payload.x_sillytavern && typeof payload.x_sillytavern === 'object' ? payload.x_sillytavern : {}),
        ...buildXSillyTavernPayload(request, timedWorldInfo, worldInfoOverflowed, worldInfo, promptSnapshotKey),
    };
    const { sanitizedWorldInfo } = buildWorldInfoSummaryResponseData(worldInfo, request?.user);
    if (sanitizedWorldInfo) {
        payload.worldInfo = structuredClone(sanitizedWorldInfo);
    }

    if (!Object.keys(xSillyTavern).length) {
        return payload;
    }

    payload.x_sillytavern = {
        ...xSillyTavern,
    };
    return payload;
}

function writeWorldInfoSseEvent(response, request, timedWorldInfo, worldInfoOverflowed = false, worldInfo = null, promptSnapshotKey = null) {
    if (response.writableEnded) {
        return;
    }

    const xSillyTavern = buildXSillyTavernPayload(request, timedWorldInfo, worldInfoOverflowed, worldInfo, promptSnapshotKey);
    if (!Object.keys(xSillyTavern).length) {
        return;
    }

    response.write(`data: ${JSON.stringify({ x_sillytavern: xSillyTavern })}\n\n`);
}

async function forwardFetchResponseWithWorldInfo(from, to, request, timedWorldInfo, worldInfoOverflowed = false, worldInfo = null, promptSnapshotKey = null) {
    let statusCode = from.status;
    let statusText = from.statusText;

    if (!from.ok) {
        console.warn(`Streaming request failed with status ${statusCode} ${statusText}`);
    }

    if (statusCode === 401) {
        statusCode = 400;
    }

    to.statusCode = statusCode;
    to.statusMessage = statusText;
    to.setHeader('Content-Type', from.headers.get('content-type') || 'text/event-stream; charset=utf-8');
    to.setHeader('Cache-Control', from.headers.get('cache-control') || 'no-cache');
    to.setHeader('Connection', 'keep-alive');

    if (!from.body || !to.socket) {
        writeWorldInfoSseEvent(to, request, timedWorldInfo, worldInfoOverflowed, worldInfo, promptSnapshotKey);
        to.end();
        return;
    }

    writeWorldInfoSseEvent(to, request, timedWorldInfo, worldInfoOverflowed, worldInfo, promptSnapshotKey);

    const decoder = new TextDecoder();
    let buffer = '';

    const flushEventBlock = (eventBlock) => {
        if (!eventBlock || to.writableEnded) {
            return;
        }

        to.write(`${eventBlock}\n\n`);
    };

    to.socket.on('close', function () {
        from.body.destroy();
        if (!to.writableEnded) {
            to.end();
        }
    });

    try {
        for await (const chunk of from.body) {
            buffer += decoder.decode(chunk, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() ?? '';

            for (const eventBlock of events) {
                flushEventBlock(eventBlock);
            }
        }

        buffer += decoder.decode();

        if (buffer) {
            flushEventBlock(buffer);
        }

        console.info('Streaming request finished');
        if (!to.writableEnded) {
            to.end();
        }
    } catch (error) {
        console.error('Streaming request failed', error);
        if (!to.writableEnded) {
            to.end();
        }
    }
}

function toPromptAssemblyErrorBody(error) {
    return {
        error: {
            message: String(error?.message || error),
            type: String(error?.name || 'Error'),
        },
    };
}

router.post('/status', async function (request, statusResponse) {
    if (!request.body) return statusResponse.sendStatus(400);

    if (request.body.reverse_proxy && isVoidaiAppUrl(request.body.reverse_proxy)) {
        console.warn('Blocked reverse proxy endpoint (voidai.app).');
        return statusResponse.status(403).send({ error: { message: 'The domain voidai.app is blocked as a custom API endpoint.' } });
    }

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM && isVoidaiAppUrl(request.body.custom_url)) {
        console.warn('Blocked custom endpoint (voidai.app).');
        return statusResponse.status(403).send({ error: { message: 'The domain voidai.app is blocked as a custom API endpoint.' } });
    }

    let apiUrl = '';
    let apiKey = '';
    let headers = {};
    let queryParams = {};

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENAI) {
        apiUrl = new URL(request.body.reverse_proxy || API_OPENAI).toString();
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.OPENAI);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENROUTER) {
        apiUrl = 'https://openrouter.ai/api/v1';
        apiKey = readSecret(request.user.directories, SECRET_KEYS.OPENROUTER);
        // OpenRouter needs to pass the Referer and X-Title: https://openrouter.ai/docs#requests
        headers = { ...OPENROUTER_HEADERS };
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MISTRALAI) {
        apiUrl = new URL(request.body.reverse_proxy || API_MISTRAL).toString();
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.MISTRALAI);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM) {
        apiUrl = request.body.custom_url;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.CUSTOM);
        headers = {};
        mergeObjectWithYaml(headers, request.body.custom_include_headers);
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.COHERE) {
        apiUrl = API_COHERE_V1;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.COHERE);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.ELECTRONHUB) {
        apiUrl = API_ELECTRONHUB;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.ELECTRONHUB);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.NAVY) {
        apiUrl = API_NAVY;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.NAVY);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.ZANITY) {
        apiUrl = request.body.custom_url || getZanityApiUrl(request.body.zanity_endpoint);
        apiKey = readSecret(request.user.directories, SECRET_KEYS.ZANITY);
        headers = {};
        mergeObjectWithYaml(headers, request.body.custom_include_headers);
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.NANOGPT) {
        apiUrl = API_NANOGPT;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.NANOGPT);
        headers = {};
        queryParams = { detailed: true };
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.DEEPSEEK) {
        apiUrl = new URL(request.body.reverse_proxy || API_DEEPSEEK.replace('/beta', '')).toString();
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.DEEPSEEK);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.XAI) {
        apiUrl = new URL(request.body.reverse_proxy || API_XAI).toString();
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.XAI);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.AIMLAPI) {
        apiUrl = API_AIMLAPI;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.AIMLAPI);
        headers = { ...AIMLAPI_HEADERS };
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.POLLINATIONS) {
        apiUrl = 'https://text.pollinations.ai';
        apiKey = 'NONE';
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.GROQ) {
        apiUrl = API_GROQ;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.GROQ);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.COMETAPI) {
        apiUrl = API_COMETAPI;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.COMETAPI);
        headers = {};
        throw new Error('This provider is temporarily disabled.');
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MOONSHOT) {
        apiUrl = API_MOONSHOT;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.MOONSHOT);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.FIREWORKS) {
        apiUrl = API_FIREWORKS;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.FIREWORKS);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MAKERSUITE) {
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.MAKERSUITE);
        apiUrl = trimTrailingSlash(request.body.reverse_proxy || API_MAKERSUITE);
        const apiVersion = getConfigValue('gemini.apiVersion', 'v1beta');
        const modelsUrl = !apiKey && request.body.reverse_proxy
            ? `${apiUrl}/${apiVersion}/models`
            : `${apiUrl}/${apiVersion}/models?key=${apiKey}`;

        if (!apiKey && !request.body.reverse_proxy) {
            console.warn('Google AI Studio API key is missing.');
            return statusResponse.status(400).send({ error: true });
        }

        try {
            const response = await fetch(modelsUrl);

            if (response.ok) {
                /** @type {any} */
                const data = await response.json();
                // Transform Google AI Studio models to OpenAI format
                const models = data.models
                    ?.filter(model => model.supportedGenerationMethods?.includes('generateContent'))
                    ?.map(model => ({
                        id: model.name.replace('models/', ''),
                    })) || [];

                console.info('Available Google AI Studio models:', models.map(m => m.id));
                return statusResponse.send({ data: models });
            } else {
                console.warn('Google AI Studio models endpoint failed:', response.status, response.statusText);
                return statusResponse.send({ error: true, bypass: true, data: { data: [] } });
            }
        } catch (error) {
            console.error('Error fetching Google AI Studio models:', error);
            return statusResponse.send({ error: true, bypass: true, data: { data: [] } });
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.AZURE_OPENAI) {
        const { azure_base_url, azure_deployment_name, azure_api_version } = request.body;
        const apiKey = typeof request.body.azure_api_key === 'string'
            ? request.body.azure_api_key
            : readSecret(request.user.directories, SECRET_KEYS.AZURE_OPENAI);

        // 1) Validate configuration from the frontend
        if (!apiKey || !azure_base_url || !azure_deployment_name || !azure_api_version) {
            console.warn('Azure OpenAI status check failed: missing config from frontend.');
            return statusResponse.status(400).send({ error: true, message: 'Azure configuration is incomplete.' });
        }
        // 2) Build URLs using the URL API for consistency and robustness.
        const modelsUrl = new URL('/openai/models', azure_base_url);
        modelsUrl.searchParams.set('api-version', azure_api_version);

        const chatUrl = new URL(`/openai/deployments/${azure_deployment_name}/chat/completions`, azure_base_url);
        chatUrl.searchParams.set('api-version', azure_api_version);

        // Map common status codes to user-friendly error messages
        const azureStatusErrorMap = {
            400: 'API version may be invalid for this resource.',
            401: 'Invalid API key or insufficient permissions.',
            403: 'Invalid API key or insufficient permissions.',
            404: 'Endpoint URL appears incorrect (404).',
        };

        try {
            // ---- A) GET /models: fast sanity check for endpoint + api key + api version ----
            const apiConfigTest = await fetch(modelsUrl, {
                method: 'GET',
                headers: { 'api-key': apiKey, 'Accept': 'application/json' },
            });

            if (!apiConfigTest.ok) {
                let errText = '';
                try { errText = await apiConfigTest.text(); } catch { /* response body may be empty */ }

                console.warn('Azure OpenAI GET /models failed:', apiConfigTest.status, apiConfigTest.statusText, errText || '');

                const defaultMessage = `Azure Models endpoint error: ${apiConfigTest.statusText}`;
                const message = azureStatusErrorMap[apiConfigTest.status] ?? defaultMessage;
                return statusResponse.status(apiConfigTest.status).send({ error: true, message });
            }

            // ---- B) POST /chat/completions: verify deployment + read underlying model ID ----
            // Small, deterministic probe to minimize cost/latency
            const modelPayload = {
                messages: [{ role: 'user', content: 'Say word Hi' }],
                stream: false,
                max_completion_tokens: 5,
            };

            const modelRequest = await fetch(chatUrl, {
                method: 'POST',
                headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(modelPayload),
            });

            let modelResponse;
            try {
                modelResponse = await modelRequest.json();
            } catch {
                modelResponse = { raw: 'Failed to parse JSON response from chat completions probe.' };
            }

            const modelId = /** @type {any} */ (modelResponse)?.model;
            if (!modelId) {
                console.warn('Azure status check succeeded but could not find a model ID in the response.');
                console.debug('Azure Response Body:', modelResponse);
                // Keep a benign success to avoid UX disruption in the UI
                return statusResponse.send({ data: [] });
            }

            console.info(color.green('Azure OpenAI connection successful. Detected model:'), modelId);
            // Consistent response format: always an array of { id }
            return statusResponse.send({ data: [{ id: modelId }] });
        } catch (error) {
            console.error('Azure OpenAI status check connection error:', error);
            return statusResponse.status(500).send({ error: true, message: 'Failed to connect to the Azure endpoint.' });
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.SILICONFLOW) {
        apiUrl = API_SILICONFLOW;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.SILICONFLOW);
        headers = {};
    } else {
        console.warn('This chat completion source is not supported yet.');
        return statusResponse.status(400).send({ error: true });
    }

    if (!apiKey && !request.body.reverse_proxy && request.body.chat_completion_source !== CHAT_COMPLETION_SOURCES.CUSTOM) {
        console.warn('Chat Completion API key is missing.');
        return statusResponse.status(400).send({ error: true });
    }

    try {
        const modelsUrl = new URL(urlJoin(apiUrl, '/models'));
        Object.keys(queryParams).forEach(key => {
            modelsUrl.searchParams.append(key, queryParams[key]);
        });
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.NAVY
                ? { ...headers }
                : {
                    'Authorization': 'Bearer ' + apiKey,
                    ...headers,
                },
        });

        if (response.ok) {
            /** @type {any} */
            let data = await response.json();

            if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.POLLINATIONS && Array.isArray(data)) {
                data = { data: data.map(model => ({ id: model.name, ...model })) };
            }

            if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.NAVY && Array.isArray(data?.data)) {
                data = {
                    ...data,
                    data: data.data.filter(isNavyChatModel),
                };
            }

            statusResponse.send(data);

            if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.COHERE && Array.isArray(data?.models)) {
                data.data = data.models.map(model => ({ id: model.name, ...model }));
            }

            if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENROUTER && Array.isArray(data?.data)) {
                let models = [];

                data.data.forEach(model => {
                    const context_length = model.context_length;
                    const tokens_dollar = Number(1 / (1000 * model.pricing?.prompt));
                    const tokens_rounded = (Math.round(tokens_dollar * 1000) / 1000).toFixed(0);
                    models[model.id] = {
                        tokens_per_dollar: tokens_rounded + 'k',
                        context_length: context_length,
                    };
                });

                console.info('Available OpenRouter models:', models);
            } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MISTRALAI) {
                const models = data?.data;
                console.info(models);
            } else {
                const models = data?.data;

                if (Array.isArray(models)) {
                    const modelIds = models.filter(x => x && typeof x === 'object').map(x => x.id).sort();
                    console.info('Available models:', modelIds);
                } else {
                    console.warn('Chat Completion endpoint did not return a list of models.');
                }
            }
        }
        else {
            console.error('Chat Completion status check failed. Either Access Token is incorrect or API endpoint is down.');
            statusResponse.send({ error: true, data: { data: [] } });
        }
    } catch (e) {
        console.error(e);

        if (!statusResponse.headersSent) {
            statusResponse.send({ error: true });
        } else {
            statusResponse.end();
        }
    }
});

router.post('/bias', async function (request, response) {
    if (!request.body || !Array.isArray(request.body))
        return response.sendStatus(400);

    try {
        const result = {};
        const model = getTokenizerModel(String(request.query.model || ''));

        // no bias for claude
        if (model == 'claude') {
            return response.send(result);
        }

        let encodeFunction;

        if (sentencepieceTokenizers.includes(model)) {
            const tokenizer = getSentencepieceTokenizer(model);
            const instance = await tokenizer?.get();
            if (!instance) {
                console.error('Tokenizer not initialized:', model);
                return response.send({});
            }
            encodeFunction = (text) => new Uint32Array(instance.encodeIds(text));
        } else if (webTokenizers.includes(model)) {
            const tokenizer = getWebTokenizer(model);
            const instance = await tokenizer?.get();
            if (!instance) {
                console.warn('Tokenizer not initialized:', model);
                return response.send({});
            }
            encodeFunction = (text) => new Uint32Array(instance.encode(text));
        } else {
            const tokenizer = getTiktokenTokenizer(model);
            encodeFunction = (tokenizer.encode.bind(tokenizer));
        }

        for (const entry of request.body) {
            if (!entry || !entry.text) {
                continue;
            }

            try {
                const tokens = getEntryTokens(entry.text, encodeFunction);

                for (const token of tokens) {
                    result[token] = entry.value;
                }
            } catch {
                console.warn('Tokenizer failed to encode:', entry.text);
            }
        }

        // not needed for cached tokenizers
        //tokenizer.free();
        return response.send(result);

        /**
         * Gets tokenids for a given entry
         * @param {string} text Entry text
         * @param {(string) => Uint32Array} encode Function to encode text to token ids
         * @returns {Uint32Array} Array of token ids
         */
        function getEntryTokens(text, encode) {
            // Get raw token ids from JSON array
            if (text.trim().startsWith('[') && text.trim().endsWith(']')) {
                try {
                    const json = JSON.parse(text);
                    if (Array.isArray(json) && json.every(x => typeof x === 'number')) {
                        return new Uint32Array(json);
                    }
                } catch {
                    // ignore
                }
            }

            // Otherwise, get token ids from tokenizer
            return encode(text);
        }
    } catch (error) {
        console.error(error);
        return response.send({});
    }
});


export async function handleChatCompletionsGenerate(request, response) {
    if (!request.body) return response.status(400).send({ error: true });

    return (async () => {

    if (request.body.reverse_proxy && isVoidaiAppUrl(request.body.reverse_proxy)) {
        console.warn('Blocked reverse proxy endpoint (voidai.app).');
        return response.status(403).send({ error: { message: 'The domain voidai.app is blocked as a custom API endpoint.' } });
    }

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM && isVoidaiAppUrl(request.body.custom_url)) {
        console.warn('Blocked custom endpoint (voidai.app).');
        return response.status(403).send({ error: { message: 'The domain voidai.app is blocked as a custom API endpoint.' } });
    }

    const postProcessingType = request.body.custom_prompt_post_processing;

    if (request.body.json_schema?.value) {
        request.body.json_schema.value = flattenSchema(request.body.json_schema.value, request.body.chat_completion_source);
    }

    let assembledPromptContext = false;
    let assembledTimedWorldInfo = null;
    let assembledWorldInfoOverflowed = false;
    let assembledPromptSnapshot = null;
    let promptInspectionInfo = null;
    if (!Array.isArray(request.body.messages) && request.body.prompt_context && typeof request.body.prompt_context === 'object') {
        request.body.prompt_context.includeItemization = true;
        await prepareServerPromptContext(request.user, request.user.directories, request.body.prompt_context);
        const assembled = await assembleChatCompletionPrompt(request.body.prompt_context);
        promptInspectionInfo = getPromptInspectionInfo(request);
        if (promptInspectionInfo) {
            assembledPromptSnapshot = assembled;
            const promptSnapshotCount = Math.max(1, Number(request.body.n) || 1);
            for (let index = 0; index < promptSnapshotCount; index++) {
                const snapshotInfo = index === 0
                    ? promptInspectionInfo
                    : {
                        ...promptInspectionInfo,
                        swipeId: promptInspectionInfo.swipeId + index,
                        key: buildPromptSnapshotKey(
                            promptInspectionInfo.username,
                            promptInspectionInfo.chatScope,
                            promptInspectionInfo.mesId,
                            promptInspectionInfo.swipeId + index,
                        ),
                    };
                if (snapshotInfo?.key) {
                    setPromptInspectionSnapshot(snapshotInfo.key, createPromptInspectionSnapshot(request, assembled, snapshotInfo));
                }
            }
        }
        rewriteSystemMessagesForO1Model(request.body.prompt_context.model, request.body.prompt_context.chatCompletionSource, assembled.chat);
        request.body.messages = assembled.chat;
        response.setHeader('X-ST-Messages-Count', String(Number(assembled.messagesCount) || 0));
        assembledTimedWorldInfo = assembled.timedWorldInfo;
        assembledWorldInfoOverflowed = Boolean(assembled.worldInfoOverflowed);
        assembledPromptContext = true;
    }

    if (!Array.isArray(request.body.messages) && typeof request.body.messages !== 'string') {
        return response.status(400).send({ error: { message: 'messages array or prompt_context is required' } });
    }

    if (Array.isArray(request.body.messages) && postProcessingType && (!request.body.prompt_context || assembledPromptContext)) {
        console.info('Applying custom prompt post-processing of type', postProcessingType);
        request.body.messages = postProcessPrompt(
            request.body.messages,
            postProcessingType,
            getPromptNames(request));
    }

    rewriteSystemMessagesForO1Model(request.body.model, request.body.chat_completion_source, request.body.messages);

    let providerResult = null;
    switch (request.body.chat_completion_source) {
        case CHAT_COMPLETION_SOURCES.CLAUDE:
            providerResult = await sendClaudeRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.AI21:
            providerResult = await sendAI21Request(request);
            break;
        case CHAT_COMPLETION_SOURCES.MAKERSUITE:
        case CHAT_COMPLETION_SOURCES.VERTEXAI:
            providerResult = await sendMakerSuiteRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.MISTRALAI:
            providerResult = await sendMistralAIRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.COHERE:
            providerResult = await sendCohereRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.DEEPSEEK:
            providerResult = await sendDeepSeekRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.AIMLAPI:
            providerResult = await sendAimlapiRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.XAI:
            providerResult = await sendXaiRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.ELECTRONHUB:
            providerResult = await sendElectronHubRequest(request);
            break;
        case CHAT_COMPLETION_SOURCES.AZURE_OPENAI:
            providerResult = await sendAzureOpenAIRequest(request);
            break;
    }

    if (providerResult) {
        return await sendProviderDispatchResult(providerResult, request, response, {
            timedWorldInfo: assembledTimedWorldInfo,
            worldInfoOverflowed: assembledWorldInfoOverflowed,
            worldInfo: assembledPromptSnapshot?.worldInfo || null,
            promptSnapshotKey: promptInspectionInfo?.key || null,
        });
    }

    const requestedTextCompletion = Boolean(request.body.model && TEXT_COMPLETION_MODELS.includes(request.body.model)) || typeof request.body.messages === 'string';
    if (requestedTextCompletion) {
        return response.status(410).send({ error: { message: 'Text completion is disabled in chat-completions-only mode.' } });
    }

    let apiUrl;
    let apiKey;
    let headers;
    let bodyParams;

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENAI) {
        apiUrl = new URL(request.body.reverse_proxy || API_OPENAI).toString();
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.OPENAI);
        headers = {};
        bodyParams = {
            logprobs: request.body.logprobs,
            top_logprobs: undefined,
        };

        // Adjust logprobs params for Chat Completions API, which expects { top_logprobs: number; logprobs: boolean; }
        if (bodyParams.logprobs > 0) {
            bodyParams.top_logprobs = bodyParams.logprobs;
            bodyParams.logprobs = true;
        }

        if (getConfigValue('openai.randomizeUserId', false, 'boolean')) {
            bodyParams['user'] = uuidv4();
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENROUTER) {
        apiUrl = 'https://openrouter.ai/api/v1';
        apiKey = readSecret(request.user.directories, SECRET_KEYS.OPENROUTER);
        // OpenRouter needs to pass the Referer and X-Title: https://openrouter.ai/docs#requests
        headers = { ...OPENROUTER_HEADERS };
        bodyParams = {
            'transforms': getOpenRouterTransforms(request),
            'plugins': getOpenRouterPlugins(request),
            'include_reasoning': Boolean(request.body.include_reasoning),
        };

        if (request.body.min_p !== undefined) {
            bodyParams['min_p'] = request.body.min_p;
        }

        if (request.body.top_a !== undefined) {
            bodyParams['top_a'] = request.body.top_a;
        }

        if (request.body.repetition_penalty !== undefined) {
            bodyParams['repetition_penalty'] = request.body.repetition_penalty;
        }

        if (Array.isArray(request.body.provider) && request.body.provider.length > 0) {
            bodyParams['provider'] = {
                allow_fallbacks: request.body.allow_fallbacks ?? true,
                order: request.body.provider ?? [],
            };
        }

        if (request.body.use_fallback) {
            bodyParams['route'] = 'fallback';
        }

        if (request.body.reasoning_effort) {
            bodyParams['reasoning'] = { effort: request.body.reasoning_effort };
        }

        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    strict: request.body.json_schema.strict ?? true,
                    schema: request.body.json_schema.value,
                },
            };
        }

        const cachingAtDepth = getConfigValue('claude.cachingAtDepth', -1, 'number');
        const isClaude3or4 = /anthropic\/claude-(3|opus-4|sonnet-4|haiku-4)/.test(request.body.model);
        const cacheTTL = getConfigValue('claude.extendedTTL', false, 'boolean') ? '1h' : '5m';
        if (Array.isArray(request.body.messages)) {
            embedOpenRouterMedia(request.body.messages);
            if (Number.isInteger(cachingAtDepth) && cachingAtDepth >= 0 && isClaude3or4) {
                cachingAtDepthForOpenRouterClaude(request.body.messages, cachingAtDepth, cacheTTL);
            }
        }

        const isGemini = /google\/gemini/.test(request.body.model);
        if (isGemini) {
            bodyParams['safety_settings'] = GEMINI_SAFETY;
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM) {
        apiUrl = request.body.custom_url;
        apiKey = typeof request.body.custom_api_key === 'string'
            ? request.body.custom_api_key
            : readSecret(request.user.directories, SECRET_KEYS.CUSTOM);
        headers = {};
        bodyParams = {
            logprobs: request.body.logprobs,
            top_logprobs: undefined,
        };

        // Adjust logprobs params for Chat Completions API, which expects { top_logprobs: number; logprobs: boolean; }
        if (bodyParams.logprobs > 0) {
            bodyParams.top_logprobs = bodyParams.logprobs;
            bodyParams.logprobs = true;
        }

        mergeObjectWithYaml(bodyParams, request.body.custom_include_body);
        mergeObjectWithYaml(headers, request.body.custom_include_headers);
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.PERPLEXITY) {
        apiUrl = API_PERPLEXITY;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.PERPLEXITY);
        headers = {};
        bodyParams = {
            reasoning_effort: request.body.reasoning_effort,
        };
        request.body.messages = postProcessPrompt(request.body.messages, PROMPT_PROCESSING_TYPE.STRICT, getPromptNames(request));
        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    schema: request.body.json_schema.value,
                },
            };
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.GROQ) {
        apiUrl = API_GROQ;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.GROQ);
        headers = {};
        bodyParams = {};
        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    description: request.body.json_schema.description,
                    schema: request.body.json_schema.value,
                    strict: request.body.json_schema.strict ?? true,
                },
            };
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.FIREWORKS) {
        apiUrl = API_FIREWORKS;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.FIREWORKS);
        headers = {};
        bodyParams = {};
        if (request.body.json_schema) {
            bodyParams['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: request.body.json_schema.name,
                    description: request.body.json_schema.description,
                    schema: request.body.json_schema.value,
                    strict: request.body.json_schema.strict ?? true,
                },
            };
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.NANOGPT) {
        apiUrl = API_NANOGPT;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.NANOGPT);
        headers = {};
        bodyParams = {};
        if (request.body.enable_web_search && !/:online$/.test(request.body.model)) {
            request.body.model = `${request.body.model}:online`;
        }
        const enableSystemPromptCache = getConfigValue('claude.enableSystemPromptCache', false, 'boolean');
        const isClaude3or4 = /claude-(3|opus-4|sonnet-4)/.test(request.body.model);
        const cacheTTL = getConfigValue('claude.extendedTTL', false, 'boolean') ? '1h' : '5m';
        if (enableSystemPromptCache && isClaude3or4) {
            bodyParams['cache_control'] = {
                'enabled': true,
                'ttl': cacheTTL,
            };
        }
    }
    else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.POLLINATIONS) {
        apiUrl = API_POLLINATIONS;
        apiKey = 'NONE';
        headers = {
            'Authorization': '',
        };
        bodyParams = {
            reasoning_effort: request.body.reasoning_effort,
            private: true,
            referrer: 'sillytavern',
            seed: request.body.seed ?? Math.floor(Math.random() * 99999999),
        };
        if (request.body.json_schema) {
            setJsonObjectFormat(bodyParams, request.body.messages, request.body.json_schema);
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MOONSHOT) {
        apiUrl = API_MOONSHOT;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.MOONSHOT);
        headers = {};
        bodyParams = {};
        request.body.json_schema
            ? setJsonObjectFormat(bodyParams, request.body.messages, request.body.json_schema)
            : addAssistantPrefix(request.body.messages, [], 'partial');
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.COMETAPI) {
        apiUrl = API_COMETAPI;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.COMETAPI);
        headers = {};
        bodyParams = {
            reasoning_effort: request.body.reasoning_effort,
        };
        throw new Error('This provider is temporarily disabled.');
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.ZANITY) {
        apiUrl = request.body.custom_url || getZanityApiUrl(request.body.zanity_endpoint);
        apiKey = readSecret(request.user.directories, SECRET_KEYS.ZANITY);
        headers = {};
        bodyParams = {
            logprobs: request.body.logprobs,
            top_logprobs: undefined,
        };

        if (bodyParams.logprobs > 0) {
            bodyParams.top_logprobs = bodyParams.logprobs;
            bodyParams.logprobs = true;
        }

        mergeObjectWithYaml(bodyParams, request.body.custom_include_body);
        mergeObjectWithYaml(headers, request.body.custom_include_headers);
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.ZAI) {
        apiUrl = request.body.zai_endpoint === ZAI_ENDPOINT.CODING ? API_ZAI_CODING : API_ZAI_COMMON;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.ZAI);
        headers = {
            'Accept-Language': 'en-US,en',
        };
        bodyParams = {
            thinking: {
                type: request.body.include_reasoning ? 'enabled' : 'disabled',
            },
        };
        if (request.body.json_schema) {
            setJsonObjectFormat(bodyParams, request.body.messages, request.body.json_schema);
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.SILICONFLOW) {
        apiUrl = API_SILICONFLOW;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.SILICONFLOW);
        headers = {};
        bodyParams = {};
        if (request.body.json_schema) {
            setJsonObjectFormat(bodyParams, request.body.messages, request.body.json_schema);
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.NAVY) {
        apiUrl = API_NAVY;
        apiKey = readSecret(request.user.directories, SECRET_KEYS.NAVY);
        headers = {};
        bodyParams = {};
        if (request.body.reasoning_effort) {
            bodyParams.reasoning_effort = request.body.reasoning_effort;
        }
    } else {
        console.warn('This chat completion source is not supported yet.');
        return response.status(400).send({ error: true });
    }

    // A few of OpenAIs reasoning models support reasoning effort
    if (request.body.reasoning_effort && [CHAT_COMPLETION_SOURCES.CUSTOM, CHAT_COMPLETION_SOURCES.OPENAI].includes(request.body.chat_completion_source)) {
        if (OPENAI_REASONING_EFFORT_MODELS.includes(request.body.model)) {
            bodyParams['reasoning_effort'] = OPENAI_REASONING_EFFORT_MAP[request.body.reasoning_effort] ?? request.body.reasoning_effort;
        }
    }

    if (!apiKey && !request.body.reverse_proxy && request.body.chat_completion_source !== CHAT_COMPLETION_SOURCES.CUSTOM) {
        console.warn('OpenAI API key is missing.');
        return response.status(400).send({ error: true });
    }

    // Add custom stop sequences
    if (Array.isArray(request.body.stop) && request.body.stop.length > 0) {
        bodyParams['stop'] = request.body.stop;
    }

    let endpointUrl;
    try {
        endpointUrl = new URL(`${trimTrailingSlash(String(apiUrl || ''))}/chat/completions`).toString();
    } catch {
        return response.status(400).send({
            error: {
                message: 'Invalid chat completion endpoint URL. Use a full absolute URL such as https://api.openai.com/v1 or http://127.0.0.1:1/v1.',
            },
        });
    }

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    if (Array.isArray(request.body.tools) && request.body.tools.length > 0) {
        bodyParams['tools'] = request.body.tools;
        bodyParams['tool_choice'] = request.body.tool_choice;
    }

    if (request.body.json_schema && !bodyParams['response_format']) {
        bodyParams['response_format'] = {
            type: 'json_schema',
            json_schema: {
                name: request.body.json_schema.name,
                strict: request.body.json_schema.strict ?? true,
                schema: request.body.json_schema.value,
            },
        };
    }

    const requestBody = {
        'messages': request.body.messages,
        'model': request.body.model,
        'temperature': request.body.temperature,
        'max_tokens': request.body.max_tokens,
        'max_completion_tokens': request.body.max_completion_tokens,
        'stream': request.body.stream,
        'presence_penalty': request.body.presence_penalty,
        'frequency_penalty': request.body.frequency_penalty,
        'top_p': request.body.top_p,
        'top_k': request.body.top_k,
        'stop': request.body.stop,
        'logit_bias': request.body.logit_bias,
        'seed': request.body.seed,
        'n': request.body.n,
        ...bodyParams,
    };

    if ([CHAT_COMPLETION_SOURCES.CUSTOM, CHAT_COMPLETION_SOURCES.ZANITY].includes(request.body.chat_completion_source)) {
        excludeKeysByYaml(requestBody, request.body.custom_exclude_body);
    }

    /** @type {import('node-fetch').RequestInit} */
    const config = {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            ...headers,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
    };

    console.debug('Chat Completion request:', requestBody);

    providerResult = await makeRequest(config, request);
    return await sendProviderDispatchResult(providerResult, request, response, {
        timedWorldInfo: assembledTimedWorldInfo,
        worldInfoOverflowed: assembledWorldInfoOverflowed,
        worldInfo: assembledPromptSnapshot?.worldInfo || null,
        promptSnapshotKey: promptInspectionInfo?.key || null,
    });

    /**
     * Makes a fetch request to the OpenAI API endpoint.
     * @param {import('node-fetch').RequestInit} config Fetch config
     * @param {express.Request} request Express request
     */
    async function makeRequest(config, request) {
        try {
            controller.signal.throwIfAborted();
            const fetchResponse = await fetch(endpointUrl, config);

            if (request.body.stream) {
                console.info('Streaming request in progress');
                return createProviderStreamResult(fetchResponse);
            }

            if (fetchResponse.ok) {
                /** @type {any} */
                const json = await fetchResponse.json();
                console.debug('Chat Completion response:', json);
                return createProviderJsonResult(json);
            } else {
                return await handleErrorResponse(fetchResponse);
            }
        } catch (error) {
            console.error('Generation failed', error);
            const message = error.code === 'ECONNREFUSED'
                ? `Connection refused: ${error.message}`
                : error.message || 'Unknown error occurred';

            return createProviderJsonResult({ error: { message } }, { status: 502, ok: false });
        }
    }

    /**
     * @param {import("node-fetch").Response} errorResponse
     */
    async function handleErrorResponse(errorResponse) {
        const sanitizedError = await buildSanitizedErrorResponse(errorResponse);
        return createProviderJsonResult(sanitizedError.body, { ok: false });
    }
    })().catch((error) => {
        console.error('Chat completion generation failed', error);
        if (!response.headersSent) {
            response.status(getPromptAssemblyErrorStatus(error)).send(toPromptAssemblyErrorBody(error));
        } else if (!response.writableEnded) {
            response.end();
        }
    });
}

router.post('/generate', function (request, response) {
    return handleChatCompletionsGenerate(request, response);
});

router.post('/assemble', async function (request, response) {
    try {
        if (!request.body) {
            return response.sendStatus(400);
        }

        await prepareServerPromptContext(request.user, request.user.directories, request.body);
        const result = await assembleChatCompletionPrompt(request.body);
        rewriteSystemMessagesForO1Model(request.body.model, request.body.chatCompletionSource, result.chat);
        const sanitizedResult = sanitizePromptAssemblyForResponse(result, request.user);
        return response.send(attachWorldInfoResponseData(sanitizedResult, request, result.timedWorldInfo, result.worldInfoOverflowed, result.worldInfo));
    } catch (error) {
        console.error('Chat completion assembly failed', error);
        return response.status(getPromptAssemblyErrorStatus(error)).send(toPromptAssemblyErrorBody(error));
    }
});

router.post('/assemble/compare', async function (request, response) {
    try {
        if (!request.body) {
            return response.sendStatus(400);
        }

        await prepareServerPromptContext(request.user, request.user.directories, request.body);
        const result = await assembleChatCompletionPrompt(request.body);
        rewriteSystemMessagesForO1Model(request.body.model, request.body.chatCompletionSource, result.chat);
        const sanitizedResult = sanitizePromptAssemblyForResponse(result, request.user);

        if (canViewPromptParityRawDebugData(request.user)) {
            sanitizedResult.comparison = compareChatCompletionMessages(request.body.clientChat || [], sanitizedResult.chat || [], {
                maxDifferences: request.body.maxDifferences,
            });
        }

        return response.send(attachWorldInfoResponseData(sanitizedResult, request, result.timedWorldInfo, result.worldInfoOverflowed, result.worldInfo));
    } catch (error) {
        console.error('Chat completion assembly comparison failed', error);
        return response.status(getPromptAssemblyErrorStatus(error)).send(toPromptAssemblyErrorBody(error));
    }
});

router.get('/debug/prompt-snapshot', async function (request, response) {
    const key = String(request.query.key || '');
    if (!isPromptSnapshotAuthorizedForRequest(request, key)) {
        return response.sendStatus(403);
    }

    const snapshot = getPromptInspectionSnapshot(key);
    if (!snapshot) {
        return response.status(404).send({ error: { message: 'No prompt inspection snapshot is available for this key.' } });
    }

    return response.send(sanitizePromptInspectionSnapshotForResponse(snapshot, request.user));
});

router.post('/debug/prompt-snapshot/maintenance', async function (request, response) {
    const deletes = Array.isArray(request.body?.deletes) ? request.body.deletes : [];
    const rekeys = Array.isArray(request.body?.rekeys) ? request.body.rekeys : [];

    for (const key of deletes) {
        if (!isPromptSnapshotAuthorizedForRequest(request, key)) {
            return response.sendStatus(403);
        }
    }

    for (const rekey of rekeys) {
        if (!isPromptSnapshotAuthorizedForRequest(request, rekey?.from) || !isPromptSnapshotAuthorizedForRequest(request, rekey?.to)) {
            return response.sendStatus(403);
        }
    }

    for (const key of deletes) {
        deletePromptInspectionSnapshot(String(key || ''));
    }

    for (const rekey of rekeys) {
        rekeyPromptInspectionSnapshot(String(rekey?.from || ''), String(rekey?.to || ''));
    }

    return response.send({ ok: true });
});

const multimodalModels = express.Router();

multimodalModels.post('/pollinations', async (_req, res) => {
    try {
        const response = await fetch('https://text.pollinations.ai/models');

        if (!response.ok) {
            return res.json([]);
        }

        /** @type {any} */
        const data = await response.json();

        if (!Array.isArray(data)) {
            return res.json([]);
        }

        const multimodalModels = data.filter(m => m?.vision).map(m => m.name);
        return res.json(multimodalModels);
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

multimodalModels.post('/aimlapi', async (_req, res) => {
    try {
        const response = await fetch('https://api.aimlapi.com/v1/models');

        if (!response.ok) {
            return res.json([]);
        }

        /** @type {any} */
        const data = await response.json();

        if (!Array.isArray(data?.data)) {
            return res.json([]);
        }

        const multimodalModels = data.data.filter(m => m?.features?.includes('openai/chat-completion.vision')).map(m => m.id);
        return res.json(multimodalModels);
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

multimodalModels.post('/nanogpt', async (_req, res) => {
    try {
        const response = await fetch('https://nano-gpt.com/api/v1/models?detailed=true');

        if (!response.ok) {
            return res.json([]);
        }

        /** @type {any} */
        const data = await response.json();

        if (!Array.isArray(data?.data)) {
            return res.json([]);
        }

        const multimodalModels = data.data.filter(m => m?.capabilities?.vision).map(m => m.id);
        return res.json(multimodalModels);
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

multimodalModels.post('/electronhub', async (_req, res) => {
    try {
        const response = await fetch('https://api.electronhub.ai/v1/models');

        if (!response.ok) {
            return res.json([]);
        }

        /** @type {any} */
        const data = await response.json();
        const multimodalModels = data.data.filter(m => m.metadata?.vision).map(m => m.id);
        return res.json(multimodalModels);
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

multimodalModels.post('/mistral', async (req, res) => {
    try {
        const key = readSecret(req.user.directories, SECRET_KEYS.MISTRALAI);

        if (!key) {
            return res.json([]);
        }

        const response = await fetch('https://api.mistral.ai/v1/models', {
            headers: {
                'Authorization': `Bearer ${key}`,
            },
        });

        if (!response.ok) {
            return res.json([]);
        }

        /** @type {any} */
        const data = await response.json();
        const multimodalModels = data.data.filter(m => m.capabilities?.vision).map(m => m.id);
        return res.json(multimodalModels);
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

multimodalModels.post('/xai', async (req, res) => {
    try {
        const key = readSecret(req.user.directories, SECRET_KEYS.XAI);

        if (!key) {
            return res.json([]);
        }

        // xAI's /models endpoint doesn't return modality info, so we must use /language-models instead
        const response = await fetch('https://api.x.ai/v1/language-models', {
            headers: {
                'Authorization': `Bearer ${key}`,
            },
        });

        if (!response.ok) {
            return res.json([]);
        }

        /** @type {any} */
        const data = await response.json();
        const multimodalModels = data.models.filter(m => m.input_modalities?.includes('image')).map(m => m.id);
        if (!multimodalModels.includes('grok-4-0709')) {
            // The endpoint says it doesn't support images, but it does
            multimodalModels.push('grok-4-0709');
        }
        return res.json(multimodalModels);
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

router.use('/multimodal-models', multimodalModels);

router.post('/process', async function (request, response) {
    try {
        if (!Array.isArray(request.body.messages)) {
            return response.status(400).send({ error: 'Invalid messages format' });
        }

        if (!Object.values(PROMPT_PROCESSING_TYPE).includes(request.body.type)) {
            return response.status(400).send({ error: 'Unknown processing type' });
        }

        const messages = postProcessPrompt(request.body.messages, request.body.type, getPromptNames(request));
        return response.send({ messages });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
