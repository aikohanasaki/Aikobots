import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const api = fs.readFileSync(new URL('../public/scripts/stmb-api.js', import.meta.url), 'utf8');
const start = api.indexOf('export async function resolveStmbOperation(');
const end = api.indexOf('async function postStmb(', start);
assert.ok(start >= 0 && end > start);

test('recovery preserves safe error classification and renders localized guidance without server details', async () => {
    const errorPayload = { code: 'StmbRecoverySourceChanged', type: 'StmbOperationConflict', message: 'untrusted server text', internal: 'private' };
    const context = vm.createContext({
        translate: value => `localized: ${value}`,
        queueAcknowledgedChatRevisionRequest: async () => ({ response: { ok: false, status: 409 }, errorData: { error: errorPayload } }),
    });
    const { resolveStmbOperation, getStmbRecoveryErrorMessage } = vm.runInContext(
        api.slice(start, end).replaceAll('export ', '') + '; ({ resolveStmbOperation, getStmbRecoveryErrorMessage })', context,
    );
    await assert.rejects(resolveStmbOperation({}, 'operation'), error => {
        assert.equal(error.code, errorPayload.code);
        assert.equal(error.type, errorPayload.type);
        assert.equal(error.status, 409);
        assert.equal(error.internal, undefined);
        assert.equal(error.message.includes(errorPayload.message), false);
        assert.match(getStmbRecoveryErrorMessage(error), /^localized: The source messages/);
        return true;
    });
    const expectations = {
        StmbRecoveryRevisionChanged: /newer saved version/,
        StmbRecoveryProgressChanged: /processed-message marker/,
        StmbRecoveryOperationMissing: /refresh the list/,
        StmbRecoverySavedEntriesChanged: /missing, changed, or incomplete/,
        StmbRecoveryOwnershipUnclear: /cannot safely identify/,
        StmbRecoverySnapshotUnavailable: /no usable restoration snapshot/,
        StmbRecoverySidePromptChanged: /avoid overwriting those edits/,
        StmbRecoveryBookChanged: /avoid overwriting newer edits/,
    };
    for (const [code, expected] of Object.entries(expectations)) {
        assert.match(getStmbRecoveryErrorMessage({ code }), expected);
    }
    assert.match(getStmbRecoveryErrorMessage({ type: 'LorebookCheckoutRequired' }), /Check it out, then retry/);
    for (const type of ['LorebookNotFound', 'LorebookAccessDenied']) {
        assert.match(getStmbRecoveryErrorMessage({ type }), /Check your lorebook access/);
    }
    const fallback = getStmbRecoveryErrorMessage({ code: 'unknown', message: 'untrusted server text' });
    assert.match(fallback, /Some steps may already be saved/);
    assert.equal(fallback.includes('untrusted server text'), false);
});

test('memory save acknowledgements update local effects only for a known current revision', async () => {
    const start = api.indexOf('async function saveStmbOperation(');
    const end = api.indexOf('/**', start + 1);
    assert.ok(start >= 0 && end > start);
    for (const [previousRevision, current, expected, acknowledgedRevision] of [[1, true, true, 2], [7, true, false, 8], [1, false, false, 2], [1, true, false, 9], [0, true, true, 1]]) {
        let dispatching = true;
        let saved = false;
        let mirrored = false;
        let adopted;
        const context = vm.createContext({
            queueAcknowledgedChatRevisionRequest: async factory => {
                const request = factory({ baseRevision: 1, operationId: 'request', saveSessionId: 'session' });
                dispatching = false;
                const data = { previous_revision: previousRevision, chat_revision: acknowledgedRevision };
                adopted = request.onAcknowledged(data, { baseRevision: 1 });
                return { response: { ok: true }, responseData: data };
            },
        });
        const save = vm.runInContext(api.slice(start, end) + '; saveStmbOperation', context);
        const result = await save('save-memory', {}, {
            isCurrent: () => dispatching || current,
            onSaved: () => { saved = true; },
            onAcknowledged: () => { mirrored = true; },
        });
        assert.equal(saved, true);
        assert.equal(mirrored, expected && acknowledgedRevision !== 1);
        assert.equal(adopted, expected);
        assert.equal(result.requiresChatReload, !expected);
    }
});

test('the revision queue applies acknowledged effects before releasing later saves, and can refuse stale adoption', async () => {
    const script = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
    const start = script.indexOf('export function queueAcknowledgedChatRevisionRequest(');
    const end = script.indexOf('function getSyncCurrentChatCooldownSeconds(', start);
    assert.ok(start >= 0 && end > start);
    let revision = 1;
    let marker = 0;
    let dispatched = 0;
    const context = vm.createContext({
        chatRevisionOperationQueue: Promise.resolve(),
        uuidv4: () => 'request',
        getActiveChatRevisionKey: () => 'chat',
        getChatSaveRevision: () => revision,
        getChatSaveSessionId: () => 'session',
        getRequestHeaders: () => ({}),
        CHAT_SAVE_REQUEST_RETRY_DELAY_MS: 0,
        structuredClone,
        console: { debug() {} },
        fetch: async () => ({ ok: true, json: async () => ({ status: 'noop', chat_revision: ++dispatched + 1 }) }),
        adoptChatSaveRevision: ({ incomingRevision, allowAdvance }) => { if (allowAdvance) revision = incomingRevision; },
    });
    const queue = vm.runInContext(script.slice(start, end).replace('export ', '') + '; queueAcknowledgedChatRevisionRequest', context);
    const first = queue(() => ({ url: 'save', body: {}, onAcknowledged: () => { marker = 2; } }));
    const second = queue(({ baseRevision }) => {
        assert.equal(baseRevision, 2);
        assert.equal(marker, 2);
        return { url: 'save', body: {}, onAcknowledged: () => false };
    });
    await Promise.all([first, second]);
    assert.equal(revision, 2);
});

test('memory job cleanup preserves uncertain operations and resumes confirmed saves before generation', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function executeMemoryJob(');
    const end = source.indexOf('async function runMemoryJob(', start);
    assert.ok(start >= 0 && end > start);
    for (const canceled of [true, false]) {
        const job = { payload: {}, sceneContext: { chatRef: {} } };
        const context = vm.createContext({
            runMemoryJob: async () => { job.payload.operationId = 'operation'; throw new Error('generation stopped'); },
            cancelUnstartedStmbOperation: async () => ({ canceled }),
        });
        const run = vm.runInContext(source.slice(start, end) + '; executeMemoryJob', context);
        await assert.rejects(run(job, {}), /generation stopped/);
        assert.equal(job.payload.operationId, canceled ? undefined : 'operation');
    }
    const job = { payload: { operationId: 'operation' }, sceneContext: { chatRef: {} }, lorebookName: 'Book' };
    const context = vm.createContext({
        cancelUnstartedStmbOperation: async () => ({ canceled: false, operation: { state: 'applied' } }),
        runMemoryJob: async () => { assert.equal(job.payload.resumePostSaveResult.memorySaved, true); },
    });
    await vm.runInContext(source.slice(start, end) + '; executeMemoryJob', context)(job, {});
});

test('acknowledged memory progress preserves newer local selections and refuses unsaved progress edits', () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');
    const start = source.indexOf('function applyStmbProgressResult(');
    const end = source.indexOf('/** Finishes UI effects', start);
    assert.ok(start >= 0 && end > start);
    const state = { sceneStart: 3, sceneEnd: 4 };
    let hidden = 0;
    const context = vm.createContext({
        isSceneContextCurrent: () => true,
        getStmbState: () => state,
        applyLoadedChatMessageVisibility: () => { hidden++; },
    });
    const apply = vm.runInContext(source.slice(start, end) + '; applyStmbProgressResult', context);
    const result = { previousProgress: { highest: null, manuallySet: false }, highestMemoryProcessed: 2,
        clearScene: true, sceneStartBefore: 0, sceneEndBefore: 2, hideRanges: [{ start: 0, end: 2 }] };
    assert.equal(apply({}, result), true);
    assert.equal(state.sceneStart, 3);
    assert.equal(state.highestMemoryProcessed, 2);
    assert.equal(hidden, 1);
    state.highestMemoryProcessed = 4;
    assert.equal(apply({}, result), false);
    assert.equal(state.highestMemoryProcessed, 4);
    assert.equal(hidden, 1);
});

