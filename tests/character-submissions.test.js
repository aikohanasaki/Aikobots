import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { write } from '../src/character-card-parser.js';
import { getCharacterDistributionPolicy, setCharacterDistributionPolicy } from '../src/character-distribution-registry.js';
import { FAVORITES_FILE } from '../src/favorites-repository.js';
import { setConfigFilePath } from '../src/util.js';

const BASE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

function buildCard({ name = 'Bot', ownerHandle = 'owner', sharedCharacterKey = 'shared-bot', favorite = false } = {}) {
    return {
        data: {
            name,
            extensions: {
                fav: favorite,
                aikobots: {
                    owner_handle: ownerHandle,
                    shared_character_key: sharedCharacterKey,
                },
            },
        },
    };
}

function writeCard(filePath, card) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const buffer = write(Buffer.from(BASE_PNG, 'base64'), JSON.stringify(card));
    fs.writeFileSync(filePath, buffer);
    return buffer;
}

async function importCharacterSubmissionsModule(label) {
    return await import(`../src/character-submissions.js?${label}=${Date.now()}`);
}

describe('character submission distribution rollback', () => {
    let dataRoot;
    let defaultContentRoot;
    let previousDataRoot;
    let previousDefaultContentRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        previousDefaultContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-submissions-'));
        defaultContentRoot = path.join(dataRoot, 'default');
        globalThis.DATA_ROOT = dataRoot;
        globalThis.DEFAULT_CONTENT_ROOT = defaultContentRoot;
    });

    afterEach(() => {
        globalThis.DATA_ROOT = previousDataRoot;
        globalThis.DEFAULT_CONTENT_ROOT = previousDefaultContentRoot;
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    it('rolls back library copies, favorite migration, and policy when global publishing fails', async () => {
        const actingUserHandle = 'rollback-user';
        const sourcePath = path.join(dataRoot, 'uploads', 'Bot.png');
        const destinationPath = path.join(dataRoot, actingUserHandle, 'characters', 'Bot.png');
        const favoritesPath = path.join(dataRoot, actingUserHandle, FAVORITES_FILE);

        writeCard(sourcePath, buildCard());
        const previousDestination = writeCard(destinationPath, buildCard({
            name: 'Previous Bot',
            favorite: true,
        }));

        await setCharacterDistributionPolicy({
            ownerHandle: 'owner',
            characterKey: 'shared-bot',
            publishedFilename: 'Bot',
            blacklistHandles: [actingUserHandle],
            updatedBy: 'admin',
        });

        fs.mkdirSync(defaultContentRoot, { recursive: true });
        fs.writeFileSync(path.join(defaultContentRoot, 'characters'), 'not a directory', 'utf8');

        const { distributeCharacterFile, PUBLISH_MODES } = await importCharacterSubmissionsModule('rollback');

        await expect(distributeCharacterFile({
            sourcePath,
            publishedFilename: 'Bot',
            publishMode: PUBLISH_MODES.GLOBAL,
            actingUserHandle,
            sourceOwnerHandle: 'owner',
            applyBlacklist: false,
        })).rejects.toThrow();

        expect(fs.readFileSync(destinationPath)).toEqual(previousDestination);
        expect(fs.existsSync(favoritesPath)).toBe(false);

        const policy = await getCharacterDistributionPolicy({
            ownerHandle: 'owner',
            characterKey: 'shared-bot',
            publishedFilename: 'Bot',
        });
        expect(policy.adminBlacklistHandles).toEqual([actingUserHandle]);
    });

    it('rolls back distributed character files when setup publication fails', async () => {
        const actingUserHandle = 'rollback-user';
        const sourcePath = path.join(dataRoot, 'uploads', 'Bot.png');
        const destinationPath = path.join(dataRoot, actingUserHandle, 'characters', 'Bot.png');
        writeCard(sourcePath, buildCard({ name: 'New Bot' }));
        const previousDestination = writeCard(destinationPath, buildCard({ name: 'Previous Bot' }));
        const { distributeCharacterFile, PUBLISH_MODES } = await importCharacterSubmissionsModule('setupRollback');

        await expect(distributeCharacterFile({
            sourcePath,
            publishedFilename: 'Bot',
            publishMode: PUBLISH_MODES.SELECTED,
            targetHandles: [actingUserHandle],
            actingUserHandle,
            sourceOwnerHandle: 'owner',
            afterDistribution: async () => {
                throw new Error('Setup publication failed.');
            },
        })).rejects.toThrow('Setup publication failed.');

        expect(fs.readFileSync(destinationPath)).toEqual(previousDestination);
    });
});

describe('default content character deletion', () => {
    let dataRoot;
    let defaultContentRoot;
    let previousDataRoot;
    let previousDefaultContentRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        previousDefaultContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-default-content-delete-'));
        defaultContentRoot = path.join(dataRoot, 'default');
        globalThis.DATA_ROOT = dataRoot;
        globalThis.DEFAULT_CONTENT_ROOT = defaultContentRoot;
    });

    afterEach(() => {
        globalThis.DATA_ROOT = previousDataRoot;
        globalThis.DEFAULT_CONTENT_ROOT = previousDefaultContentRoot;
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    it('removes the catalog character file and matching index entry', async () => {
        const catalogPath = path.join(defaultContentRoot, 'characters', 'Bot.png');
        const indexPath = path.join(defaultContentRoot, 'index.json');
        writeCard(catalogPath, buildCard());
        fs.writeFileSync(indexPath, JSON.stringify([
            { filename: 'characters/Bot.png', type: 'character' },
            { filename: 'characters/Other.png', type: 'character' },
            { filename: 'worlds/Lore.json', type: 'world' },
        ], null, 4));

        const { deleteDefaultContentCharacter } = await importCharacterSubmissionsModule('deleteDefaultContent');

        await expect(deleteDefaultContentCharacter('Bot.png')).resolves.toEqual({
            removedFile: true,
            removedIndexEntry: true,
            removed: true,
        });

        expect(fs.existsSync(catalogPath)).toBe(false);
        expect(JSON.parse(fs.readFileSync(indexPath, 'utf8'))).toEqual([
            { filename: 'characters/Other.png', type: 'character' },
            { filename: 'worlds/Lore.json', type: 'world' },
        ]);
    });

    it('succeeds when the catalog file and index entry are already missing', async () => {
        const indexPath = path.join(defaultContentRoot, 'index.json');
        fs.mkdirSync(defaultContentRoot, { recursive: true });
        fs.writeFileSync(indexPath, JSON.stringify([
            { filename: 'characters/Other.png', type: 'character' },
        ], null, 4));

        const { deleteDefaultContentCharacter } = await importCharacterSubmissionsModule('deleteDefaultContentMissing');

        await expect(deleteDefaultContentCharacter('Bot.png')).resolves.toEqual({
            removedFile: false,
            removedIndexEntry: false,
            removed: false,
        });

        expect(JSON.parse(fs.readFileSync(indexPath, 'utf8'))).toEqual([
            { filename: 'characters/Other.png', type: 'character' },
        ]);
    });

    it('recreates a malformed index without failing deletion', async () => {
        const catalogPath = path.join(defaultContentRoot, 'characters', 'Bot.png');
        const indexPath = path.join(defaultContentRoot, 'index.json');
        writeCard(catalogPath, buildCard());
        fs.writeFileSync(indexPath, '{not json', 'utf8');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const { deleteDefaultContentCharacter } = await importCharacterSubmissionsModule('deleteDefaultContentMalformed');

        try {
            await expect(deleteDefaultContentCharacter('Bot.png')).resolves.toEqual({
                removedFile: true,
                removedIndexEntry: false,
                removed: true,
            });
        } finally {
            warnSpy.mockRestore();
        }

        expect(fs.existsSync(catalogPath)).toBe(false);
        expect(JSON.parse(fs.readFileSync(indexPath, 'utf8'))).toEqual([]);
    });

    it('rejects unsafe or non-png character filenames', async () => {
        const { deleteDefaultContentCharacter } = await importCharacterSubmissionsModule('deleteDefaultContentInvalid');

        await expect(deleteDefaultContentCharacter('../Bot.png')).rejects.toThrow('Invalid character file name.');
        await expect(deleteDefaultContentCharacter('Bot.jpg')).rejects.toThrow('Invalid character file name.');
    });
});

describe('character submission distribution defaults', () => {
    let dataRoot;
    let previousDataRoot;
    let previousDefaultContentRoot;

    beforeEach(() => {
        previousDataRoot = globalThis.DATA_ROOT;
        previousDefaultContentRoot = globalThis.DEFAULT_CONTENT_ROOT;
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-submission-defaults-'));
        globalThis.DATA_ROOT = dataRoot;
        globalThis.DEFAULT_CONTENT_ROOT = path.join(dataRoot, 'default');
    });

    afterEach(() => {
        globalThis.DATA_ROOT = previousDataRoot;
        globalThis.DEFAULT_CONTENT_ROOT = previousDefaultContentRoot;
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    it('prefills selected-user submissions from the current persisted whitelist', async () => {
        const {
            getExistingApprovedDistributionViewForSource,
            PUBLISH_MODES,
            SUBMISSION_STATUSES,
            writeSubmissionRecord,
        } = await importCharacterSubmissionsModule('defaultsWhitelist');
        const sourcePath = path.join(dataRoot, 'maker', 'characters', 'Bot.png');
        writeCard(sourcePath, buildCard({
            ownerHandle: 'maker',
            sharedCharacterKey: 'shared-bot',
        }));

        await writeSubmissionRecord({
            id: 'maker|Bot',
            status: SUBMISSION_STATUSES.APPROVED,
            ownerHandle: 'maker',
            ownerHandles: ['maker'],
            sharedCharacterKey: 'shared-bot',
            submittedAt: Date.now(),
            submittedFilename: 'Bot.png',
            reviewedAt: Date.now(),
            reviewedBy: 'admin',
            reviewNote: '',
            publishMode: PUBLISH_MODES.SELECTED,
            targetHandles: ['stale-user'],
            publishedFilename: 'Bot',
            adminQueueReason: '',
            requestedDistributionMode: 'whitelist',
            requestedTargetHandles: ['stale-user'],
            requestedBlacklistHandles: [],
            userBlacklistHandles: [],
        });

        await setCharacterDistributionPolicy({
            ownerHandle: 'maker',
            characterKey: 'shared-bot',
            publishedFilename: 'Bot',
            whitelistHandles: ['alpha', 'beta'],
            userBlacklistHandles: ['self-opt-out'],
            updatedBy: 'admin',
        });

        await expect(getExistingApprovedDistributionViewForSource({
            sourcePath,
            ownerHandle: 'maker',
            originalFilename: 'Bot.png',
        })).resolves.toMatchObject({
            requestedDistributionMode: 'whitelist',
            requestedTargetHandles: ['alpha', 'beta'],
            requestedBlacklistHandles: [],
            whitelistHandles: ['alpha', 'beta'],
            adminBlacklistHandles: [],
            userBlacklistHandles: [],
            hasWhitelist: true,
            hasAdminBlacklist: false,
            hasUserBlacklist: false,
        });
    });

    it('never treats private Recommended Chat Setup staging as a submission record', async () => {
        const {
            getSubmissionPaths,
            listSubmissionRecords,
            SUBMISSION_STATUSES,
            writeSubmissionRecord,
        } = await importCharacterSubmissionsModule('privateSetupStaging');
        const record = {
            id: 'maker|Bot',
            status: SUBMISSION_STATUSES.PENDING,
            ownerHandle: 'maker',
            ownerHandles: ['maker'],
            submittedAt: Date.now(),
            submittedFilename: 'Bot.png',
            reviewNote: '',
            targetHandles: [],
        };
        await writeSubmissionRecord(record);
        const { recommendedSetupPath } = getSubmissionPaths(record.id);
        fs.writeFileSync(recommendedSetupPath, JSON.stringify({ staged: true }));

        const records = await listSubmissionRecords();
        expect(records.map(item => item.id)).toEqual([record.id]);
    });

    it('prefills global blacklist submissions from the current persisted admin blacklist', async () => {
        const {
            getExistingApprovedDistributionViewForSource,
            PUBLISH_MODES,
            SUBMISSION_STATUSES,
            writeSubmissionRecord,
        } = await importCharacterSubmissionsModule('defaultsBlacklist');
        const sourcePath = path.join(dataRoot, 'maker', 'characters', 'Bot.png');
        writeCard(sourcePath, buildCard({
            ownerHandle: 'maker',
            sharedCharacterKey: 'shared-bot',
        }));

        await writeSubmissionRecord({
            id: 'maker|Bot',
            status: SUBMISSION_STATUSES.APPROVED,
            ownerHandle: 'maker',
            ownerHandles: ['maker'],
            sharedCharacterKey: 'shared-bot',
            submittedAt: Date.now(),
            submittedFilename: 'Bot.png',
            reviewedAt: Date.now(),
            reviewedBy: 'admin',
            reviewNote: '',
            publishMode: PUBLISH_MODES.GLOBAL,
            targetHandles: [],
            publishedFilename: 'Bot',
            adminQueueReason: '',
            requestedDistributionMode: 'global_blacklist',
            requestedTargetHandles: [],
            requestedBlacklistHandles: ['blocked-user'],
            userBlacklistHandles: [],
        });

        await setCharacterDistributionPolicy({
            ownerHandle: 'maker',
            characterKey: 'shared-bot',
            publishedFilename: 'Bot',
            blacklistHandles: ['blocked-user'],
            userBlacklistHandles: ['self-opt-out'],
            updatedBy: 'admin',
        });

        await expect(getExistingApprovedDistributionViewForSource({
            sourcePath,
            ownerHandle: 'maker',
            originalFilename: 'Bot.png',
        })).resolves.toMatchObject({
            requestedDistributionMode: 'global_blacklist',
            requestedTargetHandles: [],
            requestedBlacklistHandles: ['blocked-user'],
            whitelistHandles: [],
            adminBlacklistHandles: ['blocked-user'],
            userBlacklistHandles: [],
            hasWhitelist: false,
            hasAdminBlacklist: true,
            hasUserBlacklist: false,
        });
    });

    it('can include user self-enrolled blacklist handles in the admin distribution view', async () => {
        const {
            getExistingApprovedDistributionViewForSource,
            PUBLISH_MODES,
            SUBMISSION_STATUSES,
            writeSubmissionRecord,
        } = await importCharacterSubmissionsModule('defaultsUserBlacklist');
        const sourcePath = path.join(dataRoot, 'maker', 'characters', 'Bot.png');
        writeCard(sourcePath, buildCard({
            ownerHandle: 'maker',
            sharedCharacterKey: 'shared-bot',
        }));

        await writeSubmissionRecord({
            id: 'maker|Bot',
            status: SUBMISSION_STATUSES.APPROVED,
            ownerHandle: 'maker',
            ownerHandles: ['maker'],
            sharedCharacterKey: 'shared-bot',
            submittedAt: Date.now(),
            submittedFilename: 'Bot.png',
            reviewedAt: Date.now(),
            reviewedBy: 'admin',
            reviewNote: '',
            publishMode: PUBLISH_MODES.GLOBAL,
            targetHandles: [],
            publishedFilename: 'Bot',
            adminQueueReason: '',
            requestedDistributionMode: 'global_blacklist',
            requestedTargetHandles: [],
            requestedBlacklistHandles: ['blocked-user'],
            userBlacklistHandles: [],
        });

        await setCharacterDistributionPolicy({
            ownerHandle: 'maker',
            characterKey: 'shared-bot',
            publishedFilename: 'Bot',
            blacklistHandles: ['blocked-user'],
            userBlacklistHandles: ['self-opt-out'],
            updatedBy: 'admin',
        });

        await expect(getExistingApprovedDistributionViewForSource({
            sourcePath,
            ownerHandle: 'maker',
            originalFilename: 'Bot.png',
            includeUserBlacklist: true,
        })).resolves.toMatchObject({
            requestedDistributionMode: 'global_blacklist',
            adminBlacklistHandles: ['blocked-user'],
            userBlacklistHandles: ['self-opt-out'],
            hasAdminBlacklist: true,
            hasUserBlacklist: true,
        });
    });
});
