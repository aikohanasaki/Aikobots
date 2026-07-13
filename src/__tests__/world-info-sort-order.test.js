import { describe, expect, it } from '@jest/globals';

import {
    DEFAULT_WORLD_INFO_SORT_ORDER,
    getWorldInfoSortOrder,
    normalizeWorldInfoSortOrder,
    setWorldInfoSortOrder,
} from '../../public/scripts/world-info-sort-order.js';

describe('world info sort order metadata', () => {
    it('normalizes persistent values and excludes temporary search sorting', () => {
        expect(normalizeWorldInfoSortOrder('13')).toBe('13');
        expect(normalizeWorldInfoSortOrder(16)).toBe('16');
        expect(normalizeWorldInfoSortOrder('14')).toBeNull();
        expect(normalizeWorldInfoSortOrder('invalid', '8')).toBe('8');
        expect(normalizeWorldInfoSortOrder('invalid', '14')).toBeNull();
    });

    it('reads metadata before the legacy fallback and defaults to Priority', () => {
        expect(getWorldInfoSortOrder({
            extensions: {
                aikobots: {
                    sort_order: '2',
                },
            },
        }, '8')).toBe('2');
        expect(getWorldInfoSortOrder({ entries: {} }, '8')).toBe('8');
        expect(getWorldInfoSortOrder({ entries: {} }, '14')).toBe(DEFAULT_WORLD_INFO_SORT_ORDER);
    });

    it('writes namespaced metadata without changing entries or unrelated extensions', () => {
        const entries = {
            1: {
                uid: 1,
                content: 'unchanged',
            },
        };
        const data = {
            entries: structuredClone(entries),
            extensions: {
                existing: {
                    enabled: true,
                },
                aikobots: {
                    existing: 'preserved',
                },
            },
        };

        expect(setWorldInfoSortOrder(data, 9)).toBe('9');
        expect(data.entries).toEqual(entries);
        expect(data.extensions).toEqual({
            existing: {
                enabled: true,
            },
            aikobots: {
                existing: 'preserved',
                sort_order: '9',
            },
        });
    });

    it('creates missing namespaced metadata and rejects invalid sort values without mutation', () => {
        const data = { entries: {} };
        expect(setWorldInfoSortOrder(data, '15')).toBe('15');
        expect(data.extensions.aikobots.sort_order).toBe('15');

        const before = structuredClone(data);
        expect(() => setWorldInfoSortOrder(data, '14')).toThrow('Lorebook sort order is invalid.');
        expect(data).toEqual(before);
    });

    it.each([
        [{ entries: {}, extensions: [] }, 'Lorebook extensions metadata must be a plain object.'],
        [{ entries: {}, extensions: { aikobots: 'invalid' } }, 'Lorebook Aikobots metadata must be a plain object.'],
    ])('rejects malformed metadata containers without mutating them', (data, message) => {
        const before = structuredClone(data);
        expect(() => setWorldInfoSortOrder(data, '1')).toThrow(message);
        expect(data).toEqual(before);
    });
});
