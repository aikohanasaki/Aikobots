import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveSystemChromiumPath } from '../scripts/browser-path.mjs';

test('HTML export renders hidden elements and colors while sanitizing message HTML', async () => {
    const script = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');
    const chats = await fs.readFile(new URL('../public/scripts/chats.js', import.meta.url), 'utf8');
    // Exercise the production helpers without booting or mutating an active chat.
    const extract = (source, start, end) => {
        source = source.replace(/\r\n/g, '\n');
        const offset = source.indexOf(start);
        assert.ok(offset >= 0);
        const limit = source.indexOf(end, offset);
        assert.ok(limit > offset);
        return source.slice(offset, limit).replace(/^export /gm, '');
    };
    const browser = await chromium.launch({ executablePath: resolveSystemChromiumPath() || undefined });
    try {
        const page = await browser.newPage();
        for (const path of [
            'node_modules/dompurify/dist/purify.js',
            'node_modules/showdown/dist/showdown.js',
            'node_modules/@adobe/css-tools/dist/umd/adobe-css-tools.js',
        ]) {
            await page.addScriptTag({ path });
        }
        await page.addScriptTag({ content: [
            'const css = cssTools; const converter = new showdown.Converter({ simpleLineBreaks: true });',
            'const isExternalMediaAllowed = () => true;',
            extract(chats, 'export function encodeStyleTags(', '\n/**'),
            extract(chats, 'export function decodeStyleTags(', '\n/**\n * Formats creator notes'),
            extract(chats, 'export function addDOMPurifyHooks(', '\n/**'),
            extract(script, 'function formatManageChatsHtmlText(', '\nfunction toManageChatsAbsoluteAssetUrl'),
            'addDOMPurifyHooks();',
        ].join('\n') });
        const result = await page.evaluate(() => {
            document.body.innerHTML = '<div class="message-text"></div><span class="custom-hidden" id="outside">Outside</span>';
            document.querySelector('.message-text').innerHTML = formatManageChatsHtmlText(`
<style>.hidden { display: none; } .colored { color: rgb(12, 34, 56); background-color: rgb(65, 43, 21); }</style>
<div class="hidden"><b>Hidden by stylesheet</b></div>
<span style="display: none">Hidden inline</span>
<span class="colored">Colored by stylesheet</span>
<span style="color: rgb(78, 90, 12)">Colored inline</span>
<script>window.exportScriptExecuted = true;</script>
<img onerror="window.exportScriptExecuted = true">

**Bold** and *italic*`);
            const root = document.querySelector('.message-text');
            return {
                hidden: getComputedStyle(root.querySelector('.custom-hidden')).display,
                inlineHidden: getComputedStyle(root.querySelector('span')).display,
                color: getComputedStyle(root.querySelector('.custom-colored')).color,
                background: getComputedStyle(root.querySelector('.custom-colored')).backgroundColor,
                inlineColor: getComputedStyle(root.querySelector('span[style*="color"]')).color,
                outside: getComputedStyle(document.querySelector('#outside')).display,
                unsafe: !!root.querySelector('script, [onerror]') || !!window.exportScriptExecuted,
                markdown: !!root.querySelector('strong') && !!root.querySelector('em'),
            };
        });
        assert.deepEqual(result, {
            hidden: 'none', inlineHidden: 'none', color: 'rgb(12, 34, 56)',
            background: 'rgb(65, 43, 21)', inlineColor: 'rgb(78, 90, 12)',
            outside: 'inline', unsafe: false, markdown: true,
        });
    } finally {
        await browser.close();
    }
});
