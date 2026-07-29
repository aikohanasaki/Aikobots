/**
 * Returns the first entered or saved model ID, or rejects a model-less request.
 */
export function resolveConnectionProfileModel(...candidates) {
    const model = candidates.map(value => String(value || '').trim()).find(Boolean);
    if (!model) {
        throw new Error('Enter a model ID or select a connection profile with a saved model ID.');
    }
    return model;
}

/**
 * Returns the first finite temperature in precedence order.
 */
export function resolveConnectionProfileTemperature(...candidates) {
    for (const value of candidates) {
        if (value === null || value === '' || value === undefined) {
            continue;
        }
        const temperature = Number(value);
        if (Number.isFinite(temperature)) {
            return Math.max(0, Math.min(2, temperature));
        }
    }
    return undefined;
}
