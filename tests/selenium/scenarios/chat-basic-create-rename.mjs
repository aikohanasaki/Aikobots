import { runLoggedStep } from '../run-context.mjs';

export async function runChatBasicCreateRenameScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-basic-create-rename';
    const featureTags = ['chat-create', 'chat-send-message'];
    const promptText = 'Selenium MVP smoke prompt: reply with one short sentence.';

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
        stepName: 'wait-chat-ready',
        featureTags,
        selector: '#top_chat_bar_chat_name',
        expected: 'A created/selected chat is active',
        action: async () => {
            await page.waitForActiveChatReady();
            const currentName = await page.getCurrentChatName();
            return { currentName };
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-chat-ready', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-connection-ready',
        featureTags,
        selector: '#top_chat_connection_profiles_status,#send_form',
        expected: 'Connection status is ready before sending',
        action: async () => {
            await page.waitForConnectionReady();
            const connectionStatus = await page.getConnectionStatusText();
            return { connectionStatus };
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-connection-ready', error }),
    });

    const beforeAssistantCount = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-assistant-messages-before-send',
        featureTags,
        selector: '.mes[is_user="false"]',
        expected: 'Assistant message count is captured before sending',
        action: async () => {
            const assistantCount = await page.countAssistantMessages();
            return { assistantCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-assistant-messages-before-send', error }),
    });

    const beforeUserCount = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-user-messages-before-send',
        featureTags,
        selector: '.mes[is_user="true"]',
        expected: 'User message count is captured before sending',
        action: async () => {
            const userCount = await page.countUserMessages();
            return { userCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-user-messages-before-send', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'send-user-message',
        featureTags,
        selector: '#send_textarea,#send_but',
        expected: 'A user message is sent to generate assistant response',
        action: async () => {
            await page.sendMessage(promptText);
            await page.waitForUserMessageSent(beforeUserCount.userCount);
            return { promptText };
        },
        onError: error => captureArtifacts({ testName, stepName: 'send-user-message', error }),
    });

    const response = await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-for-assistant-response',
        featureTags,
        selector: '.mes[is_user="false"] .mes_text,#top_chat_connection_profiles_status',
        expected: 'Assistant response appears after sending message',
        action: async () => {
            return page.waitForAssistantResponse(beforeAssistantCount.assistantCount);
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-for-assistant-response', error }),
    });

    const connectionStatus = await page.getConnectionStatusText();
    console.log(`[selenium-smoke] Connection status: ${connectionStatus}`);
    console.log(`[selenium-smoke] Assistant response: ${response.responseText}`);

    return { testName, status: 'pass', assistantResponse: response.responseText, connectionStatus };
}
