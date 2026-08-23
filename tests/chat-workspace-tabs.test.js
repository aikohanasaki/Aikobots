import { describe, expect, it, jest } from '@jest/globals';

import {
    captureChatWorkspaceTabFocus,
    getChatWorkspaceRecoveryRefreshDelay,
    getLatestChatWorkspaceRecovery,
    listChatWorkspaceTabs,
    removeChatWorkspaceTab,
    restoreChatWorkspaceTabFocus,
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
    it.each([
        [{ panelOpen: true }, 3_000],
        [{ generationActive: true }, 3_000],
        [{ recoveries: [{ state: 'queued' }] }, 3_000],
        [{ recoveries: [{ state: 'running' }] }, 3_000],
        [{ recoveries: [{ state: 'completed' }, { state: 'failed' }] }, 30_000],
        [{}, 30_000],
    ])('selects the recovery refresh cadence from workspace activity', (state, expected) => {
        expect(getChatWorkspaceRecoveryRefreshDelay(state, 3_000, 30_000)).toBe(expected);
    });

    it('shows a retry instead of an older retained failure', () => {
        const failed = { generationId: 'failed', state: 'failed', createdAt: 1 };
        const retry = { generationId: 'retry', state: 'running', createdAt: 2 };

        expect(getLatestChatWorkspaceRecovery([failed, retry])).toBe(retry);
    });

    it.each(['open', 'close'])('restores focus to the same tab %s control after a rebuild', action => {
        const previousControl = {
            dataset: { workspaceTabKey: 'character:avatar.png:chat-a', workspaceTabAction: action },
            closest: () => previousControl,
        };
        const replacementControl = {
            dataset: { ...previousControl.dataset },
            focus: jest.fn(),
        };
        const container = {
            contains: element => element === previousControl || element === replacementControl,
            querySelectorAll: () => [replacementControl],
        };

        const focusIdentity = captureChatWorkspaceTabFocus(container, previousControl);

        expect(focusIdentity).toEqual({ key: previousControl.dataset.workspaceTabKey, action });
        expect(restoreChatWorkspaceTabFocus(container, focusIdentity)).toBe(true);
        expect(replacementControl.focus).toHaveBeenCalledTimes(1);
    });

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

    it('keeps delimiter-containing tab identities distinct', () => {
        const storage = createStorage();
        const first = upsertChatWorkspaceTab({
            ownerType: 'character',
            ownerId: 'a:b',
            chatId: 'c',
            label: 'First',
            createdAt: 1,
        }, storage);
        const second = upsertChatWorkspaceTab({
            ownerType: 'character',
            ownerId: 'a',
            chatId: 'b:c',
            label: 'Second',
            createdAt: 2,
        }, storage);

        expect(first.key).not.toBe(second.key);
        expect(listChatWorkspaceTabs(storage)).toEqual([first, second]);
        removeChatWorkspaceTab(first.key, storage);
        expect(listChatWorkspaceTabs(storage)).toEqual([second]);
    });
});
