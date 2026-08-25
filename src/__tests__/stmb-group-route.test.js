import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const getLorebookForManagement = jest.fn();
const saveLorebookForManagement = jest.fn();
const transactionSave = jest.fn();
const assertLorebookCheckoutForManagement = jest.fn();
const isReservedRecommendedTemplateSource = jest.fn();
const resolveLogicalChatReference = jest.fn();
const resolveSqliteLogicalChatReference = jest.fn();
const withChatSaveLock = jest.fn(async (_path, callback) => await callback());

class MockLorebookRepositoryError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.type = type;
        this.status = status;
    }
}

jest.unstable_mockModule('../lorebook-repository.js', () => ({
    assertLorebookCheckoutForManagement,
    getLorebookForManagement,
    LorebookRepositoryError: MockLorebookRepositoryError,
    saveLorebookForManagement,
    withLorebookManagementTransaction: operation => operation({ save: transactionSave }),
}));

jest.unstable_mockModule('../recommended-chat-template-store.js', () => ({
    isReservedRecommendedTemplateSource,
}));

jest.unstable_mockModule('../endpoints/chats.js', () => ({
    resolveLogicalChatReference,
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
let syncHandler;

beforeAll(async () => {
    const { router } = await import('../endpoints/stmb.js');
    handler = router.stack.find(layer => layer.route?.path === '/save-group-memory').route.stack[0].handle;
    syncHandler = router.stack.find(layer => layer.route?.path === '/sync-group-stlo').route.stack[0].handle;
});

beforeEach(() => {
    getLorebookForManagement.mockReset();
    saveLorebookForManagement.mockReset();
    transactionSave.mockReset();
    assertLorebookCheckoutForManagement.mockReset();
    isReservedRecommendedTemplateSource.mockReset();
    resolveLogicalChatReference.mockReset();
    resolveSqliteLogicalChatReference.mockReset();
    isReservedRecommendedTemplateSource.mockReturnValue(false);
    resolveSqliteLogicalChatReference.mockResolvedValue({
        storageMode: 'sqlite',
        sqliteMissing: false,
        messages: [
            undefined,
            { aikobots_message_uuid: '00000000-0000-4000-8000-000000000001' },
            undefined,
            undefined,
            { aikobots_message_uuid: '00000000-0000-4000-8000-000000000004' },
        ],
    });
    transactionSave.mockResolvedValue({});
});

function makeResponse() {
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

function makeRequest(overrides = {}) {
    return {
        user: { profile: { handle: 'alice' } },
        activeSessionOperation: { assertAllowed: jest.fn().mockResolvedValue(undefined) },
        body: {
            primary: {
                lorebookName: 'Group Book',
                storage: 'user',
                memoryObject: { title: 'Arrival', content: 'The party arrived.', keywords: ['party'] },
                characterFilterNames: ['alice', 'bob'],
            },
            targets: [{
                lorebookName: 'Alice Book',
                storage: 'user',
                memoryObject: { title: 'Arrival', content: 'Alice arrived.', keywords: ['alice'] },
                characterFilterNames: ['alice'],
                usePrimaryTitle: false,
            }],
            sceneContext: { sceneStart: 1, sceneEnd: 4, groupName: 'Party' },
            chatRef: { type: 'group', chatId: 'party-chat' },
            profile: { titleFormat: '[000] - {{title}}' },
        },
        ...overrides,
    };
}

function mockLoadedLorebooks() {
    const books = new Map([
        ['Group Book', { data: { entries: {} }, metadata: { name: 'Group Book', storage: 'user' } }],
        ['Alice Book', { data: { entries: {} }, metadata: { name: 'Alice Book', storage: 'user' } }],
    ]);
    getLorebookForManagement.mockImplementation((_user, name) => structuredClone(books.get(name)));
}

function makeNarratorRequest() {
    const request = makeRequest();
    request.body.routingMode = 'narrator';
    request.body.primary.characterFilterNames = ['must-not-persist'];
    request.body.primary.narratorParticipantIds = ['alice-id'];
    request.body.targets[0].characterFilterNames = ['must-not-persist'];
    request.body.targets[0].narratorOwnerIds = ['alice-id'];
    return request;
}

describe('STMB multi-lorebook group route', () => {
    it('synchronizes existing group bindings without returning character metadata', async () => {
        getLorebookForManagement.mockResolvedValue({
            data: { entries: {}, stlo: { priority: 4, budget: 2000 } },
            metadata: { name: 'Alice Book', storage: 'user' },
        });
        const request = makeRequest({
            body: {
                targets: [{
                    lorebookName: 'Alice Book',
                    storage: 'user',
                    characterNames: ['alice'],
                }],
            },
        });
        const response = makeResponse();

        await syncHandler(request, response);

        expect(response.payload).toEqual({ ok: true, updatedCount: 1 });
        expect(transactionSave.mock.calls[0][2].stlo).toMatchObject({
            priority: 4,
            budget: 2000,
            onlyWhenSpeaking: true,
            characterOverrides: {
                alice: { priority: 4, orderAdjustment: 0 },
            },
        });
        expect(JSON.stringify(response.payload)).not.toContain('alice');
    });

    it('rejects designated ordinary template targets before reading lorebook data', async () => {
        const request = makeRequest();
        request.body.primary.lorebookName = 'LTM - Alice - Blank';
        request.body.primary.storage = 'user';
        isReservedRecommendedTemplateSource.mockReturnValue(true);
        const response = makeResponse();

        await handler(request, response);

        expect(response.statusCode).toBe(400);
        expect(getLorebookForManagement).not.toHaveBeenCalled();
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('validates target storage before opening a transaction', async () => {
        const request = makeRequest();
        request.body.targets[0].storage = 'remote';
        const response = makeResponse();

        await handler(request, response);

        expect(response.statusCode).toBe(400);
        expect(response.payload.error.type).toBe('StmbBadRequest');
        expect(getLorebookForManagement).not.toHaveBeenCalled();
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('validates every checkout before any lorebook write', async () => {
        mockLoadedLorebooks();
        assertLorebookCheckoutForManagement.mockImplementation((_user, metadata) => {
            if (metadata.name === 'Alice Book') {
                throw new MockLorebookRepositoryError('LorebookCheckoutRequired', 'Checkout required.', 423);
            }
        });
        const response = makeResponse();

        await handler(makeRequest(), response);

        expect(response.statusCode).toBe(423);
        expect(getLorebookForManagement).toHaveBeenCalledTimes(2);
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('writes canonical metadata and one entry per distinct target', async () => {
        mockLoadedLorebooks();
        const response = makeResponse();

        await handler(makeRequest(), response);

        expect(response.statusCode).toBe(200);
        expect(response.payload.ok).toBe(true);
        expect(transactionSave).toHaveBeenCalledTimes(2);
        const primaryData = transactionSave.mock.calls[0][2];
        const targetData = transactionSave.mock.calls[1][2];
        const primaryEntry = Object.values(primaryData.entries)[0];
        const targetEntry = Object.values(targetData.entries)[0];
        expect(primaryEntry).toMatchObject({
            STMB_canonical: true,
            STMB_canonicalLorebook: 'Group Book',
            STMB_canonicalMemoryNumber: 1,
            group: 'Party-Memory-001',
        });
        expect(targetEntry).toMatchObject({
            STMB_canonical: false,
            STMB_canonicalLorebook: 'Group Book',
            STMB_canonicalEntryUid: primaryEntry.uid,
            STMB_canonicalMemoryNumber: 1,
        });
        expect(targetData.stlo).toMatchObject({
            onlyWhenSpeaking: true,
            characterOverrides: {
                alice: { priority: 3, orderAdjustment: 0 },
            },
        });
        expect(response.payload.entries[0]).not.toHaveProperty('content');
    });

    it('routes Narrator entries by stable IDs without native filters or STLO mutation', async () => {
        mockLoadedLorebooks();
        const response = makeResponse();

        await handler(makeNarratorRequest(), response);

        expect(response.statusCode).toBe(200);
        const primaryData = transactionSave.mock.calls[0][2];
        const targetData = transactionSave.mock.calls[1][2];
        const primaryEntry = Object.values(primaryData.entries)[0];
        const targetEntry = Object.values(targetData.entries)[0];
        expect(primaryEntry.STMB_narratorParticipantIds).toEqual(['alice-id']);
        expect(targetEntry.STMB_narratorOwnerIds).toEqual(['alice-id']);
        expect(primaryEntry).not.toHaveProperty('characterFilter');
        expect(targetEntry).not.toHaveProperty('characterFilter');
        expect(targetData).not.toHaveProperty('stlo');
        expect(JSON.stringify(response.payload)).not.toContain('alice-id');
    });

    it('rejects secure or inconsistent Narrator routing before reading lorebooks', async () => {
        const secureRequest = makeNarratorRequest();
        secureRequest.body.targets[0].storage = 'secure';
        const secureResponse = makeResponse();
        await handler(secureRequest, secureResponse);
        expect(secureResponse.statusCode).toBe(403);
        expect(getLorebookForManagement).not.toHaveBeenCalled();

        const invalidRequest = makeNarratorRequest();
        invalidRequest.body.targets[0].narratorOwnerIds = ['other-id'];
        const invalidResponse = makeResponse();
        await handler(invalidRequest, invalidResponse);
        expect(invalidResponse.statusCode).toBe(400);
        expect(getLorebookForManagement).not.toHaveBeenCalled();
    });

    it('rolls back a completed Narrator write after a partial failure', async () => {
        mockLoadedLorebooks();
        transactionSave
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('simulated write failure'))
            .mockResolvedValueOnce({});
        const response = makeResponse();
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await handler(makeNarratorRequest(), response);
        } finally {
            consoleSpy.mockRestore();
        }

        expect(transactionSave).toHaveBeenCalledTimes(3);
        expect(transactionSave.mock.calls[2][2]).toEqual({ entries: {} });
        expect(response.payload).toEqual({
            error: {
                type: 'StmbGroupMemoryWriteFailed',
                message: 'The group memory could not be saved.',
            },
        });
        expect(JSON.stringify(response.payload)).not.toContain('alice-id');
    });

    it('saves numeric scene boundaries for legacy JSONL chats without message UUIDs', async () => {
        resolveSqliteLogicalChatReference.mockResolvedValue({ sqliteMissing: true });
        resolveLogicalChatReference.mockResolvedValue({
            storageMode: 'jsonl',
            messages: Array.from({ length: 5 }, (_, index) => ({ mes: `Message ${index}` })),
        });
        mockLoadedLorebooks();
        const response = makeResponse();

        await handler(makeRequest(), response);

        expect(response.statusCode).toBe(200);
        expect(resolveLogicalChatReference).toHaveBeenCalledTimes(1);
        const primaryEntry = Object.values(transactionSave.mock.calls[0][2].entries)[0];
        expect(primaryEntry).toMatchObject({ STMB_start: 1, STMB_end: 4 });
        expect(primaryEntry).not.toHaveProperty('STMB_startUuid');
        expect(primaryEntry).not.toHaveProperty('STMB_endUuid');
    });

    it('allocates canonical numbers from managed memories, not unrelated or consolidated entries', async () => {
        getLorebookForManagement.mockImplementation((_user, name) => {
            if (name === 'Group Book') {
                return {
                    data: {
                        entries: {
                            0: { uid: 0, comment: '[999] Unrelated' },
                            1: { uid: 1, comment: '[500] Summary', stmemorybooks: true, stmbSummary: true },
                            2: { uid: 2, comment: '[004] Memory', stmemorybooks: true },
                        },
                    },
                    metadata: { name: 'Group Book', storage: 'user' },
                };
            }
            return { data: { entries: {} }, metadata: { name: 'Alice Book', storage: 'user' } };
        });
        const response = makeResponse();

        await handler(makeRequest(), response);

        expect(response.payload.canonicalNumber).toBe(5);
        const primaryEntry = Object.values(transactionSave.mock.calls[0][2].entries)
            .find(entry => entry.STMB_canonical === true);
        expect(primaryEntry.STMB_canonicalMemoryNumber).toBe(5);
    });

    it('rolls back completed writes and returns no generated content after a partial failure', async () => {
        mockLoadedLorebooks();
        transactionSave
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('simulated write failure'))
            .mockResolvedValueOnce({});
        const response = makeResponse();
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await handler(makeRequest(), response);
        } finally {
            consoleSpy.mockRestore();
        }

        expect(transactionSave).toHaveBeenCalledTimes(3);
        expect(transactionSave.mock.calls[2][2]).toEqual({ entries: {} });
        expect(response.statusCode).toBe(500);
        expect(response.payload).toEqual({
            error: {
                type: 'StmbGroupMemoryWriteFailed',
                message: 'The group memory could not be saved.',
            },
        });
        expect(JSON.stringify(response.payload)).not.toContain('The party arrived');
    });

    it('rejects aliases resolving to the same lorebook before mutation', async () => {
        getLorebookForManagement.mockImplementation((_user, name) => ({
            data: { entries: {} },
            metadata: { name: 'Canonical Book', storage: 'user', requested: name },
        }));
        const request = makeRequest();
        request.body.primary.lorebookName = 'Canonical Book';
        request.body.targets[0].lorebookName = 'Canonical Book?';
        const response = makeResponse();

        await handler(request, response);

        expect(response.statusCode).toBe(400);
        expect(response.payload.error.type).toBe('StmbDuplicateGroupLorebook');
        expect(transactionSave).not.toHaveBeenCalled();
    });
});
