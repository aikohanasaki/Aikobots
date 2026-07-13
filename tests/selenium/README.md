# Aikobots Selenium MVP Harness

This is the MVP Selenium harness focused on high-signal JSONL output for LLM/Codex debugging.

## Required environment

Copy `.env.example` to `.env` and set:

- `ST_BASE_URL` (default `http://127.0.0.1:8000`)
- `TEST_HARNESS_ST_CONNECTION_PROFILE_NAME` (**required**; must match an
existing profile in UI, a tester specific one is recommended for tracking
spend/adjustments)
- `TEST_HARNESS_CHROME_BINARY_PATH` (set explicit Chrome/Chrome for Testing binary path)
- `TEST_HARNESS_CHROMEDRIVER_PATH` (set explicit chromedriver binary path, useful for Windows/macOS per-dev setup)

## Windows vs Mac

In windows the env file settings should NOT have ' or "  marks around values. 

In powershell you may need  to run  the following command if it's onery about
running scripts: 

`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

You will usually only have to do that 1x per user.

Your ST_PAGELOAD_TIMEOUT_MS  might need to be like 90000 because slower startup

In mac, the env file settings should  have ' marks around the paths and the test
harness profile name should be without spaces like zzzzTestHarness


## Commands

- `npm run test:selenium:mvp:smoke`
  - Runs only the smoke path (`node tests/selenium/run.mjs --smoke`) in a single browser session
  - Scope: bootstrap + connection-profile setup + chat create/rename/group-message flow
  - Response wait timeout is controlled by `ST_RESPONSE_TIMEOUT_MS` (default 90000)
- `npm run test:selenium:mvp`
  - Runs the same smoke path plus additional non-smoke scenarios


## Smoke test flow

`npm run test:selenium:mvp:smoke` executes these steps in order:

1. **Bootstrap (`run.mjs`)**
   - `bootstrap / load-app`: open the app and wait for shell readiness (`#top_chat_bar`).
2. **Connection profile setup (`scenarios/setup-connection-profile.mjs`)**
   - `open-connection-profiles-panel`
   - `verify-profile-exists`
   - `select-profile`
   - `close-connection-profiles-panel`
3. **Chat basic create/rename/group flow (`scenarios/chat-basic-create-rename.mjs`)**
   - Start and stabilize chat: `start-new-chat`, `wait-chat-ready`, `wait-connection-ready`
   - Send first prompt and verify reply: `send-user-message`, `wait-for-assistant-response`
   - Rename path: `wait-rename-ready`, `rename-temporary-chat`, `send-user-message-after-rename`, `wait-for-assistant-response-after-rename`
   - Group conversion path: `convert-chat-to-group`, `send-user-message-after-group-convert`, `wait-for-assistant-response-after-group-convert`
   - Group member activity path: `add-member-to-group`, `trigger-added-member-speak`, `send-user-message-after-added-member-speak`, `wait-for-assistant-response-after-added-member-speak`

## Non-smoke scenarios

When `--smoke` is **not** passed (for `npm run test:selenium:mvp`), `run.mjs` also runs:

- `chat-import-export-roundtrip`
- `chat-long-swipe-smoke`

These scenarios are intentionally excluded from `npm run test:selenium:mvp:smoke` to keep smoke runs focused and fast.

## Output

- Logs: `tests/selenium/logs/<runIdUtc>.jsonl`
- Artifacts: `tests/selenium/artifacts/<runIdUtc>/`
  - `downloads/` exported chat files
  - `snapshots/` screenshot + DOM snapshots for failed steps

## JSONL step records

Each step emits lifecycle phases: `start`, `pass`, `fail`, `end`.
Required fields include:

- `runIdUtc`, `testName`, `stepName`, `featureTags`, `phase`, `timestampUtc`, `durationMs`
- `expected`, `observed`, `selector`
- `error.message` (+ compact stack on failure)
- `artifactPaths` on failure
