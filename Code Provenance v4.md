# Aikobots v4: Native SQLite and Transactional Chat Mutations

This document records the historical v4 architecture. Committed frontend production bundles and the bundled-client extension policy belong to [Code Provenance v5](Code%20Provenance%20v5.md).

Aikobots v4 keeps the SQLite chat format introduced in v3, but changes how that format is used. v3 treated each `.sqlite` chat as a whole-file artifact loaded through `sql.js`, modified in memory, exported, and atomically replaced. v4 moves ordinary chat reads and writes to native SQLite through `better-sqlite3`, with bounded SQL reads, WAL-backed transactions, stable message and swipe identities, idempotent mutation receipts, and stronger client/server coordination.

v4 also moves more Memory Books work behind server-managed lorebook operations, adds group-memory workflows, improves chat and swipe editing reliability, introduces Recent Chats and the character Catalog on the welcome screen, preserves per-lorebook sort choices, and adds a Selenium end-to-end test harness.

## What changed

## Attribution note

v4 carries forward the SQLite storage work credited in v3 to LeRobber. Repository history attributes the v4 native SQLite conversion and its integration work to Aiko Hanasaki.

LeRobber also contributed the initial Selenium MVP harness in v4, including the first browser scenarios for chat creation and rename, edit cancellation, import/export, long-chat swipes, and connection-profile setup.

### Chat storage now uses native SQLite

v3 used `sql.js`: every save loaded the complete database image into memory, exported it, and replaced the complete `.sqlite` file. v4 replaces that engine with `better-sqlite3` and raises the runtime floor to Node.js 20.

Aikobots v4 supports:

* Ordinary bounded reads directly from the chat database.
* Ordinary writes performed as native SQLite transactions.
* Short-lived database connections instead of a process-global connection cache.
* WAL journal mode with `synchronous = FULL`, foreign keys, a busy timeout, and automatic checkpoints.
* Direct persistence without `db.export()` or whole-file replacement during ordinary saves.
* Existing `.sqlite` files upgraded in place.
* Legacy `.jsonl` retained as a migration and import source rather than a second writable chat format.

This is a storage-engine change, not another chat-format reset. Existing v3 `.sqlite` chats remain the continuity boundary.

### Chat lifecycle operations became WAL-aware

Native SQLite introduces committed state and lifecycle files that did not exist in v3's whole-file model. v4 updates chat storage helpers and callers so they coordinate the main database with its WAL and shared-memory state.

Aikobots v4 supports:

* Canonical `.sqlite`, `.sqlite-wal`, `.sqlite-shm`, and lock companion paths.
* Raw SQLite exports that include committed WAL state in a standalone database image.
* SQLite-aware backup, copy, rename, delete, import, and migration behavior.
* Cross-process application locks around logical chat lifecycle operations.
* SQLite's native transaction and file-lock behavior for concurrent database work.
* Explicit handling for the production model of multiple PM2 workers sharing one local `DATA_ROOT`.

### Routine chat changes became explicit mutations

v3 still relied heavily on broad full-chat and loaded-range replacement requests. v4 adds explicit SQLite mutation routes for direct and group chats so routine edits can address the intended record rather than resubmit unrelated chat state.

Aikobots v4 supports targeted operations for:

* Message append and insertion.
* Message text and selected-swipe edits.
* Adjacent message moves.
* Message deletion and truncation.
* Message cloning and regeneration preparation.
* Chat-header metadata.
* Message visibility and persona synchronization.
* Direct and group chat variants of the principal message mutations.

Creation, import, restore, migration, repair, and other deliberate replacement workflows keep narrow full-replacement paths. Some compatibility full-chat and loaded-range save paths also remain transitional; v4 does not claim that every legacy mutation caller has already been removed.

### Message and swipe identity became durable

Array positions are unsafe identifiers once chats can be loaded sparsely, messages can move, and concurrent requests can race. v4 extends the v3 message-identity work into a shared client/server identity model.

Aikobots v4 supports:

* Durable `aikobots_message_uuid` identities created before first persistence.
* Durable `aikobots_swipe_uuid` identities for embedded swipe state.
* An indexed SQLite `message_uuid` column synchronized with the compatibility JSON record.
* UUID-targeted edits, deletes, moves, clones, inserts, visibility updates, and group updates.
* Validation that distinguishes repairable identity omissions from contradictory or duplicate identity state.
* Preservation of unaffected identities through edits, rerenders, retries, movement, and streaming metadata replacement.
* Focused repair for the exact legacy one-past-the-end overswipe state, with ambiguous states rejected for diagnosis.

### Retries became idempotent and revision-aware

v4 strengthens the v3 chat-revision model by pairing semantic mutations with operation IDs and safe operation receipts.

Aikobots v4 supports:

* Revision validation inside the mutation transaction for explicit operations.
* One revision increment for one committed semantic mutation.
* Client-generated operation IDs reused when retrying the same logical request.
* A bounded receipt history used to acknowledge an already-committed retry without applying it twice.
* Rejection when an operation ID is reused with a different request payload.
* Receipts containing request fingerprints and safe acknowledgement data, not chat or secure lorebook content.
* Client acknowledgement queues for revision-sensitive metadata, visibility, persona, move, and group-message changes.
* Explicit reload or conflict behavior when server state cannot be reconciled safely.

### Chat editing and generation recovery improved

The native mutation work is carried through the frontend instead of existing only at the storage layer.

Aikobots v4 improves:

* Ordinary message edits without replacing following messages or sibling swipes.
* Edit cancellation and lock release.
* Swipe generation, streaming, selection, and overswipe recovery.
* Regeneration confirmation and preparation.
* Message move, cut, visibility, system-message, and chat-bound metadata persistence.
* First-message persistence for an otherwise pristine temporary greeting.
* Continue-message timestamps.
* Scroll preservation around edits and sparse chat state.

### Memory Books gained server-managed and group workflows

v4 moves more STMB persistence behind server endpoints that use the existing lorebook repository, storage selection, checkout validation, and active-session checks.

Aikobots v4 supports:

* Server-side scene capture and SQLite chat-range resolution.
* Server-managed memory saves, summary commits, and entry upserts.
* Group prompt selection and group-aware side-prompt defaults.
* One canonical group memory plus participant-target copies.
* Stable participant filters using avatar identities with conservative name fallback.
* Canonical numbering and metadata linking related group-memory entries.
* Validation of every target and checkout before group-memory writes begin.
* Rollback attempts if a multi-lorebook group-memory write fails partway through.
* Core Memory Assistance modes, Clip-update review reports, and Topical Clips sourced from bounded chat-message ranges, adapted from SillyTavern-MemoryBooks commit `52520c76e1a1c9ad820d37c0960e4608467ff2f6`.
* The reference repository's German, French, Japanese, and Portuguese Memory Assistance translations, copied without retranslation.

Secure and shared-secure lorebooks continue to use the existing permission-sensitive repository boundary; v4 does not move protected lorebook content into client-side persistence.

### Lorebook sorting became a saved choice

v4 adds a small shared normalization layer and server route for per-lorebook sort order. The selected order can persist with the lorebook instead of remaining only a transient browser choice, while search order remains a temporary UI mode.

### Welcome and mobile workflows expanded

v4 adds two welcome-screen discovery paths:

* Recent Chats, ordered from explicit chat activity metadata with legacy timestamp fallback.
* A character Catalog backed by the server-managed published-character index and safe catalog retrieval routes.

The release also includes mobile pull-to-refresh behavior, refresh clamping, floating-icon fixes, and related chat navigation refinements.

### Group generation setup became more reliable

Connection-profile and generation-lock changes now wait for the current chat-completion connection attempt, discard superseded status checks, and recheck connection state when required. This prevents stale asynchronous connection work from winning while group generation applies its selected profile, preset, model, and overrides.

### End-to-end verification was introduced

v4 adds a Selenium MVP harness with structured step records and Windows/macOS setup guidance. Initial scenarios cover chat creation and rename, edit cancellation, import/export round trips, long-chat swipe behavior, and connection-profile setup. This complements the expanded native SQLite, identity, migration, STMB group, and lorebook sort-order regression tests.

## Summary

v4 is the native-database evolution of Aikobots. v3 established SQLite as the chat artifact; v4 makes SQLite the active storage engine, with bounded reads, transactional mutations, WAL-aware lifecycle handling, durable identities, idempotent retries, and safer direct and group editing. It also deepens the core Memory Books integration and adds practical discovery, mobile, connection, and end-to-end testing improvements.

## Provenance note

v4 remains an Aikobots platform release built on the SillyTavern foundation and the systems documented in v1 through v3. The native SQLite architecture and related integration do not make it a clean-room rewrite.
