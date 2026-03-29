# Changelog: `release` -> `v2`

Local comparison summary for the changes present on `v2` and not on `release`.

Comparison details:
- Base branch: `release`
- Target branch: `v2`
- Commit window: March 25, 2026 through March 28, 2026

## Summary

`v2` shifts prompt assembly and World Info processing onto the server, introduces secure and hidden lorebook flows, improves group-chat parity for server-side generation, and narrows the application into a chat-completions-only build.

## Added

- Server-side chat-completion prompt assembly.
  - Prompt construction now happens on the backend instead of relying on the browser to build the final OpenAI message list.
  - New assembly and comparison routes were added for debugging and validation.

- Server-side World Info scanning and preparation.
  - World Info sorting, macro substitution, regex handling, decorator parsing, and token-aware depth injection are now handled by backend modules.

- Secure lorebooks.
  - Lorebooks can now be promoted from user storage into secure storage and demoted back.
  - Secure lorebooks carry ownership and capability metadata.
  - Management APIs now distinguish between user and secure storage.

- Hidden lorebook bindings.
  - Characters can now have hidden lorebooks attached through a registry file.
  - Hidden lorebooks participate in generation without needing to remain visibly selected in normal World Info selectors.

- Server extension runtime.
  - Extensions can now register server-side prompt providers, macro providers, and generation interceptors.
  - The memory extension gained a server runtime hook.

- Prompt assembly comparison tests and lorebook binding tests.
  - New coverage was added around prompt comparison, hidden lorebook registry behavior, and hidden lorebook resolution in World Info sorting.

## Changed

- World Info moved from client-heavy to server-heavy behavior.
  - The frontend still manages editing and UI state, but the backend now owns the generation-time scan and merge behavior.
  - Client-side legacy World Info assembly code was removed or reduced substantially.

- Group chat parity improved for server-side generation.
  - Group macro values such as group member names, unmuted members, and `notChar` are now available for backend prompt assembly.
  - Regex and macro evaluation paths were aligned more closely with grouped chat behavior.

- Prompt token itemization became more accurate.
  - World Info injected before/after prompt sections is now tracked separately from World Info injected at chat depth.
  - Itemization templates and calculations were updated to reflect the new split.

- Settings and lorebook listings now return richer metadata.
  - Lorebook list responses include storage, ownership, and management permissions instead of only plain names.

- Prompt debugging for admins improved.
  - The client can request a backend assembly dump and compare client-side vs server-side chat payloads.

## Removed or Disabled

- Legacy text-generation backends are effectively disabled in this build.
  - Kobold generation endpoints now return disabled responses.
  - Text-generation-webui text completion endpoints now return disabled responses.
  - NovelAI text generation endpoints now return disabled responses.

- Legacy preset APIs for disabled backends are blocked.
  - Presets tied to Kobold, NovelAI, textgenerationwebui, and instruct mode are no longer active in the same way.

- OpenAI text-completion support was removed from the active generation path.
  - The build now assumes chat completions rather than switching between chat and text-completion request formats.

- Dead or no-longer-used API/UI paths were removed.
  - Several old frontend helpers and unused World Info assembly paths were deleted as part of the server-side migration.

## Breaking / Behavioral Notes

- The build is now chat-completions-only.
  - The UI forces `openai` as the main API and disables legacy generation controls.
  - Legacy backend routes return `410` instead of continuing to operate.

- `skipWIAN` is deprecated for chat-completion generation.
  - World Info and related prompt assembly now happen server-side, so the old client-side skip behavior is no longer authoritative.

- Secure lorebooks cannot be deleted until they are demoted.

- A user lorebook can shadow a secure lorebook with the same name during generation.
  - The UI now warns when this happens.

- Hidden lorebooks can affect generation even when they are not visibly selected in the standard World Info UI.

## Functional Impact

- Generation behavior should now be more consistent between clients because assembly happens centrally on the server.
- World Info behavior is more powerful and more controllable, but also more backend-dependent.
- Lorebook management now supports private vs secure workflows.
- Admin/debug workflows have better visibility into what the backend actually assembled.

## Commit Themes Included In This Range

- `first pass serverside`
- `progress bank`
- `bank progress on serverside lorebooks`
- `chat injects at depth token counting`
- `group parity`
- `promote/demote secure lorebooks`
- `hidden lorebook bindings`
- `remove dead API endpoints`
