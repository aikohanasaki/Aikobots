import { stableHashString } from './hashing.js';

/** Fingerprints message identity and active text; visibility-only changes do not change the source. */
export function fingerprintStmbSource(messages) {
    return stableHashString(JSON.stringify(messages.map(message => [
        message?.aikobots_message_uuid, message?.mes, message?.name, Boolean(message?.is_user),
        message?.swipe_info?.[message?.swipe_id ?? 0]?.aikobots_swipe_uuid || null,
        message?.extra?.STMemoryBooks?.narratorCast || null,
    ])));
}
