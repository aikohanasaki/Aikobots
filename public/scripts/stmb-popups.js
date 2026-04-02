import {
    DOMPurify,
} from '../lib.js';
import { playMessageSound } from './power-user.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { parseSummaryJsonResponse } from './stmb-summary.js';
import { escapeHtml } from './utils.js';

const STMB_POPUP_RESULTS = Object.freeze({
    ADVANCED: POPUP_RESULT.CUSTOM1,
    SAVE_PROFILE: POPUP_RESULT.CUSTOM2,
    RETRY: POPUP_RESULT.CUSTOM4,
});
const activePreviewPopups = new Set();

function safePlayMessageSound() {
    try {
        playMessageSound();
    } catch (error) {
        console.warn('STMB popup sound failed', error);
    }
}

function keywordsToString(keywords) {
    if (Array.isArray(keywords)) {
        return keywords
            .map(keyword => String(keyword || '').trim())
            .filter(Boolean)
            .join(', ');
    }

    return String(keywords || '').trim();
}

function parseKeywords(keywordText) {
    return String(keywordText || '')
        .split(/[,\n]+/)
        .map(keyword => keyword.trim())
        .filter(Boolean);
}

function renderProfileOptions(profiles = [], selectedIndex = 0) {
    return profiles.map((profile, index) => `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(String(profile?.name || `Profile ${index + 1}`))}</option>`).join('');
}

function applyProfileDisplay(dialog, profiles, profileIndex, { editablePrompt = false } = {}) {
    const profile = profiles[profileIndex] || profiles[0] || {};
    const promptText = String(profile?.effectivePrompt || '').trim();
    const modelText = String(profile?.profileModel || 'Current SillyTavern model');
    const temperatureText = String(profile?.profileTemperature ?? 'Current SillyTavern temperature');

    const promptEl = dialog.querySelector(editablePrompt ? '#stmb-advanced-prompt' : '#stmb-confirm-prompt');
    if (promptEl) {
        if (editablePrompt) promptEl.value = promptText;
        else promptEl.textContent = promptText || '(none)';
    }

    const modelEl = dialog.querySelector(editablePrompt ? '#stmb-advanced-profile-model' : '#stmb-confirm-profile-model');
    if (modelEl) modelEl.textContent = modelText;
    const tempEl = dialog.querySelector(editablePrompt ? '#stmb-advanced-profile-temp' : '#stmb-confirm-profile-temp');
    if (tempEl) tempEl.textContent = String(temperatureText);
}

export async function showAutoSummaryDecisionPopup() {
    const html = `
        <div class="stmb-auto-summary-popup">
            <h4>Auto-Summary Ready</h4>
            <div class="world_entry_form_control">
                <p>Auto-summary is enabled but there is no assigned lorebook for this chat.</p>
                <p>Would you like to select a lorebook for memory storage, or postpone this auto-summary?</p>
                <label for="stmb-postpone-messages">Postpone for how many messages?</label>
                <select id="stmb-postpone-messages" class="text_pole" style="width:100%">
                    <option value="10">10 messages</option>
                    <option value="20">20 messages</option>
                    <option value="30">30 messages</option>
                    <option value="40">40 messages</option>
                    <option value="50">50 messages</option>
                </select>
            </div>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Select Lorebook',
        cancelButton: 'Postpone',
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    const postponeMessages = Number(popup.dlg?.querySelector('#stmb-postpone-messages')?.value ?? 10);

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        return { action: 'select', postponeMessages };
    }

    return {
        action: 'postpone',
        postponeMessages: Number.isFinite(postponeMessages) ? postponeMessages : 10,
    };
}

export async function showLorebookPickerPopup(lorebookNames = [], options = {}) {
    const items = Array.isArray(lorebookNames)
        ? lorebookNames.map(name => String(name || '').trim()).filter(Boolean)
        : [];

    const html = `
        <div class="stmb-lorebook-picker-popup">
            <h4>${escapeHtml(String(options?.title || 'Select Lorebook'))}</h4>
            <div class="world_entry_form_control">
                ${items.length > 0
                    ? `
                        <label for="stmb-lorebook-picker">Lorebook</label>
                        <select id="stmb-lorebook-picker" class="text_pole" style="width:100%">
                            ${items.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
                        </select>
                    `
                    : `<div class="opacity70p">${escapeHtml(String(options?.emptyMessage || 'No existing lorebooks are available.'))}</div>`
                }
            </div>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Select',
        cancelButton: 'Cancel',
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE || items.length === 0) {
        return null;
    }

    return String(popup.dlg?.querySelector('#stmb-lorebook-picker')?.value || '').trim() || null;
}

export async function showAutoConsolidationPromptPopup(data = {}) {
    const html = `
        <div class="stmb-auto-consolidation-popup">
            <h3>Consolidation Available</h3>
            <p>You now have ${escapeHtml(String(data?.eligibleCount ?? 0))} eligible ${escapeHtml(String(data?.sourcePlural || 'entries'))}. That meets the minimum of ${escapeHtml(String(data?.requiredMin ?? 0))} needed to create a ${escapeHtml(String(data?.targetLabel || 'summary'))}.</p>
            <p class="opacity70p">Open Consolidate Memories now?</p>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Open Consolidation',
        cancelButton: 'Later',
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    return result === POPUP_RESULT.AFFIRMATIVE;
}

export async function showSummaryConsolidationOptionsPopup(data = {}) {
    const targetTier = Number(data?.initialTargetTier ?? 1);
    const tierOptions = Array.isArray(data?.tierOptions) ? data.tierOptions : [];
    const presets = Array.isArray(data?.presets) ? data.presets : [];
    const html = `
        <div class="stmb-summary-consolidation-popup">
            <h3>Consolidate Memories</h3>
            <div class="world_entry_form_control">
                <label for="stmb-summary-tier">Summary Tier</label>
                <select id="stmb-summary-tier" class="text_pole" style="width:100%">
                    ${tierOptions.map(option => `<option value="${escapeHtml(String(option.value))}" ${Number(option.value) === targetTier ? 'selected' : ''}>${escapeHtml(String(option.label))}</option>`).join('')}
                </select>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-summary-preset">Preset</label>
                <select id="stmb-summary-preset" class="text_pole" style="width:100%">
                    ${presets.map(option => `<option value="${escapeHtml(String(option.value))}" ${String(option.value) === String(data?.defaultPresetKey || 'arc_default') ? 'selected' : ''}>${escapeHtml(String(option.label))}</option>`).join('')}
                </select>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-summary-required-min">Minimum eligible source entries</label>
                <input id="stmb-summary-required-min" type="number" min="1" step="1" class="text_pole" style="width:100%" value="${escapeHtml(String(data?.requiredMin ?? 5))}">
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label">
                    <input id="stmb-summary-disable-originals" type="checkbox" ${data?.disableOriginals !== false ? 'checked' : ''}>
                    <span>Disable selected source entries after creating summaries</span>
                </label>
            </div>
            <div class="world_entry_form_control opacity70p">
                <div id="stmb-summary-candidate-count">${escapeHtml(String(data?.candidateInfo || ''))}</div>
            </div>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Run',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return { action: 'cancel' };
    }

    return {
        action: 'run',
        targetTier: Number(popup.dlg?.querySelector('#stmb-summary-tier')?.value ?? targetTier),
        presetKey: String(popup.dlg?.querySelector('#stmb-summary-preset')?.value || data?.defaultPresetKey || 'arc_default'),
        requiredMin: Number(popup.dlg?.querySelector('#stmb-summary-required-min')?.value ?? data?.requiredMin ?? 5),
        disableOriginals: Boolean(popup.dlg?.querySelector('#stmb-summary-disable-originals')?.checked),
    };
}

export async function showConfirmationPopup(data) {
    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    const selectedIndex = Number.isInteger(data?.selectedProfileIndex) ? data.selectedProfileIndex : 0;
    const html = `
        <div class="stmb-confirm-popup">
            <h3>Create Memory</h3>
            <div class="world_entry_form_control opacity70p">
                <div>Scene: ${escapeHtml(String(data?.sceneStart ?? '?'))}-${escapeHtml(String(data?.sceneEnd ?? '?'))}</div>
                <div>Messages: ${escapeHtml(String(data?.messageCount ?? '?'))}</div>
                <div>Estimated tokens: ${escapeHtml(String(data?.estimatedTokens ?? '?'))}</div>
            </div>
            ${data?.showWarning ? `<div class="world_entry_form_control"><strong>Warning:</strong> Large scene exceeds the warning threshold of ${escapeHtml(String(data?.tokenThreshold ?? '?'))} tokens.</div>` : ''}
            <div class="world_entry_form_control">
                <label for="stmb-confirm-profile-select">Profile</label>
                <select id="stmb-confirm-profile-select" class="text_pole" style="width:100%">
                    ${renderProfileOptions(profiles, selectedIndex)}
                </select>
            </div>
            <div class="world_entry_form_control opacity70p">
                <div>Profile model: <span id="stmb-confirm-profile-model"></span></div>
                <div>Profile temperature: <span id="stmb-confirm-profile-temp"></span></div>
                <div>Current UI provider: ${escapeHtml(String(data?.currentApi || 'Unknown'))}</div>
                <div>Current UI model: ${escapeHtml(String(data?.currentModel || 'Unknown'))}</div>
                <div>Current UI temperature: ${escapeHtml(String(data?.currentTemperature ?? 0.7))}</div>
            </div>
            <div class="world_entry_form_control">
                <label>Effective prompt</label>
                <pre id="stmb-confirm-prompt" class="text_pole" style="white-space:pre-wrap; max-height:220px; overflow:auto;"></pre>
            </div>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Create Memory',
        cancelButton: 'Cancel',
        allowVerticalScrolling: true,
        customButtons: [
            {
                text: 'Advanced Options...',
                result: STMB_POPUP_RESULTS.ADVANCED,
                classes: ['menu_button', 'whitespacenowrap'],
            },
        ],
    });

    const dialog = popup.dlg;
    const profileSelect = dialog.querySelector('#stmb-confirm-profile-select');
    const updateSelectedProfile = () => applyProfileDisplay(dialog, profiles, Number(profileSelect?.value ?? selectedIndex), { editablePrompt: false });
    profileSelect?.addEventListener('change', updateSelectedProfile);
    updateSelectedProfile();

    const result = await popup.show();
    if (result === STMB_POPUP_RESULTS.ADVANCED) {
        return {
            action: 'advanced',
            profileIndex: Number(profileSelect?.value ?? selectedIndex),
        };
    }
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return { action: 'cancel' };
    }

    return {
        action: 'confirm',
        profileIndex: Number(profileSelect?.value ?? selectedIndex),
    };
}

export async function showAdvancedOptionsPopup(data) {
    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    const selectedIndex = Number.isInteger(data?.selectedProfileIndex) ? data.selectedProfileIndex : 0;
    const html = `
        <div class="stmb-advanced-popup">
            <h3>Advanced Options</h3>
            <div class="world_entry_form_control opacity70p">
                <div>Scene: ${escapeHtml(String(data?.sceneStart ?? '?'))}-${escapeHtml(String(data?.sceneEnd ?? '?'))}</div>
                <div>Messages: ${escapeHtml(String(data?.messageCount ?? '?'))}</div>
                <div>Available memories: ${escapeHtml(String(data?.availableMemories ?? 0))}</div>
                <div>Estimated tokens: ${escapeHtml(String(data?.estimatedTokens ?? '?'))}</div>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-advanced-profile-select">Profile</label>
                <select id="stmb-advanced-profile-select" class="text_pole" style="width:100%">
                    ${renderProfileOptions(profiles, selectedIndex)}
                </select>
            </div>
            <div class="world_entry_form_control opacity70p">
                <div>Profile model: <span id="stmb-advanced-profile-model"></span></div>
                <div>Profile temperature: <span id="stmb-advanced-profile-temp"></span></div>
                <div>Current UI provider: ${escapeHtml(String(data?.currentApi || 'Unknown'))}</div>
                <div>Current UI model: ${escapeHtml(String(data?.currentModel || 'Unknown'))}</div>
                <div>Current UI temperature: ${escapeHtml(String(data?.currentTemperature ?? 0.7))}</div>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-advanced-prompt">Effective prompt</label>
                <textarea id="stmb-advanced-prompt" class="text_pole" style="width:100%; min-height:220px; white-space:pre-wrap;"></textarea>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-advanced-memory-count">Context memories</label>
                <input id="stmb-advanced-memory-count" type="number" min="0" max="7" step="1" class="text_pole" style="width:100%" value="${escapeHtml(String(data?.defaultMemoryCount ?? 0))}">
            </div>
            <div class="world_entry_form_control">
                <label class="checkbox_label">
                    <input id="stmb-advanced-override-settings" type="checkbox" ${data?.overrideSettings ? 'checked' : ''}>
                    <span>Use current SillyTavern model/provider settings for this run</span>
                </label>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-advanced-profile-name">New profile name</label>
                <input id="stmb-advanced-profile-name" class="text_pole" style="width:100%" value="${escapeHtml(String(data?.suggestedProfileName || ''))}">
            </div>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Create Memory',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onClosing: popupInstance => {
            const dialog = popupInstance?.dlg;
            if (!dialog) return true;

            if (popupInstance.result === STMB_POPUP_RESULTS.SAVE_PROFILE) {
                const profileName = String(dialog.querySelector('#stmb-advanced-profile-name')?.value || '').trim();
                if (!profileName) {
                    toastr.error('Please enter a profile name', 'STMB');
                    return false;
                }
            }

            if (popupInstance.result === POPUP_RESULT.AFFIRMATIVE) {
                const promptText = String(dialog.querySelector('#stmb-advanced-prompt')?.value || '').trim();
                if (!promptText) {
                    toastr.error('Prompt cannot be empty', 'STMB');
                    return false;
                }
                const shouldSave = dialog.querySelector('.popup_button_ok')?.dataset.shouldSave === 'true';
                if (shouldSave) {
                    const profileName = String(dialog.querySelector('#stmb-advanced-profile-name')?.value || '').trim();
                    if (!profileName) {
                        toastr.error('Please enter a profile name or use "Create Memory" to proceed without saving', 'STMB');
                        return false;
                    }
                }
            }

            return true;
        },
        customButtons: [
            {
                text: 'Save as New Profile',
                result: STMB_POPUP_RESULTS.SAVE_PROFILE,
                classes: ['menu_button', 'whitespacenowrap'],
            },
        ],
    });

    const dialog = popup.dlg;
    const profileSelect = dialog.querySelector('#stmb-advanced-profile-select');
    const originalSettings = {
        profileIndex: Number(profileSelect?.value ?? selectedIndex),
        promptText: String(profiles[selectedIndex]?.effectivePrompt || ''),
        memoryCount: Number(data?.defaultMemoryCount ?? 0),
        overrideSettings: Boolean(data?.overrideSettings),
    };
    const updateSelectedProfile = (updateBaseline = false) => {
        const nextProfileIndex = Number(profileSelect?.value ?? selectedIndex);
        applyProfileDisplay(dialog, profiles, nextProfileIndex, { editablePrompt: true });
        if (updateBaseline) {
            originalSettings.profileIndex = nextProfileIndex;
            originalSettings.promptText = String(profiles[nextProfileIndex]?.effectivePrompt || '');
        }
    };
    updateSelectedProfile();

    const createButton = dialog.querySelector('.popup_button_ok');
    const updateCreateButtonState = () => {
        const currentProfileIndex = Number(profileSelect?.value ?? selectedIndex);
        const currentPrompt = String(dialog.querySelector('#stmb-advanced-prompt')?.value || '');
        const currentMemoryCount = Number(dialog.querySelector('#stmb-advanced-memory-count')?.value ?? data?.defaultMemoryCount ?? 0);
        const currentOverride = Boolean(dialog.querySelector('#stmb-advanced-override-settings')?.checked);
        const hasChanges = currentProfileIndex !== originalSettings.profileIndex
            || currentPrompt !== originalSettings.promptText
            || currentMemoryCount !== originalSettings.memoryCount
            || currentOverride !== originalSettings.overrideSettings;

        if (!createButton) {
            return;
        }

        if (hasChanges) {
            createButton.textContent = 'Save Profile & Create Memory';
            createButton.title = 'Save the modified settings as a new profile and create the memory';
            createButton.dataset.shouldSave = 'true';
        } else {
            createButton.textContent = 'Create Memory';
            createButton.title = 'Create memory using the selected profile settings';
            createButton.dataset.shouldSave = 'false';
        }
    };

    profileSelect?.addEventListener('change', () => {
        updateSelectedProfile(true);
        updateCreateButtonState();
    });
    dialog.querySelector('#stmb-advanced-prompt')?.addEventListener('input', updateCreateButtonState);
    dialog.querySelector('#stmb-advanced-memory-count')?.addEventListener('input', updateCreateButtonState);
    dialog.querySelector('#stmb-advanced-override-settings')?.addEventListener('change', updateCreateButtonState);
    updateCreateButtonState();

    const buildResult = action => ({
        action,
        profileIndex: Number(profileSelect?.value ?? selectedIndex),
        promptText: String(dialog.querySelector('#stmb-advanced-prompt')?.value || ''),
        memoryCount: Number(dialog.querySelector('#stmb-advanced-memory-count')?.value ?? data?.defaultMemoryCount ?? 0),
        overrideSettings: Boolean(dialog.querySelector('#stmb-advanced-override-settings')?.checked),
        newProfileName: String(dialog.querySelector('#stmb-advanced-profile-name')?.value || '').trim(),
    });

    const result = await popup.show();
    if (result === STMB_POPUP_RESULTS.SAVE_PROFILE) {
        return buildResult('save_profile');
    }
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return { action: 'cancel' };
    }

    return buildResult(createButton?.dataset.shouldSave === 'true' ? 'save_and_confirm' : 'confirm');
}

export async function showMemoryPreviewPopup(memoryResult, sceneData, profileSettings, options = {}) {
    if (!memoryResult || typeof memoryResult !== 'object') {
        return { action: 'cancel' };
    }

    const title = String(
        memoryResult.extractedTitle
        ?? memoryResult.title
        ?? 'Memory',
    ).trim() || 'Memory';
    const content = String(
        memoryResult.content
        ?? memoryResult.summary
        ?? '',
    ).trim();
    const keywordsText = keywordsToString(
        memoryResult.suggestedKeys
        ?? memoryResult.keywords
        ?? [],
    );

    const html = `
        <div class="stmb-preview-popup">
            <h3>Review Memory</h3>
            <div class="world_entry_form_control opacity70p">
                <div>Profile: ${escapeHtml(String(profileSettings?.name || 'Current SillyTavern Settings'))}</div>
                <div>Scene: ${escapeHtml(String(sceneData?.sceneStart ?? '?'))}-${escapeHtml(String(sceneData?.sceneEnd ?? '?'))}</div>
                <div>Messages: ${escapeHtml(String(sceneData?.messageCount ?? '?'))}</div>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-preview-title">Title</label>
                <input id="stmb-preview-title" class="text_pole" style="width:100%" value="${escapeHtml(title)}" ${options.lockTitle ? 'readonly' : ''}>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-preview-content">Content</label>
                <textarea id="stmb-preview-content" class="text_pole" style="width:100%; min-height:220px; white-space:pre-wrap;">${escapeHtml(content)}</textarea>
            </div>
            <div class="world_entry_form_control">
                <label for="stmb-preview-keywords">Keywords</label>
                <textarea id="stmb-preview-keywords" class="text_pole" style="width:100%; min-height:90px; white-space:pre-wrap;">${escapeHtml(keywordsText)}</textarea>
            </div>
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        okButton: 'Edit & Save',
        cancelButton: 'Cancel',
        wide: true,
        allowVerticalScrolling: true,
        onClosing: popupInstance => {
            if (popupInstance.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            const titleValue = String(popupInstance.dlg.querySelector('#stmb-preview-title')?.value || '').trim();
            const contentValue = String(popupInstance.dlg.querySelector('#stmb-preview-content')?.value || '').trim();
            if (!contentValue) {
                toastr.error('Memory content cannot be empty', 'STMB');
                return false;
            }
            if (!options.lockTitle && !titleValue) {
                toastr.error('Memory title cannot be empty', 'STMB');
                return false;
            }
            return true;
        },
        customButtons: [
            {
                text: 'Retry Generation',
                result: STMB_POPUP_RESULTS.RETRY,
                classes: ['menu_button', 'whitespacenowrap'],
            },
        ],
    });

    activePreviewPopups.add(popup);
    try {
        const result = await popup.show();
        if (result === STMB_POPUP_RESULTS.RETRY) {
            return { action: 'retry' };
        }
        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            return { action: 'cancel' };
        }

        const titleValue = String(popup.dlg.querySelector('#stmb-preview-title')?.value || '').trim();
        const contentValue = String(popup.dlg.querySelector('#stmb-preview-content')?.value || '').trim();
        const keywordsValue = String(popup.dlg.querySelector('#stmb-preview-keywords')?.value || '').trim();

        return {
            action: 'edit',
            memoryData: {
                ...memoryResult,
                extractedTitle: options.lockTitle ? title : titleValue,
                title: options.lockTitle ? title : titleValue,
                content: contentValue,
                suggestedKeys: parseKeywords(keywordsValue),
                keywords: parseKeywords(keywordsValue),
            },
        };
    } finally {
        activePreviewPopups.delete(popup);
    }
}

export function closeActiveMemoryPreviewPopups() {
    for (const popup of Array.from(activePreviewPopups)) {
        try {
            popup.completeCancelled();
        } catch (error) {
            console.warn('STMB failed to close preview popup', error);
        }
    }
}

export function showFailedAIResponsePopup(error, { onApply } = {}) {
    const rawResponse = typeof error?.rawResponse === 'string' ? error.rawResponse : '';
    const providerBody = typeof error?.providerBody === 'string' ? error.providerBody : '';
    const code = String(error?.code || '').trim();
    const message = String(error?.message || 'Unknown error').trim();
    const canApply = rawResponse && typeof onApply === 'function';

    const html = `
        <div class="stmb-failed-response-popup">
            <h3>Review Failed AI Response</h3>
            <div class="world_entry_form_control">
                <div><strong>Error:</strong> ${escapeHtml(message)}</div>
                ${code ? `<div><strong>Code:</strong> ${escapeHtml(code)}</div>` : ''}
            </div>
            ${rawResponse ? `
                <div class="world_entry_form_control">
                    <h4>Raw AI Response</h4>
                    <textarea id="stmb-corrected-raw" class="text_pole" style="width:100%; min-height:220px; max-height:360px; white-space:pre; overflow:auto;">${escapeHtml(rawResponse)}</textarea>
                    <div class="buttons_block gap10px">
                        <button id="stmb-copy-raw" class="menu_button">Copy Raw</button>
                        <button id="stmb-apply-corrected-raw" class="menu_button" ${canApply ? '' : 'disabled'}>Create Memory from corrected JSON</button>
                    </div>
                    ${canApply ? '' : '<div class="opacity70p">Unable to apply corrected JSON because the original generation context is missing.</div>'}
                </div>
            ` : '<div class="world_entry_form_control opacity70p">No raw response was captured.</div>'}
            ${providerBody ? `
                <div class="world_entry_form_control">
                    <h4>Provider Error Body</h4>
                    <pre class="text_pole" style="white-space:pre-wrap; max-height:200px; overflow:auto;"><code>${escapeHtml(providerBody)}</code></pre>
                    <div class="buttons_block gap10px">
                        <button id="stmb-copy-provider" class="menu_button">Copy Provider Body</button>
                    </div>
                </div>
            ` : ''}
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: 'Close',
    });

    const dlg = popup.dlg;
    dlg.querySelector('#stmb-copy-raw')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(rawResponse);
            toastr.success('Copied raw response', 'STMB');
        } catch {
            toastr.error('Copy failed', 'STMB');
        }
    });
    dlg.querySelector('#stmb-copy-provider')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(providerBody);
            toastr.success('Copied provider body', 'STMB');
        } catch {
            toastr.error('Copy failed', 'STMB');
        }
    });
    dlg.querySelector('#stmb-apply-corrected-raw')?.addEventListener('click', async () => {
        const correctedRaw = String(dlg.querySelector('#stmb-corrected-raw')?.value ?? rawResponse);
        if (!canApply) {
            return;
        }

        try {
            const applied = await onApply(correctedRaw);
            if (!applied) {
                return;
            }
            toastr.success('Memory created from corrected JSON', 'STMB');
            await popup.completeCancelled();
        } catch (applyError) {
            console.error('STMB manual memory repair failed', applyError);
            toastr.error(String(applyError?.message || 'Failed to create memory from corrected JSON'), 'STMB');
        }
    });

    void popup.show();
}

function splitKeywords(keywordText) {
    return String(keywordText || '')
        .split(/[,\n]+/)
        .map(keyword => keyword.trim())
        .filter(Boolean);
}

function extractSummaryFieldsFromText(raw) {
    const text = String(raw || '');

    try {
        const parsed = parseSummaryJsonResponse(text);
        const firstSummary = Array.isArray(parsed?.summaries) ? parsed.summaries[0] : null;
        if (firstSummary) {
            return {
                title: String(firstSummary.title || '').trim(),
                summary: String(firstSummary.summary || '').trim(),
                keywords: Array.isArray(firstSummary.keywords) ? firstSummary.keywords : [],
            };
        }
    } catch {
        // Fall back to heuristic extraction for malformed responses.
    }

    let title = '';
    let summary = '';
    let keywords = [];

    const titleLine = text.match(/(?:^|\n)\s*(?:title|arc\s*title|summary\s*title)\s*[:\-]\s*(.+)\s*$/im)
        || text.match(/(?:^|\n)\s*#{1,6}\s*(.+)\s*$/m);
    if (titleLine) {
        title = String(titleLine[1] || '')
            .trim()
            .replace(/^["']|["']$/g, '');
    }

    const summaryMatch = text.match(
        /(?:^|\n)\s*(?:summary|arc\s*summary|content)\s*[:\-]\s*([\s\S]*?)(?=\n\s*(?:keywords?|tags?)\s*[:\-]|\n\s*$)/im,
    );
    if (summaryMatch) {
        summary = String(summaryMatch[1] || '').trim();
    } else if (title) {
        const afterTitle = text.split(title).slice(1).join(title);
        const paragraphs = afterTitle
            .split(/\n\s*\n/g)
            .map(paragraph => paragraph.trim())
            .filter(Boolean);
        if (paragraphs.length > 0) {
            summary = paragraphs[0];
        }
    }

    const keywordSection = text.match(
        /(?:^|\n)\s*(?:keywords?|tags?)\s*[:\-]\s*([\s\S]*)$/im,
    );
    if (keywordSection) {
        keywords = splitKeywords(keywordSection[1]);
    } else {
        const bulletish = text
            .split(/\r?\n/)
            .filter(line => /^\s*(?:[\-*•]|\d+\.)\s+/.test(line))
            .slice(0, 60)
            .join('\n');
        if (bulletish) {
            keywords = splitKeywords(bulletish);
        }
    }

    return { title, summary, keywords };
}

export function showFailedSummaryResponsePopup(error, { onApply } = {}) {
    const rawResponse = String(error?.retryRawResponse || error?.rawResponse || '').trim();
    const originalRawResponse = String(error?.rawResponse || '').trim();
    const code = String(error?.code || '').trim();
    const message = String(error?.message || 'Unknown error').trim();
    const canApply = rawResponse && typeof onApply === 'function';
    const prefill = rawResponse ? extractSummaryFieldsFromText(rawResponse) : null;

    const html = `
        <div class="stmb-failed-summary-popup">
            <h3>Review Failed Summary Response</h3>
            <div class="world_entry_form_control">
                <div><strong>Error:</strong> ${escapeHtml(message)}</div>
                ${code ? `<div><strong>Code:</strong> ${escapeHtml(code)}</div>` : ''}
            </div>
            ${rawResponse ? `
                <div class="world_entry_form_control">
                    <h4>Raw Summary Response</h4>
                    <textarea id="stmb-summary-corrected-raw" class="text_pole" style="width:100%; min-height:220px; max-height:360px; white-space:pre; overflow:auto;">${escapeHtml(rawResponse)}</textarea>
                    <div class="buttons_block gap10px">
                        <button id="stmb-summary-copy-raw" class="menu_button">Copy Raw</button>
                        <button id="stmb-summary-extract-fields" class="menu_button">Extract Title/Summary/Keywords</button>
                        <button id="stmb-summary-fill-json" class="menu_button">Fill JSON</button>
                        <button id="stmb-summary-apply-corrected-raw" class="menu_button" ${canApply ? '' : 'disabled'}>Create Summary from corrected JSON</button>
                    </div>
                    ${canApply ? '' : '<div class="opacity70p">Unable to apply corrected JSON because the original consolidation context is missing.</div>'}
                </div>
                <div class="world_entry_form_control">
                    <h4>Extractable Fields</h4>
                    <div class="opacity70p">Use Extract to populate fields from the raw response, then Fill JSON to generate valid summary JSON.</div>
                    <div class="world_entry_form_control">
                        <label for="stmb-summary-field-title">Title</label>
                        <input id="stmb-summary-field-title" class="text_pole" style="width:100%" value="${escapeHtml(String(prefill?.title || ''))}">
                    </div>
                    <div class="world_entry_form_control">
                        <label for="stmb-summary-field-summary">Summary</label>
                        <textarea id="stmb-summary-field-summary" class="text_pole" style="width:100%; min-height:120px; white-space:pre-wrap;">${escapeHtml(String(prefill?.summary || ''))}</textarea>
                    </div>
                    <div class="world_entry_form_control">
                        <label for="stmb-summary-field-keywords">Keywords (one per line or comma-separated)</label>
                        <textarea id="stmb-summary-field-keywords" class="text_pole" style="width:100%; min-height:90px; white-space:pre-wrap;">${escapeHtml(Array.isArray(prefill?.keywords) ? prefill.keywords.join('\n') : '')}</textarea>
                    </div>
                </div>
                ${originalRawResponse && originalRawResponse !== rawResponse ? `
                    <details class="world_entry_form_control">
                        <summary class="opacity70p">Show original (pre-retry) response</summary>
                        <textarea class="text_pole" style="width:100%; min-height:160px; max-height:260px; white-space:pre; overflow:auto;">${escapeHtml(originalRawResponse)}</textarea>
                    </details>
                ` : ''}
            ` : '<div class="world_entry_form_control opacity70p">No raw response was captured.</div>'}
        </div>
    `;

    safePlayMessageSound();
    const popup = new Popup(DOMPurify.sanitize(html), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: 'Close',
    });

    const dlg = popup.dlg;
    dlg.querySelector('#stmb-summary-copy-raw')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(rawResponse);
            toastr.success('Copied raw response', 'STMB');
        } catch {
            toastr.error('Copy failed', 'STMB');
        }
    });
    dlg.querySelector('#stmb-summary-extract-fields')?.addEventListener('click', () => {
        const rawValue = String(dlg.querySelector('#stmb-summary-corrected-raw')?.value ?? rawResponse);
        const extracted = extractSummaryFieldsFromText(rawValue);
        dlg.querySelector('#stmb-summary-field-title').value = String(extracted.title || '');
        dlg.querySelector('#stmb-summary-field-summary').value = String(extracted.summary || '');
        dlg.querySelector('#stmb-summary-field-keywords').value = Array.isArray(extracted.keywords) ? extracted.keywords.join('\n') : '';
        if (!extracted.title && !extracted.summary && (!Array.isArray(extracted.keywords) || extracted.keywords.length === 0)) {
            toastr.warning('Could not extract summary fields from the raw response', 'STMB');
            return;
        }
        toastr.success('Extracted fields from raw response', 'STMB');
    });
    dlg.querySelector('#stmb-summary-fill-json')?.addEventListener('click', () => {
        const title = String(dlg.querySelector('#stmb-summary-field-title')?.value || '').trim();
        const summary = String(dlg.querySelector('#stmb-summary-field-summary')?.value || '').trim();
        const keywords = splitKeywords(dlg.querySelector('#stmb-summary-field-keywords')?.value || '');
        if (!title || !summary) {
            toastr.warning('Title and Summary are required to build a summary.', 'STMB');
            return;
        }

        const payload = {
            summaries: [{ title, summary, keywords, member_ids: [] }],
            unassigned_items: [],
        };
        const rawEl = dlg.querySelector('#stmb-summary-corrected-raw');
        if (rawEl) {
            rawEl.value = JSON.stringify(payload, null, 2);
        }
        toastr.success('Filled JSON from fields', 'STMB');
    });
    dlg.querySelector('#stmb-summary-apply-corrected-raw')?.addEventListener('click', async () => {
        if (!canApply) {
            return;
        }

        const correctedRaw = String(dlg.querySelector('#stmb-summary-corrected-raw')?.value ?? rawResponse);
        try {
            const applied = await onApply(correctedRaw);
            if (!applied) {
                return;
            }
            toastr.success('Summary created from corrected JSON', 'STMB');
            await popup.completeCancelled();
        } catch (applyError) {
            console.error('STMB manual summary repair failed', applyError);
            toastr.error(String(applyError?.message || 'Failed to create summary from corrected JSON'), 'STMB');
        }
    });

    void popup.show();
}
