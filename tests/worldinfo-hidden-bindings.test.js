import { describe, expect, it, jest } from '@jest/globals';

import { LorebookRepositoryError } from '../src/lorebook-repository.js';
import { resolveSortedEntriesPayload } from '../src/endpoints/worldinfo.js';

describe('resolveSortedEntriesPayload hidden bindings', () => {
    it('preserves escaped decorator lines as literal content', async () => {
        const result = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['Escaped'],
            },
            {
                readEntries: async () => [{
                    uid: 1,
                    world: 'Escaped',
                    order: 1,
                    content: '@@@activate\nvisible body',
                }],
                getHiddenBooks: () => [],
                hasLorebook: () => true,
            },
        );

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].decorators).toEqual([]);
        expect(result.entries[0].content).toBe('@@activate\nvisible body');
    });

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
        try {
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
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('sorts one unified pool by effective order instead of source precedence', async () => {
        const worldEntries = {
            Global: [{ uid: 1, world: 'Global', order: 900, content: 'global' }],
            Visible: [{ uid: 2, world: 'Visible', order: 100, content: 'visible' }],
            Chat: [{ uid: 3, world: 'Chat', order: 10, content: 'chat' }],
            Persona: [{ uid: 4, world: 'Persona', order: 20, content: 'persona' }],
        };

        const result = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['Global'],
                chatWorld: 'Chat',
                personaWorld: 'Persona',
                characterWorld: 'Visible',
            },
            {
                readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []),
                getHiddenBooks: () => [],
                hasLorebook: (_user, name) => Boolean(worldEntries[name]),
            },
        );

        expect(result.entries.map(entry => entry.world)).toEqual(['Global', 'Visible', 'Persona', 'Chat']);
    });

    it('applies speaker overrides and onlyWhenSpeaking before adding lorebooks to the pool', async () => {
        const worldEntries = {
            SpeakerBook: [{
                uid: 1,
                world: 'SpeakerBook',
                order: 10,
                content: 'speaker',
                lorebookSettings: {
                    onlyWhenSpeaking: true,
                    characterOverrides: {
                        hero: {
                            priority: 5,
                            orderAdjustment: 100,
                        },
                    },
                },
            }],
            Other: [{ uid: 2, world: 'Other', order: 50, content: 'other' }],
        };

        const matched = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['SpeakerBook', 'Other'],
                activeSpeaker: { filename: 'hero' },
            },
            {
                readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []),
                getHiddenBooks: () => [],
                hasLorebook: (_user, name) => Boolean(worldEntries[name]),
            },
        );

        const unmatched = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['SpeakerBook', 'Other'],
                activeSpeaker: { filename: 'villain' },
            },
            {
                readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []),
                getHiddenBooks: () => [],
                hasLorebook: (_user, name) => Boolean(worldEntries[name]),
            },
        );

        expect(matched.entries.map(entry => entry.world)).toEqual(['SpeakerBook', 'Other']);
        expect(unmatched.entries.map(entry => entry.world)).toEqual(['Other']);
    });

    it('applies orderAdjustmentGroupOnly only when the request is for a group response', async () => {
        const worldEntries = {
            GroupOnly: [{
                uid: 1,
                world: 'GroupOnly',
                order: 10,
                content: 'group-only',
                lorebookSettings: {
                    orderAdjustment: 500,
                    orderAdjustmentGroupOnly: true,
                },
            }],
            Baseline: [{ uid: 2, world: 'Baseline', order: 100, content: 'baseline' }],
        };

        const nonGroup = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['GroupOnly', 'Baseline'],
                selectedGroup: false,
            },
            {
                readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []),
                getHiddenBooks: () => [],
                hasLorebook: (_user, name) => Boolean(worldEntries[name]),
            },
        );

        const group = await resolveSortedEntriesPayload(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['GroupOnly', 'Baseline'],
                selectedGroup: true,
            },
            {
                readEntries: async (_user, name) => structuredClone(worldEntries[name] ?? []),
                getHiddenBooks: () => [],
                hasLorebook: (_user, name) => Boolean(worldEntries[name]),
            },
        );

        expect(nonGroup.entries.map(entry => entry.world)).toEqual(['Baseline', 'GroupOnly']);
        expect(group.entries.map(entry => entry.world)).toEqual(['GroupOnly', 'Baseline']);
    });
});
