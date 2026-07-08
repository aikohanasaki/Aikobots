# SQLite Chat Architecture

This note documents the current SQLite chat implementation so future changes do not require rediscovering the storage model from scratch.

## Current Decision

Aikobots chat SQLite storage uses `sql.js`, not native SQLite connections.

Each `.sqlite` chat file is treated as a durable file format, while mutations happen in memory:

1. Load the full `.sqlite` file into an in-memory `SQL.Database`.
2. Apply reads/writes against that in-memory database.
3. Use SQL transactions for multi-row logical mutations.
4. Run `PRAGMA integrity_check` before persistence.
5. Export the full database with `db.export()`.
6. Persist via atomic whole-file replacement using `write-file-atomic`.

This preserves the historical whole-file chat persistence model while changing the on-disk format from JSONL to SQLite.

## Key Files

- `src/sqlite-manager.js`: low-level SQLite lifecycle, schema creation, JSONL migration, message range reads, range writes, reindexing, metadata helpers, and clone insertion ordering.
- `src/endpoints/chats.js`: HTTP-level chat behavior, validation, revision checks, active-session checks, save locking, imports, exports, backups, group chat adaptation, chunked reads, STMB range resolution, and mutation endpoints.
- `src/chat-paths.js`: storage path validation, extension normalization, `.sqlite` defaulting, legacy `.jsonl` acceptance, companion path resolution, and path traversal defenses.
- `migrate-sqlite.js`: one-shot legacy JSONL to SQLite migration with integrity verification and split-tail refusal.
- `src/__tests__/chat-storage.test.js`: SQLite behavior coverage for chunking, STMB sparse range reads, loaded-range writes, fractional insert ordering, clone behavior, dotted names, and split-tail rejection.
- `src/__tests__/chat-paths.test.js`: path validation and storage extension coverage.

## Storage Format

New chat paths default to `.sqlite`. Legacy `.jsonl` paths are still accepted at boundaries so old clients, imports, and references can be resolved, then converted to the SQLite companion path where appropriate.

The SQLite schema is created in `createDatabase()`:

```sql
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_index REAL,
    content TEXT
);

CREATE INDEX idx_messages_order_index ON messages(order_index);
```

`metadata.storage_version` is currently set to `20260530`.

`messages.content` stores one JSON string per logical chat record. The first record is always the chat header.

## Logical Message Model

There are two index spaces:

- SQLite row ordering includes the header at `order_index = 0`.
- Public/logical message IDs exclude the header. Logical message `0` is stored after the header.

That means helper calls intentionally offset by one in write paths:

- `getMessageRange(db, offset, limit)` reads logical messages only, with `WHERE order_index > 0`.
- `getMessageCount(db)` counts logical messages only, with `WHERE order_index > 0`.
- `writeLogicalChat(..., { messageStartId })` calls `updateMessages(db, messages, messageStartId + 1)` because `updateMessages()` works in SQLite row order including the header.
- Header updates use row/order index `0`.

Do not mix logical message IDs with SQLite row offsets without checking whether the helper includes or excludes the header.

## Read Flow

The main read adapter is `getChatSegments(filePath)` in `src/endpoints/chats.js`.

For SQLite files:

- It resolves the `.sqlite` companion path with `replaceChatStorageExtension()`.
- Metadata-only reads load only the header, logical message count, and last logical message.
- Full reads load all rows through `getMessages(db)` and return `header = messages[0]`, `messages = messages.slice(1)`.

For legacy JSONL files:

- It reads newline-delimited JSON objects with `readJsonlObjects()`.
- It rejects legacy split-tail storage through `assertSupportedChatStorage()`.
- It treats the first record as the header and the rest as logical messages.

Reads use chunk loading and do not require hydrating the full chat into memory; only saves load/export the complete file. Chunked chat reads use `buildChunkedChatPayload()`:

- SQLite reads fetch only the requested logical range with `getMessageRange()`.
- Non-SQLite legacy reads slice the already-loaded JSONL array.
- `displayCount` is clamped by `normalizeLongChatConfig()`.
- Returned range metadata is absolute logical message metadata: `loadedRangeStart`, `loadedRangeEnd`, `tailStartId`, `tailEndId`, `headCount`, and `tailCount`.

STMB uses `resolveSqliteLogicalChatReference()` when it needs SQLite-native behavior. It intentionally does not fall back to JSONL if the `.sqlite` file is missing, and can populate only a requested range into sparse logical message positions.

## Write Flow

The central write helper is `writeLogicalChat(filePath, header, messages, options)`.

It:

1. Rejects the old `startIndex` option. Callers must use `messageStartId`, which is a zero-based logical message id excluding the header.
2. Sanitizes the header and messages before persistence.
3. Normalizes or regenerates Aikobots message identities.
4. Resolves the `.sqlite` companion path.
5. Loads or creates the database.
6. Performs either:
   - a full rewrite with `setMessages(db, [header, ...messages])`, or
   - a targeted logical message update with `updateMessages(db, messages, messageStartId + 1)`.
7. Runs `saveDb()`, which performs SQLite integrity checking and atomic whole-file replacement.
8. Returns range metadata and a JSONL backup payload only for full saves.

Important implications:

- Incremental and partial range saves do not return `fullJsonl`, so chat backups are skipped for those writes.
- Complete loaded-range saves for SQLite chats serialize the stored logical chat after the database write and can create a JSONL backup without using ordinary full replacement.
- SQLite message appends create a periodic full JSONL backup every `backups.chat.sqliteAppendBackupMessageInterval` messages by default, subject to the existing backup throttle.
- `updateMessages()` may update existing rows or append when the start index is exactly the current row count.
- `updateMessages()` rejects gaps and overlong ranges to avoid sparse/corrupt row sequences.

## Mutations

Most mutation endpoints live in `src/endpoints/chats.js` and should continue to reuse the existing helpers.

Key mutation paths:

- `/save`: full or loaded-range direct chat saves. `save_mode = tail` is rejected. Full saves require hydrated chat data unless `save_mode = loaded_range`.
- `/group/save`: group equivalent of direct saves, with group header wrapping.
- `/message-visibility`: currently loads the logical chat, mutates visibility, and rewrites through `writeLogicalChat()`.
- `/sync-user-persona`: updates matching user persona messages directly in SQLite rows and saves the database.
- `/message/clone`: requires SQLite, clones a logical message after the source, assigns new identities, strips prompt snapshot keys from affected messages, remaps timed-world-info checkpoints, updates the revision header, and returns a window around the inserted clone.
- `/rename`: rewrites the target through `writeLogicalChat()` when logical records are available, then removes old `.jsonl` and `.sqlite` companions.
- `/delete` and `/group/delete`: remove both `.jsonl` and `.sqlite` companions.
- `/export`: supports raw SQLite export as base64 and logical JSONL/text exports from the current logical chat view.
- `/import` and `/group/import`: normalize supported imports and persist new chats through `writeLogicalChat()` or `writeGroupChat()`.

## Ordering And Inserts

`messages.order_index` is `REAL` so `insertLogicalMessageAfter()` can insert between two existing logical messages without immediately rewriting every row.

Insert behavior:

- Find the source logical row with `getLogicalMessageRow(db, messageId)`.
- Find the next logical row.
- Use the midpoint between `source.orderIndex` and `next.orderIndex`, or append at `source.orderIndex + 1`.
- If the midpoint is not finite or collides due to precision limits, reindex with `setMessagesWithoutTransaction(db, getMessages(db))` and retry.

Loaded-range updates remain position-based after fractional inserts because `updateMessages()` selects target rows by ordered row position, not by raw `order_index` value.

## Concurrency And Revisions

Writes are coordinated by application-level lock files, not SQLite WAL or native SQLite file locks.

`withChatSaveLock(filePath, callback)`:

- Creates `${filePath}.lock` with exclusive `wx` open.
- Retries every `25ms`.
- Times out after `10s`.
- Removes stale locks older than `10 minutes`.
- Always closes and removes the lock in `finally`.

Revision conflict detection is separate:

- `chat_revision` lives in the chat header.
- `base_revision` from the request is compared against the persisted header.
- A stale revision returns `409`.
- `last_save_session_id` is preserved when the request provides a valid UUID save session.

Active-session checks remain endpoint-level and must not be bypassed for mutations that currently require them.

## Journal Mode / WAL

We do not use WAL mode.

There is no configured `PRAGMA journal_mode`, no `journal_mode=WAL`, no checkpoint management, and no expected `-wal` or `-shm` sidecar files for chat storage.

This is intentional for the current architecture because `sql.js` does not operate as a long-lived native SQLite file connection. The app owns durability by exporting the complete database image and atomically replacing the chat file.

Application-level save locking remains the concurrency boundary for writes. SQLite native file-locking and WAL semantics are not relied on for coordinating concurrent writers.

This keeps the current deployment model simple: each chat save produces one complete `.sqlite` file, without sidecar journal files that would need coordinated lifecycle handling across multiple instances sharing `DATA_ROOT`.

## Path And Format Boundaries

All chat file paths should be resolved through `src/chat-paths.js`.

Current rules:

- `.sqlite` and `.jsonl` are supported chat storage extensions.
- Missing extensions default to `.sqlite`.
- Extension normalization is case-insensitive.
- Known unsafe/non-chat extensions such as `.db`, `.sqlite3`, `.sqlite-wal`, `.sqlite-shm`, `.json`, `.txt`, `.bak`, `.tmp`, and `.log` are rejected.
- `*.head.jsonl` split-head files are rejected.
- Path traversal, absolute paths, URL-encoded traversal, NULs, slash/backslash separators, drive-letter paths, and empty logical names are rejected.
- Deduplicated chat listings prefer `.sqlite` over legacy `.jsonl` for the same logical chat name.

Do not build chat paths manually in new code.

## Legacy JSONL And Split-Tail

Legacy JSONL is still a compatibility input, but split-tail storage is intentionally unsupported.

Supported JSONL paths:

- legacy reads where no SQLite companion exists,
- imports from complete JSONL exports,
- JSONL exports generated from SQLite logical records,
- backups from full saves.

Rejected JSONL paths:

- headers with `chat_storage.mode === 'split-tail'`,
- split-head files such as `*.head.jsonl`,
- partial split-tail migration inputs.

`migrate-sqlite.js` refuses partial split-tail JSONL, writes SQLite through `migrateFromJsonl()`, verifies `PRAGMA integrity_check`, and only then removes legacy JSONL sources.

## Backups And Exports

Backups remain JSONL files in the backup directory.

Full saves produce a serialized JSONL payload and can be backed up. Complete loaded-range saves for SQLite chats can also be backed up by serializing the stored logical chat after the database write. SQLite appends also create periodic JSONL backups when the post-append message count is divisible by `backups.chat.sqliteAppendBackupMessageInterval`, default `2`; set it to `0` to disable that cadence. Incremental updates and partial range saves avoid loading the entire chat and return `fullJsonl: null`, so backup creation is skipped for those writes.

Exports are format-specific:

- `format = sqlite`: reads the `.sqlite` file and returns base64 with `is_binary: true`.
- `format = jsonl`: serializes logical chat data, optionally stripping Aikobots identity metadata.
- other formats: serialize visible logical messages to text.

## Group Chats

Group chats share the same SQLite storage primitives but use a synthetic group header:

- `is_group_chat_header: true`
- `group_chat_header_version`
- `chat_metadata`

Legacy group chats without headers are wrapped by `ensureGroupChatHeader()`, which can use legacy group metadata if available. Group chunked reads use `buildChunkedGroupChatPayload()`.

## Security Notes

Chat content may contain sensitive secure lorebook data. Architecture or debugging changes must not log message content, secure entry data, full JSONL payloads, or raw SQLite row contents.

Security boundaries to preserve:

- Use `chat-paths.js` for path validation.
- Keep active-session checks for write endpoints that currently require them.
- Keep revision checks before mutating persisted chats.
- Keep integrity checks before `saveDb()` persistence.
- Keep import rejection for split-tail partial files.
- Do not trust client-provided filenames, paths, message IDs, revisions, or format names.

## Regression Map

Relevant focused checks:

- `node --check src/sqlite-manager.js`
- `node --check src/endpoints/chats.js`
- `node --check src/chat-paths.js`
- `npm test -- src/__tests__/chat-storage.test.js`
- `npm test -- src/__tests__/chat-paths.test.js`
- `git diff --check`

Existing tests cover:

- default `.sqlite` path normalization and legacy `.jsonl` acceptance,
- dotted chat names without accidental `.sqlite.sqlite` paths,
- unsupported extension and path traversal rejection,
- split-head and split-tail rejection,
- chunked SQLite range reads,
- STMB sparse range reads and missing-SQLite reporting,
- loaded-range saves preserving unseen messages,
- position-based range updates after fractional inserts,
- clone insertion identity regeneration and prompt snapshot invalidation.

## Revisit Criteria

Reconsider native SQLite and WAL only if we intentionally move from whole-file `sql.js` persistence to long-lived native database connections, and after designing:

- multi-instance writer coordination,
- WAL/checkpoint policy,
- backup/export behavior,
- rename/delete handling for sidecar files,
- crash recovery expectations,
- deployment behavior on shared `DATA_ROOT`.
