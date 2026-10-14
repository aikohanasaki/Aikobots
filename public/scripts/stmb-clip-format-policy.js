export const DEFAULT_CLIP_FORMAT = '=== {{TITLE}} ===\n\n{{CONTENT}}\n\n=== END {{TITLE}} ===';

/** Returns the saved format category of a Clip. */
export function getClipFormatKind(entry) {
    return entry?.data?.extensions?.aikobots?.combined_clips ? 'combined' : 'topical';
}

/** Requires one content insertion point. */
export function validateClipFormat(template) {
    if (typeof template !== 'string' || template.split('{{CONTENT}}').length !== 2) throw new Error('The format must contain {{CONTENT}} exactly once.');
    return template;
}

/** Renders only recognized placeholders and preserves literal replacement syntax. */
export function renderClipFormat(template, title, content) {
    return validateClipFormat(template).replace(/{{(TITLE|CONTENT)}}/g, (_, key) => key === 'TITLE' ? String(title) : String(content));
}

/** Reads a Clip body only when its saved format still matches the content. */
export function readFormattedClip(entry) {
    const format = entry?.data?.extensions?.aikobots?.clip_format;
    if (typeof format?.template !== 'string' || typeof format?.title !== 'string') return null;
    try {
        const [before, after] = validateClipFormat(format.template).split('{{CONTENT}}');
        const prefix = before.replace(/{{TITLE}}/g, () => format.title);
        const suffix = after.replace(/{{TITLE}}/g, () => format.title);
        const content = String(entry.content ?? '');
        if (!content.startsWith(prefix) || !content.endsWith(suffix) || content.length < prefix.length + suffix.length) return null;
        return { template: format.template, title: format.title, body: content.slice(prefix.length, content.length - suffix.length) };
    } catch { return null; }
}

/** Adds format metadata without replacing other entry metadata. */
export function withClipFormatData(data, template, title) {
    return { ...data, extensions: { ...data?.extensions, aikobots: { ...data?.extensions?.aikobots, clip_format: { template, title } } } };
}

/** Removes stale format metadata without touching other entry fields. */
export function withoutClipFormatData(data) {
    const next = structuredClone(data || {});
    if (next.extensions?.aikobots) delete next.extensions.aikobots.clip_format;
    return next;
}
