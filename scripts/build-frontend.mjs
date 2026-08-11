import { buildFrontend, defaultOutputDirectory } from './frontend-build-lib.mjs';

const outputArgumentIndex = process.argv.indexOf('--output');
const outputDirectory = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : defaultOutputDirectory;
const manifest = await buildFrontend(outputDirectory);

console.log(`Built frontend: ${manifest.initialRequestCount} initial JS/CSS requests, ${manifest.initialGzipBytes} gzip bytes.`);
