import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scripts/stmb-jobs.js', import.meta.url), 'utf8');
const start = source.indexOf('async function executeRunningJob(');
const end = source.indexOf('function finishRunningJob(', start);
assert.ok(start >= 0 && end > start);

test('operation conflicts offer a persistent, keyboard-accessible recovery action', async () => {
    let click;
    let reviewed = false;
    let finished = false;
    let appended;
    const button = { addEventListener: (event, handler) => { assert.equal(event, 'click'); click = handler; } };
    const context = vm.createContext({
        createJobContext: () => ({}),
        getJobTypeLabel: () => 'Memory',
        translate: value => value,
        document: { createElement: tag => { assert.equal(tag, 'button'); return button; } },
        toastr: { error: (message, title, options) => {
            assert.equal(message, 'Memory Books has unresolved work or changed source messages.');
            assert.equal(options.timeOut, 0);
            assert.equal(options.tapToDismiss, false);
            return { find: selector => {
                assert.equal(selector, '.toast-message');
                return { append: element => { appended = element; } };
            } };
        } },
        loadStmb: async () => ({ reviewStmbOperations: async () => { reviewed = true; } }),
        finishRunningJob: () => { finished = true; },
    });
    const run = vm.runInContext(source.slice(start, end).replace("import('./stmb.js')", 'loadStmb()') + '; executeRunningJob', context);
    const job = {};
    await run('chat', {}, job, async () => {
        throw Object.assign(new Error('Conflict'), { type: 'StmbOperationConflict' });
    });
    assert.equal(job.state, 'failed');
    assert.equal(finished, true);
    assert.equal(appended, button);
    assert.equal(button.type, 'button');
    assert.equal(button.textContent, 'Pending Memory Books operations');
    await click();
    assert.equal(reviewed, true);
});
