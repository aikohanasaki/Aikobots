import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { setConfigFilePath } from '../src/util.js';

setConfigFilePath(fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml'));

const { write: writeCharacterCard } = await import('../src/character-card-parser.js');
const { SETTINGS_FILE } = await import('../src/constants.js');
const { writeHiddenLorebookBindings } = await import('../src/hidden-lorebook-bindings.js');
const { writeHiddenLorebookTemplates } = await import('../src/hidden-lorebook-templates.js');
const { writePersonasDocument } = await import('../src/persona-repository.js');
const { writeStmbContextSettingsDocument } = await import('../src/stmb-context-settings.js');
const { saveStmbSidePrompts } = await import('../src/stmb-side-prompts-repository.js');
const { migrateFromJsonlRecords } = await import('../src/sqlite-manager.js');
const { getUserDirectories } = await import('../src/users.js');

const BASE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function createLorebooks(user, names) {
    fs.mkdirSync(user.directories.worlds, { recursive: true });
    for (const name of names) {
        fs.writeFileSync(path.join(user.directories.worlds, `${name}.json`), JSON.stringify({ entries: {} }), 'utf8');
    }
}

function writeCharacter(user, name, card) {
    fs.mkdirSync(user.directories.characters, { recursive: true });
    const buffer = writeCharacterCard(Buffer.from(BASE_PNG, 'base64'), JSON.stringify(card));
    fs.writeFileSync(path.join(user.directories.characters, `${name}.png`), buffer);
}

function writeJsonlChat(filePath, metadata) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({ chat_metadata: metadata })}\n${JSON.stringify({ mes: 'body is not scanned' })}\n`, 'utf8');
}

async function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lorebook-cleanup-'));
    const previousRoot = globalThis.DATA_ROOT;
    globalThis.DATA_ROOT = root;
    const handle = `cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = { profile: { handle, admin: false }, directories: getUserDirectories(handle) };
    for (const directory of Object.values(user.directories)) fs.mkdirSync(directory, { recursive: true });
    const cleanup = await import(`../src/lorebook-cleanup.js?fixture=${handle}`);
    return {
        cleanup,
        root,
        user,
        restore() {
            globalThis.DATA_ROOT = previousRoot;
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

test('lists only ordinary lorebooks absent from every durable reference source', async () => {
    const fixture = await createFixture();
    const { cleanup, root, user } = fixture;
    try {
        const boundNames = [
            'Global', 'Extra', 'LegacyGlobal', 'PersonaCurrent', 'PersonaSaved', 'CharacterLock', 'LegacyCharacterLock',
            'CharacterPrimary', 'CharacterLinked', 'ChatPrimary', 'ChatManual', 'ChatCharacter', 'ChatSide',
            'SqlitePrimary', 'LegacyGroup', 'PresetMember', 'HiddenBinding', 'HiddenTemplate', 'ContextSetting', 'SidePromptTarget',
            'ReservedTemplate',
        ];
        createLorebooks(user, ['Unused', ...boundNames]);

        fs.writeFileSync(path.join(user.directories.root, SETTINGS_FILE), JSON.stringify({
            world_info: {
                globalSelect: ['Global'],
                charLore: [{ name: 'Bot', extraBooks: ['Extra'] }],
            },
            world_info_settings: { world_info: { globalSelect: ['LegacyGlobal'] } },
            power_user: { persona_description_lorebook: 'PersonaCurrent' },
            stmb_settings: { characterMemoryBookLocks: { 'bot.png': { lorebookName: 'CharacterLock' } } },
            extension_settings: {
                STMemoryBooks: { characterMemoryBookLocks: { 'old.png': { lorebookName: 'LegacyCharacterLock' } } },
                worldInfoPresets: { presetList: [{ name: 'Story', worldList: ['PresetMember'] }] },
            },
        }), 'utf8');
        writePersonasDocument(user.directories, {
            personas: { 'user.png': { name: 'User', lorebook: 'PersonaSaved' } },
        });

        writeCharacter(user, 'Bot', {
            data: {
                extensions: {
                    world: 'CharacterPrimary',
                    aikobots: { secure_lorebooks: ['CharacterLinked'] },
                },
            },
        });
        writeJsonlChat(path.join(user.directories.chats, 'Bot', 'chat.jsonl'), {
            world_info: 'ChatPrimary',
            STMemoryBooks: {
                manualLorebook: 'ChatManual',
                manualCharacterLorebooks: { bot: 'ChatCharacter' },
                sidePromptLorebookOverrides: { prompt: 'ChatSide' },
            },
        });
        await migrateFromJsonlRecords([
            JSON.stringify({ chat_metadata: { world_info: 'SqlitePrimary' } }),
            JSON.stringify({ mes: 'SQLite body is not scanned' }),
        ], path.join(user.directories.groupChats, 'sqlite-chat.sqlite'));
        fs.writeFileSync(path.join(user.directories.groups, 'group.json'), JSON.stringify({
            past_metadata: { old: { world_info: 'LegacyGroup' } },
        }), 'utf8');

        writeHiddenLorebookBindings({ global: ['HiddenBinding'] });
        writeHiddenLorebookTemplates({ templates: { protected: { add: ['HiddenTemplate'] } } });
        writeStmbContextSettingsDocument(user, {
            settings: { one: { key: 'one', name: 'One', entries: [{ lorebookName: 'ContextSetting', uid: '1' }] } },
        });
        await saveStmbSidePrompts(user, {
            version: 2,
            prompts: { one: { settings: { lorebook: { targetLorebookName: 'SidePromptTarget' } } } },
            sets: {},
        }, 'missing');

        const templateDirectory = path.join(root, '_templates', 'recommended-chat-setups');
        fs.mkdirSync(templateDirectory, { recursive: true });
        fs.writeFileSync(path.join(templateDirectory, 'index.json'), JSON.stringify({
            version: 2,
            drafts: { bot: { templateSourceOwnerHandle: user.profile.handle, templateSourceName: 'ReservedTemplate' } },
            published: {},
        }), 'utf8');

        const result = await cleanup.listUnboundUserLorebooks(user);
        assert.deepEqual(result.map(item => item.name), ['Unused']);
    } finally {
        fixture.restore();
    }
});

test('fails closed on malformed binding data and rechecks immediately before deletion', async () => {
    const fixture = await createFixture();
    const { cleanup, user } = fixture;
    try {
        createLorebooks(user, ['Candidate']);
        assert.deepEqual((await cleanup.listUnboundUserLorebooks(user)).map(item => item.name), ['Candidate']);

        fs.writeFileSync(path.join(user.directories.root, SETTINGS_FILE), JSON.stringify({
            world_info: { globalSelect: ['Candidate'] },
        }), 'utf8');
        await assert.rejects(
            cleanup.deleteUnboundUserLorebooks(user, ['Candidate']),
            error => error instanceof cleanup.LorebookCleanupConflictError && error.status === 409,
        );
        assert.equal(fs.existsSync(path.join(user.directories.worlds, 'Candidate.json')), true);

        fs.writeFileSync(path.join(user.directories.root, SETTINGS_FILE), '{ malformed', 'utf8');
        await assert.rejects(cleanup.listUnboundUserLorebooks(user));
        assert.equal(fs.existsSync(path.join(user.directories.worlds, 'Candidate.json')), true);

        fs.writeFileSync(path.join(user.directories.root, SETTINGS_FILE), '{}', 'utf8');
        const secureDirectory = path.join(fixture.root, '_secure', 'worlds');
        fs.mkdirSync(secureDirectory, { recursive: true });
        fs.writeFileSync(path.join(secureDirectory, 'index.json'), '{ malformed', 'utf8');
        await assert.rejects(cleanup.listUnboundUserLorebooks(user));
    } finally {
        fixture.restore();
    }
});

test('deletes a freshly revalidated ordinary unbound lorebook', async () => {
    const fixture = await createFixture();
    const { cleanup, user } = fixture;
    try {
        createLorebooks(user, ['Candidate']);
        assert.deepEqual(await cleanup.deleteUnboundUserLorebooks(user, ['Candidate']), ['Candidate']);
        assert.equal(fs.existsSync(path.join(user.directories.worlds, 'Candidate.json')), false);
    } finally {
        fixture.restore();
    }
});

test('Data Maid cross-worker fallback preserves typed lorebook deletion semantics', async () => {
    const fixture = await createFixture();
    const { user } = fixture;
    try {
        createLorebooks(user, ['Candidate']);
        const { router } = await import(`../src/endpoints/data-maid.js?fallback=${user.profile.handle}`);
        const deleteHandler = router.stack
            .find(layer => layer.route?.path === '/delete')
            .route.stack.at(-1).handle;
        const lorebookPath = path.join(user.directories.worlds, 'Candidate.json');
        const hash = crypto.createHash('sha256').update(lorebookPath).digest('hex');
        const response = {
            statusCode: 200,
            payload: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
            sendStatus(code) {
                this.statusCode = code;
                return this;
            },
        };

        await deleteHandler({
            user,
            body: { token: 'token-created-on-another-worker', hashes: [hash] },
        }, response);

        assert.equal(response.statusCode, 204);
        assert.equal(fs.existsSync(lorebookPath), false);
    } finally {
        fixture.restore();
    }
});

test('Data Maid rejects a lorebook replaced after its report was authorized', async () => {
    const fixture = await createFixture();
    const { user } = fixture;
    try {
        createLorebooks(user, ['Candidate']);
        const module = await import(`../src/endpoints/data-maid.js?stale=${user.profile.handle}`);
        const service = new module.DataMaidService(user.profile.handle, user.directories);
        const report = await service.generateReport();
        const token = module.DataMaidService.generateToken(user.profile.handle, report);
        const lorebookPath = path.join(user.directories.worlds, 'Candidate.json');
        const hash = crypto.createHash('sha256').update(lorebookPath).digest('hex');
        fs.writeFileSync(lorebookPath, JSON.stringify({ entries: {}, replacement: 'new file' }), 'utf8');

        const deleteHandler = module.router.stack
            .find(layer => layer.route?.path === '/delete')
            .route.stack.at(-1).handle;
        const response = {
            statusCode: 200,
            payload: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
            sendStatus(code) {
                this.statusCode = code;
                return this;
            },
        };
        await deleteHandler({ user, body: { token, hashes: [hash] } }, response);

        assert.equal(response.statusCode, 409);
        assert.equal(response.payload?.error, 'lorebook_cleanup_conflict');
        assert.equal(fs.existsSync(lorebookPath), true);
    } finally {
        fixture.restore();
    }
});

test('Data Maid cross-worker fallback reports a newly STWIL-preset-bound lorebook as a conflict', async () => {
    const fixture = await createFixture();
    const { user } = fixture;
    try {
        createLorebooks(user, ['Candidate']);
        fs.writeFileSync(path.join(user.directories.root, SETTINGS_FILE), JSON.stringify({
            extension_settings: {
                worldInfoPresets: { presetList: [{ name: 'Story', worldList: ['Candidate'] }] },
            },
        }), 'utf8');
        const { router } = await import(`../src/endpoints/data-maid.js?boundFallback=${user.profile.handle}`);
        const deleteHandler = router.stack
            .find(layer => layer.route?.path === '/delete')
            .route.stack.at(-1).handle;
        const lorebookPath = path.join(user.directories.worlds, 'Candidate.json');
        const hash = crypto.createHash('sha256').update(lorebookPath).digest('hex');
        const response = {
            statusCode: 200,
            payload: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
            sendStatus(code) {
                this.statusCode = code;
                return this;
            },
        };
        await deleteHandler({ user, body: { token: 'other-worker-token', hashes: [hash] } }, response);

        assert.equal(response.statusCode, 409);
        assert.equal(fs.existsSync(lorebookPath), true);
    } finally {
        fixture.restore();
    }
});
