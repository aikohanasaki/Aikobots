# STMB Running Parity Checklist

Reference oracle: `aikohanasaki/SillyTavern-MemoryBooks@8f21abc8de6079544333911bda3bb8cb9e112beb`

This file is updated subsystem by subsystem during the audit. Only sections that have been actively audited are listed here so far.

## 1. Config / Profiles

| Item | Status | Note |
| --- | --- | --- |
| Settings defaults match STMB exactly. | Partial | Core normalization now matches STMB for `maxTokens`, `tokenWarningThreshold`, `defaultMemoryCount`, `autoSummaryInterval`, and summary/arc order syncing; the remaining gap is broader end-to-end runtime verification rather than raw defaults, and legacy settings-migration branches in STMB are out of scope. |
| Settings migration/import is idempotent. | Partial | Steady-state import/normalization now preserves builtin `current_st` invariants, duplicate builtin cleanup, outlet-only `outletName` retention, `convertExistingRecursion` persistence, and summary prompt first-run migration; legacy STMB migration side effects are now treated as non-goal compatibility code, per-profile prompt overrides remain intentionally removed by user request, and broader runtime verification is still pending. |
| Profile CRUD behavior matches STMB. | Exact | Dedicated profile-manager create/edit/delete/export/import flow has now passed manual testing, including safe-name handling, duplicate-count import reporting, outlet validation, builtin protections, and explicit `Set As Default`; per-profile prompt overrides remain intentionally removed by approved deviation. |
| `current_st` / dynamic profile behavior matches STMB. | Exact | Builtin profile invariants and current-ST profile behavior passed manual testing through the dedicated profile editor. |
| Custom/full-manual profile behavior matches STMB. | Exact | Full-manual endpoint requirements, field visibility, and save/reopen behavior passed manual testing in the dedicated profile editor. |
| Provider/model/temperature/endpoint/apiKey overrides match STMB. | Exact | Provider/model/temperature/endpoint/apiKey override behavior passed manual testing in the dedicated profile editor and settings surface. |
| Regex selection behavior matches STMB. | Exact | Memory flow applies selected outgoing/incoming regex in STMB order, and `showRegexSelectionPopup` now matches STMB's popup-local save/select2/toast semantics. |
| Lorebook routing/manual mode behavior matches STMB. | Partial | Silent manual-mode fallback to chat-bound lorebook was removed, missing/unbound lorebooks now enter a recovery popup flow closer to STMB, and auto-create now uses STMB-style sanitized unique-name binding before attaching the new lorebook to chat metadata; the full reference flow is still broader. |

## 2. Scene System

| Item | Status | Note |
| --- | --- | --- |
| Scene marker placement/removal matches STMB. | Exact | Local toggle logic matches STMB's `calculateNewSceneState` semantics. |
| Start/end marker validation matches STMB. | Exact | Validation and single-message scene allowance match STMB. |
| `scenememory` behavior matches STMB. | Partial | Main range parsing, deterministic validation, scene-set messaging, centralized launch handoff, busy-state gating, character/group readiness checks, and `unhideBeforeMemory` preflight now match STMB more closely; final runtime verification is still pending. |
| `nextmemory` behavior matches STMB. | Partial | Empty-chat, no-new-message, lorebook preflight, and busy-state surfaces are now closer to STMB; final runtime verification is still pending. |
| Deleted-message handling shifts markers exactly like STMB. | Partial | Marker-shift semantics and notification strings are now centralized in a pure helper that matches the reference deletion path more closely, and focused regression coverage now exists for before-scene, single-message-scene, and empty-chat cases; final runtime verification is still pending. |
| Highest processed message tracking matches STMB. | Partial | Runtime tracking exists, deletion rebasing is now covered by the shared scene-state helper and focused tests, and the remaining uncertainty is slash-surface/runtime verification rather than core rebasing logic. |
| Group chat behavior matches STMB. | Partial | State now resolves from active chat context and uses group names for scene requests; full group-chat parity remains to be verified. |
| Invalid ranges fail deterministically like STMB. | Exact | `/scenememory` range parsing and failure taxonomy now live in a pure helper with focused regression coverage, and the slash-surface error strings match STMB's range validation path. |

## 3. Memory Generation

| Item | Status | Note |
| --- | --- | --- |
| Prompt preset bodies match STMB exactly. | Partial | Built-in prompt content appears aligned, and summary prompts are now loaded from a dedicated file-backed manager with legacy migration; browser/runtime verification is still pending. |
| Prompt selection/custom prompt override behavior matches STMB. | Partial | Profile preset selection works, and the main settings surface already exposes STMB-style summary-order controls; the remaining intentional difference is the approved removal of per-profile custom prompt overrides in favor of the dedicated prompt managers. |
| Scene compilation input matches STMB. | Partial | Prompt assembly now uses STMB-style transcript formatting; further verification is needed. |
| Previous-memory context behavior matches STMB. | Partial | Prompt assembly now includes STMB-style previous scene context blocks and keywords, and previous-context selection now follows STMB's `stmemorybooks === true` identification semantics; end-to-end verification is still pending. |
| Provider request shaping matches STMB profile semantics. | Partial | Core shaping exists and current patch restores STMB-like prompt text flow; standard structured-memory parsing now returns from `/api/stmb/generate-memory`, while the regex-adjusted path still stays client-side for browser regex execution but now preserves STMB-like provider truncation detection and cleaned repair text. |
| Structured parsing/error taxonomy matches STMB. | Partial | Parser logic is close, and regex-mode failures now surface the post-regex raw text plus provider truncation more like STMB; broader end-to-end runtime verification is still pending. |
| Claude/tool-use handling matches STMB. | Partial | Parser supports Claude structured content/tool blocks; generation path still needs explicit verification. |
| Truncation/malformed JSON handling matches STMB. | Partial | Parser has truncation/malformed branches; UI/error popup parity still open. |
| No silent fallback to plain text. | Exact | Current flow still requires structured JSON parsing. |

## 4. Memory Review / Repair Flow

| Item | Status | Note |
| --- | --- | --- |
| Confirmation popup flow matches STMB decision points. | Partial | Confirmation and advanced-options popups now exist, include a direct settings-popup handoff during memory setup, and have dynamic save-and-create behavior closer to STMB; full popup/UI parity still needs runtime validation. |
| Advanced options flow matches STMB. | Partial | Profile/prompt/context-memory editing, live total-token estimation, and dynamic save-and-create behavior are now wired in; full CRUD/UI parity remains open. |
| Preview/edit/save behavior matches STMB. | Partial | Preview and edit paths exist; end-to-end runtime validation is still pending. |
| Retry generation behavior matches STMB. | Partial | Retry from preview/manual-repair now preserves advanced context-memory count; popup/runtime parity still needs verification. |
| Manual JSON repair behavior matches STMB. | Partial | Failed-response repair path is wired, and the failed-memory popup now guards against duplicate apply clicks plus in-flight close races more like STMB; final runtime/popup semantics still need matching. |
| Failed AI response popup behavior matches STMB. | Partial | Surface exists and uses raw-response repair; it now includes a reference-style fail-safe wrapper, apply re-entry guard, and in-flight close protection, but exact STMB flow is not yet fully matched. |
| `/stmb-stop` behavior during generation/review/repair matches STMB. | Partial | Root-task cancellation exists; popup-interaction edge cases still need audit. |

## 5. Lorebook Persistence

| Item | Status | Note |
| --- | --- | --- |
| Managed entry identification fields match STMB. | Exact | Static audit now confirms memory/summary managed-entry identification uses STMB's `stmemorybooks === true` field set, with summary-type migration handling legacy `stmbArc` / `disabledByArcId` carryover. |
| Title numbering and formats match STMB. | Exact | Stepped through against `addlore.js`: numbering conflict detection, format-aware extraction fallback, wrapped-token rendering, repeated token replacement, no-token format handling, and order derivation now follow STMB's decision path. |
| Order calculation matches STMB. | Exact | Core order math, reverse/manual handling, and computed-order clamp notification semantics now follow STMB's `addlore.js` path. |
| Metadata roundtrip matches STMB. | Partial | Extra memory-only `STMB_*` fields were removed, side-prompt checkpoint read/write semantics are now centralized and audited, and legacy summary metadata migration now persists through the server commit path instead of only mutating the client copy; remaining roundtrip risk is broader runtime/write-path verification. |
| `STMemoryBooks` / `stmemorybooks` / scene range / tracker metadata fields match STMB. | Exact | Static audit now confirms memory scene-range fields, summary disable provenance fields, chat metadata ownership under `STMemoryBooks`, and side-prompt tracker/checkpoint fields match the audited STMB field set. |
| Secure vs user lorebook routing matches Aikobots expectations without breaking STMB semantics. | Partial | Routing is present through `/api/stmb`, and missing/unbound lorebooks now use an STMB-like recovery flow instead of hard-failing, but broader write-path verification is still pending. |
| Cache invalidation/read-after-write behavior is correct. | Partial | Save paths now invalidate cache, memories reapply STMB-like refresh/auto-hide client effects, summary commits refresh the editor again, and sideprompt/tracker writes now refresh the editor more like STMB; runtime validation is still pending. |

### `addlore.js` Focus Checklist

| Item | Status | Disposition | Note |
| --- | --- | --- | --- |
| Title numbering helpers (`generateEntryTitle` / `getNextEntryNumber` / `extractNumberUsingFormat` / `extractNumberFromTitle`) | Exact | Closed | Stepped through against the reference; numbering conflict detection, format-aware fallback, wrapped-token rendering, repeated token replacement, no-token handling, and order derivation now match STMB semantics. |
| Lorebook order computation (`computeLorebookEntryOrder` / `applyLorebookEntrySettings`) | Exact | Closed | Core order math, reverse/manual handling, and computed-order clamp notification semantics now match STMB's `addlore.js` behavior. |
| Main save orchestration (`addMemoryToLorebook`) | Partial | Fix now | Local save is split between `/api/stmb/save-memory` and client post-save effects. Persistence is close, but this still needs end-to-end verification for notification timing, refresh-editor behavior, auto-hide behavior, highest-processed updates, and scene-marker clearing. |
| Managed-entry helper semantics (`isMemoryEntry` / `identifyMemoryEntries`) | Exact | Closed | Local managed-entry identification now matches STMB's `addlore.js` helper semantics by treating any `stmemorybooks === true` entry as in-scope and sorting by the same title-derived sequence path. |
| Utility helpers (`validateTitleFormat`, `previewTitle`, `getLorebookStats`, `getEntryByTitle`) | Exact | Closed | Shared helpers now cover title-format validation, preview generation, exact/fallback title lookup, and lorebook stats calculation; runtime stats resolution lives in `stmb-lorebook.js` without forcing recovery UI, while the pure calculation path lives in `stmb-core.js` for focused reuse and tests. |
| Upsert-by-title helpers (`upsertLorebookEntryByTitle`, `upsertLorebookEntriesBatch`) | Partial | Acceptable deviation for now | Equivalent behavior exists through `/api/stmb` and sideprompt helpers, but ownership and surface shape differ from the reference module. Not blocking memory-save parity unless we decide the module API itself must match. |

## 6. Summaries / Consolidation

| Item | Status | Note |
| --- | --- | --- |
| Tier definitions match STMB. | Exact | Tier map and labels align with STMB's `summaryTiers.js`. |
| Eligibility rules match STMB. | Partial | Core source-entry filtering and legacy summary migration align, but full runtime validation is still pending. |
| Summary prompts match STMB. | Partial | The dedicated summary prompt manager is now at exact semantic parity except for the approved no-profile-custom-prompt deviation, built-in prompt bodies appear aligned, and consolidation prompts now use a dedicated file-backed `stmb-arc-prompts.json` cache; broader prompt/runtime validation is still open. |
| Sequential summary analysis behavior matches STMB. | Partial | Previous-summary context, chronological briefs, selected-source filtering, parse-retry, token-budget trimming, max-pass controls, and repair-path source preservation are now closer; browser/runtime validation is still pending. |
| `member_ids` semantics match STMB. | Partial | Ambiguous multi-summary cases are rejected and member ID resolution matches STMB closely; broader manual-repair/runtime coverage is still pending. |
| Ambiguous multi-summary cases are handled like STMB. | Partial | Parser rejects multiple summaries without `member_ids`; UI-level repair messaging still needs matching. |
| Commit behavior and disabling originals match STMB. | Partial | Commit path, tier numbering, selected-source disabling, editor refresh, `disabledBySummaryId` behavior, and legacy summary-field migration persistence are aligned more closely now; broader runtime verification is still pending. |
| Auto-summary trigger behavior matches STMB. | Partial | Runtime trigger checks now exist for single chats and `GROUP_WRAPPER_FINISHED`, manual-mode lorebook select/postpone flow is present, and manual auto-summary now re-enters lorebook validation/load checks after selection instead of trusting the selected name alone; broader runtime parity still needs verification. |
| Manual summary repair popup flow matches STMB. | Partial | Failed-summary repair popup now supports extracted fields, corrected JSON application, missing-context messaging, and original/pre-retry raw display; broader runtime parity is still open. |
| Auto-consolidation prompt flow matches STMB. | Partial | Prompt gating, duplicate-prompt suppression, post-memory trigger, next-tier chaining, no-lorebook popup rendering, and multi-pass consolidation controls are now closer; dedicated arc prompt-manager UI parity is still open. |

## 7. Side Prompts / Trackers

| Item | Status | Note |
| --- | --- | --- |
| Template schema matches STMB. | Exact | Static audit now confirms the V2 triggers-based schema, V1->V2 migration, import normalization, runtime-macro trigger stripping, and legacy Cast-key migration semantics match the audited manager path. |
| Built-in templates match STMB. | Exact | Static audit now confirms Plotpoints, Status, Cast, and Assess built-ins match the reference field set and trigger defaults, including the Cast built-in key alignment to `cast`. |
| Macro parsing and substitution match STMB. | Partial | Runtime macro parsing, quoting, autocomplete suggestions, and substitution are now close to STMB; more end-to-end validation is still needed. |
| Manual `/sideprompt` command behavior matches STMB. | Partial | Manual flow now also uses active chat-context metadata for group/manual lorebook state and group scene metadata, but broader runtime verification is still pending. |
| Interval tracker behavior matches STMB. | Partial | Checkpoint semantics, preview serialization, token overrides, editor refresh, temporary unhide/restore compilation, and no-checkpoint-on-preview-cancel behavior now align more closely with STMB; Aikobots intentionally deviates from STMB by regenerating immediately when a user clicks preview `Retry`, and broader runtime verification is still pending. |
| Post-memory trigger behavior matches STMB. | Partial | Side prompts now inherit the current memory profile unless a template override replaces it, use abort-aware per-attempt generation closer to STMB, and process after-memory runs in concurrent waves with receipt-order previews, batched wave saves, preview-failure fallback, and aggregate notifications closer to STMB; broader runtime verification is still pending. |
| Overwrite-by-title tracker semantics match STMB. | Partial | Unified title lookup, built-in key naming, legacy score fallback, and checkpoint metadata are now centralized and audited; the remaining uncertainty is broader runtime behavior, not the static title/checkpoint path. |
| Checkpoint metadata semantics match STMB. | Exact | `STMB_sp_*`, generic tracker fallback fields, legacy score fallback reads, and after-memory last-run-only writes now follow the audited STMB checkpoint path through shared helpers. |
| Preview/retry/cancel/manual behavior matches STMB. | Partial | Preview queue serialization, abort-aware retry attempts, interval retry-skip-save semantics, and manual/after-memory preview-failure fallback are now closer to STMB, and after-memory approvals now persist in wave batches; broader runtime verification is still pending. |
| Side prompt profile override behavior matches STMB. | Partial | Template override profiles and parent-memory profile fallback now align more closely; broader runtime verification is still pending. |

## 8. Slash Commands and Runtime

| Item | Status | Note |
| --- | --- | --- |
| `creatememory` | Exact | Registered name, empty-scene fast-fail, and launch handoff now match STMB semantically. |
| `scenememory` | Exact | Range parsing, validation taxonomy, scene-set messaging, and launch handoff now match STMB semantically. |
| `nextmemory` | Exact | Busy-state gating, lorebook preflight, range derivation, and no-new-message handling now match STMB semantically. |
| `sideprompt` | Partial | Command help text, autocomplete, macro suggestions, and toast flow are now closer to STMB, but runtime parity still depends on finishing sideprompt subsystem audit. |
| `sideprompt-on` | Exact | Help text, `all` handling, update-event dispatch, and user-facing enable/disable semantics match STMB. |
| `sideprompt-off` | Exact | Help text, `all` handling, update-event dispatch, and user-facing enable/disable semantics match STMB. |
| `stmb-highest` | Exact | Return semantics match STMB's direct `String(getHighestMemoryProcessed())` behavior. |
| `stmb-set-highest` | Partial | Main error/success/clamp semantics match STMB closely; the remaining uncertainty is whether popup refresh breadth fully matches STMB's full refresh path in every open-settings state. |
| `stmb-stop` | Partial | Stop text, in-flight detection, toast clearing, and preview popup closing are aligned; the remaining gap is runtime validation that task-abort coverage fully substitutes for STMB's legacy busy-flag resets in every generation/review/repair path. |

## 9. UI / Popup Surfaces

| Item | Status | Note |
| --- | --- | --- |
| Main STMB entry points exist. | Exact | The Memory Books menu entry and main settings popup now pass manual testing for the supported settings surface; the bottom-of-popup layout has an approved deviation from STMB. |
| Memory preview popup matches STMB flow. | Partial | Preview/edit/retry/cancel behavior is much closer, including serialized sideprompt previews and STMB-style invalid-input guard/logging for preview launch; broader runtime validation is still needed. |
| Failed memory repair popup matches STMB flow. | Partial | Raw-response repair flow exists, and the popup now blocks duplicate apply clicks and in-flight close races with a fail-safe wrapper closer to STMB; the full STMB popup surface is still not matched exactly. |
| Summary consolidation popup matches STMB flow. | Partial | The popup now preserves summary-entry settings, renders candidate checklists by tier, honors selected source entries, exposes max-items/token/max-pass controls, uses a file-backed arc prompt cache, and still renders without a lorebook like STMB; browser/runtime validation is still pending. |
| Failed summary repair popup matches STMB flow. | Partial | The popup supports extracted fields, corrected JSON application, and original/pre-retry raw display, but the full STMB surface is still not matched. |
| Side prompt manager/editor popup matches STMB flow. | Partial | Manager/editor behavior is now much closer to STMB, including list structure, empty-state handling, inline actions, stronger recreate/delete confirmations, editor affordances, outlet validation, runtime-macro trigger stripping, keyword-macro validation, and max-concurrency controls. Localization, prompt wording, and built-in key naming are deferred globally; final browser/runtime validation is still needed. |
| Inline scene buttons and state styling match STMB closely. | Partial | Core inline scene controls exist and track scene state, but no final visual/style parity pass has been done. |

## 10. Architecture / Ownership

| Item | Status | Note |
| --- | --- | --- |
| Confirm what is now server-owned vs client-owned. | Partial | Prompt preparation, lorebook writes, and standard structured-memory parsing are now server-owned through `/api/stmb`; client still owns orchestration, popup flow, and regex-adjusted memory parsing/error handling. |
| Ensure client orchestration is thin. | Partial | Client orchestration is thinner than before, but there is still meaningful runtime logic in `stmb.js` and `stmb-sideprompts.js`. |
| Ensure no business logic accidentally moved into UI-only handlers. | Partial | Overlap blocking now lives in a pure helper instead of only in UI flow, but a dedicated audit is still needed for the remaining popup/runtime boundaries. |
| Ensure `/api/stmb` and client runtime do not duplicate conflicting logic. | Partial | The stale settings-backed consolidation prompt resolver was removed, sideprompt lorebook title lookup now reuses shared `stmb-core.js` helpers instead of keeping a local duplicate, standard memory parsing is now server-owned, and the remaining client-owned regex path now matches STMB more closely for truncation detection and repair raw-text handling; final ownership review is still needed around runtime validation and browser-only regex execution. |

## 11. Validation

| Item | Status | Note |
| --- | --- | --- |
| Build a parity matrix mapping each STMB product function to implementation status. | Partial | Initial matrix created in `STMB_PARITY_MATRIX.md`; it still needs expansion for the unported settings/profile-manager subsystems. |
| Do static bug-hunting after each subsystem pass. | Partial | Static syntax checks were run after each recent pass, but browser/runtime QA is still pending. |

## Semantic Parity Achieved

These items have been reviewed side-by-side against the STMB reference and are currently at exact semantic parity in the implemented path.

| Item | Reference basis | Local basis |
| --- | --- | --- |
| Settings `maxTokens` normalization | `index.js` `validateSettings` | `public/scripts/stmb-core.js` `normalizeStmbSettings` |
| Summary/arc order-field sync into `summaryEntrySettings` | `index.js` `validateSettings` | `public/scripts/stmb-core.js` `normalizeStmbSettings` |
| Dedicated profile manager CRUD/import/export semantics | `profileManager.js` / `utils.js` | `public/scripts/stmb.js` profile editor helpers + `public/scripts/stmb-core.js` `sanitizeProfile` |
| Advanced-options save-new-profile semantics | `confirmationPopup.js` `saveNewProfileFromAdvancedSettings` | `public/scripts/stmb.js` `saveAdvancedProfile` |
| `current_st` / full-manual profile editor semantics | `profileManager.js` | `public/scripts/stmb.js` profile editor handlers |
| Provider/model/temperature/endpoint/apiKey override behavior | `profileManager.js` | `public/scripts/stmb.js` profile editor handlers |
| Regex selection popup semantics | `index.js` `showRegexSelectionPopup` | `public/scripts/stmb.js` `showRegexSelectionPopup` |
| `/scenememory` invalid range taxonomy | `index.js` `handleSceneMemoryCommand` | `public/scripts/stmb-core.js` `parseSceneMemoryCommandRange` + `public/scripts/stmb.js` `sceneMemoryCommand` |
| Scene overlap guard in memory initiation | `index.js` overlap check in `createMemory` | `public/scripts/stmb.js` `createMemoryFromRange` + `public/scripts/stmb-core.js` `findOverlappingManagedMemoryEntry` |
| Scene marker placement/removal | `sceneManager.js` marker toggle helpers | `public/scripts/stmb.js` scene marker helpers |
| Start/end marker validation | `sceneManager.js` validation helpers | `public/scripts/stmb.js` `assertRangeWithinCurrentChat` / `validateSceneMarkers` |
| No silent fallback to plain text | `stmemory.js` structured parse path | `public/scripts/stmb.js` `requestStructuredMemory` + `public/scripts/stmb-core.js` parser path |
| Summary tier definitions | `summaryTiers.js` | `public/scripts/stmb-summary.js` tier helpers |
| Summary prompt manager semantics | `summaryPromptManager.js` / `index.js` `showPromptManagerPopup` | `public/scripts/stmb-summary-prompt-manager.js` + `public/scripts/stmb.js` `showSummaryPromptManagerPopup` |
| Side prompt checkpoint metadata semantics | `sidePrompts.js` tracker/manual checkpoint reads and writes | `public/scripts/stmb-core.js` sideprompt checkpoint helpers + `public/scripts/stmb-sideprompts.js` |
| Side prompt loose name lookup | `sidePromptsManager.js` `findTemplateByName` | `public/scripts/stmb-sideprompts-manager.js` `findTemplateByName` |
| `/stmb-highest` return semantics | `index.js` `handleHighestMemoryProcessedCommand` | `public/scripts/stmb.js` `getHighestProcessedCommand` |

## Approved Deviations

These are deliberate differences from STMB that were explicitly approved during the parity pass.

| Item | Reason |
| --- | --- |
| Per-profile custom prompt overrides removed from Memory Books profiles | User approved deprecating profile-level custom prompts in favor of the dedicated prompt managers. |
| Main settings popup bottom-section layout differs from STMB | User approved moving `Profile Settings`, removing the prompt-manager info box wrapper, and reorganizing the lower popup layout for Aikobots. |

## Deferred Final-Pass Items

These items are intentionally not blocking parity status during the current programming pass and will be handled together at the end.

| Item | Reason |
| --- | --- |
| Localization / translation exactness | User requested that localization not be addressed until the programming pass is complete. |
| Prompt wording exactness | User requested prompt wording be handled in a separate end pass. |
| Interval sideprompt preview `Retry` regenerates immediately instead of STMB's skip-save behavior | User requested this deviation because STMB's current interval-preview `Retry` behavior appears buggy. |
