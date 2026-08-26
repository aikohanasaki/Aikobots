import { describe, expect, it } from '@jest/globals';

import {
    ELECTRONHUB_IMAGE_SIZES,
    getClosestElectronHubSize,
    getElectronHubImageSizes,
    getElectronHubModels,
} from '../public/scripts/extensions/stable-diffusion/electronhub.js';
import { getElectronHubImageRequest } from '../src/endpoints/stable-diffusion.js';

describe('Electron Hub image model capabilities', () => {
    it('accepts both the documented model-list envelope and the internal array response', () => {
        const models = [{ id: 'image-model' }];

        expect(getElectronHubModels({ data: models })).toBe(models);
        expect(getElectronHubModels(models)).toBe(models);
        expect(getElectronHubModels({ data: null })).toEqual([]);
    });

    it('uses valid advertised sizes and falls back to the documented image sizes', () => {
        expect(getElectronHubImageSizes({ sizes: ['800x600', null, 'invalid', '0x0'] })).toEqual(['800x600']);
        expect(getElectronHubImageSizes({})).toEqual(ELECTRONHUB_IMAGE_SIZES);
    });

    it('selects the valid size with the closest area', () => {
        const sizes = ['invalid', '512x512', '1024x1024'];

        expect(getClosestElectronHubSize(900, 900, sizes)).toBe('1024x1024');
        expect(getClosestElectronHubSize(0, 1024, sizes)).toBeNull();
        expect(getClosestElectronHubSize(1024, 1024, null)).toBeNull();
    });
});

describe('Electron Hub image generation request', () => {
    it('preserves the prompt while forwarding only supported fields', () => {
        const request = getElectronHubImageRequest({
            model: ' image-model ',
            prompt: '  preserve prompt whitespace  ',
            size: ' 1024x1024 ',
            quality: ' hd ',
            ignored: 'value',
        });

        expect(request).toEqual({
            model: 'image-model',
            prompt: '  preserve prompt whitespace  ',
            response_format: 'b64_json',
            size: '1024x1024',
            quality: 'hd',
        });
    });

    it('rejects missing required string fields', () => {
        expect(getElectronHubImageRequest({ model: 'image-model', prompt: ' ' })).toBeNull();
        expect(getElectronHubImageRequest({ model: {}, prompt: 'prompt' })).toBeNull();
    });
});
