import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/scripts/stmb-clips.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function compactStmbEntry(');
const end = source.indexOf('\nfunction getTopicalClipPromptTemplate(', start);
assert.ok(start >= 0 && end > start);

test('the entry shortcut uses the same compaction review and clears loading after generation', async () => {
    const states = [];
    const context = vm.createContext({
        setCompactionEntryActionLoading: (_button, loading) => states.push(loading),
        getCompactionProfileIndex: () => 2,
        showCompactReviewPopup: async (_book, _data, _entry, options) => {
            assert.equal(options.skipPromptStep, true);
            assert.equal(options.profileIndex, 2);
            options.onCompactionRequestSettled();
            return true;
        },
    });
    const compact = vm.runInContext(source.slice(start, end).replace('export async function', 'async function') + '\ncompactStmbEntry', context);
    assert.equal(await compact({}, 'Book', { entries: {} }, { uid: 1 }), true);
    assert.deepEqual(states, [true, false]);
});
