import { POPUP_RESULT, POPUP_TYPE, Popup } from './popup.js';

/** @type {Popup} */
let loaderPopup;
let activeLoaderHandle = null;
let activeLoaderRootSelector = null;
let loaderHandleCounter = 0;

let preloaderYoinked = false;

const POPUP_LOADER_ROOT_ID = 'popup-loader';
const POPUP_LOADER_SPINNER_ID = 'load-spinner';

function buildLoaderMarkup(rootId, spinnerId) {
    return `
        <div id="${rootId}">
            <div class="loader-shell" aria-live="polite">
                <div class="loader-icon-wrap">
                    <div id="${spinnerId}" class="loader-spinner fa-solid fa-gear fa-spin fa-3x"></div>
                </div>
                <div class="loader-copy">We're working on your request, sit tight!</div>
            </div>
        </div>`;
}

function resetActiveLoaderState(handle = activeLoaderHandle) {
    if (handle && activeLoaderHandle !== handle) {
        return;
    }

    activeLoaderHandle = null;
    activeLoaderRootSelector = null;
    loaderPopup = null;
}

function removeActiveLoader(result = POPUP_RESULT.CANCELLED) {
    const rootSelector = activeLoaderRootSelector;
    const popup = loaderPopup;
    const handle = activeLoaderHandle;

    if (!rootSelector && !popup) {
        resetActiveLoaderState(handle);
        return;
    }

    if (rootSelector) {
        $(rootSelector).remove();
    }

    if (popup) {
        popup.complete(result).catch((err) => console.error('Error completing loaderPopup:', err));
    }

    resetActiveLoaderState(handle);
}

export function showLoader() {
    // Two loaders don't make sense. Don't await, we can overlay the old loader while it closes
    if (activeLoaderHandle) {
        removeActiveLoader(POPUP_RESULT.CANCELLED);
    }

    const handle = `loader-${++loaderHandleCounter}`;

    activeLoaderHandle = handle;

    loaderPopup = new Popup(buildLoaderMarkup(POPUP_LOADER_ROOT_ID, POPUP_LOADER_SPINNER_ID), POPUP_TYPE.DISPLAY, null, { transparent: true, animation: 'none', wide: true, large: true });
    activeLoaderRootSelector = `#${POPUP_LOADER_ROOT_ID}`;

    // No close button, loaders are not closable
    loaderPopup.closeButton.style.display = 'none';

    loaderPopup.show();
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
        const popup = loaderPopup;
        const loader = $(activeLoaderRootSelector);

        if (!loader.length) {
            console.warn('Loader element not found, skipping animation');
            cleanup();
            return;
        }

        // Check if transitions are enabled
        const transitionDuration = loader[0] ? getComputedStyle(loader[0]).transitionDuration : '0s';
        const hasTransitions = parseFloat(transitionDuration) > 0;

        if (hasTransitions) {
            Promise.race([
                new Promise((r) => setTimeout(r, 500)), // Fallback timeout
                new Promise((r) => loader.one('transitionend webkitTransitionEnd oTransitionEnd MSTransitionEnd', r)),
            ]).finally(cleanup);
        } else {
            cleanup();
        }

        function cleanup() {
            loader.remove();
            // Yoink preloader entirely; it only exists to cover up unstyled content while loading JS
            // If it's present, we remove it once and then it's gone.
            yoinkPreloader();

            if (popup) {
                popup.complete(POPUP_RESULT.AFFIRMATIVE)
                    .catch((err) => console.error('Error completing loaderPopup:', err))
                    .finally(() => {
                        resetActiveLoaderState(currentHandle);
                        resolve();
                    });
                return;
            }

            resetActiveLoaderState(currentHandle);
            resolve();
        }

        // Apply the styles
        loader.css({
            'filter': 'blur(15px)',
            'opacity': '0',
        });
    });
}

function yoinkPreloader() {
    if (preloaderYoinked) return;
    const preloader = document.getElementById('preloader');
    if (preloader) {
        preloader.remove();
    }
    preloaderYoinked = true;
}
