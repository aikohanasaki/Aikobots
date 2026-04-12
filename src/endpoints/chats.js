import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import _ from 'lodash';

import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';
import { touchUserActivity } from '../users.js';
import {
    getConfigValue,
    humanizedISO8601DateTime,
    tryParse,
    generateTimestamp,
    removeOldBackups,
    formatBytes,
    getUniqueName,
    sanitizeSafeCharacterReplacements,
} from '../util.js';

const isBackupEnabled = !!getConfigValue('backups.chat.enabled', true, 'boolean');
const maxTotalChatBackups = Number(getConfigValue('backups.chat.maxTotalBackups', -1, 'number'));
const throttleInterval = Number(getConfigValue('backups.chat.throttleInterval', 10_000, 'number'));
const checkIntegrity = !!getConfigValue('backups.chat.checkIntegrity', true, 'boolean');
const CHAT_STORAGE_KEY = 'chat_storage';
const CHAT_STORAGE_MODE_SPLIT_TAIL = 'split-tail';
const CHAT_HEAD_FILE_SUFFIX = '.head.jsonl';
const GROUP_CHAT_HEADER_VERSION = 1;
const CHAT_METADATA_STRIP_KEYS = ['worldInfoSummary', 'worldInfoReport'];
const CHAT_EXTRA_STRIP_KEYS = ['worldInfoSummary', 'worldInfoReport'];
const LONG_CHAT_DISPLAY_MIN = 20;
const LONG_CHAT_DISPLAY_MAX = 200;
const LONG_CHAT_BUFFER_GAP = 50;
const LONG_CHAT_BUFFER_MIN = LONG_CHAT_DISPLAY_MIN + LONG_CHAT_BUFFER_GAP;
const LONG_CHAT_BUFFER_MAX = 500;
const LONG_CHAT_DISPLAY_DEFAULT = 100;
const LONG_CHAT_BUFFER_DEFAULT = 200;

export const CHAT_BACKUPS_PREFIX = 'chat_';

function isHeadChatFile(fileName) {
    return String(fileName).endsWith(CHAT_HEAD_FILE_SUFFIX);
}

function getSplitHeadPath(filePath) {
    const parsedPath = path.parse(filePath);
    return path.join(parsedPath.dir, `${parsedPath.name}${CHAT_HEAD_FILE_SUFFIX}`);
}

function stripChatStorage(header) {
    if (!header || !_.isObject(header)) {
        return header;
    }

    const result = { ...header };
    delete result[CHAT_STORAGE_KEY];
    return result;
}

function getChatStorage(header) {
    const storage = header?.[CHAT_STORAGE_KEY];
    return storage?.mode === CHAT_STORAGE_MODE_SPLIT_TAIL ? storage : null;
}

function isGroupChatHeader(record) {
    return Boolean(record?.is_group_chat_header === true);
}

function buildGroupChatHeader(chatMetadata = {}, existingHeader = null) {
    return {
        ...(isGroupChatHeader(existingHeader) ? stripChatStorage(existingHeader) : {}),
        is_group_chat_header: true,
        group_chat_header_version: GROUP_CHAT_HEADER_VERSION,
        create_date: String(existingHeader?.create_date || humanizedISO8601DateTime()),
        chat_metadata: _.isPlainObject(chatMetadata) ? _.cloneDeep(chatMetadata) : {},
    };
}

function stripPersistedChatExtra(extra) {
    if (!_.isPlainObject(extra)) {
        return extra;
    }

    const sanitizedExtra = _.cloneDeep(extra);
    for (const key of CHAT_EXTRA_STRIP_KEYS) {
        delete sanitizedExtra[key];
    }

    return sanitizedExtra;
}

function stripPersistedChatMetadata(chatMetadata) {
    if (!_.isPlainObject(chatMetadata)) {
        return chatMetadata;
    }

    const sanitizedMetadata = _.cloneDeep(chatMetadata);
    for (const key of CHAT_METADATA_STRIP_KEYS) {
        delete sanitizedMetadata[key];
    }

    return sanitizedMetadata;
}

function sanitizeChatMessageForPersistence(message) {
    if (!_.isPlainObject(message)) {
        return message;
    }

    const sanitizedMessage = _.cloneDeep(message);

    if (_.isPlainObject(sanitizedMessage.extra)) {
        sanitizedMessage.extra = stripPersistedChatExtra(sanitizedMessage.extra);
    }

    if (Array.isArray(sanitizedMessage.swipe_info)) {
        sanitizedMessage.swipe_info = sanitizedMessage.swipe_info.map((swipeInfo) => {
            if (!_.isPlainObject(swipeInfo)) {
                return swipeInfo;
            }

            const sanitizedSwipeInfo = _.cloneDeep(swipeInfo);
            if (_.isPlainObject(sanitizedSwipeInfo.extra)) {
                sanitizedSwipeInfo.extra = stripPersistedChatExtra(sanitizedSwipeInfo.extra);
            }

            return sanitizedSwipeInfo;
        });
    }

    return sanitizedMessage;
}

function sanitizeChatHeaderForPersistence(header) {
    if (!_.isPlainObject(header)) {
        return header;
    }

    const sanitizedHeader = stripChatStorage(_.cloneDeep(header));
    if (_.isPlainObject(sanitizedHeader.chat_metadata)) {
        sanitizedHeader.chat_metadata = stripPersistedChatMetadata(sanitizedHeader.chat_metadata);
    }

    return sanitizedHeader;
}

function getUnsupportedImportedJsonlMessage(header) {
    if (!header || !_.isObject(header)) {
        return null;
    }

    if (header.split_part === 'head') {
        return 'This JSONL file is only a long-chat head segment. Export the full chat as JSONL first, then import that exported file.';
    }

    const storage = getChatStorage(header);
    if (storage) {
        return 'This JSONL file is a split long-chat tail segment and does not include the full message history. Export the full chat as JSONL first, then import that exported file.';
    }

    return null;
}

function getImportedChatBaseName(originalName, characterName) {
    const sanitizedOriginalBaseName = sanitize(path.parse(String(originalName || '')).name, {
        replacement: sanitizeSafeCharacterReplacements,
    });

    if (sanitizedOriginalBaseName) {
        return sanitizedOriginalBaseName;
    }

    return sanitize(`${characterName} - ${humanizedISO8601DateTime()} imported`, {
        replacement: sanitizeSafeCharacterReplacements,
    });
}

function parsePromptSnapshotKey(promptSnapshotKey) {
    if (typeof promptSnapshotKey !== 'string') {
        return null;
    }

    const parts = promptSnapshotKey.split('|');
    if (parts.length !== 4) {
        return null;
    }

    const [username, chatScope, mesIdText, swipeIdText] = parts;
    const mesId = Number(mesIdText);
    const swipeId = Number(swipeIdText);

    if (!username || !chatScope || !Number.isFinite(mesId) || mesId < 0 || !Number.isFinite(swipeId) || swipeId < 0) {
        return null;
    }

    return { username, chatScope, mesId, swipeId };
}

function buildPromptSnapshotKey({ username, chatScope, mesId, swipeId }) {
    if (!username || !chatScope || !Number.isFinite(Number(mesId)) || Number(mesId) < 0 || !Number.isFinite(Number(swipeId)) || Number(swipeId) < 0) {
        return null;
    }

    return `${username}|${chatScope}|${Number(mesId)}|${Number(swipeId)}`;
}

function rekeyImportedPromptSnapshotKey(promptSnapshotKey, { chatScope, mesId, swipeId = null } = {}) {
    const parsed = parsePromptSnapshotKey(promptSnapshotKey);
    if (!parsed) {
        return promptSnapshotKey;
    }

    return buildPromptSnapshotKey({
        username: parsed.username,
        chatScope: chatScope ?? parsed.chatScope,
        mesId: mesId ?? parsed.mesId,
        swipeId: swipeId ?? parsed.swipeId,
    }) ?? promptSnapshotKey;
}

function normalizeImportedHeader(header) {
    const normalizedHeader = sanitizeChatHeaderForPersistence(header);

    if (_.isPlainObject(normalizedHeader?.chat_metadata)) {
        delete normalizedHeader.chat_metadata.integrity;
        delete normalizedHeader.chat_metadata.chat_id_hash;
    }

    return normalizedHeader;
}

function normalizeImportedMessage(message, { chatScope, mesId }) {
    const normalizedMessage = sanitizeChatMessageForPersistence(message);

    if (_.isPlainObject(normalizedMessage?.extra) && typeof normalizedMessage.extra.promptSnapshotKey === 'string') {
        normalizedMessage.extra.promptSnapshotKey = rekeyImportedPromptSnapshotKey(normalizedMessage.extra.promptSnapshotKey, {
            chatScope,
            mesId,
        });
    }

    if (Array.isArray(normalizedMessage?.swipe_info)) {
        normalizedMessage.swipe_info = normalizedMessage.swipe_info.map((swipeInfo, swipeId) => {
            if (!_.isPlainObject(swipeInfo)) {
                return swipeInfo;
            }

            const normalizedSwipeInfo = _.cloneDeep(swipeInfo);
            if (_.isPlainObject(normalizedSwipeInfo.extra) && typeof normalizedSwipeInfo.extra.promptSnapshotKey === 'string') {
                normalizedSwipeInfo.extra.promptSnapshotKey = rekeyImportedPromptSnapshotKey(normalizedSwipeInfo.extra.promptSnapshotKey, {
                    chatScope,
                    mesId,
                    swipeId,
                });
            }

            return normalizedSwipeInfo;
        });
    }

    return normalizedMessage;
}

function normalizeImportedSerializedChat(serializedChat, fileName) {
    const records = String(serializedChat || '')
        .split('\n')
        .map(line => tryParse(line))
        .filter(record => _.isPlainObject(record));

    if (!records.length) {
        return null;
    }

    const [header, ...messages] = records;
    const chatScope = `chat:${path.parse(String(fileName || '')).name}`;

    return {
        header: normalizeImportedHeader(header),
        messages: messages.map((message, mesId) => normalizeImportedMessage(message, { chatScope, mesId })),
    };
}

function clampLongChatValue(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeLongChatConfig({ displayCount = LONG_CHAT_DISPLAY_DEFAULT, bufferMax = LONG_CHAT_BUFFER_DEFAULT } = {}) {
    let normalizedDisplayCount = clampLongChatValue(
        displayCount,
        LONG_CHAT_DISPLAY_MIN,
        LONG_CHAT_DISPLAY_MAX,
        LONG_CHAT_DISPLAY_DEFAULT,
    );
    let normalizedBufferMax = clampLongChatValue(
        bufferMax,
        LONG_CHAT_BUFFER_MIN,
        LONG_CHAT_BUFFER_MAX,
        LONG_CHAT_BUFFER_DEFAULT,
    );

    if (normalizedBufferMax < normalizedDisplayCount + LONG_CHAT_BUFFER_GAP) {
        normalizedBufferMax = Math.min(LONG_CHAT_BUFFER_MAX, normalizedDisplayCount + LONG_CHAT_BUFFER_GAP);
        normalizedDisplayCount = Math.min(normalizedDisplayCount, normalizedBufferMax - LONG_CHAT_BUFFER_GAP);
    }

    normalizedDisplayCount = clampLongChatValue(
        normalizedDisplayCount,
        LONG_CHAT_DISPLAY_MIN,
        Math.min(LONG_CHAT_DISPLAY_MAX, normalizedBufferMax - LONG_CHAT_BUFFER_GAP),
        LONG_CHAT_DISPLAY_DEFAULT,
    );
    normalizedBufferMax = clampLongChatValue(
        normalizedBufferMax,
        Math.max(LONG_CHAT_BUFFER_MIN, normalizedDisplayCount + LONG_CHAT_BUFFER_GAP),
        LONG_CHAT_BUFFER_MAX,
        LONG_CHAT_BUFFER_DEFAULT,
    );

    return {
        displayCount: normalizedDisplayCount,
        bufferMax: normalizedBufferMax,
    };
}

function normalizeChatTimestamp(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (trimmed) {
            const numeric = Number(trimmed);
            if (Number.isFinite(numeric)) {
                return numeric;
            }

            const parsed = Date.parse(trimmed);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }

    return fallback;
}

function hasValidChatPayload(chat) {
    return Array.isArray(chat) && _.isPlainObject(chat[0]);
}

export function serializeJsonl(data) {
    return data.map(x => JSON.stringify(x)).join('\n');
}

export function readJsonlObjects(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const data = fs.readFileSync(filePath, 'utf8');
    if (!data) {
        return [];
    }

    return data
        .split('\n')
        .map(line => tryParse(line))
        .filter(x => x);
}

function getChatSegments(filePath) {
    const tailObjects = readJsonlObjects(filePath);

    if (!tailObjects.length) {
        return {
            header: null,
            storage: null,
            headPath: getSplitHeadPath(filePath),
            headMessages: [],
            tailMessages: [],
            messages: [],
        };
    }

    const header = tailObjects[0];
    const storage = getChatStorage(header);
    const headPath = storage?.head_file
        ? path.join(path.dirname(filePath), storage.head_file)
        : getSplitHeadPath(filePath);
    const headObjects = storage ? readJsonlObjects(headPath) : [];
    const headMessages = headObjects.slice(1);
    const tailMessages = tailObjects.slice(1);

    return {
        header,
        storage,
        headPath,
        headMessages,
        tailMessages,
        messages: [...headMessages, ...tailMessages],
    };
}

function getSegmentLayout(segments) {
    const hasStorage = Boolean(segments?.storage);
    const actualHeadCount = Array.isArray(segments?.headMessages) ? segments.headMessages.length : 0;
    const actualTailCount = Array.isArray(segments?.tailMessages) ? segments.tailMessages.length : 0;
    const actualTotalMessages = Array.isArray(segments?.messages) ? segments.messages.length : 0;
    const declaredHeadCount = Number.isInteger(segments?.storage?.head_count)
        ? Math.max(0, segments.storage.head_count)
        : actualHeadCount;
    const declaredTailCount = Number.isInteger(segments?.storage?.tail_count)
        ? Math.max(0, segments.storage.tail_count)
        : actualTailCount;
    const declaredTotalMessages = hasStorage
        ? declaredHeadCount + declaredTailCount
        : actualTotalMessages;
    const headMessagesMissing = hasStorage && actualHeadCount < declaredHeadCount;
    const headCount = headMessagesMissing ? declaredHeadCount : actualHeadCount;
    const tailCount = actualTailCount;
    const totalMessages = headMessagesMissing
        ? (declaredHeadCount + actualTailCount)
        : actualTotalMessages;
    const tailStartId = hasStorage
        ? Math.min(headCount, totalMessages)
        : Math.max(0, totalMessages - (tailCount || totalMessages));
    const tailEndId = totalMessages > 0 ? totalMessages - 1 : -1;
    const availableTailEndId = actualTailCount > 0 ? tailStartId + actualTailCount - 1 : tailStartId - 1;

    return {
        actualHeadCount,
        actualTailCount,
        actualTotalMessages,
        declaredHeadCount,
        declaredTailCount,
        declaredTotalMessages,
        headCount,
        tailCount,
        totalMessages,
        tailStartId,
        tailEndId,
        availableTailEndId,
        headMessagesMissing,
    };
}

export function getLogicalChatData(filePath) {
    const segments = getChatSegments(filePath);

    if (!segments.header) {
        return [];
    }

    return [stripChatStorage(segments.header), ...segments.messages];
}

function getLogicalChatMessages(filePath) {
    const [, ...messages] = getLogicalChatData(filePath);
    return messages;
}

function resolveLegacyGroupChatMetadata(user, chatId) {
    if (!chatId || !fs.existsSync(user.directories.groups)) {
        return {};
    }

    const groupFiles = fs.readdirSync(user.directories.groups).filter(file => path.extname(file) === '.json');
    for (const groupFile of groupFiles) {
        try {
            const groupPath = path.join(user.directories.groups, groupFile);
            const group = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
            if (String(group?.chat_id || '') === String(chatId) && _.isPlainObject(group?.chat_metadata)) {
                return _.cloneDeep(group.chat_metadata);
            }

            const pastMetadata = group?.past_metadata?.[chatId];
            if (_.isPlainObject(pastMetadata)) {
                return _.cloneDeep(pastMetadata);
            }
        } catch (error) {
            console.warn('Failed to resolve legacy group chat metadata for', chatId, error);
        }
    }

    return {};
}

function getGroupChatPayload(filePath) {
    if (!fs.existsSync(filePath)) {
        return { header: null, messages: [], hasHeader: false };
    }

    const records = readJsonlObjects(filePath);
    if (!records.length) {
        return { header: null, messages: [], hasHeader: false };
    }

    if (isGroupChatHeader(records[0])) {
        const logicalChat = getLogicalChatData(filePath);
        return {
            header: logicalChat[0] || null,
            messages: logicalChat.slice(1),
            hasHeader: true,
        };
    }

    return {
        header: null,
        messages: records,
        hasHeader: false,
    };
}

function writeGroupChat(filePath, messages, chatMetadata = {}, existingHeader = null) {
    return writeLogicalChat(filePath, buildGroupChatHeader(chatMetadata, existingHeader), messages);
}

function ensureGroupChatHeader(user, chatId, filePath) {
    const payload = getGroupChatPayload(filePath);
    if (payload.hasHeader || payload.messages.length === 0) {
        return payload;
    }

    const chatMetadata = resolveLegacyGroupChatMetadata(user, chatId);
    const writeResult = writeGroupChat(filePath, payload.messages, chatMetadata);
    return {
        header: buildGroupChatHeader(chatMetadata),
        messages: payload.messages,
        hasHeader: true,
        writeResult,
    };
}

export function writeLogicalChat(filePath, header, messages, { displayCount = LONG_CHAT_DISPLAY_DEFAULT, bufferMax = LONG_CHAT_BUFFER_DEFAULT, tailStartId = null } = {}) {
    const { displayCount: normalizedDisplayCount, bufferMax: normalizedBufferMax } = normalizeLongChatConfig({ displayCount, bufferMax });
    const baseHeader = sanitizeChatHeaderForPersistence(header);
    const sanitizedMessages = Array.isArray(messages)
        ? messages.map(message => sanitizeChatMessageForPersistence(message))
        : [];
    const fullJsonl = serializeJsonl([baseHeader, ...sanitizedMessages]);
    const headPath = getSplitHeadPath(filePath);
    const totalMessages = sanitizedMessages.length;
    let nextTailStartId = Number.isInteger(tailStartId) ? tailStartId : null;

    if (nextTailStartId !== null) {
        nextTailStartId = Math.min(Math.max(0, nextTailStartId), totalMessages);
        const tailCount = Math.max(0, totalMessages - nextTailStartId);
        if (tailCount > normalizedBufferMax) {
            nextTailStartId = Math.max(0, totalMessages - normalizedDisplayCount);
        }
    } else if (totalMessages > normalizedBufferMax) {
        nextTailStartId = Math.max(0, totalMessages - normalizedDisplayCount);
    }

    if (nextTailStartId !== null && nextTailStartId > 0 && nextTailStartId < totalMessages) {
        const headMessages = sanitizedMessages.slice(0, nextTailStartId);
        const tailMessages = sanitizedMessages.slice(nextTailStartId);
        const storage = {
            mode: CHAT_STORAGE_MODE_SPLIT_TAIL,
            head_file: path.basename(headPath),
            head_count: headMessages.length,
            tail_count: tailMessages.length,
        };
        const headerWithStorage = { ...baseHeader, [CHAT_STORAGE_KEY]: storage };
        const headHeader = {
            split_part: 'head',
            parent_file: path.basename(filePath),
            message_count: headMessages.length,
        };

        writeFileAtomicSync(headPath, serializeJsonl([headHeader, ...headMessages]), 'utf8');
        writeFileAtomicSync(filePath, serializeJsonl([headerWithStorage, ...tailMessages]), 'utf8');

        return {
            fullJsonl,
            storageMode: CHAT_STORAGE_MODE_SPLIT_TAIL,
            headCount: headMessages.length,
            tailCount: tailMessages.length,
            tailStartId: headMessages.length,
            tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
            compacted: tailStartId !== null && nextTailStartId !== tailStartId,
        };
    } else {
        if (fs.existsSync(headPath)) {
            fs.unlinkSync(headPath);
        }

        writeFileAtomicSync(filePath, fullJsonl, 'utf8');

        return {
            fullJsonl,
            storageMode: 'full',
            headCount: 0,
            tailCount: totalMessages,
            tailStartId: 0,
            tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
            compacted: false,
        };
    }
}

function ensureSplitTailStorage(filePath, { displayCount = LONG_CHAT_DISPLAY_DEFAULT, bufferMax = LONG_CHAT_BUFFER_DEFAULT } = {}) {
    const segments = getChatSegments(filePath);
    if (!segments.header || segments.storage || segments.messages.length <= normalizeLongChatConfig({ displayCount, bufferMax }).bufferMax) {
        return false;
    }

    writeLogicalChat(filePath, segments.header, segments.messages, {
        displayCount,
        bufferMax,
        tailStartId: Math.max(0, segments.messages.length - normalizeLongChatConfig({ displayCount, bufferMax }).displayCount),
    });
    return true;
}

export function buildChunkedChatPayload(filePath, {
    rangeStart = null,
    count = null,
    hydrateFull = false,
    displayCount = LONG_CHAT_DISPLAY_DEFAULT,
    bufferMax = LONG_CHAT_BUFFER_DEFAULT,
    includeParentPromptCache = false,
} = {}) {
    const config = normalizeLongChatConfig({ displayCount, bufferMax });
    const segments = getChatSegments(filePath);
    const header = stripChatStorage(segments.header);
    const layout = getSegmentLayout(segments);
    const totalMessages = layout.totalMessages;
    const tailCount = Number.isInteger(layout.tailCount) ? layout.tailCount : totalMessages;
    const tailStartId = layout.tailStartId;
    const tailEndId = layout.tailEndId;

    if (!header) {
        return {
            mode: 'full',
            header: null,
            messages: [],
            totalMessages: 0,
            loadedRangeStart: 0,
            loadedRangeEnd: -1,
            tailStartId: 0,
            tailEndId: -1,
            headCount: 0,
            tailCount: 0,
        };
    }

    let startId = 0;
    let endId = totalMessages - 1;
    let loadedRangeStart = totalMessages > 0 ? 0 : 0;
    let loadedRangeEnd = totalMessages > 0 ? endId : -1;
    let messages = totalMessages > 0
        ? segments.messages.slice(startId, endId + 1)
        : [];
    const shouldServeTailUsingDeclaredIds = Boolean(segments.storage) && layout.headMessagesMissing;

    if (shouldServeTailUsingDeclaredIds) {
        const normalizedCount = hydrateFull
            ? Math.max(1, layout.actualTailCount)
            : Math.max(1, Number(count) || tailCount || config.displayCount);
        startId = Number.isInteger(rangeStart)
            ? rangeStart
            : tailStartId;
        startId = Math.max(tailStartId, Math.min(startId, Math.max(tailStartId, layout.availableTailEndId)));
        endId = Math.min(layout.availableTailEndId, startId + normalizedCount - 1);
        loadedRangeStart = startId;
        loadedRangeEnd = endId;
        messages = endId >= startId
            ? segments.tailMessages.slice(startId - tailStartId, endId - tailStartId + 1)
            : [];

        console.warn(`Long chat head segment is incomplete for ${filePath}; serving tail using declared absolute IDs.`, {
            declaredHeadCount: layout.declaredHeadCount,
            actualHeadCount: layout.actualHeadCount,
            declaredTailCount: layout.declaredTailCount,
            actualTailCount: layout.actualTailCount,
            totalMessages,
        });
    } else if (!hydrateFull && segments.storage) {
        const normalizedCount = Math.max(1, Number(count) || tailCount || config.displayCount);
        startId = Number.isInteger(rangeStart)
            ? rangeStart
            : tailStartId;
        startId = Math.max(0, Math.min(startId, Math.max(0, totalMessages - 1)));
        endId = Math.min(totalMessages - 1, startId + normalizedCount - 1);
        loadedRangeStart = startId;
        loadedRangeEnd = endId;
        messages = totalMessages > 0
            ? segments.messages.slice(startId, endId + 1)
            : [];
    } else {
        loadedRangeStart = totalMessages > 0 ? startId : 0;
        loadedRangeEnd = totalMessages > 0 ? endId : -1;
        messages = totalMessages > 0
            ? segments.messages.slice(startId, endId + 1)
            : [];
    }

    const parentPromptMessages = segments.storage && !hydrateFull && !shouldServeTailUsingDeclaredIds && (includeParentPromptCache || rangeStart === null)
        ? segments.messages.slice(0, tailStartId).filter(isResidentParentPromptMessage)
        : undefined;

    return {
        mode: segments.storage ? CHAT_STORAGE_MODE_SPLIT_TAIL : 'full',
        header,
        messages,
        parentPromptMessages,
        totalMessages,
        loadedRangeStart,
        loadedRangeEnd,
        tailStartId,
        tailEndId,
        headCount: layout.headCount,
        tailCount,
        displayCount: config.displayCount,
        isHydrated: (hydrateFull || !segments.storage) && !shouldServeTailUsingDeclaredIds,
    };
}

function getCharacterChatFilePath(chatsDirectory, avatarUrl, fileName) {
    const directoryName = String(avatarUrl || '').replace('.png', '');
    const normalizedFileName = String(fileName || '').endsWith('.jsonl')
        ? String(fileName)
        : `${String(fileName)}.jsonl`;
    return path.join(chatsDirectory, directoryName, sanitize(normalizedFileName));
}

function buildSplitLogicalMessages(segments, layout) {
    if (!segments?.storage || !layout?.headMessagesMissing) {
        return Array.isArray(segments?.messages) ? segments.messages.slice() : [];
    }

    const sparseMessages = new Array(Math.max(0, layout.totalMessages));
    for (let index = 0; index < layout.actualHeadCount; index++) {
        sparseMessages[index] = segments.headMessages[index];
    }
    for (let index = 0; index < layout.actualTailCount; index++) {
        sparseMessages[layout.tailStartId + index] = segments.tailMessages[index];
    }
    return sparseMessages;
}

function getMissingRangesForSegments(layout) {
    if (!layout?.headMessagesMissing) {
        return [];
    }

    const missingStart = layout.actualHeadCount;
    const missingEnd = layout.declaredHeadCount - 1;
    return missingStart <= missingEnd
        ? [{ start: missingStart, end: missingEnd }]
        : [];
}

function findLastAvailableMessageId(messages) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    for (let index = sourceMessages.length - 1; index >= 0; index--) {
        if (sourceMessages[index]) {
            return index;
        }
    }
    return -1;
}

function resolveDirectLogicalChat(filePath) {
    const segments = getChatSegments(filePath);
    const layout = getSegmentLayout(segments);
    const messages = buildSplitLogicalMessages(segments, layout);

    return {
        chatType: 'character',
        filePath,
        header: stripChatStorage(segments.header),
        messages,
        totalMessages: layout.totalMessages,
        lastAvailableMessageId: findLastAvailableMessageId(messages),
        missingRanges: getMissingRangesForSegments(layout),
        storageMode: segments.storage ? CHAT_STORAGE_MODE_SPLIT_TAIL : 'full',
        storageHealthy: !layout.headMessagesMissing,
        tailStartId: layout.tailStartId,
        tailEndId: layout.tailEndId,
    };
}

function resolveGroupLogicalChat(filePath) {
    const segments = getChatSegments(filePath);
    if (isGroupChatHeader(segments.header)) {
        const layout = getSegmentLayout(segments);
        const messages = buildSplitLogicalMessages(segments, layout);

        return {
            chatType: 'group',
            filePath,
            header: stripChatStorage(segments.header),
            messages,
            totalMessages: layout.totalMessages,
            lastAvailableMessageId: findLastAvailableMessageId(messages),
            missingRanges: getMissingRangesForSegments(layout),
            storageMode: segments.storage ? CHAT_STORAGE_MODE_SPLIT_TAIL : 'full',
            storageHealthy: !layout.headMessagesMissing,
            tailStartId: layout.tailStartId,
            tailEndId: layout.tailEndId,
        };
    }

    const messages = readJsonlObjects(filePath);
    return {
        chatType: 'group',
        filePath,
        header: null,
        messages,
        totalMessages: messages.length,
        lastAvailableMessageId: findLastAvailableMessageId(messages),
        missingRanges: [],
        storageMode: 'full',
        storageHealthy: true,
        tailStartId: 0,
        tailEndId: messages.length > 0 ? messages.length - 1 : -1,
    };
}

export function resolveLogicalChatReference(directories, chatRef) {
    const reference = chatRef && typeof chatRef === 'object' ? chatRef : {};

    if (reference.type === 'group') {
        const chatId = String(reference.chatId || '').trim();
        if (!chatId) {
            return resolveGroupLogicalChat('');
        }

        const normalizedFileName = chatId.endsWith('.jsonl') ? chatId : `${chatId}.jsonl`;
        const filePath = path.join(directories.groupChats, sanitize(normalizedFileName));
        return resolveGroupLogicalChat(filePath);
    }

    const avatarUrl = String(reference.avatarUrl || '').trim();
    const fileName = String(reference.fileName || '').trim();
    if (!avatarUrl || !fileName) {
        return resolveDirectLogicalChat('');
    }

    const filePath = getCharacterChatFilePath(directories.chats, avatarUrl, fileName);
    return resolveDirectLogicalChat(filePath);
}

function isPromptExcludedMessage(message) {
    return Boolean(message?.extra?.ignore);
}

function isResidentParentPromptMessage(message) {
    return !isPromptExcludedMessage(message) && (!message?.is_system || Array.isArray(message?.extra?.tool_invocations));
}

export function resolveSplitCoreChatPayload(chatsDirectory, coreChatPayload) {
    if (!coreChatPayload || typeof coreChatPayload !== 'object' || coreChatPayload.mode !== CHAT_STORAGE_MODE_SPLIT_TAIL) {
        return Array.isArray(coreChatPayload) ? coreChatPayload : [];
    }

    const filePath = getCharacterChatFilePath(chatsDirectory, coreChatPayload.avatarUrl, coreChatPayload.currentChatId);
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const segments = getChatSegments(filePath);
    const layout = getSegmentLayout(segments);
    const totalMessages = layout.totalMessages;
    const normalizedTailStartId = Number.isInteger(coreChatPayload.tailStartId)
        ? Math.max(0, Math.min(coreChatPayload.tailStartId, totalMessages))
        : layout.tailStartId;
    const parentMessages = coreChatPayload.useParentUnhiddenMessages
        ? (!layout.headMessagesMissing
            ? segments.messages.slice(0, normalizedTailStartId).filter(isResidentParentPromptMessage)
            : [])
        : [];
    const tailMessages = coreChatPayload.useTailContents === false
        ? []
        : (layout.headMessagesMissing
            ? segments.tailMessages.slice(Math.max(0, Math.max(normalizedTailStartId, layout.tailStartId) - layout.tailStartId))
            : segments.messages.slice(normalizedTailStartId));

    return [...parentMessages, ...tailMessages];
}

/**
 * Saves a chat to the backups directory.
 * @param {string} directory The user's backups directory.
 * @param {string} name The name of the chat.
 * @param {string} chat The serialized chat to save.
 */
function backupChat(directory, name, chat) {
    try {
        if (!isBackupEnabled || !fs.existsSync(directory)) {
            return;
        }

        // replace non-alphanumeric characters with underscores
        name = sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase();

        const backupFile = path.join(directory, `${CHAT_BACKUPS_PREFIX}${name}_${generateTimestamp()}.jsonl`);
        writeFileAtomicSync(backupFile, chat, 'utf-8');

        removeOldBackups(directory, `${CHAT_BACKUPS_PREFIX}${name}_`);

        if (isNaN(maxTotalChatBackups) || maxTotalChatBackups < 0) {
            return;
        }

        removeOldBackups(directory, CHAT_BACKUPS_PREFIX, maxTotalChatBackups);
    } catch (err) {
        console.error(`Could not backup chat for ${name}`, err);
    }
}

/**
 * @type {Map<string, import('lodash').DebouncedFunc<function(string, string, string): void>>}
 */
const backupFunctions = new Map();

/**
 * Gets a backup function for a user.
 * @param {string} handle User handle
 * @returns {function(string, string, string): void} Backup function
 */
function getBackupFunction(handle) {
    if (!backupFunctions.has(handle)) {
        backupFunctions.set(handle, _.throttle(backupChat, throttleInterval, { leading: true, trailing: true }));
    }
    return backupFunctions.get(handle) || (() => { });
}

/**
 * Gets a preview message from an array of chat messages
 * @param {Array<Object>} messages - Array of chat messages, each with a 'mes' property
 * @returns {string} A truncated preview of the last message or empty string if no messages
 */
function getPreviewMessage(messages) {
    const strlen = 400;
    const lastMessage = messages[messages.length - 1]?.mes;

    if (!lastMessage) {
        return '';
    }

    return lastMessage.length > strlen
        ? '...' + lastMessage.substring(lastMessage.length - strlen)
        : lastMessage;
}

function getSearchFragments(query) {
    return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function getChatSearchResult(chatFile, fragments = []) {
    const messages = getLogicalChatMessages(chatFile.path)
        .filter(message => message && typeof message.mes === 'string');

    if (fragments.length && messages.length === 0) {
        return null;
    }

    const lastMessage = messages[messages.length - 1];
    const fallbackTimestamp = Math.round(fs.statSync(chatFile.path).mtimeMs);
    const lastMesDate = normalizeChatTimestamp(lastMessage?.send_date, fallbackTimestamp);
    const result = {
        file_name: chatFile.file_name,
        file_size: chatFile.file_size,
        message_count: messages.length,
        last_mes: lastMesDate,
        preview_message: getPreviewMessage(messages),
    };

    if (!fragments.length) {
        return result;
    }

    const text = [path.parse(chatFile.path).name, ...messages.map(message => message?.mes)].join('\n').toLowerCase();
    const hasMatch = fragments.every(fragment => text.includes(fragment));

    return hasMatch ? result : null;
}

process.on('exit', () => {
    for (const func of backupFunctions.values()) {
        func.flush();
    }
});

/**
 * Imports a chat from Ooba's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string} Chat data
 */
function importOobaChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        user_name: userName,
        character_name: characterName,
        create_date: humanizedISO8601DateTime(),
    }];

    for (const arr of jsonData.data_visible) {
        if (arr[0]) {
            const userMessage = {
                name: userName,
                is_user: true,
                send_date: humanizedISO8601DateTime(),
                mes: arr[0],
            };
            chat.push(userMessage);
        }
        if (arr[1]) {
            const charMessage = {
                name: characterName,
                is_user: false,
                send_date: humanizedISO8601DateTime(),
                mes: arr[1],
            };
            chat.push(charMessage);
        }
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from Agnai's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Chat data
 * @returns {string} Chat data
 */
function importAgnaiChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        user_name: userName,
        character_name: characterName,
        create_date: humanizedISO8601DateTime(),
    }];

    for (const message of jsonData.messages) {
        const isUser = !!message.userId;
        chat.push({
            name: isUser ? userName : characterName,
            is_user: isUser,
            send_date: humanizedISO8601DateTime(),
            mes: message.msg,
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from CAI Tools format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string[]} Converted data
 */
function importCAIChat(userName, characterName, jsonData) {
    /**
     * Converts the chat data to suitable format.
     * @param {object} history Imported chat data
     * @returns {object[]} Converted chat data
     */
    function convert(history) {
        const starter = {
            user_name: userName,
            character_name: characterName,
            create_date: humanizedISO8601DateTime(),
        };

        const historyData = history.msgs.map((msg) => ({
            name: msg.src.is_human ? userName : characterName,
            is_user: msg.src.is_human,
            send_date: humanizedISO8601DateTime(),
            mes: msg.text,
        }));

        return [starter, ...historyData];
    }

    const newChats = (jsonData.histories.histories ?? []).map(history => newChats.push(convert(history).map(obj => JSON.stringify(obj)).join('\n')));
    return newChats;
}

/**
 * Imports a chat from Kobold Lite format.
 * @param {string} _userName User name
 * @param {string} _characterName Character name
 * @param {object} data JSON data
 * @returns {string} Chat data
 */
function importKoboldLiteChat(_userName, _characterName, data) {
    const inputToken = '{{[INPUT]}}';
    const outputToken = '{{[OUTPUT]}}';

    /** @type {function(string): object} */
    function processKoboldMessage(msg) {
        const isUser = msg.includes(inputToken);
        return {
            name: isUser ? header.user_name : header.character_name,
            is_user: isUser,
            mes: msg.replaceAll(inputToken, '').replaceAll(outputToken, '').trim(),
            send_date: Date.now(),
        };
    }

    // Create the header
    const header = {
        user_name: String(data.savedsettings.chatname),
        character_name: String(data.savedsettings.chatopponent).split('||$||')[0],
    };
    // Format messages
    const formattedMessages = data.actions.map(processKoboldMessage);
    // Add prompt if available
    if (data.prompt) {
        formattedMessages.unshift(processKoboldMessage(data.prompt));
    }
    // Combine header and messages
    const chatData = [header, ...formattedMessages];
    return chatData.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Flattens `msg` and `swipes` data from Chub Chat format.
 * Only changes enough to make it compatible with the standard chat serialization format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {string[]} lines serialised JSONL data
 * @returns {string} Converted data
 */
function flattenChubChat(userName, characterName, lines) {
    function flattenSwipe(swipe) {
        return swipe.message ? swipe.message : swipe;
    }

    function convert(line) {
        const lineData = tryParse(line);
        if (!lineData) return line;

        if (lineData.mes && lineData.mes.message) {
            lineData.mes = lineData?.mes.message;
        }

        if (lineData?.swipes && Array.isArray(lineData.swipes)) {
            lineData.swipes = lineData.swipes.map(swipe => flattenSwipe(swipe));
        }

        return JSON.stringify(lineData);
    }

    return (lines ?? []).map(convert).join('\n');
}

/**
 * Imports a chat from RisuAI format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Imported chat data
 * @returns {string} Chat data
 */
function importRisuChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        user_name: userName,
        character_name: characterName,
        create_date: humanizedISO8601DateTime(),
    }];

    for (const message of jsonData.data.message) {
        const isUser = message.role === 'user';
        chat.push({
            name: message.name ?? (isUser ? userName : characterName),
            is_user: isUser,
            send_date: Number(message.time ?? Date.now()),
            mes: message.data ?? '',
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Reads the first line of a file asynchronously.
 * @param {string} filePath Path to the file
 * @returns {Promise<string>} The first line of the file
 */
function readFirstLine(filePath) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream });
    return new Promise((resolve, reject) => {
        let resolved = false;
        rl.on('line', line => {
            resolved = true;
            rl.close();
            stream.close();
            resolve(line);
        });

        rl.on('error', error => {
            resolved = true;
            reject(error);
        });

        // Handle empty files
        stream.on('end', () => {
            if (!resolved) {
                resolved = true;
                resolve('');
            }
        });
    });
}

/**
 * Checks if the chat being saved has the same integrity as the one being loaded.
 * @param {string} filePath Path to the chat file
 * @param {string} integritySlug Integrity slug
 * @returns {Promise<boolean>} Whether the chat is intact
 */
async function checkChatIntegrity(filePath, integritySlug) {
    // If the chat file doesn't exist, assume it's intact
    if (!fs.existsSync(filePath)) {
        return true;
    }

    // Parse the first line of the chat file as JSON
    const firstLine = await readFirstLine(filePath);
    const jsonData = tryParse(firstLine);
    const chatIntegrity = jsonData?.chat_metadata?.integrity;

    // If the chat has no integrity metadata, assume it's intact
    if (!chatIntegrity) {
        return true;
    }

    // Check if the integrity matches
    return chatIntegrity === integritySlug;
}

/**
 * @typedef {Object} ChatInfo
 * @property {string} [file_id] - The name of the chat file (without extension)
 * @property {string} [file_name] - The name of the chat file (with extension)
 * @property {string} [file_size] - The size of the chat file
 * @property {number} [chat_items] - The number of chat items in the file
 * @property {string} [mes] - The last message in the chat
 * @property {number} [last_mes] - The timestamp of the last message
 * @property {object} [chat_metadata] - Additional chat metadata
 */

/**
 * Reads the information from a chat file.
 * @param {string} pathToFile - Path to the chat file
 * @param {object} additionalData - Additional data to include in the result
 * @param {boolean} isGroup - Whether the chat is a group chat
 * @param {boolean} withMetadata - Whether to read chat metadata
 * @returns {Promise<ChatInfo>}
 */
export async function getChatInfo(pathToFile, additionalData = {}, isGroup = false, withMetadata = false) {
    return new Promise(async (res) => {
        const parsedPath = path.parse(pathToFile);
        const stats = await fs.promises.stat(pathToFile);

        if (isGroup) {
            const fileObjects = readJsonlObjects(pathToFile);
            const lastMessage = fileObjects.at(-1);
            const fallbackTimestamp = Math.round(stats.mtimeMs);
            const chatData = {
                file_id: parsedPath.name,
                file_name: parsedPath.base,
                file_size: `${(stats.size / 1024).toFixed(2)}kb`,
                chat_items: fileObjects.length,
                mes: lastMessage?.mes || '[The chat is empty]',
                last_mes: normalizeChatTimestamp(lastMessage?.send_date, fallbackTimestamp),
                ...additionalData,
            };

            return res(chatData);
        }

        const segments = getChatSegments(pathToFile);
        const headStats = segments.storage && fs.existsSync(segments.headPath)
            ? await fs.promises.stat(segments.headPath)
            : null;
        const totalSize = stats.size + (headStats?.size || 0);
        const fileSizeInKB = `${(totalSize / 1024).toFixed(2)}kb`;

        const chatData = {
            file_id: parsedPath.name,
            file_name: parsedPath.base,
            file_size: fileSizeInKB,
            chat_items: 0,
            mes: '[The chat is empty]',
            last_mes: Math.round(stats.mtimeMs),
            ...additionalData,
        };

        if (stats.size === 0 && !isGroup) {
            console.warn(`Found an empty chat file: ${pathToFile}`);
            res({});
            return;
        }

        if (stats.size === 0 && isGroup) {
            res(chatData);
            return;
        }

        if (withMetadata && segments.header && _.isObject(segments.header.chat_metadata)) {
            chatData.chat_metadata = segments.header.chat_metadata;
        }

        const lastMessage = segments.messages.at(-1);

        if (lastMessage || segments.header) {
            chatData.chat_items = getSegmentLayout(segments).totalMessages;
            chatData.mes = lastMessage?.mes || '[The message is empty]';
            chatData.last_mes = normalizeChatTimestamp(lastMessage?.send_date, Math.round(stats.mtimeMs));
            res(chatData);
        } else {
            console.warn('Found an invalid or corrupted chat file:', pathToFile);
            res({});
        }
    });
}

export const router = express.Router();

router.post('/save', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const directoryName = String(request.body.avatar_url).replace('.png', '');
        if (!hasValidChatPayload(request.body.chat)) {
            return response.status(400).send({ error: 'invalid_chat_payload' });
        }

        const chatData = request.body.chat;
        const config = normalizeLongChatConfig({
            displayCount: request.body.display_count,
            bufferMax: request.body.buffer_max,
        });
        const fileName = `${String(request.body.file_name)}.jsonl`;
        const filePath = path.join(request.user.directories.chats, directoryName, sanitize(fileName));
        if (checkIntegrity && !request.body.force) {
            const integritySlug = chatData?.[0]?.chat_metadata?.integrity;
            const isIntact = await checkChatIntegrity(filePath, integritySlug);
            if (!isIntact) {
                console.error(`Chat integrity check failed for ${filePath}`);
                return response.status(400).send({ error: 'integrity' });
            }
        }

        let logicalChatData = chatData;
        let requestedTailStartId = null;
        const existingSegments = fs.existsSync(filePath) ? getChatSegments(filePath) : null;
        const existingTailStartId = existingSegments?.storage?.head_count;

        if (request.body.save_mode === 'tail') {
            const existingChat = getLogicalChatData(filePath);
            const absoluteStartId = Number(request.body.absolute_start_id);

            if (!Number.isInteger(absoluteStartId) || absoluteStartId < 0 || existingChat.length === 0 || absoluteStartId > (existingChat.length - 1)) {
                return response.status(400).send({ error: 'invalid_tail_save' });
            }

            logicalChatData = [
                chatData[0] ?? existingChat[0],
                ...existingChat.slice(1, absoluteStartId + 1),
                ...chatData.slice(1),
            ];
            requestedTailStartId = absoluteStartId;
        } else if (Number.isInteger(existingTailStartId)) {
            requestedTailStartId = existingTailStartId;
        } else if (chatData.length > (config.bufferMax + 1)) {
            requestedTailStartId = Math.max(0, chatData.length - 1 - config.displayCount);
        }

        const header = logicalChatData[0];
        const messages = logicalChatData.slice(1);
        const writeResult = writeLogicalChat(filePath, header, messages, {
            displayCount: config.displayCount,
            bufferMax: config.bufferMax,
            tailStartId: requestedTailStartId,
        });
        getBackupFunction(request.user.profile.handle)(request.user.directories.backups, directoryName, writeResult.fullJsonl);

        const refreshRequired = writeResult.compacted
            || (existingSegments?.storage?.mode ?? 'full') !== writeResult.storageMode;

        return response.send({
            result: 'ok',
            storage_mode: writeResult.storageMode,
            tailStartId: writeResult.tailStartId,
            tailEndId: writeResult.tailEndId,
            headCount: writeResult.headCount,
            tailCount: writeResult.tailCount,
            payload: refreshRequired
                ? buildChunkedChatPayload(filePath, {
                    count: writeResult.storageMode === CHAT_STORAGE_MODE_SPLIT_TAIL ? writeResult.tailCount : messages.length,
                    hydrateFull: writeResult.storageMode !== CHAT_STORAGE_MODE_SPLIT_TAIL,
                    displayCount: config.displayCount,
                    bufferMax: config.bufferMax,
                    includeParentPromptCache: writeResult.storageMode === CHAT_STORAGE_MODE_SPLIT_TAIL,
                })
                : null,
        });
    } catch (error) {
        console.error(error);
        return response.send(error);
    }
});

router.post('/get', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const dirName = String(request.body.avatar_url).replace('.png', '');
        const directoryPath = path.join(request.user.directories.chats, dirName);
        const chatDirExists = fs.existsSync(directoryPath);

        //if no chat dir for the character is found, make one with the character name
        if (!chatDirExists) {
            fs.mkdirSync(directoryPath);
            return response.send({});
        }

        if (!request.body.file_name) {
            return response.send({});
        }

        const fileName = `${String(request.body.file_name)}.jsonl`;
        const filePath = path.join(directoryPath, sanitize(fileName));
        const chatFileExists = fs.existsSync(filePath);

        if (!chatFileExists) {
            return response.send({});
        }

        if (request.body.chunked) {
            const config = normalizeLongChatConfig({
                displayCount: request.body.display_count,
                bufferMax: request.body.buffer_max,
            });
            ensureSplitTailStorage(filePath, config);
            const rangeStart = request.body.range_start === undefined ? null : Number(request.body.range_start);
            const count = request.body.count === undefined ? null : Number(request.body.count);
            const hydrateFull = request.body.hydrate_full === true;
            try {
                await touchUserActivity(request.user.profile.handle);
            } catch (error) {
                console.error('Failed to update user last activity for direct chat read:', error);
            }
            return response.send(buildChunkedChatPayload(filePath, {
                rangeStart,
                count,
                hydrateFull,
                displayCount: config.displayCount,
                bufferMax: config.bufferMax,
                includeParentPromptCache: request.body.include_parent_prompt_cache === true,
            }));
        }

        try {
            await touchUserActivity(request.user.profile.handle);
        } catch (error) {
            console.error('Failed to update user last activity for direct chat read:', error);
        }
        return response.send(getLogicalChatData(filePath));
    } catch (error) {
        console.error(error);
        return response.send({});
    }
});

router.post('/save-prefix', validateAvatarUrlMiddleware, function (request, response) {
    try {
        const dirName = String(request.body.avatar_url).replace('.png', '');
        const directoryPath = path.join(request.user.directories.chats, dirName);
        const sourceFileName = `${String(request.body.source_file)}.jsonl`;
        const targetFileName = `${String(request.body.target_file)}.jsonl`;
        const sourcePath = path.join(directoryPath, sanitize(sourceFileName));
        const targetPath = path.join(directoryPath, sanitize(targetFileName));
        const prefixEndId = Number(request.body.prefix_end_id);
        const headerOverrides = _.isObject(request.body.header_overrides) ? request.body.header_overrides : {};

        if (!fs.existsSync(sourcePath) || !Number.isInteger(prefixEndId) || prefixEndId < 0) {
            return response.sendStatus(400);
        }

        const logicalChat = getLogicalChatData(sourcePath);
        const sourceHeader = logicalChat[0];
        const messages = logicalChat.slice(1);

        if (!sourceHeader || prefixEndId >= messages.length) {
            return response.sendStatus(400);
        }

        const targetHeader = { ...sourceHeader, ...headerOverrides };
        const writeResult = writeLogicalChat(targetPath, targetHeader, messages.slice(0, prefixEndId + 1));
        getBackupFunction(request.user.profile.handle)(request.user.directories.backups, dirName, writeResult.fullJsonl);
        return response.send({ ok: true });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/rename', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body || !request.body.original_file || !request.body.renamed_file) {
            return response.sendStatus(400);
        }

        const pathToFolder = request.body.is_group
            ? request.user.directories.groupChats
            : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
        const pathToOriginalFile = path.join(pathToFolder, sanitize(request.body.original_file));
        const pathToRenamedFile = path.join(pathToFolder, sanitize(request.body.renamed_file));
        const sanitizedFileName = path.parse(pathToRenamedFile).name;
        console.debug('Old chat name', pathToOriginalFile);
        console.debug('New chat name', pathToRenamedFile);

        if (!fs.existsSync(pathToOriginalFile) || fs.existsSync(pathToRenamedFile)) {
            console.error('Either Source or Destination files are not available');
            return response.status(400).send({ error: true });
        }

        fs.copyFileSync(pathToOriginalFile, pathToRenamedFile);
        fs.unlinkSync(pathToOriginalFile);

        const originalHeadPath = getSplitHeadPath(pathToOriginalFile);
        const renamedHeadPath = getSplitHeadPath(pathToRenamedFile);
        if (fs.existsSync(originalHeadPath)) {
            fs.copyFileSync(originalHeadPath, renamedHeadPath);
            fs.unlinkSync(originalHeadPath);
            const logicalChat = getLogicalChatData(pathToRenamedFile);
            if (logicalChat.length > 0) {
                writeLogicalChat(pathToRenamedFile, logicalChat[0], logicalChat.slice(1));
            }
        }

        console.info('Successfully renamed chat file.');
        return response.send({ ok: true, sanitizedFileName });
    } catch (error) {
        console.error('Error renaming chat file:', error);
        return response.status(500).send({ error: true });
    }
});

router.post('/delete', validateAvatarUrlMiddleware, function (request, response) {
    try {
        if (!path.extname(request.body.chatfile)) {
            request.body.chatfile += '.jsonl';
        }

        const dirName = String(request.body.avatar_url).replace('.png', '');
        const fileName = String(request.body.chatfile);
        const filePath = path.join(request.user.directories.chats, dirName, sanitize(fileName));
        const chatFileExists = fs.existsSync(filePath);

        if (!chatFileExists) {
            console.error(`Chat file not found '${filePath}'`);
            return response.sendStatus(400);
        }

        fs.unlinkSync(filePath);
        const headPath = getSplitHeadPath(filePath);
        if (fs.existsSync(headPath)) {
            fs.unlinkSync(headPath);
        }
        console.info(`Deleted chat file: ${filePath}`);
        return response.send('ok');
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/export', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body.file || (!request.body.avatar_url && request.body.is_group === false)) {
        return response.sendStatus(400);
    }
    const pathToFolder = request.body.is_group
        ? request.user.directories.groupChats
        : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
    let filename = path.join(pathToFolder, request.body.file);
    let exportfilename = request.body.exportfilename;
    if (!fs.existsSync(filename)) {
        const errorMessage = {
            message: `Could not find JSONL file to export. Source chat file: ${filename}.`,
        };
        console.error(errorMessage.message);
        return response.status(404).json(errorMessage);
    }
    try {
        // Short path for JSONL files
        if (request.body.format === 'jsonl') {
            try {
                const rawFile = serializeJsonl(getLogicalChatData(filename));
                const successMessage = {
                    message: `Chat saved to ${exportfilename}`,
                    result: rawFile,
                };

                console.info(`Chat exported as ${exportfilename}`);
                return response.status(200).json(successMessage);
            } catch (err) {
                console.error(err);
                const errorMessage = {
                    message: `Could not read JSONL file to export. Source chat file: ${filename}.`,
                };
                console.error(errorMessage.message);
                return response.status(500).json(errorMessage);
            }
        }

        let buffer = '';
        for (const data of getLogicalChatMessages(filename)) {
            if (data.is_system) {
                continue;
            }
            if (data.mes) {
                const name = data.name;
                const message = (data?.extra?.display_text || data?.mes || '').replace(/\r?\n/g, '\n');
                buffer += (`${name}: ${message}\n\n`);
            }
        }

        const successMessage = {
            message: `Chat saved to ${exportfilename}`,
            result: buffer,
        };
        console.info(`Chat exported as ${exportfilename}`);
        return response.status(200).json(successMessage);
    } catch (err) {
        console.error('chat export failed.', err);
        return response.sendStatus(400);
    }
});

router.post('/group/import', function (request, response) {
    try {
        const filedata = request.file;

        if (!filedata) {
            return response.sendStatus(400);
        }

        const chatname = humanizedISO8601DateTime();
        const pathToUpload = path.join(filedata.destination, filedata.filename);
        const pathToNewFile = path.join(request.user.directories.groupChats, `${chatname}.jsonl`);
        fs.copyFileSync(pathToUpload, pathToNewFile);
        fs.unlinkSync(pathToUpload);
        return response.send({ res: chatname });
    } catch (error) {
        console.error(error);
        return response.send({ error: true });
    }
});

router.post('/import', validateAvatarUrlMiddleware, function (request, response) {
    if (!request.body) return response.sendStatus(400);

    const format = request.body.file_type;
    const avatarUrl = (request.body.avatar_url).replace('.png', '');
    const characterName = request.body.character_name;
    const userName = request.body.user_name || 'User';
    const fileNames = [];

    if (!request.file) {
        return response.sendStatus(400);
    }

    try {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        const data = fs.readFileSync(pathToUpload, 'utf8');
        const chatsDirectory = path.join(request.user.directories.chats, avatarUrl);
        const importedChatBaseName = getImportedChatBaseName(request.file.originalname, characterName);

        if (!fs.existsSync(chatsDirectory)) {
            fs.mkdirSync(chatsDirectory, { recursive: true });
        }

        const getImportedChatFileName = (usedNames = []) => {
            const uniqueBaseName = getUniqueName(importedChatBaseName, (candidate) => {
                const fileName = `${candidate}.jsonl`;
                return usedNames.includes(fileName) || fs.existsSync(path.join(chatsDirectory, fileName));
            });

            return `${uniqueBaseName}.jsonl`;
        };

        if (format === 'json') {
            fs.unlinkSync(pathToUpload);
            const jsonData = JSON.parse(data);

            /** @type {function(string, string, object): string|string[]} */
            let importFunc;

            if (jsonData.savedsettings !== undefined) { // Kobold Lite format
                importFunc = importKoboldLiteChat;
            } else if (jsonData.histories !== undefined) { // CAI Tools format
                importFunc = importCAIChat;
            } else if (Array.isArray(jsonData.data_visible)) { // oobabooga's format
                importFunc = importOobaChat;
            } else if (Array.isArray(jsonData.messages)) { // Agnai's format
                importFunc = importAgnaiChat;
            } else if (jsonData.type === 'risuChat') { // RisuAI format
                importFunc = importRisuChat;
            } else { // Unknown format
                console.error('Incorrect chat format .json');
                return response.send({ error: true });
            }

            const handleChat = (chat) => {
                const fileName = getImportedChatFileName(fileNames);
                const filePath = path.join(chatsDirectory, fileName);
                const normalizedImportedChat = normalizeImportedSerializedChat(chat, fileName);

                if (!normalizedImportedChat?.header) {
                    throw new Error('Imported chat could not be normalized.');
                }

                fileNames.push(fileName);
                writeLogicalChat(filePath, normalizedImportedChat.header, normalizedImportedChat.messages);
            };

            const chat = importFunc(userName, characterName, jsonData);

            if (Array.isArray(chat)) {
                chat.forEach(handleChat);
            } else {
                handleChat(chat);
            }

            return response.send({ res: true, fileNames });
        }

        if (format === 'jsonl') {
            let lines = data.split('\n');
            const header = lines[0];

            const jsonData = JSON.parse(header);

            if (!(jsonData.user_name !== undefined || jsonData.name !== undefined)) {
                console.error('Incorrect chat format .jsonl');
                return response.send({ error: true });
            }

            const unsupportedImportMessage = getUnsupportedImportedJsonlMessage(jsonData);
            if (unsupportedImportMessage) {
                console.warn('Rejected unsupported JSONL chat import:', unsupportedImportMessage);
                return response.status(400).send({ error: true, message: unsupportedImportMessage });
            }

            // Do a tiny bit of work to import Chub Chat data
            // Processing the entire file is so fast that it's not worth checking if it's a Chub chat first
            let flattenedChat = data;
            try {
                // flattening is unlikely to break, but it's not worth failing to
                // import normal chats in an attempt to import a Chub chat
                flattenedChat = flattenChubChat(userName, characterName, lines);
            } catch (error) {
                console.warn('Failed to flatten Chub Chat data: ', error);
            }

            const fileName = getImportedChatFileName(fileNames);
            const filePath = path.join(chatsDirectory, fileName);
            const normalizedImportedChat = normalizeImportedSerializedChat(flattenedChat, fileName);

            if (!normalizedImportedChat?.header) {
                throw new Error('Imported chat could not be normalized.');
            }

            fileNames.push(fileName);
            writeLogicalChat(filePath, normalizedImportedChat.header, normalizedImportedChat.messages);
            fs.unlinkSync(pathToUpload);
            response.send({ res: true, fileNames });
        }
    } catch (error) {
        console.error(error);
        return response.send({ error: true });
    }
});

router.post('/group/get', async (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }

    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groupChats, `${id}.jsonl`);

    if (fs.existsSync(pathToFile)) {
        const payload = ensureGroupChatHeader(request.user, id, pathToFile);
        const jsonData = payload.messages;
        try {
            await touchUserActivity(request.user.profile.handle);
        } catch (error) {
            console.error('Failed to update user last activity for group chat read:', error);
        }

        if (request.body.chunked) {
            const totalMessages = jsonData.length;
            const requestedStart = request.body.range_start === undefined ? Math.max(0, totalMessages - 50) : Number(request.body.range_start);
            const requestedCount = request.body.count === undefined ? 50 : Number(request.body.count);
            const loadedRangeStart = Number.isInteger(requestedStart) ? Math.max(0, Math.min(requestedStart, Math.max(0, totalMessages - 1))) : 0;
            const count = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : 50;
            const loadedRangeEnd = totalMessages > 0
                ? Math.min(totalMessages - 1, loadedRangeStart + count - 1)
                : -1;

            return response.send({
                mode: 'full',
                isHydrated: true,
                totalMessages,
                loadedRangeStart,
                loadedRangeEnd,
                messages: loadedRangeEnd >= loadedRangeStart
                    ? jsonData.slice(loadedRangeStart, loadedRangeEnd + 1)
                    : [],
            });
        }

        return response.send(jsonData);
    } else {
        return response.send([]);
    }
});

router.post('/group/delete', (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }

    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groupChats, `${id}.jsonl`);

    if (fs.existsSync(pathToFile)) {
        fs.unlinkSync(pathToFile);
        const headPath = getSplitHeadPath(pathToFile);
        if (fs.existsSync(headPath)) {
            fs.unlinkSync(headPath);
        }
        return response.send({ ok: true });
    }

    return response.send({ error: true });
});

router.post('/group/save', (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }

    if (!hasValidChatPayload(request.body.chat)) {
        return response.status(400).send({ error: 'invalid_chat_payload' });
    }

    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groupChats, `${id}.jsonl`);

    if (!fs.existsSync(request.user.directories.groupChats)) {
        fs.mkdirSync(request.user.directories.groupChats);
    }

    let chat_data = request.body.chat;
    const existingPayload = getGroupChatPayload(pathToFile);
    const chatMetadata = _.isPlainObject(request.body.chat_metadata)
        ? _.cloneDeep(request.body.chat_metadata)
        : (existingPayload.hasHeader
            ? _.cloneDeep(existingPayload.header?.chat_metadata || {})
            : resolveLegacyGroupChatMetadata(request.user, id));
    const writeResult = writeGroupChat(pathToFile, chat_data, chatMetadata, existingPayload.header);
    getBackupFunction(request.user.profile.handle)(request.user.directories.backups, String(id), writeResult.fullJsonl);
    return response.send({ ok: true });
});

router.post('/search', validateAvatarUrlMiddleware, function (request, response) {
    try {
        const { query, avatar_url, group_id } = request.body;
        const fragments = getSearchFragments(query);
        let chatFiles = [];

        if (group_id) {
            // Find group's chat IDs first
            const groupDir = path.join(request.user.directories.groups);
            const groupFiles = fs.readdirSync(groupDir)
                .filter(file => file.endsWith('.json'));

            let targetGroup;
            for (const groupFile of groupFiles) {
                try {
                    const groupData = JSON.parse(fs.readFileSync(path.join(groupDir, groupFile), 'utf8'));
                    if (groupData.id === group_id) {
                        targetGroup = groupData;
                        break;
                    }
                } catch (error) {
                    console.warn(groupFile, 'group file is corrupted:', error);
                }
            }

            if (!targetGroup?.chats) {
                return response.send([]);
            }

            // Find group chat files for given group ID
            const groupChatsDir = path.join(request.user.directories.groupChats);
            chatFiles = targetGroup.chats
                .map(chatId => {
                    const filePath = path.join(groupChatsDir, `${chatId}.jsonl`);
                    if (!fs.existsSync(filePath)) return null;
                    const stats = fs.statSync(filePath);
                    return {
                        file_name: chatId,
                        file_size: formatBytes(stats.size),
                        path: filePath,
                    };
                })
                .filter(x => x);
        } else {
            // Regular character chat directory
            const character_name = avatar_url.replace('.png', '');
            const directoryPath = path.join(request.user.directories.chats, character_name);

            if (!fs.existsSync(directoryPath)) {
                return response.send([]);
            }

            chatFiles = fs.readdirSync(directoryPath)
                .filter(file => file.endsWith('.jsonl') && !isHeadChatFile(file))
                .map(fileName => {
                    const filePath = path.join(directoryPath, fileName);
                    const stats = fs.statSync(filePath);
                    const headPath = getSplitHeadPath(filePath);
                    const headStats = fs.existsSync(headPath) ? fs.statSync(headPath) : null;
                    return {
                        file_name: fileName,
                        file_size: formatBytes(stats.size + (headStats?.size || 0)),
                        path: filePath,
                    };
                });
        }

        const results = [];

        for (const chatFile of chatFiles) {
            const searchResult = getChatSearchResult(chatFile, fragments);
            if (searchResult) {
                results.push(searchResult);
            }
        }

        // Sort by last message date descending
        results.sort((a, b) => b.last_mes - a.last_mes);
        return response.send(results);

    } catch (error) {
        console.error('Chat search error:', error);
        return response.status(500).json({ error: 'Search failed' });
    }
});

router.post('/orphaned', async function (request, response) {
    try {
        const query = request.body?.query;
        const orphanKeyFilter = String(request.body?.orphan_key || '').trim();
        const fragments = getSearchFragments(query);
        const characterDirents = await fs.promises.readdir(request.user.directories.characters, { withFileTypes: true }).catch(() => []);
        const liveCharacterKeys = new Set(
            characterDirents
                .filter(entry => entry.isFile() && path.extname(entry.name) === '.png')
                .map(entry => path.parse(entry.name).name),
        );

        const chatDirents = await fs.promises.readdir(request.user.directories.chats, { withFileTypes: true }).catch(() => []);
        const orphanDirectories = chatDirents
            .filter(entry => entry.isDirectory() && !liveCharacterKeys.has(entry.name))
            .filter(entry => !orphanKeyFilter || entry.name === orphanKeyFilter)
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));

        const groupDirents = await fs.promises.readdir(request.user.directories.groups, { withFileTypes: true }).catch(() => []);
        const groups = [];

        for (const entry of groupDirents) {
            if (!entry.isFile() || path.extname(entry.name) !== '.json') {
                continue;
            }

            try {
                const filePath = path.join(request.user.directories.groups, entry.name);
                const group = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                groups.push(group);
            } catch (error) {
                console.warn('Failed to read group while listing orphaned chats:', entry.name, error);
            }
        }

        const toChatSummary = (chatData) => ({
            file_name: chatData.file_name,
            file_size: chatData.file_size,
            message_count: chatData.chat_items ?? 0,
            last_mes: normalizeChatTimestamp(chatData.last_mes, 0),
            preview_message: chatData.mes ?? '',
        });

        const orphanEntries = [];

        for (const orphanKey of orphanDirectories) {
            const avatarUrl = `${orphanKey}.png`;
            const orphanChatDir = path.join(request.user.directories.chats, orphanKey);
            const orphanChatFiles = await fs.promises.readdir(orphanChatDir, { withFileTypes: true }).catch(() => []);
            const directChatFiles = orphanChatFiles
                .filter(file => file.isFile() && path.extname(file.name) === '.jsonl' && !isHeadChatFile(file.name))
                .map(file => file.name);

            const directChats = fragments.length
                ? directChatFiles
                    .map(fileName => {
                        const filePath = path.join(orphanChatDir, fileName);
                        const stats = fs.statSync(filePath);
                        const headPath = getSplitHeadPath(filePath);
                        const headStats = fs.existsSync(headPath) ? fs.statSync(headPath) : null;
                        return getChatSearchResult({
                            file_name: fileName,
                            file_size: formatBytes(stats.size + (headStats?.size || 0)),
                            path: filePath,
                        }, fragments);
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.last_mes - a.last_mes)
                : (await Promise.allSettled(
                    directChatFiles.map(fileName => {
                        const filePath = path.join(orphanChatDir, fileName);
                        return getChatInfo(filePath, {}, false, false);
                    }),
                ))
                    .filter(result => result.status === 'fulfilled' && result.value?.file_name)
                    .map(result => toChatSummary(result.value))
                    .sort((a, b) => b.last_mes - a.last_mes);

            const relatedGroups = [];

            for (const group of groups) {
                if (!Array.isArray(group?.members) || !group.members.includes(avatarUrl)) {
                    continue;
                }

                const groupChats = fragments.length
                    ? (Array.isArray(group.chats) ? group.chats : [])
                        .map(chatId => {
                            const filePath = path.join(request.user.directories.groupChats, `${chatId}.jsonl`);
                            if (!fs.existsSync(filePath)) {
                                return null;
                            }

                            const stats = fs.statSync(filePath);
                            return getChatSearchResult({
                                file_name: `${chatId}.jsonl`,
                                file_size: formatBytes(stats.size),
                                path: filePath,
                            }, fragments);
                        })
                        .filter(Boolean)
                        .sort((a, b) => b.last_mes - a.last_mes)
                    : (await Promise.allSettled(
                        (Array.isArray(group.chats) ? group.chats : []).map(chatId => {
                            const filePath = path.join(request.user.directories.groupChats, `${chatId}.jsonl`);
                            if (!fs.existsSync(filePath)) {
                                return Promise.resolve(null);
                            }

                            return getChatInfo(filePath, {}, true, false);
                        }),
                    ))
                        .filter(result => result.status === 'fulfilled' && result.value?.file_name)
                        .map(result => toChatSummary(result.value))
                        .sort((a, b) => b.last_mes - a.last_mes);

                if (groupChats.length > 0) {
                    relatedGroups.push({
                        id: String(group.id),
                        name: String(group.name || group.id),
                        avatar_url: group.avatar_url || '',
                        chats: groupChats,
                    });
                }
            }

            if (directChats.length > 0 || relatedGroups.length > 0) {
                orphanEntries.push({
                    orphan_key: orphanKey,
                    direct_chats: directChats,
                    related_groups: relatedGroups,
                });
            }
        }

        return response.send(orphanEntries);
    } catch (error) {
        console.error('Orphaned chat browser error:', error);
        return response.status(500).json({ error: true });
    }
});

router.post('/recent', async function (request, response) {
    try {
        /** @type {{pngFile?: string, groupId?: string, filePath: string, mtime: number}[]} */
        const allChatFiles = [];

        const getCharacterChatFiles = async () => {
            const pngDirents = await fs.promises.readdir(request.user.directories.characters, { withFileTypes: true });
            const pngFiles = pngDirents.filter(e => e.isFile() && path.extname(e.name) === '.png').map(e => e.name);

            for (const pngFile of pngFiles) {
                const chatsDirectory = pngFile.replace('.png', '');
                const pathToChats = path.join(request.user.directories.chats, chatsDirectory);
                if (!fs.existsSync(pathToChats)) {
                    continue;
                }
                const pathStats = await fs.promises.stat(pathToChats);
                if (pathStats.isDirectory()) {
                    const chatFiles = await fs.promises.readdir(pathToChats);
                    const jsonlFiles = chatFiles.filter(file => path.extname(file) === '.jsonl' && !isHeadChatFile(file));

                    for (const file of jsonlFiles) {
                        const filePath = path.join(pathToChats, file);
                        const stats = await fs.promises.stat(filePath);
                        allChatFiles.push({ pngFile, filePath, mtime: stats.mtimeMs });
                    }
                }
            }
        };

        const getGroupChatFiles = async () => {
            const groupDirents = await fs.promises.readdir(request.user.directories.groups, { withFileTypes: true });
            const groups = groupDirents.filter(e => e.isFile() && path.extname(e.name) === '.json').map(e => e.name);

            for (const group of groups) {
                try {
                    const groupPath = path.join(request.user.directories.groups, group);
                    const groupContents = await fs.promises.readFile(groupPath, 'utf8');
                    const groupData = JSON.parse(groupContents);

                    if (Array.isArray(groupData.chats)) {
                        for (const chat of groupData.chats) {
                            const filePath = path.join(request.user.directories.groupChats, `${chat}.jsonl`);
                            if (!fs.existsSync(filePath)) {
                                continue;
                            }
                            const stats = await fs.promises.stat(filePath);
                            allChatFiles.push({ groupId: groupData.id, filePath, mtime: stats.mtimeMs });
                        }
                    }
                } catch (error) {
                    // Skip group files that can't be read or parsed
                    continue;
                }
            }
        };

        const getRootChatFiles = async () => {
            const dirents = await fs.promises.readdir(request.user.directories.chats, { withFileTypes: true });
            const chatFiles = dirents.filter(e => e.isFile() && path.extname(e.name) === '.jsonl' && !isHeadChatFile(e.name)).map(e => e.name);

            for (const file of chatFiles) {
                const filePath = path.join(request.user.directories.chats, file);
                const stats = await fs.promises.stat(filePath);
                allChatFiles.push({ filePath, mtime: stats.mtimeMs });
            }
        };

        await Promise.allSettled([getCharacterChatFiles(), getGroupChatFiles(), getRootChatFiles()]);

        const max = parseInt(request.body.max ?? Number.MAX_SAFE_INTEGER);
        const recentChats = allChatFiles.sort((a, b) => b.mtime - a.mtime).slice(0, max);
        const jsonFilesPromise = recentChats.map((file) => {
            const withMetadata = Boolean(request.body.metadata);
            return file.groupId
                ? getChatInfo(file.filePath, { group: file.groupId }, true, withMetadata)
                : getChatInfo(file.filePath, { avatar: file.pngFile }, false, withMetadata);
        });

        const chatData = (await Promise.allSettled(jsonFilesPromise)).filter(x => x.status === 'fulfilled').map(x => x.value);
        const validFiles = chatData.filter(i => i.file_name);

        return response.send(validFiles);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
