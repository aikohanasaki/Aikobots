# Changelog: `release` -> `v2`

High-level summary of what exists on `v2` and not on `release`.

Comparison details:
- Base branch: `release`
- Target branch: `v2`
- Commit window represented here: March 25, 2026 through March 31, 2026

## Summary

`v2` is a backend-first fork centered on server-side prompt assembly, server-side World Info processing, lorebook access control, and a narrower chat-completions-focused runtime. Compared with `release`, it moves more generation behavior out of the browser, reduces support for legacy text-generation paths, and adds a more opinionated lorebook model with secure books, hidden bindings, hidden-template compilation, and built-in STLO ordering/budget controls.

That backend shift is now paired with a second theme that was not fully reflected in the earlier draft: `v2` also folds several Aikobots branch-specific features into core. The branch now includes character submission/distribution workflows, ownership-aware character controls, named bookmarks and checkpoint navigation, and long-chat storage/loading behavior that treats very large chats as a first-class case instead of a pure frontend rendering problem.

## Major Themes

- Prompt assembly moved to the server.
  - Chat-completion prompts are assembled on the backend instead of trusting the browser to build the final request payload.
  - Supporting modules were added for macro evaluation, regex processing, assembly comparison, and debugging.

- World Info moved to a server-owned generation path.
  - Lorebook sorting, preprocessing, scan-time activation, token-aware budgeting, and generation-time merge behavior are now primarily backend concerns.
  - The frontend still edits lorebooks, but the backend now decides much more of what actually reaches generation.

- Lorebook management became more capable and more controlled.
  - User and secure lorebook storage are now distinct concepts.
  - Hidden lorebook bindings allow characters to carry generation-affecting lorebooks that are not exposed in the normal selector flow.
  - Hidden lorebook templates now compile into bindings, giving admins a higher-level way to manage hidden-book sets per character.
  - STLO was brought into core so lorebook ordering and budgeting are part of the built-in World Info experience instead of remaining an external extension.

- Character management became ownership-aware and distribution-aware.
  - Character cards can now be submitted for admin review and then distributed to selected users or globally.
  - Ownership metadata now affects what can be duplicated, redistributed, or edited.
  - Admin workflows are more explicit about publication targets and managed content.

- Core product features were pulled out of extension-only form.
  - Several Aikobots features were migrated into core scripts, templates, and UI instead of remaining isolated in extension files.
  - This includes hidden-template management, bookmark tooling, and related character-management behavior.

- Chat UX was expanded for very large histories.
  - Long chats can now be split into writable tail storage plus historical head storage.
  - The UI can open a chat with only the newest window visible, then hydrate older chunks on demand.
  - Bookmark and checkpoint tools now work alongside that chunked-history model.

- The build became more narrowly scoped around chat completions.
  - Legacy text-generation backends and related UI/API flows were removed, disabled, or deprioritized.
  - The fork assumes a more modern chat-completions pipeline rather than maintaining broad parity with older text-completion paths.

## Added

- Server-side prompt assembly modules.
  - New backend prompting modules were added for chat assembly, comparison, macro evaluation, regex processing, and World Info scanning.

- Server runtime hooks for extensions.
  - Extensions can now participate in server-side generation through runtime hooks instead of relying only on browser-side prompt injection.

- Secure lorebook workflows.
  - Lorebooks can be promoted to secure storage and demoted back.
  - Ownership and management permissions are now carried through lorebook APIs and UI list responses.

- Hidden lorebook bindings.
  - Characters can be associated with hidden lorebooks through a registry file.
  - These lorebooks participate in generation without having to appear as visibly selected books in the normal UI.

- Hidden lorebook templates.
  - A new template registry can describe reusable hidden-lorebook sets and per-character overrides.
  - Templates compile down into the hidden-binding registry, turning hidden lorebook assignment into a higher-level managed workflow.
  - Core UI was added to edit, save, preview, and compile these templates.

- Core STLO support.
  - Lorebooks can carry built-in ordering and budgeting metadata.
  - The World Info UI now exposes lorebook-level ordering/budget controls directly in core.
  - Scan-time lorebook budgeting and ordering behavior now exists in the backend path rather than only as client-side extension behavior.

- Character submission and distribution workflows.
  - Characters can be submitted for admin review from the main UI.
  - Admins can approve/reject submissions, publish to selected users or globally, and preserve managed metadata on redistributed cards.
  - Distribution also updates default managed content when publication is global.

- Ownership-aware character controls.
  - Character cards now carry owner metadata.
  - Duplication, lorebook editing, and some distribution paths now respect owner/admin rules.
  - Admin-facing delete/distribute controls are more explicit about scope.

- Named bookmarks and improved checkpoint tooling.
  - Chats now support named bookmarks in addition to checkpoint links.
  - Bookmark creation, editing, import/export, lookup, and navigation were added, including slash-command coverage.
  - Bookmark UI reports whether the target message is already visible, buffered, or requires loading older history.

- Long-chat storage and hydration support.
  - Very large chats can be stored in split-tail form, with a historical head file and an active tail buffer.
  - New settings control how many recent messages are shown initially and how much writable tail history stays buffered before compaction.
  - Server payloads can return chunked chat windows and resident parent prompt messages instead of always hydrating the full log.

- Additional frontend/runtime helpers.
  - Chat popout support was added.
  - Model-tag injection and related prompt/runtime helpers were added around the newer core flow.

- New automated coverage around the new backend behavior.
  - Tests were added for prompt comparison, hidden lorebook bindings, hidden lorebook templates, World Info scanning, lorebook budget handling, server runtime behavior, and STLO-related behavior.

## Changed

- World Info behavior is now substantially different in architecture.
  - The browser no longer owns the full generation-time World Info pipeline.
  - Server-side sorting and scan logic now mediate what lorebook entries are considered and injected.

- Group-chat behavior was brought closer to server-side parity.
  - Group-derived prompt data, macro values, and related generation behavior were improved so the backend path can make decisions closer to the client's previous behavior.

- Prompt token accounting and itemization were reworked.
  - Prompt composition and reporting now better distinguish different sources of injected prompt material, especially around World Info and depth-injected content.

- Lorebook APIs now return richer metadata.
  - Lorebook list/get/edit operations now carry storage, ownership, and capability information instead of only simple names and file contents.

- Several frontend screens and controls now act more like views over backend state than owners of generation logic.
  - This is especially visible in OpenAI/chat-completion flows, World Info handling, preset behavior, and prompt debugging.

- Core features were reorganized on the frontend.
  - A number of Aikobots features were moved from extension-specific files into core scripts/templates and then further reorganized into dedicated modules.
  - The `v2` frontend is less "extension layered on top" and more "forked core product surface."

- Character management behavior is more policy-driven.
  - Owner metadata now influences duplication and lorebook editing.
  - Admins gained clearer review, publish, and delete-for-all-users flows.

- The UI was reorganized to surface the new core model.
  - `index.html`, styling, and supporting scripts were reshaped around the newer controls and settings.
  - Localization was updated alongside those UI changes.

- Long-chat handling changed from a pure display concern to a storage/runtime concern.
  - Opening, renaming, jumping within, and editing chats can now interact with chunked/hydrated history instead of assuming the full log is already in memory.

## Removed or Narrowed

- Legacy text-generation pathways were reduced sharply.
  - Kobold, text-completions, Horde-heavy paths, instruct-mode-heavy flows, and other older text-generation modules were removed, disabled, or made non-primary in this fork.

- Dead or legacy API/UI paths were trimmed.
  - A number of old helpers, endpoints, compatibility paths, and legacy settings/search affordances disappeared as part of the move toward the new backend-owned generation pipeline.

## Behavioral Notes

- `v2` is effectively a chat-completions-first build.
  - This branch is no longer trying to preserve equal support for all historic generation modes.

- Generation decisions are more backend-dependent than on `release`.
  - Prompt content, lorebook ordering, lorebook budgeting, regex effects, macro resolution, and some extension behavior now depend on server modules rather than browser-only logic.

- Lorebook visibility and lorebook participation are now separate concerns.
  - A lorebook can affect generation because it is hidden-bound, template-derived, or secure, even if the normal World Info selector does not present it the way `release` users expect.

- STLO behavior is now part of core World Info handling.
  - Ordering and budget behavior are no longer just an optional extension concern in this branch.

- Secure lorebooks introduce ownership rules.
  - Promotion, demotion, deletion, shadowing, and some editing behaviors are now more constrained than plain user-storage lorebooks on `release`.

- Character cards now carry stronger ownership semantics.
  - Sharing and duplication are no longer assumed to be unrestricted local actions.
  - Some workflows depend on owner/admin policy instead of only filesystem presence.

- Large chats may open partially hydrated.
  - The newest messages remain immediately available, but older messages may need to be loaded on demand.
  - Bookmark navigation and editing workflows now account for that state explicitly.

## Functional Impact

- Prompt assembly should be more consistent across clients because the backend owns more of the final generation payload.
- Lorebook behavior is more expressive, but also more opinionated and less "purely frontend" than on `release`.
- Admin and debugging workflows are stronger because the backend can expose what it actually assembled and because character publication is now a managed workflow.
- Long chats are more usable and scalable because storage, hydration, and navigation now acknowledge that very large histories exist.
- Compatibility with older generation modes is worse by design, in exchange for a more focused server-side pipeline and a more integrated fork-specific product surface.

## Commit Themes In This Range

- `first pass serverside`
- `progress bank`
- `bank progress on serverside lorebooks`
- `chat injects at depth token counting`
- `group parity`
- `promote/demote secure lorebooks`
- `hidden lorebook bindings`
- `remove dead API endpoints`
- `remove textgen`
- `bug hunting and cleanup`
- `switch Gemini max context`
- `add STLO to core`
- `bughunt post-STLO`
- `hidden lorebook templates`
- `think user toggle`
- `bank progress`
- `localisation updates`
- `chat jump and bookmarks`
- `integrate core features`
- `more textgen removals`
- `UI reorganization`
- `additional character controls`
- `improved long chat handling`
- `quick regenerate`
