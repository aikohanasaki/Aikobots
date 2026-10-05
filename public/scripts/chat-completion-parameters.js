export const ADDITIONAL_PARAMETER_KEYS = Object.freeze([
    'custom_include_body',
    'custom_exclude_body',
    'custom_include_headers',
]);

/** Resolves only the selected provider's parameters, preserving legacy custom settings. */
export function getAdditionalParameters(settings, source = settings.chat_completion_source) {
    const values = source === 'custom'
        ? settings
        : Object.hasOwn(settings.additional_parameters ?? {}, source)
            ? settings.additional_parameters[source]
            : null;
    return Object.fromEntries(ADDITIONAL_PARAMETER_KEYS.map(key => [key, typeof values?.[key] === 'string' ? values[key] : '']));
}

/** Saves a provider's parameters without changing any other provider's values. */
export function setAdditionalParameters(settings, source, values) {
    const parameters = Object.fromEntries(ADDITIONAL_PARAMETER_KEYS.map(key => [key, typeof values?.[key] === 'string' ? values[key] : '']));
    if (source === 'custom') {
        Object.assign(settings, parameters);
    } else {
        settings.additional_parameters = { ...settings.additional_parameters, [source]: parameters };
    }
}
