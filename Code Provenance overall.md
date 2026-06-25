# Aikobots Changes from Base SillyTavern

Aikobots is a fork of SillyTavern. Portions of the codebase remain derived from upstream SillyTavern and are governed by the same AGPL-3.0 license terms.

This document summarizes major Aikobots-specific additions, integrations, and behavioral changes from the upstream SillyTavern base. It is intended as a provenance and orientation guide, not a complete line-by-line changelog.

Fact-check basis: this document has been checked against the current `chat-dbs` / v3 workspace, including `readme.md`, `readme/sqlite.md`, `public/index.html`, `public/scripts/world-info.js`, the `public/scripts/stmb*.js` modules, `src/endpoints/chats.js`, `src/sqlite-manager.js`, `src/lorebook-repository.js`, `src/character-sharing-repository.js`, `src/character-submissions.js`, `src/active-session-store.js`, and related endpoint files. It is a high-level provenance guide, not a formal exhaustive diff against every upstream SillyTavern commit.

## Attribution

Aikobots is maintained by Aiko Hanasaki.

Upstream SillyTavern work remains credited to the SillyTavern project and its contributors. Third-party extensions and forked work are credited in the relevant extension repositories and in the main Aikobots License and Credits section.

Some Aikobots implementation work may have involved AI-assisted coding tools under Aiko’s direction, review, testing, and integration. The feature design, requirements, integration decisions, testing, documentation, and release decisions are part of the Aikobots project work.

## Major Aikobots-Specific Systems

### 1. Memory Books / STMB

Aikobots adds Memory Books workflows for long-running roleplay and structured memory management. This includes Aikobots-specific prompt behavior, memory organization patterns, and supporting UI/workflow conventions.

Current code includes STMB scene capture, memory generation, summary/consolidation tiers, Topical Clips, SidePrompts, tracker/scoreboard-style side prompt behavior, queued Memory Books jobs, processed-message boundary controls, catch-up commands for long chats, profile-specific provider settings, and lorebook order defaults for auto-created memory books.

### 2. Lorebook Ordering / STLO

Aikobots adds lorebook ordering and budgeting workflows intended to give users more control over how lorebook entries are selected, ordered, and presented to the model.

Current code exposes native lorebook ordering settings with priority, order, group-chat behavior, per-lorebook budgets, fixed and percentage budget modes, random subset behavior, and entry-level overrides. Server-side world-info scanning applies these ordering and budget settings during prompt assembly.

### 3. Secure and Admin-Managed Lorebooks

Aikobots adds secure lorebook behavior, admin-managed lorebook workflows, permission-sensitive UI behavior, and handling for pushed/shared lorebooks.

This includes Aikobots-specific concepts such as admin/user visibility rules, protected lorebook flows, and conventions for separating user-facing lorebooks from hidden or system-managed lorebooks.

Current code separates user, secure, and shared secure lorebook storage, supports owner lists and checkout state for shared secure lorebooks, and preserves hidden lorebook bindings/templates through rename and migration paths.

### 4. Lorebook Naming Conventions

Aikobots uses distinctive naming conventions for hidden/system-managed lorebooks.

* `9Z` is used for admin world/global lorebook handling.
* `9ZZ` is used for admin character-specific lorebook handling.
* `Z-` is used for non-admin lorebook handling.

These conventions are part of Aikobots’ hidden lorebook, privacy, and integration behavior.

### 5. WorldInfoInfo Integration and Hidden Lorebook Behavior

Aikobots integrates with forked WorldInfoInfo behavior to support Aikobots-specific hidden lorebook workflows.

WorldInfoInfo was originally created by Len Anderson. Aikobots’ fork/integration preserves upstream attribution and documents Aikobots-specific changes separately.

Current code also stores effective hidden lorebook bindings in server-side registries and resolves global and character-specific hidden lorebooks without relying only on user-visible lorebook selection.

### 6. Character Protection and Admin Push Workflows

Aikobots adds character protection behavior and admin push workflows for distributing or managing characters and related lorebook data.

These systems are designed for hosted/community environments where admins may need to distribute content while preserving user boundaries and protected metadata.

Current code includes shared character storage, owner metadata, checkout/force-checkout behavior, direct admin push, user submission queues, admin distribution review, whitelist/global/global-with-blacklist modes, per-user repush opt-out, and distribution policies that preserve owner and blacklist state.

### 7. Chat Handling and Long-Chat Performance Work

Aikobots includes changes intended to improve long-chat handling, including split-tail/chunked chat loading behavior and related performance/stability work.

Later development work moves toward replacing JSONL/split-tail behavior with SQLite-backed chat storage. This work was contributed by LeRobber and is substantial enough to make LeRobber the main developer for this specific feature. 

Repository history confirms LeRobber authored key SQLite retrieval and migration commits. Subsequent branch history also shows substantial Aikobots integration, migration, locking, STMB compatibility, and bugfix work by Aiko/aikohanasaki around the same chat-storage area.

Fact-check update for the current v3 workspace: SQLite-backed chat storage is now the documented current architecture, not only future work. New chat paths default to `.sqlite`, legacy `.jsonl` remains a compatibility input, v2's split-tail storage is intentionally unsupported by v3, chat imports/exports include SQLite, and migration tooling verifies SQLite integrity before removing legacy JSONL sources.

The current chat system also includes chat revisions, stale-write conflict detection, active-session checks on mutations, application-level save locks, chunked/range reads, STMB sparse range resolution, raw SQLite export, message cloning, and prompt snapshot invalidation for affected cloned messages.

### 8. Layout and UI Systems

Aikobots includes custom layout and interface work, including additional visual modes, UI refinements, and Aikobots-specific workflow controls.

Examples include custom layout modules, top information display behavior, and roleplay-oriented interface changes.

Current code includes a modular layout system with built-in layouts, a layout variable contract, custom CSS upload, layout asset upload with image conversion/storage limits, and route-level validation that rejects unsafe filenames, unsafe CSS markers, and arbitrary remote asset URLs.

### 9. Session and Safety Guards

Aikobots includes session-handling and write-safety behavior intended to reduce accidental overwrites, stale writes, and multi-tab conflicts.

This includes single-tab/session-lock concepts and related frontend/backend coordination.

Current code implements active-session leases with claim, take-over, heartbeat, verify, and release endpoints, plus middleware that attaches active-session operations to protected requests. Chat writes combine this with revision checks and save locks.

### 10. Provider, Token, and Prompt Workflow Changes

Aikobots includes provider registry work, token dry-run behavior, redacted prompt inspection/support workflows, and related utilities used to improve reliability and transparency for generation setup.

Current code includes character token dry-run metadata, redacted itemized prompt display, server-side prompt inspection snapshots, prompt snapshot maintenance, connection profiles, and provider-specific prompt conversion/dispatch paths. Prompt inspection responses are sanitized before they are returned to the client.

### 11. Multi-User Hosted Architecture

Aikobots is a multi-user fork designed for hosted/community deployments. The project README explicitly describes Aikobots as a multi-user fork built around chat completion APIs and notes that it does not include support for legacy text generation APIs.

Current code includes user/admin endpoints, public/private user routes, admin-gated extension installation controls, character and lorebook ownership metadata, shared asset repositories, and hosted-environment safeguards around concurrent writes.

### 12. Character Sharing, Ownership, and Submissions

Aikobots adds shared character workflows beyond simple local character cards. This includes owner lists, shared-character indexes, checkout state, force checkout for admins, owner management, submission review queues, direct admin distribution, and repush blacklist handling.

These features are distinct from ordinary character import/export because they are designed to preserve creator attribution, hosted-community ownership, and user opt-out boundaries while still allowing admins to distribute or update shared characters.

### 13. Shared Secure Lorebooks and Checkout Workflows

Aikobots extends secure lorebooks with shared secure storage, owner metadata, checkout/check-in state, force checkout for admins, and owner-management controls.

This is separate from normal user lorebook selection: shared secure lorebooks live in dedicated secure storage and can participate in hidden/system-managed lorebook flows while preserving edit permissions.

### 14. Server-Side Prompt Assembly and Inspection

Aikobots moves important prompt assembly and inspection behavior server-side so hosted deployments can reason about what was sent without exposing secure lorebook internals through ordinary client state.

Current code includes server-side world-info scan reporting, prompt itemization, redacted prompt text, prompt inspection snapshots scoped to generation, and sanitization before returning snapshot data to the client.

### 15. SQLite Chat Storage and Migration Tooling

Aikobots v3 uses SQLite chat files through `sql.js` while preserving the historical whole-file persistence model. The storage layer includes schema creation, JSONL migration, message range reads, range writes, metadata helpers, and integrity checks.

The migration tool supports legacy JSONL migration, verifies `PRAGMA integrity_check`, compares migrated content back to the source plan, and rejects unsafe partial split-tail inputs instead of silently producing ambiguous chat data.

### 16. Extension and Plugin Policy Changes

Aikobots includes server-side extension runtime plumbing and policy checks for hosted environments. Third-party extension installation can be admin-restricted, and server-side extension hooks support generation interceptors, prompt providers, and macro providers.

This supports an integrated Aikobots deployment model while keeping extension behavior behind explicit policy boundaries.

## Forked or Integrated Third-Party Work

Aikobots credits upstream and third-party work where used. Relevant examples include:

* SillyTavern, the upstream project.
* WorldInfoInfo by Len Anderson.
* WorldInfoPresets by Len Anderson.
* Chat Top Bar / Top Info Bar by Cohee1207.
* Favorites Carousel by subzero5544.
* Other credited extensions, UI components, or features listed in the main README License and Credits section.

Where Aikobots forks or modifies third-party extensions, the relevant extension repository should identify the upstream project and summarize Aikobots-specific changes.

## Reuse and Attribution Request

Aikobots is open-source software under AGPL-3.0-compatible terms inherited from SillyTavern.

Forking and reuse are allowed under the license. However, when redistributing or presenting work derived from Aikobots-specific systems, please preserve the provenance trail and credit Aikobots/Aiko where relevant. 

Suggested attribution wording:

> Portions of this work are derived from Aikobots by Aiko Hanasaki.

For WorldInfoInfo-derived work:

> WorldInfoInfo originally by Len Anderson, with Aikobots-specific hidden-lorebook integration work by Aiko Hanasaki.

## Notes on Scope

This document is not a full diff against upstream SillyTavern. It highlights major Aikobots-specific systems and conventions so contributors, fork maintainers, and users can understand what was added or changed by Aikobots.
