import { describe, expect, it } from '@jest/globals';

import {
    extractPromptCacheUsage,
    extractPromptCacheUsageFromSseEvent,
    normalizePromptCacheUsage,
} from '../prompt-cache-usage.js';

describe('prompt cache usage', () => {
    it.each([
        ['OpenAI-compatible', { usage: { prompt_tokens_details: { cached_tokens: 1200 } } }, 1200],
        ['OpenAI Responses', { usage: { input_tokens_details: { cached_tokens: 1300 } } }, 1300],
        ['Claude and ElectronHub', { usage: { cache_read_input_tokens: 1400 } }, 1400],
        ['Claude streaming', { message: { usage: { cache_read_input_tokens: 1500 } } }, 1500],
        ['Gemini', { usageMetadata: { cachedContentTokenCount: 1600 } }, 1600],
    ])('extracts %s usage', (_provider, payload, expected) => {
        expect(extractPromptCacheUsage(payload)).toEqual({
            cachedInputTokens: expected,
            scope: 'request',
        });
    });

    it('distinguishes an explicit cache miss from unavailable usage', () => {
        expect(extractPromptCacheUsage({ usage: { prompt_tokens_details: { cached_tokens: 0 } } })).toEqual({
            cachedInputTokens: 0,
            scope: 'request',
        });
        expect(extractPromptCacheUsage({ usage: {} })).toBeNull();
        expect(normalizePromptCacheUsage(-1)).toBeNull();
        expect(normalizePromptCacheUsage(null)).toBeNull();
        expect(normalizePromptCacheUsage(false)).toBeNull();
    });

    it('extracts usage from the final SSE event without treating DONE as usage', () => {
        expect(extractPromptCacheUsageFromSseEvent('event: message_start\ndata: {"message":{"usage":{"cache_read_input_tokens":321}}}')).toEqual({
            cachedInputTokens: 321,
            scope: 'request',
        });
        expect(extractPromptCacheUsageFromSseEvent('data: [DONE]')).toBeNull();
    });
});
