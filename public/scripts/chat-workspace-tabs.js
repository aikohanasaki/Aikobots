const STORAGE_KEY = 'aikobots.chat-workspace-tabs.v1';

function getDefaultStorage() {
    try {
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
}

/** Validates a content-free workspace tab identity. */
export function normalizeChatWorkspaceTab(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const ownerType = value.ownerType === 'group' ? 'group' : value.ownerType === 'character' ? 'character' : '';
    const ownerId = String(value.ownerId || '').trim();
    const chatId = String(value.chatId || '').trim();
    const label = String(value.label || chatId).trim().slice(0, 256);
    const createdAt = Number(value.createdAt) || now;
    if (!ownerType || !ownerId || !chatId || !label || !Number.isFinite(createdAt) || createdAt <= 0) {
        return null;
    }
    return {
        key: `${ownerType}:${ownerId}:${chatId}`,
        ownerType,
        ownerId,
        chatId,
        label,
        createdAt,
    };
}

/** Reads valid workspace tabs from session storage. */
export function listChatWorkspaceTabs(storage = getDefaultStorage()) {
    if (!storage) {
        return [];
    }
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
        const tabs = (Array.isArray(parsed) ? parsed : []).map(value => normalizeChatWorkspaceTab(value)).filter(Boolean);
        storage.setItem(STORAGE_KEY, JSON.stringify(tabs));
        return tabs;
    } catch {
        try {
            storage.removeItem(STORAGE_KEY);
        } catch {
            // Session storage is best-effort; chats remain authoritative on the server.
        }
        return [];
    }
}

/** Opens or refreshes one logical chat tab. */
export function upsertChatWorkspaceTab(value, storage = getDefaultStorage()) {
    const normalized = normalizeChatWorkspaceTab(value);
    if (!normalized || !storage) {
        return null;
    }
    try {
        const tabs = listChatWorkspaceTabs(storage).filter(tab => tab.key !== normalized.key);
        tabs.push(normalized);
        storage.setItem(STORAGE_KEY, JSON.stringify(tabs));
        return normalized;
    } catch {
        return null;
    }
}

/** Removes one logical chat tab without deleting or mutating its chat. */
export function removeChatWorkspaceTab(key, storage = getDefaultStorage()) {
    if (!storage) {
        return;
    }
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(listChatWorkspaceTabs(storage).filter(tab => tab.key !== key)));
    } catch {
        // Session storage is best-effort; chats remain authoritative on the server.
    }
}
