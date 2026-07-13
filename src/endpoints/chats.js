import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import _ from 'lodash';

import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';
import { touchUserActivity } from '../users.js';
import { isActiveSessionError, sendActiveSessionRequired } from '../active-session-store.js';
import { withDirectoryLock } from '../file-system-lock.js';
import {
    backupSqliteDatabaseFile,
    copyLegacyJsonlFile,
    deleteChatStorageCompanions,
    getChatStorageCompanionPaths,
    hasPrimaryChatStorageFile,
    getNewChatTargetConflict,
    replaceChatStorageExtension,
    withChatSaveLock,
    withChatSaveLocks,
} from '../chat-storage.js';
import {
    assertPathInside,
    getDeduplicatedChatHistoryFileNames,
    isChatPathValidationError,
    normalizeCharacterChatDirectoryName,
    resolveCharacterChatDirectory,
    resolveCharacterChatFilePath,
    resolveGroupChatFilePath,
    validateStmbChatRef,
} from '../chat-paths.js';
import {
    getConfigValue,
    humanizedISO8601DateTime,
    tryParse,
    generateTimestamp,
    removeOldBackups,
    formatBytes,
    getUniqueName,
    sanitizeSafeCharacterReplacements,
    uuidv4,
} from '../util.js';
import {
    AIKOBOTS_MESSAGE_UUID_KEY,
    AIKOBOTS_SWIPE_UUID_KEY,
    cloneMessageWithNewIdentity,
    compareActiveSwipeState,
    isValidAikobotsUuid,
    normalizeChatIdentities,
    regenerateChatIdentities,
    stripAikobotsIdentityMetadata,
    validateMessageSwipeState,
} from '../../public/scripts/chat-identities.js';
import {
    loadDb,
    saveDb,
    exportDatabaseFile,
    getMessages,
    setMessages,
    getChatHeader,
    getMessageCount,
    getLastMessage,
    getMessageRange,
    appendLogicalMessage,
    insertLogicalMessageAfter,
    getLogicalMessageRow,
    getLogicalMessageRowByUuid,
    updateLogicalMessageRowById,
    deleteLogicalMessagesAfter,
    deleteAllLogicalMessages,
    updateMessages,
    getMetadata,
    setMetadata,
    getOperationReceipt,
    recordOperationReceipt,
    readChatActivityData,
} from '../sqlite-manager.js';

const isBackupEnabled = !!getConfigValue('backups.chat.enabled', true, 'boolean');
const maxTotalChatBackups = Number(getConfigValue('backups.chat.maxTotalBackups', -1, 'number'));
const throttleInterval = Number(getConfigValue('backups.chat.throttleInterval', 10_000, 'number'));
const checkIntegrity = !!getConfigValue('backups.chat.checkIntegrity', true, 'boolean');
const sqliteAppendBackupMessageInterval = Math.max(0, Math.floor(Number(getConfigValue('backups.chat.sqliteAppendBackupMessageInterval', 2, 'number'))));
const CHAT_STORAGE_KEY = 'chat_storage';
const CHAT_REVISION_KEY = 'chat_revision';
const CHAT_LAST_SAVE_SESSION_KEY = 'last_save_session_id';
const CHAT_IDENTITY_REPAIR_ERROR = 'chat_repaired';
const CHAT_IDENTITY_SCAN_METADATA_KEY = 'identity_scan_version';
const CHAT_IDENTITY_SCAN_VERSION = '1';
const CHAT_LAST_ACTIVITY_METADATA_KEY = 'last_activity_at';
const GROUP_CHAT_HEADER_VERSION = 1;
const CHAT_METADATA_STRIP_KEYS = ['timedWorldInfo', 'worldInfoSummary', 'worldInfoReport'];
const CHAT_EXTRA_STRIP_KEYS = ['timedWorldInfo', 'worldInfoSummary', 'worldInfoReport'];
const TIMED_WORLD_INFO_CHECKPOINT_KEY = 'timedWorldInfoCheckpoint';
const TIMED_WORLD_INFO_CHECKPOINT_VERSION = 1;
const LONG_CHAT_DISPLAY_MIN = 25;
const LONG_CHAT_DISPLAY_MAX = 1048576; // 2^20
const LONG_CHAT_DISPLAY_DEFAULT = 100;
const CHAT_SAVE_LOCK_RETRY_MS = 25;
const CHAT_SAVE_LOCK_TIMEOUT_MS = 10_000;
const CHAT_SAVE_LOCK_STALE_MS = 10 * 60_000;
const CHAT_SAVE_LOCK_HEARTBEAT_MS = 1_000;

export const CHAT_BACKUPS_PREFIX = 'chat_';

export {
    getDeduplicatedChatHistoryFileNames,
    isHeadChatFile,
} from '../chat-paths.js';

function sendChatPathValidationError(response, error) {
    return response.status(error.status || 400).send({
        error: error.code || 'invalid_chat_path',
        message: error.message,
    });
}

function isUnsupportedSplitTailChatError(error) {
    return error instanceof UnsupportedSplitTailChatError || error?.code === 'unsupported_split_tail';
}

function sendUnsupportedSplitTailChatError(response, error) {
    return response.status(error.status || 409).send({
        error: error.code || 'unsupported_split_tail',
        message: error.message,
    });
}

function stripChatStorage(header) {
    if (!header || !_.isObject(header)) {
        return header;
    }

    const result = { ...header };
    delete result[CHAT_STORAGE_KEY];
    return result;
}

/**
 * Normalizes read responses so clients can rely on explicit revision metadata.
 */
function normalizeChatResponseHeader(header) {
    const responseHeader = stripChatStorage(header);
    if (!_.isPlainObject(responseHeader)) {
        return responseHeader;
    }

    return setChatRevision(responseHeader, getChatRevision(responseHeader), getChatLastSaveSessionId(responseHeader));
}

function getChatStorage(header) {
    const storage = header?.[CHAT_STORAGE_KEY];
    return storage?.mode === 'split-tail' ? storage : null;
}

class UnsupportedSplitTailChatError extends Error {
    constructor(message = 'Split-tail chat storage is no longer supported. Convert this chat to SQLite before opening it.') {
        super(message);
        this.name = 'UnsupportedSplitTailChatError';
        this.code = 'unsupported_split_tail';
        this.status = 409;
    }
}

function assertSupportedChatStorage(header) {
    if (getChatStorage(header)) {
        throw new UnsupportedSplitTailChatError();
    }
}

function getChatRevision(header) {
    const revision = Number(header?.[CHAT_REVISION_KEY]);
    return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizeSaveSessionId(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedSessionId)
        ? normalizedSessionId
        : '';
}

function getChatLastSaveSessionId(header) {
    return normalizeSaveSessionId(header?.[CHAT_LAST_SAVE_SESSION_KEY]);
}

function getRequestSaveSessionId(requestBody) {
    return normalizeSaveSessionId(requestBody?.save_session_id);
}

function setChatRevision(header, revision, saveSessionId = '') {
    const normalizedRevision = Number(revision);
    const revisedHeader = {
        ...(_.isPlainObject(header) ? header : {}),
        [CHAT_REVISION_KEY]: Number.isInteger(normalizedRevision) && normalizedRevision >= 0 ? normalizedRevision : 0,
    };
    const normalizedSessionId = normalizeSaveSessionId(saveSessionId);

    if (normalizedSessionId) {
        revisedHeader[CHAT_LAST_SAVE_SESSION_KEY] = normalizedSessionId;
    } else {
        delete revisedHeader[CHAT_LAST_SAVE_SESSION_KEY];
    }

    return revisedHeader;
}

function getRequestBaseRevision(requestBody) {
    if (!Object.prototype.hasOwnProperty.call(requestBody || {}, 'base_revision')) {
        return null;
    }

    const revision = Number(requestBody.base_revision);
    return Number.isInteger(revision) && revision >= 0 ? revision : NaN;
}

function validateSaveRevision(requestBody, existingHeader) {
    const baseRevision = getRequestBaseRevision(requestBody);
    const currentRevision = getChatRevision(existingHeader);
    const lastSaveSessionId = getChatLastSaveSessionId(existingHeader);

    if (baseRevision === null) {
        return { ok: true, currentRevision, nextRevision: currentRevision + 1 };
    }

    if (!Number.isInteger(baseRevision)) {
        return { ok: false, status: 400, error: 'invalid_revision', currentRevision, submittedBaseRevision: baseRevision };
    }

    if (baseRevision !== currentRevision) {
        return { ok: false, status: 409, error: 'stale_revision', currentRevision, lastSaveSessionId, submittedBaseRevision: baseRevision };
    }

    return { ok: true, currentRevision, nextRevision: currentRevision + 1 };
}

function isForcePushAuthorityRequest(requestBody) {
    return requestBody?.force === true && requestBody?.force_push === true && requestBody?.save_mode === 'loaded_range';
}

function getServerAuthorityRevisionCheck(header) {
    const currentRevision = getChatRevision(header);
    return { ok: true, currentRevision, nextRevision: currentRevision + 1 };
}

function hasModernSaveMetadata(header) {
    return _.isPlainObject(header)
        && (Object.prototype.hasOwnProperty.call(header, CHAT_REVISION_KEY)
            || Object.prototype.hasOwnProperty.call(header, CHAT_LAST_SAVE_SESSION_KEY));
}

function unlinkFileIfExists(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
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
    delete sanitizedMessage.id;
    delete sanitizedMessage.order_index;

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
    delete sanitizedHeader.id;
    delete sanitizedHeader.order_index;
    if (_.isPlainObject(sanitizedHeader.chat_metadata)) {
        sanitizedHeader.chat_metadata = stripPersistedChatMetadata(sanitizedHeader.chat_metadata);
    }

    return sanitizedHeader;
}

function removePromptSnapshotKeysFromMessage(message) {
    if (!_.isPlainObject(message)) {
        return;
    }

    if (_.isPlainObject(message.extra)) {
        delete message.extra.promptSnapshotKey;
    }

    if (!Array.isArray(message.swipe_info)) {
        return;
    }

    for (const swipeInfo of message.swipe_info) {
        if (_.isPlainObject(swipeInfo?.extra)) {
            delete swipeInfo.extra.promptSnapshotKey;
        }
    }
}

function removeTimedWorldInfoCheckpointsFromMessage(message) {
    if (!_.isPlainObject(message)) {
        return;
    }

    if (_.isPlainObject(message.extra)) {
        delete message.extra[TIMED_WORLD_INFO_CHECKPOINT_KEY];
    }

    if (!Array.isArray(message.swipe_info)) {
        return;
    }

    for (const swipeInfo of message.swipe_info) {
        if (_.isPlainObject(swipeInfo?.extra)) {
            delete swipeInfo.extra[TIMED_WORLD_INFO_CHECKPOINT_KEY];
        }
    }
}

function normalizeTimedWorldInfoState(timedWorldInfo) {
    if (!_.isPlainObject(timedWorldInfo)) {
        return null;
    }

    const state = _.cloneDeep(timedWorldInfo);
    for (const type of ['sticky', 'cooldown']) {
        if (!_.isPlainObject(state[type])) {
            state[type] = {};
        }
    }

    return state;
}

function remapTimedWorldInfoState(timedWorldInfo, remapIndex) {
    const state = normalizeTimedWorldInfoState(timedWorldInfo);
    if (!state) {
        return null;
    }

    if (typeof remapIndex !== 'function') {
        return state;
    }

    for (const type of ['sticky', 'cooldown']) {
        for (const effect of Object.values(state[type])) {
            if (!_.isPlainObject(effect)) {
                continue;
            }

            if (Number.isFinite(Number(effect.start))) {
                effect.start = remapIndex(Number(effect.start));
            }

            if (Number.isFinite(Number(effect.end))) {
                effect.end = remapIndex(Number(effect.end));
            }
        }
    }

    return state;
}

function remapTimedWorldInfoCheckpoint(extra, messageId, remapIndex) {
    if (!_.isPlainObject(extra)) {
        return;
    }

    const checkpoint = extra[TIMED_WORLD_INFO_CHECKPOINT_KEY];
    if (!_.isPlainObject(checkpoint) || Number(checkpoint.version) !== TIMED_WORLD_INFO_CHECKPOINT_VERSION) {
        delete extra[TIMED_WORLD_INFO_CHECKPOINT_KEY];
        return;
    }

    const state = remapTimedWorldInfoState(checkpoint.timedWorldInfo, remapIndex);
    if (!state) {
        delete extra[TIMED_WORLD_INFO_CHECKPOINT_KEY];
        return;
    }

    extra[TIMED_WORLD_INFO_CHECKPOINT_KEY] = {
        version: TIMED_WORLD_INFO_CHECKPOINT_VERSION,
        messageId: Number(messageId),
        timedWorldInfo: state,
    };
}

function remapMessageTimedWorldInfoCheckpoints(message, messageId, remapIndex) {
    if (!_.isPlainObject(message)) {
        return;
    }

    remapTimedWorldInfoCheckpoint(message.extra, messageId, remapIndex);

    if (!Array.isArray(message.swipe_info)) {
        return;
    }

    for (const swipeInfo of message.swipe_info) {
        remapTimedWorldInfoCheckpoint(swipeInfo?.extra, messageId, remapIndex);
    }
}

function createInsertMessageIndexMapper(insertAt) {
    const insertedMessageId = Number(insertAt);
    return (messageId) => messageId >= insertedMessageId ? messageId + 1 : messageId;
}

function createDeleteMessageIndexMapper(deletedAt) {
    const deletedMessageId = Number(deletedAt);
    return (messageId) => messageId > deletedMessageId ? messageId - 1 : messageId;
}

class ChatMutationError extends Error {
    constructor(status, error, message = error, details = {}) {
        super(message);
        this.name = 'ChatMutationError';
        this.status = status;
        this.error = error;
        this.details = details;
    }
}

function getRequestBaseRevisionForLog(requestBody) {
    if (!Object.prototype.hasOwnProperty.call(requestBody || {}, 'base_revision')) {
        return null;
    }

    const revision = Number(requestBody.base_revision);
    return Number.isInteger(revision) && revision >= 0 ? revision : String(requestBody.base_revision);
}

function getLoadedRangeForLog(requestBody) {
    if (!requestBody || requestBody.loaded_range_start === undefined) {
        return null;
    }

    return {
        start: requestBody.loaded_range_start,
        end: requestBody.loaded_range_end,
    };
}

function logChatPersistenceOperation(level, {
    routeName = 'unknown',
    operationType = 'unknown',
    filePath = '',
    oldRevision = null,
    requestBody = null,
    submittedMessageCount = null,
    serverMessageCountBefore = null,
    serverMessageCountAfter = null,
    isPrivilegedOperation = false,
    rejectionReason = null,
} = {}) {
    const payload = {
        route_name: routeName,
        operation_type: operationType,
        chat_path: filePath,
        old_revision: oldRevision,
        submitted_base_revision: getRequestBaseRevisionForLog(requestBody),
        save_session_id: getRequestSaveSessionId(requestBody),
        submitted_message_count: submittedMessageCount,
        server_message_count_before: serverMessageCountBefore,
        server_message_count_after: serverMessageCountAfter,
        loaded_range: getLoadedRangeForLog(requestBody),
        full_chat: requestBody?.full_chat === true,
        import_admin_recovery: isPrivilegedOperation === true,
        rejection_reason: rejectionReason,
    };

    const message = `[ChatPersistence] ${JSON.stringify(payload)}`;
    if (level === 'error') {
        console.error(message);
    } else if (level === 'warn') {
        console.warn(message);
    } else {
        console.info(message);
    }
}

export function validateExistingSqliteFullReplacementRequest({
    routeName = 'unknown',
    operationType = 'full_replace',
    filePath = '',
    requestBody = null,
    existingHeader = null,
    serverMessageCountBefore = null,
    submittedMessageCount = null,
    isPrivilegedOperation = false,
    rejectionReason = 'sqlite_full_replacement_forbidden',
} = {}) {
    if (isPrivilegedOperation === true) {
        return { ok: true };
    }

    logChatPersistenceOperation('warn', {
        routeName,
        operationType,
        filePath,
        oldRevision: getChatRevision(existingHeader),
        requestBody,
        submittedMessageCount,
        serverMessageCountBefore,
        isPrivilegedOperation,
        rejectionReason,
    });

    return {
        ok: false,
        status: 409,
        error: rejectionReason,
    };
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

function getChatFileStats(filePath) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (fs.existsSync(sqlitePath)) {
        const stats = fs.statSync(sqlitePath);
        return {
            tailStats: stats,
            totalSize: stats.size,
            latestMtimeMs: stats.mtimeMs,
            isSqlite: true,
        };
    }

    const tailStats = fs.statSync(filePath);

    return {
        tailStats,
        totalSize: tailStats.size,
        latestMtimeMs: tailStats.mtimeMs,
        isSqlite: false,
    };
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

    delete normalizedHeader?.[CHAT_REVISION_KEY];

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

function normalizeImportedChatRecords(records, fileName) {
    const chatRecords = Array.isArray(records)
        ? records.filter(record => _.isPlainObject(record))
        : [];

    if (!chatRecords.length) {
        return null;
    }

    const [header, ...messages] = chatRecords;
    const chatScope = `chat:${path.parse(String(fileName || '')).name}`;

    return {
        sourceHeader: header,
        header: normalizeImportedHeader(header),
        messages: messages.map((message, mesId) => normalizeImportedMessage(message, { chatScope, mesId })),
    };
}

function normalizeImportedSerializedChat(serializedChat, fileName) {
    const records = String(serializedChat || '')
        .split('\n')
        .map(line => tryParse(line));

    return normalizeImportedChatRecords(records, fileName);
}

/**
 * Reads an uploaded SQLite chat through the normal chat DB loader before re-saving it.
 * @param {string} sqlitePath Uploaded SQLite file path.
 * @param {string} fileName Target chat file name used for imported metadata keys.
 * @returns {Promise<{sourceHeader: object, header: object, messages: object[]}|null>}
 */
async function normalizeImportedSqliteChat(sqlitePath, fileName) {
    const db = await loadDb(sqlitePath);
    try {
        return normalizeImportedChatRecords(getMessages(db), fileName);
    } finally {
        db.close();
    }
}

function clampLongChatValue(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeLongChatConfig({ displayCount = LONG_CHAT_DISPLAY_DEFAULT } = {}) {
    const normalizedDisplayCount = clampLongChatValue(
        displayCount,
        LONG_CHAT_DISPLAY_MIN,
        LONG_CHAT_DISPLAY_MAX,
        LONG_CHAT_DISPLAY_DEFAULT,
    );

    return {
        displayCount: normalizedDisplayCount,
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
    if (!Array.isArray(chat) || !_.isPlainObject(chat[0])) {
        return false;
    }

    for (let index = 0; index < chat.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(chat, index) || !_.isPlainObject(chat[index])) {
            return false;
        }
    }

    return true;
}

/** Records a committed canonical-message activity timestamp in SQLite metadata. */
function setChatLastActivity(db, timestamp = Date.now()) {
    setMetadata(db, CHAT_LAST_ACTIVITY_METADATA_KEY, String(timestamp));
}

/** Reads canonical-message activity, falling back to the last persisted message for legacy chats. */
function getChatLastActivity(filePath) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    const activityData = readChatActivityData(sqlitePath, CHAT_LAST_ACTIVITY_METADATA_KEY);
    const storedTimestamp = normalizeChatTimestamp(activityData.storedValue, NaN);
    if (Number.isFinite(storedTimestamp)) {
        return storedTimestamp;
    }

    return normalizeChatTimestamp(activityData.lastMessage?.send_date, 0);
}

export function hasValidGroupChatPayload(chat) {
    if (!Array.isArray(chat)) {
        return false;
    }

    for (let index = 0; index < chat.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(chat, index) || !_.isPlainObject(chat[index])) {
            return false;
        }
    }

    return true;
}

function getPersonaThumbnailUrl(personaAvatar) {
    return `/thumbnail?type=persona&file=${encodeURIComponent(personaAvatar)}`;
}

function validatePersonaAvatarName(userDirectories, personaAvatar) {
    const avatarName = String(personaAvatar || '').trim();
    if (!avatarName || sanitize(avatarName) !== avatarName) {
        return { ok: false, status: 400, error: 'invalid_persona_avatar' };
    }

    const avatarPath = assertPathInside(userDirectories.avatars, path.join(userDirectories.avatars, avatarName), 'persona_avatar');
    if (!fs.existsSync(avatarPath)) {
        return { ok: false, status: 404, error: 'persona_avatar_not_found' };
    }

    return { ok: true, avatarName };
}

/**
 * Updates persisted user messages in place without hydrating the chat in the browser.
 * @param {object} db Native SQLite chat database adapter
 * @param {string} userName Target user name
 * @param {string} forceAvatar Target persona thumbnail URL
 * @returns {{matched: number, changed: number, updates: {id: number, message: object}[]}}
 */
function getUserPersonaMessageUpdates(db, userName, forceAvatar) {
    const stmt = db.prepare('SELECT id, content FROM messages WHERE order_index > 0 ORDER BY order_index ASC');
    const updates = [];
    let matched = 0;

    try {
        while (stmt.step()) {
            const row = stmt.get();
            const id = row[0];
            const message = JSON.parse(row[1]);

            if (message?.is_user !== true) {
                continue;
            }

            matched++;
            if (message.name === userName && message.force_avatar === forceAvatar) {
                continue;
            }

            updates.push({
                id,
                message: {
                    ...message,
                    name: userName,
                    force_avatar: forceAvatar,
                },
            });
        }
    } finally {
        stmt.free();
    }

    return { matched, changed: updates.length, updates };
}

export async function updateSqliteUserPersonaMessages({ filePath, requestBody, userName, forceAvatar, saveSessionId, assertMutationAllowed = null }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(404, 'chat_not_found');
    }

    const db = await loadDb(sqlitePath);
    try {
        const operationId = requireRequestOperationId(requestBody);
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const currentRevision = getChatRevision(header);
        if (repeatedReceipt) {
            logChatRevisionDecision({ filePath, route: '/api/chats/sync-user-persona', operationType: 'persona_sync', operationId, saveSessionId, receiptFound: true, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'replayed' });
            return repeatedReceipt;
        }
        const revisionCheck = requireLoggedChatMutationRequest(requestBody, header, { filePath, route: '/api/chats/sync-user-persona', operationType: 'persona_sync', operationId, saveSessionId });

        const { matched, changed, updates } = getUserPersonaMessageUpdates(db, userName, forceAvatar);
        if (changed === 0) {
            const payload = {
                result: 'ok',
                ok: true,
                operation_id: operationId,
                status: 'noop',
                matched,
                changed,
                chat_revision: revisionCheck.currentRevision,
            };
            db.run('BEGIN TRANSACTION');
            try {
                recordSqliteOperationReceipt(db, requestBody, revisionCheck.currentRevision, payload);
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            saveDb(db, sqlitePath);
            logChatRevisionDecision({ filePath, route: '/api/chats/sync-user-persona', operationType: 'persona_sync', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'noop' });
            return payload;
        }

        if (typeof assertMutationAllowed === 'function') {
            await assertMutationAllowed();
        }

        db.run('BEGIN TRANSACTION');
        let headerStmt;
        try {
            const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
            headerStmt = db.prepare('UPDATE messages SET content = ? WHERE order_index = 0');
            headerStmt.run([JSON.stringify(sanitizeChatHeaderForPersistence(revisedHeader))]);

            for (const update of updates) {
                updateLogicalMessageRowById(db, update.id, sanitizeChatMessageForPersistence(update.message));
            }
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision, { operation_id: operationId, status: 'applied', matched, changed });

            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        } finally {
            headerStmt?.free();
        }

        saveDb(db, sqlitePath);

        const payload = {
            result: 'ok',
            ok: true,
            operation_id: operationId,
            status: 'applied',
            matched,
            changed,
            chat_revision: revisionCheck.nextRevision,
        };
        logChatRevisionDecision({ filePath, route: '/api/chats/sync-user-persona', operationType: 'persona_sync', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: revisionCheck.nextRevision, decision: 'applied' });
        return payload;
    } finally {
        db.close();
    }
}

function getAikobotsMessageUuid(message) {
    return typeof message?.[AIKOBOTS_MESSAGE_UUID_KEY] === 'string'
        ? message[AIKOBOTS_MESSAGE_UUID_KEY]
        : '';
}

/**
 * Backfills missing/ambiguous SQLite chat identities created by partial migrations.
 * Keeps the existing chat revision so clients must reload instead of treating repair as a save.
 * @param {object} db Native SQLite chat database adapter
 * @param {string} sqlitePath
 * @param {object|null} header
 * @returns {{repaired: boolean, changedMessages: number, missingMessages: number, duplicateMessages: number, missingSwipes: number, duplicateSwipes: number}}
 */
function repairSqliteChatMessageIdentities(db, sqlitePath, header = null) {
    if (!hasModernSaveMetadata(header)) {
        return {
            repaired: false,
            changedMessages: 0,
            missingMessages: 0,
            duplicateMessages: 0,
            missingSwipes: 0,
            duplicateSwipes: 0,
        };
    }

    if (getMetadata(db, CHAT_IDENTITY_SCAN_METADATA_KEY) === CHAT_IDENTITY_SCAN_VERSION) {
        return {
            repaired: false,
            changedMessages: 0,
            missingMessages: 0,
            duplicateMessages: 0,
            missingSwipes: 0,
            duplicateSwipes: 0,
        };
    }

    const totalMessages = getMessageCount(db);
    if (totalMessages <= 0) {
        setMetadata(db, CHAT_IDENTITY_SCAN_METADATA_KEY, CHAT_IDENTITY_SCAN_VERSION);
        return {
            repaired: false,
            changedMessages: 0,
            missingMessages: 0,
            duplicateMessages: 0,
            missingSwipes: 0,
            duplicateSwipes: 0,
        };
    }

    const messages = getMessageRange(db, 0, totalMessages);
    const identityResult = normalizeChatIdentities(messages, { generateUuid: uuidv4 });
    if (!identityResult.changed) {
        setMetadata(db, CHAT_IDENTITY_SCAN_METADATA_KEY, CHAT_IDENTITY_SCAN_VERSION);
        return {
            repaired: false,
            changedMessages: 0,
            missingMessages: 0,
            duplicateMessages: 0,
            missingSwipes: 0,
            duplicateSwipes: 0,
        };
    }

    updateMessages(db, messages.map(message => sanitizeChatMessageForPersistence(message)), 1);
    setMetadata(db, CHAT_IDENTITY_SCAN_METADATA_KEY, CHAT_IDENTITY_SCAN_VERSION);
    saveDb(db, sqlitePath);

    const changedMessageIndexes = new Set([
        ...identityResult.missingMessageIndexes,
        ...identityResult.duplicateMessageIndexes,
        ...identityResult.missingSwipeRefs.map(ref => ref.messageIndex),
        ...identityResult.duplicateSwipeRefs.map(ref => ref.messageIndex),
    ]);

    console.info('[SQLite] Repaired chat message identity metadata.', {
        filePath: sqlitePath,
        totalMessages,
        changedMessages: changedMessageIndexes.size,
        missingMessages: identityResult.missingMessageIndexes.length,
        duplicateMessages: identityResult.duplicateMessageIndexes.length,
        missingSwipes: identityResult.missingSwipeRefs.length,
        duplicateSwipes: identityResult.duplicateSwipeRefs.length,
    });

    return {
        repaired: true,
        changedMessages: changedMessageIndexes.size,
        missingMessages: identityResult.missingMessageIndexes.length,
        duplicateMessages: identityResult.duplicateMessageIndexes.length,
        missingSwipes: identityResult.missingSwipeRefs.length,
        duplicateSwipes: identityResult.duplicateSwipeRefs.length,
    };
}

function throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header) {
    const repair = repairSqliteChatMessageIdentities(db, sqlitePath, header);
    if (!repair.repaired) {
        return repair;
    }

    throw new ChatMutationError(
        409,
        CHAT_IDENTITY_REPAIR_ERROR,
        'Chat message identities were repaired. Reload the chat before saving again.',
        {
            chat_repaired: true,
            reload_required: true,
            repaired_messages: repair.changedMessages,
        },
    );
}

async function throwIfSqliteChatFileIdentityRepairNeeded(sqlitePath) {
    if (!fs.existsSync(sqlitePath)) {
        return;
    }

    const db = await loadDb(sqlitePath);
    try {
        const header = getChatHeader(db);
        if (header) {
            throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);
        }
    } finally {
        db.close();
    }
}

function requireStrictSaveRevision(requestBody) {
    if (!Object.prototype.hasOwnProperty.call(requestBody || {}, 'base_revision')) {
        return { ok: false, status: 400, error: 'base_revision_required' };
    }

    if (!getRequestSaveSessionId(requestBody)) {
        return { ok: false, status: 400, error: 'save_session_id_required' };
    }

    return { ok: true };
}

function requireChatMutationRequest(requestBody, header) {
    if (isForcePushAuthorityRequest(requestBody)) {
        return getServerAuthorityRevisionCheck(header);
    }

    const strictRevision = requireStrictSaveRevision(requestBody);
    if (!strictRevision.ok) {
        throw new ChatMutationError(strictRevision.status, strictRevision.error);
    }

    const revisionCheck = validateSaveRevision(requestBody, header);
    if (!revisionCheck.ok) {
        throw new ChatMutationError(revisionCheck.status, revisionCheck.error, revisionCheck.error, {
            current_revision: revisionCheck.currentRevision,
            last_save_session_id: revisionCheck.lastSaveSessionId,
            submitted_base_revision: revisionCheck.submittedBaseRevision,
        });
    }

    return revisionCheck;
}

async function assertChatSaveMutationAllowed(request) {
    if (isForcePushAuthorityRequest(request.body)) {
        return;
    }

    await request.activeSessionOperation?.assertAllowed();
}

function validateLoadedMessageRangeIdentity(logicalChatData, startId, rangeMessages) {
    for (let index = 0; index < rangeMessages.length; index++) {
        const existingMessage = logicalChatData[startId + 1 + index];
        const incomingMessage = rangeMessages[index];
        const existingUuid = getAikobotsMessageUuid(existingMessage);
        const incomingUuid = getAikobotsMessageUuid(incomingMessage);

        if (!existingUuid || !incomingUuid || existingUuid !== incomingUuid) {
            return false;
        }
    }

    return true;
}

function validateLoadedMessageRangeMessages(rangeMessages) {
    if (!Array.isArray(rangeMessages) || rangeMessages.length === 0) {
        return false;
    }

    for (let index = 0; index < rangeMessages.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(rangeMessages, index) || !_.isPlainObject(rangeMessages[index])) {
            return false;
        }
    }

    return true;
}

function validateLoadedMessageRangeBounds(messageCount, rangeStart, rangeMessages, rangeEnd = undefined) {
    const startId = Number(rangeStart);
    if (!Number.isInteger(startId) || startId < 0 || !validateLoadedMessageRangeMessages(rangeMessages)) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    const existingMessageCount = Number(messageCount);
    if (!Number.isInteger(existingMessageCount) || existingMessageCount < 0 || startId >= existingMessageCount) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    const endId = startId + rangeMessages.length - 1;
    if (endId >= existingMessageCount) {
        return { ok: false, error: 'loaded_range_exceeds_tail' };
    }

    const declaredEndId = Number(rangeEnd);
    if (rangeEnd === undefined || !Number.isInteger(declaredEndId) || declaredEndId !== endId) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    return { ok: true, startId, endId };
}

function validateSubmittedMessageCount(requestBody, submittedMessageCount) {
    const declaredMessageCount = Number(requestBody?.saved_message_count);
    if (!Number.isInteger(declaredMessageCount) || declaredMessageCount < 0 || declaredMessageCount !== submittedMessageCount) {
        return { ok: false, error: 'saved_message_count_mismatch' };
    }

    return { ok: true };
}

function validateSubmittedFullChatPayload(requestBody, submittedMessages) {
    if (requestBody?.full_chat !== true) {
        return { ok: false, error: 'full_save_requires_hydration' };
    }

    if (!Array.isArray(submittedMessages)) {
        return { ok: false, error: 'invalid_chat_payload' };
    }

    for (let index = 0; index < submittedMessages.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(submittedMessages, index) || !_.isPlainObject(submittedMessages[index])) {
            return { ok: false, error: 'invalid_chat_payload' };
        }
    }

    return validateSubmittedMessageCount(requestBody, submittedMessages.length);
}

export function applyLoadedMessageRange(logicalChatData, rangeStart, rangeMessages, rangeEnd = undefined, { requireIdentityMatch = true } = {}) {
    const startId = Number(rangeStart);
    const rangeValidation = validateLoadedMessageRangeBounds(Math.max(0, logicalChatData.length - 1), startId, rangeMessages, rangeEnd);
    if (!rangeValidation.ok) {
        return rangeValidation;
    }
    const { endId } = rangeValidation;

    if (requireIdentityMatch && !validateLoadedMessageRangeIdentity(logicalChatData, startId, rangeMessages)) {
        return { ok: false, error: 'loaded_range_identity_mismatch' };
    }

    return {
        ok: true,
        chatData: [
            logicalChatData[0],
            ...logicalChatData.slice(1, startId + 1),
            ...rangeMessages,
            ...logicalChatData.slice(endId + 2),
        ],
    };
}

/**
 * Replaces the selected loaded message span while preserving server messages outside it.
 * Unlike ordinary loaded-range saves, force push can change the selected span length.
 */
export function applyForcePushLoadedMessageRange(logicalChatData, rangeStart, rangeMessages, rangeEnd = undefined, requestBody = {}) {
    if (!Array.isArray(logicalChatData) || !_.isPlainObject(logicalChatData[0])) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    const submittedRangeValidation = validateForcePushRangeMessages(rangeMessages);
    if (!submittedRangeValidation.ok) {
        return submittedRangeValidation;
    }

    const startId = Number(rangeStart);
    const endId = Number(rangeEnd);
    if (!Number.isInteger(startId) || startId < 0 || !Number.isInteger(endId) || endId !== startId + rangeMessages.length - 1) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    const serverMessageCount = Math.max(0, logicalChatData.length - 1);
    const clientMessageCount = Number(requestBody?.saved_message_count);
    if (!Number.isInteger(clientMessageCount) || clientMessageCount < 0) {
        return { ok: false, error: 'saved_message_count_mismatch' };
    }

    const messageCountDelta = clientMessageCount - serverMessageCount;
    const oldRangeCount = rangeMessages.length - messageCountDelta;
    if (!Number.isInteger(oldRangeCount) || oldRangeCount < 0 || startId + oldRangeCount > serverMessageCount) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    const existingMessages = logicalChatData.slice(1);
    const nextMessages = [
        ...existingMessages.slice(0, startId),
        ...rangeMessages,
        ...existingMessages.slice(startId + oldRangeCount),
    ];
    const identityValidation = validateUniqueLogicalMessageIdentities(nextMessages);
    if (!identityValidation.ok) {
        return identityValidation;
    }

    return {
        ok: true,
        replaced: oldRangeCount,
        chatData: [
            logicalChatData[0],
            ...nextMessages,
        ],
    };
}

function normalizeLogicalChatDataForNoopCompare(chatData) {
    if (!Array.isArray(chatData) || !_.isPlainObject(chatData[0])) {
        return [];
    }

    const header = sanitizeChatHeaderForPersistence(chatData[0]);
    delete header[CHAT_REVISION_KEY];
    delete header[CHAT_LAST_SAVE_SESSION_KEY];

    return [
        header,
        ...chatData.slice(1).map(message => sanitizeChatMessageForPersistence(message)),
    ];
}

function isLogicalChatSaveNoop(existingChatData, nextChatData) {
    return _.isEqual(
        normalizeLogicalChatDataForNoopCompare(existingChatData),
        normalizeLogicalChatDataForNoopCompare(nextChatData),
    );
}

function isLoadedRangeSaveNoop(existingHeader, nextHeader, existingRangeMessages, nextRangeMessages) {
    const normalizedExistingHeader = sanitizeChatHeaderForPersistence(existingHeader);
    delete normalizedExistingHeader?.[CHAT_REVISION_KEY];
    delete normalizedExistingHeader?.[CHAT_LAST_SAVE_SESSION_KEY];

    const normalizedNextHeader = sanitizeChatHeaderForPersistence(nextHeader);
    delete normalizedNextHeader?.[CHAT_REVISION_KEY];
    delete normalizedNextHeader?.[CHAT_LAST_SAVE_SESSION_KEY];

    return _.isEqual(normalizedExistingHeader, normalizedNextHeader)
        && _.isEqual(
            existingRangeMessages.map(message => sanitizeChatMessageForPersistence(message)),
            nextRangeMessages.map(message => sanitizeChatMessageForPersistence(message)),
        );
}

function validateLoadedMessageRangeForSqlite(db, rangeStart, rangeMessages, rangeEnd = undefined, { requireIdentityMatch = true } = {}) {
    const rangeValidation = validateLoadedMessageRangeBounds(getMessageCount(db), rangeStart, rangeMessages, rangeEnd);
    if (!rangeValidation.ok) {
        return rangeValidation;
    }

    const existingRangeMessages = getMessageRange(db, rangeValidation.startId, rangeMessages.length);
    if (existingRangeMessages.length !== rangeMessages.length) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    if (requireIdentityMatch) {
        const logicalRange = [null, ...existingRangeMessages];
        if (!validateLoadedMessageRangeIdentity(logicalRange, 0, rangeMessages)) {
            return { ok: false, error: 'loaded_range_identity_mismatch' };
        }
    }

    return {
        ...rangeValidation,
        existingRangeMessages,
    };
}

/**
 * Rejects only fatal active-swipe contradictions in messages submitted by the current mutation.
 * Diagnostic records contain locations and field paths, never message or metadata contents.
 * @param {object[]} messages Messages submitted by the current mutation.
 * @param {number} [logicalStartId=0] Logical index of the first submitted message.
 * @returns {void}
 */
function assertSubmittedActiveSwipeStates(messages, logicalStartId = 0) {
    if (!Array.isArray(messages)) {
        return;
    }

    for (let messageRelativeIndex = 0; messageRelativeIndex < messages.length; messageRelativeIndex++) {
        const logicalChatIndex = logicalStartId + messageRelativeIndex;
        const comparison = compareActiveSwipeState(messages[messageRelativeIndex], {
            allowMesMismatch: logicalChatIndex === 0,
            allowMetadataMismatch: logicalChatIndex === 0,
            messageRelativeIndex,
            logicalChatIndex,
        });
        if (!comparison.ok) {
            throw new ChatMutationError(409, 'invalid_message_swipe_state', 'Message swipe data is inconsistent.', {
                reason: comparison.fatalMismatches[0]?.code ?? 'invalid_message_swipe_state',
                comparison,
            });
        }
    }
}

function validateForcePushRangeMessages(rangeMessages) {
    if (!validateLoadedMessageRangeMessages(rangeMessages)) {
        return { ok: false, error: 'invalid_loaded_range' };
    }

    const seenUuids = new Set();
    for (const message of rangeMessages) {
        const uuid = getAikobotsMessageUuid(message);
        if (!uuid) {
            return { ok: false, error: 'loaded_range_identity_mismatch' };
        }

        if (seenUuids.has(uuid)) {
            return { ok: false, error: 'loaded_range_duplicate_identity' };
        }

        seenUuids.add(uuid);
    }

    return { ok: true };
}

function validateUniqueLogicalMessageIdentities(messages) {
    const seenUuids = new Set();
    for (const message of messages) {
        const uuid = getAikobotsMessageUuid(message);
        if (!uuid) {
            continue;
        }

        if (seenUuids.has(uuid)) {
            return { ok: false, error: 'loaded_range_identity_conflict' };
        }

        seenUuids.add(uuid);
    }

    return { ok: true };
}

/**
 * Applies a force-push structural replacement to a loaded SQLite range.
 * The submitted range length may differ from the replaced server range length.
 */
async function updateSqliteForcePushLoadedMessageRange({ filePath, requestBody, incomingHeader, rangeMessages, saveSessionId, regenerateIdentities = false }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'loaded_range_requires_sqlite', 'Loaded-range update requires SQLite chat storage.');
    }

    const submittedRangeValidation = validateForcePushRangeMessages(rangeMessages);
    if (!submittedRangeValidation.ok) {
        throw new ChatMutationError(400, submittedRangeValidation.error);
    }

    const submittedStartId = Number(requestBody?.loaded_range_start);
    const submittedEndId = Number(requestBody?.loaded_range_end);
    if (!Number.isInteger(submittedStartId) || submittedStartId < 0 || !Number.isInteger(submittedEndId) || submittedEndId !== submittedStartId + rangeMessages.length - 1) {
        throw new ChatMutationError(400, 'invalid_loaded_range');
    }

    const db = await loadDb(sqlitePath);
    let header;
    let revisionCheck;
    let totalMessages;
    let nextMessages;
    let oldRangeCount;
    let existingRangeMessages;
    try {
        header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        revisionCheck = requireChatMutationRequest(requestBody, header);
        totalMessages = getMessageCount(db);

        const clientMessageCount = Number(requestBody?.saved_message_count);
        if (!Number.isInteger(clientMessageCount) || clientMessageCount < 0) {
            throw new ChatMutationError(400, 'saved_message_count_mismatch');
        }

        const messageCountDelta = clientMessageCount - totalMessages;
        oldRangeCount = rangeMessages.length - messageCountDelta;
        if (!Number.isInteger(oldRangeCount) || oldRangeCount < 0 || submittedStartId + oldRangeCount > totalMessages) {
            throw new ChatMutationError(400, 'invalid_loaded_range');
        }

        const existingMessages = totalMessages > 0 ? getMessageRange(db, 0, totalMessages) : [];
        existingRangeMessages = existingMessages.slice(submittedStartId, submittedStartId + oldRangeCount);
        nextMessages = [
            ...existingMessages.slice(0, submittedStartId),
            ...rangeMessages,
            ...existingMessages.slice(submittedStartId + oldRangeCount),
        ];
        const identityValidation = validateUniqueLogicalMessageIdentities(nextMessages);
        if (!identityValidation.ok) {
            throw new ChatMutationError(400, identityValidation.error);
        }

        if (nextMessages.length !== clientMessageCount) {
            throw new ChatMutationError(400, 'saved_message_count_mismatch');
        }

        assertSubmittedActiveSwipeStates(rangeMessages, submittedStartId);

        const candidateHeader = incomingHeader ?? header;
        if (oldRangeCount === rangeMessages.length && isLoadedRangeSaveNoop(header, candidateHeader, existingRangeMessages, rangeMessages)) {
            return {
                result: 'ok',
                changed: 0,
                chat_revision: revisionCheck.currentRevision,
                storage_mode: 'sqlite',
                tailStartId: 0,
                tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
                headCount: 0,
                tailCount: totalMessages,
                payload: null,
            };
        }
    } finally {
        db.close();
    }

    const revisedHeader = setChatRevision(incomingHeader ?? header, revisionCheck.nextRevision, saveSessionId);
    const writeResult = await writeLogicalChat(filePath, revisedHeader, nextMessages, {
        regenerateIdentities,
        routeName: requestBody?.group_id ? '/api/chats/group/save' : '/api/chats/save',
        operationType: 'force_push_loaded_range_replace',
        requestBody,
        isPrivilegedOperation: true,
        allowExistingSqliteFullReplacement: true,
        activityTimestamp: Date.now(),
        activeSwipeValidationMessages: rangeMessages,
        activeSwipeValidationStartId: submittedStartId,
    });

    return {
        result: 'ok',
        changed: rangeMessages.length,
        replaced: oldRangeCount,
        chat_revision: revisionCheck.nextRevision,
        storage_mode: 'sqlite',
        tailStartId: writeResult.tailStartId,
        tailEndId: writeResult.tailEndId,
        headCount: writeResult.headCount,
        tailCount: writeResult.tailCount,
        fullJsonl: writeResult.fullJsonl,
    };
}

export function serializeJsonl(data) {
    return data.map(x => {
        if (x && typeof x === 'object') {
            const copy = { ...x };
            delete copy.id;
            delete copy.order_index;
            return JSON.stringify(copy);
        }
        return JSON.stringify(x);
    }).join('\n');
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

async function getChatSegments(filePath, { metadataOnly = false } = {}) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (fs.existsSync(sqlitePath)) {
        const db = await loadDb(sqlitePath);
        try {
            if (metadataOnly) {
                const header = getChatHeader(db);
                const messageCount = getMessageCount(db);
                const lastMessage = getLastMessage(db);

                console.debug(`[SQLite] Loaded metadata for ${filePath}: ${messageCount} messages.`);

                return {
                    header,
                    messageCount,
                    lastMessage,
                    isSqlite: true,
                    metadataOnly: true,
                    storage: null,
                    tailMessages: [],
                    messages: [],
                };
            }

            const messages = getMessages(db);

            if (messages.length === 0) {
                return {
                    header: null,
                    storage: null,
                    tailMessages: [],
                    messages: [],
                };
            }

            return {
                header: messages[0],
                isSqlite: true,
                storage: null,
                tailMessages: messages.slice(1),
                messages: messages.slice(1),
            };
        } finally {
            db.close();
        }
    }

    const tailObjects = readJsonlObjects(filePath);

    if (!tailObjects.length) {
        return {
            header: null,
            storage: null,
            tailMessages: [],
            messages: [],
        };
    }

    const header = tailObjects[0];
    assertSupportedChatStorage(header);
    const tailMessages = tailObjects.slice(1);

    return {
        header,
        isSqlite: false,
        storage: null,
        tailMessages,
        messages: tailMessages,
    };
}

function getSegmentLayout(segments) {
    const actualTailCount = Array.isArray(segments?.tailMessages) ? segments.tailMessages.length : 0;
    const actualTotalMessages = Array.isArray(segments?.messages) ? segments.messages.length : 0;
    const totalMessages = actualTotalMessages;
    const tailEndId = totalMessages > 0 ? totalMessages - 1 : -1;

    return {
        actualTailCount,
        actualTotalMessages,
        declaredTotalMessages: actualTotalMessages,
        headCount: 0,
        tailCount: actualTailCount,
        totalMessages,
        tailStartId: 0,
        tailEndId,
        availableTailEndId: tailEndId,
    };
}

export async function getLogicalChatData(filePath) {
    const segments = await getChatSegments(filePath);

    if (!segments.header) {
        return [];
    }

    return [stripChatStorage(segments.header), ...segments.messages];
}

async function getLogicalChatMessages(filePath) {
    const chatData = await getLogicalChatData(filePath);
    const [, ...messages] = chatData;
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

async function getGroupChatPayload(filePath) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (fs.existsSync(sqlitePath) || fs.existsSync(filePath)) {
        const records = await getLogicalChatData(filePath);
        if (!records.length) {
            return { header: null, messages: [], hasHeader: false };
        }

        if (isGroupChatHeader(records[0])) {
            return {
                header: records[0] || null,
                messages: records.slice(1),
                hasHeader: true,
            };
        }

        return {
            header: null,
            messages: records,
            hasHeader: false,
        };
    }

    return { header: null, messages: [], hasHeader: false };
}

async function writeGroupChat(filePath, messages, chatMetadata = {}, existingHeader = null, { activityTimestamp = null } = {}) {
    return await writeLogicalChat(filePath, buildGroupChatHeader(chatMetadata, existingHeader), messages, {
        allowExistingSqliteFullReplacement: true,
        routeName: 'internal',
        operationType: 'group_header_migration',
        isPrivilegedOperation: true,
        activityTimestamp,
    });
}

function getAvatarThumbnailUrl(avatarUrl) {
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatarUrl)}`;
}

function normalizeGroupChatMetadataPayload(chatMetadata) {
    return _.isPlainObject(chatMetadata) ? _.cloneDeep(chatMetadata) : {};
}

function assertNewGroupChatTarget(user, chatId, { allowExisting = false } = {}) {
    const targetPath = getGroupChatFilePath(user.directories.groupChats, chatId);
    const sqlitePath = replaceChatStorageExtension(targetPath, '.sqlite');
    const jsonlPath = replaceChatStorageExtension(targetPath, '.jsonl');

    if (!allowExisting && (fs.existsSync(sqlitePath) || fs.existsSync(jsonlPath))) {
        throw new ChatMutationError(409, 'target_chat_exists');
    }

    return targetPath;
}

function getNewGroupChatHeader(chatMetadata, saveSessionId) {
    return setChatRevision(buildGroupChatHeader(normalizeGroupChatMetadataPayload(chatMetadata)), 1, saveSessionId);
}

function transformDirectMessagesForGroup(messages, { characterName, avatarUrl }) {
    const genIdFirst = Date.now();
    const forceAvatar = getAvatarThumbnailUrl(avatarUrl);
    const groupMessages = Array.isArray(messages)
        ? _.cloneDeep(messages)
        : [];

    for (let index = 0; index < groupMessages.length; index++) {
        const message = groupMessages[index];
        if (!_.isPlainObject(message)) {
            continue;
        }

        if (message.is_user || message.is_system || message.extra?.type === 'narrator' || message.force_avatar !== undefined) {
            continue;
        }

        if (!_.isPlainObject(message.extra)) {
            message.extra = {};
        }

        message.name = characterName;
        message.original_avatar = avatarUrl;
        message.force_avatar = forceAvatar;
        message.extra.gen_id = genIdFirst + index;
    }

    return groupMessages;
}

function normalizeGroupId(groupId) {
    const id = String(groupId || '').trim();
    return id && sanitize(id) === id ? id : '';
}

function getGroupFilePath(groupsDirectory, groupId) {
    const id = normalizeGroupId(groupId);
    if (!id) {
        throw new ChatMutationError(400, 'invalid_group_id');
    }

    return path.join(groupsDirectory, sanitize(`${id}.json`));
}

async function withGroupMetadataLock(groupPath, callback) {
    const lockPath = `${groupPath}.lock`;

    return await withDirectoryLock({
        lockPath,
        retryMs: CHAT_SAVE_LOCK_RETRY_MS,
        timeoutMs: CHAT_SAVE_LOCK_TIMEOUT_MS,
        staleMs: CHAT_SAVE_LOCK_STALE_MS,
        heartbeatMs: CHAT_SAVE_LOCK_HEARTBEAT_MS,
        timeoutMessage: `Timed out waiting for group metadata lock: ${groupPath}`,
    }, async lock => await lock.run(callback));
}

/**
 * Uses the stable group id for group chat backups after verifying it owns the chat id.
 */
function getVerifiedGroupBackupOwnerKey(user, chatId, groupId) {
    const fallbackKey = String(chatId);
    const id = normalizeGroupId(groupId);
    if (!id) {
        return fallbackKey;
    }

    try {
        const groupPath = getGroupFilePath(user.directories.groups, id);
        if (!fs.existsSync(groupPath)) {
            return fallbackKey;
        }

        const group = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
        const groupChatIds = Array.isArray(group?.chats) ? group.chats.map(String) : [];
        const groupOwnsChat = groupChatIds.includes(String(chatId)) || String(group?.chat_id || '') === String(chatId);

        if (String(group?.id) === id && groupOwnsChat) {
            return id;
        }
    } catch {
        return fallbackKey;
    }

    return fallbackKey;
}

function sanitizeGroupForPersistence(group) {
    const sanitizedGroup = _.cloneDeep(group);
    delete sanitizedGroup.chat_metadata;
    delete sanitizedGroup.past_metadata;
    delete sanitizedGroup.fav;
    return sanitizedGroup;
}

/**
 * Replaces exactly one logical group chat message row in SQLite.
 * @param {{filePath: string, requestBody: object, saveSessionId?: string|null}} options Update options
 * @returns {Promise<{result: string, chat_revision: number, message_id: number}>}
 */
export async function updateGroupChatMessageRow({ filePath, requestBody, saveSessionId }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'message_update_requires_sqlite', 'Message update requires SQLite chat storage.');
    }

    const targetUuid = assertValidMessageUuid(requestBody?.message_uuid);
    const messageId = Number(requestBody?.message_id);
    if (requestBody?.message_id !== undefined && (!Number.isInteger(messageId) || messageId < 0)) {
        throw new ChatMutationError(400, 'invalid_message_id');
    }

    if (!_.isPlainObject(requestBody?.message)) {
        throw new ChatMutationError(400, 'invalid_message_payload');
    }

    if (!Object.prototype.hasOwnProperty.call(requestBody || {}, 'base_revision')) {
        throw new ChatMutationError(400, 'base_revision_required');
    }

    if (!saveSessionId) {
        throw new ChatMutationError(400, 'save_session_id_required');
    }

    const db = await loadDb(sqlitePath);
    try {
        const operationId = requireRequestOperationId(requestBody);
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const currentRevision = getChatRevision(header);
        if (repeatedReceipt) {
            logChatRevisionDecision({ filePath, route: '/api/chats/group/message/update', operationType: 'group_incremental_update', operationId, saveSessionId, receiptFound: true, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'replayed' });
            return repeatedReceipt;
        }
        const revisionCheck = requireLoggedChatMutationRequest(requestBody, header, { filePath, route: '/api/chats/group/message/update', operationType: 'group_incremental_update', operationId, saveSessionId });

        const existingRow = getLogicalMessageRowByUuid(db, targetUuid);
        if (!existingRow) {
            throw new ChatMutationError(404, 'message_not_found');
        }
        if (requestBody?.message_id !== undefined && existingRow.logicalIndex !== messageId) {
            throw new ChatMutationError(409, 'message_identity_mismatch');
        }

        const updatedMessage = applyMessageUpdatePayload(existingRow.message, requestBody);
        const changed = !_.isEqual(sanitizeChatMessageForPersistence(existingRow.message), updatedMessage);
        const resultingRevision = changed ? revisionCheck.nextRevision : revisionCheck.currentRevision;

        db.run('BEGIN TRANSACTION');
        let headerStmt;
        try {
            if (changed) {
                const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
                headerStmt = db.prepare('UPDATE messages SET content = ? WHERE order_index = 0');
                headerStmt.run([JSON.stringify(sanitizeChatHeaderForPersistence(revisedHeader))]);
                updateLogicalMessageRowById(db, existingRow.id, updatedMessage);
            }
            recordSqliteOperationReceipt(db, requestBody, resultingRevision, { operation_id: operationId, status: changed ? 'applied' : 'noop', message_id: existingRow.logicalIndex, message_uuid: targetUuid });

            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        } finally {
            headerStmt?.free();
        }

        saveDb(db, sqlitePath);
        const payload = {
            result: 'ok',
            ok: true,
            operation_id: operationId,
            status: changed ? 'applied' : 'noop',
            chat_revision: resultingRevision,
            message_id: existingRow.logicalIndex,
            message_uuid: targetUuid,
        };
        logChatRevisionDecision({ filePath, route: '/api/chats/group/message/update', operationType: 'group_incremental_update', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: resultingRevision, decision: payload.status });
        return payload;
    } finally {
        db.close();
    }
}

async function ensureGroupChatHeader(user, chatId, filePath) {
    const payload = await getGroupChatPayload(filePath);
    if (payload.hasHeader || payload.messages.length === 0) {
        return payload;
    }

    const chatMetadata = resolveLegacyGroupChatMetadata(user, chatId);
    const writeResult = await writeGroupChat(filePath, payload.messages, chatMetadata);
    return {
        header: buildGroupChatHeader(chatMetadata),
        messages: payload.messages,
        hasHeader: true,
        writeResult,
    };
}

async function buildChunkedGroupChatPayload(user, chatId, filePath, {
    rangeStart = null,
    count = null,
    hydrateFull = false,
    displayCount = LONG_CHAT_DISPLAY_DEFAULT,
} = {}) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');

    if (fs.existsSync(sqlitePath)) {
        const db = await loadDb(sqlitePath);
        let header;
        try {
            header = getChatHeader(db);
        } finally {
            db.close();
        }

        if (isGroupChatHeader(header)) {
            const payload = await buildChunkedChatPayload(filePath, {
                rangeStart,
                count,
                hydrateFull,
                displayCount,
            });
            const chatMetadata = _.cloneDeep(payload.header?.chat_metadata || {});
            return {
                ...payload,
                chat_metadata: chatMetadata,
                chat_revision: getChatRevision(payload.header),
            };
        }
    }

    const payload = await ensureGroupChatHeader(user, chatId, filePath);
    const chatData = payload.header ? [payload.header, ...payload.messages] : [];
    const chunk = buildChunkedChatPayloadFromLogicalChatData(chatData, {
        rangeStart,
        count,
        hydrateFull,
        displayCount,
    });
    const chatMetadata = _.cloneDeep(chunk.header?.chat_metadata || payload.header?.chat_metadata || {});

    return {
        ...chunk,
        chat_metadata: chatMetadata,
        chat_revision: getChatRevision(chunk.header || payload.header),
    };
}

/**
 * Writes a complete logical chat, or patches messages starting at a logical message id.
 * The header is stored separately at SQLite order_index 0; messageStartId excludes it.
 */
export async function writeLogicalChat(filePath, header, messages, {
    regenerateIdentities = false,
    messageStartId = null,
    startIndex = undefined,
    allowExistingSqliteFullReplacement = false,
    routeName = 'internal',
    operationType = null,
    requestBody = null,
    isPrivilegedOperation = false,
    activeSwipeValidationMessages = null,
    activeSwipeValidationStartId = 0,
    activityTimestamp = null,
} = {}) {
    if (startIndex !== undefined) {
        throw new Error('writeLogicalChat startIndex is no longer supported. Use messageStartId with zero-based logical message IDs.');
    }

    if (messageStartId !== null && (!Number.isInteger(messageStartId) || messageStartId < 0)) {
        throw new Error('Invalid logical message update start id.');
    }

    const submittedSwipeMessages = Array.isArray(activeSwipeValidationMessages)
        ? activeSwipeValidationMessages
        : messageStartId === null ? messages : [];

    const baseHeader = sanitizeChatHeaderForPersistence(header);
    const identityMessages = Array.isArray(messages)
        ? _.cloneDeep(messages)
        : [];

    if (regenerateIdentities) {
        regenerateChatIdentities(identityMessages, { generateUuid: uuidv4 });
    } else {
        normalizeChatIdentities(identityMessages, { generateUuid: uuidv4 });
    }

    const sanitizedMessages = identityMessages.map(message => sanitizeChatMessageForPersistence(message));

    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    const existingSqliteFile = fs.existsSync(sqlitePath);
    const db = await loadDb(sqlitePath);
    let totalMessages = 0;
    let changedMessages = 0;
    let writeSucceeded = false;

    try {
        if (messageStartId === null) {
            let serverMessageCountBefore = null;
            let existingHeader = null;
            const resolvedOperationType = operationType || 'full_replace';

            if (existingSqliteFile) {
                existingHeader = getChatHeader(db);
                serverMessageCountBefore = getMessageCount(db);
                const validation = validateExistingSqliteFullReplacementRequest({
                    routeName,
                    operationType: resolvedOperationType,
                    filePath: sqlitePath,
                    requestBody,
                    existingHeader,
                    serverMessageCountBefore,
                    submittedMessageCount: sanitizedMessages.length,
                    isPrivilegedOperation: allowExistingSqliteFullReplacement === true && isPrivilegedOperation === true,
                });

                if (!validation.ok) {
                    throw new ChatMutationError(validation.status, validation.error);
                }
            }

            assertSubmittedActiveSwipeStates(submittedSwipeMessages, activeSwipeValidationStartId);
            db.run('BEGIN TRANSACTION');
            try {
                setMessages(db, [baseHeader, ...sanitizedMessages]);
                setMetadata(db, CHAT_IDENTITY_SCAN_METADATA_KEY, CHAT_IDENTITY_SCAN_VERSION);
                if (Number.isFinite(activityTimestamp)) {
                    setChatLastActivity(db, activityTimestamp);
                }
                recordSqliteOperationReceipt(db, requestBody, getChatRevision(baseHeader));
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            totalMessages = getMessageCount(db);
            changedMessages = sanitizedMessages.length;

            if (existingSqliteFile || isPrivilegedOperation === true) {
                logChatPersistenceOperation('info', {
                    routeName,
                    operationType: resolvedOperationType,
                    filePath: sqlitePath,
                    oldRevision: getChatRevision(existingHeader),
                    requestBody,
                    submittedMessageCount: sanitizedMessages.length,
                    serverMessageCountBefore,
                    serverMessageCountAfter: totalMessages,
                    isPrivilegedOperation: allowExistingSqliteFullReplacement === true && isPrivilegedOperation === true,
                });
            }
        } else {
            assertSubmittedActiveSwipeStates(submittedSwipeMessages, activeSwipeValidationStartId);
            const existingMessageCount = getMessageCount(db);
            if (messageStartId > existingMessageCount) {
                throw new Error('Message update would create a gap.');
            }

            const existingMessages = getMessageRange(db, messageStartId, sanitizedMessages.length);
            if (existingMessages.length < sanitizedMessages.length
                && messageStartId + existingMessages.length !== existingMessageCount) {
                throw new Error('Message update range exceeds existing messages.');
            }

            const changedRows = [];
            for (let index = 0; index < existingMessages.length; index++) {
                if (!_.isEqual(sanitizeChatMessageForPersistence(existingMessages[index]), sanitizedMessages[index])) {
                    changedRows.push({ id: existingMessages[index].id, message: sanitizedMessages[index] });
                }
            }
            const appendedMessages = sanitizedMessages.slice(existingMessages.length);
            const existingHeader = getChatHeader(db);
            const headerChanged = Boolean(baseHeader)
                && !_.isEqual(sanitizeChatHeaderForPersistence(existingHeader), baseHeader);

            db.run('BEGIN TRANSACTION');
            try {
                if (headerChanged) {
                    updateSqliteHeaderRow(db, baseHeader);
                }
                for (const row of changedRows) {
                    updateLogicalMessageRowById(db, row.id, row.message);
                }
                for (const message of appendedMessages) {
                    appendLogicalMessage(db, message);
                }
                if (changedRows.length > 0 || appendedMessages.length > 0) {
                    setChatLastActivity(db);
                }
                recordSqliteOperationReceipt(db, requestBody, getChatRevision(baseHeader));
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            changedMessages = changedRows.length + appendedMessages.length;
            totalMessages = getMessageCount(db);
        }

        saveDb(db, sqlitePath);
        writeSucceeded = true;
    } finally {
        db.close();
        if (!existingSqliteFile && !writeSucceeded) {
            for (const createdPath of [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`]) {
                unlinkFileIfExists(createdPath);
            }
        }
    }

    console.debug(`[SQLite] Updated database for ${filePath}: ${sanitizedMessages.length} messages starting at message id ${messageStartId ?? 0}. Total messages: ${totalMessages}.`);

    // For incremental writes, we don't return the full JSONL to avoid loading everything.
    // This means backups will be skipped for incremental saves.
    const fullJsonl = messageStartId === null ? serializeJsonl([baseHeader, ...sanitizedMessages]) : null;

    return {
        fullJsonl,
        changedMessages,
        storageMode: 'sqlite',
        headCount: 0,
        tailCount: totalMessages,
        tailStartId: 0,
        tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
        compacted: false,
    };
}

/** Updates only participant message rows whose persisted avatar matches the renamed character. */
export async function updateSqliteParticipantHistory({ filePath, oldAvatar, newAvatar, newName, saveSessionId = '' }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(404, 'chat_not_found');
    }

    const encodedOldAvatar = encodeURIComponent(oldAvatar);
    const encodedNewAvatar = encodeURIComponent(newAvatar);
    const db = await loadDb(sqlitePath);
    try {
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const stmt = db.prepare('SELECT id, content FROM messages WHERE order_index > 0 ORDER BY order_index ASC');
        const updates = [];
        try {
            while (stmt.step()) {
                const [id, content] = stmt.get();
                const message = JSON.parse(content);
                if (!_.isPlainObject(message) || message.is_user || message.is_system || message.extra?.type === 'narrator'
                    || typeof message.force_avatar !== 'string' || !message.force_avatar.includes(encodedOldAvatar)) {
                    continue;
                }

                message.name = newName;
                message.force_avatar = message.force_avatar.replace(encodedOldAvatar, encodedNewAvatar);
                message.original_avatar = newAvatar;
                updates.push({ id: Number(id), message: sanitizeChatMessageForPersistence(message) });
            }
        } finally {
            stmt.free();
        }

        if (updates.length === 0) {
            return { changed: 0, chat_revision: getChatRevision(header) };
        }

        const revisedHeader = setChatRevision(stripChatStorage(header), getChatRevision(header) + 1, saveSessionId);
        db.run('BEGIN TRANSACTION');
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            for (const update of updates) {
                updateLogicalMessageRowById(db, update.id, update.message);
            }
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }
        saveDb(db, sqlitePath);
        return { changed: updates.length, chat_revision: getChatRevision(revisedHeader) };
    } finally {
        db.close();
    }
}

export async function updateSqliteLoadedMessageRange({ filePath, requestBody, incomingHeader, rangeMessages, saveSessionId, regenerateIdentities = false }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'loaded_range_requires_sqlite', 'Loaded-range update requires SQLite chat storage.');
    }

    if (isForcePushAuthorityRequest(requestBody)) {
        return await updateSqliteForcePushLoadedMessageRange({
            filePath,
            requestBody,
            incomingHeader,
            rangeMessages,
            saveSessionId,
            regenerateIdentities,
        });
    }

    const db = await loadDb(sqlitePath);
    let validation;
    let revisionCheck;
    let header;
    let totalMessages;
    try {
        header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        revisionCheck = requireChatMutationRequest(requestBody, header);
        totalMessages = getMessageCount(db);
        const messageCountValidation = validateSubmittedMessageCount(requestBody, totalMessages);
        if (!messageCountValidation.ok) {
            throw new ChatMutationError(400, messageCountValidation.error);
        }

        validation = validateLoadedMessageRangeForSqlite(db, requestBody?.loaded_range_start, rangeMessages, requestBody?.loaded_range_end);
        if (!validation.ok) {
            throw new ChatMutationError(400, validation.error);
        }

        assertSubmittedActiveSwipeStates(rangeMessages, validation.startId);

        const candidateHeader = incomingHeader ?? header;
        const saveIsNoop = isLoadedRangeSaveNoop(header, candidateHeader, validation.existingRangeMessages, rangeMessages);

        if (saveIsNoop) {
            return {
                result: 'ok',
                changed: 0,
                chat_revision: revisionCheck.currentRevision,
                storage_mode: 'sqlite',
                tailStartId: 0,
                tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
                headCount: 0,
                tailCount: totalMessages,
                payload: null,
            };
        }
    } finally {
        db.close();
    }

    const revisedHeader = setChatRevision(incomingHeader ?? header, revisionCheck.nextRevision, saveSessionId);
    const writeResult = await writeLogicalChat(filePath, revisedHeader, rangeMessages, {
        regenerateIdentities,
        messageStartId: validation.startId,
        requestBody,
    });
    return {
        result: 'ok',
        changed: rangeMessages.length,
        chat_revision: revisionCheck.nextRevision,
        storage_mode: 'sqlite',
        tailStartId: writeResult.tailStartId,
        tailEndId: writeResult.tailEndId,
        headCount: writeResult.headCount,
        tailCount: writeResult.tailCount,
        fullJsonl: null,
        payload: null,
    };
}

export async function updateSqliteMessageVisibility({ filePath, requestBody, start, end, hide, nameFilter = '', saveSessionId, assertMutationAllowed = null }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'visibility_requires_sqlite', 'Visibility update requires SQLite chat storage.');
    }

    const normalizedStart = Number(start);
    const normalizedEnd = Number(end);
    if (!Number.isInteger(normalizedStart) || !Number.isInteger(normalizedEnd) || normalizedStart < 0 || normalizedEnd < normalizedStart) {
        throw new ChatMutationError(400, 'invalid_visibility_range');
    }

    const db = await loadDb(sqlitePath);
    try {
        const operationId = requireRequestOperationId(requestBody);
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const currentRevision = getChatRevision(header);
        if (repeatedReceipt) {
            logChatRevisionDecision({ filePath, route: '/api/chats/message-visibility', operationType: 'visibility', operationId, saveSessionId, receiptFound: true, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'replayed' });
            return repeatedReceipt;
        }

        const totalMessages = getMessageCount(db);
        if (normalizedEnd >= totalMessages) {
            throw new ChatMutationError(400, 'invalid_visibility_range');
        }

        const revisionCheck = requireLoggedChatMutationRequest(requestBody, header, { filePath, route: '/api/chats/message-visibility', operationType: 'visibility', operationId, saveSessionId });

        const messages = getMessageRange(db, normalizedStart, normalizedEnd - normalizedStart + 1);
        const changedMessages = [];
        for (const message of messages) {
            if (!message || (nameFilter && message.name !== nameFilter)) {
                continue;
            }

            if (message.is_system !== hide) {
                message.is_system = hide;
                changedMessages.push(message);
            }
        }

        if (changedMessages.length === 0) {
            const payload = {
                result: 'ok',
                ok: true,
                operation_id: operationId,
                status: 'noop',
                changed: 0,
                chat_revision: revisionCheck.currentRevision,
                storage_mode: 'sqlite',
                tailStartId: 0,
                tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
                headCount: 0,
                tailCount: totalMessages,
            };
            db.run('BEGIN TRANSACTION');
            try {
                recordSqliteOperationReceipt(db, requestBody, revisionCheck.currentRevision, payload);
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            saveDb(db, sqlitePath);
            logChatRevisionDecision({ filePath, route: '/api/chats/message-visibility', operationType: 'visibility', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'noop' });
            return payload;
        }

        if (typeof assertMutationAllowed === 'function') {
            await assertMutationAllowed();
        }

        const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
        db.run('BEGIN TRANSACTION');
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            for (const message of changedMessages) {
                updateLogicalMessageRowById(db, message.id, sanitizeChatMessageForPersistence(message));
            }
            setChatLastActivity(db);
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision, { operation_id: operationId, status: 'applied', changed: changedMessages.length });
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }

        saveDb(db, sqlitePath);
        const payload = {
            result: 'ok',
            ok: true,
            operation_id: operationId,
            status: 'applied',
            changed: changedMessages.length,
            chat_revision: revisionCheck.nextRevision,
            storage_mode: 'sqlite',
            tailStartId: 0,
            tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
            headCount: 0,
            tailCount: totalMessages,
        };
        logChatRevisionDecision({ filePath, route: '/api/chats/message-visibility', operationType: 'visibility', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: revisionCheck.nextRevision, decision: 'applied' });
        return payload;
    } finally {
        db.close();
    }
}

export async function buildChunkedChatPayload(filePath, {
    rangeStart = null,
    count = null,
    hydrateFull = false,
    displayCount = LONG_CHAT_DISPLAY_DEFAULT,
} = {}) {
    const config = normalizeLongChatConfig({ displayCount });
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');

    if (fs.existsSync(sqlitePath)) {
        const db = await loadDb(sqlitePath);
        try {
            const header = getChatHeader(db);
            const repair = repairSqliteChatMessageIdentities(db, sqlitePath, header);
            const totalMessages = getMessageCount(db);

            if (!header) {
                return {
                    mode: 'full',
                    storageMode: 'sqlite',
                    header: null,
                    messages: [],
                    totalMessages: 0,
                    loadedRangeStart: 0,
                    loadedRangeEnd: -1,
                    tailStartId: 0,
                    tailEndId: -1,
                    headCount: 0,
                    tailCount: 0,
                    chat_repaired: repair.repaired,
                    reload_required: repair.repaired,
                };
            }

            const normalizedCount = hydrateFull
                ? totalMessages
                : Math.max(1, Number(count) || config.displayCount);

            let startId = Number.isInteger(rangeStart)
                ? rangeStart
                : Math.max(0, totalMessages - normalizedCount);

            startId = Math.max(0, Math.min(startId, Math.max(0, totalMessages - 1)));
            const endId = totalMessages > 0 ? Math.min(totalMessages - 1, startId + normalizedCount - 1) : -1;
            const loadedRangeStart = startId;
            const loadedRangeEnd = endId;

            const messages = totalMessages > 0 && endId >= startId
                ? getMessageRange(db, startId, endId - startId + 1)
                : [];

            return {
                mode: 'full',
                storageMode: 'sqlite',
                header: normalizeChatResponseHeader(header),
                messages,
                totalMessages,
                loadedRangeStart,
                loadedRangeEnd,
                tailStartId: startId,
                tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
                headCount: startId,
                tailCount: totalMessages - startId,
                displayCount: config.displayCount,
                isHydrated: hydrateFull || (startId === 0 && messages.length >= totalMessages),
                chat_repaired: repair.repaired,
                reload_required: repair.repaired,
            };
        } finally {
            db.close();
        }
    }

    const segments = await getChatSegments(filePath, { metadataOnly: fs.existsSync(sqlitePath) });
    const header = normalizeChatResponseHeader(segments.header);
    const totalMessages = Array.isArray(segments.messages) ? segments.messages.length : 0;

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

    const normalizedCount = hydrateFull
        ? totalMessages
        : Math.max(1, Number(count) || config.displayCount);
    const startId = Number.isInteger(rangeStart)
        ? Math.max(0, Math.min(rangeStart, Math.max(0, totalMessages - 1)))
        : Math.max(0, totalMessages - normalizedCount);
    const endId = totalMessages > 0 ? Math.min(totalMessages - 1, startId + normalizedCount - 1) : -1;
    const messages = totalMessages > 0 && endId >= startId
        ? segments.messages.slice(startId, endId + 1)
        : [];

    return {
        mode: 'full',
        storageMode: 'jsonl',
        header,
        messages,
        totalMessages,
        loadedRangeStart: totalMessages > 0 ? startId : 0,
        loadedRangeEnd: totalMessages > 0 ? endId : -1,
        tailStartId: startId,
        tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
        headCount: startId,
        tailCount: totalMessages - startId,
        displayCount: config.displayCount,
        isHydrated: hydrateFull || (startId === 0 && messages.length >= totalMessages),
    };
}

function buildChunkedChatPayloadFromLogicalChatData(chatData, {
    rangeStart = null,
    count = null,
    hydrateFull = false,
    displayCount = LONG_CHAT_DISPLAY_DEFAULT,
} = {}) {
    const config = normalizeLongChatConfig({ displayCount });
    const header = sanitizeChatHeaderForPersistence(Array.isArray(chatData) ? chatData[0] : null);
    const logicalMessages = Array.isArray(chatData)
        ? chatData.slice(1).map(message => sanitizeChatMessageForPersistence(message))
        : [];
    const totalMessages = logicalMessages.length;
    const normalizedTailEndId = totalMessages > 0 ? totalMessages - 1 : -1;

    if (!header) {
        return {
            mode: 'full',
            storageMode: 'jsonl',
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
        ? logicalMessages.slice(startId, endId + 1)
        : [];
    let isChunked = false;

    if (!hydrateFull) {
        const normalizedCount = Math.max(1, Number(count) || config.displayCount);
        startId = Number.isInteger(rangeStart)
            ? rangeStart
            : Math.max(0, totalMessages - normalizedCount);
        startId = Math.max(0, Math.min(startId, Math.max(0, totalMessages - 1)));
        endId = Math.min(totalMessages - 1, startId + normalizedCount - 1);
        loadedRangeStart = startId;
        loadedRangeEnd = endId;
        messages = totalMessages > 0
            ? logicalMessages.slice(startId, endId + 1)
            : [];
        isChunked = (startId > 0 || endId < totalMessages - 1);
    }

    return {
        mode: 'full',
        storageMode: 'jsonl',
        header,
        messages,
        totalMessages,
        loadedRangeStart,
        loadedRangeEnd,
        tailStartId: startId,
        tailEndId: normalizedTailEndId,
        headCount: startId,
        tailCount: totalMessages - startId,
        displayCount: config.displayCount,
        isHydrated: !isChunked,
    };
}

function getCloneResponseWindow(insertedMessageId, totalMessages, displayCount) {
    const config = normalizeLongChatConfig({ displayCount });
    const count = Math.max(1, config.displayCount);
    const maxStart = Math.max(0, totalMessages - count);
    const centeredStart = Number(insertedMessageId) - Math.floor(count / 2);
    return {
        rangeStart: Math.max(0, Math.min(centeredStart, maxStart)),
        count,
        displayCount: config.displayCount,
    };
}

function applyCloneTextOverride(clone, requestBody) {
    if (!Object.prototype.hasOwnProperty.call(requestBody || {}, 'text_override')) {
        return;
    }

    if (typeof requestBody.text_override !== 'string') {
        throw new ChatMutationError(400, 'invalid_text_override');
    }

    clone.mes = requestBody.text_override;

    const swipeId = Number(clone.swipe_id);
    if (Array.isArray(clone.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < clone.swipes.length) {
        clone.swipes[swipeId] = requestBody.text_override;
    }

    if (Object.prototype.hasOwnProperty.call(requestBody || {}, 'bias_override')) {
        if (requestBody.bias_override !== null && typeof requestBody.bias_override !== 'string') {
            throw new ChatMutationError(400, 'invalid_bias_override');
        }
        clone.extra ??= {};
        clone.extra.bias = requestBody.bias_override;
    }

    if (Array.isArray(clone.swipe_info) && _.isPlainObject(clone.swipe_info[swipeId])) {
        const selectedSwipeInfo = clone.swipe_info[swipeId];
        selectedSwipeInfo.send_date = clone.send_date;
        selectedSwipeInfo.gen_started = clone.gen_started;
        selectedSwipeInfo.gen_finished = clone.gen_finished;
        if (Object.prototype.hasOwnProperty.call(requestBody || {}, 'bias_override')) {
            selectedSwipeInfo.extra = _.isPlainObject(selectedSwipeInfo.extra)
                ? _.cloneDeep(selectedSwipeInfo.extra)
                : {};
            selectedSwipeInfo.extra.bias = requestBody.bias_override;
        }
    }

    const swipeValidation = validateMessageSwipeState(clone);
    if (!swipeValidation.ok) {
        throw new ChatMutationError(409, 'invalid_message_swipe_state', 'Cloned message swipe data is inconsistent.', {
            reason: swipeValidation.reason,
        });
    }
}

function getMutationResponseWindow(focusMessageId, totalMessages, displayCount) {
    if (!Number.isInteger(focusMessageId) || focusMessageId < 0) {
        return getCloneResponseWindow(Math.max(0, totalMessages - 1), totalMessages, displayCount);
    }

    return getCloneResponseWindow(focusMessageId, totalMessages, displayCount);
}

function buildSqliteMutationPayload(db, header, focusMessageId, displayCount, extra = {}) {
    const totalMessages = getMessageCount(db);
    const window = getMutationResponseWindow(focusMessageId, totalMessages, displayCount);
    const messages = totalMessages > 0 ? getMessageRange(db, window.rangeStart, window.count) : [];
    return {
        result: 'ok',
        ok: true,
        storageMode: 'sqlite',
        chat_revision: getChatRevision(header),
        header: stripChatStorage(header),
        messages,
        totalMessages,
        loadedRangeStart: messages.length > 0 ? window.rangeStart : 0,
        loadedRangeEnd: messages.length > 0 ? window.rangeStart + messages.length - 1 : -1,
        tailStartId: messages.length > 0 ? window.rangeStart : 0,
        tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
        headCount: messages.length > 0 ? window.rangeStart : 0,
        tailCount: messages.length > 0 ? totalMessages - window.rangeStart : 0,
        displayCount: window.displayCount,
        isHydrated: window.rangeStart === 0 && messages.length >= totalMessages,
        ...extra,
    };
}

function assertValidMessageUuid(messageUuid) {
    const normalizedUuid = String(messageUuid || '').trim();
    if (!normalizedUuid) {
        throw new ChatMutationError(400, 'message_uuid_required');
    }

    if (!isValidAikobotsUuid(normalizedUuid)) {
        throw new ChatMutationError(400, 'invalid_message_uuid');
    }

    return normalizedUuid;
}

function requireSqliteMutationRequest(requestBody, header) {
    return requireChatMutationRequest(requestBody, header);
}

function getRequestOperationId(requestBody) {
    const operationId = String(requestBody?.operation_id || '').trim();
    if (operationId && !isValidAikobotsUuid(operationId)) {
        throw new ChatMutationError(400, 'invalid_operation_id');
    }
    return operationId;
}

function requireRequestOperationId(requestBody) {
    const operationId = getRequestOperationId(requestBody);
    if (!operationId) {
        throw new ChatMutationError(400, 'operation_id_required');
    }
    return operationId;
}

function getRepeatedSqliteOperationReceipt(db, requestBody) {
    const operationId = getRequestOperationId(requestBody);
    if (!operationId) {
        return null;
    }
    try {
        const receipt = getOperationReceipt(db, operationId, requestBody);
        return receipt ? { ...receipt, status: 'replayed', duplicate_operation: true } : null;
    } catch (error) {
        if (error?.code === 'operation_id_reused') {
            throw new ChatMutationError(409, 'operation_id_reused', error.message);
        }
        throw error;
    }
}

function recordSqliteOperationReceipt(db, requestBody, revision, responseData = {}) {
    const operationId = getRequestOperationId(requestBody);
    if (!operationId) {
        return;
    }
    recordOperationReceipt(db, operationId, requestBody, {
        result: 'ok',
        ok: true,
        storage_mode: 'sqlite',
        chat_revision: revision,
        ...responseData,
    });
}

function logChatRevisionDecision({ filePath, route, operationType, operationId, saveSessionId, receiptFound, submittedBaseRevision, authoritativeRevisionBefore, authoritativeRevisionAfter, decision }) {
    console.debug('[ChatRevision] mutation decision', {
        route,
        operationType,
        operationId: operationId || null,
        chatKey: crypto.createHash('sha256').update(String(filePath || '')).digest('hex').slice(0, 12),
        saveSessionId: saveSessionId || null,
        receiptFound,
        submittedBaseRevision,
        authoritativeRevisionBefore,
        authoritativeRevisionAfter,
        decision,
    });
}

function requireLoggedChatMutationRequest(requestBody, header, logContext) {
    try {
        return requireChatMutationRequest(requestBody, header);
    } catch (error) {
        if (error instanceof ChatMutationError && error.error === 'stale_revision') {
            const currentRevision = getChatRevision(header);
            logChatRevisionDecision({
                ...logContext,
                receiptFound: false,
                submittedBaseRevision: requestBody?.base_revision,
                authoritativeRevisionBefore: currentRevision,
                authoritativeRevisionAfter: currentRevision,
                decision: 'rejected_stale',
            });
        }
        throw error;
    }
}

async function getRepeatedSqliteOperationReceiptFromFile(sqlitePath, requestBody) {
    if (!fs.existsSync(sqlitePath) || !getRequestOperationId(requestBody)) {
        return null;
    }
    const db = await loadDb(sqlitePath);
    try {
        return getRepeatedSqliteOperationReceipt(db, requestBody);
    } finally {
        db.close();
    }
}

function updateSqliteHeaderRow(db, header) {
    const stmt = db.prepare('UPDATE messages SET content = ? WHERE order_index = 0');
    try {
        stmt.run([JSON.stringify(sanitizeChatHeaderForPersistence(header))]);
    } finally {
        stmt.free();
    }
}

/**
 * Replaces chat-header metadata without reading or rewriting message rows.
 */
export async function updateSqliteChatMetadata({ filePath, requestBody, chatMetadata, saveSessionId, assertMutationAllowed = null, route = '/api/chats/metadata' }) {
    if (!_.isPlainObject(chatMetadata)) {
        throw new ChatMutationError(400, 'invalid_chat_metadata');
    }

    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(404, 'chat_not_found');
    }

    const db = await loadDb(sqlitePath);
    try {
        const operationId = requireRequestOperationId(requestBody);
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);

        const currentRevision = getChatRevision(header);
        if (repeatedReceipt) {
            logChatRevisionDecision({ filePath, route, operationType: 'chat_metadata', operationId, saveSessionId, receiptFound: true, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'replayed' });
            return repeatedReceipt;
        }

        const revisionCheck = requireLoggedChatMutationRequest(requestBody, header, { filePath, route, operationType: 'chat_metadata', operationId, saveSessionId });
        const sanitizedMetadata = stripPersistedChatMetadata(chatMetadata);
        const currentMetadata = stripPersistedChatMetadata(header.chat_metadata || {});
        const totalMessages = getMessageCount(db);

        if (_.isEqual(currentMetadata, sanitizedMetadata)) {
            const payload = {
                result: 'ok',
                ok: true,
                operation_id: operationId,
                status: 'noop',
                changed: 0,
                chat_revision: revisionCheck.currentRevision,
                storage_mode: 'sqlite',
            };
            db.run('BEGIN TRANSACTION');
            try {
                recordSqliteOperationReceipt(db, requestBody, revisionCheck.currentRevision, payload);
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            saveDb(db, sqlitePath);
            logChatRevisionDecision({ filePath, route, operationType: 'chat_metadata', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: currentRevision, decision: 'noop' });
            return payload;
        }

        if (typeof assertMutationAllowed === 'function') {
            await assertMutationAllowed();
        }

        const revisedHeader = setChatRevision({
            ...stripChatStorage(header),
            chat_metadata: sanitizedMetadata,
        }, revisionCheck.nextRevision, saveSessionId);
        db.run('BEGIN TRANSACTION');
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision, { operation_id: operationId, status: 'applied', changed: 1 });
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }

        saveDb(db, sqlitePath);
        const payload = {
            result: 'ok',
            ok: true,
            operation_id: operationId,
            status: 'applied',
            changed: 1,
            chat_revision: revisionCheck.nextRevision,
            storage_mode: 'sqlite',
            totalMessages,
        };
        logChatRevisionDecision({ filePath, route, operationType: 'chat_metadata', operationId, saveSessionId, receiptFound: false, submittedBaseRevision: requestBody.base_revision, authoritativeRevisionBefore: currentRevision, authoritativeRevisionAfter: revisionCheck.nextRevision, decision: 'applied' });
        return payload;
    } finally {
        db.close();
    }
}

function applyMessageUpdatePayload(existingMessage, requestBody) {
    if (!_.isPlainObject(requestBody?.message)) {
        throw new ChatMutationError(400, 'invalid_message_payload');
    }

    const updatedMessage = _.cloneDeep(requestBody.message);
    const targetUuid = assertValidMessageUuid(requestBody.message_uuid);
    const submittedUuid = getAikobotsMessageUuid(updatedMessage);
    if (submittedUuid && submittedUuid !== targetUuid) {
        throw new ChatMutationError(409, 'message_uuid_mismatch');
    }

    const swipeValidation = validateMessageSwipeState(updatedMessage);
    if (!swipeValidation.ok) {
        throw new ChatMutationError(409, 'invalid_message_swipe_state', 'Message swipe data is inconsistent.', {
            reason: swipeValidation.reason,
        });
    }

    if (requestBody.mutation_type === 'ordinary_text_edit') {
        assertOrdinaryTextEditPreservesSwipes(existingMessage, updatedMessage, requestBody.selected_swipe_uuid);
    }

    updatedMessage[AIKOBOTS_MESSAGE_UUID_KEY] = targetUuid;
    if (existingMessage?.id !== undefined) {
        delete updatedMessage.id;
    }
    delete updatedMessage.order_index;
    normalizeChatIdentities([updatedMessage], { generateUuid: uuidv4 });
    return sanitizeChatMessageForPersistence(updatedMessage);
}

/**
 * Rejects ordinary text edits that replace the selected identity or mutate sibling swipes.
 * @param {object} existingMessage Stored message before the edit.
 * @param {object} updatedMessage Submitted edited message.
 * @param {string|null} selectedSwipeUuid Client-captured selected swipe UUID.
 */
function assertOrdinaryTextEditPreservesSwipes(existingMessage, updatedMessage, selectedSwipeUuid) {
    const existingHasSwipes = Array.isArray(existingMessage?.swipes);
    const updatedHasSwipes = Array.isArray(updatedMessage?.swipes);
    if (!existingHasSwipes || !updatedHasSwipes) {
        const swipeFields = ['swipes', 'swipe_info', 'swipe_id'];
        if (existingHasSwipes !== updatedHasSwipes
            || swipeFields.some(key => !_.isEqual(existingMessage?.[key], updatedMessage?.[key]))) {
            throw new ChatMutationError(409, 'ordinary_text_edit_swipe_mutation', 'An ordinary text edit cannot add, remove, or replace swipe data.');
        }
        return;
    }

    const existingSwipeUuids = existingMessage.swipe_info.map(info => info?.[AIKOBOTS_SWIPE_UUID_KEY]);
    const updatedSwipeUuids = updatedMessage.swipe_info.map(info => info?.[AIKOBOTS_SWIPE_UUID_KEY]);
    if (!_.isEqual(existingSwipeUuids, updatedSwipeUuids)) {
        throw new ChatMutationError(409, 'ordinary_text_edit_swipe_mutation', 'An ordinary text edit cannot replace or reorder swipes.');
    }

    const existingSwipeId = Number(existingMessage.swipe_id);
    const updatedSwipeId = Number(updatedMessage.swipe_id);
    const expectedSwipeUuid = existingSwipeUuids[existingSwipeId];
    if (!isValidAikobotsUuid(selectedSwipeUuid)
        || selectedSwipeUuid !== expectedSwipeUuid
        || updatedSwipeUuids[updatedSwipeId] !== selectedSwipeUuid) {
        throw new ChatMutationError(409, 'ordinary_text_edit_swipe_uuid_mismatch', 'The selected swipe changed during the text edit.');
    }

    for (let index = 0; index < existingMessage.swipes.length; index++) {
        if (index === existingSwipeId) {
            continue;
        }
        if (existingMessage.swipes[index] !== updatedMessage.swipes[index]
            || !_.isEqual(existingMessage.swipe_info[index], updatedMessage.swipe_info[index])) {
            throw new ChatMutationError(409, 'ordinary_text_edit_swipe_mutation', 'An ordinary text edit cannot change a non-selected swipe.');
        }
    }
}

function updateShiftedMessagesAfterDelete(db, deletedLogicalIndex) {
    const totalMessages = getMessageCount(db);
    const remapIndex = createDeleteMessageIndexMapper(deletedLogicalIndex);

    for (let logicalIndex = deletedLogicalIndex; logicalIndex < totalMessages; logicalIndex++) {
        const shiftedRow = getLogicalMessageRow(db, logicalIndex);
        if (!shiftedRow) {
            continue;
        }

        const shiftedMessage = _.cloneDeep(shiftedRow.message);
        removePromptSnapshotKeysFromMessage(shiftedMessage);
        remapMessageTimedWorldInfoCheckpoints(shiftedMessage, logicalIndex, remapIndex);
        updateLogicalMessageRowById(db, shiftedRow.id, sanitizeChatMessageForPersistence(shiftedMessage));
    }
}

export async function updateSqliteMessageByUuid({ filePath, requestBody, saveSessionId, displayCount }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'message_update_requires_sqlite', 'Message update requires SQLite chat storage.');
    }

    const targetUuid = assertValidMessageUuid(requestBody?.message_uuid);
    const db = await loadDb(sqlitePath);
    try {
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        if (repeatedReceipt) {
            return repeatedReceipt;
        }
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const revisionCheck = requireSqliteMutationRequest(requestBody, header);
        const row = getLogicalMessageRowByUuid(db, targetUuid);
        if (!row) {
            throw new ChatMutationError(404, 'message_not_found');
        }

        const updatedMessage = applyMessageUpdatePayload(row.message, requestBody);
        const messageChanged = !_.isEqual(sanitizeChatMessageForPersistence(row.message), updatedMessage);
        const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);

        db.run('BEGIN TRANSACTION');
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            updateLogicalMessageRowById(db, row.id, updatedMessage);
            if (messageChanged) {
                setChatLastActivity(db);
            }
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision);
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }

        saveDb(db, sqlitePath);
        return buildSqliteMutationPayload(db, revisedHeader, row.logicalIndex, displayCount, {
            message_uuid: targetUuid,
            message_id: row.logicalIndex,
        });
    } finally {
        db.close();
    }
}

export async function appendSqliteMessage({ filePath, requestBody, saveSessionId, displayCount }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'message_append_requires_sqlite', 'Message append requires SQLite chat storage.');
    }

    if (!_.isPlainObject(requestBody?.message)) {
        throw new ChatMutationError(400, 'invalid_message_payload');
    }

    const db = await loadDb(sqlitePath);
    try {
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        if (repeatedReceipt) {
            return repeatedReceipt;
        }
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const revisionCheck = requireSqliteMutationRequest(requestBody, header);
        const expectedTailUuid = String(requestBody?.expected_tail_uuid || '').trim();
        if (expectedTailUuid) {
            if (!isValidAikobotsUuid(expectedTailUuid)) {
                throw new ChatMutationError(400, 'invalid_expected_tail_uuid');
            }
            const tail = getLastMessage(db);
            if (getAikobotsMessageUuid(tail) !== expectedTailUuid) {
                throw new ChatMutationError(409, 'tail_mismatch');
            }
        }

        const message = _.cloneDeep(requestBody.message);
        delete message.id;
        delete message.order_index;
        normalizeChatIdentities([message], { generateUuid: uuidv4 });
        const sanitizedMessage = sanitizeChatMessageForPersistence(message);
        const messageUuid = getAikobotsMessageUuid(sanitizedMessage);
        if (!messageUuid || getLogicalMessageRowByUuid(db, messageUuid)) {
            throw new ChatMutationError(409, 'message_uuid_conflict');
        }
        const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
        let insertedMessageId;

        db.run('BEGIN TRANSACTION');
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            insertedMessageId = appendLogicalMessage(db, sanitizedMessage);
            setChatLastActivity(db);
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision);
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }

        saveDb(db, sqlitePath);
        return buildSqliteMutationPayload(db, revisedHeader, insertedMessageId, displayCount, {
            message_uuid: messageUuid,
            message_id: insertedMessageId,
        });
    } finally {
        db.close();
    }
}

export async function deleteSqliteMessageByUuid({ filePath, requestBody, saveSessionId, displayCount }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'message_delete_requires_sqlite', 'Message delete requires SQLite chat storage.');
    }

    const targetUuid = assertValidMessageUuid(requestBody?.message_uuid);
    const db = await loadDb(sqlitePath);
    try {
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        if (repeatedReceipt) {
            return repeatedReceipt;
        }
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const revisionCheck = requireSqliteMutationRequest(requestBody, header);
        const row = getLogicalMessageRowByUuid(db, targetUuid);
        if (!row) {
            throw new ChatMutationError(404, 'message_not_found');
        }

        const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
        db.run('BEGIN TRANSACTION');
        let stmt;
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            stmt = db.prepare('DELETE FROM messages WHERE id = ?');
            stmt.run([row.id]);
            updateShiftedMessagesAfterDelete(db, row.logicalIndex);
            setChatLastActivity(db);
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision);
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        } finally {
            stmt?.free();
        }

        saveDb(db, sqlitePath);
        return buildSqliteMutationPayload(db, revisedHeader, Math.max(0, row.logicalIndex - 1), displayCount, {
            message_uuid: targetUuid,
            deleted_message_id: row.logicalIndex,
        });
    } finally {
        db.close();
    }
}

export async function truncateSqliteChatAfterUuid({ filePath, requestBody, saveSessionId, displayCount }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'truncate_requires_sqlite', 'Truncate requires SQLite chat storage.');
    }

    const truncateAll = requestBody?.truncate_all === true;
    const targetUuid = truncateAll ? null : assertValidMessageUuid(requestBody?.branch_point_uuid || requestBody?.message_uuid);
    const db = await loadDb(sqlitePath);
    try {
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        if (repeatedReceipt) {
            return repeatedReceipt;
        }
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const revisionCheck = requireSqliteMutationRequest(requestBody, header);
        const serverMessageCountBefore = getMessageCount(db);
        const row = truncateAll ? null : getLogicalMessageRowByUuid(db, targetUuid);
        if (!truncateAll && !row) {
            throw new ChatMutationError(404, 'message_not_found');
        }

        const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
        const changesCanonicalMessages = truncateAll ? serverMessageCountBefore > 0 : row.logicalIndex < serverMessageCountBefore - 1;
        db.run('BEGIN TRANSACTION');
        try {
            updateSqliteHeaderRow(db, revisedHeader);
            if (truncateAll) {
                deleteAllLogicalMessages(db);
            } else {
                deleteLogicalMessagesAfter(db, row.logicalIndex);
            }
            if (changesCanonicalMessages) {
                setChatLastActivity(db);
            }
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision);
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }

        saveDb(db, sqlitePath);
        const serverMessageCountAfter = getMessageCount(db);
        logChatPersistenceOperation('info', {
            routeName: 'sqlite_mutation',
            operationType: truncateAll ? 'truncate_all' : 'truncate',
            filePath: sqlitePath,
            oldRevision: revisionCheck.currentRevision,
            requestBody,
            submittedMessageCount: null,
            serverMessageCountBefore,
            serverMessageCountAfter,
            isPrivilegedOperation: true,
        });
        return buildSqliteMutationPayload(db, revisedHeader, row?.logicalIndex ?? -1, displayCount, {
            ...(targetUuid ? { message_uuid: targetUuid } : {}),
            branch_point_message_id: row?.logicalIndex ?? -1,
        });
    } finally {
        db.close();
    }
}

/**
 * Clones one logical SQLite chat message immediately after the source message.
 * @param {{filePath: string, requestBody: object, saveSessionId?: string|null, displayCount?: number}} options
 * @returns {Promise<object>} Chunked chat payload containing the inserted clone.
 */
export async function cloneSqliteMessageAfter({ filePath, requestBody, saveSessionId, displayCount }) {
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(sqlitePath)) {
        throw new ChatMutationError(409, 'clone_requires_sqlite', 'Message clone requires SQLite chat storage.');
    }

    const hasMessageUuid = typeof requestBody?.message_uuid === 'string' && requestBody.message_uuid.trim();
    const messageId = Number(requestBody?.message_id);
    if (!hasMessageUuid && (!Number.isInteger(messageId) || messageId < 0)) {
        throw new ChatMutationError(400, 'invalid_message_id');
    }

    const db = await loadDb(sqlitePath);
    try {
        const repeatedReceipt = getRepeatedSqliteOperationReceipt(db, requestBody);
        if (repeatedReceipt) {
            return repeatedReceipt;
        }
        const header = getChatHeader(db);
        if (!header) {
            throw new ChatMutationError(404, 'chat_not_found');
        }
        assertSupportedChatStorage(header);
        throwIfSqliteChatIdentityRepairNeeded(db, sqlitePath, header);

        const revisionCheck = requireChatMutationRequest(requestBody, header);

        const sourceRow = hasMessageUuid
            ? getLogicalMessageRowByUuid(db, requestBody.message_uuid)
            : getLogicalMessageRow(db, messageId);
        if (!sourceRow) {
            throw new ChatMutationError(400, 'invalid_message_id');
        }

        const clone = cloneMessageWithNewIdentity(sourceRow.message, { generateUuid: uuidv4 });
        applyCloneTextOverride(clone, requestBody);
        clone.send_date = Date.now();
        removePromptSnapshotKeysFromMessage(clone);
        removeTimedWorldInfoCheckpointsFromMessage(clone);

        const revisedHeader = setChatRevision(stripChatStorage(header), revisionCheck.nextRevision, saveSessionId);
        let insertedMessageId;
        let totalMessages;
        db.run('BEGIN TRANSACTION');
        try {
            insertedMessageId = insertLogicalMessageAfter(db, sourceRow.logicalIndex ?? messageId, sanitizeChatMessageForPersistence(clone));
            totalMessages = getMessageCount(db);
            const shiftedMessages = getMessageRange(db, insertedMessageId, totalMessages - insertedMessageId);
            const remapIndex = createInsertMessageIndexMapper(insertedMessageId);

            for (let index = 0; index < shiftedMessages.length; index++) {
                const logicalMessageId = insertedMessageId + index;
                const originalMessage = sanitizeChatMessageForPersistence(shiftedMessages[index]);
                removePromptSnapshotKeysFromMessage(shiftedMessages[index]);
                if (logicalMessageId === insertedMessageId) {
                    removeTimedWorldInfoCheckpointsFromMessage(shiftedMessages[index]);
                } else {
                    remapMessageTimedWorldInfoCheckpoints(shiftedMessages[index], logicalMessageId, remapIndex);
                }
                const nextMessage = sanitizeChatMessageForPersistence(shiftedMessages[index]);
                if (!_.isEqual(originalMessage, nextMessage)) {
                    updateLogicalMessageRowById(db, shiftedMessages[index].id, nextMessage);
                }
            }

            updateSqliteHeaderRow(db, revisedHeader);
            setChatLastActivity(db);
            recordSqliteOperationReceipt(db, requestBody, revisionCheck.nextRevision);
            db.run('COMMIT');
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }
        saveDb(db, sqlitePath);

        const window = getCloneResponseWindow(insertedMessageId, totalMessages, displayCount);
        const messages = getMessageRange(db, window.rangeStart, window.count);
        return {
            result: 'ok',
            chat_revision: revisionCheck.nextRevision,
            inserted_message_id: insertedMessageId,
            header: stripChatStorage(revisedHeader),
            messages,
            totalMessages,
            loadedRangeStart: messages.length > 0 ? window.rangeStart : 0,
            loadedRangeEnd: messages.length > 0 ? window.rangeStart + messages.length - 1 : -1,
            tailStartId: window.rangeStart,
            tailEndId: totalMessages > 0 ? totalMessages - 1 : -1,
            headCount: window.rangeStart,
            tailCount: totalMessages - window.rangeStart,
            displayCount: window.displayCount,
            isHydrated: window.rangeStart === 0 && messages.length >= totalMessages,
        };
    } finally {
        db.close();
    }
}


function getGroupChatFilePath(groupChatsDirectory, chatId) {
    return resolveGroupChatFilePath(groupChatsDirectory, chatId);
}

function buildSplitLogicalMessages(segments, layout) {
    return Array.isArray(segments?.messages) ? segments.messages.slice() : [];
}

function getMissingRangesForSegments(layout) {
    return [];
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

async function resolveDirectLogicalChat(filePath, options = {}) {
    const segments = await getChatSegments(filePath, options);

    if (segments.metadataOnly) {
        return {
            chatType: 'character',
            filePath,
            header: stripChatStorage(segments.header),
            messages: [],
            totalMessages: segments.messageCount,
            lastMessage: segments.lastMessage,
            metadataOnly: true,
            storageMode: segments.isSqlite ? 'sqlite' : 'jsonl',
            storageHealthy: true,
            tailStartId: 0,
            tailEndId: segments.messageCount > 0 ? segments.messageCount - 1 : -1,
        };
    }

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
        storageMode: segments.isSqlite ? 'sqlite' : 'jsonl',
        storageHealthy: true,
        tailStartId: layout.tailStartId,
        tailEndId: layout.tailEndId,
    };
}

async function resolveGroupLogicalChat(filePath, options = {}) {
    const segments = await getChatSegments(filePath, options);

    if (segments.metadataOnly) {
        return {
            chatType: 'group',
            filePath,
            header: stripChatStorage(segments.header),
            messages: [],
            totalMessages: segments.messageCount,
            lastMessage: segments.lastMessage,
            metadataOnly: true,
            storageMode: segments.isSqlite ? 'sqlite' : 'jsonl',
            storageHealthy: true,
            tailStartId: 0,
            tailEndId: segments.messageCount > 0 ? segments.messageCount - 1 : -1,
        };
    }

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
            storageMode: segments.isSqlite ? 'sqlite' : 'jsonl',
            storageHealthy: true,
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
        storageMode: 'jsonl',
        storageHealthy: true,
        tailStartId: 0,
        tailEndId: messages.length > 0 ? messages.length - 1 : -1,
    };
}

async function buildLogicalChatSummary(pathToFile, {
    additionalData = {},
    isGroup = false,
    withMetadata = false,
} = {}) {
    const parsedPath = path.parse(pathToFile);
    const fileStats = getChatFileStats(pathToFile);
    const logicalChat = isGroup
        ? await resolveGroupLogicalChat(pathToFile, { metadataOnly: true })
        : await resolveDirectLogicalChat(pathToFile, { metadataOnly: true });
    const fallbackTimestamp = Math.round(fileStats.latestMtimeMs);
    const chatData = {
        file_id: parsedPath.name,
        file_name: parsedPath.base,
        file_size: `${(fileStats.totalSize / 1024).toFixed(2)}kb`,
        chat_items: 0,
        mes: '[The chat is empty]',
        last_mes: fallbackTimestamp,
        ...additionalData,
    };

    if (!isGroup && fileStats.tailStats.size === 0) {
        console.warn(`Found an empty chat file: ${pathToFile}`);
        return {};
    }

    if (withMetadata && _.isObject(logicalChat.header?.chat_metadata)) {
        chatData.chat_metadata = logicalChat.header.chat_metadata;
    }

    const lastMessage = logicalChat.metadataOnly
        ? logicalChat.lastMessage
        : (logicalChat.lastAvailableMessageId >= 0 ? logicalChat.messages[logicalChat.lastAvailableMessageId] : null);

    if (lastMessage || logicalChat.header) {
        chatData.chat_items = logicalChat.totalMessages;
        chatData.mes = lastMessage?.mes || (isGroup && logicalChat.totalMessages === 0
            ? '[The chat is empty]'
            : '[The message is empty]');
        chatData.last_mes = normalizeChatTimestamp(lastMessage?.send_date, fallbackTimestamp);
        return chatData;
    }

    if (!isGroup) {
        console.warn('Found an invalid or corrupted chat file:', pathToFile);
        return {};
    }

    return chatData;
}

export async function resolveLogicalChatReference(directories, chatRef) {
    const reference = validateStmbChatRef(chatRef);

    if (reference.type === 'group') {
        const chatId = reference.chatId;
        if (!chatId) {
            return await resolveGroupLogicalChat('');
        }

        const filePath = resolveGroupChatFilePath(directories.groupChats, chatId);
        return await resolveGroupLogicalChat(filePath);
    }

    const avatarUrl = reference.avatarUrl;
    const fileName = reference.fileName;
    if (!avatarUrl || !fileName) {
        return await resolveDirectLogicalChat('');
    }

    const filePath = resolveCharacterChatFilePath(directories.chats, avatarUrl, fileName);
    return await resolveDirectLogicalChat(filePath);
}

function createSparseLogicalMessages(totalMessages, rangeStart, rangeMessages) {
    const messages = [];
    messages.length = Math.max(0, Number(totalMessages) || 0);

    if (!Number.isInteger(rangeStart) || rangeStart < 0 || !Array.isArray(rangeMessages)) {
        return messages;
    }

    for (let index = 0; index < rangeMessages.length; index++) {
        messages[rangeStart + index] = rangeMessages[index];
    }

    return messages;
}

/**
 * Resolves a chat reference against SQLite storage and optionally loads one logical message range.
 * @param {object} directories User storage directories.
 * @param {object} chatRef STMB chat reference.
 * @param {object} [options] Range loading options.
 * @param {number|null} [options.rangeStart] First zero-based logical message id to load.
 * @param {number|null} [options.rangeEnd] Last zero-based logical message id to load.
 * @param {boolean} [options.includeMessages] Whether to populate the requested range in a sparse message array.
 * @returns {Promise<object>} SQLite-backed logical chat state.
 */
export async function resolveSqliteLogicalChatReference(directories, chatRef, options = {}) {
    const reference = validateStmbChatRef(chatRef);
    const isGroup = reference.type === 'group';
    const chatType = isGroup ? 'group' : 'character';
    let filePath = '';

    if (isGroup) {
        if (reference.chatId) {
            filePath = resolveGroupChatFilePath(directories.groupChats, reference.chatId);
        }
    } else if (reference.avatarUrl && reference.fileName) {
        filePath = resolveCharacterChatFilePath(directories.chats, reference.avatarUrl, reference.fileName);
    }

    const sqlitePath = filePath ? replaceChatStorageExtension(filePath, '.sqlite') : '';
    if (!sqlitePath || !fs.existsSync(sqlitePath)) {
        return {
            chatType,
            filePath,
            sqlitePath,
            header: null,
            messages: [],
            totalMessages: 0,
            lastAvailableMessageId: -1,
            missingRanges: [],
            storageMode: 'sqlite',
            storageHealthy: false,
            sqliteMissing: true,
        };
    }

    const db = await loadDb(sqlitePath);
    try {
        db.run('BEGIN TRANSACTION');
        try {
            const header = getChatHeader(db);
            const totalMessages = getMessageCount(db);
            const lastAvailableMessageId = totalMessages > 0 ? totalMessages - 1 : -1;
            const rangeStart = Number(options.rangeStart);
            const rangeEnd = Number(options.rangeEnd);
            const shouldLoadRange = options.includeMessages === true
                && Number.isInteger(rangeStart)
                && Number.isInteger(rangeEnd)
                && rangeStart >= 0
                && rangeEnd >= rangeStart
                && rangeStart <= lastAvailableMessageId;
            const clampedRangeEnd = shouldLoadRange ? Math.min(rangeEnd, lastAvailableMessageId) : -1;
            const rangeMessages = shouldLoadRange
                ? getMessageRange(db, rangeStart, clampedRangeEnd - rangeStart + 1)
                : [];
            const expectedRangeCount = shouldLoadRange ? clampedRangeEnd - rangeStart + 1 : 0;
            const missingRanges = shouldLoadRange && rangeMessages.length < expectedRangeCount
                ? [{ start: rangeStart + rangeMessages.length, end: clampedRangeEnd }]
                : [];

            const result = {
                chatType,
                filePath,
                sqlitePath,
                header: stripChatStorage(header),
                messages: shouldLoadRange ? createSparseLogicalMessages(totalMessages, rangeStart, rangeMessages) : [],
                totalMessages,
                lastAvailableMessageId,
                missingRanges,
                storageMode: 'sqlite',
                storageHealthy: Boolean(header),
                sqliteMissing: false,
                loadedRangeStart: shouldLoadRange ? rangeStart : null,
                loadedRangeEnd: shouldLoadRange ? clampedRangeEnd : null,
            };
            db.run('COMMIT');
            return result;
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }
    } finally {
        db.close();
    }
}

function isPromptExcludedMessage(message) {
    return Boolean(message?.extra?.ignore);
}

function isResidentParentPromptMessage(message) {
    return !isPromptExcludedMessage(message) && (!message?.is_system || Array.isArray(message?.extra?.tool_invocations));
}

export async function resolveCoreChatPayload(chatsDirectory, coreChatPayload) {
    if (!coreChatPayload || typeof coreChatPayload !== 'object') {
        return Array.isArray(coreChatPayload) ? coreChatPayload : [];
    }

    const avatarUrl = coreChatPayload.avatarUrl;
    const chatId = coreChatPayload.currentChatId;

    if (avatarUrl && chatId) {
        const filePath = resolveCharacterChatFilePath(chatsDirectory, avatarUrl, chatId);
        const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');

        if (fs.existsSync(sqlitePath)) {
            const db = await loadDb(sqlitePath);
            try {
                db.run('BEGIN TRANSACTION');
                try {
                    const totalMessages = getMessageCount(db);
                    const tailStartId = Number.isInteger(coreChatPayload.tailStartId)
                        ? Math.max(0, Math.min(coreChatPayload.tailStartId, totalMessages))
                        : 0;

                    const parentMessages = coreChatPayload.useParentUnhiddenMessages
                        ? getMessageRange(db, 0, tailStartId).filter(isResidentParentPromptMessage)
                        : [];

                    const tailMessages = coreChatPayload.useTailContents === false
                        ? []
                        : getMessageRange(db, tailStartId, totalMessages - tailStartId);

                    const resolvedMessages = [...parentMessages, ...tailMessages];
                    db.run('COMMIT');
                    return resolvedMessages;
                } catch (error) {
                    db.run('ROLLBACK');
                    throw error;
                }
            } finally {
                db.close();
            }
        }
    }

    return Array.isArray(coreChatPayload.messages) ? coreChatPayload.messages : (Array.isArray(coreChatPayload) ? coreChatPayload : []);
}

function getLatestChatBackupFile(directory, prefix) {
    const backupFiles = fs.readdirSync(directory)
        .filter(file => file.startsWith(prefix) && path.extname(file) === '.jsonl')
        .map(file => {
            const filePath = path.join(directory, file);
            try {
                return {
                    filePath,
                    mtimeMs: fs.statSync(filePath).mtimeMs,
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return backupFiles[0]?.filePath || null;
}

function shouldSkipChatBackup(directory, prefix) {
    const latestBackupFile = getLatestChatBackupFile(directory, prefix);

    if (!latestBackupFile) {
        return false;
    }

    try {
        const latestBackupStats = fs.statSync(latestBackupFile);
        // Chat backups are time-gated; edits and deletions inside the interval are coalesced.
        return Date.now() - latestBackupStats.mtimeMs < throttleInterval;
    } catch {
        return false;
    }
}

function getSanitizedChatBackupName(name) {
    return sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function getChatBackupPrefix(name) {
    return `${CHAT_BACKUPS_PREFIX}${getSanitizedChatBackupName(name)}_`;
}

function shouldCreatePeriodicSqliteAppendBackup(directory, name, messageCount) {
    if (!isBackupEnabled || !fs.existsSync(directory) || sqliteAppendBackupMessageInterval <= 0) {
        return false;
    }

    const totalMessages = Number(messageCount);
    if (!Number.isInteger(totalMessages) || totalMessages <= 0 || totalMessages % sqliteAppendBackupMessageInterval !== 0) {
        return false;
    }

    return !shouldSkipChatBackup(directory, getChatBackupPrefix(name));
}

async function maybeBackupSqliteChatAfterAppend(user, filePath, name, messageCount) {
    if (!shouldCreatePeriodicSqliteAppendBackup(user.directories.backups, name, messageCount)) {
        return;
    }

    try {
        const fullJsonl = serializeJsonl(await getLogicalChatData(filePath));
        getBackupFunction(user.profile.handle)(user.directories.backups, name, fullJsonl);
    } catch (error) {
        console.error(`Could not create periodic SQLite chat backup for ${name}`, error);
    }
}

/**
 * Saves a chat to the backups directory.
 * @param {string} directory The user's backups directory.
 * @param {string} name The name of the chat.
 * @param {string} chat The serialized chat to save.
 * @param {object} [options] Backup options.
 * @param {boolean} [options.skipThrottle=false] Bypass the normal time gate.
 * @param {string} [options.label=''] Optional filename label inserted before the timestamp.
 */
function backupChat(directory, name, chat, { skipThrottle = false, label = '' } = {}) {
    try {
        if (!isBackupEnabled || !fs.existsSync(directory) || typeof chat !== 'string') {
            return;
        }

        writeChatBackup(directory, name, chat, { skipThrottle, label });
    } catch (err) {
        console.error(`Could not backup chat for ${name}`, err);
    }
}

function writeChatBackup(directory, name, chat, { skipThrottle = false, label = '' } = {}) {
    if (!isBackupEnabled || !fs.existsSync(directory)) {
        throw new Error('Chat backups are disabled or the backups directory is unavailable.');
    }

    if (typeof chat !== 'string') {
        throw new Error('Chat backup content must be a JSONL string.');
    }

    // replace non-alphanumeric characters with underscores
    name = getSanitizedChatBackupName(name);
    const backupPrefix = getChatBackupPrefix(name);

    if (!skipThrottle && shouldSkipChatBackup(directory, backupPrefix)) {
        return null;
    }

    const sanitizedLabel = label ? `_${getSanitizedChatBackupName(label)}` : '';
    const backupFile = path.join(directory, `${CHAT_BACKUPS_PREFIX}${name}${sanitizedLabel}_${generateTimestamp()}.jsonl`);
    writeFileAtomicSync(backupFile, chat, 'utf-8');

    removeOldBackups(directory, backupPrefix);

    if (!isNaN(maxTotalChatBackups) && maxTotalChatBackups >= 0) {
        removeOldBackups(directory, CHAT_BACKUPS_PREFIX, maxTotalChatBackups);
    }

    return backupFile;
}

/** Creates the mandatory JSONL recovery point before a force push overwrites server chat data. */
async function backupPreForcePushServerChat(user, filePath, name) {
    try {
        const serverChat = await getLogicalChatData(filePath);
        if (!Array.isArray(serverChat) || serverChat.length === 0) {
            throw new Error('No existing server chat was available to back up.');
        }

        writeChatBackup(user.directories.backups, name, serializeJsonl(serverChat), {
            skipThrottle: true,
            label: 'force_push_pre_server',
        });
    } catch (error) {
        console.error(`Could not create pre-force-push chat backup for ${name}`, error);
        throw new ChatMutationError(500, 'force_push_backup_failed', 'Could not create a JSONL backup of the server chat. Server copy was not overwritten.');
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

export async function getChatSearchResult(chatFile, fragments = [], { isGroup = false } = {}) {
    const useMetadataOnly = fragments.length === 0;
    const sqlitePath = replaceChatStorageExtension(chatFile.path, '.sqlite');
    if (fs.existsSync(sqlitePath)) {
        const db = await loadDb(sqlitePath);
        try {
            const fileNameText = path.parse(chatFile.path).name.toLowerCase();
            if (fragments.length > 0) {
                const matchStmt = db.prepare(`
                    SELECT 1
                    FROM messages
                    WHERE order_index > 0
                      AND json_type(content, '$.mes') = 'text'
                      AND instr(aikobots_lower(json_extract(content, '$.mes')), ?) > 0
                    LIMIT 1
                `);
                try {
                    for (const fragment of fragments) {
                        if (fileNameText.includes(fragment)) {
                            continue;
                        }
                        matchStmt.bind([fragment]);
                        if (!matchStmt.step()) {
                            return null;
                        }
                    }
                } finally {
                    matchStmt.free();
                }
            }

            const messageCount = getMessageCount(db);
            let lastMessage = useMetadataOnly ? getLastMessage(db) : null;
            if (!useMetadataOnly) {
                const lastStmt = db.prepare(`
                    SELECT content
                    FROM messages
                    WHERE order_index > 0 AND json_type(content, '$.mes') = 'text'
                    ORDER BY order_index DESC
                    LIMIT 1
                `);
                try {
                    if (lastStmt.step()) {
                        lastMessage = JSON.parse(lastStmt.get()[0]);
                    }
                } finally {
                    lastStmt.free();
                }
            }

            if (fragments.length > 0 && !lastMessage) {
                return null;
            }
            const fallbackTimestamp = Math.round(getChatFileStats(chatFile.path).latestMtimeMs);
            return {
                file_name: chatFile.file_name,
                file_size: chatFile.file_size,
                message_count: messageCount,
                last_mes: normalizeChatTimestamp(lastMessage?.send_date, fallbackTimestamp),
                preview_message: getPreviewMessage(lastMessage ? [lastMessage] : []),
            };
        } finally {
            db.close();
        }
    }

    const logicalChat = isGroup
        ? await resolveGroupLogicalChat(chatFile.path, { metadataOnly: useMetadataOnly })
        : await resolveDirectLogicalChat(chatFile.path, { metadataOnly: useMetadataOnly });

    const messages = useMetadataOnly ? [] : (logicalChat.messages || [])
        .filter(message => message && typeof message.mes === 'string');

    if (fragments.length && messages.length === 0) {
        return null;
    }

    const lastMessage = useMetadataOnly ? logicalChat.lastMessage : messages[messages.length - 1];
    const fallbackTimestamp = Math.round(getChatFileStats(chatFile.path).latestMtimeMs);
    const lastMesDate = normalizeChatTimestamp(lastMessage?.send_date, fallbackTimestamp);
    const result = {
        file_name: chatFile.file_name,
        file_size: chatFile.file_size,
        message_count: logicalChat.totalMessages,
        last_mes: lastMesDate,
        preview_message: getPreviewMessage(useMetadataOnly ? (lastMessage ? [lastMessage] : []) : messages),
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
    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
    if (!fs.existsSync(filePath) && !fs.existsSync(sqlitePath)) {
        return true;
    }

    const segments = await getChatSegments(filePath);
    const jsonData = segments.header;
    const chatIntegrity = jsonData?.chat_metadata?.integrity;

    if (!chatIntegrity) {
        return true;
    }

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
    return buildLogicalChatSummary(pathToFile, { additionalData, isGroup, withMetadata });
}

export const router = express.Router();


router.post('/message/clone', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(filePath) && !fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await cloneSqliteMessageAfter({
                filePath,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });

            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'clone_failed' });
    }
});

router.post('/message/append', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const directoryName = normalizeCharacterChatDirectoryName(request.body.avatar_url);
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await appendSqliteMessage({
                filePath,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            await maybeBackupSqliteChatAfterAppend(request.user, filePath, directoryName, payload.totalMessages);
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'append_failed' });
    }
});

router.post('/message/update', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await updateSqliteMessageByUuid({
                filePath,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'message_update_failed' });
    }
});

router.post('/message/delete', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await deleteSqliteMessageByUuid({
                filePath,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'message_delete_failed' });
    }
});

router.post('/truncate-after', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await truncateSqliteChatAfterUuid({
                filePath,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'truncate_failed' });
    }
});

router.post('/regenerate-prepare', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        const requestBody = {
            ...request.body,
            branch_point_uuid: request.body.branch_point_uuid ?? request.body.message_uuid,
        };

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await truncateSqliteChatAfterUuid({
                filePath,
                requestBody,
                saveSessionId: getRequestSaveSessionId(requestBody),
                displayCount: requestBody.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'regenerate_prepare_failed' });
    }
});

router.post('/metadata', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const fileName = String(request.body?.file_name || '').trim();
        if (!fileName || !_.isPlainObject(request.body?.chat_metadata)) {
            return response.status(400).send({ error: 'invalid_chat_metadata' });
        }

        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, fileName);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            const payload = await updateSqliteChatMetadata({
                filePath,
                requestBody: request.body,
                chatMetadata: request.body.chat_metadata,
                saveSessionId: getRequestSaveSessionId(request.body),
                assertMutationAllowed: () => request.activeSessionOperation?.assertAllowed(),
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'chat_metadata_update_failed' });
    }
});

router.post('/group/metadata', async function (request, response) {
    try {
        const chatId = String(request.body?.id || '').trim();
        if (!chatId || !_.isPlainObject(request.body?.chat_metadata)) {
            return response.status(400).send({ error: 'invalid_chat_metadata' });
        }

        const filePath = getGroupChatFilePath(request.user.directories.groupChats, chatId);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            const payload = await updateSqliteChatMetadata({
                filePath,
                requestBody: request.body,
                chatMetadata: request.body.chat_metadata,
                saveSessionId: getRequestSaveSessionId(request.body),
                assertMutationAllowed: () => request.activeSessionOperation?.assertAllowed(),
                route: '/api/chats/group/metadata',
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'group_chat_metadata_update_failed' });
    }
});

router.post('/message-visibility', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const directoryName = normalizeCharacterChatDirectoryName(request.body.avatar_url);
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        const start = Number(request.body.start);
        const end = request.body.end === undefined ? start : Number(request.body.end);
        const hide = request.body.unhide !== true;
        const nameFilter = String(request.body.name_filter || '').trim();

        if (!String(request.body.file_name || '').trim() || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
            return response.status(400).send({ error: 'invalid_visibility_range' });
        }

        if (!fs.existsSync(filePath) && !fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            if (fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
                const payload = await updateSqliteMessageVisibility({
                    filePath,
                    requestBody: request.body,
                    start,
                    end,
                    hide,
                    nameFilter,
                    saveSessionId: getRequestSaveSessionId(request.body),
                    assertMutationAllowed: () => request.activeSessionOperation?.assertAllowed(),
                });
                return response.send(payload);
            }

            const segments = await getChatSegments(filePath);
            const layout = getSegmentLayout(segments);

            if (!segments.header) {
                return response.status(404).send({ error: 'chat_not_found' });
            }

            const revisionCheck = requireChatMutationRequest(request.body, segments.header);

            if (end >= layout.totalMessages) {
                return response.status(400).send({ error: 'invalid_visibility_range' });
            }

            const messages = segments.messages.slice();
            let changed = 0;
            for (let messageId = start; messageId <= end; messageId++) {
                const message = messages[messageId];
                if (!message || (nameFilter && message.name !== nameFilter)) {
                    continue;
                }

                if (message.is_system !== hide) {
                    changed++;
                }
                message.is_system = hide;
            }

            if (changed === 0) {
                return response.send({
                    result: 'ok',
                    changed: 0,
                    chat_revision: getChatRevision(segments.header),
                    storage_mode: 'full',
                    tailStartId: layout.tailStartId,
                    tailEndId: layout.tailEndId,
                    headCount: layout.headCount,
                    tailCount: layout.tailCount,
                });
            }

            const nextRevision = revisionCheck.nextRevision;
            const header = setChatRevision(stripChatStorage(segments.header), nextRevision, getRequestSaveSessionId(request.body));
            const writeResult = await writeLogicalChat(filePath, header, messages, {
                allowExistingSqliteFullReplacement: true,
                routeName: '/api/chats/message-visibility',
                operationType: 'visibility_rewrite',
                requestBody: request.body,
                isPrivilegedOperation: true,
                activityTimestamp: Date.now(),
            });
            getBackupFunction(request.user.profile.handle)(request.user.directories.backups, directoryName, writeResult.fullJsonl);

            return response.send({
                result: 'ok',
                changed,
                chat_revision: nextRevision,
                storage_mode: writeResult.storageMode,
                tailStartId: writeResult.tailStartId,
                tailEndId: writeResult.tailEndId,
                headCount: writeResult.headCount,
                tailCount: writeResult.tailCount,
            });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'visibility_update_failed' });
    }
});

router.post('/sync-user-persona', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
        const userName = String(request.body.user_name || '').trim();
        const personaValidation = validatePersonaAvatarName(request.user.directories, request.body.persona_avatar);

        if (!userName) {
            return response.status(400).send({ error: 'invalid_user_name' });
        }
        if (!personaValidation.ok) {
            return response.status(personaValidation.status).send({ error: personaValidation.error });
        }
        if (!fs.existsSync(sqlitePath)) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        if (checkIntegrity && request.body.integrity) {
            const isIntact = await checkChatIntegrity(sqlitePath, String(request.body.integrity));
            if (!isIntact) {
                console.error(`Chat integrity check failed for ${sqlitePath}`);
                return response.status(400).send({ error: 'integrity' });
            }
        }

        return await withChatSaveLock(sqlitePath, async () => {
            const payload = await updateSqliteUserPersonaMessages({
                filePath,
                requestBody: request.body,
                userName,
                forceAvatar: getPersonaThumbnailUrl(personaValidation.avatarName),
                saveSessionId: getRequestSaveSessionId(request.body),
                assertMutationAllowed: () => request.activeSessionOperation?.assertAllowed(),
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'sync_user_persona_failed' });
    }
});

router.post('/member/rename-history', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const oldAvatar = String(request.body?.old_avatar || '');
        const newAvatar = String(request.body?.new_avatar || '');
        const newName = String(request.body?.new_name || '').trim();
        if (!request.body?.file_name || !oldAvatar || !newAvatar || !newName) {
            return response.status(400).send({ error: 'invalid_rename_request' });
        }

        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(filePath, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const result = await updateSqliteParticipantHistory({
                filePath,
                oldAvatar,
                newAvatar,
                newName,
                saveSessionId: getRequestSaveSessionId(request.body),
            });
            return response.send({
                ok: true,
                changed_messages: result.changed,
                chat_revision: result.chat_revision,
            });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'rename_history_failed' });
    }
});

router.post('/save', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const directoryName = normalizeCharacterChatDirectoryName(request.body.avatar_url);
        if (!hasValidChatPayload(request.body.chat)) {
            return response.status(400).send({ error: 'invalid_chat_payload' });
        }

        const chatData = request.body.chat;
        const directoryPath = resolveCharacterChatDirectory(request.user.directories.chats, request.body.avatar_url);
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);

        if (!fs.existsSync(directoryPath)) {
            fs.mkdirSync(directoryPath, { recursive: true });
        }

        return await withChatSaveLock(filePath, async () => {
            if (checkIntegrity && !request.body.force) {
                const integritySlug = chatData?.[0]?.chat_metadata?.integrity;
                const isIntact = await checkChatIntegrity(filePath, integritySlug);
                if (!isIntact) {
                    console.error(`Chat integrity check failed for ${filePath}`);
                    return response.status(400).send({ error: 'integrity' });
                }
            }

            let logicalChatData = chatData;
            const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
            const existingSqliteChat = fs.existsSync(sqlitePath);
            const existingSegments = fs.existsSync(filePath) || existingSqliteChat
                ? await getChatSegments(filePath, { metadataOnly: existingSqliteChat })
                : null;
            if (existingSqliteChat) {
                const repeatedReceipt = await getRepeatedSqliteOperationReceiptFromFile(sqlitePath, request.body);
                if (repeatedReceipt) {
                    return response.send(repeatedReceipt);
                }
            }
            const revisionCheck = existingSegments?.header || Object.prototype.hasOwnProperty.call(request.body || {}, 'base_revision')
                ? requireChatMutationRequest(request.body, existingSegments?.header)
                : { currentRevision: 0, nextRevision: 1 };

            if (existingSqliteChat && existingSegments?.header) {
                await throwIfSqliteChatFileIdentityRepairNeeded(sqlitePath);
            }

            if (request.body.save_mode === 'tail') {
                return response.status(400).send({ error: 'invalid_save_mode' });
            } else if (request.body.save_mode === 'loaded_range') {
                if (existingSqliteChat) {
                    await assertChatSaveMutationAllowed(request);
                    if (isForcePushAuthorityRequest(request.body)) {
                        await backupPreForcePushServerChat(request.user, filePath, directoryName);
                    }
                    const payload = await updateSqliteLoadedMessageRange({
                        filePath,
                        requestBody: request.body,
                        incomingHeader: chatData[0],
                        rangeMessages: chatData.slice(1),
                        saveSessionId: getRequestSaveSessionId(request.body),
                        regenerateIdentities: request.body.regenerate_identities === true,
                    });
                    if (payload.fullJsonl) {
                        getBackupFunction(request.user.profile.handle)(request.user.directories.backups, directoryName, payload.fullJsonl);
                    }

                    const responsePayload = { ...payload };
                    delete responsePayload.fullJsonl;
                    return response.send(responsePayload);
                }

                const existingChat = await getLogicalChatData(filePath);
                if (existingChat.length === 0) {
                    return response.status(400).send({ error: 'invalid_loaded_range' });
                }

                const isForcePush = isForcePushAuthorityRequest(request.body);
                const loadedRangeResult = isForcePush
                    ? applyForcePushLoadedMessageRange(existingChat, request.body.loaded_range_start, chatData.slice(1), request.body.loaded_range_end, request.body)
                    : applyLoadedMessageRange(existingChat, request.body.loaded_range_start, chatData.slice(1), request.body.loaded_range_end);
                if (!isForcePush) {
                    const messageCountValidation = validateSubmittedMessageCount(request.body, existingChat.length - 1);
                    if (!messageCountValidation.ok) {
                        return response.status(400).send({ error: messageCountValidation.error });
                    }
                }
                if (!loadedRangeResult.ok) {
                    return response.status(400).send({ error: loadedRangeResult.error });
                }
                if (isForcePush) {
                    await backupPreForcePushServerChat(request.user, filePath, directoryName);
                }

                logicalChatData = [
                    chatData[0] ?? existingChat[0],
                    ...loadedRangeResult.chatData.slice(1),
                ];
            } else if (request.body.save_mode !== undefined) {
                return response.status(400).send({ error: 'invalid_save_mode' });
            } else if (request.body.full_chat !== true) {
                return response.status(400).send({ error: 'full_save_requires_hydration' });
            } else if (existingSegments?.header || Object.prototype.hasOwnProperty.call(request.body || {}, 'base_revision')) {
                const fullChatValidation = validateSubmittedFullChatPayload(request.body, chatData.slice(1));
                if (!fullChatValidation.ok) {
                    return response.status(400).send({ error: fullChatValidation.error });
                }
            }

            if (existingSqliteChat && existingSegments?.header) {
                const validation = validateExistingSqliteFullReplacementRequest({
                    routeName: '/api/chats/save',
                    operationType: 'ordinary_full_replace',
                    filePath: sqlitePath,
                    requestBody: request.body,
                    existingHeader: existingSegments.header,
                    serverMessageCountBefore: existingSegments.messageCount,
                    submittedMessageCount: Math.max(0, chatData.length - 1),
                });

                return response.status(validation.status).send({ error: validation.error });
            }

            const existingChatData = existingSegments?.header ? await getLogicalChatData(filePath) : [];
            const saveIsNoop = existingChatData.length > 0 && isLogicalChatSaveNoop(existingChatData, logicalChatData);

            if (saveIsNoop) {
                const layout = getSegmentLayout(existingSegments);

                return response.send({
                    result: 'ok',
                    chat_revision: revisionCheck.currentRevision,
                    storage_mode: existingSegments?.isSqlite ? 'sqlite' : 'jsonl',
                    tailStartId: layout.tailStartId,
                    tailEndId: layout.tailEndId,
                    headCount: layout.headCount,
                    tailCount: layout.tailCount,
                    payload: null,
                });
            }

            const header = setChatRevision(logicalChatData[0], revisionCheck.nextRevision, getRequestSaveSessionId(request.body));
            const messages = logicalChatData.slice(1);
            await assertChatSaveMutationAllowed(request);

            const writeOptions = {
                regenerateIdentities: request.body.regenerate_identities === true,
                requestBody: request.body,
                activityTimestamp: !existingSegments?.header && messages.length > 0 ? Date.now() : null,
            };

            const writeResult = await writeLogicalChat(filePath, header, messages, writeOptions);
            if (writeResult.fullJsonl) {
                getBackupFunction(request.user.profile.handle)(request.user.directories.backups, directoryName, writeResult.fullJsonl);
            }

            return response.send({
                result: 'ok',
                chat_revision: revisionCheck.nextRevision,
                storage_mode: writeResult.storageMode,
                tailStartId: writeResult.tailStartId,
                tailEndId: writeResult.tailEndId,
                headCount: writeResult.headCount,
                tailCount: writeResult.tailCount,
                payload: null,
            });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'save_failed' });
    }
});

router.post('/get', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const directoryPath = resolveCharacterChatDirectory(request.user.directories.chats, request.body.avatar_url);
        const chatDirExists = fs.existsSync(directoryPath);

        if (!chatDirExists) {
            return response.send({});
        }

        if (!request.body.file_name) {
            return response.send({});
        }

        const requestedFilePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file_name);
        const chatPaths = getChatStorageCompanionPaths(requestedFilePath);
        const sqliteExists = fs.existsSync(chatPaths.sqlitePath);
        const jsonlExists = fs.existsSync(chatPaths.jsonlPath);
        const filePath = sqliteExists ? chatPaths.sqlitePath : chatPaths.jsonlPath;
        const chatFileExists = sqliteExists || jsonlExists;

        if (!chatFileExists) {
            return response.send({});
        }

        if (request.body.chunked) {
            const config = normalizeLongChatConfig({
                displayCount: request.body.display_count,
            });
            const rangeStart = request.body.range_start === undefined ? null : Number(request.body.range_start);
            const count = request.body.count === undefined ? null : Number(request.body.count);
            const hydrateFull = request.body.hydrate_full === true;
            try {
                await touchUserActivity(request.user.profile.handle);
            } catch (error) {
                console.error('Failed to update user last activity for direct chat read:', error);
            }
            return await withChatSaveLock(filePath, async () => {
                return response.send(await buildChunkedChatPayload(filePath, {
                    rangeStart,
                    count,
                    hydrateFull,
                    displayCount: config.displayCount,
                }));
            });
        }

        try {
            await touchUserActivity(request.user.profile.handle);
        } catch (error) {
            console.error('Failed to update user last activity for direct chat read:', error);
        }
        return response.send(await getLogicalChatData(filePath));
    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        console.error(error);
        return response.send({});
    }
});

router.post('/save-prefix', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const dirName = normalizeCharacterChatDirectoryName(request.body.avatar_url);
        const sourcePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.source_file);
        const targetPath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.target_file);
        const prefixEndId = Number(request.body.prefix_end_id);
        const headerOverrides = _.isObject(request.body.header_overrides) ? request.body.header_overrides : {};

        if ((!fs.existsSync(sourcePath) && !fs.existsSync(replaceChatStorageExtension(sourcePath, '.sqlite'))) || !Number.isInteger(prefixEndId) || prefixEndId < 0) {
            return response.sendStatus(400);
        }

        return await withChatSaveLocks([sourcePath, targetPath], async () => {
            const targetConflict = getNewChatTargetConflict(sourcePath, targetPath);
            if (targetConflict) {
                const status = targetConflict === 'target_chat_exists' ? 409 : 400;
                return response.status(status).send({ error: targetConflict });
            }

            let sourceHeader;
            let messages;
            const sourceSqlitePath = replaceChatStorageExtension(sourcePath, '.sqlite');
            if (fs.existsSync(sourceSqlitePath)) {
                const db = await loadDb(sourceSqlitePath);
                try {
                    sourceHeader = getChatHeader(db);
                    const messageCount = getMessageCount(db);
                    if (prefixEndId >= messageCount) {
                        return response.sendStatus(400);
                    }
                    messages = getMessageRange(db, 0, prefixEndId + 1);
                } finally {
                    db.close();
                }
            } else {
                const logicalChat = await getLogicalChatData(sourcePath);
                sourceHeader = logicalChat[0];
                messages = logicalChat.slice(1, prefixEndId + 2);
            }

            if (!sourceHeader || messages.length !== prefixEndId + 1) {
                return response.sendStatus(400);
            }

            await request.activeSessionOperation?.assertAllowed();
            const targetHeader = { ...sourceHeader, ...headerOverrides };
            const writeResult = await writeLogicalChat(targetPath, targetHeader, messages, {
                regenerateIdentities: true,
                routeName: '/api/chats/save-prefix',
                operationType: 'save_prefix',
                requestBody: request.body,
                activityTimestamp: Date.now(),
            });
            getBackupFunction(request.user.profile.handle)(request.user.directories.backups, dirName, writeResult.fullJsonl);
            return response.send({ ok: true });
        });
    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/rename', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body || !request.body.original_file || !request.body.renamed_file) {
            return response.sendStatus(400);
        }

        const pathToOriginalFile = request.body.is_group
            ? resolveGroupChatFilePath(request.user.directories.groupChats, request.body.original_file)
            : resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.original_file);
        const pathToRenamedFile = request.body.is_group
            ? resolveGroupChatFilePath(request.user.directories.groupChats, request.body.renamed_file)
            : resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.renamed_file);
        const sanitizedFileName = path.parse(pathToRenamedFile).name;
        console.debug('Old chat name', pathToOriginalFile);
        console.debug('New chat name', pathToRenamedFile);

        const originalCompanions = getChatStorageCompanionPaths(pathToOriginalFile);
        const renamedCompanions = getChatStorageCompanionPaths(pathToRenamedFile);

        return await withChatSaveLocks([pathToOriginalFile, pathToRenamedFile], async () => {
            if (!hasPrimaryChatStorageFile(pathToOriginalFile) || hasPrimaryChatStorageFile(pathToRenamedFile)) {
                console.error('Either Source or Destination files are not available');
                return response.status(400).send({ error: true });
            }

            if (fs.existsSync(originalCompanions.sqlitePath)) {
                await backupSqliteDatabaseFile(originalCompanions.sqlitePath, renamedCompanions.sqlitePath);
            } else if (fs.existsSync(originalCompanions.jsonlPath)) {
                copyLegacyJsonlFile(originalCompanions.jsonlPath, renamedCompanions.jsonlPath);
            } else {
                return response.status(404).send({ error: 'chat_not_found' });
            }

            deleteChatStorageCompanions(pathToOriginalFile);

            console.info('Successfully renamed chat file.');
            return response.send({ ok: true, sanitizedFileName });
        });
    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        console.error('Error renaming chat file:', error);
        return response.status(500).send({ error: true });
    }
});

router.post('/delete', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const filePath = resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.chatfile);

        return await withChatSaveLock(filePath, async () => {
            if (!hasPrimaryChatStorageFile(filePath)) {
                console.error(`Chat file not found '${filePath}'`);
                return response.sendStatus(400);
            }

            const segments = await getChatSegments(filePath, { metadataOnly: fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite')) });
            requireChatMutationRequest(request.body, segments.header);
            await request.activeSessionOperation?.assertAllowed();

            deleteChatStorageCompanions(filePath);
            console.info(`Deleted chat file: ${filePath}`);
            return response.send('ok');
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/export', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body.file || (!request.body.avatar_url && request.body.is_group === false)) {
        return response.sendStatus(400);
    }
    try {
        const filename = request.body.is_group
            ? resolveGroupChatFilePath(request.user.directories.groupChats, request.body.file)
            : resolveCharacterChatFilePath(request.user.directories.chats, request.body.avatar_url, request.body.file);
        const sqlitePath = replaceChatStorageExtension(filename, '.sqlite');
        const exportfilename = request.body.exportfilename;

        if (!fs.existsSync(filename) && !fs.existsSync(sqlitePath)) {
            const errorMessage = {
                message: `Could not find chat file to export. Source chat file: ${filename}.`,
            };
            console.error(errorMessage.message);
            return response.status(404).json(errorMessage);
        }

        // Export a consistent raw SQLite snapshot, including committed WAL state.
        if (request.body.format === 'sqlite') {
            if (!fs.existsSync(sqlitePath)) {
                return response.status(404).json({ message: 'SQLite file not found for this chat.' });
            }
            return await withChatSaveLock(sqlitePath, async () => {
                const buffer = await exportDatabaseFile(sqlitePath);
                return response.status(200).json({
                    message: `Chat saved to ${exportfilename}`,
                    result: buffer.toString('base64'),
                    is_binary: true,
                });
            });
        }

        // Explicit JSONL export path; normal chat persistence remains SQLite-only.
        if (request.body.format === 'jsonl') {
            try {
                const logicalChatData = await getLogicalChatData(filename);
                const exportChatData = request.body.preserve_aikobots_metadata === false
                    ? stripAikobotsIdentityMetadata(logicalChatData)
                    : logicalChatData;
                const rawFile = serializeJsonl(exportChatData);
                const successMessage = {
                    message: `Chat saved to ${exportfilename}`,
                    result: rawFile,
                };

                console.info(`Chat exported as ${exportfilename}`);
                return response.status(200).json(successMessage);
            } catch (err) {
                console.error(err);
                const errorMessage = {
                    message: `Could not read chat data to export. Source chat file: ${filename}.`,
                };
                console.error(errorMessage.message);
                return response.status(500).json(errorMessage);
            }
        }

        let buffer = '';
        const messages = await getLogicalChatMessages(filename);
        for (const data of messages) {
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
        if (isChatPathValidationError(err)) {
            return sendChatPathValidationError(response, err);
        }
        return response.sendStatus(400);
    }
});

router.post('/group/import', async function (request, response) {
    try {
        const filedata = request.file;
        const format = request.body?.file_type;

        if (!filedata) {
            return response.sendStatus(400);
        }

        const chatname = humanizedISO8601DateTime();
        const pathToUpload = assertPathInside(filedata.destination, path.join(filedata.destination, filedata.filename), 'upload_file');

        if (format === 'sqlite') {
            const normalizedImportedChat = await normalizeImportedSqliteChat(pathToUpload, `${chatname}.sqlite`);
            const unsupportedImportMessage = getUnsupportedImportedJsonlMessage(normalizedImportedChat?.sourceHeader);
            if (unsupportedImportMessage) {
                fs.unlinkSync(pathToUpload);
                console.warn('Rejected unsupported group SQLite chat import:', unsupportedImportMessage);
                return response.status(400).send({ error: true, message: unsupportedImportMessage });
            }

            if (!normalizedImportedChat?.header) {
                fs.unlinkSync(pathToUpload);
                return response.status(400).send({ error: true, message: 'Imported chat could not be normalized.' });
            }

            const pathToNewFile = getGroupChatFilePath(request.user.directories.groupChats, chatname);
            await withChatSaveLock(pathToNewFile, async () => {
                if (hasPrimaryChatStorageFile(pathToNewFile)) {
                    throw new ChatMutationError(409, 'target_chat_exists');
                }

                await writeGroupChat(pathToNewFile, normalizedImportedChat.messages, normalizedImportedChat.header.chat_metadata || {}, normalizedImportedChat.header, { activityTimestamp: Date.now() });
            });
            fs.unlinkSync(pathToUpload);
            return response.send({ res: chatname, fileNames: [`${chatname}.sqlite`] });
        }

        const serializedChat = String(fs.readFileSync(pathToUpload, 'utf8') || '');
        const header = tryParse(serializedChat.split('\n').find(line => line.trim()) || '');
        const unsupportedImportMessage = getUnsupportedImportedJsonlMessage(header);
        if (unsupportedImportMessage) {
            fs.unlinkSync(pathToUpload);
            console.warn('Rejected unsupported group JSONL chat import:', unsupportedImportMessage);
            return response.status(400).send({ error: true, message: unsupportedImportMessage });
        }

        const normalizedImportedChat = normalizeImportedSerializedChat(serializedChat, `${chatname}.jsonl`);
        if (!normalizedImportedChat?.header) {
            fs.unlinkSync(pathToUpload);
            return response.status(400).send({ error: true, message: 'Imported chat could not be normalized.' });
        }

        const pathToNewFile = getGroupChatFilePath(request.user.directories.groupChats, chatname);
        await withChatSaveLock(pathToNewFile, async () => {
            if (hasPrimaryChatStorageFile(pathToNewFile)) {
                throw new ChatMutationError(409, 'target_chat_exists');
            }

            await writeGroupChat(pathToNewFile, normalizedImportedChat.messages, normalizedImportedChat.header.chat_metadata || {}, normalizedImportedChat.header, { activityTimestamp: Date.now() });
        });
        fs.unlinkSync(pathToUpload);
        return response.send({ res: chatname });
    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.send({ error: true });
    }
});

router.post('/import', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body) return response.sendStatus(400);

    const format = request.body.file_type;
    const avatarUrl = request.body.avatar_url;
    const characterName = request.body.character_name;
    const userName = request.body.user_name || 'User';
    const fileNames = [];

    if (!request.file) {
        return response.sendStatus(400);
    }

    try {
        const pathToUpload = assertPathInside(request.file.destination, path.join(request.file.destination, request.file.filename), 'upload_file');
        const chatsDirectory = resolveCharacterChatDirectory(request.user.directories.chats, avatarUrl);
        const importedChatBaseName = getImportedChatBaseName(request.file.originalname, characterName);

        if (!fs.existsSync(chatsDirectory)) {
            fs.mkdirSync(chatsDirectory, { recursive: true });
        }

        const getImportedChatFileName = (usedNames = []) => {
            const uniqueBaseName = getUniqueName(importedChatBaseName, (candidate) => {
                const fileName = `${candidate}.sqlite`;
                const filePath = resolveCharacterChatFilePath(request.user.directories.chats, avatarUrl, fileName);
                const jsonlPath = replaceChatStorageExtension(filePath, '.jsonl');
                return usedNames.includes(fileName) || fs.existsSync(filePath) || fs.existsSync(jsonlPath);
            });

            return `${uniqueBaseName}.sqlite`;
        };

        if (format === 'json') {
            const data = fs.readFileSync(pathToUpload, 'utf8');
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
                return response.status(400).send({ error: true, message: 'Incorrect chat format .json' });
            }

            const handleChat = async (chat) => {
                const fileName = getImportedChatFileName(fileNames);
                const filePath = resolveCharacterChatFilePath(request.user.directories.chats, avatarUrl, fileName);
                const normalizedImportedChat = normalizeImportedSerializedChat(chat, fileName);

                if (!normalizedImportedChat?.header) {
                    throw new Error('Imported chat could not be normalized.');
                }

                fileNames.push(fileName);
                await withChatSaveLock(filePath, async () => {
                    if (hasPrimaryChatStorageFile(filePath)) {
                        throw new ChatMutationError(409, 'target_chat_exists');
                    }

                    await writeLogicalChat(filePath, normalizedImportedChat.header, normalizedImportedChat.messages, {
                        allowExistingSqliteFullReplacement: true,
                        routeName: '/api/chats/import',
                        operationType: 'import_json',
                        requestBody: request.body,
                        isPrivilegedOperation: true,
                        activityTimestamp: Date.now(),
                    });
                });
            };

            const chat = importFunc(userName, characterName, jsonData);

            if (Array.isArray(chat)) {
                for (const item of chat) {
                    await handleChat(item);
                }
            } else {
                await handleChat(chat);
            }

            return response.send({ res: true, fileNames });
        }

        if (format === 'jsonl') {
            const data = fs.readFileSync(pathToUpload, 'utf8');
            let lines = data.split('\n');
            const header = lines.find(line => line.trim()) || '';

            const jsonData = JSON.parse(header);

            if (!(jsonData.user_name !== undefined || jsonData.name !== undefined)) {
                console.error('Incorrect chat format .jsonl');
                return response.status(400).send({ error: true, message: 'Incorrect chat format .jsonl' });
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
            const filePath = resolveCharacterChatFilePath(request.user.directories.chats, avatarUrl, fileName);
            const normalizedImportedChat = normalizeImportedSerializedChat(flattenedChat, fileName);

            if (!normalizedImportedChat?.header) {
                throw new Error('Imported chat could not be normalized.');
            }

            fileNames.push(fileName);
            await withChatSaveLock(filePath, async () => {
                if (hasPrimaryChatStorageFile(filePath)) {
                    throw new ChatMutationError(409, 'target_chat_exists');
                }

                await writeLogicalChat(filePath, normalizedImportedChat.header, normalizedImportedChat.messages, {
                    allowExistingSqliteFullReplacement: true,
                    routeName: '/api/chats/import',
                    operationType: 'import_jsonl',
                    requestBody: request.body,
                    isPrivilegedOperation: true,
                    activityTimestamp: Date.now(),
                });
            });
            fs.unlinkSync(pathToUpload);
            return response.send({ res: true, fileNames });
        }

        if (format === 'sqlite') {
            const fileName = getImportedChatFileName(fileNames);
            const filePath = resolveCharacterChatFilePath(request.user.directories.chats, avatarUrl, fileName);
            const normalizedImportedChat = await normalizeImportedSqliteChat(pathToUpload, fileName);
            const unsupportedImportMessage = getUnsupportedImportedJsonlMessage(normalizedImportedChat?.sourceHeader);

            if (unsupportedImportMessage) {
                console.warn('Rejected unsupported SQLite chat import:', unsupportedImportMessage);
                fs.unlinkSync(pathToUpload);
                return response.status(400).send({ error: true, message: unsupportedImportMessage });
            }

            if (!normalizedImportedChat?.header) {
                fs.unlinkSync(pathToUpload);
                return response.status(400).send({ error: true, message: 'Imported chat could not be normalized.' });
            }

            fileNames.push(fileName);
            await withChatSaveLock(filePath, async () => {
                if (hasPrimaryChatStorageFile(filePath)) {
                    throw new ChatMutationError(409, 'target_chat_exists');
                }

                await writeLogicalChat(filePath, normalizedImportedChat.header, normalizedImportedChat.messages, {
                    allowExistingSqliteFullReplacement: true,
                    routeName: '/api/chats/import',
                    operationType: 'import_sqlite',
                    requestBody: request.body,
                    isPrivilegedOperation: true,
                    activityTimestamp: Date.now(),
                });
            });
            fs.unlinkSync(pathToUpload);
            return response.send({ res: true, fileNames });
        }

        return response.status(400).send({ error: true, message: 'Unsupported chat import file type.' });
    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error('Failed to import chat:', {
            format,
            avatarUrl,
            originalName: request.file?.originalname,
            error,
        });
        return response.status(500).send({ error: true, message: 'Chat import failed. Check the server log for details.' });
    }
});

router.post('/group/get', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        const withMetadata = request.body.with_metadata === true;

        if (fs.existsSync(pathToFile) || fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return await withChatSaveLock(pathToFile, async () => {
                if (request.body.chunked) {
                    const requestedStart = request.body.range_start === undefined ? null : Number(request.body.range_start);
                    const requestedCount = request.body.count === undefined ? null : Number(request.body.count);
                    const config = normalizeLongChatConfig({
                        displayCount: request.body.display_count,
                    });
                    const payload = await buildChunkedGroupChatPayload(request.user, id, pathToFile, {
                        rangeStart: Number.isInteger(requestedStart) ? requestedStart : null,
                        count: Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : config.displayCount,
                        hydrateFull: request.body.hydrate_full === true,
                        displayCount: config.displayCount,
                    });

                    try {
                        await touchUserActivity(request.user.profile.handle);
                    } catch (error) {
                        console.error('Failed to update user last activity for group chat read:', error);
                    }

                    return response.send({
                        mode: payload.mode,
                        storageMode: payload.storageMode,
                        storage_mode: payload.storageMode,
                        isHydrated: payload.isHydrated === true,
                        totalMessages: payload.totalMessages,
                        loadedRangeStart: payload.loadedRangeStart,
                        loadedRangeEnd: payload.loadedRangeEnd,
                        tailStartId: payload.tailStartId,
                        tailEndId: payload.tailEndId,
                        headCount: payload.headCount,
                        tailCount: payload.tailCount,
                        chat_revision: payload.chat_revision,
                        chat_repaired: payload.chat_repaired === true,
                        reload_required: payload.reload_required === true,
                        ...(withMetadata ? { chat_metadata: payload.chat_metadata } : {}),
                        header: payload.header,
                        messages: payload.messages,
                    });
                }

                const payload = await ensureGroupChatHeader(request.user, id, pathToFile);
                const jsonData = payload.messages;
                const chatMetadata = _.cloneDeep(payload.header?.chat_metadata || {});
                try {
                    await touchUserActivity(request.user.profile.handle);
                } catch (error) {
                    console.error('Failed to update user last activity for group chat read:', error);
                }

                if (withMetadata) {
                    return response.send({
                        messages: jsonData,
                        chat_metadata: chatMetadata,
                        chat_revision: getChatRevision(payload.header),
                    });
                }

                return response.send(jsonData);
            });
        }
        return response.send(withMetadata
            ? { messages: [], chat_metadata: {}, chat_revision: 0 }
            : []);
    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/group/delete', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);

        return await withChatSaveLock(pathToFile, async () => {
            if (hasPrimaryChatStorageFile(pathToFile)) {
                const segments = await getChatSegments(pathToFile, { metadataOnly: fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite')) });
                requireChatMutationRequest(request.body, segments.header);
                await request.activeSessionOperation?.assertAllowed();

                deleteChatStorageCompanions(pathToFile);
                return response.send({ ok: true });
            }

            return response.send({ error: true });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/group/create-from-direct', validateAvatarUrlMiddleware, async (request, response) => {
    try {
        if (!request.body || !request.body.id || !request.body.file_name) {
            return response.sendStatus(400);
        }

        const id = String(request.body.id);
        const avatarUrl = String(request.body.avatar_url || '');
        const characterName = String(request.body.character_name || '').trim();
        if (!characterName) {
            return response.status(400).send({ error: 'invalid_character_name' });
        }

        const sourcePath = resolveCharacterChatFilePath(request.user.directories.chats, avatarUrl, request.body.file_name);
        const sourceSqlitePath = replaceChatStorageExtension(sourcePath, '.sqlite');
        if (!fs.existsSync(sourcePath) && !fs.existsSync(sourceSqlitePath)) {
            return response.status(404).send({ error: 'source_chat_not_found' });
        }

        const targetPath = assertNewGroupChatTarget(request.user, id);
        if (!fs.existsSync(request.user.directories.groupChats)) {
            fs.mkdirSync(request.user.directories.groupChats, { recursive: true });
        }

        return await withChatSaveLock(sourcePath, async () => {
            const sourceRecords = await getLogicalChatData(sourcePath);
            if (!sourceRecords.length) {
                return response.status(404).send({ error: 'source_chat_not_found' });
            }

            const messages = transformDirectMessagesForGroup(sourceRecords.slice(1), {
                characterName,
                avatarUrl,
            });

            return await withChatSaveLock(targetPath, async () => {
                assertNewGroupChatTarget(request.user, id);
                await request.activeSessionOperation?.assertAllowed();
                const header = getNewGroupChatHeader(request.body.chat_metadata, getRequestSaveSessionId(request.body));
                const writeResult = await writeLogicalChat(targetPath, header, messages, { activityTimestamp: Date.now() });
                if (writeResult.fullJsonl) {
                    getBackupFunction(request.user.profile.handle)(request.user.directories.backups, String(id), writeResult.fullJsonl);
                }

                return response.send({ ok: true, chat_revision: getChatRevision(header) });
            });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'create_group_chat_from_direct_failed' });
    }
});

router.post('/group/copy-prefix', async (request, response) => {
    try {
        if (!request.body || !request.body.source_id || !request.body.target_id) {
            return response.sendStatus(400);
        }

        const sourceId = String(request.body.source_id);
        const targetId = String(request.body.target_id);
        if (sourceId === targetId) {
            return response.status(400).send({ error: 'invalid_target_chat_id' });
        }

        const prefixEndId = Number(request.body.end_message_id);
        if (!Number.isInteger(prefixEndId) || prefixEndId < 0) {
            return response.status(400).send({ error: 'invalid_message_id' });
        }

        const sourcePath = getGroupChatFilePath(request.user.directories.groupChats, sourceId);
        if (!fs.existsSync(sourcePath) && !fs.existsSync(replaceChatStorageExtension(sourcePath, '.sqlite'))) {
            return response.status(404).send({ error: 'source_chat_not_found' });
        }

        const allowExistingTarget = request.body.replace_target === true;
        const targetPath = assertNewGroupChatTarget(request.user, targetId, { allowExisting: allowExistingTarget });
        if (!fs.existsSync(request.user.directories.groupChats)) {
            fs.mkdirSync(request.user.directories.groupChats, { recursive: true });
        }

        return await withChatSaveLock(sourcePath, async () => {
            let sourceHeader;
            let messages;
            const sourceSqlitePath = replaceChatStorageExtension(sourcePath, '.sqlite');
            if (fs.existsSync(sourceSqlitePath)) {
                const db = await loadDb(sourceSqlitePath);
                try {
                    sourceHeader = getChatHeader(db);
                    if (prefixEndId >= getMessageCount(db)) {
                        return response.status(400).send({ error: 'invalid_message_id' });
                    }
                    messages = getMessageRange(db, 0, prefixEndId + 1);
                } finally {
                    db.close();
                }
            } else {
                const sourcePayload = await ensureGroupChatHeader(request.user, sourceId, sourcePath);
                sourceHeader = sourcePayload.header;
                messages = sourcePayload.messages.slice(0, prefixEndId + 1);
            }
            if (!sourceHeader || messages.length !== prefixEndId + 1) {
                return response.status(400).send({ error: 'invalid_message_id' });
            }

            if (request.body.message_override !== undefined) {
                if (!_.isPlainObject(request.body.message_override)) {
                    return response.status(400).send({ error: 'invalid_message_override' });
                }
                messages[prefixEndId] = _.cloneDeep(request.body.message_override);
            }

            return await withChatSaveLock(targetPath, async () => {
                assertNewGroupChatTarget(request.user, targetId, { allowExisting: allowExistingTarget });
                await request.activeSessionOperation?.assertAllowed();
                const header = getNewGroupChatHeader(request.body.chat_metadata, getRequestSaveSessionId(request.body));
                const writeResult = await writeLogicalChat(targetPath, header, messages, {
                    regenerateIdentities: request.body.regenerate_identities === true,
                    allowExistingSqliteFullReplacement: allowExistingTarget,
                    routeName: '/api/chats/group/copy-prefix',
                    operationType: 'group_copy_prefix',
                    requestBody: request.body,
                    isPrivilegedOperation: allowExistingTarget,
                    activityTimestamp: Date.now(),
                });
                if (writeResult.fullJsonl) {
                    getBackupFunction(request.user.profile.handle)(request.user.directories.backups, String(targetId), writeResult.fullJsonl);
                }

                return response.send({ ok: true, chat_revision: getChatRevision(header) });
            });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'copy_group_chat_prefix_failed' });
    }
});

router.post('/group/member/rename-history', async (request, response) => {
    try {
        const groupId = normalizeGroupId(request.body?.group_id);
        const oldAvatar = String(request.body?.old_avatar || '');
        const newAvatar = String(request.body?.new_avatar || '');
        const newName = String(request.body?.new_name || '').trim();

        if (!groupId || !oldAvatar || !newAvatar || !newName) {
            return response.status(400).send({ error: 'invalid_rename_request' });
        }

        const groupPath = getGroupFilePath(request.user.directories.groups, groupId);
        if (!fs.existsSync(groupPath)) {
            return response.status(404).send({ error: 'group_not_found' });
        }

        await request.activeSessionOperation?.assertAllowed();

        return await withGroupMetadataLock(groupPath, async () => {
            const group = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
            if (!Array.isArray(group.members) || !Array.isArray(group.chats)) {
                return response.status(400).send({ error: 'invalid_group' });
            }

            let groupChanged = false;
            const memberIndex = group.members.findIndex(member => member === oldAvatar);
            if (memberIndex !== -1) {
                group.members[memberIndex] = newAvatar;
                groupChanged = true;
            }

            let changedChats = 0;
            let changedMessages = 0;
            for (const chatId of group.chats) {
                const chatPath = getGroupChatFilePath(request.user.directories.groupChats, chatId);
                if (!fs.existsSync(chatPath) && !fs.existsSync(replaceChatStorageExtension(chatPath, '.sqlite'))) {
                    continue;
                }

                await withChatSaveLock(chatPath, async () => {
                    if (!fs.existsSync(replaceChatStorageExtension(chatPath, '.sqlite'))) {
                        await ensureGroupChatHeader(request.user, chatId, chatPath);
                    }
                    const updateResult = await updateSqliteParticipantHistory({
                        filePath: chatPath,
                        oldAvatar,
                        newAvatar,
                        newName,
                        saveSessionId: getRequestSaveSessionId(request.body),
                    });
                    if (updateResult.changed === 0) {
                        return;
                    }

                    changedChats++;
                    changedMessages += updateResult.changed;
                });
            }

            if (groupChanged) {
                writeFileAtomicSync(groupPath, JSON.stringify(sanitizeGroupForPersistence(group), null, 4));
            }

            return response.send({
                ok: true,
                group_changed: groupChanged,
                changed_chats: changedChats,
                changed_messages: changedMessages,
            });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'rename_group_member_history_failed' });
    }
});

router.patch('/group/message/update', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        if (!fs.existsSync(pathToFile) && !fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(pathToFile, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const result = await updateGroupChatMessageRow({
                filePath: pathToFile,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
            });
            return response.send(result);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'message_update_failed' });
    }
});

router.post('/group/message/update', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        if (!fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(pathToFile, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await updateSqliteMessageByUuid({
                filePath: pathToFile,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'message_update_failed' });
    }
});

router.post('/group/message/append', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const backupOwnerKey = getVerifiedGroupBackupOwnerKey(request.user, id, request.body.group_id);
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        if (!fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(pathToFile, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await appendSqliteMessage({
                filePath: pathToFile,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            await maybeBackupSqliteChatAfterAppend(request.user, pathToFile, backupOwnerKey, payload.totalMessages);
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'append_failed' });
    }
});

router.post('/group/message/delete', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        if (!fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(pathToFile, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await deleteSqliteMessageByUuid({
                filePath: pathToFile,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'message_delete_failed' });
    }
});

router.post('/group/truncate-after', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        if (!fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(pathToFile, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await truncateSqliteChatAfterUuid({
                filePath: pathToFile,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });
            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'truncate_failed' });
    }
});

router.post('/group/message/clone', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);
        if (!fs.existsSync(pathToFile) && !fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'))) {
            return response.status(404).send({ error: 'chat_not_found' });
        }

        return await withChatSaveLock(pathToFile, async () => {
            await request.activeSessionOperation?.assertAllowed();
            const payload = await cloneSqliteMessageAfter({
                filePath: pathToFile,
                requestBody: request.body,
                saveSessionId: getRequestSaveSessionId(request.body),
                displayCount: request.body.display_count,
            });

            return response.send(payload);
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'clone_failed' });
    }
});

router.post('/group/save', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        if (!hasValidGroupChatPayload(request.body.chat)) {
            return response.status(400).send({ error: 'invalid_chat_payload' });
        }

        const id = request.body.id;
        const backupOwnerKey = getVerifiedGroupBackupOwnerKey(request.user, id, request.body.group_id);
        const pathToFile = getGroupChatFilePath(request.user.directories.groupChats, id);

        if (!fs.existsSync(request.user.directories.groupChats)) {
            fs.mkdirSync(request.user.directories.groupChats, { recursive: true });
        }

        return await withChatSaveLock(pathToFile, async () => {
            const chat_data = request.body.chat;
            const groupSqliteExists = fs.existsSync(replaceChatStorageExtension(pathToFile, '.sqlite'));
            const existingPayload = groupSqliteExists
                ? null
                : await getGroupChatPayload(pathToFile);
            const loadedRangeSqliteSegments = groupSqliteExists
                ? await getChatSegments(pathToFile, { metadataOnly: true })
                : null;
            const effectiveExistingPayload = existingPayload ?? {
                header: loadedRangeSqliteSegments?.header || null,
                messages: [],
                hasHeader: isGroupChatHeader(loadedRangeSqliteSegments?.header),
            };
            if (groupSqliteExists) {
                const repeatedReceipt = await getRepeatedSqliteOperationReceiptFromFile(replaceChatStorageExtension(pathToFile, '.sqlite'), request.body);
                if (repeatedReceipt) {
                    return response.send(repeatedReceipt);
                }
            }

            if (groupSqliteExists && effectiveExistingPayload.header) {
                await throwIfSqliteChatFileIdentityRepairNeeded(replaceChatStorageExtension(pathToFile, '.sqlite'));
            }
            const revisionCheck = effectiveExistingPayload.header || Object.prototype.hasOwnProperty.call(request.body || {}, 'base_revision')
                ? requireChatMutationRequest(request.body, effectiveExistingPayload.header)
                : { currentRevision: 0, nextRevision: 1 };

            const chatMetadata = _.isPlainObject(request.body.chat_metadata)
                ? _.cloneDeep(request.body.chat_metadata)
                : (effectiveExistingPayload.hasHeader
                    ? _.cloneDeep(effectiveExistingPayload.header?.chat_metadata || {})
                    : resolveLegacyGroupChatMetadata(request.user, id));
            const header = setChatRevision(
                buildGroupChatHeader(chatMetadata, effectiveExistingPayload.header),
                revisionCheck.nextRevision,
                getRequestSaveSessionId(request.body),
            );
            let messages = chat_data;
            const writeOptions = {
                regenerateIdentities: request.body.regenerate_identities === true,
                requestBody: request.body,
                activityTimestamp: !effectiveExistingPayload.header && chat_data.length > 0 ? Date.now() : null,
            };

            if (request.body.save_mode === 'tail') {
                return response.status(400).send({ error: 'invalid_save_mode' });
            } else if (request.body.save_mode === 'loaded_range') {
                if (groupSqliteExists) {
                    await assertChatSaveMutationAllowed(request);
                    if (isForcePushAuthorityRequest(request.body)) {
                        await backupPreForcePushServerChat(request.user, pathToFile, backupOwnerKey);
                    }
                    const payload = await updateSqliteLoadedMessageRange({
                        filePath: pathToFile,
                        requestBody: request.body,
                        incomingHeader: buildGroupChatHeader(chatMetadata, effectiveExistingPayload.header),
                        rangeMessages: chat_data,
                        saveSessionId: getRequestSaveSessionId(request.body),
                        regenerateIdentities: request.body.regenerate_identities === true,
                    });
                    if (payload.fullJsonl) {
                        getBackupFunction(request.user.profile.handle)(request.user.directories.backups, backupOwnerKey, payload.fullJsonl);
                    }
                    return response.send({ ok: true, chat_revision: payload.chat_revision, storage_mode: payload.storage_mode });
                }

                if (!effectiveExistingPayload.header) {
                    return response.status(400).send({ error: 'invalid_loaded_range' });
                }

                const isForcePush = isForcePushAuthorityRequest(request.body);
                const existingLogicalChat = [effectiveExistingPayload.header, ...effectiveExistingPayload.messages];
                const loadedRangeResult = isForcePush
                    ? applyForcePushLoadedMessageRange(
                        existingLogicalChat,
                        request.body.loaded_range_start,
                        chat_data,
                        request.body.loaded_range_end,
                        request.body,
                    )
                    : applyLoadedMessageRange(
                        existingLogicalChat,
                        request.body.loaded_range_start,
                        chat_data,
                        request.body.loaded_range_end,
                    );
                if (!isForcePush) {
                    const messageCountValidation = validateSubmittedMessageCount(request.body, effectiveExistingPayload.messages.length);
                    if (!messageCountValidation.ok) {
                        return response.status(400).send({ error: messageCountValidation.error });
                    }
                }
                if (!loadedRangeResult.ok) {
                    return response.status(400).send({ error: loadedRangeResult.error });
                }
                if (isForcePush) {
                    await backupPreForcePushServerChat(request.user, pathToFile, backupOwnerKey);
                }

                messages = loadedRangeResult.chatData.slice(1);
            } else if (request.body.save_mode !== undefined) {
                return response.status(400).send({ error: 'invalid_save_mode' });
            } else if (request.body.full_chat !== true) {
                return response.status(400).send({ error: 'full_save_requires_hydration' });
            } else if (effectiveExistingPayload.header || Object.prototype.hasOwnProperty.call(request.body || {}, 'base_revision')) {
                const fullChatValidation = validateSubmittedFullChatPayload(request.body, chat_data);
                if (!fullChatValidation.ok) {
                    return response.status(400).send({ error: fullChatValidation.error });
                }
            }

            if (groupSqliteExists && effectiveExistingPayload.header) {
                const validation = validateExistingSqliteFullReplacementRequest({
                    routeName: '/api/chats/group/save',
                    operationType: 'ordinary_group_full_replace',
                    filePath: replaceChatStorageExtension(pathToFile, '.sqlite'),
                    requestBody: request.body,
                    existingHeader: effectiveExistingPayload.header,
                    serverMessageCountBefore: loadedRangeSqliteSegments?.messageCount,
                    submittedMessageCount: chat_data.length,
                });

                return response.status(validation.status).send({ error: validation.error });
            }

            await assertChatSaveMutationAllowed(request);
            const writeResult = await writeLogicalChat(pathToFile, header, messages, writeOptions);
            if (writeResult.fullJsonl) {
                getBackupFunction(request.user.profile.handle)(request.user.directories.backups, backupOwnerKey, writeResult.fullJsonl);
            }
            return response.send({ ok: true, chat_revision: revisionCheck.nextRevision, storage_mode: writeResult.storageMode });
        });
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
        if (error instanceof ChatMutationError) {
            return response.status(error.status || 400).send({ error: error.error, message: error.message, ...error.details });
        }
        console.error(error);
        return response.status(500).send({ error: 'save_failed' });
    }
});

router.post('/search', validateAvatarUrlMiddleware, async function (request, response) {
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
            // JSONL compatability intentionally not supported
            const groupChatsDir = request.user.directories.groupChats;
            chatFiles = targetGroup.chats
                .map(chatId => {
                    const filePath = getGroupChatFilePath(groupChatsDir, chatId);
                    const sqlitePath = replaceChatStorageExtension(filePath, '.sqlite');
                    if (!fs.existsSync(sqlitePath)) return null;
                    const fileStats = getChatFileStats(filePath);
                    return {
                        file_name: chatId,
                        file_size: formatBytes(fileStats.totalSize),
                        path: filePath,
                    };
                })
                .filter(x => x);
        } else {
            // Regular character chat directory
            const directoryPath = resolveCharacterChatDirectory(request.user.directories.chats, avatar_url);

            if (!fs.existsSync(directoryPath)) {
                return response.send([]);
            }

            chatFiles = getDeduplicatedChatHistoryFileNames(fs.readdirSync(directoryPath), { includeLegacyJsonl: false })
                .map(fileName => {
                    const filePath = path.join(directoryPath, fileName);
                    const stats = getChatFileStats(filePath);
                    return {
                        file_name: fileName,
                        file_size: formatBytes(stats.totalSize),
                        path: filePath,
                    };
                });
        }

        const results = [];

        for (const chatFile of chatFiles) {
            const searchResult = await getChatSearchResult(chatFile, fragments, { isGroup: Boolean(group_id) });
            if (searchResult) {
                results.push(searchResult);
            }
        }

        // Sort by last message date descending
        results.sort((a, b) => b.last_mes - a.last_mes);
        return response.send(results);

    } catch (error) {
        if (isUnsupportedSplitTailChatError(error)) {
            return sendUnsupportedSplitTailChatError(response, error);
        }
        if (isChatPathValidationError(error)) {
            return sendChatPathValidationError(response, error);
        }
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
            const directChatFiles = getDeduplicatedChatHistoryFileNames(orphanChatFiles, { includeLegacyJsonl: false });

            const directChats = fragments.length
                ? (await Promise.all(directChatFiles
                    .map(async fileName => {
                        const filePath = path.join(orphanChatDir, fileName);
                        const fileStats = getChatFileStats(filePath);
                        return await getChatSearchResult({
                            file_name: fileName,
                            file_size: formatBytes(fileStats.totalSize),
                            path: filePath,
                        }, fragments);
                    })))
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
                    ? (await Promise.all((Array.isArray(group.chats) ? group.chats : [])
                        .map(async chatId => {
                            const filePath = getGroupChatFilePath(request.user.directories.groupChats, chatId);
                            if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
                                return null;
                            }

                            const fileStats = getChatFileStats(filePath);
                            return await getChatSearchResult({
                                file_name: `${chatId}.sqlite`,
                                file_size: formatBytes(fileStats.totalSize),
                                path: filePath,
                            }, fragments, { isGroup: true });
                        })))
                        .filter(Boolean)
                        .sort((a, b) => b.last_mes - a.last_mes)
                    : (await Promise.allSettled(
                        (Array.isArray(group.chats) ? group.chats : []).map(chatId => {
                            const filePath = getGroupChatFilePath(request.user.directories.groupChats, chatId);
                            if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
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
        /** @typedef {{pngFile?: string, groupId?: string, filePath: string, activity?: number}} ChatFile */
        /** @type {ChatFile[]} */
        const allChatFiles = [];
        /** @type {import('../../public/scripts/welcome-screen.js').PinnedChat[]} */
        const pinnedChats = Array.isArray(request.body.pinned) ? request.body.pinned : [];

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
                    const storageFiles = getDeduplicatedChatHistoryFileNames(chatFiles, { includeLegacyJsonl: false });

                    for (const file of storageFiles) {
                        const filePath = path.join(pathToChats, file);
                        allChatFiles.push({ pngFile, filePath });
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
                            const filePath = getGroupChatFilePath(request.user.directories.groupChats, chat);
                            if (!fs.existsSync(replaceChatStorageExtension(filePath, '.sqlite'))) {
                                continue;
                            }
                            allChatFiles.push({ groupId: groupData.id, filePath });
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
                            const chatFiles = getDeduplicatedChatHistoryFileNames(dirents, { includeLegacyJsonl: false });

                            for (const file of chatFiles) {
                            const filePath = path.join(request.user.directories.chats, file);
                            allChatFiles.push({ filePath });
                            }
                            };

                            await Promise.allSettled([getCharacterChatFiles(), getGroupChatFiles(), getRootChatFiles()]);

                            for (const chatFile of allChatFiles) {
                            try {
                            chatFile.activity = getChatLastActivity(chatFile.filePath);
                            } catch {
                            chatFile.activity = 0;
                            }
                            }

                            const max = parseInt(request.body.max ?? Number.MAX_SAFE_INTEGER) + pinnedChats.length;
                            const isPinned = (/** @type {ChatFile} */ chatFile) => pinnedChats.some(p => path.parse(String(p.file_name || '')).name === path.parse(path.basename(chatFile.filePath)).name && (p.avatar === chatFile.pngFile || p.group === chatFile.groupId));
                            const recentChats = allChatFiles.filter(chatFile => (chatFile.activity ?? 0) > 0).sort((a, b) => {
                            const isAPinned = isPinned(a);
                            const isBPinned = isPinned(b);

                            if (isAPinned && !isBPinned) return -1;
                            if (!isAPinned && isBPinned) return 1;

                            return (b.activity ?? 0) - (a.activity ?? 0);
                            }).slice(0, max);
                            const jsonFilesPromise = recentChats.map((file) => {
                                const withMetadata = Boolean(request.body.metadata);
                                return file.groupId
                                    ? getChatInfo(file.filePath, { group: file.groupId, last_activity: file.activity ?? 0 }, true, withMetadata)
                                    : getChatInfo(file.filePath, { avatar: file.pngFile, last_activity: file.activity ?? 0 }, false, withMetadata);
                            });

                            const chatDataResults = await Promise.allSettled(jsonFilesPromise);
                            const chatData = chatDataResults.filter(x => x.status === 'fulfilled').map(x => x.value);
                            const validFiles = chatData.filter(i => i.file_name);

                            return response.send(validFiles);
                            } catch (error) {
                            console.error(error);
                            return response.sendStatus(500);
                            }
                            });
