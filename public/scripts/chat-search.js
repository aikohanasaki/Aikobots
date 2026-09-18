/**
 * Fetches chat summaries from the shared Manage Chats search endpoint.
 * @param {{ query?: string, avatarUrl?: string|null, groupId?: string|null, requestHeaders: HeadersInit, fetchImpl?: typeof fetch }} options
 * @returns {Promise<Array<object>>}
 */
export async function fetchChatSearchResults({
    query = '',
    avatarUrl = null,
    groupId = null,
    requestHeaders,
    fetchImpl = globalThis.fetch,
}) {
    const response = await fetchImpl('/api/chats/search', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
            query,
            avatar_url: avatarUrl,
            group_id: groupId,
        }),
    });

    if (!response.ok) {
        throw new Error('Chat search failed.');
    }

    const results = await response.json();
    if (!Array.isArray(results)) {
        throw new Error('Chat search returned an invalid response.');
    }

    return results;
}

/** Finds literal, case-insensitive matches in current message text, excluding alternate swipes and metadata. */
export function findChatMessages(messages, query) {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return messages.flatMap((message, index) => typeof message?.mes === 'string' && message.mes.toLowerCase().includes(term)
        ? [{ index, name: String(message.name ?? ''), text: message.mes }]
        : []);
}

/** Returns a 40-word preview while preserving the original message text. */
export function getChatMessagePreview(text, maxWords = 40) {
    const value = String(text ?? '');
    if (!value) return { text: '', truncated: false };
    const segmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;
    if (segmenter) {
        let wordCount = 0;
        let end = value.length;
        for (const segment of segmenter.segment(value)) {
            if (!segment.isWordLike) continue;
            wordCount++;
            if (wordCount > maxWords) {
                end = segment.index;
                break;
            }
        }
        return { text: value.slice(0, end).trimEnd(), truncated: end < value.length };
    }
    const words = [...value.matchAll(/\S+/gu)];
    if (words.length <= maxWords) return { text: value, truncated: false };
    return { text: value.slice(0, words[maxWords].index).trimEnd(), truncated: true };
}
