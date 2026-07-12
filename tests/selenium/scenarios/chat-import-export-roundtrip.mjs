import fs from 'node:fs';
import path from 'node:path';

import { runLoggedStep } from '../run-context.mjs';

export async function runChatImportExportRoundtripScenario({ page, logger, captureArtifacts, runContext, waitForFileInDirectory }) {
    const testName = 'chat-import-export-roundtrip';
    const featureTags = ['chat-import', 'chat-export'];
    const fixtureName = 'mvp-short-chat.jsonl';
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
        stepName: 'import-chat-fixture',
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
        onError: error => captureArtifacts({ testName, stepName: 'import-chat-fixture', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'export-imported-chat',
        featureTags,
        selector: '.exportRawChatButton',
        expected: 'Export file exists and is non-empty',
        action: async () => {
            await page.exportChatJsonlByName(expectedChatNamePart);
            const downloadedFile = await waitForFileInDirectory(runContext.downloadsDir, 20_000);
            const size = fs.statSync(downloadedFile).size;
            if (size <= 0) {
                throw new Error(`Downloaded export is empty: ${downloadedFile}`);
            }
            return { downloadedFile, size };
        },
        onError: error => captureArtifacts({ testName, stepName: 'export-imported-chat', error }),
    });

    return { testName, status: 'pass' };
}
