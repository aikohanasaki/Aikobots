# Native SQLite Chat Architecture

This document records Aikobots’ native SQLite storage decisions, the current transitional mutation model, and the target mutation contract.

`AGENTS.md` is the governing project directive. This file must not be treated as proof that every current mutation path already satisfies the target architecture. Claims in this document must remain consistent with verified code and tests.

## Architectural Status

Aikobots has completed the storage-engine transition from `sql.js` whole-file persistence to native SQLite through `better-sqlite3`.

Ordinary reads and writes now operate directly against SQLite:

1. Resolve and validate the target chat path.
2. Acquire any required application-level coordination.
3. Open the target `.sqlite` file.
4. Execute bounded reads or one transaction containing the complete requested mutation.
5. Commit through SQLite.
6. Close the connection.
7. Release application-level coordination.

Ordinary saves must not load the entire database image, call `db.export()`, or replace the complete `.sqlite` file. Full serialization is reserved for explicit raw SQLite export.

The mutation architecture is not yet considered fully resolved.

Some existing routes may still retain legacy client-authoritative behavior, including:

- full-chat saves;
- loaded-range saves;
- reconciliation based on submitted positions;
- swipe operations based on mutable array indexes;
- compatibility helpers that replace broad portions of chat state;
- destructive helpers whose call sites require audit;
- revision checks performed outside the mutation transaction.

These paths are transitional unless they are explicitly restricted to creation, import, restore, migration, administrative repair, or intentional clear-all behavior.

The target state is one authoritative explicit-mutation model based on stable identities, server-controlled revisions, one transaction per semantic operation, idempotent retries, and defined conflict behavior.

## Project Priorities

Storage work must prioritize:

1. Preventing exposure of secure lorebook content through storage, logs, diagnostics, errors, or tests.
2. Preventing accidental loss, duplication, replacement, or corruption of existing chats and messages.
3. Preserving edits and new-message creation.
4. Improving long-chat reliability and speed through bounded reads and incremental mutations.
5. Keeping changes targeted and reviewable without preserving an incorrect architecture merely to minimize code changes.

## Resolved Native SQLite Decisions

- Driver: `better-sqlite3` 12.x.
- Runtime floor: Node.js 20.
- Connection lifetime: short-lived, normally one connection per storage operation.
- Journal mode: WAL.
- Durability: `synchronous = FULL`.
- SQLite lock wait: `busy_timeout = 10000`.
- Automatic WAL checkpoint threshold: 1,000 pages.
- Foreign keys enabled.
- Existing `.sqlite` files are upgraded in place.
- Existing `.jsonl` chats remain supported as migration or import inputs.
- Ordinary reads are bounded SQL reads.
- Ordinary writes use native transactions.
- Ordinary saves do not serialize or replace the complete database file.

Short-lived connections are intentional. Aikobots may have many chat databases, and files can be renamed or deleted. A global connection cache would retain file handles and complicate safe rename, delete, export, and WAL-sidecar handling.

Every native connection applies:

```sql
PRAGMA busy_timeout = 10000;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA wal_autocheckpoint = 1000;
```

These settings must be verified under the production deployment model. They do not replace correct transaction boundaries, revision handling, or mutation semantics.

Production uses multiple PM2 workers sharing one local `DATA_ROOT`. The filesystem must support SQLite byte-range locking and shared-memory behavior correctly. Network filesystems must not be assumed safe for WAL without explicit validation.

## Key Files

- `src/sqlite-manager.js`: native connection configuration, schema upgrades, JSONL migration, bounded reads, UUID lookup, transactions, and raw export.
- `src/chat-storage.js`: canonical companion paths, cross-process locks, lifecycle cleanup, and storage snapshots.
- `src/endpoints/chats.js`: path validation, authorization, revisions, active sessions, mutations, compatibility routes, imports, restores, repairs, and exports.
- `src/chat-paths.js`: canonical `.sqlite`, `.jsonl`, `.sqlite-wal`, `.sqlite-shm`, and lock paths.
- `migrate-sqlite.js`: one-shot migration and integrity validation.
- Storage and endpoint tests: engine, mutation, migration, and multi-worker regression coverage.

Any other route, extension integration, background task, or helper capable of mutating chat storage is part of this architecture and must satisfy the same invariants.

## Current Storage Schema

The current documented storage version is:

```text
20260711
```

The current base schema is:

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

The first ordered row is the chat header. Logical messages follow it.

`messages.content` remains the compatibility JSON representation of the complete record, including embedded swipe data.

`messages.message_uuid` mirrors the durable message UUID stored in the JSON object and permits indexed lookup.

This schema describes the current baseline. It does not yet enforce every target identity constraint.

### Recent-chat activity

SQLite chat metadata may contain `last_activity_at`, an epoch-millisecond timestamp used only to compile and order the welcome screen's Recent Chats list. It records the most recent successful committed change to the canonical message sequence or state.

Qualifying changes are message append, insert, edit, reorder, delete, truncate, clone, persisted swipe creation/edit/deletion/selection, and message visibility changes. Imports use import time. A copied, duplicated, or branched target uses its creation time without changing the source. A newly created empty chat receives no activity timestamp until its first message is persisted.

An empty SQLite chat may display a locally generated pristine greeting and its alternate swipes before roleplay starts. Navigating those existing greeting swipes remains client-local and does not create chat activity. Immediately before the first real message is appended, the client appends the selected greeting through the revision-checked SQLite message mutation; later messages then use the normal tail-checked append path. The client retains the server-reported SQLite storage mode while this local greeting is displayed and does not fall back to an ordinary full-chat replacement.

Chat rename, chat-header metadata, persona or participant-history synchronization, group membership/configuration, opening a chat, pin changes, export, backup, migration, repair, compaction, and other maintenance do not update this value. Failed, rolled-back, no-op, and idempotently replayed mutations do not update it.

### Ordinary swipe text edits

An ordinary swipe text edit is addressed by the message UUID and the client-captured selected swipe UUID. While the compatibility request still carries the complete message record, the server rejects selected-swipe replacement, swipe reordering, and changes to persisted sibling swipe text or metadata. Sibling comparisons use the canonical persistence form so runtime-only fields that storage intentionally removes do not create false conflicts.

### Interrupted overswipe repair

Generating a new swipe past the right edge uses an in-memory pending target that is separate from the canonical message `swipe_id`. The client allocates the new swipe's UUID when it captures that target, then materializes the `swipes` and `swipe_info` slot with that exact UUID before changing the canonical index. Later streaming and save steps require the same UUID to still own the slot and reject the generation if either the slot identity or selected swipe changed. Saves therefore cannot persist a one-past-the-end generation sentinel or apply generated content to a different swipe that occupied the same array index.

Modern SQLite chats receive a one-time `swipe_state_scan_version` maintenance scan on load. The scan repairs only the exact legacy overswipe shape where `swipe_id === swipes.length`, the swipe list is non-empty, and selecting the final materialized swipe makes the entire message pass active-swipe validation. Other out-of-bounds or contradictory states are left unchanged for explicit diagnosis. A successful repair preserves the chat revision and activity timestamp and requires the client to reload the repaired chat before writing.

Chat-header metadata changes use a dedicated revision-checked SQLite mutation for direct and group chats. The mutation replaces the sanitized `chat_metadata` object atomically, records an operation receipt, and does not read, validate, or rewrite message rows. This allows metadata such as chat-bound lorebooks to persist for empty chats and independently of message-range state.

Direct and group SQLite chats also expose a dedicated revision-checked message insertion mutation. The client supplies the new message and its absolute logical position. Under the existing chat-save lock, the server rejects out-of-range positions and reused UUIDs, then atomically inserts the row, repairs positional metadata in the shifted suffix, advances the chat revision and activity time, and records the operation receipt. Slash commands that use `at=` call this mutation instead of submitting a loaded-range replacement.

Pinned and unpinned chats form separate display tiers; each tier sorts by `last_activity_at` descending. Legacy chats without the metadata value use their last persisted message timestamp without writing a migration value or consulting filesystem modification time. Chats with neither value are omitted until qualifying activity occurs.

## Message Identity

Every logical message has two conceptually different identifiers:

```text
db_message_id
message_uuid
```

In the current schema:

```text
db_message_id = messages.id
```

`db_message_id` is internal database identity.

`message_uuid` is the durable identity used by clients and mutation APIs.

A message must not be externally identified primarily by:

- `order_index`;
- array position;
- DOM `mesid`;
- loaded-range position;
- message content;
- timestamp;
- database row ID alone.

The client must create `message_uuid` before the first persistence request involving a new message. Rerendering, hydration, retry, move, or reordering must not create a new UUID for the same logical message.

The indexed database column is the authoritative mutation target. The UUID inside `content` is a compatibility mirror. Manager-owned writes must keep them synchronized. A mismatch is an invalid state that must be detected rather than silently resolved.

The final schema must enforce UUID uniqueness within the intended scope after existing data is audited and repaired. A likely staged form is a partial unique index excluding the header or other legitimate null values:

```sql
CREATE UNIQUE INDEX ... ON messages(message_uuid)
WHERE message_uuid IS NOT NULL;
```

Do not add this constraint blindly if existing chats contain duplicate, malformed, or missing identities.

## Swipe Identity

Storing all swipes inside one message row makes a row update atomic, but it does not by itself provide stable swipe identity. A transaction can still atomically edit or select the wrong swipe if the target is only a mutable array index.

Independent swipe operations require durable `swipe_uuid` values where the client can:

- create a swipe;
- select a swipe;
- edit a swipe;
- delete a swipe;
- reorder swipes;
- retry swipe creation;
- regenerate while preserving history.

The client must create a swipe UUID before persistence when later operations may refer to that swipe.

Runtime replacements of embedded swipe metadata, including per-token streaming updates, must preserve the slot's existing valid swipe UUID. A legacy slot without a valid UUID may receive one during replacement, but replacing timestamps or `extra` metadata must not change an established identity.

Use the smallest safe representation.

### Embedded swipe UUIDs

Keep swipes embedded in `messages.content` if that representation can safely support:

- one durable UUID per swipe;
- UUID-based selection, edit, delete, and reordering;
- preservation of swipe metadata;
- conflict detection;
- idempotent retries;
- deterministic migration.

### Normalized swipe table

Introduce a swipe table only if embedded swipe data cannot establish those invariants without broad ambiguous replacement.

Possible conceptual fields include:

```text
messages:
- db_message_id
- message_uuid
- order_index
- current_swipe_uuid
- row_version
- created_at
- updated_at
- last_updated_device_id

swipes:
- db_swipe_id
- db_message_id
- swipe_uuid
- swipe_index
- content
- metadata
- row_version
- created_at
- updated_at
- last_updated_device_id
```

Normalization must be justified by actual supported operations, not theoretical preference.

## Ordering

`order_index` remains ordering data and may remain `REAL`.

It must not serve as durable message identity.

Moving, inserting, deleting, cloning, or reindexing messages must preserve unaffected message and swipe UUIDs.

Fractional insertion may use the midpoint between adjacent order values. If precision no longer permits a distinct midpoint, reindexing must occur atomically and change only ordering information unless another change is explicitly required.

Helpers using physical row order must account for the header without exposing the header offset as logical identity.

## Read Flow

Normal reads use bounded SQL operations, including:

- reading the header;
- reading the revision;
- counting logical messages;
- reading the tail;
- reading a range;
- locating a message by UUID;
- reading only rows required by a mutation.

A logical response composed from multiple queries must use a read transaction when needed so it cannot combine values from different committed revisions.

The browser may continue to receive complete swipe data for each returned message. Chunking remains by logical message unless measured evidence justifies a separate swipe-loading design.

Legacy JSONL reads still require parsing. JSONL is a migration or import source, not a second indefinitely writable authoritative format.

## Target Mutation Contract

Existing-chat changes must become explicit semantic operations, for example:

```text
create message
append message
insert message
edit message UUID X
delete message UUID X
truncate after message UUID X
truncate all messages
add swipe UUID Y to message UUID X
select swipe UUID Y on message UUID X
edit swipe UUID Y
delete swipe UUID Y
reorder swipes
move message UUID X before UUID Y
copy message UUID X
rename chat
duplicate chat
import chat
restore chat
migrate chat
```

A routine mutation request should contain only:

- the intended operation;
- stable target identity;
- changed data;
- `base_revision`;
- `operation_uuid`;
- `device_id`;
- operation-specific preconditions.

The client must not resend a complete chat or broad loaded range merely to identify one changed entity.

## Server-Authoritative Revision

Every existing chat must have an integer revision.

Every ordinary mutation request must include:

```text
base_revision
```

The mutation must:

1. Begin the write transaction.
2. Read the persisted revision inside the transaction.
3. Compare it with `base_revision`.
4. Reject the operation if stale.
5. Perform the complete semantic mutation.
6. Increment the chat revision exactly once.
7. Record the resulting revision.
8. Record the successful operation UUID.
9. Commit.

Revision validation, mutation, revision increment, and operation recording must share one transaction.

Do not:

- validate revision only before the transaction;
- increment revision before all mutation work succeeds;
- update data and revision in separate transactions;
- use client timestamps as authoritative conflict order;
- silently apply last-write-wins behavior.

## One Semantic Operation, One Transaction

One user-visible action must commit atomically.

Examples include:

- editing or deleting a message;
- truncating after a message;
- adding and selecting a swipe;
- deleting a selected swipe and choosing the new selection;
- regenerating a response;
- moving or copying a message;
- importing or restoring a chat;
- renaming a chat when multiple records or files are affected.

If any required statement fails, the entire semantic operation must roll back.

A transaction does not make a logically incorrect replacement safe. Routine mutations must not be implemented by transactionally deleting and rebuilding the complete chat.

## Idempotent Retries

Every logical mutation attempt must include:

```text
operation_id
```

The client reuses the same operation UUID when retrying the same logical request.

Inside the transaction, the server must:

1. Check whether the operation UUID already committed.
2. If so, verify the replay matches the original operation.
3. Return the recorded result or another safe idempotent response.
4. Otherwise perform the mutation.
5. Record the operation type, target, resulting revision, and safe response data.
6. Commit.

The operation must not be recorded as successful before the mutation commits.

Reusing one operation UUID with a materially different payload must be rejected.

The operation log must have a bounded retention policy sufficient for realistic retry and reconnect windows.

SQLite chats persist the newest 4096 operation receipts in `operation_receipts`. Each receipt contains only a request fingerprint and safe acknowledgement data; chat or secure lore content is not copied into the receipt. Receipt insertion occurs in the same transaction as the chat mutation.

## Device Identity and Time

Clients may provide a random installation-scoped:

```text
device_id
```

This must not be hardware fingerprinting.

A successful mutation may record:

```text
last_updated_device_id
```

Device identity is diagnostic. It does not decide whose write wins.

Server-generated timestamps are authoritative for storage events such as:

```text
created_at
updated_at
committed_at
```

Existing client timestamps may be preserved separately when they represent composition, generation, or imported history.

Client clocks must not determine ordering or conflict resolution.

The design must remain correct when:

- a device clock is wrong;
- a clock moves backward or forward;
- a suspended device submits an old request;
- requests arrive out of creation order;
- two devices begin from the same revision.

## Conflicts and API Responses

A stale revision must return an explicit conflict response containing safe metadata such as:

- submitted base revision;
- current server revision;
- operation type;
- confirmation that the operation was not applied;
- whether the client must reload or reconcile.

A successful mutation response must provide enough authoritative state for the client to update without reconstructing the result from assumptions. Depending on the operation, this may include:

- operation UUID;
- resulting revision;
- changed message UUID;
- changed swipe UUID;
- normalized changed entity;
- authoritative selected swipe UUID;
- ordering information;
- deleted UUIDs;
- server timestamps;
- idempotent replay status.

Success must not be returned before commit.

## Transitional Compatibility Paths

The current code may still contain:

- full-chat saves;
- loaded-range saves;
- compatibility save helpers;
- UUID-targeted mutations;
- append and truncate helpers;
- clone or move behavior;
- group-chat variants;
- repair and migration routes.

Every path must be inventoried and classified as:

- temporarily required by an active caller;
- required only for creation, import, restore, migration, or repair;
- unused;
- immediately replaceable;
- unsafe and requiring disablement.

Full-chat, loaded-range, and explicit CRUD must not remain equally authoritative mutation systems.

The target is one explicit mutation model plus narrowly isolated replacement operations.

## Full Replacement and Destructive Helpers

A helper that deletes or replaces all logical messages is not inherently wrong. Its call sites determine whether it is safe.

Full replacement may be valid for:

- new chat creation;
- import;
- restore;
- migration;
- administrator repair;
- explicit clear-all;
- explicit truncate-all.

`/api/chats/save-prefix` is creation-only. It rejects an existing target and a
source/target path collision; it is not an implicit restore or replacement path.

Migration cleanup retires JSONL only after SQLite integrity succeeds and every
ordered structured record (header plus all messages and embedded swipe state)
matches. Legacy split-storage bookkeeping is removed from the recombined header;
no other metadata difference is ignored. Verification failures retain JSONL and
report only a safe mismatch category.

It must not implement ordinary:

- edit;
- swipe selection or editing;
- regeneration;
- single-message deletion;
- truncation after one message;
- stale-client reconciliation;
- autosave;
- routine persistence.

An empty array, missing UUID, omitted range, absent unloaded message, or partially hydrated payload must never silently mean “delete everything.”

### Truncate after UUID

This operation must:

- validate the target UUID;
- preserve the target when that is the defined behavior;
- delete only later messages and dependent data;
- preserve earlier UUIDs;
- update ordering only where necessary;
- increment revision atomically;
- return authoritative deleted identities.

### Truncate all

This operation must:

- require explicit destructive intent such as `truncate_all: true`;
- never infer intent from a missing UUID;
- preserve required header and metadata;
- delete all logical messages and dependent data atomically;
- increment revision atomically;
- return authoritative empty-chat state.

These are separate semantic operations and must not be overloaded ambiguously.

## Loaded-Range and Full-Chat Compatibility

While a compatibility path remains, it must:

- require `base_revision`;
- require active-session validation where applicable;
- reject sparse or ambiguous ranges;
- reject ranges beyond the server tail unless append is explicit;
- verify submitted UUIDs against the authoritative range;
- reject partially hydrated full replacement;
- never infer deletion from unloaded messages;
- preserve unseen authoritative state;
- log safe operation metadata for migration tracking;
- identify its active caller and removal criteria.

Compatibility tests may prove that loaded-range writes preserve unseen data. They must be labeled transitional and must not imply that loaded-range save is part of the final architecture.

## Application Locks and PM2

Native SQLite supplies locking and transaction isolation.

Aikobots also uses per-chat application lock directories.

Application locks remain clearly justified for lifecycle operations involving the database and companion files, including:

- rename;
- delete;
- import replacement;
- restore;
- migration;
- raw export;
- sidecar cleanup.

The need for application locks around ordinary row mutations must be verified rather than assumed.

A mutation lock may remain justified when correctness depends on state outside the SQLite transaction, such as external active-session state or coordinated filesystem work.

However:

- revision validation belongs inside the transaction;
- row mutations belong inside the transaction;
- revision increment belongs inside the transaction;
- operation-idempotency recording belongs inside the transaction.

An application lock must not compensate for missing transaction boundaries.

If ordinary mutation locks remain, tests must verify:

- coordination across PM2 workers;
- timeout and stale-lock recovery;
- cleanup after worker failure;
- no route bypass;
- no conflict with SQLite busy handling;
- no serialization across unrelated chats.

A deterministic single-process bug must not be blamed on PM2. Fixing that bug does not prove multi-worker safety.

## Existing Database Upgrade

Opening an older database may:

1. Verify the `messages` table.
2. Add `message_uuid` if absent.
3. Create the lookup index.
4. Backfill lookup values from message JSON.
5. Update `metadata.storage_version`.

Upgrade steps must run inside an appropriate transaction and recheck schema state after acquiring the writer lock so concurrent workers cannot perform incompatible changes.

A resumable upgrade is not a complete recovery plan.

Every schema or identity migration must define:

- source and schema detection;
- backup policy;
- handling of duplicate, malformed, or missing identities;
- logical before-and-after validation;
- completion marking;
- failure cleanup;
- restoration procedure;
- compatibility with application rollback.

An identity-scan marker may record successful completion of a specific scan algorithm. It must be invalidated by future schema or identity changes and must not conceal interrupted or failed repair.

## JSONL Migration

JSONL migration is an explicit replacement operation.

A failure-atomic migration should:

1. Identify and validate the source format.
2. Check schema version.
3. Preserve the source according to backup policy.
4. Build a temporary native SQLite database beside the destination.
5. Validate every source record.
6. Preserve or assign message UUIDs.
7. Preserve or assign swipe UUIDs where required.
8. Preserve order, selected swipe, and documented timestamps.
9. Insert in one transaction.
10. Run `PRAGMA integrity_check`.
11. Compare the logical chat before and after migration.
12. Close the temporary database.
13. Rename it into place atomically where supported.
14. Mark migration complete only after validation.

On failure, the source must remain recoverable and the incomplete target must not become authoritative.

Split-tail JSONL remains unsupported unless separately designed and tested.

## Backups and Raw Export

Normal mutations do not synchronously serialize the full chat to JSONL.

Logical backups may continue on the configured schedule and must preserve enough information to restore:

- header;
- message order;
- message UUIDs;
- swipe identities;
- selected swipe;
- relevant metadata;
- format or schema version.

Raw SQLite export is explicit and exceptional.

It must produce a consistent snapshot containing committed WAL state. Never copy only the main `.sqlite` file while committed changes may remain in `.sqlite-wal`.

Export should use SQLite-supported backup or snapshot behavior where possible and must coordinate with required lifecycle locks.

## Rename and Delete

Lifecycle operations use canonical validated paths and required locks.

Delete must account for:

- `.jsonl`;
- `.sqlite`;
- `.sqlite-wal`;
- `.sqlite-shm`;
- lock and temporary companions where applicable.

The start-new-chat flow's optional deletion creates a non-throttled logical JSONL recovery backup while holding the chat lifecycle lock. If that backup cannot be created, deletion fails closed and leaves the authoritative chat intact. Ordinary standalone deletion retains its existing configured-backup behavior.

Rename must not ignore active WAL state. Source and destination coordination must prevent concurrent mutation or path collision.

Raw-file fallback behavior must be restricted to explicitly verified conditions in which no writer is active and no committed sidecar state is omitted.

## Security and Diagnostics

Storage code must:

- use canonical validated chat paths;
- preserve authorization and active-session checks;
- validate UUIDs, revisions, ranges, filenames, and storage metadata;
- use parameterized SQL;
- fail closed when destructive intent is ambiguous;
- distinguish malformed input from a stale conflict.

Do not log:

- message text;
- swipe text;
- prompt content;
- secure lorebook entries;
- private chat content.

Timing instrumentation may capture:

```text
request received
validation complete
application lock requested
application lock acquired
transaction requested
transaction started
database wait duration
mutation complete
transaction committed
response sent
```

Safe diagnostic fields may include:

- internal or anonymized chat reference;
- operation type;
- operation UUID;
- worker ID;
- base and resulting revisions;
- duration;
- conflict or rollback outcome;
- safe device metadata.

Performance conclusions must be based on measurements rather than assumptions about disk, network, or SQLite contention.

## Client Contract

The browser must:

- create stable message and swipe UUIDs before persistence where required;
- preserve identity through rendering and hydration;
- avoid treating DOM position or array index as durable identity;
- reuse the entity UUID when retrying persistence of the same entity;
- reuse the operation UUID for retry of the same logical mutation;
- create a new operation UUID for a genuinely new mutation;
- send the current known base revision;
- update its revision from the authoritative response;
- serialize active-chat revision changes through one acknowledgement-gated queue;
- assign the latest acknowledged base revision only when an operation reaches the head of that queue;
- keep a debounced save flush as one immutable operation envelope;
- pause later operations while the head operation has no acknowledgement;
- retry transport failures and retryable HTTP responses with the same operation UUID and identical request body;
- handle conflicts explicitly;
- never represent partially hydrated state as complete authoritative state.

Automatic last-write-wins behavior requires an explicit product decision and dedicated tests.

A successful no-op acknowledgement may retain the submitted base revision. A successful mutation acknowledgement advances it by exactly one. Any other successful revision response is invalid and must not release the next queued operation.

Direct background chat saves may coalesce for up to two seconds. A user-visible generation is an explicit persistence barrier: the client cancels any remaining coalescing delay, starts the already queued shared save runner, and awaits its acknowledgement before changing the generation target or submitting a provider request. Generated swipes cross that barrier before entering swipe mutation state, and group regeneration crosses it before deleting the prior generated replies. This promotion changes only when the existing save starts; it does not create another dirty save, revision envelope, or transaction.

## Verification

Use package scripts directly. Do not use `npx`, `bunx`, or equivalent wrappers.

Focused static checks may include:

```text
node --check src/sqlite-manager.js
node --check src/endpoints/chats.js
node --check src/chat-paths.js
node --check src/endpoints/groups.js
node --check migrate-sqlite.js
git diff --check
```

Tests must cover the semantic operation, not only isolated SQL helpers.

Required categories include:

### Storage

- pre-current database upgrade;
- UUID backfill;
- bounded reads;
- coherent multi-query reads;
- raw export with committed WAL state;
- WAL and SHM cleanup;
- interrupted migration or upgrade recovery;
- rename and delete lifecycle safety.

### Messages

- create with client UUID;
- duplicate operation retry;
- duplicate entity UUID under a different operation;
- append and insert;
- edit and delete by UUID;
- truncate after UUID;
- explicit truncate-all;
- move, reorder, and clone;
- preservation of unaffected UUIDs, content, and order.

### Swipes

- create with client UUID;
- add and select by UUID;
- edit and delete by UUID;
- delete selected and non-selected swipes;
- deterministic selection after deletion;
- reorder;
- regeneration preserving history;
- prevention of cross-message effects;
- preservation of metadata;
- duplicate retry prevention.

### Revisions and idempotency

- correct and stale base revisions;
- two requests from one base revision;
- duplicate operation delivery;
- operation UUID reused with conflicting payload;
- one revision increment per successful semantic operation;
- no increment after rollback, conflict, or idempotent replay.

### Rollback

Inject failure during:

- add/select swipe;
- truncate;
- regenerate;
- import or restore;
- message reordering.

Verify no partial data, selection, ordering, revision, or operation record remains.

### Multi-device and multi-worker

- two devices from one revision;
- delayed stale request;
- incorrect client clocks;
- device metadata recording;
- separate connections or processes;
- concurrent same-chat and separate-chat writes;
- writer waiting and busy timeout;
- stale revision after waiting;
- worker termination during a transaction;
- coherent reads during writes;
- authoritative final state.

### Compatibility

While legacy paths remain, verify:

- loaded-range writes preserve unseen messages;
- stale revisions are rejected;
- submitted UUIDs match authoritative ranges;
- partial hydration cannot trigger full replacement;
- empty payload cannot clear a chat;
- replacement requires explicit authorized intent;
- migrated data cannot be overwritten by an unguarded compatibility route.

## Implementation Stages

1. Inventory routes and reproduce deterministic failures.
2. Establish message and swipe identity invariants.
3. Implement explicit transactional operations.
4. Add operation idempotency and device metadata.
5. Validate multi-worker behavior and locking.
6. Restrict and remove ordinary replacement paths.
7. Validate migration, recovery, and performance.

Each stage must remain reviewable and state:

- invariant established;
- files changed;
- behavior changed;
- tests added;
- compatibility impact;
- migration impact;
- remaining risk.

## Completion Criteria

The storage-engine conversion is complete.

The mutation architecture is complete only when:

- deterministic failures have identified root causes and regression tests;
- ordinary mutations use stable message UUIDs;
- swipe operations have stable identity semantics;
- new messages and swipes can be identified before persistence where required;
- one semantic operation uses one transaction;
- revision validation and increment occur inside that transaction;
- injected failure leaves no partial logical change;
- duplicate delivery does not duplicate effects;
- stale requests do not overwrite newer state;
- client clocks do not determine authoritative order;
- multi-device conflict behavior is defined;
- multi-worker behavior is tested;
- ordinary edits do not rebuild unrelated rows;
- full replacement is restricted to explicit replacement operations;
- empty or partially hydrated payloads cannot clear a chat;
- unaffected message and swipe UUIDs survive mutations;
- migration and recovery are tested;
- loaded-range and generalized replacement writes have a defined removal path.

The goal is not merely that native SQLite writes succeed.

The goal is a coherent database contract in which every user-visible chat action has stable identity, explicit semantics, one atomic transaction boundary, server-authoritative revision behavior, idempotent retries, deterministic tests, and defined recovery.

## Superseded Architecture

The former storage architecture used `sql.js` to load the complete database, mutate it in memory, call `db.export()`, and replace the complete file. It must not return as a fallback for ordinary reads or saves.

The legacy client-authoritative mutation model is also being superseded.

Native SQLite must not become merely a faster container for:

- full-array replacement;
- loaded-range splicing;
- index-based identity;
- deletion inferred from absence;
- routine delete-and-rebuild behavior.

The completed architecture uses SQLite as a database: stable identities, bounded reads, explicit mutations, constraints, atomic transactions, revisions, idempotency, and defined recovery.

### Active-chat revision operations

Chat-header metadata changes, visibility changes, persona synchronization, adjacent message moves, and group incremental message updates use the shared acknowledged client queue and SQLite operation receipts. An adjacent move addresses both messages by UUID, verifies their persisted adjacency, and swaps only their ordering values in one transaction. Receipts are checked under the logical-chat lock before stale-revision validation, including for validated no-ops. Group incremental updates resolve the persisted wrapper by `aikobots_message_uuid`; a supplied positional message ID is compatibility metadata and must match the UUID-resolved row.

An open message or reasoning edit, including its final-save window, is protected client state. Full-window redraws and STMB planner chat reloads are rejected or deferred until the user saves or cancels; generation remains blocked for the same interval. Same-chat refresh events preserve that protection and its deferred reload, while a genuine group, character, or chat identity change discards both. Async edit work uses the group, character, and chat identity captured before persistence starts; if that identity is no longer active after an awaited event or save, the client abandons the remaining persistence and recovery UI instead of applying them to the newly active chat. A failed automatic or final edit save leaves the draft open, or reopens it from the locally edited message, instead of replacing it with a server reload. This is UI draft protection, not client-authoritative conflict resolution or an offline mutation outbox: persisted writes still require the normal server revision acknowledgement, and a deferred authoritative reload runs after the edit closes.

STMB post-memory auto-hide is durable chat visibility state and must use the normal persisted visibility path. Direct and group chats use revision-checked visibility endpoints that update only the requested SQLite message rows, including unloaded historical ranges. After acknowledgement, the client reconciles matching messages already present in its sparse cache and updates rendered visibility in place; unloaded rows remain absent until a later bounded read. A browser-only `is_system` change is insufficient because later incremental message appends do not rewrite historical rows, while reloading the whole chat solely to reconcile this bounded mutation would discard the user's current history window and scroll position.

### Streamed response authority

Chat-completion provider work is owned by a detached server job after the create request is acknowledged. Job state and replayable generated SSE events live in `DATA_ROOT/_generation-jobs/jobs.sqlite` under WAL mode with `synchronous = NORMAL`, so reconnect and cancellation requests may land on any PM2 worker without putting a disk sync on every SSE event commit. This auxiliary log remains consistent and durable across application crashes; recent transactions may roll back after an OS crash or power loss. The client supplies an idempotency UUID; reusing it with a different request hash or recovery target is rejected. Same-origin generation requests carry the HTTP-only login session cookie, and the server derives `request.user.profile.handle` from that session; client-supplied handles are not trusted. Every generation-job route rejects requests without that non-empty authenticated handle before deriving the hashed ownership key. Prompts, secure lorebook entries, keys, bindings, hidden metadata, and provider credentials are never stored in the job database. The `recovery_json` and `resolved_at` columns are added under an immediate SQLite migration transaction so concurrent PM2 startup cannot race the schema change.

Closing or suspending the stream connection does not cancel provider work. The browser reconnects to the event stream using SSE event IDs and exponentially backs off to five seconds, but terminates that delivery attempt after five consecutive failures or empty responses; it will not automatically reattach to that same exhausted job again during the current page lifetime. Stream readers flush each replayed event page. When a nonterminal job has missed three 15-second owner heartbeats, the shared store atomically marks it failed (or cancelled when cancellation was already requested), resolves its unusable recovery route, and appends a safe error plus `[DONE]`; late output from that former owner is rejected. Other failed and cancelled jobs also resolve their recovery routes because partial output is never committed. An explicit cancellation request durably changes the shared job state before the owning worker aborts its provider request. Cancellation is therefore ordered independently of the client connection and wins a concurrent completion transition. A process restart can still interrupt a job owned by that process because the sensitive provider request is deliberately not persisted for takeover.

A foreground streaming generation stores a strictly validated, content-free recovery route with the shared job and keeps the same record in the originating tab's `sessionStorage` as a fast path. The route contains the generation UUID, active chat identity, stable tail-message UUID, preassigned output-message UUID for appends, generation type, and optional swipe target; it contains no prompt, generated content, lorebook data, credentials, or hidden metadata. A page reload or closed browser drops only the delivery connection. After the same authoritative chat loads in any tab, the browser discovers the authenticated user's unresolved jobs, verifies the chat and tail identities, replays the durable generation events from the beginning, reconstructs the ephemeral streaming message, and uses the normal acknowledged chat mutation to append or update it. Preassigned message/swipe identities and a content-free continuation marker make a lost resolution acknowledgement detectable without applying the result twice. Only a successful authoritative chat mutation marks the job resolved. A tail-identity mismatch in the matching chat clears and cancels the pending job instead of guessing at a mutation target. Explicit Stop still cancels immediately. A server process crash does not provide provider-call takeover because the sensitive request remains deliberately unpersisted.

Healthy queued or running jobs remain live while their owner heartbeat advances. Completed recoverable jobs that have not yet been saved to chat are retained for seven days. Resolved completions, cancellations, failures, non-recoverable completions, and stale nonterminal jobs are retained for 24 hours; deletion is opportunistic after those minimum windows.

The browser message shown while generation is streaming remains ephemeral display state. When a stream finishes, the client sends one explicit SQLite append or update mutation, waits for its acknowledged revision, reads that message back from the server by logical position, validates its stable message UUID, and replaces the ephemeral browser object and DOM with the canonical SQLite row. Completion events run only after that replacement. Foreground generation controls remain unavailable through this final mutation, authoritative read-back, recovery acknowledgement, and completion events; an auto-swipe or auto-continue transfers that busy state directly instead of exposing an idle send control between chained generations.

Generic range saves are deferred until both the final streaming mutation and authoritative read-back settle. An explicit chat flush waits for the same boundary, while an explicit server refresh discards deferred browser-save state. This prevents a courtesy streaming display or a delayed save timer from becoming authoritative or leaking into another chat.

### Default content character index

Before user content seeding, every server worker scans `DEFAULT_CONTENT_ROOT/characters` for pushed PNG files and appends missing character records to `DEFAULT_CONTENT_ROOT/index.json`. Reconciliation uses the existing cross-worker default-content directory lock and atomic index replacement, so concurrent PM2 startup and character publication cannot lose one another's entries. Existing records are preserved and the startup refresh never removes files or index entries; a missing or malformed index is not guessed or replaced.

### Recommended Chat Setup persistence

Each configured character carries only a stable opaque `data.extensions.aikobots.recommended_chat_setup_key`. The key survives renames and distribution and is removed by character duplication. It is not an authorization credential: the server-side draft also records its authorized manager handles. Exact draft source bindings are returned only by the owner/admin management API; consumer summaries expose only component availability, botmaker display name, side-prompt count/name, and the current content revision.

Draft bindings and approved setup records live under `DATA_ROOT/_templates/recommended-chat-setups`, separate from secure lorebook storage. The index is atomically replaced under a cross-worker directory lock. Published component files are immutable and addressed by character key plus an internal content hash; publication writes those files first and switches the index once. This prevents a reader from pairing old metadata with new content. Approval uses the character distribution rollback hook, and successful commit removes superseded component files. Approved complete removal deletes both component files and the published index record.

The editable lorebook source remains an ordinary user lorebook. Designation accepts only `LTM - <character> - Blank` or `LTM-<character>-Blank`; `LTM` is case-sensitive and the final `Blank` is case-insensitive. A designated source remains editable but cannot be renamed, deleted, promoted, moved to shared storage, activated, bound to a chat/character, or selected by STMB. Selecting another source or `None` releases that reservation immediately. Lorebook mutation locking encloses designation so a concurrent rename/delete cannot race the reservation across PM2 workers. Secure lorebooks use only the existing `Z-`/`9Z` programming-lorebook rules; there is no secure-LTM exception.

Configured dead lorebook names are removed from user settings and from the server-side hidden-template source and compiled bindings on successful login. Before a reference migration persists changed template source, it atomically creates a content-free compile-pending marker; only a successful compiled-binding write clears that marker. Later login cleanup retries marked compilation even when the dead-name migration is already a no-op. Hidden-template cleanup, source saves, and compilation share the cross-worker lorebook mutation lock so concurrent admin requests and PM2 workers cannot interleave their filesystem writes.

The server-only secure lorebook index remains authoritative if a data-directory copy or restore drops a single-owner lorebook symlink. The repository may resolve that indexed entry through the exact backing file recorded for its owner, provided that file still exists and is readable; it remains classified and access-controlled as secure. A missing index record, missing backing file, non-symlink object in secure storage, or unreadable target is never accepted through this recovery path.

Submission copies the current ordinary source and selected side-prompt set into the submission directory under `DATA_ROOT/_system/character-submissions`. Missing, renamed, non-matching, or incomplete sources fail before a review record is created. Pending and rejected staged files never affect the published setup. Manual and automatic approval publish the staged components together with character distribution. Selecting `None` stages removal while leaving the previously approved setup available until that removal is approved.

STMB side prompts remain in each user's `stmb-side-prompts.json`, but reads now include a content revision and whole-document saves require the matching revision. Setup installation uses the same repository's cross-worker locked mutation so an install cannot silently overwrite a concurrent edit from another tab or PM2 worker. The generic file-upload endpoint cannot replace this file.

Built-in STMB memory, consolidation, side-prompt, Compaction, and Memory Assistance bodies follow the active German, French, Japanese, or Portuguese UI locale. Their prompt documents and module settings retain signatures for the last installed built-in text so a locale change can replace only an unchanged built-in; custom presets and user-edited built-ins are preserved. Built-in display names remain English. Memory Assistance translations are copied from the STMB reference repository; the reference's Brazilian Portuguese strings are used for Aikobots' supported Portuguese locale. The new message-aware Topical Clip default remains English because the reference commit intentionally deferred translations for that revised prompt; its translated UI strings are still copied unchanged.

STMB settings version 7 adds the normalized Memory Assistance mode and migrates the legacy after-memory checkbox without overriding an explicitly disabled mode. Version 6 added normalized per-character Memory Book locks keyed by the character avatar identity. A lock stores only the character and lorebook names, applies only in manual mode, follows character rename/edit/delete lifecycle events, and remains present but visibly broken when its lorebook is deleted so the user can repair it explicitly. Version 5 replaced duplicated provider configuration for new profiles with a reference to a central SillyTavern connection profile. STMB still stores optional model and temperature overrides; model resolution is per-run entry, then saved STMB override, then the connection profile model, and fails when all are empty. Existing direct-provider profiles remain intact until the user explicitly rebinds one, at which point duplicated provider, endpoint, and API-key fields are removed. Queued jobs persist a non-secret connection snapshot and a secret identifier, never the raw secret value, so later UI connection changes do not alter an already queued request.

World Info preset character locks use the character avatar filename as their stable client identity and move that key when the character file is renamed. The core loader also retains the legacy display-name map used by WorldInfoLocks v1.10.5. A legacy name is copied to the stable map only when it matches exactly one current character; duplicate or missing names remain untouched as compatibility fallbacks rather than being guessed or discarded. Chat locks retain the existing `worldInfoPresetLock` chat-metadata key and therefore use the normal acknowledged chat save path and SQLite chat transaction behavior.

### STMB Memory Assistance and Topical Clip message sources

Memory Assistance is integrated into the core STMB job queue rather than loaded as an extension hook. It is disabled by default. After a successful manual or automatic memory save, each ordinary-user target Memory Book receives a dependent job according to the selected mode; secure and shared-secure books are rejected before their contents are loaded. Jobs keep the already captured scene, non-secret connection snapshot, and source range, and never persist lorebook contents in queue state. More than five candidate Clips requires the existing durable approval flow, so another PM2 worker can resume the job without relying on process-local state.

Suggested updates are stored in a disabled, non-vectorized `Memory Assistance (STMB SidePrompt)` entry. Report creation and replacement use expected-absence or full-content-hash checks, and applying a suggestion adds expected title and Clip-type checks to the existing `/api/stmb/update-entry-by-uid` transaction. All identity and hash checks occur while the cross-worker lorebook mutation lock is held. A concurrent edit therefore returns a typed `409` instead of overwriting the newer Clip. Secure lorebook names, bindings, content, keys, and hidden metadata are not returned or logged by this workflow.

Topical Clip metadata version 2 may include both selected Memory entries and an authoritative chat-message range. Message capture resolves the numeric range through the existing SQLite reader and records boundary UUIDs plus non-content message hashes; it does not toggle message visibility or rewrite the chat. Ordinary JSONL chats retain the existing logical-range fallback. Memory Assistance stores the generating scene's start and end message numbers on each suggested topic and pre-fills them when that suggestion opens the same core Topical Clip editor. The editor's auto-accept action closes after validation, generates in the background, and removes the originating suggestion only after the established revision-checked lorebook save succeeds.

Opening Memory Books settings in a manual group chat reconciles configured character-lorebook bindings with STLO character filters. Shared character books are grouped into one target and the existing `/api/stmb/sync-group-stlo` transaction re-reads, updates, and saves all changed lorebooks under the cross-worker lorebook mutation lock; missing, reserved, canonical, and unbound books are skipped by the client. The operation is idempotent. The client sends only lorebook names, storage classes, and character names, and the endpoint never returns or logs lorebook entry content.

The selected installed resources are stored in ordinary chat metadata (`world_info`, `STMemoryBooks.sidePromptAfterMemorySetKey`, and content-free setup provenance). For SQLite chats, the existing revision-checked metadata mutation persists those bindings without replacing message rows. A pristine temporary direct chat is persisted only after the user confirms Apply; group chats are not supported by this feature.

### User storage alert state

Once-per-day user storage alert state lives at `DATA_ROOT/_storage-check/storage-check-alerts.json`. It remains outside `DATA_ROOT/_storage`, where every file must be a wrapped `node-persist` datum. Startup atomically moves the legacy alert file to the dedicated directory when no newer state exists. Reads, migrations, and atomic replacements use the alert state's cross-worker directory lock.

### STMB branch and checkpoint copies

Direct and group branches/checkpoints use the same server-authoritative prefix-copy operation. The request identifies the selected logical message and swipe, supplies the source revision and an operation UUID, and chooses either a branch or checkpoint. The browser does not submit a full replacement chat. The target chat records a content-free copy marker and the normal SQLite operation receipt, so an acknowledged retry cannot create another target.

For group copies, the client requires the group metadata edit to acknowledge the new chat-list entry before requesting publication, and removes that entry again after a caught copy failure. Network retries reuse the copy operation UUID. This prevents a completed copy from being silently omitted because an unchecked group-metadata response failed; a hard process or browser termination between the two separately persisted resources remains a recovery case rather than an atomic cross-file transaction.

When Memory Book copying is selected, the operation acquires the cross-worker lorebook mutation lock before the source/target chat locks. It resolves bindings from the persisted source header, rejects every operation containing a secure or ineligible lorebook before publication, clones each ordinary lorebook as a complete snapshot, creates collision-free ordinary-user copies, rewrites the target bindings, and writes the target chat. A caught failure deletes only the chat and lorebook resources created by that attempt while the same locks remain held. Responses and logs contain only safe status flags and counts; lorebook names, bindings, entry content, keys, and hidden secure metadata are excluded.

Manual-mode character locks are global settings rather than chat metadata. Solo locked books are not cloned for a branch or checkpoint. In groups, locked member bindings stay on their original books while unlocked member bindings and the canonical group book are cloned normally. The client sends only a solo-lock boolean and group member binding keys to the coordinated copy endpoint; locked lorebook names are not added to the request, response, or logs.

Ordinary copies store their original lineage root and allocate `Branch N` and `Checkpoint N` suffixes under the lorebook lock. Nested copies therefore continue the root sequence. Replacing a checkpoint publishes a newly named chat and newly numbered books; the formerly linked checkpoint and its books remain untouched.

New base-memory entries persist `STMB_startUuid` and `STMB_endUuid` from an authoritative SQLite range read in addition to the legacy numeric range. Chat-copy operations deliberately do not interpret numeric ranges, UUID ranges, consolidation relationships, or Side Prompt regeneration snapshots: every entry and its source-chat metadata is preserved unchanged. This supports manually managed or shared lorebooks whose message metadata may describe another chat; users are responsible for removing entries they do not want in the copied book. Book-to-book references and target-chat bindings are still rewritten, copy lineage is recorded, and the copied chat's processing state is clamped to its selected message.

Base-memory saves fall back to the existing logical JSONL reader when the referenced chat has not yet been migrated to SQLite. The server still verifies that both numeric scene boundaries exist in that exact referenced chat; persisted boundary UUIDs are included only when both are already present. This compatibility read does not migrate, rewrite, or delete the legacy chat, and the resulting numeric-only memory continues through the existing legacy range rules.

### STMB entry regeneration

Regeneration runs as a core STMB client job so it is serialized with other Memory Books work and appears in the job queue. The queued record contains only the lorebook name, entry UID, and chat identity; the executor re-reads the entry instead of storing lorebook content in queue state.

Base-memory regeneration always captures its original message range through the server-side SQLite range reader, including rows outside the browser's loaded window. Capture metadata includes the current `chatRevision`. The replacement request supplies that revision plus a full target-entry hash; consolidation regeneration also supplies the explicit source UIDs and full source-entry hashes.

Every STMB lorebook endpoint that creates or updates entries holds the cross-worker lorebook mutation lock across the complete read-modify-write operation. This includes base memories, consolidations, individual entry creation and updates, and single or batched Side Prompt upserts; serializing only their final whole-file save would allow a later worker to overwrite an earlier worker's mutation with a stale read.

`POST /api/stmb/regenerate-entry` supports only ordinary user lorebooks. It acquires the shared lorebook mutation lock before the logical-chat lock, re-reads the target, source identities, eligibility, and chat revision under that lock order, and rejects stale state with a typed `409` before mutation. A successful operation preserves the entry UID and unrelated metadata while replacing only the formatted title, content, keywords, explicit source UIDs, and a parent-disable state whose referenced parent is demonstrably absent.

Each successful Side Prompt run persists one versioned `STMB_sidePromptRegeneration` snapshot containing its template key, prior output, runtime macros, chat identity, numeric range, and authoritative boundary UUIDs. Regeneration resolves that UUID range through SQLite, uses the current template and settings, requires approval, and submits `replacementMode: content-only`; the server preserves the entry title, keywords, settings, checkpoint fields, and snapshot. Normal Side Prompt runs advance the saved prior version, while regeneration produces another alternative from the same saved inputs. Entries created before this metadata exists become eligible after their next normal run.

New ordinary-user consolidations store `stmbSourceEntryUids`; legacy consolidations may recover source identity from `disabledBySummaryId` backlinks. The recovered set must be complete and exactly one tier lower. Secure lorebooks are excluded because client-side generation may not read, return, log, or fingerprint secure content or hidden metadata.
