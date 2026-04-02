# STMB Running Parity Checklist

Reference oracle: `aikohanasaki/SillyTavern-MemoryBooks@8f21abc8de6079544333911bda3bb8cb9e112beb`

This file is updated subsystem by subsystem during the audit. Only sections that have been actively audited are listed here so far.

## 1. Config / Profiles

| Item | Status | Note |
| --- | --- | --- |
| Settings defaults match STMB exactly. | Partial | Raw defaults and builtin profile initialization were aligned, but Aikobots still persists prompt preset storage in settings unlike STMB's manager/file flow. |
| Settings migration/import is idempotent. | Partial | Builtin `current_st` invariants, duplicate builtin cleanup, and legacy dynamic migration are now normalized; full import/export parity still needs CRUD/UI verification. |
| Profile CRUD behavior matches STMB. | Partial | Core profile normalization is closer, but popup-driven CRUD parity is not audited yet. |
| `current_st` / dynamic profile behavior matches STMB. | Partial | Builtin profile invariants now match STMB normalization; advanced popup/runtime override surfaces still need verification. |
| Custom/full-manual profile behavior matches STMB. | Partial | Connection override shaping exists; edit/create popup flow parity remains open. |
| Provider/model/temperature/endpoint/apiKey overrides match STMB. | Partial | Core override shaping is present; end-to-end profile edit/runtime parity still needs direct comparison. |
| Regex selection behavior matches STMB. | Partial | Memory flow now applies selected outgoing/incoming regex in STMB order; end-to-end verification is still pending. |
| Lorebook routing/manual mode behavior matches STMB. | Partial | Silent manual-mode fallback to chat-bound lorebook was removed; lorebook selection popup parity is still missing. |

## 2. Scene System

| Item | Status | Note |
| --- | --- | --- |
| Scene marker placement/removal matches STMB. | Exact | Local toggle logic matches STMB's `calculateNewSceneState` semantics. |
| Start/end marker validation matches STMB. | Exact | Validation and single-message scene allowance match STMB. |
| `scenememory` behavior matches STMB. | Partial | Main range parsing and scene-set messaging were tightened; full parity still needs deeper command/runtime verification. |
| `nextmemory` behavior matches STMB. | Partial | Empty-chat and no-new-message surface text now matches STMB more closely; lorebook validation and busy-state flow still need checking. |
| Deleted-message handling shifts markers exactly like STMB. | Partial | Core shift logic is aligned; notification behavior and full regression coverage remain open. |
| Highest processed message tracking matches STMB. | Partial | Runtime tracking exists; slash-surface and deletion edge cases still need final verification. |
| Group chat behavior matches STMB. | Partial | State now resolves from active chat context and uses group names for scene requests; full group-chat parity remains to be verified. |
| Invalid ranges fail deterministically like STMB. | Partial | Core range validation exists, but exact command error taxonomy/messages still need matching. |

## 3. Memory Generation

| Item | Status | Note |
| --- | --- | --- |
| Prompt preset bodies match STMB exactly. | Partial | Built-in prompt content appears aligned, but prompt-manager storage architecture still differs. |
| Prompt selection/custom prompt override behavior matches STMB. | Partial | Preset vs custom prompt precedence exists; popup-driven flow parity still needs audit. |
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
| Secure vs user lorebook routing matches Aikobots expectations without breaking STMB semantics. | Partial | Routing is present through `/api/stmb`, but manual-mode and write-path edge cases still need verification. |
| Cache invalidation/read-after-write behavior is correct. | Partial | Save path now invalidates cache and reapplies STMB-like refresh/auto-hide client effects; runtime validation is still pending. |

## 6. Summaries / Consolidation

| Item | Status | Note |
| --- | --- | --- |
| Tier definitions match STMB. | Exact | Tier map and labels align with STMB's `summaryTiers.js`. |
| Eligibility rules match STMB. | Partial | Core source-entry filtering and legacy summary migration align, but full runtime validation is still pending. |
| Summary prompts match STMB. | Partial | Built-in prompt bodies appear aligned, but prompt-manager/storage flow still differs. |
| Sequential summary analysis behavior matches STMB. | Partial | Previous-summary context and chronological briefs are present; end-to-end parity remains to be verified. |
| `member_ids` semantics match STMB. | Partial | Ambiguous multi-summary cases are rejected and member ID resolution matches STMB closely; broader manual-repair/runtime coverage is still pending. |
| Ambiguous multi-summary cases are handled like STMB. | Partial | Parser rejects multiple summaries without `member_ids`; UI-level repair messaging still needs matching. |
| Commit behavior and disabling originals match STMB. | Partial | Commit path, tier numbering, and `disabledBySummaryId` behavior are aligned in core shape; popup/editor refresh flow still needs runtime verification. |
| Auto-summary trigger behavior matches STMB. | Partial | Runtime trigger checks now exist for single chats and `GROUP_WRAPPER_FINISHED`, and manual-mode lorebook select/postpone flow is now present; full lorebook-validation parity still needs verification. |
| Manual summary repair popup flow matches STMB. | Partial | Failed-summary repair popup now supports extracted fields, corrected JSON application, missing-context messaging, and original/pre-retry raw display; broader runtime parity is still open. |
| Auto-consolidation prompt flow matches STMB. | Missing | No local equivalent of STMB's auto-consolidation prompt/runtime yet. |
