import { getStringHash } from './utils.js';

function getPromptSignature(prompt) {
    const text = String(prompt || '');
    return `${text.length}:${getStringHash(text)}`;
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
