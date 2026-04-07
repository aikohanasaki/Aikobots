import { describe, expect, it } from '@jest/globals';

import { calculateLorebookStats, STMB_MANAGED_FLAG } from '../public/scripts/stmb-core.js';

describe('stmb lorebook stats', () => {
    it('counts managed and non-managed entries using stmemorybooks semantics', () => {
        const stats = calculateLorebookStats('Test Lorebook', {
            entries: {
                1: { uid: 1, comment: '[001] - Memory', content: 'alpha', key: ['a', 'b'], [STMB_MANAGED_FLAG]: true },
                2: { uid: 2, comment: 'Plain Entry', content: 'beta123', key: ['c'] },
                3: { uid: 3, comment: '[ARC 001] - Summary', content: 'gamma', key: ['d', 'e', 'f'], [STMB_MANAGED_FLAG]: true, stmbSummary: true },
            },
        });

        expect(stats).toEqual({
            valid: true,
            lorebookName: 'Test Lorebook',
            totalEntries: 3,
            memoryEntries: 2,
            otherEntries: 1,
            averageContentLength: 6,
            totalKeywords: 6,
            memoryKeywords: 5,
        });
    });

    it('returns zeroed stats for an empty lorebook', () => {
        expect(calculateLorebookStats('Empty', { entries: {} })).toEqual({
            valid: true,
            lorebookName: 'Empty',
            totalEntries: 0,
            memoryEntries: 0,
            otherEntries: 0,
            averageContentLength: 0,
            totalKeywords: 0,
            memoryKeywords: 0,
        });
    });
});
