import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultStmbSettings, createManagedLorebookEntryData, normalizeStmbSettings } from '../public/scripts/stmb-core.js';

import {
    StmbChatCopyError,
    allocateStmbLorebookCopyName,
    clearStmbChatMetadataBindings,
    collectStmbChatLorebookNames,
    finalizeStmbLorebookCopy,
    projectStmbLorebookForChatCopy,
    rewriteManagedMemoryBoundaryUuids,
    rewriteStmbChatMetadataForCopy,
} from '../src/stmb-chat-copy.js';

test('binding collection uses chat-bound or manual STMB targets without duplicates', () => {
    assert.deepEqual(collectStmbChatLorebookNames({
        world_info: 'unrelated character book',
        STMemoryBooks: {
            manualLorebook: 'Memories',
            manualCharacterLorebooks: { one: 'Alice Memories', two: 'Memories' },
            sidePromptLorebookOverrides: { tracker: 'Tracker Book' },
        },
    }), ['Memories', 'Alice Memories', 'Tracker Book']);

    assert.deepEqual(collectStmbChatLorebookNames({
        world_info: 'Chat Memories',
        STMemoryBooks: {},
    }), ['Chat Memories']);
});

test('Memory Book chat copying is default-on and preserves an explicit opt-out', () => {
    assert.equal(createDefaultStmbSettings().moduleSettings.copyMemoryBooksWithChatCopies, true);
    assert.equal(normalizeStmbSettings({ moduleSettings: { copyMemoryBooksWithChatCopies: false } }).moduleSettings.copyMemoryBooksWithChatCopies, false);
});

test('new managed memories retain server-derived UUID boundaries', () => {
    const entry = createManagedLorebookEntryData(
        { title: 'Scene', content: 'Memory', keywords: [] },
        { sceneStart: 2, sceneEnd: 4, sceneStartUuid: 'start-uuid', sceneEndUuid: 'end-uuid' },
        {},
        1,
    );
    assert.equal(entry.STMB_startUuid, 'start-uuid');
    assert.equal(entry.STMB_endUuid, 'end-uuid');
});

test('point-in-time projection preserves derived entries and removes future dependency chains', () => {
    const source = {
        entries: {
            1: { uid: 1, stmemorybooks: true, STMB_start: 0, STMB_end: 2, disable: true, disabledBySummaryId: 3 },
            2: { uid: 2, stmemorybooks: true, STMB_start: 5, STMB_end: 8, disable: true, disabledBySummaryId: 3 },
            3: { uid: 3, stmemorybooks: true, stmbSummary: true, stmbSourceEntryUids: [1, 2] },
            4: { uid: 4, comment: 'Tracker (STMB SidePrompt)', content: 'advanced', STMB_tracker_lastMsgId: 99, disable: true, disabledBySummaryId: 3 },
            5: { uid: 5, comment: 'About topic [STMB Clip]', content: 'advanced clip' },
            6: { uid: 6, comment: 'ordinary entry', content: 'keep me' },
            7: { uid: 7, stmemorybooks: true, stmbSummary: true, stmbSourceEntryUids: [3] },
        },
    };

    const result = projectStmbLorebookForChatCopy(source, {
        cutoffIndex: 4,
        resolveMessageIndex: () => undefined,
    });

    assert.deepEqual(Object.keys(result.data.entries), ['1', '4', '5', '6']);
    assert.equal(result.data.entries[1].disable, false);
    assert.equal('disabledBySummaryId' in result.data.entries[1], false);
    assert.equal(result.data.entries[4].STMB_tracker_lastMsgId, 99);
    assert.equal(result.data.entries[4].disabledBySummaryId, 3);
    assert.equal(result.data.entries[4].disable, true);
    assert.equal(result.hasDerivedEntries, true);
    assert.equal(source.entries[1].disable, true, 'source book must not be mutated');
});

test('UUID ranges remain authoritative when numeric message positions changed', () => {
    const source = {
        entries: {
            1: {
                uid: 1,
                stmemorybooks: true,
                STMB_start: 30,
                STMB_end: 40,
                STMB_startUuid: 'start',
                STMB_endUuid: 'end',
            },
        },
    };
    const positions = new Map([['start', 1], ['end', 3]]);
    const result = projectStmbLorebookForChatCopy(source, {
        cutoffIndex: 3,
        resolveMessageIndex: uuid => positions.get(uuid),
    });
    const targetMessages = [0, 1, 2, 3].map(index => ({ aikobots_message_uuid: `target-${index}` }));
    rewriteManagedMemoryBoundaryUuids(result.data, targetMessages, uuid => positions.get(uuid));

    assert.equal(result.data.entries[1].STMB_startUuid, 'target-1');
    assert.equal(result.data.entries[1].STMB_endUuid, 'target-3');
    assert.equal(result.data.entries[1].STMB_start, 1);
    assert.equal(result.data.entries[1].STMB_end, 3);
});

test('an incomplete UUID range falls back to valid numeric message positions', () => {
    const result = projectStmbLorebookForChatCopy({
        entries: {
            1: {
                uid: 1,
                stmemorybooks: true,
                STMB_start: 1,
                STMB_end: 3,
                STMB_startUuid: 'start-only',
            },
        },
    }, { cutoffIndex: 3, resolveMessageIndex: uuid => uuid === 'start-only' ? 1 : undefined });
    const targetMessages = [0, 1, 2, 3].map(index => ({ aikobots_message_uuid: `target-${index}` }));

    rewriteManagedMemoryBoundaryUuids(result.data, targetMessages, uuid => uuid === 'start-only' ? 1 : undefined);

    assert.equal(result.data.entries[1].STMB_startUuid, 'target-1');
    assert.equal(result.data.entries[1].STMB_endUuid, 'target-3');
    assert.equal(result.data.entries[1].STMB_start, 1);
    assert.equal(result.data.entries[1].STMB_end, 3);
});

test('an unresolvable UUID range falls back to valid numeric message positions', () => {
    const result = projectStmbLorebookForChatCopy({
        entries: {
            1: {
                uid: 1,
                stmemorybooks: true,
                STMB_start: 1,
                STMB_end: 3,
                STMB_startUuid: 'stale-start',
                STMB_endUuid: 'stale-end',
            },
        },
    }, { cutoffIndex: 3, resolveMessageIndex: () => undefined });
    const targetMessages = [0, 1, 2, 3].map(index => ({ aikobots_message_uuid: `target-${index}` }));

    rewriteManagedMemoryBoundaryUuids(result.data, targetMessages, () => undefined);

    assert.equal(result.data.entries[1].STMB_startUuid, 'target-1');
    assert.equal(result.data.entries[1].STMB_endUuid, 'target-3');
    assert.equal(result.data.entries[1].STMB_start, 1);
    assert.equal(result.data.entries[1].STMB_end, 3);
});

test('invalid UUID metadata still rejects without a valid numeric fallback', () => {
    assert.throws(
        () => projectStmbLorebookForChatCopy({
            entries: {
                1: {
                    uid: 1,
                    stmemorybooks: true,
                    STMB_startUuid: 'stale-start',
                    STMB_endUuid: 'stale-end',
                },
            },
        }, { cutoffIndex: 3, resolveMessageIndex: () => undefined }),
        error => error instanceof StmbChatCopyError && error.code === 'stmb_copy_ambiguous_legacy',
    );
});

test('a locked solo book stays on its original book during a branch copy', () => {
    const metadata = {
        world_info: 'Solo',
        STMemoryBooks: {
            manualLorebook: 'Solo',
            sidePromptLorebookOverrides: { tracker: 'Tracker' },
        },
    };
    const options = { soloMemoryBookLocked: true };
    assert.deepEqual(collectStmbChatLorebookNames(metadata, options), ['Tracker']);
    const rewritten = rewriteStmbChatMetadataForCopy(metadata, new Map([
        ['Solo', 'Solo Branch 1'],
        ['Tracker', 'Tracker Branch 1'],
    ]), 10, options);
    assert.equal(rewritten.world_info, 'Solo');
    assert.equal(rewritten.STMemoryBooks.manualLorebook, 'Solo');
    assert.equal(rewritten.STMemoryBooks.sidePromptLorebookOverrides.tracker, 'Tracker Branch 1');
});

test('locked group members stay original while unlocked member books are branched', () => {
    const metadata = {
        STMemoryBooks: { manualCharacterLorebooks: { alice: 'Alice', bob: 'Bob' } },
    };
    const options = { lockedCharacterBindingKeys: ['alice'] };
    assert.deepEqual(collectStmbChatLorebookNames(metadata, options), ['Bob']);
    const rewritten = rewriteStmbChatMetadataForCopy(metadata, new Map([
        ['Alice', 'Alice Branch 1'],
        ['Bob', 'Bob Branch 1'],
    ]), 10, options);
    assert.equal(rewritten.STMemoryBooks.manualCharacterLorebooks.alice, 'Alice');
    assert.equal(rewritten.STMemoryBooks.manualCharacterLorebooks.bob, 'Bob Branch 1');
});

test('legacy arc consolidations use source relationships instead of message ranges', () => {
    const result = projectStmbLorebookForChatCopy({
        entries: {
            1: { uid: 1, stmemorybooks: true, STMB_start: 0, STMB_end: 2 },
            2: { uid: 2, stmemorybooks: true, stmbArc: true, stmbSourceEntryUids: [1] },
        },
    }, { cutoffIndex: 2, resolveMessageIndex: () => undefined });

    const targetMessages = [0, 1, 2].map(index => ({ aikobots_message_uuid: `target-${index}` }));
    assert.doesNotThrow(() => rewriteManagedMemoryBoundaryUuids(result.data, targetMessages, () => undefined));
    assert.equal(result.data.entries[2].stmbArc, true);
});

test('an overlapping or unclassifiable legacy memory aborts safely', () => {
    assert.throws(
        () => projectStmbLorebookForChatCopy({
            entries: { 1: { uid: 1, stmemorybooks: true, STMB_start: 3, STMB_end: 7 } },
        }, { cutoffIndex: 5, resolveMessageIndex: () => undefined }),
        error => error instanceof StmbChatCopyError && error.code === 'stmb_copy_ambiguous_legacy',
    );
});

test('copied metadata rewrites every STMB binding and clamps progress', () => {
    const nameMap = new Map([
        ['Memories', 'Memories Branch 2'],
        ['Alice', 'Alice Branch 1'],
        ['Tracker', 'Tracker Branch 1'],
    ]);
    const metadata = rewriteStmbChatMetadataForCopy({
        STMemoryBooks: {
            manualLorebook: 'Memories',
            manualCharacterLorebooks: { alice: 'Alice' },
            sidePromptLorebookOverrides: { tracker: 'Tracker' },
            highestMemoryProcessed: 20,
            sceneStart: 18,
            sceneEnd: 25,
            autoSummaryNextPromptAt: 30,
        },
    }, nameMap, 10);

    assert.equal(metadata.STMemoryBooks.manualLorebook, 'Memories Branch 2');
    assert.equal(metadata.STMemoryBooks.manualCharacterLorebooks.alice, 'Alice Branch 1');
    assert.equal(metadata.STMemoryBooks.sidePromptLorebookOverrides.tracker, 'Tracker Branch 1');
    assert.equal(metadata.STMemoryBooks.highestMemoryProcessed, 10);
    assert.equal(metadata.STMemoryBooks.sceneStart, null);
    assert.equal(metadata.STMemoryBooks.sceneEnd, 10);
    assert.equal(metadata.STMemoryBooks.autoSummaryNextPromptAt, 11);
    assert.deepEqual(
        allocateStmbLorebookCopyName('Memories', 'branch', ['Memories Branch 1', 'Memories Branch 4']),
        { name: 'Memories Branch 5', sequence: 5 },
    );
});

test('derived entry content and processing metadata stay unchanged in the finalized copy', () => {
    const derived = {
        uid: 7,
        comment: 'Tracker (STMB SidePrompt)',
        content: 'advanced tracker text',
        STMB_tracker_lastMsgId: 99,
        STMB_chatId: 'parent chat',
        data: { extensions: { custom: { nested: true } } },
    };
    const result = finalizeStmbLorebookCopy({ entries: { 7: derived } }, {
        nameMap: new Map(),
        targetChatId: 'child chat',
        rootName: 'Memories',
        sourceName: 'Memories',
        kind: 'branch',
        sequence: 1,
        operationId: 'operation',
    });
    assert.deepEqual(result.entries[7], derived);
});

test('safe side-prompt snapshots rebind to copied message identities', () => {
    const startUuid = '11111111-1111-4111-8111-111111111111';
    const endUuid = '22222222-2222-4222-8222-222222222222';
    const positions = new Map([[startUuid, 1], [endUuid, 3]]);
    const projected = projectStmbLorebookForChatCopy({
        entries: {
            7: {
                uid: 7,
                comment: 'Tracker (STMB SidePrompt)',
                content: 'Tracker output',
                STMB_sidePromptRegeneration: {
                    version: 1,
                    templateKey: 'tracker',
                    priorContent: 'Previous tracker',
                    sceneStart: 10,
                    sceneEnd: 20,
                    sceneStartUuid: startUuid,
                    sceneEndUuid: endUuid,
                    chatId: 'parent chat',
                    runtimeMacros: {},
                },
            },
        },
    }, { cutoffIndex: 3, resolveMessageIndex: uuid => positions.get(uuid) });
    const targetMessages = [0, 1, 2, 3].map(index => ({
        aikobots_message_uuid: `0000000${index}-0000-4000-8000-00000000000${index}`,
    }));

    rewriteManagedMemoryBoundaryUuids(projected.data, targetMessages, uuid => positions.get(uuid), {
        targetChatId: 'child chat',
    });

    expectSnapshot(projected.data.entries[7].STMB_sidePromptRegeneration, {
        sceneStart: 1,
        sceneEnd: 3,
        sceneStartUuid: targetMessages[1].aikobots_message_uuid,
        sceneEndUuid: targetMessages[3].aikobots_message_uuid,
        chatId: 'child chat',
    });
});

test('post-cutoff or invalid side-prompt snapshots are stripped without removing derived content', () => {
    const startUuid = '11111111-1111-4111-8111-111111111111';
    const endUuid = '22222222-2222-4222-8222-222222222222';
    const entry = {
        uid: 7,
        comment: 'Tracker (STMB SidePrompt)',
        content: 'Keep this derived output',
        STMB_sidePromptRegeneration: {
            version: 1,
            templateKey: 'tracker',
            priorContent: '',
            sceneStart: 1,
            sceneEnd: 8,
            sceneStartUuid: startUuid,
            sceneEndUuid: endUuid,
            chatId: 'parent chat',
            runtimeMacros: {},
        },
    };
    const result = projectStmbLorebookForChatCopy({ entries: { 7: entry } }, {
        cutoffIndex: 4,
        resolveMessageIndex: uuid => uuid === startUuid ? 1 : 8,
    });

    assert.equal(result.data.entries[7].content, 'Keep this derived output');
    assert.equal('STMB_sidePromptRegeneration' in result.data.entries[7], false);
    assert.equal(result.hasDerivedEntries, true);
});

function expectSnapshot(actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
        assert.equal(actual?.[key], value);
    }
}

test('chat-only copies remove STMB-owned bindings', () => {
    const result = clearStmbChatMetadataBindings({
        world_info: 'Chat Memories',
        STMemoryBooks: {
            manualCharacterLorebooks: { alice: 'Alice Memories' },
            sidePromptLorebookOverrides: { tracker: 'Tracker' },
        },
    });
    assert.equal('world_info' in result, false);
    assert.equal('manualCharacterLorebooks' in result.STMemoryBooks, false);
    assert.equal('sidePromptLorebookOverrides' in result.STMemoryBooks, false);

    const manual = clearStmbChatMetadataBindings({
        world_info: 'Unrelated Character Lorebook',
        STMemoryBooks: { manualLorebook: 'Manual Memories' },
    });
    assert.equal(manual.world_info, 'Unrelated Character Lorebook');
    assert.equal('manualLorebook' in manual.STMemoryBooks, false);
});
