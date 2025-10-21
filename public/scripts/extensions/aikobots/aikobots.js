import { isAdmin } from './../../user.js';
import { eventSource, event_types } from '../../../script.js';
import { executeSlashCommandsWithOptions } from '../../slash-commands.js';

// Show elements for admin users
function showElement(selector) {
    try {
        const element = document.querySelector(selector);
        if (element) {
            element.style.display = 'flex';
            console.log(`Showing element: ${selector}`);
        } else {
            console.warn(`Element not found: ${selector}`);
        }
    } catch (error) {
        console.error(`Error showing element ${selector}:`, error);
    }
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

// Seed once on app ready
eventSource.once(event_types.APP_READY, () => {
    refreshModelTagInjection();
});

// Refresh on EVERY generation (pre-prompt assembly)
eventSource.makeFirst(event_types.GENERATION_STARTED, async () => {
    await refreshModelTagInjection();
});

// Main execution function
export async function initializeAikobots() {
    if (!isAdmin()) {
        return;
    }
    // Show admin-only elements
    showElement('[id="quick_prompts_edit_drawer"]');
    showElement('[id="utility_prompts_edit_drawer"]');
    showElement('[id="advanced-formatting-button"]');
    showElement('[id="extensions_notify_updates_label"]');
    showElement('[id="extensions_details"]');
    showElement('[id="third_party_extension_button"]');
    showElement('[id="assets_container"]');
    showElement('[id="world_button"]');
}
