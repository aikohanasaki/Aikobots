import { describe, expect, it } from '@jest/globals';

import { LatestTask } from '../public/scripts/util/LatestTask.js';

function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => resolve = resolvePromise);
    return { promise, resolve };
}

describe('LatestTask', () => {
    it('marks replaced tasks stale', async () => {
        const tracker = new LatestTask();
        const first = createDeferred();
        let firstId;
        let secondId;

        const firstTask = tracker.start(async id => {
            firstId = id;
            await first.promise;
        });
        await tracker.start(async id => {
            secondId = id;
        });

        expect(tracker.isLatest(firstId)).toBe(false);
        expect(tracker.isLatest(secondId)).toBe(true);
        first.resolve();
        await firstTask;
    });

    it('waits for a replacement started while waiting', async () => {
        const tracker = new LatestTask();
        const first = createDeferred();
        const second = createDeferred();
        let waitFinished = false;

        const firstTask = tracker.start(async () => first.promise);
        const wait = tracker.wait().then(() => waitFinished = true);
        const secondTask = tracker.start(async () => second.promise);

        first.resolve();
        await firstTask;
        await Promise.resolve();
        expect(waitFinished).toBe(false);

        second.resolve();
        await secondTask;
        await wait;
        expect(waitFinished).toBe(true);
    });
});
