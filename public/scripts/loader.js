let activeLoaderHandle = null;
let loaderHandleCounter = 0;

const PRELOADER_SELECTOR = '#preloader';

function getPreloaderElement() {
    return document.querySelector(PRELOADER_SELECTOR);
}

function resetLoaderState(handle = activeLoaderHandle) {
    if (handle && activeLoaderHandle !== handle) {
        return;
    }

    activeLoaderHandle = null;
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
    let handle = null;
    let cleared = false;
    const timer = setTimeout(() => {
        if (cleared) {
            return;
        }

        handle = showLoader();
    }, delayMs);

    return {
        async clear() {
            if (cleared) {
                return;
            }

            cleared = true;
            clearTimeout(timer);

            if (handle) {
                await hideLoader(handle);
            }
        },
    };
}

export async function hideLoader(handle = null) {
    if (!activeLoaderHandle) {
        console.warn('There is no loader showing to hide');
        return Promise.resolve();
    }

    if (handle && handle !== activeLoaderHandle) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const currentHandle = activeLoaderHandle;
        const preloader = getPreloaderElement();

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
