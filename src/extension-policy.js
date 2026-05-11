import path from 'node:path';

import { getConfigValue } from './util.js';

const THIRD_PARTY_PREFIX = 'third-party/';

function normalizeExtensionName(extensionName) {
    if (typeof extensionName !== 'string') {
        return '';
    }

    const normalized = extensionName.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    const withoutPrefix = normalized.startsWith(THIRD_PARTY_PREFIX)
        ? normalized.slice(THIRD_PARTY_PREFIX.length)
        : normalized;

    return withoutPrefix.split('/')[0] || '';
}

function getAllowlistedUserThirdPartyExtensions() {
    const value = getConfigValue('allowedUserThirdPartyExtensions', []);
    const names = Array.isArray(value) ? value : [];
    return new Set(names.map(normalizeExtensionName).filter(Boolean));
}

export function allowUserThirdPartyExtensions() {
    return getConfigValue('allowUserThirdPartyExtensions', false, 'boolean');
}

export function isUserThirdPartyExtensionAllowlisted(extensionName) {
    const extensionFolderName = normalizeExtensionName(extensionName);
    return Boolean(extensionFolderName) && getAllowlistedUserThirdPartyExtensions().has(extensionFolderName);
}

export function canManageUserThirdPartyExtensions(user) {
    return Boolean(user?.profile?.admin) || allowUserThirdPartyExtensions();
}

export function canLoadUserThirdPartyExtension(user, extensionName) {
    return canManageUserThirdPartyExtensions(user) || isUserThirdPartyExtensionAllowlisted(extensionName);
}

export function getRequestedExtensionFolderName(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return normalizeExtensionName(normalized.split(path.posix.sep)[0] || normalized);
}
