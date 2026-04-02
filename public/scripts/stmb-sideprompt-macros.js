import { substituteParamsExtended } from '../script.js';

const MACRO_TOKEN_REGEX = /{{[^{}]+}}/g;

function uniqueExact(values = []) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        output.push(value);
    }
    return output;
}

function toRuntimeMacroEnv(runtimeMacros = {}) {
    const environment = {};
    for (const [token, value] of Object.entries(runtimeMacros || {})) {
        if (typeof token !== 'string' || !token.startsWith('{{') || !token.endsWith('}}')) continue;
        environment[token.slice(2, -2)] = value ?? '';
    }
    return environment;
}

function parseQuotedSegment(input, start) {
    const quote = input[start];
    if (quote !== '"' && quote !== '\'') {
        return { error: 'expected_quote', end: start };
    }

    let value = '';
    let index = start + 1;
    while (index < input.length) {
        const character = input[index];
        if (character === '\\' && index + 1 < input.length) {
            value += input[index + 1];
            index += 2;
            continue;
        }
        if (character === quote) {
            return { value, end: index + 1 };
        }
        value += character;
        index++;
    }

    return { value, end: input.length, incomplete: true };
}

export function extractMacroTokens(text) {
    return uniqueExact(String(text || '').match(MACRO_TOKEN_REGEX) || []);
}

export function applySidePromptMacros(text, runtimeMacros = {}) {
    return substituteParamsExtended(String(text || ''), toRuntimeMacroEnv(runtimeMacros));
}

export function collectTemplateRuntimeMacros(templateLike, runtimeMacros = {}) {
    const prompt = typeof templateLike === 'string' ? templateLike : String(templateLike?.prompt || '');
    const responseFormat = typeof templateLike === 'string' ? '' : String(templateLike?.responseFormat || '');
    const titleOverride = typeof templateLike === 'string'
        ? ''
        : String(templateLike?.settings?.lorebook?.entryTitleOverride || '');
    const unresolvedPrompt = extractMacroTokens(applySidePromptMacros(prompt, runtimeMacros));
    const unresolvedFormat = extractMacroTokens(applySidePromptMacros(responseFormat, runtimeMacros));
    const unresolvedTitleOverride = extractMacroTokens(applySidePromptMacros(titleOverride, runtimeMacros));
    return uniqueExact([...unresolvedPrompt, ...unresolvedFormat, ...unresolvedTitleOverride]);
}

export function hasTemplateRuntimeMacros(templateLike) {
    return collectTemplateRuntimeMacros(templateLike).length > 0;
}

export function formatQuotedSidePromptName(name) {
    return `"${String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function parseSidePromptCommandInput(input, options = {}) {
    const allowIncomplete = Boolean(options.allowIncomplete);
    const source = String(input || '');
    const result = {
        source,
        name: '',
        nameClosed: false,
        runtimeMacros: {},
        range: null,
        trailing: '',
        error: null,
        macroToken: null,
    };

    let index = 0;
    while (index < source.length && /\s/.test(source[index])) index++;
    if (index >= source.length) return result;

    if (source[index] !== '"' && source[index] !== '\'') {
        if (allowIncomplete) {
            result.trailing = source.slice(index);
            return result;
        }
        result.error = 'missing_name_quotes';
        return result;
    }

    const parsedName = parseQuotedSegment(source, index);
    result.name = parsedName.value || '';
    if (parsedName.incomplete) {
        if (allowIncomplete) return result;
        result.error = 'unterminated_name';
        return result;
    }

    result.nameClosed = true;
    index = parsedName.end;

    while (index < source.length) {
        while (index < source.length && /\s/.test(source[index])) index++;
        if (index >= source.length) return result;

        const remaining = source.slice(index);
        const rangeMatch = remaining.match(/^(\d+)\s*[-–—]\s*(\d+)\s*$/);
        if (rangeMatch) {
            result.range = `${rangeMatch[1]}-${rangeMatch[2]}`;
            return result;
        }

        const macroMatch = remaining.match(/^(\{\{[^{}]+\}\})\s*=\s*/);
        if (!macroMatch) {
            if (allowIncomplete) {
                result.trailing = remaining;
                return result;
            }
            result.error = 'invalid_token';
            return result;
        }

        const token = macroMatch[1];
        index += macroMatch[0].length;

        if (index >= source.length || (source[index] !== '"' && source[index] !== '\'')) {
            if (allowIncomplete) {
                result.trailing = remaining;
                return result;
            }
            result.error = 'macro_value_must_be_quoted';
            result.macroToken = token;
            return result;
        }

        const valueParsed = parseQuotedSegment(source, index);
        if (valueParsed.incomplete) {
            if (allowIncomplete) {
                result.trailing = source.slice(index - macroMatch[0].length);
                return result;
            }
            result.error = 'unterminated_macro_value';
            result.macroToken = token;
            return result;
        }

        result.runtimeMacros[token] = valueParsed.value || '';
        index = valueParsed.end;
    }

    return result;
}

export function buildSidePromptMacroSuggestion(rawInput, draft, token) {
    const source = String(rawInput || '');
    const trailing = String(draft?.trailing || '');
    const base = trailing ? source.slice(0, source.length - trailing.length) : source;
    const trimmed = base.replace(/\s+$/, '');
    return `${trimmed}${trimmed ? ' ' : ''}${token}=""`;
}
