import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scripts/generation-jobs-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');

function setup(jobs = []) {
    const createElement = tag => ({
        tag, children: [], textContent: '', disabled: false, listeners: {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute() {},
        addEventListener(event, callback) { this.listeners[event] = callback; },
        querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); },
    });
    const state = {
        jobs, confirmed: 1, acknowledged: true, calls: [], fail: false,
        account: { patron: false, admin: false, accountsEnabled: true },
        limits: { concurrent: 1, outstanding: 3, standardConcurrent: 1, patronConcurrent: 4 },
    };
    const context = vm.createContext({
        document: { createElement }, AbortSignal,
        getRequestHeaders: () => ({}),
        t: (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
        POPUP_RESULT: { AFFIRMATIVE: 1 }, POPUP_TYPE: { TEXT: 1 },
        Popup: { show: { confirm: async () => state.confirmed } },
        callGenericPopup: root => { state.root = root; },
        fetch: async () => {
            state.calls.push('load');
            return { ok: !state.fail, json: async () => ({ jobs: state.jobs, account: state.account, limits: state.limits, serverTime: 100_000, staleAfterMs: 45_000 }) };
        },
        cancelGenerationWithConfirmation: async id => { state.calls.push(id); return state.acknowledged; },
    });
    vm.runInContext(source, context);
    state.open = () => context.openGenerationJobs();
    state.text = () => {
        const text = element => element.textContent + '\n' + element.children.map(text).join('\n');
        return text(state.root);
    };
    state.buttons = label => state.root.querySelectorAll('button').filter(button => button.textContent === label);
    return state;
}

test('account dialog explains occupied slots, stale activity, and entitlement exceptions', async () => {
    const state = setup([
        { id: 'old', state: 'running', createdAt: 0, updatedAt: 0 },
        { id: 'waiting', state: 'queued', createdAt: 90_000, updatedAt: 99_000 },
        { id: 'stopping', state: 'cancel_requested', createdAt: 90_000, updatedAt: 99_000 },
    ]);
    await state.open();
    assert.match(state.text(), /Patron: No/);
    assert.match(state.text(), /Patrons: 4 concurrent/);
    assert.match(state.text(), /Concurrent slots occupied: 2 \/ 1/);
    assert.match(state.text(), /Queued: 1. Cancellation requested: 1/);
    assert.match(state.text(), /limit is reached/);
    assert.match(state.text(), /Time since requested: 0 h 1 min 40 s/);
    assert.equal(state.text().match(/No recent activity/g).length, 1);
    assert.equal(state.buttons('Cancel').length, 2);
    state.account = { patron: true, admin: true, accountsEnabled: true };
    state.limits.concurrent = 4;
    await state.buttons('Refresh')[0].listeners.click();
    assert.match(state.text(), /Patron: Yes/);
    assert.match(state.text(), /Administrators receive/);
    assert.doesNotMatch(state.text(), /limit is reached/);
    state.account.accountsEnabled = false;
    state.jobs = [];
    await state.buttons('Refresh')[0].listeners.click();
    assert.match(state.text(), /Accounts are disabled/);
    assert.match(state.text(), /no active generation jobs/);
});

test('cancellation requires confirmation, targets one job, and refreshes authoritative state', async () => {
    const state = setup([{ id: 'selected', state: 'running', createdAt: 0, updatedAt: 99_000 }]);
    await state.open();
    state.confirmed = 0;
    await state.buttons('Cancel')[0].listeners.click();
    assert.deepEqual(state.calls, ['load']);
    state.confirmed = 1;
    state.acknowledged = false;
    await state.buttons('Cancel')[0].listeners.click();
    assert.match(state.text(), /could not be confirmed/);
    assert.deepEqual(state.calls, ['load', 'selected']);
    state.acknowledged = true;
    state.jobs[0].state = 'cancel_requested';
    await state.buttons('Cancel')[0].listeners.click();
    assert.equal(state.buttons('Cancel').length, 0);
    assert.match(state.text(), /about a minute/);
    state.jobs = [];
    await state.buttons('Refresh')[0].listeners.click();
    assert.match(state.text(), /no active generation jobs/);
    state.fail = true;
    await state.buttons('Refresh')[0].listeners.click();
    assert.match(state.text(), /outdated/);
    assert.equal(state.buttons('Refresh')[0].disabled, false);
});
