import {
    CHAT_SAVE_RESULT,
    characters,
    chat_metadata,
    getRequestHeaders,
    saveMetadata,
    saveSettingsDebounced,
    this_chid,
} from '../script.js';
import { extension_settings } from './extensions.js';
import { groups, selected_group } from './group-chats.js';
import { t, translate } from './i18n.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from './slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import {
    applyWorldInfoPresetSelection,
    getPresetEligibleWorldNames,
    getWorldInfoSettings,
    importWorldInfo,
    selected_world_info,
} from './world-info.js';
import {
    WORLD_INFO_LOCKS_EXPORT_VERSION,
    filterWorldInfoEngineSettings,
    getEligiblePresetWorldNames,
    isSafeOrdinaryLorebookExportResponse,
    loadWorldInfoLocksSettingsSource,
    migrateLegacyCharacterLockIds,
    migrateLegacyGroupLockIds,
    moveCharacterLockId,
    normalizeWorldInfoLocksSettings,
    normalizeWorldInfoPreset,
    removePresetReferences,
    renamePresetReferences,
    resolveWorldInfoPresetLock,
    validateWorldInfoPresetImport,
} from './world-info-locks-policy.js';
import { eventSource, event_types } from './events.js';

export const WORLD_INFO_PRESET_CHAT_LOCK_KEY = 'worldInfoPresetLock';

const settings = normalizeWorldInfoLocksSettings({});
let initialized = false;
let contextRefreshTimer = null;

/** Loads legacy World Info Locks settings even when the extension subsystem is disabled. */
export function loadWorldInfoLocksSettings(rawSettings = {}) {
    const normalized = loadWorldInfoLocksSettingsSource(rawSettings, extension_settings.worldInfoPresets);
    for (const key of Object.keys(settings)) {
        delete settings[key];
    }
    Object.assign(settings, normalized);
    extension_settings.worldInfoPresets = settings;
    return settings;
}

export function getWorldInfoLocksSettings() {
    return settings;
}

function getCurrentContext() {
    if (selected_group) {
        const groupId = String(selected_group);
        const groupName = String(groups.find(group => String(group.id) === groupId)?.name || '');
        return {
            isGroupChat: true,
            groupId,
            groupName,
            legacyGroupNameUnique: Boolean(groupName)
                && groups.filter(group => group?.name === groupName).length === 1
                && !characters.some(character => character?.name === groupName),
            characterId: '',
            characterName: '',
        };
    }

    const character = characters[this_chid];
    const characterName = String(character?.name || chat_metadata?.character_name || '');
    return {
        isGroupChat: false,
        groupId: '',
        groupName: '',
        characterId: String(character?.avatar || ''),
        characterName,
        legacyNameUnique: characters.filter(item => item?.name === characterName).length === 1,
    };
}

function getChatLock() {
    return typeof chat_metadata?.[WORLD_INFO_PRESET_CHAT_LOCK_KEY] === 'string'
        ? chat_metadata[WORLD_INFO_PRESET_CHAT_LOCK_KEY]
        : '';
}

function getContextLock() {
    return resolveWorldInfoPresetLock(settings, getCurrentContext(), getChatLock());
}

function getEntityLock(context = getCurrentContext()) {
    if (context.isGroupChat) {
        return settings.groupLocks[context.groupId]
            || (context.legacyGroupNameUnique ? settings.characterLocks[context.groupName] : '')
            || '';
    }
    return settings.characterLockIds[context.characterId]
        || (context.legacyNameUnique ? settings.characterLocks[context.characterName] : '')
        || '';
}

function hasCurrentContextLock() {
    return Boolean(getContextLock());
}

function findPreset(name) {
    const normalizedName = String(name || '').trim().toLocaleLowerCase();
    return settings.presetList.find(preset => preset.name.toLocaleLowerCase() === normalizedName) || null;
}

function getCurrentPreset() {
    return findPreset(settings.presetName);
}

function snapshotWorldInfoSettings() {
    return filterWorldInfoEngineSettings(getWorldInfoSettings()) || {};
}

function getSettingCategories() {
    return [
        {
            name: t`Activation Settings`,
            description: t`Controls when and how lorebook entries are activated.`,
            keys: ['world_info_depth', 'world_info_min_activations', 'world_info_min_activations_depth_max', 'world_info_recursive', 'world_info_max_recursion_steps'],
        },
        {
            name: t`Budget & Performance`,
            description: t`Controls token budgets and overflow warnings.`,
            keys: ['world_info_budget', 'world_info_budget_cap', 'world_info_overflow_alert'],
        },
        {
            name: t`Text Matching`,
            description: t`Controls how lorebook keywords are matched.`,
            keys: ['world_info_case_sensitive', 'world_info_match_whole_words', 'world_info_include_names'],
        },
        {
            name: t`Strategy & Scoring`,
            description: t`Controls inclusion-group scoring.`,
            keys: ['world_info_use_group_scoring'],
        },
    ];
}

function getWorldInfoSettingLabel(key) {
    const labels = {
        world_info_depth: t`Scan Depth`,
        world_info_min_activations: t`Min Activations`,
        world_info_min_activations_depth_max: t`Max Depth`,
        world_info_budget: t`Context %`,
        world_info_include_names: t`Include Names`,
        world_info_recursive: t`Recursive Scan`,
        world_info_overflow_alert: t`Alert On Overflow`,
        world_info_case_sensitive: t`Case Sensitive`,
        world_info_match_whole_words: t`Match Whole Words`,
        world_info_budget_cap: t`Budget Cap`,
        world_info_use_group_scoring: t`Use Group Scoring`,
        world_info_max_recursion_steps: t`Max Recursion Steps`,
    };
    return labels[key] || key;
}

function migrateLegacyPresets() {
    const snapshot = snapshotWorldInfoSettings();
    let changed = false;
    for (const preset of settings.presetList) {
        if (!Object.hasOwn(preset, 'worldInfoSettings')) {
            preset.worldInfoSettings = { ...snapshot };
            changed = true;
        }
    }
    return changed;
}

function getEligibleWorldNameSet() {
    return new Set(getPresetEligibleWorldNames());
}

function getCurrentEligibleWorldNames() {
    return getEligiblePresetWorldNames(selected_world_info, getEligibleWorldNameSet());
}

function getPresetEligibleNames(preset) {
    return getEligiblePresetWorldNames(preset?.worldList, getEligibleWorldNameSet());
}

function setButtonDisabled(selector, disabled) {
    $(selector).prop('disabled', disabled).toggleClass('disabled', disabled);
}

function renderPresetSelect() {
    const select = $('#world_info_locks_preset');
    if (!select.length) {
        return;
    }

    select.empty();
    const placeholder = settings.globalDefaultPreset
        ? t`--- Default: ${settings.globalDefaultPreset} ---`
        : t`--- Pick a Preset ---`;
    select.append(new Option(placeholder, ''));

    for (const preset of [...settings.presetList].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))) {
        const option = new Option(preset.name, preset.name);
        const visibleBooks = getPresetEligibleNames(preset);
        option.title = visibleBooks.length
            ? t`Books: ${visibleBooks.join(', ')}`
            : t`No ordinary user lorebooks in this preset`;
        select.append(option);
    }
    select.val(settings.presetName);

    const hasPreset = Boolean(getCurrentPreset());
    setButtonDisabled('#world_info_locks_rename, #world_info_locks_export, #world_info_locks_delete', !hasPreset);
    $('#world_info_locks_lock').toggleClass('toggleEnabled', hasCurrentContextLock());
}

function showNotification(message, level = 'info') {
    if (!settings.showLockNotifications) {
        return;
    }
    toastr[level](message, t`World Info Presets`);
}

async function setChatLock(presetName) {
    const previous = getChatLock();
    if (presetName) {
        chat_metadata[WORLD_INFO_PRESET_CHAT_LOCK_KEY] = presetName;
    } else {
        delete chat_metadata[WORLD_INFO_PRESET_CHAT_LOCK_KEY];
    }

    try {
        const result = await saveMetadata();
        if (result !== CHAT_SAVE_RESULT.SAVED) {
            throw new Error('Chat metadata save failed');
        }
        return true;
    } catch {
        if (previous) {
            chat_metadata[WORLD_INFO_PRESET_CHAT_LOCK_KEY] = previous;
        } else {
            delete chat_metadata[WORLD_INFO_PRESET_CHAT_LOCK_KEY];
        }
        toastr.error(t`The chat preset lock could not be saved.`, t`World Info Presets`);
        return false;
    }
}

function setCharacterLock(context, presetName) {
    if (!context.characterId) {
        return;
    }

    if (presetName) {
        settings.characterLockIds[context.characterId] = presetName;
    } else {
        delete settings.characterLockIds[context.characterId];
    }

    const sameNameCharacters = characters.filter(character => character?.name === context.characterName);
    if (context.characterName && sameNameCharacters.length === 1) {
        if (presetName) {
            settings.characterLocks[context.characterName] = presetName;
        } else {
            delete settings.characterLocks[context.characterName];
        }
    }
    saveSettingsDebounced();
}

function setGroupLock(context, presetName) {
    if (!context.groupId) {
        return;
    }
    if (presetName) {
        settings.groupLocks[context.groupId] = presetName;
    } else {
        delete settings.groupLocks[context.groupId];
        if (context.legacyGroupNameUnique) {
            delete settings.characterLocks[context.groupName];
        }
    }
    saveSettingsDebounced();
}

async function updateExistingLocks(presetName) {
    const context = getCurrentContext();
    if (getChatLock()) {
        if (!await setChatLock(presetName)) {
            return false;
        }
    }
    if (context.isGroupChat && getEntityLock(context)) {
        setGroupLock(context, presetName);
    } else if (!context.isGroupChat && getEntityLock(context)) {
        setCharacterLock(context, presetName);
    }
    return true;
}

function applyWorldInfoEngineSettings(value) {
    const requested = filterWorldInfoEngineSettings(value);
    if (!requested) {
        return [];
    }

    const failures = [];
    const orderedKeys = Object.keys(requested);
    const recursionIndex = orderedKeys.indexOf('world_info_max_recursion_steps');
    if (recursionIndex > 0) {
        orderedKeys.unshift(...orderedKeys.splice(recursionIndex, 1));
    }
    for (const key of orderedKeys) {
        const input = document.getElementById(key);
        if (!(input instanceof HTMLInputElement)) {
            failures.push(key);
            continue;
        }

        const nextValue = requested[key];
        if (typeof nextValue === 'boolean') {
            input.checked = nextValue;
        } else {
            const min = input.min === '' ? -Infinity : Number(input.min);
            const max = input.max === '' ? Infinity : Number(input.max);
            if (!Number.isFinite(nextValue) || nextValue < min || nextValue > max) {
                failures.push(key);
                continue;
            }
            input.value = String(nextValue);
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return failures;
}

async function activatePreset(preset, { skipLockPrompt = false } = {}) {
    const currentLock = getContextLock();
    if (!skipLockPrompt && currentLock && currentLock !== (preset?.name || '')) {
        const confirmed = await Popup.show.confirm(
            t`Preset Lock Active`,
            t`This context is locked to "${currentLock}". Update the lock to use "${preset?.name || translate('None')}"?`,
        );
        if (confirmed && !await updateExistingLocks(preset?.name || '')) {
            return;
        }
    }

    applyWorldInfoPresetSelection(getPresetEligibleNames(preset));
    const failures = preset?.worldInfoSettings ? applyWorldInfoEngineSettings(preset.worldInfoSettings) : [];
    settings.presetName = preset?.name || '';
    saveSettingsDebounced();
    renderPresetSelect();

    if (failures.length) {
        toastr.warning(t`Some saved World Info settings are no longer supported and were not applied.`, t`World Info Presets`);
    }
}

async function activatePresetByName(name, options = {}) {
    if (!String(name || '').trim()) {
        await activatePreset(null, options);
        return;
    }
    const preset = findPreset(name);
    if (!preset) {
        toastr.warning(t`World Info preset not found.`, t`World Info Presets`);
        return;
    }
    await activatePreset(preset, options);
}

async function applyLocksForCurrentContext() {
    const lockedPresetName = getContextLock();
    if (lockedPresetName) {
        const preset = findPreset(lockedPresetName);
        if (!preset) {
            showNotification(t`The locked World Info preset no longer exists.`, 'warning');
            renderPresetSelect();
            return;
        }
        await activatePreset(preset, { skipLockPrompt: true });
        showNotification(t`Applied the locked World Info preset.`);
        return;
    }

    if (settings.globalDefaultPreset) {
        const preset = findPreset(settings.globalDefaultPreset);
        if (preset) {
            await activatePreset(preset, { skipLockPrompt: true });
            showNotification(t`Applied the default World Info preset.`);
        }
    }
    renderPresetSelect();
}

function scheduleContextRefresh() {
    clearTimeout(contextRefreshTimer);
    contextRefreshTimer = setTimeout(() => void applyLocksForCurrentContext(), 100);
}

function makeCheckbox(label, checked, id) {
    const wrapper = document.createElement('label');
    wrapper.className = 'checkbox_label';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.append(input, text);
    return { wrapper, input };
}

function makePopupContent(title) {
    const content = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = title;
    content.append(heading);
    return content;
}

async function showLockSettings() {
    const context = getCurrentContext();
    const currentPreset = getCurrentPreset();
    if (!currentPreset) {
        toastr.warning(t`Select a World Info preset before creating a lock.`, t`World Info Presets`);
        return;
    }

    const content = makePopupContent(t`Preset Locks`);
    const explanation = document.createElement('p');
    explanation.textContent = t`Lock the current preset to this context.`;
    content.append(explanation);

    const entityLock = getEntityLock(context);
    const entityLabel = context.isGroupChat
        ? t`Lock to group${context.groupName ? ` (${context.groupName})` : ''}`
        : t`Lock to character${context.characterName ? ` (${context.characterName})` : ''}`;
    const entity = makeCheckbox(entityLabel, Boolean(entityLock), 'world_info_locks_entity_checkbox');
    const chat = makeCheckbox(t`Lock to chat`, Boolean(getChatLock()), 'world_info_locks_chat_checkbox');
    content.append(entity.wrapper, chat.wrapper);

    const popup = new Popup(content, POPUP_TYPE.CONFIRM);
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }

    if (!await setChatLock(chat.input.checked ? currentPreset.name : '')) {
        return;
    }
    if (context.isGroupChat) {
        setGroupLock(context, entity.input.checked ? currentPreset.name : '');
    } else {
        setCharacterLock(context, entity.input.checked ? currentPreset.name : '');
    }
    renderPresetSelect();
    showNotification(entity.input.checked || chat.input.checked ? t`Preset lock saved.` : t`Preset locks removed.`, 'success');
}

async function showGlobalSettings() {
    const content = makePopupContent(t`World Info Preset Settings`);
    const defaultLabel = document.createElement('label');
    defaultLabel.textContent = t`Global default preset`;
    defaultLabel.htmlFor = 'world_info_locks_global_default';
    const defaultSelect = document.createElement('select');
    defaultSelect.id = 'world_info_locks_global_default';
    defaultSelect.className = 'wide100p';
    defaultSelect.append(new Option(t`None`, ''));
    for (const preset of settings.presetList) {
        defaultSelect.append(new Option(preset.name, preset.name));
    }
    defaultSelect.value = settings.globalDefaultPreset;
    content.append(defaultLabel, defaultSelect);

    const controls = [
        ['enableCharacterLocks', t`Enable character locks`],
        ['enableGroupLocks', t`Enable group locks`],
        ['enableChatLocks', t`Enable chat locks`],
        ['preferChatOverCharacterLocks', t`Prefer chat locks over character and group locks`],
        ['showLockNotifications', t`Show lock notifications`],
    ].map(([key, label]) => ({ key, ...makeCheckbox(label, settings[key], `world_info_locks_${key}`) }));
    controls.forEach(control => content.append(control.wrapper));

    const popup = new Popup(content, POPUP_TYPE.CONFIRM);
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }

    const oldDefaultPreset = settings.globalDefaultPreset;
    settings.globalDefaultPreset = String(defaultSelect.value || '');
    controls.forEach(control => settings[control.key] = control.input.checked);
    saveSettingsDebounced();
    renderPresetSelect();
    if (settings.globalDefaultPreset !== oldDefaultPreset && !settings.presetName && !getContextLock()) {
        await applyLocksForCurrentContext();
    }
}

async function choosePresetSettings() {
    const content = makePopupContent(t`World Info Settings Inclusion`);
    const explanation = document.createElement('p');
    explanation.textContent = t`Choose which global World Info settings to store in this preset.`;
    content.append(explanation);
    const include = makeCheckbox(t`Include World Info settings in preset`, false, 'world_info_locks_include_settings');
    content.append(include.wrapper);

    const supported = snapshotWorldInfoSettings();
    const settingsContainer = document.createElement('div');
    settingsContainer.className = 'indent20p';
    settingsContainer.hidden = true;
    const settingInputs = [];
    for (const category of getSettingCategories()) {
        const keys = category.keys.filter(key => Object.hasOwn(supported, key));
        if (!keys.length) {
            continue;
        }
        const heading = document.createElement('h4');
        heading.textContent = category.name;
        const description = document.createElement('small');
        description.className = 'displayBlock marginBot5';
        description.textContent = category.description;
        settingsContainer.append(heading, description);
        for (const key of keys) {
            const control = makeCheckbox(getWorldInfoSettingLabel(key), true, `world_info_locks_setting_${key}`);
            control.input.dataset.setting = key;
            settingInputs.push(control.input);
            settingsContainer.append(control.wrapper);
        }
    }
    include.input.addEventListener('change', () => settingsContainer.hidden = !include.input.checked);
    content.append(settingsContainer);

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: t`Save`,
        cancelButton: t`Cancel`,
        allowVerticalScrolling: true,
    });
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return undefined;
    }
    if (!include.input.checked) {
        return null;
    }
    return Object.fromEntries(settingInputs.filter(input => input.checked).map(input => [input.dataset.setting, supported[input.dataset.setting]]));
}

async function createPreset() {
    const name = String(await Popup.show.input(t`Create World Info Preset`, t`Preset name:`, settings.presetName) || '').trim();
    if (!name) {
        return;
    }
    if (findPreset(name)) {
        toastr.warning(t`A World Info preset with that name already exists.`, t`World Info Presets`);
        return;
    }

    const worldInfoSettings = await choosePresetSettings();
    if (worldInfoSettings === undefined) {
        return;
    }
    const preset = normalizeWorldInfoPreset({
        name,
        worldList: getCurrentEligibleWorldNames(),
        worldInfoSettings,
    });
    settings.presetList.push(preset);
    settings.presetName = preset.name;
    saveSettingsDebounced();
    renderPresetSelect();
}

async function updateCurrentPreset() {
    const preset = getCurrentPreset();
    if (!preset) {
        await createPreset();
        return;
    }
    preset.worldList = getCurrentEligibleWorldNames();
    const previousSettings = preset.worldInfoSettings && typeof preset.worldInfoSettings === 'object' && !Array.isArray(preset.worldInfoSettings)
        ? preset.worldInfoSettings
        : {};
    preset.worldInfoSettings = { ...previousSettings, ...snapshotWorldInfoSettings() };
    saveSettingsDebounced();
    renderPresetSelect();
    toastr.success(t`World Info preset updated.`, t`World Info Presets`);
}

async function renameCurrentPreset() {
    const preset = getCurrentPreset();
    if (!preset) {
        return;
    }
    const oldName = preset.name;
    const newName = String(await Popup.show.input(t`Rename World Info Preset`, t`New preset name:`, oldName) || '').trim();
    if (!newName || newName === oldName) {
        return;
    }
    if (findPreset(newName)) {
        toastr.warning(t`A World Info preset with that name already exists.`, t`World Info Presets`);
        return;
    }

    if (getChatLock() === oldName && !await setChatLock(newName)) {
        return;
    }
    preset.name = newName;
    renamePresetReferences(settings, oldName, newName);
    if (settings.presetName === oldName) {
        settings.presetName = newName;
    }
    saveSettingsDebounced();
    renderPresetSelect();
}

async function deleteCurrentPreset() {
    const preset = getCurrentPreset();
    if (!preset || !await Popup.show.confirm(t`Delete World Info Preset`, t`Delete "${preset.name}"?`)) {
        return;
    }

    if (getChatLock() === preset.name && !await setChatLock('')) {
        return;
    }
    removePresetReferences(settings, preset.name);
    settings.presetList.splice(settings.presetList.indexOf(preset), 1);
    settings.presetName = '';
    await activatePreset(null, { skipLockPrompt: true });
    saveSettingsDebounced();
    renderPresetSelect();
}

async function importBundledBooks(data) {
    const books = data.books || {};
    if (!Object.keys(books).length || !await Popup.show.confirm(t`Import Lorebooks`, t`This preset contains ordinary user lorebooks. Import them?`)) {
        return;
    }
    for (const [name, book] of Object.entries(books)) {
        const file = new File([JSON.stringify(book)], `${name}.json`, { type: 'application/json' });
        await importWorldInfo(file);
    }
}

function importPresetLockRecord(target, source, sourcePresetName, targetPresetName) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return;
    }
    for (const [key, value] of Object.entries(source)) {
        if (typeof key === 'string' && key && value === sourcePresetName) {
            target[key] = targetPresetName;
        }
    }
}

function translatePresetImportError(message) {
    switch (message) {
        case 'The preset file must contain an object.': return t`The preset file must contain an object.`;
        case 'The preset file is missing a valid name or world list.': return t`The preset file is missing a valid name or world list.`;
        case 'The preset file contains invalid World Info settings.': return t`The preset file contains invalid World Info settings.`;
        case 'The preset file contains invalid lock data.': return t`The preset file contains invalid lock data.`;
        case 'The preset file contains an invalid default setting.': return t`The preset file contains an invalid default setting.`;
        case 'The preset books field is invalid.': return t`The preset books field is invalid.`;
        case 'The preset contains invalid lorebook data.': return t`The preset contains invalid lorebook data.`;
        case 'Secure or hidden lorebook data cannot be imported with a preset.': return t`Secure or hidden lorebook data cannot be imported with a preset.`;
        default: return t`The preset file is invalid.`;
    }
}

async function importPresetFile(file) {
    let data;
    let preset;
    try {
        data = JSON.parse(await file.text());
        preset = validateWorldInfoPresetImport(data);
    } catch (error) {
        toastr.error(translatePresetImportError(error?.message), t`World Info Presets`);
        return;
    }

    const sourcePresetName = preset.name;
    let existing = findPreset(preset.name);
    if (existing) {
        const replacementName = await Popup.show.input(t`Import World Info Preset`, t`Change the name, or keep it to overwrite the existing preset.`, preset.name);
        if (!replacementName) {
            return;
        }
        preset.name = String(replacementName).trim();
        if (!preset.name) {
            return;
        }
        existing = findPreset(preset.name);
        if (existing && !await Popup.show.confirm(t`Overwrite World Info Preset`, t`Overwrite "${existing.name}"?`)) {
            return;
        }
    }

    const reactivateImportedPreset = Boolean(existing && settings.presetName === existing.name);
    await importBundledBooks(data);
    if (existing) {
        Object.assign(existing, preset);
    } else {
        settings.presetList.push(preset);
    }

    const hasCharacterLocks = Object.values(data.characterLocks || {}).includes(sourcePresetName)
        || Object.values(data.characterLockIds || {}).includes(sourcePresetName)
        || data.characterLockRecords?.some(record => record?.presetName === sourcePresetName);
    if (hasCharacterLocks && await Popup.show.confirm(t`Import Character Preset Locks`, t`This file contains character preset locks. Import them?`)) {
        importPresetLockRecord(settings.characterLocks, data.characterLocks, sourcePresetName, preset.name);
        importPresetLockRecord(settings.characterLockIds, data.characterLockIds, sourcePresetName, preset.name);
        if (Array.isArray(data.characterLockRecords)) {
            for (const record of data.characterLockRecords) {
                if (record?.presetName !== sourcePresetName) {
                    continue;
                }
                const directMatch = characters.find(character => character?.avatar === record?.id);
                const nameMatches = characters.filter(character => character?.name === record?.name);
                const character = directMatch || (nameMatches.length === 1 ? nameMatches[0] : null);
                if (character?.avatar) {
                    settings.characterLockIds[character.avatar] = preset.name;
                }
            }
        }
    }

    const hasGroupLocks = Object.values(data.groupLocks || {}).includes(sourcePresetName);
    if (hasGroupLocks && await Popup.show.confirm(t`Import Group Preset Locks`, t`This file contains group preset locks. Import them?`)) {
        importPresetLockRecord(settings.groupLocks, data.groupLocks, sourcePresetName, preset.name);
    }
    if (data.isGlobalDefault && await Popup.show.confirm(t`Import Default Preset`, t`Set the imported preset as the global default?`)) {
        settings.globalDefaultPreset = preset.name;
    }
    if (reactivateImportedPreset) {
        await activatePreset(existing, { skipLockPrompt: true });
    } else {
        saveSettingsDebounced();
        renderPresetSelect();
    }
}

async function loadOrdinaryLorebookForExport(name) {
    if (!getEligibleWorldNameSet().has(name)) {
        return null;
    }
    const response = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name, storage: 'user' }),
    });
    if (!response.ok) {
        throw new Error(translate('An ordinary user lorebook could not be exported.'));
    }
    const result = await response.json();
    if (!isSafeOrdinaryLorebookExportResponse(result)) {
        throw new Error(translate('An ordinary user lorebook could not be exported.'));
    }
    return result.data;
}

function getRelevantLocks(record, presetName) {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value === presetName));
}

async function exportCurrentPreset() {
    const preset = getCurrentPreset();
    if (!preset) {
        return;
    }
    const content = makePopupContent(t`Export World Info Preset`);
    const includeBooks = makeCheckbox(t`Include ordinary user lorebook contents`, true, 'world_info_locks_export_books');
    const useCurrent = makeCheckbox(t`Use the current ordinary lorebook selection`, false, 'world_info_locks_export_current');
    content.append(includeBooks.wrapper, useCurrent.wrapper);
    const popup = new Popup(content, POPUP_TYPE.CONFIRM);
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }

    const worldList = useCurrent.input.checked ? getCurrentEligibleWorldNames() : getPresetEligibleNames(preset);
    const characterLocks = getRelevantLocks(settings.characterLocks, preset.name);
    const characterLockIds = getRelevantLocks(settings.characterLockIds, preset.name);
    const characterLockRecords = Object.keys(characterLockIds).map(id => ({
        id,
        name: String(characters.find(character => character?.avatar === id)?.name || ''),
        presetName: preset.name,
    }));
    const data = {
        formatVersion: WORLD_INFO_LOCKS_EXPORT_VERSION,
        name: preset.name,
        worldList,
        worldInfoSettings: preset.worldInfoSettings === null
            ? null
            : filterWorldInfoEngineSettings(preset.worldInfoSettings),
        characterLocks,
        characterLockIds,
        characterLockRecords,
        groupLocks: getRelevantLocks(settings.groupLocks, preset.name),
        isGlobalDefault: settings.globalDefaultPreset === preset.name,
    };

    if (includeBooks.input.checked) {
        data.books = {};
        try {
            for (const name of worldList) {
                const book = await loadOrdinaryLorebookForExport(name);
                if (book) {
                    data.books[name] = book;
                }
            }
        } catch (error) {
            toastr.error(error?.message || t`The preset could not be exported.`, t`World Info Presets`);
            return;
        }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Aikobots-WorldInfoPreset-${preset.name.replace(/[<>:"/\\|?*]/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function bindUi() {
    $('#world_info_locks_preset').on('change', async function () {
        const name = String($(this).val() || '');
        if (!name && settings.globalDefaultPreset) {
            await activatePresetByName(settings.globalDefaultPreset);
        } else {
            await activatePresetByName(name);
        }
    });
    $('#world_info_locks_lock').on('click', showLockSettings);
    $('#world_info_locks_settings').on('click', showGlobalSettings);
    $('#world_info_locks_rename').on('click', renameCurrentPreset);
    $('#world_info_locks_update').on('click', updateCurrentPreset);
    $('#world_info_locks_create').on('click', createPreset);
    $('#world_info_locks_restore').on('click', () => activatePreset(getCurrentPreset(), { skipLockPrompt: true }));
    $('#world_info_locks_import').on('click', () => $('#world_info_locks_import_file').trigger('click'));
    $('#world_info_locks_export').on('click', exportCurrentPreset);
    $('#world_info_locks_delete').on('click', deleteCurrentPreset);
    $('#world_info_locks_import_file').on('change', async function () {
        for (const file of Array.from(this.files || [])) {
            await importPresetFile(file);
        }
        this.value = '';
    });
}

function registerSlashCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wipreset',
        callback: async (_args, value) => {
            await activatePresetByName(value);
            return settings.presetName;
        },
        returns: 'active World Info preset',
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'World Info preset name',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
        })],
        helpString: '<div data-i18n="Activate a World Info preset. Leave the name blank to deactivate ordinary user lorebooks.">Activate a World Info preset. Leave the name blank to deactivate ordinary user lorebooks.</div>',
    }));
}

/** Initializes the always-loaded World Info Locks core feature. */
export function initWorldInfoLocks() {
    if (initialized) {
        return;
    }
    initialized = true;

    const presetsChanged = migrateLegacyPresets();
    const charactersChanged = migrateLegacyCharacterLockIds(settings, characters);
    const groupsChanged = migrateLegacyGroupLockIds(settings, groups, characters.map(character => character?.name));
    if (presetsChanged || charactersChanged || groupsChanged) {
        saveSettingsDebounced();
    }

    bindUi();
    registerSlashCommand();
    renderPresetSelect();
    void applyLocksForCurrentContext();

    eventSource.on(event_types.CHAT_CHANGED, scheduleContextRefresh);
    eventSource.on(event_types.CHARACTER_RENAMED, (oldId, newId) => {
        if (moveCharacterLockId(settings, oldId, newId)) {
            saveSettingsDebounced();
        }
    });
    eventSource.on(event_types.LOREBOOK_REFERENCES_UPDATED, ({ operation, oldName, newName } = {}) => {
        if (operation !== 'rename' || !oldName || !newName) {
            return;
        }
        let changedPreset = false;
        for (const preset of settings.presetList) {
            if (!preset.worldList.includes(oldName)) {
                continue;
            }
            preset.worldList = preset.worldList.map(name => name === oldName ? newName : name);
            changedPreset = true;
        }
        if (changedPreset) {
            saveSettingsDebounced();
            renderPresetSelect();
        }
    });
}
