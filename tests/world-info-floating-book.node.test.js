import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { URL } from 'node:url';

const source = fs.readFileSync(new URL('../public/scripts/world-info.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const showEditor = section('export async function showWorldEditor(', '/**\n * Loads world info').replace('export ', '');
const loadWorld = section('export async function loadWorldInfo(', 'export async function updateWorldInfoList').replace('export ', '');

test('hidden rows and missing identities are inert; visible UID zero opens the editor', () => {
    const calls = [];
    const context = vm.createContext({
        translate: text => text,
        openWorldInfoEditor: (...args) => calls.push(args),
        document: { createElement: tag => ({
            tag, children: [], events: {}, classList: { add() {} },
            append(child) { this.children.push(child); },
            addEventListener(type, callback) { this.events[type] = callback; },
        }) },
    });
    vm.runInContext(`var controller = {${section('        createEntryRow(row)', '        createChatRow(row)')}};`, context);
    const create = context.controller.createEntryRow;
    for (const row of [{ hidden: true, book: 'Synthetic', uid: 0 }, { hidden: true }, { book: 'Synthetic', uid: null }]) {
        const element = create(row);
        assert.equal(element.tag, 'div');
        assert.equal(element.events.click, undefined);
    }
    const visible = create({ hidden: false, book: 'Synthetic', uid: 0, title: 'Synthetic entry' });
    assert.equal(visible.tag, 'button');
    assert.equal(visible.type, 'button');
    visible.events.click();
    assert.deepEqual(calls, [['Synthetic', 0]]);
});

test('target navigation bypasses cached access and rejects missing or hidden entries', async () => {
    const displayed = [];
    const warnings = [];
    const context = vm.createContext({
        worldEditorLoadToken: 0, navigation_option: { none: 'none' },
        hideWorldEditor: async () => {},
        translate: text => text, toastr: { warning: text => warnings.push(text) },
        displayWorldEntries: (...args) => displayed.push(args),
        loadWorldInfo: async (_name, options) => {
            assert.equal(options.forceReload, true);
            return context.data;
        },
    });
    vm.runInContext(showEditor, context);
    for (const data of [null, { entries: {} }, { entries: { 0: { hidden: true } } }]) {
        context.data = data;
        await context.showWorldEditor('Synthetic', 0);
    }
    assert.equal(displayed.length, 0);
    assert.deepEqual(warnings, Array(3).fill('Lorebook entry is unavailable.'));
    context.data = { entries: { 0: { uid: 0 } } };
    await context.showWorldEditor('Synthetic', 0);
    assert.equal(displayed[0][2], 0);
    assert.equal(displayed[0][5], true);

    let resolve;
    let started;
    const loading = new Promise(done => { started = done; });
    context.loadWorldInfo = () => new Promise(done => { resolve = done; started(); });
    const pending = context.showWorldEditor('Synthetic', 0);
    await loading;
    context.worldEditorLoadToken++;
    resolve(context.data);
    await pending;
    assert.equal(displayed.length, 1, 'superseded loads must not render');
});

test('fresh loading never falls back to cached data after access is denied', async () => {
    let requests = 0;
    const cached = { entries: { 0: { uid: 0 } } };
    const context = vm.createContext({
        worldInfoCache: new Map([['Synthetic', cached]]),
        getRequestHeaders: () => ({}), getLorebookStorageForRequest: () => 'secure',
        fetch: async () => { requests++; return { ok: false }; },
    });
    vm.runInContext(loadWorld, context);
    assert.equal(await context.loadWorldInfo('Synthetic'), cached);
    assert.equal(requests, 0);
    assert.equal(await context.loadWorldInfo('Synthetic', { forceReload: true }), null);
    assert.equal(requests, 1);
});

test('group states survive rebuilds and reloads without initialization writes', () => {
    const storage = new Map();
    let writes = 0;
    const context = vm.createContext({
        FLOATING_BOOK_STORAGE_KEYS: { groupStates: 'states' },
        accountStorage: {
            getItem: key => storage.get(key),
            setItem: (key, value) => { writes++; storage.set(key, value); },
        },
    });
    vm.runInContext(section('function readFloatingBookGroupStates()', 'function getFloatingBookDeviceProfile()'), context);
    const controller = { settings: { rememberGroups: true }, groupStates: context.readFloatingBookGroupStates() };
    const drawer = () => ({ isConnected: true, addEventListener(_type, callback) { this.toggle = callback; } });
    let first = drawer();
    context.bindFloatingBookGroupState(first, 'Synthetic', controller);
    assert.equal(first.open, true);
    first.toggle();
    assert.equal(writes, 0);
    first.open = false;
    first.toggle();
    assert.equal(writes, 1);
    controller.groupStates = context.readFloatingBookGroupStates();
    first = drawer();
    context.bindFloatingBookGroupState(first, 'Synthetic', controller);
    assert.equal(first.open, false);
    first.toggle();
    assert.equal(writes, 1);
    const second = drawer();
    context.bindFloatingBookGroupState(second, 'Other', controller);
    assert.equal(second.open, true);
    controller.settings.rememberGroups = false;
    context.bindFloatingBookGroupState(drawer(), 'Synthetic', controller);
    second.open = false;
    second.toggle();
    assert.equal(writes, 1);
    for (const invalid of ['null', '{', '"bad"', '[true]']) {
        storage.set('states', invalid);
        assert.equal(context.readFloatingBookGroupStates().size, 0);
    }
});

test('target UID chooses its sorted editor page, including UID zero', () => {
    const code = section('    const storageKey = \'WI_PerPage\';', '    $(\'#world_info_pagination\').pagination({');
    for (const [uid, page] of [[0, 1], [26, 3]]) {
        const context = vm.createContext({
            navigation: uid, navigation_option: { previous: 'previous' },
            accountStorage: { getItem: () => '10' },
            getDataArray: () => Array.from({ length: 30 }, (_, uid) => ({ uid })),
        });
        assert.equal(vm.runInContext(`${code}\nstartPage;`, context), page);
    }
});

test('target rendering expands, focuses and highlights only the requested row', () => {
    const actions = [];
    const control = {
        attr(name, value) { assert.equal(name, 'tabindex'); assert.equal(value, '-1'); return this; },
        trigger: event => actions.push(event),
    };
    const target = {
        length: 1, 0: { scrollIntoView: () => actions.push('scroll') },
        find: selector => selector === '.inline-drawer-icon' ? control : { is: () => false },
    };
    const context = vm.createContext({
        openTarget: true, navigation: 0, flashOnNav: true,
        worldEntriesList: { find: selector => { assert.equal(selector, '.world_entry[uid="0"]'); return target; } },
        flashHighlight: () => actions.push('highlight'),
    });
    const code = section('                if (openTarget) {', '\n            } catch (error)');
    vm.runInContext(`function renderTarget() { ${code} } renderTarget(); renderTarget();`, context);
    assert.deepEqual(actions, ['click', 'scroll', 'focus', 'highlight']);
});
