import { getStringHash } from '../../string-hash.js';

const AIKOBOTS_VECTOR_HASH_SEED = 0xA1C0B075;

/** Calculates the stable Aikobots vector hash for a string. */
export function getVectorStringHash(str) {
    return getStringHash(str, AIKOBOTS_VECTOR_HASH_SEED);
}
