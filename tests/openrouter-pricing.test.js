import { beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../public/scripts/i18n.js', () => ({
    getCurrentLocale: () => 'en-US',
    translate: text => text,
    t: (strings, ...values) => strings.reduce((result, part, index) => result + part + (values[index] ?? ''), ''),
}));

let formatOpenRouterPricePerMillion;
let getOpenRouterPricingDisplay;

beforeAll(async () => {
    ({ formatOpenRouterPricePerMillion, getOpenRouterPricingDisplay } = await import('../public/scripts/openrouter-pricing.js'));
});

describe('OpenRouter pricing display', () => {
    it('shows separate input and output prices per million tokens', () => {
        expect(getOpenRouterPricingDisplay({
            prompt: '0.000003',
            completion: '0.000015',
        }, 'en-US')).toEqual({
            text: 'Input $3 / Output $15 per 1M tokens',
            tooltip: '',
        });

        expect(formatOpenRouterPricePerMillion('0.000000125', 'en-US')).toBe('0.125');
    });

    it('handles free and invalid pricing without inverse calculations', () => {
        expect(getOpenRouterPricingDisplay({ prompt: '0', completion: '0' }, 'en-US').text).toBe('Free');
        expect(getOpenRouterPricingDisplay({ prompt: 'invalid', completion: '0' }, 'en-US').text).toBe('Unknown');
    });

    it('lists threshold and UTC pricing overrides while inheriting omitted rates', () => {
        const display = getOpenRouterPricingDisplay({
            prompt: '0.000003',
            completion: '0.000015',
            overrides: [
                {
                    min_prompt_tokens: 200000,
                    prompt: '0.000006',
                    completion: '0.0000225',
                },
                {
                    utc_start: 1630,
                    utc_end: 30,
                    prompt: '0.0000015',
                },
            ],
        }, 'en-US');

        expect(display.tooltip).toBe([
            'Conditional pricing overrides:',
            'More than 200,000 input tokens: Input $6 / Output $22.5 per 1M tokens',
            'From 16:30 to 00:30 UTC: Input $1.5 / Output $15 per 1M tokens',
        ].join('\n'));
    });
});
