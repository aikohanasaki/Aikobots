# Aikobots v2 ChatStore First-Cut Server Seam

## Trimmed Interface

This first cut is intentionally route-shaped. It exists to remove direct path, JSONL segment, split-tail, and sidecar handling from `src/endpoints/chats.js` without changing client request or response payloads. It does not cover schema design, tests, a DB adapter, active chat references, search/recent/orphaned indexing, prompt payload resolution, or group definition management.

```ts
interface ChatStore {
    load(ref: ChatRef, input: LoadChatInput): Promise<LoadChatResult>;
    save(ref: DirectChatRef, input: SaveChatInput): Promise<SaveChatResult>;
    mutateVisibility(ref: DirectChatRef, input: VisibilityMutationInput): Promise<VisibilityMutationResult>;
    createPrefix(ref: DirectChatRef, input: PrefixCreateInput): Promise<PrefixCreateResult>;
    rename(ref: ChatRef, input: RenameChatInput): Promise<RenameChatResult>;
    delete(ref: ChatRef, input?: DeleteChatInput): Promise<DeleteChatResult>;
    export(ref: ChatRef, input: ExportChatInput): Promise<ExportChatResult>;
    importDirect(ref: DirectChatCollectionRef, input: ImportDirectChatInput): Promise<ImportDirectChatResult>;
    importGroup(ref: GroupChatCollectionRef, input: ImportGroupChatInput): Promise<ImportGroupChatResult>;
    saveGroup(ref: GroupChatRef, input: SaveGroupChatInput): Promise<SaveGroupChatResult>;
}

type UserChatScope = {
    userHandle: string;
    directories: UserDirectoryList;
};

type DirectChatRef = UserChatScope & {
    kind: 'direct';
    avatarUrl: string;
    characterKey: string;
    chatId: string;
};

type GroupChatRef = UserChatScope & {
    kind: 'group';
    chatId: string;
};

type ChatRef = DirectChatRef | GroupChatRef;

type DirectChatCollectionRef = UserChatScope & {
    kind: 'directCollection';
    avatarUrl: string;
    characterKey: string;
};

type GroupChatCollectionRef = UserChatScope & {
    kind: 'groupCollection';
};

type LogicalChatData = [Record<string, unknown>, ...Record<string, unknown>[]] | [];

type StorageState = {
    storage_mode: 'full' | 'split-tail';
    tailStartId: number;
    tailEndId: number;
    headCount: number;
    tailCount: number;
};

type RevisionInput = {
    base_revision?: number | null;
    save_session_id?: string;
};

type LoadChatInput = {
    chunked?: boolean;
    range_start?: number | null;
    count?: number | null;
    hydrate_full?: boolean;
    display_count?: number;
    buffer_max?: number;
    include_parent_prompt_cache?: boolean;
    with_metadata?: boolean;
    touch_activity?: boolean;
};

type LoadChatResult =
    | { kind: 'missing'; body: {} | [] | { messages: []; chat_metadata: {}; chat_revision: 0 }; }
    | { kind: 'directFull'; body: LogicalChatData; }
    | { kind: 'directChunk'; body: ChunkedDirectChatPayload; }
    | { kind: 'groupFull'; body: Record<string, unknown>[] | { messages: Record<string, unknown>[]; chat_metadata: Record<string, unknown>; chat_revision: number }; }
    | { kind: 'groupChunk'; body: ChunkedGroupChatPayload; };

type ChunkedDirectChatPayload = StorageState & {
    mode: 'full' | 'split-tail';
    header: Record<string, unknown> | null;
    messages: Record<string, unknown>[];
    totalMessages: number;
    loadedRangeStart: number;
    loadedRangeEnd: number;
    chat_revision: number;
    parentPromptCache?: Record<string, unknown>;
};

type ChunkedGroupChatPayload = {
    mode: 'full';
    isHydrated: true;
    chat_revision: number;
    totalMessages: number;
    loadedRangeStart: number;
    loadedRangeEnd: number;
    messages: Record<string, unknown>[];
    chat_metadata?: Record<string, unknown>;
};

type SaveChatInput = RevisionInput & {
    chat: LogicalChatData;
    save_mode?: 'full' | 'tail' | 'loaded_range';
    absolute_start_id?: number;
    loaded_range_start?: number;
    display_count?: number;
    buffer_max?: number;
    refresh_tail?: boolean;
    force?: boolean;
};

type SaveChatResult = StorageState & {
    result: 'ok';
    chat_revision: number;
    payload: ChunkedDirectChatPayload | null;
};

type SaveGroupChatInput = RevisionInput & {
    chat: Record<string, unknown>[];
    chat_metadata?: Record<string, unknown>;
};

type SaveGroupChatResult = {
    ok: true;
    chat_revision: number;
};

type VisibilityMutationInput = RevisionInput & {
    start: number;
    end?: number;
    unhide?: boolean;
    name_filter?: string;
    display_count?: number;
    buffer_max?: number;
};

type VisibilityMutationResult = StorageState & {
    result: 'ok';
    changed: number;
    chat_revision: number;
};

type PrefixCreateInput = {
    targetChatId: string;
    prefix_end_id: number;
    header_overrides?: Record<string, unknown>;
};

type PrefixCreateResult = {
    ok: true;
};

type RenameChatInput = {
    targetChatId: string;
    originalFileName?: string;
    renamedFileName?: string;
};

type RenameChatResult = {
    ok: true;
    sanitizedFileName: string;
};

type DeleteChatInput = {
    missingOk?: boolean;
};

type DeleteChatResult = {
    ok: true;
    deleted: boolean;
};

type ExportChatInput = {
    format: 'jsonl' | 'txt';
    exportfilename?: string;
};

type ExportChatResult = {
    message: string;
    result: string;
};

type ImportDirectChatInput = {
    file_type: 'json' | 'jsonl';
    originalname: string;
    data: string;
    character_name: string;
    user_name: string;
};

type ImportDirectChatResult = {
    res: true;
    fileNames: string[];
};

type ImportGroupChatInput = {
    data: string;
};

type ImportGroupChatResult = {
    res: string;
};
```

Later, outside the first-cut seam:

- `search`, `recent`, and `orphaned` should become store-backed query/listing APIs after core read/write routes are behind the adapter.
- `summarize` and `getChatInfo` should move after list/search callers stop depending on paths.
- `resolvePromptPayload` should move after route cutover, because it is an exported prompt assembly helper rather than an HTTP route.
- Active chat reference reads/writes should move after character and group endpoint ownership is addressed.
- Group `chat_id`/`chats` list management should stay in `src/endpoints/groups.js` for the first cut and move later with group definition storage.

## Route-To-Method Mapping For `src/endpoints/chats.js`

- `POST /api/chats/message-visibility`
  - Build `DirectChatRef` from `avatar_url` and `file_name`.
  - Call `chatStore.mutateVisibility(ref, request.body)`.
  - Preserve current 400/404/409/500 error bodies and success body.

- `POST /api/chats/save`
  - Build `DirectChatRef` from `avatar_url` and `file_name`.
  - Call `chatStore.save(ref, request.body)`.
  - The store handles `save_mode` values `tail`, `loaded_range`, and default full save.
  - Preserve current integrity, revision, no-op, split-tail, refresh-tail, backup-trigger, and response payload behavior.

- `POST /api/chats/get`
  - Build `DirectChatRef` from `avatar_url` and `file_name`.
  - Call `chatStore.load(ref, request.body)`.
  - If missing, route returns `{}` exactly as today.
  - If `chunked` is true, route sends `LoadChatResult.body` as the current chunked payload.
  - If `chunked` is false, route sends `LoadChatResult.body` as the current logical JSONL array.

- `POST /api/chats/save-prefix`
  - Build `DirectChatRef` from `avatar_url` and `source_file`.
  - Call `chatStore.createPrefix(ref, { targetChatId, prefix_end_id, header_overrides })`.
  - Preserve `{ ok: true }`, 400, and 500 route behavior.

- `POST /api/chats/rename`
  - Build `DirectChatRef` when `is_group` is false.
  - Build `GroupChatRef` when `is_group` is true.
  - Call `chatStore.rename(ref, { targetChatId, originalFileName, renamedFileName })`.
  - Preserve `{ ok: true, sanitizedFileName }`, 400, 409 `incomplete_split_chat`, and 500 behavior.

- `POST /api/chats/delete`
  - Build `DirectChatRef` from `avatar_url` and `chatfile`.
  - Call `chatStore.delete(ref)`.
  - Preserve plain `'ok'` success, 400 missing-chat response, and 500 response.

- `POST /api/chats/export`
  - Build `DirectChatRef` when `is_group` is false.
  - Build `GroupChatRef` when `is_group` is true.
  - Call `chatStore.export(ref, { format, exportfilename })`.
  - Preserve current JSONL and text export response shape.

- `POST /api/chats/group/import`
  - Build `GroupChatCollectionRef`.
  - Read upload data in the route.
  - Call `chatStore.importGroup(ref, { data })`.
  - Preserve `{ res: chatname }`, unsupported JSONL rejection, and `{ error: true }`.

- `POST /api/chats/import`
  - Build `DirectChatCollectionRef` from `avatar_url`.
  - Read upload data in the route.
  - Call `chatStore.importDirect(ref, { file_type, originalname, data, character_name, user_name })`.
  - Preserve `{ res: true, fileNames }`, unsupported JSONL rejection, and `{ error: true }`.

- `POST /api/chats/group/get`
  - Build `GroupChatRef` from `id`.
  - Call `chatStore.load(ref, request.body)`.
  - Preserve array response, `{ messages, chat_metadata, chat_revision }`, chunked group payload, and missing-chat empty responses.

- `POST /api/chats/group/delete`
  - Build `GroupChatRef` from `id`.
  - Call `chatStore.delete(ref)`.
  - Preserve `{ ok: true }` on success and `{ error: true }` when missing.

- `POST /api/chats/group/save`
  - Build `GroupChatRef` from `id`.
  - Call `chatStore.saveGroup(ref, request.body)`.
  - Preserve `{ ok: true, chat_revision }`, revision errors, and 500 save error.

- `POST /api/chats/search`
  - Later. Keep current route implementation for the first cut or move only after a query/listing API is added.

- `POST /api/chats/orphaned`
  - Later. Keep current route implementation for the first cut or move only after orphan collection listing is added.

- `POST /api/chats/recent`
  - Later. Keep current route implementation for the first cut or move only after recent chat listing is added.

## File-Backed Adapter Implementation Sequence

1. Create a file-backed `ChatStore` module with only the interface above.

2. Move path resolution into the adapter:
   - Direct refs resolve to `request.user.directories.chats/<characterKey>/<chatId>.jsonl`.
   - Group refs resolve to `request.user.directories.groupChats/<chatId>.jsonl`.
   - Routes pass refs only; they do not call `path.join`, `sanitize`, `getSplitHeadPath`, or inspect `.head.jsonl`.

3. Move physical JSONL helpers into the adapter unchanged:
   - `isHeadChatFile`.
   - `getSplitHeadPath`.
   - `readJsonlObjects`.
   - `serializeJsonl`.
   - `getChatSegments`.
   - `getSegmentLayout`.
   - `stripChatStorage`.
   - `writeLogicalChat`.
   - `ensureSplitTailStorage`.
   - `buildChunkedChatPayload`.

4. Move persistence normalization into the adapter unchanged:
   - `sanitizeChatHeaderForPersistence`.
   - `sanitizeChatMessageForPersistence`.
   - `stripPersistedChatMetadata`.
   - `stripPersistedChatExtra`.
   - `normalizeLongChatConfig`.
   - `hasValidChatPayload`.
   - `applyLoadedMessageRange`.
   - `isLogicalChatSaveNoop`.

5. Move concurrency and revision handling into the adapter unchanged:
   - `withChatSaveLock`.
   - `getChatRevision`.
   - `getChatLastSaveSessionId`.
   - `getRequestSaveSessionId`.
   - `setChatRevision`.
   - `validateSaveRevision`.
   - `checkChatIntegrity`.

6. Implement `load`:
   - Direct full load returns logical JSONL data with storage metadata stripped.
   - Direct chunked load locks the chat, ensures split-tail storage when needed, and returns the existing chunk payload.
   - Group full load calls the existing group-header normalization path and returns the existing array or metadata object shape.
   - Group chunked load preserves the current `mode: 'full'`, `isHydrated: true` payload.
   - User activity touch can stay in the route or be called from the adapter through the `touch_activity` flag, but choose one place and keep route payloads unchanged.

7. Implement `save` for direct chats:
   - Keep the current full, `tail`, and `loaded_range` merge logic inside the adapter.
   - Keep integrity checks, revision checks, no-op stale-save acceptance, split-tail preservation, compaction, and `refresh_tail` payload generation inside the adapter.
   - Return the exact current save payload fields.

8. Implement `mutateVisibility`:
   - Keep absolute positional range validation inside the adapter.
   - Reject incomplete split-tail head mutations with `incomplete_split_chat`.
   - Preserve no-op revision behavior and current storage state response fields.

9. Implement `createPrefix`:
   - Load the source logical chat by ref.
   - Validate `prefix_end_id`.
   - Write target logical chat with source header plus `header_overrides`.
   - Preserve current `{ ok: true }` behavior.

10. Implement `rename` and `delete`:
    - Keep split-tail sidecar handling entirely inside the adapter.
    - Preserve split-tail layout on rename.
    - Reject incomplete split-tail rename with the current 409 error.
    - Delete both primary and head files for delete.

11. Implement `export`:
    - JSONL export serializes logical chat data, not physical split-tail files.
    - Text export iterates logical messages and preserves the current `is_system`, `display_text`, and formatting behavior.

12. Implement `importDirect` and `importGroup`:
    - Keep existing import format detection and normalization helpers available to the adapter or as pure helper imports.
    - Route reads upload bytes/text and deletes temp upload files.
    - Adapter chooses unique chat names, rejects unsupported headers, normalizes imported chat data, writes through `writeLogicalChat`, and returns current result shapes.

13. Implement `saveGroup`:
    - Move `getGroupChatPayload`, `buildGroupChatHeader`, `writeGroupChat`, `ensureGroupChatHeader`, and `resolveLegacyGroupChatMetadata` into the adapter.
    - Preserve group metadata fallback, revision checks, backup-trigger behavior, and `{ ok: true, chat_revision }`.

14. Refactor the core routes one at a time:
    - Start with `/get` and `/save`, because they exercise the main load/save seam.
    - Then move `/message-visibility`, `/save-prefix`, `/rename`, `/delete`, and `/export`.
    - Then move group import/get/delete/save.
    - Then move direct import.

15. Leave `/search`, `/orphaned`, `/recent`, `getChatInfo`, and `resolveSplitCoreChatPayload` on the old helpers until the first-cut route seam is stable.
