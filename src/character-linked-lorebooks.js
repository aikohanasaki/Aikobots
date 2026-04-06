import _ from 'lodash';

import { resolveLorebookWithMetadata } from './lorebook-repository.js';

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
    if (!getCharacterOwnerHandle(characterCard)) {
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
