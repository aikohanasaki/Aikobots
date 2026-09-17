import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveSystemChromiumPath } from '../scripts/browser-path.mjs';

/** Builds the production popup with a synthetic reader and the real popup stylesheet. */
async function popupHtml(focusMessageId, anchoring) {
    const source = await fs.readFile(new URL('../public/scripts/chat-popout.js', import.meta.url), 'utf8');
    const css = await fs.readFile(new URL('../public/css/chat-popout.css', import.meta.url), 'utf8');
    const start = source.indexOf('function buildChatPopoutHtml(');
    const end = source.indexOf('export function openChatPopoutWindow(', start);
    assert.ok(start >= 0 && end > start);
    const constants = source.slice(source.indexOf('const READER_BATCH_SIZE'), source.indexOf('function buildReaderContext'));
    const build = new Function(`${constants}
        const getPopupAssetUrls = () => [];
        const getChatPopoutColorScheme = () => 'light';
        const document = { body: { classList: { contains: () => false } } };
        ${source.slice(start, end)}
        return buildChatPopoutHtml;
    `)();
    return build({ focusMessageId, context: { type: 'synthetic' } }).replace('<head>', `<head>
        <style>${css}
            .chat-popout-log { overflow-anchor: ${anchoring}; }
            .mes { box-sizing: border-box; }
        </style>
        <script>
            window.opener = window;
            window.pendingChunks = [];
            window.requests = [];
            window.ChatPopout = { loadChunk: async (_, { rangeStart, count }) => {
                const first = requests.length === 0;
                requests.push({ rangeStart, count });
                if (!first) await new Promise(resolve => pendingChunks.push(resolve));
                const end = Math.min(200, rangeStart + count);
                return {
                    totalMessages: 200, loadedRangeStart: rangeStart, loadedRangeEnd: end - 1,
                    html: Array.from({ length: end - rangeStart }, (_, i) => {
                        const id = rangeStart + i;
                        const height = id === 131 ? 1100 : 80 + id % 7 * 23;
                        return '<div class="mes" mesid="' + id + '" style="height:' + height + 'px">'
                            + '<div class="mes_buttons"><button class="mes_edit">Edit</button><button class="mes_copy">Copy</button><button class="mes_delete">Delete</button></div>'
                            + '<div class="mes_text">Message ' + id + '</div></div>';
                    }).join(''),
                };
            } };
        </script>`);
}

/** Lets layout and scroll events finish without depending on animation timing. */
async function settle(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Returns viewport-relative message geometry and the loaded range. */
async function geometry(page, id) {
    return page.evaluate(id => {
        const root = document.querySelector('.chat-popout-log');
        const target = root.querySelector(`[mesid="${id}"]`);
        const messages = root.querySelectorAll('.mes');
        return {
            top: target.getBoundingClientRect().top - root.getBoundingClientRect().top,
            viewport: root.clientHeight,
            atBottom: Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) <= 1,
            first: Number(messages[0].getAttribute('mesid')),
            last: Number(messages[messages.length - 1].getAttribute('mesid')),
        };
    }, id);
}

test('bookmark jumps and incremental loading preserve the intended message position', async () => {
    const browser = await chromium.launch({ executablePath: resolveSystemChromiumPath() || undefined });
    try {
        const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const anchoring of ['auto', 'none']) {
            for (const id of [68, 131, 0, 199]) {
                // Reuse the same document/window, as successive bookmark clicks do.
                await page.setContent(await popupHtml(id, anchoring));
                await page.waitForFunction(() => window.requests.length > 1);
                await settle(page);
                const initial = await geometry(page, id);
                assert.ok(Math.abs(initial.top) <= 1 || (initial.atBottom && initial.top >= 0 && initial.top < initial.viewport),
                    `Bookmark ${id} (${anchoring}) was not positioned at its beginning: ${JSON.stringify(initial)}`);
                await page.evaluate(() => pendingChunks.splice(0).forEach(resolve => resolve()));
                await page.waitForFunction(() => document.getElementById('chat-popout-loading').dataset.hidden === 'true');
                await settle(page);
                const loaded = await geometry(page, id);
                assert.ok(Math.abs(loaded.top - initial.top) <= 1, `Loading moved bookmark ${id} (${anchoring})`);

                if (id !== 131) continue;
                // Request more history, then scroll away before its response arrives.
                await page.evaluate(() => { document.querySelector('.chat-popout-log').scrollTop = 0; });
                await page.waitForFunction(() => pendingChunks.length > 0);
                await page.evaluate(() => { document.querySelector('.chat-popout-log').scrollTop = 350; });
                await settle(page);
                const before = await geometry(page, loaded.first);
                await page.evaluate(() => pendingChunks.splice(0).forEach(resolve => resolve()));
                await settle(page);
                const after = await geometry(page, loaded.first);
                assert.ok(after.first < before.first, 'Earlier messages must load');
                assert.ok(Math.abs(after.top - before.top) <= 1, `Delayed prepend moved the reader (${anchoring})`);

                await page.evaluate(() => {
                    const root = document.querySelector('.chat-popout-log');
                    root.scrollTop = root.scrollHeight;
                });
                await page.waitForFunction(() => pendingChunks.length > 0);
                await page.evaluate(() => pendingChunks.splice(0).forEach(resolve => resolve()));
                await settle(page);
                assert.ok((await geometry(page, id)).last > loaded.last, 'Later messages must still load');
            }
        }
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

test('loading batches preserves active edits and initializes each message only once', async () => {
    const browser = await chromium.launch({ executablePath: resolveSystemChromiumPath() || undefined });
    try {
        const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
        await page.setContent(await popupHtml(68, 'auto'));
        await page.waitForFunction(() => window.pendingChunks.length === 2);
        await page.locator('[mesid="68"] .mes_edit').dispatchEvent('pointerup');
        await page.locator('[mesid="68"] .mes_text').fill('Edited locally');
        await page.evaluate(() => window.pendingChunks.splice(0).forEach(resolve => resolve()));
        await page.waitForFunction(() => document.getElementById('chat-popout-loading').dataset.hidden === 'true');
        await settle(page);
        assert.deepEqual(await page.locator('[mesid="68"] .mes_text').evaluate(element => ({
            text: element.textContent,
            editing: element.contentEditable,
            focused: document.activeElement === element,
        })), { text: 'Edited locally', editing: 'plaintext-only', focused: true });
        assert.equal(await page.locator('.mes_delete').count(), 0);
        assert.equal(await page.locator('.chat-popout-target').count(), 1);

        // Count handler invocations without blur causing an additional focus event.
        for (const id of [68, 8, 78]) {
            assert.deepEqual(await page.locator(`[mesid="${id}"] .mes_text`).evaluate(element => {
                element.blur();
                let calls = 0;
                element.blur = () => { calls++; };
                element.contentEditable = 'plaintext-only';
                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                const escapeCalls = calls;
                element.contentEditable = 'plaintext-only';
                element.dispatchEvent(new FocusEvent('blur'));
                return { escapeCalls, blurCalls: calls - escapeCalls, editing: element.contentEditable };
            }), { escapeCalls: 1, blurCalls: 1, editing: 'false' });
        }
    } finally {
        await browser.close();
    }
});
