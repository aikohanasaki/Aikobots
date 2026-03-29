import { describe, expect, it } from '@jest/globals';

import { runRegexScript } from '../src/prompting/regex-runtime.js';

describe('runRegexScript regex safety guard', () => {
    it('blocks nested variable quantifier patterns', () => {
        const result = runRegexScript({
            findRegex: '/(a+)+$/',
            replaceString: 'blocked',
        }, 'aaaaa');

        expect(result).toBe('aaaaa');
    });

    it('allows ordinary regex replacements', () => {
        const result = runRegexScript({
            findRegex: '/a+/',
            replaceString: 'ok',
        }, 'aaaaa');

        expect(result).toBe('ok');
    });

    it('allows repeated groups with fixed-width inner quantifiers', () => {
        const result = runRegexScript({
            findRegex: '/(?:\\d{2})+/',
            replaceString: 'ok',
        }, '1212');

        expect(result).toBe('ok');
    });
});
