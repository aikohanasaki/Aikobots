import path from 'node:path';
import webpack from 'webpack';
import { serverDirectory } from './src/server-directory.js';

const publicDirectory = path.join(serverDirectory, 'public');

/**
 * Creates the production frontend bundle configuration.
 * @param {object} options Build options.
 * @param {string} options.outputPath Output directory.
 * @param {Record<string, object>} options.builtinManifests Built-in extension manifests.
 * @param {Record<string, object>} options.builtinResources Built-in extension resources.
 * @param {Record<string, string>} options.startupTemplates Startup template contents.
 * @returns {import('webpack').Configuration} Webpack configuration.
 */
export default function getFrontendConfig({ outputPath, builtinManifests, builtinResources, startupTemplates }) {
    return {
        mode: 'production',
        entry: {
            app: path.join(publicDirectory, 'scripts', 'frontend-entry.js'),
        },
        cache: false,
        devtool: false,
        watch: false,
        plugins: [
            new webpack.DefinePlugin({
                __BUILTIN_EXTENSION_MANIFESTS__: JSON.stringify(builtinManifests),
                __BUILTIN_EXTENSION_RESOURCES__: JSON.stringify(builtinResources),
                __STARTUP_TEMPLATES__: JSON.stringify(startupTemplates),
            }),
        ],
        resolve: {
            alias: {
                '/script.js': path.join(publicDirectory, 'script.js'),
            },
        },
        optimization: {
            concatenateModules: false,
            moduleIds: 'deterministic',
            chunkIds: 'deterministic',
            runtimeChunk: {
                name: 'runtime',
            },
            splitChunks: {
                chunks: 'all',
                cacheGroups: {
                    stmb: {
                        test: module => Boolean(module.resource && /^stmb(?:-.+)?\.js$/u.test(path.basename(module.resource)) && path.dirname(module.resource) === path.join(publicDirectory, 'scripts')),
                        name: 'stmb',
                        priority: 40,
                        enforce: true,
                        reuseExistingChunk: true,
                    },
                    vendor: {
                        test: /[\\/]node_modules[\\/]/u,
                        name: 'vendor',
                        priority: 30,
                        enforce: true,
                        reuseExistingChunk: true,
                    },
                },
            },
        },
        performance: {
            hints: false,
        },
        stats: {
            preset: 'errors-warnings',
            assets: true,
            entrypoints: true,
            modules: true,
            timings: true,
        },
        output: {
            path: outputPath,
            publicPath: '/dist/',
            filename: '[name].js',
            chunkFilename: 'chunks/[name].js',
            clean: true,
        },
    };
}
