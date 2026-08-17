import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getEligiblePresetWorldNames,
    isCoreWorldInfoLocksExtension,
    isSafeOrdinaryLorebookExportResponse,
    loadWorldInfoLocksSettingsSource,
    mergeWorldInfoPresetSelection,
    migrateLegacyCharacterLockIds,
    migrateLegacyGroupLockIds,
    moveCharacterLockId,
    normalizeWorldInfoLocksSettings,
    removePresetReferences,
    renamePresetReferences,
    resolveWorldInfoPresetLock,
    validateWorldInfoPresetImport,
} from '../public/scripts/world-info-locks-policy.js';

test('canonical legacy World Info Locks manifests are superseded by core', () => {
    assert.equal(isCoreWorldInfoLocksExtension('third-party/SillyTavern-WorldInfoLocks', {}), true);
    assert.equal(isCoreWorldInfoLocksExtension('renamed-folder', {
        homePage: 'https://github.com/aikohanasaki/SillyTavern-WorldInfoLocks/',
    }), true);
    assert.equal(isCoreWorldInfoLocksExtension('another-extension', { homePage: 'https://example.com' }), false);
});

test('legacy World Info Locks settings normalize without dropping compatibility fields', () => {
    const settings = normalizeWorldInfoLocksSettings({
        presetName: 'Story',
        presetList: [{
            name: 'Story',
            worldList: ['One', 'One', 'Two'],
            worldInfoSettings: { world_info_depth: 4, deprecated_setting: 'keep' },
            legacyField: true,
        }],
        characterLocks: { Alice: 'Story' },
        groupLocks: { group1: 'Story' },
        customLegacyField: { keep: true },
    });

    assert.deepEqual(settings.presetList[0].worldList, ['One', 'Two']);
    assert.equal(settings.presetList[0].legacyField, true);
    assert.deepEqual(settings.presetList[0].worldInfoSettings, { world_info_depth: 4, deprecated_setting: 'keep' });
    assert.deepEqual(settings.customLegacyField, { keep: true });
    assert.deepEqual(settings.characterLockIds, {});
    assert.equal(settings.enableCharacterLocks, true);
});

test('raw legacy settings load without depending on extension activation', () => {
    const loaded = loadWorldInfoLocksSettingsSource({
        extension_settings: {
            worldInfoPresets: {
                presetName: 'Core',
                presetList: [{ name: 'Core', worldList: ['Book'] }],
            },
        },
    }, {
        presetName: 'Stale',
        presetList: [{ name: 'Stale', worldList: [] }],
    });
    assert.equal(loaded.presetName, 'Core');

    const missingForNewAccount = loadWorldInfoLocksSettingsSource({ extension_settings: {} }, loaded);
    assert.equal(missingForNewAccount.presetName, '');
    assert.deepEqual(missingForNewAccount.presetList, []);
});

test('lock resolution prefers stable identities and honors chat precedence', () => {
    const settings = normalizeWorldInfoLocksSettings({
        presetList: [
            { name: 'Stable', worldList: [] },
            { name: 'Legacy', worldList: [] },
            { name: 'Chat', worldList: [] },
        ],
        characterLockIds: { 'alice.png': 'Stable' },
        characterLocks: { Alice: 'Legacy' },
        enableCharacterLocks: true,
        enableChatLocks: true,
    });
    const context = { isGroupChat: false, characterId: 'alice.png', characterName: 'Alice' };

    assert.equal(resolveWorldInfoPresetLock(settings, context, 'Chat'), 'Stable');
    delete settings.characterLockIds['alice.png'];
    context.legacyNameUnique = false;
    assert.equal(resolveWorldInfoPresetLock(settings, context, ''), '');
    context.legacyNameUnique = true;
    settings.characterLockIds['alice.png'] = 'Stable';
    settings.preferChatOverCharacterLocks = true;
    assert.equal(resolveWorldInfoPresetLock(settings, context, 'Chat'), 'Chat');
});

test('legacy group migration only accepts unique group names', () => {
    const settings = normalizeWorldInfoLocksSettings({
        presetList: [{ name: 'Story', worldList: [] }],
        characterLocks: { Party: 'Story', Duplicate: 'Story' },
    });
    const changed = migrateLegacyGroupLockIds(settings, [
        { name: 'Party', id: 'group-1' },
        { name: 'Duplicate', id: 'group-2' },
        { name: 'Duplicate', id: 'group-3' },
    ], ['Character']);

    assert.equal(changed, true);
    assert.deepEqual(settings.groupLocks, { 'group-1': 'Story' });
    assert.deepEqual(settings.characterLocks, { Party: 'Story', Duplicate: 'Story' });
    assert.equal(resolveWorldInfoPresetLock(settings, {
        isGroupChat: true,
        groupId: 'missing',
        groupName: 'Party',
        legacyGroupNameUnique: true,
    }), 'Story');
});

test('legacy character migration only accepts unique character names', () => {
    const settings = normalizeWorldInfoLocksSettings({
        presetList: [{ name: 'Story', worldList: [] }],
        characterLocks: { Alice: 'Story', Twin: 'Story', Missing: 'Story' },
    });
    const changed = migrateLegacyCharacterLockIds(settings, [
        { name: 'Alice', avatar: 'alice.png' },
        { name: 'Twin', avatar: 'twin-a.png' },
        { name: 'Twin', avatar: 'twin-b.png' },
    ]);

    assert.equal(changed, true);
    assert.deepEqual(settings.characterLockIds, { 'alice.png': 'Story' });
    assert.deepEqual(settings.characterLocks, { Alice: 'Story', Twin: 'Story', Missing: 'Story' });
    assert.equal(moveCharacterLockId(settings, 'alice.png', 'alice-renamed.png'), true);
    assert.deepEqual(settings.characterLockIds, { 'alice-renamed.png': 'Story' });
});

test('preset world filtering excludes secure, hidden, missing, and duplicate names', () => {
    assert.deepEqual(
        getEligiblePresetWorldNames(['User A', 'Secure A', 'Hidden A', 'User A'], new Set(['User A', 'User B'])),
        ['User A'],
    );

    assert.deepEqual(
        mergeWorldInfoPresetSelection(
            ['User B', 'Secure A', 'Hidden Binding'],
            ['User A', 'Secure A'],
            new Set(['User A', 'User B']),
            new Set(['Secure A']),
            new Set(['User A', 'User B', 'Secure A']),
        ),
        ['User A', 'Secure A', 'Hidden Binding'],
    );
});

test('preset rename and delete update every compatibility lock map', () => {
    const settings = normalizeWorldInfoLocksSettings({
        presetName: 'Old',
        presetList: [{ name: 'Old', worldList: [] }],
        characterLocks: { Alice: 'Old' },
        characterLockIds: { 'alice.png': 'Old' },
        groupLocks: { group1: 'Old' },
        globalDefaultPreset: 'Old',
    });

    assert.equal(renamePresetReferences(settings, 'Old', 'New'), true);
    assert.deepEqual(settings.characterLocks, { Alice: 'New' });
    assert.deepEqual(settings.characterLockIds, { 'alice.png': 'New' });
    assert.deepEqual(settings.groupLocks, { group1: 'New' });
    assert.equal(settings.globalDefaultPreset, 'New');

    removePresetReferences(settings, 'New');
    assert.deepEqual(settings.characterLocks, {});
    assert.deepEqual(settings.characterLockIds, {});
    assert.deepEqual(settings.groupLocks, {});
    assert.equal(settings.globalDefaultPreset, '');
});

test('preset import validates the complete document before accepting it', () => {
    assert.equal(validateWorldInfoPresetImport({
        name: 'Legacy',
        worldList: ['Book'],
        books: { Book: { entries: {} } },
        characterLocks: { Alice: 'Legacy' },
    }).name, 'Legacy');

    assert.throws(
        () => validateWorldInfoPresetImport({ name: 'Broken', worldList: 'Book' }),
        /valid name or world list/,
    );
    assert.throws(
        () => validateWorldInfoPresetImport({
            name: 'Protected',
            worldList: ['Secure'],
            books: { Secure: { entries: { 0: { hidden: true } } } },
        }),
        /Secure or hidden lorebook data/,
    );
    assert.throws(
        () => validateWorldInfoPresetImport({ name: 'Malformed', worldList: ['Book'], groupLocks: [] }),
        /invalid lock data/,
    );
    assert.throws(
        () => validateWorldInfoPresetImport({ name: 'Malformed', worldList: ['Book'], worldInfoSettings: [] }),
        /invalid World Info settings/,
    );
});

test('ordinary lorebook export response rejects secure and hidden data', () => {
    assert.equal(isSafeOrdinaryLorebookExportResponse({
        data: { entries: { 0: { content: 'ordinary' } } },
        metadata: { storage: 'user' },
    }), true);
    assert.equal(isSafeOrdinaryLorebookExportResponse({
        data: { entries: { 0: { content: 'protected', hidden: true } } },
        metadata: { storage: 'user' },
    }), false);
    assert.equal(isSafeOrdinaryLorebookExportResponse({
        data: { entries: {} },
        metadata: { storage: 'secure' },
    }), false);
});
