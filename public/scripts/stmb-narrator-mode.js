export const NARRATOR_MODE_VERSION = 1;
export const NARRATOR_MESSAGE_METADATA_KEY = 'narratorCast';

function cleanString(value) {
    return String(value || '').trim();
}

function uniqueStrings(values) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = cleanString(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Returns whether Narrator Mode is valid for the current chat mode. */
export function isNarratorModeActive({ isGroupChat = false, manualModeEnabled = false, enabled = false } = {}) {
    return !isGroupChat && manualModeEnabled === true && enabled === true;
}

/** Creates one stable write-in Narrator cast identity. */
export function createNarratorMember({ id, name, lorebookName = '', retired = false } = {}, createId = () => crypto.randomUUID()) {
    return {
        id: cleanString(id) || cleanString(createId()),
        name: cleanString(name),
        lorebookName: cleanString(lorebookName),
        retired: retired === true,
    };
}

/** Normalizes persisted per-chat Narrator configuration without discarding repairable members. */
export function normalizeNarratorConfig(value) {
    const source = isPlainObject(value) ? value : {};
    const members = [];
    const seenIds = new Set();
    let changed = !isPlainObject(value) || source.version !== NARRATOR_MODE_VERSION;

    for (const raw of Array.isArray(source.members) ? source.members : []) {
        if (!isPlainObject(raw)) {
            changed = true;
            continue;
        }
        const member = createNarratorMember(raw, () => '');
        if (!member.id || !member.name || seenIds.has(member.id)) {
            changed = true;
            continue;
        }
        seenIds.add(member.id);
        members.push(member);
        if (
            raw.id !== member.id || raw.name !== member.name || raw.lorebookName !== member.lorebookName
            || Boolean(raw.retired) !== member.retired || Object.hasOwn(raw, 'avatar')
        ) changed = true;
    }

    const selectableIds = new Set(members.filter(member => !member.retired).map(member => member.id));
    const activeCastIds = uniqueStrings(source.activeCastIds).filter(id => selectableIds.has(id));
    if (activeCastIds.length !== (Array.isArray(source.activeCastIds) ? source.activeCastIds.length : 0)) changed = true;

    return {
        config: {
            version: NARRATOR_MODE_VERSION,
            enabled: source.enabled === true,
            members,
            activeCastIds,
        },
        changed,
    };
}

/** Ensures the current chat metadata contains normalized Narrator configuration. */
export function ensureNarratorConfig(stmbState) {
    if (!isPlainObject(stmbState)) throw new TypeError('STMemoryBooks chat metadata must be an object.');
    const { config, changed } = normalizeNarratorConfig(stmbState.narratorMode);
    stmbState.narratorMode = config;
    return { config, changed };
}

/** Returns active, non-retired cast members in declared order. */
export function getNarratorActiveMembers(config) {
    const activeIds = new Set(uniqueStrings(config?.activeCastIds));
    return (Array.isArray(config?.members) ? config.members : [])
        .filter(member => !member?.retired && activeIds.has(member.id));
}

/** Replaces Active Cast with valid non-retired member IDs. */
export function setNarratorActiveCast(config, memberIds) {
    const allowedIds = new Set((config?.members || []).filter(member => !member.retired).map(member => member.id));
    const next = uniqueStrings(memberIds).filter(id => allowedIds.has(id));
    const current = uniqueStrings(config?.activeCastIds);
    if (current.length === next.length && current.every((id, index) => id === next[index])) return false;
    config.activeCastIds = next;
    return true;
}

/** Validates distinct ordinary cast-book bindings against the canonical book. */
export function validateNarratorBindings(config, canonicalLorebookName, availableLorebooks = []) {
    const canonical = cleanString(canonicalLorebookName);
    const available = new Set((availableLorebooks || []).map(cleanString).filter(Boolean));
    const used = new Map();
    const issues = [];
    for (const member of config?.members || []) {
        const lorebookName = cleanString(member?.lorebookName);
        if (!lorebookName || (available.size > 0 && !available.has(lorebookName))) {
            issues.push({ type: 'missing', member });
        } else if (lorebookName === canonical) {
            issues.push({ type: 'canonical', member, lorebookName });
        } else if (used.has(lorebookName)) {
            issues.push({ type: 'duplicate', member, otherMember: used.get(lorebookName), lorebookName });
        } else {
            used.set(lorebookName, member);
        }
    }
    return { valid: issues.length === 0, issues };
}

/** Validates one assignment so multiple missing members can be repaired incrementally. */
export function validateNarratorMemberBinding(config, candidate, canonicalLorebookName, availableLorebooks = []) {
    const lorebookName = cleanString(candidate?.lorebookName);
    const canonical = cleanString(canonicalLorebookName);
    const available = new Set((availableLorebooks || []).map(cleanString).filter(Boolean));
    if (!lorebookName || (available.size > 0 && !available.has(lorebookName))) return { valid: false, issue: { type: 'missing', member: candidate } };
    if (lorebookName === canonical) return { valid: false, issue: { type: 'canonical', member: candidate, lorebookName } };
    const duplicate = (config?.members || []).find(member => member.id !== candidate?.id && cleanString(member.lorebookName) === lorebookName);
    if (duplicate) return { valid: false, issue: { type: 'duplicate', member: candidate, otherMember: duplicate, lorebookName } };
    return { valid: true, issue: null };
}

function ensureMessageStmbExtra(message) {
    if (!isPlainObject(message.extra)) message.extra = {};
    if (!isPlainObject(message.extra.STMemoryBooks)) message.extra.STMemoryBooks = {};
    return message.extra.STMemoryBooks;
}

/** Stamps the current cast on a message and its active swipe. */
export function stampNarratorCast(message, memberIds, { merge = false } = {}) {
    if (!isPlainObject(message)) return false;
    const existing = merge ? getNarratorCastFromMessage(message) : [];
    const memberIdList = uniqueStrings([...existing, ...uniqueStrings(memberIds)]);
    const metadata = { version: NARRATOR_MODE_VERSION, memberIds: memberIdList };
    ensureMessageStmbExtra(message)[NARRATOR_MESSAGE_METADATA_KEY] = metadata;

    if (Number.isInteger(message.swipe_id) && Array.isArray(message.swipe_info)) {
        const swipeInfo = message.swipe_info[message.swipe_id];
        if (isPlainObject(swipeInfo)) {
            if (!isPlainObject(swipeInfo.extra)) swipeInfo.extra = {};
            if (!isPlainObject(swipeInfo.extra.STMemoryBooks)) swipeInfo.extra.STMemoryBooks = {};
            swipeInfo.extra.STMemoryBooks[NARRATOR_MESSAGE_METADATA_KEY] = structuredClone(metadata);
        }
    }
    return true;
}

/** Reads normalized cast IDs from the active message metadata. */
export function getNarratorCastFromMessage(message) {
    return uniqueStrings(message?.extra?.STMemoryBooks?.[NARRATOR_MESSAGE_METADATA_KEY]?.memberIds);
}

/** Returns whether a message carries an explicit Narrator cast snapshot. */
function hasNarratorCastMetadata(message) {
    return isPlainObject(message?.extra?.STMemoryBooks?.[NARRATOR_MESSAGE_METADATA_KEY]);
}

/** Distinguishes actual system notices from ordinary messages hidden from the prompt. */
function isNarratorSystemNotice(message) {
    return Boolean(message?.is_system
        && !hasNarratorCastMetadata(message)
        && (cleanString(message?.extra?.type)
            || Array.isArray(message?.extra?.tool_invocations)
            || message?.extra?.uses_system_ui === true));
}

/** Resolves scene participants, treating fully tagged assistant messages as authoritative. */
export function getNarratorSceneParticipants(messages) {
    const source = Array.isArray(messages) ? messages.filter(Boolean) : [];
    const participantMessages = source.filter(message => !isNarratorSystemNotice(message));
    const narratorMessages = participantMessages.filter(message => !message?.is_user);
    const authoritative = narratorMessages.length > 0 ? narratorMessages : participantMessages;
    const hasUntaggedMessages = authoritative.some(message =>
        !hasNarratorCastMetadata(message),
    );
    const continuityMessages = hasUntaggedMessages ? participantMessages : authoritative;
    return {
        memberIds: uniqueStrings(continuityMessages.flatMap(getNarratorCastFromMessage)),
        hasUntaggedMessages,
    };
}

/** Maps selected Narrator cast identities to display names in selection order. */
export function getNarratorParticipantNames(config, participantIds) {
    const membersById = new Map(
        (Array.isArray(config?.members) ? config.members : []).map(member => [member?.id, member]),
    );
    return uniqueStrings(participantIds)
        .map(id => cleanString(membersById.get(id)?.name))
        .filter(Boolean);
}

/** Builds unique character-book write targets for selected participants. */
export function buildNarratorCopyTargets(config, participantIds) {
    const selected = new Set(uniqueStrings(participantIds));
    return (config?.members || [])
        .filter(member => !member.retired && selected.has(member.id) && cleanString(member.lorebookName))
        .map(member => ({
            lorebookName: cleanString(member.lorebookName),
            members: [structuredClone(member)],
            ownerIds: [member.id],
        }));
}

/** Merges request-local lorebook entries without mutating the cached source. */
export function mergeNarratorLorebookEntries(targetEntries, lorebookData, worldName, existingKeys = new Set()) {
    const target = Array.isArray(targetEntries) ? targetEntries : [];
    for (const [entryKey, rawEntry] of Object.entries(lorebookData?.entries || {})) {
        const uid = rawEntry?.uid ?? entryKey;
        const key = `${worldName}.${uid}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        target.push({ ...structuredClone(rawEntry), uid, world: worldName });
    }
    return target;
}

/** Carries Narrator ownership and participant metadata through consolidation. */
export function collectNarratorSourceMetadata(entries, sourceIds) {
    const ids = new Set(uniqueStrings(sourceIds));
    const ownerIds = [];
    const participantIds = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!ids.has(cleanString(entry?.uid))) continue;
        ownerIds.push(...uniqueStrings(entry?.STMB_narratorOwnerIds));
        participantIds.push(...uniqueStrings(entry?.STMB_narratorParticipantIds));
    }
    const result = {};
    const owners = uniqueStrings(ownerIds);
    const participants = uniqueStrings(participantIds);
    if (owners.length > 0) result.STMB_narratorOwnerIds = owners;
    if (participants.length > 0) result.STMB_narratorParticipantIds = participants;
    return result;
}

/** Rewrites or clears a Narrator member lorebook reference after lifecycle changes. */
export function migrateNarratorLorebookReference(config, oldName, newName = '') {
    let changed = false;
    for (const member of config?.members || []) {
        if (member.lorebookName !== oldName) continue;
        member.lorebookName = cleanString(newName);
        changed = true;
    }
    if (changed && !cleanString(newName)) config.enabled = false;
    return changed;
}

/** Normalizes current and legacy queued multi-character snapshots without retaining lorebook contents. */
export function normalizeMultiCharacterSnapshot(payload = {}) {
    const raw = payload?.multiCharacterSnapshot || payload?.manualGroupSnapshot;
    if (!isPlainObject(raw)) return null;
    const mode = raw.mode === 'narrator' ? 'narrator' : 'group';
    const members = (Array.isArray(raw.members) ? raw.members : []).map(member => mode === 'narrator'
        ? createNarratorMember(member, () => '')
        : {
            key: cleanString(member?.key),
            avatar: cleanString(member?.avatar),
            memberId: cleanString(member?.memberId),
            name: cleanString(member?.name),
            characterFilterName: cleanString(member?.characterFilterName),
        });
    const bindings = Object.fromEntries(Object.entries(isPlainObject(raw.bindings) ? raw.bindings : {})
        .map(([key, value]) => [cleanString(key), cleanString(value)])
        .filter(([key, value]) => key && value));
    return {
        mode,
        canonicalLorebookName: cleanString(raw.canonicalLorebookName),
        members,
        bindings,
        ...(mode === 'narrator'
            ? { participantIds: uniqueStrings(raw.participantIds) }
            : {
                characterFilterNames: uniqueStrings(raw.characterFilterNames),
                locksByMemberKey: isPlainObject(raw.locksByMemberKey) ? structuredClone(raw.locksByMemberKey) : {},
            }),
    };
}
