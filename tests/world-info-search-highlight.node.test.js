import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Fuse from 'fuse.js';

const source = readFileSync(new URL('../public/scripts/world-info.js', import.meta.url), 'utf8');
const powerUserSource = readFileSync(new URL('../public/scripts/power-user.js', import.meta.url), 'utf8');
const rendererStart = source.indexOf('function escapeHighlightText(');
const rendererEnd = source.indexOf('function attachWorldInfoSearchHighlight(', rendererStart);
const stylingStart = source.indexOf('function templateStyling(', source.indexOf('function enableKeysInputHelper('));
const stylingEnd = source.indexOf('\n    if (isFancyInput)', stylingStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart && stylingStart >= 0 && stylingEnd > stylingStart);

test('textarea mirrors copy their padding and box sizing from the native control', () => {
    for (const property of ['boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
        assert.match(source, new RegExp(`${property}: inputStyle\\.${property}`));
    }
});

test('fuzzy cache keeps match-enabled results separate', () => {
    const start = powerUserSource.indexOf('export function performFuzzySearch(');
    const end = powerUserSource.indexOf('\n/**', start);
    assert.ok(start >= 0 && end > start);
    const performFuzzySearch = new Function('Fuse', `${powerUserSource.slice(start, end).replace('export ', '')}\nreturn performFuzzySearch;`)(Fuse);
    const cache = { worldInfo: { resultMap: new Map() } };
    const data = [{ key: 'dragon' }];
    const plain = performFuzzySearch('worldInfo', data, ['key'], 'dragom', cache);
    const withMatches = performFuzzySearch('worldInfo', data, ['key'], 'dragom', cache, { includeMatches: true });
    assert.equal(plain[0].matches, undefined);
    assert.deepEqual(withMatches[0].matches, [{ indices: [[0, 4]], value: 'dragon', key: 'key' }]);
    assert.equal(cache.worldInfo.resultMap.size, 2);
});

/** Runs the real chip renderer with a minimal jQuery text/markup container. */
function renderChip(entry, field, text, query, matches) {
    const $ = () => ({
        markup: '',
        addClass() { return this; },
        attr() { return this; },
        text(value) { this.markup = value; return this; },
        html(value) { this.markup = value; return this; },
    });
    const worldInfoFilter = {
        getFilterData: () => query,
        getWorldInfoMatches: uid => {
            assert.equal(uid, entry.uid);
            return matches;
        },
    };
    const render = new Function('$', 'worldInfoFilter', 'entry', 'entryPropName', `
        const FILTER_TYPES = { WORLD_INFO_SEARCH: 'world_info_search' };
        const t = (strings, ...values) => String.raw({ raw: strings }, ...values);
        const isValidRegex = () => false;
        ${source.slice(rendererStart, rendererEnd)}
        ${source.slice(stylingStart, stylingEnd)}
        return templateStyling;
    `)($, worldInfoFilter, entry, field);
    return render({ text }).markup;
}

test('Select2 chips highlight Fuse typo matches only for the matching field and keyword', () => {
    const entry = { uid: 7, key: ['castle', 'dragon'], keysecondary: ['dragons', 'castle'] };
    const query = 'dragom';
    const [result] = new Fuse([entry], {
        keys: ['key', 'keysecondary'], includeMatches: true,
        threshold: 0.2, ignoreLocation: true, useExtendedSearch: true,
    }).search(query);
    assert.ok(result.matches.length > 0);
    assert.equal(renderChip(entry, 'key', 'dragon', query, result.matches), '<mark class="wi-search-highlight fuzzy">drago</mark>n');
    assert.equal(renderChip(entry, 'keysecondary', 'dragons', query, result.matches), '<mark class="wi-search-highlight fuzzy">drago</mark>ns');
    for (const field of ['key', 'keysecondary']) {
        assert.equal(renderChip(entry, field, 'castle', query, result.matches), 'castle');
    }
    assert.equal(renderChip(entry, 'keysecondary', 'dragon', query, result.matches), 'dragon');
    assert.equal(renderChip(entry, 'key', 'dragon', '', result.matches), 'dragon');
});
