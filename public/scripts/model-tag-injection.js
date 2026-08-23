import { executeSlashCommandsWithOptions } from './slash-commands.js';
import { eventSource, event_types, extension_prompt_types, setExtensionPrompt } from '../script.js';

let modelTagInjectionInitialized = false;
const MODEL_TAG_PROMPT_KEY = 'script_inject_core-model-tag';

/**
 * Keep a hidden, scan-only model tag injected and refresh it on EVERY generation.
 * Uses a stable id to avoid stacking.
 */
export async function refreshModelTagInjection() {
    try {
        const result = await executeSlashCommandsWithOptions('/model', {
            handleParserErrors: false,
            handleExecutionErrors: false,
            scope: null,
            parserFlags: null,
            abortController: null,
        });
        setExtensionPrompt(MODEL_TAG_PROMPT_KEY, `MODEL=${String(result?.pipe || '')}`, extension_prompt_types.NONE, 4, true);
    } catch (error) {
        console.debug('[Core Model Tag Injection] refreshModelTagInjection failed', error);
    }
}

export function initializeModelTagInjection() {
    if (modelTagInjectionInitialized) {
        return;
    }

    modelTagInjectionInitialized = true;

    eventSource.once(event_types.APP_READY, () => {
        refreshModelTagInjection();
    });

    eventSource.makeFirst(event_types.GENERATION_STARTED, async () => {
        await refreshModelTagInjection();
    });
}
