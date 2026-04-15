import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const FAVORITES_FILE = 'favorites.json';
export const FAVORITES_VERSION = 1;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTrueMap(source) {
    const normalized = {};
    if (!isPlainObject(source)) {
        return normalized;
    }

    for (const [key, value] of Object.entries(source)) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || value !== true) {
            continue;
        }

        normalized[normalizedKey] = true;
    }

    return normalized;
}

function createEmptyFavoritesDocument() {
    return {
        version: FAVORITES_VERSION,
        characters: {
            bySharedKey: {},
            byAvatar: {},
        },
        groups: {},
        // Migration markers let us backfill legacy fav=true once without letting
        // stale card/group data resurrect favorites after the user unfavorites it.
        migrated: {
            characters: {
                bySharedKey: {},
                byAvatar: {},
            },
            groups: {},
        },
    };
}

function normalizeFavoritesDocument(document) {
    const source = isPlainObject(document) ? document : {};
    const sourceCharacters = isPlainObject(source.characters) ? source.characters : {};
    const sourceMigrated = isPlainObject(source.migrated) ? source.migrated : {};
    const sourceMigratedCharacters = isPlainObject(sourceMigrated.characters) ? sourceMigrated.characters : {};

    return {
        version: FAVORITES_VERSION,
        characters: {
            bySharedKey: normalizeTrueMap(sourceCharacters.bySharedKey),
            byAvatar: normalizeTrueMap(sourceCharacters.byAvatar),
        },
        groups: normalizeTrueMap(source.groups),
        migrated: {
            characters: {
                bySharedKey: normalizeTrueMap(sourceMigratedCharacters.bySharedKey),
                byAvatar: normalizeTrueMap(sourceMigratedCharacters.byAvatar),
            },
            groups: normalizeTrueMap(sourceMigrated.groups),
        },
    };
}

function isFavoritesState(value) {
    return Boolean(value)
        && typeof value === 'object'
        && isPlainObject(value.document)
        && value.directories
        && typeof value.dirty === 'boolean';
}

function getNormalizedCharacterFavoriteKeys({ avatar = '', sharedCharacterKey = '' }) {
    return {
        avatar: String(avatar || '').trim(),
        sharedCharacterKey: String(sharedCharacterKey || '').trim(),
    };
}

function getPrimaryCharacterFavoriteTarget({ avatar = '', sharedCharacterKey = '' }) {
    if (sharedCharacterKey) {
        return { mapKey: 'bySharedKey', key: sharedCharacterKey };
    }

    return { mapKey: 'byAvatar', key: avatar };
}

function getCharacterMigrationMap(document, mapKey) {
    return document.migrated.characters[mapKey];
}

function getCharacterFavoritesMap(document, mapKey) {
    return document.characters[mapKey];
}

function markCharacterMigrated(state, mapKey, key) {
    if (!key) {
        return;
    }

    const migrationMap = getCharacterMigrationMap(state.document, mapKey);
    if (migrationMap[key] === true) {
        return;
    }

    migrationMap[key] = true;
    state.dirty = true;
}

function setCharacterFavoriteInDocument(state, mapKey, key, value) {
    if (!key) {
        return;
    }

    const favoritesMap = getCharacterFavoritesMap(state.document, mapKey);
    const nextValue = value === true;

    if (nextValue) {
        if (favoritesMap[key] !== true) {
            favoritesMap[key] = true;
            state.dirty = true;
        }
        return;
    }

    if (favoritesMap[key] === true) {
        delete favoritesMap[key];
        state.dirty = true;
    }
}

function resolveCharacterFavoriteInState(state, { avatar = '', sharedCharacterKey = '', legacyFavorite = false }) {
    const normalizedKeys = getNormalizedCharacterFavoriteKeys({ avatar, sharedCharacterKey });
    const explicitSharedFavorite = normalizedKeys.sharedCharacterKey
        && state.document.characters.bySharedKey[normalizedKeys.sharedCharacterKey] === true;
    const explicitAvatarFavorite = normalizedKeys.avatar
        && state.document.characters.byAvatar[normalizedKeys.avatar] === true;

    if (explicitSharedFavorite || explicitAvatarFavorite) {
        return true;
    }

    const primaryTarget = getPrimaryCharacterFavoriteTarget(normalizedKeys);
    if (!primaryTarget.key) {
        return false;
    }

    const migrationMap = getCharacterMigrationMap(state.document, primaryTarget.mapKey);
    if (migrationMap[primaryTarget.key] === true) {
        return false;
    }

    markCharacterMigrated(state, primaryTarget.mapKey, primaryTarget.key);
    if (legacyFavorite === true) {
        setCharacterFavoriteInDocument(state, primaryTarget.mapKey, primaryTarget.key, true);
        return true;
    }

    return false;
}

function resolveGroupFavoriteInState(state, { id = '', legacyFavorite = false }) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
        return false;
    }

    if (state.document.groups[normalizedId] === true) {
        return true;
    }

    if (state.document.migrated.groups[normalizedId] === true) {
        return false;
    }

    state.document.migrated.groups[normalizedId] = true;
    state.dirty = true;

    if (legacyFavorite === true) {
        state.document.groups[normalizedId] = true;
        state.dirty = true;
        return true;
    }

    return false;
}

function coerceState(target) {
    return isFavoritesState(target)
        ? { state: target, autoFlush: false }
        : { state: createFavoritesState(target), autoFlush: true };
}

export function getFavoritesPath(directories) {
    return path.join(directories.root, FAVORITES_FILE);
}

export function readFavoritesDocument(directories) {
    const favoritesPath = getFavoritesPath(directories);

    if (!fs.existsSync(favoritesPath)) {
        return createEmptyFavoritesDocument();
    }

    try {
        const rawDocument = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
        return normalizeFavoritesDocument(rawDocument);
    } catch (error) {
        throw new Error(`Failed to read favorites file "${favoritesPath}": ${error.message}`);
    }
}

export function writeFavoritesDocument(directories, document) {
    const favoritesPath = getFavoritesPath(directories);
    const normalizedDocument = normalizeFavoritesDocument(document);
    writeFileAtomicSync(favoritesPath, JSON.stringify(normalizedDocument, null, 4), 'utf8');
    return normalizedDocument;
}

export function createFavoritesState(directories) {
    return {
        directories,
        document: readFavoritesDocument(directories),
        dirty: false,
    };
}

export function flushFavoritesState(state) {
    if (!isFavoritesState(state) || !state.dirty) {
        return state?.document ?? null;
    }

    state.document = writeFavoritesDocument(state.directories, state.document);
    state.dirty = false;
    return state.document;
}

export function getCharacterFavorite(target, params) {
    const { state, autoFlush } = coerceState(target);
    const favorite = resolveCharacterFavoriteInState(state, params || {});

    if (autoFlush) {
        flushFavoritesState(state);
    }

    return favorite;
}

export function setCharacterFavorite(target, { avatar = '', sharedCharacterKey = '', value = false }) {
    const { state, autoFlush } = coerceState(target);
    const normalizedKeys = getNormalizedCharacterFavoriteKeys({ avatar, sharedCharacterKey });
    const primaryTarget = getPrimaryCharacterFavoriteTarget(normalizedKeys);

    if (!primaryTarget.key) {
        if (autoFlush) {
            flushFavoritesState(state);
        }
        return false;
    }

    setCharacterFavoriteInDocument(state, primaryTarget.mapKey, primaryTarget.key, value === true);
    markCharacterMigrated(state, primaryTarget.mapKey, primaryTarget.key);

    if (primaryTarget.mapKey === 'bySharedKey' && normalizedKeys.avatar) {
        setCharacterFavoriteInDocument(state, 'byAvatar', normalizedKeys.avatar, false);
        markCharacterMigrated(state, 'byAvatar', normalizedKeys.avatar);
    }

    if (autoFlush) {
        flushFavoritesState(state);
    }

    return value === true;
}

export function moveAvatarFavorite(target, { oldAvatar = '', newAvatar = '' }) {
    const { state, autoFlush } = coerceState(target);
    const normalizedOldAvatar = String(oldAvatar || '').trim();
    const normalizedNewAvatar = String(newAvatar || '').trim();

    if (!normalizedOldAvatar || !normalizedNewAvatar || normalizedOldAvatar === normalizedNewAvatar) {
        if (autoFlush) {
            flushFavoritesState(state);
        }
        return;
    }

    const favoriteMap = state.document.characters.byAvatar;
    const migrationMap = state.document.migrated.characters.byAvatar;

    if (favoriteMap[normalizedOldAvatar] === true) {
        favoriteMap[normalizedNewAvatar] = true;
        delete favoriteMap[normalizedOldAvatar];
        state.dirty = true;
    }

    if (migrationMap[normalizedOldAvatar] === true && migrationMap[normalizedNewAvatar] !== true) {
        migrationMap[normalizedNewAvatar] = true;
        state.dirty = true;
    }

    if (migrationMap[normalizedOldAvatar] === true) {
        delete migrationMap[normalizedOldAvatar];
        state.dirty = true;
    }

    if (autoFlush) {
        flushFavoritesState(state);
    }
}

export function getGroupFavorite(target, { id = '', legacyFavorite = false }) {
    const { state, autoFlush } = coerceState(target);
    const favorite = resolveGroupFavoriteInState(state, { id, legacyFavorite });

    if (autoFlush) {
        flushFavoritesState(state);
    }

    return favorite;
}

export function setGroupFavorite(target, { id = '', value = false }) {
    const { state, autoFlush } = coerceState(target);
    const normalizedId = String(id || '').trim();

    if (!normalizedId) {
        if (autoFlush) {
            flushFavoritesState(state);
        }
        return false;
    }

    if (value === true) {
        if (state.document.groups[normalizedId] !== true) {
            state.document.groups[normalizedId] = true;
            state.dirty = true;
        }
    } else if (state.document.groups[normalizedId] === true) {
        delete state.document.groups[normalizedId];
        state.dirty = true;
    }

    if (state.document.migrated.groups[normalizedId] !== true) {
        state.document.migrated.groups[normalizedId] = true;
        state.dirty = true;
    }

    if (autoFlush) {
        flushFavoritesState(state);
    }

    return value === true;
}

export function getLegacyCharacterFavoriteState(card) {
    return Boolean(card?.data?.extensions?.fav ?? card?.fav ?? false);
}

export function clearCharacterFavoriteState(card) {
    if (!isPlainObject(card)) {
        return card;
    }

    card.fav = false;
    card.data = isPlainObject(card.data) ? card.data : {};
    card.data.extensions = isPlainObject(card.data.extensions) ? card.data.extensions : {};
    card.data.extensions.fav = false;
    return card;
}
