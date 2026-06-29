import { Fuse, lodash } from '../lib.js';

import {
    CHAT_COMPLETIONS_ONLY,
    amount_gen,
    characters,
    eventSource,
    event_types,
    getRequestHeaders,
    main_api,
    max_context,
    online_status,
    saveSettings,
    saveSettingsDebounced,
    this_chid,
} from '../script.js';
import { groups, selected_group } from './group-chats.js';
import { t } from './i18n.js';
import { oai_settings, openai_setting_names, openai_settings } from './openai.js';
import { Popup } from './popup.js';
import { power_user } from './power-user.js';
import { reasoning_templates } from './reasoning.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from './slash-commands/SlashCommandArgument.js';
import { enumIcons } from './slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandEnumValue, enumTypes } from './slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import { download, ensurePlainObject, equalsIgnoreCaseAndAccents, getSanitizedFilename, parseJsonFile, waitUntilCondition } from './utils.js';

const presetManagers = {};
// Text-generation preset managers were removed with the textgen cleanup; only OpenAI presets and reasoning templates remain here.
const CHAT_COMPLETIONS_ONLY_PRESET_MANAGERS = new Set(['openai', 'reasoning']);

/**
 * Automatically select a preset for current API based on character or group name.
 */
function autoSelectPreset() {
    if (power_user.generationLocks?.enabled) {
        console.debug('Skipping auto-select preset because Generation Locks are enabled.');
        return;
    }

    const presetManager = getPresetManager();

    if (!presetManager) {
        console.debug(`Preset Manager not found for API: ${main_api}`);
        return;
    }

    const name = selected_group ? groups.find(x => x.id == selected_group)?.name : characters[this_chid]?.name;

    if (!name) {
        console.debug(`Preset candidate not found for API: ${main_api}`);
        return;
    }

    const preset = presetManager.findPreset(name);
    const selectedPreset = presetManager.getSelectedPreset();

    if (preset === selectedPreset) {
        console.debug(`Preset already selected for API: ${main_api}, name: ${name}`);
        return;
    }

    if (preset !== undefined && preset !== null) {
        console.log(`Preset found for API: ${main_api}, name: ${name}`);
        presetManager.selectPreset(preset);
    }
}

/**
 * Gets a preset manager by API id.
 * @param {string} apiId API id
 * @returns {PresetManager} Preset manager
 */
export function getPresetManager(apiId = '') {
    if (!apiId) {
        apiId = main_api;
    }

    if (!Object.keys(presetManagers).includes(apiId)) {
        return null;
    }

    return presetManagers[apiId];
}

/**
 * Registers preset managers for all select elements with data-preset-manager-for attribute.
 */
function registerPresetManagers() {
    $('select[data-preset-manager-for]').each((_, e) => {
        const forData = $(e).data('preset-manager-for');
        for (const apiId of forData.split(',')) {
            if (CHAT_COMPLETIONS_ONLY && !CHAT_COMPLETIONS_ONLY_PRESET_MANAGERS.has(apiId)) {
                console.debug(`Skipping preset manager for API: ${apiId} (chat-completions-only mode)`);
                continue;
            }

            console.debug(`Registering preset manager for API: ${apiId}`);
            presetManagers[apiId] = new PresetManager($(e), apiId);
        }
    });
}

class PresetManager {
    constructor(select, apiId) {
        this.select = select;
        this.apiId = apiId;
    }

    /**
     * Gets all preset names.
     * @returns {string[]} List of preset names
     */
    getAllPresets() {
        return $(this.select).find('option').map((_, el) => el.text).toArray();
    }

    /**
     * Finds a preset by name.
     * @param {string} name Preset name
     * @returns {any} Preset value
     */
    findPreset(name) {
        return $(this.select).find('option').filter(function () {
            return $(this).text() === name;
        }).val();
    }

    /**
     * Gets the selected preset value.
     * @returns {any} Selected preset value
     */
    getSelectedPreset() {
        return $(this.select).find('option:selected').val();
    }

    /**
     * Gets the selected preset name.
     * @returns {string} Selected preset name
     */
    getSelectedPresetName() {
        return $(this.select).find('option:selected').text();
    }

    /**
     * Selects a preset by option value.
     * @param {string} value Preset option value
     */
    selectPreset(value) {
        const option = $(this.select).filter(function () {
            return $(this).val() === value;
        });
        option.prop('selected', true);
        $(this.select).val(value).trigger('change');
    }

    /**
     * Updates the preset select element with the current API presets.
     * @param {object} [options] Options for saving the preset
     * @param {boolean} [options.skipUpdate=false] If true, skips updating the preset list after saving.
     */
    async updatePreset(options = { skipUpdate: false }) {
        const selected = $(this.select).find('option:selected');

        if (selected.val() == 'gui') {
            toastr.info(t`Cannot update GUI preset`);
            return;
        }

        const name = selected.text();
        await this.savePreset(name, null, options);

        const successToast = !this.isAdvancedFormatting() ? t`Preset updated` : t`Template updated`;
        toastr.success(successToast);
    }

    /**
     * Saves the currently selected preset with a new name.
     */
    async savePresetAs() {
        const inputValue = this.getSelectedPresetName();
        const popupText = !this.isAdvancedFormatting() ? '<h4>' + t`Hint: Use a character/group name to bind preset to a specific chat.` + '</h4>' : '';
        const headerText = !this.isAdvancedFormatting() ? t`Preset name:` : t`Template name:`;
        const name = await Popup.show.input(headerText, popupText, inputValue);
        if (!name) {
            console.log('Preset name not provided');
            return;
        }

        await this.savePreset(name);

        const successToast = !this.isAdvancedFormatting() ? t`Preset saved` : t`Template saved`;
        toastr.success(successToast);
    }

    /**
     * Saves a preset with the given name and settings.
     * @param {string} name Name of the preset to save
     * @param {object} [settings] Settings to save as the preset. If not provided, uses the current preset settings.
     * @param {object} [options] Options for saving the preset
     * @param {boolean} [options.skipUpdate=false] If true, skips updating the preset list after saving.
     */
    async savePreset(name, settings, { skipUpdate = false } = {}) {
        const preset = settings ?? this.getPresetSettings(name);

        const response = await fetch('/api/presets/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ preset, name, apiId: this.apiId }),
        });

        if (!response.ok) {
            toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Preset could not be saved`);
            console.error('Preset could not be saved', response);
            throw new Error('Preset could not be saved');
        }

        const data = await response.json();
        name = data.name;

        if (skipUpdate) {
            console.debug(`Preset ${name} saved, but not updating the list`);
            return;
        }

        this.updateList(name, preset);
    }

    /**
     * Renames the currently selected preset.
     * @param {string} newName New name for the preset
     */
    async renamePreset(newName) {
        const oldName = this.getSelectedPresetName();
        if (equalsIgnoreCaseAndAccents(oldName, newName)) {
            throw new Error('New name must be different from old name');
        }
        try {
            await this.savePreset(newName);
            await this.deletePreset(oldName);
        } catch (error) {
            toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Preset could not be renamed`);
            console.error('Preset could not be renamed', error);
            throw new Error('Preset could not be renamed');
        }

    }

    /**
     * Gets a list of presets for the API.
     * @param {string} [api] API ID. If not specified, uses the current API ID.
     * @returns {{presets: any[], preset_names: object, settings: object}}
     */
    getPresetList(api) {
        let presets = [];
        let preset_names = {};
        let settings = {};

        // If no API specified, use the current API
        if (api === undefined) {
            api = this.apiId;
        }

        switch (api) {
            case 'openai':
                presets = openai_settings;
                preset_names = openai_setting_names;
                settings = oai_settings;
                break;
            case 'reasoning':
                presets = reasoning_templates;
                preset_names = reasoning_templates.map(x => x.name);
                settings = power_user.reasoning;
                break;
            default:
                console.warn(`Unknown API ID ${api}`);
        }

        return { presets, preset_names, settings };
    }

    /**
     * Returns true if the API is keyed, meaning it uses a name to identify presets.
     */
    isKeyedApi() {
        return this.isAdvancedFormatting();
    }

    /**
     * Returns true if the API is from Advanced Formatting group.
     */
    isAdvancedFormatting() {
        // After textgen removal, reasoning is the only remaining name-keyed template set.
        return this.apiId === 'reasoning';
    }

    /**
     * Updates the preset list with a new or existing preset.
     * @param {string} name Name of the preset
     * @param {object} preset Preset object
     */
    updateList(name, preset) {
        const { presets, preset_names } = this.getPresetList();
        const presetExists = this.isKeyedApi() ? preset_names.includes(name) : Object.keys(preset_names).includes(name);

        if (presetExists) {
            if (this.isKeyedApi()) {
                presets[preset_names.indexOf(name)] = preset;
                $(this.select).find(`option[value="${name}"]`).prop('selected', true);
                $(this.select).val(name).trigger('change');
            }
            else {
                const value = preset_names[name];
                presets[value] = preset;
                $(this.select).find(`option[value="${value}"]`).prop('selected', true);
                $(this.select).val(value).trigger('change');
            }
        }
        else {
            presets.push(preset);
            const value = presets.length - 1;

            if (this.isKeyedApi()) {
                preset_names[value] = name;
                const option = $('<option></option>', { value: name, text: name, selected: true });
                $(this.select).append(option);
                $(this.select).val(name).trigger('change');
            } else {
                preset_names[name] = value;
                const option = $('<option></option>', { value: value, text: name, selected: true });
                $(this.select).append(option);
                $(this.select).val(value).trigger('change');
            }
        }
    }

    /**
     * Gets the preset settings for the given name.
     * @param {string} name Name of the preset
     * @returns {object} Preset settings object for the given name
     */
    getPresetSettings(name) {
        function getSettingsByApiId(apiId) {
            switch (apiId) {
                case 'openai':
                    return oai_settings;
                case 'reasoning': {
                    const reasoning_preset = structuredClone(power_user.reasoning);
                    reasoning_preset['name'] = name || power_user.reasoning.preset;
                    return reasoning_preset;
                }
                default:
                    console.warn(`Unknown API ID ${apiId}`);
                    return {};
            }
        }

        const filteredKeys = [
            'api_server',
            'preset',
            'streaming',
            'truncation_length',
            'n',
            'streaming_url',
            'stopping_strings',
            'can_use_tokenization',
            'can_use_streaming',
            'preset_settings_novel',
            'preset_settings',
            'streaming_novel',
            'nai_preamble',
            'model_novel',
            'enabled',
            'seed',
            'legacy_api',
            'mancer_model',
            'togetherai_model',
            'ollama_model',
            'vllm_model',
            'aphrodite_model',
            'server_urls',
            'type',
            'custom_model',
            'bypass_status_check',
            'infermaticai_model',
            'dreamgen_model',
            'openrouter_model',
            'featherless_model',
            'max_tokens_second',
            'openrouter_providers',
            'openrouter_allow_fallbacks',
            'tabby_model',
            'derived',
            'generic_model',
            'include_reasoning',
            'global_banned_tokens',
            'send_banned_tokens',

            // Reasoning exclusions
            'auto_parse',
            'add_to_prompts',
            'auto_expand',
            'show_hidden',
            'max_additions',
        ];
        const settings = Object.assign({}, getSettingsByApiId(this.apiId));

        for (const key of filteredKeys) {
            if (Object.hasOwn(settings, key)) {
                delete settings[key];
            }
        }

        return settings;
    }

    /**
     * Retrieves a completion preset by name.
     * @param {string} name Name of the preset to retrieve
     * @returns {any} Preset object if found, otherwise undefined
     */
    getCompletionPresetByName(name) {
        // Retrieve a completion preset by name. Return undefined if not found.
        let { presets, preset_names } = this.getPresetList();
        let preset;

        // Some APIs use an array of names, others use an object of {name: index}
        if (Array.isArray(preset_names)) {  // array of names
            if (preset_names.includes(name)) {
                preset = presets[preset_names.indexOf(name)];
            }
        } else {  // object of {names: index}
            if (preset_names[name] !== undefined) {
                preset = presets[preset_names[name]];
            }
        }

        if (preset === undefined) {
            console.error(`Preset ${name} not found`);
        }

        // if the preset isn't found, returns undefined
        return preset;
    }

    /**
     * Deletes a preset by name. If not provided, deletes the currently selected preset.
     * @param {string} [name] Name of the preset to delete.
     */
    async deletePreset(name) {
        const { preset_names, presets } = this.getPresetList();
        const value = name ? (this.isKeyedApi() ? this.findPreset(name) : name) : this.getSelectedPreset();
        const nameToDelete = name || this.getSelectedPresetName();

        if (value == 'gui') {
            toastr.info(t`Cannot delete GUI preset`);
            return;
        }

        if (this.isKeyedApi()) {
            $(this.select).find(`option[value="${value}"]`).remove();
            const index = preset_names.indexOf(nameToDelete);
            preset_names.splice(index, 1);
            presets.splice(index, 1);
        } else {
            const index = preset_names[nameToDelete];
            $(this.select).find(`option[value="${index}"]`).remove();
            delete preset_names[nameToDelete];
        }

        // switch in UI only when deleting currently selected preset
        const switchPresets = !name || this.getSelectedPresetName() == name;

        if (Object.keys(preset_names).length && switchPresets) {
            const nextPresetName = Object.keys(preset_names)[0];
            const newValue = preset_names[nextPresetName];
            $(this.select).find(`option[value="${newValue}"]`).attr('selected', 'true');
            $(this.select).trigger('change');
        }

        const response = await fetch('/api/presets/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: nameToDelete, apiId: this.apiId }),
        });

        return response.ok;
    }

    /**
     * Retrieves the default preset for the API from the server.
     * @param {string} name Name of the preset to restore
     * @returns {Promise<any>} Default preset object, or undefined if the request fails
     */
    async getDefaultPreset(name) {
        const response = await fetch('/api/presets/restore', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name, apiId: this.apiId }),
        });

        if (!response.ok) {
            const errorToast = !this.isAdvancedFormatting() ? t`Failed to restore default preset` : t`Failed to restore default template`;
            toastr.error(errorToast);
            return;
        }

        return await response.json();
    }

    /**
     * Reads a preset extension field from the preset.
     * @param {object} options
     * @param {string} [options.name] Name of the preset. If not provided, uses the currently selected preset name.
     * @param {string} options.path Path to the preset extension field, e.g. 'myextension.data'. If empty, reads the entire extensions object.
     * @return {any} The value of the preset extension field, or null if not found.
     */
    readPresetExtensionField({ name, path }) {
        const { settings } = this.getPresetList();
        const selectedName = this.getSelectedPresetName();
        const presetName = name || selectedName;

        // Read from settings if the selected preset is the same as the provided name
        if (settings && selectedName === presetName) {
            const settingsExtensions = ensurePlainObject(settings.extensions || {});
            return path ? lodash.get(settingsExtensions, path, null) : settingsExtensions;
        }

        // Otherwise, read from the preset by name
        const preset = this.getCompletionPresetByName(presetName);
        if (!preset) {
            return null;
        }

        const presetExtensions = ensurePlainObject(preset.extensions || {});
        const value = path ? lodash.get(presetExtensions, path, null) : presetExtensions;
        return value;
    }

    /**
     * Writes a value to a preset extension field.
     * @param {object} options
     * @param {string} [options.name] Name of the preset. If not provided, uses the currently selected preset name.
     * @param {string} options.path Path to the preset extension field, e.g. 'myextension.data'. If empty, writes to the root of the extensions object.
     * @param {any} options.value Value to write to the preset extension field.
     * @return {Promise<void>} Resolves when the preset is saved.
     */
    async writePresetExtensionField({ name, path, value }) {
        const { settings } = this.getPresetList();
        const selectedName = this.getSelectedPresetName();
        const presetName = name || selectedName;

        // Write to settings if the selected preset is the same as the provided name
        if (settings && selectedName === presetName) {
            // Set the value at the specified path
            settings.extensions = ensurePlainObject(settings.extensions || {});
            path ? lodash.set(settings.extensions, path, value) : (settings.extensions = value);
            await saveSettings();
        }

        // Also update the preset by name
        const preset = this.getCompletionPresetByName(presetName);
        if (!preset) {
            return;
        }

        // Set the value at the specified path
        preset.extensions = ensurePlainObject(preset.extensions || {});
        path ? lodash.set(preset.extensions, path, value) : (preset.extensions = value);

        // Save the updated preset
        await this.savePreset(presetName, preset, { skipUpdate: true });
    }
}

/**
 * Selects a preset by name for current API.
 * @param {any} _ Named arguments
 * @param {string} name Unnamed arguments
 * @returns {Promise<string>} Selected or current preset name
 */
async function presetCommandCallback(_, name) {
    const shouldReconnect = online_status !== 'no_connection';
    const presetManager = getPresetManager();

    if (!presetManager) {
        console.debug(`Preset Manager not found for API: ${main_api}`);
        return '';
    }

    const allPresets = presetManager.getAllPresets();
    const currentPreset = presetManager.getSelectedPresetName();

    if (!name) {
        console.log('No name provided for /preset command, using current preset');
        return currentPreset;
    }

    if (!Array.isArray(allPresets) || allPresets.length === 0) {
        console.log(`No presets found for API: ${main_api}`);
        return currentPreset;
    }

    // Find exact match
    const exactMatch = allPresets.find(p => p.toLowerCase().trim() === name.toLowerCase().trim());

    if (exactMatch) {
        console.log('Found exact preset match', exactMatch);

        if (currentPreset !== exactMatch) {
            const presetValue = presetManager.findPreset(exactMatch);

            if (presetValue) {
                presetManager.selectPreset(presetValue);
                shouldReconnect && await waitForConnection();
            }
        }

        return exactMatch;
    } else {
        // Find fuzzy match
        const fuse = new Fuse(allPresets);
        const fuzzyMatch = fuse.search(name);

        if (!fuzzyMatch.length) {
            console.warn(`Preset not found with name ${name}`);
            return currentPreset;
        }

        const fuzzyPresetName = fuzzyMatch[0].item;
        const fuzzyPresetValue = presetManager.findPreset(fuzzyPresetName);

        if (fuzzyPresetValue) {
            console.log('Found fuzzy preset match', fuzzyPresetName);

            if (currentPreset !== fuzzyPresetName) {
                presetManager.selectPreset(fuzzyPresetValue);
                shouldReconnect && await waitForConnection();
            }
        }

        return fuzzyPresetName;
    }
}

/**
 * Waits for API connection to be established.
 */
async function waitForConnection() {
    try {
        await waitUntilCondition(() => online_status !== 'no_connection', 10000, 100);
    } catch {
        console.log('Timeout waiting for API to connect');
    }
}

export async function initPresetManager() {
    eventSource.on(event_types.CHAT_CHANGED, autoSelectPreset);
    registerPresetManagers();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'preset',
        callback: presetCommandCallback,
        returns: 'current preset',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'name',
                typeList: [ARGUMENT_TYPE.STRING],
                enumProvider: () => getPresetManager().getAllPresets().map(preset => new SlashCommandEnumValue(preset, null, enumTypes.enum, enumIcons.preset)),
            }),
        ],
        helpString: `
            <div>
                Sets a preset by name for the current API. Gets the current preset if no name is provided.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/preset myPreset</code></pre>
                    </li>
                    <li>
                        <pre><code>/preset</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));


    $(document).on('click', '[data-preset-manager-update]', async function () {
        const apiId = $(this).data('preset-manager-update');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        await presetManager.updatePreset();
    });

    $(document).on('click', '[data-preset-manager-new]', async function () {
        const apiId = $(this).data('preset-manager-new');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        await presetManager.savePresetAs();
    });

    $(document).on('click', '[data-preset-manager-rename]', async function () {
        const apiId = $(this).data('preset-manager-rename');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        const popupHeader = !presetManager.isAdvancedFormatting() ? t`Rename preset` : t`Rename template`;
        const oldName = presetManager.getSelectedPresetName();
        const newName = await getSanitizedFilename(await Popup.show.input(popupHeader, t`Enter a new name:`, oldName) || '');
        if (!newName || oldName === newName) {
            console.debug(!presetManager.isAdvancedFormatting() ? 'Preset rename cancelled' : 'Template rename cancelled');
            return;
        }
        if (equalsIgnoreCaseAndAccents(oldName, newName)) {
            toastr.warning(t`Name not accepted, as it is the same as before (ignoring case and accents).`, t`Rename Preset`);
            return;
        }

        await eventSource.emit(event_types.PRESET_RENAMED_BEFORE, { apiId: apiId, oldName: oldName, newName: newName });
        const extensions = presetManager.readPresetExtensionField({ name: oldName, path: '' });
        await presetManager.renamePreset(newName);
        await presetManager.writePresetExtensionField({ name: newName, path: '', value: extensions });
        await eventSource.emit(event_types.PRESET_RENAMED, { apiId: apiId, oldName: oldName, newName: newName });

        if (apiId === 'openai') {
            // This is a horrible mess, but prevents the renamed preset from being corrupted.
            $('#update_oai_preset').trigger('click');
            return;
        }

        const successToast = !presetManager.isAdvancedFormatting() ? t`Preset renamed` : t`Template renamed`;
        toastr.success(successToast);
    });

    $(document).on('click', '[data-preset-manager-export]', async function () {
        const apiId = $(this).data('preset-manager-export');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        const selected = $(presetManager.select).find('option:selected');
        const name = selected.text();
        const preset = presetManager.getPresetSettings(name);
        const data = JSON.stringify(preset, null, 4);
        download(data, `${name}.json`, 'application/json');
    });

    $(document).on('click', '[data-preset-manager-import]', async function () {
        const apiId = $(this).data('preset-manager-import');
        $(`[data-preset-manager-file="${apiId}"]`).trigger('click');
    });

    $(document).on('change', '[data-preset-manager-file]', async function (e) {
        const apiId = $(this).data('preset-manager-file');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        const file = e.target.files[0];

        if (!file) {
            return;
        }

        const fileName = file.name.replace('.json', '').replace('.settings', '');
        const data = await parseJsonFile(file);
        const name = data?.name ?? fileName;
        data['name'] = name;

        await presetManager.savePreset(name, data);
        const successToast = !presetManager.isAdvancedFormatting() ? t`Preset imported` : t`Template imported`;
        toastr.success(successToast);
        e.target.value = null;
    });

    $(document).on('click', '[data-preset-manager-delete]', async function () {
        const apiId = $(this).data('preset-manager-delete');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        const headerText = !presetManager.isAdvancedFormatting() ? t`Delete this preset?` : t`Delete this template?`;
        const confirm = await Popup.show.confirm(headerText, t`This action is irreversible and your current settings will be overwritten.`);
        if (!confirm) {
            return;
        }

        const name = presetManager.getSelectedPresetName();
        const result = await presetManager.deletePreset();

        if (result) {
            const successToast = !presetManager.isAdvancedFormatting() ? t`Preset deleted` : t`Template deleted`;
            toastr.success(successToast);
            await eventSource.emit(event_types.PRESET_DELETED, { apiId, name });
        } else {
            const warningToast = !presetManager.isAdvancedFormatting() ? t`Preset was not deleted from server` : t`Template was not deleted from server`;
            toastr.warning(warningToast);
        }

        saveSettingsDebounced();
    });

    $(document).on('click', '[data-preset-manager-restore]', async function () {
        const apiId = $(this).data('preset-manager-restore');
        const presetManager = getPresetManager(apiId);

        if (!presetManager) {
            console.warn(`Preset Manager not found for API: ${apiId}`);
            return;
        }

        const name = presetManager.getSelectedPresetName();
        const data = await presetManager.getDefaultPreset(name);

        if (name == 'gui') {
            toastr.info(t`Cannot restore GUI preset`);
            return;
        }

        if (!data) {
            return;
        }

        if (data.isDefault) {
            if (Object.keys(data.preset).length === 0) {
                const errorToast = !presetManager.isAdvancedFormatting() ? t`Default preset cannot be restored` : t`Default template cannot be restored`;
                toastr.error(errorToast);
                return;
            }

            const confirmText = !presetManager.isAdvancedFormatting()
                ? t`Resetting a <b>default preset</b> will restore the default settings.`
                : t`Resetting a <b>default template</b> will restore the default settings.`;
            const confirm = await Popup.show.confirm(t`Are you sure?`, confirmText);
            if (!confirm) {
                return;
            }

            await presetManager.deletePreset();
            await presetManager.savePreset(name, data.preset);
            const option = presetManager.findPreset(name);
            presetManager.selectPreset(option);
            const successToast = !presetManager.isAdvancedFormatting() ? t`Default preset restored` : t`Default template restored`;
            toastr.success(successToast);
        } else {
            const confirmText = !presetManager.isAdvancedFormatting()
                ? t`Resetting a <b>custom preset</b> will restore to the last saved state.`
                : t`Resetting a <b>custom template</b> will restore to the last saved state.`;
            const confirm = await Popup.show.confirm(t`Are you sure?`, confirmText);
            if (!confirm) {
                return;
            }

            const option = presetManager.findPreset(name);
            presetManager.selectPreset(option);
            const successToast = !presetManager.isAdvancedFormatting() ? t`Preset restored` : t`Template restored`;
            toastr.success(successToast);
        }
    });

}
