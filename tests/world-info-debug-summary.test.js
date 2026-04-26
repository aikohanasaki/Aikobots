import { describe, expect, it, jest } from '@jest/globals';

import { scanWorldInfo } from '../src/prompting/world-info-scan.js';

const worldInfoPosition = {
    before: 0,
    after: 1,
    EMTop: 2,
    EMBottom: 3,
    ANTop: 4,
    ANBottom: 5,
    atDepth: 6,
    outlet: 7,
};

describe('scanWorldInfo debug summary', () => {
    it('can skip debug summary generation while preserving timed state updates', async () => {
        const result = await scanWorldInfo({
            chat: ['The moonwell ledger is missing.'],
            maxContext: 100,
            worldInfoPosition,
            includeDebugInfo: false,
            settings: {
                world_info_budget: 100,
                world_info_budget_cap: 0,
                world_info_recursive: false,
            },
            timedWorldInfo: {
                sticky: {},
                cooldown: {},
            },
            sortedEntries: [
                {
                    uid: 1,
                    world: 'Alpha',
                    order: 300,
                    position: worldInfoPosition.before,
                    content: 'Before entry',
                    decorators: ['@@activate'],
                    sticky: 3,
                    lorebookSettings: { budgetMode: 'default' },
                },
            ],
        });

        expect(result.worldInfo).toBeNull();
        expect(result.timedWorldInfo.sticky['Alpha::1']).toMatchObject({
            book: 'Alpha',
            name: '1',
            start: 1,
            end: 4,
        });
    });

    it('groups admitted entries by placement', async () => {
        const result = await scanWorldInfo({
            chat: ['The moonwell ledger is missing.'],
            maxContext: 100,
            worldInfoPosition,
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
                    position: worldInfoPosition.before,
                    content: 'Before entry',
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'default' },
                },
                {
                    uid: 2,
                    world: 'Beta',
                    order: 200,
                    position: worldInfoPosition.after,
                    content: 'After entry',
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'default' },
                },
                {
                    uid: 3,
                    world: 'Gamma',
                    order: 100,
                    position: worldInfoPosition.EMTop,
                    content: 'Example entry',
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'default' },
                },
                {
                    uid: 4,
                    world: 'Delta',
                    order: 50,
                    position: worldInfoPosition.atDepth,
                    depth: 2,
                    role: 0,
                    content: 'Depth entry',
                    decorators: ['@@activate'],
                    lorebookSettings: { budgetMode: 'default' },
                },
            ],
        });

        expect(result.worldInfo.beforeEntries.map(entry => entry.uid)).toEqual([1]);
        expect(result.worldInfo.afterEntries.map(entry => entry.uid)).toEqual([2]);
        expect(result.worldInfo.exampleEntries.map(entry => entry.uid)).toEqual([3]);
        expect(result.worldInfo.depthEntries.map(entry => entry.uid)).toEqual([4]);
        expect(result.worldInfo.activatedEntries.every(entry => entry.status === 'admitted')).toBe(true);
    });

    it('reports probability and budget drop reasons', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

        try {
            const result = await scanWorldInfo({
                chat: ['Mention moonwell and cipher.'],
                maxContext: 40,
                worldInfoPosition,
                settings: {
                    world_info_budget: 25,
                    world_info_budget_cap: 0,
                    world_info_recursive: false,
                },
                sortedEntries: [
                    {
                        uid: 1,
                        world: 'Alpha',
                        order: 300,
                        position: worldInfoPosition.before,
                        content: 'A'.repeat(10),
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
                        position: worldInfoPosition.after,
                        content: 'B'.repeat(30),
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
                        position: worldInfoPosition.before,
                        content: 'Probability entry',
                        decorators: ['@@activate'],
                        useProbability: true,
                        probability: 50,
                        lorebookSettings: { budgetMode: 'default' },
                    },
                    {
                        uid: 4,
                        world: 'Gamma',
                        order: 50,
                        position: worldInfoPosition.before,
                        content: 'C'.repeat(40),
                        decorators: ['@@activate'],
                        lorebookSettings: { budgetMode: 'default' },
                    },
                ],
            });

            const statuses = Object.fromEntries(result.worldInfo.activatedEntries.map(entry => [entry.uid, entry.status]));
            expect(statuses[1]).toBe('admitted');
            expect(statuses[2]).toBe('dropped_lorebook_budget');
            expect(statuses[3]).toBe('dropped_probability');
            expect(statuses[4]).toBe('dropped_budget');
            expect(result.worldInfo.overflowed).toBe(true);
            expect(result.worldInfo.budgetUsed.global.limit).toBeGreaterThan(0);
        } finally {
            randomSpy.mockRestore();
        }
    });
});
