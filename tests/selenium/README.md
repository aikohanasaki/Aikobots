# Aikobots Selenium MVP Harness

This is the MVP Selenium harness focused on high-signal JSONL output for LLM/Codex debugging.

## Required environment

Copy `.env.example` to `.env` and set:

- `ST_BASE_URL` (default `http://127.0.0.1:8000`)
- `TEST_HARNESS_ST_CONNECTION_PROFILE_NAME` (**required**; must match an existing profile in UI)
- `TEST_HARNESS_CHROME_BINARY_PATH` (optional; set explicit Chrome/Chrome for Testing binary path)
- `TEST_HARNESS_CHROMEDRIVER_PATH` (optional; set explicit chromedriver binary path, useful for Windows/macOS per-dev setup)

## Commands

- `npm run test:selenium:mvp:smoke`
  - Runs bootstrap + connection profile + create/rename scenarios
- `npm run test:selenium:mvp`
  - Runs full MVP scenarios

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
