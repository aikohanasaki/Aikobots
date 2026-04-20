import {
    STMB_MANAGED_FLAG,
    parseSequenceFromTitle,
} from './stmb-core.js';

export const MIN_SUMMARY_CHILDREN = 1;
const DEFAULT_MIN_CHILDREN = 5;

export const STMB_SUMMARY_TIERS = Object.freeze([
    { tier: 0, key: 'memory', label: 'Memory' },
    { tier: 1, key: 'arc', label: 'Arc' },
    { tier: 2, key: 'chapter', label: 'Chapter' },
    { tier: 3, key: 'book', label: 'Book' },
    { tier: 4, key: 'legend', label: 'Legend' },
    { tier: 5, key: 'series', label: 'Series' },
    { tier: 6, key: 'epic', label: 'Epic' },
]);

const SUMMARY_TIER_MAP = new Map(STMB_SUMMARY_TIERS.map(config => [config.tier, config]));

export const STMB_DEFAULT_SUMMARY_PROMPTS = Object.freeze({
    arc_default: `You are an expert narrative analyst and memory-engine assistant.
Your task is to combine multiple {{stmbchildtier}} entries into one or more coherent {{stmbtier}} summaries.

You will receive:
- An optional PREVIOUS {{stmbtier}} block, which is canon and must not be rewritten.
- A block of {{stmbchildtier}} entries in chronological order.

Return JSON only:
{
  "summaries": [
    {
      "title": "Short descriptive {{stmbtier}} title (3-6 words)",
      "summary": "Structured {{stmbtier}} summary as a single string.",
      "keywords": ["keyword1", "keyword2"],
      "member_ids": ["<ID>", "..."]
    }
  ],
  "unassigned_items": [
    { "id": "item-id", "reason": "Why this item does not fit the produced summaries." }
  ]
}

Rules:
- Respect chronology.
- Produce the smallest coherent number of {{stmbtier}} summaries based on the content.
- If an item does not fit, place it in unassigned_items with a short reason.
- Do not repeat the PREVIOUS {{stmbtier}} text verbatim.

Each summary must:
- Very clearly trace cause-effect in order to make the plot and continuity understandable.
- Be token-efficient and plot-accurate.
- Preserve important changes, decisions, conflicts, consequences, and continuity.
- Ignore OOC and flavor-only detail unless it affects future continuity.
- Use the structure below inside the summary string:

# [{{stmbtier}} Title]
Time period: ...

{{stmbtier}} Premise: One sentence describing what this {{stmbtier}} is about.

## Major Beats
- 3-7 bullets focused on plot-changing events

## Character Dynamics
- 1-2 short paragraphs on relationship, emotional, or motive changes

## Key Exchanges
- Up to 8 short exact quotes only if materially important

## Outcome & Continuity
- 4-8 bullets covering decisions, promises, unresolved threads, permanent consequences, and foreshadowed next steps

Keywords must be concrete nouns, objects, places, proper nouns, or distinctive actions.
Do not use abstract emotions, themes, or plot-summary phrases.

Return only the JSON object. No markdown fences. No commentary.`,
    arc_alternate: `You are an expert narrative analyst and memory-engine assistant.
Your task is to combine multiple {{stmbchildtier}} entries into a single coherent {{stmbtier}} summary.

Return JSON only:
{
  "summaries": [
    {
      "title": "Short descriptive {{stmbtier}} title",
      "summary": "Structured {{stmbtier}} summary",
      "keywords": ["keyword1", "keyword2"],
      "member_ids": ["<ID>", "..."]
    }
  ],
  "unassigned_items": [
    { "id": "item-id", "reason": "Why this item does not fit." }
  ]
}

Requirements:
- Respect chronology.
- Keep the summary compact but preserve major plot and continuity.
- Ignore OOC and flavor-only detail unless it affects future events.
- Use member_ids whenever possible.
- Return only valid JSON.`,
    arc_tiny: `You specialize in compressing many small {{stmbchildtier}} entries into compact, coherent {{stmbtier}} summaries.

Return JSON only:
{
  "summaries": [
    { "title": "...", "summary": "...", "keywords": ["..."], "member_ids": ["<ID>", "..."] }
  ],
  "unassigned_items": [
    { "id": "...", "reason": "..." }
  ]
}

Rules:
- Focus on plot, emotional progression, decisions, conflicts, and continuity.
- Very clearly trace cause-effect in order to make the plot and continuity understandable.
- Keep compression aggressive but accurate.
- Identify non-fitting items in unassigned_items.
- No commentary outside JSON.`,
});

export const STMB_SUMMARY_RESPONSE_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['summaries', 'unassigned_items'],
    properties: {
        summaries: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'summary', 'keywords', 'member_ids'],
                properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    keywords: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                    member_ids: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                },
            },
        },
        unassigned_items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'reason'],
                properties: {
                    id: { type: 'string' },
                    reason: { type: 'string' },
                },
            },
        },
    },
});

export class StmbSummaryParseError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'StmbSummaryParseError';
        this.code = code;
        this.rawResponse = typeof options.rawResponse === 'string' ? options.rawResponse : '';
    }
}

function normalizeTier(tier) {
    const parsed = Number(tier);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalizeText(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/^\uFEFF/, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\u2060]/g, '');
}

function makeSummaryParseError(code, message, rawResponse = '') {
    return new StmbSummaryParseError(code, message, { rawResponse });
}

function extractFenceContent(text) {
    const matches = [...String(text || '').matchAll(/```(?:[\w-]+)?\s*([\s\S]*?)```/g)];
    return matches.map(match => String(match[1] || '').trim()).filter(Boolean);
}

function extractBalancedJson(text) {
    const source = String(text || '');
    const start = source.search(/[{\[]/);
    if (start < 0) return null;

    const stack = [];
    let inString = false;
    let escaping = false;
    for (let index = start; index < source.length; index++) {
        const character = source[index];
        if (inString) {
            if (escaping) escaping = false;
            else if (character === '\\') escaping = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{' || character === '[') {
            stack.push(character);
            continue;
        }
        if (character === '}' || character === ']') {
            const open = stack.pop();
            if (!open) return null;
            if ((open === '{' && character !== '}') || (open === '[' && character !== ']')) return null;
            if (stack.length === 0) return source.slice(start, index + 1).trim();
        }
    }

    return null;
}

function stripJsonComments(text) {
    let output = '';
    let inString = false;
    let escaping = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];

        if (inString) {
            output += character;
            if (escaping) escaping = false;
            else if (character === '\\') escaping = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (inLineComment) {
            if (character === '\n') {
                inLineComment = false;
                output += character;
            }
            continue;
        }
        if (inBlockComment) {
            if (character === '*' && next === '/') {
                inBlockComment = false;
                index++;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
            output += character;
            continue;
        }
        if (character === '/' && next === '/') {
            inLineComment = true;
            index++;
            continue;
        }
        if (character === '/' && next === '*') {
            inBlockComment = true;
            index++;
            continue;
        }
        output += character;
    }

    return output;
}

function stripTrailingCommas(text) {
    let output = '';
    let inString = false;
    let escaping = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (inString) {
            output += character;
            if (escaping) escaping = false;
            else if (character === '\\') escaping = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') {
            inString = true;
            output += character;
            continue;
        }
        if (character === ',') {
            let lookahead = index + 1;
            while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead++;
            if (text[lookahead] === '}' || text[lookahead] === ']') {
                continue;
            }
        }
        output += character;
    }

    return output;
}

function normalizeKeywords(keywords) {
    if (!Array.isArray(keywords)) return [];
    const seen = new Set();
    const normalized = [];

    for (const keyword of keywords) {
        const value = String(keyword || '').trim();
        if (!value) continue;
        const lower = value.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        normalized.push(value);
    }

    return normalized;
}

const SUMMARY_MEMBER_INFERENCE_STOPWORDS = new Set([
    'about',
    'after',
    'again',
    'against',
    'all',
    'and',
    'are',
    'but',
    'can',
    'chapter',
    'character',
    'continuity',
    'during',
    'each',
    'from',
    'has',
    'into',
    'key',
    'major',
    'not',
    'outcome',
    'plot',
    'premise',
    'rank',
    'summary',
    'the',
    'their',
    'then',
    'this',
    'through',
    'time',
    'title',
    'with',
]);

function tokenizeSummaryInferenceText(text) {
    return Array.from(String(text || '').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu))
        .map(match => match[0])
        .filter(token => token.length >= 3 && !/^\d+$/.test(token) && !SUMMARY_MEMBER_INFERENCE_STOPWORDS.has(token));
}

function getSummaryInferenceText(summary) {
    return [
        summary?.title,
        summary?.summary,
        Array.isArray(summary?.keywords) ? summary.keywords.join(' ') : '',
    ].filter(Boolean).join(' ');
}

function scoreSummaryBriefMembership(summaryTokens, briefTokens, briefTokenFrequency) {
    let score = 0;
    for (const token of summaryTokens) {
        if (!briefTokens.has(token)) continue;
        score += 1 / Math.max(1, briefTokenFrequency.get(token) || 1);
    }
    return score;
}

function inferSummaryMemberIdsFromText(summaries, briefs) {
    if (!Array.isArray(summaries) || summaries.length === 0 || !Array.isArray(briefs) || briefs.length === 0) {
        return [];
    }

    const briefTokenSets = briefs.map(brief => new Set(tokenizeSummaryInferenceText(`${brief.title || ''} ${brief.content || ''}`)));
    const briefTokenFrequency = new Map();
    for (const tokenSet of briefTokenSets) {
        for (const token of tokenSet) {
            briefTokenFrequency.set(token, (briefTokenFrequency.get(token) || 0) + 1);
        }
    }

    const summaryTokenSets = summaries.map(summary => new Set(tokenizeSummaryInferenceText(getSummaryInferenceText(summary))));
    const scoreMatrix = summaryTokenSets.map(summaryTokens =>
        briefTokenSets.map(briefTokens => scoreSummaryBriefMembership(summaryTokens, briefTokens, briefTokenFrequency)),
    );

    const summaryCount = summaries.length;
    const briefCount = briefs.length;
    if (summaryCount > briefCount) {
        return scoreMatrix.map(row => {
            let bestIndex = -1;
            let bestScore = 0;
            for (let index = 0; index < row.length; index++) {
                if (row[index] > bestScore) {
                    bestScore = row[index];
                    bestIndex = index;
                }
            }
            return bestIndex >= 0 ? [String(briefs[bestIndex].id)] : [];
        });
    }

    const segmentScores = scoreMatrix.map(row => {
        const prefix = [0];
        for (const score of row) {
            prefix.push(prefix[prefix.length - 1] + score);
        }
        return (start, endExclusive) => prefix[endExclusive] - prefix[start];
    });
    const dp = Array.from({ length: summaryCount + 1 }, () => Array(briefCount + 1).fill(-Infinity));
    const previousBoundary = Array.from({ length: summaryCount + 1 }, () => Array(briefCount + 1).fill(-1));
    dp[0][0] = 0;

    for (let summaryIndex = 1; summaryIndex <= summaryCount; summaryIndex++) {
        for (let briefEnd = summaryIndex; briefEnd <= briefCount; briefEnd++) {
            for (let briefStart = summaryIndex - 1; briefStart < briefEnd; briefStart++) {
                const candidateScore = dp[summaryIndex - 1][briefStart]
                    + segmentScores[summaryIndex - 1](briefStart, briefEnd);
                if (candidateScore > dp[summaryIndex][briefEnd]) {
                    dp[summaryIndex][briefEnd] = candidateScore;
                    previousBoundary[summaryIndex][briefEnd] = briefStart;
                }
            }
        }
    }

    if (!Number.isFinite(dp[summaryCount][briefCount]) || dp[summaryCount][briefCount] <= 0) {
        return [];
    }

    const inferred = Array.from({ length: summaryCount }, () => []);
    let briefEnd = briefCount;
    for (let summaryIndex = summaryCount; summaryIndex >= 1; summaryIndex--) {
        const briefStart = previousBoundary[summaryIndex][briefEnd];
        if (briefStart < 0) return [];
        inferred[summaryIndex - 1] = briefs.slice(briefStart, briefEnd).map(brief => String(brief.id));
        briefEnd = briefStart;
    }
    return inferred;
}

function extractClaudeText(response) {
    if (!response || typeof response !== 'object' || !Array.isArray(response.content)) {
        return null;
    }

    const textBlock = response.content.find(block =>
        block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string',
    );
    return textBlock?.text || null;
}

function extractGeminiText(response) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;

    const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').join('');
    return text.trim() || null;
}

function extractSummaryPayload(response) {
    let value = response;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (Array.isArray(value.summaries) || Array.isArray(value.arcs)) {
            return value;
        }
    }

    if (value && typeof value === 'object' && Array.isArray(value?.choices)) {
        const firstChoice = value.choices[0];
        const messageContent = firstChoice?.message?.content;
        if (Array.isArray(messageContent)) {
            const joinedText = messageContent.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim();
            if (joinedText) value = joinedText;
        } else if (typeof messageContent === 'string') {
            value = messageContent;
        } else if (typeof firstChoice?.text === 'string') {
            value = firstChoice.text;
        }
    }

    if (value && typeof value === 'object' && Array.isArray(value.content)) {
        const toolUseInput = value.content.find(block =>
            block && typeof block === 'object' && block.type === 'tool_use' && block.input && typeof block.input === 'object',
        )?.input;
        if (toolUseInput && (Array.isArray(toolUseInput.summaries) || Array.isArray(toolUseInput.arcs))) {
            return toolUseInput;
        }
        value = extractClaudeText(value);
    } else if (value && typeof value === 'object' && typeof value.content === 'string') {
        value = value.content;
    } else if (value && typeof value === 'object') {
        const geminiText = extractGeminiText(value);
        if (geminiText) value = geminiText;
    }

    if (typeof value !== 'string') {
        throw makeSummaryParseError('EMPTY_OR_INVALID', 'Summary response is empty or invalid');
    }

    const normalized = normalizeText(value).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!normalized) {
        throw makeSummaryParseError('EMPTY_OR_INVALID', 'Summary response is empty or invalid');
    }

    const candidates = [];
    candidates.push(...extractFenceContent(normalized));
    const balanced = extractBalancedJson(normalized);
    if (balanced) candidates.push(balanced);
    candidates.push(normalized);

    for (const candidate of [...new Set(candidates.map(item => String(item || '').trim()).filter(Boolean))]) {
        try {
            const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(candidate)));
            if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.summaries) || Array.isArray(parsed.arcs))) {
                return parsed;
            }
        } catch {
            // Continue trying candidates.
        }
    }

    throw makeSummaryParseError('MALFORMED', 'Model did not return valid summary JSON', normalized);
}

export function getSummaryTierConfig(tier) {
    const normalizedTier = normalizeTier(tier);
    if (SUMMARY_TIER_MAP.has(normalizedTier)) {
        return SUMMARY_TIER_MAP.get(normalizedTier);
    }

    return {
        tier: normalizedTier,
        key: `tier${normalizedTier}`,
        label: `Tier ${normalizedTier}`,
    };
}

export function getSummaryTierLabel(tier) {
    return getSummaryTierConfig(tier).label;
}

export function pluralizeSummaryLabel(label) {
    const normalized = String(label || '').trim();
    if (!normalized) return '';
    return /y$/i.test(normalized) ? `${normalized.slice(0, -1)}ies` : `${normalized}s`;
}

export function getSummaryTypeKey(tier) {
    return getSummaryTierConfig(tier).key;
}

export function getSourceTierForTarget(targetTier) {
    return Math.max(0, normalizeTier(targetTier) - 1);
}

export function getDefaultSummaryTitleFormat(tier) {
    const config = getSummaryTierConfig(tier);
    if (config.tier <= 0) return '[000] - {{title}}';
    return `[${String(config.key || 'tier').toUpperCase()} 000] - {{title}}`;
}

export function getDefaultSummaryMinChildren(tier) {
    return normalizeTier(tier) <= 0 ? 0 : DEFAULT_MIN_CHILDREN;
}

export function normalizeSummaryMinChildren(value, fallback = DEFAULT_MIN_CHILDREN) {
    const normalizeCandidate = candidate => {
        const parsed = Number(candidate);
        if (!Number.isFinite(parsed)) {
            return null;
        }

        const normalized = Math.trunc(parsed);
        return normalized === 0 ? 0 : Math.max(MIN_SUMMARY_CHILDREN, normalized);
    };

    const normalizedValue = normalizeCandidate(value);
    if (normalizedValue !== null) {
        return normalizedValue;
    }

    const normalizedFallback = normalizeCandidate(fallback);
    if (normalizedFallback !== null) {
        return normalizedFallback;
    }

    return DEFAULT_MIN_CHILDREN;
}

export function isSummaryEntry(entry) {
    return !!entry && entry.stmbSummary === true;
}

export function getEntrySummaryTier(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    if (entry.stmbSummary === true) {
        const tier = normalizeTier(entry.stmbSummaryTier);
        return tier > 0 ? tier : 1;
    }
    if (entry.stmbArc === true || String(entry.type || '').toLowerCase() === 'arc') {
        return 1;
    }
    return 0;
}

export function isEligibleSummarySourceEntry(entry, sourceTier) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry[STMB_MANAGED_FLAG] !== true) return false;
    if (entry.disable) return false;
    return getEntrySummaryTier(entry) === normalizeTier(sourceTier);
}

export function migrateLorebookSummarySchema(lorebookData) {
    const entries = Object.values(lorebookData?.entries || {});
    let changed = false;

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;

        const isLegacyArc = entry.stmbArc === true || String(entry.type || '').toLowerCase() === 'arc';
        if (isLegacyArc) {
            if (entry.stmbSummary !== true) {
                entry.stmbSummary = true;
                changed = true;
            }
            if (normalizeTier(entry.stmbSummaryTier) !== 1) {
                entry.stmbSummaryTier = 1;
                changed = true;
            }
            if (entry.type !== 'arc') {
                entry.type = 'arc';
                changed = true;
            }
        }

        if (entry.disabledByArcId !== undefined && entry.disabledBySummaryId === undefined) {
            entry.disabledBySummaryId = entry.disabledByArcId ?? null;
            changed = true;
        }

        if ('stmbArc' in entry) {
            delete entry.stmbArc;
            changed = true;
        }
        if ('disabledByArcId' in entry) {
            delete entry.disabledByArcId;
            changed = true;
        }
    }

    return changed;
}

export function identifyManagedSummaryEntries(entries, targetTier = null) {
    const normalizedTargetTier = targetTier === null || targetTier === undefined ? null : normalizeTier(targetTier);

    return Object.values(entries || {})
        .filter(entry => entry && entry[STMB_MANAGED_FLAG] === true && isSummaryEntry(entry))
        .filter(entry => normalizedTargetTier === null || getEntrySummaryTier(entry) === normalizedTargetTier)
        .sort((left, right) => {
            const leftSequence = parseSequenceFromTitle(left.comment || left.title || '') ?? Number(left.uid) ?? 0;
            const rightSequence = parseSequenceFromTitle(right.comment || right.title || '') ?? Number(right.uid) ?? 0;
            return leftSequence - rightSequence;
        });
}

export function identifyEligibleSummarySourceEntries(entries, targetTier) {
    const sourceTier = getSourceTierForTarget(targetTier);
    return Object.values(entries || {})
        .filter(entry => isEligibleSummarySourceEntry(entry, sourceTier))
        .sort((left, right) => {
            const leftSequence = parseSequenceFromTitle(left.comment || left.title || '') ?? Number(left.uid) ?? 0;
            const rightSequence = parseSequenceFromTitle(right.comment || right.title || '') ?? Number(right.uid) ?? 0;
            return leftSequence - rightSequence;
        });
}

export function resolveSelectedSummarySourceEntries(entries, targetTier, selectedEntryIds = null) {
    const eligibleEntries = identifyEligibleSummarySourceEntries(entries, targetTier);
    if (!Array.isArray(selectedEntryIds)) {
        return eligibleEntries;
    }

    const selectedIds = new Set(selectedEntryIds.map(value => String(value)));
    return eligibleEntries.filter(entry => selectedIds.has(String(entry?.uid)));
}

export function resolveSummaryPromptPlaceholders(promptText, { targetTier = 1, childTier = null, parentTier = null } = {}) {
    const resolvedChildTier = childTier === null || childTier === undefined
        ? getSourceTierForTarget(targetTier)
        : childTier;
    const resolvedParentTier = parentTier === null || parentTier === undefined
        ? targetTier + 1
        : parentTier;

    return String(promptText || '')
        .replace(/\{\{\s*stmbtier\s*\}\}/gi, getSummaryTierLabel(targetTier))
        .replace(/\{\{\s*stmbchildtier\s*\}\}/gi, getSummaryTierLabel(resolvedChildTier))
        .replace(/\{\{\s*stmbparenttier\s*\}\}/gi, getSummaryTierLabel(resolvedParentTier));
}

export function buildBriefsFromEntries(entries) {
    const briefs = [];

    for (const entry of entries || []) {
        if (!entry || typeof entry !== 'object') continue;
        briefs.push({
            id: String(entry.uid ?? ''),
            order: parseSequenceFromTitle(entry.comment ?? '') ?? 0,
            title: String(entry.comment || 'Untitled').trim(),
            content: String(entry.content || '').trim(),
        });
    }

    briefs.sort((left, right) => left.order - right.order);
    return briefs;
}

export function buildSummaryAnalysisPrompt({
    briefs,
    previousSummary = null,
    previousOrder = null,
    promptText = null,
    targetTier = 1,
}) {
    const header = resolveSummaryPromptPlaceholders(
        promptText || STMB_DEFAULT_SUMMARY_PROMPTS.arc_default,
        { targetTier },
    );
    const targetLabel = getSummaryTierLabel(targetTier).toUpperCase();
    const childTierLabel = getSummaryTierLabel(getSourceTierForTarget(targetTier));
    const childPlural = /y$/i.test(childTierLabel) ? `${childTierLabel.slice(0, -1)}ies` : `${childTierLabel}s`;
    const childPluralLabel = childPlural.toUpperCase();
    const lines = [];

    lines.push('Important: member_ids must refer to the numbered source entries below, such as "001" or "Memory 001", not character names, groups, or participants.');
    lines.push('');

    if (previousSummary) {
        lines.push(`=== PREVIOUS ${targetLabel} (CANON — DO NOT REWRITE, DO NOT INCLUDE IN YOUR NEW SUMMARY) ===`);
        if (previousOrder !== null && previousOrder !== undefined) {
            lines.push(`${getSummaryTierLabel(targetTier)} ${previousOrder}`);
        }
        lines.push(String(previousSummary).trim());
        lines.push(`=== END PREVIOUS ${targetLabel} ===`);
        lines.push('');
    }

    lines.push(`=== ${childPluralLabel} ===`);
    briefs.forEach((brief, index) => {
        const sequence = String(index + 1).padStart(3, '0');
        lines.push(`=== ${childTierLabel} ${sequence} ===`);
        lines.push(`Title: ${String(brief.title || '').trim()}`);
        lines.push(`Contents: ${String(brief.content || '').trim()}`);
        lines.push(`=== end ${childTierLabel} ${sequence} ===`);
        lines.push('');
    });
    lines.push(`=== END ${childPluralLabel} ===`);
    lines.push('');

    return `${header}\n\n${lines.join('\n')}`;
}

export function parseSummaryJsonResponse(response) {
    const parsed = extractSummaryPayload(response);
    const summaries = Array.isArray(parsed.summaries)
        ? parsed.summaries
        : Array.isArray(parsed.arcs)
            ? parsed.arcs
            : [];
    const unassignedItems = Array.isArray(parsed.unassigned_items)
        ? parsed.unassigned_items
        : Array.isArray(parsed.unassigned_memories)
            ? parsed.unassigned_memories
            : [];

    return {
        summaries: summaries
            .filter(item =>
                item &&
                typeof item.title === 'string' &&
                item.title.trim() &&
                typeof item.summary === 'string' &&
                item.summary.trim(),
            )
            .map(item => ({
                title: item.title.trim(),
                summary: item.summary.trim(),
                keywords: normalizeKeywords(item.keywords),
                member_ids: Array.isArray(item.member_ids) ? item.member_ids.map(value => String(value || '').trim()).filter(Boolean) : [],
            })),
        unassigned_items: unassignedItems
            .filter(item =>
                item &&
                typeof item.id === 'string' &&
                item.id.trim() &&
                typeof item.reason === 'string',
            )
            .map(item => ({
                id: item.id.trim(),
                reason: item.reason,
            })),
    };
}

export function createSummaryCandidatesFromResponse(parsedResponse, sourceEntries) {
    const briefs = buildBriefsFromEntries(sourceEntries);
    const idResolver = new Map();
    const summaries = Array.isArray(parsedResponse?.summaries) ? parsedResponse.summaries : [];

    if (summaries.length > 1) {
        const hasMissingMemberIds = summaries.some(item => !Array.isArray(item?.member_ids) || item.member_ids.length === 0);
        if (hasMissingMemberIds) {
            throw makeSummaryParseError(
                'AMBIGUOUS_MEMBER_IDS',
                'Every summary in a multi-summary response must provide member_ids to avoid ambiguous assignment.',
                JSON.stringify(parsedResponse ?? {}),
            );
        }
    }

    briefs.forEach((brief, index) => {
        const uid = String(brief.id);
        idResolver.set(uid, uid);
        const sequence = String(index + 1).padStart(3, '0');
        idResolver.set(sequence, uid);
        idResolver.set(String(index + 1), uid);
    });

    const resolveId = value => {
        const rawValue = String(value || '').trim();
        if (!rawValue) return null;

        const exactMatch = idResolver.get(rawValue);
        if (exactMatch) return exactMatch;

        const sequence = parseSequenceFromTitle(rawValue);
        if (!Number.isFinite(sequence)) return null;

        return idResolver.get(String(sequence).padStart(3, '0')) || idResolver.get(String(sequence)) || null;
    };
    const allBriefIds = briefs.map(brief => String(brief.id));
    const unassignedIds = new Set();
    for (const item of parsedResponse.unassigned_items || []) {
        const resolved = resolveId(item.id);
        if (resolved) unassignedIds.add(resolved);
    }
    const inferredMemberIds = summaries.length > 1 ? inferSummaryMemberIdsFromText(summaries, briefs) : [];

    const summaryCandidates = [];
    for (let index = 0; index < summaries.length; index++) {
        const item = summaries[index];
        const hasExplicitMemberIds = Array.isArray(item.member_ids) && item.member_ids.length > 0;
        let memberIds = hasExplicitMemberIds
            ? item.member_ids.map(resolveId).filter(Boolean)
            : [];
        if (memberIds.length === 0 && summaries.length > 1 && hasExplicitMemberIds) {
            memberIds = inferredMemberIds[index] || [];
        }
        if (memberIds.length === 0 && summaries.length > 1) {
            throw makeSummaryParseError(
                'AMBIGUOUS_MEMBER_IDS',
                'A multi-summary response contained missing or unresolvable member_ids.',
                JSON.stringify(parsedResponse ?? {}),
            );
        }
        if (memberIds.length === 0 && !hasExplicitMemberIds) {
            memberIds = allBriefIds;
        }
        if (memberIds.length === 0) {
            throw makeSummaryParseError(
                'AMBIGUOUS_MEMBER_IDS',
                'A summary response contained unresolvable member_ids.',
                JSON.stringify(parsedResponse ?? {}),
            );
        }
        memberIds = Array.from(new Set(memberIds)).filter(id => !unassignedIds.has(id));
        if (memberIds.length === 0) continue;

        summaryCandidates.push({
            title: item.title,
            summary: item.summary,
            keywords: normalizeKeywords(item.keywords),
            memberIds,
        });
    }

    return {
        summaryCandidates,
        leftovers: briefs.map(brief => String(brief.id)).filter(id => !summaryCandidates.some(candidate => candidate.memberIds.includes(id))),
    };
}

export function getNextSummaryNumber(lorebookData, targetTier = 1) {
    const entries = identifyManagedSummaryEntries(lorebookData?.entries || {}, targetTier);
    let max = 0;

    for (const entry of entries) {
        const sequence = parseSequenceFromTitle(entry.comment || '');
        if (Number.isFinite(sequence) && sequence > max) {
            max = sequence;
        }
    }

    return max + 1;
}

export function formatSummaryTitle(targetTier, format, baseTitle, sequenceNumber) {
    const safeTitle = String(baseTitle || '').trim();
    let title = String(format || '').trim() || getDefaultSummaryTitleFormat(targetTier);
    title = title.replace(/\{\{\s*title\s*\}\}/g, safeTitle);

    const numbered = title.match(/\[([^\]]*?)(0{2,})([^\]]*?)\]/);
    if (numbered) {
        const digits = numbered[2].length;
        const padded = String(sequenceNumber).padStart(digits, '0');
        return title.replace(numbered[0], `[${numbered[1]}${padded}${numbered[3]}]`);
    }

    const typeKey = String(getSummaryTypeKey(targetTier) || 'tier').toUpperCase();
    return `[${typeKey} ${String(sequenceNumber).padStart(3, '0')}] ${safeTitle}`;
}

export function createManagedSummaryEntryData(summaryCandidate, {
    targetTier = 1,
    titleFormat = null,
    sequenceNumber = 1,
} = {}) {
    return {
        comment: formatSummaryTitle(targetTier, titleFormat, summaryCandidate.title, sequenceNumber),
        content: String(summaryCandidate.summary || '').trim(),
        key: normalizeKeywords(summaryCandidate.keywords),
        [STMB_MANAGED_FLAG]: true,
        stmbSummary: true,
        stmbSummaryTier: Number(targetTier),
        type: getSummaryTypeKey(targetTier),
        disable: false,
    };
}
