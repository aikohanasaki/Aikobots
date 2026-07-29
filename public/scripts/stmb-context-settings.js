import { t, translate } from './i18n.js';
import { DOMPurify } from '../lib.js';
import { Popup, POPUP_TYPE } from './popup.js';
import {
    deleteStmbContextSetting,
    duplicateStmbContextSetting,
    listStmbContextSettings,
    listStmbContextSourceEntries,
    resolveStmbContextSetting,
    upsertStmbContextSetting,
} from './stmb-api.js';
import { escapeHtml } from './utils.js';

export const STMB_CONTEXT_NONE_KEY = '__none__';
export const STMB_CONTEXT_FOLLOW_CHAT_VALUE = '__follow_chat__';
export const STMB_CONTEXT_SOURCE_MODES = Object.freeze({
    FOLLOW_CHAT: 'follow-chat',
    FIXED: 'fixed',
    NONE: 'none',
});

function cloneSetting(setting = {}) {
    return {
        key: String(setting?.key || '').trim(),
        name: String(setting?.name || '').trim(),
        entries: (Array.isArray(setting?.entries) ? setting.entries : []).map(entry => ({
            lorebookName: String(entry?.lorebookName || '').trim(),
            storage: entry?.storage === 'secure' ? 'secure' : 'user',
            uid: String(entry?.uid ?? '').trim(),
        })).filter(entry => entry.lorebookName && entry.uid),
    };
}

function buildContextSettingsHtml(settings = [], selectedChatKey = STMB_CONTEXT_NONE_KEY) {
    const settingOptions = settings.map(setting => (
        `<option value="${escapeHtml(setting.key)}">${escapeHtml(setting.name || setting.key)}</option>`
    )).join('');
    const chatOptions = [
        `<option value="${STMB_CONTEXT_NONE_KEY}" ${selectedChatKey === STMB_CONTEXT_NONE_KEY ? 'selected' : ''} data-i18n="None">None</option>`,
        ...settings.map(setting => (
            `<option value="${escapeHtml(setting.key)}" ${selectedChatKey === setting.key ? 'selected' : ''}>${escapeHtml(setting.name || setting.key)}</option>`
        )),
    ].join('');

    return `
        <div class="stmb-context-settings-popup" style="max-height:min(72vh, 900px); overflow-y:auto; padding-right:6px;">
            <h3 data-i18n="Additional Context">Additional Context</h3>
            <div class="world_entry_form_control">
                <label for="stmb-context-chat-select">
                    <h4 data-i18n="Additional Context for this chat">Additional Context for this chat</h4>
                    <select id="stmb-context-chat-select" class="text_pole">${chatOptions}</select>
                </label>
            </div>
            <div class="world_entry_form_control">
                <div class="flex-container flexGap5" style="align-items:flex-end; flex-wrap:wrap;">
                    <label style="flex:1 1 240px;" for="stmb-context-setting-select">
                        <h4 data-i18n="Context Settings">Context Settings</h4>
                        <select id="stmb-context-setting-select" class="text_pole">${settingOptions}</select>
                    </label>
                    <button id="stmb-context-new" class="menu_button" type="button" data-i18n="New">New</button>
                    <button id="stmb-context-duplicate" class="menu_button" type="button" data-i18n="Duplicate">Duplicate</button>
                    <button id="stmb-context-delete" class="menu_button" type="button" data-i18n="Delete">Delete</button>
                </div>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-context-name">
                    <h4 data-i18n="Name">Name</h4>
                    <input id="stmb-context-name" class="text_pole" placeholder="Context setting name" data-i18n="[placeholder]Context setting name">
                </label>
            </div>
            <div class="world_entry_form_control">
                <div class="flex-container flexGap5" style="align-items:flex-end; flex-wrap:wrap;">
                    <label style="flex:1 1 320px;" for="stmb-context-source-entry">
                        <h4 data-i18n="Add owned lorebook entry">Add owned lorebook entry</h4>
                        <select id="stmb-context-source-entry" class="text_pole"></select>
                    </label>
                    <button id="stmb-context-add-entry" class="menu_button" type="button" data-i18n="Add">Add</button>
                </div>
            </div>
            <div class="world_entry_form_control">
                <h4 data-i18n="Selected Entries">Selected Entries</h4>
                <div id="stmb-context-entry-list"></div>
            </div>
            <div class="world_entry_form_control">
                <button id="stmb-context-save" class="menu_button" type="button" data-i18n="Save Context Setting">Save Context Setting</button>
                <small id="stmb-context-status" class="opacity70p" style="margin-left:8px;"></small>
            </div>
        </div>
    `;
}

function entryMatches(left, right) {
    return left?.lorebookName === right?.lorebookName
        && left?.storage === right?.storage
        && String(left?.uid) === String(right?.uid);
}

function renderSourceOptions(dialog, sourceEntries = [], selectedEntries = []) {
    const select = dialog?.querySelector('#stmb-context-source-entry');
    if (!select) return;

    const options = sourceEntries.map((entry, index) => {
        const disabled = selectedEntries.some(selected => entryMatches(selected, entry));
        const storageLabel = entry.storage === 'secure' ? 'secure' : 'user';
        return `<option value="${index}" ${disabled ? 'disabled' : ''}>${escapeHtml(entry.lorebookName)} [${storageLabel}] - ${escapeHtml(entry.title || `Entry ${entry.uid}`)}</option>`;
    });
    select.innerHTML = options.length > 0
        ? options.join('')
        : '<option value="" data-i18n="No owned lorebook entries available">No owned lorebook entries available</option>';
}

function renderSelectedEntries(dialog, sourceEntries = [], selectedEntries = [], onChange = () => {}) {
    const container = dialog?.querySelector('#stmb-context-entry-list');
    if (!container) return;

    if (selectedEntries.length === 0) {
        container.innerHTML = '<div class="opacity70p" data-i18n="No entries selected.">No entries selected.</div>';
        renderSourceOptions(dialog, sourceEntries, selectedEntries);
        return;
    }

    container.innerHTML = selectedEntries.map((entry, index) => {
        const source = sourceEntries.find(candidate => entryMatches(candidate, entry));
        const title = source?.title || `Entry ${entry.uid}`;
        const storageLabel = entry.storage === 'secure' ? 'secure' : 'user';
        const staleLabel = source ? '' : ' <small class="warning" data-i18n="stale or no longer owned">stale or no longer owned</small>';
        return `
            <div class="flex-container flexGap5" data-index="${index}" style="align-items:center; margin:4px 0;">
                <button type="button" class="menu_button stmb-context-entry-up" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="menu_button stmb-context-entry-down" ${index === selectedEntries.length - 1 ? 'disabled' : ''}>↓</button>
                <div style="flex:1 1 auto; min-width:0;">
                    <strong>${escapeHtml(title)}</strong>
                    <small class="opacity70p"> ${escapeHtml(entry.lorebookName)} [${storageLabel}] #${escapeHtml(entry.uid)}</small>${staleLabel}
                </div>
                <button type="button" class="menu_button stmb-context-entry-remove" data-i18n="Remove">Remove</button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.stmb-context-entry-up').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.closest('[data-index]')?.dataset?.index);
        if (Number.isInteger(index) && index > 0) {
            [selectedEntries[index - 1], selectedEntries[index]] = [selectedEntries[index], selectedEntries[index - 1]];
            onChange();
        }
    }));
    container.querySelectorAll('.stmb-context-entry-down').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.closest('[data-index]')?.dataset?.index);
        if (Number.isInteger(index) && index < selectedEntries.length - 1) {
            [selectedEntries[index], selectedEntries[index + 1]] = [selectedEntries[index + 1], selectedEntries[index]];
            onChange();
        }
    }));
    container.querySelectorAll('.stmb-context-entry-remove').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.closest('[data-index]')?.dataset?.index);
        if (Number.isInteger(index)) {
            selectedEntries.splice(index, 1);
            onChange();
        }
    }));
    renderSourceOptions(dialog, sourceEntries, selectedEntries);
}

function setStatus(dialog, message = '') {
    const status = dialog?.querySelector('#stmb-context-status');
    if (status) {
        status.textContent = message;
    }
}

export async function resolveAdditionalContextEntriesForKey(key, options = {}) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || normalizedKey === STMB_CONTEXT_NONE_KEY) {
        return [];
    }

    const result = await resolveStmbContextSetting(normalizedKey);
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    if (warnings.length > 0 && options.notify !== false) {
        toastr.warning(t`${warnings.length} Additional Context reference(s) were skipped.`, 'STMB');
        console.warn('[STMB] Additional Context references skipped', warnings);
    }
    return Array.isArray(result?.entries) ? result.entries : [];
}

export function buildAdditionalContextSourceOptionsHtml(contextSettings = [], selectedConfig = {}) {
    const config = selectedConfig && typeof selectedConfig === 'object' ? selectedConfig : {};
    const mode = Object.values(STMB_CONTEXT_SOURCE_MODES).includes(config.mode) ? config.mode : STMB_CONTEXT_SOURCE_MODES.NONE;
    const fixedKey = mode === STMB_CONTEXT_SOURCE_MODES.FIXED ? String(config.contextSettingKey || '').trim() : '';
    return [
        `<option value="${STMB_CONTEXT_FOLLOW_CHAT_VALUE}" ${mode === STMB_CONTEXT_SOURCE_MODES.FOLLOW_CHAT ? 'selected' : ''} data-i18n="Follow chat">Follow chat</option>`,
        `<option value="${STMB_CONTEXT_NONE_KEY}" ${mode === STMB_CONTEXT_SOURCE_MODES.NONE ? 'selected' : ''} data-i18n="None">None</option>`,
        ...contextSettings.map(setting => (
            `<option value="${escapeHtml(setting.key)}" ${fixedKey === setting.key ? 'selected' : ''}>${escapeHtml(setting.name || setting.key)}</option>`
        )),
    ].join('');
}

export function readAdditionalContextSourceSetting(select) {
    const value = String(select?.value || STMB_CONTEXT_NONE_KEY).trim();
    if (value === STMB_CONTEXT_NONE_KEY) {
        return { mode: STMB_CONTEXT_SOURCE_MODES.NONE };
    }
    if (value === STMB_CONTEXT_FOLLOW_CHAT_VALUE) {
        return { mode: STMB_CONTEXT_SOURCE_MODES.FOLLOW_CHAT };
    }
    return {
        mode: STMB_CONTEXT_SOURCE_MODES.FIXED,
        contextSettingKey: value,
    };
}

export async function showStmbContextSettingsPopup({ selectedKey = STMB_CONTEXT_NONE_KEY, onSelectedKeyChange = null } = {}) {
    let settings = (await listStmbContextSettings()).settings || [];
    const sourceEntries = (await listStmbContextSourceEntries()).entries || [];
    let current = cloneSetting(settings[0] || {});
    let selectedEntries = current.entries;

    const popup = new Popup(DOMPurify.sanitize(buildContextSettingsHtml(settings, selectedKey || STMB_CONTEXT_NONE_KEY)), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: translate('Close'),
        wide: true,
        large: true,
        allowVerticalScrolling: false,
    });

    let renderEntries = () => {};
    const selectSetting = key => {
        current = cloneSetting(settings.find(setting => setting.key === key) || {});
        selectedEntries = current.entries;
        const nameInput = popup.dlg?.querySelector('#stmb-context-name');
        if (nameInput) nameInput.value = current.name || '';
        renderEntries();
    };

    const refreshSettingSelect = preferredKey => {
        const settingSelect = popup.dlg?.querySelector('#stmb-context-setting-select');
        if (settingSelect) {
            settingSelect.innerHTML = settings.map(setting => (
                `<option value="${escapeHtml(setting.key)}">${escapeHtml(setting.name || setting.key)}</option>`
            )).join('');
            settingSelect.value = preferredKey && settings.some(setting => setting.key === preferredKey)
                ? preferredKey
                : (settings[0]?.key || '');
        }
        const chatSelect = popup.dlg?.querySelector('#stmb-context-chat-select');
        if (chatSelect) {
            const chatValue = String(chatSelect.value || selectedKey || STMB_CONTEXT_NONE_KEY);
            chatSelect.innerHTML = [
                `<option value="${STMB_CONTEXT_NONE_KEY}" data-i18n="None">None</option>`,
                ...settings.map(setting => (
                    `<option value="${escapeHtml(setting.key)}">${escapeHtml(setting.name || setting.key)}</option>`
                )),
            ].join('');
            chatSelect.value = settings.some(setting => setting.key === chatValue) ? chatValue : STMB_CONTEXT_NONE_KEY;
        }
        selectSetting(settingSelect?.value || '');
    };

    renderEntries = () => renderSelectedEntries(popup.dlg, sourceEntries, selectedEntries, renderEntries);
    const settingSelect = popup.dlg?.querySelector('#stmb-context-setting-select');
    settingSelect?.addEventListener('change', () => selectSetting(settingSelect.value));
    popup.dlg?.querySelector('#stmb-context-chat-select')?.addEventListener('change', event => {
        onSelectedKeyChange?.(String(event.target?.value || STMB_CONTEXT_NONE_KEY));
    });
    popup.dlg?.querySelector('#stmb-context-new')?.addEventListener('click', () => {
        current = cloneSetting({ name: 'New Context Setting', entries: [] });
        selectedEntries = current.entries;
        const nameInput = popup.dlg?.querySelector('#stmb-context-name');
        if (nameInput) nameInput.value = current.name;
        renderEntries();
        setStatus(popup.dlg, 'Editing new setting.');
    });
    popup.dlg?.querySelector('#stmb-context-duplicate')?.addEventListener('click', async () => {
        if (!current.key) return;
        const result = await duplicateStmbContextSetting(current.key);
        settings = (await listStmbContextSettings()).settings || [];
        refreshSettingSelect(result?.key);
        setStatus(popup.dlg, 'Duplicated.');
    });
    popup.dlg?.querySelector('#stmb-context-delete')?.addEventListener('click', async () => {
        if (!current.key || !confirm('Delete this context setting?')) return;
        await deleteStmbContextSetting(current.key);
        settings = (await listStmbContextSettings()).settings || [];
        const chatSelect = popup.dlg?.querySelector('#stmb-context-chat-select');
        if (chatSelect?.value === current.key) {
            chatSelect.value = STMB_CONTEXT_NONE_KEY;
            onSelectedKeyChange?.(STMB_CONTEXT_NONE_KEY);
        }
        refreshSettingSelect(settings[0]?.key || '');
        setStatus(popup.dlg, 'Deleted.');
    });
    popup.dlg?.querySelector('#stmb-context-add-entry')?.addEventListener('click', () => {
        const sourceSelect = popup.dlg?.querySelector('#stmb-context-source-entry');
        const source = sourceEntries[Number(sourceSelect?.value)];
        if (!source) return;
        selectedEntries.push({
            lorebookName: source.lorebookName,
            storage: source.storage === 'secure' ? 'secure' : 'user',
            uid: String(source.uid),
        });
        renderEntries();
    });
    popup.dlg?.querySelector('#stmb-context-save')?.addEventListener('click', async () => {
        const name = String(popup.dlg?.querySelector('#stmb-context-name')?.value || '').trim();
        const result = await upsertStmbContextSetting({
            key: current.key || undefined,
            name: name || current.name || 'Untitled Context Setting',
            entries: selectedEntries,
        });
        settings = (await listStmbContextSettings()).settings || [];
        refreshSettingSelect(result?.key);
        setStatus(popup.dlg, 'Saved.');
    });

    refreshSettingSelect(settings[0]?.key || '');
    await popup.show();
}
