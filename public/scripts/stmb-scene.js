import {
    getCurrentChatId,
    name1,
    name2,
    saveChatConditional,
} from '../script.js';
import { getContext } from './extensions.js';
import { groups, selected_group } from './group-chats.js';
import { captureStmbScene, getStmbChatRangeInfo } from './stmb-api.js';

function buildStmbSceneContext() {
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

async function saveChatIfNeeded(saveFirst = true) {
    if (saveFirst !== false) {
        await saveChatConditional();
    }
}

export async function fetchStmbChatRangeInfo(options = {}) {
    const { signal = null, saveFirst = true, rangeStart = null, rangeEnd = null } = options;
    await saveChatIfNeeded(saveFirst);

    return getStmbChatRangeInfo({
        ...buildStmbSceneContext(),
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
    } = options;
    await saveChatIfNeeded(saveFirst);

    return captureStmbScene({
        ...buildStmbSceneContext(),
        sceneStart: Number(range?.sceneStart),
        sceneEnd: Number(range?.sceneEnd),
        skipSystemMessages,
        allowPartial,
    }, { signal });
}
