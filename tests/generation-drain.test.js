import { expect, it, jest } from '@jest/globals';

import { drainGenerationTasks, startTrackedGenerationTask } from '../src/generation-drain.js';

it('drains owned generation work and rejects new work after shutdown starts', async () => {
    let finishGeneration;
    const activeGeneration = new Promise(resolve => { finishGeneration = resolve; });
    const startActiveGeneration = jest.fn(() => activeGeneration);
    const startLateGeneration = jest.fn(() => Promise.resolve());

    expect(startTrackedGenerationTask(startActiveGeneration)).toBeInstanceOf(Promise);
    const drain = drainGenerationTasks();
    expect(startTrackedGenerationTask(startLateGeneration)).toBeNull();

    let drained = false;
    void drain.then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    finishGeneration();
    await drain;

    expect(startActiveGeneration).toHaveBeenCalledTimes(1);
    expect(startLateGeneration).not.toHaveBeenCalled();
});
