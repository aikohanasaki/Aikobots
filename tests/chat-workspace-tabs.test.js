import { describe, expect, it } from '@jest/globals';

import {
    listChatWorkspaceTabs,
    removeChatWorkspaceTab,
    upsertChatWorkspaceTab,
} from '../public/scripts/chat-workspace-tabs.js';

function createStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}

describe('chat workspace tabs', () => {
    it('stores one content-free tab per logical chat and removes only the selected tab', () => {
        const storage = createStorage();
        const first = upsertChatWorkspaceTab({
            ownerType: 'character',
            ownerId: 'avatar.png',
            chatId: 'chat-a',
            label: 'Bot A: chat-a',
            createdAt: 1,
            messages: 'must not persist',
        }, storage);
        upsertChatWorkspaceTab({ ...first, label: 'Bot A: renamed' }, storage);
        const second = upsertChatWorkspaceTab({
            ownerType: 'group',
            ownerId: 'group-1',
            chatId: 'chat-b',
            label: 'Group: chat-b',
            createdAt: 2,
        }, storage);

        expect(listChatWorkspaceTabs(storage)).toEqual([
            expect.objectContaining({ key: first.key, label: 'Bot A: renamed' }),
            second,
        ]);
        expect(JSON.stringify(listChatWorkspaceTabs(storage))).not.toContain('must not persist');
        removeChatWorkspaceTab(first.key, storage);
        expect(listChatWorkspaceTabs(storage)).toEqual([second]);
    });
});
