import { describe, expect, it } from '@jest/globals';

import { createMacroState, evaluatePromptMacros } from '../src/prompting/macro-evaluator.js';

describe('evaluatePromptMacros variable arithmetic', () => {
    it('treats an unset local variable as zero for incvar/decvar', () => {
        const macroState = createMacroState();

        expect(evaluatePromptMacros('{{incvar::counter}}', {}, { macroState })).toBe('1');
        expect(macroState.localVariables.counter).toBe('1');

        expect(evaluatePromptMacros('{{decvar::counter}}', {}, { macroState })).toBe('0');
        expect(macroState.localVariables.counter).toBe('0');
    });

    it('treats an unset global variable as zero for incglobalvar/decglobalvar', () => {
        const macroState = createMacroState();

        expect(evaluatePromptMacros('{{incglobalvar::counter}}', {}, { macroState })).toBe('1');
        expect(macroState.globalVariables.counter).toBe('1');

        expect(evaluatePromptMacros('{{decglobalvar::counter}}', {}, { macroState })).toBe('0');
        expect(macroState.globalVariables.counter).toBe('0');
    });
});
