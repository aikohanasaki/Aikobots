import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/fetch-patch.js';
import { Jimp, JimpMime } from '../src/jimp.js';

test('image processing retains crop, cover resizing, and PNG/JPEG/WebP conversion', async () => {
    const image = new Jimp({ width: 12, height: 8, color: 0xff0000ff });
    image.crop({ x: 2, y: 1, w: 8, h: 6 });
    assert.equal(image.bitmap.width, 8);
    assert.equal(image.bitmap.height, 6);
    image.cover({ w: 4, h: 4 });

    for (const mime of [JimpMime.png, JimpMime.jpeg, JimpMime.webp]) {
        const options = mime === JimpMime.jpeg ? { quality: 90, jpegColorSpace: 'ycbcr' } : {};
        const decoded = await Jimp.read(await image.getBuffer(mime, options));
        assert.equal(decoded.bitmap.width, 4, mime);
        assert.equal(decoded.bitmap.height, 4, mime);
        const pixel = decoded.getPixelColor(2, 2);
        assert.ok((pixel >>> 24) > 240, `${mime}: red channel preserved`);
        assert.ok(((pixel >>> 16) & 255) < 15, `${mime}: green channel preserved`);
        assert.ok(((pixel >>> 8) & 255) < 15, `${mime}: blue channel preserved`);
    }
});
