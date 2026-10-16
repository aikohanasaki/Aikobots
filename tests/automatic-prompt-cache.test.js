import { beforeEach, describe, expect, it } from '@jest/globals';
import {
    createAutomaticCacheComparison,
    finishAutomaticCacheComparison,
    normalizeAutomaticCacheUsage,
    resetAutomaticCacheComparisons,
} from '../public/scripts/automatic-prompt-cache.js';

const request = (sequence, overrides = {}) => createAutomaticCacheComparison({
    requestId: `request-${sequence}`, chatScope: 'chat:synthetic', provider: 'claude',
    model: 'claude-sonnet-4-6', ttl: '5m', directAnthropic: true, ...overrides,
});
const usage = (reads, writes5m) => ({ input: 10, reads, writes5m, writes1h: 0 });

describe('automatic prompt cache warnings', () => {
    beforeEach(resetAutomaticCacheComparisons);

    it('normalizes final usage without treating total prompt tokens as regular input', () => {
        expect(normalizeAutomaticCacheUsage({ usage: {
            prompt_tokens: 3000, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 2000 },
        } }, '5m')).toEqual({ input: null, reads: 0, writes5m: 2000, writes1h: 0 });
        expect(normalizeAutomaticCacheUsage({ message: { usage: {
            input_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1200 },
        } } }, '1h')).toEqual({ input: 20, reads: 0, writes5m: 0, writes1h: 1200 });
        expect(normalizeAutomaticCacheUsage({ usage: { prompt_tokens: 1000 } }, '5m')).toBeNull();
    });

    it('excludes only the initial successful request and counts later zero-read writes', () => {
        expect(finishAutomaticCacheComparison(request(1), usage(0, 1000), 'claude-sonnet-4-6')).toBeNull();
        expect(finishAutomaticCacheComparison(request(2), usage(0, 1100), 'claude-sonnet-4-6')).toBeNull();
        expect(finishAutomaticCacheComparison(request(3), usage(0, 1200), 'claude-sonnet-4-6')).toBe('low_reuse');
        expect(finishAutomaticCacheComparison(request(4), usage(0, 1300), 'claude-sonnet-4-6')).toBeNull();
    });

    it('warns on cost when reuse is above the low-reuse threshold', () => {
        const hourly = { ...usage(300, 0), writes1h: 1000 };
        finishAutomaticCacheComparison(request(1, { ttl: '1h' }), null, 'claude-sonnet-4-6');
        expect(finishAutomaticCacheComparison(request(2, { ttl: '1h' }), hourly, 'claude-sonnet-4-6')).toBeNull();
        expect(finishAutomaticCacheComparison(request(3, { ttl: '1h' }), hourly, 'claude-sonnet-4-6')).toBe('cost');
    });

    it('does not infer prices for routed providers and ignores stale completions', () => {
        finishAutomaticCacheComparison(request(1, { provider: 'openrouter' }), usage(0, 1000), 'anthropic/claude-sonnet-4-6');
        const older = request(2, { provider: 'openrouter' });
        const newer = request(3, { provider: 'openrouter' });
        expect(finishAutomaticCacheComparison(newer, usage(500, 1000), 'anthropic/claude-sonnet-4-6')).toBeNull();
        expect(finishAutomaticCacheComparison(older, usage(0, 1000), 'anthropic/claude-sonnet-4-6')).toBeNull();
        expect(finishAutomaticCacheComparison(request(4, { provider: 'openrouter' }), usage(500, 1000), 'anthropic/claude-sonnet-4-6')).toBeNull();
        expect(finishAutomaticCacheComparison(request(5, { provider: 'electronhub' }), usage(0, 1000), 'claude-sonnet-4-6')).toBeNull();
    });

    it('does not use direct Anthropic rates for a proxy or unknown response model', () => {
        const hourly = { ...usage(300, 0), writes1h: 1000 };
        finishAutomaticCacheComparison(request(1, { ttl: '1h', directAnthropic: false }), hourly, 'claude-sonnet-4-6');
        finishAutomaticCacheComparison(request(2, { ttl: '1h', directAnthropic: false }), hourly, 'claude-sonnet-4-6');
        expect(finishAutomaticCacheComparison(request(3, { ttl: '1h', directAnthropic: false }), hourly, 'claude-sonnet-4-6')).toBeNull();
    });

    it('uses the response model read rate instead of the requested alias', () => {
        finishAutomaticCacheComparison(request(1), usage(0, 1000), 'claude-opus-5-5');
        expect(finishAutomaticCacheComparison(request(2), usage(265, 1000), 'claude-opus-5-5')).toBeNull();
        expect(finishAutomaticCacheComparison(request(3), usage(265, 1000), 'claude-opus-5-5')).toBeNull();
    });
});
