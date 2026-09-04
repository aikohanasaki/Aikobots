import {
    countBotDryRunTokens,
    countWebTokenizerTokens,
    getSentencepieceTokenizer,
    getTiktokenTokenizer,
    getTokenizerModel,
    getWebTokenizer,
} from '../endpoints/tokenizers.js';

const world_info_logic = {
    AND_ANY: 0,
    NOT_ALL: 1,
    NOT_ANY: 2,
    AND_ALL: 3,
};

const scan_state = {
    NONE: 0,
    INITIAL: 1,
    RECURSION: 2,
    MIN_ACTIVATIONS: 3,
};

const DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;
const MAX_SCAN_DEPTH = 1000;
const DEFAULT_GLOBAL_SCAN_DATA = Object.freeze({
    trigger: 'normal',
    personaDescription: '',
    characterDescription: '',
    characterPersonality: '',
    characterDepthPrompt: '',
    scenario: '',
    creatorNotes: '',
});

function escapeRegex(string) {
    return String(string || '').replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

function parseRegexFromString(input) {
    const match = String(input || '').match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }

    let [, pattern, flags] = match;
    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }

    pattern = pattern.replace(/\\\//g, '/');

    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

function estimateTokenCount(value) {
    if (!value) {
        return 0;
    }

    return Math.ceil(String(value).length / 3.35);
}

async function countSentencepieceArrayTokens(tokenizer, array) {
    const instance = await tokenizer?.get();
    const fallbackBody = JSON.stringify(array);
    if (!instance) {
        return Math.ceil(fallbackBody.length / 3.35);
    }
    try {
        const jsonBody = array.flatMap(item => Object.values(item)).join('\n\n');
        return instance.encodeIds(jsonBody).length;
    } catch (error) {
        console.warn('World info sentencepiece token count failed, using fallback estimate.', {
            message: error?.message || String(error),
        });
        return Math.ceil(fallbackBody.length / 3.35);
    }
}

async function countTokensOpenAIAsync(messages, model, full = false) {
    if (String(model || '') === 'o200k_base') {
        const count = countBotDryRunTokens(messages);
        return full ? count : Math.max(0, count - 3);
    }

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
        return countSentencepieceArrayTokens(getSentencepieceTokenizer(sentencepieceModel), messageArray);
    }

    let tokenCount = 0;
    const tokenizer = getTiktokenTokenizer(tokenizerModel);
    if (!tokenizer) {
        throw new Error(`Failed to load tokenizer: ${tokenizerModel}`);
    }
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

            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
            tokenCount += tokenizer.encode(stringValue).length;
            if (key === 'name') {
                tokenCount += tokensPerName;
            }
        }
    }

    if (full) {
        tokenCount += tokensPadding;
    }

    return tokenCount;
}

async function countWorldInfoTokens(value, payload = {}, cache = new Map()) {
    if (!value) {
        return 0;
    }

    const tokenizerModel = String(payload.tokenizerModel || '');
    const cacheKey = `${tokenizerModel}\u0000${value}`;
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }

    let tokenCount = 0;
    if (tokenizerModel) {
        tokenCount = await countTokensOpenAIAsync({ role: 'system', content: String(value) }, tokenizerModel, true);
    } else {
        tokenCount = estimateTokenCount(value);
    }

    cache.set(cacheKey, tokenCount);
    return tokenCount;
}

async function primeWorldInfoTokenCounts(values, payload = {}, cache = new Map()) {
    const tokenizerModel = String(payload.tokenizerModel || '');
    const uncachedValues = [...new Set(
        (Array.isArray(values) ? values : [])
            .filter(Boolean)
            .map(value => String(value)),
    )].filter(value => !cache.has(`${tokenizerModel}\u0000${value}`));

    if (!uncachedValues.length) {
        return;
    }

    await Promise.all(uncachedValues.map(value => countWorldInfoTokens(value, payload, cache)));
}

function calculateLorebookBudget(settings = {}, totalBudget = 0, maxContext = 0) {
    const budgetMode = String(settings?.budgetMode || 'default').trim().toLowerCase();
    const budgetValue = Number(settings?.budget);

    if (!Number.isFinite(budgetValue) || budgetValue <= 0) {
        return 0;
    }

    switch (budgetMode) {
        case 'percentage_context':
            return Math.floor((budgetValue / 100) * (Number(maxContext) || 0));
        case 'percentage_budget':
            return Math.floor((budgetValue / 100) * (Number(totalBudget) || 0));
        case 'fixed':
            return Math.floor(budgetValue);
        default:
            return 0;
    }
}

function shuffleInPlace(arr = []) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
}

async function buildRandomTrimDropSet(newEntries, payload, tokenCountCache, lorebookBudgets, lorebookActivatedText) {
    const byWorld = new Map();

    for (const entry of newEntries) {
        if (!entry?.world || entry.ignoreBudget || entry.activationOnly || !entry.lorebookSettings?.randomTrim) {
            continue;
        }

        const lorebookBudget = lorebookBudgets.get(entry.world) || 0;
        if (!(lorebookBudget > 0)) {
            continue;
        }

        if (!byWorld.has(entry.world)) {
            byWorld.set(entry.world, []);
        }

        byWorld.get(entry.world).push(entry);
    }

    await primeWorldInfoTokenCounts([
        ...Array.from(byWorld.keys(), world => lorebookActivatedText.get(world) || ''),
        ...Array.from(byWorld.values()).flatMap(entries => entries.map(entry => `${entry.content}\n`)),
    ], payload, tokenCountCache);

    const dropSet = new Set();
    for (const [world, entries] of byWorld.entries()) {
        const lorebookBudget = lorebookBudgets.get(world) || 0;
        const existingText = lorebookActivatedText.get(world) || '';
        let usedTokens = existingText
            ? await countWorldInfoTokens(existingText, payload, tokenCountCache)
            : 0;

        const shuffledEntries = shuffleInPlace(entries.slice());
        for (const entry of shuffledEntries) {
            const entryKey = `${entry.world}.${entry.uid}`;
            const entryTokens = await countWorldInfoTokens(`${entry.content}\n`, payload, tokenCountCache);
            if ((usedTokens + entryTokens) >= lorebookBudget) {
                dropSet.add(entryKey);
                continue;
            }

            usedTokens += entryTokens;
        }
    }

    return dropSet;
}

function getWorldInfoEntryKey(entry = {}) {
    return `${entry?.world ?? ''}.${entry?.uid ?? ''}`;
}

function getScanStateLabel(scanState) {
    switch (scanState) {
        case scan_state.INITIAL:
            return 'initial';
        case scan_state.RECURSION:
            return 'recursion';
        case scan_state.MIN_ACTIVATIONS:
            return 'min_activations';
        default:
            return 'none';
    }
}

function getWorldInfoPlacement(entry = {}, payload = {}) {
    const worldInfoPosition = payload.worldInfoPosition || {};

    switch (entry.position) {
        case worldInfoPosition.before:
            return 'before';
        case worldInfoPosition.after:
            return 'after';
        case worldInfoPosition.EMTop:
            return 'example_before';
        case worldInfoPosition.EMBottom:
            return 'example_after';
        case worldInfoPosition.ANTop:
            return 'authors_note_before';
        case worldInfoPosition.ANBottom:
            return 'authors_note_after';
        case worldInfoPosition.atDepth:
            return `depth:${entry.depth ?? DEFAULT_DEPTH}:${entry.role ?? 0}`;
        case worldInfoPosition.outlet:
            return entry.outletName ? `outlet:${entry.outletName}` : 'outlet';
        default:
            return 'unknown';
    }
}

function compareWorldInfoDebugEntries(a, b) {
    return (Number(a.decisionIndex) || 0) - (Number(b.decisionIndex) || 0)
        || (Number(a.activationIndex) || 0) - (Number(b.activationIndex) || 0)
        || (Number(a.roundIndex) || 0) - (Number(b.roundIndex) || 0)
        || (Number(b.order) || 0) - (Number(a.order) || 0)
        || String(a.key || '').localeCompare(String(b.key || ''));
}

function getWorldInfoDropReason(status) {
    return typeof status === 'string' && status.startsWith('dropped_')
        ? status.slice('dropped_'.length)
        : null;
}

function buildWorldInfoRounds(entries = []) {
    const rounds = new Map();

    for (const entry of entries) {
        const roundIndex = Number(entry?.roundIndex ?? 0) || 0;
        const scanState = entry?.scanState ?? null;
        const round = rounds.get(roundIndex) || {
            roundIndex,
            scanState,
            entries: [],
        };

        if (!round.scanState && scanState) {
            round.scanState = scanState;
        }

        round.entries.push(entry);
        rounds.set(roundIndex, round);
    }

    return Array.from(rounds.values())
        .sort((a, b) => a.roundIndex - b.roundIndex || String(a.scanState || '').localeCompare(String(b.scanState || '')))
        .map(round => ({
            ...round,
            admittedEntries: round.entries.filter(entry => entry.status === 'admitted').length,
            droppedEntries: round.entries.filter(entry => entry.status !== 'admitted').length,
        }));
}

async function buildWorldInfoDebugSummary(entryDebugMap, payload, tokenCountCache, budget, lorebookBudgets, lorebookActivatedText, timedState, overflowed) {
    const entryDebugList = Array.from(entryDebugMap.values());
    const uniqueContents = entryDebugList
        .map(item => item?.entry?.content ? `${item.entry.content}\n` : '')
        .filter(Boolean);
    await primeWorldInfoTokenCounts(uniqueContents, payload, tokenCountCache);

    const activatedEntries = await Promise.all(entryDebugList.map(async item => {
        const entry = item.entry || {};
        const content = entry.content ? `${entry.content}\n` : '';
        const activationOnly = Boolean(entry.activationOnly);
        const admitted = item.status === 'admitted';
        const inserted = admitted && !activationOnly;

        return {
            key: getWorldInfoEntryKey(entry),
            book: entry.world ?? null,
            lorebookSource: entry.lorebookSource,
            uid: entry.uid ?? null,
            storage: entry.storage === 'secure' ? 'secure' : 'user',
            ownerHandle: String(entry.ownerHandle || ''),
            ownerHandles: Array.isArray(entry.ownerHandles) ? entry.ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean) : [],
            displayName: entry.comment ?? entry.displayName ?? entry.name ?? null,
            comment: entry.comment ?? null,
            content: entry.content ?? '',
            displayContent: entry.content ?? '',
            hidden: false,
            placement: getWorldInfoPlacement(entry, payload),
            order: Number(entry.order ?? 0),
            role: entry.role ?? null,
            depth: entry.depth ?? null,
            outletName: entry.outletName ?? null,
            activationSource: item.activationSource ?? null,
            activationReason: item.activationReason ?? null,
            matchedPrimaryKey: item.matchedPrimaryKey ?? null,
            matchedSecondaryKeys: Array.isArray(item.matchedSecondaryKeys) ? item.matchedSecondaryKeys : [],
            scanState: item.scanState ?? null,
            roundIndex: Number(item.roundIndex ?? 0) || 0,
            status: item.status ?? 'candidate',
            dropReason: getWorldInfoDropReason(item.status),
            probability: entry.useProbability ? Number(entry.probability ?? 0) : null,
            ignoreBudget: Boolean(entry.ignoreBudget),
            vectorized: Boolean(entry.vectorized),
            activationOnly,
            inserted,
            notInsertedReason: admitted && activationOnly ? 'activation_only' : null,
            preventRecursion: Boolean(entry.preventRecursion),
            tokens: content ? await countWorldInfoTokens(content, payload, tokenCountCache) : 0,
            activationIndex: Number(item.activationIndex ?? 0),
            decisionIndex: Number(item.decisionIndex ?? 0),
        };
    }));

    activatedEntries.sort(compareWorldInfoDebugEntries);

    const admittedEntries = activatedEntries.filter(entry => entry.status === 'admitted');
    const insertedEntries = admittedEntries.filter(entry => entry.inserted !== false);
    const lorebookUsage = await Promise.all(Array.from(lorebookBudgets.entries()).map(async ([book, limit]) => {
        const text = lorebookActivatedText.get(book) || '';
        const used = text ? await countWorldInfoTokens(text, payload, tokenCountCache) : 0;
        return { book, used, limit };
    }));
    lorebookUsage.sort((a, b) => String(a.book).localeCompare(String(b.book)));

    const globalUsedText = insertedEntries.map(entry => entry.content).filter(Boolean).join('\n');
    const globalUsed = globalUsedText ? await countWorldInfoTokens(globalUsedText, payload, tokenCountCache) : 0;

    return {
        activatedEntries,
        beforeEntries: insertedEntries.filter(entry => entry.placement === 'before'),
        afterEntries: insertedEntries.filter(entry => entry.placement === 'after'),
        depthEntries: insertedEntries.filter(entry => entry.placement.startsWith('depth:')),
        exampleEntries: insertedEntries.filter(entry => entry.placement.startsWith('example_')),
        timedState: structuredClone(timedState || {}),
        overflowed: Boolean(overflowed),
        rounds: buildWorldInfoRounds(activatedEntries),
        budgetUsed: {
            global: {
                used: globalUsed,
                limit: Number(budget) || 0,
            },
            lorebooks: lorebookUsage,
        },
    };
}

function buildWorldInfoSegmentEntry(entry = {}, payload = {}, debugItem = null) {
    const activationOnly = Boolean(entry.activationOnly);
    return {
        text: activationOnly ? '' : String(entry.content ?? ''),
        storage: entry.storage === 'secure' ? 'secure' : 'user',
        ownerHandle: String(entry.ownerHandle || ''),
        ownerHandles: Array.isArray(entry.ownerHandles) ? entry.ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean) : [],
        book: entry.world ?? null,
        uid: entry.uid ?? null,
        placement: getWorldInfoPlacement(entry, payload),
        roundIndex: Number(debugItem?.roundIndex ?? 0) || 0,
        status: debugItem?.status ?? 'admitted',
        activationOnly,
        inserted: !activationOnly,
        notInsertedReason: activationOnly ? 'activation_only' : null,
    };
}

class WorldInfoBuffer {
    #settings = null;
    #globalScanData = null;
    #depthBuffer = [];
    #recurseBuffer = [];
    #injectBuffer = [];
    #forcedActivations = new Map();
    #skew = 0;

    constructor(messages, globalScanData, injects, settings, forcedActivations = []) {
        this.#settings = settings;
        this.#globalScanData = globalScanData;
        this.#injectBuffer = Array.isArray(injects) ? injects.filter(Boolean) : [];
        this.#forcedActivations = new Map(
            (Array.isArray(forcedActivations) ? forcedActivations : [])
                .filter(entry => entry && entry.world !== undefined && entry.uid !== undefined)
                .map(entry => [`${entry.world}.${entry.uid}`, structuredClone(entry)]),
        );

        for (let depth = 0; depth < MAX_SCAN_DEPTH; depth++) {
            if (messages[depth]) {
                this.#depthBuffer[depth] = String(messages[depth]).trim();
            }
            if (depth === messages.length - 1) {
                break;
            }
        }
    }

    #transformString(str, entry) {
        const caseSensitive = entry.caseSensitive ?? this.#settings.world_info_case_sensitive;
        return caseSensitive ? String(str || '') : String(str || '').toLowerCase();
    }

    get(entry, scanState) {
        let depth = entry.scanDepth ?? this.getDepth();
        if (depth <= 0) {
            return '';
        }

        if (depth > MAX_SCAN_DEPTH) {
            depth = MAX_SCAN_DEPTH;
        }

        const matcher = '\x01';
        const joiner = '\n' + matcher;
        let result = matcher + this.#depthBuffer.slice(0, depth).join(joiner);

        if (entry.matchPersonaDescription && this.#globalScanData.personaDescription) {
            result += joiner + this.#globalScanData.personaDescription;
        }
        if (entry.matchCharacterDescription && this.#globalScanData.characterDescription) {
            result += joiner + this.#globalScanData.characterDescription;
        }
        if (entry.matchCharacterPersonality && this.#globalScanData.characterPersonality) {
            result += joiner + this.#globalScanData.characterPersonality;
        }
        if (entry.matchCharacterDepthPrompt && this.#globalScanData.characterDepthPrompt) {
            result += joiner + this.#globalScanData.characterDepthPrompt;
        }
        if (entry.matchScenario && this.#globalScanData.scenario) {
            result += joiner + this.#globalScanData.scenario;
        }
        if (entry.matchCreatorNotes && this.#globalScanData.creatorNotes) {
            result += joiner + this.#globalScanData.creatorNotes;
        }
        if (this.#injectBuffer.length > 0) {
            result += joiner + this.#injectBuffer.join(joiner);
        }
        if (this.#recurseBuffer.length > 0 && scanState !== scan_state.MIN_ACTIVATIONS) {
            result += joiner + this.#recurseBuffer.join(joiner);
        }

        return result;
    }

    matchKeys(haystack, needle, entry) {
        const keyRegex = parseRegexFromString(needle);
        if (keyRegex) {
            return keyRegex.test(haystack);
        }

        haystack = this.#transformString(haystack, entry);
        const transformedString = this.#transformString(needle, entry);
        const matchWholeWords = entry.matchWholeWords ?? this.#settings.world_info_match_whole_words;

        if (matchWholeWords) {
            const keyWords = transformedString.split(/\s+/);
            if (keyWords.length > 1) {
                return haystack.includes(transformedString);
            }

            const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedString)})(?:$|\\W)`);
            return regex.test(haystack);
        }

        return haystack.includes(transformedString);
    }

    addRecurse(message) {
        this.#recurseBuffer.push(message);
    }

    hasRecurse() {
        return this.#recurseBuffer.length > 0;
    }

    getExternallyActivated(entry) {
        return this.#forcedActivations.get(`${entry.world}.${entry.uid}`);
    }

    advanceScan() {
        this.#skew++;
    }

    getDepth() {
        return Number(this.#settings.world_info_depth) + this.#skew;
    }

    getScore(entry, scanState) {
        const bufferState = this.get(entry, scanState);
        let numberOfPrimaryKeys = 0;
        let numberOfSecondaryKeys = 0;
        let primaryScore = 0;
        let secondaryScore = 0;

        if (Array.isArray(entry.key)) {
            numberOfPrimaryKeys = entry.key.length;
            for (const key of entry.key) {
                if (this.matchKeys(bufferState, key, entry)) {
                    primaryScore++;
                }
            }
        }

        if (Array.isArray(entry.keysecondary)) {
            numberOfSecondaryKeys = entry.keysecondary.length;
            for (const key of entry.keysecondary) {
                if (this.matchKeys(bufferState, key, entry)) {
                    secondaryScore++;
                }
            }
        }

        if (!numberOfPrimaryKeys) {
            return 0;
        }

        if (numberOfSecondaryKeys > 0) {
            switch (entry.selectiveLogic) {
                case world_info_logic.AND_ANY:
                    return primaryScore + secondaryScore;
                case world_info_logic.AND_ALL:
                    return secondaryScore === numberOfSecondaryKeys ? primaryScore + secondaryScore : primaryScore;
            }
        }

        return primaryScore;
    }
}

class WorldInfoTimedEffects {
    #chatLength = 0;
    #entries = [];
    #isDryRun = false;
    #timedWorldInfo = null;
    #buffer = {
        sticky: [],
        cooldown: [],
        delay: [],
    };

    constructor(chatLength, entries, timedWorldInfo, isDryRun = false) {
        this.#chatLength = chatLength;
        this.#entries = entries;
        this.#timedWorldInfo = timedWorldInfo && typeof timedWorldInfo === 'object' ? timedWorldInfo : {};
        this.#isDryRun = isDryRun;
        this.#ensureTimedWorldInfo();
    }

    #ensureTimedWorldInfo() {
        if (!this.#timedWorldInfo.sticky || typeof this.#timedWorldInfo.sticky !== 'object') {
            this.#timedWorldInfo.sticky = {};
        }
        if (!this.#timedWorldInfo.cooldown || typeof this.#timedWorldInfo.cooldown !== 'object') {
            this.#timedWorldInfo.cooldown = {};
        }
    }

    #getEntryHash(entry) {
        return entry.hash;
    }

    #getEntryName(entry) {
        const value = entry?.comment ?? entry?.displayName ?? entry?.name ?? entry?.uid ?? '';
        return String(value || '').trim();
    }

    #getEntryKey(entry) {
        return `${String(entry?.world ?? entry?.book ?? '').trim()}::${this.#getEntryName(entry)}`;
    }

    #findEntryForEffect(key, effect) {
        const canonicalKey = this.#getEntryKey(effect);
        if (canonicalKey && canonicalKey !== '::') {
            const entry = this.#entries.find(item => this.#getEntryKey(item) === canonicalKey);
            if (entry) {
                return entry;
            }
        }

        if (effect?.hash !== undefined && effect?.hash !== null) {
            const entry = this.#entries.find(item => String(this.#getEntryHash(item)) === String(effect.hash));
            if (entry) {
                return entry;
            }
        }

        return this.#entries.find(item => this.#getEntryKey(item) === String(key || '').trim()) ?? null;
    }

    #getEntryTimedEffect(type, entry, isProtected) {
        return {
            book: String(entry?.world ?? '').trim(),
            name: this.#getEntryName(entry),
            start: this.#chatLength,
            end: this.#chatLength + Number(entry[type]),
            protected: !!isProtected,
        };
    }

    #checkTimedEffectOfType(type, buffer, onEnded) {
        const effects = Object.entries(this.#timedWorldInfo[type] || {});
        for (const [key, value] of effects) {
            const entry = this.#findEntryForEffect(key, value);
            const canonicalKey = entry ? this.#getEntryKey(entry) : null;

            if (entry && canonicalKey && canonicalKey !== key) {
                this.#timedWorldInfo[type][canonicalKey] = {
                    ...value,
                    book: String(entry?.world ?? value?.book ?? '').trim(),
                    name: this.#getEntryName(entry),
                };
                delete this.#timedWorldInfo[type][key];
            }

            if (this.#chatLength <= Number(value?.start) && !value?.protected) {
                delete this.#timedWorldInfo[type][canonicalKey ?? key];
                continue;
            }

            if (!entry) {
                if (this.#chatLength >= Number(value?.end)) {
                    delete this.#timedWorldInfo[type][key];
                }
                continue;
            }

            if (!entry[type]) {
                delete this.#timedWorldInfo[type][canonicalKey ?? key];
                continue;
            }

            if (this.#chatLength >= Number(value?.end)) {
                delete this.#timedWorldInfo[type][canonicalKey ?? key];
                if (typeof onEnded === 'function') {
                    onEnded(entry);
                }
                continue;
            }

            buffer.push(entry);
        }
    }

    #checkDelayEffect(buffer) {
        for (const entry of this.#entries) {
            if (entry.delay && this.#chatLength < entry.delay) {
                buffer.push(entry);
            }
        }
    }

    checkTimedEffects() {
        if (!this.#isDryRun) {
            this.#checkTimedEffectOfType('sticky', this.#buffer.sticky, (entry) => {
                if (!entry.cooldown) {
                    return;
                }

                const key = this.#getEntryKey(entry);
                this.#timedWorldInfo.cooldown[key] = this.#getEntryTimedEffect('cooldown', entry, true);
                this.#buffer.cooldown.push(entry);
            });
            this.#checkTimedEffectOfType('cooldown', this.#buffer.cooldown);
        }

        this.#checkDelayEffect(this.#buffer.delay);
    }

    isEffectActive(type, entry) {
        return this.#buffer[type]?.some(item => this.#getEntryHash(item) === this.#getEntryHash(entry)) ?? false;
    }

    setTimedEffects(activatedEntries) {
        if (this.#isDryRun) {
            return;
        }

        for (const entry of activatedEntries) {
            for (const type of ['sticky', 'cooldown']) {
                if (!entry[type]) {
                    continue;
                }

                const key = this.#getEntryKey(entry);
                if (!this.#timedWorldInfo[type][key]) {
                    this.#timedWorldInfo[type][key] = this.#getEntryTimedEffect(type, entry, false);
                }
            }
        }
    }

    cleanUp() {
        for (const buffer of Object.values(this.#buffer)) {
            buffer.splice(0, buffer.length);
        }
    }

    getTimedWorldInfo() {
        return this.#timedWorldInfo;
    }
}

function filterGroupsByScoring(groups, buffer, removeEntry, scanState, hasStickyMap, settings) {
    for (const [key, group] of Object.entries(groups)) {
        if (!settings.world_info_use_group_scoring && !group.some(item => item.useGroupScoring)) {
            continue;
        }

        if (hasStickyMap.get(key)) {
            continue;
        }

        const scores = group.map(entry => buffer.getScore(entry, scanState));
        const maxScore = Math.max(...scores);
        for (let index = 0; index < group.length; index++) {
            const isScored = group[index].useGroupScoring ?? settings.world_info_use_group_scoring;
            if (isScored && scores[index] < maxScore) {
                removeEntry(group[index]);
                group.splice(index, 1);
                scores.splice(index, 1);
                index--;
            }
        }
    }
}

function filterGroupsByTimedEffects(groups, timedEffects, removeEntry) {
    const hasStickyMap = new Map();

    for (const [key, group] of Object.entries(groups)) {
        hasStickyMap.set(key, false);

        const stickyEntries = group.filter(entry => timedEffects.isEffectActive('sticky', entry));
        if (stickyEntries.length) {
            for (const entry of group) {
                if (!stickyEntries.includes(entry)) {
                    removeEntry(entry);
                }
            }
            groups[key] = stickyEntries;
            hasStickyMap.set(key, true);
            continue;
        }

        for (const type of ['cooldown', 'delay']) {
            const entries = group.filter(entry => timedEffects.isEffectActive(type, entry));
            for (const entry of entries) {
                removeEntry(entry);
            }
        }

        groups[key] = group.filter(entry =>
            !timedEffects.isEffectActive('cooldown', entry) &&
            !timedEffects.isEffectActive('delay', entry),
        );
    }

    return hasStickyMap;
}

function filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects, settings) {
    const grouped = newEntries.filter(entry => entry.group).reduce((acc, item) => {
        item.group.split(/,\s*/).filter(Boolean).forEach(group => {
            acc[group] = acc[group] ?? [];
            acc[group].push(item);
        });
        return acc;
    }, {});

    if (Object.keys(grouped).length === 0) {
        return;
    }

    const removeEntry = (entry) => {
        const index = newEntries.indexOf(entry);
        if (index >= 0) {
            newEntries.splice(index, 1);
        }
    };

    const removeAllBut = (group, chosen) => {
        for (const entry of group) {
            if (entry !== chosen) {
                removeEntry(entry);
            }
        }
    };

    const hasStickyMap = filterGroupsByTimedEffects(grouped, timedEffects, removeEntry);
    filterGroupsByScoring(grouped, buffer, removeEntry, scanState, hasStickyMap, settings);

    for (const [key, group] of Object.entries(grouped)) {
        if (hasStickyMap.get(key)) {
            continue;
        }

        if (Array.from(allActivatedEntries.values()).some(entry => entry.group && entry.group.split(/,\s*/).includes(key))) {
            removeAllBut(group, null);
            continue;
        }

        if (!Array.isArray(group) || group.length <= 1) {
            continue;
        }

        const sortFn = (a, b) => (b.order ?? 0) - (a.order ?? 0);
        const prios = group.filter(entry => entry.groupOverride).sort(sortFn);
        if (prios.length) {
            removeAllBut(group, prios[0]);
            continue;
        }

        const totalWeight = group.reduce((acc, item) => acc + (item.groupWeight ?? DEFAULT_WEIGHT), 0);
        const rollValue = Math.random() * totalWeight;
        let currentWeight = 0;
        let winner = null;

        for (const entry of group) {
            currentWeight += entry.groupWeight ?? DEFAULT_WEIGHT;
            if (rollValue <= currentWeight) {
                winner = entry;
                break;
            }
        }

        if (winner) {
            removeAllBut(group, winner);
        }
    }
}

function getScanInjects(payload = {}) {
    const extensionPrompts = payload.extensionPrompts;
    if (extensionPrompts && typeof extensionPrompts === 'object') {
        const injects = Object.keys(extensionPrompts)
            .sort()
            .map((key) => extensionPrompts[key])
            .filter(prompt => prompt?.scan)
            .map(prompt => String(prompt.resolvedValue ?? prompt.scanText ?? prompt.value ?? '').trim())
            .filter(Boolean);

        if (injects.length) {
            return injects;
        }
    }

    return Array.isArray(payload.injects) ? payload.injects.filter(Boolean) : [];
}

export async function scanWorldInfo(payload = {}) {
    const settings = payload.settings || {};
    const chat = Array.isArray(payload.chat) ? payload.chat.map(String) : [];
    const globalScanData = { ...DEFAULT_GLOBAL_SCAN_DATA, ...(payload.globalScanData || {}) };
    const sortedEntries = Array.isArray(payload.sortedEntries) ? structuredClone(payload.sortedEntries) : [];
    const injects = getScanInjects(payload);
    const currentCharacterFilename = String(payload.currentCharacterFilename || '');
    const currentCharacterTags = Array.isArray(payload.currentCharacterTags) ? payload.currentCharacterTags : [];
    const isDryRun = Boolean(payload.isDryRun);
    const includeDebugInfo = payload.includeDebugInfo !== false;
    const tokenCountCache = new Map();

    const buffer = new WorldInfoBuffer(chat, globalScanData, injects, settings, payload.forcedActivations);
    const timedEffects = new WorldInfoTimedEffects(chat.length, sortedEntries, structuredClone(payload.timedWorldInfo || {}), isDryRun);
    timedEffects.checkTimedEffects();
    const entryDebug = new Map();
    let activationIndex = 0;
    let decisionIndex = 0;

    const recordEntryDebug = (entry, patch = {}) => {
        if (!entry || entry.world === undefined || entry.uid === undefined) {
            return;
        }

        const key = getWorldInfoEntryKey(entry);
        const existing = entryDebug.get(key) || {
            entry,
            activationIndex: activationIndex++,
            decisionIndex: Number.MAX_SAFE_INTEGER,
            roundIndex: null,
        };

        existing.entry = existing.entry || entry;
        if (patch.activationSource && !existing.activationSource) {
            existing.activationSource = patch.activationSource;
        }
        if (patch.activationReason && !existing.activationReason) {
            existing.activationReason = patch.activationReason;
        }
        if (patch.matchedPrimaryKey && !existing.matchedPrimaryKey) {
            existing.matchedPrimaryKey = patch.matchedPrimaryKey;
        }
        if (Array.isArray(patch.matchedSecondaryKeys) && patch.matchedSecondaryKeys.length && !existing.matchedSecondaryKeys?.length) {
            existing.matchedSecondaryKeys = patch.matchedSecondaryKeys;
        }
        if (patch.scanState && !existing.scanState) {
            existing.scanState = patch.scanState;
        }
        if (Number.isFinite(Number(patch.roundIndex)) && (existing.roundIndex === null || existing.roundIndex === undefined || !Number.isFinite(Number(existing.roundIndex)))) {
            existing.roundIndex = Number(patch.roundIndex);
        }
        if (patch.status) {
            existing.status = patch.status;
            existing.decisionIndex = decisionIndex++;
        }

        entryDebug.set(key, existing);
    };

    if (sortedEntries.length === 0) {
        return {
            worldInfoBefore: '',
            worldInfoAfter: '',
            WIDepthEntries: [],
            EMEntries: [],
            ANBeforeEntries: [],
            ANAfterEntries: [],
            outletEntries: {},
            allActivatedEntries: [],
            timedWorldInfo: timedEffects.getTimedWorldInfo(),
            overflowed: false,
            worldInfo: includeDebugInfo
                ? {
                    activatedEntries: [],
                    beforeEntries: [],
                    afterEntries: [],
                    depthEntries: [],
                    exampleEntries: [],
                    timedState: timedEffects.getTimedWorldInfo(),
                    overflowed: false,
                    rounds: [],
                    budgetUsed: {
                        global: { used: 0, limit: 0 },
                        lorebooks: [],
                    },
                }
                : null,
        };
    }

    let scanState = scan_state.INITIAL;
    let tokenBudgetOverflowed = false;
    const lorebookBudgetOverflowed = new Set();
    let count = 0;
    let allActivatedEntries = new Map();
    let failedProbabilityChecks = new Set();
    let allActivatedText = '';
    const lorebookActivatedText = new Map();

    let budget = Math.round((Number(settings.world_info_budget) || 0) * Number(payload.maxContext || 0) / 100);
    if (Number(settings.world_info_budget_cap) > 0 && budget > Number(settings.world_info_budget_cap)) {
        budget = Number(settings.world_info_budget_cap);
    }

    const lorebookBudgets = new Map();
    for (const entry of sortedEntries) {
        if (!entry?.world || lorebookBudgets.has(entry.world)) {
            continue;
        }

        const lorebookBudget = calculateLorebookBudget(entry.lorebookSettings, budget, payload.maxContext);
        if (lorebookBudget > 0) {
            lorebookBudgets.set(entry.world, lorebookBudget);
        }
    }

    const availableRecursionDelayLevels = [...new Set(sortedEntries
        .filter(entry => entry.delayUntilRecursion)
        .map(entry => entry.delayUntilRecursion === true ? 1 : entry.delayUntilRecursion),
    )].sort((a, b) => a - b);
    let currentRecursionDelayLevel = availableRecursionDelayLevels.shift() ?? 0;

    while (scanState) {
        if (settings.world_info_max_recursion_steps && Number(settings.world_info_max_recursion_steps) <= count) {
            break;
        }

        count++;
        let nextScanState = scan_state.NONE;
        let activatedNow = new Set();

        const getEligibleScanEntry = (entry) => {
            if (failedProbabilityChecks.has(entry) || allActivatedEntries.has(`${entry.world}.${entry.uid}`)) {
                return null;
            }

            if (entry.disable === true) {
                return null;
            }

            if (Array.isArray(entry.triggers) && entry.triggers.length > 0 && !entry.triggers.includes(globalScanData.trigger)) {
                return null;
            }

            if (entry.characterFilter?.names?.length > 0) {
                const nameIncluded = currentCharacterFilename && entry.characterFilter.names.includes(currentCharacterFilename);
                const filtered = entry.characterFilter.isExclude ? nameIncluded : !nameIncluded;
                if (filtered) {
                    return null;
                }
            }

            if (entry.characterFilter?.tags?.length > 0) {
                const includesTag = currentCharacterTags.some(tag => entry.characterFilter.tags.includes(tag));
                const filtered = entry.characterFilter.isExclude ? includesTag : !includesTag;
                if (filtered) {
                    return null;
                }
            }

            const isSticky = timedEffects.isEffectActive('sticky', entry);
            const isCooldown = timedEffects.isEffectActive('cooldown', entry);
            const isDelay = timedEffects.isEffectActive('delay', entry);

            if (isDelay || (isCooldown && !isSticky)) {
                return null;
            }

            if (scanState !== scan_state.RECURSION && entry.delayUntilRecursion && !isSticky) {
                return null;
            }

            if (scanState === scan_state.RECURSION && entry.delayUntilRecursion && entry.delayUntilRecursion > currentRecursionDelayLevel && !isSticky) {
                return null;
            }

            if (scanState === scan_state.RECURSION && settings.world_info_recursive && entry.excludeRecursion && !isSticky) {
                return null;
            }

            return {
                entry,
                isSticky,
                isConstantLike: Boolean(entry.constant || isSticky),
            };
        };

        const activateConstantEntry = ({ entry, isSticky }) => {
            if (Array.isArray(entry.decorators) && entry.decorators.includes('@@activate')) {
                recordEntryDebug(entry, {
                    activationSource: 'decorator',
                    activationReason: '@@activate',
                    scanState: getScanStateLabel(scanState),
                    roundIndex: count,
                });
                activatedNow.add(entry);
                return;
            }

            if (Array.isArray(entry.decorators) && entry.decorators.includes('@@dont_activate')) {
                return;
            }

            recordEntryDebug(entry, {
                activationSource: isSticky ? 'sticky' : 'constant',
                activationReason: isSticky ? 'timed_sticky' : 'constant',
                scanState: getScanStateLabel(scanState),
                roundIndex: count,
            });
            activatedNow.add(entry);
        };

        const activateOtherEntry = ({ entry }) => {
            if (entry.constant) {
                return;
            }

            if (Array.isArray(entry.decorators) && entry.decorators.includes('@@activate')) {
                recordEntryDebug(entry, {
                    activationSource: 'decorator',
                    activationReason: '@@activate',
                    scanState: getScanStateLabel(scanState),
                    roundIndex: count,
                });
                activatedNow.add(entry);
                return;
            }

            if (Array.isArray(entry.decorators) && entry.decorators.includes('@@dont_activate')) {
                return;
            }

            const externallyActivated = buffer.getExternallyActivated(entry);
            if (externallyActivated) {
                recordEntryDebug(externallyActivated, {
                    activationSource: 'external',
                    activationReason: 'forced_activation',
                    scanState: getScanStateLabel(scanState),
                    roundIndex: count,
                });
                activatedNow.add(externallyActivated);
                return;
            }

            if (!Array.isArray(entry.key) || !entry.key.length) {
                return;
            }

            const textToScan = buffer.get(entry, scanState);
            const primaryKeyMatch = entry.key.find(key => key && buffer.matchKeys(textToScan, String(key).trim(), entry));
            if (!primaryKeyMatch) {
                return;
            }

            const hasSecondaryKeywords = entry.selective && Array.isArray(entry.keysecondary) && entry.keysecondary.length;
            if (!hasSecondaryKeywords) {
                recordEntryDebug(entry, {
                    activationSource: 'primary_key',
                    activationReason: 'keyword_match',
                    matchedPrimaryKey: primaryKeyMatch,
                    scanState: getScanStateLabel(scanState),
                    roundIndex: count,
                });
                activatedNow.add(entry);
                return;
            }

            const selectiveLogic = entry.selectiveLogic ?? 0;
            let hasAnyMatch = false;
            let hasAllMatch = true;
            let matched = false;

            for (const keysecondary of entry.keysecondary) {
                const hasSecondaryMatch = keysecondary && buffer.matchKeys(textToScan, String(keysecondary).trim(), entry);
                if (hasSecondaryMatch) {
                    hasAnyMatch = true;
                } else {
                    hasAllMatch = false;
                }

                if (selectiveLogic === world_info_logic.AND_ANY && hasSecondaryMatch) {
                    matched = true;
                    break;
                }
                if (selectiveLogic === world_info_logic.NOT_ALL && !hasSecondaryMatch) {
                    matched = true;
                    break;
                }
            }

            if (!matched && selectiveLogic === world_info_logic.NOT_ANY && !hasAnyMatch) {
                matched = true;
            }
            if (!matched && selectiveLogic === world_info_logic.AND_ALL && hasAllMatch) {
                matched = true;
            }

            if (matched) {
                recordEntryDebug(entry, {
                    activationSource: 'selective',
                    activationReason: 'keyword_match',
                    matchedPrimaryKey: primaryKeyMatch,
                    matchedSecondaryKeys: entry.keysecondary.filter(keysecondary => keysecondary && buffer.matchKeys(textToScan, String(keysecondary).trim(), entry)),
                    scanState: getScanStateLabel(scanState),
                    roundIndex: count,
                });
                activatedNow.add(entry);
            }
        };

        const eligibleEntries = sortedEntries
            .map(getEligibleScanEntry)
            .filter(Boolean);

        for (const eligibleEntry of eligibleEntries) {
            if (eligibleEntry.isConstantLike) {
                activateConstantEntry(eligibleEntry);
            }
        }

        for (const eligibleEntry of eligibleEntries) {
            if (!eligibleEntry.isConstantLike) {
                activateOtherEntry(eligibleEntry);
            }
        }

        const sortFn = (a, b) => {
            const aConstantBucket = a.constant || timedEffects.isEffectActive('sticky', a) ? 0 : 1;
            const bConstantBucket = b.constant || timedEffects.isEffectActive('sticky', b) ? 0 : 1;
            const isASticky = timedEffects.isEffectActive('sticky', a) ? 1 : 0;
            const isBSticky = timedEffects.isEffectActive('sticky', b) ? 1 : 0;
            return aConstantBucket - bConstantBucket || isBSticky - isASticky || sortedEntries.indexOf(a) - sortedEntries.indexOf(b);
        };
        const newEntries = [...activatedNow].sort(sortFn);
        const textToScanTokens = await countWorldInfoTokens(allActivatedText, payload, tokenCountCache);
        const admittedEntries = [];
        const preGroupFilterEntries = [...newEntries];

        filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects, settings);
        for (const entry of preGroupFilterEntries) {
            if (!newEntries.includes(entry)) {
                recordEntryDebug(entry, {
                    status: 'dropped_group',
                    scanState: getScanStateLabel(scanState),
                    roundIndex: count,
                });
            }
        }
        await primeWorldInfoTokenCounts(newEntries.map(entry => `${entry.content}\n`), payload, tokenCountCache);
        const randomTrimDrops = await buildRandomTrimDropSet(newEntries, payload, tokenCountCache, lorebookBudgets, lorebookActivatedText);

        let newContent = '';
        let ignoresBudget = newEntries.filter(entry => entry.ignoreBudget || entry.activationOnly).length;
        for (const entry of newEntries) {
            const ignoresInsertionBudget = Boolean(entry.ignoreBudget || entry.activationOnly);
            ignoresBudget -= ignoresInsertionBudget ? 1 : 0;
            if (tokenBudgetOverflowed && !ignoresInsertionBudget) {
                if (ignoresBudget > 0) {
                    continue;
                }
                break;
            }

            if (entry.useProbability && entry.probability !== 100 && !timedEffects.isEffectActive('sticky', entry)) {
                const rollValue = Math.random() * 100;
                if (rollValue > entry.probability) {
                    failedProbabilityChecks.add(entry);
                    recordEntryDebug(entry, { status: 'dropped_probability', roundIndex: count });
                    continue;
                }
            }

            const entryContent = `${entry.content}\n`;
            const insertableEntryContent = entry.activationOnly ? '' : entryContent;
            if (randomTrimDrops.has(`${entry.world}.${entry.uid}`)) {
                recordEntryDebug(entry, { status: 'dropped_trim', roundIndex: count });
                continue;
            }

            if (!entry.ignoreBudget && !entry.activationOnly && lorebookBudgetOverflowed.has(entry.world)) {
                recordEntryDebug(entry, { status: 'dropped_lorebook_budget', roundIndex: count });
                continue;
            }

            if (!entry.ignoreBudget && !entry.activationOnly) {
                const lorebookBudget = lorebookBudgets.get(entry.world) || 0;
                const lorebookText = lorebookActivatedText.get(entry.world) || '';
                if (lorebookBudget > 0 && (await countWorldInfoTokens(lorebookText + insertableEntryContent, payload, tokenCountCache)) >= lorebookBudget) {
                    lorebookBudgetOverflowed.add(entry.world);
                    recordEntryDebug(entry, { status: 'dropped_lorebook_budget', roundIndex: count });
                    continue;
                }

                if ((textToScanTokens + await countWorldInfoTokens(newContent + insertableEntryContent, payload, tokenCountCache)) >= budget) {
                    tokenBudgetOverflowed = true;
                    recordEntryDebug(entry, { status: 'dropped_budget', roundIndex: count });
                    continue;
                }

                lorebookActivatedText.set(entry.world, lorebookText + insertableEntryContent);
            }

            newContent += insertableEntryContent;
            allActivatedEntries.set(`${entry.world}.${entry.uid}`, entry);
            admittedEntries.push(entry);
            recordEntryDebug(entry, { status: 'admitted', roundIndex: count });
        }

        const successfulNewEntriesForRecursion = admittedEntries.filter(entry => !entry.preventRecursion);

        if (settings.world_info_recursive && !tokenBudgetOverflowed && successfulNewEntriesForRecursion.length) {
            nextScanState = scan_state.RECURSION;
        }

        if (settings.world_info_recursive && !tokenBudgetOverflowed && scanState === scan_state.MIN_ACTIVATIONS && buffer.hasRecurse()) {
            nextScanState = scan_state.RECURSION;
        }

        const minActivationsNotSatisfied = Number(settings.world_info_min_activations) > 0 && allActivatedEntries.size < Number(settings.world_info_min_activations);
        if (!nextScanState && !tokenBudgetOverflowed && minActivationsNotSatisfied) {
            const overMax =
                (Number(settings.world_info_min_activations_depth_max) > 0 && buffer.getDepth() > Number(settings.world_info_min_activations_depth_max)) ||
                (buffer.getDepth() > chat.length);

            if (!overMax) {
                nextScanState = scan_state.MIN_ACTIVATIONS;
                buffer.advanceScan();
            }
        }

        if (nextScanState === scan_state.NONE && availableRecursionDelayLevels.length) {
            nextScanState = scan_state.RECURSION;
            currentRecursionDelayLevel = availableRecursionDelayLevels.shift();
        }

        const recursionText = successfulNewEntriesForRecursion.map(entry => entry.content).join('\n');
        const admittedText = admittedEntries.filter(entry => !entry.activationOnly).map(entry => entry.content).join('\n');
        scanState = nextScanState;
        if (recursionText) {
            buffer.addRecurse(recursionText);
        }
        if (admittedText) {
            allActivatedText = `${admittedText}\n${allActivatedText}`;
        }
    }

    const world_info_position = payload.worldInfoPosition || {};
    const wi_anchor_position = payload.wiAnchorPosition || {};
    const WIDepthEntries = [];
    const WIOutletEntries = {};
    const WIBeforeEntries = [];
    const WIAfterEntries = [];
    const EMEntries = [];
    const ANTopEntries = [];
    const ANBottomEntries = [];
    const structuredWorldInfo = {
        beforeEntries: [],
        afterEntries: [],
        exampleEntries: [],
        authorsNoteBeforeEntries: [],
        authorsNoteAfterEntries: [],
        depthEntries: [],
        outletEntries: {},
    };
    const sortFn = (a, b) => (b.order ?? 0) - (a.order ?? 0);

    [...allActivatedEntries.values()].sort(sortFn).forEach((entry) => {
        if (entry.activationOnly) {
            return;
        }

        const content = entry.content;
        if (!content) {
            return;
        }

        const debugItem = entryDebug.get(getWorldInfoEntryKey(entry)) || null;
        const segmentEntry = buildWorldInfoSegmentEntry(entry, payload, debugItem);

        switch (entry.position) {
            case world_info_position.before:
                WIBeforeEntries.unshift(content);
                structuredWorldInfo.beforeEntries.unshift(segmentEntry);
                break;
            case world_info_position.after:
                WIAfterEntries.unshift(content);
                structuredWorldInfo.afterEntries.unshift(segmentEntry);
                break;
            case world_info_position.EMTop:
                EMEntries.unshift({ position: wi_anchor_position.before, content });
                structuredWorldInfo.exampleEntries.unshift({ position: wi_anchor_position.before, entry: segmentEntry });
                break;
            case world_info_position.EMBottom:
                EMEntries.unshift({ position: wi_anchor_position.after, content });
                structuredWorldInfo.exampleEntries.unshift({ position: wi_anchor_position.after, entry: segmentEntry });
                break;
            case world_info_position.ANTop:
                ANTopEntries.unshift(content);
                structuredWorldInfo.authorsNoteBeforeEntries.unshift(segmentEntry);
                break;
            case world_info_position.ANBottom:
                ANBottomEntries.unshift(content);
                structuredWorldInfo.authorsNoteAfterEntries.unshift(segmentEntry);
                break;
            case world_info_position.atDepth: {
                const depth = entry.depth ?? DEFAULT_DEPTH;
                const role = entry.role ?? 0;
                const existingDepthIndex = WIDepthEntries.findIndex(item => item.depth === depth && item.role === role);
                const structuredDepthIndex = structuredWorldInfo.depthEntries.findIndex(item => item.depth === depth && item.role === role);
                if (existingDepthIndex !== -1) {
                    WIDepthEntries[existingDepthIndex].entries.unshift(content);
                } else {
                    WIDepthEntries.push({ depth, entries: [content], role });
                }
                if (structuredDepthIndex !== -1) {
                    structuredWorldInfo.depthEntries[structuredDepthIndex].entries.unshift(segmentEntry);
                } else {
                    structuredWorldInfo.depthEntries.push({ depth, entries: [segmentEntry], role });
                }
                break;
            }
            case world_info_position.outlet:
                if (entry.outletName) {
                    WIOutletEntries[entry.outletName] = WIOutletEntries[entry.outletName] ?? [];
                    WIOutletEntries[entry.outletName].push(content);
                    structuredWorldInfo.outletEntries[entry.outletName] = structuredWorldInfo.outletEntries[entry.outletName] ?? [];
                    structuredWorldInfo.outletEntries[entry.outletName].push(segmentEntry);
                }
                break;
            default:
                break;
        }
    });

    const result = {
        worldInfoBefore: WIBeforeEntries.length ? WIBeforeEntries.join('\n') : '',
        worldInfoAfter: WIAfterEntries.length ? WIAfterEntries.join('\n') : '',
        EMEntries,
        WIDepthEntries,
        ANBeforeEntries: ANTopEntries,
        ANAfterEntries: ANBottomEntries,
        outletEntries: WIOutletEntries,
        structuredWorldInfo,
        allActivatedEntries: Array.from(allActivatedEntries.values()),
        timedWorldInfo: timedEffects.getTimedWorldInfo(),
        overflowed: Boolean(tokenBudgetOverflowed),
    };

    timedEffects.setTimedEffects(result.allActivatedEntries);
    timedEffects.cleanUp();
    result.worldInfo = includeDebugInfo
        ? await buildWorldInfoDebugSummary(
            entryDebug,
            payload,
            tokenCountCache,
            budget,
            lorebookBudgets,
            lorebookActivatedText,
            timedEffects.getTimedWorldInfo(),
            result.overflowed,
        )
        : null;

    return result;
}
