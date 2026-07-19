# Aikobots v3 / v3.1: SQLite Chat Storage and Safer Long Chats

This document records the historical v3/v3.1 architecture. Native SQLite and later transactional mutation work belong to [Code Provenance v4](Code%20Provenance%20v4.md).

Aikobots v3 keeps the v2 platform direction, but replaces the long-chat storage foundation underneath it.

The main change is chat storage: v3 moves away from the v2 JSONL/split-tail model, itself a departure from base SillyTavern's plain JSONL, and introduces SQLite-backed chat files, with stricter migration rules, safer path handling, revision-aware writes, SQLite-aware Memory Book behavior, and frontend save recovery paths for long-running chats.

## What changed

## Attribution note

The SQLite chat-storage transition in v3 includes substantial work by LeRobber.

LeRobber contributed substantial early SQLite retrieval and migration work and should be credited as a major developer for the SQLite storage feature area. He was also instrumental in spearheading QA efforts. Aikobots then integrates that storage work into the wider hosted platform: migration behavior, locking, revision checks, active-session safety, STMB compatibility, sparse range behavior, prompt snapshot invalidation, and related bugfixes.

### Chats now use SQLite storage

Base SillyTavern and Aikobots v2 store chats as JSONL. v3 changes the default chat format to SQLite-backed `.sqlite` files, giving Aikobots a stronger foundation for long chats, range reads, metadata access, and storage safety while preserving the historical whole-file chat artifact model.

Aikobots v3 supports:

* New chats defaulting to `.sqlite`.
* SQLite through `sql.js`.
* Durable `.sqlite` chat artifacts.
* In-memory mutation followed by full `.sqlite` export.
* Atomic whole-file replacement.
* SQLite integrity checks before persistence.
* Raw SQLite import/export paths in addition to logical JSONL and text exports.

The current implementation intentionally treats SQLite as a durable file format rather than a long-lived native SQLite connection. It does not use WAL, `-wal`, or `-shm` sidecars for chat storage; application-level save locking and atomic whole-file replacement remain the persistence boundary.

### Legacy JSONL is still supported, but split-tail runtime storage is not

v3 keeps compatibility for complete legacy `.jsonl` chats, but does not keep v2 split-tail as a live storage mode. Runtime reads and imports reject split-tail fragments because incomplete split-tail data is ambiguous. The migration path is stricter: it can recombine complete legacy split-tail pairs when the head and tail are both present and checkable, but refuses unsafe or partial migration sources instead of treating them as complete.

Aikobots v3 supports:

* Reading or importing complete legacy `.jsonl`.
* Resolving `.jsonl` references to SQLite companion paths.
* JSONL exports and backups for full logical chat views.
* Rejecting split-tail headers in runtime reads and imports.
* Rejecting split-head files as standalone chat inputs.
* Recombining complete legacy split-tail pairs during migration.
* Refusing partial split-tail migration inputs.

### Migration became explicit and checkable

v3 adds dedicated migration tooling for this kind of storage change, with a deliberate path: migrate the full logical source, verify the database, compare the migrated content, and report correctness issues.

Aikobots v3 supports:

* One-shot migration through `migrate-sqlite.js`.
* Complete JSONL-to-SQLite migration.
* Complete legacy split-tail recombination when both segments are available.
* SQLite integrity verification.
* Source-to-output comparison.
* Centralized migration behavior.
* A single migration lock so concurrent instances do not run the migration over the same shared data root.
* Related data cleanup for initial messages and pushed/orphaned character lore references as part of the v3 migration path.

### Chat paths are stricter

v3 adds a dedicated chat path module and tighter storage boundaries than either base SillyTavern or v2 enforced, protecting chat storage from unsafe names, ambiguous sidecar-style paths, traversal attempts, and unsupported formats.

Aikobots v3 supports:

* `src/chat-paths.js` validation.
* `.sqlite` as the supported chat storage extensions and `.jsonl` as the supported chat backup storage extension.
* Defaulting missing extensions to `.sqlite`.
* Rejecting unsafe extensions.
* Rejecting sidecar-style names.
* Rejecting split-head names.
* Rejecting traversal, encoded traversal, slashes, backslashes, drive-letter paths, NULs, and empty names.
* Preferring SQLite as the operational chat storage method while retaining legacy JSONL compatibility paths.

### Long-chat reads became range-based

v3 replaces the v2 split-tail retrieval model with SQLite-backed chunk and range reads, so Aikobots can read the part of the chat it needs instead of hydrating the entire logical chat — a step beyond what v2's split-tail approach allowed.

Aikobots v3 supports:

* Direct logical range reads from SQLite.
* Metadata-only reads.
* Chunk payloads with absolute range metadata.
* Sparse range resolution for STMB.
* Long-chat loading, jumping, and top bar behavior adjusted for SQLite.

### Writes became revision-aware

v3 strengthens write coordination around the new storage layer beyond what base SillyTavern or v2 provided.

Aikobots v3 supports:

* Chat revisions to detect stale writes.
* Save locks.
* Active-session checks for protected mutations.
* Separate handling for loaded-range saves and full saves.
* Rejection of v2 tail save mode.
* Incremental saves that avoid unnecessary full JSONL backup generation.
* `last_save_session_id` metadata so the client can distinguish its own repeated save from another tab or session.
* Same-session stale-save retry/adoption behavior in the client.
* One quiet retry for transient chat save request/server failures.
* Strict loaded-range validation so partial saves cannot overwrite unseen messages when identities or ranges no longer match.

### Mutations became SQLite-native

v3 updates chat mutation paths so they understand SQLite message ordering and logical message IDs, rather than treating SQLite as a drop-in replacement for JSONL.

Aikobots v3 supports:

* Logical message IDs that exclude the chat header.
* SQLite row/order space that includes the header.
* Correct offsets for message range writes.
* Persona sync updates in SQLite.
* SQLite-only message clone behavior.
* Rename, delete, import, export, group chat, and Data Maid behavior updated for SQLite.
* UUID-addressed message updates, appends, deletes, visibility changes, truncation, and clone operations.
* Message and swipe identity normalization before persistence.
* Server-side repair for missing or duplicate SQLite message identity metadata, with reload-required responses instead of silent overwrite.
* Prompt snapshot invalidation and timed-world-info checkpoint remapping when cloned messages change identity.

### Backups and exports became SQLite-aware

v3 preserves JSONL as a compatibility and backup artifact without using it as the primary live chat storage mode.

Aikobots v3 supports:

* Full logical JSONL backup payloads for full saves.
* JSONL backup payloads after complete loaded-range SQLite saves.
* Periodic full JSONL backups after SQLite append saves, controlled by `backups.chat.sqliteAppendBackupMessageInterval`.
* Raw SQLite export as base64 with binary metadata.
* Logical JSONL export from SQLite-backed chats.
* Text export from visible logical messages.

### Memory Books were updated for SQLite chats

v3 carries Memory Books forward into the new storage model, extending the v2 STMB integration to work with sparse, SQLite-backed long chats.

Aikobots v3 supports:

* STMB sparse range resolution.
* Retry context fixes.
* Context key and context settings work.
* Unloaded-message interaction fixes.
* Additional context support.
* Token estimate adjustments.
* Group manual queue behavior.
* Last-processed-message behavior in SQLite-aware paths.

### Temporary chats and client save recovery improved

v3.1 adds client-side save recovery work around temporary chats and revision conflicts so users can continue working without turning transient state into accidental data loss.

Aikobots v3.1 supports:

* Temporary character and group chat tracking in the frontend.
* Pending temporary chat filename preservation through local storage.
* Skipping pristine generated temporary greetings instead of persisting empty throwaway chats.
* User-facing stale revision warnings with current server revision details.
* Reload-required handling when server-side chat identity repair occurs.
* Save retry handling that avoids retrying validation, active-session, identity-repair, integrity, or stale-revision failures as if they were transient network failures.

### Storage visibility improved

v3 adds operational visibility around storage health not present in earlier versions.

Aikobots v3 supports:

* User storage checks.
* Admin storage alerts.
* User storage alerts.
* Storage-related tests.
* SQLite architecture documentation.
* Chat storage repair responses that identify repair-required cases without exposing chat content.
* Focused regression coverage for chunked reads, sparse STMB reads, loaded-range saves, clone identity regeneration, path validation, split-tail rejection, and periodic SQLite append backup cadence.

## Summary

v3 is the storage evolution of Aikobots. It keeps the v2 hosted platform but replaces the long-chat foundation with SQLite-backed chat files: safer migration, stricter path validation, faster range reads, revision-aware writes, identity-aware message mutation, SQLite-aware backups and exports, and Memory Book behavior that works with sparse long-chat loading — a substantial step beyond what either base SillyTavern or Aikobots v2 supported.

## Provenance note

v3 does not erase the SillyTavern foundation or the v2 Aikobots platform. It is the SQLite and long-chat storage evolution of Aikobots.
