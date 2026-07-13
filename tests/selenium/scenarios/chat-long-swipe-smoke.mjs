import fs from 'node:fs';
import path from 'node:path';

import { runLoggedStep } from '../run-context.mjs';

export async function runChatLongSwipeSmokeScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-long-swipe-smoke';
    const featureTags = ['chat-long', 'swipe'];
    const fixtureName = 'mvp-long-chat.jsonl';
    const fixturePath = page.resolveFixturePath(fixtureName);
    const expectedChatNamePart = path.basename(fixtureName, '.jsonl');

    await runLoggedStep({
        logger,
        testName,
        stepName: 'open-manage-chats',
        featureTags,
        selector: '#top_chat_bar_chat_manager',
        expected: 'Manage chats popup is visible',
        action: async () => {
            await page.openManageChats();
            return 'manage-chats-opened';
        },
        onError: error => captureArtifacts({ testName, stepName: 'open-manage-chats', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'import-long-chat-fixture',
        featureTags,
        selector: '#chat_import_file',
        expected: `Fixture imported: ${fixtureName}`,
        action: async () => {
            if (!fs.existsSync(fixturePath)) {
                throw new Error(`Missing fixture: ${fixturePath}`);
            }
            await page.importChatFixture(fixturePath);
            await page.waitForChatInManageList(expectedChatNamePart);
            return { fixturePath, expectedChatNamePart };
        },
        onError: error => captureArtifacts({ testName, stepName: 'import-long-chat-fixture', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'open-long-chat',
        featureTags,
        selector: '.select_chat_block',
        expected: `Current chat contains ${expectedChatNamePart}`,
        action: async () => {
            await page.openChatByName(expectedChatNamePart);
            await page.waitForCurrentChatContains(expectedChatNamePart);
            const currentName = await page.getCurrentChatName();
            return { currentName };
        },
        onError: error => captureArtifacts({ testName, stepName: 'open-long-chat', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'swipe-last-message-right-left',
        featureTags,
        selector: '.last_mes .swipe_right,.last_mes .swipe_left',
        expected: 'Last message text changes on right swipe and returns on left swipe',
        action: async () => {
            const before = await page.getLastMessageText();
            await page.swipeLastMessageRight();
            const afterRight = await page.getLastMessageText();
            if (afterRight === before) {
                throw new Error(`Swipe right did not change message text. before=${before} afterRight=${afterRight}`);
            }

            await page.swipeLastMessageLeft();
            const afterLeft = await page.getLastMessageText();
            if (afterLeft !== before) {
                throw new Error(`Swipe left did not restore message text. before=${before} afterLeft=${afterLeft}`);
            }

            return { before, afterRight, afterLeft };
        },
        onError: error => captureArtifacts({ testName, stepName: 'swipe-last-message-right-left', error }),
    });

    return { testName, status: 'pass' };
}
