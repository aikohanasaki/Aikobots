import { afterAll, beforeAll, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../public/script.js', () => ({ getRequestHeaders: () => ({}), substituteParamsExtended: value => value }));
jest.unstable_mockModule('../public/scripts/i18n.js', () => ({ getCurrentLocale: () => 'en', translate: value => value }));
jest.unstable_mockModule('../public/scripts/utils.js', () => ({ getStringHash: value => value }));

let manager;
let document = { version: 2, prompts: {}, sets: {} };
const originalFetch = globalThis.fetch;

beforeAll(async () => {
    globalThis.fetch = jest.fn(async (_url, options = {}) => {
        if (options.method === 'PUT') document = JSON.parse(options.body).document;
        return { ok: true, status: 200, json: async () => ({ document: structuredClone(document), revision: 'test' }) };
    });
    manager = await import('../public/scripts/stmb-sideprompts-manager.js');
});
afterAll(() => { globalThis.fetch = originalFetch; });

it('retains Save all versions through edits, reloads, duplication, export and import', async () => {
    const key = await manager.upsertTemplate({ name: 'Assess', prompt: 'Assess the scene', settings: { saveAllVersions: true } });
    await manager.upsertTemplate({ key, enabled: false });
    manager.clearSidePromptsCache();
    expect((await manager.getTemplate(key)).settings.saveAllVersions).toBe(true);
    const copy = await manager.duplicateTemplate(key);
    expect((await manager.getTemplate(copy)).settings.saveAllVersions).toBe(true);
    const exported = await manager.exportSidePromptsJson();
    expect(JSON.parse(exported).prompts[key].settings.saveAllVersions).toBe(true);
    await manager.importSidePromptsJson(exported);
    const prompts = (await manager.listTemplates()).filter(prompt => prompt.name.startsWith('Assess'));
    expect(prompts).toHaveLength(4);
    expect(prompts.every(prompt => prompt.settings.saveAllVersions)).toBe(true);
    await manager.upsertTemplate({ key, settings: { saveAllVersions: false } });
    expect((await manager.getTemplate(key)).settings.saveAllVersions).toBe(false);
});
