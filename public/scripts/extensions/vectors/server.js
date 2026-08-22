import { queryCollection } from '../../../../src/endpoints/vectors.js';
import { getConfigValue } from '../../../../src/util.js';

const EXTENSION_PROMPT_TAG = '3_vectors';

function getStringHash(str, seed = 0) {
    if (typeof str !== 'string') {
        return 0;
    }
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let index = 0; index < str.length; index++) {
        const char = str.charCodeAt(index);
        h1 = Math.imul(h1 ^ char, 2654435761);
        h2 = Math.imul(h2 ^ char, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function getSourceSettings(context, settings) {
    const source = String(settings.source || 'transformers');
    const extensionSettings = context.promptContext.extensionSettings || {};
    switch (source) {
        case 'transformers':
            return { model: getConfigValue('extensions.models.embedding', '') };
        case 'extras':
            return { extrasUrl: extensionSettings.apiUrl || '', extrasKey: extensionSettings.apiKey || '' };
        case 'electronhub':
            return { model: settings.electronhub_model || 'text-embedding-3-small' };
        case 'openrouter':
            return { model: settings.openrouter_model || 'openai/text-embedding-3-large' };
        case 'togetherai':
            return { model: settings.togetherai_model || '' };
        case 'openai':
            return { model: settings.openai_model || '' };
        case 'cohere':
            return { model: settings.cohere_model || '' };
        case 'llamacpp':
            return { apiUrl: settings.alt_endpoint_url || '' };
        case 'vllm':
            return { apiUrl: settings.alt_endpoint_url || '', model: settings.vllm_model || '' };
        case 'ollama':
            return { apiUrl: settings.alt_endpoint_url || '', model: settings.ollama_model || '', keep: Boolean(settings.ollama_keep) };
        case 'mistral':
            return { model: 'mistral-embed' };
        case 'nomicai':
            return { model: 'nomic-embed-text-v1.5' };
        default:
            return {};
    }
}

function collapseNewlines(value) {
    return String(value || '').replace(/\n{3,}/g, '\n\n');
}

/** Reproduces the built-in chat-vector prompt injection in the owning worker. */
async function rearrangeChat(context) {
    const settings = context.settings || {};
    context.removeExtensionPrompt(EXTENSION_PROMPT_TAG);
    if (context.type === 'quiet' || !settings.enabled_chats || !context.currentChatId || !Array.isArray(context.chat)) {
        return;
    }
    const protect = Math.max(0, Number(settings.protect) || 0);
    if (context.chat.length < protect) {
        return;
    }

    const queryCount = Math.max(1, Number(settings.query) || 1);
    const queryText = collapseNewlines(context.chat
        .map(message => context.substituteParams(String(message.promptVectorMes ?? message.mes ?? '')).trim())
        .filter(Boolean)
        .reverse()
        .slice(0, queryCount)
        .join('\n')).trim();
    if (!queryText) {
        return;
    }

    const source = String(settings.source || 'transformers');
    const result = await queryCollection(
        context.directories,
        context.currentChatId,
        source,
        getSourceSettings(context, settings),
        queryText,
        Math.max(1, Number(settings.insert) || 1),
        Number(settings.score_threshold) || 0,
    );
    const queryHashes = Array.from(new Set(Array.isArray(result.hashes) ? result.hashes : []));
    const retained = new Set(protect > 0 ? context.chat.slice(-protect) : []);
    const insertedHashes = new Set();
    const queriedMessages = context.chat.filter(message => {
        if (retained.has(message) || !message?.mes) {
            return false;
        }
        const hash = getStringHash(context.substituteParams(String(message.mes)));
        if (!queryHashes.includes(hash) || insertedHashes.has(hash)) {
            return false;
        }
        insertedHashes.add(hash);
        return true;
    });
    queriedMessages.sort((left, right) => {
        const leftHash = getStringHash(context.substituteParams(String(left.mes)));
        const rightHash = getStringHash(context.substituteParams(String(right.mes)));
        return queryHashes.indexOf(rightHash) - queryHashes.indexOf(leftHash);
    });
    if (!queriedMessages.length) {
        return;
    }
    const queriedMessageIds = new Set(queriedMessages.map(message => Number(message.messageId)));
    context.promptContext.coreChat = context.promptContext.coreChat
        .filter(message => !queriedMessageIds.has(Number(message.messageId)));
    context.chat = context.promptContext.coreChat;
    const text = queriedMessages.map(message => collapseNewlines(`${message.name}: ${message.mes}`).trim()).join('\n\n');
    const value = context.substituteParams(String(settings.template || 'Past events:\n{{text}}'), { text });
    context.setExtensionPrompt(
        EXTENSION_PROMPT_TAG,
        value,
        Number(settings.position),
        Number(settings.depth),
        Boolean(settings.include_wi),
    );
}

export function setup({ registerGenerationInterceptor }) {
    registerGenerationInterceptor(rearrangeChat);
}
