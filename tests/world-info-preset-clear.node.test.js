import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { removePresetReferences } from '../public/scripts/world-info-locks-policy.js';

const source = fs.readFileSync(new URL('../public/scripts/world-info-locks.js', import.meta.url), 'utf8');
const start = source.indexOf('function activatePreset(');
assert.ok(start >= 0);
const activation = source.slice(start, source.indexOf('async function activatePresetByName(', start));

test('clearing a preset succeeds without refreshing an unavailable catalog', async () => {
    let refreshes = 0;
    let selectedNames;
    const settings = { presetName: 'Old preset' };
    const context = vm.createContext({
        clearTimeout() {},
        getPresetContextKey: () => 'synthetic-chat',
        refreshStandaloneUniverses: async () => { refreshes++; return false; },
        getContextLock: () => '',
        getPresetEligibleNames: () => [],
        applyWorldInfoPresetSelection: names => { selectedNames = names; },
        settings,
        saveSettingsDebounced() {},
        renderPresetSelect() {},
    });
    vm.runInContext('let contextRefreshTimer = null; let contextRefreshPromise; let presetApplicationPromise; let presetApplicationVersion = 0;' + activation, context);

    assert.equal(await vm.runInContext('activatePreset(null)', context), true);
    assert.equal(refreshes, 0);
    assert.deepEqual(Array.from(selectedNames), []);
    assert.equal(settings.presetName, '');
});

for (const hasDefault of [true, false]) {
    test(`deleting a preset falls back to ${hasDefault ? 'the default' : 'no preset'}`, async () => {
        const deleted = { name: 'deleted' };
        const fallback = { name: 'default' };
        const settings = {
            presetName: deleted.name, presetList: [deleted, fallback],
            globalDefaultPreset: hasDefault ? fallback.name : deleted.name,
            characterLocks: {}, characterLockIds: {}, groupLocks: {},
        };
        let chatLock = deleted.name;
        let applied;
        const context = vm.createContext({
            settings, removePresetReferences,
            t: strings => strings.join(''), Popup: { show: { confirm: async () => true } },
            getCurrentPreset: () => deleted,
            getChatLock: () => chatLock, getContextLock: () => chatLock,
            setChatLock: async name => { chatLock = name; return true; },
            findPreset: name => settings.presetList.find(preset => preset.name === name),
            activatePreset: async preset => { applied = preset; settings.presetName = preset?.name || ''; return true; },
            saveSettingsDebounced() {}, renderPresetSelect() {}, showNotification() {},
        });
        vm.runInContext(source.slice(source.indexOf('async function applyLocksForCurrentContext('), source.indexOf('function scheduleContextRefresh(')), context);
        vm.runInContext(source.slice(source.indexOf('async function deleteCurrentPreset('), source.indexOf('async function importBundledBooks(')), context);
        await context.deleteCurrentPreset();
        assert.equal(applied, hasDefault ? fallback : null);
        assert.equal(chatLock, '');
        assert.equal(settings.presetList.includes(deleted), false);
    });
}
