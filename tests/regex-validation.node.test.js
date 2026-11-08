import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

const sceneHeaderPattern = /<scene_header\b(?!(?:[^<>"'\s]+(?![^<>"'\s])|\s+(?!\s)|"[^"<>]*"|'[^'<>]*')*?\s+sky=)(?=(?:[^<>"'\s]+(?![^<>"'\s])|\s+(?!\s)|"[^"<>]*"|'[^'<>]*')*?\s+location="([^"<>]+)")(?=(?:[^<>"'\s]+(?![^<>"'\s])|\s+(?!\s)|"[^"<>]*"|'[^'<>]*')*?\s+time="([^"<>]*?\b(?:dawn|sunrise|daybreak|morning|(?<![\d:])0?[5-8]:\d{2}\s*(?:am|a\.m\.))(?!\w)[^"<>]*)")(?=(?:[^<>"'\s]+(?![^<>"'\s])|\s+(?!\s)|"[^"<>]*"|'[^'<>]*')*?\s+(?:atmosphere|weather|mood)="([^"<>]+)")(?:[^<>"'\s]+(?![^<>"'\s])|\s+(?!\s)|"[^"<>]*"|'[^'<>]*')*?\/?>/gi;
const whoPattern = /\[\[who\s+([^\]|]+?)\s*\|\s*o(\d{1,2})\s*\]\](?:[ \t\r\n]|<br\s*\/?>|<\/p>|<p>)*((?:(?!\[\[who\s)[\s\S])*?)(?:[ \t\r\n]|<br\s*\/?>|<\/p>|<p>)*\[\[\/who\]\]/g;
// Require a closer first, scan br endings atomically, and only try trailing trim at non-trim boundaries.
// The auxiliary br capture moves the body from $3 to $4; whitespace-only names are rejected.
const revisedWhoPattern = /\[\[who\s+(?!\s)([^\]|]*?[^\]|\s])\s*\|\s*o(\d{1,2})\s*\]\](?=(?:(?!\[\[who\s)[\s\S])*?\[\[\/who\]\])(?:[ \t\r\n]|<br(?=(\s*\/?>))\3|<\/p>|<p>)*((?:(?!\[\[who\s|\[\[\/who\]\])[\s\S])*?(?<![ \t\r\n]|<br\s*\/?>|<\/p>|<p>))?(?:[ \t\r\n]|<br(?=(\s*\/?>))\5|<\/p>|<p>)*\[\[\/who\]\]/g;

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

    test(`${name}: scene header scanner preserves captures and exclusions`, () => {
        const regex = parse(sceneHeaderPattern.toString());
        assert.ok(regex);
        const text = '<scene_header location="Garden" time="morning" weather="clear">';
        assert.equal(text.replace(regex, '$1 / $2 / $3'), 'Garden / morning / clear');
        assert.equal('<scene_header mood="quiet" time="06:30 am" location="Park"/>'.replace(regex, '$1 / $2 / $3'), 'Park / 06:30 am / quiet');
        for (const excluded of [text.replace('weather=', 'sky="blue" weather='), text.replace('morning', 'evening')]) {
            assert.equal(excluded.replace(regex, 'matched'), excluded);
        }
        assert.equal(text.replace('location=', 'note=" sky=blue" location=').replace(regex, '$1'), 'Garden');
        const malformed = '<scene_header note="' + 'x'.repeat(50_000) + '">';
        assert.equal(vm.runInNewContext('regex.test(text)', { regex, text: malformed }, { timeout: 1000 }), false);
    });

    test(`${name}: who scanner remains blocked because overlapping runs stall on missing closers`, () => {
        assert.equal(parse(whoPattern.toString()), undefined);
    });

    test(`${name}: revised who scanner preserves formatting trim and consecutive blocks`, () => {
        const regex = parse(revisedWhoPattern.toString());
        assert.ok(regex);
        for (const body of ['<p>Hello.</p>', '<br \t />Hi<br\n/>', '', '   ', 'a  b ', '<p>x</p><p>y</p>']) {
            const text = `[[who Alice Smith | o12]]${body}[[/who]]`;
            assert.equal(text.replace(regex, '$1:$2:$4'), text.replace(whoPattern, '$1:$2:$3'));
        }
        const text = '[[who Alice | o12]]<p>Hello.</p>[[/who]]\n[[who Bob | o2]]<br />Bye.<br>[[/who]]';
        assert.equal(text.replace(regex, '$1:$2:$4'), 'Alice:12:Hello.\nBob:2:Bye.');
        const incomplete = '[[who Alice | o1]]unfinished ';
        assert.equal((incomplete + '[[who Bob | o2]]Hi[[/who]]').replace(regex, '$1:$4'), incomplete + 'Bob:Hi');
        assert.equal('[[who   | o1]]Hi[[/who]]'.replace(regex, 'matched'), '[[who   | o1]]Hi[[/who]]');
    });

    test(`${name}: revised who scanner handles long whitespace and missing closers`, () => {
        const regex = parse(revisedWhoPattern.toString());
        assert.ok(regex);
        for (const body of [' '.repeat(50_000), 'x' + ' '.repeat(50_000) + 'y', '<br '.repeat(10_000)]) {
            const incomplete = '[[who Alice | o12]]' + body;
            assert.equal(vm.runInNewContext('text.replace(regex, "$4")', { regex, text: incomplete }, { timeout: 1000 }), incomplete);
            assert.equal(vm.runInNewContext('text.replace(regex, "$4")', { regex, text: incomplete + '[[/who]]' }, { timeout: 1000 }), body.trim());
        }
        const malformedHeader = '[[who ' + ' '.repeat(50_000);
        assert.equal(vm.runInNewContext('regex.test(text)', { regex, text: malformedHeader }, { timeout: 1000 }), false);
    });

    test(`${name}: token exceptions reject ambiguous variants and enclosing repetitions`, () => {
        for (const pattern of [
            String.raw`(?:\s+|"[^"<>]*")*x`,
            String.raw`(?:\s+(?!\s)|\s)*x`,
            String.raw`(?:<br\s*\/?>|<br\s*\/?>)*x`,
            String.raw`(?:<br\s*\/?>|<br|\s|/|>)*x`,
            String.raw`(?:(?:<br\s*\/?>)*)+x`,
            String.raw`(?:(?:\s+(?!\s))*)+x`,
            String.raw`(?:\s+(?!\s)|\s+(?!\s))*x`,
        ]) {
            assert.equal(parse(pattern), undefined);
        }
    });
}
