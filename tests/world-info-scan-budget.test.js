import { describe, expect, it } from '@jest/globals';

import { scanWorldInfo } from '../src/prompting/world-info-scan.js';

describe('scanWorldInfo per-lorebook budgeting', () => {
    it('enforces a lorebook fixed budget without stopping other lorebooks', async () => {
        const result = await scanWorldInfo({
            chat: [],
            maxContext: 100,
            settings: {
                world_info_budget: 100,
                world_info_budget_cap: 0,
                world_info_recursive: false,
            },
            sortedEntries: [
                {
                    uid: 1,
                    world: 'Alpha',
                    order: 300,
                    content: 'A'.repeat(20),
                    decorators: ['@@activate'],
                    lorebookSettings: {
                        budgetMode: 'fixed',
                        budget: 10,
                    },
                },
                {
                    uid: 2,
                    world: 'Alpha',
                    order: 200,
                    content: 'B'.repeat(20),
                    decorators: ['@@activate'],
                    lorebookSettings: {
                        budgetMode: 'fixed',
                        budget: 10,
                    },
                },
                {
                    uid: 3,
                    world: 'Beta',
                    order: 100,
                    content: 'C'.repeat(20),
                    decorators: ['@@activate'],
                    lorebookSettings: {
                        budgetMode: 'default',
                    },
                },
            ],
        });

        expect(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)).toEqual([
            'Alpha.1',
            'Beta.3',
        ]);
        expect(result.overflowed).toBe(false);
    });

    it('lets ignoreBudget entries bypass per-lorebook and global budget checks', async () => {
        const result = await scanWorldInfo({
            chat: [],
            maxContext: 20,
            settings: {
                world_info_budget: 25,
                world_info_budget_cap: 0,
                world_info_recursive: false,
            },
            sortedEntries: [
                {
                    uid: 1,
                    world: 'Alpha',
                    order: 200,
                    content: 'A'.repeat(20),
                    decorators: ['@@activate'],
                    ignoreBudget: true,
                    lorebookSettings: {
                        budgetMode: 'fixed',
                        budget: 1,
                    },
                },
                {
                    uid: 2,
                    world: 'Alpha',
                    order: 100,
                    content: 'B'.repeat(20),
                    decorators: ['@@activate'],
                    lorebookSettings: {
                        budgetMode: 'fixed',
                        budget: 1,
                    },
                },
            ],
        });

        expect(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)).toEqual([
            'Alpha.1',
        ]);
        expect(result.overflowed).toBe(false);
    });

    it('counts non-recursing admitted entries against later global budget checks', async () => {
        const result = await scanWorldInfo({
            chat: [],
            maxContext: 40,
            settings: {
                world_info_budget: 25,
                world_info_budget_cap: 0,
                world_info_recursive: true,
            },
            sortedEntries: [
                {
                    uid: 1,
                    world: 'Alpha',
                    order: 200,
                    content: 'A'.repeat(20),
                    decorators: ['@@activate'],
                    preventRecursion: true,
                    lorebookSettings: {
                        budgetMode: 'default',
                    },
                },
                {
                    uid: 2,
                    world: 'Gamma',
                    order: 150,
                    content: 'G',
                    decorators: ['@@activate'],
                    lorebookSettings: {
                        budgetMode: 'default',
                    },
                },
                {
                    uid: 3,
                    world: 'Beta',
                    order: 100,
                    content: 'B'.repeat(12),
                    decorators: ['@@activate'],
                    delayUntilRecursion: true,
                    lorebookSettings: {
                        budgetMode: 'default',
                    },
                },
            ],
        });

        expect(result.allActivatedEntries.map(entry => `${entry.world}.${entry.uid}`)).toEqual([
            'Alpha.1',
            'Gamma.2',
        ]);
        expect(result.overflowed).toBe(true);
    });
});
