import { describe, expect, it } from '@jest/globals';

import {
    compileScene,
    createManagedLorebookEntryData,
    formatMemoryTitle,
    getStmbCharacterFilterName,
    normalizeStmbSettings,
    resolveAfterMemorySidePromptSetKey,
    validateTitleFormat,
} from '../../public/scripts/stmb-core.js';
import {
    buildBriefsFromEntries,
    buildSummaryAnalysisPrompt,
    createManagedSummaryEntryData,
    createSummaryCandidatesFromResponse,
    fingerprintLorebookEntry,
} from '../../public/scripts/stmb-summary.js';

const participants = [
    { key: 'alice.png', avatar: 'alice.png', name: 'Alice', characterFilterName: 'alice' },
    { key: 'bob.webp', avatar: 'bob.webp', name: 'Bob', characterFilterName: 'bob' },
];

describe('STMB group participant capture', () => {
    it('uses avatar basenames for world-info character filters', () => {
        expect(getStmbCharacterFilterName('characters\\party/alice.card.png?revision=2')).toBe('alice.card');
    });

    it('prefers stable avatars, falls back to unique names, and preserves original avatars', () => {
        const scene = compileScene([
            { name: 'Renamed Alice', mes: 'Avatar match', original_avatar: 'alice.png' },
            { name: 'Bob', mes: 'Unique name fallback' },
            { name: 'User', mes: 'Hello', is_user: true },
        ], {
            sceneStart: 0,
            sceneEnd: 2,
            groupName: 'Party',
        }, { groupParticipants: participants });

        expect(scene.messages[0].original_avatar).toBe('alice.png');
        expect(scene.metadata.characterFilterNames).toEqual(['alice', 'bob']);
        expect(scene.metadata.groupName).toBe('Party');
        expect(scene.metadata.presentCharacterNames).toEqual(['Renamed Alice', 'Bob']);
    });

    it('skips ambiguous display-name matches and deduplicates participant filters', () => {
        const scene = compileScene([
            { name: 'Twin', mes: 'Ambiguous speaker' },
            { name: 'Alice', mes: 'First' },
            { name: 'Alice', mes: 'Second' },
        ], { sceneStart: 0, sceneEnd: 2 }, {
            groupParticipants: [
                ...participants,
                { key: 'twin-a.png', avatar: 'twin-a.png', name: 'Twin' },
                { key: 'twin-b.png', avatar: 'twin-b.png', name: 'Twin' },
            ],
        });

        expect(scene.metadata.characterFilterNames).toEqual(['alice']);
    });

    it('writes automatic group filters and canonical-copy metadata compatibly', () => {
        const entry = createManagedLorebookEntryData({
            title: 'Arrival',
            content: 'The party arrived.',
            keywords: ['party'],
        }, {
            sceneStart: 1,
            sceneEnd: 4,
            groupName: 'Party',
            presentCharacterNames: ['Alice', 'Bob'],
            characterFilterNames: ['alice', 'bob'],
        }, { titleFormat: '[000] - {{groupname}} - {{present}} - {{title}}' }, 3, {
            inclusionGroup: 'Party-Memory-003',
            entryMetadata: {
                STMB_canonical: true,
                STMB_canonicalLorebook: 'Party',
                STMB_canonicalEntryUid: 7,
                STMB_canonicalMemoryNumber: 3,
            },
        });

        expect(entry.characterFilter).toEqual({ isExclude: false, names: ['alice', 'bob'], tags: [] });
        expect(entry.comment).toBe('003 - Party - Alice, Bob - Arrival');
        expect(entry.group).toBe('Party-Memory-003');
        expect(entry.STMB_canonicalMemoryNumber).toBe(3);
        expect(validateTitleFormat('{{groupname}} - {{present}} - {{title}}').warnings).toEqual([]);
        expect(formatMemoryTitle('{{present}}', { characterName: 'Solo Alice' }, 1)).toBe('Solo Alice');
    });
});

describe('STMB group settings migration', () => {
    it('defaults legacy settings without changing their prompt behavior', () => {
        const settings = normalizeStmbSettings({
            profiles: [{ name: 'Legacy', preset: 'summary', connection: { api: 'openai', model: 'test-model' } }],
        });
        const profile = settings.profiles.find(item => item.name === 'Legacy');

        expect(profile.useGroupSpecificPrompts).toBe(false);
        expect(profile.groupPreset).toBe('group');
        expect(profile.characterPreset).toBe('char');
        expect(settings.moduleSettings.autoAcceptGroupParticipants).toBe(false);
    });

    it('preserves exported group prompt fields', () => {
        const settings = normalizeStmbSettings({
            moduleSettings: { autoAcceptGroupParticipants: true },
            profiles: [{
                name: 'Group profile',
                preset: 'summary',
                useGroupSpecificPrompts: true,
                groupPreset: 'custom-group',
                characterPreset: 'custom-char',
                connection: { api: 'openai', model: 'test-model' },
            }],
        });
        const profile = settings.profiles.find(item => item.name === 'Group profile');

        expect(profile).toMatchObject({
            useGroupSpecificPrompts: true,
            groupPreset: 'custom-group',
            characterPreset: 'custom-char',
        });
        expect(settings.moduleSettings.autoAcceptGroupParticipants).toBe(true);
    });

    it('normalizes separate solo and group side prompt set defaults', () => {
        const settings = normalizeStmbSettings({
            moduleSettings: {
                defaultSoloSidePromptSetKey: ' solo-set ',
                defaultGroupSidePromptSetKey: ' group-set ',
            },
        });

        expect(settings.moduleSettings.defaultSoloSidePromptSetKey).toBe('solo-set');
        expect(settings.moduleSettings.defaultGroupSidePromptSetKey).toBe('group-set');
    });

    it('resolves side prompt defaults without overriding explicit chat choices', () => {
        const moduleSettings = {
            defaultSoloSidePromptSetKey: 'solo-set',
            defaultGroupSidePromptSetKey: 'group-set',
        };

        expect(resolveAfterMemorySidePromptSetKey({}, moduleSettings, false)).toBe('solo-set');
        expect(resolveAfterMemorySidePromptSetKey({}, moduleSettings, true)).toBe('group-set');
        expect(resolveAfterMemorySidePromptSetKey({ sidePromptAfterMemorySetKey: '' }, moduleSettings, true)).toBe('');
        expect(resolveAfterMemorySidePromptSetKey({ sidePromptAfterMemorySetKey: ' legacy-set ' }, moduleSettings, false)).toBe('legacy-set');
    });
});

describe('STMB group consolidation metadata', () => {
    const sourceEntries = [
        { uid: 1, comment: '[001] First', content: 'A', characterFilter: { names: ['alice', 'bob'], isExclude: false } },
        { uid: 2, comment: '[002] Second', content: 'B', characterFilter: { names: ['bob', 'cara'], isExclude: false } },
        { uid: 3, comment: '[003] Third', content: 'C', characterFilter: { names: ['cara'], isExclude: true } },
    ];

    it('keeps chronology gaps transient and out of assignments', () => {
        const gap = { __stmbGapMarker: true, id: 'gap-2', order: 2, content: 'Another participant has memory 2.' };
        const input = [sourceEntries[0], gap, sourceEntries[2]];
        const briefs = buildBriefsFromEntries(input);
        const prompt = buildSummaryAnalysisPrompt({ briefs, promptText: 'Summarize.', targetTier: 1 });
        const result = createSummaryCandidatesFromResponse({
            summaries: [{ title: 'Combined', summary: 'Summary', keywords: [], member_ids: ['001', '003'] }],
            unassigned_items: [],
        }, input);

        expect(prompt).toContain('Note: Another participant has memory 2.');
        expect(result.summaryCandidates[0].memberIds).toEqual(['1', '3']);
        expect(result.leftovers).toEqual([]);
    });

    it('unions included filters, removes exclusions, and leaves unrestricted sources unrestricted', () => {
        const filtered = createManagedSummaryEntryData({
            title: 'Filtered', summary: 'Summary', keywords: [], memberIds: ['1', '2', '3'],
        }, { sourceEntries, sequenceNumber: 1 });
        const unrestricted = createManagedSummaryEntryData({
            title: 'Open', summary: 'Summary', keywords: [], memberIds: ['1', '4'],
        }, { sourceEntries: [...sourceEntries, { uid: 4, comment: '[004] Open', content: 'D' }], sequenceNumber: 2 });

        expect(filtered.characterFilter.names).toEqual(['alice', 'bob']);
        expect(unrestricted.characterFilter).toBeUndefined();
    });

    it('includes filters and canonical fields in source fingerprints', () => {
        const base = { uid: 1, comment: 'Memory', content: 'Content', STMB_canonicalMemoryNumber: 1 };
        expect(fingerprintLorebookEntry(base)).not.toBe(fingerprintLorebookEntry({
            ...base,
            characterFilter: { names: ['alice'], isExclude: false },
        }));
        expect(fingerprintLorebookEntry(base)).not.toBe(fingerprintLorebookEntry({
            ...base,
            STMB_canonicalMemoryNumber: 2,
        }));
    });
});
