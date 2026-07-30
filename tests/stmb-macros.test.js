import { beforeAll, describe, expect, it, jest } from '@jest/globals';

const macroCallbacks = new Map();
const loadWorldInfo = jest.fn(async () => ({ entries: {} }));

jest.unstable_mockModule('../public/script.js', () => ({
    chat_metadata: {},
    eventSource: { on: jest.fn() },
    event_types: {
        CHAT_CHANGED: 'chat_changed',
        WORLDINFO_UPDATED: 'worldinfo_updated',
    },
}));

jest.unstable_mockModule('../public/scripts/i18n.js', () => ({
    translate: value => value,
}));

jest.unstable_mockModule('../public/scripts/macros.js', () => ({
    MacrosParser: {
        registerMacro: jest.fn((name, callback) => macroCallbacks.set(name, callback)),
    },
}));

jest.unstable_mockModule('../public/scripts/stmb-core.js', () => ({
    STMB_MANAGED_FLAG: 'stmbManaged',
}));

jest.unstable_mockModule('../public/scripts/stmb-summary.js', () => ({
    getEntrySummaryTier: entry => entry.tier,
}));

jest.unstable_mockModule('../public/scripts/world-info.js', () => ({
    METADATA_KEY: 'world_info',
    loadWorldInfo,
    world_names: ['Active'],
}));

let refreshStmbMacroCache;

beforeAll(async () => {
    const stmbMacros = await import('../public/scripts/stmb-macros.js');
    refreshStmbMacroCache = stmbMacros.refreshStmbMacroCache;
    stmbMacros.initStmbMacros({
        getSettings: () => ({ moduleSettings: { manualModeEnabled: true } }),
        getManualLorebook: () => 'Active',
    });
});

describe('refreshStmbMacroCache', () => {
    it('preserves active counts when an unrelated lorebook is updated', async () => {
        await refreshStmbMacroCache('Active', {
            entries: {
                1: { stmbManaged: true, tier: 2 },
            },
        });

        await refreshStmbMacroCache('Other', { entries: {} });

        expect(macroCallbacks.get('memtier2')()).toBe('1');
    });

    it('does not let an unrelated update cancel an active refresh', async () => {
        let resolveLoad;
        loadWorldInfo.mockImplementationOnce(() => new Promise(resolve => {
            resolveLoad = resolve;
        }));

        const activeRefresh = refreshStmbMacroCache('Active');
        await refreshStmbMacroCache('Other', { entries: {} });
        resolveLoad({
            entries: {
                1: { stmbManaged: true, tier: 3 },
            },
        });
        await activeRefresh;

        expect(macroCallbacks.get('memtier3')()).toBe('1');
    });
});
