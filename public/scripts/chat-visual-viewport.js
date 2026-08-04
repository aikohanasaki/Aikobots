const CHAT_VIEWPORT_HEIGHT_PROPERTY = '--aiko-chat-visual-viewport-height';
const CHAT_VIEWPORT_TOP_PROPERTY = '--aiko-chat-visual-viewport-top';

/**
 * Returns safe CSS values for positioning the chat inside the visual viewport.
 * @param {{ height: number, offsetTop: number }} viewport Visual viewport measurements.
 * @returns {{ height: string, top: string } | null} CSS values, or null for invalid measurements.
 */
export function getChatVisualViewportGeometry(viewport) {
    const height = Number(viewport?.height);
    const top = Number(viewport?.offsetTop);

    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(top)) {
        return null;
    }

    return {
        height: `${height}px`,
        top: `${Math.max(0, top)}px`,
    };
}

/**
 * Keeps the chat shell aligned with the visible iOS viewport while its composer is focused.
 * @param {object} [dependencies] Browser dependencies for testing.
 * @param {Window} [dependencies.windowObject] Window containing the visual viewport.
 * @param {Document} [dependencies.documentObject] Document containing the chat composer.
 * @returns {{ destroy: () => void, isActive: () => boolean }} Fix lifecycle and active-state accessors.
 */
export function installChatVisualViewportFix({
    windowObject = window,
    documentObject = document,
} = {}) {
    const viewport = windowObject.visualViewport;
    const input = documentObject.getElementById('send_textarea');
    const rootStyle = documentObject.documentElement?.style;

    if (!viewport || !input || !rootStyle) {
        return {
            destroy: () => {},
            isActive: () => false,
        };
    }

    let animationFrame = null;
    const isActive = () => documentObject.activeElement === input;
    const clear = () => {
        rootStyle.removeProperty(CHAT_VIEWPORT_HEIGHT_PROPERTY);
        rootStyle.removeProperty(CHAT_VIEWPORT_TOP_PROPERTY);
    };
    const sync = () => {
        animationFrame = null;

        if (!isActive()) {
            clear();
            return;
        }

        const geometry = getChatVisualViewportGeometry(viewport);
        if (!geometry) {
            clear();
            return;
        }

        rootStyle.setProperty(CHAT_VIEWPORT_HEIGHT_PROPERTY, geometry.height);
        rootStyle.setProperty(CHAT_VIEWPORT_TOP_PROPERTY, geometry.top);
    };
    const scheduleSync = () => {
        if (animationFrame !== null) {
            windowObject.cancelAnimationFrame(animationFrame);
        }

        animationFrame = windowObject.requestAnimationFrame(sync);
    };
    const handleBlur = () => {
        if (animationFrame !== null) {
            windowObject.cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }

        clear();
    };

    input.addEventListener('focus', scheduleSync);
    input.addEventListener('blur', handleBlur);
    viewport.addEventListener('resize', scheduleSync);
    viewport.addEventListener('scroll', scheduleSync);
    windowObject.addEventListener('orientationchange', scheduleSync);

    return {
        isActive,
        destroy: () => {
            input.removeEventListener('focus', scheduleSync);
            input.removeEventListener('blur', handleBlur);
            viewport.removeEventListener('resize', scheduleSync);
            viewport.removeEventListener('scroll', scheduleSync);
            windowObject.removeEventListener('orientationchange', scheduleSync);
            handleBlur();
        },
    };
}
