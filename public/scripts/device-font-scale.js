const DEFAULT_FONT_SCALE = 1;
const MIN_FONT_SCALE = 0.5;
const MAX_FONT_SCALE = 1.5;

/**
 * Normalizes a font scale from saved settings or imported themes.
 * @param {unknown} value Candidate font scale.
 * @param {number} fallback Value used when the candidate is invalid.
 * @returns {number} A valid font scale.
 */
function normalizeFontScale(value, fallback) {
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
        return fallback;
    }

    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(Math.max(number, MIN_FONT_SCALE), MAX_FONT_SCALE)
        : fallback;
}

/**
 * Resolves saved desktop/mobile font scales and selects the active device value.
 * @param {{ mobile: boolean, desktopScale: unknown, mobileScale: unknown }} options Device and saved scale values.
 * @returns {{ desktopScale: number, mobileScale: number, effectiveScale: number }} Normalized device scales.
 */
export function resolveDeviceFontScales({ mobile, desktopScale, mobileScale }) {
    const normalizedDesktopScale = normalizeFontScale(desktopScale, DEFAULT_FONT_SCALE);
    const normalizedMobileScale = normalizeFontScale(mobileScale, normalizedDesktopScale);

    return {
        desktopScale: normalizedDesktopScale,
        mobileScale: normalizedMobileScale,
        effectiveScale: mobile ? normalizedMobileScale : normalizedDesktopScale,
    };
}
