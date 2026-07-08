import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { Buffer } from 'node:buffer';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import yaml from 'yaml';
import _ from 'lodash';
import mime from 'mime-types';
import { Jimp, JimpMime } from '../jimp.js';
import storage from 'node-persist';

import { AVATAR_WIDTH, AVATAR_HEIGHT, DEFAULT_AVATAR_PATH } from '../constants.js';
import { default as validateAvatarUrlMiddleware, getFileNameValidationFunction } from '../middleware/validateFileName.js';
import { deepMerge, humanizedISO8601DateTime, tryParse, extractFileFromZipBuffer, MemoryLimitedMap, getConfigValue, mutateJsonString, clientRelativePath, getUniqueName, sanitizeSafeCharacterReplacements } from '../util.js';
import { TavernCardValidator } from '../validator/TavernCardValidator.js';
import { parse, read, write } from '../character-card-parser.js';
import { getCharacterDistributionPolicy, getCharacterDistributionUserBlacklistEntries, setCharacterDistributionPolicy } from '../character-distribution-registry.js';
import { getCharacterOwnerHandle, getCharacterOwnerHandles, getCharacterSharedKey, validateOwnedCharacterLinkedLorebooks } from '../character-linked-lorebooks.js';
import {
    CharacterSharingRepositoryError,
    checkinSharedCharacter,
    checkoutSharedCharacter,
    deleteSharedCharacter,
    getCharacterMetadata,
    getSharedCharacterRecord,
    promoteCharacterToShared,
    readSharedCharacterIndexSnapshot,
    updateSharedCharacterOwners,
} from '../character-sharing-repository.js';
import { readWorldInfoFile } from './worldinfo.js';
import { invalidateThumbnail } from './thumbnails.js';
import { importRisuSprites } from './sprites.js';
import { getAllEnabledUsers, getUserDirectories, requireAdminMiddleware } from '../users.js';
import { getChatInfo, getDeduplicatedChatHistoryFileNames } from './chats.js';
import { ByafParser } from '../byaf.js';
import cacheBuster from '../middleware/cacheBuster.js';
import { assertPathUnderParent, assertSafeFileName, PathSecurityError, resolvePathUnderParent } from '../path-security.js';
import { DISTRIBUTION_SOURCE_TYPES, PUBLISH_MODES, SUBMISSION_STATUSES, deleteDefaultContentCharacter, distributeCharacterFile, getExistingApprovedDistributionViewForSource, getSubmissionPaths, getSubmissionRecord } from '../character-submissions.js';
import {
    reconcileCharacterRepushBlacklistEntries,
    removeCharacterRepushBlacklistEntry,
    upsertCharacterRepushBlacklistEntry,
} from '../character-repush-blacklist-settings.js';
import {
    clearCharacterFavoriteState,
    createFavoritesState,
    flushFavoritesState,
    getCharacterFavorite,
    getLegacyCharacterFavoriteState,
    moveAvatarFavorite,
    setCharacterFavorite,
} from '../favorites-repository.js';
import { countBotDryRunMessageTokens, countBotDryRunTextTokens, countBotDryRunTokens } from './tokenizers.js';
import { assembleChatCompletionPrompt } from '../prompting/chat-completion-assembly.js';
import { prepareServerPromptContext } from './backends/chat-completions.js';
import { migrateFromJsonlRecords } from '../sqlite-manager.js';

// With 100 MB limit it would take roughly 3000 characters to reach this limit
const memoryCacheCapacity = getConfigValue('performance.memoryCacheCapacity', '100mb');
const memoryCache = new MemoryLimitedMap(memoryCacheCapacity);
// Some Android devices require tighter memory management
const isAndroid = process.platform === 'android';
// Use shallow character data for the character list
const useShallowCharacters = !!getConfigValue('performance.lazyLoadCharacters', false, 'boolean');
const useDiskCache = !!getConfigValue('performance.useDiskCache', true, 'boolean');
const characterEndpointInstanceId = `${process.pid}-${Date.now().toString(36)}`;
let characterListRequestCounter = 0;
const ALLOWED_CHARACTER_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const TOKEN_DRY_RUN_TOKENIZER = 'o200k_base';
const TOKEN_DRY_RUN_TOKENIZER_MODE = 'standardized_local_estimate';
const TOKEN_DRY_RUN_MODE = 'zero_history_zero_persona';
const TOKEN_DRY_RUN_VERSION = 1;
const TOKEN_DRY_RUN_ASSEMBLY_MODEL = 'gpt-4o';
const CATALOG_CHARACTER_DIRECTORY = 'characters';
const CATALOG_CHARACTER_EXTENSION = '.png';
const CHAT_STORAGE_EXTENSIONS = new Set(['.jsonl', '.sqlite']);

function getDefaultContentRoot() {
    return path.resolve(String(globalThis.DEFAULT_CONTENT_ROOT || './default/content'));
}

function getDefaultContentIndexPath() {
    return path.join(getDefaultContentRoot(), 'index.json');
}

function getCatalogCharactersDirectory() {
    return path.join(getDefaultContentRoot(), CATALOG_CHARACTER_DIRECTORY);
}

function normalizeCatalogCharacterIndexFilename(value) {
    const normalizedFilename = String(value || '').replaceAll('\\', '/').trim();
    const parsed = path.posix.parse(normalizedFilename);
    if (
        parsed.dir !== CATALOG_CHARACTER_DIRECTORY
        || parsed.base !== sanitize(parsed.base)
        || path.posix.extname(parsed.base).toLowerCase() !== CATALOG_CHARACTER_EXTENSION
    ) {
        return '';
    }

    return `${CATALOG_CHARACTER_DIRECTORY}/${parsed.base}`;
}

async function readCatalogCharacterIndex() {
    const indexPath = getDefaultContentIndexPath();
    if (!fs.existsSync(indexPath)) {
        return [];
    }

    const rawIndex = await fsPromises.readFile(indexPath, 'utf8');
    const parsedIndex = JSON.parse(rawIndex);
    if (!Array.isArray(parsedIndex)) {
        return [];
    }

    const filenames = new Map();
    for (const item of parsedIndex) {
        if (item?.type !== 'character') {
            continue;
        }

        const normalizedFilename = normalizeCatalogCharacterIndexFilename(item?.filename);
        if (!normalizedFilename) {
            continue;
        }

        filenames.set(normalizedFilename, normalizedFilename);
    }

    return Array.from(filenames.values()).sort((left, right) => left.localeCompare(right));
}

async function getIndexedCatalogCharacter(filename, indexedFilenames = null) {
    const normalizedFilename = normalizeCatalogCharacterIndexFilename(filename);
    if (!normalizedFilename) {
        return null;
    }

    const catalogIndex = indexedFilenames ?? await readCatalogCharacterIndex();
    if (!catalogIndex.includes(normalizedFilename)) {
        return null;
    }

    const publishedFilename = path.posix.basename(normalizedFilename);
    const filePath = resolvePathUnderParent(getCatalogCharactersDirectory(), publishedFilename, 'catalog character');
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return {
        indexFilename: normalizedFilename,
        publishedFilename,
        filePath,
    };
}

async function readCatalogCharacterCard(filePath) {
    const [rawBuffer, rawCard] = await Promise.all([
        fsPromises.readFile(filePath),
        parse(filePath, 'png'),
    ]);

    return {
        rawBuffer,
        card: JSON.parse(rawCard),
    };
}

async function writeCatalogCharacterToUser(sourcePath, destinationPath) {
    const { rawBuffer, card } = await readCatalogCharacterCard(sourcePath);
    clearCharacterFavoriteState(card);
    await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
    writeFileAtomicSync(destinationPath, write(rawBuffer, JSON.stringify(card)));
    return card;
}

function resolveUploadedFilePath(file) {
    return assertPathUnderParent(file.destination, path.join(file.destination, file.filename), 'upload');
}

function resolveCharacterFilePath(directories, avatarName) {
    const fileName = assertSafeFileName(avatarName, 'avatar');
    if (sanitize(fileName) !== fileName || path.extname(fileName).toLowerCase() !== '.png') {
        throw new PathSecurityError('Invalid avatar filename.');
    }
    return resolvePathUnderParent(directories.characters, fileName, 'avatar');
}

function resolveCharacterOutputPath(directories, outputFile) {
    const internalName = assertSafeFileName(outputFile, 'character');
    return resolveCharacterFilePath(directories, `${internalName}.png`);
}

function resolveCharacterChatDirectory(directories, internalName) {
    const safeName = assertSafeFileName(internalName, 'character chat directory');
    return resolvePathUnderParent(directories.chats, safeName, 'character chat directory');
}

function resolveCharacterChatFilePath(directories, internalName, chatFileName) {
    const fileName = assertSafeFileName(chatFileName, 'chat file');
    const extension = path.extname(fileName).toLowerCase();
    if (extension !== '.jsonl' && extension !== '.sqlite') {
        throw new PathSecurityError('Invalid chat file extension.');
    }
    return resolvePathUnderParent(resolveCharacterChatDirectory(directories, internalName), fileName, 'chat file');
}

function resolveCharacterImagePath(parentDirectory, fileName) {
    const safeFileName = assertSafeFileName(fileName, 'image file');
    const extension = path.extname(safeFileName).toLowerCase();
    if (!ALLOWED_CHARACTER_IMAGE_EXTENSIONS.has(extension)) {
        throw new PathSecurityError('Invalid image extension.');
    }
    return resolvePathUnderParent(parentDirectory, safeFileName, 'image file');
}

function coerceFavoriteValue(...values) {
    for (const value of values) {
        if (value === undefined) {
            continue;
        }

        return value === true || value === 'true';
    }

    return undefined;
}

function normalizeCharacterJsonForPersistence(data) {
    try {
        const character = JSON.parse(data);
        clearCharacterFavoriteState(character);
        return JSON.stringify(character);
    } catch {
        return data;
    }
}

function getCharacterOwnerLabel(characterCard) {
    const ownerHandles = getCharacterOwnerHandles(characterCard);
    if (ownerHandles.length > 0) {
        return ownerHandles.join(', ');
    }

    return getCharacterOwnerHandle(characterCard);
}

class DiskCache {
    /**
     * @type {string}
     * @readonly
     */
    static DIRECTORY = 'characters';

    /**
     * @type {number}
     * @readonly
     */
    static SYNC_INTERVAL = 5 * 60 * 1000;

    /** @type {import('node-persist').LocalStorage} */
    #instance;

    /** @type {NodeJS.Timeout} */
    #syncInterval;

    /**
     * Queue of user handles to sync.
     * @type {Set<string>}
     * @readonly
     */
    syncQueue = new Set();

    /**
     * Path to the cache directory.
     * @returns {string}
     */
    get cachePath() {
        return path.join(globalThis.DATA_ROOT, '_cache', DiskCache.DIRECTORY);
    }

    /**
     * Returns the list of hashed keys in the cache.
     * @returns {string[]}
     */
    get hashedKeys() {
        return fs.readdirSync(this.cachePath);
    }

    /**
     * Processes the synchronization queue.
     * @returns {Promise<void>}
     */
    async #syncCacheEntries() {
        try {
            if (!useDiskCache || this.syncQueue.size === 0) {
                return;
            }

            const directories = [...this.syncQueue].map(entry => getUserDirectories(entry));
            this.syncQueue.clear();

            await this.verify(directories);
        } catch (error) {
            console.error('Error while synchronizing cache entries:', error);
        }
    }

    /**
     * Gets the disk cache instance.
     * @returns {Promise<import('node-persist').LocalStorage>}
     */
    async instance() {
        if (this.#instance) {
            return this.#instance;
        }

        this.#instance = storage.create({
            dir: this.cachePath,
            ttl: false,
            forgiveParseErrors: true,
            expiredInterval: 0,
            // @ts-ignore
            maxFileDescriptors: 100,
        });
        await this.#instance.init();
        this.#syncInterval = setInterval(this.#syncCacheEntries.bind(this), DiskCache.SYNC_INTERVAL);
        return this.#instance;
    }

    /**
     * Verifies disk cache size and prunes it if necessary.
     * @param {import('../users.js').UserDirectoryList[]} directoriesList List of user directories
     * @returns {Promise<void>}
     */
    async verify(directoriesList) {
        try {
            if (!useDiskCache) {
                return;
            }

            const cache = await this.instance();
            const validKeys = new Set();
            for (const dir of directoriesList) {
                const files = fs.readdirSync(dir.characters, { withFileTypes: true });
                for (const file of files.filter(f => f.isFile() && path.extname(f.name) === '.png')) {
                    const filePath = path.join(dir.characters, file.name);
                    const cacheKey = getCacheKey(filePath);
                    validKeys.add(path.parse(cache.getDatumPath(cacheKey)).base);
                }
            }
            for (const key of this.hashedKeys) {
                if (!validKeys.has(key)) {
                    await fsPromises.rm(resolvePathUnderParent(this.cachePath, key, 'disk cache entry'), { force: true });
                }
            }
        } catch (error) {
            console.error('Error while verifying disk cache:', error);
        }
    }

    dispose() {
        if (this.#syncInterval) {
            clearInterval(this.#syncInterval);
        }
    }
}

export const diskCache = new DiskCache();

/**
 * Gets the cache key for the specified image file.
 * @param {string} inputFile - Path to the image file
 * @returns {string} - Cache key
 */
function getCacheKey(inputFile) {
    if (fs.existsSync(inputFile)) {
        const stat = fs.statSync(inputFile);
        return `${inputFile}-${stat.mtimeMs}`;
    }

    return inputFile;
}

/**
 * Reads the character card from the specified image file.
 * @param {string} inputFile - Path to the image file
 * @param {string} inputFormat - 'png'
 * @returns {Promise<string | undefined>} - Character card data
 */
async function readCharacterData(inputFile, inputFormat = 'png') {
    const cacheKey = getCacheKey(inputFile);
    if (memoryCache.has(cacheKey)) {
        return memoryCache.get(cacheKey);
    }
    if (useDiskCache) {
        try {
            const cache = await diskCache.instance();
            const cachedData = await cache.getItem(cacheKey);
            if (cachedData) {
                return cachedData;
            }
        } catch (error) {
            console.warn('Error while reading from disk cache:', error);
        }
    }

    const result = await parse(inputFile, inputFormat);
    !isAndroid && memoryCache.set(cacheKey, result);
    if (useDiskCache) {
        try {
            const cache = await diskCache.instance();
            await cache.setItem(cacheKey, result);
        } catch (error) {
            console.warn('Error while writing to disk cache:', error);
        }
    }
    return result;
}

/**
 * Writes the character card to the specified image file.
 * @param {string|Buffer} inputFile - Path to the image file or image buffer
 * @param {string} data - Character card data
 * @param {string} outputFile - Target image file name
 * @param {import('express').Request} request - Express request obejct
 * @param {Crop|undefined} crop - Crop parameters
 * @returns {Promise<boolean>} - True if the operation was successful
 */
async function writeCharacterData(inputFile, data, outputFile, request, crop = undefined) {
    try {
        // Reset the cache
        for (const key of memoryCache.keys()) {
            if (Buffer.isBuffer(inputFile)) {
                break;
            }
            if (key.startsWith(inputFile)) {
                memoryCache.delete(key);
                break;
            }
        }
        if (useDiskCache && !Buffer.isBuffer(inputFile)) {
            diskCache.syncQueue.add(request.user.profile.handle);
        }
        /**
         * Read the image, resize, and save it as a PNG into the buffer.
         * @returns {Promise<Buffer>} Image buffer
         */
        async function getInputImage() {
            try {
                if (Buffer.isBuffer(inputFile)) {
                    return await parseImageBuffer(inputFile, crop);
                }

                return await tryReadImage(inputFile, crop);
            } catch (error) {
                const message = Buffer.isBuffer(inputFile) ? 'Failed to read image buffer.' : `Failed to read image: ${inputFile}.`;
                console.warn(message, 'Using a fallback image.', error);
                return await fs.promises.readFile(DEFAULT_AVATAR_PATH);
            }
        }

        const inputImage = await getInputImage();

        // Get the chunks
        const outputImage = write(inputImage, normalizeCharacterJsonForPersistence(data));
        const outputImagePath = resolveCharacterOutputPath(request.user.directories, outputFile);

        writeFileAtomicSync(outputImagePath, outputImage);
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

/**
 * @typedef {Object} Crop
 * @property {number} x X-coordinate
 * @property {number} y Y-coordinate
 * @property {number} width Width
 * @property {number} height Height
 * @property {boolean} want_resize Resize the image to the standard avatar size
 */

/**
 * Applies avatar crop and resize operations to an image.
 * I couldn't fix the type issue, so the first argument has {any} type.
 * @param {object} jimp Jimp image instance
 * @param {Crop|undefined} [crop] Crop parameters
 * @returns {Promise<Buffer>} Processed image buffer
 */
export async function applyAvatarCropResize(jimp, crop) {
    if (!(jimp instanceof Jimp)) {
        throw new TypeError('Expected a Jimp instance');
    }

    const image = /** @type {InstanceType<typeof Jimp>} */ (jimp);
    let finalWidth = image.bitmap.width, finalHeight = image.bitmap.height;

    // Apply crop if defined
    if (typeof crop == 'object' && [crop.x, crop.y, crop.width, crop.height].every(x => typeof x === 'number')) {
        image.crop({ x: crop.x, y: crop.y, w: crop.width, h: crop.height });
        // Apply standard resize if requested
        if (crop.want_resize) {
            finalWidth = AVATAR_WIDTH;
            finalHeight = AVATAR_HEIGHT;
        } else {
            finalWidth = crop.width;
            finalHeight = crop.height;
        }
    }

    image.cover({ w: finalWidth, h: finalHeight });
    return await image.getBuffer(JimpMime.png);
}

/**
 * Parses an image buffer and applies crop if defined.
 * @param {Buffer} buffer Buffer of the image
 * @param {Crop|undefined} [crop] Crop parameters
 * @returns {Promise<Buffer>} Image buffer
 */
async function parseImageBuffer(buffer, crop) {
    const image = await Jimp.fromBuffer(buffer);
    return await applyAvatarCropResize(image, crop);
}

/**
 * Reads an image file and applies crop if defined.
 * @param {string} imgPath Path to the image file
 * @param {Crop|undefined} crop Crop parameters
 * @returns {Promise<Buffer>} Image buffer
 */
async function tryReadImage(imgPath, crop) {
    try {
        const rawImg = await Jimp.read(imgPath);
        return await applyAvatarCropResize(rawImg, crop);
    }
    // If it's an unsupported type of image (APNG) - just read the file as buffer
    catch (error) {
        console.error(`Failed to read image: ${imgPath}`, error);
        return fs.readFileSync(imgPath);
    }
}

/**
 * calculateChatSize - Calculates the total chat size for a given character.
 *
 * @param  {string} charDir The directory where the chats are stored.
 * @return {{ chatSize: number, dateLastChat: number, latestChat: string }} The total chat size and latest chat id.
 */
const calculateChatSize = (charDir) => {
    let chatSize = 0;
    let dateLastChat = 0;
    let latestChat = '';
    let latestChatMtime = 0;

    if (fs.existsSync(charDir)) {
        const chats = fs.readdirSync(charDir);
        if (Array.isArray(chats) && chats.length) {
            for (const chat of chats) {
                const chatStat = fs.statSync(path.join(charDir, chat));
                chatSize += chatStat.size;
                dateLastChat = Math.max(dateLastChat, chatStat.mtimeMs);

                const extension = path.extname(chat).toLowerCase();
                if (CHAT_STORAGE_EXTENSIONS.has(extension) && !chat.toLowerCase().endsWith('.head.jsonl') && chatStat.mtimeMs >= latestChatMtime) {
                    latestChatMtime = chatStat.mtimeMs;
                    latestChat = path.parse(chat).name;
                }
            }
        }
    }

    return { chatSize, dateLastChat, latestChat };
};

/**
 * Checks whether a character chat has either current SQLite or legacy JSONL storage.
 */
function hasCharacterChatStorageFile(chatsDirectory, chatName) {
    const normalizedChatName = String(chatName || '').trim();
    if (!normalizedChatName) {
        return false;
    }

    const extension = path.extname(normalizedChatName).toLowerCase();
    const candidateFileNames = CHAT_STORAGE_EXTENSIONS.has(extension)
        ? [normalizedChatName]
        : ['.sqlite', '.jsonl'].map(storageExtension => `${normalizedChatName}${storageExtension}`);

    return candidateFileNames.some(fileName => fs.existsSync(path.join(chatsDirectory, sanitize(fileName))));
}

// Calculate the total string length of the data object
const calculateDataSize = (data) => {
    return typeof data === 'object' ? Object.values(data).reduce((acc, val) => acc + String(val).length, 0) : 0;
};

/**
 * Only get fields that are used to display the character list.
 * @param {object} character Character object
 * @returns {{shallow: true, [key: string]: any}} Shallow character
 */
const toShallow = (character) => {
    return {
        shallow: true,
        name: character.name,
        avatar: character.avatar,
        chat: character.chat,
        fav: character.fav,
        date_added: character.date_added,
        create_date: character.create_date,
        date_last_chat: character.date_last_chat,
        chat_size: character.chat_size,
        data_size: character.data_size,
        tags: character.tags,
        ownerHandle: character.ownerHandle || '',
        ownerHandles: Array.isArray(character.ownerHandles) ? character.ownerHandles : [],
        sharingMode: character.sharingMode || 'single',
        sharedCharacterKey: character.sharedCharacterKey || '',
        checkedOutBy: character.checkedOutBy || null,
        checkedOutAt: character.checkedOutAt || null,
        checkoutState: character.checkoutState || 'available',
        canCheckOut: Boolean(character.canCheckOut),
        canCheckIn: Boolean(character.canCheckIn),
        canForceCheckout: Boolean(character.canForceCheckout),
        canManageOwners: Boolean(character.canManageOwners),
        data: {
            name: _.get(character, 'data.name', ''),
            character_version: _.get(character, 'data.character_version', ''),
            creator: _.get(character, 'data.creator', ''),
            creator_notes: _.get(character, 'data.creator_notes', ''),
            tags: _.get(character, 'data.tags', []),
            extensions: {
                fav: _.get(character, 'data.extensions.fav', false),
                aikobots: {
                    owner_handle: _.get(character, 'data.extensions.aikobots.owner_handle', ''),
                    owner_handles: _.get(character, 'data.extensions.aikobots.owner_handles', []),
                    sharing_mode: _.get(character, 'data.extensions.aikobots.sharing_mode', 'single'),
                    shared_character_key: _.get(character, 'data.extensions.aikobots.shared_character_key', ''),
                },
            },
        },
    };
};

function applyCharacterManagementMetadata(character, metadata) {
    character.ownerHandle = metadata.ownerHandle;
    character.ownerHandles = metadata.ownerHandles;
    character.sharingMode = metadata.sharingMode;
    character.sharedCharacterKey = metadata.sharedCharacterKey;
    character.checkedOutBy = metadata.checkedOutBy;
    character.checkedOutAt = metadata.checkedOutAt;
    character.checkoutState = metadata.checkoutState;
    character.canCheckOut = metadata.canCheckOut;
    character.canCheckIn = metadata.canCheckIn;
    character.canForceCheckout = metadata.canForceCheckout;
    character.canManageOwners = metadata.canManageOwners;

    _.set(character, 'data.extensions.aikobots.owner_handle', metadata.ownerHandle);
    _.set(character, 'data.extensions.aikobots.owner_handles', metadata.ownerHandles);
    _.set(character, 'data.extensions.aikobots.sharing_mode', metadata.sharingMode);
    _.set(character, 'data.extensions.aikobots.shared_character_key', metadata.sharedCharacterKey);
}

/**
 * processCharacter - Process a given character, read its data and calculate its statistics.
 *
 * @param  {string} item The name of the character.
 * @param  {import('../users.js').UserDirectoryList} directories User directories
 * @param  {object} options Options for the character processing
 * @param  {boolean} options.shallow If true, only return the core character's metadata
 * @return {Promise<object>}     A Promise that resolves when the character processing is done.
 */
const processCharacter = async (item, directories, { shallow, user = null, sharedIndex = null, favoritesState = null }) => {
    try {
        const imgFile = path.join(directories.characters, item);
        const imgData = await readCharacterData(imgFile);
        if (imgData === undefined) throw new Error('Failed to read character file');

        let jsonObject = getCharaCardV2(JSON.parse(imgData), directories, false);
        jsonObject.avatar = item;
        const character = jsonObject;
        character['json_data'] = imgData;
        const charStat = fs.statSync(path.join(directories.characters, item));
        character['date_added'] = charStat.ctimeMs;
        character['create_date'] = jsonObject['create_date'] || humanizedISO8601DateTime(charStat.ctimeMs);
        const chatsDirectory = path.join(directories.chats, item.replace('.png', ''));

        const { chatSize, dateLastChat, latestChat } = calculateChatSize(chatsDirectory);
        character['chat_size'] = chatSize;
        character['date_last_chat'] = dateLastChat;
        const activeChat = typeof character.chat === 'string' ? character.chat.trim() : '';
        character['chat'] = activeChat && hasCharacterChatStorageFile(chatsDirectory, activeChat)
            ? activeChat
            : (latestChat || activeChat || `${character.name} - ${humanizedISO8601DateTime()}`);
        character['data_size'] = calculateDataSize(jsonObject?.data);
        applyCharacterManagementMetadata(character, await getCharacterMetadata({
            characterCard: character,
            filenameStem: path.parse(item).name,
            user,
            sharedIndex,
        }));
        const favorite = getCharacterFavorite(favoritesState || directories, {
            avatar: item,
            sharedCharacterKey: String(character.sharedCharacterKey || _.get(character, 'data.extensions.aikobots.shared_character_key', '') || '').trim(),
            legacyFavorite: getLegacyCharacterFavoriteState(character),
        });
        _.set(character, 'fav', favorite);
        _.set(character, 'data.extensions.fav', favorite);
        return shallow ? toShallow(character) : character;
    }
    catch (err) {
        console.error(`Could not process character: ${item}`);

        if (err instanceof SyntaxError) {
            console.error(`${item} does not contain a valid JSON object.`);
        } else {
            console.error('An unexpected error occurred: ', err);
        }

        return {
            date_added: 0,
            date_last_chat: 0,
            chat_size: 0,
        };
    }
};

/**
 * Builds the minimal admin-facing source list entry for a character.
 * @param {string} item Character filename
 * @param {import('../users.js').UserDirectoryList} directories Source user directories
 * @param {object} options Options
 * @param {import('../users.js').User} options.user Acting user
 * @param {string} options.sourceOwnerHandle Source user handle
 * @param {object} [options.sharedIndex] Shared character index snapshot
 * @returns {Promise<object|null>}
 */
const processAdminSourceCharacter = async (item, directories, { user, sourceOwnerHandle, sharedIndex = null }) => {
    try {
        const imgFile = path.join(directories.characters, item);
        const imgData = await readCharacterData(imgFile);
        if (imgData === undefined) {
            throw new Error('Failed to read character file');
        }

        const character = getCharaCardV2(JSON.parse(imgData), directories, false);
        character.avatar = item;
        applyCharacterManagementMetadata(character, await getCharacterMetadata({
            characterCard: character,
            filenameStem: path.parse(item).name,
            user,
            sharedIndex,
        }));

        let distributionDefaults = null;
        try {
            distributionDefaults = await getExistingApprovedDistributionViewForSource({
                sourcePath: imgFile,
                ownerHandle: character.ownerHandle || sourceOwnerHandle,
                originalFilename: item,
                includeUserBlacklist: true,
            });
        } catch (error) {
            console.warn(`Could not resolve admin source distribution defaults for ${item}`, error);
        }

        const reusableDistribution = Boolean(distributionDefaults?.publishMode && distributionDefaults?.publishedFilename)
            && (distributionDefaults.publishMode !== PUBLISH_MODES.SELECTED
                || Array.isArray(distributionDefaults.requestedTargetHandles) && distributionDefaults.requestedTargetHandles.length > 0
                || Array.isArray(distributionDefaults.whitelistHandles) && distributionDefaults.whitelistHandles.length > 0);

        return {
            name: character.name,
            avatar: item,
            ownerHandle: character.ownerHandle || '',
            ownerHandles: Array.isArray(character.ownerHandles) ? character.ownerHandles : [],
            sharedCharacterKey: character.sharedCharacterKey || '',
            distributionDefaults: {
                reusable: reusableDistribution,
                publishMode: distributionDefaults?.publishMode || null,
                publishedFilename: distributionDefaults?.publishedFilename || '',
                requestedTargetHandles: Array.isArray(distributionDefaults?.requestedTargetHandles) ? distributionDefaults.requestedTargetHandles : [],
                whitelistHandles: Array.isArray(distributionDefaults?.whitelistHandles) ? distributionDefaults.whitelistHandles : [],
                adminBlacklistHandles: Array.isArray(distributionDefaults?.adminBlacklistHandles) ? distributionDefaults.adminBlacklistHandles : [],
                userBlacklistHandles: Array.isArray(distributionDefaults?.userBlacklistHandles) ? distributionDefaults.userBlacklistHandles : [],
            },
        };
    } catch (err) {
        console.error(`Could not process admin source character: ${item}`, err);
        return null;
    }
};

/**
 * Convert a character object to Spec V2 format.
 * @param {object} jsonObject Character object
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {boolean} hoistDate Will set the chat and create_date fields to the current date if they are missing
 * @returns {object} Character object in Spec V2 format
 */
function getCharaCardV2(jsonObject, directories, hoistDate = true) {
    if (jsonObject.spec === undefined) {
        jsonObject = convertToV2(jsonObject, directories);

        if (hoistDate && !jsonObject.create_date) {
            jsonObject.create_date = humanizedISO8601DateTime();
        }
    } else {
        jsonObject = readFromV2(jsonObject);
    }
    return jsonObject;
}

/**
 * Convert a character object to Spec V2 format.
 * @param {object} char Character object
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {object} Character object in Spec V2 format
 */
function convertToV2(char, directories) {
    // Simulate incoming data from frontend form
    const result = charaFormatData({
        json_data: JSON.stringify(char),
        ch_name: char.name,
        description: char.description,
        personality: char.personality,
        scenario: char.scenario,
        first_mes: char.first_mes,
        mes_example: char.mes_example,
        creator_notes: char.creatorcomment,
        talkativeness: char.talkativeness,
        fav: char.fav,
        creator: char.creator,
        tags: char.tags,
        depth_prompt_prompt: char.depth_prompt_prompt,
        depth_prompt_depth: char.depth_prompt_depth,
        depth_prompt_role: char.depth_prompt_role,
    }, directories);

    result.chat = char.chat ?? humanizedISO8601DateTime();
    result.create_date = char.create_date;

    return result;
}

/**
 * Removes fields that are not meant to be shared.
 */
function unsetPrivateFields(char) {
    _.set(char, 'fav', false);
    _.set(char, 'data.extensions.fav', false);
    _.unset(char, 'data.extensions.aikobots.secure_lorebooks');
    _.unset(char, 'chat');
}

function readFromV2(char) {
    if (_.isUndefined(char.data)) {
        console.warn(`Char ${char['name']} has Spec v2 data missing`);
        return char;
    }

    // If 'json_data' was already saved, don't let it propagate
    _.unset(char, 'json_data');

    const fieldMappings = {
        name: 'name',
        description: 'description',
        personality: 'personality',
        scenario: 'scenario',
        first_mes: 'first_mes',
        mes_example: 'mes_example',
        talkativeness: 'extensions.talkativeness',
        fav: 'extensions.fav',
        tags: 'tags',
    };

    _.forEach(fieldMappings, (v2Path, charField) => {
        //console.info(`Migrating field: ${charField} from ${v2Path}`);
        const v2Value = _.get(char.data, v2Path);
        if (_.isUndefined(v2Value)) {
            let defaultValue = undefined;

            // Backfill default values for missing ST extension fields
            if (v2Path === 'extensions.talkativeness') {
                defaultValue = 0.5;
            }

            if (v2Path === 'extensions.fav') {
                defaultValue = false;
            }

            if (!_.isUndefined(defaultValue)) {
                //console.warn(`Spec v2 extension data missing for field: ${charField}, using default value: ${defaultValue}`);
                char[charField] = defaultValue;
            } else {
                console.warn(`Char ${char['name']} has Spec v2 data missing for unknown field: ${charField}`);
                return;
            }
        }
        if (!_.isUndefined(char[charField]) && !_.isUndefined(v2Value) && String(char[charField]) !== String(v2Value)) {
            console.warn(`Char ${char['name']} has Spec v2 data mismatch with Spec v1 for field: ${charField}`, char[charField], v2Value);
        }
        char[charField] = v2Value;
    });

    char['chat'] = char['chat'] ?? humanizedISO8601DateTime();

    return char;
}

/**
 * Format character data to Spec V2 format.
 * @param {object} data Character data
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns
 */
function charaFormatData(data, directories) {
    // This is supposed to save all the foreign keys that ST doesn't care about
    const char = tryParse(data.json_data) || {};

    // Prevent erroneous 'json_data' recursive saving
    _.unset(char, 'json_data');

    // Checks if data.alternate_greetings is an array, a string, or neither, and acts accordingly. (expected to be an array of strings)
    const getAlternateGreetings = data => {
        if (Array.isArray(data.alternate_greetings)) return data.alternate_greetings;
        if (typeof data.alternate_greetings === 'string') return [data.alternate_greetings];
        return [];
    };

    // Spec V1 fields
    _.set(char, 'name', data.ch_name);
    _.set(char, 'description', data.description || '');
    _.set(char, 'personality', data.personality || '');
    _.set(char, 'scenario', data.scenario || '');
    _.set(char, 'first_mes', data.first_mes || '');
    _.set(char, 'mes_example', data.mes_example || '');

    // Old ST extension fields (for backward compatibility, will be deprecated)
    _.set(char, 'creatorcomment', data.creator_notes || '');
    _.set(char, 'avatar', 'none');
    _.set(char, 'chat', data.ch_name + ' - ' + humanizedISO8601DateTime());
    _.set(char, 'talkativeness', data.talkativeness || 0.5);
    _.set(char, 'fav', data.fav == 'true');
    _.set(char, 'tags', typeof data.tags == 'string' ? (data.tags.split(',').map(x => x.trim()).filter(x => x)) : data.tags || []);

    // Spec V2 fields
    _.set(char, 'spec', 'chara_card_v2');
    _.set(char, 'spec_version', '2.0');
    _.set(char, 'data.name', data.ch_name);
    _.set(char, 'data.description', data.description || '');
    _.set(char, 'data.personality', data.personality || '');
    _.set(char, 'data.scenario', data.scenario || '');
    _.set(char, 'data.first_mes', data.first_mes || '');
    _.set(char, 'data.mes_example', data.mes_example || '');

    // New V2 fields
    _.set(char, 'data.creator_notes', data.creator_notes || '');
    _.set(char, 'data.system_prompt', data.system_prompt || '');
    _.set(char, 'data.post_history_instructions', data.post_history_instructions || '');
    _.set(char, 'data.tags', typeof data.tags == 'string' ? (data.tags.split(',').map(x => x.trim()).filter(x => x)) : data.tags || []);
    _.set(char, 'data.creator', data.creator || '');
    _.set(char, 'data.character_version', data.character_version || '');
    _.set(char, 'data.alternate_greetings', getAlternateGreetings(data));

    // ST extension fields to V2 object
    _.set(char, 'data.extensions.talkativeness', data.talkativeness || 0.5);
    _.set(char, 'data.extensions.fav', data.fav == 'true');
    _.set(char, 'data.extensions.world', data.world || '');

    // Spec extension: depth prompt
    const depth_default = 4;
    const role_default = 'system';
    const depth_value = !isNaN(Number(data.depth_prompt_depth)) ? Number(data.depth_prompt_depth) : depth_default;
    const role_value = data.depth_prompt_role ?? role_default;
    _.set(char, 'data.extensions.depth_prompt.prompt', data.depth_prompt_prompt ?? '');
    _.set(char, 'data.extensions.depth_prompt.depth', depth_value);
    _.set(char, 'data.extensions.depth_prompt.role', role_value);
    //_.set(char, 'data.extensions.create_date', humanizedISO8601DateTime());
    //_.set(char, 'data.extensions.avatar', 'none');
    //_.set(char, 'data.extensions.chat', data.ch_name + ' - ' + humanizedISO8601DateTime());

    // V3 fields
    _.set(char, 'data.group_only_greetings', data.group_only_greetings ?? []);

    if (data.world) {
        try {
            const file = readWorldInfoFile(directories, data.world, false);

            // File was imported - save it to the character book
            if (file && file.originalData) {
                _.set(char, 'data.character_book', file.originalData);
            }

            // File was not imported - convert the world info to the character book
            if (file && file.entries) {
                _.set(char, 'data.character_book', convertWorldInfoToCharacterBook(data.world, file.entries));
            }

        } catch {
            console.warn(`Failed to read world info file: ${data.world}. Character book will not be available.`);
        }
    }

    if (data.extensions) {
        try {
            const extensions = JSON.parse(data.extensions);
            // Deep merge the extensions object
            _.set(char, 'data.extensions', deepMerge(char.data.extensions, extensions));
        } catch {
            console.warn(`Failed to parse extensions JSON: ${data.extensions}`);
        }
    }

    return char;
}

/**
 * @param {string} name Name of World Info file
 * @param {object} entries Entries object
 */
function convertWorldInfoToCharacterBook(name, entries) {
    /** @type {{ entries: object[]; name: string }} */
    const result = { entries: [], name };

    for (const index in entries) {
        const entry = entries[index];

        const originalEntry = {
            id: entry.uid,
            keys: entry.key,
            secondary_keys: entry.keysecondary,
            comment: entry.comment,
            content: entry.content,
            constant: entry.constant,
            selective: entry.selective,
            insertion_order: entry.order,
            enabled: !entry.disable,
            position: entry.position == 0 ? 'before_char' : 'after_char',
            use_regex: true, // ST keys are always regex
            extensions: {
                ...entry.extensions,
                position: entry.position,
                exclude_recursion: entry.excludeRecursion,
                display_index: entry.displayIndex,
                probability: entry.probability ?? null,
                useProbability: entry.useProbability ?? false,
                depth: entry.depth ?? 4,
                selectiveLogic: entry.selectiveLogic ?? 0,
                outlet_name: entry.outletName ?? '',
                group: entry.group ?? '',
                group_override: entry.groupOverride ?? false,
                group_weight: entry.groupWeight ?? null,
                prevent_recursion: entry.preventRecursion ?? false,
                delay_until_recursion: entry.delayUntilRecursion ?? false,
                scan_depth: entry.scanDepth ?? null,
                match_whole_words: entry.matchWholeWords ?? null,
                use_group_scoring: entry.useGroupScoring ?? false,
                case_sensitive: entry.caseSensitive ?? null,
                automation_id: entry.automationId ?? '',
                role: entry.role ?? 0,
                vectorized: entry.vectorized ?? false,
                sticky: entry.sticky ?? null,
                cooldown: entry.cooldown ?? null,
                delay: entry.delay ?? null,
                match_persona_description: entry.matchPersonaDescription ?? false,
                match_character_description: entry.matchCharacterDescription ?? false,
                match_character_personality: entry.matchCharacterPersonality ?? false,
                match_character_depth_prompt: entry.matchCharacterDepthPrompt ?? false,
                match_scenario: entry.matchScenario ?? false,
                match_creator_notes: entry.matchCreatorNotes ?? false,
                triggers: entry.triggers ?? [],
                ignore_budget: entry.ignoreBudget ?? false,
                activation_only: entry.activationOnly ?? false,
            },
        };

        result.entries.push(originalEntry);
    }

    return result;
}

/**
 * Checks whether the current requester can edit protected lorebook metadata for a character.
 * @param {object|null|undefined} characterCard Character card data
 * @param {import('express').Request} request Express request object
 * @returns {boolean}
 */
function canEditCharacterLorebooks(characterCard, request) {
    const ownerHandles = getCharacterOwnerHandles(characterCard);
    return ownerHandles.length === 0 || Boolean(request.user?.profile?.admin) || ownerHandles.includes(request.user?.profile?.handle);
}

/**
 * Checks whether the current requester can edit character card metadata.
 * Pushed/owned characters are creator/admin-managed; non-owners can still
 * update local avatar art and favorite state through dedicated endpoints.
 * @param {object|null|undefined} characterCard Character card data
 * @param {import('express').Request} request Express request object
 * @returns {boolean}
 */
function canEditCharacterMetadata(characterCard, request) {
    const ownerHandles = getCharacterOwnerHandles(characterCard);
    return ownerHandles.length === 0 || Boolean(request.user?.profile?.admin) || ownerHandles.includes(request.user?.profile?.handle);
}

/**
 * Checks whether the current requester is one of the character owners.
 * @param {object|null|undefined} characterCard Character card data
 * @param {import('express').Request} request Express request object
 * @returns {boolean}
 */
function canManageCharacterOwnership(characterCard, request) {
    const ownerHandles = getCharacterOwnerHandles(characterCard);
    return ownerHandles.length === 0 || Boolean(request.user?.profile?.admin) || ownerHandles.includes(request.user?.profile?.handle);
}

function getCharacterCardTextField(characterCard, dataField, legacyField = dataField) {
    return String(_.get(characterCard, `data.${dataField}`, characterCard?.[legacyField] || '') || '');
}

function getCharacterDryRunSavedFields(characterCard) {
    return {
        name: getCharacterCardTextField(characterCard, 'name', 'name'),
        description: getCharacterCardTextField(characterCard, 'description', 'description'),
        personality: getCharacterCardTextField(characterCard, 'personality', 'personality'),
        scenario: getCharacterCardTextField(characterCard, 'scenario', 'scenario'),
        mesExamples: getCharacterCardTextField(characterCard, 'mes_example', 'mes_example'),
        charDepthPrompt: String(_.get(characterCard, 'data.extensions.depth_prompt.prompt', '') || ''),
        creatorNotes: getCharacterCardTextField(characterCard, 'creator_notes', 'creatorcomment'),
        systemPrompt: getCharacterCardTextField(characterCard, 'system_prompt', ''),
        jailbreakPrompt: getCharacterCardTextField(characterCard, 'post_history_instructions', ''),
    };
}

function sanitizeDryRunPromptContext(rawPromptContext, characterCard, avatarUrl) {
    if (!rawPromptContext || typeof rawPromptContext !== 'object' || Array.isArray(rawPromptContext)) {
        const error = new Error('prompt_context is required.');
        error.status = 400;
        throw error;
    }

    const promptContext = structuredClone(rawPromptContext);
    const savedFields = getCharacterDryRunSavedFields(characterCard);
    const avatar = String(avatarUrl || '');
    const filename = path.parse(avatar).name;
    const existingWorldInfoRequest = promptContext.worldInfoRequest && typeof promptContext.worldInfoRequest === 'object'
        ? promptContext.worldInfoRequest
        : {};
    const existingGlobalScanData = existingWorldInfoRequest.globalScanData && typeof existingWorldInfoRequest.globalScanData === 'object'
        ? existingWorldInfoRequest.globalScanData
        : {};

    promptContext.model = TOKEN_DRY_RUN_ASSEMBLY_MODEL;
    promptContext.charName = savedFields.name;
    promptContext.name2 = savedFields.name;
    promptContext.charDescription = savedFields.description;
    promptContext.charPersonality = savedFields.personality;
    promptContext.scenario = savedFields.scenario;
    promptContext.mesExamples = savedFields.mesExamples;
    promptContext.charDepthPrompt = savedFields.charDepthPrompt;
    promptContext.creatorNotes = savedFields.creatorNotes;
    promptContext.systemPromptOverride = promptContext.systemPromptOverride ? savedFields.systemPrompt : '';
    promptContext.jailbreakPromptOverride = promptContext.jailbreakPromptOverride ? savedFields.jailbreakPrompt : '';
    promptContext.persona = '';
    promptContext.coreChat = [];
    promptContext.messages = [];
    promptContext.groupId = null;
    promptContext.groupName = '';
    promptContext.groupMembers = [];
    promptContext.selectedGroup = false;
    const existingActiveCharacter = promptContext.activeCharacter && typeof promptContext.activeCharacter === 'object'
        ? promptContext.activeCharacter
        : {};
    promptContext.activeCharacter = {
        ...existingActiveCharacter,
        id: existingActiveCharacter.id || filename,
    };
    promptContext.powerUser = {
        ...(promptContext.powerUser && typeof promptContext.powerUser === 'object' ? promptContext.powerUser : {}),
        persona_description: '',
    };

    promptContext.worldInfoRequest = {
        ...existingWorldInfoRequest,
        chat: [],
        isDryRun: true,
        selectedGroup: false,
        personaWorld: '',
        characterWorld: String(_.get(characterCard, 'data.extensions.world', '') || ''),
        currentCharacterFilename: filename,
        activeSpeaker: {
            name: savedFields.name,
            avatar,
            filename,
        },
        timedWorldInfo: {},
        globalScanData: {
            ...existingGlobalScanData,
            personaDescription: '',
            characterDescription: savedFields.description,
            characterPersonality: savedFields.personality,
            characterDepthPrompt: savedFields.charDepthPrompt,
            scenario: savedFields.scenario,
            creatorNotes: savedFields.creatorNotes,
            trigger: 'normal',
        },
        tokenizerModel: TOKEN_DRY_RUN_TOKENIZER,
    };

    return promptContext;
}

function buildTokenDryRunMetadata(tokenCount) {
    return {
        token_count: Number(tokenCount) || 0,
        calculated_at: new Date().toISOString(),
        tokenizer: TOKEN_DRY_RUN_TOKENIZER,
        tokenizer_mode: TOKEN_DRY_RUN_TOKENIZER_MODE,
        mode: TOKEN_DRY_RUN_MODE,
        version: TOKEN_DRY_RUN_VERSION,
    };
}

function normalizeTokenDryRunMetadata(metadata) {
    return {
        token_count: Number(metadata.token_count) || 0,
        calculated_at: String(metadata.calculated_at || ''),
        tokenizer: TOKEN_DRY_RUN_TOKENIZER,
        tokenizer_mode: TOKEN_DRY_RUN_TOKENIZER_MODE,
        mode: TOKEN_DRY_RUN_MODE,
        version: TOKEN_DRY_RUN_VERSION,
    };
}

function getSerializedDryRunMessagePayload(node) {
    if (!node || typeof node !== 'object') {
        return null;
    }

    const payload = {
        role: node.role || 'system',
        ...(node.content !== undefined ? { content: node.content } : {}),
        ...(node.name ? { name: node.name } : {}),
        ...(node.tool_calls ? { tool_calls: node.tool_calls } : {}),
        ...(node.signature ? { signature: node.signature } : {}),
    };

    return payload.content || payload.tool_calls ? payload : null;
}

function collectTokenDryRunContributions(node, parentIdentifier = '') {
    if (!node || typeof node !== 'object') {
        return [];
    }

    if (node.type === 'collection') {
        const identifier = String(node.identifier || parentIdentifier || 'collection');
        return (Array.isArray(node.collection) ? node.collection : [])
            .flatMap(child => collectTokenDryRunContributions(child, identifier));
    }

    if (node.type !== 'message') {
        return [];
    }

    const payload = getSerializedDryRunMessagePayload(node);
    if (!payload) {
        return [];
    }

    return [{
        identifier: String(node.identifier || parentIdentifier || 'message'),
        group: String(parentIdentifier || ''),
        role: String(payload.role || 'system'),
        token_count: countBotDryRunMessageTokens(payload),
    }];
}

function getWorldInfoEntryKeyFromParts(book, uid) {
    return `${String(book ?? '')}.${String(uid ?? '')}`;
}

function getWorldInfoDebugEntryMap(assembly) {
    const entries = Array.isArray(assembly?.worldInfo?.activatedEntries)
        ? assembly.worldInfo.activatedEntries
        : [];
    return new Map(entries.map(entry => [getWorldInfoEntryKeyFromParts(entry.book, entry.uid), entry]));
}

function getWorldInfoEntryDisplayName(entry = {}) {
    return String(entry.displayName ?? entry.comment ?? entry.name ?? entry.uid ?? '').trim();
}

function collectWorldInfoSegments(node, debugEntryMap, parentIdentifier = '') {
    if (!node || typeof node !== 'object') {
        return [];
    }

    if (node.type === 'collection') {
        const identifier = String(node.identifier || parentIdentifier || 'collection');
        return (Array.isArray(node.collection) ? node.collection : [])
            .flatMap(child => collectWorldInfoSegments(child, debugEntryMap, identifier));
    }

    if (node.type !== 'message') {
        return [];
    }

    return (Array.isArray(node.contentSegments) ? node.contentSegments : [])
        .filter(segment => segment?.type === 'worldInfo')
        .map(segment => {
            const debugEntry = debugEntryMap.get(getWorldInfoEntryKeyFromParts(segment.book, segment.uid)) || {};
            return {
                messageIdentifier: String(node.identifier || 'message'),
                group: String(parentIdentifier || ''),
                role: String(node.role || 'system'),
                book: String(segment.book ?? debugEntry.book ?? ''),
                uid: segment.uid ?? debugEntry.uid ?? null,
                storage: String(segment.storage || debugEntry.storage || 'user'),
                name: getWorldInfoEntryDisplayName(debugEntry),
                placement: String(segment.placement ?? debugEntry.placement ?? ''),
                status: String(segment.status ?? debugEntry.status ?? ''),
                activationReason: String(debugEntry.activationReason || ''),
                activationSource: String(debugEntry.activationSource || ''),
                roundIndex: Number(segment.roundIndex ?? debugEntry.roundIndex ?? 0) || 0,
                contentTokens: countBotDryRunTextTokens(segment.text),
            };
        });
}

function logTokenDryRunLine(lines, line) {
    const text = String(line ?? '');
    console.info(text);
    lines.push(text);
}

function logTokenDryRunWorldInfoEntries(assembly, lines) {
    const debugEntryMap = getWorldInfoDebugEntryMap(assembly);
    const entries = collectWorldInfoSegments(assembly?.messagesState, debugEntryMap);

    if (!entries.length) {
        logTokenDryRunLine(lines, '[Token dry run] World-info entries: none inserted');
        return;
    }

    logTokenDryRunLine(lines, '[Token dry run] World-info entries inserted:');
    for (const entry of entries) {
        const name = entry.name ? ` | name=${entry.name}` : '';
        const activation = [entry.activationSource, entry.activationReason].filter(Boolean).join(':');
        const activationText = activation ? ` | activation=${activation}` : '';
        const group = entry.group ? ` | group=${entry.group}` : '';
        logTokenDryRunLine(lines, `[Token dry run]   ${String(entry.contentTokens).padStart(6)} text tokens | ${entry.storage} | book=${entry.book} | uid=${entry.uid}${name} | placement=${entry.placement} | message=${entry.messageIdentifier}${group} | role=${entry.role} | round=${entry.roundIndex}${activationText}`);
    }
}

function logTokenDryRunContributions(characterCard, avatarUrl, metadata, assembly) {
    const lines = [];
    const contributions = collectTokenDryRunContributions(assembly?.messagesState);
    const characterName = getCharacterCardTextField(characterCard, 'name', 'name') || path.parse(String(avatarUrl || '')).name;

    logTokenDryRunLine(lines, `[Token dry run] ${characterName} (${avatarUrl})`);
    logTokenDryRunLine(lines, `[Token dry run] Total: ${metadata.token_count} tokens | tokenizer=${metadata.tokenizer} | mode=${metadata.mode}`);

    if (!contributions.length) {
        logTokenDryRunLine(lines, '[Token dry run] No assembled prompt entries contributed to the count.');
        return lines;
    }

    logTokenDryRunLine(lines, '[Token dry run] Contributions:');
    for (const entry of contributions) {
        const group = entry.group ? ` | group=${entry.group}` : '';
        logTokenDryRunLine(lines, `[Token dry run]   ${String(entry.token_count).padStart(6)} tokens | role=${entry.role} | entry=${entry.identifier}${group}`);
    }
    logTokenDryRunLine(lines, '[Token dry run]        3 tokens | chat-completion priming overhead');
    logTokenDryRunWorldInfoEntries(assembly, lines);
    return lines;
}

/**
 * Removes shared-character identity metadata from a copied card.
 * @param {object|null|undefined} characterCard Character card to mutate
 */
function clearCharacterSharingIdentityMetadata(characterCard) {
    if (!characterCard) {
        return;
    }

    _.unset(characterCard, 'data.extensions.aikobots.owner_handle');
    _.unset(characterCard, 'data.extensions.aikobots.owner_handles');
    _.unset(characterCard, 'data.extensions.aikobots.sharing_mode');
    _.unset(characterCard, 'data.extensions.aikobots.shared_character_key');

    _.unset(characterCard, 'ownerHandle');
    _.unset(characterCard, 'ownerHandles');
    _.unset(characterCard, 'sharingMode');
    _.unset(characterCard, 'sharedCharacterKey');
    _.unset(characterCard, 'checkedOutBy');
    _.unset(characterCard, 'checkedOutAt');
    _.unset(characterCard, 'checkoutState');
    _.unset(characterCard, 'canCheckOut');
    _.unset(characterCard, 'canCheckIn');
    _.unset(characterCard, 'canForceCheckout');
    _.unset(characterCard, 'canManageOwners');
}

/**
 * Copies protected lorebook fields from one character card to another.
 * @param {object} targetCharacter Character card to mutate
 * @param {object} sourceCharacter Character card to copy from
 */
function preserveProtectedLorebookFields(targetCharacter, sourceCharacter) {
    _.set(targetCharacter, 'data.extensions.world', String(_.get(sourceCharacter, 'data.extensions.world', '') || ''));

    if (_.has(sourceCharacter, 'data.character_book')) {
        _.set(targetCharacter, 'data.character_book', _.cloneDeep(_.get(sourceCharacter, 'data.character_book')));
    } else {
        _.unset(targetCharacter, 'data.character_book');
    }

    if (_.has(sourceCharacter, 'data.extensions.aikobots.secure_lorebooks')) {
        _.set(targetCharacter, 'data.extensions.aikobots.secure_lorebooks', _.cloneDeep(_.get(sourceCharacter, 'data.extensions.aikobots.secure_lorebooks')));
    } else {
        _.unset(targetCharacter, 'data.extensions.aikobots.secure_lorebooks');
    }
}

/**
 * Preserves dry-run token metadata across normal character saves.
 * This field is owned by the token dry-run route and must not be changed by
 * form saves or generic attribute merges.
 * @param {object} targetCharacter Character card to mutate
 * @param {object|null|undefined} sourceCharacter Existing saved character card
 */
function preserveTokenDryRunMetadata(targetCharacter, sourceCharacter) {
    if (_.has(sourceCharacter, 'data.extensions.aikobots.token_dry_run')) {
        _.set(targetCharacter, 'data.extensions.aikobots.token_dry_run', _.cloneDeep(_.get(sourceCharacter, 'data.extensions.aikobots.token_dry_run')));
    } else {
        _.unset(targetCharacter, 'data.extensions.aikobots.token_dry_run');
    }
}

const relaxedCharacterMetadataPaths = new Set([
    'avatar',
    'chat',
    'fav',
    'tags',
    'talkativeness',
    'data.avatar',
    'data.fav',
    'data.tags',
    'data.talkativeness',
    'data.extensions.fav',
    'data.extensions.talkativeness',
]);

function getLeafPaths(value, pathParts = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [pathParts.join('.')];
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
        return [pathParts.join('.')];
    }

    return entries.flatMap(([key, child]) => getLeafPaths(child, [...pathParts, key]));
}

function isRelaxedCharacterMetadataUpdate(update) {
    return getLeafPaths(update).every(path => relaxedCharacterMetadataPaths.has(path));
}

function withoutRelaxedCharacterMetadata(character) {
    const comparable = _.cloneDeep(character);
    for (const path of relaxedCharacterMetadataPaths) {
        _.unset(comparable, path);
    }
    return comparable;
}

function isRelaxedCharacterMetadataChange(existingCharacter, requestedCharacter) {
    return _.isEqual(
        withoutRelaxedCharacterMetadata(existingCharacter),
        withoutRelaxedCharacterMetadata(requestedCharacter),
    );
}

/**
 * Removes an embedded lorebook when the edit request explicitly clears the
 * embedded-lorebook selector and the submitted JSON no longer carries the
 * embedded book payload.
 * This avoids stripping imported external card embeds on unrelated saves.
 * @param {object} characterCard Character card to mutate
 * @param {object|null} requestedJsonCard Parsed json_data payload from the edit form
 * @param {string} requestedWorld Embedded lorebook selector value from the edit form
 */
function sanitizeEmbeddedLorebookForPrimaryWorld(characterCard, requestedJsonCard, requestedWorld) {
    const normalizedRequestedWorld = String(requestedWorld || '').trim();
    const requestRemovedEmbeddedLorebook = normalizedRequestedWorld === ''
        && requestedJsonCard
        && !_.has(requestedJsonCard, 'data.character_book');

    if (requestRemovedEmbeddedLorebook) {
        _.unset(characterCard, 'data.character_book');
    }
}

function sendSharedCharacterError(response, error) {
    if (error instanceof CharacterSharingRepositoryError) {
        return response.status(error.status || 400).json({
            error: {
                type: error.type,
                message: error.message,
                details: error.details ?? null,
            },
        });
    }

    console.error('[Characters] Shared character operation failed', error);
    return response.status(500).json({
        error: {
            type: 'CharacterInternalError',
            message: String(error?.message || error),
            details: null,
        },
    });
}

async function assertSharedCharacterCheckoutForMutation(request, avatarName) {
    const characterName = path.parse(String(avatarName || '')).name;
    if (!characterName) {
        return;
    }

    const sharedRecord = await getSharedCharacterRecord(characterName);
    if (!sharedRecord || sharedRecord.sharingMode !== 'shared') {
        return;
    }

    if (Boolean(request.user?.profile?.admin)) {
        return;
    }

    const currentHandle = String(request.user?.profile?.handle || '').trim();
    const checkedOutBy = String(sharedRecord.checkedOutBy || '').trim();
    if (!checkedOutBy) {
        throw new CharacterSharingRepositoryError('CharacterCheckedOut', `Character "${sharedRecord.name}" must be checked out before editing.`, 423);
    }

    if (checkedOutBy !== currentHandle) {
        throw new CharacterSharingRepositoryError('CharacterCheckedOut', `Character "${sharedRecord.name}" is checked out by ${checkedOutBy}.`, 423);
    }
}

async function validateSharedCharacterOwnerHandles(ownerHandles = [], actingHandle = '') {
    const normalizedActingHandle = String(actingHandle || '').trim();
    const normalizedOwnerHandles = [...new Set([
        ...(Array.isArray(ownerHandles) ? ownerHandles : []),
        normalizedActingHandle,
    ]
        .map(handle => String(handle || '').trim())
        .filter(Boolean))];

    if (normalizedOwnerHandles.length < 2) {
        throw new CharacterSharingRepositoryError('CharacterOwnersInvalid', 'Shared characters must have at least two owners.', 400);
    }

    const enabledUsers = await getAllEnabledUsers();
    const enabledHandles = new Set(enabledUsers.map(user => String(user.handle || '').trim()).filter(Boolean));
    const invalidOwnerHandles = normalizedOwnerHandles.filter(handle => !enabledHandles.has(handle));
    if (invalidOwnerHandles.length > 0) {
        throw new CharacterSharingRepositoryError('CharacterOwnersInvalid', `Invalid owner handles: ${invalidOwnerHandles.join(', ')}.`, 400);
    }

    return normalizedOwnerHandles;
}

/**
 * Import a character from a YAML file.
 * @param {string} uploadPath Path to the uploaded file
 * @param {{ request: import('express').Request, response: import('express').Response }} context Express request and response objects
 * @param {string|undefined} preservedFileName Preserved file name
 * @returns {Promise<string>} Internal name of the character
 */
async function importFromYaml(uploadPath, context, preservedFileName) {
    const fileText = fs.readFileSync(uploadPath, 'utf8');
    fs.unlinkSync(uploadPath);
    const yamlData = yaml.parse(fileText);
    console.info('Importing from YAML');
    yamlData.name = sanitize(yamlData.name);
    const fileName = preservedFileName || getPngName(yamlData.name, context.request.user.directories);
    let char = convertToV2({
        'name': yamlData.name,
        'description': yamlData.context ?? '',
        'first_mes': yamlData.greeting ?? '',
        'create_date': humanizedISO8601DateTime(),
        'chat': `${yamlData.name} - ${humanizedISO8601DateTime()}`,
        'personality': '',
        'creatorcomment': '',
        'avatar': 'none',
        'mes_example': '',
        'scenario': '',
        'talkativeness': 0.5,
        'creator': '',
        'tags': '',
    }, context.request.user.directories);
    const result = await writeCharacterData(DEFAULT_AVATAR_PATH, JSON.stringify(char), fileName, context.request);
    return result ? fileName : '';
}

/**
 * Imports a character card from CharX (ZIP) file.
 * @param {string} uploadPath
 * @param {object} params
 * @param {import('express').Request} params.request
 * @param {string|undefined} preservedFileName Preserved file name
 * @returns {Promise<string>} Internal name of the character
 */
async function importFromCharX(uploadPath, { request }, preservedFileName) {
    const data = fs.readFileSync(uploadPath).buffer;
    fs.unlinkSync(uploadPath);
    console.info('Importing from CharX');
    const cardBuffer = await extractFileFromZipBuffer(data, 'card.json');

    if (!cardBuffer) {
        throw new Error('Failed to extract card.json from CharX file');
    }

    const card = readFromV2(JSON.parse(cardBuffer.toString()));

    if (card.spec === undefined) {
        throw new Error('Invalid CharX card file: missing spec field');
    }

    /** @type {string|Buffer} */
    let avatar = DEFAULT_AVATAR_PATH;
    const assets = _.get(card, 'data.assets');
    if (Array.isArray(assets) && assets.length) {
        for (const asset of assets.filter(x => x.type === 'icon' && typeof x.uri === 'string')) {
            const pathNoProtocol = String(asset.uri.replace(/^(?:\/\/|[^/]+)*\//, ''));
            const buffer = await extractFileFromZipBuffer(data, pathNoProtocol);
            if (buffer) {
                avatar = buffer;
                break;
            }
        }
    }

    unsetPrivateFields(card);
    card['create_date'] = humanizedISO8601DateTime();
    card.name = sanitize(card.name);
    const fileName = preservedFileName || getPngName(card.name, request.user.directories);
    const result = await writeCharacterData(avatar, JSON.stringify(card), fileName, request);
    return result ? fileName : '';
}

async function importFromByaf(uploadPath, { request }, preservedFileName) {
    const data = (await fsPromises.readFile(uploadPath)).buffer;
    await fsPromises.unlink(uploadPath);
    console.info('Importing from BYAF');

    const byafData = await new ByafParser(data).parse();
    const card = readFromV2(byafData.card);
    const fileName = preservedFileName || getPngName(sanitize(byafData.character.displayName || card.name, { replacement: sanitizeSafeCharacterReplacements }), request.user.directories);

    // Don't import chats and images if the character is being replaced or updated, instead of newly imported.
    if (!preservedFileName) {
        /**
         * @param {Partial<ByafScenario>} scenario
        */
        const createChatAsCurrentPersona = async (scenario) => {
            const chatName = sanitize(`${scenario.title || card.name} - ${humanizedISO8601DateTime()} imported.sqlite`, { replacement: sanitizeSafeCharacterReplacements });
            const filePath = resolveCharacterChatFilePath(request.user.directories, path.basename(fileName), chatName);
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const chatRecords = ByafParser.getChatFromScenario(scenario, request.body.user_name, card.name, byafData.chatBackgrounds)
                .split('\n')
                .filter(line => line.trim());
            await migrateFromJsonlRecords(chatRecords, filePath);
            console.log(`Created ${chatName} chat from BYAF import`);
            return chatName;
        };

        // Upload backgrounds
        for (const bg of byafData.chatBackgrounds) {
            const extension = path.extname(bg.paths?.[0]) || '.png';
            const baseName = `${path.basename(fileName)}_bg`;
            const filePath = resolvePathUnderParent(request.user.directories.userImages, assertSafeFileName(fileName, 'BYAF image directory'), 'BYAF image directory');
            if (!fs.existsSync(filePath)) fs.mkdirSync(filePath, { recursive: true });
            const file = getUniqueName(baseName, (name) => fs.existsSync(resolveCharacterImagePath(filePath, `${name}${extension}`)));
            if (Buffer.isBuffer(bg.data)) {
                const newFile = `${file}${extension}`;
                const newFilePath = resolveCharacterImagePath(filePath, newFile);
                writeFileAtomicSync(newFilePath, bg.data);
                bg.name = clientRelativePath(request.user.directories.root, newFilePath); // Update background name to the new file
                console.log(`Created ${newFile} background from BYAF import`);
            }
        }

        const chats = [];
        // Create chats for each scenario
        if (Array.isArray(byafData.scenarios)) {
            for (const scenario of byafData.scenarios) {
                chats.push(await createChatAsCurrentPersona(scenario));
            }
        }

        // Update the default chat if there are any so we open to an existing chat instead of creating a new one and opening that.
        if (chats.length > 0) {
            card.chat = path.basename(chats[0], path.extname(chats[0]));
        }

        // Save alternate icons for the character.
        for (const icon of byafData.images.slice(1)) {
            // BYAF does not support character expressions, so using the same structure will not result in conflicts,
            // even if the expression system did not tolerate additional icons that are not mapped to expressions.
            // This will not yet allow changing icons within the UI but at least the icons will be available for manual selection, rather than being lost.
            const altImagesFolder = resolvePathUnderParent(request.user.directories.characters, assertSafeFileName(sanitize(card.name), 'alternate image directory'), 'alternate image directory');
            if (!fs.existsSync(altImagesFolder)) fs.mkdirSync(altImagesFolder, { recursive: true });
            const extension = path.extname(icon.filename) || '.png';
            const file = getUniqueName(`${sanitize(icon.label, { replacement: sanitizeSafeCharacterReplacements }) || 'alt'}`, (name) => fs.existsSync(resolveCharacterImagePath(altImagesFolder, `${name}${extension}`)));
            if (Buffer.isBuffer(icon.image)) {
                writeFileAtomicSync(resolveCharacterImagePath(altImagesFolder, `${file}${extension}`), icon.image);
                console.log(`Created ${file}${extension} alternate icon from BYAF import`);
            }
        }
    }

    const result = await writeCharacterData(byafData.images[0].image, JSON.stringify(card), fileName, request);

    return result ? fileName : '';
}

/**
 * Import a character from a JSON file.
 * @param {string} uploadPath Path to the uploaded file
 * @param {{ request: import('express').Request, response: import('express').Response }} context Express request and response objects
 * @param {string|undefined} preservedFileName Preserved file name
 * @returns {Promise<string>} Internal name of the character
 */
async function importFromJson(uploadPath, { request }, preservedFileName) {
    const data = fs.readFileSync(uploadPath, 'utf8');
    fs.unlinkSync(uploadPath);

    let jsonData = JSON.parse(data);

    if (jsonData.spec !== undefined) {
        console.info(`Importing from ${jsonData.spec} json`);
        importRisuSprites(request.user.directories, jsonData);
        unsetPrivateFields(jsonData);
        jsonData = readFromV2(jsonData);
        jsonData['create_date'] = humanizedISO8601DateTime();
        const pngName = preservedFileName || getPngName(jsonData.data?.name || jsonData.name, request.user.directories);
        const char = JSON.stringify(jsonData);
        const result = await writeCharacterData(DEFAULT_AVATAR_PATH, char, pngName, request);
        return result ? pngName : '';
    } else if (jsonData.name !== undefined) {
        console.info('Importing from v1 json');
        jsonData.name = sanitize(jsonData.name);
        if (jsonData.creator_notes) {
            jsonData.creator_notes = jsonData.creator_notes.replace('Creator\'s notes go here.', '');
        }
        const pngName = preservedFileName || getPngName(jsonData.name, request.user.directories);
        let char = {
            'name': jsonData.name,
            'description': jsonData.description ?? '',
            'creatorcomment': jsonData.creatorcomment ?? jsonData.creator_notes ?? '',
            'personality': jsonData.personality ?? '',
            'first_mes': jsonData.first_mes ?? '',
            'avatar': 'none',
            'chat': jsonData.name + ' - ' + humanizedISO8601DateTime(),
            'mes_example': jsonData.mes_example ?? '',
            'scenario': jsonData.scenario ?? '',
            'create_date': humanizedISO8601DateTime(),
            'talkativeness': jsonData.talkativeness ?? 0.5,
            'creator': jsonData.creator ?? '',
            'tags': jsonData.tags ?? '',
        };
        char = convertToV2(char, request.user.directories);
        let charJSON = JSON.stringify(char);
        const result = await writeCharacterData(DEFAULT_AVATAR_PATH, charJSON, pngName, request);
        return result ? pngName : '';
    } else if (jsonData.char_name !== undefined) {//json Pygmalion notepad
        console.info('Importing from gradio json');
        jsonData.char_name = sanitize(jsonData.char_name);
        if (jsonData.creator_notes) {
            jsonData.creator_notes = jsonData.creator_notes.replace('Creator\'s notes go here.', '');
        }
        const pngName = preservedFileName || getPngName(jsonData.char_name, request.user.directories);
        let char = {
            'name': jsonData.char_name,
            'description': jsonData.char_persona ?? '',
            'creatorcomment': jsonData.creatorcomment ?? jsonData.creator_notes ?? '',
            'personality': '',
            'first_mes': jsonData.char_greeting ?? '',
            'avatar': 'none',
            'chat': jsonData.name + ' - ' + humanizedISO8601DateTime(),
            'mes_example': jsonData.example_dialogue ?? '',
            'scenario': jsonData.world_scenario ?? '',
            'create_date': humanizedISO8601DateTime(),
            'talkativeness': jsonData.talkativeness ?? 0.5,
            'creator': jsonData.creator ?? '',
            'tags': jsonData.tags ?? '',
        };
        char = convertToV2(char, request.user.directories);
        const charJSON = JSON.stringify(char);
        const result = await writeCharacterData(DEFAULT_AVATAR_PATH, charJSON, pngName, request);
        return result ? pngName : '';
    }

    return '';
}

/**
 * Import a character from a PNG file.
 * @param {string} uploadPath Path to the uploaded file
 * @param {{ request: import('express').Request, response: import('express').Response }} context Express request and response objects
 * @param {string|undefined} preservedFileName Preserved file name
 * @returns {Promise<string>} Internal name of the character
 */
async function importFromPng(uploadPath, { request }, preservedFileName) {
    const imgData = await readCharacterData(uploadPath);
    if (imgData === undefined) throw new Error('Failed to read character data');

    let jsonData = JSON.parse(imgData);

    jsonData.name = sanitize(jsonData.data?.name || jsonData.name);
    const pngName = preservedFileName || getPngName(jsonData.name, request.user.directories);

    if (jsonData.spec !== undefined) {
        console.info(`Found a ${jsonData.spec} character file.`);
        importRisuSprites(request.user.directories, jsonData);
        unsetPrivateFields(jsonData);
        jsonData = readFromV2(jsonData);
        jsonData['create_date'] = humanizedISO8601DateTime();
        const char = JSON.stringify(jsonData);
        const result = await writeCharacterData(uploadPath, char, pngName, request);
        fs.unlinkSync(uploadPath);
        return result ? pngName : '';
    } else if (jsonData.name !== undefined) {
        console.info('Found a v1 character file.');

        if (jsonData.creator_notes) {
            jsonData.creator_notes = jsonData.creator_notes.replace('Creator\'s notes go here.', '');
        }

        let char = {
            'name': jsonData.name,
            'description': jsonData.description ?? '',
            'creatorcomment': jsonData.creatorcomment ?? jsonData.creator_notes ?? '',
            'personality': jsonData.personality ?? '',
            'first_mes': jsonData.first_mes ?? '',
            'avatar': 'none',
            'chat': jsonData.name + ' - ' + humanizedISO8601DateTime(),
            'mes_example': jsonData.mes_example ?? '',
            'scenario': jsonData.scenario ?? '',
            'create_date': humanizedISO8601DateTime(),
            'talkativeness': jsonData.talkativeness ?? 0.5,
            'creator': jsonData.creator ?? '',
            'tags': jsonData.tags ?? '',
        };
        char = convertToV2(char, request.user.directories);
        const charJSON = JSON.stringify(char);
        const result = await writeCharacterData(uploadPath, charJSON, pngName, request);
        fs.unlinkSync(uploadPath);
        return result ? pngName : '';
    }

    return '';
}

export const router = express.Router();

router.post('/create', getFileNameValidationFunction('file_name'), async function (request, response) {
    try {
        if (!request.body) return response.sendStatus(400);

        request.body.ch_name = sanitize(request.body.ch_name);
        const requestedFavorite = coerceFavoriteValue(request.body.fav) === true;

        const char = JSON.stringify(charaFormatData(request.body, request.user.directories));
        const internalName = request.body.file_name || getPngName(request.body.ch_name, request.user.directories);
        const avatarName = `${internalName}.png`;
        const chatsPath = resolveCharacterChatDirectory(request.user.directories, internalName);

        await assertSharedCharacterCheckoutForMutation(request, avatarName);

        if (!fs.existsSync(chatsPath)) fs.mkdirSync(chatsPath);

        if (!request.file) {
            const wasWritten = await writeCharacterData(DEFAULT_AVATAR_PATH, char, internalName, request);
            if (!wasWritten) {
                return response.sendStatus(500);
            }
            setCharacterFavorite(request.user.directories, { avatar: avatarName, value: requestedFavorite });
            return response.send(avatarName);
        } else {
            const crop = tryParse(request.query.crop);
            const uploadPath = resolveUploadedFilePath(request.file);
            const wasWritten = await writeCharacterData(uploadPath, char, internalName, request, crop);
            fs.unlinkSync(uploadPath);
            if (!wasWritten) {
                return response.sendStatus(500);
            }
            setCharacterFavorite(request.user.directories, { avatar: avatarName, value: requestedFavorite });
            return response.send(avatarName);
        }
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        if (err instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, err);
        }

        console.error(err);
        response.sendStatus(500);
    }
});

router.post('/rename', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body.avatar_url || !request.body.new_name) {
        return response.sendStatus(400);
    }

    const oldAvatarName = request.body.avatar_url;
    const newName = sanitize(request.body.new_name);
    const oldInternalName = path.parse(request.body.avatar_url).name;
    const newInternalName = getPngName(newName, request.user.directories);
    const newAvatarName = `${newInternalName}.png`;

    try {
        const oldAvatarPath = resolveCharacterFilePath(request.user.directories, oldAvatarName);
        const oldChatsPath = resolveCharacterChatDirectory(request.user.directories, oldInternalName);
        const newChatsPath = resolveCharacterChatDirectory(request.user.directories, newInternalName);

        // Read old file, replace name int it
        const rawOldData = await readCharacterData(oldAvatarPath);
        if (rawOldData === undefined) throw new Error('Failed to read character file');

        const oldData = getCharaCardV2(JSON.parse(rawOldData), request.user.directories);
        if (!canManageCharacterOwnership(oldData, request)) {
            const ownerLabel = getCharacterOwnerLabel(oldData);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can rename this character.` });
        }

        if (await getSharedCharacterRecord(oldInternalName)) {
            return response.status(409).json({ error: 'Shared characters cannot be renamed. Renaming creates a new identity; create a new character instead.' });
        }

        _.set(oldData, 'data.name', newName);
        _.set(oldData, 'name', newName);
        const newData = JSON.stringify(oldData);

        // Write data to new location
        await writeCharacterData(oldAvatarPath, newData, newInternalName, request);

        // Rename chats folder
        if (fs.existsSync(oldChatsPath) && !fs.existsSync(newChatsPath)) {
            fs.cpSync(oldChatsPath, newChatsPath, { recursive: true });
            fs.rmSync(oldChatsPath, { recursive: true, force: true });
        }

        // Remove the old character file
        fs.unlinkSync(oldAvatarPath);
        moveAvatarFavorite(request.user.directories, { oldAvatar: oldAvatarName, newAvatar: newAvatarName });

        // Return new avatar name to ST
        return response.send({ avatar: newAvatarName });
    }
    catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }
        console.error(err);
        return response.sendStatus(500);
    }
});

router.post('/token-dry-run', validateAvatarUrlMiddleware, async function (request, response) {
    const avatarUrl = String(request.body?.avatar_url || '').trim();
    if (!avatarUrl) {
        return response.status(400).json({ error: 'avatar_url is required.' });
    }

    try {
        const avatarPath = resolveCharacterFilePath(request.user.directories, avatarUrl);
        if (!fs.existsSync(avatarPath)) {
            return response.status(404).json({ error: 'Character not found.' });
        }

        const rawCharacterData = await readCharacterData(avatarPath);
        if (!rawCharacterData) {
            return response.status(404).json({ error: 'Character not found.' });
        }

        const rawCharacterCard = JSON.parse(rawCharacterData);
        const characterCard = getCharaCardV2(structuredClone(rawCharacterCard), request.user.directories, false);
        if (!canManageCharacterOwnership(characterCard, request)) {
            const ownerLabel = getCharacterOwnerLabel(characterCard);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can run a token dry run for this character.` });
        }

        await assertSharedCharacterCheckoutForMutation(request, avatarUrl);

        const promptContext = sanitizeDryRunPromptContext(request.body.prompt_context, characterCard, avatarUrl);
        await prepareServerPromptContext(request.user, request.user.directories, promptContext);
        const assembly = await assembleChatCompletionPrompt(promptContext);
        const metadata = buildTokenDryRunMetadata(countBotDryRunTokens(assembly.chat || []));

        _.set(rawCharacterCard, 'data.extensions.aikobots.token_dry_run', metadata);
        const wasWritten = await writeCharacterData(avatarPath, JSON.stringify(rawCharacterCard), path.parse(avatarUrl).name, request);
        if (!wasWritten) {
            return response.sendStatus(500);
        }

        const consoleLog = logTokenDryRunContributions(characterCard, avatarUrl, metadata, assembly);
        return response.json({
            ...normalizeTokenDryRunMetadata(metadata),
            console_log: consoleLog,
        });
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        if (err instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, err);
        }

        if (err?.status === 400) {
            return response.status(400).json({ error: err.message });
        }

        console.error('Character token dry run failed.', err);
        return response.sendStatus(500);
    }
});

router.post('/edit', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body) {
        console.warn('Error: no response body detected');
        response.status(400).send('Error: no response body detected');
        return;
    }

    if (request.body.ch_name === '' || request.body.ch_name === undefined || request.body.ch_name === '.') {
        console.warn('Error: invalid name.');
        response.status(400).send('Error: invalid name.');
        return;
    }

    try {
        await assertSharedCharacterCheckoutForMutation(request, request.body.avatar_url);
        const avatarPath = resolveCharacterFilePath(request.user.directories, request.body.avatar_url);
        const rawCharacterData = await readCharacterData(avatarPath);
        const existingCharacter = rawCharacterData ? getCharaCardV2(JSON.parse(rawCharacterData), request.user.directories, false) : null;

        const canEditMetadata = !existingCharacter || canEditCharacterMetadata(existingCharacter, request);
        const requestedFavorite = coerceFavoriteValue(request.body.fav);
        const canEditLorebooks = canEditCharacterLorebooks(existingCharacter, request);
        const requestedJsonData = tryParse(request.body.json_data);
        const requestedJsonCard = requestedJsonData ? getCharaCardV2(requestedJsonData, request.user.directories, false) : null;
        const requestedWorld = String(request.body.world || '');

        if (existingCharacter && !canEditLorebooks) {
            const existingWorld = String(_.get(existingCharacter, 'data.extensions.world', '') || '');
            const requestedJsonWorld = requestedJsonCard
                ? String(_.get(requestedJsonCard, 'data.extensions.world', existingWorld) || '')
                : existingWorld;
            const requestedEmbeddedBookChanged = requestedJsonCard
                ? _.has(requestedJsonCard, 'data.character_book') && !_.isEqual(_.get(requestedJsonCard, 'data.character_book'), _.get(existingCharacter, 'data.character_book'))
                : false;
            const requestedSecureLorebooksChanged = requestedJsonCard
                ? _.has(requestedJsonCard, 'data.extensions.aikobots.secure_lorebooks')
                    && !_.isEqual(
                        _.get(requestedJsonCard, 'data.extensions.aikobots.secure_lorebooks'),
                        _.get(existingCharacter, 'data.extensions.aikobots.secure_lorebooks'),
                    )
                : false;

            if (requestedWorld !== existingWorld || requestedJsonWorld !== existingWorld || requestedEmbeddedBookChanged || requestedSecureLorebooksChanged) {
                const ownerLabel = getCharacterOwnerLabel(existingCharacter);
                return response.status(403).json({ error: `Only ${ownerLabel} and admins can change this character's lorebook assignments.` });
            }
        }

        let char = charaFormatData(request.body, request.user.directories);
        preserveTokenDryRunMetadata(char, existingCharacter);
        if (existingCharacter && !canEditLorebooks) {
            preserveProtectedLorebookFields(char, existingCharacter);
        }

        if (canEditLorebooks) {
            sanitizeEmbeddedLorebookForPrimaryWorld(char, requestedJsonCard, requestedWorld);
            validateOwnedCharacterLinkedLorebooks(request.user, char);
        }

        char.chat = request.body.chat;
        char.create_date = request.body.create_date;

        if (existingCharacter && !canEditMetadata && !isRelaxedCharacterMetadataChange(existingCharacter, char)) {
            const ownerLabel = getCharacterOwnerLabel(existingCharacter);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can edit this character's metadata.` });
        }

        char = JSON.stringify(char);
        let targetFile = (request.body.avatar_url).replace('.png', '');

        if (!request.file) {
            const wasWritten = await writeCharacterData(avatarPath, char, targetFile, request);
            if (!wasWritten) {
                return response.sendStatus(500);
            }
        } else {
            const crop = tryParse(request.query.crop);
            const newAvatarPath = resolveUploadedFilePath(request.file);
            invalidateThumbnail(request.user.directories, 'avatar', request.body.avatar_url);
            const wasWritten = await writeCharacterData(newAvatarPath, char, targetFile, request, crop);
            fs.unlinkSync(newAvatarPath);
            if (!wasWritten) {
                return response.sendStatus(500);
            }

            // Bust cache to reload the new avatar
            cacheBuster.bust(request, response);
        }

        if (requestedFavorite !== undefined) {
            setCharacterFavorite(request.user.directories, {
                avatar: String(request.body.avatar_url || `${targetFile}.png`),
                sharedCharacterKey: getCharacterSharedKey(existingCharacter) || getCharacterSharedKey(tryParse(char)),
                value: requestedFavorite,
            });
        }

        return response.sendStatus(200);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        if (err?.status === 400) {
            return response.status(400).json({ error: err.message });
        }

        if (err instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, err);
        }

        console.error('An error occurred, character edit invalidated.', err);
        return response.sendStatus(500);
    }
});

router.post('/edit-avatar', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.file) {
            return response.status(400).send('Error: no file uploaded');
        }

        if (!request.body || !request.body.avatar_url) {
            return response.status(400).send('Error: no avatar_url in request body');
        }

        const uploadPath = resolveUploadedFilePath(request.file);
        if (!fs.existsSync(uploadPath)) {
            return response.status(400).send('Error: uploaded file does not exist');
        }
        const characterPath = resolveCharacterFilePath(request.user.directories, request.body.avatar_url);
        if (!fs.existsSync(characterPath)) {
            return response.status(400).send('Error: character file does not exist');
        }

        await assertSharedCharacterCheckoutForMutation(request, request.body.avatar_url);

        const data = await readCharacterData(characterPath);
        if (!data) {
            return response.status(400).send('Error: failed to read character data');
        }

        const crop = tryParse(request.query.crop);
        const fileName = request.body.avatar_url.replace('.png', '');
        await writeCharacterData(uploadPath, data, fileName, request, crop);

        // Remove uploaded temp file
        fs.unlinkSync(uploadPath);

        // Reset images caches
        cacheBuster.bust(request, response);
        invalidateThumbnail(request.user.directories, 'avatar', request.body.avatar_url);

        return response.sendStatus(200);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).send(err.message);
        }

        if (err instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, err);
        }

        console.error('An error occurred while editing avatar', err);
        return response.sendStatus(500);
    }
});

/**
 * Handle a POST request to edit a character attribute.
 *
 * This function reads the character data from a file, updates the specified attribute,
 * and writes the updated data back to the file.
 *
 * @param {Object} request - The HTTP request object.
 * @param {Object} response - The HTTP response object.
 * @returns {void}
 */
router.post('/edit-attribute', validateAvatarUrlMiddleware, async function (request, response) {
    console.debug(request.body);
    if (!request.body) {
        console.warn('Error: no response body detected');
        return response.status(400).send('Error: no response body detected');
    }

    if (request.body.ch_name === '' || request.body.ch_name === undefined || request.body.ch_name === '.') {
        console.warn('Error: invalid name.');
        return response.status(400).send('Error: invalid name.');
    }

    if (request.body.field === 'json_data') {
        console.warn('Error: cannot edit json_data field.');
        return response.status(400).send('Error: cannot edit json_data field.');
    }

    try {
        await assertSharedCharacterCheckoutForMutation(request, request.body.avatar_url);
        const avatarPath = resolveCharacterFilePath(request.user.directories, request.body.avatar_url);
        const charJSON = await readCharacterData(avatarPath);
        if (typeof charJSON !== 'string') throw new Error('Failed to read character file');

        const char = JSON.parse(charJSON);
        const existingCharacter = _.cloneDeep(char);

        //check if the field exists
        if (char[request.body.field] === undefined && char.data[request.body.field] === undefined) {
            console.warn('Error: invalid field.');
            response.status(400).send('Error: invalid field.');
            return;
        }
        char[request.body.field] = request.body.value;
        char.data[request.body.field] = request.body.value;
        preserveTokenDryRunMetadata(char, existingCharacter);

        if (!canEditCharacterMetadata(existingCharacter, request) && !isRelaxedCharacterMetadataChange(existingCharacter, char)) {
            const ownerLabel = getCharacterOwnerLabel(existingCharacter);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can edit this character's metadata.` });
        }

        let newCharJSON = JSON.stringify(char);
        const targetFile = (request.body.avatar_url).replace('.png', '');
        await writeCharacterData(avatarPath, newCharJSON, targetFile, request);
        return response.sendStatus(200);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).send(err.message);
        }

        if (err instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, err);
        }

        console.error('An error occurred, character edit invalidated.', err);
        return response.sendStatus(500);
    }
});

/**
 * Handle a POST request to edit character properties.
 *
 * Merges the request body with the selected character and
 * validates the result against TavernCard V2 specification.
 *
 * @param {Object} request - The HTTP request object.
 * @param {Object} response - The HTTP response object.
 *
 * @returns {void}
 * */
router.post('/merge-attributes', getFileNameValidationFunction('avatar'), async function (request, response) {
    try {
        const update = request.body;
        const requestedFavorite = coerceFavoriteValue(update?.fav, _.get(update, 'data.extensions.fav'));
        await assertSharedCharacterCheckoutForMutation(request, update.avatar);
        const avatarPath = resolveCharacterFilePath(request.user.directories, update.avatar);

        const pngStringData = await readCharacterData(avatarPath);

        if (!pngStringData) {
            console.error('Error: invalid character file.');
            return response.status(400).send('Error: invalid character file.');
        }

        _.unset(update, 'json_data');
        _.unset(update, 'fav');
        _.unset(update, 'data.extensions.fav');

        let character = JSON.parse(pngStringData);
        const existingCharacter = _.cloneDeep(character);
        const canEditMetadata = canEditCharacterMetadata(character, request);
        if (!canEditMetadata && !isRelaxedCharacterMetadataUpdate(update)) {
            const ownerLabel = getCharacterOwnerLabel(character);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can edit this character's metadata.` });
        }

        const canEditLorebooks = canEditCharacterLorebooks(character, request);
        const updatesWorld = _.has(update, 'data.extensions.world');
        const updatesEmbeddedBook = _.has(update, 'data.character_book');
        const updatesSecureLorebooks = _.has(update, 'data.extensions.aikobots.secure_lorebooks');
        const updatesProtectedLorebookFields = updatesWorld || updatesEmbeddedBook || updatesSecureLorebooks;

        if (updatesProtectedLorebookFields && !canEditLorebooks) {
            const ownerLabel = getCharacterOwnerLabel(character);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can change this character's lorebook assignments.` });
        }

        _.unset(character, 'json_data');

        character = deepMerge(character, update);

        if (!canEditLorebooks) {
            preserveProtectedLorebookFields(character, existingCharacter);
        }

        preserveTokenDryRunMetadata(character, existingCharacter);

        if (updatesProtectedLorebookFields && canEditLorebooks) {
            validateOwnedCharacterLinkedLorebooks(request.user, character);
        }

        const validator = new TavernCardValidator(character);
        const targetImg = (update.avatar).replace('.png', '');

        //Accept either V1 or V2.
        if (validator.validate()) {
            const wasWritten = await writeCharacterData(avatarPath, JSON.stringify(character), targetImg, request);
            if (!wasWritten) {
                return response.status(500).send({ message: 'Unexpected error while saving character.' });
            }
            if (requestedFavorite !== undefined) {
                setCharacterFavorite(request.user.directories, {
                    avatar: String(update.avatar || ''),
                    sharedCharacterKey: getCharacterSharedKey(character),
                    value: requestedFavorite,
                });
            }
            response.sendStatus(200);
        } else {
            console.warn(validator.lastValidationError);
            response.status(400).send({ message: `Validation failed for ${character.name}`, error: validator.lastValidationError });
        }
    } catch (exception) {
        if (exception?.status === 400) {
            return response.status(400).send({ message: 'Invalid linked lorebooks.', error: exception.message });
        }

        if (exception instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, exception);
        }

        response.status(500).send({ message: 'Unexpected error while saving character.', error: exception.toString() });
    }
});

router.post('/delete', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body || !request.body.avatar_url) {
        return response.sendStatus(400);
    }

    if (request.body.avatar_url !== sanitize(request.body.avatar_url)) {
        console.error('Malicious filename prevented');
        return response.sendStatus(403);
    }

    const deleteForAllUsers = request.body.delete_for_all_users == true;
    if (deleteForAllUsers && !request.user.profile.admin) {
        return response.status(403).json({ error: 'Only admins can delete a character for all users.' });
    }

    const avatarUrl = request.body.avatar_url;
    let dir_name = (avatarUrl.replace('.png', ''));

    if (!dir_name.length) {
        console.error('Malicious dirname prevented');
        return response.sendStatus(403);
    }

    async function deleteCharacterFromDirectories(directories) {
        const avatarPath = resolveCharacterFilePath(directories, avatarUrl);
        const avatarExists = fs.existsSync(avatarPath);

        if (avatarExists) {
            fs.unlinkSync(avatarPath);
            invalidateThumbnail(directories, 'avatar', avatarUrl);
        }

        if (request.body.delete_chats == true) {
            await fs.promises.rm(resolveCharacterChatDirectory(directories, dir_name), { recursive: true, force: true });
        }

        return avatarExists;
    }

    async function enrollDeletingUserInRepushBlacklist(avatarPath) {
        const deletingUserHandle = String(request.user?.profile?.handle || '').trim();
        if (!deletingUserHandle) {
            throw new Error('Missing user handle for character deletion.');
        }

        const rawCharacterData = await readCharacterData(avatarPath);
        if (!rawCharacterData) {
            throw new Error('Could not read character metadata for repush opt-out.');
        }

        const characterCard = getCharaCardV2(JSON.parse(rawCharacterData), request.user.directories, false);
        const ownerHandles = getCharacterOwnerHandles(characterCard);
        if (ownerHandles.length === 0 || ownerHandles.includes(deletingUserHandle)) {
            return;
        }

        const ownerHandle = getCharacterOwnerHandle(characterCard);
        const characterKey = getCharacterSharedKey(characterCard);
        const publishedFilename = path.parse(avatarPath).name;
        const policy = await getCharacterDistributionPolicy({ ownerHandle, characterKey, publishedFilename });
        let nextPolicy = policy;

        if (!policy.userBlacklistHandles.includes(deletingUserHandle)) {
            nextPolicy = await setCharacterDistributionPolicy({
                ownerHandle,
                characterKey,
                publishedFilename,
                userBlacklistHandles: [...policy.userBlacklistHandles, deletingUserHandle],
                updatedBy: deletingUserHandle,
            });
        }

        await upsertCharacterRepushBlacklistEntry(request.user.directories, {
            key: nextPolicy.key,
            ownerHandle,
            characterKey,
            publishedFilename,
            characterName: _.get(characterCard, 'data.name') || _.get(characterCard, 'name') || publishedFilename,
            addedAt: Date.now(),
        });
    }

    if (deleteForAllUsers) {
        try {
            const sharedRecord = await getSharedCharacterRecord(avatarUrl);
            const removedSharedBacking = Boolean(sharedRecord);
            if (sharedRecord) {
                await deleteSharedCharacter(request.user, avatarUrl);
            }

            const users = await getAllEnabledUsers();
            let deletedCount = 0;

            for (const user of users) {
                const directories = getUserDirectories(user.handle);
                deletedCount += Number(await deleteCharacterFromDirectories(directories));
            }

            const removedCatalogSource = (await deleteDefaultContentCharacter(avatarUrl)).removed;

            if (!deletedCount && !removedSharedBacking && !removedCatalogSource) {
                return response.sendStatus(400);
            }
        } catch (err) {
            if (err instanceof PathSecurityError) {
                return response.status(400).json({ error: err.message });
            }

            if (err instanceof CharacterSharingRepositoryError) {
                return sendSharedCharacterError(response, err);
            }

            console.error(err);
            return response.sendStatus(500);
        }

        return response.sendStatus(200);
    }

    let avatarPath;
    try {
        avatarPath = resolveCharacterFilePath(request.user.directories, avatarUrl);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }
        console.error(err);
        return response.sendStatus(500);
    }
    if (!fs.existsSync(avatarPath)) {
        return response.sendStatus(400);
    }

    try {
        const sharedRecord = await getSharedCharacterRecord(avatarUrl);
        const currentHandle = String(request.user?.profile?.handle || '').trim();
        if (sharedRecord?.ownerHandles?.includes(currentHandle)) {
            return response.status(409).json({
                error: 'Shared owners cannot delete only their local copy. Update shared owners instead, or use delete for all users.',
            });
        }

        if (request.body.skip_future_pushes == true && !deleteForAllUsers) {
            await enrollDeletingUserInRepushBlacklist(avatarPath);
        }

        await deleteCharacterFromDirectories(request.user.directories);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        console.error(err);
        return response.sendStatus(500);
    }

    return response.sendStatus(200);
});

/**
 * HTTP POST endpoint for the "/api/characters/all" route.
 *
 * This endpoint is responsible for reading character files from the `charactersPath` directory,
 * parsing character data, calculating stats for each character and responding with the data.
 * Stats are calculated only on the first run, on subsequent runs the stats are fetched from
 * the `charStats` variable.
 * The stats are calculated by the `calculateStats` function.
 * The characters are processed by the `processCharacter` function.
 *
 * @param  {import("express").Request} request The HTTP request object.
 * @param  {import("express").Response} response The HTTP response object.
 * @return {void}
 */
router.post('/all', async function (request, response) {
    const requestId = `${characterEndpointInstanceId}-${++characterListRequestCounter}`;
    const startedAt = Date.now();
    response.set('X-Aikobots-Character-Request', requestId);
    response.set('X-Aikobots-Character-Instance', characterEndpointInstanceId);
    const favoritesState = createFavoritesState(request.user.directories);
    try {
        const files = fs.readdirSync(request.user.directories.characters);
        const pngFiles = files.filter(file => file.endsWith('.png'));
        const sharedIndex = await readSharedCharacterIndexSnapshot();
        const processingPromises = pngFiles.map(file => processCharacter(file, request.user.directories, {
            shallow: useShallowCharacters,
            user: request.user,
            sharedIndex,
            favoritesState,
        }));
        const processed = await Promise.all(processingPromises);
        const data = processed.filter(c => c.name);
        response.set('X-Aikobots-Character-Count', String(data.length));
        response.set('X-Aikobots-Character-File-Count', String(pngFiles.length));
        console.debug('[Characters] Loaded character list.', {
            requestId,
            user: request.user?.profile?.handle,
            files: pngFiles.length,
            returned: data.length,
            invalid: processed.length - data.length,
            shallow: useShallowCharacters,
            elapsedMs: Date.now() - startedAt,
        });
        if (processed.length !== data.length) {
            console.warn('[Characters] Some character files were skipped while loading the list.', {
                requestId,
                skipped: processed.length - data.length,
            });
        }
        return response.send(data);
    } catch (err) {
        console.error('[Characters] Failed to load character list.', {
            requestId,
            user: request.user?.profile?.handle,
            elapsedMs: Date.now() - startedAt,
            error: err,
        });
        const isRangeError = err instanceof RangeError;
        response.status(500).send({ overflow: isRangeError, error: true });
    } finally {
        flushFavoritesState(favoritesState);
    }
});

router.post('/get', validateAvatarUrlMiddleware, async function (request, response) {
    const favoritesState = createFavoritesState(request.user.directories);
    try {
        if (!request.body) return response.sendStatus(400);
        const item = request.body.avatar_url;
        const filePath = resolveCharacterFilePath(request.user.directories, item);

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        const data = await processCharacter(item, request.user.directories, {
            shallow: false,
            user: request.user,
            favoritesState,
        });

        return response.send(data);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        console.error(err);
        response.sendStatus(500);
    } finally {
        flushFavoritesState(favoritesState);
    }
});

router.post('/admin/source-list', requireAdminMiddleware, async function (request, response) {
    try {
        const sourceOwnerHandle = String(request.body?.sourceOwnerHandle || '').trim();
        if (!sourceOwnerHandle) {
            return response.status(400).json({ error: 'Missing source owner.' });
        }

        const enabledUsers = await getAllEnabledUsers();
        const sourceUser = enabledUsers.find(user => String(user.handle || '').trim() === sourceOwnerHandle);
        if (!sourceUser) {
            return response.status(400).json({ error: 'Invalid or disabled source owner.' });
        }

        const sourceDirectories = getUserDirectories(sourceUser.handle);
        const files = fs.existsSync(sourceDirectories.characters)
            ? fs.readdirSync(sourceDirectories.characters)
            : [];
        const pngFiles = files.filter(file => file.endsWith('.png'));
        const sharedIndex = await readSharedCharacterIndexSnapshot();
        const processed = await Promise.all(pngFiles.map(file => processAdminSourceCharacter(file, sourceDirectories, {
            user: request.user,
            sourceOwnerHandle: sourceUser.handle,
            sharedIndex,
        })));
        const characters = processed
            .filter(character => character?.name)
            .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));

        return response.json({
            sourceOwnerHandle: sourceUser.handle,
            characters,
        });
    } catch (error) {
        console.error('Admin source character list failed:', error);
        return response.status(500).json({ error: 'Failed to list source characters.' });
    }
});

router.post('/chats', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body) return response.sendStatus(400);

        const characterDirectory = (request.body.avatar_url).replace('.png', '');
        const chatsDirectory = resolveCharacterChatDirectory(request.user.directories, characterDirectory);

        if (!fs.existsSync(chatsDirectory)) {
            return response.send({ error: true });
        }

        const files = fs.readdirSync(chatsDirectory, { withFileTypes: true });
        const jsonFiles = getDeduplicatedChatHistoryFileNames(files, { includeLegacyJsonl: false });

        if (jsonFiles.length === 0) {
            return response.send([]);
        }

        if (request.body.simple) {
            return response.send(jsonFiles.map(file => ({ file_name: file, file_id: path.parse(file).name })));
        }

        const jsonFilesPromise = jsonFiles.map((file) => {
            const withMetadata = !!request.body.metadata;
            const pathToFile = resolveCharacterChatFilePath(request.user.directories, characterDirectory, file);
            return getChatInfo(pathToFile, {}, false, withMetadata);
        });

        const chatData = (await Promise.allSettled(jsonFilesPromise)).filter(x => x.status === 'fulfilled').map(x => x.value);
        const validFiles = chatData.filter(i => i.file_name);

        return response.send(validFiles);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            return response.status(400).json({ error: error.message });
        }

        console.error(error);
        return response.send({ error: true });
    }
});

/**
 * Gets the name for the uploaded PNG file.
 * @param {string} file File name
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {string} - The name for the uploaded PNG file
 */
function getPngName(file, directories) {
    let i = 1;
    file = sanitize(String(file || ''), { replacement: sanitizeSafeCharacterReplacements });
    const baseName = file;
    while (fs.existsSync(resolveCharacterOutputPath(directories, file))) {
        file = baseName + i;
        i++;
    }
    return file;
}

/**
 * Gets the preserved name for the uploaded file if the request is valid.
 * @param {import("express").Request} request - Express request object
 * @returns {string | undefined} - The preserved name if the request is valid, otherwise undefined
 */
function getPreservedName(request) {
    if (typeof request.body.preserved_name !== 'string' || request.body.preserved_name.length === 0) {
        return undefined;
    }

    return path.parse(assertSafeFileName(request.body.preserved_name, 'preserved_name')).name;
}

router.post('/import', async function (request, response) {
    if (!request.body || !request.file) return response.sendStatus(400);

    const format = request.body.file_type;

    const formatImportFunctions = {
        'yaml': importFromYaml,
        'yml': importFromYaml,
        'json': importFromJson,
        'png': importFromPng,
        'charx': importFromCharX,
        'byaf': importFromByaf,
    };

    try {
        const uploadPath = resolveUploadedFilePath(request.file);
        const preservedFileName = getPreservedName(request);
        const importFunction = formatImportFunctions[format];

        if (!importFunction) {
            throw new Error(`Unsupported format: ${format}`);
        }

        if (preservedFileName) {
            await assertSharedCharacterCheckoutForMutation(request, preservedFileName);
        }

        const fileName = await importFunction(uploadPath, { request, response }, preservedFileName);

        if (!fileName) {
            console.warn('Failed to import character');
            return response.sendStatus(400);
        }

        if (preservedFileName) {
            invalidateThumbnail(request.user.directories, 'avatar', `${preservedFileName}.png`);
        }

        response.send({ file_name: fileName });
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        if (err instanceof CharacterSharingRepositoryError) {
            return sendSharedCharacterError(response, err);
        }

        console.error(err);
        response.send({ error: true });
    }
});

router.get('/catalog/avatar/:filename', async function (request, response) {
    try {
        const publishedFilename = String(request.params?.filename || '').trim();
        const catalogCharacter = await getIndexedCatalogCharacter(`${CATALOG_CHARACTER_DIRECTORY}/${publishedFilename}`);
        if (!catalogCharacter) {
            return response.sendStatus(404);
        }

        response.type('png');
        return response.sendFile(catalogCharacter.filePath);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            return response.status(400).json({ error: error.message });
        }

        console.error('Failed to serve catalog character avatar', error);
        return response.sendStatus(500);
    }
});

router.post('/catalog/list', async function (request, response) {
    try {
        const indexedFilenames = await readCatalogCharacterIndex();
        const entries = [];

        for (const indexFilename of indexedFilenames) {
            const catalogCharacter = await getIndexedCatalogCharacter(indexFilename, indexedFilenames);
            if (!catalogCharacter) {
                continue;
            }

            try {
                const { card } = await readCatalogCharacterCard(catalogCharacter.filePath);
                const character = getCharaCardV2(card, request.user.directories, false);
                const ownerHandles = getCharacterOwnerHandles(character);
                const ownerHandle = getCharacterOwnerHandle(character);
                entries.push({
                    publishedFilename: catalogCharacter.publishedFilename,
                    name: String(_.get(character, 'data.name', character.name) || path.parse(catalogCharacter.publishedFilename).name),
                    creator: String(_.get(character, 'data.creator', character.creator) || ''),
                    ownerHandle,
                    ownerHandles,
                    sharedCharacterKey: getCharacterSharedKey(character),
                    alreadyInstalled: fs.existsSync(resolveCharacterFilePath(request.user.directories, catalogCharacter.publishedFilename)),
                    avatarUrl: `/api/characters/catalog/avatar/${encodeURIComponent(catalogCharacter.publishedFilename)}`,
                });
            } catch (error) {
                console.warn(`Skipping unreadable catalog character: ${indexFilename}`, error);
            }
        }

        return response.json({ entries });
    } catch (error) {
        console.error('Failed to list catalog characters', error);
        return response.status(500).json({ error: 'Failed to list catalog characters.' });
    }
});

router.post('/catalog/retrieve', async function (request, response) {
    try {
        const publishedFilename = String(request.body?.publishedFilename || '').trim();
        const catalogCharacter = await getIndexedCatalogCharacter(`${CATALOG_CHARACTER_DIRECTORY}/${publishedFilename}`);
        if (!catalogCharacter) {
            return response.status(404).json({ error: 'Catalog character not found.' });
        }

        const destinationPath = resolveCharacterFilePath(request.user.directories, catalogCharacter.publishedFilename);
        if (fs.existsSync(destinationPath)) {
            return response.status(409).json({ error: 'Character is already installed.' });
        }

        const card = await writeCatalogCharacterToUser(catalogCharacter.filePath, destinationPath);
        invalidateThumbnail(request.user.directories, 'avatar', catalogCharacter.publishedFilename);

        const userHandle = String(request.user?.profile?.handle || '').trim();
        const ownerHandle = getCharacterOwnerHandle(card);
        const characterKey = getCharacterSharedKey(card);
        let removedRepushOptOut = false;

        if (userHandle && (ownerHandle || characterKey)) {
            const policy = await getCharacterDistributionPolicy({
                ownerHandle,
                characterKey,
                publishedFilename: path.parse(catalogCharacter.publishedFilename).name,
            });
            const userBlacklistHandles = policy.userBlacklistHandles.filter(handle => handle !== userHandle);

            if (userBlacklistHandles.length !== policy.userBlacklistHandles.length) {
                await setCharacterDistributionPolicy({
                    ownerHandle,
                    characterKey,
                    publishedFilename: path.parse(catalogCharacter.publishedFilename).name,
                    userBlacklistHandles,
                    updatedBy: userHandle,
                });
                removedRepushOptOut = true;
            }

            const registryEntries = await getCharacterDistributionUserBlacklistEntries(userHandle);
            const entries = await reconcileCharacterRepushBlacklistEntries(request.user.directories, registryEntries);
            const matchingEntry = entries.find(entry => entry.key === policy.key);
            if (matchingEntry) {
                await removeCharacterRepushBlacklistEntry(request.user.directories, matchingEntry.key);
                removedRepushOptOut = true;
            }
        }

        return response.json({
            ok: true,
            publishedFilename: catalogCharacter.publishedFilename,
            removedRepushOptOut,
        });
    } catch (error) {
        if (error instanceof PathSecurityError) {
            return response.status(400).json({ error: error.message });
        }

        console.error('Failed to retrieve catalog character', error);
        return response.status(500).json({ error: 'Failed to retrieve catalog character.' });
    }
});

router.post('/repush-blacklist/list', async function (request, response) {
    try {
        const userHandle = String(request.user?.profile?.handle || '').trim();
        const registryEntries = await getCharacterDistributionUserBlacklistEntries(userHandle);

        return response.json({
            entries: await reconcileCharacterRepushBlacklistEntries(request.user.directories, registryEntries),
        });
    } catch (error) {
        console.error('Failed to list character repush blacklist entries', error);
        return response.status(500).json({ error: 'Failed to list character repush blacklist entries.' });
    }
});

router.post('/repush-blacklist/remove', async function (request, response) {
    try {
        const key = String(request.body?.key || '').trim();
        const userHandle = String(request.user?.profile?.handle || '').trim();

        if (!key) {
            return response.status(400).json({ error: 'Missing blacklist entry key.' });
        }

        if (!userHandle) {
            return response.status(400).json({ error: 'Missing user handle.' });
        }

        const registryEntries = await getCharacterDistributionUserBlacklistEntries(userHandle);
        const entries = await reconcileCharacterRepushBlacklistEntries(request.user.directories, registryEntries);
        const entry = entries.find(item => item.key === key);
        if (!entry) {
            return response.status(404).json({ error: 'Blacklist entry not found.' });
        }

        const policy = await getCharacterDistributionPolicy({
            ownerHandle: entry.ownerHandle,
            characterKey: entry.characterKey,
            publishedFilename: entry.publishedFilename,
        });
        const userBlacklistHandles = policy.userBlacklistHandles.filter(handle => handle !== userHandle);

        if (userBlacklistHandles.length !== policy.userBlacklistHandles.length) {
            await setCharacterDistributionPolicy({
                ownerHandle: entry.ownerHandle,
                characterKey: entry.characterKey,
                publishedFilename: entry.publishedFilename,
                userBlacklistHandles,
                updatedBy: userHandle,
            });
        }

        const result = await removeCharacterRepushBlacklistEntry(request.user.directories, key);

        return response.json({
            removed: true,
            removedEntry: result.removedEntry,
            entries: result.entries,
        });
    } catch (error) {
        console.error('Failed to remove character repush blacklist entry', error);
        return response.status(500).json({ error: 'Failed to remove character repush blacklist entry.' });
    }
});

router.post('/distribution-policy', requireAdminMiddleware, async function (request, response) {
    try {
        const ownerHandle = String(request.body?.ownerHandle || '').trim();
        const characterKey = String(request.body?.characterKey || '').trim();
        const publishedFilename = String(request.body?.publishedFilename || '').trim();

        if (!publishedFilename) {
            return response.status(400).json({ error: 'Missing published filename.' });
        }

        const policy = await getCharacterDistributionPolicy({ ownerHandle, characterKey, publishedFilename });
        return response.json(policy);
    } catch (error) {
        console.error('Character distribution policy lookup failed', error);
        return response.status(400).json({ error: error.message || 'Character distribution policy lookup failed.' });
    }
});

router.post('/promote-shared', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body?.avatar_url) {
        return response.sendStatus(400);
    }

    try {
        const ownerHandles = await validateSharedCharacterOwnerHandles(request.body.ownerHandles, request.user?.profile?.handle);
        const result = await promoteCharacterToShared(request.user, request.body.avatar_url, ownerHandles);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendSharedCharacterError(response, error);
    }
});

router.post('/shared/owners', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body?.avatar_url) {
        return response.sendStatus(400);
    }

    try {
        const ownerHandles = await validateSharedCharacterOwnerHandles(request.body.ownerHandles, request.user?.profile?.handle);
        const result = await updateSharedCharacterOwners(request.user, request.body.avatar_url, ownerHandles);
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendSharedCharacterError(response, error);
    }
});

router.post('/checkout', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body?.avatar_url) {
        return response.sendStatus(400);
    }

    try {
        const result = await checkoutSharedCharacter(request.user, request.body.avatar_url, Boolean(request.body.force));
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendSharedCharacterError(response, error);
    }
});

router.post('/checkin', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body?.avatar_url) {
        return response.sendStatus(400);
    }

    try {
        const result = await checkinSharedCharacter(request.user, request.body.avatar_url, Boolean(request.body.force));
        return response.send({ ok: true, ...result });
    } catch (error) {
        return sendSharedCharacterError(response, error);
    }
});

router.post('/distribute', requireAdminMiddleware, async function (request, response) {
    try {
        const sourceType = String(request.body?.sourceType || '').trim();
        const publishMode = String(request.body?.publishMode || '').trim();
        const applyBlacklist = typeof request.body?.applyBlacklist === 'boolean' ? request.body.applyBlacklist : undefined;
        const persistWhitelist = typeof request.body?.persistWhitelist === 'boolean' ? request.body.persistWhitelist : undefined;

        if (![PUBLISH_MODES.SELECTED, PUBLISH_MODES.GLOBAL].includes(publishMode)) {
            return response.status(400).json({ error: 'Invalid publish mode.' });
        }

        /** @type {string} */
        let sourcePath = '';
        let sourceOwnerHandle = '';

        if (sourceType === DISTRIBUTION_SOURCE_TYPES.CHARACTER) {
            const sourceAvatar = String(request.body?.sourceAvatar || '').trim();
            if (!sourceAvatar) {
                return response.status(400).json({ error: 'Missing source character.' });
            }

            const requestedSourceOwnerHandle = String(request.body?.sourceOwnerHandle || '').trim();
            let sourceDirectories = request.user.directories;
            sourceOwnerHandle = request.user.profile.handle;

            if (requestedSourceOwnerHandle) {
                const enabledUsers = await getAllEnabledUsers();
                const sourceUser = enabledUsers.find(user => String(user.handle || '').trim() === requestedSourceOwnerHandle);
                if (!sourceUser) {
                    return response.status(400).json({ error: 'Invalid or disabled source owner.' });
                }

                sourceDirectories = getUserDirectories(sourceUser.handle);
                sourceOwnerHandle = sourceUser.handle;
            }

            sourcePath = resolveCharacterFilePath(sourceDirectories, sourceAvatar);
        } else if (sourceType === DISTRIBUTION_SOURCE_TYPES.SUBMISSION) {
            const submissionId = String(request.body?.submissionId || '').trim();
            if (!submissionId) {
                return response.status(400).json({ error: 'Missing submission id.' });
            }

            let submission;
            try {
                submission = await getSubmissionRecord(submissionId);
            } catch (error) {
                if (error?.message === 'Invalid submission id.') {
                    return response.status(400).json({ error: 'Invalid submission id.' });
                }
                if (error?.code === 'ENOENT') {
                    return response.status(404).json({ error: 'Submission not found.' });
                }
                throw error;
            }

            if (submission.status !== SUBMISSION_STATUSES.APPROVED) {
                return response.status(409).json({ error: 'Only approved submissions can be distributed.' });
            }

            sourcePath = getSubmissionPaths(submissionId).cardPath;
        } else {
            return response.status(400).json({ error: 'Invalid distribution source.' });
        }

        const distribution = await distributeCharacterFile({
            sourcePath,
            publishedFilename: request.body?.publishedFilename,
            publishMode,
            targetHandles: request.body?.targetHandles,
            actingUserHandle: request.user.profile.handle,
            applyBlacklist,
            blacklistHandles: request.body?.blacklistHandles,
            persistWhitelist,
            whitelistHandles: request.body?.whitelistHandles,
            sourceOwnerHandle,
        });

        return response.json(distribution);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            return response.status(400).json({ error: error.message });
        }

        console.error('Character distribution failed', error);
        return response.status(400).json({ error: error.message || 'Character distribution failed.' });
    }
});

router.post('/duplicate', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body.avatar_url) {
            console.warn('avatar URL not found in request body');
            console.debug(request.body);
            return response.sendStatus(400);
        }
        let filename = resolveCharacterFilePath(request.user.directories, request.body.avatar_url);
        if (!fs.existsSync(filename)) {
            console.error('file for dupe not found', filename);
            return response.sendStatus(404);
        }

        const rawCharacterData = await readCharacterData(filename);
        const characterCard = rawCharacterData ? JSON.parse(rawCharacterData) : null;
        const canDuplicate = canEditCharacterLorebooks(characterCard, request);
        if (!canDuplicate) {
            const ownerLabel = getCharacterOwnerLabel(characterCard);
            return response.status(403).json({ error: `Only ${ownerLabel} and admins can duplicate this character.` });
        }

        let suffix = 1;
        let newFilename = filename;

        // If filename ends with a _number, increment the number
        const nameParts = path.basename(filename, path.extname(filename)).split('_');
        const lastPart = nameParts[nameParts.length - 1];

        let baseName;

        if (!isNaN(Number(lastPart)) && nameParts.length > 1) {
            suffix = parseInt(lastPart) + 1;
            baseName = nameParts.slice(0, -1).join('_'); // construct baseName without suffix
        } else {
            baseName = nameParts.join('_'); // original filename is completely the baseName
        }

        newFilename = resolveCharacterFilePath(request.user.directories, `${baseName}_${suffix}${path.extname(filename)}`);

        while (fs.existsSync(newFilename)) {
            let suffixStr = '_' + suffix;
            newFilename = resolveCharacterFilePath(request.user.directories, `${baseName}${suffixStr}${path.extname(filename)}`);
            suffix++;
        }

        const duplicatedCharacter = rawCharacterData ? JSON.parse(rawCharacterData) : null;
        clearCharacterFavoriteState(duplicatedCharacter);
        clearCharacterSharingIdentityMetadata(duplicatedCharacter);
        const wasWritten = await writeCharacterData(filename, JSON.stringify(duplicatedCharacter), path.parse(newFilename).name, request);
        if (!wasWritten) {
            return response.send({ error: true });
        }
        console.info(`${filename} was copied to ${newFilename}`);
        response.send({ path: path.parse(newFilename).base });
    }
    catch (error) {
        if (error instanceof PathSecurityError) {
            return response.status(400).json({ error: error.message });
        }

        console.error(error);
        return response.send({ error: true });
    }
});

router.post('/export', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body.format || !request.body.avatar_url) {
            return response.sendStatus(400);
        }

        let filename = resolveCharacterFilePath(request.user.directories, request.body.avatar_url);

        if (!fs.existsSync(filename)) {
            return response.sendStatus(404);
        }

        switch (request.body.format) {
            case 'png': {
                const rawBuffer = await fsPromises.readFile(filename);
                const rawData = read(rawBuffer);
                const mutatedData = mutateJsonString(rawData, unsetPrivateFields);
                const mutatedBuffer = write(rawBuffer, mutatedData);
                const contentType = mime.lookup(filename) || 'image/png';
                response.setHeader('Content-Type', contentType);
                response.setHeader('Content-Disposition', `attachment; filename="${encodeURI(path.basename(filename))}"`);
                return response.send(mutatedBuffer);
            }
            case 'json': {
                try {
                    const json = await readCharacterData(filename);
                    if (json === undefined) return response.sendStatus(400);
                    const jsonObject = getCharaCardV2(JSON.parse(json), request.user.directories);
                    unsetPrivateFields(jsonObject);
                    return response.type('json').send(JSON.stringify(jsonObject, null, 4));
                }
                catch {
                    return response.sendStatus(400);
                }
            }
        }

        return response.sendStatus(400);
    } catch (err) {
        if (err instanceof PathSecurityError) {
            return response.status(400).json({ error: err.message });
        }

        console.error('Character export failed', err);
        response.sendStatus(500);
    }
});
