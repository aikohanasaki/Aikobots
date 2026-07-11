# Native SQLite Chat Architecture

This document records the resolved architecture for Aikobots chat storage.

## Current Decision

Aikobots uses native SQLite through `better-sqlite3`. The former `sql.js`
whole-file persistence model is retired.

Ordinary reads and mutations operate directly on database pages:

1. Open the target `.sqlite` file with a native connection.
2. Execute bounded SQL reads or a transaction containing the requested mutation.
3. Commit through SQLite.
4. Close the connection.

Ordinary saves do not read the complete file, call `db.export()`, or atomically
replace the complete database image. Full serialization is reserved for an
explicit raw SQLite export.

The project requires Node.js 20 or newer. `better-sqlite3` is a native runtime
dependency, so production installation must allow its prebuilt binary to install
or provide the build toolchain needed by the deployment platform.

## Resolved Operational Decisions

- Driver: `better-sqlite3` 12.x.
- Runtime floor: Node.js 20.
- Connection lifetime: short-lived, one connection per storage operation.
- Journal mode: WAL.
- Durability: `synchronous = FULL`.
- SQLite lock wait: `busy_timeout = 10000` milliseconds.
- Automatic WAL checkpoint threshold: 1,000 pages.
- Application lock files remain in place.
- Revision and active-session validation remain in place.
- Existing `.sqlite` chat files are upgraded in place.
- Existing `.jsonl` chats remain supported migration/import inputs.

Short-lived connections are intentional. Aikobots can have many chat databases,
and chat files can be renamed or deleted. A process-global connection cache would
retain large numbers of file handles and complicate safe rename, delete, and WAL
sidecar handling. Native page-level I/O does not require a long-lived connection.

## Key Files

- `src/sqlite-manager.js`: native connection configuration, schema upgrades,
  JSONL migration, range reads, indexed UUID lookup, transactions, and explicit
  raw database export.
- `src/chat-storage.js`: canonical companion paths, cross-process chat locks,
  locked companion cleanup, and consistent lifecycle snapshots.
- `src/endpoints/chats.js`: path validation, cross-process locking, revisions,
  active-session checks, chat mutation endpoints, backups, imports, exports, and
  group chat adaptation.
- `src/chat-paths.js`: canonical `.sqlite`, `.jsonl`, `-wal`, and `-shm` paths.
- `migrate-sqlite.js`: one-shot JSONL migration and integrity verification.
- `src/__tests__/chat-storage.test.js`: storage and mutation regression coverage.

## Storage Schema

The storage version is `20260711`.

```sql
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_index REAL,
    content TEXT,
    message_uuid TEXT
);

CREATE INDEX idx_messages_order_index
    ON messages(order_index);

CREATE INDEX idx_messages_message_uuid
    ON messages(message_uuid);
```

`messages.content` remains the canonical JSON representation of each record. This
preserves compatibility with existing chat objects, including `swipes` and
`swipe_info`. The first ordered record is the chat header.

`message_uuid` mirrors `content.aikobots_message_uuid` for logical messages. It is
an indexed lookup column, not a second public source of truth. All manager-owned
insert and update paths write `content` and `message_uuid` together.

The UUID index locates the target row without parsing every message JSON object.
Computing its zero-based logical position still counts preceding entries through
the ordering index for response metadata. A swipe edit updates one message row
atomically because all sibling swipes belong to that row.

## Existing Database Upgrade

Opening an older Aikobots database performs an idempotent schema upgrade:

1. Verify that the `messages` table exists.
2. Add `messages.message_uuid` if absent.
3. Create `idx_messages_message_uuid` if absent.
4. Backfill UUIDs by parsing each existing logical message once.
5. Set `metadata.storage_version` to `20260711`.

The upgrade uses an immediate SQLite transaction and rechecks the schema after
acquiring the writer lock. Concurrent PM2 processes therefore cannot both attempt
the same `ALTER TABLE` operation.

The upgrade is resumable. If a process stops before the storage version is
advanced, the next open repeats the UUID backfill safely.

Existing chat data, message row IDs, `order_index` values, swipe arrays, metadata,
and revisions are not reformatted during this schema upgrade.

## Connection And WAL Policy

Every native connection applies:

```sql
PRAGMA busy_timeout = 10000;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA wal_autocheckpoint = 1000;
```

Committed data is durable when it is present in either the main database or its
WAL. Code must never assume that reading only the main `.sqlite` file captures the
latest state while a WAL may exist.

Closing the final connection normally checkpoints and removes idle sidecars, but
sidecars remain first-class storage companions:

- `<chat>.sqlite-wal`
- `<chat>.sqlite-shm`

Delete paths remove both sidecars. Rename and raw export operations must run while
holding the chat lock and use logical copying or a consistent SQLite snapshot.

## Application Locks And Multiple PM2 Processes

Native SQLite supplies file locking and transaction isolation. Aikobots also
retains `${chat}.sqlite.lock` directory locks because application mutations are
more than isolated SQL statements. They include revision checks, active-session
authorization, identity validation, header updates, and sometimes multiple row
changes that must share one application decision.

The directory lock:

- coordinates all PM2 instances using the same `DATA_ROOT`;
- serializes revisioned mutations for one logical chat;
- protects rename, delete, import, and raw export lifecycle operations;
- remains separate from SQLite's WAL reader/writer locking.

The shared `DATA_ROOT` must be on a filesystem with correct SQLite byte-range lock
and shared-memory semantics. A local Linux filesystem is the expected production
configuration. Network filesystems must not be assumed safe without explicit
SQLite WAL compatibility validation.

## Read Flow

Chunked reads use SQL range queries and parse only returned rows:

- `getChatHeader()` reads the header.
- `getMessageCount()` performs `COUNT(*)` over logical messages.
- `getLastMessage()` reads one tail row.
- `getMessageRange(offset, limit)` reads the requested logical window.
- `getLogicalMessageRowByUuid()` uses `idx_messages_message_uuid` and does not scan
  every message JSON object.

Read flows that combine a count, header, and one or more ranges use an explicit
read transaction so a concurrent WAL commit cannot mix two logical chat versions
inside one response or prompt assembly.

The browser still receives complete swipe data for each returned message. Chunking
is by logical message, not by swipe byte count.

Legacy JSONL reads still parse the JSONL file because JSONL has no query engine.
Production chats should be migrated to SQLite.

## Identity Validation

Old or partially migrated databases may require a complete message/swipe identity
scan. The result is recorded in:

```text
metadata.identity_scan_version = 1
```

Full normalized writes set this marker directly. Modern chats without the marker
are scanned once; ordinary chunk reads then skip the complete identity scan.
Mutation boundaries continue to validate the submitted message or range.

The marker is invalidated only by a future schema or identity algorithm migration.
Code that directly edits chat files outside Aikobots is unsupported and must not
expect automatic detection after the scan marker is set.

## Write And Mutation Flow

The endpoint layer retains the existing public behavior:

- full and loaded-range saves;
- UUID-targeted message edits;
- UUID-targeted message deletes;
- suffix truncation after a stable branch-point UUID, or explicit truncation of
  all logical messages while preserving the chat header;
- message append with expected-tail validation;
- message clone and fractional ordering;
- visibility and persona updates;
- group chat equivalents.

Mutations preserve this order:

1. Resolve and validate the chat path.
2. Acquire the application lock.
3. Check active-session authority when required.
4. Open the native database.
5. Read the persisted header and revision.
6. Validate identities, active swipe state, and request shape.
7. Begin a SQL transaction.
8. Update the revision header and affected rows.
9. Commit.
10. Close the connection and release the application lock.

`saveDb()` remains temporarily as a compatibility boundary for existing callers.
It no longer exports or writes the file; it only rejects a leaked open transaction.
New code should treat the SQL commit as the durability boundary.

## Ordering And Inserts

`order_index` remains `REAL`. Cloning between two messages uses their midpoint,
avoiding a full reindex for ordinary inserts. If floating-point precision cannot
represent a distinct midpoint, the existing reindex fallback remains available.

Logical message IDs exclude the header. Helpers that operate in physical row order
must continue to account for the header at position zero.

## JSONL Migration

JSONL migration is failure-atomic:

1. Create a temporary native SQLite database beside the destination.
2. Use rollback-journal mode for the temporary build.
3. Validate every JSONL record before insertion.
4. Insert all records in one transaction.
5. Run `PRAGMA integrity_check`.
6. Close the temporary database.
7. Rename it to the final `.sqlite` path.

On failure, the temporary file is removed and the legacy source remains untouched.
Split-tail JSONL remains unsupported.

## Backups And Exports

Normal mutations do not serialize the database.

JSONL backups continue to be logical backups produced from stored chat records.
Incremental mutations do not synchronously serialize JSONL, even when the loaded
range happens to cover the whole chat. Periodic append backups retain the existing
configured cadence. This policy is independent of SQLite's WAL durability.

A raw SQLite export is an explicit exceptional operation. It acquires the chat
lock, checkpoints committed WAL state, and serializes a consistent database image.
The whole database is read only because the user explicitly requested the whole
database file.

Never copy or export the main `.sqlite` file without accounting for active WAL
state.

## Rename And Delete

Chat lifecycle operations use canonical companion paths and the application lock.

- Delete removes `.jsonl`, `.sqlite`, `.sqlite-wal`, and `.sqlite-shm` companions.
- Rename normally reads logical records and writes a new native database while
  holding locks for both source and destination.
- Direct raw-file fallback copying is allowed only when no logical header exists
  and no connection can be writing the source.

## Security And Data Integrity

- Continue using `src/chat-paths.js` for every user-derived chat path.
- Preserve active-session and revision checks.
- Validate selected swipe text, index, metadata, and UUID consistency before save.
- Never log chat content, swipe text, prompt snapshots, or secure lorebook data.
- Do not place secure lorebook entries in SQLite diagnostics or thrown errors.
- Do not trust client-provided UUIDs, revisions, ranges, filenames, or storage
  metadata.
- Keep SQL values parameterized.

## Verification

Focused checks for storage changes:

```text
node --check src/sqlite-manager.js
node --check src/endpoints/chats.js
node --check src/chat-paths.js
node --check src/endpoints/groups.js
node --check migrate-sqlite.js
git diff --check
```

Storage regression coverage must include:

- opening and upgrading a pre-`20260711` database;
- UUID index backfill;
- bounded chunk reads;
- selected-swipe edits preserving sibling swipes;
- message deletion, suffix truncation, and truncate-all empty-chat handling;
- loaded-range writes preserving unseen messages;
- fractional clone insertion;
- raw export containing committed WAL state;
- JSONL migration cleanup after failure;
- `.sqlite-wal` and `.sqlite-shm` lifecycle cleanup.

## Superseded Architecture

The previous architecture loaded the full file into `sql.js`, mutated an in-memory
database, called `db.export()`, and atomically replaced the complete file. That
model is intentionally superseded. It must not be reintroduced as a fallback for
ordinary reads or saves.
