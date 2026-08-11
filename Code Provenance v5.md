# Aikobots v5: Committed Frontend Bundles

Aikobots v5 changes how the browser application is delivered. Earlier versions served roughly 200 or more individual JavaScript and CSS files during startup. v5 builds those sources ahead of time into a small, deterministic set of production bundles committed under `public/dist`.

This is a delivery and client-extension-policy change, not a chat-storage reset. v5 carries forward the native SQLite, transaction, identity, locking, and recovery architecture documented in [Code Provenance v4](Code%20Provenance%20v4.md). It does not change application APIs, database formats, chat payloads, secure lorebook boundaries, or character payloads.

## Attribution note

Aikobots v5 is maintained and integrated by Aiko Hanasaki. It remains an Aikobots platform release built on SillyTavern and carries forward the third-party integrations and attribution described in [Code Provenance overall](Code%20Provenance%20overall.md).

The v5 bundling design, integration choices, extension policy, validation, and release workflow are Aikobots-specific work. Bundled source retains its original copyright and license notices. Packaging upstream or integrated code into a bundle does not change the provenance or license of that code.

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

Shared application and dependency code remains in the app or vendor bundles instead of being copied into STMB. Existing Memory Books initialization after settings load, planner polling, automatic-memory hooks, job UI, slash commands, bookmark integration, storage behavior, logging rules, and server APIs are unchanged.

STMB stays eager because its automatic work and chat hooks must be registered reliably even when the user does not open a Memory Books menu during that session.

### Built-in extensions share one asynchronous download

The 13 built-in extensions now use a compiled registry containing their manifests, supported locale data, CSS, and HTML templates. Their code and resources are emitted as one asynchronous `builtins.js` chunk.

The first enabled built-in triggers that download. Manifest order and dependency checks remain in place, but only enabled extensions execute and receive styles. This removes the separate manifest, module, stylesheet, locale, and template requests previously made for each built-in.

Kokoro/TTS workers, speech models, WASM, PDF parsing, and EPUB parsing remain outside startup bundles and load only when their features are used.

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

The initial v5 build uses 10 application JavaScript/CSS requests and approximately 1.59 MiB of gzip-compressed startup assets. HTML, fonts, images, API calls, and feature-only resources are intentionally excluded from that request count.

### Character pagination remains separate

Production continues to use `lazyLoadCharacters: true`. Character endpoint pagination is a separate optimization because it changes API payload behavior, while v5 frontend bundling intentionally does not.

## Summary

v5 turns Aikobots from a source-file-heavy browser startup into a prebuilt application release. Users download a small stable set of bundles; Memory Books arrives as one eager unit; built-in extensions share one conditional download; optional engines stay lazy; and production workers only serve committed artifacts.

The practical result is fewer network round trips without changing chat storage, secure lorebook handling, application APIs, or the production character-loading configuration.

## Provenance note

v5 is not a clean-room rewrite. It packages and integrates the existing Aikobots, SillyTavern, Memory Books, and built-in-extension source graph while preserving the provenance and license obligations of those components. Redistribution should retain the AGPL-3.0 license, generated bundle license notices, and the attribution trail described in the overall provenance guide.
