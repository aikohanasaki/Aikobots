import { describe, expect, it, jest } from '@jest/globals';

import { setMobileBackgroundAudioPlayback } from '../public/scripts/mobile-background-audio.js';

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

    it('plays on mobile and retries blocked autoplay after user activation', async () => {
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

        setMobileBackgroundAudioPlayback({ enabled: true, mobile: true, audio, activationTarget });
        await Promise.resolve();
        activationTarget.dispatchEvent(new Event('click'));

        expect(audio.play).toHaveBeenCalledTimes(2);

        setMobileBackgroundAudioPlayback({ enabled: false, mobile: true, audio, activationTarget });
    });
});
