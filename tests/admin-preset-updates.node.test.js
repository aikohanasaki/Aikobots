import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import { createHook } from 'node:async_hooks';
import { getPendingPresetUpdate, processPresetUpdate, sanitizePublishedPreset } from '../src/admin-preset-updates.js';
import { setConfigFilePath } from '../src/util.js';

function preset(temperature = 0.7) {
    return {
        temperature,
        prompts: [{ identifier: 'main', role: 'system', content: 'A sample prompt.', system_prompt: true }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    };
}

function setup(t) {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-preset-update-'));
    t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
    const directories = {};
    for (const name of ['admin', 'user']) {
        directories[name] = { root: path.join(dataRoot, name), openAI_Settings: path.join(dataRoot, name, 'presets') };
        fs.mkdirSync(directories[name].openAI_Settings, { recursive: true });
    }
    const saveSource = value => fs.writeFileSync(path.join(directories.admin.openAI_Settings, 'Aikobots.json'), JSON.stringify(value));
    saveSource(preset());
    const run = (action, body = {}, user = 'user', options = {}) => processPresetUpdate(action, directories[user], body, { dataRoot, ...options });
    return { dataRoot, directories, saveSource, run, pending: () => getPendingPresetUpdate(directories.user, dataRoot) };
}

test('publication allowlists nested prompt data and excludes connection/extension fields', () => {
    const source = preset();
    source.proxy_password = 'sample-credential';
    source.custom_include_headers = 'sample-header';
    source.openai_model = 'sample-model';
    source.chat_completion_source = 'custom';
    source.custom_url = 'https://example.invalid';
    source.openrouter_providers = ['sample-provider'];
    source.extensions = { sample: true };
    source.prompts[0].extra = { sample: true };
    source.prompt_order.push({ character_id: 42, order: [] });
    assert.deepEqual(sanitizePublishedPreset(source), preset());
    for (const invalid of [null, [], {}, { ...preset(), temperature: 'bad' }, { ...preset(), prompt_order: [] }]) {
        assert.throws(() => sanitizePublishedPreset(invalid), { status: 400 });
    }
    source.prompts[0].position = 'before';
    assert.equal(sanitizePublishedPreset(source).prompts[0].position, 'before');
    const bundled = JSON.parse(fs.readFileSync(new URL('../default/content/presets/openai/Aikobots.json', import.meta.url), 'utf8'));
    assert.equal(sanitizePublishedPreset(bundled).prompts.length, bundled.prompts.length);
});

test('release snapshot is immutable; acceptance is retryable until completed; skips are per release', async t => {
    const env = setup(t);
    const release = await env.run('publish', {}, 'admin');
    env.saveSource(preset(1.2));
    assert.deepEqual(env.pending(), release);
    assert.equal(fs.existsSync(path.join(env.directories.user.openAI_Settings, 'Aikobots.json')), false);
    await assert.rejects(env.run('accept', { id: release.id, complete: true }), { status: 409 });
    const accepted = await env.run('accept', release);
    assert.equal(accepted.preset.temperature, 0.7);
    assert.equal(accepted.created, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(env.directories.user.openAI_Settings, 'Aikobots.json'))), preset());
    assert.deepEqual(env.pending(), release);
    const retried = await env.run('accept', release);
    assert.equal(retried.preset.temperature, 0.7);
    assert.equal(retried.created, true);
    await env.run('accept', { id: release.id, complete: true });
    assert.equal(env.pending(), null);
    assert.deepEqual(await env.run('accept', release), { handled: true });
    const newer = await env.run('publish', {}, 'admin');
    assert.equal((await env.run('accept', newer)).created, false);
    await assert.rejects(env.run('skip', release), { status: 409 });
    await env.run('skip', newer);
    assert.equal(env.pending(), null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(env.directories.user.openAI_Settings, 'Aikobots.json'))).temperature, 1.2);
    assert.deepEqual(env.pending(), null);
});

test('failed writes and rejected active sessions leave the offer pending', async t => {
    const env = setup(t);
    const release = await env.run('publish', {}, 'admin');
    const blockedPath = path.join(env.directories.user.openAI_Settings, 'Aikobots.json');
    fs.mkdirSync(blockedPath);
    await assert.rejects(env.run('accept', release));
    assert.deepEqual(env.pending(), release);
    fs.rmdirSync(blockedPath);
    await assert.rejects(env.run('accept', release, 'user', { assertAllowed: async () => { throw new Error('inactive'); } }), /inactive/);
    assert.equal(fs.existsSync(blockedPath), false);
    await env.run('accept', release);
    await env.run('accept', { ...release, complete: true });
    assert.equal(env.pending(), null);
});

test('concurrent workers serialize pushes and reject superseded decisions', async t => {
    const env = setup(t);
    const moduleUrl = new URL('../src/admin-preset-updates.js', import.meta.url).href;
    const script = `import { processPresetUpdate } from ${JSON.stringify(moduleUrl)}; const [directories, dataRoot] = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(await processPresetUpdate('publish', directories, {}, { dataRoot })));`;
    const worker = async () => JSON.parse((await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([env.directories.admin, env.dataRoot])])).stdout);
    const releases = await Promise.all([worker(), worker()]);
    const latest = env.pending();
    assert.notEqual(releases[0].id, releases[1].id);
    const stale = releases.find(release => release.id !== latest.id);
    await assert.rejects(env.run('accept', stale), { status: 409 });
    const decisions = await Promise.all([env.run('skip', latest), env.run('accept', latest)]);
    assert.ok(decisions.every(result => result.handled || result.id === latest.id));
    assert.equal(env.pending(), null);
});

test('preset endpoints enforce admin access, validate requests, and serialize ordinary saves', async t => {
    const env = setup(t);
    const originalRoot = globalThis.DATA_ROOT;
    const originalContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
    const originalScaffoldRoot = globalThis.DEFAULT_SCAFFOLD_ROOT;
    globalThis.DATA_ROOT = env.dataRoot;
    globalThis.DEFAULT_CONTENT_ROOT = path.resolve('default/content');
    globalThis.DEFAULT_SCAFFOLD_ROOT = path.resolve('default/scaffold');
    t.after(() => {
        globalThis.DATA_ROOT = originalRoot;
        globalThis.DEFAULT_CONTENT_ROOT = originalContentRoot;
        globalThis.DEFAULT_SCAFFOLD_ROOT = originalScaffoldRoot;
    });
    setConfigFilePath(path.resolve('config.yaml'));
    const { default: express } = await import('express');
    const { router } = await import('../src/endpoints/presets.js');
    const { router: settingsRouter } = await import('../src/endpoints/settings.js');
    const { getUserDirectories } = await import('../src/users.js');
    env.directories.user = { ...getUserDirectories('user'), ...env.directories.user };
    for (const directory of Object.values(env.directories.user)) fs.mkdirSync(directory, { recursive: true });
    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
        const admin = request.headers['x-test-admin'] === 'yes';
        request.user = { profile: { admin, handle: admin ? 'admin' : 'user' }, directories: env.directories[admin ? 'admin' : 'user'] };
        request.activeSessionOperation = { assertAllowed: async () => {} };
        next();
    });
    app.use('/api/presets', router);
    app.use('/api/settings', settingsRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const post = (route, body, admin = false) => fetch(`http://127.0.0.1:${server.address().port}/api/presets/${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-test-admin': admin ? 'yes' : 'no' }, body: JSON.stringify(body),
    });
    assert.equal((await post('admin-update/publish', {})).status, 403);
    const published = await post('admin-update/publish', {}, true);
    assert.equal(published.status, 200);
    const release = await published.json();
    assert.equal((await post('admin-update/accept', { id: 3 })).status, 400);
    assert.equal((await post('admin-update/skip', { id: 'stale' })).status, 409);
    const responses = await Promise.all([
        post('admin-update/accept', release),
        post('save', { apiId: 'openai', name: 'Aikobots', preset: preset(1.1) }),
    ]);
    assert.ok(responses.every(response => response.status === 200));
    const saved = JSON.parse(fs.readFileSync(path.join(env.directories.user.openAI_Settings, 'Aikobots.json')));
    assert.ok([0.7, 1.1].includes(saved.temperature));
    await env.run('skip', release);
    const statePath = path.join(env.directories.user.root, 'admin-preset-update-state.json');
    const state = fs.readFileSync(statePath, 'utf8');
    const settingsPost = (route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/settings/${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    // Clean up the real endpoint's ten-minute backup throttle after this test.
    const saveTimers = [];
    const timerHook = createHook({ init(_id, type, _trigger, resource) {
        if (type === 'Timeout') saveTimers.push(resource);
    } }).enable();
    t.after(() => { timerHook.disable(); saveTimers.forEach(clearTimeout); });
    assert.equal((await settingsPost('save', { username: 'Saved', oai_settings: { preset_settings_openai: 'Personal' } })).status, 200);
    timerHook.disable();
    const snapshotName = 'settings_user_example.json';
    fs.writeFileSync(path.join(env.directories.user.backups, snapshotName), JSON.stringify({ username: 'Restored', oai_settings: { preset_settings_openai: 'Personal' } }));
    assert.equal((await settingsPost('restore-snapshot', { name: snapshotName })).status, 204);
    assert.equal(JSON.parse(fs.readFileSync(path.join(env.directories.user.root, 'settings.json'))).username, 'Restored');
    assert.equal(fs.readFileSync(statePath, 'utf8'), state);
    assert.equal(env.pending(), null);
});

/** Run the browser coordinator with only its UI/network dependencies stubbed. */
function browser(answer, active = true, saved = true, created = false) {
    const calls = [];
    const source = fs.readFileSync(new URL('../public/scripts/admin-preset-updates.js', import.meta.url), 'utf8');
    const context = {
        eventSource: {}, event_types: {}, getRequestHeaders: () => ({}), isActiveSessionLocked: false,
        oai_settings: { preset_settings_openai: active ? 'Aikobots' : 'Personal' },
        openai_setting_names: { Aikobots: 2 },
        $: selector => ({ val: value => {
            assert.equal(selector, '#settings_preset_openai');
            assert.equal(value, 2);
            calls.push('select');
        } }),
        onSettingsPresetChange: async () => { calls.push('apply'); },
        saveSettings: async () => { calls.push('save'); return saved; },
        getPresetManager: () => ({ updateList: (_name, _preset, options) => calls.push(`list:${options.select}`) }),
        Popup: { show: { confirm: async () => answer } }, POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0 },
        t: parts => parts.join(''), toastr: { error: () => calls.push('error') },
        fetch: async (url, options) => {
            calls.push(`${url.split('/').at(-1)}:${JSON.parse(options.body).complete || false}`);
            return { ok: true, json: async () => ({ id: 'release', preset: preset(), created }) };
        },
    };
    vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nthis.offer = async () => { pendingRelease = { id: "release" }; await offerUpdate(); };', context);
    return { calls, offer: context.offer };
}

test('browser accepts active presets only after apply and successful settings save', async () => {
    const active = browser(1);
    await active.offer();
    assert.deepEqual(active.calls, ['accept:false', 'list:false', 'select', 'apply', 'save', 'accept:true']);
    const failed = browser(1, true, false);
    await failed.offer();
    assert.deepEqual(failed.calls, ['accept:false', 'list:false', 'select', 'apply', 'save', 'error']);
});

test('browser selects and applies a created preset, including after reload; failed saves do not complete', async () => {
    for (const saved of [true, false]) {
        const created = browser(1, false, saved, true);
        await created.offer();
        assert.deepEqual(created.calls, ['accept:false', 'list:false', 'select', 'apply', 'save', saved ? 'accept:true' : 'error']);
    }
});

test('browser preserves inactive settings, persists No, and ignores dismissal', async () => {
    const inactive = browser(1, false);
    await inactive.offer();
    assert.deepEqual(inactive.calls, ['accept:false', 'list:false', 'accept:true']);
    const skipped = browser(0);
    await skipped.offer();
    assert.deepEqual(skipped.calls, ['skip:false']);
    const dismissed = browser(null);
    await dismissed.offer();
    assert.deepEqual(dismissed.calls, []);
});

test('admin must save generation edits before publishing; connection edits are excluded', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/admin-preset-updates.js', import.meta.url), 'utf8');
    const calls = [];
    let click;
    const button = { addEventListener: (_event, handler) => { click = handler; } };
    const context = {
        document: { getElementById: () => button }, eventSource: { on: () => {} }, event_types: {},
        oai_settings: { preset_settings_openai: 'Aikobots', temp_openai: 1, openai_model: 'user-model' },
        openai_settings: [preset()], openai_setting_names: { Aikobots: 0 },
        settingsToUpdate: { temperature: ['', 'temp_openai', false, false], openai_model: ['', 'openai_model', false, true] },
        lodash: { isEqual: isDeepStrictEqual }, t: parts => parts.join(''),
        toastr: { info: () => calls.push('save-first'), success: () => calls.push('published') },
        Popup: { show: { confirm: async () => 1 } }, POPUP_RESULT: { AFFIRMATIVE: 1 },
        getRequestHeaders: () => ({}), fetch: async () => ({ ok: true, json: async () => ({ id: 'new' }) }),
    };
    vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\ninitAdminPresetUpdates();', context);
    await click();
    assert.deepEqual(calls, ['save-first']);
    context.oai_settings.temp_openai = 0.7;
    await click();
    assert.deepEqual(calls, ['save-first', 'published']);
});

test('normal preset application awaits subscribers and preserves connection fields', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/openai.js', import.meta.url), 'utf8');
    const start = source.indexOf('export function onSettingsPresetChange()');
    const end = source.indexOf('\nfunction getMaxContextOpenAI', start);
    const events = [];
    const pushed = { ...preset(), openai_model: 'other-model' };
    const context = {
        structuredClone,
        oai_settings: { preset_settings_openai: 'Personal', temp_openai: 1, openai_model: 'my-model' },
        openai_settings: [pushed], openai_setting_names: { Aikobots: 0 },
        settingsToUpdate: { temperature: ['#temperature', 'temp_openai', false, false], openai_model: ['#model', 'openai_model', false, true], prompts: ['', 'prompts', false, false], prompt_order: ['', 'prompt_order', false, false] },
        event_types: { OAI_PRESET_CHANGED_BEFORE: 'before', OAI_PRESET_CHANGED_AFTER: 'after', PRESET_CHANGED: 'changed' },
        eventSource: { emit: async name => { await new Promise(resolve => setTimeout(resolve, 1)); events.push(name); } },
        saveOpenAIPreset: () => {}, saveSettingsDebounced: () => events.push('schedule-save'),
        $: () => ({ find: () => ({ text: () => 'Aikobots' }), val() { return this; }, prop() { return this; }, trigger() { return this; } }),
    };
    vm.runInNewContext(source.slice(start, end).replace('export ', '') + '\nthis.apply = onSettingsPresetChange;', context);
    await context.apply();
    assert.deepEqual(events, ['before', 'schedule-save', 'after', 'changed']);
    assert.equal(context.oai_settings.openai_model, 'my-model');
    assert.equal(context.oai_settings.preset_settings_openai, 'Aikobots');
    assert.equal(context.oai_settings.temp_openai, 0.7);
    assert.deepEqual(context.oai_settings.prompts, pushed.prompts);
    assert.deepEqual(context.oai_settings.prompt_order, pushed.prompt_order);
});

test('updating or adding an inactive preset never selects it or triggers change', () => {
    const source = fs.readFileSync(new URL('../public/scripts/preset-manager.js', import.meta.url), 'utf8');
    const start = source.indexOf('    updateList(name, preset,');
    const end = source.indexOf('\n    /**', start);
    const options = [];
    const context = { $: (selector, properties) => properties ?? { append: option => options.push(option) } };
    vm.runInNewContext(`this.Manager = class { ${source.slice(start, end)} };`, context);
    const manager = new context.Manager();
    const data = { presets: [preset()], preset_names: { Aikobots: 0 } };
    manager.getPresetList = () => data;
    manager.isKeyedApi = () => false;
    manager.updateList('Aikobots', preset(0.8), { select: false });
    assert.equal(data.presets[0].temperature, 0.8);
    manager.updateList('New', preset(0.9), { select: false });
    assert.equal(data.presets[1].temperature, 0.9);
    assert.equal(data.preset_names.New, 1);
    assert.equal(options.length, 1);
    assert.equal(options[0].selected, undefined);
});
