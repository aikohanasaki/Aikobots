# Aikobots v2: From Branded Fork to Hosted Platform

Where v1 mainly changed how SillyTavern looked and was deployed, v2 changes what it can do: major systems such as memory books, lorebook ordering, server-managed prompts, secure lorebooks, character sharing, long-chat handling, and hosted multi-user safety move into the core runtime.

Several of the major systems integrated in v2 came from the project owner's own SillyTavern extension work on STLO, STMB, and STWII. In v2, those extension concepts become first-party Aikobots systems, with credit retained where due, including Len Anderson's contributions noted in the README.

## What changed

### Prompt assembly moved server-side

In base SillyTavern, prompt assembly happens largely in the browser. v2 moves the chat-completions prompt path into the server/runtime path instead.

Prompt construction, world-info scanning, macro behavior, regex handling, and prompt conversion are handled in a more controlled way for the Aikobots runtime, giving hosted users a more consistent experience across devices and sessions.

### Lorebook ordering became core behavior

v2 integrates STLO-style lorebook ordering directly into Aikobots. Base SillyTavern already had important world-info controls such as entry order, budgets, recursion, probability, and group behavior; v2 adds a higher-level lorebook policy layer built from STLO work.

Aikobots v2 supports:

* Lorebook ordering and priority controls.
* Fixed and percentage-style token budgets.
* Entry-level overrides.
* Group-chat-aware lorebook behavior.
* Random subset and recursion behavior.
* Lorebook defaults that work with Memory Books.
* Integration with secure and hidden lorebook behavior.

### Memory Books became part of the main experience

STMB / Memory Books move from optional extension to core workflow, supporting long-running roleplay in a way base SillyTavern doesn't natively address.

Aikobots v2 supports:

* Memory Book UI and workflows.
* Scene capture.
* Summaries.
* Memory generation.
* Memory consolidation.
* Topical Clips.
* SidePrompts and side prompt sets.
* Manual side prompts.
* Retry handling.
* Job queues and processed-message tracking.
* Long-chat support hooks.

### Lorebooks became secure, hidden, and admin-manageable

In v2, lorebooks stop being only ordinary user-selected context files and become a permission-sensitive platform feature, and are treated as protected resources, not just files a local user manually selects.

Aikobots adds secure, hidden, shared, system-managed, and admin-managed lorebook behavior for hosted communities. This allows admins to distribute or bind lorebooks without exposing every internal/system lorebook directly through ordinary user selection.

Aikobots v2 supports:

* Secure lorebooks.
* Hidden lorebooks.
* Hidden templates and bindings.
* Server-side lorebook repository behavior.
* Shared secure lorebook concepts.
* Admin/user visibility separation.
* System-managed lorebook conventions.
* STWII / WorldInfoInfo-style hidden lorebook integration.
* Preservation of hidden lorebook bindings through rename and migration paths.

### Character sharing became structured

Base SillyTavern has no built-in mechanism for managing a shared character community. v2 adds that layer to the UI and server runtime and moves manual v1 Python script functionality into the UI interface in v2.

Aikobots v2 supports:

* Character submissions for admin review.
* Shared character storage.
* Owner metadata.
* Owner-management workflows.
* Checkout and force-checkout behavior.
* Direct admin push and distribution.
* Whitelist, global, and blacklist distribution policies.
* Repush opt-out and blacklist handling.

### Long chats became a normal use case

Base SillyTavern loads full chat history on open. v2 adds split-tail and chunked loading so long chats don't carry that cost.

Aikobots v2 supports:

* Opening chats without loading full history.
* Fetching older message ranges as needed.
* Bookmark and last-opened behavior.
* Last-processed-message tracking.
* Chat DOM and scroll preservation.
* Reduced long-chat UI cost.

### Hosted write safety improved

v2 adds protections for multi-tab, multi-session hosted use that base SillyTavern, built for single-user local use, doesn't need.

Aikobots v2 supports:

* Active-session behavior.
* Single-session protections.
* Hosted session naming and write-lock coordination.
* Preservation of base SillyTavern's CSRF protections while adding Aikobots-specific hosted write safety.
* Better save and chat error messages.
* Frontend/backend coordination to reduce accidental overwrites.

### Layouts became more modular

v2 introduces a richer UI layer than base SillyTavern's layout system.

Aikobots v2 supports:

* Modular layout files.
* Starter layouts.
* Layout import work.
* Custom CSS/layout documentation.
* Floating UI and top bar refactors.
* Mobile swipe improvements.
* Chat top bar integrations.

### Provider behavior became more focused

v2 continues narrowing around chat-completion-style APIs, with older text-generation paths becoming less central and supported provider behavior organized around the Aikobots runtime. Some older provider settings and compatibility code remain, but the main v2 generation path is focused around chat-completions.

## Summary

v2 is the version where Aikobots becomes a hosted roleplay platform rather than a customized fork. Against base SillyTavern, the gap widens substantially: server-managed chat-completions prompts, core Memory Books, higher-level lorebook ordering, secure lorebooks, character distribution, long-chat support, modular layouts, and multi-user write safety that base SillyTavern doesn't provide.

## Provenance note

v2 is a major divergence from v1, but it still inherits and selectively updates SillyTavern-derived code. It is an Aikobots platform fork, not a clean-room replacement.
