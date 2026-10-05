import { Headers } from 'node-fetch';
import { mergeObjectWithYaml, excludeKeysByYaml } from '../../util.js';

/** Applies advanced overrides to a provider-native request and serializes its body. */
export function applyAdditionalParameters(parameters, config) {
    mergeObjectWithYaml(config.body, parameters.custom_include_body);
    excludeKeysByYaml(config.body, parameters.custom_exclude_body);

    const overrides = Object.create(null);
    mergeObjectWithYaml(overrides, parameters.custom_include_headers);
    const headers = new Headers(config.headers);
    try {
        for (const [name, value] of Object.entries(overrides)) {
            headers.set(name, value);
        }
    } catch {
        // Header validation errors must not echo values.
        throw new Error('Invalid additional request header.');
    }

    return { ...config, headers, body: JSON.stringify(config.body) };
}
