/**
 * Returns whether every loaded generation interceptor can preserve its behavior during server preparation.
 * @param {object[]} manifests Extension manifests
 * @param {object} handlers Global interceptor and capability handlers
 * @returns {boolean} Whether server preparation is safe
 */
export function areGenerationInterceptorsServerCompatible(manifests, handlers = globalThis) {
    for (const manifest of manifests) {
        const interceptorKey = manifest?.generate_interceptor;
        if (!interceptorKey || typeof handlers[interceptorKey] !== 'function' || manifest.generation_interceptor_mode === 'client-preflight') {
            continue;
        }

        const capabilityKey = manifest.generation_interceptor_capability_check;
        const capabilityCheck = typeof capabilityKey === 'string' ? handlers[capabilityKey] : null;
        if (typeof capabilityCheck !== 'function') {
            return false;
        }

        try {
            if (capabilityCheck() === true) {
                continue;
            }
        } catch {
            // A broken capability check must retain the established client-preparation fallback.
        }

        return false;
    }

    return true;
}
