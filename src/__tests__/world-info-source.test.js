import { beforeAll, describe, expect, it, jest } from '@jest/globals';

let resolveSortedEntriesPayload;
let sanitizeWorldInfoDebugDataForResponse;

beforeAll(async () => {
    ({ resolveSortedEntriesPayload } = await import('../endpoints/worldinfo.js'));
    ({ sanitizeWorldInfoDebugDataForResponse } = await import('../endpoints/backends/chat-completions.js'));
});

describe('World Info activation sources', () => {
    it('stamps every source after applying the existing binding precedence', async () => {
        const readEntries = jest.fn(async (_user, worldName) => [{
            world: worldName,
            uid: 1,
            content: `${worldName} content`,
            lorebookSource: 'forged',
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
    });

    it('removes background provenance from inaccessible secure entries', () => {
        const result = sanitizeWorldInfoDebugDataForResponse({
            activatedEntries: [
                { book: 'Chat Book', uid: 1, storage: 'user', lorebookSource: 'chat', status: 'admitted', inserted: true },
                { book: 'Hidden Book', uid: 2, storage: 'secure', ownerHandle: 'other', lorebookSource: 'background', status: 'admitted', inserted: true },
                { book: 'Owned Book', uid: 3, storage: 'secure', ownerHandle: 'viewer', lorebookSource: 'character', status: 'admitted', inserted: true },
            ],
            rounds: [],
            budgetUsed: {},
        }, { profile: { handle: 'viewer', admin: false } });

        expect(result.activatedEntries[0].lorebookSource).toBe('chat');
        expect(result.activatedEntries[1].hidden).toBe(true);
        expect(result.activatedEntries[1]).not.toHaveProperty('lorebookSource');
        expect(result.activatedEntries[2].lorebookSource).toBe('character');
    });
});
