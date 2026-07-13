import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { setConfigFilePath } from '../util.js';

const CONFIG_PATH = fs.existsSync(path.resolve(process.cwd(), 'config.yaml'))
    ? path.resolve(process.cwd(), 'config.yaml')
    : path.resolve(process.cwd(), '..', 'config.yaml');

setConfigFilePath(CONFIG_PATH);

let router;
let updateWorldInfoSortOrder;

beforeAll(async () => {
    const worldInfoEndpoint = await import('../endpoints/worldinfo.js');
    router = worldInfoEndpoint.router;
    updateWorldInfoSortOrder = worldInfoEndpoint.updateWorldInfoSortOrder;
});

describe('world info sort order endpoint', () => {
    it('registers the targeted sort-order route', () => {
        const hasRoute = router.stack.some(layer =>
            layer?.route?.path === '/sort-order'
            && layer.route.methods?.post,
        );

        expect(hasRoute).toBe(true);
    });

    it('updates the latest lorebook JSON without changing entries or unrelated metadata', async () => {
        const user = { profile: { handle: 'owner' } };
        const latestData = {
            entries: {
                1: {
                    uid: 1,
                    content: 'latest persisted entry',
                },
            },
            extensions: {
                existing: true,
                aikobots: {
                    existing: 'preserved',
                },
            },
        };
        const loadedMetadata = {
            name: 'Book',
            storage: 'secure',
        };
        const savedMetadata = {
            ...loadedMetadata,
            ownerHandle: 'owner',
        };
        const save = jest.fn(async () => savedMetadata);
        const getLorebookForManagement = jest.fn(async () => ({
            data: latestData,
            metadata: loadedMetadata,
        }));

        const result = await updateWorldInfoSortOrder(user, {
            name: 'Book',
            storage: 'secure',
            sortOrder: 10,
        }, {
            getLorebookForManagement,
            withLorebookManagementTransaction: operation => operation({ save }),
        });

        expect(getLorebookForManagement).toHaveBeenCalledWith(user, 'Book', false, 'secure');
        expect(save).toHaveBeenCalledWith(user, 'Book', result.data, 'secure');
        expect(result).toEqual({
            data: {
                entries: latestData.entries,
                extensions: {
                    existing: true,
                    aikobots: {
                        existing: 'preserved',
                        sort_order: '10',
                    },
                },
            },
            metadata: savedMetadata,
            sortOrder: '10',
        });
        expect(latestData.extensions.aikobots).not.toHaveProperty('sort_order');
    });

    it('rejects malformed metadata before saving', async () => {
        const save = jest.fn();

        await expect(updateWorldInfoSortOrder(
            { profile: { handle: 'owner' } },
            { name: 'Book', storage: 'user', sortOrder: '1' },
            {
                getLorebookForManagement: async () => ({
                    data: {
                        entries: {},
                        extensions: [],
                    },
                    metadata: {
                        name: 'Book',
                        storage: 'user',
                    },
                }),
                withLorebookManagementTransaction: operation => operation({ save }),
            },
        )).rejects.toMatchObject({
            type: 'LorebookInvalidData',
            status: 400,
        });
        expect(save).not.toHaveBeenCalled();
    });

    it('rejects temporary search sorting before reading or saving a lorebook', async () => {
        const getLorebookForManagement = jest.fn();
        const withLorebookManagementTransaction = jest.fn();

        await expect(updateWorldInfoSortOrder(
            { profile: { handle: 'owner' } },
            { name: 'Book', storage: 'user', sortOrder: '14' },
            { getLorebookForManagement, withLorebookManagementTransaction },
        )).rejects.toMatchObject({
            type: 'LorebookSortOrderInvalid',
            status: 400,
        });
        expect(getLorebookForManagement).not.toHaveBeenCalled();
        expect(withLorebookManagementTransaction).not.toHaveBeenCalled();
    });
});
