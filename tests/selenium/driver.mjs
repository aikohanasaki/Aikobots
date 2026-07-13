import fs from 'node:fs';
import path from 'node:path';

import { Builder, By, until, logging } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { ServiceBuilder } from 'selenium-webdriver/chrome.js';

function sanitizeSegment(value) {
    return String(value || 'unknown').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export async function createDriver({ headless, timeouts, downloadsDir, chromeBinaryPath, chromedriverPath }) {
    const options = new chrome.Options();
    options.addArguments('--window-size=1600,1200');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');

    options.setUserPreferences({
        'download.default_directory': downloadsDir,
        'download.prompt_for_download': false,
        'download.directory_upgrade': true,
        'safebrowsing.enabled': true,
    });

    if (chromeBinaryPath) {
        options.setChromeBinaryPath(chromeBinaryPath);
    }

    if (headless) {
        options.addArguments('--headless=new');
    }

    const builder = new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options);

    const loggingPrefs = new logging.Preferences();
    loggingPrefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);
    builder.setLoggingPrefs(loggingPrefs);

    if (chromedriverPath) {
        const service = new ServiceBuilder(chromedriverPath);
        builder.setChromeService(service);
    }

    const driver = await builder.build();

    await driver.manage().setTimeouts({
        pageLoad: timeouts.pageLoadMs,
        script: timeouts.scriptMs,
        implicit: 0,
    });

    return { driver, By, until };
}

export async function waitForFileInDirectory(directory, timeoutMs) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
        const files = fs.readdirSync(directory)
            .filter(file => !file.endsWith('.crdownload') && !file.endsWith('.tmp'));

        if (files.length > 0) {
            const sorted = files
                .map(file => ({ file, fullPath: path.join(directory, file), mtime: fs.statSync(path.join(directory, file)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            return sorted[0].fullPath;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`No downloaded file found in ${directory} within ${timeoutMs}ms.`);
}

export async function captureFailureArtifacts({ driver, snapshotsDir, testName, stepName }) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const stamp = Date.now();
    const namePrefix = `${sanitizeSegment(testName)}--${sanitizeSegment(stepName)}--${stamp}`;
    const screenshotPath = path.join(snapshotsDir, `${namePrefix}.png`);
    const domSnapshotPath = path.join(snapshotsDir, `${namePrefix}.html`);

    const screenshotBase64 = await driver.takeScreenshot();
    fs.writeFileSync(screenshotPath, screenshotBase64, 'base64');

    const dom = await driver.executeScript('return document.documentElement.outerHTML;');
    fs.writeFileSync(domSnapshotPath, String(dom || ''), 'utf8');

    return {
        screenshot: screenshotPath,
        domSnapshot: domSnapshotPath,
    };
}

export async function readBrowserConsoleLogs(driver) {
    if (!driver) {
        return [];
    }

    try {
        const entries = await driver.manage().logs().get(logging.Type.BROWSER);
        return entries.map(entry => ({
            level: String(entry.level?.name || entry.level || '').toUpperCase(),
            message: String(entry.message || ''),
            timestamp: Number(entry.timestamp || Date.now()),
        }));
    } catch {
        return [];
    }
}

export async function closeDriver(driver) {
    if (!driver) {
        return;
    }

    await driver.quit();
}
