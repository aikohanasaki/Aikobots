import {
    getCurrentChatId,
    name1,
    name2,
    saveChatConditional,
} from '../script.js';
import { getContext } from './extensions.js';
import { groups, selected_group } from './group-chats.js';
import { captureStmbScene, getStmbChatRangeInfo } from './stmb-api.js';

const suppressedPassiveFlushCounts = new Map();

export function buildStmbSceneContext() {
    const context = getContext();
    const group = selected_group ? groups.find(item => item.id === selected_group) : null;
    const chatId = selected_group
        ? String(group?.chat_id || context?.chatId || getCurrentChatId() || '')
        : String(context?.chatId || getCurrentChatId() || '');
    const characterName = selected_group
        ? String(group?.name || name2 || '')
        : String(name2 || context?.characters?.[context.characterId]?.name || '');

    if (selected_group) {
        return {
            chatRef: {
                type: 'group',
                chatId,
            },
            chatId,
            groupId: String(selected_group || ''),
            characterName,
            userName: String(name1 || ''),
        };
    }

    const activeCharacter = context?.characters?.[context.characterId];
    return {
        chatRef: {
            type: 'character',
            avatarUrl: String(activeCharacter?.avatar || activeCharacter?.avatar_url || context?.avatarUrl || ''),
            fileName: chatId,
        },
        chatId,
        characterName,
        userName: String(name1 || ''),
    };
}

export function getStmbChatKey(chatLike = {}) {
    if (chatLike?.chatRef?.type === 'group') {
        return `group:${String(chatLike?.groupId || '')}:${String(chatLike?.chatId || chatLike?.chatRef?.chatId || '')}`;
    }

    if (chatLike?.chatRef?.type === 'character') {
        return `character:${String(chatLike?.chatId || chatLike?.chatRef?.fileName || '')}`;
    }

    if (chatLike?.isGroup) {
        return `group:${String(chatLike?.groupId || '')}:${String(chatLike?.chatId || '')}`;
    }

    return `character:${String(chatLike?.chatId || chatLike?.fileName || '')}`;
}

function incrementSuppressedPassiveFlush(chatLike) {
    const chatKey = getStmbChatKey(chatLike);
    if (!chatKey) {
        return null;
    }

    suppressedPassiveFlushCounts.set(chatKey, (suppressedPassiveFlushCounts.get(chatKey) || 0) + 1);
    return chatKey;
}

function decrementSuppressedPassiveFlush(chatKey) {
    if (!chatKey) {
        return;
    }

    const remaining = (suppressedPassiveFlushCounts.get(chatKey) || 0) - 1;
    if (remaining > 0) {
        suppressedPassiveFlushCounts.set(chatKey, remaining);
        return;
    }

    suppressedPassiveFlushCounts.delete(chatKey);
}

export function isPassiveStmbFlushSuppressedForChat(chatLike = {}) {
    const chatKey = getStmbChatKey(chatLike);
    return Boolean(chatKey && suppressedPassiveFlushCounts.get(chatKey));
}

async function saveChatIfNeeded(saveFirst = true, sceneContext = null) {
    if (saveFirst !== false) {
        const chatKey = incrementSuppressedPassiveFlush(sceneContext || buildStmbSceneContext());
        try {
            await saveChatConditional();
        } finally {
            decrementSuppressedPassiveFlush(chatKey);
        }
    }
}

export async function fetchStmbChatRangeInfo(options = {}) {
    const { signal = null, saveFirst = true, rangeStart = null, rangeEnd = null, sceneContext: sceneContextOverride = null } = options;
    const sceneContext = sceneContextOverride || buildStmbSceneContext();
    await saveChatIfNeeded(saveFirst, sceneContext);

    return getStmbChatRangeInfo({
        ...sceneContext,
        rangeStart,
        rangeEnd,
    }, { signal });
}

export async function captureStmbSceneRange(range, options = {}) {
    const {
        signal = null,
        saveFirst = true,
        skipSystemMessages = true,
        allowPartial = false,
        sceneContext: sceneContextOverride = null,
    } = options;
    const sceneContext = sceneContextOverride || buildStmbSceneContext();
    await saveChatIfNeeded(saveFirst, sceneContext);

    return captureStmbScene({
        ...sceneContext,
        sceneStart: Number(range?.sceneStart),
        sceneEnd: Number(range?.sceneEnd),
        skipSystemMessages,
        allowPartial,
    }, { signal });
}
