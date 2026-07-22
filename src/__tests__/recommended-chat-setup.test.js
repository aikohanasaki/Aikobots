import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const createUserLorebookForManagement = jest.fn();
const getLorebookForManagement = jest.fn();
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
    LorebookRepositoryError: MockLorebookRepositoryError,
}));

jest.unstable_mockModule('../character-linked-lorebooks.js', () => ({
    getCharacterOwnerHandles: () => characterOwners,
    getCharacterSharedKey: card => card.sharedKey,
}));

jest.unstable_mockModule('../stmb-side-prompts-repository.js', () => ({
    mutateStmbSidePrompts,
    readStmbSidePrompts,
}));

let applyRecommendedChatSetup;
let getRecommendedChatSetupManagement;
let getRecommendedChatSetupSummary;
let preflightRecommendedChatSetup;
let saveRecommendedChatSetup;
let tempRoot;
let sidePromptDocument;

const user = {
    profile: { handle: 'maker', name: 'Maker Name', admin: false },
};
const card = {
    sharedKey: 'shared-aiko',
    data: { name: 'Aiko', creator: 'Maker Name' },
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

beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recommended-chat-setup-'));
    globalThis.DATA_ROOT = tempRoot;
    ({
        applyRecommendedChatSetup,
        getRecommendedChatSetupManagement,
        getRecommendedChatSetupSummary,
        preflightRecommendedChatSetup,
        saveRecommendedChatSetup,
    } = await import('../recommended-chat-setup.js'));
});

beforeEach(() => {
    fs.rmSync(path.join(tempRoot, '_secure'), { recursive: true, force: true });
    createUserLorebookForManagement.mockReset();
    getLorebookForManagement.mockReset();
    readStmbSidePrompts.mockReset();
    mutateStmbSidePrompts.mockReset();
    characterOwners = ['maker'];
    sidePromptDocument = makeSourceSidePrompts();
    readStmbSidePrompts.mockImplementation(() => ({ document: structuredClone(sidePromptDocument), revision: 'one' }));
    mutateStmbSidePrompts.mockImplementation(async (_user, operation) => {
        sidePromptDocument = await operation(structuredClone(sidePromptDocument));
        return { document: structuredClone(sidePromptDocument), revision: 'two' };
    });
    getLorebookForManagement.mockImplementation((_user, name, _allowDummy, storage) => {
        if (storage === 'secure' && name === 'LTM - Aiko - Blank') {
            return { data: { entries: {} }, metadata: { storage: 'secure' } };
        }
        throw new MockLorebookRepositoryError('LorebookNotFound', 'Not found.', 404);
    });
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Recommended Chat Setup', () => {
    it('does not allow an ownerless character copy to replace a shared setup', async () => {
        characterOwners = [];
        await expect(saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: '',
        })).rejects.toMatchObject({ type: 'RecommendedSetupForbidden', status: 403 });
        expect(getLorebookForManagement).not.toHaveBeenCalled();
    });

    it.each(['LTM - Aiko - Blank', 'LTM-Aiko-Blank'])('accepts the supported secure template name %s', async templateSourceName => {
        if (templateSourceName === 'LTM-Aiko-Blank') {
            getLorebookForManagement.mockImplementation((_user, name, _allowDummy, storage) => {
                expect(storage).toBe('secure');
                if (name === templateSourceName) return { data: { entries: {} }, metadata: { storage } };
                throw new MockLorebookRepositoryError('LorebookNotFound', 'Not found.', 404);
            });
        }

        const summary = await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName,
            sidePromptSetKey: '',
        });

        expect(summary).toMatchObject({ available: true, hasTemplate: true, hasSidePrompts: false });
        expect(getLorebookForManagement).toHaveBeenCalledWith(user, templateSourceName, false, 'secure');
        expect(JSON.stringify(summary)).not.toContain('entries');
    });

    it('rejects non-matching lorebook names before reading any lorebook', async () => {
        await expect(saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Someone Else - Blank',
            sidePromptSetKey: '',
        })).rejects.toMatchObject({ type: 'RecommendedSetupTemplateNameInvalid', status: 400 });
        expect(getLorebookForManagement).not.toHaveBeenCalled();
    });

    it('copies an ordinary lorebook and installs side prompts under the character name', async () => {
        const saved = await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: 'LTM - Aiko - Blank',
            sidePromptSetKey: 'source',
        });
        const management = getRecommendedChatSetupManagement(user, card);
        const summary = getRecommendedChatSetupSummary(card);
        const preflight = preflightRecommendedChatSetup(user, card, 'Aiko Memory');

        expect(management).toEqual(expect.objectContaining({ hasTemplate: true, sidePromptSetKey: 'source' }));
        expect(JSON.stringify(management)).not.toContain('LTM - Aiko - Blank');
        expect(summary).toMatchObject({
            hasTemplate: true,
            hasSidePrompts: true,
            sidePromptSetName: 'Aiko',
            sidePromptCount: 1,
        });
        expect(preflight).toMatchObject({ lorebookConflict: false, sidePromptConflict: false });

        const result = await applyRecommendedChatSetup(user, card, {
            version: saved.version,
            installLorebook: true,
            lorebookName: 'Aiko Memory',
            installSidePrompts: true,
            sidePromptConflictMode: '',
        });

        expect(createUserLorebookForManagement).toHaveBeenCalledWith(
            user,
            'Aiko Memory',
            expect.objectContaining({ entries: {} }),
        );
        expect(result).toMatchObject({ lorebookName: 'Aiko Memory', sidePromptSetName: 'Aiko', sidePromptCount: 1 });
        const installedSet = sidePromptDocument.sets[result.sidePromptSetKey];
        expect(installedSet.name).toBe('Aiko');
        expect(sidePromptDocument.prompts[installedSet.items[0].promptKey].triggers.onAfterMemory.enabled).toBe(true);
    });

    it('keeps an existing character-named set when the user chooses Keep Existing', async () => {
        const saved = await saveRecommendedChatSetup(user, card, {
            templateAction: 'keep',
            sidePromptSetKey: 'source',
        });
        sidePromptDocument.sets.existing = {
            key: 'existing',
            name: 'Aiko',
            items: [],
        };

        const preflight = preflightRecommendedChatSetup(user, card, '');
        expect(preflight).toMatchObject({ sidePromptConflict: true, existingSidePromptSetKey: 'existing' });
        const result = await applyRecommendedChatSetup(user, card, {
            version: saved.version,
            installSidePrompts: true,
            sidePromptConflictMode: 'keep',
        });

        expect(result).toMatchObject({
            sidePromptSetKey: 'existing',
            sidePromptSetName: 'Aiko',
            sidePromptCount: 0,
            keptExistingSidePrompts: true,
        });
        expect(sidePromptDocument.sets.existing.items).toEqual([]);
    });
});
