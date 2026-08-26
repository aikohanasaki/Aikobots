export const ELECTRONHUB_IMAGE_SIZES = Object.freeze([
    '256x256',
    '512x512',
    '1024x1024',
    '1792x1024',
    '1024x1792',
]);

/**
 * Normalize an Electron Hub model-list response.
 * @param {any} payload Model-list response payload
 * @returns {any[]} Models in the response
 */
export function getElectronHubModels(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    return Array.isArray(payload?.data) ? payload.data : [];
}

/**
 * Get the selected Electron Hub model's advertised image sizes.
 * @param {any} model Electron Hub model metadata
 * @returns {string[]} Advertised sizes, or the documented API sizes as a fallback
 */
export function getElectronHubImageSizes(model) {
    const sizes = Array.isArray(model?.sizes)
        ? model.sizes.filter(size => typeof size === 'string' && /^[1-9]\d*x[1-9]\d*$/.test(size))
        : [];

    return sizes.length > 0 ? sizes : [...ELECTRONHUB_IMAGE_SIZES];
}

/**
 * Find the available image size closest to a requested resolution.
 * @param {number} width Requested width
 * @param {number} height Requested height
 * @param {string[]} sizes Available image sizes
 * @returns {string|null} Closest valid size
 */
export function getClosestElectronHubSize(width, height, sizes) {
    const targetWidth = Number(width);
    const targetHeight = Number(height);

    if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
        return null;
    }

    const targetArea = targetWidth * targetHeight;
    const closest = (Array.isArray(sizes) ? sizes : []).reduce((best, size) => {
        if (typeof size !== 'string') {
            return best;
        }

        const match = /^(\d+)x(\d+)$/.exec(size);
        if (!match) {
            return best;
        }

        const sizeWidth = Number(match[1]);
        const sizeHeight = Number(match[2]);
        if (sizeWidth <= 0 || sizeHeight <= 0) {
            return best;
        }

        const diff = Math.abs((sizeWidth * sizeHeight) - targetArea);
        return diff < best.diff ? { size, diff } : best;
    }, { size: null, diff: Infinity });

    return closest.size;
}
