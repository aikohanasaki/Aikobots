import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultStmbSettings, compileScene, normalizeStmbSettings, STMB_SETTINGS_VERSION } from '../public/scripts/stmb-core.js';
import {
    buildNarratorCopyTargets,
    collectNarratorSourceMetadata,
    createNarratorMember,
    getNarratorCastFromMessage,
    getNarratorSceneParticipants,
    mergeNarratorLorebookEntries,
    migrateNarratorLorebookReference,
    normalizeMultiCharacterSnapshot,
    normalizeNarratorConfig,
    setNarratorActiveCast,
    stampNarratorCast,
    validateNarratorBindings,
    validateNarratorMemberBinding,
} from '../public/scripts/stmb-narrator-mode.js';
import { createManagedSummaryEntryData } from '../public/scripts/stmb-summary.js';

test('Narrator configuration keeps stable identities and repairable missing assignments', () => {
    const { config, changed } = normalizeNarratorConfig({
        version: 0,
        enabled: true,
        members: [
            { id: 'alice-id', name: ' Alice ', lorebookName: '', retired: false, avatar: 'legacy.png' },
            { id: 'bob-id', name: 'Bob', lorebookName: 'Bob Book', retired: true },
        ],
        activeCastIds: ['alice-id', 'bob-id', 'alice-id'],
    });
    assert.equal(changed, true);
    assert.deepEqual(config.members, [
        { id: 'alice-id', name: 'Alice', lorebookName: '', retired: false },
        { id: 'bob-id', name: 'Bob', lorebookName: 'Bob Book', retired: true },
    ]);
    assert.deepEqual(config.activeCastIds, ['alice-id']);
    assert.equal(createNarratorMember({ id: 'fixed', name: 'Carol' }).id, 'fixed');
});

test('Narrator bindings require distinct available character books separate from canonical', () => {
    const members = [
        { id: 'a', name: 'Alice', lorebookName: 'Alice Book' },
        { id: 'b', name: 'Bob', lorebookName: 'Bob Book' },
    ];
    assert.equal(validateNarratorBindings({ members }, 'Omniscient', ['Alice Book', 'Bob Book']).valid, true);
    assert.equal(validateNarratorBindings({ members: [{ ...members[0], lorebookName: 'Omniscient' }] }, 'Omniscient', ['Omniscient']).issues[0].type, 'canonical');
    assert.equal(validateNarratorBindings({ members: [members[0], { ...members[1], lorebookName: 'Alice Book' }] }, 'Omniscient', ['Alice Book']).issues[0].type, 'duplicate');
    assert.equal(validateNarratorMemberBinding({ members: [{ id: 'broken', lorebookName: '' }, members[1]] }, members[1], 'Omniscient', ['Bob Book']).valid, true);
});

test('message stamps keep swipe snapshots independent and merge continuations', () => {
    const message = { extra: {}, swipe_id: 0, swipe_info: [{ extra: {} }, { extra: {} }] };
    stampNarratorCast(message, ['alice']);
    message.swipe_id = 1;
    stampNarratorCast(message, ['bob']);
    stampNarratorCast(message, ['carol'], { merge: true });
    assert.deepEqual(message.swipe_info[0].extra.STMemoryBooks.narratorCast.memberIds, ['alice']);
    assert.deepEqual(message.swipe_info[1].extra.STMemoryBooks.narratorCast.memberIds, ['bob', 'carol']);
    assert.deepEqual(getNarratorCastFromMessage(message), ['bob', 'carol']);
});

test('scene participant resolution uses tagged assistant responses authoritatively and legacy snapshots as hints', () => {
    const tagged = id => ({ is_user: false, extra: { STMemoryBooks: { narratorCast: { version: 1, memberIds: [id] } } } });
    const user = { is_user: true, extra: { STMemoryBooks: { narratorCast: { version: 1, memberIds: ['user-hint'] } } } };
    assert.deepEqual(getNarratorSceneParticipants([user, tagged('alice'), tagged('bob')]), {
        memberIds: ['alice', 'bob'],
        hasUntaggedMessages: false,
    });
    assert.deepEqual(getNarratorSceneParticipants([user, tagged('alice'), { is_user: false }]), {
        memberIds: ['user-hint', 'alice'],
        hasUntaggedMessages: true,
    });
});

test('scene compilation exposes Narrator routing metadata without adding it to scene text', () => {
    const messages = [
        { mes: 'Hello', name: 'User', is_user: true, extra: { STMemoryBooks: { narratorCast: { version: 1, memberIds: ['alice'] } } } },
        { mes: 'Reply', name: 'Narrator', is_user: false, extra: { STMemoryBooks: { narratorCast: { version: 1, memberIds: ['alice'] } } } },
    ];
    const compiled = compileScene(messages, { sceneStart: 0, sceneEnd: 1 }, { collectNarratorCast: true });
    assert.deepEqual(compiled.metadata.narratorParticipantIds, ['alice']);
    assert.equal(compiled.metadata.narratorHasUntaggedMessages, false);
    assert.equal(JSON.stringify(compiled.messages).includes('narratorCast'), false);
});

test('copy targets, prompt lore deduplication, lifecycle repair, and summary propagation preserve IDs', () => {
    const config = {
        enabled: true,
        members: [
            { id: 'alice', name: 'Alice', lorebookName: 'Alice Book', retired: false },
            { id: 'bob', name: 'Bob', lorebookName: 'Bob Book', retired: false },
        ],
        activeCastIds: ['alice'],
    };
    assert.deepEqual(buildNarratorCopyTargets(config, ['bob']).map(target => [target.lorebookName, target.ownerIds]), [['Bob Book', ['bob']]]);
    const target = [{ uid: 1, world: 'Alice Book' }];
    mergeNarratorLorebookEntries(target, { entries: { 1: { uid: 1 }, 2: { uid: 2, content: 'safe' } } }, 'Alice Book', new Set(['Alice Book.1']));
    assert.deepEqual(target.map(entry => entry.uid), [1, 2]);
    assert.equal(migrateNarratorLorebookReference(config, 'Alice Book', ''), true);
    assert.equal(config.enabled, false);
    assert.equal(config.members[0].id, 'alice');
    assert.equal(config.members[0].lorebookName, '');

    const sources = [
        { uid: 1, STMB_narratorParticipantIds: ['alice', 'bob'] },
        { uid: 2, STMB_narratorParticipantIds: ['bob'] },
    ];
    assert.deepEqual(collectNarratorSourceMetadata(sources, ['1', '2']), { STMB_narratorParticipantIds: ['alice', 'bob'] });
    const summary = createManagedSummaryEntryData({ title: 'Arc', summary: 'Text', keywords: [], memberIds: ['1', '2'] }, { sourceEntries: sources });
    assert.deepEqual(summary.STMB_narratorParticipantIds, ['alice', 'bob']);
});

test('settings v8 migration defaults the Narrator drawer safely', () => {
    const defaults = createDefaultStmbSettings();
    assert.equal(STMB_SETTINGS_VERSION, 8);
    assert.equal(defaults.moduleSettings.narratorCastDrawerCollapsed, true);
    assert.equal(defaults.moduleSettings.narratorCastDrawerPosition, null);
    const migrated = normalizeStmbSettings({ migrationVersion: 7, moduleSettings: {} });
    assert.equal(migrated.migrationVersion, 8);
    assert.equal(migrated.moduleSettings.narratorCastDrawerCollapsed, true);
    assert.equal(migrated.moduleSettings.narratorCastDrawerPosition, null);
});

test('active cast excludes retired or unknown identities', () => {
    const config = { members: [{ id: 'a', retired: false }, { id: 'b', retired: true }], activeCastIds: [] };
    assert.equal(setNarratorActiveCast(config, ['a', 'b', 'missing']), true);
    assert.deepEqual(config.activeCastIds, ['a']);
});

test('durable multi-character snapshots normalize legacy groups and strip unrelated payload fields', () => {
    assert.equal(normalizeMultiCharacterSnapshot({ multiCharacterSnapshot: null }), null);
    assert.deepEqual(normalizeMultiCharacterSnapshot({
        manualGroupSnapshot: {
            members: [{ key: 'alice', name: 'Alice', characterFilterName: 'Alice' }],
            bindings: { alice: 'Alice Book' },
            characterFilterNames: ['Alice'],
        },
    }).mode, 'group');
    const narrator = normalizeMultiCharacterSnapshot({
        multiCharacterSnapshot: {
            mode: 'narrator',
            canonicalLorebookName: 'Omniscient',
            members: [{ id: 'alice', name: 'Alice', lorebookName: 'Alice Book', content: 'must not persist' }],
            bindings: { alice: 'Alice Book' },
            participantIds: ['alice'],
            lorebookData: { entries: { secret: true } },
        },
    });
    assert.deepEqual(narrator.members, [{ id: 'alice', name: 'Alice', lorebookName: 'Alice Book', retired: false }]);
    assert.equal('lorebookData' in narrator, false);
    assert.equal('content' in narrator.members[0], false);
});
