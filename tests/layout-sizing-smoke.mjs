import assert from 'node:assert/strict';

const layouts = ['classic', 'wide', 'compact', 'leftDock', 'workspaceRight', 'compactOps', 'topComposer'];
const fixedLayouts = new Set(['leftDock', 'workspaceRight', 'compactOps']);

/** Applies the real layout selector and waits for the stylesheet transaction. */
async function selectLayout(page, id) {
    await page.locator('#aiko_layout_module').evaluate((select, value) => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
    await page.waitForFunction(value => document.body.dataset.aikoLayout === value
        && globalThis.SillyTavern.getContext().powerUserSettings.aiko_layout === value, id);
}

/** Uses the numeric input's forced-update path, including its production lock guard. */
async function setWidth(page, width) {
    await page.evaluate(value => $('#chat_width_slider').val(value).trigger('input', { forced: true }), width);
}

/** Tests the browser's native resize grip without substituting scripted style changes. */
async function resizeWithMouse(page, selector) {
    const element = page.locator(selector);
    const before = await element.boundingBox();
    await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width + 97, before.y + before.height - 3, { steps: 5 });
    await page.mouse.up();
    return (await element.boundingBox()).width > before.width + 50;
}

/** Measures actual shell/panel geometry, including hidden panels' computed widths. */
async function geometry(page) {
    return page.evaluate(() => {
        const rect = id => {
            const element = document.getElementById(id);
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { x: box.x, y: box.y, width: box.width, height: box.height, cssWidth: parseFloat(style.width) };
        };
        return {
            shell: rect('sheld'), top: rect('top-bar'), composer: rect('form_sheld'), chat: rect('chat'),
            left: rect('left-nav-panel'), right: rect('right-nav-panel'),
            floating: rect('floatingPrompt'), cfg: rect('cfgConfig'),
            font: parseFloat(getComputedStyle(document.body).fontSize),
            slider: document.getElementById('chat_width_slider').disabled,
            counter: document.getElementById('chat_width_slider_counter').disabled,
            savedWidth: globalThis.SillyTavern.getContext().powerUserSettings.chat_width,
        };
    });
}

/** Opens pinned drawers through their existing controls, checking overlay and scrolling. */
async function checkPanels(page, viewportWidth) {
    const before = (await geometry(page)).shell;
    await page.evaluate(() => {
        document.querySelectorAll('#lm_button_panel_pin, #rm_button_panel_pin').forEach(pin => {
            if (!pin.checked) pin.click();
        });
        document.getElementById('leftNavDrawerIcon').click();
    });
    await page.locator('#left-nav-panel.openDrawer').waitFor({ state: 'visible' });
    assert.deepEqual((await geometry(page)).shell, before, 'Opening left panel changed chat bounds.');
    await page.locator('#rightNavDrawerIcon').evaluate(icon => icon.click());
    await page.locator('#right-nav-panel.openDrawer').waitFor({ state: 'visible' });
    const both = await geometry(page);
    assert.equal(await page.locator('#left-nav-panel').evaluate(panel => panel.className), 'drawer-content fillLeft pinnedOpen openDrawer', 'Pinned left panel must remain open beside the right panel.');
    assert.deepEqual(both.shell, before, 'Opening both panels changed chat bounds.');
    for (const key of ['left', 'right']) {
        assert.ok(both[key].width >= 449 && both[key].x >= -1
            && both[key].x + both[key].width <= viewportWidth + 1, `${key} panel outside viewport: ${JSON.stringify(both[key])}`);
    }
    assert.equal(await page.locator('#left-nav-panel > .scrollableInner').evaluate(element => {
        const style = getComputedStyle(element);
        return element.clientHeight > 0 && style.overflowY === 'auto';
    }), true, 'Left panel must retain a usable scroll container.');
    await page.locator('#leftNavDrawerIcon').evaluate(icon => icon.click());
    assert.deepEqual((await geometry(page)).shell, before, 'Right-only panel changed chat bounds.');
    await page.locator('#rightNavDrawerIcon').evaluate(icon => icon.click());
    await page.evaluate(() => document.querySelectorAll('#lm_button_panel_pin, #rm_button_panel_pin').forEach(pin => {
        if (pin.checked) pin.click();
    }));
    assert.equal(await page.locator('#left-nav-panel.openDrawer, #right-nav-panel.openDrawer').count(), 0);
}

/** Exercises preset widths, custom-layout compatibility, and movable-panel precedence in the real app. */
export async function testLayoutSizing(page) {
    const originalViewport = page.viewportSize();
    const originalWidth = (await geometry(page)).savedWidth;
    const probe = await page.context().browser().newPage();
    let nativeResize;
    try {
        await probe.setContent('<div style="position:absolute;left:20px;top:20px;width:200px;height:200px;overflow:hidden;resize:both;background:gray"></div>');
        nativeResize = await resizeWithMouse(probe, 'div');
    } finally {
        await probe.close();
    }
    if (!nativeResize) console.log('Native resize-grip check unavailable: this browser port cannot resize a plain CSS box with pointer automation.');
    for (const viewportWidth of [1024, 1440, 1920]) {
        await page.setViewportSize({ width: viewportWidth, height: 1000 });
        for (const id of layouts) {
            await selectLayout(page, id);
            const before = await geometry(page);
            for (const width of [25, 50, 90, 100]) {
                await setWidth(page, width);
                const current = await geometry(page);
                const fixed = fixedLayouts.has(id);
                assert.equal(current.slider, fixed, `${id}: incorrect slider lock`);
                assert.equal(current.counter, fixed, `${id}: incorrect numeric lock`);
                assert.equal(current.savedWidth, fixed ? before.savedWidth : width, `${id}: locked input changed settings`);
                assert.ok(Math.abs(current.shell.width - (fixed ? before.shell.width : viewportWidth * width / 100)) < 1, `${id}: chat width did not follow its owner`);
                assert.ok(Math.abs(current.top.width - current.shell.width) < 1, `${id}: top bar and shell diverged`);
                const remainder = (viewportWidth - current.shell.width - 2) / 2;
                const gap = Math.min(28, Math.max(12, viewportWidth * 0.02));
                const leftWidth = id === 'workspaceRight' ? current.shell.width : id === 'wide' ? Math.max(viewportWidth * 0.3, remainder) : remainder;
                const rightWidth = id === 'workspaceRight' ? viewportWidth - current.shell.width - gap * 2 - 2 : leftWidth;
                const floatingWidth = id === 'workspaceRight' ? rightWidth : remainder;
                const expectedWidths = { left: leftWidth, right: rightWidth, floating: floatingWidth, cfg: floatingWidth };
                for (const key of ['left', 'right', 'floating', 'cfg']) {
                    assert.ok(current[key].cssWidth >= 449 && current[key].cssWidth <= viewportWidth, `${id}: ${key} width ${current[key].cssWidth}`);
                    assert.ok(Math.abs(current[key].cssWidth - Math.max(450, expectedWidths[key])) < 1, `${id}: ${key} retained an inherited width`);
                }
                if (id === 'compact' || id === 'compactOps') {
                    const font = 15 * (id === 'compact' ? 0.9 : 0.88);
                    const topHeight = font * 2 * (id === 'compact' ? 0.8 : 0.78) + font / 3;
                    assert.ok(Math.abs(current.font - font) < 0.1, `${id}: inherited font scale`);
                    assert.ok(Math.abs(current.top.height - topHeight) < 1, `${id}: inherited icon height`);
                    assert.ok(Math.abs(current.shell.y - topHeight) < 1, `${id}: inherited shell top`);
                    assert.ok(current.chat.y + current.chat.height <= current.composer.y + 1, `${id}: chat overlaps composer`);
                    assert.ok(current.composer.y + current.composer.height <= 1000, `${id}: composer below viewport`);
                }
            }
            await checkPanels(page, viewportWidth);
        }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await selectLayout(page, 'classic');
    await setWidth(page, 50);
    // Known pre-patch contract geometry: body overrides do not recompute root dependencies.
    const customCases = [
        { name: 'root', css: ':root { --aiko-layout-chat-width: 800px; }', shell: 800, panel: 319, locked: true },
        { name: 'body', css: 'body.layout-custom { --aiko-layout-chat-width: 800px; }', shell: 800, panel: 359, locked: true },
        { name: 'explicit', css: 'body.layout-custom #sheld { width: 650px; }', shell: 650, panel: 359, locked: false },
        { name: 'delegated', css: 'body.layout-custom { --aiko-layout-chat-width: min(var(--sheldWidth, 50vw), 100dvw); }', shell: 720, panel: 359, locked: false },
        { name: 'alias', css: 'body.layout-custom { --my-width: var(--sheldWidth); --aiko-layout-chat-width: var(--my-width); }', shell: 720, panel: 359, locked: true },
        { name: 'legacy', css: 'body.layout-custom { --sheldWidth: 600px; }', shell: 720, panel: 359, locked: true },
    ];
    for (const custom of customCases) {
        const filename = `layout-smoke-${custom.name}.css`;
        await page.locator('#aiko_layout_css_upload').setInputFiles({ name: filename, mimeType: 'text/css', buffer: Buffer.from(custom.css) });
        await page.waitForFunction(id => document.body.dataset.aikoLayout === id, `custom:${filename}`);
        const measured = await geometry(page);
        assert.ok(Math.abs(measured.shell.width - custom.shell) < 1, `${custom.name}: custom shell geometry changed`);
        assert.ok(Math.abs(measured.left.cssWidth - custom.panel) < 1, `${custom.name}: custom panel geometry changed`);
        assert.equal(measured.slider, custom.locked, `${custom.name}: custom lock incorrect`);
        if (custom.name === 'delegated') {
            await setWidth(page, 60);
            assert.ok(Math.abs((await geometry(page)).shell.width - 864) < 1);
            await setWidth(page, 50);
        }
    }

    await selectLayout(page, 'classic');
    await page.evaluate(() => $('#movingUImode').prop('checked', true).trigger('change'));
    // Inline user resizing must remain authoritative even below the default panel floor.
    await page.locator('#left-nav-panel').evaluate(panel => { panel.style.width = '300px'; });
    assert.equal((await geometry(page)).left.cssWidth, 300, 'Default floor overrode an inline panel resize.');
    await page.locator('#left-nav-panel').evaluate(panel => panel.style.removeProperty('width'));
    const handle = await page.locator('#sheldheader').boundingBox();
    assert.ok(handle, 'Moving UI drag handle unavailable.');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 40, handle.y + handle.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => document.getElementById('chat_width_slider').disabled);
    const draggedWidth = (await geometry(page)).savedWidth;
    await setWidth(page, 95);
    assert.equal((await geometry(page)).savedWidth, draggedWidth, 'Dragged shell allowed slider settings to change.');
    assert.equal(await page.locator('#themes').isDisabled(), false, 'Movable width disabled theme presets.');
    if (nativeResize) assert.equal(await resizeWithMouse(page, '#sheld'), true, 'Native shell resizing stopped working.');
    assert.equal(await page.locator('#chat_width_slider').isDisabled(), true, 'Native resize cleared the width lock.');
    const moved = await page.locator('#sheld').getAttribute('style');
    await selectLayout(page, 'leftDock');
    assert.equal(await page.locator('#sheld').getAttribute('style'), moved, 'Layout switch erased geometry.');
    await page.locator('#movingUIreset').evaluate(button => button.click());
    await page.waitForFunction(() => !document.getElementById('sheld').style.width && !document.getElementById('sheld').classList.contains('resizing'));
    assert.equal(await page.locator('#chat_width_slider').isDisabled(), true, 'Reset cleared layout-owned lock.');
    await selectLayout(page, 'classic');
    assert.equal(await page.locator('#chat_width_slider').isDisabled(), false, 'Reset did not restore slider.');

    // Restore an actual saved resize using the normal settings and reload path.
    const savedResize = page.waitForResponse(response => response.url().endsWith('/api/settings/save') && response.ok()
        && response.request().postDataJSON()?.power_user?.movingUIState?.sheld?.width === 620);
    await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        context.powerUserSettings.movingUIState.sheld = { width: 620, height: 700, left: 75, top: 80, right: 'auto', bottom: 'auto', margin: 'unset' };
        context.saveSettingsDebounced();
    });
    await (await savedResize).finished();
    await page.waitForLoadState('networkidle');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.SillyTavern);
    await page.evaluate(() => new Promise(resolve => {
        const context = globalThis.SillyTavern.getContext();
        context.eventSource.once(context.eventTypes.APP_READY, resolve);
    }));
    await page.waitForFunction(() => document.getElementById('sheld')?.style.width === '620px');
    await page.waitForFunction(() => document.getElementById('chat_width_slider').disabled);
    assert.ok(Math.abs((await geometry(page)).shell.width - 620) < 1, 'Saved width not restored.');
    await selectLayout(page, 'wide');
    assert.ok(Math.abs((await geometry(page)).shell.width - 620) < 1, 'Preset replaced saved width.');
    await page.locator('#movingUIreset').evaluate(button => button.click());
    await page.waitForFunction(() => !document.getElementById('chat_width_slider').disabled && !document.getElementById('sheld').classList.contains('resizing'));
    await page.evaluate(() => $('#movingUImode').prop('checked', false).trigger('change'));

    for (const width of [1000, 600]) {
        await page.setViewportSize({ width, height: 900 });
        for (const id of layouts) {
            await selectLayout(page, id);
            const measured = await geometry(page);
            assert.ok(Math.abs(measured.shell.width - width) < 1, `${id}: mobile shell width changed`);
            for (const key of ['left', 'right', 'floating', 'cfg']) {
                assert.ok(Math.abs(measured[key].cssWidth - width) < 1, `${id}: mobile ${key} width changed`);
            }
        }
    }
    await page.setViewportSize(originalViewport);
    await selectLayout(page, 'classic');
    await setWidth(page, originalWidth);
}
