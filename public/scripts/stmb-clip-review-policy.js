import { stableHashString } from './hashing.js';

export const CLIP_REVIEW_TEMPLATE_KEY = 'clip-review';
export const CLIP_REVIEW_ENTRY_TITLE = 'Memory Assistance (STMB SidePrompt)';
export const LEGACY_CLIP_REVIEW_ENTRY_TITLE = 'Clip Review (STMB SidePrompt)';
export const CLIP_REVIEW_METADATA_KEY = 'STMB_clipReview';
export const MEMORY_ASSISTANCE_MODE_OFF = 'off';
export const MEMORY_ASSISTANCE_MODE_UPDATE = 'update';
export const MEMORY_ASSISTANCE_MODE_UPDATE_AND_SUGGEST = 'update_and_suggest';
export const MEMORY_ASSISTANCE_MODE_AUTOMATIC = 'automatic';
export const CLIP_LONG_ENTRY_TOKEN_THRESHOLD = 500;
export const CLIP_REVIEW_REQUIRES_REVIEW = 'CLIP_REVIEW_REQUIRES_REVIEW';

export const DEFAULT_CLIP_REVIEW_PROMPT = `SYSTEM: You review existing Memory Book Clips against one newly processed chat scene.

For each supplied Clip, gather all facts concerning this topic. Resolve later information against earlier information. Distinguish current state, completed events, decisions, unresolved issues, and future plans. Preserve exact details where available.

Rules:
- Use only facts directly supported by the supplied scene.
- For an ordinary Clip, suggest one exact excerpt from a single source message; never rewrite or remove its existing content.
- For a Topical Clip, return a complete revised body that preserves useful existing information, merges relevant new facts, removes redundancy, and notes genuine conflicts.
- Refer to entries only by their supplied UID.
- Repetition, paraphrase, or merely related discussion does not require an update.
- Omit entries that do not need an update.
- Do not greet, explain the task, or return Markdown fences.`;

export const DEFAULT_CLIP_SUGGESTIONS_PROMPT = `SYSTEM: Review the supplied chat scene and suggest new Topical Clips based on the scene.

1. Review the scene and identify concrete topics at discussion. Concisely classify 0-5 topics identified in the scene.
2. Compare the identified topics against the supplied existing Topical Clips list. ONLY suggest new Topical Clips if a topic is not already covered by an existing Topical Clip.
3. Limit your suggestions to topics that are directly supported and substantially discussed. Do not suggest topics that are only tangentially related or not mentioned in the scene.

Rules:
- Use only facts directly supported by the supplied scene.
- Prefer objective details over subjective impressions.
- Repetition, paraphrase, or merely related discussion does not require an update.
- Omit entries that do not need an update.
- Do not greet, explain the task, or return Markdown fences.`;

/** Returns the checked Clip-review choice UIDs in DOM order. */
export function getSelectedClipReviewUids(choices = []) {
    return Array.from(choices)
        .filter(choice => choice?.checked)
        .map(choice => String(choice.value));
}

/** Normalizes persisted Memory Assistance modes, including the legacy checkbox. */
export function normalizeMemoryAssistanceMode(value, legacyAlwaysRun = false) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'suggest') return MEMORY_ASSISTANCE_MODE_UPDATE;
    if (['update and suggest', 'update-and-suggest'].includes(normalized)) return MEMORY_ASSISTANCE_MODE_UPDATE_AND_SUGGEST;
    if ([MEMORY_ASSISTANCE_MODE_OFF, MEMORY_ASSISTANCE_MODE_UPDATE, MEMORY_ASSISTANCE_MODE_UPDATE_AND_SUGGEST, MEMORY_ASSISTANCE_MODE_AUTOMATIC].includes(normalized)) {
        return normalized;
    }
    return legacyAlwaysRun ? MEMORY_ASSISTANCE_MODE_UPDATE : MEMORY_ASSISTANCE_MODE_OFF;
}

export function isTopicalClipEntry(entry) {
    return Boolean(entry?.data?.extensions?.aikobots?.topical_clip);
}

/** Checks the shared approximate-token threshold used for long Clip warnings. */
export function isLongClipEntryContent(content) {
    return Math.ceil(String(content || '').length / 4) > CLIP_LONG_ENTRY_TOKEN_THRESHOLD;
}

/** Checks the optional immutable identity evidence supplied with a reviewed Clip update. */
export function matchesClipReviewTargetIdentity(entry, expectedTitle = '', expectedClipType = '') {
    if (expectedTitle && String(entry?.comment || '') !== String(expectedTitle)) return false;
    const actualType = isTopicalClipEntry(entry) ? 'topical' : 'ordinary';
    return !expectedClipType || actualType === expectedClipType;
}

export function makeClipReviewRecord(entry) {
    return {
        uid: String(entry?.uid ?? entry?.id ?? ''),
        type: isTopicalClipEntry(entry) ? 'topical' : 'ordinary',
        title: String(entry?.comment || ''),
        topic: String(entry?.data?.extensions?.aikobots?.topical_clip?.topic || ''),
        keywords: Array.isArray(entry?.key) ? entry.key.map(String) : [],
        content: String(entry?.content || ''),
        contentHash: stableHashString(entry?.content || ''),
    };
}

export function packClipReviewBatches(records, sceneText, tokenLimit, reserveTokens = 1200) {
    const estimate = value => Math.ceil(String(value || '').length / 4);
    const capacity = Math.max(1, Number(tokenLimit) - reserveTokens - estimate(sceneText));
    const batches = [];
    let current = [];
    let used = 0;
    for (const record of records || []) {
        const cost = estimate(JSON.stringify(record)) + 80;
        if (current.length > 0 && used + cost > capacity) {
            batches.push(current);
            current = [];
            used = 0;
        }
        current.push(record);
        used += cost;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

export function shouldPreserveClipReviewReport({ batchCount = 0, failedBatchCount = 0, suggestionPassRequested = false, suggestionPassSucceeded = false, suggestionPassFailed = false } = {}) {
    const allReviewBatchesFailed = batchCount > 0 && failedBatchCount === batchCount;
    const topicOnlyPassFailed = batchCount === 0 && suggestionPassRequested && suggestionPassFailed;
    return (allReviewBatchesFailed && (!suggestionPassRequested || !suggestionPassSucceeded)) || topicOnlyPassFailed;
}

function stripJsonFence(text) {
    const raw = String(text || '').trim();
    const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : raw;
}

function normalizeForMatch(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForComparison(value) {
    return normalizeForMatch(value).toLocaleLowerCase();
}

export function parseClipSuggestionsResponse(text, existingTopicalRecords = []) {
    const parsed = JSON.parse(stripJsonFence(text));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.topics)) {
        throw new Error('Memory Assistance topic suggestions must be one JSON object containing a topics array.');
    }
    const existingTopics = new Set((existingTopicalRecords || [])
        .filter(record => record?.type === 'topical')
        .flatMap(record => [record.topic, record.title])
        .map(normalizeForComparison)
        .filter(Boolean));
    const acceptedTopics = new Set();
    const suggestions = [];
    for (const item of parsed.topics.slice(0, 5)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const topic = normalizeForMatch(item.topic);
        const comparableTopic = normalizeForComparison(topic);
        if (!topic || existingTopics.has(comparableTopic) || acceptedTopics.has(comparableTopic)) continue;
        const seenKeywords = new Set();
        const keywords = (Array.isArray(item.keywords) ? item.keywords : [])
            .map(normalizeForMatch)
            .filter(keyword => {
                const comparable = normalizeForComparison(keyword);
                if (!comparable || seenKeywords.has(comparable)) return false;
                seenKeywords.add(comparable);
                return true;
            });
        if (keywords.length === 0) keywords.push(topic);
        acceptedTopics.add(comparableTopic);
        suggestions.push({
            id: `topic-${stableHashString(`${comparableTopic}\u0000${keywords.map(normalizeForComparison).join('\u0000')}`)}`,
            topic,
            keywords,
        });
    }
    return suggestions;
}

export function parseClipReviewResponse(text, records, sceneMessages) {
    const parsed = JSON.parse(stripJsonFence(text));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Memory Assistance response must be one JSON object mapping Clip UIDs to suggestions.');
    }
    const byUid = new Map((records || []).map(record => [String(record.uid), record]));
    const messages = (sceneMessages || []).map(message => ({
        id: Number(message.id),
        text: normalizeForMatch(message.mes),
    }));
    const accepted = [];
    const responseEntries = Object.entries(parsed);
    let hasSuggestion = false;
    let hasInvalidEntry = false;
    for (const [rawUid, rawSuggestion] of responseEntries) {
        const uid = String(rawUid);
        const record = byUid.get(uid);
        if (!record || typeof rawSuggestion !== 'string') {
            hasInvalidEntry = true;
            continue;
        }
        const suggestion = rawSuggestion.trim();
        if (!suggestion) continue;
        hasSuggestion = true;
        if (record.type === 'ordinary') {
            const normalizedSuggestion = normalizeForMatch(suggestion);
            const sourceMessage = normalizedSuggestion ? messages.find(message => message.text.includes(normalizedSuggestion)) : null;
            if (!sourceMessage) continue;
            accepted.push({
                uid,
                type: record.type,
                title: record.title,
                evidenceMessageIds: [sourceMessage.id],
                additions: [{ messageId: sourceMessage.id, text: suggestion }],
                contentHash: record.contentHash,
            });
        } else {
            accepted.push({
                uid,
                type: record.type,
                title: record.title,
                evidenceMessageIds: [],
                proposedContent: suggestion,
                contentHash: record.contentHash,
            });
        }
    }
    if (accepted.length === 0 && (hasSuggestion || hasInvalidEntry)) {
        throw new Error('Memory Assistance returned suggestions, but none matched the requested Clips and response rules.');
    }
    return accepted;
}

/** Rebuilds edited ordinary-Clip additions while preserving their source message IDs. */
export function rebuildOrdinaryClipAdditions(candidate, editedText) {
    const additions = Array.isArray(candidate?.additions) ? candidate.additions : [];
    const fallbackAddition = additions[0] || {};
    const fallbackMessageId = fallbackAddition.messageId ?? candidate?.evidenceMessageIds?.[0];
    return String(editedText ?? '').split(/\r?\n/).map((text, index) => {
        const addition = additions[index] || fallbackAddition;
        return {
            ...addition,
            ...(addition.messageId == null && fallbackMessageId != null ? { messageId: fallbackMessageId } : {}),
            text: text.trim(),
        };
    }).filter(item => item.text);
}

/** Applies ordinary Clip candidates sequentially while preserving failures for review. */
export async function applyAutomaticClipReviewCandidates(candidates, applySuggestion, { signal, applyError, onFailure } = {}) {
    const result = { pendingCandidates: [], appliedCount: 0, failedCount: 0, reviewCount: 0 };
    for (const candidate of candidates || []) {
        signal?.throwIfAborted();
        if (candidate.type === 'topical') {
            result.pendingCandidates.push(candidate);
            result.reviewCount++;
            continue;
        }
        try {
            if (await applySuggestion(candidate)) result.appliedCount++;
        } catch (error) {
            if (signal?.aborted) throw error;
            if (error?.code === CLIP_REVIEW_REQUIRES_REVIEW) {
                result.reviewCount++;
                result.pendingCandidates.push({ ...candidate, reviewReason: error.message });
                continue;
            }
            onFailure?.(error);
            result.failedCount++;
            result.pendingCandidates.push({ ...candidate, applyError });
        }
        signal?.throwIfAborted();
    }
    return result;
}

export function renderClipReviewReport({ sceneStart, sceneEnd, candidates = [], topicSuggestions = [], status = 'complete', appliedCount = 0, failedCount = 0, reviewCount = 0, failedBatchCount = 0, suggestionPassCompleted = false, suggestionPassFailed = false, suggestionPassDeclined = false }) {
    const lines = ['=== Memory Assistance ===', `Scene: messages ${sceneStart}-${sceneEnd}`];
    if (status === 'automatic') {
        lines.push('', `Automatic mode applied ${appliedCount} Clip update${appliedCount === 1 ? '' : 's'}.`);
        if (reviewCount > 0) lines.push(`${reviewCount} Clip update${reviewCount === 1 ? '' : 's'} require${reviewCount === 1 ? 's' : ''} approval and remain below for review.`);
        if (failedCount > 0) lines.push(`${failedCount} suggested update${failedCount === 1 ? '' : 's'} could not be applied and remain below for review.`);
        if (reviewCount === 0 && failedCount === 0) lines.push('There are no suggestions awaiting review.');
        if (failedBatchCount > 0) lines.push(`${failedBatchCount} review batch${failedBatchCount === 1 ? '' : 'es'} failed, so the automatic results may be incomplete.`);
    } else if (status === 'cancelled') lines.push('', 'The latest Memory Assistance run was cancelled. There are no current suggestions.');
    else if (status === 'pending') lines.push('', 'Clip selection is required before this review can run.');
    else if (status === 'partial' && candidates.length === 0 && topicSuggestions.length === 0) {
        lines.push('', 'Memory Assistance was incomplete. No reliable suggestions were saved.');
    } else if (candidates.length === 0) {
        lines.push('', 'No Clip updates were suggested for this scene.');
    }
    if (suggestionPassFailed) lines.push('', 'Warning: Topical Clip discovery failed, so new-topic suggestions are unavailable for this scene.');
    if (suggestionPassDeclined) lines.push('', 'Topical Clip discovery was skipped because the token warning was declined.');
    if (status !== 'automatic' && failedBatchCount > 0) lines.push('', `${failedBatchCount} review batch${failedBatchCount === 1 ? '' : 'es'} failed, so existing-Clip update suggestions may be incomplete.`);
    if (candidates.length > 0) {
        if (status === 'partial') lines.push('', 'Warning: one or more Memory Assistance batches failed. The suggestions below are incomplete.');
        for (const candidate of candidates) {
            lines.push('', `## ${candidate.title}`, `Type: ${candidate.type === 'topical' ? 'Topical Clip' : 'Clip'}`);
            if (candidate.applyError) lines.push(`Automatic update error: ${candidate.applyError}`);
            if (candidate.reviewReason) lines.push(`Review required: ${candidate.reviewReason}`);
            if (candidate.reason) lines.push(`Reason: ${candidate.reason}`);
            if (candidate.evidenceMessageIds?.length) lines.push(`Source message: ${candidate.evidenceMessageIds.join(', ')}`);
            if (candidate.type === 'ordinary') {
                const additions = (candidate.additions || []).map(item => {
                    const messageId = String(item?.messageId ?? '').trim();
                    return messageId ? `- [${messageId}] ${item?.text ?? ''}` : `- ${item?.text ?? ''}`;
                });
                lines.push('Suggested additions:', ...additions);
            }
            else lines.push('Suggested replacement:', candidate.proposedContent);
        }
    }
    if (topicSuggestions.length > 0) {
        lines.push('', '## Suggested New Topical Clips');
        for (const suggestion of topicSuggestions) lines.push(`- ${suggestion.topic}${suggestion.keywords?.length ? ` — Keywords: ${suggestion.keywords.join(', ')}` : ''}`);
    } else if (suggestionPassCompleted) {
        lines.push('', 'No new Topical Clip topics were suggested. Topics can still be added manually from Memory Assistance Suggestions.');
    }
    lines.push('', '=== END Memory Assistance ===');
    return lines.join('\n');
}
