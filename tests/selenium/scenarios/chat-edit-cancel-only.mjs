import { runLoggedStep } from '../run-context.mjs';

export async function runChatEditCancelOnlyScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-edit-draft-protection';
    const featureTags = ['chat-edit', 'bad-connection'];

    const editTarget = await runLoggedStep({
        logger,
        testName,
        stepName: 'collect-message-target-for-cancel-edit',
        featureTags,
        selector: '.mes[mesid]',
        expected: 'At least one editable message id is available',
        action: async () => {
            const ids = await page.getNonSystemMessageIdsInOrder();
            const uniqueIds = Array.from(new Set(ids));
            if (!uniqueIds.length) {
                throw new Error('No editable messages found for cancel-edit scenario.');
            }

            return { mesId: uniqueIds[0] };
        },
        onError: error => captureArtifacts({ testName, stepName: 'collect-message-target-for-cancel-edit', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'preserve-edit-during-redraw',
        featureTags,
        selector: '.mes_edit,.mes_edit_cancel,#curEditTextarea',
        expected: 'A background redraw is rejected without replacing the open edit draft',
        action: async () => {
            const result = await page.verifyEditSurvivesBlockedRedraw({
                mesId: editTarget.mesId,
                appendedText: '[selenium-edit-draft-protection]',
            });
            return { mesId: editTarget.mesId, ...result };
        },
        onError: error => captureArtifacts({ testName, stepName: 'preserve-edit-during-redraw', error }),
    });

    return { testName, status: 'pass' };
}
