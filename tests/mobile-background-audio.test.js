import { describe, expect, it, jest } from '@jest/globals';

import {
    beginMobileBackgroundAudioGeneration,
    setMobileBackgroundAudioPlayback,
} from '../public/scripts/mobile-background-audio.js';

function createAudio({ play = () => Promise.resolve() } = {}) {
    return {
        currentTime: 12,
        paused: true,
        pause: jest.fn(),
        play: jest.fn(play),
    };
}

describe('mobile background audio', () => {
    it('stops and resets playback when disabled or not mobile', () => {
        const audio = createAudio();
        const activationTarget = new EventTarget();

        setMobileBackgroundAudioPlayback({ enabled: true, mobile: false, audio, activationTarget });

        expect(audio.play).not.toHaveBeenCalled();
        expect(audio.pause).toHaveBeenCalledTimes(1);
        expect(audio.currentTime).toBe(0);
    });

    it('plays only during generation and retries blocked autoplay after user activation', async () => {
        let attempts = 0;
        const audio = createAudio({
            play: () => {
                attempts++;
                if (attempts === 1) {
                    return Promise.reject(new Error('Autoplay blocked'));
                }
                return Promise.resolve();
            },
        });
        const activationTarget = new EventTarget();
        const statuses = [];

        setMobileBackgroundAudioPlayback({
            enabled: true,
            mobile: true,
            audio,
            activationTarget,
            onStatusChange: status => statuses.push(status),
        });
        expect(audio.play).not.toHaveBeenCalled();

        const finishGeneration = beginMobileBackgroundAudioGeneration();
        await Promise.resolve();
        await Promise.resolve();
        activationTarget.dispatchEvent(new Event('click'));
        await Promise.resolve();

        expect(audio.play).toHaveBeenCalledTimes(2);
        expect(statuses).toContain('blocked');
        expect(statuses).toContain('playing');

        finishGeneration();
        expect(audio.pause).toHaveBeenCalled();
        expect(statuses.at(-1)).toBe('idle');

        setMobileBackgroundAudioPlayback({ enabled: false, mobile: true, audio, activationTarget });
    });

    it('ignores a stale rejection after a newer playback attempt succeeds', async () => {
        let rejectFirstAttempt;
        let attempts = 0;
        const audio = createAudio({
            play: () => {
                attempts++;
                if (attempts === 1) {
                    return new Promise((resolve, reject) => {
                        rejectFirstAttempt = reject;
                    });
                }
                return Promise.resolve();
            },
        });
        const activationTarget = new EventTarget();
        const statuses = [];

        setMobileBackgroundAudioPlayback({
            enabled: true,
            mobile: true,
            audio,
            activationTarget,
            onStatusChange: status => statuses.push(status),
        });
        const finishGeneration = beginMobileBackgroundAudioGeneration();

        activationTarget.dispatchEvent(new Event('click'));
        await Promise.resolve();
        rejectFirstAttempt(new Error('Stale autoplay failure'));
        await Promise.resolve();

        expect(audio.play).toHaveBeenCalledTimes(2);
        expect(statuses).not.toContain('blocked');
        expect(statuses.at(-1)).toBe('playing');

        finishGeneration();
        setMobileBackgroundAudioPlayback({ enabled: false, mobile: true, audio, activationTarget });
    });
});
