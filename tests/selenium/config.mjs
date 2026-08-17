import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localEnvPath = path.resolve(__dirname, '.env');
if (fs.existsSync(localEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(localEnvPath));
    for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
} else {
    dotenv.config();
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
    const baseUrl = String(process.env.ST_BASE_URL || '').trim();
    const connectionProfileName = String(process.env.TEST_HARNESS_ST_CONNECTION_PROFILE_NAME || '').trim();
    const chromeBinaryPath = String(process.env.TEST_HARNESS_CHROME_BINARY_PATH || '').trim();
    const chromedriverPath = String(process.env.TEST_HARNESS_CHROMEDRIVER_PATH || '').trim();

    const missing = [
        !baseUrl && 'ST_BASE_URL',
        !connectionProfileName && 'TEST_HARNESS_ST_CONNECTION_PROFILE_NAME',
        !chromeBinaryPath && 'TEST_HARNESS_CHROME_BINARY_PATH',
        !chromedriverPath && 'TEST_HARNESS_CHROMEDRIVER_PATH',
    ].filter(Boolean);
    if (missing.length) {
        throw new Error(`Selenium is not configured. Set: ${missing.join(', ')}.`);
    }

    return {
        baseUrl,
        connectionProfileName,
        chromeBinaryPath,
        chromedriverPath,
        headless: parseBoolean(process.env.ST_HEADLESS, true),
        timeouts: {
            stepMs: parseNumber(process.env.ST_STEP_TIMEOUT_MS, 20_000),
            pageLoadMs: parseNumber(process.env.ST_PAGELOAD_TIMEOUT_MS, 60_000),
            scriptMs: parseNumber(process.env.ST_SCRIPT_TIMEOUT_MS, 30_000),
            downloadMs: parseNumber(process.env.ST_DOWNLOAD_TIMEOUT_MS, 20_000),
            responseMs: parseNumber(process.env.ST_RESPONSE_TIMEOUT_MS, 90_000),
        },
    };
}
