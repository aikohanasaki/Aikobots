import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
    bundledStylesheets,
    defaultOutputDirectory,
    inlineStylesheet,
    legacyScripts,
    publicDirectory,
    rebaseCssUrls,
    retainedStylesheets,
} from '../scripts/frontend-build-lib.mjs';

test('frontend build rejects --output without a value', () => {
    const result = spawnSync(process.execPath, [path.join(path.dirname(publicDirectory), 'scripts', 'build-frontend.mjs'), '--output'], {
        encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing value for --output\./u);
});

test('legacy bundle preserves the declared classic-script order', async () => {
    const bundle = await fs.readFile(path.join(defaultOutputDirectory, 'legacy.js'), 'utf8');
    let previousIndex = -1;
    for (const script of legacyScripts) {
        const index = bundle.indexOf(`/* ${script} */`);
        assert.ok(index > previousIndex, `${script} must appear once in order`);
        assert.equal(bundle.indexOf(`/* ${script} */`, index + 1), -1);
        previousIndex = index;
    }
});

test('CSS URLs are rebased and imports are recursively inlined', async () => {
    const sourcePath = path.join(publicDirectory, 'css', 'popup.css');
    assert.equal(
        rebaseCssUrls('a{background:url(../img/test.png?v=1#icon)}', sourcePath),
        'a{background:url(/img/test.png?v=1#icon)}',
    );

    const bundled = await inlineStylesheet(path.join(publicDirectory, 'style.css'));
    assert.doesNotMatch(bundled, /@import/u);
    assert.match(bundled, /\.poly_dialog/u);
});

test('committed build stays within startup budgets and contains bundled registries', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(defaultOutputDirectory, 'manifest.json'), 'utf8'));
    assert.ok(manifest.initialRequestCount <= 12);
    assert.ok(manifest.initialGzipBytes <= 1.8 * 1024 * 1024);
    assert.equal(manifest.builtinExtensionCount, 13);
    assert.equal(manifest.stmbModuleCount, 29);
    assert.ok(manifest.assets.some(asset => asset.name === 'chunks/builtins.js'));
    assert.ok(manifest.assets.some(asset => asset.name === 'stmb.js'));
});

test('startup HTML references bundles and only retained dynamic stylesheets', async () => {
    const html = await fs.readFile(path.join(publicDirectory, 'index.html'), 'utf8');
    assert.match(html, /src="dist\/legacy\.js"/u);
    assert.match(html, /src="dist\/runtime\.js"/u);
    assert.match(html, /src="dist\/vendor\.js"/u);
    assert.match(html, /src="dist\/stmb\.js"/u);
    assert.match(html, /src="dist\/app\.js"/u);
    assert.match(html, /href="dist\/app\.css"/u);
    for (const stylesheet of retainedStylesheets) {
        assert.match(html, new RegExp(`href="${stylesheet.replaceAll('.', '\\.')}"`, 'u'));
    }
    for (const stylesheet of bundledStylesheets) {
        assert.doesNotMatch(html, new RegExp(`href="${stylesheet.replaceAll('.', '\\.')}"`, 'u'));
    }
    assert.doesNotMatch(html, /src="(?:script\.js|scripts\/|lib\/)/u);
});

test('Claude uses the searchable editable model selector', async () => {
    const [html, source] = await Promise.all([
        fs.readFile(path.join(publicDirectory, 'index.html'), 'utf8'),
        fs.readFile(path.join(publicDirectory, 'scripts', 'openai.js'), 'utf8'),
    ]);
    assert.match(html, /<select id="model_claude_select" required><\/select>/u);
    assert.doesNotMatch(html, /model_claude_suggestions/u);
    assert.match(source, /\$\('#model_claude_select'\)\.select2\(\{[\s\S]*?tags: true,/u);
});

test('v5 client excludes third-party discovery, controls, and runtime compilation', async () => {
    const [extensions, assets, backgrounds, server] = await Promise.all([
        fs.readFile(path.join(publicDirectory, 'scripts', 'extensions.js'), 'utf8'),
        fs.readFile(path.join(publicDirectory, 'scripts', 'extensions', 'assets', 'index.js'), 'utf8'),
        fs.readFile(path.join(publicDirectory, 'scripts', 'backgrounds.js'), 'utf8'),
        fs.readFile(path.join(path.dirname(publicDirectory), 'src', 'server-main.js'), 'utf8'),
    ]);
    assert.doesNotMatch(extensions, /\/api\/extensions\/discover/u);
    assert.doesNotMatch(extensions, /id="third_party_extension_button"/u);
    assert.match(extensions, /const isDisabled = extension_settings\.disabledExtensions\.includes\(name\)/u);
    assert.match(extensions, /&& !isDisabled\) \{/u);
    assert.match(assets, /filter\(type => type !== 'extension'\)/u);
    assert.doesNotMatch(backgrounds, /openThirdPartyExtensionMenu/u);
    assert.doesNotMatch(server, /webpack|runWebpackCompiler/u);
});

test('application and provenance identify the release as v5', async () => {
    const [packageSource, provenance] = await Promise.all([
        fs.readFile(path.join(path.dirname(publicDirectory), 'package.json'), 'utf8'),
        fs.readFile(path.join(path.dirname(publicDirectory), 'Code Provenance v5.md'), 'utf8'),
    ]);
    assert.equal(JSON.parse(packageSource).version, '5.1.0');
    assert.match(provenance, /^# Aikobots v5:/u);
    assert.match(provenance, /All 28 `stmb\.js` and `stmb-\*\.js` modules/u);
    assert.match(provenance, /13 built-in extensions/u);
});
