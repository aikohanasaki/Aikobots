import path from 'node:path';

export class PathSecurityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PathSecurityError';
        this.status = 400;
    }
}

export function getDecodedPathVariants(value) {
    const variants = [String(value ?? '')];
    for (let index = 0; index < 3; index++) {
        const current = variants[variants.length - 1];
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current || variants.includes(decoded)) {
                break;
            }
            variants.push(decoded);
        } catch {
            break;
        }
    }
    return variants;
}

export function hasUnsafePathSegment(value) {
    return getDecodedPathVariants(value).some(token => {
        const normalized = String(token || '').trim();
        return !normalized
            || normalized === '.'
            || normalized === '..'
            || normalized.includes('\0')
            || normalized.includes('/')
            || normalized.includes('\\')
            || path.posix.isAbsolute(normalized)
            || path.win32.isAbsolute(normalized)
            || /^[a-zA-Z]:/.test(normalized);
    });
}

export function assertSafeFileName(value, fieldName = 'filename') {
    const fileName = String(value ?? '').trim();
    if (hasUnsafePathSegment(fileName)) {
        throw new PathSecurityError(`Invalid ${fieldName}.`);
    }
    return fileName;
}

export function isPathUnderParent(parentPath, childPath) {
    const resolvedParent = path.resolve(parentPath);
    const resolvedChild = path.resolve(childPath);
    const relativePath = path.relative(resolvedParent, resolvedChild);
    const firstSegment = relativePath.split(/[\\/]/)[0];
    return !relativePath || (firstSegment !== '..' && !path.isAbsolute(relativePath));
}

export function assertPathUnderParent(parentPath, childPath, fieldName = 'path') {
    const resolvedChild = path.resolve(childPath);
    if (!isPathUnderParent(parentPath, resolvedChild)) {
        throw new PathSecurityError(`Invalid ${fieldName}.`);
    }
    return resolvedChild;
}

export function resolvePathUnderParent(parentPath, childName, fieldName = 'path') {
    const safeChildName = assertSafeFileName(childName, fieldName);
    return assertPathUnderParent(parentPath, path.join(parentPath, safeChildName), fieldName);
}
