import { DOMPurify, moment } from '../lib.js';
import { getRequestHeaders } from '../script.js';
import { t } from './i18n.js';
import { callGenericPopup, Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { renderTemplateAsync } from './templates.js';

export const SECRET_KEYS = {
    HORDE: 'api_key_horde',
    MANCER: 'api_key_mancer',
    VLLM: 'api_key_vllm',
    APHRODITE: 'api_key_aphrodite',
    TABBY: 'api_key_tabby',
    OPENAI: 'api_key_openai',
    NOVEL: 'api_key_novel',
    CLAUDE: 'api_key_claude',
    OPENROUTER: 'api_key_openrouter',
    SCALE: 'api_key_scale',
    AI21: 'api_key_ai21',
    SCALE_COOKIE: 'scale_cookie',
    MAKERSUITE: 'api_key_makersuite',
    VERTEXAI: 'api_key_vertexai',
    SERPAPI: 'api_key_serpapi',
    MISTRALAI: 'api_key_mistralai',
    TOGETHERAI: 'api_key_togetherai',
    INFERMATICAI: 'api_key_infermaticai',
    DREAMGEN: 'api_key_dreamgen',
    CUSTOM: 'api_key_custom',
    OOBA: 'api_key_ooba',
    NOMICAI: 'api_key_nomicai',
    KOBOLDCPP: 'api_key_koboldcpp',
    LLAMACPP: 'api_key_llamacpp',
    COHERE: 'api_key_cohere',
    PERPLEXITY: 'api_key_perplexity',
    GROQ: 'api_key_groq',
    AZURE_TTS: 'api_key_azure_tts',
    FEATHERLESS: 'api_key_featherless',
    ZEROONEAI: 'api_key_01ai',
    HUGGINGFACE: 'api_key_huggingface',
    STABILITY: 'api_key_stability',
    CUSTOM_OPENAI_TTS: 'api_key_custom_openai_tts',
    NANOGPT: 'api_key_nanogpt',
    TAVILY: 'api_key_tavily',
    BFL: 'api_key_bfl',
    GENERIC: 'api_key_generic',
    DEEPSEEK: 'api_key_deepseek',
    SERPER: 'api_key_serper',
    FALAI: 'api_key_falai',
    XAI: 'api_key_xai',
    VERTEXAI_SERVICE_ACCOUNT: 'vertexai_service_account_json',
};

const FRIENDLY_NAMES = {
    [SECRET_KEYS.HORDE]: 'AI Horde',
    [SECRET_KEYS.MANCER]: 'Mancer',
    [SECRET_KEYS.OPENAI]: 'OpenAI',
    [SECRET_KEYS.NOVEL]: 'NovelAI',
    [SECRET_KEYS.CLAUDE]: 'Claude',
    [SECRET_KEYS.OPENROUTER]: 'OpenRouter',
    [SECRET_KEYS.SCALE]: 'Scale',
    [SECRET_KEYS.AI21]: 'AI21',
    [SECRET_KEYS.SCALE_COOKIE]: 'Scale (Cookie)',
    [SECRET_KEYS.MAKERSUITE]: 'Google AI Studio',
    [SECRET_KEYS.VERTEXAI]: 'Google Vertex AI (Express Mode)',
    [SECRET_KEYS.VLLM]: 'vLLM',
    [SECRET_KEYS.APHRODITE]: 'Aphrodite',
    [SECRET_KEYS.TABBY]: 'TabbyAPI',
    [SECRET_KEYS.MISTRALAI]: 'MistralAI',
    [SECRET_KEYS.CUSTOM]: 'Custom (OpenAI-compatible)',
    [SECRET_KEYS.TOGETHERAI]: 'TogetherAI',
    [SECRET_KEYS.OOBA]: 'Text Generation WebUI',
    [SECRET_KEYS.INFERMATICAI]: 'InfermaticAI',
    [SECRET_KEYS.DREAMGEN]: 'DreamGen',
    [SECRET_KEYS.NOMICAI]: 'NomicAI',
    [SECRET_KEYS.KOBOLDCPP]: 'KoboldCpp',
    [SECRET_KEYS.LLAMACPP]: 'llama.cpp',
    [SECRET_KEYS.COHERE]: 'Cohere',
    [SECRET_KEYS.PERPLEXITY]: 'Perplexity',
    [SECRET_KEYS.GROQ]: 'Groq',
    [SECRET_KEYS.FEATHERLESS]: 'Featherless',
    [SECRET_KEYS.ZEROONEAI]: '01.AI',
    [SECRET_KEYS.HUGGINGFACE]: 'HuggingFace',
    [SECRET_KEYS.NANOGPT]: 'NanoGPT',
    [SECRET_KEYS.GENERIC]: 'Generic (OpenAI-compatible)',
    [SECRET_KEYS.DEEPSEEK]: 'DeepSeek',
    [SECRET_KEYS.XAI]: 'xAI (Grok)',
    [SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT]: 'Google Vertex AI (Service Account)',
};

const INPUT_MAP = {
    [SECRET_KEYS.HORDE]: '#horde_api_key',
    [SECRET_KEYS.MANCER]: '#api_key_mancer',
    [SECRET_KEYS.OPENAI]: '#api_key_openai',
    [SECRET_KEYS.NOVEL]: '#api_key_novel',
    [SECRET_KEYS.CLAUDE]: '#api_key_claude',
    [SECRET_KEYS.OPENROUTER]: '.api_key_openrouter',
    [SECRET_KEYS.SCALE]: '#api_key_scale',
    [SECRET_KEYS.AI21]: '#api_key_ai21',
    [SECRET_KEYS.SCALE_COOKIE]: '#scale_cookie',
    [SECRET_KEYS.MAKERSUITE]: '#api_key_makersuite',
    [SECRET_KEYS.VERTEXAI]: '#api_key_vertexai',
    [SECRET_KEYS.VLLM]: '#api_key_vllm',
    [SECRET_KEYS.APHRODITE]: '#api_key_aphrodite',
    [SECRET_KEYS.TABBY]: '#api_key_tabby',
    [SECRET_KEYS.MISTRALAI]: '#api_key_mistralai',
    [SECRET_KEYS.CUSTOM]: '#api_key_custom',
    [SECRET_KEYS.TOGETHERAI]: '#api_key_togetherai',
    [SECRET_KEYS.OOBA]: '#api_key_ooba',
    [SECRET_KEYS.INFERMATICAI]: '#api_key_infermaticai',
    [SECRET_KEYS.DREAMGEN]: '#api_key_dreamgen',
    [SECRET_KEYS.NOMICAI]: '#api_key_nomicai',
    [SECRET_KEYS.KOBOLDCPP]: '#api_key_koboldcpp',
    [SECRET_KEYS.LLAMACPP]: '#api_key_llamacpp',
    [SECRET_KEYS.COHERE]: '#api_key_cohere',
    [SECRET_KEYS.PERPLEXITY]: '#api_key_perplexity',
    [SECRET_KEYS.GROQ]: '#api_key_groq',
    [SECRET_KEYS.FEATHERLESS]: '#api_key_featherless',
    [SECRET_KEYS.ZEROONEAI]: '#api_key_01ai',
    [SECRET_KEYS.HUGGINGFACE]: '#api_key_huggingface',
    [SECRET_KEYS.NANOGPT]: '#api_key_nanogpt',
    [SECRET_KEYS.GENERIC]: '#api_key_generic',
    [SECRET_KEYS.DEEPSEEK]: '#api_key_deepseek',
    [SECRET_KEYS.XAI]: '#api_key_xai',
    [SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT]: '#vertexai_service_account_json',
};

const STATIC_PLACEHOLDER_KEYS = [
    SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT,
];

const getLabel = () => moment().format('L LT');

export function updateSecretDisplay() {
    for (const [secret_key, input_selector] of Object.entries(INPUT_MAP)) {
        if (STATIC_PLACEHOLDER_KEYS.includes(secret_key)) {
            continue;
        }
        const validSecret = !!secret_state[secret_key];
        const placeholder = $('#viewSecrets').attr(validSecret ? 'key_saved_text' : 'missing_key_text');
        const label = getActiveSecretLabel(secret_key);
        const placeholderWithLabel = label ? `${placeholder} (${label})` : placeholder;
        $(input_selector).attr('placeholder', placeholderWithLabel);
    }
}

/**
 * Gets the active secret label for a given key.
 * @param {string} key Gets the active secret label for a given key.
 * @returns {string} The label of the active secret, or '[No label]' if none is active.
 */
function getActiveSecretLabel(key) {
    const selectedSecret = secret_state[key];
    if (Array.isArray(selectedSecret)) {
        const activeSecret = selectedSecret.find(x => x.active);
        if (!activeSecret) {
            return '';
        }
        return activeSecret.label || activeSecret.value || t`[No label]`;
    }
    return '';
}

async function viewSecrets() {
    const response = await fetch('/api/secrets/view', {
        method: 'POST',
        headers: getRequestHeaders(),
    });

    if (response.status == 403) {
        await Popup.show.text(t`Forbidden`, t`To view your API keys here, set the value of allowKeysExposure to true in config.yaml file and restart the SillyTavern server.`);
        return;
    }

    if (!response.ok) {
        return;
    }

    $('#dialogue_popup').addClass('wide_dialogue_popup');
    const data = await response.json();
    const table = document.createElement('table');
    table.classList.add('responsiveTable');
    $(table).append('<thead><th>Key</th><th>Value</th></thead>');

    for (const [key, value] of Object.entries(data)) {
        $(table).append(`<tr><td>${DOMPurify.sanitize(key)}</td><td>${DOMPurify.sanitize(value)}</td></tr>`);
    }

    await callGenericPopup(table.outerHTML, POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}

/**
 * @type {Record<string, import('../../src/endpoints/secrets.js').SecretState[]|null>}
 */
export let secret_state = {};

/**
 * Write a secret value to the server.
 * @param {string} key Secret key
 * @param {string} value Secret value to write
 * @param {string} [label] (Optional) Label for the key. If not provided, generated automatically.
 */
export async function writeSecret(key, value, label) {
    try {
        if (!value) {
            console.warn(`No value provided for ${key} in writeSecret, redirecting to deleteSecret`);
            return deleteSecret(key);
        }

        if (!label) {
            label = getLabel();
        }

        const response = await fetch('/api/secrets/write', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, value, label }),
        });

        if (response.ok) {
            // Clear the input field
            $(INPUT_MAP[key]).val('').trigger('input');
            await readSecretState();
        }
    } catch (error) {
        console.error(`Could not write secret value: ${key}`, error);
    }
}

/**
 * Deletes a secret value from the server.
 * @param {string} key Secret key
 * @param {string} [id] (Optional) ID of the secret key to delete. If not provided, deletes an active key.
 */
export async function deleteSecret(key, id) {
    try {
        const response = await fetch('/api/secrets/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id }),
        });

        if (response.ok) {
            await readSecretState();
            // Force reconnection to the API with the new key
            $('#main_api').trigger('change');
        }
    } catch (error) {
        console.error(`Could not delete secret value: ${key}`, error);
    }
}

/**
 * Reads the current state of secrets from the server.
 * @returns {Promise<void>}
 */
export async function readSecretState() {
    try {
        const response = await fetch('/api/secrets/read', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (response.ok) {
            secret_state = await response.json();
            updateSecretDisplay();
            updateInputDataLists();
            await checkOpenRouterAuth();
        }
    } catch {
        console.error('Could not read secrets file');
    }
}

/**
 * Finds a secret value by key.
 * @param {string} key Secret key
 * @returns {Promise<string | undefined>} Secret value, or undefined if keys are not exposed
 */
export async function findSecret(key) {
    try {
        const response = await fetch('/api/secrets/find', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key }),
        });

        if (response.ok) {
            const data = await response.json();
            return data.value;
        }
    } catch {
        console.error('Could not find secret value: ', key);
    }
}

/**
 * Changes the active value for a given secret key.
 * @param {string} key Secret key to rotate
 * @param {string} id ID of the secret to rotate
 */
export async function rotateSecret(key, id) {
    try {
        const response = await fetch('/api/secrets/rotate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id }),
        });

        if (response.ok) {
            await readSecretState();
            // Force reconnection to the API with the new key
            $('#main_api').trigger('change');
        }
    } catch (error) {
        console.error(`Could not rotate secret value: ${key}`, error);
    }
}

/**
 * Renames a secret value on the server.
 * @param {string} key Secret key to rename
 * @param {string} id ID of the secret to rename
 * @param {string} label Label to rename the secret to
 */
export async function renameSecret(key, id, label) {
    try {
        const response = await fetch('/api/secrets/rename', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id, label }),
        });

        if (response.ok) {
            await readSecretState();
        }
    } catch (error) {
        console.error(`Could not rename secret value: ${key}`, error);
    }
}

/**
 * Redirects the user to authorize OpenRouter.
 */
function authorizeOpenRouter() {
    const redirectUrl = new URL('/callback/openrouter', window.location.origin);
    const openRouterUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(redirectUrl.toString())}`;
    location.href = openRouterUrl;
}

/**
 * Checks if the OpenRouter authorization code is present in the URL, and if so, exchanges it for an API key.
 * @returns {Promise<void>}
 */
async function checkOpenRouterAuth() {
    const params = new URLSearchParams(location.search);
    const source = params.get('source');
    if (source === 'openrouter') {
        const query = new URLSearchParams(params.get('query'));
        const code = query.get('code');
        try {
            const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
                method: 'POST',
                body: JSON.stringify({ code }),
            });

            if (!response.ok) {
                throw new Error('OpenRouter exchange error');
            }

            const data = await response.json();
            if (!data || !data.key) {
                throw new Error('OpenRouter invalid response');
            }

            await writeSecret(SECRET_KEYS.OPENROUTER, data.key);

            if (secret_state[SECRET_KEYS.OPENROUTER]) {
                toastr.success('OpenRouter token saved');
                // Remove the code from the URL
                const currentUrl = window.location.href;
                const urlWithoutSearchParams = currentUrl.split('?')[0];
                window.history.pushState({}, '', urlWithoutSearchParams);
            } else {
                throw new Error('OpenRouter token not saved');
            }
        } catch (err) {
            toastr.error('Could not verify OpenRouter token. Please try again.');
            return;
        }
    }
}

/**
 * Updates the input data lists for secret keys for autocomplete functionality.
 */
function updateInputDataLists() {
    let container = document.getElementById('secrets_datalists');
    if (!container) {
        container = document.createElement('div');
        container.id = 'secrets_datalists';
        container.style.display = 'none';
        document.body.appendChild(container);
    }

    for (const [key, inputSelector] of Object.entries(INPUT_MAP)) {
        const inputElements = document.querySelectorAll(inputSelector);
        if (inputElements.length === 0) {
            console.warn(`No input elements found for key: ${key}`);
            continue;
        }

        const dataListId = `${key}_datalist`;
        let dataList = document.getElementById(dataListId);
        if (!dataList) {
            dataList = document.createElement('datalist');
            dataList.id = dataListId;
            container.appendChild(dataList);
        }

        // Clear existing options
        dataList.innerHTML = '';

        const secrets = secret_state[key];
        if (!Array.isArray(secrets)) {
            continue;
        }

        for (const secret of secrets) {
            const option = document.createElement('option');
            option.value = secret.id;
            option.textContent = `${secret.label} (${secret.value})`;
            dataList.appendChild(option);
        }

        // Set the input element to use the datalist
        inputElements.forEach(element => {
            element.setAttribute('list', dataListId);
        });
    }
}

/**
 * Opens the key manager dialog for a specific key.
 * @param {string} key Key for which to open the key manager dialog.
 */
async function openKeyManagerDialog(key) {
    const secrets = secret_state[key] ?? [];
    const name = FRIENDLY_NAMES[key] || key;
    const template = $(await renderTemplateAsync('secretKeyManager', { name, key, secrets }));
    template.find('button[data-action="add-secret"]').on('click', async function () {
        const value = await Popup.show.input(t`Add Secret`, t`Enter the secret value:`);
        if (!value) {
            return;
        }
        const label = await Popup.show.input(t`Add Secret`, t`Enter a label for the secret (optional):`, getLabel());
        await writeSecret(key, value, label);
        await popup.complete(POPUP_RESULT.CANCELLED);
        openKeyManagerDialog(key);
    });
    template.find('button[data-action="rotate-secret"]').on('click', async function () {
        const secretId = $(this).data('id');
        await rotateSecret(key, secretId);
        await popup.complete(POPUP_RESULT.CANCELLED);
        openKeyManagerDialog(key);
    });
    template.find('button[data-action="rename-secret"]').on('click', async function () {
        const secretId = $(this).data('id');
        const currentSecret = secret_state[key].find(secret => secret.id === secretId);
        const label = await Popup.show.input(t`Rename Secret`, t`Enter new label for the secret:`, currentSecret?.label || getLabel());
        if (!label) {
            return;
        }
        await renameSecret(key, secretId, label);
        await popup.complete(POPUP_RESULT.CANCELLED);
        openKeyManagerDialog(key);
    });
    template.find('button[data-action="delete-secret"]').on('click', async function () {
        const secretId = $(this).data('id');
        const currentSecret = secret_state[key].find(secret => secret.id === secretId);
        const confirm = await Popup.show.confirm(t`Delete Secret: ${currentSecret?.label}`, t`Are you sure you want to delete this secret? This action cannot be undone.`);
        if (!confirm) {
            return;
        }
        await deleteSecret(key, secretId);
        await popup.complete(POPUP_RESULT.CANCELLED);
        openKeyManagerDialog(key);
    });

    const popup = new Popup(template, POPUP_TYPE.TEXT, '', { wide: true, large: true, animation: 'none' });
    const completePromise = popup.show();

    // Scroll to active key if it's not in view
    requestAnimationFrame(() => {
        const activeKey = template.find('.active');
        if (activeKey.length > 0) {
            const parent = activeKey.parent();
            const parentHeight = parent.height();
            const activeKeyOffset = activeKey.position().top;
            const activeKeyHeight = activeKey.outerHeight(true);
            if (activeKeyOffset < 0 || activeKeyOffset + activeKeyHeight > parentHeight) {
                parent.scrollTop(activeKeyOffset - (parentHeight / 2) + (activeKeyHeight / 2));
            }
        }
    });

    await completePromise;
}

jQuery(async () => {
    $('#viewSecrets').on('click', viewSecrets);
    $(document).on('click', '.manage-api-keys', async function () {
        const key = $(this).data('key');
        if (!key || !Object.values(SECRET_KEYS).includes(key)) {
            console.error('Invalid key for manage-api-keys:', key);
            return;
        }
        await openKeyManagerDialog(key);
    });
    $(document).on('input', Object.values(INPUT_MAP).join(','), function () {
        const id = $(this).attr('id');
        const value = $(this).val();

        // Find the key based on the entered value
        for (const [key, inputSelector] of Object.entries(INPUT_MAP)) {
            if (!value || !this.matches(inputSelector)) {
                continue;
            }
            const secrets = secret_state[key];
            if (!Array.isArray(secrets)) {
                continue;
            }
            const secretMatch = secrets.find(secret => secret.id === value);
            if (secretMatch) {
                $(this).val('');
                return rotateSecret(key, secretMatch.id);
            }
        }

        const warningElement = $(`[data-for="${id}"]`);
        warningElement.toggle(value.length > 0);
    });
    $('.openrouter_authorize').on('click', authorizeOpenRouter);
});
