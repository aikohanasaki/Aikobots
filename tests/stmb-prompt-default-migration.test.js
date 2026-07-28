import { jest } from '@jest/globals';

const getStringHash = jest.fn(text => String(text || '').length);
jest.unstable_mockModule('../public/scripts/utils.js', () => ({ getStringHash }));

const { migrateStmbPromptDefaults } = await import('../public/scripts/stmb-prompt-default-migration.js');

describe('STMB built-in prompt migration', () => {
    test('updates legacy defaults while preserving user-edited prompts', () => {
        const legacyPrompt = 'legacy built-in';
        const customPrompt = 'user-edited prompt';
        const doc = {
            version: 1,
            overrides: {
                builtIn: { prompt: legacyPrompt },
                custom: { prompt: customPrompt },
            },
        };
        const signatures = {
            builtIn: `${legacyPrompt.length}:${getStringHash(legacyPrompt)}`,
            custom: `${legacyPrompt.length}:${getStringHash(legacyPrompt)}`,
        };

        expect(migrateStmbPromptDefaults(doc, 2, signatures, {
            builtIn: 'new upstream default',
            custom: 'new upstream custom-key default',
        })).toBe(true);
        expect(doc).toEqual({
            version: 2,
            overrides: {
                builtIn: { prompt: 'new upstream default' },
                custom: { prompt: customPrompt },
            },
        });
    });

    test('does not reapply a completed migration', () => {
        const doc = { version: 2, overrides: { builtIn: { prompt: 'user edit after migration' } } };

        expect(migrateStmbPromptDefaults(doc, 2, {}, {})).toBe(false);
        expect(doc.overrides.builtIn.prompt).toBe('user edit after migration');
    });
});
