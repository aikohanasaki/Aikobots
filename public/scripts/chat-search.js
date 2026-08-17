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
