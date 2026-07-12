import fs from 'node:fs';
import path from 'node:path';

function compactError(error) {
    if (!error) {
        return null;
    }

    const stack = typeof error.stack === 'string'
        ? error.stack.split('\n').slice(0, 8).join('\n')
        : String(error);

    return {
        message: error.message || String(error),
        stack,
    };
}

export function createJsonlLogger({ logsDir, runIdUtc, profileName, baseUrl }) {
    fs.mkdirSync(logsDir, { recursive: true });
    const safeRunId = runIdUtc.replace(/[:.]/g, '-');
    const logFilePath = path.join(logsDir, `${safeRunId}.jsonl`);

    const write = (payload) => {
        const record = {
            runIdUtc,
            profileName,
            baseUrl,
            timestampUtc: new Date().toISOString(),
            ...payload,
        };
        fs.appendFileSync(logFilePath, `${JSON.stringify(record)}\n`, 'utf8');
        return record;
    };

    return {
        logFilePath,
        writeStep({
            testName,
            stepName,
            featureTags,
            phase,
            durationMs = null,
            expected = null,
            observed = null,
            selector = null,
            error = null,
            artifactPaths = null,
        }) {
            return write({
                type: 'step',
                testName,
                stepName,
                featureTags,
                phase,
                durationMs,
                expected,
                observed,
                selector,
                error: compactError(error),
                artifactPaths,
            });
        },
        writeRunSummary({ status, tests }) {
            return write({
                type: 'run_summary',
                phase: 'end',
                status,
                tests,
            });
        },
    };
}
