import {
    countWebTokenizerTokens,
    getSentencepiceTokenizer,
    getTiktokenTokenizer,
    getTokenizerModel,
    getWebTokenizer,
} from '../endpoints/tokenizers.js';

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

    static fromPromptAsync(prompt, tokenHandler) {
        return Message.createAsync(prompt.role, prompt.content, prompt.identifier, tokenHandler);
    }

    async setName(name) {
        this.name = name;
        this.tokens = await this.tokenHandler.countAsync({ role: this.role, content: this.content, name: this.name });
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
        this.tokens = await this.tokenHandler.countAsync({ role: this.role, tool_calls: JSON.stringify(this.tool_calls) });
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
        return this.messages.collection.findIndex(item => item?.identifier === identifier);
    }

    checkTokenBudget(message, identifier) {
        if (!this.canAfford(message)) {
            throw new Error(`Token budget exceeded. Message: ${identifier}`);
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

function substituteParams(content, env = {}, additional = {}) {
    if (!content) {
        return '';
    }

    const values = { ...env, ...additional };
    return String(content).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => {
        const value = values[key];
        if (value === undefined || value === null) {
            return match;
        }
        return typeof value === 'function' ? value() : String(value);
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
    const prompts = Object.keys(extensionPrompts)
        .sort()
        .map(key => extensionPrompts[key])
        .filter(prompt => prompt?.position === position && prompt?.value)
        .filter(prompt => depth === undefined || prompt.depth === undefined || prompt.depth === depth)
        .filter(prompt => role === undefined || prompt.role === undefined || prompt.role === role);

    let values = prompts.map(prompt => String(prompt.value).trim()).join(separator);
    if (wrap && values.length && !values.startsWith(separator)) {
        values = separator + values;
    }
    if (wrap && values.length && !values.endsWith(separator)) {
        values += separator;
    }
    return values.length ? substituteParams(values, env) : values;
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
            const chatMessage = await Message.fromPromptAsync(new Prompt(continueMessage), context.tokenHandler);
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
    for (let index = 0; index < chatPool.length; index++) {
        const chatPrompt = chatPool[index];
        const prompt = new Prompt(chatPrompt);
        prompt.identifier = `chatHistory-${messages.length - index}`;
        const chatMessage = await Message.fromPromptAsync(prompt, context.tokenHandler);

        if (context.serviceSettings.names_behavior === character_names_behavior.COMPLETION && prompt.name) {
            const messageName = context.promptManager.isValidName(prompt.name) ? prompt.name : context.promptManager.sanitizeName(prompt.name);
            await chatMessage.setName(messageName);
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
    if (summary?.value) {
        systemPrompts.push({ role: getPromptRole(summary.role), content: summary.value, identifier: 'summary', position: getPromptPosition(summary.position) });
    }

    const authorsNote = extensionPrompts['2_floating_prompt'];
    if (authorsNote?.value) {
        systemPrompts.push({ role: getPromptRole(authorsNote.role), content: authorsNote.value, identifier: 'authorsNote', position: getPromptPosition(authorsNote.position) });
    }

    const vectorsMemory = extensionPrompts['3_vectors'];
    if (vectorsMemory?.value) {
        systemPrompts.push({ role: 'system', content: vectorsMemory.value, identifier: 'vectorsMemory', position: getPromptPosition(vectorsMemory.position) });
    }

    const vectorsDataBank = extensionPrompts['4_vectors_data_bank'];
    if (vectorsDataBank?.value) {
        systemPrompts.push({ role: getPromptRole(vectorsDataBank.role), content: vectorsDataBank.value, identifier: 'vectorsDataBank', position: getPromptPosition(vectorsDataBank.position) });
    }

    const smartContext = extensionPrompts.chromadb;
    if (smartContext?.value) {
        systemPrompts.push({ role: 'system', content: smartContext.value, identifier: 'smartContext', position: getPromptPosition(smartContext.position) });
    }

    if (context.powerUser.persona_description && context.powerUser.persona_description_position === context.personaDescriptionPosition.IN_PROMPT) {
        systemPrompts.push({ role: 'system', content: context.powerUser.persona_description, identifier: 'personaDescription' });
    }

    const knownExtensionPrompts = new Set(['1_memory', '2_floating_prompt', '3_vectors', '4_vectors_data_bank', 'chromadb', 'PERSONA_DESCRIPTION', 'QUIET_PROMPT', 'DEPTH_PROMPT']);
    for (const [key, prompt] of Object.entries(extensionPrompts)) {
        if (knownExtensionPrompts.has(key) || !prompt?.value) {
            continue;
        }
        if (![extension_prompt_types.BEFORE_PROMPT, extension_prompt_types.IN_PROMPT].includes(prompt.position)) {
            continue;
        }
        systemPrompts.push({
            identifier: key.replace(/\W/g, '_'),
            position: getPromptPosition(prompt.position),
            role: getPromptRole(prompt.role),
            content: prompt.value,
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

    const controlPrompts = new MessageCollection('controlPrompts');
    if (prompts.has('impersonate') && context.type === 'impersonate') {
        const impersonateMessage = await Message.fromPromptAsync(prompts.get('impersonate'), context.tokenHandler);
        controlPrompts.add(impersonateMessage);
    }

    if (prompts.has('quietPrompt')) {
        const quietPromptMessage = await Message.fromPromptAsync(prompts.get('quietPrompt'), context.tokenHandler);
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
        controlPrompts.add(continueMessage);
        chatCompletion.reserveBudget(continueMessage);
        context.messages = context.messages.slice(1);
    }

    for (const identifier of ['nsfw', 'jailbreak', ...prompts.collection.filter(prompt => !prompt.system_prompt && prompt.injection_position !== INJECTION_POSITION.ABSOLUTE).map(prompt => prompt.identifier)]) {
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
    const env = {
        user: payload.userName || '',
        char: payload.charName || '',
        group: groupNames.length ? groupNames.join(', ') : (payload.charName || ''),
        charIfNotGroup: groupNames.length ? groupNames.join(', ') : (payload.charName || ''),
        groupNotMuted: groupNames.length ? groupNames.join(', ') : (payload.charName || ''),
        notChar: payload.userName || '',
        description: payload.charDescription || '',
        personality: payload.charPersonality || '',
        scenario: payload.scenario || '',
        persona: payload.persona || '',
        mesExamples: payload.mesExamples || '',
        mesExamplesRaw: payload.mesExamples || '',
        charDepthPrompt: payload.charDepthPrompt || '',
        creatorNotes: payload.creatorNotes || '',
        charPrompt: payload.systemPromptOverride || '',
        charInstruction: payload.jailbreakPromptOverride || '',
        charJailbreak: payload.jailbreakPromptOverride || '',
        model,
    };

    const tokenHandler = new TokenHandler(model);
    const promptManager = new PromptManagerCore({
        serviceSettings: payload.serviceSettings || {},
        activeCharacter: payload.activeCharacter || null,
        env,
    });

    const context = {
        ...payload,
        env,
        tokenHandler,
        promptManager,
        serviceSettings: payload.serviceSettings || {},
        oaiSettings: payload.oaiSettings || {},
        powerUser: payload.powerUser || {},
        extensionPrompts: payload.extensionPrompts || {},
        messages: Array.isArray(payload.messages) ? structuredClone(payload.messages) : [],
        messageExamples: Array.isArray(payload.messageExamples) ? structuredClone(payload.messageExamples) : [],
        canUseTools: Boolean(payload.canUseTools),
        toolBudgetData: payload.toolBudgetData || null,
        personaDescriptionPosition: payload.personaDescriptionPosition || { IN_PROMPT: 0 },
    };

    const chatCompletion = new ChatCompletion(tokenHandler);
    chatCompletion.setTokenBudget(Number(context.serviceSettings.openai_max_context) || 0, Number(context.serviceSettings.openai_max_tokens) || 0);

    const prompts = await preparePromptsForChatCompletion(context);
    await populateChatCompletion(prompts, chatCompletion, context);

    if (context.oaiSettings.squash_system_messages) {
        await chatCompletion.squashSystemMessages();
    }

    const chat = chatCompletion.getChat();
    const messagesCount = chat.filter(message => !message?.tool_calls && ['user', 'assistant', 'tool'].includes(message?.role)).length || 0;

    return {
        chat,
        counts: false,
        messagesCount,
        overriddenPrompts: prompts.overriddenPrompts,
    };
}
