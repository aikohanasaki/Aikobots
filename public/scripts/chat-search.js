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
