# STMB Running Parity Checklist

Reference oracle: `aikohanasaki/SillyTavern-MemoryBooks@8f21abc8de6079544333911bda3bb8cb9e112beb`

This file is updated subsystem by subsystem during the audit. Only sections that have been actively audited are listed here so far.

## 1. Config / Profiles

| Item | Status | Note |
| --- | --- | --- |
| Settings defaults match STMB exactly. | Partial | Core normalization now matches STMB for `maxTokens`, `tokenWarningThreshold`, `defaultMemoryCount`, `autoSummaryInterval`, and summary/arc order syncing; the remaining gap is broader end-to-end runtime verification rather than raw defaults. |
| Settings migration/import is idempotent. | Partial | Builtin `current_st` invariants, duplicate builtin cleanup, legacy dynamic migration, outlet-only `outletName` retention, `convertExistingRecursion` persistence, and summary prompt first-run migration are now normalized; per-profile prompt overrides were intentionally removed by user request and broader runtime verification is still pending. |
| Profile CRUD behavior matches STMB. | Exact | Dedicated profile-manager create/edit/delete/export/import flow has now passed manual testing, including safe-name handling, duplicate-count import reporting, outlet validation, builtin protections, and explicit `Set As Default`; per-profile prompt overrides remain intentionally removed by approved deviation. |
| `current_st` / dynamic profile behavior matches STMB. | Exact | Builtin profile invariants and current-ST profile behavior passed manual testing through the dedicated profile editor. |
| Custom/full-manual profile behavior matches STMB. | Exact | Full-manual endpoint requirements, field visibility, and save/reopen behavior passed manual testing in the dedicated profile editor. |
| Provider/model/temperature/endpoint/apiKey overrides match STMB. | Exact | Provider/model/temperature/endpoint/apiKey override behavior passed manual testing in the dedicated profile editor and settings surface. |
| Regex selection behavior matches STMB. | Partial | Memory flow now applies selected outgoing/incoming regex in STMB order, and the settings UI now uses a dedicated regex selection popup closer to STMB; full manager parity is still pending. |
| Lorebook routing/manual mode behavior matches STMB. | Partial | Silent manual-mode fallback to chat-bound lorebook was removed, and missing/unbound lorebooks now enter a recovery popup flow closer to STMB; the popup now exposes manual lorebook controls, but the full reference flow is still broader. |

## 2. Scene System

| Item | Status | Note |
| --- | --- | --- |
| Scene marker placement/removal matches STMB. | Exact | Local toggle logic matches STMB's `calculateNewSceneState` semantics. |
| Start/end marker validation matches STMB. | Exact | Validation and single-message scene allowance match STMB. |
| `scenememory` behavior matches STMB. | Partial | Main range parsing, deterministic validation, and scene-set messaging now match STMB more closely; final runtime verification is still pending. |
| `nextmemory` behavior matches STMB. | Partial | Empty-chat, no-new-message, lorebook preflight, and busy-state surfaces are now closer to STMB; final runtime verification is still pending. |
| Deleted-message handling shifts markers exactly like STMB. | Partial | Core shift logic is aligned; notification behavior and full regression coverage remain open. |
| Highest processed message tracking matches STMB. | Partial | Runtime tracking exists; slash-surface and deletion edge cases still need final verification. |
| Group chat behavior matches STMB. | Partial | State now resolves from active chat context and uses group names for scene requests; full group-chat parity remains to be verified. |
| Invalid ranges fail deterministically like STMB. | Partial | Core range validation exists, but exact command error taxonomy/messages still need matching. |

## 3. Memory Generation

| Item | Status | Note |
| --- | --- | --- |
| Prompt preset bodies match STMB exactly. | Partial | Built-in prompt content appears aligned, and summary prompts are now loaded from a dedicated file-backed manager with legacy migration; browser/runtime verification is still pending. |
| Prompt selection/custom prompt override behavior matches STMB. | Partial | Profile preset selection works, but per-profile custom prompt overrides were intentionally removed by user request in favor of the dedicated prompt managers; the local main settings surface also still does not expose STMB's summary-order controls (`summaryOrderMode`, `summaryOrderValue`, `summaryReverseStart`) that feed consolidation behavior. |
| Scene compilation input matches STMB. | Partial | Prompt assembly now uses STMB-style transcript formatting; further verification is needed. |
| Previous-memory context behavior matches STMB. | Partial | Prompt assembly now includes STMB-style previous scene context blocks and keywords; end-to-end verification is still pending. |
| Provider request shaping matches STMB profile semantics. | Partial | Core shaping exists and current patch restores STMB-like prompt text flow; transport still uses Aikobots chat-completions plumbing. |
| Structured parsing/error taxonomy matches STMB. | Partial | Parser logic is close, but end-to-end error surfaces still need verification after request-path changes. |
| Claude/tool-use handling matches STMB. | Partial | Parser supports Claude structured content/tool blocks; generation path still needs explicit verification. |
| Truncation/malformed JSON handling matches STMB. | Partial | Parser has truncation/malformed branches; UI/error popup parity still open. |
| No silent fallback to plain text. | Exact | Current flow still requires structured JSON parsing. |

## 4. Memory Review / Repair Flow

| Item | Status | Note |
| --- | --- | --- |
| Confirmation popup flow matches STMB decision points. | Partial | Confirmation and advanced-options popups now exist; dynamic save-and-create behavior is now closer, but full popup/UI parity still needs runtime validation. |
| Advanced options flow matches STMB. | Partial | Profile/prompt/context-memory editing and dynamic save-and-create behavior are now wired in; full CRUD/UI parity remains open. |
| Preview/edit/save behavior matches STMB. | Partial | Preview and edit paths exist; end-to-end runtime validation is still pending. |
| Retry generation behavior matches STMB. | Partial | Retry from preview/manual-repair now preserves advanced context-memory count; popup/runtime parity still needs verification. |
| Manual JSON repair behavior matches STMB. | Partial | Failed-response repair path is wired, but final popup semantics still need matching. |
| Failed AI response popup behavior matches STMB. | Partial | Surface exists and uses raw-response repair, but exact STMB flow is not yet fully matched. |
| `/stmb-stop` behavior during generation/review/repair matches STMB. | Partial | Root-task cancellation exists; popup-interaction edge cases still need audit. |

## 5. Lorebook Persistence

| Item | Status | Note |
| --- | --- | --- |
| Managed entry identification fields match STMB. | Partial | Memory saves now retain `stmemorybooks` and scene range fields only, but full side-prompt/tracker metadata audit is still pending. |
| Title numbering and formats match STMB. | Partial | Memory numbering now follows STMB title-based extraction instead of entry-count append, but broader title-format coverage still needs verification. |
| Order calculation matches STMB. | Partial | Core order logic is aligned, but end-to-end persistence still needs more regression checks. |
| Metadata roundtrip matches STMB. | Partial | Extra memory-only `STMB_*` fields were removed; remaining roundtrip behavior still needs summary/side-prompt review. |
| `STMemoryBooks` / `stmemorybooks` / scene range / tracker metadata fields match STMB. | Partial | Memory-entry fields are closer now; tracker/checkpoint fields remain unaudited. |
| Secure vs user lorebook routing matches Aikobots expectations without breaking STMB semantics. | Partial | Routing is present through `/api/stmb`, and missing/unbound lorebooks now use an STMB-like recovery flow instead of hard-failing, but broader write-path verification is still pending. |
| Cache invalidation/read-after-write behavior is correct. | Partial | Save paths now invalidate cache, memories reapply STMB-like refresh/auto-hide client effects, summary commits refresh the editor again, and sideprompt/tracker writes now refresh the editor more like STMB; runtime validation is still pending. |

## 6. Summaries / Consolidation

| Item | Status | Note |
| --- | --- | --- |
| Tier definitions match STMB. | Exact | Tier map and labels align with STMB's `summaryTiers.js`. |
| Eligibility rules match STMB. | Partial | Core source-entry filtering and legacy summary migration align, but full runtime validation is still pending. |
| Summary prompts match STMB. | Partial | Built-in prompt bodies appear aligned, the memory prompt manager is file-backed, and consolidation prompts now use a dedicated file-backed `stmb-arc-prompts.json` cache with the stale settings-backed resolver removed; browser/runtime validation is still open. |
| Sequential summary analysis behavior matches STMB. | Partial | Previous-summary context, chronological briefs, selected-source filtering, parse-retry, token-budget trimming, max-pass controls, and repair-path source preservation are now closer; browser/runtime validation is still pending. |
| `member_ids` semantics match STMB. | Partial | Ambiguous multi-summary cases are rejected and member ID resolution matches STMB closely; broader manual-repair/runtime coverage is still pending. |
| Ambiguous multi-summary cases are handled like STMB. | Partial | Parser rejects multiple summaries without `member_ids`; UI-level repair messaging still needs matching. |
| Commit behavior and disabling originals match STMB. | Partial | Commit path, tier numbering, selected-source disabling, editor refresh, and `disabledBySummaryId` behavior are aligned more closely now; broader runtime verification is still pending. |
| Auto-summary trigger behavior matches STMB. | Partial | Runtime trigger checks now exist for single chats and `GROUP_WRAPPER_FINISHED`, and manual-mode lorebook select/postpone flow is now present; full lorebook-validation parity still needs verification. |
| Manual summary repair popup flow matches STMB. | Partial | Failed-summary repair popup now supports extracted fields, corrected JSON application, missing-context messaging, and original/pre-retry raw display; broader runtime parity is still open. |
| Auto-consolidation prompt flow matches STMB. | Partial | Prompt gating, duplicate-prompt suppression, post-memory trigger, next-tier chaining, no-lorebook popup rendering, and multi-pass consolidation controls are now closer; dedicated arc prompt-manager UI parity is still open. |

## 7. Side Prompts / Trackers

| Item | Status | Note |
| --- | --- | --- |
| Template schema matches STMB. | Partial | Stored V2 schema and trigger normalization are close, but full file/import migration parity is still unaudited. |
| Built-in templates match STMB. | Partial | Core built-ins appear aligned, but I have not finished a field-by-field audit of every template body yet. |
| Macro parsing and substitution match STMB. | Partial | Runtime macro parsing, quoting, autocomplete suggestions, and substitution are now close to STMB; more end-to-end validation is still needed. |
| Manual `/sideprompt` command behavior matches STMB. | Partial | Manual flow is now toast-driven with STMB-like range tips, compile-failure messages, cancel/success toasts, and missing-lorebook recovery prompts, but hidden-range compilation still differs from STMB's temporary unhide/restore flow. |
| Interval tracker behavior matches STMB. | Partial | Checkpoint semantics, preview serialization, token overrides, and editor refresh are closer, but local range compilation still does not mirror STMB's temporary unhide/restore behavior when hidden messages are present. |
| Post-memory trigger behavior matches STMB. | Partial | Side prompts now inherit the current memory profile unless a template override replaces it, and after-memory runs now process in concurrent waves with receipt-order previews, batched wave saves, and aggregate notifications closer to STMB; broader runtime verification is still pending. |
| Overwrite-by-title tracker semantics match STMB. | Partial | Unified title lookup and checkpoint metadata are present, but broader legacy-title/runtime coverage remains open. |
| Checkpoint metadata semantics match STMB. | Partial | `STMB_sp_*` and legacy tracker fields are written, but full roundtrip verification is still pending. |
| Preview/retry/cancel/manual behavior matches STMB. | Partial | Preview queue serialization and manual/after-memory retry-cancel handling are closer to STMB, preview retries now keep the same token-override settings path, and after-memory approvals now persist in wave batches; broader runtime verification is still pending. |
| Side prompt profile override behavior matches STMB. | Partial | Template override profiles and parent-memory profile fallback now align more closely; broader runtime verification is still pending. |

## 8. Slash Commands and Runtime

| Item | Status | Note |
| --- | --- | --- |
| `creatememory` | Partial | The command now matches STMB's direct no-scene-marker fast-fail toast more closely, and the runtime once again enforces the `allowSceneOverlap` setting before generation; broader runtime verification is still pending. |
| `scenememory` | Partial | Help text, validation taxonomy, and main range messages now align more closely with STMB; final runtime verification is still pending. |
| `nextmemory` | Partial | Empty/no-new-message, lorebook preflight, and busy-state behavior are now closer to STMB; final runtime verification is still pending. |
| `sideprompt` | Partial | Command help text, autocomplete, macro suggestions, and toast flow are now closer to STMB, but runtime parity still depends on finishing sideprompt subsystem audit. |
| `sideprompt-on` | Partial | Help text, `all` handling, update-event dispatch, and direct not-found error text now match STMB more closely; final autocomplete/runtime validation is still pending. |
| `sideprompt-off` | Partial | Help text, `all` handling, update-event dispatch, and direct not-found error text now match STMB more closely; final autocomplete/runtime validation is still pending. |
| `stmb-highest` | Exact | Return semantics match STMB's direct `String(getHighestMemoryProcessed())` behavior. |
| `stmb-set-highest` | Partial | Main error/success/clamp text now matches STMB more closely, and the main settings popup refreshes its memory-status block after command writes like STMB; broader runtime verification is still open. |
| `stmb-stop` | Partial | Stop text, in-flight detection, toast clearing, and preview popup closing are aligned more closely, but full generation/review/repair cancellation parity still needs validation. |

## 9. UI / Popup Surfaces

| Item | Status | Note |
| --- | --- | --- |
| Main STMB entry points exist. | Exact | The Memory Books menu entry and main settings popup now pass manual testing for the supported settings surface; the bottom-of-popup layout has an approved deviation from STMB. |
| Memory preview popup matches STMB flow. | Partial | Preview/edit/retry/cancel behavior is much closer, including serialized sideprompt previews; broader runtime validation is still needed. |
| Failed memory repair popup matches STMB flow. | Partial | Raw-response repair flow exists, but the full STMB popup surface is still not matched exactly. |
| Summary consolidation popup matches STMB flow. | Partial | The popup now preserves summary-entry settings, renders candidate checklists by tier, honors selected source entries, exposes max-items/token/max-pass controls, uses a file-backed arc prompt cache, and still renders without a lorebook like STMB; browser/runtime validation is still pending. |
| Failed summary repair popup matches STMB flow. | Partial | The popup supports extracted fields, corrected JSON application, and original/pre-retry raw display, but the full STMB surface is still not matched. |
| Side prompt manager/editor popup matches STMB flow. | Partial | A local manager/editor popup now exists with create/edit/duplicate/delete, import/export, built-in restore, trigger/lorebook/profile settings, runtime-macro trigger stripping, keyword-macro validation, and max-concurrency controls; final runtime/UI parity still needs browser validation. |
| Inline scene buttons and state styling match STMB closely. | Partial | Core inline scene controls exist and track scene state, but no final visual/style parity pass has been done. |

## 10. Architecture / Ownership

| Item | Status | Note |
| --- | --- | --- |
| Confirm what is now server-owned vs client-owned. | Partial | Prompt preparation and lorebook writes are mostly server-owned through `/api/stmb`; client still owns orchestration, popup flow, and some parse/error handling. |
| Ensure client orchestration is thin. | Partial | Client orchestration is thinner than before, but there is still meaningful runtime logic in `stmb.js` and `stmb-sideprompts.js`. |
| Ensure no business logic accidentally moved into UI-only handlers. | Partial | Overlap blocking now lives in a pure helper instead of only in UI flow, but a dedicated audit is still needed for the remaining popup/runtime boundaries. |
| Ensure `/api/stmb` and client runtime do not duplicate conflicting logic. | Partial | The stale settings-backed consolidation prompt resolver was removed, reducing one duplicate source of truth; memory/summary parsing and some runtime validation still exist on both sides and need a final ownership review. |

## 11. Validation

| Item | Status | Note |
| --- | --- | --- |
| Build a parity matrix mapping each STMB product function to implementation status. | Partial | Initial matrix created in `STMB_PARITY_MATRIX.md`; it still needs expansion for the unported settings/profile-manager subsystems. |
| Add or update focused tests where possible. | Partial | Core tests now also cover selected summary-source resolution and label pluralization, but runtime/UI coverage is still thin. |
| Do static bug-hunting after each subsystem pass. | Partial | Static syntax checks were run after each recent pass, but browser/runtime QA is still pending. |

## Semantic Parity Achieved

These items have been reviewed side-by-side against the STMB reference and are currently at exact semantic parity in the implemented path.

| Item | Reference basis | Local basis |
| --- | --- | --- |
| Settings `maxTokens` normalization | `index.js` `validateSettings` | `public/scripts/stmb-core.js` `normalizeStmbSettings` |
| Summary/arc order-field sync into `summaryEntrySettings` | `index.js` `validateSettings` | `public/scripts/stmb-core.js` `normalizeStmbSettings` |
| Dedicated profile manager CRUD/import/export semantics | `profileManager.js` / `utils.js` | `public/scripts/stmb.js` profile editor helpers + `public/scripts/stmb-core.js` `sanitizeProfile` |
| `current_st` / full-manual profile editor semantics | `profileManager.js` | `public/scripts/stmb.js` profile editor handlers |
| Provider/model/temperature/endpoint/apiKey override behavior | `profileManager.js` | `public/scripts/stmb.js` profile editor handlers |
| Scene marker placement/removal | `sceneManager.js` marker toggle helpers | `public/scripts/stmb.js` scene marker helpers |
| Start/end marker validation | `sceneManager.js` validation helpers | `public/scripts/stmb.js` `assertRangeWithinCurrentChat` / `validateSceneMarkers` |
| No silent fallback to plain text | `stmemory.js` structured parse path | `public/scripts/stmb.js` `requestStructuredMemory` + `public/scripts/stmb-core.js` parser path |
| Summary tier definitions | `summaryTiers.js` | `public/scripts/stmb-summary.js` tier helpers |
| Side prompt loose name lookup | `sidePromptsManager.js` `findTemplateByName` | `public/scripts/stmb-sideprompts-manager.js` `findTemplateByName` |
| `/stmb-highest` return semantics | `index.js` `handleHighestMemoryProcessedCommand` | `public/scripts/stmb.js` `getHighestProcessedCommand` |

## Approved Deviations

These are deliberate differences from STMB that were explicitly approved during the parity pass.

| Item | Reason |
| --- | --- |
| Per-profile custom prompt overrides removed from Memory Books profiles | User approved deprecating profile-level custom prompts in favor of the dedicated prompt managers. |
| Main settings popup bottom-section layout differs from STMB | User approved moving `Profile Settings`, removing the prompt-manager info box wrapper, and reorganizing the lower popup layout for Aikobots. |
