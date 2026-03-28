import { describe, expect, it, jest } from '@jest/globals';

import { LorebookRepositoryError } from '../src/lorebook-repository.js';
import { resolveSortedEntriesPayload } from '../src/endpoints/worldinfo.js';

describe('resolveSortedEntriesPayload hidden bindings', () => {
    it('merges hidden bindings into character lore without duplicating visible lorebooks', async () => {
        const worldEntries = {
            Global: [{ uid: 1, world: 'Global', order: 1, content: 'global' }],
            Visible: [{ uid: 2, world: 'Visible', order: 3, content: 'visible' }],
            VisibleExtra: [{ uid: 3, world: 'VisibleExtra', order: 4, content: 'visible-extra' }],
            Hidden: [{ uid: 4, world: 'Hidden', order: 5, content: 'hidden' }],
            Chat: [{ uid: 5, world: 'Chat', order: 7, content: 'chat' }],
            Persona: [{ uid: 6, world: 'Persona', order: 6, content: 'persona' }],
        };

        const result = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['Global'],
                chatWorld: 'Chat',
                personaWorld: 'Persona',
                characterWorld: 'Visible',
                characterExtraBooks: ['VisibleExtra'],
                currentCharacterFilename: 'char_a',
                worldInfoCharacterStrategy: 1,
            },
            {
                readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []),
                getHiddenBooks: (characterKey) => characterKey === 'char_a' ? ['Hidden', 'VisibleExtra'] : [],
                hasLorebook: (_user, name) => Boolean(worldEntries[name]),
            },
        );

        expect(result.characterLore.map(entry => entry.world)).toEqual(['Visible', 'VisibleExtra', 'Hidden']);
        expect(result.entries.map(entry => entry.world)).toEqual(['Chat', 'Persona', 'Hidden', 'VisibleExtra', 'Visible', 'Global']);
    });

    it('warns and skips missing hidden lorebooks safely', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                currentCharacterFilename: 'char_a',
            },
            {
                readEntries: async (_user, name) => {
                    if (name === 'Missing') {
                        throw new LorebookRepositoryError('LorebookNotFound', 'missing', 404);
                    }

                    return [];
                },
                getHiddenBooks: () => ['Missing'],
                hasLorebook: () => false,
            },
        );

        expect(result.characterLore).toEqual([]);
        expect(result.entries).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith('[WI] Hidden lorebook "Missing" not found for character "char_a". Skipping.');

        warnSpy.mockRestore();
    });
});
