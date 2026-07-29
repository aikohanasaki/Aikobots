/**
 * Groups valid manual character-lorebook bindings into unique STLO sync targets.
 */
export function buildStmbGroupStloReconciliationTargets({
    members = [],
    bindings = {},
    canonicalLorebookName = '',
    availableLorebookNames = [],
    isReservedLorebookName = () => false,
    getStorage = () => 'user',
} = {}) {
    const available = new Set((Array.isArray(availableLorebookNames) ? availableLorebookNames : []).map(String));
    const targets = new Map();

    for (const member of Array.isArray(members) ? members : []) {
        const lorebookName = String(bindings?.[member?.key] || '').trim();
        const characterName = String(member?.characterFilterName || '').trim();
        if (!lorebookName
            || !characterName
            || lorebookName === String(canonicalLorebookName || '').trim()
            || !available.has(lorebookName)
            || isReservedLorebookName(lorebookName)) {
            continue;
        }

        const storage = String(getStorage(lorebookName) || 'user');
        const targetKey = `${storage}:${lorebookName}`;
        if (!targets.has(targetKey)) {
            targets.set(targetKey, { lorebookName, storage, characterNames: [] });
        }
        const characterNames = targets.get(targetKey).characterNames;
        if (!characterNames.includes(characterName)) {
            characterNames.push(characterName);
        }
    }

    return Array.from(targets.values());
}
