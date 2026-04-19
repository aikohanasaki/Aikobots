import {
    CHAT_SAVE_RESULT,
    chat,
    getCurrentChatId,
    isChatFullyHydrated,
    isSplitTailChat,
    name1,
    name2,
    saveChatConditional,
} from '../script.js';
import { getContext } from './extensions.js';
import { groups, selected_group } from './group-chats.js';
import { compileScene } from './stmb-core.js';
import { captureStmbScene, getStmbChatRangeInfo } from './stmb-api.js';

const suppressedPassiveFlushCounts = new Map();

function buildCharacterChatKeyParts(chatLike = {}) {
    const fileName = String(chatLike?.chatRef?.fileName || chatLike?.fileName || chatLike?.chatId || '').trim();
    const avatarUrl = String(chatLike?.chatRef?.avatarUrl || chatLike?.avatarUrl || '').trim();
    return { fileName, avatarUrl };
}

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
        const { fileName, avatarUrl } = buildCharacterChatKeyParts(chatLike);
        return avatarUrl
            ? `character:${JSON.stringify({ avatarUrl, fileName })}`
            : `character:${fileName}`;
    }

    if (chatLike?.isGroup) {
        return `group:${String(chatLike?.groupId || '')}:${String(chatLike?.chatId || '')}`;
    }

    const { fileName, avatarUrl } = buildCharacterChatKeyParts(chatLike);
    return avatarUrl
        ? `character:${JSON.stringify({ avatarUrl, fileName })}`
        : `character:${fileName}`;
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

function isCurrentSceneContext(sceneContext = null) {
    const targetChatKey = getStmbChatKey(sceneContext || buildStmbSceneContext());
    const currentChatKey = getStmbChatKey(buildStmbSceneContext());
    return Boolean(targetChatKey) && targetChatKey === currentChatKey;
}

function canUseLocalSceneShortcut(sceneContext = null) {
    if (!isCurrentSceneContext(sceneContext)) {
        return false;
    }

    return !isSplitTailChat() || isChatFullyHydrated();
}

function canUseLocalRangeShortcut(rangeStart = null, rangeEnd = null, sceneContext = null) {
    if (!isCurrentSceneContext(sceneContext)) {
        return false;
    }

    if (!isSplitTailChat() || isChatFullyHydrated()) {
        return true;
    }

    const rangeInfo = buildLocalRangeInfo(rangeStart, rangeEnd);
    return rangeInfo.missingRanges.length === 0;
}

function countRangeMessages(messages = [], start, end) {
    let visibleMessageCount = 0;
    let capturableMessageCount = 0;

    for (let index = start; index <= end && index < messages.length; index++) {
        const message = messages[index];
        if (!message) {
            continue;
        }
        if (!message.is_system) {
            visibleMessageCount++;
        }

        const content = String(message.mes || '').replace(/\r\n/g, '\n').trim();
        if (content && !message.is_system) {
            capturableMessageCount++;
        }
    }

    return { visibleMessageCount, capturableMessageCount };
}

function findMissingRanges(messages = [], start = null, end = null) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        return [];
    }

    const missingRanges = [];
    let missingStart = null;

    for (let index = start; index <= end; index++) {
        if (!messages[index]) {
            if (missingStart === null) {
                missingStart = index;
            }
            continue;
        }

        if (missingStart !== null) {
            missingRanges.push({ start: missingStart, end: index - 1 });
            missingStart = null;
        }
    }

    if (missingStart !== null) {
        missingRanges.push({ start: missingStart, end });
    }

    return missingRanges;
}

function buildLocalRangeInfo(rangeStart = null, rangeEnd = null) {
    const totalLogicalMessages = Array.isArray(chat) ? chat.length : 0;
    const lastAvailableMessageId = totalLogicalMessages > 0 ? totalLogicalMessages - 1 : -1;
    const normalizedStart = Number.isInteger(rangeStart)
        ? rangeStart
        : (totalLogicalMessages > 0 ? 0 : null);
    const normalizedEnd = Number.isInteger(rangeEnd)
        ? rangeEnd
        : (lastAvailableMessageId >= 0 ? lastAvailableMessageId : null);
    const missingRanges = findMissingRanges(chat, normalizedStart, normalizedEnd);
    const counts = normalizedStart === null || normalizedEnd === null || normalizedStart > normalizedEnd
        ? { visibleMessageCount: 0, capturableMessageCount: 0 }
        : countRangeMessages(chat, normalizedStart, normalizedEnd);

    return {
        ok: true,
        totalLogicalMessages,
        lastAvailableMessageId,
        storageMode: 'full',
        storageHealthy: true,
        rangeStart: normalizedStart,
        rangeEnd: normalizedEnd,
        missingRanges,
        visibleMessageCount: counts.visibleMessageCount,
        capturableMessageCount: counts.capturableMessageCount,
    };
}

function buildLocalCompiledScene(range, { skipSystemMessages = true, allowPartial = false, sceneContext = null } = {}) {
    const resolvedSceneContext = sceneContext || buildStmbSceneContext();
    const requestedStart = Number(range?.sceneStart);
    const requestedEnd = Number(range?.sceneEnd);
    if (!Number.isInteger(requestedStart) || !Number.isInteger(requestedEnd) || requestedStart < 0 || requestedEnd < requestedStart) {
        throw new Error('Invalid scene range.');
    }
    const missingRanges = findMissingRanges(chat, requestedStart, requestedEnd);
    if (allowPartial !== true && missingRanges.length > 0) {
        const firstMissing = missingRanges[0];
        throw new Error(`Cannot capture messages ${requestedStart}-${requestedEnd} because messages ${firstMissing.start}-${firstMissing.end} are unavailable in chat storage.`);
    }

    const compiledScene = compileScene(chat, {
        sceneStart: requestedStart,
        sceneEnd: requestedEnd,
        chatId: String(resolvedSceneContext?.chatId || ''),
        characterName: String(resolvedSceneContext?.characterName || ''),
        userName: String(resolvedSceneContext?.userName || ''),
    }, {
        skipSystemMessages,
    });

    return {
        ok: true,
        compiledScene,
        capture: {
            requestedStart,
            requestedEnd,
            capturedStart: compiledScene?.metadata?.sceneStart ?? requestedStart,
            capturedEnd: compiledScene?.metadata?.sceneEnd ?? requestedEnd,
            totalLogicalMessages: Array.isArray(chat) ? chat.length : 0,
            lastAvailableMessageId: Array.isArray(chat) && chat.length > 0 ? chat.length - 1 : -1,
            hiddenMessagesSkipped: compiledScene?.metadata?.hiddenMessagesSkipped ?? 0,
            messagesSkipped: compiledScene?.metadata?.messagesSkipped ?? 0,
            missingRanges,
            isPartial: missingRanges.length > 0,
            storageMode: 'full',
            storageHealthy: true,
        },
    };
}

async function saveChatIfNeeded(saveFirst = true, sceneContext = null) {
    if (saveFirst !== false) {
        const chatKey = incrementSuppressedPassiveFlush(sceneContext || buildStmbSceneContext());
        try {
            const saveResult = await saveChatConditional();
            if (saveResult !== CHAT_SAVE_RESULT.SAVED) {
                throw new Error('Memory Books could not capture the chat because the current chat could not be saved.');
            }
        } finally {
            decrementSuppressedPassiveFlush(chatKey);
        }
    }
}

export async function fetchStmbChatRangeInfo(options = {}) {
    const { signal = null, saveFirst = false, rangeStart = null, rangeEnd = null, sceneContext: sceneContextOverride = null } = options;
    const sceneContext = sceneContextOverride || buildStmbSceneContext();
    const canUseLocalRange = canUseLocalRangeShortcut(rangeStart, rangeEnd, sceneContext);
    if (saveFirst !== true && canUseLocalRange) {
        return buildLocalRangeInfo(rangeStart, rangeEnd);
    }
    const shouldSaveFirst = isCurrentSceneContext(sceneContext) && !canUseLocalRange
        ? true
        : saveFirst;
    await saveChatIfNeeded(shouldSaveFirst, sceneContext);

    return getStmbChatRangeInfo({
        ...sceneContext,
        rangeStart,
        rangeEnd,
    }, { signal });
}

export async function captureStmbSceneRange(range, options = {}) {
    const {
        signal = null,
        saveFirst = false,
        skipSystemMessages = true,
        allowPartial = false,
        sceneContext: sceneContextOverride = null,
    } = options;
    const sceneContext = sceneContextOverride || buildStmbSceneContext();
    const canUseLocalRange = canUseLocalRangeShortcut(Number(range?.sceneStart), Number(range?.sceneEnd), sceneContext);
    if (saveFirst !== true && canUseLocalRange && allowPartial !== true) {
        return buildLocalCompiledScene(range, {
            skipSystemMessages,
            allowPartial,
            sceneContext,
        });
    }
    const shouldSaveFirst = isCurrentSceneContext(sceneContext) && !canUseLocalRange
        ? true
        : saveFirst;
    await saveChatIfNeeded(shouldSaveFirst, sceneContext);

    return captureStmbScene({
        ...sceneContext,
        sceneStart: Number(range?.sceneStart),
        sceneEnd: Number(range?.sceneEnd),
        skipSystemMessages,
        allowPartial,
    }, { signal });
}
