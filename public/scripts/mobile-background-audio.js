let activeAudio = null;
let activeActivationTarget = null;

/**
 * Retries playback after browsers block an attempt made without user activation.
 */
function tryPlayActiveAudio() {
    if (!activeAudio || activeAudio.paused === false) {
        return;
    }

    try {
        activeAudio.play()?.catch(() => {});
    } catch {
        // The next user interaction will retry while the setting remains enabled.
    }
}

function removeActivationListeners() {
    activeActivationTarget?.removeEventListener('click', tryPlayActiveAudio, true);
    activeActivationTarget?.removeEventListener('keydown', tryPlayActiveAudio, true);
    activeActivationTarget = null;
    activeAudio = null;
}

/**
 * Applies the opt-in silent playback preference on mobile browsers.
 * @param {object} options Playback options.
 * @param {boolean} options.enabled Whether the user enabled background audio.
 * @param {boolean} options.mobile Whether the current browser is mobile.
 * @param {HTMLAudioElement|null} options.audio Silent audio element.
 * @param {EventTarget} [options.activationTarget=document] Target used to retry playback after user activation.
 */
export function setMobileBackgroundAudioPlayback({ enabled, mobile, audio, activationTarget = document }) {
    removeActivationListeners();

    if (!enabled || !mobile || !audio) {
        audio?.pause();
        if (audio) {
            audio.currentTime = 0;
        }
        return;
    }

    activeAudio = audio;
    activeActivationTarget = activationTarget;
    activeActivationTarget.addEventListener('click', tryPlayActiveAudio, true);
    activeActivationTarget.addEventListener('keydown', tryPlayActiveAudio, true);
    tryPlayActiveAudio();
}
