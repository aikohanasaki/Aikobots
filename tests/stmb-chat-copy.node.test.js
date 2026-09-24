import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { regenerateChatIdentities, AIKOBOTS_MESSAGE_UUID_KEY, AIKOBOTS_SWIPE_UUID_KEY } from '../public/scripts/chat-identities.js';
import { getStmbMemoryRole, hasStmbSharedRoles } from '../public/scripts/stmb-group-policy.js';
import { createDefaultStmbSettings, createManagedLorebookEntryData, normalizeStmbSettings, resolveStmbChatCopyKind } from '../public/scripts/stmb-core.js';

import {
    allocateStmbLorebookCopyName,
    clearStmbChatMetadataBindings,
    cloneStmbLorebookForChatCopy,
    collectStmbChatLorebookNames,
    finalizeStmbLorebookCopy,
    rewriteStmbChatMetadataForCopy,
    prepareStmbRollbackCopyMetadata,
    StmbChatCopyError,
    getStmbLorebookCopyRoot,
} from '../src/stmb-chat-copy.js';

test('copy rollback policy requires acknowledgement and retries failed metadata saves', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export async function syncStmbRollbackPolicy()'), source.indexOf('function getStmbOrdinaryUserLorebookNames()')).replace('export ', '');
    const previous = { enabled: true, books: ['Memories'] };
    const state = { autoRollbackPolicy: previous };
    let saves = 0;
    const sync = vm.runInNewContext(body + '; syncStmbRollbackPolicy', {
        buildStmbSceneContext: () => ({ chatRef: 'chat' }),
        getModuleSettings: () => ({ autoRollbackEnabled: true, autoRollbackApplyToBranches: true }),
        getStmbState: () => state, listTemplates: async () => [], isSceneContextCurrent: () => true,
        resolveLorebookName: () => 'Memories', getLorebookStorageForRequest: () => 'user',
        CHAT_SAVE_RESULT: { SAVED: 'saved' }, saveMetadata: async () => ++saves === 1 ? 'failed' : 'saved', translate: text => text,
    });
    await assert.rejects(sync(), /could not be saved/);
    assert.equal(state.autoRollbackPolicy, previous);
    await sync();
    assert.equal(state.autoRollbackPolicy.applyToBranches, true);
    await sync();
    assert.equal(saves, 2);
});

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
    assert.equal(createDefaultStmbSettings().moduleSettings.autoRollbackApplyToBranches, false);
    assert.equal(resolveStmbChatCopyKind('branch', { copyMemoryBooksWithChatCopies: false, autoRollbackEnabled: true, autoRollbackApplyToBranches: true }), 'branch');
    assert.equal(resolveStmbChatCopyKind('branch', { copyMemoryBooksWithChatCopies: false, autoRollbackEnabled: false, autoRollbackApplyToBranches: true }), '');
});

test('rollback copies include active template targets and reject every retained parent lock', () => {
    const source = { STMemoryBooks: { manualLorebook: 'Memories', autoRollbackPolicy: { enabled: true, applyToBranches: true, books: ['Old target'] },
        sidePromptLorebookOverrides: { cast: '__memory__', summary: 'Chat-specific' } } };
    const prompts = { cast: { settings: { lorebook: { targetLorebookName: 'Ignored' } } },
        summary: { settings: { lorebook: { targetLorebookName: 'Also ignored' } } },
        tracker: { enabled: true, settings: { lorebook: { targetLorebookName: 'Tracker' } } },
        disabled: { enabled: false, settings: { lorebook: { targetLorebookName: 'Dormant' } } } };
    const prepared = prepareStmbRollbackCopyMetadata(source, prompts);
    assert.deepEqual(collectStmbChatLorebookNames(prepared), ['Memories', 'Chat-specific', 'Tracker']);
    const names = new Map(collectStmbChatLorebookNames(prepared).map(name => [name, `${name} Branch 1`]));
    const child = rewriteStmbChatMetadataForCopy(prepared, names, 4);
    assert.deepEqual(child.STMemoryBooks.autoRollbackPolicy.books, [...names.values()]);
    assert.equal(child.STMemoryBooks.sidePromptLorebookOverrides.tracker, 'Tracker Branch 1');
    assert.equal(source.STMemoryBooks.sidePromptLorebookOverrides.tracker, undefined);
    assert.throws(() => prepareStmbRollbackCopyMetadata(source, prompts, { soloMemoryBookLocked: true }), { code: 'stmb_copy_rollback_unsafe' });
    assert.throws(() => prepareStmbRollbackCopyMetadata(source, prompts, { lockedCharacterBindingKeys: ['alice'] }), { code: 'stmb_copy_rollback_unsafe' });
    assert.equal(clearStmbChatMetadataBindings(source).STMemoryBooks.autoRollbackPolicy, undefined);
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

test('direct and group copy transactions prevalidate rollback, publish once, and preserve parent state', async () => {
    const rollbackSource = fs.readFileSync(new URL('../src/stmb-rollback.js', import.meta.url), 'utf8');
    const planStmbChatCopyBook = vm.runInNewContext(rollbackSource.slice(rollbackSource.indexOf('const SNAPSHOT ='), rollbackSource.indexOf('/** Executes a prevalidated rollback'))
        .replaceAll('export function ', 'function ') + '; planStmbChatCopyBook', {
        createHash, structuredClone, getStmbMemoryRole, hasStmbSharedRoles, SIDE_PROMPT_HISTORY_KEY: 'STMB_sidePromptHistory',
        stmbOperationConflict: () => new Error('Ambiguous ordinary book'),
    });
    const endpoint = fs.readFileSync(new URL('../src/endpoints/chats.js', import.meta.url), 'utf8');
    const body = endpoint.slice(endpoint.indexOf('async function copyPrefixWithMemoryBooks('), endpoint.indexOf("router.post('/save-prefix'"));
    for (const isGroup of [false, true]) {
        const messages = [0, 1, 2].map(index => ({ mes: `Ordinary message ${index}`, aikobots_message_uuid: randomUUID() }));
        const parent = { chat_revision: 1, chat_metadata: { STMemoryBooks: { manualLorebook: 'Book', highestMemoryProcessed: 2,
            autoRollbackPolicy: { enabled: true, applyToBranches: true },
            ...(isGroup ? { narratorMode: { enabled: true, members: [{ id: 'alice', lorebookName: 'Tracker', retired: true }] } } : {}),
        } } };
        const books = new Map(['Book', 'Tracker'].map((name, index) => [name, { entries: { 1: { uid: 1, stmemorybooks: true,
            STMB_startUuid: messages[index * 2].aikobots_message_uuid, STMB_endUuid: messages[index * 2].aikobots_message_uuid } } }]));
        const original = structuredClone({ parent, books, messages });
        const copies = new Map();
        let child = null;
        let bookLock = false;
        let chatLock = false;
        let writes = 0;
        const copy = vm.runInNewContext(body + '; copyPrefixWithMemoryBooks', {
            StmbChatCopyError, structuredClone, Map, Set, AIKOBOTS_MESSAGE_UUID_KEY, AIKOBOTS_SWIPE_UUID_KEY,
            normalizeStmbCopyKind: request => request.copy_kind, requireRequestOperationId: request => request.operation_id,
            getStmbCopyReplay: async (_path, id) => child?.marker.operation_id === id ? { ok: true, duplicate_operation: true } : null,
            hasPrimaryChatStorageFile: () => child !== null,
            getStmbCopyLockOptions: () => ({}),
            withLorebookManagementTransaction: async callback => {
                bookLock = true;
                try { return await callback({
                    createUser: (_user, name, data) => { assert.ok(bookLock && chatLock); copies.set(name, data); },
                    removeCreatedUser: (_user, name) => copies.delete(name),
                }); } finally { bookLock = false; }
            },
            withChatSaveLocks: async (_paths, callback) => { assert.ok(bookLock); chatLock = true; try { return await callback(); } finally { chatLock = false; } },
            listLorebookNamesForAllocation: () => [...books.keys(), ...copies.keys()],
            readChatPrefixForCopy: async () => ({ sourceHeader: structuredClone(parent), messages: structuredClone(messages.slice(0, 2)) }),
            requireChatMutationRequest: request => assert.equal(request.base_revision, parent.chat_revision),
            applyRequestedSwipeToPrefix() {}, prepareStmbRollbackCopyMetadata, collectStmbChatLorebookNames,
            readStmbSidePrompts: () => ({ document: { prompts: { tracker: { settings: { lorebook: { targetLorebookName: 'Tracker' } } } } } }),
            hasOrdinaryUserLorebookForGeneration: (_user, name) => books.has(name),
            resolveLorebookWithMetadata: (_user, name) => ({ data: structuredClone(books.get(name)), metadata: { name, storage: 'user' } }),
            getStmbLorebookCopyRoot, allocateStmbLorebookCopyName, cloneStmbLorebookForChatCopy, regenerateChatIdentities,
            _: { isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value) }, uuidv4: randomUUID,
            replaceChatStorageExtension: name => name, fs: { existsSync: () => true }, loadDb: async () => ({ close() {} }),
            getLogicalMessageRowByUuid: (_db, uuid) => { const index = messages.findIndex(message => message.aikobots_message_uuid === uuid); return index < 0 ? null : { logicalIndex: index }; },
            planStmbChatCopyBook, finalizeStmbLorebookCopy, rewriteStmbChatMetadataForCopy, clearStmbChatMetadataBindings,
            buildCopiedChatHeader: ({ chatMetadata, marker }) => ({ chat_metadata: chatMetadata, marker }),
            writeLogicalChat: async (_path, header, targetMessages) => { writes++; child = { ...header, messages: targetMessages }; return {}; },
            getChatRevision: () => 1, deleteChatStorageCompanions: () => { child = null; },
        });
        const options = { request: { user: {}, body: { copy_kind: isGroup ? 'checkpoint' : 'branch', copy_memory_books: true,
            operation_id: 'copy-1', base_revision: 1, source_file: 'parent', source_id: 'parent' } },
        sourcePath: 'source', targetPath: 'child', targetChatId: 'child', prefixEndId: 1, isGroup };
        assert.equal((await copy(options)).ok, true);
        assert.equal(writes, 1);
        assert.equal(copies.size, 2);
        const label = isGroup ? 'Checkpoint' : 'Branch';
        assert.equal(Object.keys(copies.get(`Tracker ${label} 1`).entries).length, 0);
        assert.equal(copies.get(`Book ${label} 1`).entries[1].STMB_startUuid, child.messages[0].aikobots_message_uuid);
        assert.notEqual(child.messages[0].aikobots_message_uuid, messages[0].aikobots_message_uuid);
        assert.equal(child.chat_metadata.STMemoryBooks.highestMemoryProcessed, 0);
        assert.equal((await copy(options)).duplicate_operation, true);
        assert.equal(writes, 1);
        assert.deepEqual({ parent, books, messages }, original);
        child = null; copies.clear();
        delete books.get('Tracker').entries[1].STMB_startUuid;
        await assert.rejects(copy(options), { code: 'stmb_copy_rollback_unsafe' });
        assert.equal(child, null);
        assert.equal(copies.size, 0);
        assert.equal(writes, 1);
    }
});
