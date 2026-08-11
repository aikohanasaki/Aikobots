/* global __BUILTIN_EXTENSION_MANIFESTS__ */

/** @type {Record<string, object>} */
const builtinExtensionManifests = __BUILTIN_EXTENSION_MANIFESTS__;

const builtinExtensionLoaders = {
    assets: () => import(/* webpackChunkName: "builtins" */ './extensions/assets/index.js'),
    attachments: () => import(/* webpackChunkName: "builtins" */ './extensions/attachments/index.js'),
    caption: () => import(/* webpackChunkName: "builtins" */ './extensions/caption/index.js'),
    'connection-manager': () => import(/* webpackChunkName: "builtins" */ './extensions/connection-manager/index.js'),
    expressions: () => import(/* webpackChunkName: "builtins" */ './extensions/expressions/index.js'),
    gallery: () => import(/* webpackChunkName: "builtins" */ './extensions/gallery/index.js'),
    'quick-reply': () => import(/* webpackChunkName: "builtins" */ './extensions/quick-reply/index.js'),
    regex: () => import(/* webpackChunkName: "builtins" */ './extensions/regex/index.js'),
    'stable-diffusion': () => import(/* webpackChunkName: "builtins" */ './extensions/stable-diffusion/index.js'),
    'token-counter': () => import(/* webpackChunkName: "builtins" */ './extensions/token-counter/index.js'),
    translate: () => import(/* webpackChunkName: "builtins" */ './extensions/translate/index.js'),
    tts: () => import(/* webpackChunkName: "builtins" */ './extensions/tts/index.js'),
    vectors: () => import(/* webpackChunkName: "builtins" */ './extensions/vectors/index.js'),
};

let resourcesPromise;
let loadedResources;

/**
 * Returns the built-in extensions exposed by the bundled client.
 * @returns {{name: string, type: 'system'}[]} Built-in extension descriptors.
 */
export function getBuiltinExtensions() {
    return Object.keys(builtinExtensionManifests).map(name => ({ name, type: 'system' }));
}

/**
 * Returns bundled built-in extension manifests.
 * @returns {Record<string, object>} Built-in manifests.
 */
export function getBuiltinExtensionManifests() {
    return builtinExtensionManifests;
}

async function getBuiltinExtensionResources() {
    resourcesPromise ??= import(/* webpackChunkName: "builtins" */ './builtin-extension-resources.js')
        .then(module => {
            loadedResources = module.builtinExtensionResources;
            return loadedResources;
        });
    return resourcesPromise;
}

/**
 * Loads the resources associated with a built-in extension.
 * @param {string} name Extension name.
 * @returns {Promise<{style: string, templates: Record<string, string>, locales: Record<string, object>} | undefined>} Extension resources.
 */
export async function loadBuiltinExtensionResources(name) {
    return (await getBuiltinExtensionResources())[name];
}

/**
 * Executes one built-in extension from the shared bundle.
 * @param {string} name Extension name.
 * @returns {Promise<void>} Resolves after the extension module executes.
 */
export async function loadBuiltinExtension(name) {
    const loader = builtinExtensionLoaders[name];
    if (!loader) {
        throw new Error(`Unknown built-in extension: ${name}`);
    }
    await loader();
}

/**
 * Gets a bundled extension template after resources have loaded.
 * @param {string} pathToTemplate Absolute public template path.
 * @returns {string | undefined} Template source.
 */
export function getBundledExtensionTemplate(pathToTemplate) {
    if (!loadedResources) {
        return undefined;
    }

    const normalizedPath = pathToTemplate.startsWith('/') ? pathToTemplate : `/${pathToTemplate}`;
    for (const extensionResources of Object.values(loadedResources)) {
        const template = extensionResources.templates?.[normalizedPath];
        if (template !== undefined) {
            return template;
        }
    }

    return undefined;
}
