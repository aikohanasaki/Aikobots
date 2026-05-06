import { chat_metadata, saveSettingsDebounced } from '../script.js';
import { DOMPurify } from '../lib.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { createStmbEntry, generateStmbText, updateStmbEntryByUid } from './stmb-api.js';
import { STMB_DEFAULT_COMPACTION_PROMPT_TEMPLATE } from './stmb-core.js';
import { isSidePromptEntryTitle } from './stmb-sideprompts.js';
import { escapeHtml } from './utils.js';
import { getLorebookStorageForRequest, loadWorldInfo, METADATA_KEY, reloadEditor, world_names, worldInfoCache } from './world-info.js';

const MODULE_NAME = 'STMB Clips';
const CREATE_NEW_VALUE = '__stmb_create_new_clip_entry__';
const TOKEN_WARNING_THRESHOLD = 500;
const FLOATING_CLIP_X_OFFSET = 6;
const FLOATING_CLIP_Y_OFFSET = -4;
const FLOATING_CLIP_VIEWPORT_PADDING = 8;

export const DEFAULT_COMPACTION_PROMPT_TEMPLATE = STMB_DEFAULT_COMPACTION_PROMPT_TEMPLATE;
export const STMB_CLIP_TITLE_SUFFIX = ' [STMB Clip]';

let floatingClipButton = null;
let floatingClipListenersBound = false;
let floatingClipUpdateTimer = null;
let runtime = {};

export function configureStmbClipRuntime(nextRuntime = {}) {
    runtime = { ...runtime, ...nextRuntime };
}

function tr(fallback) {
    return fallback;
}

function readIntInput(input, fallback = 0) {
    const parsed = Number.parseInt(input?.value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getSettings() {
    return runtime.getSettings?.() || {};
}

function getModuleSettings() {
    const settings = getSettings();
    if (!settings.moduleSettings || typeof settings.moduleSettings !== 'object') {
        settings.moduleSettings = {};
    }
    return settings.moduleSettings;
}

function persistSettings() {
    if (typeof runtime.persistSettings === 'function') {
        runtime.persistSettings();
        return;
    }
    saveSettingsDebounced();
}

function shouldRefreshEditor() {
    return getModuleSettings().refreshEditor !== false;
}

function estimateTokens(content) {
    return Math.ceil(String(content || '').length / 4);
}

export function isClipEntryTitle(title) {
    return typeof title === 'string' && title.trimEnd().endsWith('[STMB Clip]');
}

export function getClipHeadlineFromTitle(title) {
    const raw = String(title || '').trimEnd();
    if (!isClipEntryTitle(raw)) return raw.trim();
    return raw.slice(0, raw.length - '[STMB Clip]'.length).trim();
}

function validateClipHeadline(headline) {
    const raw = String(headline || '').trim();
    const clean = isClipEntryTitle(raw) ? getClipHeadlineFromTitle(raw) : raw;
    if (!clean) {
        throw new Error(tr('Entry title / section headline cannot be empty.'));
    }
    if (/[\r\n]/.test(clean) || /[\u0000-\u001F\u007F]/.test(clean)) {
        throw new Error(tr('Entry title / section headline cannot contain newlines or control characters.'));
    }
    if (clean.includes('[STMB Clip]')) {
        throw new Error(tr('Entry title / section headline cannot contain [STMB Clip].'));
    }
    if (clean.includes('===')) {
        throw new Error(tr('Entry title / section headline cannot contain ===.'));
    }
    return clean;
}

export function makeClipEntryTitle(headline) {
    const clean = validateClipHeadline(headline);
    return `${clean}${STMB_CLIP_TITLE_SUFFIX}`;
}

export function makeClipStartMarker(headline) {
    return `=== ${headline} ===`;
}

export function makeClipEndMarker(headline) {
    return `=== END ${headline} ===`;
}

function stripLeadingBulletMarker(line) {
    return String(line || '').replace(/^\s*(?:[-*\u2022]\s+|\d+[.)]\s+)/, '');
}

function formatClipBullet(text) {
    const lines = String(text || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => stripLeadingBulletMarker(line).trim())
        .filter(Boolean);

    if (lines.length === 0) {
        throw new Error(tr('Selected text cannot be empty.'));
    }

    const [first, ...rest] = lines;
    return [`- ${first}`, ...rest.map(line => `  ${line}`)].join('\n');
}

export function createClipEntryContent(headline, bulletText) {
    return `${makeClipStartMarker(headline)}\n\n${formatClipBullet(bulletText)}\n\n${makeClipEndMarker(headline)}`;
}

function normalizeBulletForDuplicate(text) {
    return stripLeadingBulletMarker(String(text || ''))
        .trim()
        .replace(/\s+/g, ' ');
}

function collectBulletBlocks(content) {
    const blocks = [];
    let current = null;
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');

    for (const line of lines) {
        if (/^\s*-\s+/.test(line)) {
            if (current) blocks.push(current.join('\n'));
            current = [line];
        } else if (current && /^\s{2,}\S/.test(line)) {
            current.push(line);
        } else if (current) {
            blocks.push(current.join('\n'));
            current = null;
        }
    }

    if (current) blocks.push(current.join('\n'));
    return blocks;
}

function hasDuplicateBullet(content, bulletText) {
    const target = normalizeBulletForDuplicate(bulletText);
    return collectBulletBlocks(content).some(block => normalizeBulletForDuplicate(block) === target);
}

function appendBulletBeforeEndMarker(content, headline, bulletText) {
    const endMarker = makeClipEndMarker(headline);
    const endIndex = String(content || '').indexOf(endMarker);
    if (endIndex < 0) {
        throw new Error(tr('Expected clip end marker was not found.'));
    }

    const before = String(content || '').slice(0, endIndex).replace(/[ \t]*$/g, '');
    const after = String(content || '').slice(endIndex);
    const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    return `${before}${separator}${formatClipBullet(bulletText)}\n\n${after}`;
}

function getWrapperMarkerHeadlines(content, kind) {
    const pattern = kind === 'end'
        ? /^=== END (.+) ===$/gm
        : /^=== (?!END )(.+) ===$/gm;
    return Array.from(String(content || '').matchAll(pattern), match => match[1]);
}

function analyzeClipWrapper(content, headline) {
    const text = String(content || '');
    const startMarker = makeClipStartMarker(headline);
    const endMarker = makeClipEndMarker(headline);
    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker);
    const startHeadlines = getWrapperMarkerHeadlines(text, 'start');
    const endHeadlines = getWrapperMarkerHeadlines(text, 'end');

    if (startIndex >= 0 && endIndex > startIndex) return { type: 'valid' };
    if (startHeadlines.length > 1 || endHeadlines.length > 1) return { type: 'multiple' };
    if (startHeadlines.length === 1 && endHeadlines.length === 1) {
        return { type: 'mismatch', wrapperHeadline: startHeadlines[0], wrapperEndHeadline: endHeadlines[0] };
    }
    return { type: 'none' };
}

function replaceSingleWrapperHeadline(content, fromHeadline, toHeadline, fromEndHeadline = fromHeadline) {
    return String(content || '')
        .replace(makeClipStartMarker(fromHeadline), makeClipStartMarker(toHeadline))
        .replace(makeClipEndMarker(fromEndHeadline), makeClipEndMarker(toHeadline));
}

function stripWrapperMarkerLines(content) {
    return String(content || '')
        .replace(/^=== (?!END ).+ ===\s*$/gm, '')
        .replace(/^=== END .+ ===\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function convertExistingContentToWrappedContent(content, headline, bulletText) {
    const existing = String(content || '').trim();
    if (!existing) return createClipEntryContent(headline, bulletText);
    return `${makeClipStartMarker(headline)}\n\n${existing}\n\n${formatClipBullet(bulletText)}\n\n${makeClipEndMarker(headline)}`;
}

function normalizeSelectedText(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function nodeIsInside(node, container) {
    if (!node || !container) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!element && container.contains(element);
}

function getElementForNode(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function getSelectionChatMessage(selection) {
    const anchorMessage = getElementForNode(selection?.anchorNode)?.closest?.('#chat .mes[mesid]');
    const focusMessage = getElementForNode(selection?.focusNode)?.closest?.('#chat .mes[mesid]');
    return anchorMessage && anchorMessage === focusMessage ? anchorMessage : anchorMessage || focusMessage || null;
}

function getSelectionDirection(selection) {
    const messageElement = getSelectionChatMessage(selection);
    const element = getElementForNode(selection?.focusNode) || messageElement;
    const direction = element ? getComputedStyle(element).direction : 'ltr';
    return direction === 'rtl' ? 'rtl' : 'ltr';
}

function getSelectionAttachRect(range, direction = 'ltr') {
    const rects = Array.from(range.getClientRects())
        .filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length > 0) return direction === 'rtl' ? rects[0] : rects[rects.length - 1];
    return range.getBoundingClientRect();
}

function isFloatingClipEnabled() {
    return getModuleSettings().showFloatingClipButton !== false;
}

function getSelectedChatText(messageElement = null, options = {}) {
    if (options.requireFloatingEnabled && !isFloatingClipEnabled()) {
        throw new Error(tr('Floating Clip button is disabled.'));
    }

    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
        throw new Error(tr('Highlight text in the chat first, then click Clip.'));
    }

    const selectedText = normalizeSelectedText(selection?.toString?.() || '');
    if (!selectedText) {
        throw new Error(tr('Highlight text in the chat first, then click Clip.'));
    }

    const chatElement = document.querySelector('#chat');
    if (!chatElement || !nodeIsInside(selection.anchorNode, chatElement) || !nodeIsInside(selection.focusNode, chatElement)) {
        throw new Error(tr('Selected text must be inside the chat.'));
    }

    if (messageElement && (!nodeIsInside(selection.anchorNode, messageElement) || !nodeIsInside(selection.focusNode, messageElement))) {
        throw new Error(tr('Select text inside the message you are clipping.'));
    }

    return selectedText;
}

function getFloatingSelectionState() {
    if (!isFloatingClipEnabled()) return null;
    const selection = document.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const selectedText = normalizeSelectedText(selection.toString?.() || '');
    if (!selectedText) return null;

    const chatElement = document.querySelector('#chat');
    if (!chatElement || !nodeIsInside(selection.anchorNode, chatElement) || !nodeIsInside(selection.focusNode, chatElement)) {
        return null;
    }

    const messageElement = getSelectionChatMessage(selection);
    if (!messageElement) return null;

    const range = selection.getRangeAt(0);
    const direction = getSelectionDirection(selection);
    const rect = getSelectionAttachRect(range, direction);
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;

    return { selectedText, rect, direction, messageElement };
}

function findEntryByTitle(lorebookData, title) {
    const target = String(title || '');
    return Object.values(lorebookData?.entries || {}).find(entry => String(entry?.comment || '') === target) || null;
}

function findEntryByUid(lorebookData, uid) {
    const uidText = String(uid);
    return Object.values(lorebookData?.entries || {}).find(entry => String(entry?.uid) === uidText) || null;
}

function getClipEntries(lorebookData) {
    return Object.values(lorebookData?.entries || {})
        .filter(entry => isClipEntryTitle(entry?.comment || ''))
        .sort((a, b) => String(a.comment || '').localeCompare(String(b.comment || '')));
}

function getClipEntryByFinalTitle(lorebookData, title) {
    const normalizedTitle = String(title || '').trimEnd();
    return Object.values(lorebookData?.entries || {})
        .find(entry => isClipEntryTitle(entry?.comment || '') && String(entry.comment || '').trimEnd() === normalizedTitle) || null;
}

function parseKeywords(text) {
    return String(text || '')
        .split(',')
        .map(keyword => keyword.trim())
        .filter(Boolean);
}

async function afterLorebookWrite(lorebookName, lorebookData, entry) {
    worldInfoCache.delete(lorebookName);
    if (!lorebookData.entries || typeof lorebookData.entries !== 'object') lorebookData.entries = {};
    if (entry?.uid !== undefined) lorebookData.entries[entry.uid] = entry;
    if (shouldRefreshEditor()) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn(`${MODULE_NAME}: refreshEditor failed`, error);
        }
    }
}

async function createClipLorebookEntry(lorebookName, lorebookData, { title, content, activation, keywords }) {
    if (getClipEntryByFinalTitle(lorebookData, title)) {
        throw new Error(tr('A clip entry with this title already exists.'));
    }

    const result = await createStmbEntry({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        title,
        content,
        defaults: {
            vectorized: activation === 'keyword',
            selective: activation === 'keyword',
            order: 100,
            position: 0,
        },
        entryOverrides: {
            key: activation === 'keyword' ? keywords : [],
            keysecondary: [],
            constant: activation === 'constant',
            vectorized: activation === 'keyword',
            selective: activation === 'keyword',
            disable: false,
            position: 0,
            order: 100,
        },
    });
    await afterLorebookWrite(lorebookName, lorebookData, result?.entry);
    return result?.entry;
}

async function updateLorebookEntryByUid(lorebookName, lorebookData, entry, { title, content, entryOverrides = {} }) {
    if (!entry || entry.uid === undefined || entry.uid === null) {
        throw new Error(tr('Selected clip entry was not found.'));
    }

    const result = await updateStmbEntryByUid({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        uid: entry.uid,
        title,
        content,
        entryOverrides,
    });
    await afterLorebookWrite(lorebookName, lorebookData, result?.entry);
    return result?.entry;
}

async function confirmDuplicateBullet() {
    const popup = new Popup(
        DOMPurify.sanitize(`<h3>${escapeHtml(tr('Duplicate Clip'))}</h3><p>${escapeHtml(tr('This exact clip already exists in the selected entry.'))}</p>`),
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: tr('Add Anyway'), cancelButton: tr('Cancel') },
    );
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

async function confirmConvertExistingContent() {
    const popup = new Popup(
        DOMPurify.sanitize(`<h3>${escapeHtml(tr('Convert Clip Entry'))}</h3><p>${escapeHtml(tr('This entry is marked as an STMB Clip entry but does not have the expected wrapper. Convert it to one wrapped section and preserve its current content?'))}</p>`),
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: tr('Convert'), cancelButton: tr('Cancel') },
    );
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

async function confirmMultipleWrapperConversion() {
    const popup = new Popup(
        DOMPurify.sanitize(`<h3>${escapeHtml(tr('Multiple Clip Sections'))}</h3><p>${escapeHtml(tr('STMB Clip entries support one section per entry. Convert this entry to one section using the title-derived headline?'))}</p>`),
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: tr('Convert to One Section'), cancelButton: tr('Cancel') },
    );
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

function buildUpdatedExistingContent(entry, bulletText, editedHeadline) {
    const headline = validateClipHeadline(editedHeadline ?? getClipHeadlineFromTitle(entry.comment || ''));
    const analysis = analyzeClipWrapper(entry.content || '', headline);
    if (analysis.type === 'valid') return appendBulletBeforeEndMarker(entry.content || '', headline, bulletText);
    if (analysis.type === 'multiple') return convertExistingContentToWrappedContent(stripWrapperMarkerLines(entry.content || ''), headline, bulletText);
    if (analysis.type === 'mismatch') {
        const repairedContent = replaceSingleWrapperHeadline(entry.content || '', analysis.wrapperHeadline, headline, analysis.wrapperEndHeadline);
        return appendBulletBeforeEndMarker(repairedContent, headline, bulletText);
    }
    return convertExistingContentToWrappedContent(entry.content || '', headline, bulletText);
}

async function buildExistingContentForSave(entry, bulletText, headline) {
    const analysis = analyzeClipWrapper(entry.content || '', headline);
    if (analysis.type === 'valid') return appendBulletBeforeEndMarker(entry.content || '', headline, bulletText);
    if (analysis.type === 'none') {
        const hasExisting = !!String(entry.content || '').trim();
        if (hasExisting && !await confirmConvertExistingContent()) return null;
        return convertExistingContentToWrappedContent(entry.content || '', headline, bulletText);
    }
    if (analysis.type === 'multiple') {
        if (!await confirmMultipleWrapperConversion()) return null;
        return convertExistingContentToWrappedContent(stripWrapperMarkerLines(entry.content || ''), headline, bulletText);
    }
    const repairedContent = replaceSingleWrapperHeadline(entry.content || '', analysis.wrapperHeadline, headline, analysis.wrapperEndHeadline);
    return appendBulletBeforeEndMarker(repairedContent, headline, bulletText);
}

function buildClipModalHtml(selectedText, clipEntries) {
    const entryOptions = clipEntries.map(entry => {
        const title = String(entry.comment || '');
        return `<option value="${escapeHtml(title)}">${escapeHtml(getClipHeadlineFromTitle(title))}</option>`;
    }).join('');

    return DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Clip to Memory Book'))}</h3>
        <div class="stmb-clip-modal">
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Selected text'))}</h4>
                <textarea id="stmb-clip-text" class="text_pole stmb-clip-textarea">${escapeHtml(selectedText)}</textarea>
            </label>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Existing clip entry'))}</h4>
                <select id="stmb-clip-entry-select" class="text_pole">
                    ${entryOptions}
                    <option value="${CREATE_NEW_VALUE}" ${clipEntries.length ? '' : 'selected'}>${escapeHtml(tr('Create new clip entry'))}</option>
                </select>
            </label>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Entry title / section headline'))}</h4>
                <input id="stmb-clip-headline" class="text_pole" type="text">
            </label>
            <div id="stmb-clip-new-entry-fields" class="world_entry_form_control">
                <div class="stmb-clip-activation">
                    <label><input type="radio" name="stmb-clip-activation" value="constant" checked> ${escapeHtml(tr('Always include this entry'))}</label>
                    <label><input type="radio" name="stmb-clip-activation" value="keyword"> ${escapeHtml(tr('Activate by keywords'))}</label>
                </div>
                <label id="stmb-clip-keywords-row">
                    <h4>${escapeHtml(tr('Keywords'))}</h4>
                    <input id="stmb-clip-keywords" class="text_pole" type="text">
                </label>
            </div>
            <div class="world_entry_form_control">
                <div class="stmb-clip-label-row">
                    <h4>${escapeHtml(tr('Current entry content'))}</h4>
                    <button id="stmb-clip-compact" type="button" class="menu_button stmb-clip-compact-btn">${escapeHtml(tr('Compaction'))}</button>
                </div>
                <textarea id="stmb-clip-current-content" class="text_pole stmb-clip-preview" readonly></textarea>
            </div>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Updated entry preview'))}</h4>
                <textarea id="stmb-clip-updated-preview" class="text_pole stmb-clip-preview" readonly></textarea>
            </label>
            <div id="stmb-clip-token-warning" class="info-block warning stmb-clip-warning" hidden>${escapeHtml(tr('This clip entry is getting long. Long constant entries can waste context or crowd out more relevant memory. Review, edit, or compact it.'))}</div>
        </div>
    `);
}

function attachClipModalHandlers(popup, lorebookName, lorebookData, clipEntries) {
    const dlg = popup.dlg;
    if (!dlg) return;

    const entrySelect = dlg.querySelector('#stmb-clip-entry-select');
    const clipText = dlg.querySelector('#stmb-clip-text');
    const headlineInput = dlg.querySelector('#stmb-clip-headline');
    const keywordsRow = dlg.querySelector('#stmb-clip-keywords-row');
    const currentContent = dlg.querySelector('#stmb-clip-current-content');
    const updatedPreview = dlg.querySelector('#stmb-clip-updated-preview');
    const tokenWarning = dlg.querySelector('#stmb-clip-token-warning');
    const compactButton = dlg.querySelector('#stmb-clip-compact');
    const newEntryFields = dlg.querySelector('#stmb-clip-new-entry-fields');

    const getMode = () => entrySelect?.value === CREATE_NEW_VALUE ? 'new' : 'existing';
    const getSelectedEntry = () => findEntryByTitle(lorebookData, entrySelect?.value || '');
    const getBulletText = () => clipText?.value || '';

    const syncHeadlineFromSelection = () => {
        if (!headlineInput) return;
        const entry = getSelectedEntry();
        headlineInput.value = entry ? getClipHeadlineFromTitle(entry.comment || '') : '';
    };

    const syncActivation = () => {
        const activation = dlg.querySelector('input[name="stmb-clip-activation"]:checked')?.value || 'constant';
        if (keywordsRow) keywordsRow.style.display = activation === 'keyword' ? 'block' : 'none';
    };

    const refreshPreview = () => {
        const mode = getMode();
        if (newEntryFields) newEntryFields.style.display = mode === 'new' ? 'block' : 'none';
        if (compactButton) compactButton.disabled = mode !== 'existing';

        let preview = '';
        let current = '';
        try {
            if (mode === 'existing') {
                const entry = getSelectedEntry();
                current = entry?.content || '';
                preview = entry ? buildUpdatedExistingContent(entry, getBulletText(), headlineInput?.value || '') : '';
            } else {
                const headline = validateClipHeadline(headlineInput?.value || '');
                preview = createClipEntryContent(headline, getBulletText());
            }
        } catch (error) {
            preview = error.message || '';
        }

        if (currentContent) currentContent.value = current;
        if (updatedPreview) updatedPreview.value = preview;
        if (tokenWarning) tokenWarning.hidden = estimateTokens(preview) <= TOKEN_WARNING_THRESHOLD;
    };

    entrySelect?.addEventListener('change', () => {
        syncHeadlineFromSelection();
        refreshPreview();
    });
    clipText?.addEventListener('input', refreshPreview);
    headlineInput?.addEventListener('input', refreshPreview);
    dlg.querySelectorAll('input[name="stmb-clip-activation"]').forEach(input => {
        input.addEventListener('change', () => {
            syncActivation();
            refreshPreview();
        });
    });
    compactButton?.addEventListener('click', async () => {
        const entry = getSelectedEntry();
        if (!entry) return;
        const replaced = await showCompactReviewPopup(lorebookName, lorebookData, entry);
        if (replaced) refreshPreview();
    });

    syncActivation();
    syncHeadlineFromSelection();
    refreshPreview();
}

async function showLongEntryWarning(lorebookName, lorebookData, entry, content) {
    if (estimateTokens(content) <= TOKEN_WARNING_THRESHOLD) return true;

    const popup = new Popup(
        DOMPurify.sanitize(`<h3>${escapeHtml(tr('Long Clip Entry'))}</h3><p>${escapeHtml(tr('This clip entry is getting long. Long constant entries can waste context or crowd out more relevant memory. Review, edit, or compact it.'))}</p>`),
        POPUP_TYPE.TEXT,
        '',
        {
            okButton: false,
            cancelButton: tr('Cancel'),
            customButtons: [
                { text: tr('Review Entry'), result: POPUP_RESULT.CUSTOM1, appendAtEnd: true },
                { text: tr('Compact Entry'), result: POPUP_RESULT.CUSTOM2, appendAtEnd: true },
                { text: tr('Save Anyway'), result: POPUP_RESULT.CUSTOM3, appendAtEnd: true },
            ],
        },
    );

    const result = await popup.show();
    if (result === POPUP_RESULT.CUSTOM3) return true;
    if (result === POPUP_RESULT.CUSTOM2 && entry) {
        await showCompactReviewPopup(lorebookName, lorebookData, entry, { pendingContent: content });
    } else if (result === POPUP_RESULT.CUSTOM1) {
        await new Popup(
            DOMPurify.sanitize(`<h3>${escapeHtml(tr('Review Entry'))}</h3><textarea class="text_pole stmb-clip-preview" readonly>${escapeHtml(content)}</textarea>`),
            POPUP_TYPE.TEXT,
            '',
            { wide: true, large: true, allowVerticalScrolling: true, okButton: tr('Close'), cancelButton: false },
        ).show();
    }
    return false;
}

async function saveExistingClip(lorebookName, lorebookData, title, bulletText, editedHeadline) {
    const entry = findEntryByTitle(lorebookData, title);
    if (!entry) throw new Error(tr('Selected clip entry was not found.'));

    const headline = validateClipHeadline(editedHeadline);
    const newTitle = makeClipEntryTitle(headline);
    const duplicate = getClipEntryByFinalTitle(lorebookData, newTitle);
    if (duplicate && duplicate !== entry) {
        throw new Error(tr('A clip entry with this title already exists.'));
    }

    const updatedContent = await buildExistingContentForSave(entry, bulletText, headline);
    if (updatedContent == null) return false;

    if (hasDuplicateBullet(entry.content || '', formatClipBullet(bulletText)) && !await confirmDuplicateBullet()) {
        return false;
    }

    if (!await showLongEntryWarning(lorebookName, lorebookData, entry, updatedContent)) {
        return false;
    }

    await updateLorebookEntryByUid(lorebookName, lorebookData, entry, {
        title: newTitle,
        content: updatedContent,
    });
    return true;
}

async function saveNewClip(lorebookName, lorebookData, dlg) {
    const headline = validateClipHeadline(dlg.querySelector('#stmb-clip-headline')?.value || '');
    const title = makeClipEntryTitle(headline);
    if (getClipEntryByFinalTitle(lorebookData, title)) {
        throw new Error(tr('A clip entry with this title already exists.'));
    }

    const bulletText = dlg.querySelector('#stmb-clip-text')?.value || '';
    const content = createClipEntryContent(headline, bulletText);
    const activation = dlg.querySelector('input[name="stmb-clip-activation"]:checked')?.value || 'constant';
    const keywords = parseKeywords(dlg.querySelector('#stmb-clip-keywords')?.value || '');
    if (activation === 'keyword' && keywords.length === 0) {
        throw new Error(tr('Keyword-activated clip entries require at least one keyword.'));
    }

    if (!await showLongEntryWarning(lorebookName, lorebookData, null, content)) {
        return false;
    }

    const newEntry = await createClipLorebookEntry(lorebookName, lorebookData, {
        title,
        content,
        activation,
        keywords,
    });
    if (!newEntry) {
        throw new Error(tr('Failed to create clip entry.'));
    }
    return true;
}

async function ensureClipLorebook() {
    if (typeof runtime.ensureLorebookName !== 'function') {
        throw new Error('STMB lorebook resolver is not configured.');
    }
    const lorebookName = await runtime.ensureLorebookName('clip');
    const lorebookData = await loadWorldInfo(lorebookName);
    if (!lorebookData) throw new Error(tr('No valid lorebook available.'));
    return { lorebookName, lorebookData };
}

export async function openClipModalFromSelection({ selectedText, source = 'message' } = {}) {
    if (source === 'floating') {
        try {
            getSelectedChatText(null, { requireFloatingEnabled: true });
        } catch (error) {
            hideFloatingClipButton();
            if (error?.message !== tr('Floating Clip button is disabled.')) {
                toastr.warning(error.message, 'STMB');
            }
            return;
        }
    }

    const normalizedSelectedText = normalizeSelectedText(selectedText || '');
    if (!normalizedSelectedText) {
        toastr.warning(tr('Highlight text in the chat first, then click Clip.'), 'STMB');
        return;
    }

    hideFloatingClipButton();

    let lorebookName = '';
    let lorebookData = null;
    try {
        ({ lorebookName, lorebookData } = await ensureClipLorebook());
    } catch (error) {
        if (!error?.handled) {
            toastr.error(error?.message || tr('No valid lorebook available.'), 'STMB');
        }
        return;
    }

    const clipEntries = getClipEntries(lorebookData);
    const popup = new Popup(buildClipModalHtml(normalizedSelectedText, clipEntries), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: tr('Save Clip'),
        cancelButton: tr('Cancel'),
    });

    const showPromise = popup.show();
    attachClipModalHandlers(popup, lorebookName, lorebookData, clipEntries);
    const result = await showPromise;
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;

    try {
        const dlg = popup.dlg;
        const bulletText = dlg.querySelector('#stmb-clip-text')?.value || '';
        formatClipBullet(bulletText);
        const selectedTitle = dlg.querySelector('#stmb-clip-entry-select')?.value || CREATE_NEW_VALUE;
        const editedHeadline = dlg.querySelector('#stmb-clip-headline')?.value || '';
        const saved = selectedTitle === CREATE_NEW_VALUE
            ? await saveNewClip(lorebookName, lorebookData, dlg)
            : await saveExistingClip(lorebookName, lorebookData, selectedTitle, bulletText, editedHeadline);

        if (saved) toastr.success(tr('Clip saved to Memory Book.'), 'STMB');
    } catch (error) {
        console.error(`${MODULE_NAME}: Failed to save clip:`, error);
        toastr.error(error?.message || tr('Failed to save clip.'), 'STMB');
    }
}

export async function handleClipButtonClick(messageElement) {
    try {
        const selectedText = getSelectedChatText(messageElement);
        await openClipModalFromSelection({ selectedText, source: 'message' });
    } catch (error) {
        toastr.warning(error.message, 'STMB');
    }
}

export function hideFloatingClipButton() {
    if (floatingClipUpdateTimer) {
        clearTimeout(floatingClipUpdateTimer);
        floatingClipUpdateTimer = null;
    }
    floatingClipButton?.remove();
    floatingClipButton = null;
}

function scheduleFloatingClipUpdate() {
    if (!isFloatingClipEnabled()) {
        hideFloatingClipButton();
        return;
    }
    if (floatingClipUpdateTimer) clearTimeout(floatingClipUpdateTimer);
    floatingClipUpdateTimer = setTimeout(updateFloatingClipButton, 60);
}

function createFloatingClipButton() {
    const button = document.createElement('div');
    button.classList.add('stmb_floating_clip_button', 'mes_stmb_clip', 'mes_button', 'fa-solid', 'fa-scissors', 'interactable');
    button.title = tr('Clip highlighted text to Memory Book');
    button.setAttribute('tabindex', '0');
    button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        const state = getFloatingSelectionState();
        if (!state) {
            hideFloatingClipButton();
            return;
        }
        await openClipModalFromSelection({ selectedText: state.selectedText, source: 'floating' });
    });
    document.body.appendChild(button);
    return button;
}

function updateFloatingClipButton() {
    floatingClipUpdateTimer = null;
    const state = getFloatingSelectionState();
    if (!state) {
        hideFloatingClipButton();
        return;
    }

    if (!floatingClipButton) floatingClipButton = createFloatingClipButton();

    const buttonWidth = floatingClipButton.offsetWidth || 32;
    const buttonHeight = floatingClipButton.offsetHeight || 32;
    const edgeLeft = state.direction === 'rtl'
        ? state.rect.left - buttonWidth - FLOATING_CLIP_X_OFFSET
        : state.rect.right + FLOATING_CLIP_X_OFFSET;
    const edgeTop = state.rect.top + (state.rect.height / 2) - (buttonHeight / 2) + FLOATING_CLIP_Y_OFFSET;
    const left = Math.min(window.innerWidth - buttonWidth - FLOATING_CLIP_VIEWPORT_PADDING, Math.max(FLOATING_CLIP_VIEWPORT_PADDING, edgeLeft));
    const top = Math.min(window.innerHeight - buttonHeight - FLOATING_CLIP_VIEWPORT_PADDING, Math.max(FLOATING_CLIP_VIEWPORT_PADDING, edgeTop));

    floatingClipButton.style.top = `${Math.round(top)}px`;
    floatingClipButton.style.left = `${Math.round(left)}px`;
    floatingClipButton.style.display = 'flex';
}

function handleFloatingClipDocumentMouseDown(event) {
    if (floatingClipButton?.contains(event.target)) return;
    hideFloatingClipButton();
}

function bindFloatingClipListeners() {
    if (floatingClipListenersBound) return;
    document.addEventListener('selectionchange', scheduleFloatingClipUpdate);
    document.addEventListener('mouseup', scheduleFloatingClipUpdate);
    document.addEventListener('keyup', scheduleFloatingClipUpdate);
    document.addEventListener('mousedown', handleFloatingClipDocumentMouseDown, true);
    window.addEventListener('scroll', hideFloatingClipButton, true);
    floatingClipListenersBound = true;
}

function unbindFloatingClipListeners() {
    if (!floatingClipListenersBound) return;
    document.removeEventListener('selectionchange', scheduleFloatingClipUpdate);
    document.removeEventListener('mouseup', scheduleFloatingClipUpdate);
    document.removeEventListener('keyup', scheduleFloatingClipUpdate);
    document.removeEventListener('mousedown', handleFloatingClipDocumentMouseDown, true);
    window.removeEventListener('scroll', hideFloatingClipButton, true);
    floatingClipListenersBound = false;
}

export function refreshFloatingClipButtonSetting() {
    if (isFloatingClipEnabled()) {
        bindFloatingClipListeners();
        scheduleFloatingClipUpdate();
    } else {
        unbindFloatingClipListeners();
        hideFloatingClipButton();
    }
}

export function initializeFloatingClipButton() {
    refreshFloatingClipButtonSetting();
}

function getCompactionPromptTemplate() {
    const saved = getModuleSettings().compactionPromptTemplate;
    return typeof saved === 'string' && saved.trim()
        ? saved
        : DEFAULT_COMPACTION_PROMPT_TEMPLATE;
}

function setCompactionPromptTemplate(template) {
    getModuleSettings().compactionPromptTemplate = String(template || '');
    persistSettings();
}

function getCompactionProfileIndex() {
    const settings = getSettings();
    const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
    if (profiles.length === 0) return 0;

    const rawIndex = Number.parseInt(getModuleSettings().compactionProfileIndex, 10);
    if (Number.isFinite(rawIndex) && rawIndex >= 0 && rawIndex < profiles.length) return rawIndex;

    const defaultIndex = Number.parseInt(settings.defaultProfile, 10);
    return Number.isFinite(defaultIndex) && defaultIndex >= 0 && defaultIndex < profiles.length ? defaultIndex : 0;
}

function setCompactionProfileIndex(profileIndex) {
    const settings = getSettings();
    const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
    const parsed = Number.parseInt(profileIndex, 10);
    const fallback = getCompactionProfileIndex();
    getModuleSettings().compactionProfileIndex = Number.isFinite(parsed) && parsed >= 0 && parsed < profiles.length ? parsed : fallback;
    persistSettings();
}

function buildCompactionProfileOptions(selectedIndex = getCompactionProfileIndex()) {
    const settings = getSettings();
    const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
    return profiles.map((profile, index) => {
        const displayName = profile?.isBuiltinCurrentST ? 'Current SillyTavern Settings' : profile?.name || 'Profile';
        return `<option value="${escapeHtml(String(index))}"${index === selectedIndex ? ' selected' : ''}>${escapeHtml(displayName)}</option>`;
    }).join('');
}

function buildCompactionProfileControl(selectId) {
    return `
        <div class="world_entry_form_control">
            <h4>${escapeHtml(tr('Compaction Profile'))}</h4>
            <select id="${escapeHtml(selectId)}" class="text_pole stmb-compaction-profile-select">
                ${buildCompactionProfileOptions()}
            </select>
        </div>
    `;
}

function initializeCompactionProfileSelect(popup, selectId) {
    const select = popup.dlg?.querySelector(`#${selectId}`);
    if (!select || !window.jQuery || typeof window.jQuery.fn.select2 !== 'function') return;
    const $select = window.jQuery(select);
    if ($select.hasClass('select2-hidden-accessible')) $select.select2('destroy');
    $select.select2({
        width: '100%',
        placeholder: tr('Select a Compaction profile...'),
        allowClear: false,
        dropdownParent: window.jQuery(popup.dlg),
    });
}

function getCompactionProfileIndexFromSelect(popup, selectId) {
    return readIntInput(popup.dlg?.querySelector(`#${selectId}`), getCompactionProfileIndex());
}

function validateCompactionPromptTemplate(template) {
    const value = String(template || '');
    if (!value.trim()) return tr('Prompt cannot be empty');
    if (!value.includes('{{ENTRY_CONTENT}}')) {
        return tr('The Compaction prompt must include {{ENTRY_CONTENT}}.');
    }
    return null;
}

function buildCompactionPrompt(entry, entryKind, template = getCompactionPromptTemplate()) {
    const replacements = {
        ENTRY_CONTENT: String(entry?.content || ''),
        ENTRY_KIND: String(entryKind || ''),
        ENTRY_TITLE: String(entry?.comment || ''),
    };

    return String(template || DEFAULT_COMPACTION_PROMPT_TEMPLATE).replace(
        /\{\{(ENTRY_CONTENT|ENTRY_KIND|ENTRY_TITLE)\}\}/g,
        (_match, token) => replacements[token] ?? '',
    );
}

export function isReviewableCompactionEntry(entry) {
    const title = String(entry?.comment || entry?.title || '');
    return isClipEntryTitle(title)
        || isSidePromptEntryTitle(title)
        || entry?.stmemorybooks === true;
}

function getCompactionEntryKind(entry) {
    const title = entry?.comment || '';
    if (isClipEntryTitle(title)) return 'clip';
    if (isSidePromptEntryTitle(title)) return 'sideprompt';
    if (entry?.stmemorybooks === true) return 'memory';
    return null;
}

function getCompactionEntryKindLabel(entryKind) {
    if (entryKind === 'clip') return tr('Clip');
    if (entryKind === 'sideprompt') return tr('SidePrompt');
    if (entryKind === 'memory') return tr('Memory');
    return '';
}

async function requestCompaction(entry, entryKind, template = getCompactionPromptTemplate(), profileIndex = getCompactionProfileIndex()) {
    const promptTemplateError = validateCompactionPromptTemplate(template);
    if (promptTemplateError) throw new Error(promptTemplateError);
    if (typeof runtime.buildGenerateData !== 'function') {
        throw new Error('STMB generation helper is not configured.');
    }

    const profile = runtime.getProfile?.(profileIndex) || null;
    const prompt = buildCompactionPrompt(entry, entryKind, template);
    const generateData = await runtime.buildGenerateData([{ role: 'user', content: prompt }], profile);
    const response = await generateStmbText({ generateData });
    const compacted = String(response?.text || '').trim();
    if (!compacted) throw new Error(tr('Compaction returned empty content.'));
    return compacted;
}

async function showCompactionPromptEditorPopup() {
    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Compaction Prompt'))}</h3>
        <div class="world_entry_form_control">
            <textarea id="stmb-compaction-prompt-template" class="text_pole textarea_compact" rows="18">${escapeHtml(getCompactionPromptTemplate())}</textarea>
        </div>
        <div class="buttons_block gap10px">
            <button id="stmb-compaction-save-prompt" type="button" class="menu_button">${escapeHtml(tr('Save Prompt'))}</button>
            <button id="stmb-compaction-reset-prompt" type="button" class="menu_button">${escapeHtml(tr('Reset to Default'))}</button>
            <button id="stmb-compaction-cancel-prompt" type="button" class="menu_button">${escapeHtml(tr('Cancel'))}</button>
        </div>
    `);
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: false,
    });
    const showPromise = popup.show();
    const textarea = popup.dlg?.querySelector('#stmb-compaction-prompt-template');

    popup.dlg?.querySelector('#stmb-compaction-save-prompt')?.addEventListener('click', () => {
        const nextTemplate = textarea?.value || '';
        const error = validateCompactionPromptTemplate(nextTemplate);
        if (error) {
            toastr.error(error, 'STMB');
            return;
        }
        setCompactionPromptTemplate(nextTemplate);
        popup.completeAffirmative();
    });
    popup.dlg?.querySelector('#stmb-compaction-reset-prompt')?.addEventListener('click', () => {
        if (textarea) {
            textarea.value = DEFAULT_COMPACTION_PROMPT_TEMPLATE;
            textarea.focus();
        }
    });
    popup.dlg?.querySelector('#stmb-compaction-cancel-prompt')?.addEventListener('click', () => {
        popup.completeCancelled();
    });

    return await showPromise === POPUP_RESULT.AFFIRMATIVE;
}

function populateCompactionPromptButton(popup) {
    const container = popup.dlg?.querySelector('#stmb-compaction-prompt-buttons');
    if (!container) return;
    container.innerHTML = '';
    const button = document.createElement('div');
    button.className = 'menu_button interactable whitespacenowrap';
    button.id = 'stmb-edit-compaction-prompt';
    button.textContent = tr('Edit Compaction Prompt');
    button.addEventListener('click', () => {
        void showCompactionPromptEditorPopup();
    });
    container.appendChild(button);
}

async function showCompactionRequestPopup(entry, originalContent, entryKind) {
    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Compaction'))}</h3>
        <div class="stmb-compact-review">
            ${buildCompactionProfileControl('stmb-compaction-request-profile-select')}
            <div id="stmb-compaction-prompt-buttons" class="buttons_block justifyCenter gap10px whitespacenowrap"></div>
            <div class="world_entry_form_control">
                <h4>${escapeHtml(tr('Original content'))} (${estimateTokens(originalContent)} ${escapeHtml(tr('Estimated tokens'))})</h4>
                <textarea class="text_pole stmb-clip-preview" readonly>${escapeHtml(originalContent)}</textarea>
            </div>
        </div>
    `);
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: tr('Compact Entry'),
        cancelButton: tr('Cancel'),
    });
    const showPromise = popup.show();
    populateCompactionPromptButton(popup);
    initializeCompactionProfileSelect(popup, 'stmb-compaction-request-profile-select');
    popup.dlg?.querySelector('#stmb-compaction-request-profile-select')?.addEventListener('change', event => {
        setCompactionProfileIndex(readIntInput(event.target, getCompactionProfileIndex()));
    });
    const result = await showPromise;
    if (result !== POPUP_RESULT.AFFIRMATIVE || !entry || !entryKind) {
        return { confirmed: false, profileIndex: getCompactionProfileIndex() };
    }

    const profileIndex = getCompactionProfileIndexFromSelect(popup, 'stmb-compaction-request-profile-select');
    setCompactionProfileIndex(profileIndex);
    return { confirmed: true, profileIndex };
}

function notifyCompactionRequestSettled(options) {
    if (typeof options?.onCompactionRequestSettled !== 'function') return;
    try {
        options.onCompactionRequestSettled();
    } catch (error) {
        console.warn(`${MODULE_NAME}: Failed to clear Compaction loading state:`, error);
    }
}

export async function showCompactReviewPopup(lorebookName, lorebookData, entry, options = {}) {
    if (!entry || !lorebookName || !lorebookData) return false;
    const originalContent = options.pendingContent != null ? String(options.pendingContent) : String(entry.content || '');
    const entryKind = getCompactionEntryKind(entry);
    if (!entryKind) return false;
    let profileIndex = options.profileIndex ?? getCompactionProfileIndex();

    if (!options.skipPromptStep) {
        const requestResult = await showCompactionRequestPopup(entry, originalContent, entryKind);
        if (!requestResult.confirmed) return false;
        profileIndex = requestResult.profileIndex;
    }

    let compacted = '';
    try {
        compacted = await requestCompaction({ ...entry, content: originalContent }, entryKind, getCompactionPromptTemplate(), profileIndex);
    } catch (error) {
        notifyCompactionRequestSettled(options);
        console.error(`${MODULE_NAME}: Compaction failed:`, error);
        toastr.error(error?.message || tr('Compaction failed.'), 'STMB');
        return false;
    }
    notifyCompactionRequestSettled(options);

    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Compaction'))}</h3>
        <div class="stmb-compact-review">
            <div class="world_entry_form_control">
                <h4>${escapeHtml(tr('Original content'))} (${estimateTokens(originalContent)} ${escapeHtml(tr('Estimated tokens'))})</h4>
                <textarea class="text_pole stmb-clip-preview" readonly>${escapeHtml(originalContent)}</textarea>
            </div>
            <div class="world_entry_form_control">
                <h4>${escapeHtml(tr('Compacted draft'))} (${estimateTokens(compacted)} ${escapeHtml(tr('Estimated tokens'))})</h4>
                <textarea id="stmb-compact-content" class="text_pole stmb-clip-preview">${escapeHtml(compacted)}</textarea>
            </div>
            <div class="buttons_block gap10px">
                <button id="stmb-copy-compacted" type="button" class="menu_button">${escapeHtml(tr('Copy Compacted Draft'))}</button>
            </div>
        </div>
    `);

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: tr('Replace with Compacted Version'),
        cancelButton: tr('Cancel'),
    });
    const showPromise = popup.show();
    popup.dlg?.querySelector('#stmb-copy-compacted')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(popup.dlg?.querySelector('#stmb-compact-content')?.value || compacted);
            toastr.success(tr('Copied compacted text.'), 'STMB');
        } catch {
            toastr.error(tr('Copy failed'), 'STMB');
        }
    });
    const result = await showPromise;
    if (result !== POPUP_RESULT.AFFIRMATIVE) return false;

    const replacement = popup.dlg?.querySelector('#stmb-compact-content')?.value?.trim() || '';
    if (!replacement) {
        toastr.error(tr('Compaction returned empty content.'), 'STMB');
        return false;
    }

    await updateLorebookEntryByUid(lorebookName, lorebookData, entry, { content: replacement });
    toastr.success(tr('Entry content replaced.'), 'STMB');
    return true;
}

function getDefaultCompactionLorebookName() {
    const runtimeDefault = String(runtime.getDefaultLorebookName?.() || '').trim();
    if (runtimeDefault && Array.isArray(world_names) && world_names.includes(runtimeDefault)) return runtimeDefault;

    const chatLorebook = String(chat_metadata?.[METADATA_KEY] || '').trim();
    return chatLorebook && Array.isArray(world_names) && world_names.includes(chatLorebook) ? chatLorebook : '';
}

async function loadCompactionEntriesForLorebook(lorebookName) {
    if (!lorebookName) return { lorebookName: '', lorebookData: null, entries: [] };
    const lorebookData = await loadWorldInfo(lorebookName);
    const entries = Object.values(lorebookData?.entries || {})
        .filter(entry => isReviewableCompactionEntry(entry))
        .sort((a, b) => String(a.comment || '').localeCompare(String(b.comment || '')));
    return { lorebookName, lorebookData, entries };
}

function initializeCompactionLorebookSelect(popup) {
    if (!window.jQuery || typeof window.jQuery.fn.select2 !== 'function') return;
    const $select = window.jQuery('#stmb-compaction-lorebook-select');
    if (!$select.length) return;
    if ($select.hasClass('select2-hidden-accessible')) $select.select2('destroy');
    $select.select2({
        width: '100%',
        placeholder: tr('Select a Memory Book...'),
        allowClear: false,
        dropdownParent: window.jQuery(popup.dlg),
    });
}

function buildCompactionEntryRows(entries) {
    return entries.map(entry => {
        const entryKind = getCompactionEntryKind(entry);
        return `
            <tr data-entry-uid="${escapeHtml(String(entry.uid))}">
                <td>${escapeHtml(entry.comment || '')}</td>
                <td>${escapeHtml(getCompactionEntryKindLabel(entryKind))}</td>
                <td>${estimateTokens(entry.content || '')}</td>
                <td><button type="button" class="menu_button stmb-review-entry-action"><i class="fa-solid fa-compress-alt stmb-review-entry-action-icon" aria-hidden="true"></i><span class="stmb-review-entry-action-label">${escapeHtml(tr('Compact Entry'))}</span></button></td>
            </tr>
        `;
    }).join('');
}

function setCompactionEntryActionLoading(button, isLoading) {
    if (!button) return;
    const icon = button.querySelector('.stmb-review-entry-action-icon');
    const label = button.querySelector('.stmb-review-entry-action-label');
    button.disabled = isLoading;
    button.toggleAttribute('aria-busy', isLoading);
    if (icon) {
        icon.className = isLoading
            ? 'fa-solid fa-spinner fa-spin stmb-review-entry-action-icon'
            : 'fa-solid fa-compress-alt stmb-review-entry-action-icon';
    }
    if (label) {
        label.textContent = isLoading ? tr('Compacting...') : tr('Compact Entry');
    }
}

export async function showStmbEntryReviewPopup() {
    if (!Array.isArray(world_names) || world_names.length === 0) {
        toastr.error(tr('No Memory Books were found.'), 'STMB');
        return;
    }

    const defaultLorebookName = getDefaultCompactionLorebookName();
    const lorebookOptions = [
        '<option></option>',
        ...world_names.map(name => `<option value="${escapeHtml(name)}"${name === defaultLorebookName ? ' selected' : ''}>${escapeHtml(name)}</option>`),
    ].join('');

    const popup = new Popup(DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Compaction'))}</h3>
        <div class="world_entry_form_control">
            <h4>${escapeHtml(tr('Memory Book'))}</h4>
            <select id="stmb-compaction-lorebook-select" class="text_pole">${lorebookOptions}</select>
        </div>
        ${buildCompactionProfileControl('stmb-compaction-profile-select')}
        <div id="stmb-compaction-prompt-buttons" class="buttons_block justifyCenter gap10px whitespacenowrap"></div>
        <div class="world_entry_form_control">
            <table class="stmb-review-entries">
                <thead>
                    <tr>
                        <th>${escapeHtml(tr('Entry'))}</th>
                        <th>${escapeHtml(tr('Type'))}</th>
                        <th>${escapeHtml(tr('Tokens'))}</th>
                        <th>${escapeHtml(tr('Action'))}</th>
                    </tr>
                </thead>
                <tbody id="stmb-compaction-entry-body">
                    <tr><td colspan="4" class="opacity70p">${escapeHtml(defaultLorebookName ? '' : tr('Select a Memory Book to see eligible entries.'))}</td></tr>
                </tbody>
            </table>
        </div>
    `), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: tr('Close'),
    });

    let currentLorebookName = '';
    let currentLorebookData = null;
    let currentEntries = [];

    const renderEntries = (message = '') => {
        const tbody = popup.dlg?.querySelector('#stmb-compaction-entry-body');
        if (!tbody) return;
        if (message) {
            tbody.innerHTML = `<tr><td colspan="4" class="opacity70p">${escapeHtml(message)}</td></tr>`;
            return;
        }
        tbody.innerHTML = buildCompactionEntryRows(currentEntries)
            || `<tr><td colspan="4" class="opacity70p">${escapeHtml(tr('No entries eligible for Compaction were found in this Memory Book.'))}</td></tr>`;
    };

    const loadSelectedLorebook = async lorebookName => {
        currentLorebookName = lorebookName || '';
        currentLorebookData = null;
        currentEntries = [];
        if (!currentLorebookName) {
            renderEntries(tr('Select a Memory Book to see eligible entries.'));
            return;
        }

        try {
            const loaded = await loadCompactionEntriesForLorebook(currentLorebookName);
            currentLorebookData = loaded.lorebookData;
            currentEntries = loaded.entries;
            renderEntries();
        } catch (error) {
            console.error(`${MODULE_NAME}: Failed to load compaction lorebook:`, error);
            currentLorebookData = null;
            currentEntries = [];
            renderEntries(tr('Compaction failed.'));
        }
    };

    const showPromise = popup.show();
    populateCompactionPromptButton(popup);
    initializeCompactionLorebookSelect(popup);
    initializeCompactionProfileSelect(popup, 'stmb-compaction-profile-select');
    popup.dlg?.querySelector('#stmb-compaction-profile-select')?.addEventListener('change', event => {
        setCompactionProfileIndex(readIntInput(event.target, getCompactionProfileIndex()));
    });
    popup.dlg?.querySelector('#stmb-compaction-lorebook-select')?.addEventListener('change', event => {
        void loadSelectedLorebook(event.target.value || '');
    });
    popup.dlg?.addEventListener('click', async event => {
        const button = event.target.closest('.stmb-review-entry-action');
        if (!button || button.disabled) return;
        const row = button.closest('tr[data-entry-uid]');
        const uid = row?.dataset?.entryUid;
        const entry = findEntryByUid(currentLorebookData, uid);
        if (!entry) return;

        setCompactionEntryActionLoading(button, true);
        let loadingCleared = false;
        const clearLoadingState = () => {
            if (loadingCleared) return;
            loadingCleared = true;
            setCompactionEntryActionLoading(button, false);
        };
        let replaced = false;
        try {
            const profileIndex = getCompactionProfileIndexFromSelect(popup, 'stmb-compaction-profile-select');
            setCompactionProfileIndex(profileIndex);
            replaced = await showCompactReviewPopup(currentLorebookName, currentLorebookData, entry, {
                skipPromptStep: true,
                profileIndex,
                onCompactionRequestSettled: clearLoadingState,
            });
        } finally {
            clearLoadingState();
        }
        if (replaced) {
            currentEntries = Object.values(currentLorebookData?.entries || {})
                .filter(item => isReviewableCompactionEntry(item))
                .sort((a, b) => String(a.comment || '').localeCompare(String(b.comment || '')));
            renderEntries();
        }
    });
    await loadSelectedLorebook(defaultLorebookName);
    await showPromise;
}
