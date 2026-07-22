import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

let tempRoot;
let user;
let worldsDirectory;
let deleteLorebookForManagement;
let hasLorebookForGeneration;
let listLorebooksForManagement;
let listOwnedStmbContextSourceEntries;
let promoteLorebook;
let readLorebookForGeneration;
let renameLorebookForManagement;
let saveLorebookForManagement;
let saveRecommendedChatSetup;

const templateName = 'LTM - Aiko - Blank';
const card = {
    data: {
        name: 'Aiko',
        extensions: { aikobots: { recommended_chat_setup_key: 'recommended-aiko-reservation' } },
    },
};

beforeAll(async () => {
    const utilModule = await import('../util.js');
    const configPath = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
        ? path.resolve(process.cwd(), 'config.yaml')
        : path.resolve(process.cwd(), '..', 'config.yaml');
    utilModule.setConfigFilePath(configPath);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lorebook-template-reservation-'));
    globalThis.DATA_ROOT = tempRoot;
    user = { profile: { handle: 'template-maker-test', name: 'Maker', admin: false } };
    const repositoryModule = await import('../lorebook-repository.js');
    const { getUserDirectories } = await import('../users.js');
    ({ listOwnedStmbContextSourceEntries } = await import('../stmb-context-settings.js'));
    ({ saveRecommendedChatSetup } = await import('../recommended-chat-setup.js'));
    ({
        deleteLorebookForManagement,
        hasLorebookForGeneration,
        listLorebooksForManagement,
        promoteLorebook,
        readLorebookForGeneration,
        renameLorebookForManagement,
        saveLorebookForManagement,
    } = repositoryModule);
    user.directories = getUserDirectories(user.profile.handle);
    worldsDirectory = user.directories.worlds;
});

beforeEach(() => {
    fs.rmSync(path.join(tempRoot, '_templates'), { recursive: true, force: true });
    fs.rmSync(path.join(tempRoot, '_secure'), { recursive: true, force: true });
    fs.rmSync(worldsDirectory, { recursive: true, force: true });
    fs.mkdirSync(worldsDirectory, { recursive: true });
    fs.writeFileSync(path.join(worldsDirectory, `${templateName}.json`), JSON.stringify({ entries: { 0: { uid: 0 } } }), 'utf8');
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('designated ordinary template lorebooks', () => {
    it('remains editable but blocks rename, deletion, promotion, generation, and STMB use', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: templateName,
            sidePromptSetKey: '',
        });

        const listItem = listLorebooksForManagement(user).find(item => item.name === templateName);
        expect(listItem).toMatchObject({
            storage: 'user',
            reservedTemplate: true,
            canEdit: true,
            canDelete: false,
            canPromote: false,
        });
        expect(readLorebookForGeneration(user, templateName, false)).toBeNull();
        expect(hasLorebookForGeneration(user, templateName)).toBe(false);
        expect(listOwnedStmbContextSourceEntries(user).map(item => item.lorebookName)).not.toContain(templateName);

        await expect(renameLorebookForManagement(user, templateName, 'LTM - Aiko - Other'))
            .rejects.toMatchObject({ type: 'LorebookReservedForTemplate', status: 409 });
        await expect(deleteLorebookForManagement(user, templateName))
            .rejects.toMatchObject({ type: 'LorebookReservedForTemplate', status: 409 });
        await expect(promoteLorebook(user, templateName))
            .rejects.toMatchObject({ type: 'LorebookReservedForTemplate', status: 409 });
        await expect(saveLorebookForManagement(user, templateName, { entries: { 1: { uid: 1 } } }, 'user'))
            .resolves.toBeDefined();
    });

    it('releases protection immediately when None is selected', async () => {
        await saveRecommendedChatSetup(user, card, {
            templateAction: 'replace',
            templateSourceName: templateName,
            sidePromptSetKey: '',
        });
        await saveRecommendedChatSetup(user, card, { templateAction: 'remove', sidePromptSetKey: '' });

        expect(listLorebooksForManagement(user).find(item => item.name === templateName)?.reservedTemplate).toBe(false);
        expect(readLorebookForGeneration(user, templateName, false)).toEqual({ entries: { 0: { uid: 0 } } });
        expect(hasLorebookForGeneration(user, templateName)).toBe(true);
    });

    it('returns secure LTM lorebooks to programming-lorebook naming rules', async () => {
        await expect(promoteLorebook(user, templateName))
            .rejects.toMatchObject({ type: 'LorebookNameInvalid', status: 400 });
    });

    it('keeps indexed secure lorebooks secure when a copied data directory loses symlinks', () => {
        const secureName = 'Z-template-maker-test-Programming';
        fs.writeFileSync(path.join(worldsDirectory, `${secureName}.json`), JSON.stringify({ entries: {} }), 'utf8');
        const secureDirectory = path.join(tempRoot, '_secure', 'worlds');
        fs.mkdirSync(secureDirectory, { recursive: true });
        fs.writeFileSync(path.join(secureDirectory, 'index.json'), JSON.stringify({
            version: 1,
            books: {
                [secureName]: {
                    ownerHandle: user.profile.handle,
                    createdBy: user.profile.handle,
                    updatedBy: user.profile.handle,
                },
            },
        }), 'utf8');

        expect(listLorebooksForManagement(user).find(item => item.name === secureName)).toMatchObject({
            storage: 'secure',
            ownerHandle: user.profile.handle,
            canPromote: false,
        });
    });
});
