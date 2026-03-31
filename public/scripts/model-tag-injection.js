import { executeSlashCommandsWithOptions } from './slash-commands.js';
import { eventSource, event_types } from '../script.js';

let modelTagInjectionInitialized = false;

/**
 * Keep a hidden, scan-only model tag injected and refresh it on EVERY generation.
 * Uses a stable id to avoid stacking.
 */
export async function refreshModelTagInjection() {
    const pipeline = '/model | /pass MODEL={{pipe}} | /inject id=core-model-tag position=none scan=true';
    try {
        await executeSlashCommandsWithOptions(pipeline, {
            handleParserErrors: false,
            handleExecutionErrors: false,
            scope: null,
            parserFlags: null,
            abortController: null,
        });
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
