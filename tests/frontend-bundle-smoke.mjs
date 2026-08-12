import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { chromium, firefox, webkit } from 'playwright';
import { defaultOutputDirectory, hashDirectory } from '../scripts/frontend-build-lib.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverStartAttempts = 3;
const browserName = process.env.FRONTEND_SMOKE_BROWSER || 'chromium';
const extensionsEnabled = process.env.FRONTEND_SMOKE_DISABLE_EXTENSIONS !== '1';
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

/** Waits until the spawned server reports readiness and serves the frontend bundle. */
async function waitForServer(url, child, getOutput) {
    for (let attempt = 0; attempt < 120; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null) {
            await Promise.allSettled([finished(child.stdout), finished(child.stderr)]);
            throw new Error(`Server exited before startup with code ${child.exitCode}.`);
        }
        if (!getOutput().includes('Aikobots is listening on')) {
            await new Promise(resolve => setTimeout(resolve, 250));
            continue;
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
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

/** Stops a spawned smoke server if it is still running. */
async function stopServer(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const serverExit = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await serverExit;
}

/** Starts the smoke server, retrying only when another process claimed the probed port. */
async function startServer(configPath, dataRoot) {
    let lastError;
    for (let attempt = 0; attempt < serverStartAttempts; attempt++) {
        const port = await getAvailablePort();
        const child = spawn(process.execPath, [
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
        let output = '';
        child.stdout.on('data', chunk => output += chunk);
        child.stderr.on('data', chunk => output += chunk);

        try {
            await waitForServer(`http://127.0.0.1:${port}/dist/app.js`, child, () => output);
            return { child, output: () => output, port };
        } catch (error) {
            lastError = error;
            await stopServer(child);
            if (!output.includes('EADDRINUSE') || attempt === serverStartAttempts - 1) {
                throw new Error(`${error.message}\n${output}`);
            }
            console.warn(`Frontend smoke server port ${port} was occupied; retrying.`);
        }
    }
    throw lastError ?? new Error('Frontend smoke server did not start.');
}

/** Exercises Data Maid category selection and every deletion path against mocked reports. */
async function testDataMaidMultiSelect(page, fatalBrowserDiagnostics) {
    const startingDiagnosticIndex = fatalBrowserDiagnostics.length;
    await page.setViewportSize({ width: 390, height: 800 });
    const seedItems = [
        { name: 'alpha.txt', hash: 'hash-a', parent: 'files', size: 1024, mtime: 1 },
        { name: 'beta.txt', hash: 'hash-b', parent: 'files', size: 2048, mtime: 2 },
        { name: 'gamma.txt', hash: 'hash-c', parent: 'files', size: 4096, mtime: 3 },
    ];
    const emptyReport = {
        images: [],
        chats: [],
        groupChats: [],
        avatarThumbnails: [],
        backgroundThumbnails: [],
        personaThumbnails: [],
        layouts: [],
        layoutAssets: [],
        chatBackups: [],
        settingsBackups: [],
    };
    let remainingItems = seedItems.map(item => ({ ...item }));
    const deleteRequests = [];

    await page.route('**/api/data-maid/report', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ report: { ...emptyReport, files: remainingItems }, token: 'data-maid-smoke-token' }),
        });
    });
    await page.route('**/api/data-maid/delete', async route => {
        const request = route.request().postDataJSON();
        deleteRequests.push(request);
        remainingItems = remainingItems.filter(item => !request.hashes.includes(item.hash));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/data-maid/finalize', async route => await route.fulfill({ status: 204 }));

    await page.locator('#data_maid_button').evaluate(button => button.click());
    const dialog = page.locator('.dataMaidDialog');
    await dialog.locator('.dataMaidStartButton').click();
    let category = dialog.locator('.dataMaidCategory');
    await category.waitFor();
    await category.locator('.inline-drawer-toggle').click();
    assert.equal(
        await category.locator('.dataMaidCategoryContent').evaluate(content => content.scrollWidth <= content.clientWidth + 1),
        true,
        'Data Maid category controls must not overflow a narrow viewport.',
    );

    const selectAll = category.locator('.dataMaidSelectAll');
    const deleteSelected = category.locator('.dataMaidDeleteSelected');
    assert.equal(await deleteSelected.isDisabled(), true, 'Delete Selected must start disabled.');
    await category.locator('.dataMaidItem[data-hash="hash-a"] .dataMaidItemSelect').check();
    assert.equal(await category.locator('.dataMaidSelectedCount').textContent(), '1 selected');
    assert.equal(await selectAll.evaluate(checkbox => checkbox.indeterminate), true, 'Partial selection must make Select All indeterminate.');
    assert.equal(await deleteSelected.isEnabled(), true, 'Delete Selected must enable when an item is checked.');

    await deleteSelected.click();
    let confirmation = page.locator('dialog.popup').filter({ hasText: 'This will permanently delete the selected files.' });
    await confirmation.locator('.popup-button-cancel').click();
    await confirmation.waitFor({ state: 'detached' });
    assert.equal(deleteRequests.length, 0, 'Canceling selected deletion must not send a request.');
    assert.equal(await category.locator('.dataMaidItem').count(), 3, 'Canceling selected deletion must preserve every row.');

    await selectAll.check();
    assert.equal(await category.locator('.dataMaidItemSelect:checked').count(), 3, 'Select All must check every item.');
    await selectAll.uncheck();
    assert.equal(await category.locator('.dataMaidItemSelect:checked').count(), 0, 'Clearing Select All must uncheck every item.');
    await selectAll.focus();
    await page.keyboard.press('Space');
    assert.equal(await category.locator('.dataMaidItemSelect:checked').count(), 3, 'Select All must support keyboard selection.');
    await page.keyboard.press('Space');
    assert.equal(await category.locator('.dataMaidItemSelect:checked').count(), 0, 'Select All must support keyboard clearing.');
    await category.locator('.dataMaidItem[data-hash="hash-a"] .dataMaidItemSelect').check();
    await category.locator('.dataMaidItem[data-hash="hash-b"] .dataMaidItemSelect').check();
    await deleteSelected.click();
    confirmation = page.locator('dialog.popup').filter({ hasText: 'This will permanently delete the selected files.' });
    await confirmation.locator('.popup-button-ok').click();
    await confirmation.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.dataMaidItem').length === 1);
    assert.deepEqual([...deleteRequests[0].hashes].sort(), ['hash-a', 'hash-b'], 'Selected deletion must send only checked hashes.');
    assert.equal(await category.locator('.dataMaidItem[data-hash="hash-c"]').count(), 1, 'Selected deletion must preserve unchecked rows.');
    assert.equal(await category.locator('.dataMaidCategoryItemCount').textContent(), '1');
    assert.equal(await category.locator('.dataMaidCategoryTotalSize').textContent(), '4.0 KiB');
    assert.equal(await deleteSelected.isDisabled(), true, 'Successful deletion must clear and disable the selected action.');

    await dialog.locator('.dataMaidStartButton').click();
    category = dialog.locator('.dataMaidCategory');
    await category.waitFor();
    assert.equal(await category.locator('.dataMaidItemSelect:checked').count(), 0, 'Rescanning must not retain selection.');
    assert.equal(await category.locator('.dataMaidDeleteSelected').isDisabled(), true, 'Rescanning must reset Delete Selected.');

    const expectedErrorIndex = fatalBrowserDiagnostics.length;
    await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url === '/api/data-maid/delete') {
                window.fetch = originalFetch;
                return Promise.resolve(new Response('', { status: 503, statusText: 'Expected smoke failure' }));
            }
            return originalFetch(input, init);
        };
    });
    await category.locator('.dataMaidDeleteAll').click();
    confirmation = page.locator('dialog.popup').filter({ hasText: 'This will permanently delete all files in this category.' });
    await confirmation.locator('.popup-button-ok').click();
    await confirmation.waitFor({ state: 'detached' });
    await page.waitForFunction(() => !document.querySelector('.dataMaidItemDelete')?.disabled);
    assert.equal(await category.locator('.dataMaidItem').count(), 1, 'Failed Delete All must preserve its category and rows.');
    const expectedErrors = fatalBrowserDiagnostics.splice(expectedErrorIndex);
    assert.equal(expectedErrors.length, 1, `Expected one handled deletion error, got: ${expectedErrors.join('\n')}`);
    assert.match(expectedErrors[0], /Error deleting item/u);

    await category.locator('.inline-drawer-toggle').click();
    await category.locator('.dataMaidItemDelete').click();
    confirmation = page.locator('dialog.popup').filter({ hasText: 'This will permanently delete the file.' });
    await confirmation.locator('.popup-button-ok').click();
    await confirmation.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.dataMaidCategory').length === 0);
    assert.equal(deleteRequests.at(-1).hashes[0], 'hash-c', 'Individual delete must still send its item hash.');
    assert.equal(await dialog.locator('.dataMaidPlaceholder').textContent(), 'No items found to clean up. Come back later!');

    remainingItems = seedItems.map(item => ({ ...item }));
    await dialog.locator('.dataMaidStartButton').click();
    category = dialog.locator('.dataMaidCategory');
    await category.waitFor();
    await category.locator('.dataMaidDeleteAll').click();
    confirmation = page.locator('dialog.popup').filter({ hasText: 'This will permanently delete all files in this category.' });
    await confirmation.locator('.popup-button-ok').click();
    await confirmation.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.dataMaidCategory').length === 0);
    assert.deepEqual([...deleteRequests.at(-1).hashes].sort(), ['hash-a', 'hash-b', 'hash-c'], 'Delete All must still send every category hash.');

    await page.locator('dialog.popup').filter({ has: dialog }).locator('.popup-button-close').evaluate(button => button.click());
    await dialog.waitFor({ state: 'detached' });

    // The longer interaction gives STMB's first-run prompt bootstrap time to observe and repair its three missing resources.
    const bootstrapDiagnostics = fatalBrowserDiagnostics.splice(startingDiagnosticIndex);
    const expectedBootstrapPaths = [
        '/api/stmb/side-prompts',
        '/user/files/stmb-arc-prompts.json',
        '/user/files/stmb-summary-prompts.json',
    ];
    const responsePaths = bootstrapDiagnostics
        .filter(diagnostic => diagnostic.startsWith('response 404: '))
        .map(diagnostic => new URL(diagnostic.slice('response 404: '.length)).pathname)
        .sort();
    assert.deepEqual(
        responsePaths.filter(responsePath => !expectedBootstrapPaths.includes(responsePath)),
        [],
        `Unexpected delayed bootstrap responses: ${bootstrapDiagnostics.join('\n')}`,
    );
    assert.equal(new Set(responsePaths).size, responsePaths.length, `Repeated delayed bootstrap responses: ${bootstrapDiagnostics.join('\n')}`);
    assert.equal(
        bootstrapDiagnostics.filter(diagnostic => diagnostic === 'error: Failed to load resource: the server responded with a status of 404 (Not Found)').length,
        responsePaths.length,
        `Unexpected delayed bootstrap console errors: ${bootstrapDiagnostics.join('\n')}`,
    );
    assert.equal(bootstrapDiagnostics.length, responsePaths.length * 2, `Unexpected delayed bootstrap diagnostics: ${bootstrapDiagnostics.join('\n')}`);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aikobots-frontend-smoke-'));
const configPath = path.join(temporaryRoot, 'config.yaml');
const dataRoot = path.join(temporaryRoot, 'data');
const publicPath = value => value.split(path.sep).join('/');
const committedBundleHashes = await hashDirectory(defaultOutputDirectory);

await fs.mkdir(dataRoot);
await fs.writeFile(configPath, [
    `dataRoot: ${JSON.stringify(publicPath(dataRoot))}`,
    `defaultContentRoot: ${JSON.stringify(publicPath(path.join(projectRoot, 'default', 'content')))}`,
    `defaultScaffoldRoot: ${JSON.stringify(publicPath(path.join(projectRoot, 'default', 'scaffold')))}`,
    'listen: false',
    'browserLaunch:',
    '  enabled: false',
    'enableUserAccounts: false',
    'disableCsrfProtection: true',
    'extensions:',
    `  enabled: ${extensionsEnabled}`,
    '',
].join('\n'));

let server;
let getServerOutput = () => '';
let browser;
const pageErrors = [];
const browserDiagnostics = [];
const fatalBrowserDiagnostics = [];
try {
    const startedServer = await startServer(configPath, dataRoot);
    server = startedServer.child;
    getServerOutput = startedServer.output;
    const port = startedServer.port;
    const baseUrl = `http://127.0.0.1:${port}`;
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
            const diagnostic = `${message.type()}: ${message.text()}`;
            browserDiagnostics.push(diagnostic);
            if (message.type() === 'error') {
                fatalBrowserDiagnostics.push(diagnostic);
            }
        }
    });
    page.on('requestfailed', request => {
        const diagnostic = `request failed: ${request.url()} ${request.failure()?.errorText || ''}`;
        browserDiagnostics.push(diagnostic);
        fatalBrowserDiagnostics.push(diagnostic);
    });
    page.on('response', response => {
        if (response.status() >= 400) {
            const diagnostic = `response ${response.status()}: ${response.url()}`;
            browserDiagnostics.push(diagnostic);
            fatalBrowserDiagnostics.push(diagnostic);
        }
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#top_chat_bar');
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext().SlashCommandParser.commands['stmb-highest']), null, { timeout: 30_000 });

    assert.deepEqual(fatalBrowserDiagnostics, [], `Fatal browser diagnostics: ${fatalBrowserDiagnostics.join('\n')}`);
    const requests = [...applicationRequests].sort();
    assert.ok(requests.length <= 12, `Expected at most 12 startup JS/CSS requests, got ${requests.length}: ${requests.join(', ')}`);
    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('\n')}\nRequests: ${requests.join(', ')}`);
    assert.ok(requests.includes('/dist/stmb.js'), `STMB bundle was not loaded. Requests: ${requests.join(', ')}`);
    assert.equal(requests.includes('/dist/chunks/builtins.js'), extensionsEnabled, `Built-ins bundle loading did not match the extension setting. Requests: ${requests.join(', ')}`);
    assert.ok(requests.every(request => request.startsWith('/dist/') || request.startsWith('/css/layouts/') || request === '/css/user.css'), `Unexpected source request: ${requests.join(', ')}`);
    assert.ok(requests.every(request => !/(?:kokoro|pdf|epub)/iu.test(request)), `Optional engine loaded during startup: ${requests.join(', ')}`);
    assert.equal(await page.locator('#tts_provider').count(), 0, 'Disabled TTS built-in executed.');
    assert.equal(await page.locator('#tts-css').count(), 0, 'Disabled TTS built-in style was applied.');
    assert.equal(await page.evaluate(() => Boolean(globalThis.SillyTavern)), true, 'globalThis.SillyTavern is unavailable.');
    assert.equal(await page.locator('#world_info_locks_bar').count(), 1, 'Core World Info Locks bar was not initialized exactly once with extensions disabled.');
    assert.equal(await page.evaluate(() => Boolean(globalThis.SillyTavern.getContext().SlashCommandParser.commands.wipreset)), true, 'Core /wipreset command was not registered with extensions disabled.');
    assert.equal(await page.locator('#stmb-menu-item').count(), 1, 'STMB menu was not initialized.');
    assert.equal(await page.locator('#stmb-jobs-topbar-button[aria-controls="top_chat_stmb_jobs"]').count(), 1, 'STMB jobs UI was not initialized.');
    assert.equal(await page.locator('#aiko-layout-css[href="css/layouts/classic.css"]').count(), 1, 'Selected runtime layout link was not retained.');
    await testDataMaidMultiSelect(page, fatalBrowserDiagnostics);
    assert.deepEqual(fatalBrowserDiagnostics, [], `Unexpected Data Maid browser diagnostics: ${fatalBrowserDiagnostics.join('\n')}`);
    assert.equal(await page.evaluate(async () => (await (await globalThis.fetch('/version')).json()).pkgVersion), '5.0.0', 'Runtime version is not v5.');
    assert.deepEqual(await hashDirectory(defaultOutputDirectory), committedBundleHashes, 'Production startup modified committed frontend artifacts.');
    console.log(`Frontend ${browserName} smoke passed with ${requests.length} JS/CSS requests: ${requests.join(', ')}`);
} catch (error) {
    throw new Error(`${error.message}\nPage errors:\n${pageErrors.join('\n')}\nBrowser diagnostics:\n${browserDiagnostics.join('\n')}\n${getServerOutput()}`);
} finally {
    await browser?.close();
    await stopServer(server);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
}
