import { normalizeNavyReasoningEffort } from './stmb-core.js';

const STMB_GENERATE_DATA_FIELDS = new Set([
    'type',
    'messages',
    'prompt_context',
    'model',
    'temperature',
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
    'max_new_tokens',
    'stream',
    'chat_completion_source',
    'json_schema',
    'response_format',
    'responseMimeType',
    'responseSchema',
    'custom_url',
    'custom_api_key',
    'custom_include_body',
    'custom_exclude_body',
    'custom_include_headers',
    'custom_prompt_post_processing',
    'reverse_proxy',
    'proxy_password',
    'secret_id',
    'azure_base_url',
    'azure_deployment_name',
    'azure_api_version',
    'vertexai_auth_mode',
    'vertexai_region',
    'vertexai_express_project_id',
    'zai_endpoint',
]);

/**
 * Copies only the request fields STMB is allowed to send to chat completions.
 */
export function applyStmbRequestTransport(generateData) {
    const next = {};
    for (const key of STMB_GENERATE_DATA_FIELDS) {
        if (Object.hasOwn(generateData, key)) {
            next[key] = generateData[key];
        }
    }
    next.include_reasoning = false;

    if (String(next.chat_completion_source || '').toLowerCase() === 'navy') {
        const reasoningEffort = normalizeNavyReasoningEffort(next.reasoning_effort);
        if (reasoningEffort) {
            next.reasoning_effort = reasoningEffort;
        } else {
            delete next.reasoning_effort;
        }
    }

    return next;
}
