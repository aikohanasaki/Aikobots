const STORAGE_KEY = 'aikobots.chat-workspace-tabs.v1';
const ACTIVE_RECOVERY_STATES = new Set(['queued', 'running', 'cancel_requested']);

/** Selects the recovery refresh cadence from visible and active workspace state. */
export function getChatWorkspaceRecoveryRefreshDelay({ panelOpen = false, generationActive = false, recoveries = [] }, fastMs, idleMs) {
    const hasActiveRecovery = recoveries.some(recovery => ACTIVE_RECOVERY_STATES.has(recovery?.state));
    return panelOpen || generationActive || hasActiveRecovery ? fastMs : idleMs;
}

/** Selects the newest recovery state for one workspace tab. */
export function getLatestChatWorkspaceRecovery(recoveries = []) {
    return recoveries.reduce((latest, recovery) => !latest || Number(recovery?.createdAt) > Number(latest.createdAt) ? recovery : latest, null);
}

/** Captures the stable identity of a focused workspace-tab control. */
export function captureChatWorkspaceTabFocus(container, activeElement = globalThis.document?.activeElement) {
    if (!container?.contains(activeElement)) {
        return null;
    }
    const control = activeElement?.closest?.('[data-workspace-tab-key][data-workspace-tab-action]');
    const key = String(control?.dataset?.workspaceTabKey || '');
    const action = String(control?.dataset?.workspaceTabAction || '');
    return container.contains(control) && key && ['open', 'close'].includes(action) ? { key, action } : null;
}

/** Restores focus to the matching control after workspace tabs are rebuilt. */
export function restoreChatWorkspaceTabFocus(container, focusIdentity) {
    if (!container || !focusIdentity) {
        return false;
    }
    for (const control of container.querySelectorAll('[data-workspace-tab-key][data-workspace-tab-action]')) {
        if (control.dataset.workspaceTabKey === focusIdentity.key && control.dataset.workspaceTabAction === focusIdentity.action) {
            control.focus();
            return true;
        }
    }
    return false;
}

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
        key: `${ownerType}:${encodeURIComponent(ownerId)}:${encodeURIComponent(chatId)}`,
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
