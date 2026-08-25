import { chat_metadata, eventSource, event_types } from '../script.js';
import { translate } from './i18n.js';
import { MacrosParser } from './macros.js';
import { STMB_MANAGED_FLAG } from './stmb-core.js';
import { getEntrySummaryTier } from './stmb-summary.js';
import { METADATA_KEY, loadWorldInfo, world_names } from './world-info.js';

const EMPTY_TIER_COUNTS = Object.freeze(Object.fromEntries(Array.from({ length: 7 }, (_, tier) => [tier, 0])));

let getSettings = () => ({});
let getManualLorebook = () => '';
let getAdditionalLorebooks = () => [];
let tierCounts = { ...EMPTY_TIER_COUNTS };
let clipCount = 0;
let sidePromptCount = 0;
let refreshSequence = 0;
let registered = false;

function getEffectiveLorebookName() {
    if (!getSettings()?.moduleSettings?.manualModeEnabled) {
        return String(chat_metadata?.[METADATA_KEY] || '').trim();
    }
    const manualLorebook = String(getManualLorebook() || '').trim();
    return manualLorebook && world_names.includes(manualLorebook) ? manualLorebook : '';
}

/** Returns the canonical and active Narrator books that contribute to chat-scoped macro counts. */
function getEffectiveLorebookNames() {
    const primary = getEffectiveLorebookName();
    if (!primary) return [];
    return [...new Set([primary, ...getAdditionalLorebooks()].map(value => String(value || '').trim()))]
        .filter(name => name && world_names.includes(name));
}

function updateCounts(lorebookDatas) {
    const counts = { ...EMPTY_TIER_COUNTS };
    const entries = lorebookDatas.flatMap(lorebookData => Object.values(lorebookData?.entries || {}));
    for (const entry of entries) {
        if (entry?.[STMB_MANAGED_FLAG] !== true) {
            continue;
        }
        const tier = getEntrySummaryTier(entry);
        if (Object.hasOwn(counts, tier)) {
            counts[tier]++;
        }
    }
    tierCounts = counts;
    clipCount = entries.filter(entry => String(entry?.comment || '').trimEnd().endsWith('[STMB Clip]')).length;
    sidePromptCount = entries.filter(entry => {
        const title = String(entry?.comment || '').trimEnd();
        return title.endsWith(' (STMB SidePrompt)')
            || title.endsWith(' (STMB Plotpoints)')
            || title.endsWith(' (STMB Scoreboard)')
            || title.endsWith(' (STMB Tracker)');
    }).length;
}

function clearCounts() {
    tierCounts = { ...EMPTY_TIER_COUNTS };
    clipCount = 0;
    sidePromptCount = 0;
}

/**
 * Refreshes the cached Memory Books macro counts for the effective lorebook.
 */
export async function refreshStmbMacroCache(lorebookName = null, lorebookData = null) {
    const effectiveLorebooks = getEffectiveLorebookNames();
    if (effectiveLorebooks.length === 0) {
        ++refreshSequence;
        clearCounts();
        return;
    }
    if (lorebookName && !effectiveLorebooks.includes(String(lorebookName))) {
        return;
    }

    const sequence = ++refreshSequence;
    clearCounts();
    try {
        const data = await Promise.all(effectiveLorebooks.map(name => (
            lorebookData && typeof lorebookData === 'object' && name === String(lorebookName)
                ? lorebookData
                : loadWorldInfo(name)
        )));
        if (sequence !== refreshSequence || effectiveLorebooks.join('\n') !== getEffectiveLorebookNames().join('\n')) {
            return;
        }
        updateCounts(data);
    } catch {
        if (sequence === refreshSequence) {
            clearCounts();
        }
    }
}

/**
 * Registers Memory Books count macros and their cache invalidation hooks.
 */
export function initStmbMacros(options = {}) {
    getSettings = typeof options.getSettings === 'function' ? options.getSettings : getSettings;
    getManualLorebook = typeof options.getManualLorebook === 'function' ? options.getManualLorebook : getManualLorebook;
    getAdditionalLorebooks = typeof options.getAdditionalLorebooks === 'function' ? options.getAdditionalLorebooks : getAdditionalLorebooks;
    if (registered) {
        void refreshStmbMacroCache();
        return;
    }

    for (let tier = 0; tier <= 6; tier++) {
        MacrosParser.registerMacro(`memtier${tier}`, () => String(tierCounts[tier] ?? 0), translate('Number of Memory Books entries at this tier.'));
    }
    MacrosParser.registerMacro('memclips', () => String(clipCount), translate('Number of Memory Books Clip entries.'));
    MacrosParser.registerMacro('memside', () => String(sidePromptCount), translate('Number of Memory Books Side Prompt entries.'));

    eventSource.on(event_types.CHAT_CHANGED, () => void refreshStmbMacroCache());
    eventSource.on(event_types.WORLDINFO_UPDATED, (name, data) => void refreshStmbMacroCache(name, data));
    registered = true;
    void refreshStmbMacroCache();
}
