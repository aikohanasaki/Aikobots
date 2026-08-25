import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import webpack from 'webpack';
import getFrontendConfig from '../webpack.config.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(moduleDirectory, '..');
export const publicDirectory = path.join(projectRoot, 'public');
export const defaultOutputDirectory = path.join(publicDirectory, 'dist');

export const legacyScripts = [
    'lib/polyfill.js',
    'lib/jquery-3.5.1.min.js',
    'lib/jquery-ui.min.js',
    'lib/jquery.transit.min.js',
    'lib/jquery-cookie-1.4.1.min.js',
    'lib/jquery.ui.touch-punch.min.js',
    'lib/cropper.min.js',
    'lib/jquery-cropper.min.js',
    'lib/toastr.min.js',
    'lib/select2.min.js',
    'lib/select2-search-placeholder.js',
    'lib/pagination.js',
    'lib/toolcool-color-picker.js',
    'lib/jquery.izoomify.js',
];

export const bundledStylesheets = [
    'webfonts/NotoSans/stylesheet.css',
    'webfonts/NotoSansMono/stylesheet.css',
    'css/fontawesome.min.css',
    'css/solid.min.css',
    'css/brands.min.css',
    'css/jquery-ui.min.css',
    'css/bright.min.css',
    'css/cropper.min.css',
    'css/toastr.min.css',
    'css/select2.min.css',
    'style.css',
    'css/st-tailwind.css',
    'css/rm-groups.css',
    'css/group-avatars.css',
    'css/toggle-dependent.css',
    'css/world-info.css',
    'css/extensions-panel.css',
    'css/select2-overrides.css',
    'css/mobile-styles.css',
    'css/layouts/layout-contract.css',
];

export const retainedStylesheets = [
    'css/layouts/layout-structure.css',
    'css/layouts/classic.css',
    'css/user.css',
];

const startupTemplateNames = [
    'help',
    'hotkeys',
    'formatting',
    'macros',
    'welcome',
    'welcomePrompt',
    'assistantNote',
];

function compareNames(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function toPublicUrl(filePath) {
    return `/${path.relative(publicDirectory, filePath).split(path.sep).join('/')}`;
}

function isExternalCssUrl(url) {
    return /^(?:[a-z]+:|\/|#|data:|blob:)/iu.test(url);
}

function isExternalCssImport(url) {
    return /^(?:[a-z]+:|#|data:|blob:)/iu.test(url);
}

/**
 * Rebases relative CSS URLs against the source stylesheet.
 * @param {string} css CSS source.
 * @param {string} sourcePath Source stylesheet path.
 * @returns {string} Rebased CSS.
 */
export function rebaseCssUrls(css, sourcePath) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/giu, (match, quote, rawUrl) => {
        const url = rawUrl.trim();
        if (isExternalCssUrl(url)) {
            return match;
        }

        const suffixIndex = url.search(/[?#]/u);
        const pathname = suffixIndex === -1 ? url : url.slice(0, suffixIndex);
        const suffix = suffixIndex === -1 ? '' : url.slice(suffixIndex);
        const resolved = path.resolve(path.dirname(sourcePath), pathname);
        return `url(${quote}${toPublicUrl(resolved)}${suffix}${quote})`;
    });
}

/**
 * Recursively inlines CSS imports while preserving source order.
 * @param {string} sourcePath Source stylesheet path.
 * @param {Set<string>} [stack] Active import stack.
 * @returns {Promise<string>} Inlined and rebased CSS.
 */
export async function inlineStylesheet(sourcePath, stack = new Set()) {
    const resolvedSource = path.resolve(sourcePath);
    if (stack.has(resolvedSource)) {
        throw new Error(`Circular stylesheet import: ${resolvedSource}`);
    }

    const nextStack = new Set(stack).add(resolvedSource);
    const source = await fs.readFile(resolvedSource, 'utf8');
    const importPattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*;/giu;
    let cursor = 0;
    let output = '';

    for (const match of source.matchAll(importPattern)) {
        output += rebaseCssUrls(source.slice(cursor, match.index), resolvedSource);
        const importUrl = match[2];
        if (isExternalCssImport(importUrl)) {
            output += match[0];
        } else {
            const importPath = importUrl.startsWith('/')
                ? path.join(publicDirectory, importUrl.slice(1))
                : path.resolve(path.dirname(resolvedSource), importUrl);
            output += await inlineStylesheet(importPath, nextStack);
        }
        cursor = match.index + match[0].length;
    }

    output += rebaseCssUrls(source.slice(cursor), resolvedSource);
    return output;
}

async function listFiles(directory, extension) {
    const results = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...await listFiles(entryPath, extension));
        } else if (entry.name.endsWith(extension)) {
            results.push(entryPath);
        }
    }
    return results.sort(compareNames);
}

async function collectBuiltinExtensions() {
    const extensionsDirectory = path.join(publicDirectory, 'scripts', 'extensions');
    const manifests = {};
    const resources = {};

    const entries = await fs.readdir(extensionsDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => compareNames(left.name, right.name))) {
        if (!entry.isDirectory() || entry.name === 'third-party') {
            continue;
        }

        const extensionDirectory = path.join(extensionsDirectory, entry.name);
        const manifestPath = path.join(extensionDirectory, 'manifest.json');
        try {
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            manifests[entry.name] = manifest;

            const templates = {};
            for (const templatePath of await listFiles(extensionDirectory, '.html')) {
                templates[toPublicUrl(templatePath)] = await fs.readFile(templatePath, 'utf8');
            }

            const locales = {};
            for (const [locale, localeFile] of Object.entries(manifest.i18n ?? {})) {
                locales[locale] = JSON.parse(await fs.readFile(path.join(extensionDirectory, localeFile), 'utf8'));
            }

            resources[entry.name] = {
                style: manifest.css ? await inlineStylesheet(path.join(extensionDirectory, manifest.css)) : '',
                templates,
                locales,
            };
        } catch (error) {
            if (error?.code === 'ENOENT') {
                continue;
            }
            throw error;
        }
    }

    return { manifests, resources };
}

async function collectStartupTemplates() {
    const templates = {};
    for (const name of startupTemplateNames) {
        const publicUrl = `/scripts/templates/${name}.html`;
        templates[publicUrl] = await fs.readFile(path.join(publicDirectory, 'scripts', 'templates', `${name}.html`), 'utf8');
    }
    return templates;
}

async function writeLegacyBundle(outputDirectory) {
    const contents = [];
    for (const script of legacyScripts) {
        contents.push(`/* ${script} */\n${await fs.readFile(path.join(publicDirectory, script), 'utf8')}\n;`);
    }
    await fs.writeFile(path.join(outputDirectory, 'legacy.js'), `${contents.join('\n')}\n`);
}

async function writeCssBundle(outputDirectory) {
    const contents = [];
    for (const stylesheet of bundledStylesheets) {
        contents.push(`/* ${stylesheet} */\n${await inlineStylesheet(path.join(publicDirectory, stylesheet))}`);
    }
    await fs.writeFile(path.join(outputDirectory, 'app.css'), `${contents.join('\n')}\n`);
}

function runWebpack(config) {
    return new Promise((resolve, reject) => {
        const compiler = webpack(config);
        compiler.run((error, stats) => {
            compiler.close(closeError => {
                if (error || closeError) {
                    reject(error || closeError);
                    return;
                }
                if (!stats || stats.hasErrors()) {
                    reject(new Error(stats?.toString({ colors: false, errors: true, warnings: true }) || 'Webpack failed'));
                    return;
                }
                resolve(stats);
            });
        });
    });
}

async function getAssetMetrics(outputDirectory, assetNames) {
    const assets = [];
    for (const name of [...new Set(assetNames)].sort()) {
        const contents = await fs.readFile(path.join(outputDirectory, name));
        assets.push({
            name,
            bytes: contents.length,
            gzipBytes: gzipSync(contents).length,
            sha256: createHash('sha256').update(contents).digest('hex'),
        });
    }
    return assets;
}

/**
 * Builds all committed frontend assets.
 * @param {string} [outputDirectory] Output directory.
 * @returns {Promise<object>} Build manifest.
 */
export async function buildFrontend(outputDirectory = defaultOutputDirectory) {
    const resolvedOutput = path.resolve(outputDirectory);
    await fs.rm(resolvedOutput, { recursive: true, force: true });
    await fs.mkdir(resolvedOutput, { recursive: true });

    const [{ manifests, resources }, startupTemplates] = await Promise.all([
        collectBuiltinExtensions(),
        collectStartupTemplates(),
    ]);
    const stats = await runWebpack(getFrontendConfig({
        outputPath: resolvedOutput,
        builtinManifests: manifests,
        builtinResources: resources,
        startupTemplates,
    }));
    await Promise.all([
        writeLegacyBundle(resolvedOutput),
        writeCssBundle(resolvedOutput),
    ]);

    const info = stats.toJson({ all: false, assets: true, chunkModules: true, chunks: true, entrypoints: true, ids: true, modules: true, warnings: true });
    const emittedAssets = info.assets.map(asset => asset.name).filter(name => name.endsWith('.js'));
    const allAssets = [...emittedAssets, 'legacy.js', 'app.css'];
    const metrics = await getAssetMetrics(resolvedOutput, allAssets);
    const entryAssets = info.entrypoints.app.assets.map(asset => asset.name);
    const builtinAsset = emittedAssets.find(name => name === 'chunks/builtins.js');
    const initialAssetNames = [...entryAssets, builtinAsset, 'legacy.js', 'app.css'].filter(Boolean);
    const initialMetrics = metrics.filter(asset => initialAssetNames.includes(asset.name));
    const retainedMetrics = await Promise.all(retainedStylesheets.map(async name => {
        const contents = await fs.readFile(path.join(publicDirectory, name));
        return { name, gzipBytes: gzipSync(contents).length };
    }));
    const initialRequestCount = initialMetrics.length + retainedStylesheets.length;
    const initialGzipBytes = initialMetrics.reduce((total, asset) => total + asset.gzipBytes, 0)
        + retainedMetrics.reduce((total, asset) => total + asset.gzipBytes, 0);
    const stmbModules = info.modules
        .filter(module => module.name?.includes('public\\scripts\\stmb') || module.name?.includes('public/scripts/stmb'))
        .sort((left, right) => left.name.localeCompare(right.name));
    const stmbChunk = info.chunks.find(chunk => chunk.names?.includes('stmb'));

    if (initialRequestCount > 12) {
        throw new Error(`Initial frontend request budget exceeded: ${initialRequestCount} > 12`);
    }
    if (initialGzipBytes > 1.8 * 1024 * 1024) {
        throw new Error(`Initial frontend gzip budget exceeded: ${initialGzipBytes} bytes`);
    }
    if (!emittedAssets.includes('stmb.js') || !stmbChunk) {
        throw new Error('The dedicated STMB chunk was not emitted.');
    }
    if (stmbModules.length !== 29 || stmbModules.some(module => module.chunks?.length !== 1 || module.chunks[0] !== stmbChunk.id)) {
        const placements = [...new Set(stmbModules.map(module => JSON.stringify(module.chunks)))].join(', ');
        throw new Error(`Expected all 29 STMB modules only in chunk ${stmbChunk.id}; found ${stmbModules.length} with placements ${placements}.`);
    }

    const manifest = {
        formatVersion: 1,
        initialRequestCount,
        initialGzipBytes,
        builtinExtensionCount: Object.keys(manifests).length,
        stmbModuleCount: stmbModules.length,
        assets: metrics,
        warnings: info.warnings.map(warning => warning.message),
    };
    await fs.writeFile(path.join(resolvedOutput, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

/**
 * Recursively returns file hashes for deterministic build comparison.
 * @param {string} directory Directory to inspect.
 * @returns {Promise<Record<string, string>>} Relative file hashes.
 */
export async function hashDirectory(directory) {
    const hashes = {};
    for (const filePath of await listFiles(directory, '')) {
        const relativePath = path.relative(directory, filePath).split(path.sep).join('/');
        hashes[relativePath] = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
    }
    return hashes;
}
