import { beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../public/script.js', () => ({
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
}));
jest.unstable_mockModule('../../public/scripts/utils.js', () => ({
    getStringHash: text => String(text || '').length,
}));
jest.unstable_mockModule('../../public/scripts/i18n.js', () => ({
    getCurrentLocale: () => 'en',
    translate: value => value,
}));

let duplicateArcPromptPresetFile;
let isRegenerationOnlyPreset;
let listCachedArcPromptPresets;
let selectConsolidationDefaultPresetKey;

beforeAll(async () => {
    ({
        duplicateArcPromptPresetFile,
        isRegenerationOnlyPreset,
        listCachedArcPromptPresets,
        selectConsolidationDefaultPresetKey,
    } = await import('../../public/scripts/stmb-arc-prompt-manager.js'));
});

describe('STMB regeneration-only consolidation preset policy', () => {
    it('marks only the reserved preset and exposes it as a built-in manager item', () => {
        expect(isRegenerationOnlyPreset('arc_regenerate')).toBe(true);
        expect(isRegenerationOnlyPreset('custom-regenerate')).toBe(false);
        expect(listCachedArcPromptPresets().find(item => item.key === 'arc_regenerate')).toMatchObject({
            isBuiltIn: true,
            regenerationOnly: true,
        });
    });

    it('prohibits duplication of the regeneration-only preset', async () => {
        await expect(duplicateArcPromptPresetFile('arc_regenerate')).rejects.toThrow(/cannot be duplicated/i);
    });

    it('never selects regeneration as the ordinary consolidation default', () => {
        const presets = [{ key: 'arc_regenerate' }, { key: 'custom' }, { key: 'arc_default' }];
        expect(selectConsolidationDefaultPresetKey('arc_regenerate', presets)).toBe('arc_default');
        expect(selectConsolidationDefaultPresetKey('custom', presets)).toBe('custom');
        expect(selectConsolidationDefaultPresetKey('', [{ key: 'arc_regenerate' }, { key: 'custom' }])).toBe('custom');
    });
});
