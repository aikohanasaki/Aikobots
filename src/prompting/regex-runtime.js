import { createMacroState, evaluatePromptMacros } from './macro-evaluator.js';

export const regex_placement = {
    MD_DISPLAY: 0,
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    // 4 - sendAs (legacy)
    WORLD_INFO: 5,
    REASONING: 6,
};

export const substitute_find_regex = {
    NONE: 0,
    RAW: 1,
    ESCAPED: 2,
};

function regexFromString(input) {
    try {
        const match = String(input || '').match(/(\/?)(.+)\1([a-z]*)/i);
        if (!match) {
            return;
        }

        if (match[3] && !/^(?!.*?(.).*?\1)[dgimsuvy]+$/.test(match[3])) {
            return;
        }

        return new RegExp(match[2], match[3]);
    } catch {
        return;
    }
}

function sanitizeRegexMacro(value) {
    return (value && typeof value === 'string')
        ? value.replaceAll(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, (char) => {
            switch (char) {
                case '\n': return '\\n';
                case '\r': return '\\r';
                case '\t': return '\\t';
                case '\v': return '\\v';
                case '\f': return '\\f';
                case '\0': return '\\0';
                default: return '\\' + char;
            }
        })
        : value;
}

function buildRuntimeEnv(env = {}, characterOverride) {
    if (!characterOverride) {
        return env;
    }

    return {
        ...env,
        char: characterOverride,
    };
}

function filterString(rawString, trimStrings, runtimeEnv, { macroState } = {}) {
    let finalString = rawString;

    for (const trimString of Array.isArray(trimStrings) ? trimStrings : []) {
        const resolvedTrimString = evaluatePromptMacros(trimString, runtimeEnv, { macroState });
        finalString = finalString.replaceAll(resolvedTrimString, '');
    }

    return finalString;
}

export function runRegexScript(regexScript, rawString, env = {}, { characterOverride, macroState = null } = {}) {
    let newString = rawString;
    if (!regexScript || regexScript.disabled || !regexScript.findRegex || !rawString) {
        return newString;
    }

    const runtimeEnv = buildRuntimeEnv(env, characterOverride);
    const state = macroState || createMacroState(env.macroSnapshot || {}, env.extensionPrompts || {});
    const getRegexString = () => {
        switch (Number(regexScript.substituteRegex)) {
            case substitute_find_regex.NONE:
                return regexScript.findRegex;
            case substitute_find_regex.RAW:
                return evaluatePromptMacros(regexScript.findRegex, runtimeEnv, { macroState: state });
            case substitute_find_regex.ESCAPED:
                return evaluatePromptMacros(regexScript.findRegex, runtimeEnv, { macroState: state, postProcessFn: sanitizeRegexMacro });
            default:
                console.warn(`runRegexScript: Unknown substituteRegex value ${regexScript.substituteRegex}. Using raw regex.`);
                return regexScript.findRegex;
        }
    };

    const findRegex = regexFromString(getRegexString());
    if (!findRegex) {
        return newString;
    }

    newString = rawString.replace(findRegex, function (match) {
        const args = [...arguments];
        const replaceString = String(regexScript.replaceString || '').replace(/{{match}}/gi, '$0');
        const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
            let groupValue;

            if (num) {
                groupValue = args[Number(num)];
            } else if (groupName) {
                const groups = args[args.length - 1];
                groupValue = groups && typeof groups === 'object' && groups[groupName];
            }

            if (!groupValue) {
                return '';
            }

            return filterString(groupValue, regexScript.trimStrings, runtimeEnv, { macroState: state });
        });

        return evaluatePromptMacros(replaceWithGroups, runtimeEnv, { macroState: state });
    });

    return newString;
}

export function getRegexedString(rawString, placement, regexScripts = [], env = {}, { characterOverride, isMarkdown, isPrompt, isEdit, depth, macroState = null } = {}) {
    if (typeof rawString !== 'string') {
        console.warn('getRegexedString: rawString is not a string. Returning empty string.');
        return '';
    }

    let finalString = rawString;
    const state = macroState || createMacroState(env.macroSnapshot || {}, env.extensionPrompts || {});
    for (const script of Array.isArray(regexScripts) ? regexScripts : []) {
        if (
            (script.markdownOnly && isMarkdown) ||
            (script.promptOnly && isPrompt) ||
            (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
        ) {
            if (isEdit && !script.runOnEdit) {
                continue;
            }

            if (typeof depth === 'number') {
                if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) {
                    continue;
                }

                if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) {
                    continue;
                }
            }

            if (Array.isArray(script.placement) && script.placement.includes(placement)) {
                finalString = runRegexScript(script, finalString, env, { characterOverride, macroState: state });
            }
        }
    }

    return finalString;
}
