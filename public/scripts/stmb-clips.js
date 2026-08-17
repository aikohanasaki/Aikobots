import { chat_metadata, saveSettingsDebounced } from '../script.js';
import { DOMPurify } from '../lib.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { stableHashString } from './hashing.js';
import { getCurrentLocale, translate } from './i18n.js';
import { createStmbEntry, generateStmbText, updateStmbEntryByUid } from './stmb-api.js';
import { compiledSceneToText, STMB_DEFAULT_COMPACTION_PROMPT_TEMPLATE } from './stmb-core.js';
import { buildStmbSceneContext, captureStmbSceneRange, fetchStmbChatRangeInfo } from './stmb-scene.js';
import { syncStmbLocalizedPromptFields } from './stmb-prompt-default-migration.js';
import {
    CLIP_LONG_ENTRY_TOKEN_THRESHOLD,
    CLIP_REVIEW_REQUIRES_REVIEW,
    isLongClipEntryContent,
    matchesClipReviewTargetIdentity,
    resolveTopicalClipSaveResult,
} from './stmb-clip-review-policy.js';
import { isSidePromptEntryTitle } from './stmb-sideprompts.js';
import { escapeHtml, withGoBackButton } from './utils.js';
import { getLorebookStorageForRequest, isReservedTemplateWorldName, loadWorldInfo, METADATA_KEY, reloadEditor, world_names, worldInfoCache } from './world-info.js';
import { refreshStmbMacroCache } from './stmb-macros.js';

const MODULE_NAME = 'STMB Clips';
const CREATE_NEW_VALUE = '__stmb_create_new_clip_entry__';
const FLOATING_CLIP_X_OFFSET = 6;
const FLOATING_CLIP_Y_OFFSET = -4;
const FLOATING_CLIP_VIEWPORT_PADDING = 8;

function getSelectableLorebookNames() {
    return (Array.isArray(world_names) ? world_names : []).filter(name => (
        !isReservedTemplateWorldName(name) && getLorebookStorageForRequest(name) === 'user'
    ));
}

export const DEFAULT_COMPACTION_PROMPT_TEMPLATE = STMB_DEFAULT_COMPACTION_PROMPT_TEMPLATE;
export const DEFAULT_TOPICAL_CLIP_PROMPT_TEMPLATE = `SYSTEM: You are a memory compiler. You are writing a focused memory entry (lorebook/Clip) about a SINGLE topic.

Mode: {{MODE}}
Topic: {{TOPIC}}
Keywords: {{KEYWORDS}}

Existing Clip content (if updating):
{{EXISTING_CLIP}}

Source memories:
{{SOURCE_MEMORIES}}

Source chat messages:
{{SOURCE_MESSAGES}}

---

TASK:
Produce a finished memory entry containing ONLY information directly relevant to {{TOPIC}}.
Organize the output by sub-topic or attribute — NOT by chronology or narrative order.
Each piece of information should stand on its own as a discrete, retrievable fact.

OUTPUT FORMAT:
Write in tight, factual prose, bullet points, or labeled attribute blocks (your choice, whichever is denser).

CONTENT RULES:
- Gather all facts concerning this topic.
- Include: concrete facts, names, relationships, preferences, places, constraints, promises, secrets, unresolved issues, and meaningful changes over time from either source section.
- Exclude: events, context, or details unrelated to {{TOPIC}} even if they appear in the source memories.
- Resolve later information against earlier information. Distinguish current state, completed events, decisions, unresolved issues, and future plans.
- Conflicts: if source memories contradict each other, first review if it is a correction or a true contradiction. Corrections can be made directly. If contradictory information is found, note the conflict explicitly (e.g. "Claimed X in one account, Y in another") rather than silently picking one.
- Preserve objective details where available.
- Token-efficiency is important: prefer concise phrasing, avoid filler, and remove redundancy. Be as concise and informationally dense as possible.

IF UPDATING AN EXISTING CLIP:
- Preserve useful existing content unless source memories clearly correct or supersede it.
- Merge in new relevant details; remove redundancy.
- Do not regress — the result should be strictly more useful than the existing Clip.

Return only the finished entry content. No JSON, no title field, no keyword field, no wrapper markers.

CRITICAL:
- Do not greet the user.
- Do not ask clarifying questions.
- Do not offer alternative directions or options.
- Do not explain what you are about to do.
- Begin your response with the first word of the memory entry itself.
- If the provided source material contains insufficient information to write an entry, return only: [INSUFFICIENT DATA: <one sentence reason>]
- Any response that is not the finished entry or the insufficient-data marker is a failure.`;
export const STMB_CLIP_TITLE_SUFFIX = ' [STMB Clip]';

let floatingClipButton = null;
let floatingClipListenersBound = false;
let floatingClipUpdateTimer = null;
let runtime = {};

export function configureStmbClipRuntime(nextRuntime = {}) {
    runtime = { ...runtime, ...nextRuntime };
    syncLocalizedUtilityPrompts();
}

function tr(fallback, key = fallback) {
    return translate(fallback, key);
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

function getLocalizedCompactionPromptTemplate() {
    return translate(DEFAULT_COMPACTION_PROMPT_TEMPLATE, 'STMemoryBooks_Compaction_DefaultPrompt');
}

function getLocalizedTopicalClipPromptTemplate() {
    // The reference commit intentionally ships no translated message-aware Topical Clip prompt.
    return DEFAULT_TOPICAL_CLIP_PROMPT_TEMPLATE;
}

/** Localizes unchanged built-in utility prompts while retaining customized templates. */
function syncLocalizedUtilityPrompts({ persist = true } = {}) {
    if (typeof runtime.getSettings !== 'function') return;

    const settings = getModuleSettings();
    const records = {
        compaction: {
            prompt: typeof settings.compactionPromptTemplate === 'string' && settings.compactionPromptTemplate.trim()
                ? settings.compactionPromptTemplate
                : DEFAULT_COMPACTION_PROMPT_TEMPLATE,
        },
        topicalClip: {
            prompt: typeof settings.topicalClipPromptTemplate === 'string' && settings.topicalClipPromptTemplate.trim()
                ? settings.topicalClipPromptTemplate
                : DEFAULT_TOPICAL_CLIP_PROMPT_TEMPLATE,
        },
    };
    const result = syncStmbLocalizedPromptFields(
        records,
        {
            compaction: { prompt: getLocalizedCompactionPromptTemplate() },
            topicalClip: { prompt: getLocalizedTopicalClipPromptTemplate() },
        },
        {
            compaction: { prompt: DEFAULT_COMPACTION_PROMPT_TEMPLATE },
            topicalClip: { prompt: DEFAULT_TOPICAL_CLIP_PROMPT_TEMPLATE },
        },
        settings.builtinUtilityPromptState,
        getCurrentLocale(),
    );

    if (settings.compactionPromptTemplate !== records.compaction.prompt) {
        settings.compactionPromptTemplate = records.compaction.prompt;
        result.changed = true;
    }
    if (settings.topicalClipPromptTemplate !== records.topicalClip.prompt) {
        settings.topicalClipPromptTemplate = records.topicalClip.prompt;
        result.changed = true;
    }
    settings.builtinUtilityPromptState = result.state;
    if (result.changed && persist) {
        persistSettings();
    }
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
    void refreshStmbMacroCache(lorebookName, lorebookData);
    if (shouldRefreshEditor()) {
        try {
            await Promise.resolve(reloadEditor(lorebookName));
        } catch (error) {
            console.warn(`${MODULE_NAME}: refreshEditor failed`, error);
        }
    }
}

async function createClipLorebookEntry(lorebookName, lorebookData, { title, content, activation, keywords, metadataUpdates = {} }) {
    if (getClipEntryByFinalTitle(lorebookData, title)) {
        throw new Error(tr('A clip entry with this title already exists.'));
    }

    const result = await createStmbEntry({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        title,
        content,
        metadataUpdates,
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

async function updateLorebookEntryByUid(lorebookName, lorebookData, entry, { title, content, metadataUpdates = {}, entryOverrides = {}, expectedContentHash = '', expectedTitle = '', expectedClipType = '' }) {
    if (!entry || entry.uid === undefined || entry.uid === null) {
        throw new Error(tr('Selected clip entry was not found.'));
    }

    const result = await updateStmbEntryByUid({
        lorebookName,
        storage: getLorebookStorageForRequest(lorebookName),
        uid: entry.uid,
        title,
        content,
        expectedContentHash,
        expectedTitle,
        expectedClipType,
        metadataUpdates,
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
        if (tokenWarning) tokenWarning.hidden = !isLongClipEntryContent(preview);
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
    if (!isLongClipEntryContent(content)) return true;

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
    button.classList.add('stmb_floating_clip_button', 'fa-solid', 'fa-scissors', 'interactable');
    button.title = tr('Clip highlighted text to Memory Book');
    button.setAttribute('role', 'button');
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
        : getLocalizedCompactionPromptTemplate();
}

function setCompactionPromptTemplate(template) {
    getModuleSettings().compactionPromptTemplate = String(template || '');
    syncLocalizedUtilityPrompts({ persist: false });
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

function buildCompactionProfileControl(selectId, options = {}) {
    const label = options.label || tr('Compaction Profile');
    return `
        <div class="world_entry_form_control">
            <h4>${escapeHtml(label)}</h4>
            <select id="${escapeHtml(selectId)}" class="text_pole stmb-compaction-profile-select">
                ${buildCompactionProfileOptions()}
            </select>
        </div>
    `;
}

function initializeCompactionProfileSelect(popup, selectId, options = {}) {
    const select = popup.dlg?.querySelector(`#${selectId}`);
    if (!select || !window.jQuery || typeof window.jQuery.fn.select2 !== 'function') return;
    const $select = window.jQuery(select);
    if ($select.hasClass('select2-hidden-accessible')) $select.select2('destroy');
    $select.select2({
        width: '100%',
        placeholder: options.placeholder || tr('Select a Compaction profile...'),
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

    return String(template || getLocalizedCompactionPromptTemplate()).replace(
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
            textarea.value = getLocalizedCompactionPromptTemplate();
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

async function showCompactionRequestPopup(entry, originalContent, entryKind, options = {}) {
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
    const popupOptions = {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: tr('Compact Entry'),
        cancelButton: tr('Cancel'),
    };
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', options.showGoBack ? withGoBackButton(popupOptions) : popupOptions);
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
        const requestResult = await showCompactionRequestPopup(entry, originalContent, entryKind, options);
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

    const popupOptions = {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: tr('Replace with Compacted Version'),
        cancelButton: tr('Cancel'),
    };
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', options.showGoBack ? withGoBackButton(popupOptions) : popupOptions);
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
    if (runtimeDefault && Array.isArray(world_names) && world_names.includes(runtimeDefault) && !isReservedTemplateWorldName(runtimeDefault)) return runtimeDefault;

    const chatLorebook = String(chat_metadata?.[METADATA_KEY] || '').trim();
    return chatLorebook && Array.isArray(world_names) && world_names.includes(chatLorebook) && !isReservedTemplateWorldName(chatLorebook) ? chatLorebook : '';
}

async function loadCompactionEntriesForLorebook(lorebookName) {
    if (!lorebookName) return { lorebookName: '', lorebookData: null, entries: [] };
    const lorebookData = await loadWorldInfo(lorebookName);
    const entries = Object.values(lorebookData?.entries || {})
        .filter(entry => isReviewableCompactionEntry(entry))
        .sort((a, b) => String(a.comment || '').localeCompare(String(b.comment || '')));
    return { lorebookName, lorebookData, entries };
}

function initializeCompactionLorebookSelect(popup, selectId = 'stmb-compaction-lorebook-select', options = {}) {
    if (!window.jQuery || typeof window.jQuery.fn.select2 !== 'function') return;
    const select = popup.dlg?.querySelector(`#${selectId}`);
    if (!select) return;
    const $select = window.jQuery(select);
    if (!$select.length) return;
    if ($select.hasClass('select2-hidden-accessible')) $select.select2('destroy');
    $select.select2({
        width: '100%',
        placeholder: options.placeholder || tr('Select a Memory Book...'),
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

function getTopicalClipPromptTemplate() {
    const saved = getModuleSettings().topicalClipPromptTemplate;
    return typeof saved === 'string' && saved.trim()
        ? saved
        : getLocalizedTopicalClipPromptTemplate();
}

function setTopicalClipPromptTemplate(template) {
    getModuleSettings().topicalClipPromptTemplate = String(template || '');
    syncLocalizedUtilityPrompts({ persist: false });
    persistSettings();
}

function validateTopicalClipPromptTemplate(template, sourceOptions = {}) {
    const value = String(template || '');
    if (!value.trim()) return tr('Prompt cannot be empty');
    if (sourceOptions.includeMemories !== false && !value.includes('{{SOURCE_MEMORIES}}')) {
        return tr('The Topical Clip prompt must include {{SOURCE_MEMORIES}}.');
    }
    if (sourceOptions.includeMessages === true && !value.includes('{{SOURCE_MESSAGES}}')) {
        return tr('The Topical Clip prompt must include {{SOURCE_MESSAGES}} when chat messages are selected.', 'STMemoryBooks_TopicalClip_PromptMissingSourceMessages');
    }
    return null;
}

function formatTopicalMessage(template, params = {}) {
    return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name) => {
        const value = params[name];
        return value === undefined || value === null ? '' : String(value);
    });
}

function makeTopicalClipHeadline(topic) {
    return `About ${validateClipHeadline(topic)}`;
}

function stripTopicalClipDraftFence(body) {
    const raw = String(body || '').trim();
    const fullFence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fullFence) return fullFence[1].trim();

    const jsonFence = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    return jsonFence ? jsonFence[1].trim() : raw;
}

function extractTopicalClipDraftContent(body) {
    const raw = stripTopicalClipDraftFence(body);
    if (!raw) return '';

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.content === 'string') {
            return parsed.content.trim();
        }
    } catch {
        // Non-JSON drafts are expected; use the raw model text.
    }

    return raw;
}

function normalizeTopicalClipDraftBody(body, headline) {
    const raw = extractTopicalClipDraftContent(body);
    if (!raw) return '';
    const startMarker = makeClipStartMarker(headline);
    const endMarker = makeClipEndMarker(headline);
    const startIndex = raw.indexOf(startMarker);
    const endIndex = raw.indexOf(endMarker);
    if (startIndex >= 0 && endIndex > startIndex) {
        return raw.slice(startIndex + startMarker.length, endIndex).trim();
    }
    return stripWrapperMarkerLines(raw);
}

export function createTopicalClipEntryContent(headline, body) {
    const cleanHeadline = validateClipHeadline(headline);
    const cleanBody = normalizeTopicalClipDraftBody(body, cleanHeadline);
    if (!cleanBody) {
        throw new Error(tr('Generated draft is empty.'));
    }
    return `${makeClipStartMarker(cleanHeadline)}\n\n${cleanBody}\n\n${makeClipEndMarker(cleanHeadline)}`;
}

function getEntryStableId(entry) {
    const id = entry?.uid ?? entry?.id ?? null;
    return id === undefined || id === null ? null : String(id);
}

function getEntrySortValue(entry) {
    const displayIndex = Number(entry?.displayIndex);
    if (Number.isFinite(displayIndex)) return displayIndex;
    const order = Number(entry?.order);
    if (Number.isFinite(order)) return order;
    const uid = Number(entry?.uid ?? entry?.id);
    return Number.isFinite(uid) ? uid : 0;
}

function getEntryKeys(entry) {
    return Array.isArray(entry?.key) ? entry.key.map(key => String(key || '').trim()).filter(Boolean) : [];
}

function getTopicalSourceSelectionKey(entry) {
    const stableId = getEntryStableId(entry);
    return stableId || stableHashTopicalSourceEntry(entry);
}

function stableHashTopicalSourceEntry(entry) {
    return stableHashString(JSON.stringify({
        uid: entry?.uid ?? null,
        id: entry?.id ?? null,
        title: entry?.comment ?? entry?.title ?? '',
        keys: getEntryKeys(entry),
        content: entry?.content ?? '',
    }));
}

function snapshotTopicalSourceEntries(entries) {
    return (entries || []).map(entry => ({
        uid: entry?.uid ?? entry?.id ?? null,
        hash: stableHashTopicalSourceEntry(entry),
        title: String(entry?.comment ?? entry?.title ?? ''),
    }));
}

function buildTopicalSnapshotMap(snapshot) {
    const map = new Map();
    for (const item of Array.isArray(snapshot) ? snapshot : []) {
        const uid = item?.uid ?? null;
        const key = uid === null || uid === undefined ? String(item?.hash || '') : String(uid);
        if (!key) continue;
        map.set(key, String(item?.hash || ''));
    }
    return map;
}

function buildTopicalProcessedSourceSnapshot(allEligibleEntries, targetEntry, processedEntries) {
    const processedKeys = new Set((processedEntries || []).map(getTopicalSourceSelectionKey));
    if (processedKeys.size === 0) return [];

    const previousMetadata = getTopicalClipMetadata(targetEntry);
    const previous = buildTopicalSnapshotMap(previousMetadata?.last_source_snapshot);

    return (allEligibleEntries || [])
        .map(entry => {
            const uid = entry?.uid ?? entry?.id ?? null;
            const key = uid === null || uid === undefined ? stableHashTopicalSourceEntry(entry) : String(uid);
            const currentHash = stableHashTopicalSourceEntry(entry);
            const previousHash = previous.get(key);
            const processed = processedKeys.has(getTopicalSourceSelectionKey(entry));
            if (!processed && !previousHash) return null;
            return {
                uid,
                hash: processed ? currentHash : previousHash,
                title: String(entry?.comment ?? entry?.title ?? ''),
            };
        })
        .filter(Boolean);
}

function getTopicalClipMetadata(entry) {
    return entry?.data?.extensions?.aikobots?.topical_clip || null;
}

function buildEntryDataWithTopicalMetadata(entry, metadata) {
    const data = entry?.data && typeof entry.data === 'object' && !Array.isArray(entry.data)
        ? structuredClone(entry.data)
        : {};
    data.extensions = data.extensions && typeof data.extensions === 'object' && !Array.isArray(data.extensions)
        ? data.extensions
        : {};
    data.extensions.aikobots = data.extensions.aikobots && typeof data.extensions.aikobots === 'object' && !Array.isArray(data.extensions.aikobots)
        ? data.extensions.aikobots
        : {};
    data.extensions.aikobots.topical_clip = metadata;
    return data;
}

function isSameEntry(left, right) {
    const leftId = getEntryStableId(left);
    const rightId = getEntryStableId(right);
    return leftId !== null && rightId !== null && leftId === rightId;
}

function findEntryByStableId(lorebookData, id) {
    const wanted = id === undefined || id === null ? null : String(id);
    if (!wanted) return null;
    return Object.values(lorebookData?.entries || {})
        .find(entry => getEntryStableId(entry) === wanted) || null;
}

function isTopicalSourceMemoryEntry(entry) {
    if (entry?.stmemorybooks !== true) return false;
    if (isClipEntryTitle(entry?.comment || '')) return false;
    if (isSidePromptEntryTitle(entry?.comment || '')) return false;
    return true;
}

function getTopicalSourceEntries(lorebookData, targetEntry = null) {
    return Object.values(lorebookData?.entries || {})
        .filter(entry => isTopicalSourceMemoryEntry(entry) && (!targetEntry || !isSameEntry(entry, targetEntry)))
        .sort((a, b) => getEntrySortValue(a) - getEntrySortValue(b) || String(a.comment || '').localeCompare(String(b.comment || '')));
}

function getTopicalChangedSourceEntries(allEligibleEntries, targetEntry, rebuildAll) {
    if (rebuildAll || !targetEntry) return allEligibleEntries;
    const metadata = getTopicalClipMetadata(targetEntry);
    if (!metadata?.last_source_snapshot) return allEligibleEntries;
    const previous = buildTopicalSnapshotMap(metadata.last_source_snapshot);
    return allEligibleEntries.filter(entry => {
        const uid = getEntryStableId(entry);
        const hash = stableHashTopicalSourceEntry(entry);
        const key = uid || hash;
        return previous.get(key) !== hash;
    });
}

function formatSourceMemoriesForPrompt(entries) {
    return (entries || []).map((entry, index) => {
        const number = String(index + 1).padStart(3, '0');
        const title = String(entry?.comment || entry?.title || tr('Untitled'));
        const keys = getEntryKeys(entry).join(', ');
        const content = String(entry?.content || '').trim();
        return [
            `=== SOURCE MEMORY ${number} ===`,
            `UID: ${entry?.uid ?? entry?.id ?? ''}`,
            `Title: ${title}`,
            `Keywords: ${keys}`,
            'Content:',
            content,
            `=== END SOURCE MEMORY ${number} ===`,
        ].join('\n');
    }).join('\n\n');
}

function extractClipInnerContent(entry) {
    const content = String(entry?.content || '');
    const headline = getClipHeadlineFromTitle(entry?.comment || '');
    const startMarker = makeClipStartMarker(headline);
    const endMarker = makeClipEndMarker(headline);
    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);
    if (startIndex >= 0 && endIndex > startIndex) {
        return content.slice(startIndex + startMarker.length, endIndex).trim();
    }
    return stripWrapperMarkerLines(content);
}

function buildTopicalClipPrompt({ mode, topic, keywords, sourceEntries, sourceMessages = null, existingClip, template = getTopicalClipPromptTemplate() }) {
    const replacements = {
        MODE: String(mode || ''),
        TOPIC: String(topic || ''),
        KEYWORDS: (keywords || []).join(', '),
        SOURCE_MEMORIES: formatSourceMemoriesForPrompt(sourceEntries),
        SOURCE_MESSAGES: sourceMessages ? compiledSceneToText(sourceMessages) : '',
        EXISTING_CLIP: String(existingClip || ''),
        EXISTING_ENTRY_CONTENT: String(existingClip || ''),
    };
    return String(template || getLocalizedTopicalClipPromptTemplate()).replace(
        /\{\{(MODE|TOPIC|KEYWORDS|SOURCE_MEMORIES|SOURCE_MESSAGES|EXISTING_CLIP|EXISTING_ENTRY_CONTENT)\}\}/g,
        (_match, token) => replacements[token] ?? '',
    );
}

async function requestTopicalClipDraft(prompt, profileIndex) {
    if (typeof runtime.buildGenerateData !== 'function') {
        throw new Error('STMB generation helper is not configured.');
    }

    const profile = runtime.getProfile?.(profileIndex) || null;
    const generateData = await runtime.buildGenerateData([{ role: 'user', content: prompt }], profile);
    const response = await generateStmbText({ generateData });
    const draft = String(response?.text || '').trim();
    if (!draft) throw new Error(tr('Generated draft is empty.'));
    return draft;
}

async function showTopicalClipPromptEditorPopup() {
    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Topical Clip Prompt'))}</h3>
        <div class="world_entry_form_control">
            <textarea id="stmb-topical-clip-prompt-template" class="text_pole textarea_compact" rows="18">${escapeHtml(getTopicalClipPromptTemplate())}</textarea>
        </div>
        <div class="buttons_block gap10px">
            <button id="stmb-topical-clip-save-prompt" type="button" class="menu_button whitespacenowrap">${escapeHtml(tr('Save Prompt'))}</button>
            <button id="stmb-topical-clip-reset-prompt" type="button" class="menu_button whitespacenowrap">${escapeHtml(tr('Reset to Default'))}</button>
            <button id="stmb-topical-clip-cancel-prompt" type="button" class="menu_button whitespacenowrap">${escapeHtml(tr('Cancel'))}</button>
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
    const textarea = popup.dlg?.querySelector('#stmb-topical-clip-prompt-template');

    popup.dlg?.querySelector('#stmb-topical-clip-save-prompt')?.addEventListener('click', () => {
        const nextTemplate = textarea?.value || '';
        const error = validateTopicalClipPromptTemplate(nextTemplate);
        if (error) {
            toastr.error(error, 'STMB');
            return;
        }
        setTopicalClipPromptTemplate(nextTemplate);
        popup.completeAffirmative();
    });
    popup.dlg?.querySelector('#stmb-topical-clip-reset-prompt')?.addEventListener('click', () => {
        if (textarea) {
            textarea.value = getLocalizedTopicalClipPromptTemplate();
            textarea.focus();
        }
    });
    popup.dlg?.querySelector('#stmb-topical-clip-cancel-prompt')?.addEventListener('click', () => {
        popup.completeCancelled();
    });

    return await showPromise === POPUP_RESULT.AFFIRMATIVE;
}

async function confirmTopicalClipTokenException({ estimatedTokens: tokenCount, threshold, eligibleCount, usedCount }) {
    const tokenWarningMessage = formatTopicalMessage(
        'This Topical Clip request is estimated at {{tokens}} tokens, above the warning threshold of {{threshold}}. Eligible source memories: {{eligible}}. Source memories to use: {{used}}.',
        {
            tokens: tokenCount,
            threshold,
            eligible: eligibleCount,
            used: usedCount,
        },
    );
    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Topical Clip token warning'))}</h3>
        <p>${escapeHtml(tokenWarningMessage)}</p>
        <p>${escapeHtml(tr('Raise the token warning threshold in settings, reduce source memories later, or allow this one run to continue.'))}</p>
    `);
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: tr('Cancel'),
        customButtons: [
            { text: tr('Run Once Anyway'), result: POPUP_RESULT.CUSTOM1, appendAtEnd: true },
        ],
    });
    return await popup.show() === POPUP_RESULT.CUSTOM1;
}

function buildTopicalSourceMemorySelectionRows(entries, selectedKeys) {
    return (entries || []).map(entry => {
        const key = getTopicalSourceSelectionKey(entry);
        const title = String(entry?.comment || entry?.title || tr('Untitled'));
        const keywords = getEntryKeys(entry).join(', ');
        const tokenCount = estimateTokens(entry?.content || '');
        const checked = !selectedKeys || selectedKeys.has(key) ? ' checked' : '';
        return `
            <tr>
                <td>
                    <label class="stmb-topical-source-select-label">
                        <input type="checkbox" class="stmb-topical-source-select-checkbox" value="${escapeHtml(key)}"${checked}>
                        <span>${escapeHtml(title)}</span>
                    </label>
                </td>
                <td>${escapeHtml(keywords)}</td>
                <td>${tokenCount}</td>
            </tr>
        `;
    }).join('');
}

async function showTopicalSourceMemorySelectorPopup(entries, selectedKeys = null) {
    const entryCount = Array.isArray(entries) ? entries.length : 0;
    if (entryCount === 0) {
        toastr.error(tr('No source memories are available to select.'), 'STMB');
        return null;
    }

    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Select Memories'))}</h3>
        <p class="opacity70p">${escapeHtml(tr('Choose which source memories to send for this Topical Clip draft.'))}</p>
        <div class="buttons_block justifyCenter gap10px whitespacenowrap">
            <button id="stmb-topical-select-all-sources" type="button" class="menu_button">${escapeHtml(tr('Select All'))}</button>
            <button id="stmb-topical-clear-all-sources" type="button" class="menu_button">${escapeHtml(tr('Clear'))}</button>
        </div>
        <div class="stmb-topical-source-selector">
            <table class="stmb-review-entries">
                <thead>
                    <tr>
                        <th>${escapeHtml(tr('Memory'))}</th>
                        <th>${escapeHtml(tr('Keywords'))}</th>
                        <th>${escapeHtml(tr('Tokens'))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${buildTopicalSourceMemorySelectionRows(entries, selectedKeys)}
                </tbody>
            </table>
        </div>
    `);
    let selected = null;
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: tr('Use Selected'),
        cancelButton: tr('Cancel'),
        onClosing: closingPopup => {
            if (closingPopup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            selected = new Set(checkboxes()
                .filter(checkbox => checkbox.checked)
                .map(checkbox => String(checkbox.value || ''))
                .filter(Boolean));
            if (selected.size > 0) return true;
            toastr.error(tr('Select at least one source memory.'), 'STMB');
            return false;
        },
    });
    const checkboxes = () => Array.from(popup.dlg?.querySelectorAll('.stmb-topical-source-select-checkbox') || []);
    popup.dlg?.querySelector('#stmb-topical-select-all-sources')?.addEventListener('click', () => {
        for (const checkbox of checkboxes()) checkbox.checked = true;
    });
    popup.dlg?.querySelector('#stmb-topical-clear-all-sources')?.addEventListener('click', () => {
        for (const checkbox of checkboxes()) checkbox.checked = false;
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    return selected;
}

function formatLocalTopicalClipTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        '-',
        pad(date.getMonth() + 1),
        '-',
        pad(date.getDate()),
        ' ',
        pad(date.getHours()),
        pad(date.getMinutes()),
    ].join('');
}

function makeDuplicateSafeTopicalFallbackHeadline(lorebookData, topic) {
    const base = `About ${validateClipHeadline(topic)} (Topical Clip ${formatLocalTopicalClipTimestamp()})`;
    let headline = base;
    let suffix = 2;
    while (getClipEntryByFinalTitle(lorebookData, makeClipEntryTitle(headline))) {
        headline = `${base} ${suffix}`;
        suffix += 1;
    }
    return headline;
}

function createTopicalClipRunMetadata({ topic, keywords, lorebookName, sourceSnapshot, messageSource = null }) {
    return {
        version: 2,
        topic,
        keywords,
        source_memory_book: lorebookName,
        last_successful_run_at: new Date().toISOString(),
        last_source_snapshot: sourceSnapshot,
        last_message_source: messageSource,
    };
}

async function saveTopicalClipDraft(context, draft, options = {}) {
    const {
        lorebookName,
        lorebookData,
        mode,
        topic,
        keywords,
        targetUid,
        targetContentHash,
        sourceSnapshot,
        messageSource,
    } = context || {};
    const contentDraft = String(draft || '').trim();
    if (!contentDraft) throw new Error(tr('Generated draft is empty.'));

    const keywordsArray = Array.isArray(keywords) ? keywords : [];
    const freshLorebook = await loadWorldInfo(lorebookName);
    if (!freshLorebook?.entries) throw new Error(tr('Failed to load lorebook'));

    if (mode === 'update' && !options.forceCreateNew) {
        const target = findEntryByStableId(freshLorebook, targetUid);
        if (!target) throw new Error(tr('Choose an entry to update.'));

        const headline = getClipHeadlineFromTitle(target.comment || makeTopicalClipHeadline(topic));
        const metadata = createTopicalClipRunMetadata({
            topic,
            keywords: keywordsArray,
            lorebookName,
            sourceSnapshot,
            messageSource,
        });
        const updated = await updateLorebookEntryByUid(lorebookName, freshLorebook, target, {
            content: createTopicalClipEntryContent(headline, contentDraft),
            expectedContentHash: targetContentHash,
            metadataUpdates: {
                data: buildEntryDataWithTopicalMetadata(target, metadata),
            },
            entryOverrides: {
                key: keywordsArray,
                keysecondary: Array.isArray(target.keysecondary) ? target.keysecondary : [],
                constant: false,
                vectorized: true,
                selective: true,
                disable: false,
            },
        });
        return { mode: 'update', lorebookData: freshLorebook, entry: updated };
    }

    const headline = options.forceCreateNew
        ? makeDuplicateSafeTopicalFallbackHeadline(freshLorebook, topic)
        : makeTopicalClipHeadline(topic);
    const title = makeClipEntryTitle(headline);
    if (getClipEntryByFinalTitle(freshLorebook, title)) {
        throw new Error(tr('An entry with this title already exists. Choose update mode or use a different topic/title.'));
    }
    const metadata = createTopicalClipRunMetadata({
        topic,
        keywords: keywordsArray,
        lorebookName,
        sourceSnapshot,
        messageSource,
    });
    const entry = await createClipLorebookEntry(lorebookName, freshLorebook, {
        title,
        content: createTopicalClipEntryContent(headline, contentDraft),
        activation: 'keyword',
        keywords: keywordsArray,
        metadataUpdates: {
            data: buildEntryDataWithTopicalMetadata(null, metadata),
        },
    });
    if (lorebookData && entry?.uid !== undefined) {
        lorebookData.entries = lorebookData.entries && typeof lorebookData.entries === 'object' ? lorebookData.entries : {};
        lorebookData.entries[entry.uid] = entry;
    }
    return { mode: 'create', lorebookData: freshLorebook, entry };
}

/** Applies one reviewed Clip suggestion using the existing optimistic lorebook update path. */
export async function applyClipReviewSuggestion(lorebookName, candidate, options = {}) {
    const lorebookData = await loadWorldInfo(lorebookName);
    const entry = findEntryByUid(lorebookData, candidate?.uid);
    if (!entry) throw new Error(tr('The suggested Clip no longer exists.', 'STMemoryBooks_ClipReview_TargetMissing'));
    if (!isClipEntryTitle(entry.comment || '')) throw new Error(tr('The suggestion target is no longer an STMB Clip.', 'STMemoryBooks_ClipReview_TargetNotClip'));
    const expectedTitle = String(candidate?.title || '');
    if (!expectedTitle || !matchesClipReviewTargetIdentity(entry, expectedTitle, '')) {
        const error = new Error(tr('The Clip changed after this review. Run Memory Assistance again before applying the suggestion.', 'STMemoryBooks_ClipReview_TargetChanged'));
        error.code = 'CLIP_REVIEW_TARGET_CHANGED';
        throw error;
    }

    const actualType = getTopicalClipMetadata(entry) ? 'topical' : 'ordinary';
    if (candidate?.type !== actualType) {
        throw new Error(tr('The Clip type changed after this review. Run Memory Assistance again.', 'STMemoryBooks_ClipReview_TargetTypeChanged'));
    }
    if (candidate?.contentHash && stableHashString(entry.content || '') !== candidate.contentHash) {
        const error = new Error(tr('The Clip changed after this review. Run Memory Assistance again before applying the suggestion.', 'STMemoryBooks_ClipReview_TargetChanged'));
        error.code = 'CLIP_REVIEW_TARGET_CHANGED';
        throw error;
    }

    const headline = getClipHeadlineFromTitle(entry.comment || '');
    let content = String(entry.content || '');
    let metadataUpdates = {};
    if (candidate.type === 'ordinary') {
        for (const addition of candidate.additions || []) {
            if (hasDuplicateBullet(content, addition?.text)) continue;
            content = buildUpdatedExistingContent({ ...entry, content }, addition?.text, headline);
        }
        if (content === entry.content) return false;
        if (options.deferLongEntryToReview && isLongClipEntryContent(content)) {
            const error = new Error(formatTopicalMessage(tr(
                'Automatic update paused because the resulting Clip is estimated at {{estimatedTokens}} tokens, above the {{threshold}}-token long-entry threshold. Review, compact, or apply it manually.',
                'STMemoryBooks_ClipReview_LongEntryRequiresReview',
            ), {
                estimatedTokens: estimateTokens(content),
                threshold: CLIP_LONG_ENTRY_TOKEN_THRESHOLD,
            }));
            error.code = CLIP_REVIEW_REQUIRES_REVIEW;
            throw error;
        }
        if (!options.deferLongEntryToReview && !await showLongEntryWarning(lorebookName, lorebookData, entry, content)) return false;
    } else {
        content = createTopicalClipEntryContent(headline, candidate.proposedContent);
        const prior = getTopicalClipMetadata(entry) || {};
        metadataUpdates = {
            data: buildEntryDataWithTopicalMetadata(entry, {
                ...prior,
                version: Math.max(2, Number(prior.version || 0)),
                last_successful_run_at: new Date().toISOString(),
                last_message_source: candidate.messageSource || prior.last_message_source || null,
            }),
        };
    }

    await updateLorebookEntryByUid(lorebookName, lorebookData, entry, {
        content,
        expectedContentHash: candidate.contentHash || stableHashString(entry.content || ''),
        expectedTitle,
        expectedClipType: candidate.type,
        metadataUpdates,
    });
    return true;
}

async function confirmTopicalClipTargetChangedCreateNew() {
    const content = DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Selected Clip changed'))}</h3>
        <p>${escapeHtml(tr('The selected Clip changed after this draft was generated. Create a new Topical Clip entry instead, or abort without saving.'))}</p>
    `);
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: tr('Create New Entry'),
        cancelButton: tr('Cancel'),
    });
    return await popup.show() === POPUP_RESULT.AFFIRMATIVE;
}

function buildTopicalClipTargetOptions(entries) {
    return (entries || []).map(entry => {
        const uid = getEntryStableId(entry);
        const keys = getEntryKeys(entry);
        const label = keys.length
            ? `${entry.comment || ''} (${keys.join(', ')})`
            : String(entry.comment || '');
        return `<option value="${escapeHtml(uid || '')}">${escapeHtml(label)}</option>`;
    }).join('');
}

function getTopicalClipTargetEntries(lorebookData) {
    return Object.values(lorebookData?.entries || {})
        .filter(entry => isClipEntryTitle(entry?.comment || ''))
        .sort((a, b) => String(a.comment || '').localeCompare(String(b.comment || '')));
}

function buildTopicalClipPopupHtml(defaultLorebookName) {
    const lorebookOptions = [
        '<option></option>',
        ...getSelectableLorebookNames().map(name => `<option value="${escapeHtml(name)}"${name === defaultLorebookName ? ' selected' : ''}>${escapeHtml(name)}</option>`),
    ].join('');
    const profileControl = buildCompactionProfileControl('stmb-topical-clip-profile-select', {
        label: tr('Generation Profile'),
    });
    return DOMPurify.sanitize(`
        <h3>${escapeHtml(tr('Topical Clip'))}</h3>
        <p class="opacity70p">${escapeHtml(tr('Create or update a focused Clip-style memory entry about one topic.'))}</p>
        <div class="stmb-topical-clip">
            <div class="world_entry_form_control">
                <h4>${escapeHtml(tr('Source Memory Book'))}</h4>
                <select id="stmb-topical-clip-lorebook-select" class="text_pole">
                    ${lorebookOptions}
                </select>
            </div>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Topic'))}</h4>
                <input id="stmb-topical-clip-topic" class="text_pole" type="text" />
            </label>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Keywords'))}</h4>
                <input id="stmb-topical-clip-keywords" class="text_pole" type="text" />
                <small class="opacity70p">${escapeHtml(tr('Saving updates this entry\'s activation keywords. Empty keywords are filled from Topic.'))}</small>
            </label>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Mode'))}</h4>
                <select id="stmb-topical-clip-mode" class="text_pole">
                    <option value="create" selected>${escapeHtml(tr('Create new Topical Clip'))}</option>
                    <option value="update">${escapeHtml(tr('Update existing entry'))}</option>
                </select>
            </label>
            <div id="stmb-topical-clip-target-row" class="world_entry_form_control" hidden>
                <h4>${escapeHtml(tr('Entry to update'))}</h4>
                <select id="stmb-topical-clip-target-select" class="text_pole"></select>
                <small id="stmb-topical-clip-metadata-message" class="opacity70p"></small>
            </div>
            <div id="stmb-topical-clip-rebuild-row" class="world_entry_form_control" hidden>
                <label class="checkbox_label">
                    <input id="stmb-topical-clip-rebuild-all" type="checkbox" />
                    <span>${escapeHtml(tr('Rebuild from all source memories'))}</span>
                </label>
            </div>
            <div class="world_entry_form_control">
                <h4>${escapeHtml(tr('Sources', 'STMemoryBooks_TopicalClip_SourceTypes'))}</h4>
                <label class="checkbox_label"><input id="stmb-topical-clip-include-memories" type="checkbox" checked> <span>${escapeHtml(tr('Include saved Memories', 'STMemoryBooks_TopicalClip_IncludeMemories'))}</span></label>
                <label class="checkbox_label"><input id="stmb-topical-clip-include-messages" type="checkbox"> <span>${escapeHtml(tr('Include chat messages', 'STMemoryBooks_TopicalClip_IncludeMessages'))}</span></label>
            </div>
            <div id="stmb-topical-clip-message-range" class="world_entry_form_control" hidden>
                <h4>${escapeHtml(tr('Message range'))}</h4>
                <div class="flex-container gap10px">
                    <label>${escapeHtml(tr('Start message ID', 'STMemoryBooks_TopicalClip_MessageStart'))}<input id="stmb-topical-clip-message-start" class="text_pole" type="number" min="0" step="1"></label>
                    <label>${escapeHtml(tr('End message ID', 'STMemoryBooks_TopicalClip_MessageEnd'))}<input id="stmb-topical-clip-message-end" class="text_pole" type="number" min="0" step="1"></label>
                </div>
            </div>
            ${profileControl}
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-topical-clip-select-memories" type="button" class="menu_button">${escapeHtml(tr('Select Memories'))}</button>
                <button id="stmb-topical-clip-edit-prompt" type="button" class="menu_button">${escapeHtml(tr('Edit Topical Clip Prompt'))}</button>
            </div>
            <div id="stmb-topical-clip-diagnostics" class="info_block info-block"></div>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-topical-clip-generate" type="button" class="menu_button whitespacenowrap">${escapeHtml(tr('Generate Draft'))}</button>
                <button id="stmb-topical-clip-generate-auto-accept" type="button" class="menu_button whitespacenowrap">${escapeHtml(tr('Generate and Auto-Accept', 'STMemoryBooks_TopicalClip_GenerateAutoAccept'))}</button>
            </div>
            <label class="world_entry_form_control">
                <h4>${escapeHtml(tr('Generated draft'))}</h4>
                <textarea id="stmb-topical-clip-draft" class="text_pole stmb-clip-preview" rows="14"></textarea>
            </label>
            <div class="buttons_block justifyCenter gap10px whitespacenowrap">
                <button id="stmb-topical-clip-save" type="button" class="menu_button whitespacenowrap" disabled>${escapeHtml(tr('Save Topical Clip'))}</button>
            </div>
        </div>
    `);
}

export async function showTopicalClipPopup(options = {}) {
    if (getSelectableLorebookNames().length === 0) {
        toastr.error(tr('No Memory Books were found.'), 'STMB');
        return;
    }

    const requestedLorebookName = String(options.lorebookName || '').trim();
    const defaultLorebookName = getSelectableLorebookNames().includes(requestedLorebookName)
        ? requestedLorebookName
        : getDefaultCompactionLorebookName();
    const popupOptions = {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: tr('Close'),
    };
    const popup = new Popup(
        buildTopicalClipPopupHtml(defaultLorebookName),
        POPUP_TYPE.TEXT,
        '',
        options.showGoBack ? withGoBackButton(popupOptions) : popupOptions,
    );

    let currentLorebookName = '';
    let currentLorebookData = null;
    let generationContext = null;
    let selectedSourceMemoryKeys = null;

    const showPromise = popup.show();
    initializeCompactionLorebookSelect(popup, 'stmb-topical-clip-lorebook-select', {
        placeholder: tr('Select a Memory Book...'),
    });
    initializeCompactionProfileSelect(popup, 'stmb-topical-clip-profile-select', {
        placeholder: tr('Select a Compaction profile...'),
    });

    const dlg = popup.dlg;
    const lorebookSelect = dlg?.querySelector('#stmb-topical-clip-lorebook-select');
    const modeSelect = dlg?.querySelector('#stmb-topical-clip-mode');
    const topicInput = dlg?.querySelector('#stmb-topical-clip-topic');
    const keywordsInput = dlg?.querySelector('#stmb-topical-clip-keywords');
    const targetRow = dlg?.querySelector('#stmb-topical-clip-target-row');
    const targetSelect = dlg?.querySelector('#stmb-topical-clip-target-select');
    const metadataMessage = dlg?.querySelector('#stmb-topical-clip-metadata-message');
    const rebuildRow = dlg?.querySelector('#stmb-topical-clip-rebuild-row');
    const rebuildInput = dlg?.querySelector('#stmb-topical-clip-rebuild-all');
    const includeMemoriesInput = dlg?.querySelector('#stmb-topical-clip-include-memories');
    const includeMessagesInput = dlg?.querySelector('#stmb-topical-clip-include-messages');
    const messageRange = dlg?.querySelector('#stmb-topical-clip-message-range');
    const messageStartInput = dlg?.querySelector('#stmb-topical-clip-message-start');
    const messageEndInput = dlg?.querySelector('#stmb-topical-clip-message-end');
    const selectMemoriesButton = dlg?.querySelector('#stmb-topical-clip-select-memories');
    const diagnostics = dlg?.querySelector('#stmb-topical-clip-diagnostics');
    const draftTextarea = dlg?.querySelector('#stmb-topical-clip-draft');
    const saveButton = dlg?.querySelector('#stmb-topical-clip-save');
    const generateButton = dlg?.querySelector('#stmb-topical-clip-generate');
    const generateAutoAcceptButton = dlg?.querySelector('#stmb-topical-clip-generate-auto-accept');

    if (topicInput && options.topic) topicInput.value = String(options.topic);
    if (keywordsInput && Array.isArray(options.keywords)) keywordsInput.value = options.keywords.join(', ');
    if (messageStartInput && Number.isInteger(options.sceneStart)) messageStartInput.value = String(options.sceneStart);
    if (messageEndInput && Number.isInteger(options.sceneEnd)) messageEndInput.value = String(options.sceneEnd);

    const getMode = () => modeSelect?.value || 'create';
    const getSelectedLorebookName = () => {
        const selectedValue = String(lorebookSelect?.value || '').trim();
        if (selectedValue) return selectedValue;
        if (window.jQuery && lorebookSelect) {
            return String(window.jQuery(lorebookSelect).val() || '').trim();
        }
        return '';
    };
    const getSelectedTargetEntry = () => findEntryByStableId(currentLorebookData, targetSelect?.value || '');
    const clearDraft = () => {
        generationContext = null;
        if (draftTextarea) draftTextarea.value = '';
        if (saveButton) saveButton.disabled = true;
    };
    const clearSourceSelection = () => {
        selectedSourceMemoryKeys = null;
        clearDraft();
    };
    const renderDiagnostics = (message = '') => {
        if (!diagnostics) return;
        const target = getMode() === 'update' ? getSelectedTargetEntry() : null;
        const allEligible = currentLorebookData ? getTopicalSourceEntries(currentLorebookData, target) : [];
        const rebuildAll = !!rebuildInput?.checked;
        const baseUsed = getMode() === 'update'
            ? getTopicalChangedSourceEntries(allEligible, target, rebuildAll)
            : allEligible;
        const used = selectedSourceMemoryKeys
            ? baseUsed.filter(entry => selectedSourceMemoryKeys.has(getTopicalSourceSelectionKey(entry)))
            : baseUsed;
        const threshold = Number.parseInt(getModuleSettings().tokenWarningThreshold, 10) || 50000;
        const selectionLabel = selectedSourceMemoryKeys ? tr('manual selection') : tr('all available');
        const prefix = formatTopicalMessage('Eligible source memories: {{eligible}}. Source memories to use: {{used}} ({{selection}}). Token warning threshold: {{threshold}}.', {
            eligible: allEligible.length,
            used: used.length,
            selection: selectionLabel,
            threshold,
        });
        diagnostics.textContent = message ? `${prefix} ${message}` : prefix;
    };
    const renderTargetMetadataMessage = () => {
        if (!metadataMessage) return;
        const target = getSelectedTargetEntry();
        if (!target || getMode() !== 'update') {
            metadataMessage.textContent = '';
            return;
        }
        metadataMessage.textContent = getTopicalClipMetadata(target)
            ? ''
            : tr('This entry has no Topical Clip run history. The first update will use all eligible source memories.');
    };
    const renderSourceVisibility = () => {
        const updateMode = getMode() === 'update';
        if (rebuildRow) rebuildRow.hidden = !updateMode || !includeMemoriesInput?.checked;
        if (messageRange) messageRange.hidden = !includeMessagesInput?.checked;
        if (selectMemoriesButton) selectMemoriesButton.hidden = !includeMemoriesInput?.checked;
    };
    const renderMode = () => {
        const updateMode = getMode() === 'update';
        clearSourceSelection();
        if (targetRow) targetRow.hidden = !updateMode;
        renderSourceVisibility();
        renderTargetMetadataMessage();
        renderDiagnostics();
    };
    const renderTargets = () => {
        selectedSourceMemoryKeys = null;
        const targetEntries = getTopicalClipTargetEntries(currentLorebookData);
        if (targetSelect) {
            targetSelect.innerHTML = [
                '<option></option>',
                buildTopicalClipTargetOptions(targetEntries),
            ].join('');
        }
        renderTargetMetadataMessage();
        renderDiagnostics();
    };
    const loadSelectedLorebook = async lorebookName => {
        currentLorebookName = lorebookName || '';
        currentLorebookData = null;
        clearSourceSelection();
        if (!currentLorebookName) {
            renderDiagnostics(tr('Select a Memory Book to see eligible entries.'));
            renderTargets();
            return;
        }
        try {
            currentLorebookData = await loadWorldInfo(currentLorebookName);
            if (!currentLorebookData?.entries) throw new Error(tr('Failed to load lorebook'));
            renderTargets();
        } catch (error) {
            console.error(`${MODULE_NAME}: Failed to load Topical Clip lorebook:`, error);
            currentLorebookData = null;
            renderTargets();
            renderDiagnostics(tr('Failed to load lorebook'));
        }
    };

    modeSelect?.addEventListener('change', renderMode);
    lorebookSelect?.addEventListener('change', () => {
        void loadSelectedLorebook(getSelectedLorebookName());
    });
    targetSelect?.addEventListener('change', () => {
        renderTargetMetadataMessage();
        clearSourceSelection();
        renderDiagnostics();
    });
    rebuildInput?.addEventListener('change', () => {
        clearSourceSelection();
        renderDiagnostics();
    });
    includeMemoriesInput?.addEventListener('change', () => {
        clearSourceSelection();
        renderSourceVisibility();
        renderDiagnostics();
    });
    includeMessagesInput?.addEventListener('change', () => {
        clearDraft();
        renderSourceVisibility();
        renderDiagnostics();
    });
    messageStartInput?.addEventListener('input', clearDraft);
    messageEndInput?.addEventListener('input', clearDraft);
    topicInput?.addEventListener('input', clearDraft);
    keywordsInput?.addEventListener('input', clearDraft);
    draftTextarea?.addEventListener('input', () => {
        if (saveButton) saveButton.disabled = !String(draftTextarea.value || '').trim() || !generationContext;
    });
    dlg?.querySelector('#stmb-topical-clip-profile-select')?.addEventListener('change', event => {
        setCompactionProfileIndex(readIntInput(event.target, getCompactionProfileIndex()));
        clearDraft();
    });
    dlg?.querySelector('#stmb-topical-clip-edit-prompt')?.addEventListener('click', () => {
        void showTopicalClipPromptEditorPopup();
    });
    dlg?.querySelector('#stmb-topical-clip-select-memories')?.addEventListener('click', async () => {
        const selectedLorebookName = getSelectedLorebookName();
        if (selectedLorebookName && (selectedLorebookName !== currentLorebookName || !currentLorebookData?.entries)) {
            await loadSelectedLorebook(selectedLorebookName);
        }
        if (!currentLorebookName || !currentLorebookData?.entries) {
            toastr.error(tr('Select a Memory Book to see eligible entries.'), 'STMB');
            return;
        }
        const mode = getMode();
        const target = mode === 'update' ? getSelectedTargetEntry() : null;
        if (mode === 'update' && !target) {
            toastr.error(tr('Choose an entry to update.'), 'STMB');
            return;
        }
        const allEligibleSources = getTopicalSourceEntries(currentLorebookData, target);
        const rebuildAll = !!rebuildInput?.checked;
        const selectableSources = mode === 'update'
            ? getTopicalChangedSourceEntries(allEligibleSources, target, rebuildAll)
            : allEligibleSources;
        if (selectableSources.length === 0) {
            toastr.error(tr('No source memories are available to select.'), 'STMB');
            return;
        }
        const nextSelection = await showTopicalSourceMemorySelectorPopup(selectableSources, selectedSourceMemoryKeys);
        if (!nextSelection) return;
        selectedSourceMemoryKeys = nextSelection;
        clearDraft();
        renderDiagnostics(tr('Source memory selection updated.'));
    });
    const generateTopicalClipDraft = async (autoAccept = false) => {
        const selectedLorebookName = getSelectedLorebookName();
        if (selectedLorebookName && (selectedLorebookName !== currentLorebookName || !currentLorebookData?.entries)) {
            await loadSelectedLorebook(selectedLorebookName);
        }
        if (!currentLorebookName || !currentLorebookData?.entries) {
            toastr.error(tr('Select a Memory Book to see eligible entries.'), 'STMB');
            return;
        }
        const mode = getMode();
        const topic = String(topicInput?.value || '').trim();
        if (!topic) {
            toastr.error(tr('Topic is required.'), 'STMB');
            topicInput?.focus();
            return;
        }
        let keywords = parseKeywords(keywordsInput?.value || '');
        if (keywords.length === 0) {
            keywords = [topic];
            if (keywordsInput) keywordsInput.value = topic;
        }
        const target = mode === 'update' ? getSelectedTargetEntry() : null;
        if (mode === 'update' && !target) {
            toastr.error(tr('Choose an entry to update.'), 'STMB');
            return;
        }
        const includeMemories = Boolean(includeMemoriesInput?.checked);
        const includeMessages = Boolean(includeMessagesInput?.checked);
        if (!includeMemories && !includeMessages) {
            toastr.error(tr('Select saved Memories, chat messages, or both.', 'STMemoryBooks_TopicalClip_NoSourceTypes'), 'STMB');
            return;
        }
        const templateError = validateTopicalClipPromptTemplate(getTopicalClipPromptTemplate(), { includeMemories, includeMessages });
        if (templateError) {
            toastr.error(templateError, 'STMB');
            return;
        }

        const allEligibleSources = getTopicalSourceEntries(currentLorebookData, target);
        if (includeMemories && allEligibleSources.length === 0 && !includeMessages) {
            toastr.error(tr('No STMB memory entries were found in this Memory Book.'), 'STMB');
            return;
        }
        const rebuildAll = !!rebuildInput?.checked;
        const baseSourceEntries = mode === 'update'
            ? getTopicalChangedSourceEntries(allEligibleSources, target, rebuildAll)
            : allEligibleSources;
        if (mode === 'update' && includeMemories && !includeMessages && baseSourceEntries.length === 0) {
            const noNewMessage = tr('No new STMB memory entries were found for this Topical Clip.');
            toastr.info(noNewMessage, 'STMB');
            renderDiagnostics(noNewMessage);
            return;
        }
        const sourceEntries = includeMemories ? (selectedSourceMemoryKeys
            ? baseSourceEntries.filter(entry => selectedSourceMemoryKeys.has(getTopicalSourceSelectionKey(entry)))
            : baseSourceEntries) : [];
        if (includeMemories && sourceEntries.length === 0 && !includeMessages) {
            const noSelectionMessage = tr('No selected source memories are available for this Topical Clip.');
            toastr.error(noSelectionMessage, 'STMB');
            renderDiagnostics(noSelectionMessage);
            return;
        }

        let sourceMessages = null;
        let messageSource = null;
        if (includeMessages) {
            const startText = String(messageStartInput?.value ?? '').trim();
            const endText = String(messageEndInput?.value ?? '').trim();
            const start = Number(startText);
            const end = Number(endText);
            if (!startText || !endText || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) {
                toastr.error(tr('Enter a valid message range within the current chat.', 'STMemoryBooks_TopicalClip_InvalidMessageRange'), 'STMB');
                return;
            }
            try {
                const rangeInfo = await fetchStmbChatRangeInfo({
                    rangeStart: start,
                    rangeEnd: end,
                    sceneContext: buildStmbSceneContext(),
                });
                const lastAvailable = Number(rangeInfo?.lastAvailableMessageId ?? -1);
                if (end > lastAvailable) {
                    toastr.error(tr('Enter a valid message range within the current chat.', 'STMemoryBooks_TopicalClip_InvalidMessageRange'), 'STMB');
                    return;
                }
                const capture = await captureStmbSceneRange({ sceneStart: start, sceneEnd: end }, {
                    skipSystemMessages: !getModuleSettings().unhideBeforeMemory,
                    sceneContext: buildStmbSceneContext(),
                });
                sourceMessages = capture?.compiledScene;
            } catch {
                toastr.error(tr('Failed to compile the selected messages.', 'STMemoryBooks_TopicalClip_MessageCompileFailed'), 'STMB');
                return;
            }
            messageSource = {
                chat_id: String(sourceMessages?.metadata?.chatId || ''),
                start,
                end,
                scene_start_uuid: String(sourceMessages?.metadata?.sceneStartUuid || ''),
                scene_end_uuid: String(sourceMessages?.metadata?.sceneEndUuid || ''),
                message_hashes: (sourceMessages?.messages || []).map(message => ({ id: message.id, hash: stableHashString(JSON.stringify(message)) })),
            };
        }

        const existingClip = mode === 'update' ? extractClipInnerContent(target) : '';
        const prompt = buildTopicalClipPrompt({
            mode,
            topic,
            keywords,
            sourceEntries,
            sourceMessages,
            existingClip,
        });
        const estimatedPromptTokens = estimateTokens(prompt) + 500;
        const threshold = Number.parseInt(getModuleSettings().tokenWarningThreshold, 10) || 50000;
        renderDiagnostics(formatTopicalMessage('Estimated request tokens: {{tokens}}. Eligible source memories: {{eligible}}. Source memories to use: {{used}}. Token warning threshold: {{threshold}}.', {
            tokens: estimatedPromptTokens,
            eligible: allEligibleSources.length,
            used: sourceEntries.length,
            threshold,
        }));
        if (estimatedPromptTokens > threshold) {
            const allowed = await confirmTopicalClipTokenException({
                estimatedTokens: estimatedPromptTokens,
                threshold,
                eligibleCount: allEligibleSources.length,
                usedCount: sourceEntries.length,
            });
            if (!allowed) return;
        }

        if (saveButton) saveButton.disabled = true;
        try {
            const profileIndex = getCompactionProfileIndexFromSelect(popup, 'stmb-topical-clip-profile-select');
            setCompactionProfileIndex(profileIndex);
            if (autoAccept) {
                toastr.info(tr(
                    'Topical Clip generation started. It will be saved automatically.',
                    'STMemoryBooks_TopicalClip_AutoAcceptStarted',
                ), 'STMB');
                void popup.completeCancelled();
            }
            const draft = await requestTopicalClipDraft(prompt, profileIndex);
            const draftHeadline = mode === 'update'
                ? getClipHeadlineFromTitle(target.comment || makeTopicalClipHeadline(topic))
                : makeTopicalClipHeadline(topic);
            const normalizedDraft = normalizeTopicalClipDraftBody(draft, draftHeadline);
            if (!normalizedDraft) throw new Error(tr('Generated draft is empty.'));
            generationContext = {
                lorebookName: currentLorebookName,
                lorebookData: currentLorebookData,
                mode,
                topic,
                keywords,
                targetUid: target ? getEntryStableId(target) : null,
                targetContentHash: target ? stableHashString(String(target.content || '')) : null,
                sourceSnapshot: selectedSourceMemoryKeys
                    ? buildTopicalProcessedSourceSnapshot(allEligibleSources, target, sourceEntries)
                    : includeMemories
                        ? snapshotTopicalSourceEntries(allEligibleSources)
                        : (getTopicalClipMetadata(target)?.last_source_snapshot || []),
                messageSource,
            };
            if (draftTextarea) draftTextarea.value = normalizedDraft;
            if (autoAccept) {
                try {
                    const result = await saveTopicalClipDraft(generationContext, normalizedDraft);
                    const message = result?.mode === 'update'
                        ? tr('Topical Clip entry updated.')
                        : tr('Topical Clip saved to Memory Book.');
                    toastr.success(message, 'STMB');
                    return true;
                } catch (error) {
                    console.error(`${MODULE_NAME}: Failed to auto-save Topical Clip:`, error);
                    toastr.error(error?.message || tr('Failed to save Topical Clip.'), 'STMB');
                    return false;
                }
            }
            if (saveButton) saveButton.disabled = false;
            renderDiagnostics(tr('Draft generated. Review and edit before saving.'));
        } catch (error) {
            generationContext = null;
            console.error(`${MODULE_NAME}: Topical Clip generation failed:`, error);
            toastr.error(error?.message || tr('Topical Clip generation failed.'), 'STMB');
        }
        return false;
    };
    let activeGenerationTask = null;
    let autoAcceptTask = null;
    const startGeneration = autoAccept => {
        if (activeGenerationTask) return activeGenerationTask;
        if (generateButton) {
            generateButton.disabled = true;
            generateButton.textContent = tr('Generating');
        }
        if (generateAutoAcceptButton) generateAutoAcceptButton.disabled = true;
        const task = Promise.resolve()
            .then(() => generateTopicalClipDraft(autoAccept))
            .finally(() => {
                if (generateButton) {
                    generateButton.disabled = false;
                    generateButton.textContent = tr('Generate Draft');
                }
                if (generateAutoAcceptButton) generateAutoAcceptButton.disabled = false;
                if (activeGenerationTask === task) activeGenerationTask = null;
            });
        activeGenerationTask = task;
        if (autoAccept) autoAcceptTask = task;
        return task;
    };
    generateButton?.addEventListener('click', () => { void startGeneration(false); });
    generateAutoAcceptButton?.addEventListener('click', () => { void startGeneration(true); });
    saveButton?.addEventListener('click', async () => {
        const draft = String(draftTextarea?.value || '').trim();
        if (!generationContext) return;
        if (!draft) {
            toastr.error(tr('Generated draft is empty.'), 'STMB');
            return;
        }
        saveButton.disabled = true;
        try {
            const result = await saveTopicalClipDraft(generationContext, draft);
            const message = result?.mode === 'update'
                ? tr('Topical Clip entry updated.')
                : tr('Topical Clip saved to Memory Book.');
            toastr.success(message, 'STMB');
            popup.completeAffirmative();
        } catch (error) {
            if (error?.code === 'TOPICAL_CLIP_TARGET_CHANGED' || error?.type === 'StmbEntryContentChanged') {
                const createNew = await confirmTopicalClipTargetChangedCreateNew();
                if (createNew) {
                    try {
                        const result = await saveTopicalClipDraft(generationContext, draft, { forceCreateNew: true });
                        const message = result?.mode === 'create'
                            ? tr('Topical Clip saved to Memory Book.')
                            : tr('Topical Clip entry updated.');
                        toastr.success(message, 'STMB');
                        popup.completeAffirmative();
                        return;
                    } catch (fallbackError) {
                        console.error(`${MODULE_NAME}: Failed to save stale Topical Clip as a new entry:`, fallbackError);
                        toastr.error(fallbackError?.message || tr('Failed to save Topical Clip.'), 'STMB');
                    }
                }
            } else {
                console.error(`${MODULE_NAME}: Failed to save Topical Clip:`, error);
                toastr.error(error?.message || tr('Failed to save Topical Clip.'), 'STMB');
            }
            saveButton.disabled = false;
        }
    });

    try {
        const rangeInfo = await fetchStmbChatRangeInfo({ sceneContext: buildStmbSceneContext() });
        const lastAvailable = Number(rangeInfo?.lastAvailableMessageId ?? -1);
        if (lastAvailable >= 0) {
            if (messageStartInput) messageStartInput.value = String(Math.max(0, lastAvailable - 20));
            if (messageEndInput) messageEndInput.value = String(lastAvailable);
            messageStartInput?.setAttribute('max', String(lastAvailable));
            messageEndInput?.setAttribute('max', String(lastAvailable));
        }
    } catch {
        // Range validation will retry when chat messages are selected.
    }
    renderMode();
    await loadSelectedLorebook(getSelectedLorebookName() || defaultLorebookName);
    const manuallySaved = (await showPromise) === POPUP_RESULT.AFFIRMATIVE;
    return resolveTopicalClipSaveResult(manuallySaved, autoAcceptTask);
}

export async function showStmbEntryReviewPopup(options = {}) {
    if (getSelectableLorebookNames().length === 0) {
        toastr.error(tr('No Memory Books were found.'), 'STMB');
        return;
    }

    const defaultLorebookName = getDefaultCompactionLorebookName();
    const lorebookOptions = [
        '<option></option>',
        ...getSelectableLorebookNames().map(name => `<option value="${escapeHtml(name)}"${name === defaultLorebookName ? ' selected' : ''}>${escapeHtml(name)}</option>`),
    ].join('');

    const popupOptions = {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: tr('Close'),
    };

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
    `), POPUP_TYPE.TEXT, '', options.showGoBack ? withGoBackButton(popupOptions) : popupOptions);

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
                showGoBack: options.showGoBack,
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
