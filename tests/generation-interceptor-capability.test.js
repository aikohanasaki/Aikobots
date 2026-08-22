import { jest } from '@jest/globals';

import { areGenerationInterceptorsServerCompatible } from '../public/scripts/generation-interceptor-capability.js';
import { canUseVectorServerGenerationPreparation } from '../public/scripts/extensions/vectors/capability.js';

describe('server generation interceptor capabilities', () => {
    it('requires a successful declared capability check for a loaded server interceptor', () => {
        const interceptor = jest.fn();
        const capability = jest.fn(() => true);
        const manifest = {
            generate_interceptor: 'interceptor',
            generation_interceptor_mode: 'server-prompt',
            generation_interceptor_capability_check: 'capability',
        };

        expect(areGenerationInterceptorsServerCompatible([manifest], { interceptor, capability })).toBe(true);
        expect(areGenerationInterceptorsServerCompatible([manifest], { interceptor })).toBe(false);
        expect(areGenerationInterceptorsServerCompatible([manifest], { interceptor, capability: () => false })).toBe(false);
        expect(areGenerationInterceptorsServerCompatible([manifest], { interceptor, capability: () => { throw new Error('failed'); } })).toBe(false);
    });

    it('does not require server capability from unloaded or client-preflight interceptors', () => {
        const unloaded = { generate_interceptor: 'missing' };
        const preflight = {
            generate_interceptor: 'preflight',
            generation_interceptor_mode: 'client-preflight',
        };

        expect(areGenerationInterceptorsServerCompatible([unloaded, preflight], { preflight: jest.fn() })).toBe(true);
    });
});

describe('vectors server generation capability', () => {
    it('allows disabled vectors and supported chat-only configurations', () => {
        expect(canUseVectorServerGenerationPreparation({ source: 'webllm' })).toBe(true);
        for (const source of ['transformers', 'openai', 'togetherai', 'electronhub', 'openrouter', 'cohere', 'mistral', 'nomicai']) {
            expect(canUseVectorServerGenerationPreparation({ enabled_chats: true, source })).toBe(true);
        }
    });

    it('rejects vector behavior that still requires client preparation', () => {
        expect(canUseVectorServerGenerationPreparation({ enabled_chats: true, source: 'webllm' })).toBe(false);
        expect(canUseVectorServerGenerationPreparation({ enabled_chats: true, enabled_files: true })).toBe(false);
        expect(canUseVectorServerGenerationPreparation({ enabled_chats: true, enabled_world_info: true })).toBe(false);
        expect(canUseVectorServerGenerationPreparation({ enabled_chats: true, summarize: true, summarize_sent: true })).toBe(false);
    });
});
