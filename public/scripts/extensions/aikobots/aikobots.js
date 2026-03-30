import { isAdmin } from './../../user.js';
import { renderExtensionTemplateAsync } from '../../extensions.js';
import { Popup } from '../../popup.js';
import { executeSlashCommandsWithOptions } from '../../slash-commands.js';
import { getCharaFilename } from '../../utils.js';
import { eventSource, event_types, getRequestHeaders, characters, this_chid } from '../../../script.js';

let hiddenTemplatesPanel = null;
let panelRefreshTimer = null;
let panelEventsBound = false;

function showElement(selector) {
    try {
        const element = document.querySelector(selector);
        if (element) {
            element.style.display = 'flex';
        }
    } catch (error) {
        console.error(`Error showing element ${selector}:`, error);
    }
}

function compareStrings(a, b) {
    return String(a).localeCompare(String(b));
}

function normalizeName(value) {
    return String(value || '').trim();
}

function normalizeCharacterKey(value) {
    return normalizeName(value).replace(/\.[^/.]+$/, '');
}

function normalizeStringArray(value) {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const unique = new Set();

    for (const item of items) {
        const normalized = normalizeName(item);
        if (normalized) {
            unique.add(normalized);
        }
    }

    return [...unique].sort(compareStrings);
}

function normalizeSourceData(data = {}) {
    const templates = {};
    const charactersMap = {};
    const templateSource = data?.templates && typeof data.templates === 'object' && !Array.isArray(data.templates)
        ? data.templates
        : {};
    const characterSource = data?.characters && typeof data.characters === 'object' && !Array.isArray(data.characters)
        ? data.characters
        : {};

    for (const templateName of Object.keys(templateSource).sort(compareStrings)) {
        const normalizedTemplateName = normalizeName(templateName);
        if (!normalizedTemplateName) {
            continue;
        }

        const templateEntry = templateSource[templateName] && typeof templateSource[templateName] === 'object' && !Array.isArray(templateSource[templateName])
            ? templateSource[templateName]
            : {};
        templates[normalizedTemplateName] = {
            add: normalizeStringArray(templateEntry.add),
            remove: normalizeStringArray(templateEntry.remove),
        };
    }

    for (const characterKey of Object.keys(characterSource).sort(compareStrings)) {
        const normalizedCharacterKey = normalizeCharacterKey(characterKey);
        if (!normalizedCharacterKey) {
            continue;
        }

        const characterEntry = characterSource[characterKey];
        const normalizedEntry = Array.isArray(characterEntry) || typeof characterEntry === 'string'
            ? {
                templates: [],
                add: normalizeStringArray(characterEntry),
                remove: [],
            }
            : {
                templates: normalizeStringArray(characterEntry?.templates),
                add: normalizeStringArray(characterEntry?.add),
                remove: normalizeStringArray(characterEntry?.remove),
            };

        if (normalizedEntry.templates.length || normalizedEntry.add.length || normalizedEntry.remove.length) {
            charactersMap[normalizedCharacterKey] = normalizedEntry;
        }
    }

    return { templates, characters: charactersMap };
}

function buildCompiledBindings(source = {}) {
    const normalized = normalizeSourceData(source);
    const compiled = { characters: {} };

    for (const characterKey of Object.keys(normalized.characters).sort(compareStrings)) {
        const characterEntry = normalized.characters[characterKey];
        const templateAdds = new Set();
        const templateRemoves = new Set();

        for (const templateName of characterEntry.templates) {
            const templateEntry = normalized.templates[templateName];
            if (!templateEntry) {
                continue;
            }

            for (const lorebookName of templateEntry.add) {
                templateAdds.add(lorebookName);
            }

            for (const lorebookName of templateEntry.remove) {
                templateRemoves.add(lorebookName);
            }
        }

        const compiledBooks = new Set(templateAdds);

        for (const lorebookName of templateRemoves) {
            compiledBooks.delete(lorebookName);
        }

        for (const lorebookName of characterEntry.add) {
            compiledBooks.add(lorebookName);
        }

        for (const lorebookName of characterEntry.remove) {
            compiledBooks.delete(lorebookName);
        }

        const finalBooks = [...compiledBooks].sort(compareStrings);
        if (finalBooks.length > 0) {
            compiled.characters[characterKey] = finalBooks;
        }
    }

    return compiled;
}

function getCurrentCharacterKey() {
    const currentCharacter = characters?.[Number(this_chid)];
    return currentCharacter?.avatar ? getCharaFilename(null, { manualAvatarKey: currentCharacter.avatar }) : '';
}

function createEmptyCharacterEntry() {
    return {
        templates: [],
        add: [],
        remove: [],
    };
}

function hasCharacterData(entry = createEmptyCharacterEntry()) {
    return entry.templates.length > 0 || entry.add.length > 0 || entry.remove.length > 0;
}

function ensureCharacterEntry(panel, characterKey) {
    if (!panel.source.characters[characterKey]) {
        panel.source.characters[characterKey] = createEmptyCharacterEntry();
    }

    return panel.source.characters[characterKey];
}

function upsertCharacterEntry(panel, characterKey, entry) {
    const normalizedEntry = {
        templates: normalizeStringArray(entry.templates),
        add: normalizeStringArray(entry.add),
        remove: normalizeStringArray(entry.remove),
    };

    if (hasCharacterData(normalizedEntry)) {
        panel.source.characters[characterKey] = normalizedEntry;
    } else {
        delete panel.source.characters[characterKey];
    }
}

function fillSingleSelect(select, options, value, emptyLabel) {
    select.empty();
    if (!options.length) {
        select.append(new Option(emptyLabel, ''));
        select.val('');
        return;
    }

    for (const option of options) {
        select.append(new Option(option.label, option.value, false, option.value === value));
    }

    select.val(value || options[0].value);
}

function fillMultiSelect(select, options, values) {
    const selectedValues = new Set(normalizeStringArray(values));
    select.empty();

    for (const option of options) {
        select.append(new Option(option.label, option.value, false, selectedValues.has(option.value)));
    }
}

function getSelectedValues(select) {
    return normalizeStringArray(select.val());
}

function setPanelStatus(panel, message, isError = false) {
    panel.status.text(message);
    panel.status.css('color', isError ? 'var(--warning)' : '');
}

function setPanelBusy(panel, isBusy) {
    panel.busy = isBusy;
    panel.root.find('button, select').prop('disabled', isBusy);
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: getRequestHeaders(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    let parsed = null;

    if (text) {
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = null;
        }
    }

    if (!response.ok) {
        throw new Error(parsed?.error?.message || parsed?.message || text || response.statusText);
    }

    return parsed;
}

async function fetchTemplateSource() {
    const response = await postJson('/api/worldinfo/hidden-templates/get', {});
    return normalizeSourceData(response.data);
}

async function fetchCharactersForPanel() {
    const response = await postJson('/api/characters/all', {});
    const deduped = new Map();

    for (const character of Array.isArray(response) ? response : []) {
        const key = getCharaFilename(null, { manualAvatarKey: character?.avatar }) || normalizeCharacterKey(character?.avatar);
        if (!key) {
            continue;
        }

        deduped.set(key, {
            key,
            label: String(character?.name || key),
        });
    }

    return [...deduped.values()].sort((left, right) => compareStrings(left.label, right.label));
}

async function fetchLorebooksForPanel() {
    const response = await postJson('/api/worldinfo/list', {});
    const items = Array.isArray(response?.items)
        ? response.items.map(item => item?.name)
        : Array.isArray(response?.world_names)
            ? response.world_names
            : [];

    return normalizeStringArray(items);
}

function renderTemplateEditor(panel) {
    const templateNames = Object.keys(panel.source.templates).sort(compareStrings);
    const templateOptions = templateNames.map(name => ({ label: name, value: name }));
    const selectedTemplateName = templateNames.includes(panel.currentTemplate) ? panel.currentTemplate : (templateNames[0] || '');
    panel.currentTemplate = selectedTemplateName;

    fillSingleSelect(panel.templateSelect, templateOptions, selectedTemplateName, '(No templates)');

    const lorebookOptions = panel.availableLorebooks.map(name => ({ label: name, value: name }));
    const selectedTemplate = selectedTemplateName ? panel.source.templates[selectedTemplateName] : null;

    fillMultiSelect(panel.templateAdd, lorebookOptions, selectedTemplate?.add ?? []);
    fillMultiSelect(panel.templateRemove, lorebookOptions, selectedTemplate?.remove ?? []);

    const hasTemplate = Boolean(selectedTemplateName);
    panel.templateAdd.prop('disabled', panel.busy || !hasTemplate || lorebookOptions.length === 0);
    panel.templateRemove.prop('disabled', panel.busy || !hasTemplate || lorebookOptions.length === 0);
    panel.templateRename.prop('disabled', panel.busy || !hasTemplate);
    panel.templateDelete.prop('disabled', panel.busy || !hasTemplate);
}

function renderCharacterEditor(panel) {
    const currentCharacterKey = panel.availableCharacters.some(item => item.key === panel.currentCharacter)
        ? panel.currentCharacter
        : (getCurrentCharacterKey() || panel.availableCharacters[0]?.key || '');
    panel.currentCharacter = currentCharacterKey;

    const characterOptions = panel.availableCharacters.map(item => ({ label: item.label, value: item.key }));
    fillSingleSelect(panel.characterSelect, characterOptions, currentCharacterKey, '(No characters)');

    const sourceEntry = currentCharacterKey ? (panel.source.characters[currentCharacterKey] ?? createEmptyCharacterEntry()) : createEmptyCharacterEntry();
    const templateOptions = Object.keys(panel.source.templates).sort(compareStrings).map(name => ({ label: name, value: name }));
    const lorebookOptions = panel.availableLorebooks.map(name => ({ label: name, value: name }));
    const hasCharacter = Boolean(currentCharacterKey);

    fillMultiSelect(panel.characterTemplates, templateOptions, sourceEntry.templates);
    fillMultiSelect(panel.characterAdd, lorebookOptions, sourceEntry.add);
    fillMultiSelect(panel.characterRemove, lorebookOptions, sourceEntry.remove);

    panel.characterTemplates.prop('disabled', panel.busy || !hasCharacter || templateOptions.length === 0);
    panel.characterAdd.prop('disabled', panel.busy || !hasCharacter || lorebookOptions.length === 0);
    panel.characterRemove.prop('disabled', panel.busy || !hasCharacter || lorebookOptions.length === 0);
}

function renderCompiledPreview(panel) {
    const compiled = buildCompiledBindings(panel.source);
    const compiledLorebooks = panel.currentCharacter ? (compiled.characters[panel.currentCharacter] ?? []) : [];
    panel.compiledPreview.text(compiledLorebooks.length > 0 ? compiledLorebooks.join('\n') : '(No compiled hidden lorebooks)');
}

function renderPanel(panel) {
    renderTemplateEditor(panel);
    renderCharacterEditor(panel);
    renderCompiledPreview(panel);
}

async function saveSource(panel, { silent = false } = {}) {
    const normalizedSource = normalizeSourceData(panel.source);
    const response = await postJson('/api/worldinfo/hidden-templates/save', normalizedSource);
    panel.source = normalizeSourceData(response.data);
    renderPanel(panel);

    if (!silent) {
        setPanelStatus(panel, 'Hidden lorebook template source saved.');
    }
}

async function compileSource(panel) {
    await saveSource(panel, { silent: true });
    const response = await postJson('/api/worldinfo/hidden-templates/compile', {});
    const compiledCharacterCount = Object.keys(response?.compiled?.characters ?? {}).length;
    const missingTemplateCount = Object.keys(response?.missingTemplates ?? {}).length;
    let message = `Compiled hidden lorebook bindings for ${compiledCharacterCount} character${compiledCharacterCount === 1 ? '' : 's'}.`;

    if (missingTemplateCount > 0) {
        message += ` Missing template references were ignored for ${missingTemplateCount} character${missingTemplateCount === 1 ? '' : 's'}.`;
    }

    setPanelStatus(panel, message);
}

async function refreshHiddenTemplatesPanel({ quiet = false } = {}) {
    if (!hiddenTemplatesPanel) {
        return;
    }

    const panel = hiddenTemplatesPanel;
    const previousTemplate = panel.currentTemplate;
    const previousCharacter = panel.currentCharacter;
    setPanelBusy(panel, true);

    try {
        const [source, availableCharacters, availableLorebooks] = await Promise.all([
            fetchTemplateSource(),
            fetchCharactersForPanel(),
            fetchLorebooksForPanel(),
        ]);

        panel.source = source;
        panel.availableCharacters = availableCharacters;
        panel.availableLorebooks = availableLorebooks;
        panel.currentTemplate = previousTemplate;
        panel.currentCharacter = previousCharacter || getCurrentCharacterKey();
        renderPanel(panel);

        if (!quiet) {
            setPanelStatus(panel, 'Hidden lorebook template source loaded.');
        }
    } catch (error) {
        console.error('[Aikobots] Failed to refresh hidden lorebook template panel.', error);
        setPanelStatus(panel, `Failed to load hidden lorebook templates: ${error.message}`, true);
    } finally {
        setPanelBusy(panel, false);
        renderPanel(panel);
    }
}

function scheduleHiddenTemplatesPanelRefresh() {
    if (!hiddenTemplatesPanel) {
        return;
    }

    clearTimeout(panelRefreshTimer);
    panelRefreshTimer = setTimeout(() => {
        void refreshHiddenTemplatesPanel({ quiet: true });
    }, 250);
}

function bindHiddenTemplatesPanelEvents(panel) {
    panel.refreshButton.on('click', async () => {
        await refreshHiddenTemplatesPanel();
    });

    panel.saveButton.on('click', async () => {
        setPanelBusy(panel, true);
        try {
            await saveSource(panel);
        } catch (error) {
            console.error('[Aikobots] Failed to save hidden lorebook template source.', error);
            setPanelStatus(panel, `Failed to save hidden lorebook template source: ${error.message}`, true);
        } finally {
            setPanelBusy(panel, false);
            renderPanel(panel);
        }
    });

    panel.compileButton.on('click', async () => {
        setPanelBusy(panel, true);
        try {
            await compileSource(panel);
        } catch (error) {
            console.error('[Aikobots] Failed to compile hidden lorebook templates.', error);
            setPanelStatus(panel, `Failed to compile hidden lorebook templates: ${error.message}`, true);
        } finally {
            setPanelBusy(panel, false);
            renderPanel(panel);
        }
    });

    panel.templateSelect.on('change', () => {
        panel.currentTemplate = String(panel.templateSelect.val() || '');
        renderPanel(panel);
    });

    panel.characterSelect.on('change', () => {
        panel.currentCharacter = String(panel.characterSelect.val() || '');
        renderPanel(panel);
    });

    panel.templateAdd.on('change', () => {
        if (!panel.currentTemplate) {
            return;
        }

        panel.source.templates[panel.currentTemplate] = {
            ...panel.source.templates[panel.currentTemplate],
            add: getSelectedValues(panel.templateAdd),
        };
        renderPanel(panel);
    });

    panel.templateRemove.on('change', () => {
        if (!panel.currentTemplate) {
            return;
        }

        panel.source.templates[panel.currentTemplate] = {
            ...panel.source.templates[panel.currentTemplate],
            remove: getSelectedValues(panel.templateRemove),
        };
        renderPanel(panel);
    });

    panel.characterTemplates.on('change', () => {
        if (!panel.currentCharacter) {
            return;
        }

        const entry = ensureCharacterEntry(panel, panel.currentCharacter);
        entry.templates = getSelectedValues(panel.characterTemplates);
        upsertCharacterEntry(panel, panel.currentCharacter, entry);
        renderPanel(panel);
    });

    panel.characterAdd.on('change', () => {
        if (!panel.currentCharacter) {
            return;
        }

        const entry = ensureCharacterEntry(panel, panel.currentCharacter);
        entry.add = getSelectedValues(panel.characterAdd);
        upsertCharacterEntry(panel, panel.currentCharacter, entry);
        renderPanel(panel);
    });

    panel.characterRemove.on('change', () => {
        if (!panel.currentCharacter) {
            return;
        }

        const entry = ensureCharacterEntry(panel, panel.currentCharacter);
        entry.remove = getSelectedValues(panel.characterRemove);
        upsertCharacterEntry(panel, panel.currentCharacter, entry);
        renderPanel(panel);
    });

    panel.templateCreate.on('click', async () => {
        const templateName = normalizeName(await Popup.show.input('Create Hidden Lorebook Template', 'Enter a new template name:', ''));
        if (!templateName) {
            return;
        }

        if (panel.source.templates[templateName]) {
            setPanelStatus(panel, `Template "${templateName}" already exists.`, true);
            return;
        }

        panel.source.templates[templateName] = { add: [], remove: [] };
        panel.currentTemplate = templateName;
        renderPanel(panel);
        setPanelStatus(panel, `Created template "${templateName}".`);
    });

    panel.templateRename.on('click', async () => {
        if (!panel.currentTemplate) {
            return;
        }

        const currentTemplateName = panel.currentTemplate;
        const nextTemplateName = normalizeName(await Popup.show.input('Rename Hidden Lorebook Template', 'Enter a new template name:', currentTemplateName));
        if (!nextTemplateName || nextTemplateName === currentTemplateName) {
            return;
        }

        if (panel.source.templates[nextTemplateName]) {
            setPanelStatus(panel, `Template "${nextTemplateName}" already exists.`, true);
            return;
        }

        panel.source.templates[nextTemplateName] = panel.source.templates[currentTemplateName];
        delete panel.source.templates[currentTemplateName];

        for (const [characterKey, entry] of Object.entries(panel.source.characters)) {
            entry.templates = normalizeStringArray(entry.templates.map(templateName => templateName === currentTemplateName ? nextTemplateName : templateName));
            upsertCharacterEntry(panel, characterKey, entry);
        }

        panel.currentTemplate = nextTemplateName;
        panel.source = normalizeSourceData(panel.source);
        renderPanel(panel);
        setPanelStatus(panel, `Renamed template "${currentTemplateName}" to "${nextTemplateName}".`);
    });

    panel.templateDelete.on('click', async () => {
        if (!panel.currentTemplate) {
            return;
        }

        const currentTemplateName = panel.currentTemplate;
        const confirmed = await Popup.show.confirm('Delete Hidden Lorebook Template', `Delete template "${currentTemplateName}"? This removes the template assignment from any characters using it.`);
        if (!confirmed) {
            return;
        }

        delete panel.source.templates[currentTemplateName];

        for (const [characterKey, entry] of Object.entries(panel.source.characters)) {
            entry.templates = entry.templates.filter(templateName => templateName !== currentTemplateName);
            upsertCharacterEntry(panel, characterKey, entry);
        }

        panel.currentTemplate = '';
        panel.source = normalizeSourceData(panel.source);
        renderPanel(panel);
        setPanelStatus(panel, `Deleted template "${currentTemplateName}".`);
    });
}

async function ensureHiddenTemplatesPanel() {
    if (hiddenTemplatesPanel?.root?.length) {
        return hiddenTemplatesPanel;
    }

    const panelRoot = $(await renderExtensionTemplateAsync('aikobots', 'settings'));
    $('#extensions_settings').append(panelRoot);

    hiddenTemplatesPanel = {
        root: panelRoot,
        status: panelRoot.find('#aikobots_hidden_templates_status'),
        refreshButton: panelRoot.find('#aikobots_hidden_templates_refresh'),
        saveButton: panelRoot.find('#aikobots_hidden_templates_save'),
        compileButton: panelRoot.find('#aikobots_hidden_templates_compile'),
        templateCreate: panelRoot.find('#aikobots_template_create'),
        templateRename: panelRoot.find('#aikobots_template_rename'),
        templateDelete: panelRoot.find('#aikobots_template_delete'),
        templateSelect: panelRoot.find('#aikobots_template_select'),
        templateAdd: panelRoot.find('#aikobots_template_add'),
        templateRemove: panelRoot.find('#aikobots_template_remove'),
        characterSelect: panelRoot.find('#aikobots_character_select'),
        characterTemplates: panelRoot.find('#aikobots_character_templates'),
        characterAdd: panelRoot.find('#aikobots_character_add'),
        characterRemove: panelRoot.find('#aikobots_character_remove'),
        compiledPreview: panelRoot.find('#aikobots_compiled_preview'),
        source: { templates: {}, characters: {} },
        availableCharacters: [],
        availableLorebooks: [],
        currentTemplate: '',
        currentCharacter: getCurrentCharacterKey(),
        busy: false,
    };

    bindHiddenTemplatesPanelEvents(hiddenTemplatesPanel);
    return hiddenTemplatesPanel;
}

function bindPanelRefreshEvents() {
    if (panelEventsBound) {
        return;
    }

    panelEventsBound = true;
    eventSource.on(event_types.CHARACTER_EDITED, scheduleHiddenTemplatesPanelRefresh);
    eventSource.on(event_types.CHARACTER_DELETED, scheduleHiddenTemplatesPanelRefresh);
    eventSource.on(event_types.CHARACTER_DUPLICATED, scheduleHiddenTemplatesPanelRefresh);
    eventSource.on(event_types.CHARACTER_RENAMED, scheduleHiddenTemplatesPanelRefresh);
    eventSource.on(event_types.WORLDINFO_UPDATED, scheduleHiddenTemplatesPanelRefresh);
}

/**
 * Keep a hidden, scan-only model tag injected and refresh it on EVERY generation.
 * Uses a stable id to avoid stacking.
 */
export async function refreshModelTagInjection() {
    const pipeline = '/model | /pass MODEL={{pipe}} | /inject id=aikobots-model-tag position=none scan=true';
    try {
        await executeSlashCommandsWithOptions(pipeline, {
            handleParserErrors: false,
            handleExecutionErrors: false,
            scope: null,
            parserFlags: null,
            abortController: null,
        });
    } catch (error) {
        console.debug('[Aikobots] refreshModelTagInjection failed', error);
    }
}

eventSource.once(event_types.APP_READY, () => {
    refreshModelTagInjection();
});

eventSource.makeFirst(event_types.GENERATION_STARTED, async () => {
    await refreshModelTagInjection();
});

export async function initializeAikobots() {
    if (!isAdmin()) {
        return;
    }

    showElement('[id="quick_prompts_edit_drawer"]');
    showElement('[id="utility_prompts_edit_drawer"]');
    showElement('[id="extensions_notify_updates_label"]');
    showElement('[id="extensions_details"]');
    showElement('[id="third_party_extension_button"]');
    showElement('[id="assets_container"]');
    showElement('[id="world_button"]');

    bindPanelRefreshEvents();
    await ensureHiddenTemplatesPanel();
    await refreshHiddenTemplatesPanel();
}
