import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const createUserLorebookForManagement = jest.fn();
const getLorebookForManagement = jest.fn();
const listLorebooksForManagement = jest.fn();
const readStmbSidePrompts = jest.fn();
const mutateStmbSidePrompts = jest.fn();
let characterOwners = ['maker'];

class MockLorebookRepositoryError extends Error {
    constructor(type, message, status = 400) {
        super(message);
        this.type = type;
        this.status = status;
    }
}

jest.unstable_mockModule('../lorebook-repository.js', () => ({
    createUserLorebookForManagement,
    getLorebookForManagement,
    listLorebooksForManagement,
    LorebookRepositoryError: MockLorebookRepositoryError,
    withLorebookManagementTransaction: operation => operation({}),
}));

jest.unstable_mockModule('../character-linked-lorebooks.js', () => ({
    getCharacterOwnerHandles: () => characterOwners,
    getRecommendedChatSetupKey: card => card?.data?.extensions?.aikobots?.recommended_chat_setup_key || '',
}));

jest.unstable_mockModule('../stmb-side-prompts-repository.js', () => ({
    mutateStmbSidePrompts,
    readStmbSidePrompts,
}));

let applyRecommendedChatSetup;
let getRecommendedChatSetupManagement;
let getRecommendedChatSetupSummary;
let preflightRecommendedChatSetup;
let publishStagedRecommendedChatSetup;
let saveRecommendedChatSetup;
let stageRecommendedChatSetupForSubmission;
let tempRoot;
let sidePromptDocument;
let templateData;

const user = { profile: { handle: 'maker', name: 'Maker Name', admin: false } };
const card = {
    data: {
        name: 'Aiko',
        creator: 'Maker Name',
        extensions: { aikobots: { recommended_chat_setup_key: 'recommended-aiko' } },
    },
};

function makeSourceSidePrompts() {
    return {
        version: 2,
        prompts: {
            plot: {
                key: 'plot',
                name: 'Plot',
                enabled: true,
                prompt: 'Summarize plot changes.',
                settings: {},
                triggers: { onAfterMemory: { enabled: true }, commands: ['sideprompt'] },
            },
        },
        sets: {
            source: {
                key: 'source',
                name: 'Source Name',
                items: [{ id: 'one', promptKey: 'plot', label: '', runtimeMacros: {} }],
            },
        },
    };
}

async function publishDraft() {
    const stagingPath = path.join(tempRoot, 'submission.recommended-setup.json');
    stageRecommendedChatSetupForSubmission(user, card, stagingPath);
    await publishStagedRecommendedChatSetup(stagingPath);
}

function expectSyncError(operation, expected) {
    try {
        operation();
    } catch (error) {
        expect(error).toMatchObject(expected);
        return;
    }
    throw new Error('Expected operation to throw.');
}

beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recommended-chat-setup-'));
    globalThis.DATA_ROOT = tempRoot;
    ({
        applyRecommendedChatSetup,
        getRecommendedChatSetupManagement,
        getRecommendedChatSetupSummary,
        preflightRecommendedChatSetup,
        publishStagedRecommendedChatSetup,
        saveRecommendedChatSetup,
        stageRecommendedChatSetupForSubmission,
    } = await import('../recommended-chat-setup.js'));
});

beforeEach(() => {
    fs.rmSync(path.join(tempRoot, '_templates'), { recursive: true, force: true });
    createUserLorebookForManagement.mockReset();
    getLorebookForManagement.mockReset();
    listLorebooksForManagement.mockReset();
    readStmbSidePrompts.mockReset();
    mutateStmbSidePrompts.mockReset();
    characterOwners = ['maker'];
    listLorebooksForManagement.mockReturnValue([
        { name: 'LTM - Aiko - Blank', storage: 'user' },
        { name: 'LTM-Aiko-BLANK', storage: 'user' },
        { name: 'ltm - Aiko - Blank', storage: 'user' },
        { name: 'LTM - Someone Else - Blank', storage: 'user' },
        { name: 'LTM - Aiko - Blank', storage: 'secure' },
    ]);
    sidePromptDocument = makeSourceSidePrompts();
    templateData = { entries: {} };
    readStmbSidePrompts.mockImplementation(() => ({ document: structuredClone(sidePromptDocument), revision: 'one' }));
    mutateStmbSidePrompts.mockImplementation(async (_user, operation) => {
        sidePromptDocument = await operation(structuredClone(sidePromptDocument));
        return { document: structuredClone(sidePromptDocument), revision: 'two' };
    });
    getLorebookForManagement.mockImplementation((_user, name, _allowDummy, storage) => {
        if (storage === 'user' && ['LTM - Aiko - Blank', 'LTM-Aiko-BLANK'].includes(name)) {
            return { data: structuredClone(templateData), metadata: { storage: 'user' } };
        }
        throw new MockLorebookRepositoryError('LorebookNotFound', 'Not found.', 404);
    });
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Recommended Chat Setup drafts and publication', () => {
    it('allows first configuration before submission but rejects a different owner', async () => {
        characterOwners = [];
        await expect(saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: '',
        })).resolves.toMatchObject({ available: true, templateSourceName: 'LTM - Aiko - Blank' });

        characterOwners = ['someone-else'];
        await expect(saveRecommendedChatSetup(user, card, {
            templateAction: 'remove',
            sidePromptSetKey: '',
        })).rejects.toMatchObject({ type: 'RecommendedSetupForbidden', status: 403 });
    });

    it.each(['LTM - Aiko - Blank', 'LTM-Aiko-BLANK'])('accepts the ordinary template name %s', async templateSourceName => {
        const saved = await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName,
            sidePromptSetKey: '',
        });

        expect(saved).toMatchObject({ available: true, templateSourceName });
        expect(getLorebookForManagement).toHaveBeenCalledWith(user, templateSourceName, false, 'user');
        expect(getRecommendedChatSetupSummary(card)).toEqual({ available: false });
    });

    it('does not authorize management when another owner copies the opaque key', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: '',
        });
        characterOwners = ['intruder'];
        const intruder = { profile: { handle: 'intruder', name: 'Intruder', admin: false } };

        expectSyncError(
            () => getRecommendedChatSetupManagement(intruder, card),
            { type: 'RecommendedSetupForbidden' },
        );
    });

    it.each(['ltm - Aiko - Blank', 'LTM - Someone Else - Blank', 'LTM - Aiko - Blank Copy'])('rejects invalid name %s', async templateSourceName => {
        await expect(saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName,
            sidePromptSetKey: '',
        })).rejects.toMatchObject({ type: 'RecommendedSetupTemplateNameInvalid', status: 400 });
    });

    it('exposes the exact draft source only through management and publishes submission snapshots', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: 'source',
        });

        const management = getRecommendedChatSetupManagement(user, card);
        expect(management).toMatchObject({
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: 'source',
            eligibleTemplateNames: ['LTM - Aiko - Blank', 'LTM-Aiko-BLANK'],
        });
        expect(getRecommendedChatSetupSummary(card)).toEqual({ available: false });

        await publishDraft();
        const summary = getRecommendedChatSetupSummary(card);
        expect(summary).toMatchObject({
            available: true,
            hasTemplate: true,
            hasSidePrompts: true,
            sidePromptSetName: 'Aiko',
            sidePromptCount: 1,
        });
        expect(summary).not.toHaveProperty('templateSourceName');

        const result = await applyRecommendedChatSetup(user, card, {
            revision: summary.revision,
            installLorebook: true,
            lorebookName: 'Aiko Memory',
            installSidePrompts: true,
            sidePromptConflictMode: '',
        });
        expect(createUserLorebookForManagement).toHaveBeenCalledWith(user, 'Aiko Memory', expect.objectContaining({ entries: {} }));
        expect(result).toMatchObject({ lorebookName: 'Aiko Memory', sidePromptSetName: 'Aiko', sidePromptCount: 1 });
    });

    it('keeps the published setup pending removal and deletes it only when removal is approved', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: 'source',
        });
        await publishDraft();
        expect(getRecommendedChatSetupSummary(card).available).toBe(true);

        await saveRecommendedChatSetup(user, card, { templateAction: 'remove', sidePromptSetKey: '' });
        expect(getRecommendedChatSetupManagement(user, card).templateSourceName).toBe('');
        expect(getRecommendedChatSetupSummary(card).available).toBe(true);

        await publishDraft();
        expect(getRecommendedChatSetupSummary(card)).toEqual({ available: false });
    });

    it('publishes side-prompts-only removal without retaining the template', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: 'source',
        });
        await publishDraft();
        await saveRecommendedChatSetup(user, card, { templateAction: 'remove', sidePromptSetKey: 'source' });
        await publishDraft();

        expect(getRecommendedChatSetupSummary(card)).toMatchObject({
            available: true,
            hasTemplate: false,
            hasSidePrompts: true,
        });
    });

    it('keeps the approved revision until a changed resubmission is published', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: '',
        });
        await publishDraft();
        const firstRevision = getRecommendedChatSetupSummary(card).revision;
        templateData = { entries: { 1: { uid: 1 } } };
        const stagingPath = path.join(tempRoot, 'changed.recommended-setup.json');
        stageRecommendedChatSetupForSubmission(user, card, stagingPath);
        expect(getRecommendedChatSetupSummary(card).revision).toBe(firstRevision);

        await publishStagedRecommendedChatSetup(stagingPath);
        expect(getRecommendedChatSetupSummary(card).revision).not.toBe(firstRevision);
    });

    it('blocks submission when a selected side-prompt source is later deleted', async () => {
        await saveRecommendedChatSetup(user, card, { templateAction: 'keep', sidePromptSetKey: 'source' });
        delete sidePromptDocument.sets.source;

        expectSyncError(
            () => stageRecommendedChatSetupForSubmission(user, card, path.join(tempRoot, 'missing-side-prompts.json')),
            { type: 'RecommendedSetupSidePromptsMissing' },
        );
    });

    it('blocks submission after a character rename until a newly matching source is selected', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: '',
        });
        await publishDraft();
        const renamed = structuredClone(card);
        renamed.data.name = 'Renamed Aiko';

        expect(getRecommendedChatSetupSummary(renamed).available).toBe(true);
        expectSyncError(
            () => stageRecommendedChatSetupForSubmission(user, renamed, path.join(tempRoot, 'renamed.json')),
            { type: 'RecommendedSetupTemplateNameInvalid' },
        );
    });

    it('preserves side-prompt conflict handling', async () => {
        await saveRecommendedChatSetup(user, card, { templateAction: 'keep', sidePromptSetKey: 'source' });
        await publishDraft();
        sidePromptDocument.sets.existing = { key: 'existing', name: 'Aiko', items: [] };
        const preflight = preflightRecommendedChatSetup(user, card, '');
        expect(preflight).toMatchObject({ sidePromptConflict: true, existingSidePromptSetKey: 'existing' });

        const result = await applyRecommendedChatSetup(user, card, {
            revision: preflight.revision,
            installSidePrompts: true,
            sidePromptConflictMode: 'keep',
        });
        expect(result).toMatchObject({ sidePromptSetKey: 'existing', keptExistingSidePrompts: true });
    });
});
