import { getPresetManager } from './preset-manager.js';
import { extractJsonFromData, extractMessageFromData, getRequestHeaders } from '../script.js';
import { extractReasoningFromData } from './reasoning.js';
import { getStreamingReply, tryParseStreamingError } from './openai.js';
import EventSourceStream from './sse-stream.js';

// #region Type Definitions
/**
 * @typedef {Object} ChatCompletionMessage
 * @property {string} role - The role of the message author (e.g., "user", "assistant", "system")
 * @property {string} content - The content of the message
 */

/**
 * @typedef {Object} ChatCompletionPayloadBase
 * @property {boolean?} [stream=false] - Whether to stream the response
 * @property {ChatCompletionMessage[]} messages - Array of chat messages
 * @property {string} [model] - Optional model name to use for completion
 * @property {string} chat_completion_source - Source provider
 * @property {number} max_tokens - Maximum number of tokens to generate
 * @property {number} [temperature] - Optional temperature parameter for response randomness
 * @property {string} [custom_url] - Optional custom URL
 * @property {string} [reverse_proxy] - Optional reverse proxy URL
 * @property {string} [proxy_password] - Optional proxy password
 * @property {string} [custom_prompt_post_processing] - Optional custom prompt post-processing
 */

/** @typedef {Record<string, any> & ChatCompletionPayloadBase} ChatCompletionPayload */

/**
 * @typedef {Object} ExtractedData
 * @property {string | Object} content - Extracted content. When json_schema is used, this is a parsed JSON object.
 * @property {string} reasoning - Extracted reasoning.
 */

/**
 * @typedef {Object} StreamResponse
 * @property {string} text - Generated text.
 * @property {string[]} swipes - Generated swipes
 * @property {Object} state - Generated state
 * @property {string?} [state.reasoning] - Generated reasoning
 * @property {string?} [state.image] - Generated image
 */

// #endregion

/**
 * Creates & sends a chat completion request.
 */
export class ChatCompletionService {
    static TYPE = 'openai';

    /**
     * @param {ChatCompletionPayload} custom
     * @returns {ChatCompletionPayload}
     */
    static createRequestData({ stream = false, messages, model, chat_completion_source, max_tokens, temperature, custom_url, reverse_proxy, proxy_password, custom_prompt_post_processing, ...props }) {
        const payload = {
            stream,
            messages,
            model,
            chat_completion_source,
            max_tokens,
            temperature,
            custom_url,
            reverse_proxy,
            proxy_password,
            custom_prompt_post_processing,
            use_makersuite_sysprompt: true,
            claude_use_sysprompt: true,
            ...props,
        };

        // Remove undefined values to avoid API errors
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key];
            }
        });

        return payload;
    }

    /**
     * Sends a chat completion request
     * @param {ChatCompletionPayload} data Request data
     * @param {boolean?} extractData Extract message from the response. Default true
     * @param {AbortSignal?} signal Abort signal
     * @returns {Promise<ExtractedData | (() => AsyncGenerator<StreamResponse>)>} If not streaming, returns extracted data; if streaming, returns a function that creates an AsyncGenerator
     * @throws {Error}
     */
    static async sendRequest(data, extractData = true, signal = null) {
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            cache: 'no-cache',
            body: JSON.stringify(data),
            signal,
        });

        if (!data.stream) {
            const json = await response.json();
            if (!response.ok || json.error) {
                throw json;
            }

            if (!extractData) {
                return json;
            }

            const result = {
                content: extractMessageFromData(json, this.TYPE),
                reasoning: extractReasoningFromData(json, {
                    mainApi: this.TYPE,
                    textGenType: data.chat_completion_source,
                    ignoreShowThoughts: true,
                }),
            };
            // Try parse JSON
            if (data.json_schema) {
                try {
                    result.content = JSON.parse(extractJsonFromData(json, { mainApi: this.TYPE, chatCompletionSource: data.chat_completion_source }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`Failed to parse JSON response: ${message}`, { cause: error });
                }
            }
            return result;
        }

        if (!response.ok) {
            const text = await response.text();
            tryParseStreamingError(response, text, { quiet: true });

            throw new Error(`Got response status ${response.status}`);
        }

        const eventStream = new EventSourceStream();
        response.body.pipeThrough(eventStream);
        const reader = eventStream.readable.getReader();
        return async function* streamData() {
            let text = '';
            const swipes = [];
            const state = { reasoning: '', image: '' };
            while (true) {
                const { done, value } = await reader.read();
                if (done) return;
                const rawData = value.data;
                if (rawData === '[DONE]') return;
                tryParseStreamingError(response, rawData, { quiet: true });
                const parsed = JSON.parse(rawData);

                const reply = getStreamingReply(parsed, state, {
                    chatCompletionSource: data.chat_completion_source,
                    overrideShowThoughts: true,
                });
                if (Array.isArray(parsed?.choices) && parsed?.choices?.[0]?.index > 0) {
                    const swipeIndex = parsed.choices[0].index - 1;
                    swipes[swipeIndex] = (swipes[swipeIndex] || '') + reply;
                } else {
                    text += reply;
                }

                yield { text, swipes: swipes, state };
            }
        };
    }

    /**
     * Process and send a chat completion request with optional preset
     * @param {ChatCompletionPayload} custom
     * @param {Object} options - Configuration options
     * @param {string?} [options.presetName] - Name of the preset to use for generation settings
     * @param {boolean} [extractData=true] - Whether to extract structured data from response
     * @param {AbortSignal?} [signal] - Abort signal
     * @returns {Promise<ExtractedData | (() => AsyncGenerator<StreamResponse>)>} If not streaming, returns extracted data; if streaming, returns a function that creates an AsyncGenerator
     * @throws {Error}
     */
    static async processRequest(custom, options, extractData = true, signal = null) {
        const { presetName } = options;
        let requestData = { ...custom };

        // Apply generation preset if specified
        if (presetName) {
            const presetManager = getPresetManager(this.TYPE);
            if (presetManager) {
                const preset = presetManager.getCompletionPresetByName(presetName);
                if (preset) {
                    // Convert preset to payload and merge with custom parameters
                    const presetPayload = this.presetToGeneratePayload(preset, {});
                    requestData = { ...presetPayload, ...requestData };
                } else {
                    console.warn(`Preset "${presetName}" not found, continuing with default settings`);
                }
            } else {
                console.warn('Preset manager not found, continuing with default settings');
            }
        }

        const data = this.createRequestData(requestData);

        return await this.sendRequest(data, extractData, signal);
    }

    /**
     * Converts a preset to a valid chat completion payload
     * Only supports temperature.
     * @param {Object} preset - The preset configuration
     * @param {Object} customParams - Additional parameters to override preset values
     * @returns {Object} - Formatted payload for chat completion API
     */
    static presetToGeneratePayload(preset, customParams = {}) {
        if (!preset || typeof preset !== 'object') {
            throw new Error('Invalid preset: must be an object');
        }

        // Merge preset with custom parameters
        const settings = { ...preset, ...customParams };

        // Initialize base payload with common parameters
        const payload = {
            temperature: settings.temperature >= 0 ? Number(settings.temperature) : undefined,
        };

        // Remove undefined values to avoid API errors
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key];
            }
        });

        return payload;
    }
}
