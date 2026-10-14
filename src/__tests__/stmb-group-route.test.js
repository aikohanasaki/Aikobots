import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildSidePromptHistoryRequest, SIDE_PROMPT_HISTORY_KEY } from '../../public/scripts/stmb-sideprompt-history.js';
import { snapshotCombineSource } from '../../public/scripts/stmb-combine-clips-policy.js';

const getLorebookForManagement = jest.fn();
const saveLorebookForManagement = jest.fn();
const transactionSave = jest.fn();
const assertLorebookCheckoutForManagement = jest.fn();
const isReservedRecommendedTemplateSource = jest.fn();
const resolveLogicalChatReference = jest.fn();
const resolveSqliteLogicalChatReference = jest.fn();
const withChatSaveLock = jest.fn(async (_path, callback) => await callback());
let lorebookMutationQueue = Promise.resolve();

class MockLorebookRepositoryError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.type = type;
        this.status = status;
    }
}

jest.unstable_mockModule('../lorebook-repository.js', () => ({
    getCanonicalLorebookName: name => String(name).replace(/\?/g, '').replace(/\.json$/i, ''),
    assertLorebookCheckoutForManagement,
    getLorebookForManagement,
    LorebookRepositoryError: MockLorebookRepositoryError,
    saveLorebookForManagement,
    withLorebookManagementTransaction: operation => {
        const next = lorebookMutationQueue.then(() => operation({ save: transactionSave }));
        lorebookMutationQueue = next.catch(() => {});
        return next;
    },
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
let createEntryHandler;
let combineClipsHandler;
let updateEntryHandler;
let upsertEntryHandler;
let upsertBatchHandler;

beforeAll(async () => {
    const { router } = await import('../endpoints/stmb.js');
    handler = router.stack.find(layer => layer.route?.path === '/save-group-memory').route.stack[0].handle;
    syncHandler = router.stack.find(layer => layer.route?.path === '/sync-group-stlo').route.stack[0].handle;
    createEntryHandler = router.stack.find(layer => layer.route?.path === '/create-entry').route.stack[0].handle;
    combineClipsHandler = router.stack.find(layer => layer.route?.path === '/combine-clips').route.stack[0].handle;
    updateEntryHandler = router.stack.find(layer => layer.route?.path === '/update-entry-by-uid').route.stack[0].handle;
    upsertEntryHandler = router.stack.find(layer => layer.route?.path === '/upsert-entry-by-title').route.stack[0].handle;
    upsertBatchHandler = router.stack.find(layer => layer.route?.path === '/upsert-entries-batch').route.stack[0].handle;
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

describe('Combine Clips atomic save', () => {
    let stored;
    let request;
    beforeEach(() => {
        stored = { entries: {
            0: { uid: 0, comment: 'One [STMB Clip]', content: 'Synthetic one.', key: ['one', 'shared'], disable: false, custom: 'preserve' },
            1: { uid: 1, comment: 'Two [STMB Clip]', content: 'Synthetic two.', key: ['shared', 'two'], keysecondary: ['exclude'], disable: true, data: { extensions: { aikobots: { topical_clip: { version: 2 } } } } },
            2: { uid: 2, comment: 'Unrelated', content: 'Unrelated synthetic memory.', disable: false },
        } };
        request = makeRequest();
        request.body = {
            lorebookName: 'Synthetic Book', storage: 'user', title: 'Combined', draft: 'Reviewed synthetic draft.',
            sources: [stored.entries[0], stored.entries[1]].map(snapshotCombineSource), disableOriginals: true,
        };
        getLorebookForManagement.mockImplementation(async () => ({ data: structuredClone(stored), metadata: { name: 'Synthetic Book', storage: 'user' } }));
        transactionSave.mockImplementation(async (_user, _name, data) => { stored = structuredClone(data); return { name: 'Synthetic Book', storage: 'user' }; });
    });

    it.each([true, false])('creates a Topical Clip with disableOriginals=%s in a single save', async disableOriginals => {
        request.body.disableOriginals = disableOriginals;
        const before = structuredClone(stored);
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(200);
        expect(transactionSave).toHaveBeenCalledTimes(1);
        expect(getLorebookForManagement).toHaveBeenCalledWith(request.user, 'Synthetic Book', false, 'user');
        const entry = response.payload.entry;
        expect(entry).toMatchObject({ comment: 'Combined [STMB Clip]', key: ['one', 'shared', 'two'], keysecondary: [], constant: false, vectorized: true, selective: true, disable: false });
        expect(entry.content).toBe('=== Combined ===\n\nReviewed synthetic draft.\n\n=== END Combined ===');
        expect(entry.data.extensions.aikobots.topical_clip).toMatchObject({ version: 2, last_source_snapshot: [], last_message_source: null });
        expect(entry.data.extensions.aikobots.combined_clips).toMatchObject({ version: 1, source_uids: ['0', '1'] });
        expect(stored.entries[0]).toEqual({ ...before.entries[0], disable: disableOriginals });
        expect(stored.entries[1]).toEqual(before.entries[1]);
        expect(stored.entries[2]).toEqual(before.entries[2]);
    });

    it('renders a custom format and placement in the atomic save', async () => {
        request.body.format = '## {{TITLE}}\n{{CONTENT}}';
        request.body.title = 'Price $&';
        request.body.entrySettings = { enabled: true, position: 7, outletName: 'Notes', orderMode: 'manual', orderValue: 17 };
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(200);
        expect(response.payload.entry).toMatchObject({ position: 7, outletName: 'Notes', order: 17 });
        expect(response.payload.entry.content).toBe('## Price $&\nReviewed synthetic draft.');
        expect(response.payload.entry.data.extensions.aikobots.clip_format).toEqual({ template: request.body.format, title: 'Price $&' });
    });

    it.each([{ format: '{{TITLE}}' }, { entrySettings: { enabled: true, position: 7, outletName: '', orderMode: 'auto' } }])('rejects invalid format or placement before reading', async value => {
        Object.assign(request.body, value);
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(400);
        expect(getLorebookForManagement).not.toHaveBeenCalled();
    });

    it.each([
        { storage: 'secure' }, { storage: undefined }, { title: 'Bad\ntitle' }, { title: 'Bad === title' },
        { draft: ' ' }, { disableOriginals: 'true' }, { sources: [] }, { sources: [null, null] },
    ])('rejects malformed or protected requests before reading entries: %j', async overrides => {
        Object.assign(request.body, overrides);
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(400);
        expect(getLorebookForManagement).not.toHaveBeenCalled();
        expect(transactionSave).not.toHaveBeenCalled();
    });

    it('rejects reserved templates before reading entries', async () => {
        isReservedRecommendedTemplateSource.mockReturnValue(true);
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(400);
        expect(getLorebookForManagement).not.toHaveBeenCalled();
    });

    it('rejects repeated source identities and stale sources without mutations', async () => {
        const repeated = { ...request, body: structuredClone(request.body) };
        repeated.body.sources[1] = repeated.body.sources[0];
        const duplicateResponse = makeResponse();
        await combineClipsHandler(repeated, duplicateResponse);
        expect(duplicateResponse.statusCode).toBe(400);
        stored.entries[0].content = 'Changed synthetic source.';
        const before = structuredClone(stored);
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(409);
        expect(response.payload.error.type).toBe('StmbCombineSourcesChanged');
        expect(transactionSave).not.toHaveBeenCalled();
        expect(stored).toEqual(before);
    });

    it('serializes competing saves and rejects the duplicate title', async () => {
        const first = makeResponse();
        const second = makeResponse();
        await Promise.all([combineClipsHandler(request, first), combineClipsHandler(request, second)]);
        expect([first.statusCode, second.statusCode]).toEqual([200, 409]);
        expect(second.payload.error.type).toBe('StmbDuplicateEntryTitle');
        expect(transactionSave).toHaveBeenCalledTimes(1);
        expect(Object.values(stored.entries).filter(entry => entry.comment === 'Combined [STMB Clip]')).toHaveLength(1);
    });

    it('does not persist creation or disabling when the atomic save fails', async () => {
        const before = structuredClone(stored);
        transactionSave.mockRejectedValue(new Error('synthetic internal detail'));
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const response = makeResponse();
            await combineClipsHandler(request, response);
            expect(response.statusCode).toBe(500);
            expect(JSON.stringify(response.payload)).not.toContain('synthetic internal detail');
            expect(stored).toEqual(before);
            expect(log).toHaveBeenCalledWith('[STMB] Clip combination failed', 'Error');
        } finally { log.mockRestore(); }
    });

    it('rechecks the active session before committing', async () => {
        request.activeSessionOperation.assertAllowed.mockRejectedValue(Object.assign(new Error('Inactive session'), { status: 409, type: 'InactiveSession' }));
        const response = makeResponse();
        await combineClipsHandler(request, response);
        expect(response.statusCode).toBe(409);
        expect(transactionSave).not.toHaveBeenCalled();
    });
});

describe('Side Prompt version saves', () => {
    const template = { key: 'assess', name: 'Assess', settings: { saveAllVersions: true } };
    const scene = { chatId: 'Chat One', chatRef: { type: 'character', avatarUrl: 'alice.png', fileName: 'Chat One' } };
    const history = () => buildSidePromptHistoryRequest(template, { moduleSettings: { sidePromptVersioningEnabled: true } }, scene, 'Assess', ['Assess (STMB SidePrompt)']);
    const item = (overrides = {}) => ({ title: 'Assess (STMB SidePrompt)', content: 'Next output', defaults: { order: 42 }, sidePromptHistory: history(), ...overrides });
    let book;

    beforeEach(() => {
        book = { entries: {} };
        getLorebookForManagement.mockImplementation(() => ({ data: structuredClone(book), metadata: { name: 'Book', storage: 'user' } }));
        transactionSave.mockImplementation(async (_user, name, data) => {
            book = structuredClone(data);
            return { name, storage: 'user' };
        });
    });

    async function save(value = item(), batch = false) {
        const response = makeResponse();
        await (batch ? upsertBatchHandler : upsertEntryHandler)(makeRequest({ body: {
            lorebookName: 'Book', storage: 'user', ...(batch ? { items: value } : value),
        } }), response);
        return response;
    }

    it('adopts the existing output, archives versions, and updates latest when switched off', async () => {
        book.entries[5] = { uid: 5, comment: 'Assess (STMB SidePrompt)', content: 'Original', order: 42, disable: false };
        const first = await save();
        expect(first.statusCode).toBe(200);
        expect(first.payload.entry.comment).toBe('Assess-002 (STMB SidePrompt)');
        expect(book.entries[5]).toMatchObject({ content: 'Original', comment: 'Assess-001 (STMB SidePrompt)', disable: true, order: 42, group: 'Assess-ChatOne' });
        const second = await save(item({ content: 'Changed latest', sidePromptHistory: { ...history(), append: false } }));
        expect(second.payload.created).toBe(false);
        expect(second.payload.entry.uid).toBe(first.payload.entry.uid);
        expect(Object.values(book.entries)).toHaveLength(2);
        const third = await save();
        expect(third.payload.entry.comment).toBe('Assess-003 (STMB SidePrompt)');
        expect(Object.values(book.entries).filter(entry => !entry.disable)).toHaveLength(1);
        expect(Object.values(book.entries).every(entry => entry.order === 42 && entry.group === 'Assess-ChatOne')).toBe(true);
    });

    it('allocates sequential versions within a batch and keeps chats with identical titles separate', async () => {
        const response = await save([item(), item({ content: 'Second' })], true);
        expect(response.statusCode).toBe(200);
        expect(response.payload.results.map(result => result.entry.comment)).toEqual(['Assess-001 (STMB SidePrompt)', 'Assess-002 (STMB SidePrompt)']);
        const other = history();
        other.chatKey = JSON.stringify(['character', 'bob.png', scene.chatId]);
        const another = await save(item({ sidePromptHistory: other }));
        expect(another.payload.entry.comment).toBe('Assess-001 (STMB SidePrompt)');
        expect(Object.values(book.entries).filter(entry => !entry.disable)).toHaveLength(2);
    });

    it('reads and allocates inside the transaction when single and batch saves compete', async () => {
        const responses = await Promise.all([save(), save([item(), item()], true), save()]);
        expect(responses.every(response => response.statusCode === 200)).toBe(true);
        const versions = Object.values(book.entries).sort((a, b) => a[SIDE_PROMPT_HISTORY_KEY].sequence - b[SIDE_PROMPT_HISTORY_KEY].sequence);
        expect(versions.map(entry => entry[SIDE_PROMPT_HISTORY_KEY].sequence)).toEqual([1, 2, 3, 4]);
        expect(versions.map(entry => entry.disable)).toEqual([true, true, true, false]);
    });

    it('does not change persistent history on blank, ambiguous, invalid, or failed saves', async () => {
        await save();
        const original = structuredClone(book);
        expect((await save(item({ content: '  ' }))).statusCode).toBe(400);
        expect((await save(item({ sidePromptHistory: { ...history(), append: 'yes' } }))).statusCode).toBe(400);
        expect((await save(item({ metadataUpdates: { [SIDE_PROMPT_HISTORY_KEY]: {} } }))).statusCode).toBe(400);
        transactionSave.mockRejectedValueOnce(Object.assign(new Error('Save unavailable'), { status: 503 }));
        expect((await save()).statusCode).toBe(503);
        expect(book).toEqual(original);
        book = { entries: { 1: { uid: 1, comment: item().title }, 2: { uid: 2, comment: item().title } } };
        const ambiguous = structuredClone(book);
        expect((await save()).statusCode).toBe(409);
        expect(book).toEqual(ambiguous);
        book = original;
        expect((await save([item(), item({ content: ' ' })], true)).statusCode).toBe(400);
        expect(book).toEqual(original);
    });

    it('keeps old callers and unversioned output behavior compatible', async () => {
        const first = await save(item({ sidePromptHistory: undefined }));
        const second = await save(item({ content: 'Replacement', sidePromptHistory: { ...history(), append: false } }));
        expect(second.payload.entry.uid).toBe(first.payload.entry.uid);
        expect(second.payload.entry.comment).toBe(item().title);
        expect(second.payload.entry[SIDE_PROMPT_HISTORY_KEY]).toBeUndefined();
    });
});

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
    it('preserves matching Clip format metadata and clears it after an unrelated content replacement', async () => {
        const format = '## {{TITLE}}\n{{CONTENT}}';
        const entry = { uid: 1, comment: 'Topic [STMB Clip]', content: '## Topic\nOriginal', data: { extensions: { aikobots: { clip_format: { template: format, title: 'Topic' }, topical_clip: { version: 2 } } } } };
        getLorebookForManagement.mockImplementation(async () => ({ data: { entries: { 1: structuredClone(entry) } }, metadata: { name: 'Book', storage: 'user' } }));
        transactionSave.mockResolvedValue({ name: 'Book', storage: 'user' });
        const request = makeRequest({ body: { lorebookName: 'Book', storage: 'user', uid: 1, content: '## Topic\nUpdated', clipFormat: { template: format, title: 'Topic' } } });
        const formatted = makeResponse();
        await updateEntryHandler(request, formatted);
        expect(formatted.statusCode).toBe(200);
        expect(formatted.payload.entry.data.extensions.aikobots.clip_format.title).toBe('Topic');
        request.body.content = 'Compacted without wrapper';
        delete request.body.clipFormat;
        const compacted = makeResponse();
        await updateEntryHandler(request, compacted);
        expect(compacted.statusCode).toBe(200);
        expect(compacted.payload.entry.data.extensions.aikobots.clip_format).toBeUndefined();
        expect(compacted.payload.entry.data.extensions.aikobots.topical_clip.version).toBe(2);
    });
    it('rejects disabled-state changes before Topical Clip updates', async () => {
        const entry = { uid: 1, comment: 'Topic [STMB Clip]', content: 'Original', disable: true, data: { extensions: { aikobots: { topical_clip: { version: 2 } } } } };
        getLorebookForManagement.mockResolvedValue({ data: { entries: { 1: structuredClone(entry) } }, metadata: { name: 'Book', storage: 'user' } });
        const request = makeRequest({ body: { lorebookName: 'Book', storage: 'user', uid: 1, content: 'Replacement', expectedDisabled: false, entryOverrides: { disable: false } } });
        const response = makeResponse();
        await updateEntryHandler(request, response);
        expect(response.statusCode).toBe(409);
        expect(response.payload.error.type).toBe('StmbEntryDisabledChanged');
        expect(transactionSave).not.toHaveBeenCalled();
        delete request.body.expectedDisabled;
        const legacy = makeResponse();
        await updateEntryHandler(request, legacy);
        expect(legacy.statusCode).toBe(409);
        request.body.expectedDisabled = true;
        const explicit = makeResponse();
        await updateEntryHandler(request, explicit);
        expect(explicit.statusCode).toBe(200);
    });
    it.each(['create', 'update'])('validates and persists Clip placement on %s', async mode => {
        const existing = { uid: 1, comment: 'Old Clip', content: 'Original ordinary content', order: 100, position: 1, key: ['topic'] };
        getLorebookForManagement.mockResolvedValue({ data: { entries: mode === 'update' ? { 1: structuredClone(existing) } : {} }, metadata: { name: 'Book', storage: 'user' } });
        transactionSave.mockResolvedValue({ name: 'Book', storage: 'user' });
        const request = makeRequest({ body: { lorebookName: 'Book', storage: 'user', uid: 1, title: 'New Clip', content: 'Updated ordinary content', entryOverrides: { order: 0, position: 0 } } });
        const response = makeResponse();
        const route = mode === 'create' ? createEntryHandler : updateEntryHandler;
        await route(request, response);
        expect(response.statusCode).toBe(200);
        const entries = Object.values(transactionSave.mock.calls[0][2].entries);
        expect(entries[0].order).toBe(0);
        expect(entries[0].position).toBe(0);
        if (mode === 'update') expect(entries[0].key).toEqual(existing.key);
        transactionSave.mockClear();
        request.body.entryOverrides.order = -1;
        const invalid = makeResponse();
        await route(request, invalid);
        expect(invalid.statusCode).toBe(400);
        expect(transactionSave).not.toHaveBeenCalled();
    });
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

    it('saves canonical and character roles sharing a normalized book in one write', async () => {
        getLorebookForManagement.mockImplementation((_user, name) => ({
            data: { entries: {} },
            metadata: { name: 'Canonical Book', storage: 'user', requested: name },
        }));
        const request = makeRequest();
        request.body.primary.lorebookName = 'Canonical Book';
        request.body.targets[0].lorebookName = 'Canonical Book?';
        const response = makeResponse();

        await handler(request, response);

        expect(response.statusCode).toBe(200);
        expect(transactionSave).toHaveBeenCalledTimes(1);
        const entries = Object.values(transactionSave.mock.calls[0][2].entries);
        expect(entries.map(entry => entry.STMB_memoryRole)).toEqual(['group', 'character']);
        expect(entries[1].STMB_canonicalEntryUid).toBe(entries[0].uid);
        expect(entries[1].group).toBe(entries[0].group);
    });
});
