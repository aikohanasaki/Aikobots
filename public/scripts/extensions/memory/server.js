const MODULE_NAME = '1_memory';
const DEFAULT_TEMPLATE = '[Summary: {{summary}}]';

function getLatestMemoryFromChat(chat) {
    if (!Array.isArray(chat) || !chat.length) {
        return '';
    }

    const reversedChat = chat.slice().reverse();
    reversedChat.shift();

    for (const message of reversedChat) {
        if (message?.extra?.memory) {
            return String(message.extra.memory);
        }
    }

    return '';
}

function formatMemoryValue(context, settings, value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }

    const template = settings?.template || DEFAULT_TEMPLATE;
    return context.substituteParams(template, { summary: trimmed });
}

export function setup(api) {
    api.registerPromptProvider(async (context) => {
        const settings = context.getSettings('memory');
        const prompt = formatMemoryValue(context, settings, getLatestMemoryFromChat(context.chat));

        context.setExtensionPrompt(
            MODULE_NAME,
            prompt,
            Number(settings?.position ?? 0),
            Number(settings?.depth ?? 2),
            Boolean(settings?.scan),
            Number(settings?.role ?? 0),
        );
    });
}
