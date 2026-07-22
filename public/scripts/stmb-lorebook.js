import {
    chat_metadata,
    getCurrentChatId,
    name1,
    name2,
    saveMetadata,
} from '../script.js';
import { getContext } from './extensions.js';
import {
    assignLorebookToChat,
    createNewWorldInfo,
    isReservedTemplateWorldName,
    loadWorldInfo,
    METADATA_KEY,
    world_names,
} from './world-info.js';
import { showLorebookPickerPopup, showLorebookRecoveryPopup } from './stmb-popups.js';
import { calculateLorebookStats as calculateLorebookStatsCore } from './stmb-core.js';
import { applyStloDefaultsToLorebook } from './stlo-utils.js';
import { getSanitizedFilename } from './utils.js';

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

function renderLorebookNameTemplate(template) {
    return String(template || 'LTM - {{char}} - {{chat}}')
        .replace(/\{\{char\}\}/g, String(name2 || 'Character'))
        .replace(/\{\{user\}\}/g, String(name1 || 'User'))
        .replace(/\{\{chat\}\}/g, String(getCurrentChatId() || 'Chat'));
}

async function generateAutoLorebookName(template) {
    const renderedName = renderLorebookNameTemplate(template)
        .replace(/[\/\\:*?"<>|]/g, '_')
        .replace(/_{2,}/g, '_')
        .substring(0, 60);
    const sanitizedName = String(await getSanitizedFilename(renderedName)).trim();
    const baseName = sanitizedName || 'LTM';

    if (!Array.isArray(world_names) || !world_names.includes(baseName)) {
        return baseName;
    }

    for (let index = 2; index <= 999; index++) {
        const candidate = `${baseName} ${index}`;
        if (!world_names.includes(candidate)) {
            return candidate;
        }
    }

    return `${baseName} ${Date.now()}`;
}

function getSelectableLorebookNames() {
    return (Array.isArray(world_names) ? world_names : []).filter(name => !isReservedTemplateWorldName(name));
}

/** Returns the next available lorebook name using STMB's Auto-create rules. */
export async function suggestStmbLorebookName(template) {
    return await generateAutoLorebookName(template);
}

async function autoCreateAndBindLorebook(lorebookNameTemplate, lorebookOrderDefaults = null) {
    const generatedName = await generateAutoLorebookName(lorebookNameTemplate);
    const created = lorebookOrderDefaults
        ? await createNewWorldInfo(generatedName, { initialData: applyStloDefaultsToLorebook({ entries: {} }, lorebookOrderDefaults) })
        : await createNewWorldInfo(generatedName);
    if (!created) {
        throw new Error(`Failed to create lorebook "${generatedName}"`);
    }

    chat_metadata[METADATA_KEY] = generatedName;
    await saveMetadata();
    return generatedName;
}

export async function getLorebookStats() {
    try {
        const context = getContext();
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
    lorebookOrderDefaults = null,
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
        } else if (!Array.isArray(world_names) || !world_names.includes(lorebookName) || isReservedTemplateWorldName(lorebookName)) {
            reason = 'missing';
        }

        if (reason) {
            const recovery = await showLorebookRecoveryPopup({
                manualMode,
                lorebookName,
                allowCreate,
                hasExistingLorebooks: getSelectableLorebookNames().length > 0,
                retryText,
                reason,
            });

            if (recovery.action === 'create' && allowCreate) {
                lorebookName = await autoCreateAndBindLorebook(lorebookNameTemplate, lorebookOrderDefaults);
                continue;
            }

            if (recovery.action === 'select') {
                if (manualMode) {
                    const selected = await showLorebookPickerPopup(getSelectableLorebookNames(), {
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
            hasExistingLorebooks: getSelectableLorebookNames().length > 0,
            retryText,
            reason: 'loadFailed',
        });

        if (recovery.action === 'create' && allowCreate) {
            lorebookName = await autoCreateAndBindLorebook(lorebookNameTemplate, lorebookOrderDefaults);
            continue;
        }

        if (recovery.action === 'select') {
            if (manualMode) {
                const selected = await showLorebookPickerPopup(getSelectableLorebookNames(), {
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
