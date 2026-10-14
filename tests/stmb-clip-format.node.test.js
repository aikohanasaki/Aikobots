import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CLIP_FORMAT, getClipFormatKind, readFormattedClip, renderClipFormat, validateClipFormat, withClipFormatData } from '../public/scripts/stmb-clip-format-policy.js';
import { buildCombineClipsPrompt, validateCombineClipsPrompt } from '../public/scripts/stmb-combine-clips-policy.js';

test('custom Clip formats round trip titles containing replacement syntax and literal macros', () => {
    for (const template of [DEFAULT_CLIP_FORMAT, '## {{TITLE}}\n{{CONTENT}}', '{{CONTENT}}']) {
        const title = 'Price $& $` $\'';
        const body = 'Synthetic {{char}} fact.\nAnother fact.';
        const entry = { content: renderClipFormat(template, title, body), data: withClipFormatData({}, template, title) };
        assert.equal(readFormattedClip(entry).body, body);
        assert.equal(renderClipFormat(template, title, `${readFormattedClip(entry).body}\n\n- Added.`).includes('Synthetic {{char}} fact.'), true);
        entry.content = 'Manually changed';
        assert.equal(readFormattedClip(entry)?.body ?? null, template === '{{CONTENT}}' ? 'Manually changed' : null);
    }
});

test('formats and combination prompts require one insertion point', () => {
    assert.throws(() => validateClipFormat('{{TITLE}}'));
    assert.throws(() => validateClipFormat('{{CONTENT}}{{CONTENT}}'));
    assert.throws(() => validateCombineClipsPrompt('{{TITLE}}'));
    assert.throws(() => validateCombineClipsPrompt('{{SOURCE_CLIPS}}{{SOURCE_CLIPS}}'));
    const entries = [0, 1].map(uid => ({ uid, comment: `Clip ${uid} [STMB Clip]`, content: 'Synthetic $&', key: [] }));
    assert.match(buildCombineClipsPrompt(entries, 'Title $&', '{{TITLE}}\n{{SOURCE_CLIPS}}'), /^Title \$&\n/);
    assert.equal(getClipFormatKind({ data: { extensions: { aikobots: { combined_clips: {} } } } }), 'combined');
});

test('ordinary append and rename preserve a recorded custom format', () => {
    const source = fs.readFileSync(new URL('../public/scripts/stmb-clips.js', import.meta.url), 'utf8');
    const start = source.indexOf('function buildUpdatedExistingContent(');
    const functionSource = source.slice(start, source.indexOf('\n}', start) + 2);
    const sandbox = vm.createContext({
        validateClipHeadline: value => value, readFormattedClip, renderClipFormat,
        formatClipBullet: value => `- ${value}`,
    });
    vm.runInContext(`${functionSource}\nglobalThis.update = buildUpdatedExistingContent;`, sandbox);
    const template = '## {{TITLE}}\n\n{{CONTENT}}';
    const entry = { comment: 'Old [STMB Clip]', content: renderClipFormat(template, 'Old', 'Synthetic {{char}} fact.'), data: withClipFormatData({}, template, 'Old') };
    assert.equal(sandbox.update(entry, 'New fact.', 'Price $&'), '## Price $&\n\nSynthetic {{char}} fact.\n\n- New fact.');
});
