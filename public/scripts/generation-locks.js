import {
    characters,
    chat_metadata,
    customs,
    event_types,
    eventSource,
    main_api,
    online_status,
    saveMetadata,
    saveSettingsDebounced,
    this_chid,
} from '../script.js';
import { extension_settings } from './extensions.js';
import { groups, selected_group } from './group-chats.js';
import { t } from './i18n.js';
import { chat_completion_sources, checkOpenAIStatus, oai_settings, waitForCurrentOpenAIConnection } from './openai.js';
import { Popup } from './popup.js';
import { power_user } from './power-user.js';
import { getPresetManager } from './preset-manager.js';
import { SECRET_KEYS, secret_state } from './secrets.js';
import { delay } from './utils.js';

export const GENERATION_LOCKS_METADATA_KEY = 'aikobots_generation_locks';

const GLOBAL_APPLY_MODES = new Set(['apply', 'ask', 'off']);
const OVERRIDE_SELECTORS = Object.freeze({
    temp_openai: '#temp_openai',
    top_p_openai: '#top_p_openai',
    top_k_openai: '#top_k_openai',
});
const OVERRIDE_LABELS = Object.freeze({
    temp_openai: 'Temp',
    top_p_openai: 'Top P',
    top_k_openai: 'Top K',
});

let isInitialized = false;
let isApplyingGenerationLock = false;

function createDefaultGenerationLocksSettings() {
    return {
        enabled: false,
        defaultApplyMode: 'apply',
        chatBeatsCharacter: true,
        groupBeatsChat: true,
        useIndividualCharacterSettingsInGroups: false,
        useChatLocks: true,
        useCharacterLocks: true,
        useGroupLocks: true,
    };
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getGenerationLocksSettings() {
    const defaults = createDefaultGenerationLocksSettings();
    const source = isPlainObject(power_user.generationLocks) ? power_user.generationLocks : {};
    power_user.generationLocks = {
        ...defaults,
        ...source,
        defaultApplyMode: GLOBAL_APPLY_MODES.has(source.defaultApplyMode) ? source.defaultApplyMode : defaults.defaultApplyMode,
    };
    return power_user.generationLocks;
}

function ensureCustomsDocument() {
    if (!isPlainObject(customs.generationLocks)) {
        customs.generationLocks = {};
    }
    if (!isPlainObject(customs.generationLocks.characters)) {
        customs.generationLocks.characters = {};
    }
    if (!isPlainObject(customs.generationLocks.groups)) {
        customs.generationLocks.groups = {};
    }
    customs.version = 1;
    return customs;
}

function normalizeGenerationLock(record) {
    const source = isPlainObject(record) ? record : {};
    const overrides = {};

    if (isPlainObject(source.overrides)) {
        for (const key of Object.keys(OVERRIDE_SELECTORS)) {
            if (!Object.hasOwn(source.overrides, key)) {
                continue;
            }

            const value = Number(source.overrides[key]);
            if (Number.isFinite(value)) {
                overrides[key] = value;
            }
        }
    }

    return {
        version: 1,
        connectionProfileId: typeof source.connectionProfileId === 'string' ? source.connectionProfileId : '',
        modelId: typeof source.modelId === 'string' ? source.modelId.trim() : '',
        presetName: typeof source.presetName === 'string' ? source.presetName : '',
        overrides,
        updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : new Date().toISOString(),
    };
}

function hasLockTarget(lock) {
    return Boolean(lock?.connectionProfileId || lock?.modelId || lock?.presetName || Object.keys(lock?.overrides || {}).length);
}

function getCharacterAvatar(characterId) {
    if (characterId === undefined || characterId === null) {
        return '';
    }

    return String(characters[characterId]?.avatar || '').trim();
}

function getCharacterLock(characterId) {
    const avatar = getCharacterAvatar(characterId);
    if (!avatar) {
        return null;
    }

    return ensureCustomsDocument().generationLocks.characters[avatar] || null;
}

function getGroupLock(groupId = selected_group) {
    const id = String(groupId || '').trim();
    if (!id) {
        return null;
    }

    return ensureCustomsDocument().generationLocks.groups[id] || null;
}

function getChatLock() {
    return chat_metadata?.[GENERATION_LOCKS_METADATA_KEY] || null;
}

function makeCandidate(source, lock) {
    if (!lock) {
        return null;
    }

    const normalized = normalizeGenerationLock(lock);
    if (!hasLockTarget(normalized)) {
        return null;
    }

    return { source, lock: normalized };
}

function firstCandidate(candidates) {
    return candidates.find(Boolean) || null;
}

export function resolveGenerationLock(options = {}) {
    const settings = getGenerationLocksSettings();
    if (!settings.enabled) {
        return null;
    }

    const speakerCharacterId = options.speakerCharacterId;
    if (selected_group) {
        if (speakerCharacterId !== undefined && settings.useIndividualCharacterSettingsInGroups && settings.useCharacterLocks) {
            const speakerCandidate = makeCandidate('speaker character', getCharacterLock(speakerCharacterId));
            if (speakerCandidate) {
                return speakerCandidate;
            }
        }

        const chatCandidate = settings.useChatLocks ? makeCandidate('chat', getChatLock()) : null;
        const groupCandidate = settings.useGroupLocks ? makeCandidate('group', getGroupLock(selected_group)) : null;
        return settings.groupBeatsChat
            ? firstCandidate([groupCandidate, chatCandidate])
            : firstCandidate([chatCandidate, groupCandidate]);
    }

    const chatCandidate = settings.useChatLocks ? makeCandidate('chat', getChatLock()) : null;
    const characterCandidate = settings.useCharacterLocks ? makeCandidate('character', getCharacterLock(this_chid)) : null;
    return settings.chatBeatsCharacter
        ? firstCandidate([chatCandidate, characterCandidate])
        : firstCandidate([characterCandidate, chatCandidate]);
}


async function askToApplyGenerationLock(resolved) {
    return await Popup.show.confirm(
        t`Apply Generation Lock?`,
        t`Apply the ${resolved.source} Generation Lock to the current generation settings?`,
    );
}

async function getConnectionManagerModule() {
    return await import(/* webpackChunkName: "builtins" */ './extensions/connection-manager/index.js');
}

function getProfileById(profileId) {
    return extension_settings.connectionManager?.profiles?.find(p => p.id === profileId) || null;
}

function getCurrentGroup() {
    return groups.find(group => String(group.id) === String(selected_group)) || null;
}

function findCharacterIdByAvatar(avatar) {
    const normalizedAvatar = String(avatar || '').trim();
    if (!normalizedAvatar) {
        return null;
    }

    const index = characters.findIndex(character => String(character?.avatar || '').trim() === normalizedAvatar);
    return index === -1 ? null : index;
}

function getCharacterLockByAvatar(avatar) {
    const normalizedAvatar = String(avatar || '').trim();
    if (!normalizedAvatar) {
        return null;
    }

    return ensureCustomsDocument().generationLocks.characters[normalizedAvatar] || null;
}

function describeGenerationLock(lock) {
    if (!lock) {
        return t`No Generation Lock`;
    }

    const normalized = normalizeGenerationLock(lock);
    const parts = [];
    if (normalized.connectionProfileId) {
        parts.push(getProfileById(normalized.connectionProfileId)?.name || normalized.connectionProfileId);
    }
    if (normalized.modelId) {
        parts.push(normalized.modelId);
    }
    if (normalized.presetName) {
        parts.push(normalized.presetName);
    }
    const overridesText = formatGenerationLockOverrides(normalized.overrides);
    if (overridesText) {
        parts.push(overridesText);
    }

    return parts.length ? parts.join(' - ') : t`No target`;
}

function formatGenerationLockOverrides(overrides) {
    return Object.entries(overrides || {})
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([key, value]) => `${OVERRIDE_LABELS[key] || key}: ${Number(value)}`)
        .join(', ');
}

function renderGroupMemberGenerationLocks() {
    const container = $('#generation_locks_group_members');
    if (!container.length) {
        return;
    }

    container.empty();

    if (!getGenerationLocksSettings().enabled || !selected_group) {
        container.hide();
        return;
    }

    const group = getCurrentGroup();
    const members = Array.isArray(group?.members) ? group.members : [];
    if (!members.length) {
        container.hide();
        return;
    }

    container.show();
    const header = document.createElement('small');
    header.textContent = t`Group member character locks:`;
    container.append(header);

    for (const memberAvatar of members) {
        const characterId = findCharacterIdByAvatar(memberAvatar);
        const character = characterId !== null ? characters[characterId] : null;
        const row = document.createElement('small');
        row.textContent = `${character?.name || String(memberAvatar || '').trim()}: ${describeGenerationLock(getCharacterLockByAvatar(memberAvatar))}`;
        container.append(row);
    }
}

function hasMultipleCustomSecrets() {
    const customSecrets = secret_state[SECRET_KEYS.CUSTOM];
    return Array.isArray(customSecrets) && customSecrets.length > 1;
}

async function applyConnectionProfile(profileId) {
    if (!profileId) {
        return;
    }

    const profile = getProfileById(profileId);
    if (!profile) {
        toastr.warning(t`Generation Lock profile is missing.`);
        return;
    }

    if (profile.mode === 'cc' && profile.api === chat_completion_sources.CUSTOM && hasMultipleCustomSecrets() && !profile['secret-id']) {
        toastr.warning(t`This Custom OpenAI-compatible Generation Lock profile has no saved secret id; it will use the currently active Custom API key.`);
    }

    const connectionManager = await getConnectionManagerModule();
    const appliedProfile = await connectionManager.applyConnectionProfileById(profileId);
    if (!appliedProfile) {
        toastr.warning(t`Generation Lock profile is missing.`);
    }
}

async function applyPreset(presetName) {
    if (!presetName) {
        return;
    }

    const presetManager = getPresetManager('openai');
    const preset = presetManager?.findPreset(presetName);
    if (preset === undefined || preset === null) {
        toastr.warning(t`Generation Lock preset is missing: ${presetName}`);
        return;
    }

    presetManager.selectPreset(preset);
    await delay(50);
}

function applyOverrides(overrides) {
    let changed = false;
    for (const [key, selector] of Object.entries(OVERRIDE_SELECTORS)) {
        if (!Object.hasOwn(overrides || {}, key)) {
            continue;
        }

        const value = Number(overrides[key]);
        if (!Number.isFinite(value)) {
            continue;
        }

        if (areGenerationLockNumbersEqual(oai_settings[key], value)) {
            continue;
        }

        oai_settings[key] = value;
        $(selector).val(value).trigger('input');
        changed = true;
    }

    if (changed) {
        saveSettingsDebounced();
    }
}

function areGenerationLockNumbersEqual(left, right) {
    return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.000001;
}

function isConnectionProfileActive(profileId) {
    if (!profileId) {
        return true;
    }

    if (getCurrentProfileId() !== profileId) {
        return false;
    }

    const profile = getProfileById(profileId);
    if (profile?.mode === 'cc' && profile.api === chat_completion_sources.CUSTOM && profile['secret-id']) {
        return secret_state[SECRET_KEYS.CUSTOM]?.some(secret => secret.id === profile['secret-id'] && secret.active) ?? false;
    }

    return true;
}

function isPresetActive(presetName) {
    return !presetName || getCurrentPresetName() === presetName;
}

async function getCurrentModelId() {
    const connectionManager = await getConnectionManagerModule();
    return await connectionManager.readCurrentConnectionModel();
}

async function applyModel(modelId) {
    if (!modelId) {
        return;
    }

    const connectionManager = await getConnectionManagerModule();
    const applied = await connectionManager.applyConnectionModel(modelId);
    if (!applied) {
        toastr.warning(t`Generation Lock model could not be applied: ${modelId}`);
    }
}

async function isModelActive(modelId) {
    return !modelId || await getCurrentModelId() === modelId;
}

function areOverridesActive(overrides) {
    for (const [key, value] of Object.entries(overrides || {})) {
        if (!areGenerationLockNumbersEqual(oai_settings[key], value)) {
            return false;
        }
    }

    return true;
}

export async function applyResolvedGenerationLock(resolved, options = {}) {
    if (!resolved || isApplyingGenerationLock) {
        return false;
    }

    const defaultMode = getGenerationLocksSettings().defaultApplyMode;
    if (defaultMode === 'off') {
        return false;
    }

    if (defaultMode === 'ask' && !options.force) {
        const confirmed = await askToApplyGenerationLock(resolved);
        if (!confirmed) {
            return false;
        }
    }

    const shouldApplyProfile = !isConnectionProfileActive(resolved.lock.connectionProfileId);
    const shouldApplyPreset = !isPresetActive(resolved.lock.presetName);
    const shouldApplyModel = Boolean(resolved.lock.modelId)
        && (shouldApplyProfile || shouldApplyPreset || !await isModelActive(resolved.lock.modelId));
    const shouldApplyOverrides = !areOverridesActive(resolved.lock.overrides);
    if (!options.force && !shouldApplyProfile && !shouldApplyPreset && !shouldApplyModel && !shouldApplyOverrides) {
        updateGenerationLocksStatus(resolved);
        return false;
    }

    isApplyingGenerationLock = true;
    try {
        if (shouldApplyProfile || options.force) {
            await applyConnectionProfile(resolved.lock.connectionProfileId);
        }
        if (shouldApplyPreset || options.force) {
            await applyPreset(resolved.lock.presetName);
        }
        if (shouldApplyModel || options.force) {
            await applyModel(resolved.lock.modelId);
        }
        if (shouldApplyOverrides || options.force) {
            applyOverrides(resolved.lock.overrides);
        }
        if ((shouldApplyProfile || shouldApplyPreset || shouldApplyModel || options.force) && main_api === 'openai') {
            await waitForCurrentOpenAIConnection();
            if (online_status === 'no_connection') {
                await checkOpenAIStatus();
            }
        }
        updateGenerationLocksStatus(resolved);
        return true;
    } finally {
        isApplyingGenerationLock = false;
    }
}

export async function applyGenerationLockForCurrentContext(options = {}) {
    const resolved = resolveGenerationLock(options);
    updateGenerationLocksStatus(resolved);
    return await applyResolvedGenerationLock(resolved, options);
}

function getCurrentProfileId() {
    return String(extension_settings.connectionManager?.selectedProfile || '');
}

function getCurrentPresetName() {
    if (main_api !== 'openai') {
        return '';
    }

    return getPresetManager('openai')?.getSelectedPresetName() || '';
}

function getCurrentOverrides() {
    return {
        temp_openai: Number(oai_settings.temp_openai),
        top_p_openai: Number(oai_settings.top_p_openai),
        top_k_openai: Number(oai_settings.top_k_openai),
    };
}

async function createCurrentGenerationLock() {
    return normalizeGenerationLock({
        connectionProfileId: getCurrentProfileId(),
        modelId: await getCurrentModelId(),
        presetName: getCurrentPresetName(),
        overrides: getCurrentOverrides(),
        updatedAt: new Date().toISOString(),
    });
}

function getCurrentEntityKey(type) {
    switch (type) {
        case 'chat':
            return GENERATION_LOCKS_METADATA_KEY;
        case 'character':
            return getCharacterAvatar(this_chid);
        case 'group':
            return String(selected_group || '').trim();
        default:
            return '';
    }
}

async function saveCurrentGenerationLock(type) {
    const lock = await createCurrentGenerationLock();

    if (type === 'chat') {
        chat_metadata[GENERATION_LOCKS_METADATA_KEY] = lock;
        await saveMetadata();
    } else if (type === 'character') {
        const avatar = getCurrentEntityKey(type);
        if (!avatar) {
            toastr.warning(t`No active character for Generation Lock.`);
            return;
        }
        ensureCustomsDocument().generationLocks.characters[avatar] = lock;
        saveSettingsDebounced();
    } else if (type === 'group') {
        const groupId = getCurrentEntityKey(type);
        if (!groupId) {
            toastr.warning(t`No active group for Generation Lock.`);
            return;
        }
        ensureCustomsDocument().generationLocks.groups[groupId] = lock;
        saveSettingsDebounced();
    }

    updateGenerationLocksStatus(resolveGenerationLock());
    toastr.success(t`Generation Lock saved.`);
}

async function clearCurrentGenerationLock(type) {
    if (type === 'chat') {
        delete chat_metadata[GENERATION_LOCKS_METADATA_KEY];
        await saveMetadata();
    } else if (type === 'character') {
        const avatar = getCurrentEntityKey(type);
        if (avatar) {
            delete ensureCustomsDocument().generationLocks.characters[avatar];
            saveSettingsDebounced();
        }
    } else if (type === 'group') {
        const groupId = getCurrentEntityKey(type);
        if (groupId) {
            delete ensureCustomsDocument().generationLocks.groups[groupId];
            saveSettingsDebounced();
        }
    }

    updateGenerationLocksStatus(resolveGenerationLock());
    toastr.success(t`Generation Lock cleared.`);
}

function syncGenerationLocksControls() {
    const settings = getGenerationLocksSettings();
    $('#generation_locks_enabled').prop('checked', settings.enabled);
    $('#generation_locks_default_apply_mode').val(settings.defaultApplyMode);
    $('#generation_locks_chat_beats_character').prop('checked', settings.chatBeatsCharacter);
    $('#generation_locks_group_beats_chat').prop('checked', settings.groupBeatsChat);
    $('#generation_locks_use_individual_character_settings_in_groups').prop('checked', settings.useIndividualCharacterSettingsInGroups);
    $('#generation_locks_use_chat_locks').prop('checked', settings.useChatLocks);
    $('#generation_locks_use_character_locks').prop('checked', settings.useCharacterLocks);
    $('#generation_locks_use_group_locks').prop('checked', settings.useGroupLocks);
}

function saveGenerationLocksSettingsFromControls() {
    const settings = getGenerationLocksSettings();
    settings.enabled = $('#generation_locks_enabled').prop('checked');
    settings.defaultApplyMode = String($('#generation_locks_default_apply_mode').val() || 'apply');
    settings.chatBeatsCharacter = $('#generation_locks_chat_beats_character').prop('checked');
    settings.groupBeatsChat = $('#generation_locks_group_beats_chat').prop('checked');
    settings.useIndividualCharacterSettingsInGroups = $('#generation_locks_use_individual_character_settings_in_groups').prop('checked');
    settings.useChatLocks = $('#generation_locks_use_chat_locks').prop('checked');
    settings.useCharacterLocks = $('#generation_locks_use_character_locks').prop('checked');
    settings.useGroupLocks = $('#generation_locks_use_group_locks').prop('checked');
    saveSettingsDebounced();
    updateGenerationLocksStatus(resolveGenerationLock());
}

function updateGenerationLocksStatus(resolved = resolveGenerationLock()) {
    renderGroupMemberGenerationLocks();

    const status = $('#generation_locks_status');
    if (!status.length) {
        return;
    }

    if (!getGenerationLocksSettings().enabled) {
        status.text(t`Disabled`);
        return;
    }

    if (!resolved) {
        status.text(t`No effective Generation Lock`);
        return;
    }

    const parts = [resolved.source];
    if (resolved.lock.connectionProfileId) {
        const profileName = getProfileById(resolved.lock.connectionProfileId)?.name || resolved.lock.connectionProfileId;
        parts.push(profileName);
    }
    if (resolved.lock.modelId) {
        parts.push(resolved.lock.modelId);
    }
    if (resolved.lock.presetName) {
        parts.push(resolved.lock.presetName);
    }
    const overridesText = formatGenerationLockOverrides(resolved.lock.overrides);
    if (overridesText) {
        parts.push(overridesText);
    }

    status.text(parts.join(' - '));
}

function bindGenerationLocksControls() {
    $('#generation_locks_enabled, #generation_locks_chat_beats_character, #generation_locks_group_beats_chat, #generation_locks_use_individual_character_settings_in_groups, #generation_locks_use_chat_locks, #generation_locks_use_character_locks, #generation_locks_use_group_locks')
        .on('input', saveGenerationLocksSettingsFromControls);
    $('#generation_locks_default_apply_mode').on('change', saveGenerationLocksSettingsFromControls);

    $('#generation_locks_save_chat').on('click', () => saveCurrentGenerationLock('chat'));
    $('#generation_locks_save_character').on('click', () => saveCurrentGenerationLock('character'));
    $('#generation_locks_save_group').on('click', () => saveCurrentGenerationLock('group'));
    $('#generation_locks_clear_chat').on('click', () => clearCurrentGenerationLock('chat'));
    $('#generation_locks_clear_character').on('click', () => clearCurrentGenerationLock('character'));
    $('#generation_locks_clear_group').on('click', () => clearCurrentGenerationLock('group'));
    $('#generation_locks_apply_now').on('click', () => applyGenerationLockForCurrentContext({ force: true }));
}

export function initGenerationLocks() {
    if (isInitialized) {
        return;
    }

    isInitialized = true;
    getGenerationLocksSettings();
    ensureCustomsDocument();
    syncGenerationLocksControls();
    bindGenerationLocksControls();
    updateGenerationLocksStatus();

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        await applyGenerationLockForCurrentContext();
    });
    eventSource.on(event_types.GENERATION_STARTED, async () => {
        if (!selected_group) {
            await applyGenerationLockForCurrentContext();
        }
    });
    eventSource.on(event_types.GROUP_MEMBER_DRAFTED, async (chId) => {
        await applyGenerationLockForCurrentContext({ speakerCharacterId: chId });
    });
    eventSource.on(event_types.CONNECTION_PROFILE_CREATED, () => updateGenerationLocksStatus());
    eventSource.on(event_types.CONNECTION_PROFILE_UPDATED, () => updateGenerationLocksStatus());
    eventSource.on(event_types.CONNECTION_PROFILE_DELETED, () => updateGenerationLocksStatus());
    eventSource.on(event_types.PRESET_CHANGED, () => updateGenerationLocksStatus());
}
