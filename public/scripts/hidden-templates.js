import { isAdmin } from './user.js';
import { isMobile } from './RossAscends-mods.js';
import { renderTemplateAsync } from './templates.js';
import { Popup } from './popup.js';
import { getCharaFilename } from './utils.js';
import { eventSource, event_types, getRequestHeaders, characters, this_chid } from '../script.js';

let hiddenTemplatesPanel = null;
let panelRefreshTimer = null;
let panelEventsBound = false;
let hiddenTemplatesPanelRefreshPromise = null;
let hiddenTemplatesPanelRefreshPending = false;
let hiddenTemplatesPanelRefreshPendingQuiet = true;
const CHARACTER_AVATAR_EXTENSION_REGEX = /\.(?:png|webp|jpe?g|gif|bmp|avif)$/i;

function compareStrings(a, b) {
    return String(a).localeCompare(String(b));
}

function normalizeName(value) {
    return String(value || '').trim();
}

function normalizeCharacterKey(value) {
    return normalizeName(value).replace(CHARACTER_AVATAR_EXTENSION_REGEX, '');
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

function normalizeAssignmentEntry(value) {
    if (Array.isArray(value) || typeof value === 'string') {
        return {
            templates: [],
            add: normalizeStringArray(value),
            remove: [],
        };
    }

    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        templates: normalizeStringArray(source.templates),
        add: normalizeStringArray(source.add),
        remove: normalizeStringArray(source.remove),
    };
}

function createEmptyAssignmentEntry() {
    return {
        templates: [],
        add: [],
        remove: [],
    };
}

function hasAssignmentData(entry = createEmptyAssignmentEntry()) {
    return entry.templates.length > 0 || entry.add.length > 0 || entry.remove.length > 0;
}

function normalizeSourceData(data = {}) {
    const templates = {};
    const global = normalizeAssignmentEntry(data?.global);
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

        const normalizedEntry = normalizeAssignmentEntry(characterSource[characterKey]);

        if (hasAssignmentData(normalizedEntry)) {
            charactersMap[normalizedCharacterKey] = normalizedEntry;
        }
    }

    return { templates, global, characters: charactersMap };
}

function applyAssignmentEntry(baseBooks, entry, templates) {
    const templateAdds = new Set();
    const templateRemoves = new Set();

    for (const templateName of entry.templates) {
        const templateEntry = templates[templateName];
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

    const compiledBooks = new Set(Array.isArray(baseBooks) ? baseBooks : []);

    for (const lorebookName of templateAdds) {
        compiledBooks.add(lorebookName);
    }

    for (const lorebookName of templateRemoves) {
        compiledBooks.delete(lorebookName);
    }

    for (const lorebookName of entry.add) {
        compiledBooks.add(lorebookName);
    }

    for (const lorebookName of entry.remove) {
        compiledBooks.delete(lorebookName);
    }

    return [...compiledBooks].sort(compareStrings);
}

function buildCompiledBindings(source = {}) {
    const normalized = normalizeSourceData(source);
    const compiled = {
        global: applyAssignmentEntry([], normalized.global, normalized.templates),
        characters: {},
    };

    for (const characterKey of Object.keys(normalized.characters).sort(compareStrings)) {
        compiled.characters[characterKey] = applyAssignmentEntry(compiled.global, normalized.characters[characterKey], normalized.templates);
    }

    return compiled;
}

function getCurrentCharacterKey() {
    const currentCharacter = characters?.[Number(this_chid)];
    return currentCharacter?.avatar ? getCharaFilename(null, { manualAvatarKey: currentCharacter.avatar }) : '';
}

function ensureCharacterEntry(panel, characterKey) {
    if (!panel.source.characters[characterKey]) {
        panel.source.characters[characterKey] = createEmptyAssignmentEntry();
    }

    return panel.source.characters[characterKey];
}

function upsertCharacterEntry(panel, characterKey, entry) {
    const normalizedEntry = normalizeAssignmentEntry(entry);

    if (hasAssignmentData(normalizedEntry)) {
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

    const valueExists = options.some(option => option.value === value);
    select.val(valueExists ? value : options[0].value);
}

function fillMultiSelect(select, options, values) {
    const selectedValues = new Set(normalizeStringArray(values));
    select.empty();

    for (const option of options) {
        select.append(new Option(option.label, option.value, false, selectedValues.has(option.value)));
    }

    select.val([...selectedValues]);

    if (select.data('select2')) {
        select.trigger('change.select2');
    }
}

function getSelectedValues(select) {
    return normalizeStringArray(select.val());
}

function syncSelect2(select) {
    if (select?.data('select2')) {
        select.trigger('change.select2');
    }
}

function initializeLorebookSelect2(panel) {
    if (isMobile()) {
        return;
    }

    const lorebookSelects = [
        panel.templateAdd,
        panel.templateRemove,
        panel.globalTemplates,
        panel.globalAdd,
        panel.globalRemove,
        panel.characterTemplates,
        panel.characterAdd,
        panel.characterRemove,
    ];

    for (const select of lorebookSelects) {
        if (select.data('select2')) {
            continue;
        }

        const isTemplateSelector = select.is(panel.globalTemplates) || select.is(panel.characterTemplates);
        select.select2({
            width: '100%',
            placeholder: isTemplateSelector ? 'No templates selected. Click here to select.' : 'No lorebooks selected. Click here to select.',
            searchInputPlaceholder: isTemplateSelector ? 'Search templates...' : 'Search lorebooks...',
            allowClear: true,
            closeOnSelect: false,
        });
    }
}

function setPanelStatus(panel, message, isError = false) {
    panel.status.text(message);
    panel.status.css('color', isError ? 'var(--warning)' : '');
}

function setPanelBusy(panel, isBusy) {
    panel.busy = isBusy;
    panel.root.find('button, select').prop('disabled', isBusy);
    panel.root.find('select').each((_, element) => syncSelect2($(element)));

    if (!isBusy && panel === hiddenTemplatesPanel && hiddenTemplatesPanelRefreshPending) {
        void maybeRunHiddenTemplatesPanelRefresh();
    }
}

async function postJson(url, body, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`)), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: getRequestHeaders(),
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
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
    } catch (error) {
        if (controller.signal.aborted) {
            throw controller.signal.reason instanceof Error
                ? controller.signal.reason
                : new Error(`Request timed out after ${timeoutMs}ms.`);
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
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
    syncSelect2(panel.templateAdd);
    syncSelect2(panel.templateRemove);
}

function renderGlobalEditor(panel) {
    const sourceEntry = panel.source.global ?? createEmptyAssignmentEntry();
    const templateOptions = Object.keys(panel.source.templates).sort(compareStrings).map(name => ({ label: name, value: name }));
    const lorebookOptions = panel.availableLorebooks.map(name => ({ label: name, value: name }));

    fillMultiSelect(panel.globalTemplates, templateOptions, sourceEntry.templates);
    fillMultiSelect(panel.globalAdd, lorebookOptions, sourceEntry.add);
    fillMultiSelect(panel.globalRemove, lorebookOptions, sourceEntry.remove);

    panel.globalTemplates.prop('disabled', panel.busy || templateOptions.length === 0);
    panel.globalAdd.prop('disabled', panel.busy || lorebookOptions.length === 0);
    panel.globalRemove.prop('disabled', panel.busy || lorebookOptions.length === 0);
    syncSelect2(panel.globalTemplates);
    syncSelect2(panel.globalAdd);
    syncSelect2(panel.globalRemove);
}

function renderCharacterEditor(panel) {
    const sourceOnlyCharacters = Object.keys(panel.source.characters)
        .filter(key => !panel.availableCharacters.some(item => item.key === key))
        .map(key => ({ key, label: `${key} (missing character)` }));
    const allCharacters = [...panel.availableCharacters, ...sourceOnlyCharacters]
        .sort((left, right) => compareStrings(left.label, right.label));
    const activeCharacterKey = getCurrentCharacterKey();
    const fallbackCharacterKey = allCharacters.some(item => item.key === activeCharacterKey)
        ? activeCharacterKey
        : (allCharacters[0]?.key || '');

    const currentCharacterKey = allCharacters.some(item => item.key === panel.currentCharacter)
        ? panel.currentCharacter
        : fallbackCharacterKey;
    panel.currentCharacter = currentCharacterKey;

    const characterOptions = allCharacters.map(item => ({ label: item.label, value: item.key }));
    fillSingleSelect(panel.characterSelect, characterOptions, currentCharacterKey, '(No characters)');

    const sourceEntry = currentCharacterKey ? (panel.source.characters[currentCharacterKey] ?? createEmptyAssignmentEntry()) : createEmptyAssignmentEntry();
    const templateOptions = Object.keys(panel.source.templates).sort(compareStrings).map(name => ({ label: name, value: name }));
    const lorebookOptions = panel.availableLorebooks.map(name => ({ label: name, value: name }));
    const hasCharacter = Boolean(currentCharacterKey);

    fillMultiSelect(panel.characterTemplates, templateOptions, sourceEntry.templates);
    fillMultiSelect(panel.characterAdd, lorebookOptions, sourceEntry.add);
    fillMultiSelect(panel.characterRemove, lorebookOptions, sourceEntry.remove);

    panel.characterTemplates.prop('disabled', panel.busy || !hasCharacter || templateOptions.length === 0);
    panel.characterAdd.prop('disabled', panel.busy || !hasCharacter || lorebookOptions.length === 0);
    panel.characterRemove.prop('disabled', panel.busy || !hasCharacter || lorebookOptions.length === 0);
    syncSelect2(panel.characterTemplates);
    syncSelect2(panel.characterAdd);
    syncSelect2(panel.characterRemove);
}

function renderCompiledPreview(panel) {
    const compiled = buildCompiledBindings(panel.source);
    const compiledLorebooks = panel.currentCharacter
        ? (Object.prototype.hasOwnProperty.call(compiled.characters, panel.currentCharacter)
            ? compiled.characters[panel.currentCharacter]
            : compiled.global)
        : compiled.global;
    panel.compiledPreview.text(compiledLorebooks.length > 0 ? compiledLorebooks.join('\n') : '(No compiled hidden lorebooks)');
}

function renderPanel(panel) {
    renderTemplateEditor(panel);
    renderGlobalEditor(panel);
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
    const missingTemplates = response?.missingTemplates && typeof response.missingTemplates === 'object' ? response.missingTemplates : {};
    const missingCharacterCount = Object.keys(missingTemplates).filter(key => key !== 'global').length;
    let message = `Compiled global hidden lorebooks and ${compiledCharacterCount} character override${compiledCharacterCount === 1 ? '' : 's'}.`;

    if (Array.isArray(missingTemplates.global) && missingTemplates.global.length > 0) {
        message += ' Missing universal template references were ignored.';
    }

    if (missingCharacterCount > 0) {
        message += ` Missing template references were ignored for ${missingCharacterCount} character${missingCharacterCount === 1 ? '' : 's'}.`;
    }

    setPanelStatus(panel, message);
}

async function runHiddenTemplatesPanelRefresh({ quiet = false } = {}) {
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

        if (!quiet) {
            setPanelStatus(panel, 'Hidden lorebook template source loaded.');
        }
    } catch (error) {
        console.error('[Core Hidden Templates] Failed to refresh hidden lorebook template panel.', error);
        setPanelStatus(panel, `Failed to load hidden lorebook templates: ${error.message}`, true);
    } finally {
        setPanelBusy(panel, false);
        renderPanel(panel);
    }
}

async function maybeRunHiddenTemplatesPanelRefresh() {
    if (!hiddenTemplatesPanel || hiddenTemplatesPanelRefreshPromise || hiddenTemplatesPanel.busy || !hiddenTemplatesPanelRefreshPending) {
        return;
    }

    while (hiddenTemplatesPanel && hiddenTemplatesPanelRefreshPending && !hiddenTemplatesPanel.busy) {
        const quiet = hiddenTemplatesPanelRefreshPendingQuiet;
        hiddenTemplatesPanelRefreshPending = false;
        hiddenTemplatesPanelRefreshPendingQuiet = true;
        hiddenTemplatesPanelRefreshPromise = runHiddenTemplatesPanelRefresh({ quiet });

        try {
            await hiddenTemplatesPanelRefreshPromise;
        } finally {
            hiddenTemplatesPanelRefreshPromise = null;
        }
    }
}

async function refreshHiddenTemplatesPanel({ quiet = false } = {}) {
    if (!hiddenTemplatesPanel) {
        return;
    }

    hiddenTemplatesPanelRefreshPending = true;
    hiddenTemplatesPanelRefreshPendingQuiet &&= quiet;
    await maybeRunHiddenTemplatesPanelRefresh();
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
        if (panel.busy) {
            return;
        }

        setPanelBusy(panel, true);
        try {
            await saveSource(panel);
        } catch (error) {
            console.error('[Core Hidden Templates] Failed to save hidden lorebook template source.', error);
            setPanelStatus(panel, `Failed to save hidden lorebook template source: ${error.message}`, true);
        } finally {
            setPanelBusy(panel, false);
            renderPanel(panel);
        }
    });

    panel.compileButton.on('click', async () => {
        if (panel.busy) {
            return;
        }

        setPanelBusy(panel, true);
        try {
            await compileSource(panel);
        } catch (error) {
            console.error('[Core Hidden Templates] Failed to compile hidden lorebook templates.', error);
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
        renderCompiledPreview(panel);
    });

    panel.templateRemove.on('change', () => {
        if (!panel.currentTemplate) {
            return;
        }

        panel.source.templates[panel.currentTemplate] = {
            ...panel.source.templates[panel.currentTemplate],
            remove: getSelectedValues(panel.templateRemove),
        };
        renderCompiledPreview(panel);
    });

    panel.globalTemplates.on('change', () => {
        panel.source.global.templates = getSelectedValues(panel.globalTemplates);
        panel.source.global = normalizeAssignmentEntry(panel.source.global);
        renderCompiledPreview(panel);
    });

    panel.globalAdd.on('change', () => {
        panel.source.global.add = getSelectedValues(panel.globalAdd);
        panel.source.global = normalizeAssignmentEntry(panel.source.global);
        renderCompiledPreview(panel);
    });

    panel.globalRemove.on('change', () => {
        panel.source.global.remove = getSelectedValues(panel.globalRemove);
        panel.source.global = normalizeAssignmentEntry(panel.source.global);
        renderCompiledPreview(panel);
    });

    panel.characterTemplates.on('change', () => {
        if (!panel.currentCharacter) {
            return;
        }

        const entry = ensureCharacterEntry(panel, panel.currentCharacter);
        entry.templates = getSelectedValues(panel.characterTemplates);
        upsertCharacterEntry(panel, panel.currentCharacter, entry);
        renderCompiledPreview(panel);
    });

    panel.characterAdd.on('change', () => {
        if (!panel.currentCharacter) {
            return;
        }

        const entry = ensureCharacterEntry(panel, panel.currentCharacter);
        entry.add = getSelectedValues(panel.characterAdd);
        upsertCharacterEntry(panel, panel.currentCharacter, entry);
        renderCompiledPreview(panel);
    });

    panel.characterRemove.on('change', () => {
        if (!panel.currentCharacter) {
            return;
        }

        const entry = ensureCharacterEntry(panel, panel.currentCharacter);
        entry.remove = getSelectedValues(panel.characterRemove);
        upsertCharacterEntry(panel, panel.currentCharacter, entry);
        renderCompiledPreview(panel);
    });

    panel.templateCreate.on('click', async () => {
        if (panel.busy) {
            return;
        }

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
        if (panel.busy) {
            return;
        }

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

        panel.source.global.templates = normalizeStringArray(panel.source.global.templates.map(templateName => templateName === currentTemplateName ? nextTemplateName : templateName));

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
        if (panel.busy) {
            return;
        }

        if (!panel.currentTemplate) {
            return;
        }

        const currentTemplateName = panel.currentTemplate;
        const confirmed = await Popup.show.confirm('Delete Hidden Lorebook Template', `Delete template "${currentTemplateName}"? This removes the template assignment from any characters using it.`);
        if (!confirmed) {
            return;
        }

        delete panel.source.templates[currentTemplateName];
        panel.source.global.templates = panel.source.global.templates.filter(templateName => templateName !== currentTemplateName);

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

    const panelRoot = $(await renderTemplateAsync('hiddenLorebookTemplates'));
    $('#wi-holder').prepend(panelRoot);

    hiddenTemplatesPanel = {
        root: panelRoot,
        status: panelRoot.find('#core_hidden_templates_status'),
        refreshButton: panelRoot.find('#core_hidden_templates_refresh'),
        saveButton: panelRoot.find('#core_hidden_templates_save'),
        compileButton: panelRoot.find('#core_hidden_templates_compile'),
        templateCreate: panelRoot.find('#core_template_create'),
        templateRename: panelRoot.find('#core_template_rename'),
        templateDelete: panelRoot.find('#core_template_delete'),
        templateSelect: panelRoot.find('#core_template_select'),
        templateAdd: panelRoot.find('#core_template_add'),
        templateRemove: panelRoot.find('#core_template_remove'),
        globalTemplates: panelRoot.find('#core_global_templates'),
        globalAdd: panelRoot.find('#core_global_add'),
        globalRemove: panelRoot.find('#core_global_remove'),
        characterSelect: panelRoot.find('#core_character_select'),
        characterTemplates: panelRoot.find('#core_character_templates'),
        characterAdd: panelRoot.find('#core_character_add'),
        characterRemove: panelRoot.find('#core_character_remove'),
        compiledPreview: panelRoot.find('#core_compiled_preview'),
        source: { templates: {}, global: createEmptyAssignmentEntry(), characters: {} },
        availableCharacters: [],
        availableLorebooks: [],
        currentTemplate: '',
        currentCharacter: getCurrentCharacterKey(),
        busy: false,
    };

    initializeLorebookSelect2(hiddenTemplatesPanel);
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

export async function initializeHiddenTemplates() {
    if (!isAdmin()) {
        return;
    }

    bindPanelRefreshEvents();
    await ensureHiddenTemplatesPanel();
    await refreshHiddenTemplatesPanel();
}
