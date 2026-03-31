# Prompt Parity Workflow

Use the same case from [cases.json](/c:/Users/ai/Aikobots%20Code/Aikobots/tests/prompt-parity/cases.json) in both `release` and `v2`.

## Run A Case

1. Load the target branch and open the app normally.
2. Apply the case `setup` exactly as written.
3. Apply each `mutation` in order before the measured generate.
4. Paste the case `input` into the normal user input box.
5. Click generate once.
6. Open the browser console and run:

```js
const snapshot = await SillyTavern.getLastServerDispatchSnapshot();
copy(JSON.stringify(snapshot, null, 2));
```

7. Save the copied JSON to `tests/prompt-parity/artifacts/<caseId>/<branch>.json`.

## Compare In This Order

1. `worldInfo.activatedEntries`, placement, and per-entry `status`
2. `worldInfo.budgetUsed`, `worldInfo.overflowed`, and `worldInfo.timedState`
3. `messages` order, role, content, and name fields
4. `tools` and `tool_choice`
5. `requestPayload` fields that materially change dispatch behavior

## Notes

- Mutation cases are only valid if the hide/unhide, edit, delete, and swipe state is already applied before the measured generate.
- `caseId` in the snapshot is optional today; use the corpus case id for filenames even if the field is `null`.
- Provider headers and transport-only metadata are intentionally excluded from comparison.
