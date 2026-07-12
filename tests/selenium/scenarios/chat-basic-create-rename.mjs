import { runLoggedStep } from '../run-context.mjs';

export async function runChatBasicCreateRenameScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-basic-create-rename';
    const featureTags = ['chat-create', 'chat-rename'];
    const targetName = `mvp-chat-${Date.now()}`;

    await runLoggedStep({
        logger,
        testName,
        stepName: 'start-new-chat',
        featureTags,
        selector: '#top_chat_bar_new_chat',
        expected: 'New chat dialog opens and confirms',
        action: async () => {
            await page.startNewChat();
            return 'new-chat-confirmed';
        },
        onError: error => captureArtifacts({ testName, stepName: 'start-new-chat', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'rename-chat',
        featureTags,
        selector: '#top_chat_bar_rename_chat',
        expected: `Current chat name is ${targetName}`,
        action: async () => {
            await page.renameCurrentChat(targetName);
            await page.waitForCurrentChatContains(targetName);
            const currentName = await page.getCurrentChatName();
            if (!currentName.includes(targetName)) {
                throw new Error(`Chat rename failed. Expected to contain ${targetName}, observed ${currentName}`);
            }
            return { currentName, targetName };
        },
        onError: error => captureArtifacts({ testName, stepName: 'rename-chat', error }),
    });

    return { testName, status: 'pass', chatName: targetName };
}
