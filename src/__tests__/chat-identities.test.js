import { describe, expect, it } from '@jest/globals';

import {
    AIKOBOTS_SWIPE_UUID_KEY,
    compareActiveSwipeState,
    materializeSwipeGenerationTarget,
    repairPendingOverswipeState,
    replaceSwipeInfoPreservingIdentity,
    validateSwipeGenerationTarget,
    validateMessageSwipeState,
} from '../../public/scripts/chat-identities.js';

const FIRST_UUID = '11111111-1111-4111-8111-111111111111';
const SECOND_UUID = '22222222-2222-4222-8222-222222222222';

function makeMessage() {
    return {
        mes: 'selected text',
        swipe_id: 1,
        swipes: ['other text', 'selected text'],
        send_date: 'June 14, 2026 10:30am',
        gen_started: '2026-06-14T17:30:40.886Z',
        gen_finished: '2026-06-14T17:31:00.052Z',
        extra: { model: 'test-model' },
        swipe_info: [
            {
                [AIKOBOTS_SWIPE_UUID_KEY]: FIRST_UUID,
                send_date: 'June 14, 2026 10:29am',
                gen_started: '2026-06-14T17:29:46.906Z',
                gen_finished: '2026-06-14T17:30:03.746Z',
                extra: { model: 'test-model' },
            },
            {
                [AIKOBOTS_SWIPE_UUID_KEY]: SECOND_UUID,
                send_date: 'June 14, 2026 10:30am',
                gen_started: '2026-06-14T17:30:40.886Z',
                gen_finished: '2026-06-14T17:31:00.052Z',
                extra: { model: 'test-model' },
            },
        ],
    };
}

function expectSingleCode(result, bucket, code, path) {
    expect(result[bucket]).toEqual(expect.arrayContaining([
        expect.objectContaining({ code, path }),
    ]));
}

describe('replaceSwipeInfoPreservingIdentity', () => {
    it('preserves an existing swipe UUID while replacing streaming metadata', () => {
        const replacement = replaceSwipeInfoPreservingIdentity(
            { [AIKOBOTS_SWIPE_UUID_KEY]: FIRST_UUID, stale: true },
            { send_date: 'updated', extra: { model: 'updated-model' } },
            { generateUuid: () => SECOND_UUID },
        );

        expect(replacement).toEqual({
            [AIKOBOTS_SWIPE_UUID_KEY]: FIRST_UUID,
            send_date: 'updated',
            extra: { model: 'updated-model' },
        });
    });

    it('creates an identity when replacing legacy metadata without one', () => {
        const replacement = replaceSwipeInfoPreservingIdentity(
            { send_date: 'legacy' },
            { send_date: 'updated' },
            { generateUuid: () => SECOND_UUID },
        );

        expect(replacement[AIKOBOTS_SWIPE_UUID_KEY]).toBe(SECOND_UUID);
    });
});

describe('compareActiveSwipeState', () => {
    it('accepts identical modern active-swipe state', () => {
        expect(compareActiveSwipeState(makeMessage())).toEqual({
            ok: true,
            fatalMismatches: [],
            harmlessDifferences: [],
            informationalDifferences: [],
            repairableDifferences: [],
            ambiguousConflicts: [],
        });
    });

    it.each([
        ['top-level branches', message => { message.extra.branches = ['branch']; }, 'extra.branches'],
        ['selected-swipe branches', message => { message.swipe_info[1].extra.branches = ['branch']; }, 'extra.branches'],
        ['bookmark metadata', message => { message.extra.bookmark_link = 'bookmark-name'; }, 'extra.bookmark_link'],
    ])('classifies one-sided %s as harmless', (_label, mutate, path) => {
        const message = makeMessage();
        mutate(message);
        const result = compareActiveSwipeState(message);
        expect(result.ok).toBe(true);
        expectSingleCode(result, 'harmlessDifferences', 'active_swipe_preserved_metadata_one_sided', path);
    });

    it('classifies one-sided bias null as repairable', () => {
        const message = makeMessage();
        message.extra.bias = null;
        expectSingleCode(compareActiveSwipeState(message), 'repairableDifferences', 'active_swipe_bias_missing_null', 'extra.bias');
    });

    it('classifies one-sided unknown imported metadata as informational', () => {
        const message = makeMessage();
        message.extra.imported_vendor_field = { preserved: true };
        expectSingleCode(compareActiveSwipeState(message), 'informationalDifferences', 'active_swipe_imported_metadata_one_sided', 'extra.imported_vendor_field');
    });

    it('classifies equivalent Unix-seconds and Unix-milliseconds dates as repairable', () => {
        const message = makeMessage();
        message.send_date = 1_767_323_045;
        message.swipe_info[1].send_date = 1_767_323_045_000;
        expectSingleCode(compareActiveSwipeState(message), 'repairableDifferences', 'active_swipe_send_date_equivalent', 'send_date');
    });

    it('classifies equivalent Unix and historical human-readable dates as repairable', () => {
        const message = makeMessage();
        message.send_date = Date.UTC(2026, 0, 2, 3, 4, 5);
        message.swipe_info[1].send_date = '2026-1-2 @03h 04m 05s 000ms';
        expectSingleCode(compareActiveSwipeState(message), 'repairableDifferences', 'active_swipe_send_date_equivalent', 'send_date');
    });

    it('classifies a missing legacy date as harmless', () => {
        const message = makeMessage();
        delete message.swipe_info[1].gen_started;
        expectSingleCode(compareActiveSwipeState(message), 'harmlessDifferences', 'active_swipe_gen_started_missing', 'gen_started');
    });

    it('classifies different parseable dates as ambiguous', () => {
        const message = makeMessage();
        message.swipe_info[1].gen_finished = '2026-06-14T17:31:01.052Z';
        expectSingleCode(compareActiveSwipeState(message), 'ambiguousConflicts', 'active_swipe_gen_finished_conflict', 'gen_finished');
    });

    it('classifies an unrecognized present date as ambiguous', () => {
        const message = makeMessage();
        message.swipe_info[1].send_date = 'sometime yesterday';
        expectSingleCode(compareActiveSwipeState(message), 'ambiguousConflicts', 'active_swipe_send_date_unrecognized', 'send_date');
    });

    it('rejects a genuine active-text mismatch', () => {
        const message = makeMessage();
        message.mes = 'different text';
        expectSingleCode(compareActiveSwipeState(message), 'fatalMismatches', 'active_swipe_text_mismatch', 'swipes[1]');
    });

    it('rejects different valid UUIDs that both claim the active swipe', () => {
        const message = makeMessage();
        message[AIKOBOTS_SWIPE_UUID_KEY] = FIRST_UUID;
        expectSingleCode(compareActiveSwipeState(message), 'fatalMismatches', 'active_swipe_uuid_conflict', AIKOBOTS_SWIPE_UUID_KEY);
    });

    it.each([
        ['missing', message => { delete message.swipe_info[1][AIKOBOTS_SWIPE_UUID_KEY]; }, 'missing_swipe_uuid'],
        ['malformed', message => { message.swipe_info[1][AIKOBOTS_SWIPE_UUID_KEY] = 'legacy-id'; }, 'malformed_swipe_uuid'],
    ])('classifies a %s legacy UUID as repairable', (_label, mutate, code) => {
        const message = makeMessage();
        mutate(message);
        const result = compareActiveSwipeState(message);
        expect(result.ok).toBe(true);
        expectSingleCode(result, 'repairableDifferences', code, `swipe_info[1].${AIKOBOTS_SWIPE_UUID_KEY}`);
    });

    it('rejects duplicate valid swipe UUIDs', () => {
        const message = makeMessage();
        message.swipe_info[1][AIKOBOTS_SWIPE_UUID_KEY] = FIRST_UUID;
        expectSingleCode(compareActiveSwipeState(message), 'fatalMismatches', 'duplicate_swipe_uuid', `swipe_info[1].${AIKOBOTS_SWIPE_UUID_KEY}`);
    });

    it('classifies same-key conflicting metadata as ambiguous', () => {
        const message = makeMessage();
        message.extra.model = 'different-model';
        expectSingleCode(compareActiveSwipeState(message), 'ambiguousConflicts', 'active_swipe_metadata_conflict', 'extra.model');
    });

    it('accepts multiple swipes with missing swipe_info as repairable', () => {
        const message = makeMessage();
        delete message.swipe_info;
        const result = compareActiveSwipeState(message);
        expect(result.ok).toBe(true);
        expectSingleCode(result, 'repairableDifferences', 'swipe_info_missing', 'swipe_info');
        expectSingleCode(result, 'repairableDifferences', 'selected_swipe_info_missing', 'swipe_info[1]');
    });

    it('accepts shorter swipe_info when selected text agrees', () => {
        const message = makeMessage();
        message.swipe_id = 0;
        message.mes = message.swipes[0];
        message.swipe_info.pop();
        message.send_date = message.swipe_info[0].send_date;
        message.gen_started = message.swipe_info[0].gen_started;
        message.gen_finished = message.swipe_info[0].gen_finished;
        const result = compareActiveSwipeState(message);
        expect(result.ok).toBe(true);
        expectSingleCode(result, 'repairableDifferences', 'swipe_info_shorter_than_swipes', 'swipe_info');
    });

    it.each([
        ['invalid swipe id', message => { message.swipe_id = 4; }, 'swipe_id_out_of_bounds', 'swipe_id'],
        ['non-array swipes', message => { message.swipes = {}; }, 'invalid_swipe_arrays', 'swipes'],
        ['contradictory selected swipe info', message => { message.swipe_info[1] = 'invalid'; }, 'invalid_selected_swipe_info', 'swipe_info[1]'],
    ])('rejects %s', (_label, mutate, code, path) => {
        const message = makeMessage();
        mutate(message);
        expectSingleCode(compareActiveSwipeState(message), 'fatalMismatches', code, path);
    });

    it('repairs only an exact one-past-the-end overswipe sentinel', () => {
        const message = makeMessage();
        message.swipe_id = message.swipes.length;

        expect(repairPendingOverswipeState(message, { logicalChatIndex: 3 })).toEqual({
            repaired: true,
            swipeId: 1,
            reason: '',
        });
        expect(message.swipe_id).toBe(1);
        expect(validateMessageSwipeState(message).ok).toBe(true);
    });

    it('does not clamp unrelated or internally contradictory swipe states', () => {
        const unrelated = makeMessage();
        unrelated.swipe_id = unrelated.swipes.length + 1;
        expect(repairPendingOverswipeState(unrelated).repaired).toBe(false);
        expect(unrelated.swipe_id).toBe(3);

        const contradictory = makeMessage();
        contradictory.swipe_id = contradictory.swipes.length;
        contradictory.mes = 'text that does not match the final materialized swipe';
        expect(repairPendingOverswipeState(contradictory)).toMatchObject({
            repaired: false,
            swipeId: 2,
            reason: 'active_swipe_text_mismatch',
        });
        expect(contradictory.swipe_id).toBe(2);
    });

    it('treats CRLF and LF active text as equivalent', () => {
        const message = makeMessage();
        message.mes = 'selected\r\ntext';
        message.swipes[1] = 'selected\ntext';
        expect(compareActiveSwipeState(message).ok).toBe(true);
    });

    it('retains greeting-specific text and metadata allowances', () => {
        const message = makeMessage();
        message.mes = 'rendered greeting';
        message.extra.model = 'greeting model';
        expect(compareActiveSwipeState(message, { allowMesMismatch: true, allowMetadataMismatch: true }).ok).toBe(true);
    });

    it('defaults an unrecognized two-sided field difference to ambiguous', () => {
        const message = makeMessage();
        message.extra.imported = { nested: 'top' };
        message.swipe_info[1].extra.imported = { nested: 'swipe' };
        expectSingleCode(compareActiveSwipeState(message), 'ambiguousConflicts', 'active_swipe_metadata_conflict', 'extra.imported.nested');
    });

    it('does not mutate either compared metadata source', () => {
        const message = makeMessage();
        message.extra.branches = [{ id: 1 }];
        message.swipe_info[1].extra.imported = { nested: true };
        const snapshot = structuredClone(message);
        compareActiveSwipeState(message);
        expect(message).toEqual(snapshot);
    });

    it('exposes the same shared comparison contract through the validator', () => {
        const message = makeMessage();
        message.extra.model = 'different-model';
        expect(validateMessageSwipeState(message).comparison).toEqual(compareActiveSwipeState(message));
    });
});

describe('swipe generation target identity', () => {
    function makePendingTarget() {
        const message = makeMessage();
        return {
            message,
            target: {
                swipeId: message.swipes.length,
                swipeUuid: '33333333-3333-4333-8333-333333333333',
                previousSwipeId: message.swipe_id,
            },
        };
    }

    it('materializes the next slot with the preallocated UUID', () => {
        const { message, target } = makePendingTarget();

        expect(validateSwipeGenerationTarget(message, target)).toMatchObject({
            ok: true,
            swipeId: 2,
            materialized: false,
        });
        expect(materializeSwipeGenerationTarget(message, target)).toMatchObject({
            ok: true,
            swipeId: 2,
            materialized: true,
        });
        expect(message.swipe_id).toBe(2);
        expect(message.swipes).toHaveLength(3);
        expect(message.swipe_info[2]).toEqual({
            [AIKOBOTS_SWIPE_UUID_KEY]: target.swipeUuid,
        });
    });

    it('rejects an index that was occupied by a different swipe before materialization', () => {
        const { message, target } = makePendingTarget();
        message.swipes.push('competing swipe');
        message.swipe_info.push({
            [AIKOBOTS_SWIPE_UUID_KEY]: '44444444-4444-4444-8444-444444444444',
        });
        message.swipe_id = 2;

        expect(validateSwipeGenerationTarget(message, target)).toMatchObject({
            ok: false,
            reason: 'materialized swipe UUID changed',
        });
    });

    it('rejects selection changes before and after materialization', () => {
        const { message, target } = makePendingTarget();
        message.swipe_id = 0;
        expect(validateSwipeGenerationTarget(message, target)).toMatchObject({
            ok: false,
            reason: 'selected swipe changed before materialization',
        });

        message.swipe_id = target.previousSwipeId;
        expect(materializeSwipeGenerationTarget(message, target).ok).toBe(true);
        message.swipe_id = 0;
        expect(validateSwipeGenerationTarget(message, target)).toMatchObject({
            ok: false,
            reason: 'selected swipe changed after materialization',
        });
    });

    it('rejects duplicate ownership of a materialized target UUID', () => {
        const { message, target } = makePendingTarget();
        expect(materializeSwipeGenerationTarget(message, target).ok).toBe(true);
        message.swipe_info[0][AIKOBOTS_SWIPE_UUID_KEY] = target.swipeUuid;

        expect(validateSwipeGenerationTarget(message, target)).toMatchObject({
            ok: false,
            reason: 'swipe UUID ownership is ambiguous',
        });
    });
});
