import { afterAll, beforeAll, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../public/script.js', () => ({
    eventSource: { on: jest.fn() },
    event_types: { CHAT_CHANGED: 'chat_changed' },
}));

jest.unstable_mockModule('../public/scripts/i18n.js', () => ({
    t: strings => Array.isArray(strings) ? strings.join('') : String(strings),
    translate: value => value,
}));

jest.unstable_mockModule('../public/scripts/stmb-popups.js', () => ({
    closeActiveMemoryPreviewPopups: jest.fn(),
    showFailedAIResponsePopup: jest.fn(),
}));

jest.unstable_mockModule('../public/scripts/stmb-scene.js', () => ({
    buildStmbSceneContext: () => ({}),
    getStmbChatKey: () => 'migration-test',
}));

jest.unstable_mockModule('../public/scripts/utils.js', () => ({
    escapeHtml: value => String(value),
}));

let finishRunningJob;
let getStmbJobStoreSnapshot;
let enqueueStmbJob;
let registerStmbJobExecutor;
let updateStmbJobsForLorebookReference;

beforeAll(async () => {
    const stmbJobs = await import('../public/scripts/stmb-jobs.js');
    ({
        enqueueStmbJob,
        getStmbJobStoreSnapshot,
        registerStmbJobExecutor,
        updateStmbJobsForLorebookReference,
    } = stmbJobs);
    let executionCount = 0;
    registerStmbJobExecutor('memory', () => {
        executionCount++;
        if (executionCount > 1) return undefined;
        return new Promise(resolve => {
            finishRunningJob = resolve;
        });
    });
});

afterAll(() => finishRunningJob?.());

it('migrates current and legacy snapshots when the top-level lorebook already matches', () => {
    const currentSnapshot = {
        canonicalLorebookName: 'Old Book',
        bindings: { member: 'Old Book' },
        members: [{ lorebookName: 'Old Book' }],
    };
    const legacySnapshot = structuredClone(currentSnapshot);

    enqueueStmbJob({
        id: 'running',
        chatKey: 'migration-test',
        type: 'memory',
        lorebookName: 'Old Book',
        payload: {
            lorebookName: 'Old Book',
            multiCharacterSnapshot: currentSnapshot,
        },
    });
    enqueueStmbJob({
        id: 'queued',
        chatKey: 'migration-test',
        type: 'memory',
        lorebookName: 'Old Book',
        payload: {
            lorebookName: 'Old Book',
            manualGroupSnapshot: legacySnapshot,
        },
    });

    expect(updateStmbJobsForLorebookReference({
        operation: 'rename',
        oldName: 'Old Book',
        newName: 'New Book',
    })).toEqual({ updated: 2, canceled: 0 });

    const store = getStmbJobStoreSnapshot('migration-test');
    for (const job of [...store.runningJobs, ...store.queue]) {
        const snapshot = job.payload.multiCharacterSnapshot || job.payload.manualGroupSnapshot;
        expect(job.lorebookName).toBe('New Book');
        expect(job.payload.lorebookName).toBe('New Book');
        expect(snapshot.canonicalLorebookName).toBe('New Book');
        expect(snapshot.bindings.member).toBe('New Book');
        expect(snapshot.members[0].lorebookName).toBe('New Book');
    }
});
