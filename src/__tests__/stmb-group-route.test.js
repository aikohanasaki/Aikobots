import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const getLorebookForManagement = jest.fn();
const saveLorebookForManagement = jest.fn();
const transactionSave = jest.fn();
const assertLorebookCheckoutForManagement = jest.fn();
const isReservedRecommendedTemplateSource = jest.fn();

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
    resolveSqliteLogicalChatReference: jest.fn(),
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

beforeAll(async () => {
    const { router } = await import('../endpoints/stmb.js');
    handler = router.stack.find(layer => layer.route?.path === '/save-group-memory').route.stack[0].handle;
});

beforeEach(() => {
    getLorebookForManagement.mockReset();
    saveLorebookForManagement.mockReset();
    transactionSave.mockReset();
    assertLorebookCheckoutForManagement.mockReset();
    isReservedRecommendedTemplateSource.mockReset();
    isReservedRecommendedTemplateSource.mockReturnValue(false);
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

describe('STMB multi-lorebook group route', () => {
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
        expect(response.payload.entries[0]).not.toHaveProperty('content');
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
