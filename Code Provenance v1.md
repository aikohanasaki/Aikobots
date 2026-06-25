# Aikobots v1 vs. Base SillyTavern

Aikobots v1 stayed close to upstream SillyTavern but the experience shifted from a general local-first app to a branded, hosted-friendly roleplay environment with its own defaults, presentation, and user flow.

## What changed

### Branding broadly replaced the SillyTavern default

Base SillyTavern ships with generic branding and defaults. v1 broadly replaces that with Aikobots presentation while still leaving upstream SillyTavern code and some labels in place.

* Aikobots icons, launcher assets, favicon, logo, and app manifest.
* Aikobots welcome and login screens.
* Hosted-friendly default settings in place of local-first defaults.
* Curated startup content instead of the broad default clutter base SillyTavern ships with.
* Empty character and world folders preserved for clean deployments.

### Hosted use became the target, not local use

Base SillyTavern is built primarily for a single user running it on their own machine. v1 starts shaping it for multi-user, server-hosted deployment instead.

* Login and user template changes.
* Early admin-facing behavior.
* Last-login and user metadata support.
* Configuration choices aimed at controlled multi-user hosting.

### Generation shifted toward chat-completions

Base SillyTavern supports a wide range of generation backends with no particular lean. v1 narrows that toward modern chat-completion APIs.

* OpenAI and chat-completion behavior adjusted.
* Gemini and model context defaults changed.
* Provider defaults and model injection behavior added or revised.
* Older generation paths deprioritized in favor of the chat-completions-first direction.

### The interface moved away from a technical control panel

Base SillyTavern exposes most of its settings and controls directly. v1 trims that down for a more curated experience.

* Main page structure customized.
* Welcome prompts revised.
* Prompt and itemization controls hidden, moved, or reduced where they didn't fit the intended flow.
* World-info UI behavior adjusted.

### The built-in extension surface got narrower

Base SillyTavern ships with a broad set of built-in extensions. v1 hides, reduces, or deemphasizes several that didn't fit the hosted model, although some extension code still remained in the tree.

* Quick Reply surface reduced, but the extension code still remained.
* Built-in memory surface reduced, but the extension code still remained.
* TTS behavior and UI surface reduced, but TTS code still remained.
* Extension containers adjusted for the Aikobots UI.
* Early favorite read/write behavior added — not present in base SillyTavern.

### World info, favorites, and early lorebook protection began to diverge

v1 includes the first visible attempts to make lorebook/world-info behavior fit a hosted Aikobots environment instead of a purely local, user-controlled setup. Aikobots starts treating world info and related controls as creator/admin-managed content that may need clearer boundaries, safer defaults, and less exposed surface area.

This was not yet the full secure lorebook system that appears later in v2. In v1, the protection was mainly UI visibility filtering and reduced exposed controls, not a complete server-side secure lorebook boundary.

Aikobots v1 changed:

* Hidden or owner-scoped lorebooks were filtered from non-owner UI display.
* World-info links and dropdown behavior.
* World-info warnings and keyword header behavior.
* Prompt/world-info controls that did not fit the intended hosted flow.
* Early favorite read/write behavior.
* Early groundwork for a more controlled lorebook experience.

## Summary

v1 is the first version that's recognizably Aikobots rather than SillyTavern with a different name. Compared to base SillyTavern, it's branded, hosted-oriented, and narrower: fewer exposed tools, chat-completions-first defaults, and the early groundwork for user and admin behavior that later versions build on.

## Provenance note

v1 remains close to upstream SillyTavern and continues to incorporate SillyTavern code throughout. It is not and should not be presented as a clean-room rewrite.
