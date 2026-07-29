import { GROUP_CHAT_CONSOLIDATION_PRESET_KEY } from './stmb-summary.js';

/**
 * Selects the automatic group prompt only for the canonical group work item.
 */
export function buildConsolidationWorkItemPrompt(workItem, selectedPrompt, groupPrompt) {
    const useGroupPrompt = workItem?.role === 'group' && workItem?.hasGroupCharacterTopology === true;
    return {
        presetKey: useGroupPrompt ? GROUP_CHAT_CONSOLIDATION_PRESET_KEY : selectedPrompt.presetKey,
        promptText: useGroupPrompt ? groupPrompt : selectedPrompt.promptText,
    };
}
