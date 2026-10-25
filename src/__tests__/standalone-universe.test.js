import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';

let root;
let previousRoot;
let repo;
let endpoint;
let owner;
let viewer;
let admin;
const singleName = 'Z-universe-owner-test-Synthetic';
const sharedName = 'Y-Synthetic Universe';
const content = 'SYNTHETIC_PROTECTED_UNIVERSE_ENTRY';
let secureIndexPath;
let sharedIndexPath;

function isGlobalLorebookAllowed(user, name) {
    return repo.filterGlobalLorebookNames(user, [name]).includes(name);
}

beforeAll(async () => {
    previousRoot = globalThis.DATA_ROOT;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-universe-'));
    globalThis.DATA_ROOT = root;
    repo = await import('../lorebook-repository.js');
    endpoint = await import('../endpoints/worldinfo.js');
    const { getUserDirectories } = await import('../users.js');
    const makeUser = (handle, isAdmin = false) => ({ profile: { handle, admin: isAdmin }, directories: getUserDirectories(handle) });
    owner = makeUser('universe-owner-test');
    viewer = makeUser('universe-viewer-test');
    admin = makeUser('universe-admin-test', true);
    secureIndexPath = path.join(root, '_secure', 'worlds', 'index.json');
    sharedIndexPath = path.join(root, '_secure', 'shared-worlds', 'index.json');
});

beforeEach(() => {
    for (const directory of [path.dirname(secureIndexPath), path.dirname(sharedIndexPath), owner.directories.worlds, viewer.directories.worlds]) {
        fs.mkdirSync(directory, { recursive: true });
    }
    const book = JSON.stringify({ entries: { 0: { uid: 0, content, constant: true } } });
    fs.writeFileSync(path.join(owner.directories.worlds, `${singleName}.json`), book);
    fs.writeFileSync(path.join(root, '_secure', 'shared-worlds', `${sharedName}.json`), book);
    fs.writeFileSync(secureIndexPath, JSON.stringify({ version: 1, books: { [singleName]: { ownerHandle: owner.profile.handle } } }));
    fs.writeFileSync(sharedIndexPath, JSON.stringify({ version: 1, books: { [sharedName]: { owners: [owner.profile.handle, 'second-owner-test'] } } }));
    fs.rmSync(path.join(viewer.directories.worlds, `${singleName}.json`), { force: true });
});

afterAll(() => {
    globalThis.DATA_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
});

async function request(route, user, body = {}, target = endpoint) {
    const layer = target.router.stack.find(layer => layer.route?.path === route);
    let status = 200;
    let payload;
    const response = {
        status(code) { status = code; return this; },
        send(value) { payload = value; return this; },
        json(value) { payload = value; return this; },
        sendStatus(code) { status = code; return this; },
    };
    await layer.route.stack.at(-1).handle({ user, body }, response);
    return { status, payload };
}

it('publishes only a name while management and entry responses stay protected', async () => {
    expect(repo.listStandaloneUniverseNames()).toEqual([]);
    await repo.setStandaloneUniverse(owner, singleName, true);
    const { status, payload } = await request('/list', viewer);
    expect(status).toBe(200);
    expect(payload.standalone_universe_names).toEqual([singleName]);
    expect(payload.world_names).toEqual([]);
    expect(payload.world_info_items).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(content);
    expect((await request('/get', viewer, { name: singleName, storage: 'secure' })).status).toBe(404);
    const sorted = await request('/sorted-entries', viewer, { selectedWorldInfo: [singleName] });
    expect(sorted.status).toBe(200);
    expect(JSON.stringify(sorted.payload)).not.toContain(content);
    expect(repo.listLorebooksForManagement(owner).find(book => book.name === singleName).standaloneUniverse).toBe(true);
});

it('validates designation and enforces ownership and shared checkout', async () => {
    expect((await request('/standalone-universe', viewer, { name: singleName, enabled: true })).status).toBe(404);
    expect((await request('/standalone-universe', owner, { name: singleName, enabled: 'true' })).status).toBe(400);
    await expect(repo.setStandaloneUniverse(owner, sharedName, true)).rejects.toMatchObject({ status: 423 });
    await repo.checkoutSharedLorebook(owner, sharedName);
    await repo.setStandaloneUniverse(owner, sharedName, true);
    await repo.saveLorebookForManagement(owner, sharedName, { entries: {} }, 'secure');
    await repo.updateSharedLorebookOwners(owner, sharedName, [owner.profile.handle, 'third-owner-test']);
    expect(repo.listStandaloneUniverseNames()).toEqual([sharedName]);
    await repo.setStandaloneUniverse(admin, singleName, true);
    expect(repo.listStandaloneUniverseNames()).toContain(singleName);
});

it('withdraws only ordinary global use before claiming character bindings', async () => {
    expect(isGlobalLorebookAllowed(viewer, singleName)).toBe(true);
    await repo.setStandaloneUniverse(owner, singleName, false);
    expect(JSON.parse(fs.readFileSync(secureIndexPath)).books[singleName]).not.toHaveProperty('standaloneUniverse');
    await repo.setStandaloneUniverse(owner, singleName, true);
    await repo.setStandaloneUniverse(owner, singleName, false);
    expect(repo.listStandaloneUniverseNames()).toEqual([]);
    expect(isGlobalLorebookAllowed(viewer, singleName)).toBe(false);
    expect(isGlobalLorebookAllowed(owner, singleName)).toBe(true);
    expect(isGlobalLorebookAllowed(admin, singleName)).toBe(true);
    const onlyGlobal = await endpoint.resolveSortedEntriesPayload(viewer, { selectedWorldInfo: [singleName] }, { getHiddenBooks: () => [] });
    expect(onlyGlobal.entries).toEqual([]);
    const character = await endpoint.resolveSortedEntriesPayload(viewer, { selectedWorldInfo: [singleName], characterWorld: singleName }, { getHiddenBooks: () => [] });
    expect(character.entries).toHaveLength(1);
    expect(character.entries[0].lorebookSource).toBe('character');
    fs.writeFileSync(path.join(viewer.directories.worlds, `${singleName}.json`), JSON.stringify({ entries: {} }));
    expect(isGlobalLorebookAllowed(viewer, singleName)).toBe(true);
});

it('blocks withdrawn legacy secure names while preserving owner access', () => {
    fs.writeFileSync(secureIndexPath, JSON.stringify({ books: {
        [`${singleName}.json`]: { ownerHandle: owner.profile.handle, standaloneUniverse: false },
    } }));
    expect(isGlobalLorebookAllowed(viewer, singleName)).toBe(false);
    expect(isGlobalLorebookAllowed(owner, singleName)).toBe(true);
});

it('keeps the canonical designation when a legacy secure entry conflicts', () => {
    fs.writeFileSync(secureIndexPath, JSON.stringify({ books: {
        [singleName]: { ownerHandle: owner.profile.handle, standaloneUniverse: false },
        [`${singleName}.json`]: { ownerHandle: owner.profile.handle, standaloneUniverse: true },
    } }));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        expect(repo.listStandaloneUniverseNames()).toEqual([]);
        expect(isGlobalLorebookAllowed(viewer, singleName)).toBe(false);
    } finally {
        warning.mockRestore();
    }
});

it('uses shared-reader normalization when filtering withdrawn names', () => {
    fs.writeFileSync(sharedIndexPath, JSON.stringify({ books: {
        [` ${sharedName} `]: { owners: [owner.profile.handle], standaloneUniverse: false },
    } }));
    expect(isGlobalLorebookAllowed(viewer, sharedName)).toBe(false);
});

it('preserves designation on edits and clears it on demotion', async () => {
    await repo.setStandaloneUniverse(owner, singleName, true);
    await repo.saveLorebookForManagement(owner, singleName, { entries: {} }, 'secure');
    expect(repo.listStandaloneUniverseNames()).toContain(singleName);
    await repo.demoteLorebook(owner, singleName);
    expect(repo.listStandaloneUniverseNames()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(secureIndexPath)).books[singleName]).toBeUndefined();
});

it('fails closed with a content-free error when the catalog cannot be read', () => {
    fs.writeFileSync(secureIndexPath, '{ invalid synthetic index');
    expect(() => repo.listStandaloneUniverseNames()).toThrow('Lorebook catalog is unavailable.');
    expect(() => isGlobalLorebookAllowed(viewer, singleName)).toThrow('Lorebook catalog is unavailable.');
});

it('skips a missing designated record while retaining available catalog names', async () => {
    await repo.setStandaloneUniverse(owner, singleName, true);
    const index = JSON.parse(fs.readFileSync(secureIndexPath));
    index.books['Missing synthetic universe'] = { ownerHandle: owner.profile.handle, standaloneUniverse: true };
    fs.writeFileSync(secureIndexPath, JSON.stringify(index));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        expect(repo.listStandaloneUniverseNames()).toEqual([singleName]);
        expect(warning).toHaveBeenCalledWith('[Lorebooks] Skipping an unavailable standalone universe record.');
    } finally {
        warning.mockRestore();
    }
});

it('returns management items from list and bootstrap when the catalog is unavailable', async () => {
    const settingsEndpoint = await import('../endpoints/settings.js');
    for (const directory of Object.values(viewer.directories)) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(viewer.directories.root, 'settings.json'), '{}');
    fs.writeFileSync(path.join(viewer.directories.worlds, `${singleName}.json`), '{"entries":{}}');
    fs.writeFileSync(secureIndexPath, '{"books":[]}');
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        for (const [route, target] of [['/list', endpoint], ['/get', settingsEndpoint]]) {
            const { status, payload } = await request(route, viewer, {}, target);
            expect(status).toBe(200);
            expect(payload.world_info_items.map(item => item.name)).toContain(singleName);
            expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('standalone_universe_names');
        }
    } finally {
        warning.mockRestore();
    }
});

it('retains independent mutations from separate workers sharing DATA_ROOT', async () => {
    const otherName = 'Z-universe-owner-test-Other';
    fs.writeFileSync(path.join(owner.directories.worlds, `${otherName}.json`), '{"entries":{}}');
    const index = JSON.parse(fs.readFileSync(secureIndexPath));
    index.books[otherName] = { ownerHandle: owner.profile.handle };
    fs.writeFileSync(secureIndexPath, JSON.stringify(index));
    const code = `
        import path from 'node:path';
        import { setConfigFilePath } from './src/util.js';
        setConfigFilePath(path.resolve('config.yaml'));
        globalThis.DATA_ROOT = process.argv[1];
        const { setStandaloneUniverse, saveUniverseInfo } = await import('./src/lorebook-repository.js');
        await setStandaloneUniverse({ profile: { handle: 'universe-owner-test' } }, process.argv[2], true);
        await saveUniverseInfo({ profile: { handle: 'universe-owner-test' } }, process.argv[2], { description: 'Synthetic worker metadata', tags: [] });
    `;
    await Promise.all([singleName, otherName].map(name => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, root, name])));
    const updated = JSON.parse(fs.readFileSync(secureIndexPath));
    expect(updated.books[singleName].standaloneUniverse).toBe(true);
    expect(updated.books[otherName].standaloneUniverse).toBe(true);
    expect(updated.books[singleName].universeInfo.description).toBe('Synthetic worker metadata');
    expect(updated.books[otherName].universeInfo.description).toBe('Synthetic worker metadata');
}, 30000);

it('saves listing metadata with edit permissions and exports only allowed fields to admins', async () => {
    const info = { description: 'Synthetic public description', audience: 'Explorers', tags: ['fantasy'], nameOverride: 'Public title' };
    expect((await request('/universe-info', owner, { name: singleName, info })).status).toBe(409);
    await repo.setStandaloneUniverse(owner, singleName, true);
    expect((await request('/universe-info', viewer, { name: singleName, info })).status).toBe(404);
    expect((await request('/universe-info', owner, { name: singleName, info: { ...info, imageUrl: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await request('/universe-info', owner, { name: singleName, info })).status).toBe(200);
    expect((await request('/universe-directory', owner)).status).toBe(403);
    const readFile = jest.spyOn(fs, 'readFileSync');
    let exported;
    try {
        exported = await request('/universe-directory', admin);
        expect(readFile.mock.calls.some(([file]) => String(file).endsWith(`${singleName}.json`))).toBe(false);
    } finally {
        readFile.mockRestore();
    }
    expect(exported.status).toBe(200);
    expect(exported.payload).toEqual([{
        name: 'Public title', creator: owner.profile.handle, description: info.description, audience: 'Explorers', tags: ['fantasy'], imageUrl: '', informationUrl: '',
    }]);
    expect(JSON.stringify(exported.payload)).not.toContain(content);
    await repo.saveLorebookForManagement(owner, singleName, { entries: {} }, 'secure');
    expect(repo.listLorebooksForManagement(owner).find(item => item.name === singleName).universeInfo.description).toBe(info.description);
    await repo.setStandaloneUniverse(owner, singleName, false);
    expect(await repo.exportUniverseDirectory(admin)).toEqual([]);
    await repo.setStandaloneUniverse(owner, singleName, true);
    expect((await repo.exportUniverseDirectory(admin))[0].name).toBe('Public title');
    fs.rmSync(path.join(owner.directories.worlds, `${singleName}.json`));
    expect(await repo.exportUniverseDirectory(admin)).toEqual([]);
});

it('preserves listing metadata through shared owners, checkout, and secure conversions', async () => {
    await repo.setStandaloneUniverse(owner, singleName, true);
    await repo.saveUniverseInfo(owner, singleName, { tags: [], description: 'Synthetic directory description' });
    const converted = 'Y-Converted Synthetic';
    await repo.promoteLorebookToShared(owner, singleName, converted, [owner.profile.handle, viewer.profile.handle]);
    await repo.checkoutSharedLorebook(owner, converted);
    await repo.updateSharedLorebookOwners(owner, converted, [owner.profile.handle, 'third-owner-test']);
    expect((await repo.exportUniverseDirectory(admin))[0].description).toBe('Synthetic directory description');
    await repo.checkinSharedLorebook(owner, converted);
    await expect(repo.saveUniverseInfo(owner, converted, { tags: [] })).rejects.toMatchObject({ status: 423 });
    await repo.checkoutSharedLorebook(owner, converted);
    // This checks metadata conversion, not OS symlink privileges. The repository's
    // existing backing-file fallback resolves the converted book without a link.
    const symlink = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {});
    try {
        await repo.unshareLorebook(admin, converted, owner.profile.handle);
    } finally {
        symlink.mockRestore();
    }
    expect((await repo.exportUniverseDirectory(admin))[0].description).toBe('Synthetic directory description');
});

it('directory export fails closed with a content-free error on invalid metadata', async () => {
    await repo.setStandaloneUniverse(owner, singleName, true);
    const index = JSON.parse(fs.readFileSync(secureIndexPath));
    index.books[singleName].universeInfo = { description: { synthetic: content }, tags: [] };
    fs.writeFileSync(secureIndexPath, JSON.stringify(index));
    expect(await request('/universe-directory', admin)).toEqual({ status: 503, payload: { error: { message: 'Universe directory is unavailable.', type: 'UniverseDirectoryUnavailable', details: null } } });
});
