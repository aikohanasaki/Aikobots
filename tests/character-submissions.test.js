import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

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

        const { distributeCharacterFile, PUBLISH_MODES } = await import(`../src/character-submissions.js?rollback=${Date.now()}`);

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
});
