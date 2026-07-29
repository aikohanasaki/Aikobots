import { jest } from '@jest/globals';

const getStringHash = jest.fn(text => String(text || '').length);
jest.unstable_mockModule('../public/scripts/utils.js', () => ({ getStringHash }));

const {
    migrateStmbPromptDefaults,
    syncStmbLocalizedPromptFields,
} = await import('../public/scripts/stmb-prompt-default-migration.js');

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

    test('switches unchanged built-ins to the active locale and preserves user edits', () => {
        const records = {
            builtIn: { prompt: 'English built-in' },
            edited: { prompt: 'User-authored prompt' },
        };
        const english = {
            builtIn: { prompt: 'English built-in' },
            edited: { prompt: 'English editable built-in' },
        };
        const german = {
            builtIn: { prompt: 'Deutsche Vorgabe' },
            edited: { prompt: 'Deutsche bearbeitbare Vorgabe' },
        };

        const first = syncStmbLocalizedPromptFields(records, german, english, null, 'de-de');
        expect(first.changed).toBe(true);
        expect(records).toEqual({
            builtIn: { prompt: 'Deutsche Vorgabe' },
            edited: { prompt: 'User-authored prompt' },
        });

        const french = {
            builtIn: { prompt: 'Préréglage français' },
            edited: { prompt: 'Préréglage français modifiable' },
        };
        const second = syncStmbLocalizedPromptFields(records, french, english, first.state, 'fr-fr');
        expect(second.changed).toBe(true);
        expect(records).toEqual({
            builtIn: { prompt: 'Préréglage français' },
            edited: { prompt: 'User-authored prompt' },
        });
    });

    test('tracks prompt and response-format fields independently', () => {
        const records = {
            side: { prompt: 'Custom prompt', responseFormat: 'English format' },
        };
        const english = {
            side: { prompt: 'English prompt', responseFormat: 'English format' },
        };
        const japanese = {
            side: { prompt: '日本語プロンプト', responseFormat: '日本語形式' },
        };

        const result = syncStmbLocalizedPromptFields(
            records,
            japanese,
            english,
            null,
            'ja-jp',
            ['prompt', 'responseFormat'],
        );

        expect(records).toEqual({
            side: { prompt: 'Custom prompt', responseFormat: '日本語形式' },
        });
        expect(result.state.signatures.side.prompt).toBeUndefined();
        expect(result.state.signatures.side.responseFormat).toBeDefined();
    });

    test('ignores malformed persisted signature metadata', () => {
        const records = { builtIn: { prompt: 'English built-in' } };

        expect(() => syncStmbLocalizedPromptFields(
            records,
            { builtIn: { prompt: 'Deutsche Vorgabe' } },
            { builtIn: { prompt: 'English built-in' } },
            { locale: 'en', signatures: { builtIn: 'invalid' } },
            'de-de',
        )).not.toThrow();
        expect(records.builtIn.prompt).toBe('Deutsche Vorgabe');
    });
});
