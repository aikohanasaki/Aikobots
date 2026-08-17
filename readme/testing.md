# Testing

## First-time setup

Use Node 24.18.0 and npm 12.0.1, then run this once with registry access:

```sh
npm ci
```

The lockfile is the only dependency source. npm stores downloaded packages in the ignored repository-local `.npm-cache/` directory. Test commands never install packages, invoke `npx`, download browsers, or contact the npm registry. `npm audit` remains an explicit, networked command.

After a successful online install, a clean reinstall can use only the populated cache:

```sh
npm ci --offline
```

On Node 24, `better-sqlite3` uses its published prebuild. MSVC Build Tools are needed on Windows only if a future dependency version has no matching prebuild. The production image retains Alpine's native build toolchain during installation.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run test:doctor` | Read-only toolchain, install-policy, SQLite, test-discovery, and browser checks. |
| `npm run test:node` | Run the `*.node.test.js` suite with Node's built-in test runner. |
| `npm run test:jest` | Run the `*.test.js` suite with the locked local Jest. |
| `npm run test:unit` | Run both unit-test suites. |
| `npm test` | Run the doctor, units, committed frontend bundle check, and self-contained Chromium smoke. |
| `npm run verify` | Run full ESLint, localization coverage, and `npm test`. |
| `npm run lint:files -- path/to/file.js` | Lint selected files with the local ESLint executable. |
| `npm run build:frontend` | Explicitly rebuild the committed frontend bundles. This may change tracked files. |

The default Chromium smoke uses `BROWSER_PATH`, then `CHROME_PATH`, then an installed system Chrome/Chromium location. Playwright browser downloads are not part of setup or routine testing.

## Selenium (explicit external testing only)

Selenium is outside `npm test` because it needs a running application, a dedicated connection profile, and can spend external model API credits. Do not run it without authorization.

Configure all four values before running the doctor:

```text
ST_BASE_URL=http://127.0.0.1:8000
TEST_HARNESS_ST_CONNECTION_PROFILE_NAME=A dedicated test profile
TEST_HARNESS_CHROME_BINARY_PATH=C:\path\to\chrome-for-testing\chrome.exe
TEST_HARNESS_CHROMEDRIVER_PATH=C:\path\to\chromedriver.exe
```

`npm run test:selenium:doctor` verifies existing files, matching browser/driver major versions, server reachability, and the configured profile name. It never invokes Selenium Manager or downloads a driver. Once it passes, the existing `test:selenium:mvp:smoke` and `test:selenium:mvp` commands remain the explicit test entry points.
