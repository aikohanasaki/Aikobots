import path from 'node:path';

import { loadConfig } from './config.mjs';
import { closeDriver, createDriver, captureFailureArtifacts, waitForFileInDirectory, readBrowserConsoleLogs } from './driver.mjs';
import { createJsonlLogger } from './logger.mjs';
import { ChatPage } from './pages/chat-page.mjs';
import { createRunContext, runLoggedStep } from './run-context.mjs';
import { runSetupConnectionProfileScenario } from './scenarios/setup-connection-profile.mjs';
import { runChatBasicCreateRenameScenario } from './scenarios/chat-basic-create-rename.mjs';
import { runChatImportExportRoundtripScenario } from './scenarios/chat-import-export-roundtrip.mjs';
import { runChatLongSwipeSmokeScenario } from './scenarios/chat-long-swipe-smoke.mjs';

const isSmoke = process.argv.includes('--smoke');

async function main() {
    const config = loadConfig();
    const runContext = createRunContext(config);
    const logger = createJsonlLogger({
        logsDir: runContext.logsDir,
        runIdUtc: runContext.runIdUtc,
        profileName: runContext.profileName,
        baseUrl: runContext.baseUrl,
    });

    let driverBundle = null;
    const tests = [];

    try {
        driverBundle = await createDriver({
            headless: config.headless,
            timeouts: config.timeouts,
            downloadsDir: runContext.downloadsDir,
            chromeBinaryPath: config.chromeBinaryPath,
            chromedriverPath: config.chromedriverPath,
        });

        const { driver } = driverBundle;
        const page = new ChatPage({ driver, config });
        let lastBrowserLogTimestamp = 0;

        logger.captureBrowserConsoleWarnings = async ({ testName, stepName }) => {
            const entries = await readBrowserConsoleLogs(driver);
            const newEntries = entries.filter(entry => entry.timestamp > lastBrowserLogTimestamp);

            if (entries.length > 0) {
                lastBrowserLogTimestamp = Math.max(lastBrowserLogTimestamp, ...entries.map(entry => entry.timestamp));
            }

            const warningEntries = newEntries.filter(entry => /SEVERE|ERROR/i.test(entry.level));
            for (const entry of warningEntries) {
                logger.writeWarning({
                    source: 'browser-console',
                    level: 'warning',
                    message: `Console ${entry.level}: ${entry.message}`,
                    observed: {
                        testName,
                        stepName,
                        consoleLevel: entry.level,
                        timestampMs: entry.timestamp,
                        message: entry.message,
                    },
                });
            }
        };

        const captureArtifacts = async ({ testName, stepName }) => {
            return captureFailureArtifacts({
                driver,
                snapshotsDir: runContext.snapshotsDir,
                testName,
                stepName,
            });
        };

        await runLoggedStep({
            logger,
            testName: 'bootstrap',
            stepName: 'load-app',
            featureTags: ['bootstrap'],
            selector: '#top_chat_bar',
            expected: 'App shell is loaded and ready',
            action: async () => {
                await page.gotoAndWaitForReady();
                return { url: config.baseUrl };
            },
            onError: error => captureArtifacts({ testName: 'bootstrap', stepName: 'load-app', error }),
        });

        tests.push(await runSetupConnectionProfileScenario({ page, logger, captureArtifacts, config }));
        tests.push(await runChatBasicCreateRenameScenario({ page, logger, captureArtifacts }));

        if (!isSmoke) {
            tests.push(await runChatImportExportRoundtripScenario({
                page,
                logger,
                captureArtifacts,
                runContext,
                waitForFileInDirectory,
            }));
            tests.push(await runChatLongSwipeSmokeScenario({ page, logger, captureArtifacts }));
        }

        logger.writeRunSummary({ status: 'pass', tests });
        console.log(`Selenium MVP run completed: PASS (${logger.logFilePath})`);
    } catch (error) {
        tests.push({ testName: 'run', status: 'fail', message: error.message || String(error) });
        logger.writeRunSummary({ status: 'fail', tests });
        console.error(`Selenium MVP run failed: ${error.message || error}`);
        console.error(`Log file: ${logger.logFilePath}`);
        process.exitCode = 1;
    } finally {
        await closeDriver(driverBundle?.driver);
    }
}

main();
