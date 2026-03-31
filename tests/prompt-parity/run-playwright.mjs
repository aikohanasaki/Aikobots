import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.join(__dirname, 'cases.json');
const defaultArtifactsDir = path.join(__dirname, 'artifacts');

function printHelp() {
    console.log(`
Prompt parity Playwright runner

Usage:
  node tests/prompt-parity/run-playwright.mjs --case baseline-single-turn
  node tests/prompt-parity/run-playwright.mjs --all

Options:
  --case <id>         Run a single case. May be repeated.
  --all               Run all cases.
  --branch <name>     Artifact branch label. Defaults to current git branch.
  --base-url <url>    App URL. Default: http://localhost:8000
  --browser <name>    chromium | firefox | webkit. Default: chromium
  --headless          Run headless. Default is headed.
  --output-dir <dir>  Artifact directory. Default: tests/prompt-parity/artifacts
  --no-pause          Do not pause before each case.
  --list              Print all case ids and exit.
  --help              Show this help.

Notes:
  - This runner expects the app to already be running.
  - It is designed for the current v2 snapshot export flow.
  - Cases with setup or mutations still need human prep unless you extend the runner.
`);
}

function parseArgs(argv) {
    const options = {
        caseIds: [],
        all: false,
        branch: null,
        baseUrl: 'http://localhost:8000',
        browser: 'chromium',
        headless: false,
        outputDir: defaultArtifactsDir,
        pause: true,
        list: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];

        switch (value) {
            case '--case':
                options.caseIds.push(String(argv[++index] || ''));
                break;
            case '--all':
                options.all = true;
                break;
            case '--branch':
                options.branch = String(argv[++index] || '');
                break;
            case '--base-url':
                options.baseUrl = String(argv[++index] || options.baseUrl);
                break;
            case '--browser':
                options.browser = String(argv[++index] || options.browser);
                break;
            case '--headless':
                options.headless = true;
                break;
            case '--output-dir':
                options.outputDir = path.resolve(String(argv[++index] || options.outputDir));
                break;
            case '--no-pause':
                options.pause = false;
                break;
            case '--list':
                options.list = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            default:
                throw new Error(`Unknown argument: ${value}`);
        }
    }

    return options;
}

function getCurrentBranch() {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: path.resolve(__dirname, '..', '..'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return 'unknown-branch';
    }
}

async function loadCorpus() {
    return JSON.parse(await fs.readFile(corpusPath, 'utf8'));
}

async function loadPlaywright(browserName) {
    let playwright;

    try {
        playwright = await import('playwright');
    } catch {
        throw new Error(
            'Playwright is not installed. Install it with "npm install -D playwright" or use "npx playwright install chromium" first.',
        );
    }

    const browserType = playwright[browserName];
    if (!browserType) {
        throw new Error(`Unsupported browser "${browserName}". Use chromium, firefox, or webkit.`);
    }

    return browserType;
}

function formatCaseStepList(title, items = []) {
    if (!Array.isArray(items) || !items.length) {
        return `${title}: none`;
    }

    return `${title}:\n${items.map((item, index) => `  ${index + 1}. ${item}`).join('\n')}`;
}

async function waitForAppReady(page, baseUrl) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('preloader') === null, { timeout: 0 });
    await page.waitForFunction(() => typeof globalThis.SillyTavern?.getLastServerDispatchSnapshot === 'function', { timeout: 60000 });
    await page.waitForSelector('#send_textarea', { timeout: 60000 });
}

async function getSnapshotOrNull(page) {
    return await page.evaluate(async () => {
        try {
            return await globalThis.SillyTavern.getLastServerDispatchSnapshot();
        } catch {
            return null;
        }
    });
}

async function startGeneration(page, testCase) {
    if (testCase.type === 'quiet') {
        await page.evaluate(async caseInput => {
            const mod = await import('/script.js');
            mod.Generate('quiet', { quiet_prompt: caseInput, quietToLoud: true }).catch(error => console.warn(error));
        }, testCase.input);
        return;
    }

    await page.locator('#send_textarea').fill(testCase.input || '');
    await page.locator('#send_textarea').dispatchEvent('input');

    if (testCase.type === 'normal') {
        await page.click('#send_but');
        return;
    }

    await page.evaluate(async type => {
        const mod = await import('/script.js');
        mod.Generate(type).catch(error => console.warn(error));
    }, testCase.type);
}

async function waitForNewSnapshot(page, previousCapturedAt) {
    const start = Date.now();

    while ((Date.now() - start) < 30000) {
        const snapshot = await getSnapshotOrNull(page);
        const capturedAt = snapshot?.capturedAt || null;
        if (capturedAt && capturedAt !== previousCapturedAt) {
            return snapshot;
        }

        await page.waitForTimeout(500);
    }

    throw new Error('Timed out waiting for a new dispatch snapshot.');
}

async function saveArtifact(outputDir, branch, testCase, snapshot) {
    const caseDir = path.join(outputDir, testCase.id);
    await fs.mkdir(caseDir, { recursive: true });
    const artifactPath = path.join(caseDir, `${branch}.json`);
    await fs.writeFile(artifactPath, JSON.stringify(snapshot, null, 2));
    return artifactPath;
}

async function promptForCaseReadiness(rl, testCase) {
    console.log('\n============================================================');
    console.log(`${testCase.id} - ${testCase.title}`);
    console.log(`Type: ${testCase.type}`);
    console.log(formatCaseStepList('Setup', testCase.setup));
    console.log(formatCaseStepList('Mutations', testCase.mutations));
    console.log(`Input:\n  ${JSON.stringify(testCase.input)}`);
    console.log(formatCaseStepList('Expected signals', testCase.expectedSignals));
    console.log('When the browser is ready for the measured generate, press Enter.');

    const answer = (await rl.question('Press Enter to continue, or type "skip" / "quit": ')).trim().toLowerCase();
    if (answer === 'quit') {
        return 'quit';
    }
    if (answer === 'skip') {
        return 'skip';
    }
    return 'continue';
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const corpus = await loadCorpus();
    const allCases = Array.isArray(corpus.cases) ? corpus.cases : [];

    if (options.list) {
        allCases.forEach(testCase => console.log(testCase.id));
        return;
    }

    let selectedCases = [];
    if (options.all) {
        selectedCases = allCases;
    } else if (options.caseIds.length) {
        selectedCases = options.caseIds.map(caseId => {
            const found = allCases.find(testCase => testCase.id === caseId);
            if (!found) {
                throw new Error(`Case not found: ${caseId}`);
            }
            return found;
        });
    } else {
        throw new Error('Choose --all or at least one --case <id>.');
    }

    const branch = options.branch || getCurrentBranch();
    const browserType = await loadPlaywright(options.browser);
    const browser = await browserType.launch({ headless: options.headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    const rl = readline.createInterface({ input, output });

    try {
        await waitForAppReady(page, options.baseUrl);
        console.log(`Connected to ${options.baseUrl}`);
        console.log(`Artifacts will be saved as branch "${branch}" in ${options.outputDir}`);

        for (const testCase of selectedCases) {
            await waitForAppReady(page, options.baseUrl);

            if (options.pause) {
                const readiness = await promptForCaseReadiness(rl, testCase);
                if (readiness === 'quit') {
                    break;
                }
                if (readiness === 'skip') {
                    continue;
                }
            }

            const previousSnapshot = await getSnapshotOrNull(page);
            const previousCapturedAt = previousSnapshot?.capturedAt || null;

            console.log(`Running ${testCase.id}...`);
            await startGeneration(page, testCase);
            const snapshot = await waitForNewSnapshot(page, previousCapturedAt);
            const artifactPath = await saveArtifact(options.outputDir, branch, testCase, snapshot);
            console.log(`Saved ${artifactPath}`);
        }
    } finally {
        rl.close();
        await context.close();
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
