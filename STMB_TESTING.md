# STMB Testing Checklist

This file captures the remaining behavioral/runtime checks that still need manual verification against STMB parity.

Reference source for remaining gaps: `STMB_PARITY_RUNNING.md`

## 1. Highest Priority

- Lorebook recovery flow
  - Missing chat-bound lorebook
  - Missing manual lorebook
  - Missing-on-disk lorebook
  - Auto-create replacement flow
  - Select-existing replacement flow
  - Cancel and retry behavior

- `scenememory` and `nextmemory`
  - Empty chat behavior
  - Invalid range behavior
  - No-new-message behavior
  - Overlap blocking
  - `unhideBeforeMemory` preflight
  - Busy-state gating

- Highest-processed tracking
  - Normal memory save updates baseline
  - Deleted-message rebasing
  - `/stmb-set-highest` set/reset behavior
  - Auto-summary baseline behavior

- Group chat behavior
  - Scene creation in groups
  - Manual lorebook selection in groups
  - Side prompts in groups
  - Auto-summary in groups
  - Group-name/group-context handling

## 2. Memory Generation

- Prompt assembly
  - Built-in prompt preset body actually used as expected
  - Previous-memory context injection
  - Scene transcript formatting

- Profile/provider shaping
  - `current_st` profile behavior
  - Full-manual profile behavior
  - Provider/model/temperature override behavior
  - Max-tokens behavior

- Regex memory path
  - Outgoing regex applied to prompt
  - Incoming regex applied before parse
  - Provider truncation detection on regex path
  - Repair popup prefilled with cleaned post-regex text

- Structured parse failures
  - Malformed JSON
  - Truncated JSON
  - Claude/tool-use structured response
  - Provider finish-reason truncation
  - Retry and manual repair flow

## 3. Memory Review / Repair

- Confirmation popup flow
  - Save-and-create
  - `Settings...` handoff
  - Profile change behavior
  - Context-memory count changes
  - Live token estimate refresh

- Memory preview flow
  - Edit
  - Save
  - Cancel
  - Retry
  - Close-race behavior

- Failed memory repair flow
  - Manual JSON repair apply path
  - Duplicate apply guard
  - In-flight close protection
  - `/stmb-stop` during repair

## 4. Memory Save / Lorebook Effects

- Saved memory entry contents
  - Lorebook entry fields
  - Scene range metadata
  - Managed-entry detection after save

- Post-save behavior
  - Editor refresh
  - Auto-hide behavior
  - Scene-marker clearing
  - Highest-processed update
  - Notification timing

- Lorebook persistence
  - Secure vs user lorebook routing
  - Read-after-write correctness
  - Cache invalidation

## 5. Summaries / Consolidation

- Summary eligibility and source selection
  - Correct source entries by tier
  - Minimum-child gating

- Sequential summary analysis
  - Previous-summary context
  - Token trimming
  - Max-pass behavior
  - Leftovers handling

- `member_ids` semantics
  - Single-summary response
  - Multi-summary response with valid `member_ids`
  - Multi-summary response missing `member_ids`
  - Unresolvable `member_ids`

- Summary commit behavior
  - Created entry metadata
  - Source disabling
  - `disabledBySummaryId`
  - Legacy summary-field migration persistence

- Manual summary repair flow
  - Extracted-field prefill
  - Corrected JSON apply
  - Original vs retry raw display

- Auto-summary behavior
  - Interval trigger
  - Buffer trigger
  - Postpone behavior
  - Manual lorebook selection path
  - Retry after lorebook recovery

- Auto-consolidation behavior
  - Readiness gating
  - Duplicate-prompt suppression
  - Next-tier chaining
  - No-lorebook cases

## 6. Side Prompts / Trackers

- Manual `/sideprompt`
  - Macro parsing
  - Quoted argument handling
  - Autocomplete suggestions
  - Manual/group/manual-lorebook routing

- Interval trackers
  - Checkpoint reads
  - Checkpoint writes
  - Preview cancel behavior
  - Retry behavior
  - Token overrides
  - Editor refresh

- Post-memory side prompts
  - Inherited profile behavior
  - Template override profile behavior
  - Concurrent wave execution
  - Receipt-order previews
  - Batched saves
  - Failure fallback

- Tracker overwrite behavior
  - Overwrite-by-title semantics
  - Legacy score fallback
  - Checkpoint metadata behavior

- Preview/retry/cancel/manual behavior
  - Serialized previews
  - Abort-aware retry
  - Manual preview-failure fallback
  - After-memory approval persistence

## 7. Slash Commands / Runtime

- `/sideprompt`
  - Runtime behavior, not just help/autocomplete

- `/stmb-set-highest`
  - Success/error/clamp behavior
  - Open-settings refresh behavior

- `/stmb-stop`
  - During memory generation
  - During preview
  - During memory manual repair
  - During summary manual repair
  - During side-prompt waves

## 8. UI Surfaces

- Memory preview popup
  - End-to-end runtime flow

- Failed memory repair popup
  - End-to-end runtime flow

- Summary consolidation popup
  - Selected-source checklist behavior
  - Max-items/token/max-pass controls
  - No-lorebook rendering

- Failed summary repair popup
  - End-to-end runtime flow

- Side prompt manager/editor popup
  - Create/edit/delete/import/export/recreate-builtins
  - Outlet validation
  - Trigger stripping
  - Max-concurrency controls

- Inline scene buttons/state styling
  - Actual runtime visual/state behavior

## 9. Settings / Persistence

- Runtime defaults after reload
  - `maxTokens`
  - `tokenWarningThreshold`
  - `defaultMemoryCount`
  - `autoSummaryInterval`
  - Summary/arc order settings

- Import/reload persistence
  - Builtin `current_st` invariants
  - Duplicate builtin cleanup
  - Outlet-only `outletName`
  - `convertExistingRecursion`
  - Summary prompt first-run migration

## 10. Architecture Sanity Checks

- Confirm current server/client ownership in practice
  - Prompt preparation
  - Lorebook writes
  - Standard memory parsing
  - Regex-only browser path

- Confirm no conflicting duplicate logic remains
  - Client orchestration vs `/api/stmb`
  - Popup flow vs runtime flow
  - Browser-only regex path vs server path
