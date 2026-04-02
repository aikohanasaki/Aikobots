import {
    buildSidePromptMacroSuggestion,
    collectTemplateRuntimeMacros,
    parseSidePromptCommandInput,
} from '../public/scripts/stmb-sideprompt-macros.js';

describe('stmb sideprompt macros', () => {
    it('parses quoted name, runtime macros, and range', () => {
        const parsed = parseSidePromptCommandInput('"Status" {{topic}}="trust" 10-20');

        expect(parsed.name).toBe('Status');
        expect(parsed.runtimeMacros).toEqual({ '{{topic}}': 'trust' });
        expect(parsed.range).toBe('10-20');
    });

    it('collects unresolved runtime macros from prompt, response format, and title override', () => {
        const macros = collectTemplateRuntimeMacros({
            prompt: 'Hello {{topic}}',
            responseFormat: 'Use {{format}}',
            settings: { lorebook: { entryTitleOverride: '{{topic}} report' } },
        });

        expect(macros).toEqual(['{{topic}}', '{{format}}']);
    });

    it('builds macro suggestion text without clobbering prior input', () => {
        const suggestion = buildSidePromptMacroSuggestion('"Status" ', { trailing: '' }, '{{topic}}');
        expect(suggestion).toBe('"Status" {{topic}}=""');
    });
});
