# Aikobots Changes from Base SillyTavern

Aikobots is a fork of SillyTavern. Portions of the codebase remain derived from upstream SillyTavern and are governed by the same AGPL-3.0 license terms.

This document summarizes major Aikobots-specific additions, integrations, and behavioral changes from the upstream SillyTavern base. It is intended as a provenance and orientation guide, not a complete line-by-line changelog.

## Attribution

Aikobots is maintained by Aiko Hanasaki.

Upstream SillyTavern work remains credited to the SillyTavern project and its contributors. Third-party extensions and forked work are credited in the relevant extension repositories and in the main Aikobots License and Credits section.

Some Aikobots implementation work may have involved AI-assisted coding tools under Aiko’s direction, review, testing, and integration. The feature design, requirements, integration decisions, testing, documentation, and release decisions are part of the Aikobots project work.

## Major Aikobots-Specific Systems

### 1. Memory Books / STMB

Aikobots adds Memory Books workflows for long-running roleplay and structured memory management. This includes Aikobots-specific prompt behavior, memory organization patterns, and supporting UI/workflow conventions.

### 2. Lorebook Ordering / STLO

Aikobots adds lorebook ordering and budgeting workflows intended to give users more control over how lorebook entries are selected, ordered, and presented to the model.

### 3. Secure and Admin-Managed Lorebooks

Aikobots adds secure lorebook behavior, admin-managed lorebook workflows, permission-sensitive UI behavior, and handling for pushed/shared lorebooks.

This includes Aikobots-specific concepts such as admin/user visibility rules, protected lorebook flows, and conventions for separating user-facing lorebooks from hidden or system-managed lorebooks.

### 4. 9Z / 9ZZ Lorebook Naming Conventions

Aikobots uses distinctive naming conventions for hidden/system-managed lorebooks.

* `9Z` is used for world/global lorebook handling.
* `9ZZ` is used for character-specific lorebook handling.

These conventions are part of Aikobots’ hidden lorebook, privacy, and integration behavior.

### 5. WorldInfoInfo Integration and Hidden Lorebook Behavior

Aikobots integrates with forked WorldInfoInfo behavior to support Aikobots-specific hidden lorebook workflows.

WorldInfoInfo was originally created by Len Anderson. Aikobots’ fork/integration preserves upstream attribution and documents Aikobots-specific changes separately.

### 6. Character Protection and Admin Push Workflows

Aikobots adds character protection behavior and admin push workflows for distributing or managing characters and related lorebook data.

These systems are designed for hosted/community environments where admins may need to distribute content while preserving user boundaries and protected metadata.

### 7. Chat Handling and Long-Chat Performance Work

Aikobots includes changes intended to improve long-chat handling, including split-tail/chunked chat loading behavior and related performance/stability work.

Later development work moves toward replacing JSONL/split-tail behavior with SQLite-backed chat storage. This work was contributed by LeRobber and is substantial enough to make LeRobber the main developer for this specific feature. 

### 8. Layout and UI Systems

Aikobots includes custom layout and interface work, including additional visual modes, UI refinements, and Aikobots-specific workflow controls.

Examples include custom layout modules, top information display behavior, and roleplay-oriented interface changes.

### 9. Session and Safety Guards

Aikobots includes session-handling and write-safety behavior intended to reduce accidental overwrites, stale writes, and multi-tab conflicts.

This includes single-tab/session-lock concepts and related frontend/backend coordination.

### 10. Provider, Token, and Prompt Workflow Changes

Aikobots includes provider registry work, token dry-run behavior, prompt inspection/support workflows, and related utilities used to improve reliability and transparency for generation setup.

## Forked or Integrated Third-Party Work

Aikobots credits upstream and third-party work where used. Relevant examples include:

* SillyTavern, the upstream project.
* WorldInfoInfo by Len Anderson.
* WorldInfoPresets by Len Anderson.
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
