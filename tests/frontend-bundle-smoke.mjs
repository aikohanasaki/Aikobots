import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium, firefox, webkit } from 'playwright';
import { defaultOutputDirectory, hashDirectory } from '../scripts/frontend-build-lib.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const browserName = process.env.FRONTEND_SMOKE_BROWSER || 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
if (!browserType) {
    throw new Error(`Unsupported FRONTEND_SMOKE_BROWSER: ${browserName}`);
}
const browserPath = process.env.BROWSER_PATH
    || process.env.CHROME_PATH
    || (browserName === 'chromium' && process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '');

function getAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}

async function waitForServer(url, child) {
    for (let attempt = 0; attempt < 120; attempt++) {
        if (child.exitCode !== null) {
            throw new Error(`Server exited before startup with code ${child.exitCode}.`);
        }
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
        } catch {
            // Startup is still in progress.
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Timed out waiting for the frontend smoke server.');
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aikobots-frontend-smoke-'));
const configPath = path.join(temporaryRoot, 'config.yaml');
const dataRoot = path.join(temporaryRoot, 'data');
const port = await getAvailablePort();
const publicPath = value => value.split(path.sep).join('/');
const committedBundleHashes = await hashDirectory(defaultOutputDirectory);

await fs.mkdir(dataRoot);
await fs.writeFile(configPath, [
    `dataRoot: ${JSON.stringify(publicPath(dataRoot))}`,
    `defaultContentRoot: ${JSON.stringify(publicPath(path.join(projectRoot, 'default', 'content')))}`,
    `defaultScaffoldRoot: ${JSON.stringify(publicPath(path.join(projectRoot, 'default', 'scaffold')))}`,
    'listen: false',
    `port: ${port}`,
    'browserLaunch:',
    '  enabled: false',
    'enableUserAccounts: false',
    'disableCsrfProtection: true',
    '',
].join('\n'));

const server = spawn(process.execPath, [
    path.join(projectRoot, 'server.js'),
    '--configPath', configPath,
    '--dataRoot', dataRoot,
    '--port', String(port),
    '--browserLaunchEnabled', 'false',
], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', chunk => serverOutput += chunk);
server.stderr.on('data', chunk => serverOutput += chunk);

let browser;
const pageErrors = [];
const browserDiagnostics = [];
try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/dist/app.js`, server);
    const settingsPath = path.join(dataRoot, 'default-user', 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    settings.firstRun = false;
    settings.extension_settings.disabledExtensions = ['tts'];
    await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 4)}\n`);

    browser = await browserType.launch({ ...(browserPath ? { executablePath: browserPath } : {}), headless: true });
    const page = await browser.newPage();
    const applicationRequests = new Set();

    page.on('request', request => {
        if (['script', 'stylesheet'].includes(request.resourceType())) {
            applicationRequests.add(new URL(request.url()).pathname);
        }
    });
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));
    page.on('console', message => {
        if (['error', 'warning'].includes(message.type()) || /activating extension|extension settings/iu.test(message.text())) {
            browserDiagnostics.push(`${message.type()}: ${message.text()}`);
        }
    });
    page.on('requestfailed', request => browserDiagnostics.push(`request failed: ${request.url()} ${request.failure()?.errorText || ''}`));
    page.on('response', response => {
        if (response.status() >= 400) {
            browserDiagnostics.push(`response ${response.status()}: ${response.url()}`);
        }
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#top_chat_bar');
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext().SlashCommandParser.commands['stmb-highest']), null, { timeout: 30_000 });

    const requests = [...applicationRequests].sort();
    assert.ok(requests.length <= 12, `Expected at most 12 startup JS/CSS requests, got ${requests.length}: ${requests.join(', ')}`);
    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('\n')}\nRequests: ${requests.join(', ')}`);
    assert.ok(requests.includes('/dist/stmb.js'), `STMB bundle was not loaded. Requests: ${requests.join(', ')}`);
    assert.ok(requests.includes('/dist/chunks/builtins.js'), `Built-ins bundle was not loaded. Requests: ${requests.join(', ')}`);
    assert.ok(requests.every(request => request.startsWith('/dist/') || request.startsWith('/css/layouts/') || request === '/css/user.css'), `Unexpected source request: ${requests.join(', ')}`);
    assert.ok(requests.every(request => !/(?:kokoro|pdf|epub)/iu.test(request)), `Optional engine loaded during startup: ${requests.join(', ')}`);
    assert.equal(await page.locator('#tts_provider').count(), 0, 'Disabled TTS built-in executed.');
    assert.equal(await page.locator('#tts-css').count(), 0, 'Disabled TTS built-in style was applied.');
    assert.equal(await page.evaluate(() => Boolean(globalThis.SillyTavern)), true, 'globalThis.SillyTavern is unavailable.');
    assert.equal(await page.locator('#stmb-menu-item').count(), 1, 'STMB menu was not initialized.');
    assert.equal(await page.locator('#stmb-jobs-topbar-button[aria-controls="top_chat_stmb_jobs"]').count(), 1, 'STMB jobs UI was not initialized.');
    assert.equal(await page.locator('#aiko-layout-css[href="css/layouts/classic.css"]').count(), 1, 'Selected runtime layout link was not retained.');
    assert.equal(await page.evaluate(async () => (await (await globalThis.fetch('/version')).json()).pkgVersion), '5.0.0', 'Runtime version is not v5.');
    assert.deepEqual(await hashDirectory(defaultOutputDirectory), committedBundleHashes, 'Production startup modified committed frontend artifacts.');
    console.log(`Frontend ${browserName} smoke passed with ${requests.length} JS/CSS requests: ${requests.join(', ')}`);
} catch (error) {
    throw new Error(`${error.message}\nPage errors:\n${pageErrors.join('\n')}\nBrowser diagnostics:\n${browserDiagnostics.join('\n')}\n${serverOutput}`);
} finally {
    await browser?.close();
    if (server.exitCode === null) {
        const serverExit = new Promise(resolve => server.once('exit', resolve));
        server.kill('SIGTERM');
        await serverExit;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
}
