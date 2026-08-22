const SERVER_GENERATION_SOURCES = new Set([
    'transformers', 'openai', 'togetherai', 'electronhub', 'openrouter',
    'cohere', 'mistral', 'nomicai',
]);

/** Returns whether the current vectors configuration is supported by server generation preparation. */
export function canUseVectorServerGenerationPreparation(settings = {}) {
    if (!settings.enabled_chats && !settings.enabled_files && !settings.enabled_world_info) {
        return true;
    }

    return Boolean(settings.enabled_chats
        && !settings.enabled_files
        && !settings.enabled_world_info
        && !(settings.summarize && settings.summarize_sent)
        && SERVER_GENERATION_SOURCES.has(String(settings.source || 'transformers')));
}
