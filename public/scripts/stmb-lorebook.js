import {
    chat_metadata,
    getCurrentChatId,
    name1,
    name2,
} from '../script.js';
import { getContext, saveMetadataDebounced } from './extensions.js';
import {
    assignLorebookToChat,
    createNewWorldInfo,
    loadWorldInfo,
    METADATA_KEY,
    world_names,
} from './world-info.js';
import { showLorebookPickerPopup, showLorebookRecoveryPopup } from './stmb-popups.js';
import { calculateLorebookStats as calculateLorebookStatsCore } from './stmb-core.js';

export class StmbLorebookHandledError extends Error {
    constructor(message = '') {
        super(String(message || ''));
        this.name = 'StmbLorebookHandledError';
        this.handled = true;
    }
}

export function isStmbLorebookHandledError(error) {
    return Boolean(error?.handled) || error instanceof StmbLorebookHandledError;
}

export async function getLorebookStats() {
    try {
        const context = await getContext();
        const lorebookName = String(context?.chatMetadata?.[METADATA_KEY] || '').trim();

        if (!lorebookName) {
            return { valid: false, error: 'No lorebook bound to chat' };
        }

        const lorebookData = await loadWorldInfo(lorebookName);
        if (!lorebookData) {
            return { valid: false, error: 'Failed to load lorebook' };
        }

        return calculateLorebookStatsCore(lorebookName, lorebookData);
    } catch (error) {
        console.error('STMB lorebook stats failed', error);
        return { valid: false, error: String(error?.message || error) };
    }
}

export async function ensureResolvedLorebookName({
    manualMode = false,
    getManualLorebook = () => '',
    setManualLorebook = async () => {},
    autoCreateLorebook = false,
    lorebookNameTemplate = 'LTM - {{char}} - {{chat}}',
    createContext = 'chat',
} = {}) {
    const retryText = manualMode
        ? 'After selecting a lorebook, retry memory generation.'
        : 'After selecting a lorebook in SillyTavern, retry memory generation.';
    const allowCreate = !manualMode && Boolean(autoCreateLorebook);
    let lorebookName = manualMode
        ? String(getManualLorebook?.() || '').trim()
        : String(chat_metadata[METADATA_KEY] || '').trim();
    let attempts = 0;

    while (attempts < 3) {
        attempts++;
        let reason = null;
        if (!lorebookName) {
            reason = 'unassigned';
        } else if (!Array.isArray(world_names) || !world_names.includes(lorebookName)) {
            reason = 'missing';
        }

        if (reason) {
            const recovery = await showLorebookRecoveryPopup({
                manualMode,
                lorebookName,
                allowCreate,
                hasExistingLorebooks: Array.isArray(world_names) && world_names.length > 0,
                retryText,
                reason,
            });

            if (recovery.action === 'create' && allowCreate) {
                const renderedName = String(lorebookNameTemplate || 'LTM - {{char}} - {{chat}}')
                    .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
                    .replace(/\{\{user\}\}/g, String(name1 || 'User'))
                    .replace(/\{\{chat\}\}/g, String(getCurrentChatId() || 'Chat'));
                const created = await createNewWorldInfo(renderedName);
                if (!created) {
                    throw new Error(`Failed to create lorebook "${renderedName}"`);
                }
                chat_metadata[METADATA_KEY] = renderedName;
                saveMetadataDebounced();
                lorebookName = renderedName;
                continue;
            }

            if (recovery.action === 'select') {
                if (manualMode) {
                    const selected = await showLorebookPickerPopup(world_names, {
                        title: 'Select Lorebook',
                        emptyMessage: 'No existing lorebooks are available.',
                    });
                    if (selected) {
                        await setManualLorebook(selected, { createContext });
                    }
                } else {
                    await assignLorebookToChat({ altKey: false });
                }
            }

            throw new StmbLorebookHandledError();
        }

        const lorebookData = await loadWorldInfo(lorebookName);
        if (lorebookData) {
            return lorebookName;
        }

        const recovery = await showLorebookRecoveryPopup({
            manualMode,
            lorebookName,
            allowCreate,
            hasExistingLorebooks: Array.isArray(world_names) && world_names.length > 0,
            retryText,
            reason: 'loadFailed',
        });

        if (recovery.action === 'create' && allowCreate) {
            const renderedName = String(lorebookNameTemplate || 'LTM - {{char}} - {{chat}}')
                .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
                .replace(/\{\{user\}\}/g, String(name1 || 'User'))
                .replace(/\{\{chat\}\}/g, String(getCurrentChatId() || 'Chat'));
            const created = await createNewWorldInfo(renderedName);
            if (!created) {
                throw new Error(`Failed to create lorebook "${renderedName}"`);
            }
            chat_metadata[METADATA_KEY] = renderedName;
            saveMetadataDebounced();
            lorebookName = renderedName;
            continue;
        }

        if (recovery.action === 'select') {
            if (manualMode) {
                const selected = await showLorebookPickerPopup(world_names, {
                    title: 'Select Lorebook',
                    emptyMessage: 'No existing lorebooks are available.',
                });
                if (selected) {
                    await setManualLorebook(selected, { createContext });
                }
            } else {
                await assignLorebookToChat({ altKey: false });
            }
        }

        throw new StmbLorebookHandledError();
    }

    throw new Error('Lorebook recovery failed.');
}
