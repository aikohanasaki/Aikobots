import { runLoggedStep } from '../run-context.mjs';

export async function runChatBasicCreateRenameScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-basic-create-rename';
    const featureTags = ['chat-create', 'chat-send-message', 'chat-rename', 'chat-convert-group', 'chat-group-member'];
    const promptText = 'Selenium MVP smoke prompt: reply with one short sentence.';
    const renamedChat = `mvp-renamed-${Date.now()}`;

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

    const smokeCharacterName = 'zzzzzzTesterBillySmokilyDokily';

    await runLoggedStep({
        logger,
        testName,
        stepName: 'go-to-smoke-character',
        featureTags,
        selector: '#send_textarea,#send_but,#rm_button_selected_ch h2',
        expected: `Slash command /go loads ${smokeCharacterName}`,
        action: async () => {
            await page.runSlashCommand(`/go ${smokeCharacterName}`);
            await page.waitForSelectedCharacterName(smokeCharacterName);
            const selectedCharacterName = await page.getSelectedCharacterName();
            return { selectedCharacterName };
        },
        onError: error => captureArtifacts({ testName, stepName: 'go-to-smoke-character', error }),
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
            const result = await page.sendMessageWithRetry(promptText, beforeUserCount.userCount);
            return { promptText, ...result };
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

    await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-rename-ready',
        featureTags,
        selector: '#top_chat_bar_rename_chat',
        expected: 'Rename button becomes enabled after chat is persisted',
        action: async () => {
            await page.waitForRenameReady();
            return { ready: true };
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-rename-ready', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'rename-temporary-chat',
        featureTags,
        selector: '#top_chat_bar_rename_chat,dialog.popup[open] textarea.popup-input',
        expected: `Current chat name contains ${renamedChat}`,
        action: async () => {
            await page.renameCurrentChat(renamedChat);
            await page.waitForCurrentChatContains(renamedChat);
            const currentName = await page.getCurrentChatName();
            return { currentName, renamedChat };
        },
        onError: error => captureArtifacts({ testName, stepName: 'rename-temporary-chat', error }),
    });

    const beforeAssistantAfterRename = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-assistant-messages-after-rename',
        featureTags,
        selector: '.mes[is_user="false"]',
        expected: 'Assistant message count is captured before post-rename send',
        action: async () => {
            const assistantCount = await page.countAssistantMessages();
            return { assistantCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-assistant-messages-after-rename', error }),
    });

    const beforeUserAfterRename = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-user-messages-after-rename',
        featureTags,
        selector: '.mes[is_user="true"]',
        expected: 'User message count is captured before post-rename send',
        action: async () => {
            const userCount = await page.countUserMessages();
            return { userCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-user-messages-after-rename', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-send-ready-after-rename',
        featureTags,
        selector: '#send_textarea,#send_but',
        expected: 'Send input and button become ready after rename',
        action: async () => {
            await page.waitForSendReady();
            await new Promise(resolve => setTimeout(resolve, 1_000));
            return { ready: true };
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-send-ready-after-rename', error }),
    });

    const postRenamePrompt = 'this is a renamed chat I am sending a message in';

    await runLoggedStep({
        logger,
        testName,
        stepName: 'send-user-message-after-rename',
        featureTags,
        selector: '#send_textarea,#send_but',
        expected: 'A user message is sent after rename and appears in chat',
        action: async () => {
            const result = await page.sendMessageWithRetry(postRenamePrompt, beforeUserAfterRename.userCount);
            return { postRenamePrompt, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'send-user-message-after-rename', error }),
    });

    const postRenameResponse = await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-for-assistant-response-after-rename',
        featureTags,
        selector: '.mes[is_user="false"] .mes_text',
        expected: 'Assistant response appears after sending post-rename message',
        action: async () => {
            return page.waitForAssistantResponse(beforeAssistantAfterRename.assistantCount);
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-for-assistant-response-after-rename', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'convert-chat-to-group',
        featureTags,
        selector: '#options_button,#option_convert_to_group,dialog.popup[open]',
        expected: 'Current chat converts to group chat successfully',
        action: async () => {
            await page.convertCurrentChatToGroup();
            return { converted: true };
        },
        onError: error => captureArtifacts({ testName, stepName: 'convert-chat-to-group', error }),
    });

    const beforeGroupAssistantCount = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-assistant-messages-after-group-convert',
        featureTags,
        selector: '.mes[is_user="false"]',
        expected: 'Assistant message count is captured before group message send',
        action: async () => {
            const assistantCount = await page.countAssistantMessages();
            return { assistantCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-assistant-messages-after-group-convert', error }),
    });

    const beforeGroupUserCount = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-user-messages-after-group-convert',
        featureTags,
        selector: '.mes[is_user="true"]',
        expected: 'User message count is captured before group message send',
        action: async () => {
            const userCount = await page.countUserMessages();
            return { userCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-user-messages-after-group-convert', error }),
    });

    const groupPrompt = 'this is a group-converted chat I am sending a message in';

    await runLoggedStep({
        logger,
        testName,
        stepName: 'send-user-message-after-group-convert',
        featureTags,
        selector: '#send_textarea,#send_but',
        expected: 'A user message is sent after conversion to group',
        action: async () => {
            const result = await page.sendMessageWithRetry(groupPrompt, beforeGroupUserCount.userCount);
            return { groupPrompt, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'send-user-message-after-group-convert', error }),
    });

    const groupResponse = await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-for-assistant-response-after-group-convert',
        featureTags,
        selector: '.mes[is_user="false"] .mes_text',
        expected: 'Assistant provides full response after group conversion',
        action: async () => {
            return page.waitForAssistantResponse(beforeGroupAssistantCount.assistantCount);
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-for-assistant-response-after-group-convert', error }),
    });

    const addMembersResult = await runLoggedStep({
        logger,
        testName,
        stepName: 'add-member-to-group',
        featureTags,
        selector: '#rm_group_add_members .group_member [title="Add to group"]',
        expected: 'At least two non-Assistant characters are added to the current group',
        action: async () => {
            return page.addFirstAvailableMemberToGroup();
        },
        onError: error => captureArtifacts({ testName, stepName: 'add-member-to-group', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'trigger-added-member-speak',
        featureTags,
        selector: '#rm_group_members .group_member [title="Trigger a message from this character"],#rm_group_add_members .group_member [title="Trigger a message from this character"]',
        expected: 'Speak button is tapped for one added group member',
        action: async () => {
            await page.triggerGroupMemberSpeakByChid(addMembersResult.addedChids[0]);
            return { chid: addMembersResult.addedChids[0] };
        },
        onError: error => captureArtifacts({ testName, stepName: 'trigger-added-member-speak', error }),
    });

    const beforeGroupFollowupAssistantCount = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-assistant-messages-before-group-followup-send',
        featureTags,
        selector: '.mes[is_user="false"]',
        expected: 'Assistant message count is captured before group follow-up send',
        action: async () => {
            const assistantCount = await page.countAssistantMessages();
            return { assistantCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-assistant-messages-before-group-followup-send', error }),
    });

    const beforeGroupFollowupUserCount = await runLoggedStep({
        logger,
        testName,
        stepName: 'count-user-messages-before-group-followup-send',
        featureTags,
        selector: '.mes[is_user="true"]',
        expected: 'User message count is captured before group follow-up send',
        action: async () => {
            const userCount = await page.countUserMessages();
            return { userCount };
        },
        onError: error => captureArtifacts({ testName, stepName: 'count-user-messages-before-group-followup-send', error }),
    });

    const groupFollowupPrompt = 'this is a group chat follow-up after tapping speak for an added member';

    await runLoggedStep({
        logger,
        testName,
        stepName: 'send-user-message-after-added-member-speak',
        featureTags,
        selector: '#send_textarea,#send_but',
        expected: 'A user message is sent after triggering added-member speak',
        action: async () => {
            const result = await page.sendMessageWithRetry(groupFollowupPrompt, beforeGroupFollowupUserCount.userCount);
            return { groupFollowupPrompt, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'send-user-message-after-added-member-speak', error }),
    });

    const groupFollowupResponse = await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-for-assistant-response-after-added-member-speak',
        featureTags,
        selector: '.mes[is_user="false"] .mes_text',
        expected: 'A full response appears from a group chat member after added-member speak and follow-up message',
        action: async () => {
            return page.waitForAssistantResponse(beforeGroupFollowupAssistantCount.assistantCount);
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-for-assistant-response-after-added-member-speak', error }),
    });

    const connectionStatus = await page.getConnectionStatusText();
    console.log(`[selenium-smoke] Connection status: ${connectionStatus}`);
    console.log(`[selenium-smoke] Assistant response: ${response.responseText}`);
    console.log(`[selenium-smoke] Renamed chat: ${renamedChat}`);
    console.log(`[selenium-smoke] Post-rename assistant response: ${postRenameResponse.responseText}`);
    console.log(`[selenium-smoke] Post-group-convert assistant response: ${groupResponse.responseText}`);
    console.log(`[selenium-smoke] Added-member-speak follow-up assistant response: ${groupFollowupResponse.responseText}`);

    return {
        testName,
        status: 'pass',
        assistantResponse: response.responseText,
        connectionStatus,
        renamedChat,
        postRenameAssistantResponse: postRenameResponse.responseText,
        postGroupConvertAssistantResponse: groupResponse.responseText,
        postAddedMemberSpeakAssistantResponse: groupFollowupResponse.responseText,
        };
        }
