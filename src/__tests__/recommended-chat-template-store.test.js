import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

let tempRoot;
let getPublishedRecommendedSetup;
let mutateRecommendedTemplateStore;
let publishRecommendedSetup;
let readRecommendedTemplateIndex;

beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recommended-chat-template-store-'));
    globalThis.DATA_ROOT = tempRoot;
    ({
        getPublishedRecommendedSetup,
        mutateRecommendedTemplateStore,
        publishRecommendedSetup,
        readRecommendedTemplateIndex,
    } = await import('../recommended-chat-template-store.js'));
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Recommended Chat Setup cross-worker store', () => {
    it('serializes concurrent draft mutations without dropping another character', async () => {
        await Promise.all(Array.from({ length: 12 }, (_, index) => mutateRecommendedTemplateStore(store => {
            store.drafts[`character-${index}`] = { characterKey: `character-${index}` };
        })));

        expect(Object.keys(readRecommendedTemplateIndex().drafts)).toHaveLength(12);
    });

    it('publishes components with one atomic metadata switch and supports rollback', async () => {
        const initial = {
            characterKey: 'character-publication',
            characterName: 'Aiko',
            botmakerName: 'Maker',
            hasTemplate: true,
            hasSidePrompts: false,
            templateData: { entries: {} },
            sidePrompts: null,
            revision: 'initial-revision',
        };
        await publishRecommendedSetup(initial.characterKey, initial);
        const changed = {
            ...initial,
            hasTemplate: false,
            hasSidePrompts: true,
            templateData: null,
            sidePrompts: { set: { items: [] }, prompts: {} },
            revision: 'changed-revision',
        };
        const rollback = await publishRecommendedSetup(changed.characterKey, changed);
        expect(getPublishedRecommendedSetup(changed.characterKey)).toMatchObject({
            revision: 'changed-revision',
            hasTemplate: false,
            hasSidePrompts: true,
        });

        await rollback();
        expect(getPublishedRecommendedSetup(initial.characterKey)).toMatchObject({
            revision: 'initial-revision',
            hasTemplate: true,
            hasSidePrompts: false,
        });
    });
});
