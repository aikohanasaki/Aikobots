import _ from 'lodash';

import { isSecureTemplateLorebookName, resolveLorebookWithMetadata } from './lorebook-repository.js';

const SECURE_LINKED_LOREBOOKS_ERROR_MESSAGE = 'Please ensure all lorebooks to be linked are secure lorebooks.';

function normalizeLinkedLorebooks(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function createLinkedLorebookValidationError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

/**
 * Gets the owner handle for a character card.
 * @param {object|null|undefined} characterCard
 * @returns {string}
 */
export function getCharacterOwnerHandle(characterCard) {
    return String(_.get(characterCard, 'data.extensions.aikobots.owner_handle', '') || '').trim();
}

/**
 * Gets the normalized owner handles for a character card.
 * Falls back to the legacy single-owner field when no owner list exists.
 * @param {object|null|undefined} characterCard
 * @returns {string[]}
 */
export function getCharacterOwnerHandles(characterCard) {
    const ownerHandles = _.get(characterCard, 'data.extensions.aikobots.owner_handles');
    if (Array.isArray(ownerHandles)) {
        return [...new Set(ownerHandles.map(handle => String(handle || '').trim()).filter(Boolean))];
    }

    const ownerHandle = getCharacterOwnerHandle(characterCard);
    return ownerHandle ? [ownerHandle] : [];
}

/**
 * Gets the sharing mode for a character card.
 * @param {object|null|undefined} characterCard
 * @returns {'single'|'shared'}
 */
export function getCharacterSharingMode(characterCard) {
    return _.get(characterCard, 'data.extensions.aikobots.sharing_mode') === 'shared' ? 'shared' : 'single';
}

/**
 * Gets the canonical shared-character key stored on a character card.
 * @param {object|null|undefined} characterCard
 * @returns {string}
 */
export function getCharacterSharedKey(characterCard) {
    return String(_.get(characterCard, 'data.extensions.aikobots.shared_character_key', '') || '')
        .trim()
        .replace(/\.png$/i, '');
}

/**
 * Checks whether the provided user handle is one of the character owners.
 * @param {object|null|undefined} characterCard
 * @param {string} handle
 * @returns {boolean}
 */
export function isCharacterOwner(characterCard, handle) {
    const normalizedHandle = String(handle || '').trim();
    return normalizedHandle ? getCharacterOwnerHandles(characterCard).includes(normalizedHandle) : false;
}

/**
 * Gets the normalized linked lorebook names stored on a character.
 * @param {object|null|undefined} characterCard
 * @returns {string[]}
 */
export function getCharacterLinkedLorebooks(characterCard) {
    return normalizeLinkedLorebooks(_.get(characterCard, 'data.extensions.aikobots.secure_lorebooks', []));
}

/**
 * Returns linked lorebooks that do not resolve to secure storage for the current actor.
 * @param {import('./users.js').User} user
 * @param {object|null|undefined} characterCard
 * @returns {string[]}
 */
export function getInvalidSecureLinkedLorebooks(user, characterCard) {
    return getCharacterLinkedLorebooks(characterCard).filter(name => {
        if (isSecureTemplateLorebookName(name)) {
            return true;
        }
        try {
            const lorebook = resolveLorebookWithMetadata(user, name, {
                storage: 'secure',
                requireManageableSecure: false,
            });
            return lorebook?.metadata?.storage !== 'secure';
        } catch {
            return true;
        }
    });
}

/**
 * Enforces the secure-only linked lorebook rule for owned characters.
 * @param {import('./users.js').User} user
 * @param {object|null|undefined} characterCard
 * @returns {void}
 */
export function validateOwnedCharacterLinkedLorebooks(user, characterCard) {
    if (getCharacterOwnerHandles(characterCard).length === 0) {
        return;
    }

    const invalidLorebooks = getInvalidSecureLinkedLorebooks(user, characterCard);
    if (invalidLorebooks.length) {
        throw createLinkedLorebookValidationError(SECURE_LINKED_LOREBOOKS_ERROR_MESSAGE);
    }
}

/**
 * Enforces the secure-only linked lorebook rule for submitted characters.
 * @param {import('./users.js').User} user
 * @param {object|null|undefined} characterCard
 * @returns {void}
 */
export function validateSubmittedCharacterLinkedLorebooks(user, characterCard) {
    const invalidLorebooks = getInvalidSecureLinkedLorebooks(user, characterCard);
    if (invalidLorebooks.length) {
        throw createLinkedLorebookValidationError(SECURE_LINKED_LOREBOOKS_ERROR_MESSAGE);
    }
}
