/** Captures group behavior once so queued work does not follow later settings edits. */
export function captureStmbGroupPolicy(settings = {}, context = {}) {
    return {
        characterAware: !context.isGroupChat || context.isNarratorMode === true || settings.characterAwareMemories !== false,
        separateSidePrompts: settings.useSeparateGroupSidePrompts !== false,
    };
}

/** Removes group routing when this operation uses ordinary single-book processing. */
export function applyStmbGroupPolicy(profile, compiledScene, policy) {
    if (policy?.characterAware === false) {
        profile.useGroupSpecificPrompts = false;
        if (compiledScene?.metadata) {
            delete compiledScene.metadata.characterFilterNames;
            compiledScene.metadata.stmbPromptTarget = '';
        }
    }
    return profile;
}

/** Resolves persisted stream ownership without guessing from character display names. */
export function getStmbMemoryRole(entry) {
    if (['group', 'character'].includes(entry?.STMB_memoryRole)) return entry.STMB_memoryRole;
    if (entry?.STMB_canonical === true) return 'group';
    if (entry?.STMB_canonical === false) return 'character';
    return '';
}

/** Separates streams only when group and character memories share a physical book. */
export function filterStmbMemoryRole(entries, role, shared, names = []) {
    if (!shared) return entries;
    return entries.filter(entry => {
        if (getStmbMemoryRole(entry) !== role) return false;
        return role !== 'character' || names.length === 0 || names.some(name => entry.characterFilter?.names?.includes(name));
    });
}

/** Detects a book containing both explicitly attributable memory streams. */
export function hasStmbSharedRoles(entries) {
    const roles = new Set(entries.map(getStmbMemoryRole));
    return roles.has('group') && roles.has('character');
}
