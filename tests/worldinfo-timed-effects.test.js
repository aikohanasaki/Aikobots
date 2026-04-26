import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let recomputeTimedWorldInfoFromChat;
let router;

beforeAll(async () => {
    const worldInfoEndpoint = await import('../src/endpoints/worldinfo.js');
    recomputeTimedWorldInfoFromChat = worldInfoEndpoint.recomputeTimedWorldInfoFromChat;
    router = worldInfoEndpoint.router;
});

describe('world info timed effects recompute endpoint', () => {
    it('keeps the recompute route registered for older clients', () => {
        const hasRoute = router.stack.some(layer =>
            layer?.route?.path === '/timed-effects/recompute'
            && layer.route.methods?.post,
        );

        expect(hasRoute).toBe(true);
    });

    it('recomputes timed effects from the legacy chat replay payload', async () => {
        const timedWorldInfo = await recomputeTimedWorldInfoFromChat(
            { profile: { handle: 'tester' } },
            {
                selectedWorldInfo: ['Alpha'],
                chatMessages: [
                    { name: 'User', mes: 'first message', is_user: true, is_system: false, extra: {} },
                    { name: 'Bot', mes: 'first reply', is_user: false, is_system: false, extra: {} },
                ],
                maxContext: 100,
                settings: {
                    world_info_budget: 100,
                    world_info_budget_cap: 0,
                    world_info_recursive: false,
                },
                worldInfoPosition: {
                    before: 0,
                },
            },
            {
                readEntries: async () => [{
                    uid: 1,
                    world: 'Alpha',
                    order: 100,
                    position: 0,
                    content: '@@activate\nSticky entry',
                    sticky: 3,
                    lorebookSettings: { budgetMode: 'default' },
                }],
                getHiddenBooks: () => [],
                hasLorebook: () => true,
            },
        );

        expect(timedWorldInfo.sticky['Alpha::1']).toMatchObject({
            book: 'Alpha',
            name: '1',
            start: 1,
            end: 4,
        });
    });
});
