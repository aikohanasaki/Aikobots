import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getChatVisualViewportGeometry,
    installChatVisualViewportFix,
} from '../public/scripts/chat-visual-viewport.js';

class StyleDeclaration {
    values = new Map();

    setProperty(name, value) {
        this.values.set(name, value);
    }

    removeProperty(name) {
        this.values.delete(name);
    }

    getPropertyValue(name) {
        return this.values.get(name) ?? '';
    }
}

function createBrowserHarness() {
    const input = new EventTarget();
    const viewport = new EventTarget();
    const windowObject = new EventTarget();
    const style = new StyleDeclaration();
    const frames = new Map();
    let nextFrame = 1;

    viewport.height = 260;
    viewport.offsetTop = 104;
    windowObject.visualViewport = viewport;
    windowObject.requestAnimationFrame = callback => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
    };
    windowObject.cancelAnimationFrame = id => frames.delete(id);

    const documentObject = {
        activeElement: null,
        documentElement: { style },
        getElementById: id => id === 'send_textarea' ? input : null,
    };

    return {
        documentObject,
        flushAnimationFrame() {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback());
        },
        input,
        style,
        viewport,
        windowObject,
    };
}

test('visual viewport geometry preserves the iOS keyboard offset', () => {
    assert.deepEqual(getChatVisualViewportGeometry({ height: 260, offsetTop: 104 }), {
        height: '260px',
        top: '104px',
    });
    assert.equal(getChatVisualViewportGeometry({ height: 0, offsetTop: 104 }), null);
});

test('chat viewport fix follows the focused composer and clears on blur', () => {
    const harness = createBrowserHarness();
    const fix = installChatVisualViewportFix(harness);

    harness.documentObject.activeElement = harness.input;
    harness.input.dispatchEvent(new Event('focus'));
    harness.flushAnimationFrame();

    assert.equal(fix.isActive(), true);
    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-height'), '260px');
    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-top'), '104px');

    harness.viewport.offsetTop = 120;
    harness.viewport.dispatchEvent(new Event('scroll'));
    harness.flushAnimationFrame();

    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-top'), '120px');

    harness.viewport.height = 600;
    harness.viewport.offsetTop = 0;
    harness.viewport.dispatchEvent(new Event('resize'));
    harness.flushAnimationFrame();

    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-height'), '600px');
    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-top'), '0px');

    harness.documentObject.activeElement = null;
    harness.input.dispatchEvent(new Event('blur'));

    assert.equal(fix.isActive(), false);
    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-height'), '');
    assert.equal(harness.style.getPropertyValue('--aiko-chat-visual-viewport-top'), '');

    fix.destroy();
});
