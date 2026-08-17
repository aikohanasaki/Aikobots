import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildStmbRetryPayload,
    captureStmbRetryDependents,
    collectStmbCanceledDependents,
    isStmbJobRetryable,
} from '../public/scripts/stmb-job-retry-policy.js';

test('saved memory retries resume post-save without generating a duplicate memory', () => {
    const compiledScene = { metadata: { chatId: 'chat' }, messages: [{ id: 1, mes: 'Scene' }] };
    const payload = buildStmbRetryPayload({
        type: 'memory',
        payload: {
            range: { sceneStart: 1, sceneEnd: 3 },
            compiledScene,
            memoryAssistanceLorebookNames: ['Book', 'Character Book'],
        },
        result: { lorebookName: 'Book', uid: 7 },
    });

    assert.deepEqual(payload.resumePostSaveResult, { lorebookName: 'Book', uid: 7 });
    assert.deepEqual(payload.compiledScene, compiledScene);
    assert.deepEqual(payload.memoryAssistanceLorebookNames, ['Book', 'Character Book']);
});

test('retry-all collects only canceled dependents in original queue order', () => {
    const source = { id: 'memory-1', type: 'memory' };
    const history = [
        { id: 'late', type: 'sidePrompt', state: 'canceled', createdAt: 1, parentJobOrder: 2, dependsOnJobId: 'memory-1', payload: { trigger: 'onAfterMemory' } },
        { id: 'other', type: 'sidePrompt', state: 'canceled', createdAt: 5, dependsOnJobId: 'memory-2', payload: { trigger: 'onAfterMemory' } },
        { id: 'manual', type: 'sidePrompt', state: 'canceled', createdAt: 4, dependsOnJobId: 'memory-1', payload: { trigger: 'manual' } },
        { id: 'completed', type: 'sidePrompt', state: 'completed', createdAt: 3, dependsOnJobId: 'memory-1', payload: { trigger: 'onAfterMemory' } },
        { id: 'early', type: 'sidePromptBatch', state: 'canceled', createdAt: 20, parentJobOrder: 1, payload: { dependsOnJobId: 'memory-1', trigger: 'onAfterMemory' } },
        { id: 'assistance', type: 'memoryAssistance', state: 'canceled', createdAt: 30, parentJobOrder: 3, dependsOnJobId: 'memory-1', payload: { trigger: 'onAfterMemory' } },
    ];

    assert.deepEqual(
        collectStmbCanceledDependents(source, history).map(job => job.id),
        ['early', 'late', 'assistance'],
    );
});

test('failed, blocked, and canceled jobs are retryable', () => {
    for (const state of ['failed', 'blocked', 'canceled']) {
        assert.equal(isStmbJobRetryable({ state }), true);
    }
    assert.equal(isStmbJobRetryable({ state: 'completed' }), false);
    assert.equal(isStmbJobRetryable({ state: 'skipped' }), false);
});

test('individual side-prompt retry drops its failed memory dependency', () => {
    assert.deepEqual(
        buildStmbRetryPayload({
            type: 'sidePrompt',
            payload: { dependsOnJobId: 'failed-memory', templateKey: 'tracker' },
        }),
        { templateKey: 'tracker' },
    );
});

test('retry-all uses the complete carried dependent set when visible history is truncated', () => {
    const source = {
        id: 'memory-1',
        type: 'memory',
        payload: {
            retryAfterMemoryJobs: [
                { id: 'first', type: 'sidePrompt', parentJobOrder: 0, payload: { trigger: 'onAfterMemory' } },
                { id: 'second', type: 'sidePrompt', parentJobOrder: 1, payload: { trigger: 'onAfterMemory' } },
            ],
        },
    };
    const visibleHistory = [
        {
            id: 'second',
            type: 'sidePrompt',
            state: 'canceled',
            parentJobOrder: 1,
            dependsOnJobId: 'memory-1',
            payload: { trigger: 'onAfterMemory' },
        },
    ];

    assert.deepEqual(
        collectStmbCanceledDependents(source, visibleHistory).map(job => job.id),
        ['first', 'second'],
    );
});

test('dependent capture preserves the original complete set across repeated retries', () => {
    const source = {
        id: 'memory-retry',
        type: 'memory',
        payload: {
            retryAfterMemoryJobs: [
                { id: 'original', type: 'sidePrompt', payload: { trigger: 'onAfterMemory' } },
            ],
        },
    };
    const currentQueue = [
        {
            id: 'replacement',
            type: 'sidePrompt',
            dependsOnJobId: 'memory-retry',
            payload: { trigger: 'onAfterMemory' },
        },
    ];

    assert.deepEqual(captureStmbRetryDependents(source, currentQueue).map(job => job.id), ['original']);
});

test('dependent capture is not limited by visible job history size', () => {
    const source = { id: 'memory-1', type: 'memory', payload: {} };
    const queue = Array.from({ length: 25 }, (_, index) => ({
        id: `side-${index}`,
        type: 'sidePrompt',
        parentJobOrder: index,
        dependsOnJobId: 'memory-1',
        payload: { trigger: 'onAfterMemory' },
    }));

    assert.deepEqual(
        captureStmbRetryDependents(source, queue).map(job => job.id),
        queue.map(job => job.id),
    );
});

test('retry memory drops carried dependents while retry-all retains them', () => {
    const source = {
        id: 'memory-1',
        type: 'memory',
        payload: {
            retryAfterMemoryJobs: [
                { id: 'side-1', type: 'sidePrompt', payload: { trigger: 'onAfterMemory' } },
            ],
        },
    };

    assert.equal(buildStmbRetryPayload(source).retryAfterMemoryJobs, undefined);
    assert.equal(buildStmbRetryPayload(source, { includeDependents: true }).retryAfterMemoryJobs.length, 1);
});
