import { queryCollection } from '../../../../src/endpoints/vectors.js';
import { getConfigValue } from '../../../../src/util.js';
import { getVectorStringHash } from './hash.js';

const EXTENSION_PROMPT_TAG = '3_vectors';

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
    const queriedMessages = [];
    for (const message of context.chat) {
        if (retained.has(message) || !message?.mes) {
            continue;
        }
        const hash = getVectorStringHash(context.substituteParams(String(message.mes)));
        if (!queryHashes.includes(hash) || insertedHashes.has(hash)) {
            continue;
        }
        insertedHashes.add(hash);
        queriedMessages.push({ message, hash });
    }
    queriedMessages.sort((left, right) => queryHashes.indexOf(right.hash) - queryHashes.indexOf(left.hash));
    if (!queriedMessages.length) {
        return;
    }
    const queriedMessageIds = new Set(queriedMessages
        .map(entry => Number(entry.message.messageId))
        .filter(messageId => Number.isInteger(messageId)));
    const queriedMessageSet = new Set(queriedMessages.map(entry => entry.message));
    context.promptContext.coreChat = context.promptContext.coreChat.filter((message) => {
        const messageId = Number(message.messageId);
        if (Number.isInteger(messageId)) {
            return !queriedMessageIds.has(messageId);
        }
        return !queriedMessageSet.has(message);
    });
    context.chat = context.promptContext.coreChat;
    const text = queriedMessages.map(entry => collapseNewlines(`${entry.message.name}: ${entry.message.mes}`).trim()).join('\n\n');
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
