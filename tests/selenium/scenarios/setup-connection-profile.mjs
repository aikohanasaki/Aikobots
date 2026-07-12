import { runLoggedStep } from '../run-context.mjs';

export async function runSetupConnectionProfileScenario({ page, logger, captureArtifacts, config }) {
    const testName = 'setup-connection-profile';
    const featureTags = ['connection-profile', 'bootstrap'];

    await runLoggedStep({
        logger,
        testName,
        stepName: 'open-connection-profiles-panel',
        featureTags,
        selector: '#top_chat_bar_toggle_connection_profiles',
        expected: 'Connection profiles panel is accessible',
        action: async () => {
            await page.openConnectionProfilesPanel();
            return 'opened';
        },
        onError: error => captureArtifacts({ testName, stepName: 'open-connection-profiles-panel', error }),
    });

    const options = await runLoggedStep({
        logger,
        testName,
        stepName: 'verify-profile-exists',
        featureTags,
        selector: '#top_chat_connection_profiles_select',
        expected: `Profile exists: ${config.connectionProfileName}`,
        action: async () => {
            const profileOptions = await page.readConnectionProfileOptions();
            if (!profileOptions.includes(config.connectionProfileName)) {
                throw new Error(`Profile not found. Expected ${config.connectionProfileName}. Available: ${profileOptions.join(', ') || '<none>'}`);
            }
            return profileOptions;
        },
        onError: error => captureArtifacts({ testName, stepName: 'verify-profile-exists', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'select-profile',
        featureTags,
        selector: '#top_chat_connection_profiles_select',
        expected: `Selected profile is ${config.connectionProfileName}`,
        action: async () => {
            await page.selectConnectionProfileByName(config.connectionProfileName);
            const selectedName = await page.getSelectedConnectionProfileName();
            if (selectedName !== config.connectionProfileName) {
                throw new Error(`Selected profile mismatch: expected ${config.connectionProfileName}, observed ${selectedName}`);
            }
            return { selectedName, optionsCount: options.length };
        },
        onError: error => captureArtifacts({ testName, stepName: 'select-profile', error }),
    });

    await runLoggedStep({
        logger,
        testName,
        stepName: 'close-connection-profiles-panel',
        featureTags,
        selector: '#top_chat_bar_toggle_connection_profiles',
        expected: 'Connection profiles panel closes after selection',
        action: async () => {
            await page.closeConnectionProfilesPanel();
            return 'closed';
        },
        onError: error => captureArtifacts({ testName, stepName: 'close-connection-profiles-panel', error }),
    });

    return { testName, status: 'pass' };
}
