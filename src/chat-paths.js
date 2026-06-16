import path from 'node:path';

const CHAT_HEAD_FILE_SUFFIX = '.head.jsonl';

export class ChatPathValidationError extends Error {
    constructor(message, code = 'invalid_chat_path') {
        super(message);
        this.name = 'ChatPathValidationError';
        this.status = 400;
        this.type = 'ChatPathValidationError';
        this.code = code;
    }
}

export function isChatPathValidationError(error) {
    return error instanceof ChatPathValidationError || error?.type === 'ChatPathValidationError';
}

function getDecodedPathVariants(value) {
    const variants = [String(value ?? '')];
    for (let index = 0; index < 3; index++) {
        const current = variants[variants.length - 1];
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current || variants.includes(decoded)) {
                break;
            }
            variants.push(decoded);
        } catch {
            break;
        }
    }
    return variants;
}

function hasUnsafeLogicalPathToken(value) {
    return getDecodedPathVariants(value).some(token => {
        const normalized = String(token || '').trim();
        return !normalized
            || normalized === '.'
            || normalized === '..'
            || normalized.includes('\0')
            || normalized.includes('/')
            || normalized.includes('\\')
            || path.posix.isAbsolute(normalized)
            || path.win32.isAbsolute(normalized)
            || /^[a-zA-Z]:/.test(normalized);
    });
}

function assertSafeLogicalName(value, fieldName) {
    const logicalName = String(value ?? '').trim();
    if (hasUnsafeLogicalPathToken(logicalName)) {
        throw new ChatPathValidationError(`Invalid ${fieldName}.`, `invalid_${fieldName}`);
    }
    return logicalName;
}

function assertPathInside(baseDirectory, targetPath, fieldName = 'path') {
    const resolvedBase = path.resolve(baseDirectory);
    const resolvedTarget = path.resolve(targetPath);
    const relativePath = path.relative(resolvedBase, resolvedTarget);
    const firstSegment = relativePath.split(/[\\/]/)[0];

    if (relativePath && (firstSegment === '..' || path.isAbsolute(relativePath))) {
        throw new ChatPathValidationError(`Resolved ${fieldName} escapes its base directory.`, `invalid_${fieldName}`);
    }

    return resolvedTarget;
}

function resolveContainedChildPath(baseDirectory, childName, fieldName) {
    const logicalName = assertSafeLogicalName(childName, fieldName);
    return assertPathInside(baseDirectory, path.join(baseDirectory, logicalName), fieldName);
}

function normalizeChatJsonlFileName(fileName, { fieldName = 'chat_file', allowHead = false, requireHead = false } = {}) {
    const logicalName = assertSafeLogicalName(fileName, fieldName);

    if (logicalName.endsWith('.sqlite')) {
        return logicalName;
    }

    if (logicalName.endsWith('.jsonl')) {
        return logicalName;
    }

    const normalizedFileName = `${logicalName}.sqlite`;

    if (path.extname(normalizedFileName).toLowerCase() !== '.sqlite' && path.extname(normalizedFileName).toLowerCase() !== '.jsonl') {
        throw new ChatPathValidationError(`Invalid ${fieldName} extension.`, `invalid_${fieldName}`);
    }

    if (!allowHead && isHeadChatFile(normalizedFileName)) {
        throw new ChatPathValidationError(`Invalid ${fieldName}.`, `invalid_${fieldName}`);
    }

    if (requireHead && !isHeadChatFile(normalizedFileName)) {
        throw new ChatPathValidationError(`Invalid split head file.`, `invalid_${fieldName}`);
    }

    return normalizedFileName;
}

function normalizeGroupChatId(chatId) {
    const logicalName = assertSafeLogicalName(chatId, 'group_chat_id');
    if (logicalName.endsWith('.sqlite') || logicalName.endsWith('.jsonl')) {
        return path.parse(logicalName).name;
    }
    return logicalName;
}

export function isHeadChatFile(fileName) {
    return String(fileName).endsWith(CHAT_HEAD_FILE_SUFFIX);
}

function isChatHistoryFileName(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    return (extension === '.jsonl' || extension === '.sqlite') && !isHeadChatFile(fileName);
}

/**
 * Returns one storage file per logical chat history, preferring SQLite over legacy JSONL.
 * @param {(string|import('node:fs').Dirent)[]} files Directory entries or file names to inspect.
 * @returns {string[]} Deduplicated chat file names.
 */
export function getDeduplicatedChatHistoryFileNames(files) {
    const chatFiles = new Map();

    for (const file of files) {
        if (file && typeof file === 'object' && typeof file.isFile === 'function' && !file.isFile()) {
            continue;
        }

        const fileName = typeof file === 'string' ? file : file?.name;
        if (!fileName || !isChatHistoryFileName(fileName)) {
            continue;
        }

        const logicalName = path.parse(fileName).name;
        const existingFileName = chatFiles.get(logicalName);
        if (!existingFileName || path.extname(fileName).toLowerCase() === '.sqlite') {
            chatFiles.set(logicalName, fileName);
        }
    }

    return Array.from(chatFiles.values());
}

export function getSplitHeadPath(filePath) {
    const parsedPath = path.parse(filePath);
    return resolveSplitHeadCompanionPath(filePath, `${parsedPath.name}${CHAT_HEAD_FILE_SUFFIX}`);
}

export function resolveSplitHeadCompanionPath(filePath, headFileName = null) {
    const fileDirectory = path.dirname(path.resolve(filePath));
    const companionFileName = normalizeChatJsonlFileName(headFileName || `${path.parse(filePath).name}${CHAT_HEAD_FILE_SUFFIX}`, {
        fieldName: 'split_head_file',
        allowHead: true,
        requireHead: true,
    });
    return resolveContainedChildPath(fileDirectory, companionFileName, 'split_head_file');
}

export function resolveCharacterChatDirectory(chatsDirectory, avatarUrl) {
    const directoryName = assertSafeLogicalName(String(avatarUrl ?? '').replace(/\.png$/i, ''), 'avatar_url');
    return resolveContainedChildPath(chatsDirectory, directoryName, 'chat_directory');
}

export function resolveCharacterChatFilePath(chatsDirectory, avatarUrl, fileName) {
    const directoryPath = resolveCharacterChatDirectory(chatsDirectory, avatarUrl);
    const normalizedFileName = normalizeChatJsonlFileName(fileName);
    return resolveContainedChildPath(directoryPath, normalizedFileName, 'chat_file');
}

export function resolveDirectChatFilePath(chatsDirectory, avatarUrl, fileName) {
    return resolveCharacterChatFilePath(chatsDirectory, avatarUrl, fileName);
}

export function resolveGroupChatFilePath(groupChatsDirectory, chatId) {
    const normalizedFileName = normalizeChatJsonlFileName(chatId, { fieldName: 'group_chat_file' });
    return resolveContainedChildPath(groupChatsDirectory, normalizedFileName, 'group_chat_file');
}

/**
 * Resolves every storage companion for a group chat ID inside the group chat directory.
 * @param {string} groupChatsDirectory Base group chat directory.
 * @param {string} chatId Logical group chat ID or existing group chat file name.
 * @returns {{chatId: string, jsonlPath: string, sqlitePath: string, headPath: string}}
 */
export function resolveGroupChatStoragePaths(groupChatsDirectory, chatId) {
    const safeChatId = normalizeGroupChatId(chatId);
    const jsonlPath = resolveContainedChildPath(groupChatsDirectory, `${safeChatId}.jsonl`, 'group_chat_file');
    const sqlitePath = resolveContainedChildPath(groupChatsDirectory, `${safeChatId}.sqlite`, 'group_chat_file');
    const headPath = getSplitHeadPath(jsonlPath);
    return { chatId: safeChatId, jsonlPath, sqlitePath, headPath };
}

export function validateStmbChatRef(chatRef) {
    const reference = chatRef && typeof chatRef === 'object' ? chatRef : {};

    if (reference.type === 'group') {
        const chatId = String(reference.chatId || '').trim();
        if (chatId) {
            normalizeChatJsonlFileName(chatId, { fieldName: 'chatRef_chatId' });
        }
        return { type: 'group', chatId };
    }

    const avatarUrl = String(reference.avatarUrl || '').trim();
    const fileName = String(reference.fileName || '').trim();
    if (avatarUrl) {
        assertSafeLogicalName(avatarUrl.replace(/\.png$/i, ''), 'chatRef_avatarUrl');
    }
    if (fileName) {
        normalizeChatJsonlFileName(fileName, { fieldName: 'chatRef_fileName' });
    }

    return { type: 'character', avatarUrl, fileName };
}
