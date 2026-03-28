import moment from 'moment';
import seedrandom from 'seedrandom';
import droll from 'droll';

function escapeRegex(string) {
    return String(string).replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

function getStringHash(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function sanitizeMacroValue(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

function isDigitsOnly(str) {
    return typeof str === 'string' && /^\d+$/.test(str);
}

function parseVariableValue(value) {
    if (typeof value !== 'string') {
        return value ?? '';
    }
    return (value.trim() === '' || isNaN(Number(value))) ? value : Number(value);
}

function buildOutletValues(extensionPrompts = {}) {
    const outletValues = {};
    for (const [key, prompt] of Object.entries(extensionPrompts || {})) {
        const match = /^customWIOutlet_(.+)$/.exec(key);
        if (!match) {
            continue;
        }
        outletValues[match[1]] = String(prompt?.value ?? prompt?.resolvedValue ?? '');
    }
    return outletValues;
}

export function createMacroState(snapshot = {}, extensionPrompts = {}) {
    return {
        values: { ...(snapshot?.values || {}) },
        registeredValues: { ...(snapshot?.registeredValues || {}) },
        localVariables: { ...(snapshot?.localVariables || {}) },
        globalVariables: { ...(snapshot?.globalVariables || {}) },
        chatId: String(snapshot?.chatId || ''),
        now: moment(snapshot?.now || undefined),
        outletValues: buildOutletValues(extensionPrompts),
    };
}

export function refreshMacroOutletValues(macroState, extensionPrompts = {}) {
    if (!macroState || typeof macroState !== 'object') {
        return;
    }
    macroState.outletValues = buildOutletValues(extensionPrompts);
}

export function evaluatePromptMacros(content, env = {}, { additional = {}, macroState = null, postProcessFn = (x) => x } = {}) {
    if (!content) {
        return '';
    }

    const state = macroState || createMacroState();
    const nonce = `${state.chatId || state.now.valueOf()}-${Math.random().toString(36).slice(2)}`;
    let originalUsed = false;
    const filteredEnv = Object.fromEntries(Object.entries(env || {}).filter(([key]) => !String(key).startsWith('__')));
    const filteredAdditional = Object.fromEntries(Object.entries(additional || {}).filter(([key]) => key !== 'original'));
    const runtimeEnv = {
        ...state.values,
        ...filteredEnv,
        ...filteredAdditional,
        ...state.registeredValues,
    };

    if (typeof additional?.original === 'string') {
        runtimeEnv.original = () => {
            if (originalUsed) {
                return '';
            }
            originalUsed = true;
            return additional.original;
        };
    }

    const getValue = (key) => {
        const value = runtimeEnv[key];
        return sanitizeMacroValue(typeof value === 'function' ? value(nonce) : value);
    };

    const getLocalVariable = (name) => parseVariableValue(state.localVariables[String(name).trim()]);
    const getGlobalVariable = (name) => parseVariableValue(state.globalVariables[String(name).trim()]);
    const setLocalVariable = (name, value) => {
        state.localVariables[String(name).trim()] = String(value ?? '');
        return '';
    };
    const setGlobalVariable = (name, value) => {
        state.globalVariables[String(name).trim()] = String(value ?? '');
        return '';
    };
    const addVariableValue = (currentValue, value) => {
        const increment = Number(value);
        if (isNaN(increment) || isNaN(Number(currentValue))) {
            return String(currentValue || '') + String(value ?? '');
        }
        return String(Number(currentValue || 0) + increment);
    };

    const rawContent = String(content);
    let result = String(content);
    const macros = [
        { regex: /<USER>/gi, replace: () => getValue('user') },
        { regex: /<BOT>/gi, replace: () => getValue('char') },
        { regex: /<CHAR>/gi, replace: () => getValue('char') },
        { regex: /<CHARIFNOTGROUP>/gi, replace: () => getValue('group') },
        { regex: /<GROUP>/gi, replace: () => getValue('group') },
        { regex: /{{roll[ : ]([^}]+)}}/gi, replace: (_, formulaText) => {
            let formula = String(formulaText || '').trim();
            if (isDigitsOnly(formula)) {
                formula = `1d${formula}`;
            }
            if (!droll.validate(formula)) {
                return '';
            }
            const roll = droll.roll(formula);
            return roll === false ? '' : String(roll.total);
        } },
        { regex: /{{setvar::([^:]+)::([^}]*)}}/gi, replace: (_, name, value) => setLocalVariable(name, value) },
        { regex: /{{addvar::([^:]+)::([^}]+)}}/gi, replace: (_, name, value) => {
            state.localVariables[String(name).trim()] = addVariableValue(state.localVariables[String(name).trim()], value);
            return '';
        } },
        { regex: /{{incvar::([^}]+)}}/gi, replace: (_, name) => {
            state.localVariables[String(name).trim()] = addVariableValue(state.localVariables[String(name).trim()], 1);
            return state.localVariables[String(name).trim()];
        } },
        { regex: /{{decvar::([^}]+)}}/gi, replace: (_, name) => {
            state.localVariables[String(name).trim()] = addVariableValue(state.localVariables[String(name).trim()], -1);
            return state.localVariables[String(name).trim()];
        } },
        { regex: /{{getvar::([^}]+)}}/gi, replace: (_, name) => sanitizeMacroValue(getLocalVariable(name)) },
        { regex: /{{setglobalvar::([^:]+)::([^}]*)}}/gi, replace: (_, name, value) => setGlobalVariable(name, value) },
        { regex: /{{addglobalvar::([^:]+)::([^}]+)}}/gi, replace: (_, name, value) => {
            state.globalVariables[String(name).trim()] = addVariableValue(state.globalVariables[String(name).trim()], value);
            return '';
        } },
        { regex: /{{incglobalvar::([^}]+)}}/gi, replace: (_, name) => {
            state.globalVariables[String(name).trim()] = addVariableValue(state.globalVariables[String(name).trim()], 1);
            return state.globalVariables[String(name).trim()];
        } },
        { regex: /{{decglobalvar::([^}]+)}}/gi, replace: (_, name) => {
            state.globalVariables[String(name).trim()] = addVariableValue(state.globalVariables[String(name).trim()], -1);
            return state.globalVariables[String(name).trim()];
        } },
        { regex: /{{getglobalvar::([^}]+)}}/gi, replace: (_, name) => sanitizeMacroValue(getGlobalVariable(name)) },
        { regex: /{{newline}}/gi, replace: () => '\n' },
        { regex: /(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, replace: () => '' },
        { regex: /{{noop}}/gi, replace: () => '' },
        { regex: /{{input}}/gi, replace: () => sanitizeMacroValue(state.values.input ?? '') },
    ];

    for (const [key] of Object.entries(runtimeEnv)) {
        const regex = new RegExp(`{{${escapeRegex(key)}}}`, 'gi');
        macros.push({ regex, replace: () => getValue(key) });
    }

    macros.push(
        { regex: /{{maxPrompt}}/gi, replace: () => sanitizeMacroValue(state.values.maxPrompt ?? '') },
        { regex: /{{lastMessage}}/gi, replace: () => sanitizeMacroValue(state.values.lastMessage ?? '') },
        { regex: /{{lastMessageId}}/gi, replace: () => sanitizeMacroValue(state.values.lastMessageId ?? '') },
        { regex: /{{lastUserMessage}}/gi, replace: () => sanitizeMacroValue(state.values.lastUserMessage ?? '') },
        { regex: /{{lastCharMessage}}/gi, replace: () => sanitizeMacroValue(state.values.lastCharMessage ?? '') },
        { regex: /{{firstIncludedMessageId}}/gi, replace: () => sanitizeMacroValue(state.values.firstIncludedMessageId ?? '') },
        { regex: /{{firstDisplayedMessageId}}/gi, replace: () => sanitizeMacroValue(state.values.firstDisplayedMessageId ?? '') },
        { regex: /{{lastSwipeId}}/gi, replace: () => sanitizeMacroValue(state.values.lastSwipeId ?? '') },
        { regex: /{{currentSwipeId}}/gi, replace: () => sanitizeMacroValue(state.values.currentSwipeId ?? '') },
        { regex: /{{reverse:(.+?)}}/gi, replace: (_, value) => Array.from(String(value ?? '')).reverse().join('') },
        { regex: /\{\{\/\/([\s\S]*?)\}\}/gm, replace: () => '' },
        { regex: /{{time}}/gi, replace: () => state.now.format('LT') },
        { regex: /{{date}}/gi, replace: () => state.now.format('LL') },
        { regex: /{{weekday}}/gi, replace: () => state.now.format('dddd') },
        { regex: /{{isotime}}/gi, replace: () => state.now.format('HH:mm') },
        { regex: /{{isodate}}/gi, replace: () => state.now.format('YYYY-MM-DD') },
        { regex: /{{datetimeformat +([^}]*)}}/gi, replace: (_, format) => state.now.format(format) },
        { regex: /{{idle_duration}}/gi, replace: () => sanitizeMacroValue(state.values.idle_duration ?? '') },
        { regex: /{{time_UTC([-+]\d+)}}/gi, replace: (_, offset) => moment(state.now).utc().utcOffset(parseInt(offset, 10)).format('LT') },
        { regex: /{{outlet::(.+?)}}/gi, replace: (_, key) => sanitizeMacroValue(state.outletValues[String(key).trim()] ?? '') },
        { regex: /{{timeDiff::(.*?)::(.*?)}}/gi, replace: (_, left, right) => moment.duration(moment(left).diff(moment(right))).humanize(true) },
        { regex: /{{banned "(.*)"}}/gi, replace: () => '' },
        { regex: /{{random\s?::?([^}]+)}}/gi, replace: (_, listString) => {
            const list = String(listString || '').includes('::')
                ? String(listString).split('::')
                : String(listString).replace(/\\,/g, '##COMMA##').split(',').map(item => item.trim().replace(/##COMMA##/g, ','));
            if (!list.length) {
                return '';
            }
            const rng = seedrandom('added entropy.', { entropy: true });
            return list[Math.floor(rng() * list.length)] ?? '';
        } },
        { regex: /{{pick\s?::?([^}]+)}}/gi, replace: (_, listString, offset) => {
            const list = String(listString || '').includes('::')
                ? String(listString).split('::')
                : String(listString).replace(/\\,/g, '##COMMA##').split(',').map(item => item.trim().replace(/##COMMA##/g, ','));
            if (!list.length) {
                return '';
            }
            const combinedSeedString = `${getStringHash(state.chatId)}-${getStringHash(rawContent)}-${offset}`;
            const finalSeed = getStringHash(combinedSeedString);
            const rng = seedrandom(finalSeed);
            return list[Math.floor(rng() * list.length)] ?? '';
        } },
    );

    for (const macro of macros) {
        if (!result) {
            break;
        }
        if (!macro.regex.source.startsWith('<') && !result.includes('{{')) {
            break;
        }
        try {
            result = result.replace(macro.regex, (...args) => postProcessFn(sanitizeMacroValue(macro.replace(...args))));
        } catch (error) {
            console.warn(`Macro content can't be replaced: ${macro.regex} in ${result}`, error);
        }
    }

    return result;
}
