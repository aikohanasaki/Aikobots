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
