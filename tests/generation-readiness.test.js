import { describe, expect, it } from '@jest/globals';

import { createGenerationReadinessSignal, waitForGenerationReadiness } from '../public/scripts/generation-readiness.js';

describe('generation readiness', () => {
    it('waits for durable admission without a fixed timeout', async () => {
        const signal = createGenerationReadinessSignal();
        let generationId = '';
        const waiting = waitForGenerationReadiness({
            isActive: () => true,
            getGenerationId: () => generationId,
            signal,
        });
        let settled = false;
        void waiting.then(() => { settled = true; });

        await Promise.resolve();
        expect(settled).toBe(false);
        generationId = 'generation-id';
        signal.notify();

        await expect(waiting).resolves.toBe('generation-id');
    });

    it('releases switching when preparation ends without creating a job', async () => {
        const signal = createGenerationReadinessSignal();
        let active = true;
        const waiting = waitForGenerationReadiness({
            isActive: () => active,
            getGenerationId: () => '',
            signal,
        });

        active = false;
        signal.notify();

        await expect(waiting).resolves.toBe('');
    });
});
