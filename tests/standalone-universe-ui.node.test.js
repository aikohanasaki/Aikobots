import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { getWithdrawnUniverseNames } from '../public/scripts/world-info-locks-policy.js';

const source = fs.readFileSync(new URL('../public/scripts/world-info.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function rememberStandaloneUniverses('), source.indexOf('export function applyWorldInfoPresetSelection(')).replace(/^export /gm, '');
const refreshStart = source.indexOf('export async function updateWorldInfoList(');
const refresh = source.slice(refreshStart, source.indexOf('\n/**', refreshStart)).replace('export ', '');

function createContext(requestWorldInfoList) {
    const notifications = [];
    const context = vm.createContext({
        selected_world_info: ['Gone', 'Other'],
        world_info: { standaloneUniverses: ['Gone'], globalSelect: ['Gone', 'Other'] },
        standaloneUniverseNames: ['Gone'], world_names: ['Other'], universeRefreshPromise: null,
        getWithdrawnUniverseNames, requestWorldInfoList,
        normalizeWorldInfoItems: data => data.world_info_items,
        setWorldInfoItems: items => { context.world_names = items.map(item => item.name); },
        refreshWorldInfoSelectors() {}, saveSettingsDebounced() {},
        eventSource: { emit() {} }, event_types: {},
        $: () => ({ find: () => ({ text: () => '' }) }),
        t: (parts, ...values) => parts.reduce((result, part, i) => result + part + (values[i] ?? ''), ''),
        toastr: { warning: (message, _title, options) => notifications.push({ message, options }) },
    });
    vm.runInContext(helpers + '\n' + refresh, context);
    return { context, notifications };
}

test('offline withdrawal is announced once and removes only the withdrawn global selection', () => {
    const { context, notifications } = createContext();
    context.catalog = { standalone_universe_names: [] };
    vm.runInContext('reconcileStandaloneUniverses(catalog); reconcileStandaloneUniverses(catalog)', context);
    assert.deepEqual(Array.from(context.selected_world_info), ['Other']);
    assert.deepEqual(Array.from(context.world_info.globalSelect), ['Other']);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].options.escapeHtml, true);
    assert.match(notifications[0].message, /Gone.*withdrawn/u);
});

test('failed or incomplete catalogs preserve selections and do not announce withdrawal', async () => {
    for (const result of [null, { world_info_items: [{ name: 'Other' }] }, new Error('synthetic network failure')]) {
        const { context, notifications } = createContext(async () => {
            if (result instanceof Error) throw result;
            return result;
        });
        await vm.runInContext('refreshStandaloneUniverses()', context);
        assert.deepEqual(Array.from(context.selected_world_info), ['Gone', 'Other']);
        assert.equal(notifications.length, 0);
    }
});

test('a stale preset explains a skipped universe on each explicit application without modifying the preset', async () => {
    const { context, notifications } = createContext(async () => ({ world_info_items: [{ name: 'Other' }], standalone_universe_names: [] }));
    context.selected_world_info = ['Other'];
    context.preset = { worldList: ['Gone', 'Other'], standaloneUniverses: ['Gone'] };
    await vm.runInContext('refreshStandaloneUniverses(preset.worldList, preset.standaloneUniverses)', context);
    await vm.runInContext('refreshStandaloneUniverses(preset.worldList, preset.standaloneUniverses)', context);
    assert.equal(notifications.length, 2);
    assert.deepEqual(context.preset.worldList, ['Gone', 'Other']);
    assert.deepEqual(Array.from(context.selected_world_info), ['Other']);
});

test('list refresh applies items without a catalog and reports catalog availability', async () => {
    for (const catalog of [undefined, [], 'invalid']) {
        const { context, notifications } = createContext(async () => ({
            world_info_items: [{ name: 'New book' }], standalone_universe_names: catalog,
        }));
        let refreshed = false;
        context.refreshWorldInfoSelectors = () => { refreshed = true; };
        assert.equal(await vm.runInContext('updateWorldInfoList()', context), Array.isArray(catalog));
        assert.deepEqual(Array.from(context.world_names), ['New book']);
        assert.equal(refreshed, true);
        if (!Array.isArray(catalog)) {
            assert.deepEqual(Array.from(context.selected_world_info), ['Gone', 'Other']);
            assert.equal(notifications.length, 0);
        }
    }
});
