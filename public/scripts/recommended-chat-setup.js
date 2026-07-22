import {
    CHAT_SAVE_RESULT,
    characters,
    chat_metadata,
    getRequestHeaders,
    isCurrentCharacterChatTemporary,
    persistTemporaryChatForRecommendedSetup,
    saveMetadata,
    this_chid,
} from '../script.js';
import { eventSource, event_types } from './events.js';
import { selected_group } from './group-chats.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from './popup.js';
import { getStmbSettings, openSidePromptSetEditorPopup } from './stmb.js';
import {
    clearSidePromptsCache,
    listSets,
    resolveSetItemsForRun,
} from './stmb-sideprompts-manager.js';
import { suggestStmbLorebookName } from './stmb-lorebook.js';
import { escapeHtml } from './utils.js';
import {
    METADATA_KEY,
    openWorldInfoEditor,
    updateWorldInfoList,
} from './world-info.js';

let initialized = false;
let configurationDirty = false;
let managementState = null;
let hydrateToken = 0;
let activeSummary = { available: false };

async function postJson(path, body = {}) {
    const response = await fetch(`/api/recommended-chat-setup${path}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
        cache: 'no-cache',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data?.error?.message || 'Recommended Chat Setup failed.');
        error.type = data?.error?.type || '';
        error.status = response.status;
        throw error;
    }
    return data;
}

function getCharacter(chid = this_chid) {
    return chid === undefined || chid === null ? null : characters[chid] || null;
}

function getRecommendedSetupKey(character) {
    return String(character?.data?.extensions?.aikobots?.recommended_chat_setup_key || '').trim();
}

function applyRecommendedSetupKey(character, characterKey) {
    const normalizedKey = String(characterKey || '').trim();
    if (!character || !normalizedKey) return;
    character.data ??= {};
    character.data.extensions ??= {};
    character.data.extensions.aikobots ??= {};
    character.data.extensions.aikobots.recommended_chat_setup_key = normalizedKey;
    if (character.json_data) {
        const jsonData = JSON.parse(character.json_data);
        jsonData.data ??= {};
        jsonData.data.extensions ??= {};
        jsonData.data.extensions.aikobots ??= {};
        jsonData.data.extensions.aikobots.recommended_chat_setup_key = normalizedKey;
        character.json_data = JSON.stringify(jsonData);
        $('#character_json_data').val(character.json_data);
    }
}

function resetSelect(select, options, value, disabled) {
    const element = $(select);
    if (element.hasClass('select2-hidden-accessible')) element.select2('destroy');
    element.empty();
    for (const option of options) {
        element.append($('<option></option>').val(option.value).text(option.text));
    }
    element.val(value).prop('disabled', disabled);
    element.select2({
        width: '100%',
        allowClear: true,
        minimumResultsForSearch: 0,
        placeholder: 'None',
        dropdownParent: $('#character_popup'),
    });
}

async function hydrateConfiguration(chid = this_chid) {
    const token = ++hydrateToken;
    configurationDirty = false;
    managementState = null;
    const character = getCharacter(chid);
    if (!character) {
        resetSelect('#recommended_chat_setup_lorebook', [{ value: '', text: 'None' }], '', true);
        resetSelect('#recommended_chat_setup_side_prompts', [{ value: '', text: 'None' }], '', true);
        return;
    }

    try {
        const state = await postJson('/manage/get', { avatar_url: character.avatar });
        if (token !== hydrateToken || String(chid) !== String(this_chid)) return;
        managementState = state;
        const templateOptions = [{ value: '', text: 'None' }];
        if (state.templateSourceName && !(state.eligibleTemplateNames || []).includes(state.templateSourceName)) {
            templateOptions.push({ value: state.templateSourceName, text: `${state.templateSourceName} (does not match current character)` });
        }
        templateOptions.push(...(state.eligibleTemplateNames || []).map(name => ({ value: name, text: name })));
        resetSelect(
            '#recommended_chat_setup_lorebook',
            templateOptions,
            state.templateSourceName || '',
            false,
        );
        try {
            const sidePromptSets = await listSets();
            if (token !== hydrateToken || String(chid) !== String(this_chid)) return;
            resetSelect(
                '#recommended_chat_setup_side_prompts',
                [{ value: '', text: 'None' }, ...sidePromptSets.map(set => ({ value: set.key, text: set.name }))],
                state.sidePromptSetKey || '',
                false,
            );
        } catch {
            resetSelect('#recommended_chat_setup_side_prompts', [{ value: '', text: 'Unavailable' }], '', true);
        }
    } catch (error) {
        if (token !== hydrateToken) return;
        resetSelect('#recommended_chat_setup_lorebook', [{ value: '', text: 'Unavailable' }], '', true);
        resetSelect('#recommended_chat_setup_side_prompts', [{ value: '', text: 'Unavailable' }], '', true);
        toastr.error(error?.message || 'Could not load Recommended Chat Setup.', 'Recommended Chat Setup');
    }
}

async function savePendingConfiguration() {
    if (!configurationDirty || !managementState) return;
    const character = getCharacter();
    if (!character) return;
    const controls = $('#recommended_chat_setup_lorebook, #recommended_chat_setup_side_prompts');
    const sidePromptControl = $('#recommended_chat_setup_side_prompts');
    const sidePromptValue = sidePromptControl.val();
    const sidePromptSetKey = sidePromptControl.prop('disabled') || sidePromptValue === null
        ? undefined
        : String(sidePromptValue || '');
    controls.prop('disabled', true);
    const templateValue = String($('#recommended_chat_setup_lorebook').val() || '');
    const templateAction = templateValue
        ? 'replace'
        : managementState.templateSourceName
            ? 'remove'
            : 'keep';
    try {
        if (sidePromptSetKey) {
            const resolved = await resolveSetItemsForRun(sidePromptSetKey, {}, { allowUnresolved: false });
            if (!resolved.set || resolved.skipped.length > 0) {
                throw new Error('Recommended side prompts must be complete and must not require manual macro input.');
            }
        }
        const saved = await postJson('/manage/save', {
            avatar_url: character.avatar,
            templateAction,
            templateSourceName: templateAction === 'replace' ? templateValue : '',
            sidePromptSetKey,
        });
        applyRecommendedSetupKey(character, saved.characterKey);
        configurationDirty = false;
        await updateWorldInfoList();
        await hydrateConfiguration(this_chid);
        await refreshConsumerButton();
        toastr.success('Recommended Chat Setup saved.', 'Recommended Chat Setup');
    } catch (error) {
        configurationDirty = true;
        controls.prop('disabled', false);
        toastr.error(error?.message || 'Could not save Recommended Chat Setup.', 'Recommended Chat Setup');
    }
}

function setButtonState(summary) {
    activeSummary = summary?.available ? summary : { available: false };
    const button = $('#recommended_chat_setup_button');
    const enabled = Boolean(activeSummary.available && !selected_group && getCharacter());
    button
        .prop('disabled', !enabled)
        .attr('aria-disabled', enabled ? 'false' : 'true')
        .attr('title', enabled
            ? 'Load the botmaker\'s Recommended Chat Setup.'
            : 'This bot does not have a Recommended Chat Setup.');
}

async function refreshConsumerButton() {
    const character = getCharacter();
    if (!character || selected_group || !getRecommendedSetupKey(character)) {
        setButtonState(null);
        return;
    }
    const requestedAvatar = character.avatar;
    try {
        const summary = await postJson('/summary', { avatar_url: requestedAvatar });
        if (getCharacter()?.avatar === requestedAvatar) setButtonState(summary);
    } catch {
        if (getCharacter()?.avatar === requestedAvatar) setButtonState(null);
    }
}

function buildPreview(summary, suggestedName) {
    const root = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    root.append($('<h3 class="margin0"></h3>').text('Recommended Chat Setup'));
    root.append($('<p></p>').text(`${summary.botmakerName || 'The botmaker'} created a Recommended Chat Setup that works well with this bot.`));
    if (summary.hasTemplate) {
        root.append($('<div></div>')
            .append($('<h4></h4>').text('Lorebook'))
            .append($('<p></p>').text('The botmaker\'s blank template will be copied into a new ordinary lorebook that you own.'))
            .append($('<label for="recommended-chat-setup-lorebook-name"></label>').text('Your lorebook name'))
            .append($('<input id="recommended-chat-setup-lorebook-name" class="text_pole" autocomplete="off">').val(suggestedName)));
    }
    if (summary.hasSidePrompts) {
        root.append($('<div></div>')
            .append($('<h4></h4>').text('Side Prompts'))
            .append($('<p></p>').text(`Set: ${summary.sidePromptSetName} (${summary.sidePromptCount} side prompts)`))
            .append($('<p></p>').text('These run automatically after memory is generated and require no work from you.')));
    }
    return root;
}

async function showPreview(summary, suggestedName) {
    const popup = new Popup(buildPreview(summary, suggestedName), POPUP_TYPE.CONFIRM, '', {
        okButton: 'Apply',
        cancelButton: 'Cancel',
        wide: true,
        leftAlign: true,
        onClosing: instance => {
            if (instance.result !== POPUP_RESULT.AFFIRMATIVE || !summary.hasTemplate) return true;
            const name = String(instance.dlg.querySelector('#recommended-chat-setup-lorebook-name')?.value || '').trim();
            if (name) return true;
            toastr.warning('Enter a name for your lorebook.', 'Recommended Chat Setup');
            return false;
        },
    });
    const result = await popup.show();
    return {
        confirmed: result === POPUP_RESULT.AFFIRMATIVE,
        lorebookName: String(popup.dlg.querySelector('#recommended-chat-setup-lorebook-name')?.value || '').trim(),
    };
}

async function resolveBoundLorebookConflict(summary) {
    if (!summary.hasTemplate || !String(chat_metadata[METADATA_KEY] || '').trim()) {
        return { proceed: true, installLorebook: summary.hasTemplate };
    }
    if (!summary.hasSidePrompts) {
        await Popup.show.text(
            'Lorebook Already Bound',
            'You must unbind the current chat lorebook before applying this recommended blank lorebook template.',
        );
        return { proceed: false, installLorebook: false };
    }
    const result = await Popup.show.confirm(
        'Lorebook Already Bound',
        'You must unbind the current chat lorebook before applying the recommended blank template. Would you like to turn on only the recommended side prompts?',
        { okButton: 'Turn On Side Prompts Only', cancelButton: 'Cancel' },
    );
    return { proceed: result === POPUP_RESULT.AFFIRMATIVE, installLorebook: false };
}

async function resolveSidePromptConflict(preflight) {
    if (!preflight.sidePromptConflict) return '';
    const content = `<h3>Side Prompt Set Already Exists</h3>
        <p>A side prompt set named "${escapeHtml(preflight.sidePromptSetName)}" already exists. Keep the existing set, or overwrite it with the new prompt set? Overwriting is recommended and affects other chats using this set.</p>`;
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Overwrite with Recommended Set',
        cancelButton: false,
        customButtons: [{ text: 'Keep Existing', result: POPUP_RESULT.NEGATIVE }],
        defaultResult: POPUP_RESULT.AFFIRMATIVE,
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE && result !== POPUP_RESULT.NEGATIVE) return null;
    return result === POPUP_RESULT.AFFIRMATIVE ? 'overwrite' : 'keep';
}

async function resolveLorebookNameConflict(currentName, suggestedName) {
    await updateWorldInfoList();
    const nextSuggestion = await suggestStmbLorebookName(getStmbSettings()?.moduleSettings?.lorebookNameTemplate);
    const editedSuggestion = currentName === suggestedName ? nextSuggestion : currentName;
    return await Popup.show.input(
        'Lorebook Name Already Exists',
        currentName === suggestedName
            ? 'That suggested name is no longer available. Accept the next available name or enter another.'
            : 'That lorebook name already exists. Enter another name.',
        editedSuggestion,
        { okButton: 'Continue', cancelButton: 'Cancel' },
    );
}

async function showResult(result) {
    const root = $('<div class="flex-container flexFlowColumn flexGap10"></div>');
    root.append($('<h3 class="margin0"></h3>').text('Recommended Chat Setup Loaded'));
    let lorebookButton = null;
    let sidePromptButton = null;
    if (result.lorebookName) {
        lorebookButton = $('<button type="button" class="menu_button menu_button_icon"></button>')
            .append('<i class="fa-solid fa-book"></i>')
            .append($('<span></span>').text(`Lorebook: ${result.lorebookName}`));
        root.append(lorebookButton);
    }
    if (result.sidePromptSetKey) {
        sidePromptButton = $('<button type="button" class="menu_button menu_button_icon"></button>')
            .append('<i class="fa-solid fa-list-check"></i>')
            .append($('<span></span>').text(`Side Prompts: ${result.sidePromptSetName} (${result.sidePromptCount})`));
        root.append(sidePromptButton);
        root.append($('<p></p>').text('These side prompts are selected for this chat and run automatically after memory is generated.'));
    }
    const popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true });
    lorebookButton?.on('click', async () => {
        await popup.complete(POPUP_RESULT.AFFIRMATIVE);
        openWorldInfoEditor(result.lorebookName);
    });
    sidePromptButton?.on('click', async () => {
        await popup.complete(POPUP_RESULT.AFFIRMATIVE);
        await openSidePromptSetEditorPopup({ setKey: result.sidePromptSetKey });
    });
    await popup.show();
}

async function applyRecommendedSetup() {
    const character = getCharacter();
    const summary = activeSummary;
    if (!character || !summary.available || selected_group) return;
    try {
        const suggestedName = summary.hasTemplate
            ? await suggestStmbLorebookName(getStmbSettings()?.moduleSettings?.lorebookNameTemplate)
            : '';
        const preview = await showPreview(summary, suggestedName);
        if (!preview.confirmed) return;
        const boundResolution = await resolveBoundLorebookConflict(summary);
        if (!boundResolution.proceed) return;
        let lorebookName = boundResolution.installLorebook ? preview.lorebookName : '';
        let preflight;
        for (let attempt = 0; attempt < 3; attempt++) {
            preflight = await postJson('/preflight', { avatar_url: character.avatar, lorebookName });
            if (!boundResolution.installLorebook || !preflight.lorebookConflict) break;
            const replacement = await resolveLorebookNameConflict(lorebookName, suggestedName);
            if (replacement === null) return;
            lorebookName = String(replacement || '').trim();
        }
        if (boundResolution.installLorebook && preflight?.lorebookConflict) {
            throw new Error('Choose an unused lorebook name.');
        }
        const sidePromptConflictMode = summary.hasSidePrompts
            ? await resolveSidePromptConflict(preflight)
            : '';
        if (sidePromptConflictMode === null) return;

        if (isCurrentCharacterChatTemporary()) {
            const saved = await persistTemporaryChatForRecommendedSetup();
            if (saved !== CHAT_SAVE_RESULT.SAVED) throw new Error('The temporary chat could not be created.');
        }
        const result = await postJson('/apply', {
            avatar_url: character.avatar,
            revision: summary.revision,
            installLorebook: boundResolution.installLorebook,
            lorebookName,
            installSidePrompts: summary.hasSidePrompts,
            sidePromptConflictMode,
        });
        if (result.lorebookName) {
            await updateWorldInfoList();
            chat_metadata[METADATA_KEY] = result.lorebookName;
        }
        if (result.sidePromptSetKey) {
            clearSidePromptsCache();
            chat_metadata.STMemoryBooks ??= {};
            chat_metadata.STMemoryBooks.sidePromptAfterMemorySetKey = result.sidePromptSetKey;
            window.dispatchEvent(new CustomEvent('stmb-sideprompts-updated'));
        }
        chat_metadata.recommendedChatSetup = {
            revision: summary.revision,
        };
        const metadataSaved = await saveMetadata();
        if (metadataSaved === CHAT_SAVE_RESULT.FAILED) {
            throw new Error('The setup was installed, but the chat binding could not be saved. Retry Recommended Chat Setup.');
        }
        toastr.success('Recommended Chat Setup loaded.', 'Recommended Chat Setup');
        await showResult(result);
    } catch (error) {
        toastr.error(error?.message || 'Could not load Recommended Chat Setup.', 'Recommended Chat Setup');
    }
}

/** Initializes Recommended Chat Setup UI and character/chat event handlers. */
export function initRecommendedChatSetup() {
    if (initialized) return;
    initialized = true;
    $('#recommended_chat_setup_lorebook, #recommended_chat_setup_side_prompts').on('change', async function () {
        if (!managementState) return;
        configurationDirty = true;
        await savePendingConfiguration();
    });
    $('#recommended_chat_setup_button').on('click', applyRecommendedSetup);
    $('#advanced_div').on('click.recommendedChatSetup', () => hydrateConfiguration(this_chid));
    eventSource.on(event_types.CHARACTER_EDITOR_OPENED, async chid => {
        await hydrateConfiguration(chid);
        await refreshConsumerButton();
    });
    eventSource.on(event_types.CHAT_CHANGED, refreshConsumerButton);
    eventSource.on(event_types.CHAT_CREATED, refreshConsumerButton);
    eventSource.on(event_types.WORLDINFO_UPDATED, () => hydrateConfiguration(this_chid));
    window.addEventListener('stmb-sideprompts-updated', () => hydrateConfiguration(this_chid));
    void refreshConsumerButton();
}
