import assert from 'node:assert/strict';
import test from 'node:test';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function loadTransitionModule(label) {
    return await import(`../public/scripts/connection-profile-transition.js?test=${label}-${Date.now()}`);
}

test('generation readiness waits for the current profile transition', async () => {
    const transition = await loadTransitionModule('wait');
    const application = deferred();
    const running = transition.runConnectionProfileTransition('profile-a', () => application.promise);
    let ready = false;
    const waiting = transition.waitForCurrentConnectionProfileTransition().then(() => {
        ready = true;
    });

    await Promise.resolve();
    assert.equal(ready, false);
    assert.equal(transition.isConnectionProfileSettled('profile-a'), false);

    application.resolve('applied');
    assert.equal(await running, 'applied');
    await waiting;
    assert.equal(ready, true);
    assert.equal(transition.isConnectionProfileSettled('profile-a'), true);
});

test('rapid profile changes settle and publish only the latest profile', async () => {
    const transition = await loadTransitionModule('latest');
    const first = deferred();
    const third = deferred();
    const published = [];
    const started = [];
    const firstRun = transition.runConnectionProfileTransition('profile-a', () => {
        started.push('profile-a');
        return first.promise;
    }, async () => published.push('profile-a'));
    const secondRun = transition.runConnectionProfileTransition('profile-b', () => {
        started.push('profile-b');
        return Promise.resolve('middle');
    }, async () => published.push('profile-b'));
    const thirdRun = transition.runConnectionProfileTransition('profile-c', () => {
        started.push('profile-c');
        return third.promise;
    }, async () => published.push('profile-c'));
    let ready = false;
    const waiting = transition.waitForCurrentConnectionProfileTransition().then(() => {
        ready = true;
    });

    await Promise.resolve();
    assert.deepEqual(started, ['profile-a']);

    first.resolve('old');
    assert.equal(await firstRun, null);
    assert.equal(await secondRun, null);
    await Promise.resolve();
    assert.equal(ready, false);
    assert.deepEqual(published, []);
    assert.deepEqual(started, ['profile-a', 'profile-c']);

    third.resolve('new');
    assert.equal(await thirdRun, 'new');
    await waiting;
    assert.equal(transition.isConnectionProfileSettled('profile-a'), false);
    assert.equal(transition.isConnectionProfileSettled('profile-b'), false);
    assert.equal(transition.isConnectionProfileSettled('profile-c'), true);
    assert.deepEqual(published, ['profile-c']);
});

test('a failed latest profile transition leaves readiness rejected and unsettled', async () => {
    const transition = await loadTransitionModule('failure');
    const failure = new Error('test connection failure');
    const running = transition.runConnectionProfileTransition('profile-a', async () => {
        throw failure;
    });

    await assert.rejects(running, failure);
    await assert.rejects(transition.waitForCurrentConnectionProfileTransition(), failure);
    assert.equal(transition.isConnectionProfileSettled('profile-a'), false);
});
