/** Derives directory defaults without changing lorebook identity or ownership. */
export function getUniverseDefaults(name, owners = []) {
    const original = String(name || '').trim();
    let derived = original;
    if (original.startsWith('9Z')) derived = original.slice(2).trim();
    else if (original.startsWith('Y-')) derived = original.slice(2).trim();
    else if (original.startsWith('Z-')) {
        const matches = [...new Set(owners)].filter(owner => owner && original.startsWith(`Z-${owner}-`));
        if (matches.length === 1) derived = original.slice(matches[0].length + 3).trim();
    }
    return { name: derived || original, creator: owners.join(', ') };
}

/** Accepts only absolute HTTPS URLs without embedded credentials. */
export function isUniverseUrl(value) {
    try {
        const url = new URL(value);
        return /^https:\/\//i.test(value) && url.protocol === 'https:' && !url.username && !url.password;
    } catch {
        return false;
    }
}

/** Validates and allowlists authored directory metadata; errors never echo input. */
export function validateUniverseInfo(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid universe information.');
    const result = {};
    for (const [key, limit] of Object.entries({ nameOverride: 200, creatorOverride: 200, description: 10000, audience: 5000, imageUrl: 2048, informationUrl: 2048 })) {
        const text = value[key] ?? '';
        if (typeof text !== 'string' || text.length > limit) throw new Error('Invalid universe information.');
        result[key] = text.trim();
    }
    const tags = value.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== 'string' || tag.length > 80)) {
        throw new Error('Invalid universe information.');
    }
    result.tags = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
    for (const key of ['imageUrl', 'informationUrl']) {
        if (result[key] && !isUniverseUrl(result[key])) throw new Error('Invalid universe information.');
    }
    return result;
}

/** Builds the explicit export allowlist from authored metadata and current defaults. */
export function getUniverseListing(name, owners, info = {}) {
    const metadata = validateUniverseInfo(info);
    const defaults = getUniverseDefaults(name, owners);
    return {
        name: metadata.nameOverride || defaults.name,
        creator: metadata.creatorOverride || defaults.creator,
        description: metadata.description,
        audience: metadata.audience,
        tags: metadata.tags,
        imageUrl: metadata.imageUrl,
        informationUrl: metadata.informationUrl,
    };
}
