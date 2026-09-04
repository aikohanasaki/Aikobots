import { beforeAll, describe, expect, it, jest } from '@jest/globals';

let resolveSortedEntriesPayload;
let sanitizeWorldInfoDebugDataForResponse;
let getFloatingLorebookSourcePresentation;

beforeAll(async () => {
    ({ resolveSortedEntriesPayload } = await import('../endpoints/worldinfo.js'));
    ({ sanitizeWorldInfoDebugDataForResponse } = await import('../endpoints/backends/chat-completions.js'));
    ({ getFloatingLorebookSourcePresentation } = await import('../../public/scripts/world-info-source.js'));
});

describe('World Info activation sources', () => {
    it('stamps every source after applying the existing binding precedence', async () => {
        const readEntries = jest.fn(async (_user, worldName) => [{
            world: worldName,
            uid: 1,
            content: `${worldName} content`,
            lorebookSource: 'forged',
            lorebookPriority: 1,
        }]);
        const result = await resolveSortedEntriesPayload(
            { profile: { handle: 'viewer' } },
            {
                selectedWorldInfo: ['Global Book', 'Shared Book'],
                chatWorld: 'Chat Book',
                personaWorld: 'Persona Book',
                characterWorld: 'Character Book',
                characterExtraBooks: ['Extra Character Book', 'Shared Book'],
                currentCharacterFilename: 'character',
            },
            {
                readEntries,
                getHiddenBooks: () => ['Default Background Book', 'Character Background Book', 'Shared Book'],
                hasLorebook: () => true,
            },
        );

        const sourceByBook = Object.fromEntries(result.entries.map(entry => [entry.world, entry.lorebookSource]));
        expect(sourceByBook).toEqual({
            'Global Book': 'global',
            'Shared Book': 'global',
            'Character Book': 'character',
            'Extra Character Book': 'character',
            'Default Background Book': 'background',
            'Character Background Book': 'background',
            'Chat Book': 'chat',
            'Persona Book': 'persona',
        });
        expect(readEntries.mock.calls.filter(([, worldName]) => worldName === 'Shared Book')).toHaveLength(1);
        expect(result.entries.every(entry => entry.lorebookPriority === 3)).toBe(true);
        expect(result.globalLore.every(entry => !Object.hasOwn(entry, 'lorebookPriority'))).toBe(true);
    });

    it('reports explicit priorities and the effective active-character override', async () => {
        const priorities = new Map([
            ['Level 1', 1],
            ['Level 2', 2],
            ['Level 3', 3],
            ['Level 4', 4],
            ['Level 5', 5],
        ]);
        const readEntries = jest.fn(async (_user, worldName) => [{
            world: worldName,
            uid: priorities.get(worldName) || 10,
            content: `${worldName} content`,
            lorebookSettings: worldName === 'Override Book'
                ? { priority: 2, characterOverrides: { Alice: { priority: 5 } } }
                : { priority: priorities.get(worldName) },
        }]);
        const result = await resolveSortedEntriesPayload(
            { profile: { handle: 'viewer' } },
            {
                selectedWorldInfo: [...priorities.keys(), 'Override Book'],
                selectedGroup: true,
                activeSpeaker: { name: 'Alice' },
            },
            { readEntries },
        );

        expect(Object.fromEntries(result.entries.map(entry => [entry.world, entry.lorebookPriority]))).toEqual({
            'Level 1': 1,
            'Level 2': 2,
            'Level 3': 3,
            'Level 4': 4,
            'Level 5': 5,
            'Override Book': 5,
        });
    });

    it('removes background provenance from inaccessible secure entries', () => {
        const result = sanitizeWorldInfoDebugDataForResponse({
            activatedEntries: [
                { book: 'Chat Book', uid: 1, storage: 'user', lorebookSource: 'chat', lorebookPriority: 3, status: 'admitted', inserted: true },
                { book: 'Hidden Book', uid: 2, storage: 'secure', ownerHandle: 'other', lorebookSource: 'background', lorebookPriority: 5, status: 'admitted', inserted: true },
                { book: 'Owned Book', uid: 3, storage: 'secure', ownerHandle: 'viewer', lorebookSource: 'character', lorebookPriority: 4, status: 'admitted', inserted: true },
            ],
            rounds: [],
            budgetUsed: {},
        }, { profile: { handle: 'viewer', admin: false } });

        expect(result.activatedEntries[0].lorebookSource).toBe('chat');
        expect(result.activatedEntries[0].lorebookPriority).toBe(3);
        expect(result.activatedEntries[1].hidden).toBe(true);
        expect(result.activatedEntries[1]).not.toHaveProperty('lorebookSource');
        expect(result.activatedEntries[1]).not.toHaveProperty('lorebookPriority');
        expect(result.activatedEntries[2].lorebookSource).toBe('character');
        expect(result.activatedEntries[2].lorebookPriority).toBe(4);
    });

    it('maps every source and priority to its floating icon presentation', () => {
        expect(getFloatingLorebookSourcePresentation('global', 1)).toEqual({ iconClass: 'fa-globe', priority: 1, priorityClass: 'wi-floating-book-group-source-priority-1' });
        expect(getFloatingLorebookSourcePresentation('chat', 2)).toEqual({ iconClass: 'fa-comment', priority: 2, priorityClass: 'wi-floating-book-group-source-priority-2' });
        expect(getFloatingLorebookSourcePresentation('persona', 3)).toEqual({ iconClass: 'fa-face-smile', priority: 3, priorityClass: 'wi-floating-book-group-source-priority-3' });
        expect(getFloatingLorebookSourcePresentation('character', 4)).toEqual({ iconClass: 'fa-id-card', priority: 4, priorityClass: 'wi-floating-book-group-source-priority-4' });
        expect(getFloatingLorebookSourcePresentation('background', 5)).toEqual({ iconClass: 'fa-server', priority: 5, priorityClass: 'wi-floating-book-group-source-priority-5' });
        expect(getFloatingLorebookSourcePresentation('chat', null)).toBeNull();
        expect(getFloatingLorebookSourcePresentation('unknown', 3)).toBeNull();
    });
});
