import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { loadConfig } from './config.mjs';

function fail(message) {
    throw new Error(`Selenium environment is not ready: ${message}`);
}

function requireExecutable(filePath, label) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        fail(`${label} does not exist: ${filePath}`);
    }
}

function readMajorVersion(filePath, label) {
    const result = spawnSync(filePath, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
        fail(`${label} could not report its version from ${filePath}.`);
    }
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = /\b(\d+)\./.exec(output);
    if (!match) {
        fail(`${label} returned an unrecognized version: ${output || '(empty)'}.`);
    }
    return { major: Number(match[1]), output };
}

const config = loadConfig();
requireExecutable(config.chromeBinaryPath, 'Chrome for Testing');
requireExecutable(config.chromedriverPath, 'ChromeDriver');

const chrome = readMajorVersion(config.chromeBinaryPath, 'Chrome for Testing');
const driver = readMajorVersion(config.chromedriverPath, 'ChromeDriver');
if (chrome.major !== driver.major) {
    fail(`Chrome major ${chrome.major} does not match ChromeDriver major ${driver.major}.`);
}

let response;
try {
    response = await fetch(config.baseUrl, { signal: AbortSignal.timeout(5_000) });
} catch (error) {
    fail(`the application is not reachable at ${config.baseUrl}: ${error.message}`);
}
if (!response.ok) {
    fail(`the application returned HTTP ${response.status} at ${config.baseUrl}.`);
}

console.log(`Selenium environment ready: ${chrome.output}; ${driver.output}.`);
console.log(`Server: ${config.baseUrl}; connection profile: ${config.connectionProfileName}.`);
