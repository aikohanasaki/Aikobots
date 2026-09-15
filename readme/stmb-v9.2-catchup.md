# STMB v9.2 catch-up on v5

Reference: read-only STMB commit `376975c` (September 14, 2026), including its August/September history. Core baseline: `20eed1b5c`, `441ac30db`, and the saved continuation `022418fff`.

## Parity and core adaptations

| Upstream change | Core behavior / verification |
| --- | --- |
| Side Prompt concurrency (`567cc84`) | Client ceiling ten; server generation scheduler unchanged. Settings normalization and browser persistence checks. |
| Narrator editing (`3065fff`, `37b9dc6`) | Stable IDs and historical casts preserved; active/retired duplicate names rejected. Manager handlers reject a changed originating chat. Narrator identity tests. |
| Token summaries (`936e7b6` through `376975c`) | Existing scene capture and async tokenizer, eligible unsummarized range only, trailing buffer and hidden-message policy retained. Counted scene is queued; stale source is rejected before writes. Policy/range tests. |
| Group opt-outs (`59a97fa`) | Captured operation policy controls participants, copies, and prompts. Shared-book source streams remain separate; explicit Side Prompt chat overrides survive the solo-default fallback. Policy, prompt, and routing tests. |
| Topical Clip overrides (`4044d94`, `f6e592a`) | Remembered accessible controls; selection/profile captured before asynchronous work. Normal profile projection followed by enabled placement overrides, including manual zero and reverse order. Separate create/update route checks. |
| Shared books (`765569a`, `898cb9b`) | Explicit roles, normalized target identity, shared object/single save, canonical links, STLO reconciliation, separate previous context and summaries. Group route and consolidation/regeneration tests. Narrator distinct-book rule retained. |
| Rollback (`c27ad7c`, `abbc92a`, `08aa5bc`) | Opt-in automatic rollback backed by authoritative SQLite deletion intents and per-book recovery. Tests cover middle deletion, actual/no-op truncation, dependent summaries, edited/v1 Side Prompts, and interruption between writes. |
| Stale progress / queue recovery (`74be180` and queue fixes) | Durable intent and receipts replace browser-only progress for ordinary saves. Lost-response, duplicate-request, source-edit, partial-save, and reopening checks. |
| Help formatting (`ff9d8f5`) | Smart-theme flex sizing and wrapping; existing frontend layout smoke. |

The earlier baseline retains the other reviewed August/September additions: Memory Assistance, provider truncation handling, five-message intervals, participant confirmation, group-name/present macros, regeneration scope selection, Side Prompt toggles, and localized reference-manual links. Their affected existing suites remain part of verification.

## Explicit differences from upstream

- Recovery/rollback uses core's SQLite transactions and cross-worker lorebook/chat locks. It does not rely on browser queue state as persistent authorization.
- Protected-book access is unchanged. The new durable-operation/rollback path is restricted to ordinary user books; protected saves retain their previous core path.
- Shared mutations require attributable role/canonical metadata. No bulk rewrite guesses ownership of existing entries.
- Ambiguous numeric-only legacy ranges, partial multi-book saves, edited Side Prompts, and inaccessible targets remain visible conflicts. Recovery does not guess destructive writes. Discard explicitly keeps the current state.
- v1 Side Prompt snapshots still regenerate. Automatic full-entry restoration requires a server-created v2 snapshot and an exact written-state match.
- The concurrency setting does not increase the production generation scheduler's capacity.

## Reproducible checks

Use the existing STMB Node suites (`tests/stmb*.node.test.js`), affected STMB Jest suites plus `src/__tests__/chat-storage.test.js`, `npm run lint:localization:coverage`, ESLint on affected source files, `npm run build:frontend`, `npm run check:frontend-build`, and `npm run test:frontend:smoke`. The smoke includes real keyboard changes, saved settings payload checks, and rejection of an invalid token threshold. New strings are supplied in German, French, Japanese, Portuguese, and Russian.

These checks include simulated save/worker interruption and real SQLite reopening; they do not constitute a ten-worker production load test or full Firefox/Safari interaction coverage.
