import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

for (const [name, path, endMarker] of [
    ['browser', '../public/scripts/utils.js', 'export class Stopwatch'],
    ['server', '../src/prompting/regex-runtime.js', 'function sanitizeRegexMacro'],
]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const start = source.indexOf('function parseRegexQuantifier(');
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    const parse = vm.runInNewContext(
        source.slice(start, end).replace('export function regexFromString', 'function regexFromString') + '; regexFromString',
        { console: { warn() {} } },
    );

    test(`${name}: Voyage optional comment wrappers match bare and wrapped markers`, () => {
        const regex = parse(String.raw`(?:<!--\s*)?tracker_start(?:\s*--\s*>)?`);
        assert.ok(regex);
        for (const text of ['tracker_start', '<!-- tracker_start -->', '<!--tracker_start', 'tracker_start -->']) {
            assert.equal(text.replace(regex, 'matched'), 'matched');
        }
    });

    test(`${name}: capturing and lazy optional groups accept quantified contents`, () => {
        for (const pattern of ['(a+)?b', '(?:a+)??b']) {
            const regex = parse(pattern);
            assert.ok(regex);
            assert.equal('aaab'.replace(regex, 'matched'), 'matched');
            assert.equal('b'.replace(regex, 'matched'), 'matched');
        }
    });

    test(`${name}: nested repetitions remain blocked, including optional wrappers`, () => {
        for (const pattern of ['(a+)+b', '(a*)*b', '(a+){1,3}b', '(?:(a+)?)+b', '(?:(a+)+)?b', '(a?)+b']) {
            assert.equal(parse(pattern), undefined);
        }
    });
}
