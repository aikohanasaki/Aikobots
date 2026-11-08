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

function parseRegexQuantifier(pattern, startIndex) {
    const char = pattern[startIndex];
    if (char === '*' || char === '+' || char === '?') {
        return {
            length: 1,
            variable: true,
        };
    }

    if (char !== '{') {
        return null;
    }

    const match = pattern.slice(startIndex).match(/^\{(\d+)(,(\d*)?)?\}/);
    if (!match) {
        return null;
    }

    const lower = Number(match[1]);
    const hasUpperBound = match[3] !== undefined && match[3] !== '';
    const upper = hasUpperBound ? Number(match[3]) : null;
    const variable = !match[2] ? false : upper === null || lower !== upper;
    return {
        length: match[0].length,
        variable,
    };
}

/**
 * Recognizes disjoint, nonempty tokens whose variable runs cannot cross token boundaries.
 * Deliberately limited to attribute scanners; other nested repetitions stay blocked.
 * Extend only with another proven disjoint token family, or replace with a full regex analysis.
 */
function isDeterministicRegexTokenGroup(body) {
    const tokens = [String.raw`[^<>"'\s]+(?![^<>"'\s])`, String.raw`\s+(?!\s)`, String.raw`"[^"<>]*"`, String.raw`'[^'<>]*'`];
    // These tokens contain no alternation themselves; splitting any other syntax fails closed.
    const branches = body.startsWith('?:') ? body.slice(2).split('|') : body.split('|');
    return new Set(branches).size === branches.length
        && branches.every(branch => tokens.includes(branch));
}

function isPotentiallyUnsafeRegexPattern(pattern) {
    const stack = [{ containsVariableQuantifier: false, lastToken: null }];
    let inCharacterClass = false;
    let escaped = false;

    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        const current = stack[stack.length - 1];

        if (escaped) {
            escaped = false;
            current.lastToken = { type: 'atom', containsVariableQuantifier: false };
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inCharacterClass) {
            if (char === ']') {
                inCharacterClass = false;
                current.lastToken = { type: 'atom', containsVariableQuantifier: false };
            }
            continue;
        }

        if (char === '[') {
            inCharacterClass = true;
            continue;
        }

        const quantifier = parseRegexQuantifier(pattern, index);
        if (quantifier) {
            if (!current.lastToken) {
                continue;
            }

            if (quantifier.variable) {
                current.containsVariableQuantifier = true;
                // Optional groups do not repeat their contents; keep tracking them for enclosing repetitions.
                if (char !== '?' && current.lastToken.type === 'group' && current.lastToken.containsVariableQuantifier
                    && !isDeterministicRegexTokenGroup(current.lastToken.body)) {
                    return true;
                }
            }

            current.lastToken = null;
            index += quantifier.length - 1;
            continue;
        }

        if (char === '(') {
            stack.push({ containsVariableQuantifier: false, lastToken: null, start: index + 1 });
            continue;
        }

        if (char === ')') {
            if (stack.length === 1) {
                continue;
            }

            const completedGroup = stack.pop();
            stack[stack.length - 1].lastToken = {
                type: 'group',
                body: pattern.slice(completedGroup.start, index),
                containsVariableQuantifier: completedGroup.containsVariableQuantifier,
            };
            continue;
        }

        if (char === '|') {
            current.lastToken = null;
            continue;
        }

        if (!'^{},'.includes(char)) {
            current.lastToken = { type: 'atom', containsVariableQuantifier: false };
        }
    }

    return false;
}

function regexFromString(input) {
    try {
        const match = String(input || '').match(/(\/?)(.+)\1([a-z]*)/i);
        if (!match) {
            return;
        }

        if (match[3] && !/^(?!.*?(.).*?\1)[dgimsuvy]+$/.test(match[3])) {
            return;
        }

        if (isPotentiallyUnsafeRegexPattern(match[2])) {
            console.warn('runRegexScript: Blocked regex pattern with nested variable quantifiers.');
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

    // Regex scripts are user-authored power-user features and execute as trusted patterns.
    // We do not currently sandbox or time-box RegExp execution in this runtime.
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
            (!script.markdownOnly && !script.promptOnly)
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
