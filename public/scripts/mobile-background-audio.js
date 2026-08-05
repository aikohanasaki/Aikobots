let activeAudio = null;
let activeActivationTarget = null;
let activeGenerationCount = 0;
let playbackAttemptId = 0;
let playbackEnabled = false;
let mobileBrowser = false;
let statusListener = null;

function reportStatus(status) {
    statusListener?.(status);
}

/** Retries playback after browsers block an attempt made without user activation. */
function tryPlayActiveAudio() {
    if (!activeAudio || activeAudio.paused === false || !playbackEnabled || !mobileBrowser || activeGenerationCount === 0) {
        return;
    }

    const attemptedAudio = activeAudio;
    const attemptId = ++playbackAttemptId;
    const isAttemptActive = () => playbackAttemptId === attemptId
        && activeAudio === attemptedAudio
        && playbackEnabled
        && mobileBrowser
        && activeGenerationCount > 0;

    try {
        const result = attemptedAudio.play();
        result?.then(() => {
            if (isAttemptActive()) {
                reportStatus('playing');
            }
        }).catch(() => {
            if (isAttemptActive()) {
                reportStatus('blocked');
            }
        });
    } catch {
        if (isAttemptActive()) {
            reportStatus('blocked');
        }
    }
}

function removeActivationListeners() {
    activeActivationTarget?.removeEventListener('click', tryPlayActiveAudio, true);
    activeActivationTarget?.removeEventListener('keydown', tryPlayActiveAudio, true);
    activeActivationTarget = null;
}

function syncPlayback() {
    playbackAttemptId++;
    removeActivationListeners();
    if (!playbackEnabled || !mobileBrowser || !activeAudio || activeGenerationCount === 0) {
        activeAudio?.pause();
        if (activeAudio) {
            activeAudio.currentTime = 0;
        }
        reportStatus(playbackEnabled && mobileBrowser ? 'idle' : 'disabled');
        return;
    }

    activeActivationTarget = configuredActivationTarget;
    activeActivationTarget.addEventListener('click', tryPlayActiveAudio, true);
    activeActivationTarget.addEventListener('keydown', tryPlayActiveAudio, true);
    tryPlayActiveAudio();
}

let configuredActivationTarget = null;

/**
 * Applies the opt-in silent playback preference without starting playback until generation begins.
 */
export function setMobileBackgroundAudioPlayback({
    enabled,
    mobile,
    audio,
    activationTarget = document,
    onStatusChange = null,
}) {
    playbackEnabled = Boolean(enabled);
    mobileBrowser = Boolean(mobile);
    activeAudio = audio || null;
    configuredActivationTarget = activationTarget;
    statusListener = onStatusChange;
    syncPlayback();
}

/**
 * Starts generation-scoped silent playback and returns an idempotent release function.
 */
export function beginMobileBackgroundAudioGeneration() {
    activeGenerationCount++;
    syncPlayback();
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        activeGenerationCount = Math.max(0, activeGenerationCount - 1);
        syncPlayback();
    };
}
