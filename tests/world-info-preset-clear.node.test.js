import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scripts/world-info-locks.js', import.meta.url), 'utf8');
const start = source.indexOf('async function activatePreset(');
const activation = source.slice(start, source.indexOf('async function activatePresetByName(', start));

test('clearing a preset succeeds without refreshing an unavailable catalog', async () => {
    let refreshes = 0;
    let selectedNames;
    const settings = { presetName: 'Old preset' };
    const context = vm.createContext({
        refreshStandaloneUniverses: async () => { refreshes++; return false; },
        getContextLock: () => '',
        getPresetEligibleNames: () => [],
        applyWorldInfoPresetSelection: names => { selectedNames = names; },
        settings,
        saveSettingsDebounced() {},
        renderPresetSelect() {},
    });
    vm.runInContext(activation, context);

    assert.equal(await vm.runInContext('activatePreset(null)', context), true);
    assert.equal(refreshes, 0);
    assert.deepEqual(Array.from(selectedNames), []);
    assert.equal(settings.presetName, '');
});
