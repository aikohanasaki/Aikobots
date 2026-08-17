import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { resolveSystemChromiumPath } from './browser-path.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = {
    node: '24.18.0',
    npm: '12.0.1',
};

function fail(message) {
    throw new Error(`Test environment is not ready: ${message}`);
}

function requireFile(relativePath, label = relativePath) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
        fail(`${label} is missing. Run npm ci once from the repository root.`);
    }
    return absolutePath;
}

function getNpmVersion() {
    const match = /(?:^|\s)npm\/([^\s]+)/.exec(process.env.npm_config_user_agent || '');
    return match?.[1] || null;
}

function findTestFiles(directory, files = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules') {
            continue;
        }
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            findTestFiles(entryPath, files);
        } else if (entry.name.endsWith('.test.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

if (process.versions.node !== expected.node) {
    fail(`Node ${expected.node} is required; found ${process.versions.node}.`);
}

const npmVersion = getNpmVersion();
if (npmVersion !== expected.npm) {
    fail(`npm ${expected.npm} is required; found ${npmVersion || 'an unknown version'}. Run this doctor through npm.`);
}

for (const [relativePath, label] of [
    ['node_modules/jest/bin/jest.js', 'local Jest'],
    ['node_modules/eslint/bin/eslint.js', 'local ESLint'],
    ['node_modules/webpack/bin/webpack.js', 'local webpack'],
    ['node_modules/playwright/cli.js', 'local Playwright'],
]) {
    requireFile(relativePath, label);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
if (packageJson.packageManager !== `npm@${expected.npm}`
    || packageJson.devDependencies?.jest !== '30.2.0'
    || packageJson.devDependencies?.['@jest/globals'] !== '30.2.0') {
    fail('the pinned package manager or Jest versions do not match the repository test contract.');
}
if (packageJson.allowScripts?.['better-sqlite3@12.11.1'] !== true) {
    fail('better-sqlite3@12.11.1 must be allowed to run its native install script.');
}
if (packageJson.allowScripts?.['protobufjs@6.11.6'] !== false) {
    fail('protobufjs@6.11.6 must be explicitly denied its advisory postinstall script.');
}
if (packageJson.allowScripts?.['unrs-resolver@1.12.2'] !== false) {
    fail('unrs-resolver@1.12.2 must be denied its optional native fallback postinstall script.');
}

const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
    fail('npm did not expose its local CLI path. Run this doctor through npm.');
}
const installScriptReport = JSON.parse(execFileSync(process.execPath, [npmCli, 'install-scripts', 'ls', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
}));
if (installScriptReport.allowScripts?.length) {
    fail(`install-script decisions are missing for: ${installScriptReport.allowScripts.map(item => item.name).join(', ')}.`);
}

const database = new Database(':memory:');
database.prepare('SELECT 1 AS ready').get();
database.close();

const browserPath = resolveSystemChromiumPath();
if (!browserPath) {
    fail('Chrome/Chromium was not found. Set BROWSER_PATH or CHROME_PATH to an installed browser executable.');
}

const testFiles = [
    ...findTestFiles(path.join(projectRoot, 'src')),
    ...findTestFiles(path.join(projectRoot, 'tests')),
];
const nodeTests = testFiles.filter(file => file.endsWith('.node.test.js'));
const jestTests = testFiles.filter(file => !file.endsWith('.node.test.js'));
const misplacedNodeTests = jestTests.filter(file => fs.readFileSync(file, 'utf8').includes('node:test'));
const invalidNodeTests = nodeTests.filter(file => !fs.readFileSync(file, 'utf8').includes('node:test'));
if (misplacedNodeTests.length || invalidNodeTests.length) {
    fail('one or more test files are assigned to the wrong unit-test runner.');
}

console.log(`Test environment ready: Node ${expected.node}, npm ${expected.npm}, ${nodeTests.length} Node tests, ${jestTests.length} Jest tests.`);
console.log(`Chromium: ${browserPath}`);
