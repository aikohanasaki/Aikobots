import { runLoggedStep } from '../run-context.mjs';

export async function runChatEditCancelOnlyScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-edit-draft-protection';
    const featureTags = ['chat-edit'];

    const editTarget = await runLoggedStep({
        logger,
        testName,
        stepName: 'collect-message-target-for-draft-protection',
        featureTags,
        selector: '.mes[mesid]',
        expected: 'At least one editable message id is available',
        action: async () => {
            const ids = await page.getNonSystemMessageIdsInOrder();
            const uniqueIds = Array.from(new Set(ids));
            if (!uniqueIds.length) {
                throw new Error('No editable messages found for draft-protection scenario.');
            }

            return { mesId: uniqueIds[0] };
        },
        onError: error => captureArtifacts({ testName, stepName: 'collect-message-target-for-draft-protection', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'preserve-edit-during-redraw',
        featureTags,
        selector: '.mes_edit,.mes_edit_cancel,#curEditTextarea',
        expected: 'A same-chat refresh preserves the open draft and its deferred reload',
        action: async () => {
            const result = await page.verifyEditSurvivesBlockedRedraw({
                mesId: editTarget.mesId,
                appendedText: '[selenium-edit-draft-protection]',
            });
            return { mesId: editTarget.mesId, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'preserve-edit-during-redraw', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'preserve-edit-after-validation-failure',
        featureTags,
        selector: '.mes_edit,.mes_edit_done,.mes_edit_cancel,#curEditTextarea,#toast-container',
        expected: 'A rejected checkmark keeps the draft open and explains that it was not applied',
        action: async () => {
            const result = await page.verifyFailedEditPreservesDraft({
                mesId: editTarget.mesId,
                appendedText: '[selenium-rejected-edit-draft]',
            });
            return { mesId: editTarget.mesId, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'preserve-edit-after-validation-failure', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'block-new-chat-while-draft-open',
        featureTags,
        selector: '.mes_edit,.mes_edit_cancel,#curEditTextarea,#toast-container',
        expected: 'Starting another chat is rejected before the active chat or draft changes',
        action: async () => {
            const result = await page.verifyNewChatBlockedByDraft({
                mesId: editTarget.mesId,
                appendedText: '[selenium-navigation-guard-draft]',
            });
            return { mesId: editTarget.mesId, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'block-new-chat-while-draft-open', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'preserve-chat-dom-during-model-switch',
        featureTags: [...featureTags, 'model-switch'],
        selector: '#chat_completion_source,#chat .mes,.last_mes .swipe_left,.last_mes .swipe_right',
        expected: 'Switching models outside generation leaves messages and swipe controls unchanged',
        action: async () => page.verifyModelSwitchKeepsChatDom(),
        onError: error => captureArtifacts({ testName, stepName: 'preserve-chat-dom-during-model-switch', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'wait-for-targeted-save-before-reload',
        featureTags,
        selector: '.mes_edit,.mes_edit_done,#curEditTextarea,#chat .mes',
        expected: 'A reload waits for an in-flight targeted SQLite edit and then renders the chat',
        action: async () => {
            const result = await page.verifyReloadWaitsForEditSave({
                mesId: editTarget.mesId,
                appendedText: '[selenium-delayed-edit-save]',
            });
            return { mesId: editTarget.mesId, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'wait-for-targeted-save-before-reload', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'render-after-detached-edit-state',
        featureTags,
        selector: '.mes_edit,#curEditTextarea,#chat .mes',
        expected: 'Detached edit flags are cleared and cannot produce a blank chat',
        action: async () => {
            const result = await page.verifyDetachedEditStateDoesNotBlankChat({ mesId: editTarget.mesId });
            return { mesId: editTarget.mesId, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'render-after-detached-edit-state', error }),
    });

    return { testName, status: 'pass' };
}
