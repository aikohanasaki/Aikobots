import { getStringHash } from './utils.js';

function getPromptSignature(prompt) {
    const text = String(prompt || '');
    return `${text.length}:${getStringHash(text)}`;
}

/**
 * Updates unchanged built-in prompt fields for the active locale while preserving user edits.
 */
export function syncStmbLocalizedPromptFields(records, localizedRecords, englishRecords, previousState, locale, fields = ['prompt']) {
    const previousSignatures = {};
    const storedSignatures = previousState?.signatures;
    if (storedSignatures && typeof storedSignatures === 'object' && !Array.isArray(storedSignatures)) {
        for (const [key, value] of Object.entries(storedSignatures)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            previousSignatures[key] = Object.fromEntries(
                Object.entries(value).filter(([, signature]) => typeof signature === 'string'),
            );
        }
    }
    const state = {
        locale: String(locale || 'en').toLowerCase(),
        signatures: previousSignatures,
    };
    let changed = previousState?.locale !== state.locale;

    for (const [key, localizedRecord] of Object.entries(localizedRecords || {})) {
        const record = records?.[key];
        if (!record || !localizedRecord) continue;

        for (const field of fields) {
            const current = record[field];
            const localized = localizedRecord[field];
            if (typeof current !== 'string' || typeof localized !== 'string') continue;

            const currentSignature = getPromptSignature(current);
            const localizedSignature = getPromptSignature(localized);
            const english = englishRecords?.[key]?.[field];
            const englishSignature = typeof english === 'string' ? getPromptSignature(english) : null;
            const previousSignature = previousState?.signatures?.[key]?.[field];
            const isUneditedBuiltIn = currentSignature === localizedSignature
                || currentSignature === englishSignature
                || currentSignature === previousSignature;

            if (!isUneditedBuiltIn) {
                if (state.signatures[key]?.[field]) {
                    delete state.signatures[key][field];
                    changed = true;
                }
                continue;
            }

            if (current !== localized) {
                record[field] = localized;
                changed = true;
            }
            state.signatures[key] ??= {};
            if (state.signatures[key][field] !== localizedSignature) {
                state.signatures[key][field] = localizedSignature;
                changed = true;
            }
        }

        if (state.signatures[key] && Object.keys(state.signatures[key]).length === 0) {
            delete state.signatures[key];
        }
    }

    return { changed, state };
}

/**
 * Replaces persisted legacy built-ins without changing user-edited prompt overrides.
 */
export function migrateStmbPromptDefaults(doc, version, legacySignatures, defaults) {
    if (!doc || doc.version >= version) {
        return false;
    }

    for (const [key, signature] of Object.entries(legacySignatures || {})) {
        const override = doc.overrides?.[key];
        const replacement = defaults?.[key];
        if (typeof override?.prompt !== 'string' || typeof replacement !== 'string') {
            continue;
        }
        if (getPromptSignature(override.prompt) === signature) {
            override.prompt = replacement;
        }
    }

    doc.version = version;
    return true;
}
