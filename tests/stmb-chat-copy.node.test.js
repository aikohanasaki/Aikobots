import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultStmbSettings, createManagedLorebookEntryData, normalizeStmbSettings, resolveStmbChatCopyKind } from '../public/scripts/stmb-core.js';

import {
    allocateStmbLorebookCopyName,
    clearStmbChatMetadataBindings,
    cloneStmbLorebookForChatCopy,
    collectStmbChatLorebookNames,
    finalizeStmbLorebookCopy,
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
    assert.equal(resolveStmbChatCopyKind('branch', { copyMemoryBooksWithChatCopies: true }), 'branch');
    assert.equal(resolveStmbChatCopyKind('checkpoint', { copyMemoryBooksWithChatCopies: false }), '');
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

test('Memory Book copies preserve every entry and all message metadata', () => {
    const source = {
        entries: {
            1: {
                uid: 1,
                stmemorybooks: true,
                STMB_start: 336,
                STMB_end: 350,
                STMB_startUuid: 'source-start',
                STMB_endUuid: 'source-end',
                STMB_chatId: 'source-chat',
            },
            2: { uid: 2, stmemorybooks: true, stmbSummary: true, type: 'arc' },
            3: {
                uid: 3,
                comment: 'Tracker (STMB SidePrompt)',
                STMB_sidePromptRegeneration: {
                    sceneStart: 340,
                    sceneEnd: 356,
                    sceneStartUuid: 'tracker-start',
                    sceneEndUuid: 'tracker-end',
                    chatId: 'source-chat',
                },
            },
            4: { uid: 4, comment: 'ordinary entry' },
        },
    };

    const result = cloneStmbLorebookForChatCopy(source);

    assert.deepEqual(result.data, source);
    assert.notEqual(result.data, source);
    assert.notEqual(result.data.entries[1], source.entries[1]);
    assert.equal(result.hasDerivedEntries, true);
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

test('finalized copies preserve entry metadata while rewriting lorebook references', () => {
    const derived = {
        uid: 7,
        comment: 'Tracker (STMB SidePrompt)',
        content: 'advanced tracker text',
        STMB_tracker_lastMsgId: 99,
        STMB_chatId: 'parent chat',
        data: { extensions: { custom: { nested: true } } },
    };
    const managed = {
        uid: 8,
        stmemorybooks: true,
        STMB_start: 336,
        STMB_end: 350,
        STMB_chatId: 'parent chat',
        STMB_canonicalLorebook: 'Related',
    };
    const result = finalizeStmbLorebookCopy({ entries: { 7: derived, 8: managed } }, {
        nameMap: new Map([['Related', 'Related Branch 1']]),
        rootName: 'Memories',
        sourceName: 'Memories',
        kind: 'branch',
        sequence: 1,
        operationId: 'operation',
    });
    assert.deepEqual(result.entries[7], derived);
    assert.equal(result.entries[8].STMB_chatId, 'parent chat');
    assert.equal(result.entries[8].STMB_start, 336);
    assert.equal(result.entries[8].STMB_end, 350);
    assert.equal(result.entries[8].STMB_canonicalLorebook, 'Related Branch 1');
});

test('chat-only copies remove STMB-owned bindings', () => {
    const result = clearStmbChatMetadataBindings({
        world_info: 'Chat Memories',
        STMemoryBooks: {
            manualCharacterLorebooks: { alice: 'Alice Memories' },
            sidePromptLorebookOverrides: { tracker: 'Tracker' },
            narratorMode: { enabled: true, members: [{ id: 'alice', lorebookName: 'Alice Memories', retired: false }] },
        },
    });
    assert.equal('world_info' in result, false);
    assert.equal('manualCharacterLorebooks' in result.STMemoryBooks, false);
    assert.equal('sidePromptLorebookOverrides' in result.STMemoryBooks, false);
    assert.equal('narratorMode' in result.STMemoryBooks, false);

    const manual = clearStmbChatMetadataBindings({
        world_info: 'Unrelated Character Lorebook',
        STMemoryBooks: { manualLorebook: 'Manual Memories' },
    });
    assert.equal(manual.world_info, 'Unrelated Character Lorebook');
    assert.equal('manualLorebook' in manual.STMemoryBooks, false);
});

test('Narrator copies include retired members and rewrite every cast assignment despite solo locks', () => {
    const metadata = {
        STMemoryBooks: {
            manualLorebook: 'Omniscient',
            narratorMode: {
                enabled: true,
                members: [
                    { id: 'alice', lorebookName: 'Alice', retired: false },
                    { id: 'bob', lorebookName: 'Bob', retired: true },
                ],
            },
        },
    };
    assert.deepEqual(collectStmbChatLorebookNames(metadata, { soloMemoryBookLocked: true }), ['Omniscient', 'Alice', 'Bob']);
    const rewritten = rewriteStmbChatMetadataForCopy(metadata, new Map([
        ['Omniscient', 'Omniscient Branch 1'],
        ['Alice', 'Alice Branch 1'],
        ['Bob', 'Bob Branch 1'],
    ]), 10, { soloMemoryBookLocked: true });
    assert.equal(rewritten.STMemoryBooks.manualLorebook, 'Omniscient Branch 1');
    assert.deepEqual(rewritten.STMemoryBooks.narratorMode.members.map(member => member.lorebookName), ['Alice Branch 1', 'Bob Branch 1']);
});
