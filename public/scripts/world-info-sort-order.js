export const DEFAULT_WORLD_INFO_SORT_ORDER = '0';
export const SEARCH_WORLD_INFO_SORT_ORDER = '14';

const PERSISTENT_WORLD_INFO_SORT_ORDERS = new Set([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '11',
    '12',
    '13',
    '15',
    '16',
]);

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Normalizes a persistent lorebook sort option.
 * @param {unknown} value Sort option to normalize
 * @param {unknown} [fallback=null] Fallback used when the value is invalid
 * @returns {string|null} Canonical option value or null when neither value is valid
 */
export function normalizeWorldInfoSortOrder(value, fallback = null) {
    if (value !== null && value !== undefined) {
        const normalized = String(value);
        if (PERSISTENT_WORLD_INFO_SORT_ORDERS.has(normalized)) {
            return normalized;
        }
    }

    if (fallback !== null && fallback !== undefined) {
        const normalizedFallback = String(fallback);
        if (PERSISTENT_WORLD_INFO_SORT_ORDERS.has(normalizedFallback)) {
            return normalizedFallback;
        }
    }

    return null;
}

/**
 * Reads the display sort stored in lorebook JSON metadata.
 * @param {unknown} data Lorebook JSON data
 * @param {unknown} [fallback=DEFAULT_WORLD_INFO_SORT_ORDER] Fallback sort option
 * @returns {string} Canonical persistent sort option
 */
export function getWorldInfoSortOrder(data, fallback = DEFAULT_WORLD_INFO_SORT_ORDER) {
    const storedValue = isPlainObject(data)
        && isPlainObject(data.extensions)
        && isPlainObject(data.extensions.aikobots)
        ? data.extensions.aikobots.sort_order
        : null;

    return normalizeWorldInfoSortOrder(storedValue, fallback) ?? DEFAULT_WORLD_INFO_SORT_ORDER;
}

/**
 * Writes the display sort to lorebook JSON metadata without replacing existing containers.
 * @param {unknown} data Lorebook JSON data to update
 * @param {unknown} value Persistent sort option
 * @returns {string} Canonical stored sort option
 */
export function setWorldInfoSortOrder(data, value) {
    if (!isPlainObject(data)) {
        throw new TypeError('Lorebook data must be a plain object.');
    }

    const normalized = normalizeWorldInfoSortOrder(value);
    if (normalized === null) {
        throw new TypeError('Lorebook sort order is invalid.');
    }

    const hasExtensions = Object.hasOwn(data, 'extensions');
    if (hasExtensions && !isPlainObject(data.extensions)) {
        throw new TypeError('Lorebook extensions metadata must be a plain object.');
    }

    const extensions = hasExtensions ? data.extensions : {};
    const hasAikobots = Object.hasOwn(extensions, 'aikobots');
    if (hasAikobots && !isPlainObject(extensions.aikobots)) {
        throw new TypeError('Lorebook Aikobots metadata must be a plain object.');
    }

    const aikobots = hasAikobots ? extensions.aikobots : {};
    aikobots.sort_order = normalized;

    if (!hasAikobots) {
        extensions.aikobots = aikobots;
    }
    if (!hasExtensions) {
        data.extensions = extensions;
    }

    return normalized;
}
