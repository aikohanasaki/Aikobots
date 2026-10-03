import { createJimp } from '@jimp/core';

// Optimized image formats
import webp from '@jimp/wasm-webp';
import png from '@jimp/wasm-png';
import jpeg from '@jimp/wasm-jpeg';
import avif from '@jimp/wasm-avif';

// Other image formats
import bmp, { msBmp } from '@jimp/js-bmp';
import gif from '@jimp/js-gif';
import tiff from '@jimp/js-tiff';

import * as cover from '@jimp/plugin-cover';
import * as crop from '@jimp/plugin-crop';

// A custom jimp that uses WASM for optimized formats and JS for the rest
const Jimp = createJimp({
    formats: [webp, png, jpeg, avif, bmp, msBmp, gif, tiff],
    // Cover imports its resize implementation internally.
    plugins: [cover.methods, crop.methods],
});

const JimpMime = {
    bmp: bmp().mime,
    gif: gif().mime,
    jpeg: jpeg().mime,
    png: png().mime,
    webp: webp().mime,
    tiff: tiff().mime,
};

export default Jimp;

export { Jimp, JimpMime };
