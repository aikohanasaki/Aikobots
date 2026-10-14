// Copyright (C) 2024–2026 Aiko Hanasaki
// SPDX-License-Identifier: AGPL-3.0-only

export const COMBINE_CLIPS_INSTRUCTION = `Here are multiple information snippets covering related topics.

Analyze and consolidate them into a single coherent informational entry.

- Preserve all unique, relevant information.
- Remove redundancies and repeated details.
- Rephrase for clarity, accuracy, and consistency.
- Combine overlapping information rather than repeating it.
- If snippets conflict, prefer information explicitly established as a correction or update. Otherwise, preserve the conflicting claims concisely; do not invent a resolution.
- Do not add facts that are not supported by the source snippets.
- Condense wording aggressively for token efficiency while preserving unique facts, qualifications, and meaningful distinctions.`;

export const DEFAULT_COMBINE_CLIPS_PROMPT = `${COMBINE_CLIPS_INSTRUCTION}\n\nNew entry title: {{TITLE}}\n\n{{SOURCE_CLIPS}}\n\nReturn only the consolidated entry body, without a title or wrapper markers.`;

/** Requires exactly one source insertion point. */
export function validateCombineClipsPrompt(template) {
    if (typeof template !== 'string' || template.split('{{SOURCE_CLIPS}}').length !== 2) throw new Error('The Combine Clips prompt must contain {{SOURCE_CLIPS}} exactly once.');
    return template;
}

/** Recognizes both ordinary and Topical Clip titles. */
export function isClipEntryTitle(title) {
    return typeof title === 'string' && title.trimEnd().endsWith('[STMB Clip]');
}

/** Only persisted Clips with unambiguous identities can be combined. */
export function isClipForCombination(entry) {
    return entry?.uid !== null && entry?.uid !== undefined && String(entry.uid) !== '' && isClipEntryTitle(entry.comment);
}

/** Preserves source order while deduplicating trimmed primary keywords. */
export function unionClipKeywords(entries) {
    return [...new Set(entries.flatMap(entry => Array.isArray(entry.key) ? entry.key : [])
        .map(keyword => String(keyword ?? '').trim()).filter(Boolean))];
}

/** Keeps only checked source IDs that remain visible after a visibility toggle. */
export function visibleCombineClipSelection(entries, checkedIds, showDisabled) {
    const visible = entries.filter(entry => showDisabled || !entry.disable);
    const ids = new Set(checkedIds);
    return { visible, checked: visible.filter(entry => ids.has(String(entry.uid))).map(entry => String(entry.uid)) };
}

/** Captures exactly the source fields used by combination and disabling. */
export function snapshotCombineSource(entry) {
    return {
        uid: String(entry.uid), title: entry.comment, content: entry.content,
        keywords: Array.isArray(entry.key) ? [...entry.key] : [],
        topical: Boolean(entry.data?.extensions?.aikobots?.topical_clip),
        disabled: Boolean(entry.disable),
    };
}

/** Rejects missing, duplicate, ineligible, or changed sources before saving. */
export function areCombineSourcesCurrent(snapshots, entries) {
    if (!Array.isArray(snapshots) || snapshots.length < 2) return false;
    const byUid = new Map();
    for (const entry of entries) {
        if (!isClipForCombination(entry)) continue;
        const uid = String(entry.uid);
        if (byUid.has(uid)) return false;
        byUid.set(uid, entry);
    }
    const seen = new Set();
    return snapshots.every(snapshot => {
        if (!snapshot || typeof snapshot.uid !== 'string' || seen.has(snapshot.uid)) return false;
        seen.add(snapshot.uid);
        const entry = byUid.get(snapshot.uid);
        if (!entry) return false;
        const current = snapshotCombineSource(entry);
        return Object.keys(current).every(key => JSON.stringify(current[key]) === JSON.stringify(snapshot[key]));
    });
}

/** Builds the upstream consolidation prompt from selected ordinary or Topical Clips. */
export function buildCombineClipsPrompt(entries, title, template = DEFAULT_COMBINE_CLIPS_PROMPT) {
    if (entries.length < 2 || entries.some(entry => !isClipForCombination(entry))) throw new Error('Invalid Clip selection.');
    const sources = entries.map((entry, index) =>
        `=== SNIPPET ${index + 1}: ${entry.comment} ===\n${entry.content}\n=== END SNIPPET ${index + 1} ===`,
    ).join('\n\n');
    return validateCombineClipsPrompt(template).replace(/{{(TITLE|SOURCE_CLIPS)}}/g, (_, key) => key === 'TITLE' ? title : sources);
}
