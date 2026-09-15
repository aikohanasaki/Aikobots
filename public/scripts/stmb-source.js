import { stableHashString } from './hashing.js';

/** Fingerprints the message identity, active text, visibility, and cast used during capture. */
export function fingerprintStmbSource(messages) {
    return stableHashString(JSON.stringify(messages.map(message => [
        message?.aikobots_message_uuid, message?.mes, message?.name, Boolean(message?.is_user),
        Boolean(message?.is_system),
        message?.swipe_info?.[message?.swipe_id ?? 0]?.aikobots_swipe_uuid || null,
        message?.extra?.STMemoryBooks?.narratorCast || null,
    ])));
}
