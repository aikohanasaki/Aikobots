# Aikobots v6: Stabilization, Efficiency, and Maintenance

Aikobots 6.0.0 focuses on stabilization, refactors for efficiency and easier codebase maintenance, and minor quality-of-life improvements. It builds on the bundled frontend and detached-generation architecture documented in [Code Provenance v5](Code%20Provenance%20v5.md), retaining SQLite chat identities, cross-worker transaction safeguards, and secure-lorebook access boundaries.

## Principal changes

* **Simpler generation code:** consolidate text generation around chat completions and remove obsolete text-completion UI, settings modules, and associated code. Supporting image, speech, and embedding integrations remain separate.
* **Leaner dependencies:** reduce the Jimp dependency footprint while retaining the image operations the application uses.
* **More reliable persistence:** refine Memory Books pending actions, queued consolidation source validation, and rollback handling; keep lorebook editor initialization read-only.
* **Retained partial replies:** save useful streamed text after terminal generation errors, including unfinished sentences. When reasoning stripping leaves no answer, display a localized explanation. Existing chat/swipe validation remains authoritative.
* **Small workflow improvements:** add memory reminders and a lorebook entry compaction shortcut, expose additional provider parameters across connections, clarify lorebook ordering labels, and maintain supported UI translations.
* **Standalone universes:** let owners publish the names of secure or shared secure lorebooks for global opt-in without exposing entries. Selection and World Info Locks refresh the name catalog, and server-side resolution blocks withdrawn selections for ordinary users.
* **Memory Books Clip workflows:** queue Topical Clip generation and entry compaction, and add reviewed Combine Clips generation for ordinary user Memory Books. Clip formats and insertion settings can be chosen for new Topical and combined entries; combined saves can disable their source Clips under the shared lorebook transaction.
* **Chat and provider refinements:** add chat-management sorting by last message time, name, size, or message count; expose Gemini service tier and Claude cache controls; and default Memory Books profiles to skipping provider caching unless explicitly configured otherwise.

## Attribution and continuity

Maintained and integrated by Aiko Hanasaki. These changes refine the existing Aikobots implementation; inherited SillyTavern code and the Memory Books, WorldInfoInfo, LorebookOrdering, and World Info Locks integrations retain the attribution recorded in [Code Provenance overall](Code%20Provenance%20overall.md).

The AGPL-3.0 license, third-party notices, and generated bundle license notices continue to apply. v6 does not reset chat storage or reattribute inherited code.
