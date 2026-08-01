import { getCurrentLocale, t, translate } from './i18n.js';

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Formats an OpenRouter per-token price as USD per million tokens.
 * @param {unknown} price Per-token price from OpenRouter
 * @param {string|string[]} [locales] Locale passed to Intl.NumberFormat
 * @returns {string|null} Formatted per-million price, or null for invalid input
 */
export function formatOpenRouterPricePerMillion(price, locales = getCurrentLocale()) {
    if ((typeof price !== 'string' && typeof price !== 'number') || price === '') {
        return null;
    }

    const perMillion = Number(price) * TOKENS_PER_MILLION;

    if (!Number.isFinite(perMillion) || perMillion < 0) {
        return null;
    }

    return new Intl.NumberFormat(locales, { maximumFractionDigits: 6 }).format(perMillion);
}

/**
 * Builds localized display text and conditional-pricing details for an OpenRouter model.
 * @param {Record<string, any>|null|undefined} pricing OpenRouter pricing object
 * @param {string|string[]} [locales] Locale passed to Intl.NumberFormat
 * @returns {{text: string, tooltip: string}} Display price and optional override tooltip
 */
export function getOpenRouterPricingDisplay(pricing, locales = getCurrentLocale()) {
    const inputPrice = formatOpenRouterPricePerMillion(pricing?.prompt, locales);
    const outputPrice = formatOpenRouterPricePerMillion(pricing?.completion, locales);

    if (inputPrice === null || outputPrice === null) {
        return { text: translate('Unknown'), tooltip: '' };
    }

    const text = Number(pricing.prompt) === 0 && Number(pricing.completion) === 0
        ? translate('Free')
        : formatInputOutputPrice(inputPrice, outputPrice);
    const overrides = Array.isArray(pricing.overrides)
        ? pricing.overrides.filter(override => override && (override.prompt !== undefined || override.completion !== undefined))
        : [];

    if (overrides.length === 0) {
        return { text, tooltip: '' };
    }

    const formatter = new Intl.NumberFormat(locales);
    const lines = overrides.map(override => {
        const conditions = [];
        const minimumPromptTokens = typeof override.min_prompt_tokens === 'string' || typeof override.min_prompt_tokens === 'number'
            ? Number(override.min_prompt_tokens)
            : NaN;

        if (Number.isFinite(minimumPromptTokens) && minimumPromptTokens >= 0) {
            conditions.push(t`More than ${formatter.format(minimumPromptTokens)} input tokens`);
        }

        const utcStart = formatUtcTime(override.utc_start);
        const utcEnd = formatUtcTime(override.utc_end);
        if (utcStart && utcEnd) {
            conditions.push(t`From ${utcStart} to ${utcEnd} UTC`);
        }

        const condition = conditions.join(', ') || translate('Other conditions');
        const overrideInput = formatOpenRouterPricePerMillion(override.prompt ?? pricing.prompt, locales);
        const overrideOutput = formatOpenRouterPricePerMillion(override.completion ?? pricing.completion, locales);
        const rate = overrideInput === null || overrideOutput === null
            ? translate('Unknown')
            : formatInputOutputPrice(overrideInput, overrideOutput);

        return t`${condition}: ${rate}`;
    });

    return {
        text,
        tooltip: [translate('Conditional pricing overrides:'), ...lines].join('\n'),
    };
}

/**
 * Formats localized input and output pricing.
 * @param {string} inputPrice Input price per million tokens
 * @param {string} outputPrice Output price per million tokens
 * @returns {string} Localized pricing label
 */
function formatInputOutputPrice(inputPrice, outputPrice) {
    return t`Input $${inputPrice} / Output $${outputPrice} per 1M tokens`;
}

/**
 * Formats an HHMM value from OpenRouter as a UTC time.
 * @param {unknown} value HHMM time
 * @returns {string|null} Formatted time, or null for invalid input
 */
function formatUtcTime(value) {
    if ((typeof value !== 'string' && typeof value !== 'number') || value === '' || !Number.isInteger(Number(value))) {
        return null;
    }

    const numericValue = Number(value);
    const hours = Math.floor(numericValue / 100);
    const minutes = numericValue % 100;

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
