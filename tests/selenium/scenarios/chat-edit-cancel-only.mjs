import { runLoggedStep } from '../run-context.mjs';

export async function runChatEditCancelOnlyScenario({ page, logger, captureArtifacts }) {
    const testName = 'chat-edit-cancel-only';
    const featureTags = ['chat-edit'];

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
        stepName: 'edit-message-and-cancel',
        featureTags,
        selector: '.mes_edit,.mes_edit_cancel,#curEditTextarea',
        expected: 'Message edit is canceled with the red X control',
        action: async () => {
            await page.editMessageById({
                mesId: editTarget.mesId,
                appendedText: '[selenium-edit-cancel-only]',
                cancelEdit: true,
            });
            return { mesId: editTarget.mesId };
        },
        onError: error => captureArtifacts({ testName, stepName: 'edit-message-and-cancel', error }),
    });

    return { testName, status: 'pass' };
}
