# How To Run The Prompt Parity Tests

This guide is written for a normal user, not a programmer.

You do **not** need to write code to use these tests.

## What These Tests Do

Each test case is a small scenario you run inside the app.

You:

1. open the app
2. set up the chat as described
3. click generate
4. export the final prompt snapshot
5. compare the result between `v2` and `release`

The main file with all test cases is [cases.json](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity/cases.json).

## Important Note

Right now, the self-serve snapshot export is implemented in `v2`.

That means:

- you can run the full workflow yourself on `v2` right now
- `release` still needs the same snapshot hook if you want the exact same easy export there

## Before You Start

You need:

- the app running locally
- the `v2` branch checked out
- a browser window open to the app
- access to browser developer tools

## One-Time Setup For Non-Admin Users

If your account is **not** an admin account, turn on the dev flag once before running these tests.

1. Open your `config.yaml` file in the root of the project.
2. Add or update this section:

```yaml
dev:
  promptParityAllowAllUsers: true
```

3. Save the file.
4. Restart the server.
5. Refresh the browser page.

What this does:

- it allows normal users to export the prompt-parity dispatch snapshot
- it does **not** open up all admin-only debug tools

If you turn this back off later, set it to `false` and restart the server again.

If you are using Chrome or Edge, you can usually open developer tools with:

- `F12`
- or `Ctrl+Shift+I`

## Where The Test Cases Are

Open [cases.json](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity/cases.json).

Each case has:

- `id`: the short name of the test
- `title`: the human-readable name
- `setup`: things you should prepare first
- `mutations`: changes you should make before the final generate
- `input`: the exact message to put into the input box
- `expectedSignals`: what should change or stay the same

## The Simple Workflow

Use this for each test case.

### 1. Pick one test case

Example:

- `baseline-single-turn`
- `hide-middle-message`
- `swipe-switch-nonzero`

### 2. Read the case fields

Look at:

- `setup`
- `mutations`
- `input`

### 3. Prepare the chat in the app

If the case says:

- create a fresh chat, do that
- add earlier messages, do that
- hide a message, do that
- edit or delete a message, do that
- switch swipes, do that

The goal is to make the app state match the test case before the final generate.

### 4. Put the case input into the normal message box

Copy the text from the case’s `input` field and paste it into the usual user input box.

### 5. Click generate once

This is the important generate.

The snapshot you export should represent the prompt right before the app would send it to the model.

### 6. Export the snapshot

Open browser developer tools, switch to the **Console** tab, then paste this:

```js
const snapshot = await SillyTavern.getLastServerDispatchSnapshot();
copy(JSON.stringify(snapshot, null, 2));
```

Then press Enter.

This copies the snapshot JSON to your clipboard.

### 7. Save the snapshot to a file

Create a folder like:

```text
tests/prompt-parity/artifacts/<caseId>/
```

Example:

```text
tests/prompt-parity/artifacts/baseline-single-turn/
```

Then save the copied JSON as:

- `v2.json` when testing `v2`
- `release.json` when testing `release`

Example:

```text
tests/prompt-parity/artifacts/baseline-single-turn/v2.json
```

## What To Compare

When you compare two saved snapshots, use this order:

### 1. World Info

Look at:

- `worldInfo.activatedEntries`
- each entry’s `placement`
- each entry’s `status`
- `worldInfo.overflowed`
- `worldInfo.budgetUsed`
- `worldInfo.timedState`

This is one of the main things these tests are checking.

### 2. Final Messages

Look at:

- message order
- message role
- message content
- message names

### 3. Tools

Look at:

- `tools`
- `tool_choice`

### 4. Other Request Settings

Look at:

- `model`
- `max_tokens`
- `max_completion_tokens`
- `reasoning_effort`
- `custom_prompt_post_processing`

## Good Starter Cases

If you want to begin with a small set, use these first:

### Easy baseline

- `baseline-single-turn`
- `baseline-multi-turn`
- `baseline-quiet`

### World Info

- `wi-basic-before`
- `wi-budget-overflow-global`
- `wi-budget-overflow-per-book`

### Chat mutations

- `hide-middle-message`
- `hide-edit-unhide`
- `edit-user-message`
- `delete-middle-message`

### Swipes

- `swipe-switch-nonzero`
- `swipe-edit-selected`
- `swipe-delete-selected`

## Example: Running One Case

Here is a simple example using `baseline-single-turn`.

1. Open [cases.json](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity/cases.json).
2. Find `baseline-single-turn`.
3. Create a fresh one-on-one chat.
4. Leave prompt settings at default.
5. Paste this into the input box:

```text
Give a short in-character greeting.
```

6. Click generate.
7. Open browser developer tools.
8. Go to the Console tab.
9. Paste:

```js
const snapshot = await SillyTavern.getLastServerDispatchSnapshot();
copy(JSON.stringify(snapshot, null, 2));
```

10. Save the copied JSON as:

```text
tests/prompt-parity/artifacts/baseline-single-turn/v2.json
```

## Troubleshooting

### “SillyTavern.getLastServerDispatchSnapshot is not a function”

Most likely reasons:

- you are not on the `v2` branch
- the app was not restarted after the code changes
- the page was not refreshed after restart

### “403 Forbidden” or “Prompt dispatch snapshots are blocked”

Usually this means:

- you are logged in as a non-admin user
- `dev.promptParityAllowAllUsers` is still `false`
- the server was not restarted after changing `config.yaml`

Check the one-time setup section above, then restart and refresh.

### “No prompt dispatch snapshot is available for this session.”

Usually this means:

- you have not done a generate yet in this browser session
- the generate failed before reaching the snapshot point

Try again:

1. refresh the page
2. run one generate
3. export the snapshot again

### I do not know how to read `cases.json`

Start with just these fields:

- `id`
- `setup`
- `mutations`
- `input`

You can ignore the rest at first.

### I want fewer tests

Start with the 12 starter cases listed above.

## Optional: Local Validation Tests

There are also local test files:

- [prompt-parity-cases.test.js](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity-cases.test.js)
- [world-info-debug-summary.test.js](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/world-info-debug-summary.test.js)

These are more developer-oriented. You do not need them for the manual workflow above.

## Optional: Run Cases With The Playwright Helper

If you want the computer to do the repetitive parts for you, use:

- [run-playwright.mjs](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity/run-playwright.mjs)

What it does:

- opens the app in a browser
- shows you one case at a time
- waits for you to finish any setup or mutation steps
- sends the case input
- exports and saves the snapshot JSON automatically

### First-time setup

Playwright is not included in this repo by default.

Install it once:

```bash
npm install -D playwright
npx playwright install chromium
```

### Run one case

```bash
node tests/prompt-parity/run-playwright.mjs --case baseline-single-turn
```

### Run several named cases

```bash
node tests/prompt-parity/run-playwright.mjs --case wi-basic-before --case hide-middle-message --case swipe-switch-nonzero
```

### Run all cases

```bash
node tests/prompt-parity/run-playwright.mjs --all
```

### Useful options

```bash
node tests/prompt-parity/run-playwright.mjs --all --branch v2
node tests/prompt-parity/run-playwright.mjs --case baseline-single-turn --base-url http://localhost:8000
node tests/prompt-parity/run-playwright.mjs --all --headless
node tests/prompt-parity/run-playwright.mjs --list
```

### What to expect

For each case, the script will:

1. show the case id and instructions in the terminal
2. let you press Enter when the browser is ready
3. send the case input
4. wait for a new prompt snapshot
5. save the result to:

```text
tests/prompt-parity/artifacts/<caseId>/<branch>.json
```

### Important limitation

This script does **not** fully automate every chat mutation yet.

That means:

- it can send the input and save the snapshot for you
- you still need to do case-specific setup in the UI first
- this is especially true for hide/unhide, edits, deletes, and swipe changes

It is still much faster than copying snapshots manually.

## Short Version

For each case:

1. read the case in [cases.json](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity/cases.json)
2. prepare the chat exactly as described
3. enter the case input
4. click generate
5. run this in the browser console:

```js
const snapshot = await SillyTavern.getLastServerDispatchSnapshot();
copy(JSON.stringify(snapshot, null, 2));
```

6. save the JSON
7. compare the saved files
