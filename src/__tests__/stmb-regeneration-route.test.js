import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const getLorebookForManagement = jest.fn();
const transactionSave = jest.fn();
const resolveSqliteLogicalChatReference = jest.fn();
const withChatSaveLock = jest.fn(async (_path, callback) => await callback());
const isReservedRecommendedTemplateSource = jest.fn(() => false);

class MockLorebookRepositoryError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.type = type;
        this.status = status;
    }
}

jest.unstable_mockModule('../lorebook-repository.js', () => ({
    assertLorebookCheckoutForManagement: jest.fn(),
    getLorebookForManagement,
    LorebookRepositoryError: MockLorebookRepositoryError,
    saveLorebookForManagement: jest.fn(),
    withLorebookManagementTransaction: operation => operation({ save: transactionSave }),
}));

jest.unstable_mockModule('../recommended-chat-template-store.js', () => ({
    isReservedRecommendedTemplateSource,
}));

jest.unstable_mockModule('../endpoints/chats.js', () => ({
    resolveSqliteLogicalChatReference,
}));

jest.unstable_mockModule('../chat-storage.js', () => ({
    withChatSaveLock,
}));

jest.unstable_mockModule('../stmb-context-settings.js', () => ({
    deleteStmbContextSetting: jest.fn(),
    duplicateStmbContextSetting: jest.fn(),
    getStmbContextSetting: jest.fn(),
    listOwnedStmbContextSourceEntries: jest.fn(),
    listStmbContextSettings: jest.fn(),
    migrateStmbContextSettingsLorebookReference: jest.fn(),
    resolveStmbContextSettingEntries: jest.fn(),
    STMB_CONTEXT_NONE_KEY: 'none',
    upsertStmbContextSetting: jest.fn(),
}));

jest.unstable_mockModule('../active-session-store.js', () => ({
    isActiveSessionError: () => false,
    sendActiveSessionRequired: jest.fn(),
}));

let handler;
let captureHandler;
let hashRegenerationEntry;

beforeAll(async () => {
    ({ hashRegenerationEntry } = await import('../../public/scripts/stmb-regeneration.js'));
    const { router } = await import('../endpoints/stmb.js');
    handler = router.stack.find(layer => layer.route?.path === '/regenerate-entry').route.stack[0].handle;
    captureHandler = router.stack.find(layer => layer.route?.path === '/capture-scene').route.stack[0].handle;
});

beforeEach(() => {
    getLorebookForManagement.mockReset();
    transactionSave.mockReset().mockResolvedValue({});
    resolveSqliteLogicalChatReference.mockReset().mockResolvedValue({
        sqlitePath: 'chat.sqlite',
        header: { chat_revision: 7 },
        sqliteMissing: false,
        totalMessages: 40,
        missingRanges: [],
        messages: [],
    });
    withChatSaveLock.mockClear();
    isReservedRecommendedTemplateSource.mockClear();
});

function response() {
    return {
        statusCode: 200,
        payload: null,
        status: jest.fn(function (statusCode) {
            this.statusCode = statusCode;
            return this;
        }),
        send: jest.fn(function (payload) {
            this.payload = payload;
            return payload;
        }),
    };
}

function baseEntry(overrides = {}) {
    return {
        uid: 1,
        comment: '[001] Old',
        content: 'Old content',
        key: ['old'],
        stmemorybooks: true,
        STMB_start: 10,
        STMB_end: 20,
        STMB_chatId: 'chat-1',
        order: 12,
        ...overrides,
    };
}

function requestFor(entry, overrides = {}) {
    const assertAllowed = jest.fn().mockResolvedValue(undefined);
    return {
        user: { profile: { handle: 'alice' } },
        activeSessionOperation: { assertAllowed },
        body: {
            lorebookName: 'Book',
            storage: 'user',
            uid: entry.uid,
            replacement: { title: '[001] New', content: 'New content', keywords: ['new'] },
            expectedTargetHash: hashRegenerationEntry(entry),
            sourceUids: [],
            sourceHashes: {},
            chatRef: { type: 'character', avatarUrl: 'a.png', fileName: 'chat-1' },
            currentChatId: 'chat-1',
            expectedChatRevision: 7,
            ...overrides,
        },
    };
}

function loadBook(entries) {
    getLorebookForManagement.mockResolvedValue({
        data: { entries: structuredClone(entries) },
        metadata: { name: 'Book', storage: 'user' },
    });
}

describe('STMB regeneration route', () => {
    it('returns the SQLite chat revision with server-captured unloaded ranges', async () => {
        resolveSqliteLogicalChatReference.mockResolvedValue({
            sqlitePath: 'chat.sqlite',
            header: { chat_revision: 11 },
            sqliteMissing: false,
            totalMessages: 102,
            lastAvailableMessageId: 101,
            messages: Array.from({ length: 102 }, (_value, index) => index >= 100
                ? { name: 'Alice', mes: `Server row ${index}`, is_system: false }
                : undefined),
            missingRanges: [],
            storageMode: 'sqlite',
            storageHealthy: true,
        });
        const req = {
            user: { directories: {} },
            body: {
                chatRef: { type: 'character', avatarUrl: 'a.png', fileName: 'chat-1' },
                sceneStart: 100,
                sceneEnd: 101,
                chatId: 'chat-1',
                characterName: 'Alice',
                userName: 'User',
            },
        };
        const res = response();

        await captureHandler(req, res);

        expect(res.payload.capture).toMatchObject({
            requestedStart: 100,
            requestedEnd: 101,
            chatRevision: 11,
            storageMode: 'sqlite',
        });
        expect(res.payload.compiledScene.messages).toHaveLength(2);
    });

    it('atomically replaces a base entry and returns no entry data', async () => {
        const entry = baseEntry();
        loadBook({ 1: entry });
        const request = requestFor(entry);
        const res = response();

        await handler(request, res);

        expect(res.payload).toEqual({ ok: true, lorebookName: 'Book', storage: 'user', uid: 1 });
        expect(withChatSaveLock).toHaveBeenCalledWith('chat.sqlite', expect.any(Function));
        expect(request.activeSessionOperation.assertAllowed).toHaveBeenCalled();
        const savedEntry = transactionSave.mock.calls[0][2].entries[1];
        expect(savedEntry).toMatchObject({
            uid: 1,
            comment: '[001] New',
            content: 'New content',
            key: ['new'],
            order: 12,
        });
        expect(JSON.stringify(res.payload)).not.toContain('New content');
    });

    it('rejects stale target and chat revisions without mutation', async () => {
        const entry = baseEntry();
        loadBook({ 1: entry });
        const staleTargetRequest = requestFor(entry, { expectedTargetHash: '00000000' });
        const staleTargetResponse = response();
        await handler(staleTargetRequest, staleTargetResponse);
        expect(staleTargetResponse.statusCode).toBe(409);
        expect(staleTargetResponse.payload.error.type).toBe('StmbRegenerationTargetChanged');
        expect(transactionSave).not.toHaveBeenCalled();

        loadBook({ 1: entry });
        resolveSqliteLogicalChatReference.mockResolvedValue({
            sqlitePath: 'chat.sqlite',
            header: { chat_revision: 8 },
            sqliteMissing: false,
            totalMessages: 40,
            missingRanges: [],
            messages: [],
        });
        const staleChatResponse = response();
        await handler(requestFor(entry), staleChatResponse);
        expect(staleChatResponse.statusCode).toBe(409);
        expect(staleChatResponse.payload.error.type).toBe('StmbRegenerationChatChanged');
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('rechecks the complete consolidation source set and hashes', async () => {
        const source1 = baseEntry({ uid: 1, comment: '[001] One' });
        const source2 = baseEntry({ uid: 2, comment: '[002] Two', STMB_start: 21, STMB_end: 30 });
        const target = {
            uid: 10,
            comment: '[ARC 001] Old',
            content: 'Old arc',
            key: ['arc'],
            stmemorybooks: true,
            stmbSummary: true,
            stmbSummaryTier: 1,
            stmbSourceEntryUids: [1, 2],
        };
        loadBook({ 1: source1, 2: source2, 10: target });
        const req = requestFor(target, {
            replacement: { title: '[ARC 001] New', content: 'New arc', keywords: ['new'] },
            sourceUids: ['1', '2'],
            sourceHashes: {
                1: hashRegenerationEntry(source1),
                2: '00000000',
            },
            chatRef: undefined,
            currentChatId: undefined,
            expectedChatRevision: undefined,
        });
        const res = response();

        await handler(req, res);

        expect(res.statusCode).toBe(409);
        expect(res.payload.error.type).toBe('StmbRegenerationSourcesChanged');
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('rejects secure targets before loading lorebook data', async () => {
        const entry = baseEntry();
        const res = response();
        await handler(requestFor(entry, { storage: 'secure' }), res);
        expect(res.statusCode).toBe(403);
        expect(res.payload.error.type).toBe('StmbRegenerationStorageNotAllowed');
        expect(getLorebookForManagement).not.toHaveBeenCalled();
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('enforces the active session before saving and sanitizes unexpected failures', async () => {
        const entry = baseEntry();
        loadBook({ 1: entry });
        const req = requestFor(entry);
        req.activeSessionOperation.assertAllowed.mockRejectedValue(new Error('sensitive internal state'));
        const res = response();
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await handler(req, res);
        } finally {
            consoleSpy.mockRestore();
        }

        expect(req.activeSessionOperation.assertAllowed).toHaveBeenCalled();
        expect(transactionSave).not.toHaveBeenCalled();
        expect(res.payload).toEqual({
            error: {
                type: 'StmbRegenerationFailed',
                message: 'The memory entry could not be regenerated.',
            },
        });
        expect(JSON.stringify(res.payload)).not.toContain('sensitive internal state');
    });
});
