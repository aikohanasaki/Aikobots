import { describe, expect, it } from '@jest/globals';

import { createGenerationReadinessSignal, waitForGenerationReadiness, waitForGenerationSettlement } from '../public/scripts/generation-readiness.js';

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

    it('bounds readiness when generation preparation does not report a terminal state', async () => {
        const signal = createGenerationReadinessSignal();
        const waiting = waitForGenerationReadiness({
            isActive: () => true,
            getGenerationId: () => '',
            signal,
            timeout: 10,
        });

        await expect(waiting).resolves.toBe('');
    });

    it('waits for foreground rejection and group cleanup under one deadline', async () => {
        let finishForeground;
        let groupActive = true;
        const foregroundPromise = new Promise((_, reject) => { finishForeground = reject; });
        const waiting = waitForGenerationSettlement({
            foregroundPromise,
            isGroupActive: () => groupActive,
            timeout: 100,
            interval: 1,
        });

        finishForeground(new Error('parked'));
        groupActive = false;

        await expect(waiting).resolves.toBe(true);
    });

    it('times out while group cleanup remains active', async () => {
        const waiting = waitForGenerationSettlement({
            foregroundPromise: Promise.resolve(),
            isGroupActive: () => true,
            timeout: 10,
            interval: 1,
        });

        await expect(waiting).resolves.toBe(false);
    });
});
