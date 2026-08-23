# Aikobots v5 and v5.1: Bundled Frontend and Detached Generation Workspaces

Aikobots v5 began by changing how the browser application is delivered. Earlier versions served roughly 200 or more individual JavaScript and CSS files during startup. v5 builds those sources ahead of time into a small, deterministic set of production bundles committed under `public/dist`.

The current v5.1 line also adds a shared detached-generation scheduler, server-authoritative prompt preparation for ordinary SQLite chats, resumable patron chat tabs, safer new-chat persistence, cross-worker user-record updates, administrative session reset, Data Maid lorebook cleanup, Russian localization, and a unified test toolchain.

This is not a chat-storage reset. v5 carries forward the native SQLite chat format, transaction, identity, locking, and recovery architecture documented in [Code Provenance v4](Code%20Provenance%20v4.md). The original v5.0 bundle work did not change application APIs or persistent payloads. Later v5.x work adds generation-job APIs and a separate content-restricted job database, but does not replace or expose chat, secure-lorebook, or character storage.

## Attribution note

Aikobots v5 is maintained and integrated by Aiko Hanasaki. It remains an Aikobots platform release built on SillyTavern and carries forward the third-party integrations and attribution described in [Code Provenance overall](Code%20Provenance%20overall.md).

Repository history attributes the v5 bundling design and the subsequent v5.1 generation, workspace, persistence, account, cleanup, localization, testing, and integration work to Aiko Hanasaki. World Info Locks and Memory Assistance retain the more specific upstream provenance stated below and in the overall guide.

Bundled source retains its original copyright and license notices. Packaging upstream or integrated code into a bundle does not change the provenance or license of that code.

## What changed

### Browser startup now uses committed production bundles

The browser no longer requests hundreds of source files one at a time. A deterministic Webpack 5 build emits stable, source-map-free artifacts under `public/dist`:

* The ordered legacy browser libraries.
* The Webpack runtime.
* Shared third-party vendor code.
* The main Aikobots application.
* The complete eager Memory Books module graph.
* One asynchronous built-in-extension chunk.
* The ordered static CSS bundle.
* A build manifest containing hashes, sizes, and startup-budget statistics.

The 14 classic scripts are concatenated in their existing order so their global-variable and plugin initialization behavior is preserved. The module application starts through one bundled entry after the page load event, retaining the previous startup timing.

### Static CSS is bundled without taking over runtime layouts

v5 combines the static application styles in their existing order. Local `@import` rules are recursively inlined, and relative asset URLs are rebased to their public paths so fonts and images continue to resolve after the CSS moves into `public/dist`.

Three stylesheets intentionally remain separate:

* `css/layouts/layout-structure.css`
* The currently selected layout stylesheet
* `css/user.css`

The client changes or inspects these files at runtime. Keeping them separate preserves dynamic layout selection and user styling. Memory Books styling remains part of the core CSS bundle.

### Startup templates are embedded

The seven templates needed during normal startup are embedded in the main application bundle. Built-in extension templates are embedded in the built-ins resource registry. Other infrequently used core templates remain fetch-on-demand so they do not enlarge the startup bundles unnecessarily.

### Memory Books is one eager STMB chunk

All 28 `stmb.js` and `stmb-*.js` modules are forced into one dedicated eager `stmb.js` artifact. Build validation rejects an output where an STMB module is missing, duplicated, or placed in another chunk.

Shared application and dependency code remains in the app or vendor bundles instead of being copied into STMB. The bundling step itself did not change Memory Books initialization after settings load, planner polling, automatic-memory hooks, job UI, slash commands, bookmark integration, storage behavior, logging rules, or server APIs.

STMB stays eager because its automatic work and chat hooks must be registered reliably even when the user does not open a Memory Books menu during that session.

### Built-in extensions share one asynchronous download

The 13 built-in extensions now use a compiled registry containing their manifests, supported locale data, CSS, and HTML templates. Their code and resources are emitted as one asynchronous `builtins.js` chunk.

The first enabled built-in triggers that download. Manifest order and dependency checks remain in place, but only enabled extensions execute and receive styles. This removes the separate manifest, module, stylesheet, locale, and template requests previously made for each built-in.

Kokoro/TTS workers, speech models, WASM, PDF parsing, and EPUB parsing remain outside startup bundles and load only when their features are used.

### World Info Locks is core UI

v5 restores the World Info Locks preset bar as core client code rather than depending on third-party extension discovery. The implementation is derived from SillyTavern-WorldInfoPresets by Len Anderson and the WorldInfoLocks fork by Aiko Hanasaki.

It preserves the legacy `extension_settings.worldInfoPresets` and `chat_metadata.worldInfoPresetLock` formats. Preset activation manages only ordinary user lorebooks; secure and hidden selections remain active and are excluded from preset exports, logs, and bundled lorebook data. Character locks use stable avatar filenames with conservative migration from legacy display-name keys, while chat locks persist through the acknowledged SQLite metadata path.

### Third-party extensions are not part of the v5 client

The bundled v5 browser does not discover or load third-party extensions. Installation and update controls, including extension entries in the Assets browser, are hidden or disabled.

Existing third-party files and server endpoints are not deleted. They remain available for recovery or a future deliberate migration, but they are unsupported by the v5 bundled client and cannot participate in its startup module graph.

### Production performs no frontend compilation

Production, Docker, and PM2 workers serve the committed files directly. The former server-start Webpack compiler, custom `/lib.js` middleware, and Docker compilation step are removed. Webpack is a development dependency because it is used by contributors and CI, not by the production process.

This is important for the hosted Aikobots deployment model: ten PM2 workers sharing one `DATA_ROOT` do not race to compile files or maintain separate frontend build caches. Existing static-file ETags and cache headers continue to apply, and cachebuster URLs remain disabled.

### The build is reproducible and checked

Contributors use:

* `npm run build:frontend` to regenerate `public/dist` after relevant frontend changes.
* `npm run check:frontend-build` to build into a temporary directory and compare every committed artifact hash.

The build fails if the committed output is stale, startup exceeds 12 application JavaScript/CSS requests, compressed initial assets exceed 1.8 MiB, the built-in registry count changes unexpectedly, or the 28 STMB modules are not isolated in their dedicated chunk.

Focused tests cover legacy script ordering, recursive CSS imports and URL rebasing, bundle registries, disabled built-ins, third-party exclusion, deterministic output, retained dynamic styles, and the absence of runtime compilation. The browser smoke test reaches application readiness, verifies the global SillyTavern context and STMB initialization, confirms optional engines are absent from startup, and verifies that production startup does not modify committed artifacts.

The current v5.1 build uses 10 application JavaScript/CSS requests and approximately 1.60 MiB of gzip-compressed startup assets. HTML, fonts, images, API calls, and feature-only resources are intentionally excluded from that request count.

### Character pagination remains separate

Production continues to use `lazyLoadCharacters: true`. Character endpoint pagination is a separate optimization because it changes API payload behavior, while v5 frontend bundling intentionally does not.

### Detached generation became shared, schedulable work

Chat-completion provider work is owned by a detached server job after admission. Job state, fair-scheduling metadata, content-free recovery routes, response headers, and replayable SSE events live in `DATA_ROOT/_generation-jobs/jobs.sqlite`, allowing creation, cancellation, status, and replay requests to reach any of the ten PM2 workers.

The durable scheduling and recovery metadata does not contain prompts, provider request bodies, credentials, secure lorebook entries, keys, bindings, or hidden metadata. Replayable event rows necessarily contain provider output until retention cleanup, but the content-free recovery route and request fingerprint do not duplicate it. The authenticated session supplies the user identity; a client-supplied user handle is not trusted. Generation UUIDs are idempotent, and reuse with a different safe request fingerprint or recovery target is rejected.

Compatible ordinary SQLite chat requests use a versioned preparation envelope. After client-only validation, the owning worker reads the authoritative chat by identity, revision, and tail UUID; resolves server-owned inputs, including secure lorebooks, in memory; assembles the prompt; and dispatches the provider request. Built-in vector rearrangement participates in the server extension stage when its configured embedding source is server-capable. Stale chat state or missing resources fail rather than being guessed from a newer chat. JSONL compatibility, client-only interceptors that cannot preserve behavior server-side, STMB/custom generations, and the internal provider dispatcher retain the direct route. Provider debug logging records only safe structural counts and flags.

The shared scheduler enforces configurable global, per-user, and queued limits. Reserved first-generation slots prevent users who already have running work from consuming all capacity, while aged secondary jobs eventually join normal general-pool priority. Standard users receive one running slot; patrons and admins may receive the configured higher limit. Claims, admission, stale-owner finalization, and slot release are transactional across workers.

Disconnecting or parking a browser delivery does not cancel the provider call. Recovery metadata is content-free: the browser copy is session-scoped, while the authenticated server copy is durable and user-scoped. Durable output can be replayed, and final chat persistence still uses the existing revision-checked SQLite mutation path. Graceful worker shutdown stops new ownership and drains work already held by that process; an ungraceful owner loss becomes a safe terminal failure instead of transferring an in-memory sensitive request to another worker.

### Patron chat tabs reuse the authoritative chat runtime

v5.1 adds a patron workspace to the existing Top Chat Bar. It does not mount parallel chat runtimes. Opening or selecting a tab parks any admitted detached delivery, discards an unsaved streaming placeholder, and loads the selected direct or group chat through the existing owner-checked Manage Chats path.

Tab state contains only chat identity, owner identity, label, creation time, and generation status in `sessionStorage`; generated content is not stored there. Tabs show queued/running, completed, and failed states, preserve keyboard focus across rerenders, and require confirmation before closing active work. Standard users see the entry in a locked state, while admins share patron capability.

### Chat persistence and editing gained stronger barriers

An ordinary new direct chat remains client-only while it is empty or contains only an untouched local greeting. It becomes eligible for persistence after real user activity, an accepted foreground generation, an edit, or an explicit Recommended Chat Setup apply. Rejected, quiet, dry-run, impersonation, and recovery-only operations do not manufacture an empty chat file.

A user-visible generation promotes any queued background save and waits for its acknowledgement before changing the target or submitting provider work. Stream completion appends or updates one explicit SQLite record, reads the canonical row back, verifies its UUID, and only then releases generation controls. Open edits retain their captured chat identity across asynchronous saves and preserve the local draft on failure instead of reloading over it.

### Data Maid can remove verified unbound lorebooks

Data Maid now supports category-level multi-selection and a dedicated ordinary-lorebook cleanup category. Its scan collects references from settings, personas, character cards, direct and group chat metadata, STMB settings and side prompts, World Info presets, hidden bindings, and hidden templates.

Deletion is all-or-nothing. The server re-runs the reference scan and validates the selected targets inside the cross-worker lorebook-management transaction; a changed or unreadable reference source returns a conflict and requires a rescan. Secure, shared-secure, reserved, and non-user lorebooks are not cleanup candidates.

### User and session changes are cross-worker operations

User-record read-modify-write operations now use per-handle locks under the shared `DATA_ROOT`. This covers patron grants, enable/admin changes, display-name and password recovery updates, session epochs, and activity timestamps so PM2 workers cannot overwrite unrelated fields from stale copies.

Administrators can reset another user's session. The operation rotates a persisted session epoch, removes the active-tab lease, and cancels that user's in-flight protected operations under the shared active-session lock. It invalidates authentication and active-tab state without changing chat storage.

### Memory Books workflows were refined

The v5 line continues the core Memory Assistance and message-sourced Topical Clip integration derived from SillyTavern-MemoryBooks commit `52520c76e1a1c9ad820d37c0960e4608467ff2f6`. Later v5 fixes preserve source message ranges in suggestions, prevent recursive Topical Clip settings from leaking into generated drafts, serialize dependent memory work correctly, surface raw provider failures in the STMB job UI, and add background Generate and Auto-Accept behavior through the existing revision-checked lorebook save.

The Memory Books help drawer now links directly to the AI Reference Manual matching the active supported locale, with English fallback and access to the complete language directory. Secure and shared-secure lorebooks remain excluded from Memory Assistance content loading and update paths.

### Russian joins the supported UI locales

Russian is now a maintained Aikobots UI locale alongside German, French, Japanese, and Portuguese. The localization audit checks all five supported non-English locale files for current tagged UI coverage. Memory Assistance translations specifically credited to the STMB reference remain the German, French, Japanese, and Portuguese copies described in the overall provenance guide; Russian UI coverage is part of the later Aikobots integration work.

### The test toolchain is explicit and reproducible

v5.1 pins Node.js 24.18.0 and npm 12.0.1, records dependency install-script policy, and separates `node:test` files from Jest files by filename. `npm test` runs a read-only environment doctor, both unit-test runners, the committed frontend comparison, and the self-contained Chromium smoke test. `npm run verify` adds ESLint and full localization coverage.

The Selenium harness remains explicit because it requires a running server, a dedicated connection profile, matching browser and driver binaries, and may spend model API credits. Its scenarios now include dirty new-chat persistence and stronger chat edit/send-cycle coverage in addition to the original v4 workflows.

## Summary

v5 turns Aikobots from a source-file-heavy browser startup into a prebuilt application release. v5.1 extends that release with content-restricted detached generation jobs, fair shared scheduling, server-authoritative prompt preparation, and a patron tab workspace that reuses the existing chat runtime.

The practical result is fewer startup round trips and the ability to park, queue, resume, and safely commit generation work across chats without replacing the v4 chat format or widening secure lorebook access. The same line also strengthens pristine-chat persistence, account/session concurrency, lorebook cleanup, localization, and verification.

## Provenance note

v5 is not a clean-room rewrite. It packages and integrates the existing Aikobots, SillyTavern, Memory Books, and built-in-extension source graph while preserving the provenance and license obligations of those components. Redistribution should retain the AGPL-3.0 license, generated bundle license notices, and the attribution trail described in the overall provenance guide.
