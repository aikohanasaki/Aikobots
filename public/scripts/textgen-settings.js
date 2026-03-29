import {
    abortStatusCheck,
    eventSource,
    event_types,
    getRequestHeaders,
    getStoppingStrings,
    main_api,
    max_context,
    online_status,
    resultCheckStatus,
    saveSettingsDebounced,
    setGenerationParamsFromPreset,
    setOnlineStatus,
    startStatusLoading,
    substituteParams,
} from '../script.js';
import { deriveTemplatesFromChatTemplate } from './chat-templates.js';
import { t } from './i18n.js';
import { autoSelectInstructPreset, selectContextPreset, selectInstructPreset } from './instruct-mode.js';
import { BIAS_CACHE, createNewLogitBiasEntry, displayLogitBias, getLogitBiasListResult } from './logit-bias.js';
import { power_user, registerDebugFunction } from './power-user.js';
import { getActiveManualApiSamplers, loadApiSelectedSamplers, isSamplerManualPriorityEnabled } from './samplerSelect.js';
import { SECRET_KEYS, writeSecret } from './secrets.js';
import { getEventSourceStream } from './sse-stream.js';
import { getCurrentDreamGenModelTokenizer, getCurrentOpenRouterModelTokenizer, loadAphroditeModels, loadDreamGenModels, loadFeatherlessModels, loadGenericModels, loadInfermaticAIModels, loadMancerModels, loadOllamaModels, loadOpenRouterModels, loadTabbyModels, loadTogetherAIModels, loadVllmModels } from './textgen-models.js';
import { ENCODE_TOKENIZERS, TEXTGEN_TOKENIZERS, TOKENIZER_SUPPORTED_KEY, getTextTokens, tokenizers } from './tokenizers.js';
import { AbortReason } from './util/AbortReason.js';
import { getSortableDelay, onlyUnique, arraysEqual, isObject } from './utils.js';

export const textgen_types = {
    OOBA: 'ooba',
    MANCER: 'mancer',
    VLLM: 'vllm',
    APHRODITE: 'aphrodite',
    TABBY: 'tabby',
    KOBOLDCPP: 'koboldcpp',
    TOGETHERAI: 'togetherai',
    LLAMACPP: 'llamacpp',
    OLLAMA: 'ollama',
    INFERMATICAI: 'infermaticai',
    DREAMGEN: 'dreamgen',
    OPENROUTER: 'openrouter',
    FEATHERLESS: 'featherless',
    HUGGINGFACE: 'huggingface',
    GENERIC: 'generic',
};

const {
    GENERIC,
    MANCER,
    VLLM,
    APHRODITE,
    TABBY,
    TOGETHERAI,
    OOBA,
    OLLAMA,
    LLAMACPP,
    INFERMATICAI,
    DREAMGEN,
    OPENROUTER,
    KOBOLDCPP,
    HUGGINGFACE,
    FEATHERLESS,
} = textgen_types;

const LLAMACPP_DEFAULT_ORDER = [
    'penalties',
    'dry',
    'top_n_sigma',
    'top_k',
    'typ_p',
    'top_p',
    'min_p',
    'xtc',
    'temperature',
];
const OOBA_DEFAULT_ORDER = [
    'repetition_penalty',
    'presence_penalty',
    'frequency_penalty',
    'dry',
    'temperature',
    'dynamic_temperature',
    'quadratic_sampling',
    'top_n_sigma',
    'top_k',
    'top_p',
    'typical_p',
    'epsilon_cutoff',
    'eta_cutoff',
    'tfs',
    'top_a',
    'min_p',
    'mirostat',
    'xtc',
    'encoder_repetition_penalty',
    'no_repeat_ngram',
];
export const APHRODITE_DEFAULT_ORDER = [
    'dry',
    'penalties',
    'no_repeat_ngram',
    'temperature',
    'top_nsigma',
    'top_p_top_k',
    'top_a',
    'min_p',
    'tfs',
    'eta_cutoff',
    'epsilon_cutoff',
    'typical_p',
    'quadratic',
    'xtc',
];
const BIAS_KEY = '#textgenerationwebui_api-settings';

// Maybe let it be configurable in the future?
// (7 days later) The future has come.
const MANCER_SERVER_KEY = 'mancer_server';
const MANCER_SERVER_DEFAULT = 'https://neuro.mancer.tech';
export let MANCER_SERVER = localStorage.getItem(MANCER_SERVER_KEY) ?? MANCER_SERVER_DEFAULT;
export let TOGETHERAI_SERVER = 'https://api.together.xyz';
export let INFERMATICAI_SERVER = 'https://api.totalgpt.ai';
export let DREAMGEN_SERVER = 'https://dreamgen.com';
export let OPENROUTER_SERVER = 'https://openrouter.ai/api';
export let FEATHERLESS_SERVER = 'https://api.featherless.ai/v1';

export const SERVER_INPUTS = {
    [textgen_types.OOBA]: '#textgenerationwebui_api_url_text',
    [textgen_types.VLLM]: '#vllm_api_url_text',
    [textgen_types.APHRODITE]: '#aphrodite_api_url_text',
    [textgen_types.TABBY]: '#tabby_api_url_text',
    [textgen_types.KOBOLDCPP]: '#koboldcpp_api_url_text',
    [textgen_types.LLAMACPP]: '#llamacpp_api_url_text',
    [textgen_types.OLLAMA]: '#ollama_api_url_text',
    [textgen_types.HUGGINGFACE]: '#huggingface_api_url_text',
    [textgen_types.GENERIC]: '#generic_api_url_text',
};

const KOBOLDCPP_ORDER = [6, 0, 1, 3, 4, 2, 5];
const settings = {
    temp: 0.7,
    temperature_last: true,
    top_p: 0.5,
    top_k: 40,
    top_a: 0,
    tfs: 1,
    epsilon_cutoff: 0,
    eta_cutoff: 0,
    typical_p: 1,
    min_p: 0,
    rep_pen: 1.2,
    rep_pen_range: 0,
    rep_pen_decay: 0,
    rep_pen_slope: 1,
    no_repeat_ngram_size: 0,
    penalty_alpha: 0,
    num_beams: 1,
    length_penalty: 1,
    min_length: 0,
    encoder_rep_pen: 1,
    freq_pen: 0,
    presence_pen: 0,
    skew: 0,
    do_sample: true,
    early_stopping: false,
    dynatemp: false,
    min_temp: 0,
    max_temp: 2.0,
    dynatemp_exponent: 1.0,
    smoothing_factor: 0.0,
    smoothing_curve: 1.0,
    dry_allowed_length: 2,
    dry_multiplier: 0.0,
    dry_base: 1.75,
    dry_sequence_breakers: '["\\n", ":", "\\"", "*"]',
    dry_penalty_last_n: 0,
    max_tokens_second: 0,
    seed: -1,
    preset: 'Default',
    add_bos_token: true,
    stopping_strings: [],
    //truncation_length: 2048,
    ban_eos_token: false,
    skip_special_tokens: true,
    include_reasoning: true,
    streaming: false,
    mirostat_mode: 0,
    mirostat_tau: 5,
    mirostat_eta: 0.1,
    guidance_scale: 1,
    negative_prompt: '',
    grammar_string: '',
    json_schema: null,
    banned_tokens: '',
    global_banned_tokens: '',
    send_banned_tokens: true,
    sampler_priority: OOBA_DEFAULT_ORDER,
    samplers: LLAMACPP_DEFAULT_ORDER,
    samplers_priorities: APHRODITE_DEFAULT_ORDER,
    ignore_eos_token: false,
    spaces_between_special_tokens: true,
    speculative_ngram: false,
    type: textgen_types.OOBA,
    mancer_model: 'mytholite',
    togetherai_model: 'Gryphe/MythoMax-L2-13b',
    infermaticai_model: '',
    ollama_model: '',
    openrouter_model: 'openrouter/auto',
    openrouter_providers: [],
    vllm_model: '',
    aphrodite_model: '',
    dreamgen_model: 'lucid-v1-extra-large/text',
    tabby_model: '',
    sampler_order: KOBOLDCPP_ORDER,
    logit_bias: [],
    n: 1,
    server_urls: {},
    custom_model: '',
    bypass_status_check: false,
    openrouter_allow_fallbacks: true,
    xtc_threshold: 0.1,
    xtc_probability: 0,
    nsigma: 0.0,
    min_keep: 0,
    featherless_model: '',
    generic_model: '',
    extensions: {},
};

export {
    settings as textgenerationwebui_settings,
    showSamplerControls as showTGSamplerControls,
};

export let textgenerationwebui_banned_in_macros = [];

export let textgenerationwebui_presets = [];
export let textgenerationwebui_preset_names = [];

export const setting_names = [
    'temp',
    'temperature_last',
    'rep_pen',
    'rep_pen_range',
    'rep_pen_decay',
    'rep_pen_slope',
    'no_repeat_ngram_size',
    'top_k',
    'top_p',
    'top_a',
    'tfs',
    'epsilon_cutoff',
    'eta_cutoff',
    'typical_p',
    'min_p',
    'penalty_alpha',
    'num_beams',
    'length_penalty',
    'min_length',
    'dynatemp',
    'min_temp',
    'max_temp',
    'dynatemp_exponent',
    'smoothing_factor',
    'smoothing_curve',
    'dry_allowed_length',
    'dry_multiplier',
    'dry_base',
    'dry_sequence_breakers',
    'dry_penalty_last_n',
    'max_tokens_second',
    'encoder_rep_pen',
    'freq_pen',
    'presence_pen',
    'skew',
    'do_sample',
    'early_stopping',
    'seed',
    'add_bos_token',
    'ban_eos_token',
    'skip_special_tokens',
    'include_reasoning',
    'streaming',
    'mirostat_mode',
    'mirostat_tau',
    'mirostat_eta',
    'guidance_scale',
    'negative_prompt',
    'grammar_string',
    'json_schema',
    'banned_tokens',
    'global_banned_tokens',
    'send_banned_tokens',
    'ignore_eos_token',
    'spaces_between_special_tokens',
    'speculative_ngram',
    'sampler_order',
    'sampler_priority',
    'samplers',
    'samplers_priorities',
    'n',
    'logit_bias',
    'custom_model',
    'bypass_status_check',
    'openrouter_allow_fallbacks',
    'xtc_threshold',
    'xtc_probability',
    'nsigma',
    'min_keep',
    'generic_model',
    'extensions',
];

const DYNATEMP_BLOCK = document.getElementById('dynatemp_block_ooba');

export function validateTextGenUrl() {
    // Legacy textgen settings flow is disabled in chat-completions-only mode.
}

/**
 * Gets the API URL for the selected text generation type.
 * @param {string} type If it's set, ignores active type
 * @returns {string} API URL
 */
export function getTextGenServer(type = null) {
    void type;
    // Legacy textgen settings flow is disabled in chat-completions-only mode.
    return '';
}

async function selectPreset(name) {
    const preset = textgenerationwebui_presets[textgenerationwebui_preset_names.indexOf(name)];

    if (!preset) {
        return;
    }

    settings.preset = name;
    for (const name of setting_names) {
        const value = preset[name];
        setSettingByName(name, value, true);
    }
    setGenerationParamsFromPreset(preset);
    BIAS_CACHE.delete(BIAS_KEY);
    displayLogitBias(preset.logit_bias, BIAS_KEY);
    saveSettingsDebounced();
}

export function formatTextGenURL(value) {
    void value;
    // Legacy textgen settings flow is disabled in chat-completions-only mode.
    return null;
}

function convertPresets(presets) {
    return Array.isArray(presets) ? presets.map((p) => JSON.parse(p)) : [];
}

function getTokenizerForTokenIds() {
    if (power_user.tokenizer === tokenizers.API_CURRENT && TEXTGEN_TOKENIZERS.includes(settings.type)) {
        return tokenizers.API_CURRENT;
    }

    if (ENCODE_TOKENIZERS.includes(power_user.tokenizer)) {
        return power_user.tokenizer;
    }

    if (settings.type === OPENROUTER) {
        return getCurrentOpenRouterModelTokenizer();
    }

    if (settings.type === DREAMGEN) {
        return getCurrentDreamGenModelTokenizer();
    }

    return tokenizers.LLAMA;
}

/**
 * @typedef {{banned_tokens: string, banned_strings: string[]}} TokenBanResult
 * @returns {TokenBanResult} String with comma-separated banned token IDs
 */
function getCustomTokenBans() {
    if (!settings.send_banned_tokens || (!settings.banned_tokens && !settings.global_banned_tokens && !textgenerationwebui_banned_in_macros.length)) {
        return {
            banned_tokens: '',
            banned_strings: [],
        };
    }

    const tokenizer = getTokenizerForTokenIds();
    const banned_tokens = [];
    const banned_strings = [];
    const sequences = []
        .concat(settings.banned_tokens.split('\n'))
        .concat(settings.global_banned_tokens.split('\n'))
        .concat(textgenerationwebui_banned_in_macros)
        .filter(x => x.length > 0)
        .filter(onlyUnique)
        .map(x => substituteParams(x));

    //debug
    if (textgenerationwebui_banned_in_macros.length) {
        console.log('=== Found banned word sequences in the macros:', textgenerationwebui_banned_in_macros, 'Resulting array of banned sequences (will be used this generation turn):', sequences);
    }

    //clean old temporary bans found in macros before, for the next generation turn.
    textgenerationwebui_banned_in_macros = [];

    for (const line of sequences) {
        // Raw token ids, JSON serialized
        if (line.startsWith('[') && line.endsWith(']')) {
            try {
                const tokens = JSON.parse(line);

                if (Array.isArray(tokens) && tokens.every(t => Number.isInteger(t))) {
                    banned_tokens.push(...tokens);
                } else {
                    throw new Error('Not an array of integers');
                }
            } catch (err) {
                console.log(`Failed to parse bad word token list: ${line}`, err);
            }
        } else if (line.startsWith('"') && line.endsWith('"')) {
            // Remove the enclosing quotes

            banned_strings.push(line.slice(1, -1));
        } else {
            try {
                const tokens = getTextTokens(tokenizer, line);
                banned_tokens.push(...tokens);
            } catch {
                console.log(`Could not tokenize raw text: ${line}`);
            }
        }
    }

    return {
        banned_tokens: banned_tokens.filter(onlyUnique).map(x => String(x)).join(','),
        banned_strings: banned_strings,
    };
}

/**
 * Sets the banned strings kill switch toggle.
 * @param {boolean} isEnabled Kill switch state
 * @param {string} title Label title
 */
function toggleBannedStringsKillSwitch(isEnabled, title) {
    $('#send_banned_tokens_textgenerationwebui').prop('checked', isEnabled);
    $('#send_banned_tokens_label').find('.menu_button').toggleClass('toggleEnabled', isEnabled).prop('title', title);
    settings.send_banned_tokens = isEnabled;
    saveSettingsDebounced();
}

/**
 * Calculates logit bias object from the logit bias list.
 * @returns {object} Logit bias object
 */
function calculateLogitBias() {
    if (!Array.isArray(settings.logit_bias) || settings.logit_bias.length === 0) {
        return {};
    }

    const tokenizer = getTokenizerForTokenIds();
    const result = {};

    /**
     * Adds bias to the logit bias object.
     * @param {number} bias
     * @param {number[]} sequence
     * @returns {object} Accumulated logit bias object
     */
    function addBias(bias, sequence) {
        if (sequence.length === 0) {
            return;
        }

        for (const logit of sequence) {
            const key = String(logit);
            result[key] = bias;
        }

        return result;
    }

    getLogitBiasListResult(settings.logit_bias, tokenizer, addBias);

    return result;
}

export async function loadTextGenSettings(data, loadedSettings) {
    void data;
    void loadedSettings;
    // Legacy textgen settings loading is disabled in chat-completions-only mode.
}

/**
 * Sorts the sampler items by the given order.
 * @param {any[]} orderArray Sampler order array.
 */
function sortKoboldItemsByOrder(orderArray) {
    console.debug('Preset samplers order: ' + orderArray);
    const $draggableItems = $('#koboldcpp_order');

    for (let i = 0; i < orderArray.length; i++) {
        const index = orderArray[i];
        const $item = $draggableItems.find(`[data-id="${index}"]`).detach();
        $draggableItems.append($item);
    }
}

function sortLlamacppItemsByOrder(orderArray) {
    console.debug('Preset samplers order: ', orderArray);
    const $container = $('#llamacpp_samplers_sortable');

    orderArray.forEach((name) => {
        const $item = $container.find(`[data-name="${name}"]`).detach();
        $container.append($item);
    });
}

function sortOobaItemsByOrder(orderArray) {
    console.debug('Preset samplers order: ', orderArray);
    const $container = $('#sampler_priority_container');

    orderArray.forEach((name) => {
        const $item = $container.find(`[data-name="${name}"]`).detach();
        $container.append($item);
    });
}

/**
 * Sorts the Aphrodite sampler items by the given order.
 * @param {string[]} orderArray Sampler order array.
 */
function sortAphroditeItemsByOrder(orderArray) {
    console.debug('Preset samplers order: ', orderArray);
    const $container = $('#sampler_priority_container_aphrodite');

    orderArray.forEach((name) => {
        const $item = $container.find(`[data-name="${name}"]`).detach();
        $container.append($item);
    });
}

async function getStatusTextgen() {
    const url = '/api/backends/text-completions/status';

    const endpoint = getTextGenServer();

    if (!endpoint) {
        console.warn('No endpoint for status check');
        setOnlineStatus('no_connection');
        return resultCheckStatus();
    }

    if ([textgen_types.GENERIC, textgen_types.OOBA].includes(settings.type) && settings.bypass_status_check) {
        setOnlineStatus(t`Status check bypassed`);
        return resultCheckStatus();
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                api_server: endpoint,
                api_type: settings.type,
            }),
            signal: abortStatusCheck.signal,
        });

        const data = await response.json();

        if (settings.type === textgen_types.MANCER) {
            loadMancerModels(data?.data);
            setOnlineStatus(settings.mancer_model);
        } else if (settings.type === textgen_types.TOGETHERAI) {
            loadTogetherAIModels(data?.data);
            setOnlineStatus(settings.togetherai_model);
        } else if (settings.type === textgen_types.OLLAMA) {
            loadOllamaModels(data?.data);
            setOnlineStatus(settings.ollama_model || t`Connected`);
        } else if (settings.type === textgen_types.INFERMATICAI) {
            loadInfermaticAIModels(data?.data);
            setOnlineStatus(settings.infermaticai_model);
        } else if (settings.type === textgen_types.DREAMGEN) {
            loadDreamGenModels(data?.data);
            setOnlineStatus(settings.dreamgen_model);
        } else if (settings.type === textgen_types.OPENROUTER) {
            loadOpenRouterModels(data?.data);
            setOnlineStatus(settings.openrouter_model);
        } else if (settings.type === textgen_types.VLLM) {
            loadVllmModels(data?.data);
            setOnlineStatus(settings.vllm_model);
        } else if (settings.type === textgen_types.APHRODITE) {
            loadAphroditeModels(data?.data);
            setOnlineStatus(settings.aphrodite_model);
        } else if (settings.type === textgen_types.FEATHERLESS) {
            loadFeatherlessModels(data?.data);
            setOnlineStatus(settings.featherless_model);
        } else if (settings.type === textgen_types.TABBY) {
            loadTabbyModels(data?.data);
            setOnlineStatus(settings.tabby_model || data?.result);
        } else if (settings.type === textgen_types.GENERIC) {
            loadGenericModels(data?.data);
            setOnlineStatus(settings.generic_model || data?.result || t`Connected`);
        } else {
            setOnlineStatus(data?.result);
        }

        if (!online_status) {
            setOnlineStatus('no_connection');
        }

        power_user.chat_template_hash = '';

        // Determine instruct mode preset
        const autoSelected = autoSelectInstructPreset(online_status);

        const supportsTokenization = response.headers.get('x-supports-tokenization') === 'true';
        supportsTokenization ? sessionStorage.setItem(TOKENIZER_SUPPORTED_KEY, 'true') : sessionStorage.removeItem(TOKENIZER_SUPPORTED_KEY);

        const wantsInstructDerivation = !autoSelected && (power_user.instruct.enabled && power_user.instruct_derived);
        const wantsContextDerivation = !autoSelected && power_user.context_derived;
        const wantsContextSize = power_user.context_size_derived;
        const supportsChatTemplate = [textgen_types.KOBOLDCPP, textgen_types.LLAMACPP].includes(settings.type);

        if (supportsChatTemplate && (wantsInstructDerivation || wantsContextDerivation || wantsContextSize)) {
            const response = await fetch('/api/backends/text-completions/props', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    api_server: endpoint,
                    api_type: settings.type,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                if (data) {
                    const { chat_template, chat_template_hash } = data;
                    power_user.chat_template_hash = chat_template_hash;

                    if (wantsContextSize && 'default_generation_settings' in data) {
                        const backend_max_context = data['default_generation_settings']['n_ctx'];
                        const old_value = max_context;
                        if (max_context !== backend_max_context) {
                            setGenerationParamsFromPreset({ max_length: backend_max_context });
                        }
                        if (old_value !== max_context) {
                            console.log(`Auto-switched max context from ${old_value} to ${max_context}`);
                            toastr.info(`${old_value} ⇒ ${max_context}`, 'Context Size Changed');
                        }
                    }
                    console.log(`We have chat template ${chat_template.split('\n')[0]}...`);
                    const savedTemplate = power_user.model_templates_mappings[chat_template_hash];
                    const derivedTemplate = await deriveTemplatesFromChatTemplate(chat_template, chat_template_hash);
                    const { context, instruct } = savedTemplate ?? derivedTemplate;

                    if (wantsContextDerivation && context) {
                        selectContextPreset(context, { isAuto: true });
                    }
                    if (wantsInstructDerivation && power_user.instruct.enabled && instruct) {
                        selectInstructPreset(instruct, { isAuto: true });
                    }
                }
            }
        }

        // We didn't get a 200 status code, but the endpoint has an explanation. Which means it DID connect, but I digress.
        if (online_status === 'no_connection' && data.response) {
            toastr.error(data.response, t`API Error`, { timeOut: 5000, preventDuplicates: true });
        }
    } catch (err) {
        if (err instanceof AbortReason) {
            console.info('Status check aborted.', err.reason);
        } else {
            console.error('Error getting status', err);

        }
        setOnlineStatus('no_connection');
    }

    return resultCheckStatus();
}

export function initTextGenSettings() {
    // Legacy textgen settings initialization is disabled in chat-completions-only mode.
}

/**
 * Hides and shows preset samplers from the left panel.
 * @param {string?} apiType API Type selected in API Connections - Currently selected one by default
 * @returns void
 */
function showSamplerControls(apiType = null) {
    $('#textgenerationwebui_api-settings [data-tg-samplers]').each(function(idx, elem) {
        const typeSpecificControlled = $(elem).data('tg-type') !== undefined;

        if (!typeSpecificControlled) $(this).show();
    });

    showTypeSpecificControls(apiType ?? settings.type);

    const prioritizeManualSamplerSelect = isSamplerManualPriorityEnabled(apiType ?? settings.type);
    const samplersActivatedManually = getActiveManualApiSamplers(apiType ?? settings.type);

    if (!samplersActivatedManually?.length || !prioritizeManualSamplerSelect) return;

    $('#textgenerationwebui_api-settings [data-tg-samplers]').each(function() {
        const tgSamplers = $(this).attr('data-tg-samplers').split(',').map(x => x.trim()).filter(str => str !== '');

        for (const tgSampler of tgSamplers) {
            if (samplersActivatedManually.includes(tgSampler)) {
                $(this).show();
                return;
            } else {
                $(this).hide();
            }
        }
    });
}

function showTypeSpecificControls(apiType) {
    $('[data-tg-type]').each(function () {
        const mode = String($(this).attr('data-tg-type-mode') ?? '').toLowerCase().trim();
        const tgTypes = $(this).attr('data-tg-type').split(',').map(x => x.trim());

        if (mode === 'except') {
            $(this)[tgTypes.includes(apiType) ? 'hide' : 'show']();
            return;
        }

        for (const tgType of tgTypes) {
            if (tgType === apiType || tgType == 'all') {
                $(this).show();
                return;
            } else {
                $(this).hide();
            }
        }
    });
}

/**
 * Inserts missing items from the source array into the target array.
 * @param {any[]} source - Source array
 * @param {any[]} target - Target array
 * @returns {void}
 */
function insertMissingArrayItems(source, target) {
    if (source === target || !Array.isArray(source) || !Array.isArray(target)) {
        return;
    }

    for (const item of source) {
        if (!target.includes(item)) {
            const index = source.indexOf(item);
            target.splice(index, 0, item);
        }
    }
}

function setSettingByName(setting, value, trigger) {
    if ('extensions' === setting) {
        value = value || {};
        settings.extensions = value;
        return;
    }

    if (value === null || value === undefined) {
        return;
    }

    if ('sampler_order' === setting) {
        value = Array.isArray(value) ? value : KOBOLDCPP_ORDER;
        sortKoboldItemsByOrder(value);
        settings.sampler_order = value;
        return;
    }

    if ('sampler_priority' === setting) {
        value = Array.isArray(value) ? value : OOBA_DEFAULT_ORDER;
        insertMissingArrayItems(OOBA_DEFAULT_ORDER, value);
        sortOobaItemsByOrder(value);
        settings.sampler_priority = value;
        return;
    }

    if ('samplers_priorities' === setting) {
        value = Array.isArray(value) ? value : APHRODITE_DEFAULT_ORDER;
        insertMissingArrayItems(APHRODITE_DEFAULT_ORDER, value);
        sortAphroditeItemsByOrder(value);
        settings.samplers_priorities = value;
        return;
    }

    if ('samplers' === setting) {
        value = Array.isArray(value) ? value : LLAMACPP_DEFAULT_ORDER;
        insertMissingArrayItems(LLAMACPP_DEFAULT_ORDER, value);
        sortLlamacppItemsByOrder(value);
        settings.samplers = value;
        return;
    }

    if ('logit_bias' === setting) {
        settings.logit_bias = Array.isArray(value) ? value : [];
        return;
    }

    if ('json_schema' === setting) {
        settings.json_schema = value ?? null;
        $('#tabby_json_schema').val(value ? JSON.stringify(settings.json_schema, null, 2) : '');
        return;
    }

    const isCheckbox = $(`#${setting}_textgenerationwebui`).attr('type') == 'checkbox';
    const isText = $(`#${setting}_textgenerationwebui`).attr('type') == 'text' || $(`#${setting}_textgenerationwebui`).is('textarea');
    if (isCheckbox) {
        const val = Boolean(value);
        $(`#${setting}_textgenerationwebui`).prop('checked', val);

        if ('send_banned_tokens' === setting) {
            $(`#${setting}_textgenerationwebui`).trigger('change');
        }
    }
    else if (isText) {
        $(`#${setting}_textgenerationwebui`).val(value);
    }
    else {
        const val = parseFloat(value);
        $(`#${setting}_textgenerationwebui`).val(val);
        $(`#${setting}_counter_textgenerationwebui`).val(val);
        if (power_user.enableZenSliders) {
            let zenSlider = $(`#${setting}_textgenerationwebui_zenslider`).slider();
            zenSlider.slider('option', 'value', val);
            zenSlider.slider('option', 'slide')
                .call(zenSlider, null, {
                    handle: $('.ui-slider-handle', zenSlider), value: val,
                });
        }
    }

    if (trigger) {
        $(`#${setting}_textgenerationwebui`).trigger('input');
    }
}

/**
 * Sends a streaming request for textgenerationwebui.
 * @param generate_data
 * @param signal
 * @returns {Promise<(function(): AsyncGenerator<{swipes: [], text: string, toolCalls: [], logprobs: {token: string, topLogprobs: Candidate[]}|null}, void, *>)|*>}
 * @throws {Error} - If the response status is not OK, or from within the generator
 */
export async function generateTextGenWithStreaming(generate_data, signal) {
    void generate_data;
    void signal;
    // Legacy textgen streaming is disabled in chat-completions-only mode.
    throw new Error('Legacy textgen streaming generation is disabled in chat-completions-only mode.');
}

/**
 * parseTextgenLogprobs converts a logprobs object returned from a textgen API
 * for a single token into a TokenLogprobs object used by the Token
 * Probabilities feature.
 * @param {string} token - the text of the token that the logprobs are for
 * @param {Object} logprobs - logprobs object returned from the API
 * @returns {import('./logprobs.js').TokenLogprobs | null} - converted logprobs
 */
export function parseTextgenLogprobs(token, logprobs) {
    void token;
    void logprobs;
    // Legacy textgen logprobs parsing is disabled in chat-completions-only mode.
    return null;
}

export function parseTabbyLogprobs(data) {
    void data;
    // Legacy textgen logprobs parsing is disabled in chat-completions-only mode.
    return null;
}

/**
 * Parses errors in streaming responses and displays them in toastr.
 * @param {Response} response - Response from the server.
 * @param {string} decoded - Decoded response body.
 * @returns {void} Nothing.
 * @throws {Error} If the response contains an error message, throws Error with the message.
 */
function tryParseStreamingError(response, decoded) {
    let data = {};

    try {
        data = JSON.parse(decoded);
    } catch {
        // No JSON. Do nothing.
    }

    const message = data?.error?.message || data?.error || data?.message || data?.detail;

    if (message) {
        toastr.error(message, 'Text Completion API');
        throw new Error(message);
    }
}

/**
 * Converts a string of comma-separated integers to an array of integers.
 * @param {string} string Input string
 * @returns {number[]} Array of integers
 */
function toIntArray(string) {
    if (!string) {
        return [];
    }

    return string.split(',').map(x => parseInt(x)).filter(x => !isNaN(x));
}

export function getTextGenModel() {
    // Legacy textgen generation is disabled in chat-completions-only mode.
    return undefined;
}

export function isJsonSchemaSupported() {
    return [TABBY, LLAMACPP].includes(settings.type) && main_api === 'textgenerationwebui';
}

function isDynamicTemperatureSupported() {
    return settings.dynatemp && DYNATEMP_BLOCK?.dataset?.tgType?.includes(settings.type);
}

/**
 * Gets the number of logprobs to request based on the selected type.
 * @param {string} type If it's set, ignores active type
 * @returns {number} Number of logprobs to request
 */
export function getLogprobsNumber(type = null) {
    void type;
    // Legacy textgen generation is disabled in chat-completions-only mode.
    return 0;
}

/**
 * Replaces {{macro}} in a comma-separated or serialized JSON array string.
 * @param {string} str Input string
 * @returns {string} Output string
 */
export function replaceMacrosInList(str) {
    // Legacy textgen generation is disabled in chat-completions-only mode.
    return str;
}

export async function getTextGenGenerationData(finalPrompt, maxTokens, isImpersonate, isContinue, cfgValues, type) {
    void finalPrompt;
    void maxTokens;
    void isImpersonate;
    void isContinue;
    void cfgValues;
    void type;
    // Legacy textgen request assembly is disabled in chat-completions-only mode.
    throw new Error('Legacy textgen generation request building is disabled in chat-completions-only mode.');
}
