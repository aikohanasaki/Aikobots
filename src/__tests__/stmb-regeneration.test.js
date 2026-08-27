import { describe, expect, it } from '@jest/globals';

import {
    CONSOLIDATION_REGENERATION_PRESET_KEY,
    createManagedSummaryEntryData,
    parseSummaryJsonResponse,
} from '../../public/scripts/stmb-summary.js';
import {
    applyRegenerationReplacement,
    buildRegenerationJobInput,
    buildSidePromptRegenerationSnapshot,
    buildRegenerationIndexes,
    getRegenerationEligibility,
    getRegenerationSequenceNumber,
    hasLinkedManualGroupMetadata,
    hashRegenerationEntry,
    isCanonicalLinkedGroupMemory,
    isLinkedManualGroupEntry,
    getSidePromptRegenerationSnapshot,
    selectPreviousRegenerationMemories,
} from '../../public/scripts/stmb-regeneration.js';
import { applyStloCharacterFilters } from '../../public/scripts/stlo-utils.js';

function memory(uid, number, overrides = {}) {
    return {
        uid,
        comment: `[${String(number).padStart(3, '0')}] Memory ${number}`,
        content: `Content ${number}`,
        key: [`key-${number}`],
        stmemorybooks: true,
        STMB_start: number * 2,
        STMB_end: number * 2 + 1,
        ...overrides,
    };
}

describe('STMB regeneration eligibility and replacement', () => {
    it('builds a content-free regeneration queue job', () => {
        const sceneContext = {
            chatId: 'chat-1',
            chatRef: {
                type: 'character',
                avatarUrl: 'alice.png',
                fileName: 'chat-1',
                content: 'nested entry content',
            },
            messages: [{ mes: 'chat content' }],
            characterName: 'Alice',
        };
        expect(buildRegenerationJobInput({
            lorebookName: ' Book ',
            entryUid: ' 8 ',
            sceneContext,
        })).toEqual({
            type: 'regeneration',
            lorebookName: 'Book',
            sceneContext: {
                chatId: 'chat-1',
                chatRef: { type: 'character', avatarUrl: 'alice.png', fileName: 'chat-1' },
            },
            payload: { entryUid: '8' },
        });
        expect(() => buildRegenerationJobInput({ lorebookName: 'Book' })).toThrow(/entry UID/);
        expect(() => buildRegenerationJobInput({ lorebookName: 'Book', entryUid: '8' })).toThrow(/chat identity/);
    });

    it('stores only linked regeneration identities and removes duplicate targets', () => {
        const job = buildRegenerationJobInput({
            lorebookName: 'Group Book',
            entryUid: '10',
            sceneContext: {
                chatId: 'chat-1',
                groupId: 'group-1',
                chatRef: { type: 'group', chatId: 'chat-1' },
            },
            linkedTargets: [
                { lorebookName: 'Alice Book', entryUid: 20, content: 'must not persist' },
                { lorebookName: 'Alice Book', entryUid: 20 },
                { lorebookName: 'Group Book', entryUid: 10 },
            ],
        });
        expect(job.payload).toEqual({
            entryUid: '10',
            linkedTargets: [{ lorebookName: 'Alice Book', entryUid: '20' }],
        });
    });

    it('stores only a validated group chat identity', () => {
        expect(buildRegenerationJobInput({
            lorebookName: 'Book',
            entryUid: '8',
            sceneContext: {
                chatId: 'chat-1',
                groupId: 'group-1',
                chatRef: { type: 'group', chatId: 'chat-1', content: 'nested entry content' },
                groupParticipants: [{ content: 'entry content' }],
            },
        }).sceneContext).toEqual({
            chatRef: { type: 'group', chatId: 'chat-1' },
            chatId: 'chat-1',
            groupId: 'group-1',
        });
    });

    it('stores and validates the exact side-prompt regeneration inputs', () => {
        const runtimeMacros = { npc: 'Alice', score: 4 };
        const snapshot = buildSidePromptRegenerationSnapshot({
            templateKey: 'relationship-tracker',
            priorContent: 'Previous output',
            compiledScene: {
                metadata: {
                    sceneStart: 12,
                    sceneEnd: 19,
                    sceneStartUuid: '11111111-1111-4111-8111-111111111111',
                    sceneEndUuid: '22222222-2222-4222-8222-222222222222',
                    chatId: 'chat-1',
                },
            },
            runtimeMacros,
        });
        const entry = {
            uid: 8,
            comment: 'Relationships (STMB SidePrompt)',
            content: 'Current output',
            key: ['relationship'],
            STMB_sidePromptRegeneration: snapshot,
        };

        expect(getSidePromptRegenerationSnapshot(entry)).toBe(snapshot);
        expect(getRegenerationEligibility(entry, { entries: { 8: entry } })).toMatchObject({
            eligible: true,
            kind: 'sidePrompt',
            sceneStart: 12,
            sceneEnd: 19,
        });
        expect(snapshot.runtimeMacros).toEqual({ npc: 'Alice', score: '4' });
        runtimeMacros.npc = 'Changed';
        expect(snapshot.runtimeMacros.npc).toBe('Alice');
    });

    it('rejects malformed side-prompt snapshots and replaces only approved content', () => {
        const entry = {
            uid: 8,
            comment: 'Relationships (STMB SidePrompt)',
            content: 'Current output',
            key: ['relationship'],
            order: 222,
            STMB_sidePromptRegeneration: {
                version: 1,
                templateKey: 'relationship-tracker',
                priorContent: 'Previous output',
                sceneStart: 12,
                sceneEnd: 19,
                sceneStartUuid: '11111111-1111-4111-8111-111111111111',
                sceneEndUuid: '22222222-2222-4222-8222-222222222222',
                chatId: 'chat-1',
                runtimeMacros: {},
            },
        };
        const snapshot = entry.STMB_sidePromptRegeneration;
        applyRegenerationReplacement(entry, {
            title: 'Do not replace',
            content: 'Regenerated output',
            keywords: ['do-not-replace'],
        }, { contentOnly: true });

        expect(entry).toMatchObject({
            comment: 'Relationships (STMB SidePrompt)',
            content: 'Regenerated output',
            key: ['relationship'],
            order: 222,
            STMB_sidePromptRegeneration: snapshot,
        });
        entry.STMB_sidePromptRegeneration.sceneEndUuid = 'invalid';
        expect(getSidePromptRegenerationSnapshot(entry)).toBeNull();
        expect(getRegenerationEligibility(entry, { entries: { 8: entry } }).reason).toBe('invalid-sideprompt-snapshot');
    });

    it('rotates one saved prior version only on a normal side-prompt run', () => {
        const compiledScene = {
            metadata: {
                sceneStart: 20,
                sceneEnd: 25,
                sceneStartUuid: '33333333-3333-4333-8333-333333333333',
                sceneEndUuid: '44444444-4444-4444-8444-444444444444',
                chatId: 'chat-1',
            },
        };
        const first = buildSidePromptRegenerationSnapshot({
            templateKey: 'tracker',
            priorContent: 'Version one',
            compiledScene,
        });
        const second = buildSidePromptRegenerationSnapshot({
            templateKey: 'tracker',
            priorContent: 'Version two',
            compiledScene,
        });

        expect(first.version).toBe(1);
        expect(first.priorContent).toBe('Version one');
        expect(second).toMatchObject({ version: 1, priorContent: 'Version two' });
        expect(first.priorContent).toBe('Version one');
    });

    it('requires a recoverable range and sequence and selects only preceding context', () => {
        const data = { entries: { 1: memory(1, 1), 2: memory(2, 2), 3: memory(3, 3) } };
        expect(getRegenerationEligibility(data.entries[2], data)).toMatchObject({
            eligible: true,
            kind: 'memory',
            sequenceNumber: 2,
            sceneStart: 4,
            sceneEnd: 5,
        });
        expect(selectPreviousRegenerationMemories(data, 2, 7).summaries.map(item => item.uid)).toEqual(['1']);
        expect(getRegenerationEligibility(memory(4, 4, { STMB_end: -1 }), data).reason).toBe('missing-range');
        expect(getRegenerationSequenceNumber(memory(0, 0))).toBe(0);
    });

    it('blocks active parents and resolves explicit or legacy sources exactly one tier lower', () => {
        const explicit = {
            uid: 10,
            comment: '[ARC 001] Arc',
            content: 'Arc',
            key: [],
            stmemorybooks: true,
            stmbSummary: true,
            stmbSummaryTier: 1,
            stmbSourceEntryUids: [1, 2],
        };
        const data = { entries: { 1: memory(1, 1), 2: memory(2, 2), 10: explicit } };
        expect(getRegenerationEligibility(explicit, data)).toMatchObject({
            eligible: true,
            kind: 'consolidation',
            sourceUids: ['1', '2'],
        });

        delete explicit.stmbSourceEntryUids;
        data.entries[1].disabledBySummaryId = 10;
        data.entries[2].disabledBySummaryId = 10;
        expect(getRegenerationEligibility(explicit, data)).toMatchObject({
            eligible: true,
            sourceResolution: 'legacy-backlinks',
        });
        expect(getRegenerationEligibility(data.entries[1], data).reason).toBe('active-parent');

        data.entries[2].stmbSummary = true;
        data.entries[2].stmbSummaryTier = 1;
        expect(getRegenerationEligibility(explicit, data).reason).toBe('wrong-source-tier');
    });

    it('preserves unrelated metadata and clears only a demonstrably stale parent-disable state', () => {
        const entry = memory(4, 4, {
            order: 77,
            characterFilter: { names: ['alice'], isExclude: false },
            disabledBySummaryId: 999,
            disable: true,
        });
        const beforeUid = entry.uid;
        const beforeHash = hashRegenerationEntry(entry);
        applyRegenerationReplacement(entry, {
            title: '[004] Replacement',
            content: 'Replacement content',
            keywords: ['replacement'],
        }, { lorebookData: { entries: { 4: entry } } });

        expect(entry).toMatchObject({
            uid: beforeUid,
            order: 77,
            characterFilter: { names: ['alice'], isExclude: false },
            comment: '[004] Replacement',
            content: 'Replacement content',
            key: ['replacement'],
            disable: false,
        });
        expect(entry).not.toHaveProperty('disabledBySummaryId');
        expect(hashRegenerationEntry(entry)).not.toBe(beforeHash);
    });
});

describe('STMB regeneration presets and metadata', () => {
    it('identifies canonical group memories and only their matching linked copies', () => {
        const canonical = memory(10, 1, {
            STMB_canonical: true,
            STMB_canonicalLorebook: 'Group Book',
            STMB_canonicalEntryUid: 10,
            STMB_inclusionGroup: 'Group-Memory-001',
        });
        const linked = memory(20, 1, {
            STMB_canonical: false,
            STMB_canonicalLorebook: 'Group Book',
            STMB_canonicalEntryUid: 10,
            STMB_inclusionGroup: 'Group-Memory-001',
        });
        const conflicting = memory(30, 1, {
            STMB_canonicalLorebook: 'Other Group',
            STMB_canonicalEntryUid: 10,
            STMB_inclusionGroup: 'Group-Memory-001',
        });

        expect(hasLinkedManualGroupMetadata(canonical)).toBe(true);
        expect(isCanonicalLinkedGroupMemory(canonical, 'Group Book')).toBe(true);
        expect(isCanonicalLinkedGroupMemory(linked, 'Alice Book')).toBe(false);
        expect(isLinkedManualGroupEntry(canonical, linked, 'Group Book')).toBe(true);
        expect(isLinkedManualGroupEntry(canonical, conflicting, 'Group Book')).toBe(false);
    });

    it('normalizes the flat regeneration response and reserves its preset key', () => {
        expect(CONSOLIDATION_REGENERATION_PRESET_KEY).toBe('arc_regenerate');
        expect(parseSummaryJsonResponse('{"title":"Arc","content":"Body","keywords":["hook"]}', {
            responseShape: 'regeneration',
        })).toEqual({
            summaries: [{ title: 'Arc', summary: 'Body', keywords: ['hook'], member_ids: [] }],
            unassigned_items: [],
        });
        expect(() => parseSummaryJsonResponse('{"title":"Arc","content":"Body"}', {
            responseShape: 'regeneration',
        })).toThrow(/title, content, and keywords/i);
    });

    it('stores explicit source UIDs only when requested', () => {
        const candidate = { title: 'Arc', summary: 'Body', keywords: [], memberIds: ['1', '2', '2'] };
        expect(createManagedSummaryEntryData(candidate, { includeSourceUids: false })).not.toHaveProperty('stmbSourceEntryUids');
        expect(createManagedSummaryEntryData(candidate, { includeSourceUids: true }).stmbSourceEntryUids).toEqual([1, 2]);
    });

    it('adds STLO speaker overrides without replacing existing metadata', () => {
        const data = {
            stlo: {
                priority: 5,
                orderAdjustment: 2,
                custom: 'kept',
                characterOverrides: { alice: { priority: 7, orderAdjustment: 1 } },
            },
        };
        applyStloCharacterFilters(data, ['alice', 'bob']);
        expect(data.stlo).toMatchObject({
            custom: 'kept',
            onlyWhenSpeaking: true,
            characterOverrides: {
                alice: { priority: 7, orderAdjustment: 1 },
                bob: { priority: 5, orderAdjustment: 2 },
            },
        });
        const unusual = { entries: {} };
        applyStloCharacterFilters(unusual, ['__proto__']);
        expect(Object.hasOwn(unusual.stlo.characterOverrides, '__proto__')).toBe(true);
        expect(JSON.parse(JSON.stringify(unusual)).stlo.characterOverrides.__proto__).toEqual({
            priority: 3,
            orderAdjustment: 0,
        });
        const malformed = { stlo: { characterOverrides: [] } };
        expect(() => applyStloCharacterFilters(malformed, ['alice'])).toThrow(/characterOverrides/);
        expect(malformed.stlo.characterOverrides).toEqual([]);
    });

    it('builds indexes once for explicit and legacy parent relationships', () => {
        const data = {
            entries: {
                1: memory(1, 1, { disabledBySummaryId: 10 }),
                10: {
                    uid: 10,
                    comment: '[ARC 001] Arc',
                    content: 'Arc',
                    stmemorybooks: true,
                    stmbSummary: true,
                    stmbSummaryTier: 1,
                },
            },
        };
        const indexes = buildRegenerationIndexes(data);
        expect(indexes.legacySourceUidsByParentUid.get('10')).toEqual(['1']);
        expect(indexes.parentConsolidationsBySourceUid.get('1')).toHaveLength(1);
    });
});
