import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFrontend, defaultOutputDirectory, hashDirectory } from './frontend-build-lib.mjs';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aikobots-frontend-build-'));
const temporaryOutput = path.join(temporaryRoot, 'dist');

try {
    await buildFrontend(temporaryOutput);
    const [expected, actual] = await Promise.all([
        hashDirectory(defaultOutputDirectory),
        hashDirectory(temporaryOutput),
    ]);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw new Error('Committed frontend assets are stale. Run npm run build:frontend and commit public/dist.');
    }
    console.log('Committed frontend assets are current.');
} finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
}
