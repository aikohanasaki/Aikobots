let activeLoaderHandle = null;
let loaderHandleCounter = 0;
let pendingLoader = null;

const PRELOADER_SELECTOR = '#preloader';

function getPreloaderElement() {
    return document.querySelector(PRELOADER_SELECTOR);
}

function getNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function resetLoaderState(handle = activeLoaderHandle) {
    if (handle && activeLoaderHandle !== handle) {
        return;
    }

    activeLoaderHandle = null;
}

function resetPendingLoaderState(pending = pendingLoader) {
    if (pending && pendingLoader !== pending) {
        return;
    }

    pendingLoader = null;
}

export function isLoaderVisible() {
    const preloader = getPreloaderElement();
    return Boolean(preloader && !preloader.classList.contains('loader-hidden'));
}

export async function waitForLoaderPaint() {
    if (!isLoaderVisible()) {
        return;
    }

    await new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
            setTimeout(resolve, 0);
            return;
        }

        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

async function ensurePendingLoaderShown(pending, { force = false } = {}) {
    if (!pending || pending.cleared) {
        await waitForLoaderPaint();
        return false;
    }

    const elapsed = getNow() - pending.startedAt;
    if (!force && elapsed < pending.delayMs) {
        return false;
    }

    clearTimeout(pending.timer);

    if (!pending.handle) {
        pending.handle = showLoader();
    }

    await waitForLoaderPaint();
    return true;
}

export async function ensureDeferredLoaderShown({ force = false } = {}) {
    return ensurePendingLoaderShown(pendingLoader, { force });
}

export function showLoader() {
    const handle = `loader-${++loaderHandleCounter}`;
    activeLoaderHandle = handle;

    const preloader = getPreloaderElement();
    if (!preloader) {
        console.warn('Preloader element not found, skipping showLoader');
        return handle;
    }

    preloader.classList.remove('loader-hidden');
    preloader.setAttribute('aria-hidden', 'false');

    return handle;
}

export function deferLoader({ delayMs = 250 } = {}) {
    const pending = {
        handle: null,
        cleared: false,
        delayMs,
        startedAt: getNow(),
        timer: null,
    };

    pendingLoader = pending;
    pending.timer = setTimeout(() => {
        if (pending.cleared || pendingLoader !== pending) {
            return;
        }

        pending.handle = showLoader();
    }, delayMs);

    return {
        async ensureShown({ force = false } = {}) {
            if (pending.cleared) {
                return false;
            }

            return ensurePendingLoaderShown(pending, { force });
        },
        async clear() {
            if (pending.cleared) {
                return;
            }

            pending.cleared = true;
            clearTimeout(pending.timer);
            resetPendingLoaderState(pending);

            if (pending.handle) {
                await hideLoader(pending.handle);
            }
        },
    };
}

export async function hideLoader(handle = null) {
    const preloader = getPreloaderElement();

    if (!activeLoaderHandle && (!preloader || preloader.classList.contains('loader-hidden'))) {
        console.warn('There is no loader showing to hide');
        return Promise.resolve();
    }

    if (handle && handle !== activeLoaderHandle) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const currentHandle = activeLoaderHandle;

        if (!preloader) {
            console.warn('Preloader element not found, skipping hideLoader');
            resetLoaderState(currentHandle);
            resolve();
            return;
        }

        const transitionDuration = getComputedStyle(preloader).transitionDuration || '0s';
        const hasTransitions = parseFloat(transitionDuration) > 0;

        const cleanup = () => {
            preloader.setAttribute('aria-hidden', 'true');
            resetLoaderState(currentHandle);
            resolve();
        };

        preloader.classList.add('loader-hidden');

        if (!hasTransitions) {
            cleanup();
            return;
        }

        Promise.race([
            new Promise((r) => setTimeout(r, 500)),
            new Promise((r) => $(preloader).one('transitionend webkitTransitionEnd oTransitionEnd MSTransitionEnd', r)),
        ]).finally(cleanup);
    });
}
