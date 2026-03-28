import {
    countWebTokenizerTokens,
    getSentencepiceTokenizer,
    getTiktokenTokenizer,
    getTokenizerModel,
    getWebTokenizer,
} from '../endpoints/tokenizers.js';
import { createMacroState, evaluatePromptMacros, refreshMacroOutletValues } from './macro-evaluator.js';
import { scanWorldInfo } from './world-info-scan.js';

const INJECTION_POSITION = {
    RELATIVE: 0,
    ABSOLUTE: 1,
};

const extension_prompt_types = {
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

const character_names_behavior = {
    NONE: -1,
    DEFAULT: 0,
    COMPLETION: 1,
    CONTENT: 2,
};

const DEFAULT_ORDER = 100;
const promptStateModuleMap = {
    summary: '1_memory',
    authorsNote: '2_floating_prompt',
    vectorsMemory: '3_vectors',
    vectorsDataBank: '4_vectors_data_bank',
    smartContext: 'chromadb',
};

function normalizePromptStateEntry(entry = {}) {
    return {
        key: String(entry.key || ''),
        value: String(entry.value ?? ''),
        position: entry.position === undefined ? undefined : Number(entry.position),
        depth: entry.depth === undefined ? undefined : Number(entry.depth),
        scan: Boolean(entry.scan),
        role: Number(entry.role ?? extension_prompt_roles.SYSTEM),
    };
}

function inflatePromptState(promptState = {}, quietPrompt = '') {
    const extensionPrompts = {};

    for (const [moduleKey, legacyKey] of Object.entries(promptStateModuleMap)) {
        if (!promptState?.modules?.[moduleKey]) {
            continue;
        }

        extensionPrompts[legacyKey] = normalizePromptStateEntry({
            ...promptState.modules[moduleKey],
            key: legacyKey,
        });
    }

    for (const prompt of Array.isArray(promptState?.prompts) ? promptState.prompts : []) {
        const normalized = normalizePromptStateEntry(prompt);
        if (!normalized.key) {
            continue;
        }
        extensionPrompts[normalized.key] = normalized;
    }

    extensionPrompts.QUIET_PROMPT = normalizePromptStateEntry({
        key: 'QUIET_PROMPT',
        value: quietPrompt || '',
        position: extension_prompt_types.IN_PROMPT,
        depth: 0,
        scan: true,
        role: extension_prompt_roles.SYSTEM,
    });

    return extensionPrompts;
}

function resolvePromptValues(extensionPrompts = {}, env = {}) {
    return Object.fromEntries(Object.entries(extensionPrompts).map(([key, prompt]) => {
        const value = String(prompt?.value ?? '');
        const resolvedValue = substituteParams(value, env);
        return [key, {
            ...prompt,
            value,
            resolvedValue,
            scanText: prompt?.scan ? resolvedValue : undefined,
        }];
    }));
}

function mergeExtensionPromptSources(promptState = {}, runtimePrompts = {}, quietPrompt = '') {
    return {
        ...inflatePromptState(promptState, quietPrompt),
        ...(runtimePrompts && typeof runtimePrompts === 'object' ? runtimePrompts : {}),
    };
}

class Prompt {
    constructor(prompt = {}) {
        Object.assign(this, prompt);
        this.extension = prompt.extension ?? false;
        this.injection_order = prompt.injection_order ?? DEFAULT_ORDER;
        this.injection_trigger = prompt.injection_trigger ?? [];
    }
}

class PromptCollection {
    constructor(...prompts) {
        this.collection = [];
        this.overriddenPrompts = [];
        this.add(...prompts);
    }

    add(...prompts) {
        this.collection.push(...prompts.filter(Boolean).map(prompt => prompt instanceof Prompt ? prompt : new Prompt(prompt)));
    }

    set(prompt, position) {
        this.collection[position] = prompt;
    }

    get(identifier) {
        return this.collection.find(prompt => prompt.identifier === identifier);
    }

    index(identifier) {
        return this.collection.findIndex(prompt => prompt.identifier === identifier);
    }

    has(identifier) {
        return this.index(identifier) !== -1;
    }

    override(prompt, position) {
        this.set(prompt, position);
        this.overriddenPrompts.push(prompt.identifier);
    }
}

class TokenHandler {
    constructor(model) {
        this.model = model;
        this.counts = {
            start_chat: 0,
            prompt: 0,
            bias: 0,
            nudge: 0,
            jailbreak: 0,
            impersonate: 0,
            examples: 0,
            conversation: 0,
        };
    }

    async countAsync(messages, full = false, type) {
        const tokenCount = await countTokensOpenAIAsync(messages, this.model, full);
        if (type) {
            this.counts[type] = (this.counts[type] ?? 0) + tokenCount;
        }
        return tokenCount;
    }
}

class Message {
    static tokensPerImage = 85;

    constructor(role, content, identifier, tokenHandler) {
        this.identifier = identifier;
        this.role = role || 'system';
        this.content = content;
        this.tokens = 0;
        this.tokenHandler = tokenHandler;
    }

    static async createAsync(role, content, identifier, tokenHandler) {
        const message = new Message(role, content, identifier, tokenHandler);
        if (typeof message.content === 'string' && message.content.length > 0) {
            message.tokens = await tokenHandler.countAsync({ role: message.role, content: message.content });
        }
        return message;
    }

    static async fromPromptAsync(prompt, tokenHandler) {
        const message = await Message.createAsync(prompt.role, prompt.content, prompt.identifier, tokenHandler);
        message.extension = Boolean(prompt?.extension);
        message.injected = Boolean(prompt?.injected);
        message.systemPrompt = Boolean(prompt?.system_prompt);
        return message;
    }

    ensureContentIsArray() {
        const textContent = this.content;
        if (!Array.isArray(this.content)) {
            this.content = [];
            if (typeof textContent === 'string' && textContent.length > 0) {
                this.content.push({ type: 'text', text: textContent });
            }
        }
        return this.content;
    }

    async refreshTokens() {
        const payload = {
            role: this.role,
            ...(this.content !== undefined ? { content: this.content } : {}),
            ...(this.name ? { name: this.name } : {}),
            ...(this.tool_calls ? { tool_calls: this.tool_calls } : {}),
        };
        this.tokens = await this.tokenHandler.countAsync(payload);
    }

    async setName(name) {
        this.name = name;
        await this.refreshTokens();
    }

    async setToolCalls(invocations) {
        this.tool_calls = invocations.map(invocation => ({
            id: invocation.id,
            type: 'function',
            function: {
                arguments: invocation.parameters,
                name: invocation.name,
            },
        }));
        await this.refreshTokens();
    }

    async addImage(image, quality = 'auto') {
        this.content = this.ensureContentIsArray();
        try {
            image = isDataURL(image) ? image : await fetchMediaAsDataUrl(image, 'image/png');
        } catch (error) {
            console.error('Image adding skipped', error);
            return;
        }

        this.content.push({ type: 'image_url', image_url: { url: image, detail: quality } });
        this.tokens += getImageTokenCost(image, quality);
    }

    async addVideo(video) {
        this.content = this.ensureContentIsArray();
        try {
            video = isDataURL(video) ? video : await fetchMediaAsDataUrl(video, 'video/mp4');
        } catch (error) {
            console.error('Video adding skipped', error);
            return;
        }

        this.content.push({ type: 'video_url', video_url: { url: video } });
        this.tokens += 263 * 40;
    }

    async addAudio(audio) {
        this.content = this.ensureContentIsArray();
        try {
            audio = isDataURL(audio) ? audio : await fetchMediaAsDataUrl(audio, 'audio/wav');
        } catch (error) {
            console.error('Audio adding skipped', error);
            return;
        }

        this.content.push({ type: 'audio_url', audio_url: { url: audio } });
        this.tokens += 32 * 300;
    }

    getTokens() {
        return this.tokens;
    }
}

class MessageCollection {
    constructor(identifier, ...items) {
        this.identifier = identifier;
        this.collection = [...items];
    }

    add(item) {
        this.collection.push(item);
    }

    getCollection() {
        return this.collection;
    }

    getTokens() {
        return this.collection.reduce((sum, item) => sum + item.getTokens(), 0);
    }

    flatten() {
        return this.collection.reduce((acc, item) => {
            if (item instanceof MessageCollection) {
                acc.push(...item.flatten());
            } else {
                acc.push(item);
            }
            return acc;
        }, []);
    }
}

class IdentifierNotFoundError extends Error {
    constructor(identifier) {
        super(`Identifier not found: ${identifier}`);
        this.name = 'IdentifierNotFoundError';
    }
}

class TokenBudgetExceededError extends Error {
    constructor(identifier) {
        super(`Token budget exceeded. Message: ${identifier}`);
        this.name = 'TokenBudgetExceededError';
    }
}

class ChatCompletion {
    constructor(tokenHandler) {
        this.tokenHandler = tokenHandler;
        this.tokenBudget = 0;
        this.messages = new MessageCollection('root');
        this.overriddenPrompts = [];
    }

    setTokenBudget(context, response) {
        this.tokenBudget = context - response;
    }

    getMessages() {
        return this.messages;
    }

    add(collection, position = null) {
        this.checkTokenBudget(collection, collection.identifier);
        if (position !== null && position !== -1) {
            this.messages.collection[position] = collection;
        } else {
            this.messages.collection.push(collection);
        }
        this.decreaseTokenBudgetBy(collection.getTokens());
    }

    insert(message, identifier, position = 'end') {
        this.checkTokenBudget(message, message.identifier);
        const index = this.findMessageIndex(identifier);
        if (message.content || message.tool_calls) {
            if (position === 'start') {
                this.messages.collection[index].collection.unshift(message);
            } else if (position === 'end') {
                this.messages.collection[index].collection.push(message);
            } else if (typeof position === 'number') {
                this.messages.collection[index].collection.splice(position, 0, message);
            }
            this.decreaseTokenBudgetBy(message.getTokens());
        }
    }

    insertAtStart(message, identifier) {
        this.insert(message, identifier, 'start');
    }

    insertAtEnd(message, identifier) {
        this.insert(message, identifier, 'end');
    }

    canAfford(message) {
        return this.tokenBudget - message.getTokens() >= 0;
    }

    canAffordAll(messages) {
        return this.tokenBudget - messages.reduce((sum, message) => sum + message.getTokens(), 0) >= 0;
    }

    reserveBudget(message) {
        const tokens = typeof message === 'number' ? message : message.getTokens();
        this.decreaseTokenBudgetBy(tokens);
    }

    freeBudget(message) {
        this.increaseTokenBudgetBy(message.getTokens());
    }

    increaseTokenBudgetBy(tokens) {
        this.tokenBudget += tokens;
    }

    decreaseTokenBudgetBy(tokens) {
        this.tokenBudget -= tokens;
    }

    findMessageIndex(identifier) {
        const index = this.messages.collection.findIndex(item => item?.identifier === identifier);
        if (index < 0) {
            throw new IdentifierNotFoundError(identifier);
        }
        return index;
    }

    checkTokenBudget(message, identifier) {
        if (!this.canAfford(message)) {
            throw new TokenBudgetExceededError(identifier);
        }
    }

    async squashSystemMessages() {
        const excludeList = ['newMainChat', 'newChat', 'groupNudge'];
        this.messages.collection = this.messages.flatten();
        let lastMessage = null;
        const squashedMessages = [];

        for (const message of this.messages.collection) {
            if (message.role === 'system' && !message.content) {
                continue;
            }

            const shouldSquash = current => !excludeList.includes(current.identifier) && current.role === 'system' && !current.name;
            if (shouldSquash(message) && lastMessage && shouldSquash(lastMessage)) {
                lastMessage.content += '\n' + message.content;
                lastMessage.tokens = await this.tokenHandler.countAsync({ role: lastMessage.role, content: lastMessage.content });
            } else {
                squashedMessages.push(message);
                lastMessage = message;
            }
        }

        this.messages.collection = squashedMessages;
    }

    getChat() {
        const chat = [];

        for (const item of this.messages.collection) {
            if (!item) {
                continue;
            }
            const messages = item instanceof MessageCollection ? item.flatten() : [item];
            for (const message of messages) {
                if (message.content || message.tool_calls) {
                    chat.push({
                        role: message.role,
                        content: message.content,
                        ...(message.name ? { name: message.name } : {}),
                        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
                        ...(message.role === 'tool' ? { tool_call_id: message.identifier } : {}),
                    });
                }
            }
        }

        return chat;
    }
}

function serializeMessageNode(node) {
    if (node instanceof MessageCollection) {
        return {
            type: 'collection',
            identifier: node.identifier,
            collection: node.getCollection().map(serializeMessageNode),
        };
    }

    return {
        type: 'message',
        identifier: node.identifier,
        role: node.role,
        content: node.content,
        name: node.name,
        tokens: node.tokens,
        extension: Boolean(node.extension),
        injected: Boolean(node.injected),
        systemPrompt: Boolean(node.systemPrompt),
        tool_calls: node.tool_calls,
    };
}

function createPromptItemization(serviceSettings = {}) {
    return {
        oaiStartTokens: 0,
        oaiPromptTokens: 0,
        oaiBiasTokens: 0,
        oaiNudgeTokens: 0,
        oaiJailbreakTokens: 0,
        oaiImpersonateTokens: 0,
        oaiExamplesTokens: 0,
        oaiConversationTokens: 0,
        oaiNsfwTokens: 0,
        oaiMainTokens: 0,
        charDescriptionTokens: 0,
        charPersonalityTokens: 0,
        scenarioTextTokens: 0,
        userPersonaStringTokens: 0,
        worldInfoStringTokens: 0,
        worldInfoDepthTokens: 0,
        summarizeStringTokens: 0,
        authorsNoteStringTokens: 0,
        smartContextStringTokens: 0,
        chatVectorsStringTokens: 0,
        dataBankVectorsStringTokens: 0,
        allAnchorsTokens: 0,
        beforeScenarioAnchorTokens: 0,
        afterScenarioAnchorTokens: 0,
        finalPromptTokens: 0,
        maxContext: Math.max(0, (Number(serviceSettings?.openai_max_context) || 0) - (Number(serviceSettings?.openai_max_tokens) || 0)),
    };
}

function addPromptItemizationTokens(itemization, key, tokens) {
    itemization[key] = (itemization[key] ?? 0) + tokens;
}

function classifyPromptItemizationMessage(message, collectionIdentifier, itemization) {
    const identifier = String(message?.identifier || '');
    const tokens = Number(message?.tokens) || 0;

    if (!tokens) {
        return;
    }

    if (identifier === 'newMainChat') {
        addPromptItemizationTokens(itemization, 'oaiStartTokens', tokens);
        return;
    }

    if (identifier === 'newChat' || identifier.startsWith('dialogueExamples ') || collectionIdentifier === 'dialogueExamples') {
        addPromptItemizationTokens(itemization, 'oaiExamplesTokens', tokens);
        return;
    }

    if (
        identifier.startsWith('chatHistory-') ||
        identifier.startsWith('toolCall-') ||
        identifier === 'emptyUserMessageReplacement' ||
        identifier === 'continuePrefill' ||
        message.role === 'tool' ||
        (collectionIdentifier === 'continueNudge' && identifier !== 'continueNudgeText')
    ) {
        if (message?.injected && message.role === 'system') {
            addPromptItemizationTokens(itemization, 'worldInfoDepthTokens', tokens);
            return;
        }
        addPromptItemizationTokens(itemization, 'oaiConversationTokens', tokens);
        return;
    }

    switch (identifier) {
        case 'worldInfoBefore':
        case 'worldInfoAfter':
            addPromptItemizationTokens(itemization, 'worldInfoStringTokens', tokens);
            return;
        case 'charDescription':
            addPromptItemizationTokens(itemization, 'charDescriptionTokens', tokens);
            return;
        case 'charPersonality':
            addPromptItemizationTokens(itemization, 'charPersonalityTokens', tokens);
            return;
        case 'scenario':
            addPromptItemizationTokens(itemization, 'scenarioTextTokens', tokens);
            return;
        case 'personaDescription':
            addPromptItemizationTokens(itemization, 'userPersonaStringTokens', tokens);
            return;
        case 'summary':
            addPromptItemizationTokens(itemization, 'summarizeStringTokens', tokens);
            addPromptItemizationTokens(itemization, 'allAnchorsTokens', tokens);
            return;
        case 'authorsNote':
            addPromptItemizationTokens(itemization, 'authorsNoteStringTokens', tokens);
            addPromptItemizationTokens(itemization, 'allAnchorsTokens', tokens);
            return;
        case 'smartContext':
            addPromptItemizationTokens(itemization, 'smartContextStringTokens', tokens);
            addPromptItemizationTokens(itemization, 'allAnchorsTokens', tokens);
            return;
        case 'vectorsMemory':
            addPromptItemizationTokens(itemization, 'chatVectorsStringTokens', tokens);
            addPromptItemizationTokens(itemization, 'allAnchorsTokens', tokens);
            return;
        case 'vectorsDataBank':
            addPromptItemizationTokens(itemization, 'dataBankVectorsStringTokens', tokens);
            addPromptItemizationTokens(itemization, 'allAnchorsTokens', tokens);
            return;
        case 'bias':
            addPromptItemizationTokens(itemization, 'oaiBiasTokens', tokens);
            return;
        case 'impersonate':
            addPromptItemizationTokens(itemization, 'oaiImpersonateTokens', tokens);
            return;
        case 'quietPrompt':
        case 'groupNudge':
        case 'continueNudgeText':
            addPromptItemizationTokens(itemization, 'oaiNudgeTokens', tokens);
            return;
        case 'jailbreak':
            addPromptItemizationTokens(itemization, 'oaiJailbreakTokens', tokens);
            return;
        case 'nsfw':
            addPromptItemizationTokens(itemization, 'oaiNsfwTokens', tokens);
            return;
        case 'main':
            addPromptItemizationTokens(itemization, 'oaiMainTokens', tokens);
            return;
    }

    if (message?.extension) {
        addPromptItemizationTokens(itemization, 'allAnchorsTokens', tokens);
        return;
    }

    addPromptItemizationTokens(itemization, 'oaiMainTokens', tokens);
}

function walkPromptItemization(node, itemization, collectionIdentifier = null) {
    if (node instanceof MessageCollection) {
        for (const child of node.getCollection()) {
            walkPromptItemization(child, itemization, node.identifier || collectionIdentifier);
        }
        return;
    }

    classifyPromptItemizationMessage(node, collectionIdentifier, itemization);
}

function buildPromptItemization(messages, serviceSettings = {}) {
    const itemization = createPromptItemization(serviceSettings);
    walkPromptItemization(messages, itemization);
    itemization.oaiPromptTokens =
        itemization.charDescriptionTokens +
        itemization.charPersonalityTokens +
        itemization.scenarioTextTokens +
        itemization.userPersonaStringTokens +
        itemization.oaiExamplesTokens;
    itemization.finalPromptTokens =
        itemization.oaiStartTokens +
        itemization.oaiPromptTokens +
        itemization.oaiBiasTokens +
        itemization.oaiNudgeTokens +
        itemization.oaiJailbreakTokens +
        itemization.oaiImpersonateTokens +
        itemization.oaiConversationTokens +
        itemization.oaiNsfwTokens +
        itemization.oaiMainTokens +
        itemization.worldInfoStringTokens +
        itemization.worldInfoDepthTokens +
        itemization.allAnchorsTokens;
    return itemization;
}

class PromptManagerCore {
    constructor({ serviceSettings = {}, activeCharacter = null, env = {} } = {}) {
        this.serviceSettings = serviceSettings;
        this.activeCharacter = activeCharacter;
        this.env = env;
    }

    getPromptOrderForCharacter(character) {
        if (!character) {
            return [];
        }
        return this.serviceSettings.prompt_order?.find(list => String(list.character_id) === String(character.id))?.order ?? [];
    }

    getPromptOrderEntry(character, identifier) {
        return this.getPromptOrderForCharacter(character).find(entry => entry.identifier === identifier) ?? null;
    }

    getPromptById(identifier) {
        return this.serviceSettings.prompts?.find(item => item && item.identifier === identifier) ?? null;
    }

    isPromptDisabledForActiveCharacter(identifier) {
        const promptOrderEntry = this.getPromptOrderEntry(this.activeCharacter, identifier);
        return promptOrderEntry ? !promptOrderEntry.enabled : false;
    }

    isValidName(name) {
        return /^[a-zA-Z0-9_]{1,64}$/.test(name);
    }

    sanitizeName(name) {
        return String(name || '').replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
    }

    shouldTrigger(prompt, generationType) {
        if (!Array.isArray(prompt?.injection_trigger) || !prompt.injection_trigger.length) {
            return true;
        }
        return prompt.injection_trigger.includes(generationType);
    }

    preparePrompt(prompt, original = null) {
        const preparedPrompt = new Prompt(prompt);
        const additional = {};
        if (typeof original === 'string') {
            additional.original = original;
        }
        preparedPrompt.content = substituteParams(preparedPrompt.content ?? '', this.env, additional);
        return preparedPrompt;
    }

    getPromptCollection(generationType) {
        const normalizedGenerationType = String(generationType || 'normal').toLowerCase().trim();
        const promptCollection = new PromptCollection();
        const promptOrder = this.getPromptOrderForCharacter(this.activeCharacter);

        for (const entry of promptOrder) {
            const prompt = this.getPromptById(entry.identifier);
            if (!prompt) {
                continue;
            }

            if (entry.enabled && this.shouldTrigger(prompt, normalizedGenerationType)) {
                promptCollection.add(this.preparePrompt(prompt));
            } else if (entry.identifier === 'main') {
                const replacementPrompt = structuredClone(prompt);
                replacementPrompt.content = '';
                promptCollection.add(this.preparePrompt(replacementPrompt));
            }
        }

        return promptCollection;
    }
}

function stringFormat(format, ...values) {
    return String(format || '').replace(/{(\d+)}/g, (match, index) => values[index] ?? match);
}

function isDataURL(value) {
    return typeof value === 'string' && /^data:([a-z]+\/[a-z0-9.+-]+)?(;[a-z-]+=[a-z0-9-]+)*(;base64)?,/i.test(value);
}

function normalizeMimeType(contentType, fallbackMimeType) {
    const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
    return normalized || fallbackMimeType;
}

async function fetchMediaAsDataUrl(url, fallbackMimeType) {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.status}`);
    }

    const contentType = normalizeMimeType(response.headers.get('content-type'), fallbackMimeType);
    const body = Buffer.from(await response.arrayBuffer()).toString('base64');
    return `data:${contentType};base64,${body}`;
}

function decodeDataUrl(dataUrl) {
    const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) {
        return null;
    }

    return {
        mimeType: String(match[1] || '').toLowerCase(),
        buffer: Buffer.from(match[2], 'base64'),
    };
}

function getPngSize(buffer) {
    if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
        return null;
    }

    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function getGifSize(buffer) {
    if (buffer.length < 10 || (buffer.toString('ascii', 0, 6) !== 'GIF87a' && buffer.toString('ascii', 0, 6) !== 'GIF89a')) {
        return null;
    }

    return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
    };
}

function getJpegSize(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
        return null;
    }

    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xFF) {
            offset++;
            continue;
        }

        const marker = buffer[offset + 1];
        offset += 2;

        if (marker === 0xD8 || marker === 0xD9) {
            continue;
        }

        if (offset + 2 > buffer.length) {
            break;
        }

        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) {
            break;
        }

        const isSofMarker = (marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF);
        if (isSofMarker && segmentLength >= 7) {
            return {
                height: buffer.readUInt16BE(offset + 3),
                width: buffer.readUInt16BE(offset + 5),
            };
        }

        offset += segmentLength;
    }

    return null;
}

function getWebpSize(buffer) {
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        return null;
    }

    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8X' && buffer.length >= 30) {
        return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3),
        };
    }

    if (chunkType === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return {
            width: (bits & 0x3FFF) + 1,
            height: ((bits >> 14) & 0x3FFF) + 1,
        };
    }

    return null;
}

function getImageSizeFromDataUrl(dataUrl) {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
        return null;
    }

    const { mimeType, buffer } = decoded;
    if (mimeType === 'image/png') {
        return getPngSize(buffer);
    }
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
        return getJpegSize(buffer);
    }
    if (mimeType === 'image/gif') {
        return getGifSize(buffer);
    }
    if (mimeType === 'image/webp') {
        return getWebpSize(buffer);
    }

    return null;
}

function getImageTokenCost(dataUrl, quality) {
    if (quality === 'low') {
        return Message.tokensPerImage;
    }

    const size = getImageSizeFromDataUrl(dataUrl);
    if (!size?.width || !size?.height) {
        return Message.tokensPerImage;
    }

    if (quality === 'auto' && size.width <= 512 && size.height <= 512) {
        return Message.tokensPerImage;
    }

    const scale = 2048 / Math.min(size.width, size.height);
    const scaledWidth = Math.round(size.width * scale);
    const scaledHeight = Math.round(size.height * scale);
    const finalScale = 768 / Math.min(scaledWidth, scaledHeight);
    const finalWidth = Math.round(scaledWidth * finalScale);
    const finalHeight = Math.round(scaledHeight * finalScale);
    const squares = Math.ceil(finalWidth / 512) * Math.ceil(finalHeight / 512);
    return squares * 170 + 85;
}

function resolveMediaUrl(url, clientOrigin = '') {
    const mediaUrl = String(url || '');
    if (!mediaUrl || isDataURL(mediaUrl)) {
        return mediaUrl;
    }

    try {
        return new URL(mediaUrl).toString();
    } catch {
        if (!clientOrigin) {
            return mediaUrl;
        }
        try {
            return new URL(mediaUrl, clientOrigin).toString();
        } catch {
            return mediaUrl;
        }
    }
}

function parseExampleIntoIndividual(messageExampleString, userName, charName, groupNames = [], appendNamesForGroup = true, selectedGroup = false) {
    const groupBotNames = groupNames.filter(Boolean).map(name => `${name}:`);
    const lines = String(messageExampleString || '').split('\n');
    const result = [];
    const currentMessageLines = [];
    let inUser = false;
    let inBot = false;
    let botName = charName;

    const addMessage = (name, role, systemName) => {
        let parsedMessage = currentMessageLines.join('\n').replace(`${name}:`, '').trim();

        if (appendNamesForGroup && selectedGroup && ['example_user', 'example_assistant'].includes(systemName)) {
            parsedMessage = `${name}: ${parsedMessage}`;
        }

        result.push({ role, content: parsedMessage, name: systemName });
        currentMessageLines.length = 0;
    };

    for (let index = 1; index < lines.length; index++) {
        const currentLine = lines[index];

        if (currentLine.startsWith(`${userName}:`)) {
            inUser = true;
            if (inBot) {
                addMessage(botName, 'system', 'example_assistant');
            }
            inBot = false;
        } else if (currentLine.startsWith(`${charName}:`) || groupBotNames.some(name => currentLine.startsWith(name))) {
            if (!currentLine.startsWith(`${charName}:`) && groupBotNames.length) {
                botName = currentLine.split(':')[0];
            }

            inBot = true;
            if (inUser) {
                addMessage(userName, 'system', 'example_user');
            }
            inUser = false;
        }

        currentMessageLines.push(currentLine);
    }

    if (inUser) {
        addMessage(userName, 'system', 'example_user');
    } else if (inBot) {
        addMessage(botName, 'system', 'example_assistant');
    }

    return result;
}

function parseWorldInfoExampleBlocks(content, context) {
    const exampleString = String(content || '').replace(/\r/gm, '');
    if (!exampleString.trim()) {
        return [];
    }

    const normalizedExamples = exampleString.startsWith('<START>')
        ? exampleString
        : `<START>\n${exampleString.trim()}`;
    const exampleBlocks = normalizedExamples
        .split(/<START>/gi)
        .slice(1)
        .map(block => `<START>\n${block.trim()}\n`);

    return exampleBlocks
        .map(block => block.replace(/<START>/i, '{Example Dialogue:}'))
        .map(block => parseExampleIntoIndividual(block, context.userName, context.charName, context.groupNames, true, context.selectedGroup))
        .filter(block => Array.isArray(block) && block.length > 0);
}

function normalizeMessageExamples(examples) {
    let examplesString = String(examples || '');
    if (!examplesString || examplesString === '<START>') {
        return '';
    }

    if (!examplesString.startsWith('<START>')) {
        examplesString = `<START>\n${examplesString.trim()}`;
    }

    return examplesString
        .split(/<START>/gi)
        .slice(1)
        .map(block => `<START>\n${block.trim()}\n`)
        .join('');
}

function substituteParams(content, env = {}, additional = {}) {
    return evaluatePromptMacros(content, env, {
        additional,
        macroState: env?.__macroState || additional?.__macroState || null,
    });
}

function formatWorldInfo(value, wiFormat) {
    if (!value) {
        return '';
    }

    if (!String(wiFormat || '').trim()) {
        return value;
    }

    return stringFormat(wiFormat, value);
}

function formatPersonaDescription(value) {
    const personaText = String(value || '').trim();
    if (!personaText) {
        return '';
    }

    return [
        '=== Persona Notes for {{user}} ===',
        personaText,
        '=== END Persona Notes for {{user}} ===',
    ].join('\n');
}

function getPromptRole(role) {
    switch (role) {
        case extension_prompt_roles.USER:
            return 'user';
        case extension_prompt_roles.ASSISTANT:
            return 'assistant';
        default:
            return 'system';
    }
}

function getPromptPosition(position) {
    if (position === extension_prompt_types.BEFORE_PROMPT) {
        return 'start';
    }

    if (position === extension_prompt_types.IN_PROMPT) {
        return 'end';
    }

    return false;
}

function getExtensionPromptMaxDepth(extensionPrompts = {}) {
    return Object.values(extensionPrompts).reduce((maxDepth, prompt) => {
        if (prompt?.position === extension_prompt_types.IN_CHAT) {
            return Math.max(maxDepth, Number(prompt.depth) || 0);
        }
        return maxDepth;
    }, 0);
}

function getExtensionPrompt(extensionPrompts = {}, env = {}, position = extension_prompt_types.IN_PROMPT, depth, separator = '\n', role, wrap = true) {
    const getValue = (prompt) => String(prompt?.value ?? prompt?.resolvedValue ?? '');
    const prompts = Object.keys(extensionPrompts)
        .sort()
        .map(key => extensionPrompts[key])
        .filter(prompt => prompt?.position === position && getValue(prompt))
        .filter(prompt => depth === undefined || prompt.depth === undefined || prompt.depth === depth)
        .filter(prompt => role === undefined || prompt.role === undefined || prompt.role === role);

    let values = prompts.map(prompt => getValue(prompt).trim()).join(separator);
    if (wrap && values.length && !values.startsWith(separator)) {
        values = separator + values;
    }
    if (wrap && values.length && !values.endsWith(separator)) {
        values += separator;
    }
    return values.length ? substituteParams(values, env) : values;
}

async function applyWorldInfoToContext(context) {
    if (!context.worldInfoRequest || typeof context.worldInfoRequest !== 'object') {
        return;
    }

    const scanResult = await scanWorldInfo({
        ...context.worldInfoRequest,
        extensionPrompts: context.extensionPrompts,
    });
    context.worldInfoTimedState = structuredClone(scanResult.timedWorldInfo || {});
    context.worldInfoRequest.timedWorldInfo = structuredClone(scanResult.timedWorldInfo || {});
    context.worldInfoOverflowed = Boolean(scanResult.overflowed);

    context.worldInfoBefore = scanResult.worldInfoBefore || '';
    context.worldInfoAfter = scanResult.worldInfoAfter || '';

    const extensionPrompts = { ...context.extensionPrompts };
    const authorsNote = extensionPrompts['2_floating_prompt'];
    if (authorsNote) {
        const original = String(authorsNote.value || '');
        const originalResolved = String(authorsNote.resolvedValue ?? authorsNote.value ?? '');
        const top = Array.isArray(scanResult.ANBeforeEntries) ? scanResult.ANBeforeEntries.join('\n') : '';
        const bottom = Array.isArray(scanResult.ANAfterEntries) ? scanResult.ANAfterEntries.join('\n') : '';
        extensionPrompts['2_floating_prompt'] = {
            ...authorsNote,
            value: [top, original, bottom].filter(Boolean).join('\n'),
            resolvedValue: [top, originalResolved, bottom].filter(Boolean).join('\n'),
        };
    }

    for (const item of Array.isArray(scanResult.WIDepthEntries) ? scanResult.WIDepthEntries : []) {
        extensionPrompts[`customDepthWI_${item.depth}_${item.role}`] = {
            value: Array.isArray(item.entries) ? item.entries.join('\n') : '',
            position: extension_prompt_types.IN_CHAT,
            depth: item.depth,
            scan: false,
            role: item.role ?? extension_prompt_roles.SYSTEM,
        };
    }

    for (const [key, value] of Object.entries(scanResult.outletEntries || {})) {
        extensionPrompts[`customWIOutlet_${key}`] = {
            value: Array.isArray(value) ? value.join('\n') : '',
            position: extension_prompt_types.NONE,
            depth: 0,
            scan: false,
            role: extension_prompt_roles.SYSTEM,
        };
    }

    context.extensionPrompts = extensionPrompts;
    refreshMacroOutletValues(context.macroState, extensionPrompts);

    if (Array.isArray(scanResult.EMEntries) && scanResult.EMEntries.length) {
        const messageExamples = Array.isArray(context.messageExamples) ? [...context.messageExamples] : [];

        for (const example of scanResult.EMEntries) {
            const parsedBlocks = parseWorldInfoExampleBlocks(example?.content, context);
            if (!parsedBlocks.length) {
                continue;
            }

            if (example?.position === wi_anchor_position.before) {
                messageExamples.unshift(...parsedBlocks);
            } else {
                messageExamples.push(...parsedBlocks);
            }
        }

        context.messageExamples = messageExamples;
    }
}

async function countSentencepieceArrayTokens(tokenizer, array) {
    const instance = await tokenizer?.get();
    if (!instance) {
        const fallbackBody = JSON.stringify(array);
        return Math.ceil(fallbackBody.length / 3.35);
    }
    const jsonBody = array.flatMap(item => Object.values(item)).join('\n\n');
    return instance.encodeIds(jsonBody).length;
}

async function countTokensOpenAIAsync(messages, model, full = false) {
    const tokenizerModel = getTokenizerModel(String(model || ''));
    const messageArray = Array.isArray(messages) ? messages : [messages];

    if (tokenizerModel === 'claude') {
        const instance = await getWebTokenizer('claude')?.get();
        if (!instance) {
            throw new Error('Failed to load Claude tokenizer');
        }
        return countWebTokenizerTokens(instance, messageArray);
    }

    if (tokenizerModel === 'llama3' || tokenizerModel === 'llama-3') {
        const instance = await getWebTokenizer('llama3')?.get();
        if (!instance) {
            throw new Error('Failed to load Llama3 tokenizer');
        }
        return countWebTokenizerTokens(instance, messageArray);
    }

    if (tokenizerModel === 'qwen2' || tokenizerModel === 'command-r' || tokenizerModel === 'command-a' || tokenizerModel === 'nemo' || tokenizerModel === 'deepseek') {
        const instance = await getWebTokenizer(tokenizerModel)?.get();
        if (!instance) {
            throw new Error(`Failed to load tokenizer: ${tokenizerModel}`);
        }
        return countWebTokenizerTokens(instance, messageArray);
    }

    if (tokenizerModel === 'llama' || tokenizerModel === 'mistral' || tokenizerModel === 'yi' || tokenizerModel === 'gemma' || tokenizerModel === 'gemini' || tokenizerModel === 'jamba') {
        const sentencepieceModel = tokenizerModel === 'gemini' ? 'gemma' : tokenizerModel;
        return countSentencepieceArrayTokens(getSentencepiceTokenizer(sentencepieceModel), messageArray);
    }

    let tokenCount = 0;
    const tokenizer = getTiktokenTokenizer(tokenizerModel);
    const modelName = String(model || '');
    const tokensPerName = modelName.includes('gpt-3.5-turbo-0301') ? -1 : 1;
    const tokensPerMessage = modelName.includes('gpt-3.5-turbo-0301') ? 4 : 3;
    const tokensPadding = 3;

    for (const message of messageArray) {
        tokenCount += tokensPerMessage;
        for (const [key, value] of Object.entries(message)) {
            if (value === undefined || value === null) {
                continue;
            }
            tokenCount += tokenizer.encode(String(value)).length;
            if (key === 'name') {
                tokenCount += tokensPerName;
            }
        }
    }

    tokenCount += tokensPadding;
    if (!full) {
        tokenCount -= 2;
    }

    return tokenCount;
}

async function populationInjectionPrompts(prompts, messages, extensionPrompts, env) {
    let totalInsertedMessages = 0;
    const maxDepth = getExtensionPromptMaxDepth(extensionPrompts);

    for (let depth = 0; depth <= maxDepth; depth++) {
        const depthPrompts = prompts.filter(prompt => prompt.injection_depth === depth && prompt.content);
        const roleMessages = [];
        const orderGroups = { 100: [] };

        for (const prompt of depthPrompts) {
            const order = prompt.injection_order ?? 100;
            orderGroups[order] = orderGroups[order] ?? [];
            orderGroups[order].push(prompt);
        }

        const orders = Object.keys(orderGroups).sort((a, b) => Number(b) - Number(a));
        for (const order of orders) {
            const orderPrompts = orderGroups[order];
            for (const role of ['system', 'user', 'assistant']) {
                const rolePrompts = orderPrompts.filter(prompt => prompt.role === role).map(prompt => prompt.content).join('\n');
                const extensionPrompt = Number(order) === 100
                    ? getExtensionPrompt(extensionPrompts, env, extension_prompt_types.IN_CHAT, depth, '\n', role === 'system' ? extension_prompt_roles.SYSTEM : role === 'user' ? extension_prompt_roles.USER : extension_prompt_roles.ASSISTANT, false)
                    : '';
                const jointPrompt = [rolePrompts, extensionPrompt].filter(Boolean).map(value => value.trim()).join('\n');
                if (jointPrompt) {
                    roleMessages.push({ role, content: jointPrompt, injected: true });
                }
            }
        }

        if (roleMessages.length) {
            const insertIndex = depth + totalInsertedMessages;
            messages.splice(insertIndex, 0, ...roleMessages);
            totalInsertedMessages += roleMessages.length;
        }
    }

    return messages.reverse();
}

async function populateDialogueExamples(prompts, chatCompletion, messageExamples, context) {
    if (!prompts.has('dialogueExamples')) {
        return;
    }

    chatCompletion.add(new MessageCollection('dialogueExamples'), prompts.index('dialogueExamples'));

    if (!Array.isArray(messageExamples) || !messageExamples.length) {
        return;
    }

    const newExampleChat = await Message.createAsync('system', substituteParams(context.oaiSettings.new_example_chat_prompt, context.env), 'newChat', context.tokenHandler);
    for (const [dialogueIndex, dialogue] of messageExamples.entries()) {
        const chatMessages = [];
        for (let promptIndex = 0; promptIndex < dialogue.length; promptIndex++) {
            const prompt = dialogue[promptIndex];
            const chatMessage = await Message.createAsync('system', prompt.content || '', `dialogueExamples ${dialogueIndex}-${promptIndex}`, context.tokenHandler);
            if (prompt.name) {
                await chatMessage.setName(prompt.name);
            }
            chatMessages.push(chatMessage);
        }

        if (!chatCompletion.canAffordAll([newExampleChat, ...chatMessages])) {
            break;
        }

        chatCompletion.insert(newExampleChat, 'dialogueExamples');
        for (const chatMessage of chatMessages) {
            chatCompletion.insert(chatMessage, 'dialogueExamples');
        }
    }
}

async function populateChatHistory(messages, prompts, chatCompletion, context) {
    if (!prompts.has('chatHistory')) {
        return;
    }

    chatCompletion.add(new MessageCollection('chatHistory'), prompts.index('chatHistory'));

    const newChatPrompt = context.selectedGroup ? context.oaiSettings.new_group_chat_prompt : context.oaiSettings.new_chat_prompt;
    const newChatMessage = await Message.createAsync('system', substituteParams(newChatPrompt, context.env), 'newMainChat', context.tokenHandler);
    chatCompletion.reserveBudget(newChatMessage);

    let groupNudgeMessage = null;
    if (context.selectedGroup && prompts.has('groupNudge') && !['impersonate'].includes(context.type)) {
        groupNudgeMessage = await Message.fromPromptAsync(prompts.get('groupNudge'), context.tokenHandler);
        chatCompletion.reserveBudget(groupNudgeMessage);
    }

    let continueMessageCollection = null;
    if (context.type === 'continue' && context.cyclePrompt && !context.oaiSettings.continue_prefill) {
        continueMessageCollection = new MessageCollection('continueNudge');
        const continueMessageIndex = messages.findLastIndex(message => !message.injected);
        if (continueMessageIndex >= 0) {
            const continueMessage = messages.splice(continueMessageIndex, 1)[0];
            const prompt = new Prompt(continueMessage);
            const preparedPrompt = context.promptManager.preparePrompt(prompt);
            const chatMessage = await Message.fromPromptAsync(preparedPrompt, context.tokenHandler);
            continueMessageCollection.add(chatMessage);
        }
        const continueNudge = substituteParams(context.oaiSettings.continue_nudge_prompt, context.env, { lastChatMessage: String(context.cyclePrompt).trim() });
        continueMessageCollection.add(await Message.createAsync('system', continueNudge, 'continueNudgeText', context.tokenHandler));
        chatCompletion.reserveBudget(continueMessageCollection);
    }

    const lastChatPrompt = messages[messages.length - 1];
    const emptyUserMessage = await Message.createAsync('user', context.oaiSettings.send_if_empty, 'emptyUserMessageReplacement', context.tokenHandler);
    if (lastChatPrompt?.role === 'assistant' && context.oaiSettings.send_if_empty && chatCompletion.canAfford(emptyUserMessage)) {
        chatCompletion.insert(emptyUserMessage, 'chatHistory');
    }

    const chatPool = [...messages].reverse();
    const mediaSupport = context.mediaSupport || {};
    for (let index = 0; index < chatPool.length; index++) {
        const chatPrompt = chatPool[index];
        const prompt = new Prompt(chatPrompt);
        prompt.identifier = `chatHistory-${messages.length - index}`;
        const preparedPrompt = context.promptManager.preparePrompt(prompt);
        const chatMessage = await Message.fromPromptAsync(preparedPrompt, context.tokenHandler);

        if (context.serviceSettings.names_behavior === character_names_behavior.COMPLETION && preparedPrompt.name) {
            const messageName = context.promptManager.isValidName(preparedPrompt.name) ? preparedPrompt.name : context.promptManager.sanitizeName(preparedPrompt.name);
            await chatMessage.setName(messageName);
        }

        async function inlineMediaAttachment(media) {
            if (!media?.url) {
                return;
            }

            const mediaType = String(media.type || 'image');
            const mediaUrl = resolveMediaUrl(media.url, context.clientOrigin);
            const imageQuality = context.oaiSettings.inline_image_quality || 'auto';

            if (mediaSupport.image && mediaType === 'image') {
                await chatMessage.addImage(mediaUrl, imageQuality);
            }
            if (mediaSupport.video && mediaType === 'video') {
                await chatMessage.addVideo(mediaUrl);
            }
            if (mediaSupport.audio && mediaType === 'audio') {
                await chatMessage.addAudio(mediaUrl);
            }
        }

        if (Array.isArray(chatPrompt.media) && chatPrompt.media.length) {
            if (chatPrompt.mediaDisplay === 'list') {
                for (const media of chatPrompt.media) {
                    await inlineMediaAttachment(media);
                }
            }
            if (chatPrompt.mediaDisplay === 'gallery') {
                const media = chatPrompt.media[chatPrompt.mediaIndex];
                await inlineMediaAttachment(media);
            }
        }

        if (context.canUseTools && Array.isArray(chatPrompt.invocations)) {
            const toolCallMessage = await Message.createAsync(chatMessage.role, undefined, `toolCall-${chatMessage.identifier}`, context.tokenHandler);
            const toolResultMessages = await Promise.all(chatPrompt.invocations.slice().reverse().map(invocation => Message.createAsync('tool', invocation.result || '[No content]', invocation.id, context.tokenHandler)));
            await toolCallMessage.setToolCalls(chatPrompt.invocations);
            if (chatCompletion.canAffordAll([toolCallMessage, ...toolResultMessages])) {
                for (const resultMessage of toolResultMessages) {
                    chatCompletion.insertAtStart(resultMessage, 'chatHistory');
                }
                chatCompletion.insertAtStart(toolCallMessage, 'chatHistory');
            } else {
                break;
            }
            continue;
        }

        if (chatCompletion.canAfford(chatMessage)) {
            chatCompletion.insertAtStart(chatMessage, 'chatHistory');
        } else {
            break;
        }
    }

    chatCompletion.freeBudget(newChatMessage);
    chatCompletion.insertAtStart(newChatMessage, 'chatHistory');

    if (groupNudgeMessage) {
        chatCompletion.freeBudget(groupNudgeMessage);
        chatCompletion.insertAtEnd(groupNudgeMessage, 'chatHistory');
    }

    if (continueMessageCollection) {
        chatCompletion.freeBudget(continueMessageCollection);
        chatCompletion.add(continueMessageCollection, -1);
    }
}

async function preparePromptsForChatCompletion(context) {
    const scenarioText = context.scenario && context.oaiSettings.scenario_format ? substituteParams(context.oaiSettings.scenario_format, context.env, { scenario: context.scenario }) : (context.scenario || '');
    const charPersonalityText = context.charPersonality && context.oaiSettings.personality_format ? substituteParams(context.oaiSettings.personality_format, context.env, { personality: context.charPersonality }) : (context.charPersonality || '');

    const systemPrompts = [
        { role: 'system', content: formatWorldInfo(context.worldInfoBefore, context.oaiSettings.wi_format), identifier: 'worldInfoBefore' },
        { role: 'system', content: formatWorldInfo(context.worldInfoAfter, context.oaiSettings.wi_format), identifier: 'worldInfoAfter' },
        { role: 'system', content: context.charDescription, identifier: 'charDescription' },
        { role: 'system', content: charPersonalityText, identifier: 'charPersonality' },
        { role: 'system', content: scenarioText, identifier: 'scenario' },
        { role: 'system', content: context.oaiSettings.impersonation_prompt ? substituteParams(context.oaiSettings.impersonation_prompt, context.env) : '', identifier: 'impersonate' },
        { role: 'system', content: context.quietPrompt, identifier: 'quietPrompt' },
        { role: 'system', content: context.oaiSettings.group_nudge_prompt ? substituteParams(context.oaiSettings.group_nudge_prompt, context.env) : '', identifier: 'groupNudge' },
        { role: 'assistant', content: context.bias, identifier: 'bias' },
    ];

    const extensionPrompts = context.extensionPrompts || {};
    const summary = extensionPrompts['1_memory'];
    if (summary?.value ?? summary?.resolvedValue) {
        systemPrompts.push({ role: getPromptRole(summary.role), content: summary.value ?? summary.resolvedValue, identifier: 'summary', position: getPromptPosition(summary.position) });
    }

    const authorsNote = extensionPrompts['2_floating_prompt'];
    if (authorsNote?.value ?? authorsNote?.resolvedValue) {
        systemPrompts.push({ role: getPromptRole(authorsNote.role), content: authorsNote.value ?? authorsNote.resolvedValue, identifier: 'authorsNote', position: getPromptPosition(authorsNote.position) });
    }

    const vectorsMemory = extensionPrompts['3_vectors'];
    if (vectorsMemory?.value ?? vectorsMemory?.resolvedValue) {
        systemPrompts.push({ role: 'system', content: vectorsMemory.value ?? vectorsMemory.resolvedValue, identifier: 'vectorsMemory', position: getPromptPosition(vectorsMemory.position) });
    }

    const vectorsDataBank = extensionPrompts['4_vectors_data_bank'];
    if (vectorsDataBank?.value ?? vectorsDataBank?.resolvedValue) {
        systemPrompts.push({ role: getPromptRole(vectorsDataBank.role), content: vectorsDataBank.value ?? vectorsDataBank.resolvedValue, identifier: 'vectorsDataBank', position: getPromptPosition(vectorsDataBank.position) });
    }

    const smartContext = extensionPrompts.chromadb;
    if (smartContext?.value ?? smartContext?.resolvedValue) {
        systemPrompts.push({ role: 'system', content: smartContext.value ?? smartContext.resolvedValue, identifier: 'smartContext', position: getPromptPosition(smartContext.position) });
    }

    if (context.powerUser.persona_description && context.powerUser.persona_description_position === context.personaDescriptionPosition.IN_PROMPT) {
        systemPrompts.push({ role: 'system', content: formatPersonaDescription(context.powerUser.persona_description), identifier: 'personaDescription' });
    }

    const knownExtensionPrompts = new Set(['1_memory', '2_floating_prompt', '3_vectors', '4_vectors_data_bank', 'chromadb', 'PERSONA_DESCRIPTION', 'QUIET_PROMPT', 'DEPTH_PROMPT']);
    for (const [key, prompt] of Object.entries(extensionPrompts)) {
        const promptValue = prompt?.value ?? prompt?.resolvedValue;
        if (knownExtensionPrompts.has(key) || !promptValue) {
            continue;
        }
        if (![extension_prompt_types.BEFORE_PROMPT, extension_prompt_types.IN_PROMPT].includes(prompt.position)) {
            continue;
        }
        systemPrompts.push({
            identifier: key.replace(/\W/g, '_'),
            position: getPromptPosition(prompt.position),
            role: getPromptRole(prompt.role),
            content: promptValue,
            extension: true,
        });
    }

    const prompts = context.promptManager.getPromptCollection(context.type);
    for (const prompt of systemPrompts) {
        const collectionPrompt = prompts.get(prompt.identifier);
        if (collectionPrompt) {
            prompt.injection_position = collectionPrompt.injection_position ?? prompt.injection_position;
            prompt.injection_depth = collectionPrompt.injection_depth ?? prompt.injection_depth;
            prompt.injection_order = collectionPrompt.injection_order ?? prompt.injection_order;
            prompt.role = collectionPrompt.role ?? prompt.role;
        }

        const newPrompt = context.promptManager.preparePrompt(prompt);
        const markerIndex = prompts.index(prompt.identifier);
        if (markerIndex !== -1) {
            prompts.collection[markerIndex] = newPrompt;
        } else {
            prompts.add(newPrompt);
        }
    }

    const systemPrompt = prompts.get('main');
    const systemPromptDisabled = context.promptManager.isPromptDisabledForActiveCharacter('main');
    if (context.systemPromptOverride && systemPrompt && systemPrompt.forbid_overrides !== true && !systemPromptDisabled) {
        const originalContent = systemPrompt.content;
        systemPrompt.content = context.systemPromptOverride;
        prompts.override(context.promptManager.preparePrompt(systemPrompt, originalContent), prompts.index('main'));
    }

    const jailbreakPrompt = prompts.get('jailbreak');
    const jailbreakPromptDisabled = context.promptManager.isPromptDisabledForActiveCharacter('jailbreak');
    if (context.jailbreakPromptOverride && jailbreakPrompt && jailbreakPrompt.forbid_overrides !== true && !jailbreakPromptDisabled) {
        const originalContent = jailbreakPrompt.content;
        jailbreakPrompt.content = context.jailbreakPromptOverride;
        prompts.override(context.promptManager.preparePrompt(jailbreakPrompt, originalContent), prompts.index('jailbreak'));
    }

    return prompts;
}

async function populateChatCompletion(prompts, chatCompletion, context) {
    const addToChatCompletion = async identifier => {
        if (!prompts.has(identifier)) {
            return;
        }

        if (context.promptManager.isPromptDisabledForActiveCharacter(identifier) && identifier !== 'main') {
            return;
        }

        const prompt = prompts.get(identifier);
        if (prompt.injection_position === INJECTION_POSITION.ABSOLUTE) {
            return;
        }

        const message = await Message.fromPromptAsync(prompt, context.tokenHandler);
        const collection = new MessageCollection(identifier);
        collection.add(message);
        chatCompletion.add(collection, prompts.index(identifier));
    };

    chatCompletion.reserveBudget(3);
    await addToChatCompletion('worldInfoBefore');
    chatCompletion.add(new MessageCollection('main'), prompts.index('main'));
    await addToChatCompletion('main');
    await addToChatCompletion('worldInfoAfter');
    await addToChatCompletion('charDescription');
    await addToChatCompletion('charPersonality');
    await addToChatCompletion('scenario');
    await addToChatCompletion('personaDescription');

    const handledPromptIdentifiers = new Set([
        'worldInfoBefore',
        'main',
        'worldInfoAfter',
        'charDescription',
        'charPersonality',
        'scenario',
        'personaDescription',
        'impersonate',
        'quietPrompt',
        'groupNudge',
        'summary',
        'authorsNote',
        'vectorsMemory',
        'vectorsDataBank',
        'smartContext',
        'bias',
    ]);

    const controlPrompts = new MessageCollection('controlPrompts');
    if (prompts.has('impersonate') && context.type === 'impersonate') {
        const impersonateMessage = await Message.fromPromptAsync(prompts.get('impersonate'), context.tokenHandler);
        controlPrompts.add(impersonateMessage);
    }

    if (prompts.has('quietPrompt')) {
        const quietPromptMessage = await Message.fromPromptAsync(prompts.get('quietPrompt'), context.tokenHandler);
        if (context.mediaSupport?.image && context.quietImage) {
            await quietPromptMessage.addImage(resolveMediaUrl(context.quietImage, context.clientOrigin), context.oaiSettings.inline_image_quality || 'auto');
        }
        if (quietPromptMessage?.content) {
            controlPrompts.add(quietPromptMessage);
        }
    }

    chatCompletion.reserveBudget(controlPrompts);

    if (context.type === 'continue' && context.oaiSettings.continue_prefill && context.messages.length) {
        const chatMessage = context.messages[0];
        const isAssistantRole = chatMessage.role === 'assistant';
        const supportsAssistantPrefill = context.chatCompletionSource === 'claude';
        const namesInCompletion = context.serviceSettings.names_behavior === character_names_behavior.COMPLETION;
        const assistantPrefill = isAssistantRole && supportsAssistantPrefill ? substituteParams(context.oaiSettings.assistant_prefill, context.env) : '';
        const messageContent = [assistantPrefill, chatMessage.content].filter(Boolean).join('\n\n');
        const continueMessage = await Message.createAsync(chatMessage.role, messageContent, 'continuePrefill', context.tokenHandler);
        if (chatMessage.name && namesInCompletion) {
            await continueMessage.setName(context.promptManager.sanitizeName(chatMessage.name));
        }
        if (chatCompletion.canAfford(continueMessage)) {
            controlPrompts.add(continueMessage);
            chatCompletion.reserveBudget(continueMessage);
            context.messages = context.messages.slice(1);
        }
    }

    const dynamicPromptIdentifiers = prompts.collection
        .filter(prompt => !prompt.system_prompt)
        .filter(prompt => prompt.injection_position !== INJECTION_POSITION.ABSOLUTE)
        .filter(prompt => !prompt.position)
        .filter(prompt => !handledPromptIdentifiers.has(prompt.identifier))
        .map(prompt => prompt.identifier);

    for (const identifier of ['nsfw', 'jailbreak', ...dynamicPromptIdentifiers]) {
        await addToChatCompletion(identifier);
    }

    if (prompts.has('enhanceDefinitions')) {
        await addToChatCompletion('enhanceDefinitions');
    }

    if (context.bias?.trim()) {
        await addToChatCompletion('bias');
    }

    for (const identifier of ['summary', 'authorsNote', 'vectorsMemory', 'vectorsDataBank', 'smartContext']) {
        const prompt = prompts.get(identifier);
        if (prompt?.position) {
            const message = await Message.fromPromptAsync(prompt, context.tokenHandler);
            chatCompletion.insert(message, 'main', prompt.position);
        }
    }

    for (const prompt of prompts.collection.filter(prompt => prompt.extension && prompt.position)) {
        const message = await Message.fromPromptAsync(prompt, context.tokenHandler);
        chatCompletion.insert(message, 'main', prompt.position);
    }

    if (context.toolBudgetData) {
        const toolMessage = [{ role: 'user', content: JSON.stringify(context.toolBudgetData) }];
        const toolTokens = await context.tokenHandler.countAsync(toolMessage);
        chatCompletion.reserveBudget(toolTokens);
    }

    context.messages = await populationInjectionPrompts(prompts.collection.filter(prompt => prompt.injection_position === INJECTION_POSITION.ABSOLUTE), context.messages.slice(), context.extensionPrompts, context.env);

    if (context.powerUser.pin_examples) {
        await populateDialogueExamples(prompts, chatCompletion, context.messageExamples, context);
        await populateChatHistory(context.messages, prompts, chatCompletion, context);
    } else {
        await populateChatHistory(context.messages, prompts, chatCompletion, context);
        await populateDialogueExamples(prompts, chatCompletion, context.messageExamples, context);
    }

    if (controlPrompts.collection.length) {
        chatCompletion.freeBudget(controlPrompts);
        chatCompletion.add(controlPrompts);
    }
}

export async function assembleChatCompletionPrompt(payload = {}) {
    const model = payload.model || '';
    const groupNames = Array.isArray(payload.groupNames) ? payload.groupNames.filter(Boolean) : [];
    const groupMacroValues = payload.groupMacroValues || {};
    const normalizedMesExamples = normalizeMessageExamples(payload.mesExamples);
    const env = {
        user: payload.userName || '',
        char: payload.charName || '',
        group: groupMacroValues.group || (groupNames.length ? groupNames.join(', ') : (payload.charName || '')),
        charIfNotGroup: groupMacroValues.charIfNotGroup || groupMacroValues.group || (groupNames.length ? groupNames.join(', ') : (payload.charName || '')),
        groupNotMuted: groupMacroValues.groupNotMuted || (groupNames.length ? groupNames.join(', ') : (payload.charName || '')),
        notChar: groupMacroValues.notChar || payload.userName || '',
        description: payload.charDescription || '',
        personality: payload.charPersonality || '',
        scenario: payload.scenario || '',
        persona: payload.persona || '',
        mesExamples: normalizedMesExamples,
        mesExamplesRaw: payload.mesExamples || '',
        charDepthPrompt: payload.charDepthPrompt || '',
        creatorNotes: payload.creatorNotes || '',
        charPrompt: payload.systemPromptOverride || '',
        charInstruction: payload.jailbreakPromptOverride || '',
        charJailbreak: payload.jailbreakPromptOverride || '',
        model,
    };

    const rawExtensionPrompts = mergeExtensionPromptSources(
        payload.promptState || {},
        payload.extensionPrompts || {},
        payload.quietPrompt,
    );
    const resolvedExtensionPrompts = resolvePromptValues(rawExtensionPrompts, env);

    const tokenHandler = new TokenHandler(model);
    const promptManager = new PromptManagerCore({
        serviceSettings: payload.serviceSettings || {},
        activeCharacter: payload.activeCharacter || null,
        env,
    });

    const context = {
        ...payload,
        env,
        macroState: createMacroState(payload.macroSnapshot || {}, resolvedExtensionPrompts),
        tokenHandler,
        promptManager,
        serviceSettings: payload.serviceSettings || {},
        oaiSettings: payload.oaiSettings || {},
        powerUser: payload.powerUser || {},
        extensionPrompts: resolvedExtensionPrompts,
        messages: Array.isArray(payload.messages) ? structuredClone(payload.messages) : [],
        messageExamples: Array.isArray(payload.messageExamples) ? structuredClone(payload.messageExamples) : [],
        canUseTools: Boolean(payload.canUseTools),
        toolBudgetData: payload.toolBudgetData || null,
        personaDescriptionPosition: payload.personaDescriptionPosition || { IN_PROMPT: 0 },
    };
    context.env.__macroState = context.macroState;

    const chatCompletion = new ChatCompletion(tokenHandler);
    chatCompletion.setTokenBudget(Number(context.serviceSettings.openai_max_context) || 0, Number(context.serviceSettings.openai_max_tokens) || 0);

    await applyWorldInfoToContext(context);
    const prompts = await preparePromptsForChatCompletion(context);
    await populateChatCompletion(prompts, chatCompletion, context);

    const itemization = payload.includeItemization
        ? buildPromptItemization(chatCompletion.getMessages(), context.serviceSettings)
        : null;

    if (context.oaiSettings.squash_system_messages) {
        await chatCompletion.squashSystemMessages();
    }

    const chat = chatCompletion.getChat();
    const messagesCount = chat.filter(message => !message?.tool_calls && ['user', 'assistant', 'tool'].includes(message?.role)).length || 0;
    const examplesCount = Array.isArray(context.messageExamples) ? context.messageExamples.length : 0;

    return {
        chat,
        counts: itemization ? structuredClone(itemization) : false,
        itemization,
        messagesCount,
        examplesCount,
        overriddenPrompts: prompts.overriddenPrompts,
        messagesState: serializeMessageNode(chatCompletion.getMessages()),
        timedWorldInfo: structuredClone(context.worldInfoTimedState || context.worldInfoRequest?.timedWorldInfo || {}),
        worldInfoOverflowed: Boolean(context.worldInfoOverflowed),
    };
}
