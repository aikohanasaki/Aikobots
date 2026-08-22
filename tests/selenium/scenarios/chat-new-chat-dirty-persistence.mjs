import { runLoggedStep } from '../run-context.mjs';

function assertState(state, predicate, message) {
    if (state?.error || !predicate(state)) {
        throw new Error(`${message}: ${JSON.stringify(state)}`);
    }
    return state;
}

export async function runChatNewChatDirtyPersistenceScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-new-chat-dirty-persistence';
    const featureTags = ['chat-create', 'chat-save', 'chat-generation'];
    const smokeCharacterName = 'zzzzzzTesterBillySmokilyDokily';

    await runLoggedStep({
        logger,
        testName,
        stepName: 'ensure-direct-character',
        featureTags,
        selector: '#send_textarea,#character_import_file,#rm_button_selected_ch h2',
        expected: 'A direct smoke character is selected',
        action: async () => {
            await page.runSlashCommand(`/go ${smokeCharacterName}`);
            try {
                await page.waitForSelectedCharacterName(smokeCharacterName, 2_500);
                return { imported: false };
            } catch {
                await page.importCharacterFromFile(page.resolveSmokeCharacterImportPath(`${smokeCharacterName}.png`));
                await page.runSlashCommand(`/go ${smokeCharacterName}`);
                await page.waitForSelectedCharacterName(smokeCharacterName);
                return { imported: true };
            }
        },
        onError: error => captureArtifacts({ testName, stepName: 'ensure-direct-character', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'skip-untouched-and-zero-message-openings',
        featureTags,
        selector: '#top_chat_bar_new_chat,#chat .mes',
        expected: 'Navigating away does not save an untouched greeting or a deleted zero-message opening',
        action: async () => {
            await page.startNewChat();
            await page.installNewChatGenerationProbe('observe');
            try {
                await page.startNewChat();
                let probe = await page.getNewChatGenerationProbeState();
                if (probe.saveRequests !== 0) {
                    throw new Error(`Untouched greeting issued ${probe.saveRequests} save request(s).`);
                }

                await page.deleteLastMessageForPersistenceTest();
                probe = await page.getNewChatGenerationProbeState();
                if (probe.saveRequests !== 0) {
                    throw new Error(`Zero-message opening issued ${probe.saveRequests} save request(s).`);
                }
                await page.startNewChat();
                probe = await page.getNewChatGenerationProbeState();
                if (probe.saveRequests !== 0) {
                    throw new Error(`Navigating from a zero-message opening issued ${probe.saveRequests} save request(s).`);
                }
                return probe;
            } finally {
                await page.releaseNewChatGenerationProbe();
            }
        },
        onError: error => captureArtifacts({ testName, stepName: 'skip-untouched-and-zero-message-openings', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'persist-user-message-at-index-zero',
        featureTags,
        selector: '#send_textarea,#send_but,#chat .mes[mesid="0"]',
        expected: 'Deleting the greeting and sending persists the user message at index zero',
        action: async () => {
            const userText = 'Selenium user message at index zero.';
            await page.deleteLastMessageForPersistenceTest();
            await page.installNewChatGenerationProbe('fail');
            try {
                await page.sendMessage(userText);
                await page.waitForStandardSendState();
            } finally {
                await page.releaseNewChatGenerationProbe();
            }
            await page.reloadCurrentChatForPersistenceTest();
            return assertState(
                await page.getChatPersistenceState(),
                state => !state.isTemporary && state.messages[0]?.isUser && state.messages[0]?.text === userText,
                'User message was not retained at index zero',
            );
        },
        onError: error => captureArtifacts({ testName, stepName: 'persist-user-message-at-index-zero', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'persist-edited-greeting-at-index-zero',
        featureTags,
        selector: '#chat .mes[mesid="0"] .mes_edit',
        expected: 'Editing the greeting persists the modified bot message at index zero',
        action: async () => {
            const editedText = 'Selenium edited opening at index zero.';
            await page.startNewChat();
            await page.editMessageForPersistenceTest(0, editedText);
            await page.reloadCurrentChatForPersistenceTest();
            return assertState(
                await page.getChatPersistenceState(),
                state => !state.isTemporary && !state.messages[0]?.isUser && state.messages[0]?.text === editedText,
                'Edited opening was not retained at index zero',
            );
        },
        onError: error => captureArtifacts({ testName, stepName: 'persist-edited-greeting-at-index-zero', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'persist-failed-accepted-generation',
        featureTags,
        selector: '#chat .mes[mesid="0"],#send_but',
        expected: 'A failed accepted regeneration restores and persists the nonempty opening without a targeted mutation',
        action: async () => {
            await page.startNewChat();
            await page.installNewChatGenerationProbe('fail');
            try {
                await page.generateForPersistenceTest('regenerate');
                const probe = await page.getNewChatGenerationProbeState();
                if (probe.generationRequests !== 1 || probe.saveRequests < 1 || probe.targetedMutationRequests !== 0) {
                    throw new Error(`Failed generation used an unsafe persistence path: ${JSON.stringify(probe)}`);
                }
                await page.reloadCurrentChatForPersistenceTest();
                const state = assertState(
                    await page.getChatPersistenceState(),
                    current => !current.isTemporary && current.isDirty && current.messages.length === 1 && !current.messages[0].isUser,
                    'Failed generation did not persist its restored opening',
                );
                return { probe, state };
            } finally {
                await page.releaseNewChatGenerationProbe();
            }
        },
        onError: error => captureArtifacts({ testName, stepName: 'persist-failed-accepted-generation', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'persist-completed-bot-only-generation',
        featureTags,
        selector: '#chat .mes[mesid="0"],#send_but',
        expected: 'A completed bot-only regeneration is persisted by full save and remains active after reload',
        action: async () => {
            await page.startNewChat();
            await page.installNewChatGenerationProbe('complete');
            try {
                await page.generateForPersistenceTest('regenerate');
                const probe = await page.getNewChatGenerationProbeState();
                if (probe.generationRequests !== 1 || probe.saveRequests < 1 || probe.targetedMutationRequests !== 0) {
                    throw new Error(`Completed generation used an unsafe persistence path: ${JSON.stringify(probe)}`);
                }
                await page.reloadCurrentChatForPersistenceTest();
                const state = assertState(
                    await page.getChatPersistenceState(),
                    current => !current.isTemporary
                        && current.messages.length === 1
                        && !current.messages[0].isUser
                        && current.messages[0].text.includes('Selenium bot-only generated opening.'),
                    'Generated bot-only opening did not survive reload',
                );
                return { probe, state };
            } finally {
                await page.releaseNewChatGenerationProbe();
            }
        },
        onError: error => captureArtifacts({ testName, stepName: 'persist-completed-bot-only-generation', error }),
    });

    return { testName, status: 'pass' };
}
