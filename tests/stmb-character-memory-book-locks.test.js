import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStmbSettings } from '../public/scripts/stmb-core.js';

import {
    getCharacterMemoryBookLockStatus,
    moveCharacterMemoryBookLock,
    normalizeCharacterMemoryBookLocks,
    refreshCharacterMemoryBookLockName,
    removeCharacterMemoryBookLock,
    resolveManualGroupCharacterBindings,
    resolveManualLorebookForCharacter,
    setCharacterMemoryBookLock,
} from '../public/scripts/stmb-character-memory-book-locks.js';

test('character locks normalize safely and discard invalid records', () => {
    const raw = JSON.parse('{"alice.png":{"characterName":" Alice ","lorebookName":" Memories ","extra":true},"bad":{},"__proto__":{"characterName":"Proto","lorebookName":"Unsafe"}}');
    const { locks, changed } = normalizeCharacterMemoryBookLocks(raw);

    assert.equal(changed, true);
    assert.deepEqual(locks['alice.png'], { characterName: 'Alice', lorebookName: 'Memories' });
    assert.equal(Object.hasOwn(locks, 'bad'), false);
    assert.deepEqual(locks.__proto__, { characterName: 'Proto', lorebookName: 'Unsafe' });
    assert.equal(Object.getPrototypeOf(locks), Object.prototype);
});

test('settings normalization preserves character locks', () => {
    const settings = normalizeStmbSettings({
        moduleSettings: {},
        characterMemoryBookLocks: { 'alice.png': { characterName: 'Alice', lorebookName: 'Memories' } },
    });
    assert.deepEqual(settings.characterMemoryBookLocks, {
        'alice.png': { characterName: 'Alice', lorebookName: 'Memories' },
    });
});

test('solo manual resolution gives a character lock precedence only in manual solo chats', () => {
    const locks = { 'alice.png': { characterName: 'Alice', lorebookName: 'Alice Memories' } };
    assert.deepEqual(resolveManualLorebookForCharacter({
        manualModeEnabled: true,
        isGroupChat: false,
        characterKey: 'alice.png',
        manualLorebook: 'Chat Memories',
        locks,
    }), {
        lorebookName: 'Alice Memories',
        source: 'character-lock',
        lock: { characterKey: 'alice.png', characterName: 'Alice', lorebookName: 'Alice Memories' },
    });
    assert.equal(resolveManualLorebookForCharacter({
        manualModeEnabled: true,
        isGroupChat: true,
        characterKey: 'alice.png',
        manualLorebook: 'Group Memories',
        locks,
    }).lorebookName, 'Group Memories');
});

test('group manual resolution substitutes locked members without changing chat bindings', () => {
    const chatBindings = { alice: 'Old Alice', bob: 'Bob Memories' };
    const result = resolveManualGroupCharacterBindings({
        manualModeEnabled: true,
        members: [
            { key: 'alice', avatar: 'alice.png' },
            { key: 'bob', avatar: 'bob.png' },
        ],
        chatBindings,
        locks: { 'alice.png': { characterName: 'Alice', lorebookName: 'Locked Alice' } },
    });

    assert.deepEqual(result.bindings, { alice: 'Locked Alice', bob: 'Bob Memories' });
    assert.equal(result.locksByMemberKey.alice.lorebookName, 'Locked Alice');
    assert.deepEqual(chatBindings, { alice: 'Old Alice', bob: 'Bob Memories' });
});

test('character lock lifecycle follows avatar renames, edits, and deletion', () => {
    const locks = {};
    assert.equal(setCharacterMemoryBookLock(locks, 'alice.png', 'Alice', 'Memories'), true);
    assert.equal(getCharacterMemoryBookLockStatus(locks, 'alice.png', ['Memories']).state, 'locked');
    assert.equal(getCharacterMemoryBookLockStatus(locks, 'alice.png', []).state, 'broken');
    assert.equal(moveCharacterMemoryBookLock(locks, 'alice.png', 'alice-2.png', 'Alice'), true);
    assert.equal(refreshCharacterMemoryBookLockName(locks, 'alice-2.png', 'Alice Updated'), true);
    assert.deepEqual(locks['alice-2.png'], { characterName: 'Alice Updated', lorebookName: 'Memories' });
    assert.equal(removeCharacterMemoryBookLock(locks, 'alice-2.png'), true);
    assert.deepEqual(locks, {});
});
