import fs from 'node:fs';
import process from 'node:process';

/** Resolves an already-installed Chrome or Chromium executable without downloading anything. */
export function resolveSystemChromiumPath() {
    const candidates = [
        process.env.BROWSER_PATH,
        process.env.CHROME_PATH,
        process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        process.platform === 'linux' && '/usr/bin/google-chrome',
        process.platform === 'linux' && '/usr/bin/chromium',
        process.platform === 'linux' && '/usr/bin/chromium-browser',
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate)) || '';
}
