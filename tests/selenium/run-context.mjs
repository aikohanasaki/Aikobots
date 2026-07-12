import fs from 'node:fs';
import path from 'node:path';

export function createRunContext(config) {
    const runIdUtc = new Date().toISOString();
    const safeRunId = runIdUtc.replace(/[:.]/g, '-');
    const rootDir = path.resolve(process.cwd(), 'tests', 'selenium');
    const logsDir = path.join(rootDir, 'logs');
    const artifactsDir = path.join(rootDir, 'artifacts', safeRunId);
    const downloadsDir = path.join(artifactsDir, 'downloads');
    const snapshotsDir = path.join(artifactsDir, 'snapshots');
    const runtimeFixturesDir = path.join(artifactsDir, 'fixtures');

    for (const dir of [logsDir, artifactsDir, downloadsDir, snapshotsDir, runtimeFixturesDir]) {
        fs.mkdirSync(dir, { recursive: true });
    }

    return {
        runIdUtc,
        safeRunId,
        logsDir,
        artifactsDir,
        downloadsDir,
        snapshotsDir,
        runtimeFixturesDir,
        profileName: config.connectionProfileName,
        baseUrl: config.baseUrl,
    };
}

export async function runLoggedStep({
    logger,
    testName,
    stepName,
    featureTags,
    selector = null,
    expected = null,
    action,
    onError,
}) {
    const startedAt = Date.now();
    logger.writeStep({
        testName,
        stepName,
        featureTags,
        phase: 'start',
        expected,
        observed: null,
        selector,
    });

    let error = null;
    let observed = null;
    let artifactPaths = null;

    try {
        observed = await action();
        logger.writeStep({
            testName,
            stepName,
            featureTags,
            phase: 'pass',
            durationMs: Date.now() - startedAt,
            expected,
            observed,
            selector,
        });
        return observed;
    } catch (stepError) {
        error = stepError;
        artifactPaths = onError ? await onError(stepError) : null;
        logger.writeStep({
            testName,
            stepName,
            featureTags,
            phase: 'fail',
            durationMs: Date.now() - startedAt,
            expected,
            observed,
            selector,
            error,
            artifactPaths,
        });
        throw stepError;
    } finally {
        logger.writeStep({
            testName,
            stepName,
            featureTags,
            phase: 'end',
            durationMs: Date.now() - startedAt,
            expected,
            observed,
            selector,
            error,
            artifactPaths,
        });
    }
}
