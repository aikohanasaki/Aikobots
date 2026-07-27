import { describe, expect, it } from '@jest/globals';

import { resolveDeviceFontScales } from '../public/scripts/device-font-scale.js';

describe('device font scale', () => {
    it('uses independent scales for desktop and mobile devices', () => {
        expect(resolveDeviceFontScales({
            mobile: false,
            desktopScale: 1.2,
            mobileScale: 0.8,
        }).effectiveScale).toBe(1.2);

        expect(resolveDeviceFontScales({
            mobile: true,
            desktopScale: 1.2,
            mobileScale: 0.8,
        }).effectiveScale).toBe(0.8);
    });

    it('inherits and clamps invalid saved values', () => {
        expect(resolveDeviceFontScales({
            mobile: true,
            desktopScale: 1.3,
            mobileScale: undefined,
        })).toEqual({
            desktopScale: 1.3,
            mobileScale: 1.3,
            effectiveScale: 1.3,
        });

        expect(resolveDeviceFontScales({
            mobile: true,
            desktopScale: 3,
            mobileScale: -1,
        })).toEqual({
            desktopScale: 1.5,
            mobileScale: 0.5,
            effectiveScale: 0.5,
        });
    });

    it('falls back for empty and non-scalar values', () => {
        for (const invalidValue of [null, '', '   ', [], {}, false]) {
            expect(resolveDeviceFontScales({
                mobile: true,
                desktopScale: invalidValue,
                mobileScale: invalidValue,
            })).toEqual({
                desktopScale: 1,
                mobileScale: 1,
                effectiveScale: 1,
            });
        }
    });

    it('accepts numeric strings for saved-setting compatibility', () => {
        expect(resolveDeviceFontScales({
            mobile: true,
            desktopScale: '1.2',
            mobileScale: '0.8',
        })).toEqual({
            desktopScale: 1.2,
            mobileScale: 0.8,
            effectiveScale: 0.8,
        });
    });
});
