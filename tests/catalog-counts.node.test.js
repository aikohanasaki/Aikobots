import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const start = source.indexOf('function getCatalogCharacterRow(');
const end = source.indexOf('\n/**', source.indexOf('async function showCharacterCatalog(', start));
assert.ok(start >= 0 && end > start);

/** Run the catalog UI with a minimal DOM facade and controlled network responses. */
async function openCatalog(entries, { loadFails = false, retrieveFails = false } = {}) {
    let container;
    let hiddenWhileLoading;
    const buttons = [];
    const $ = markup => {
        const element = {
            markup, children: [], visible: true, value: '', handlers: {},
            append(...children) { this.children.push(...children); return this; },
            text(value) { this.value = value; return this; },
            hide() { this.visible = false; return this; },
            show() { this.visible = true; return this; },
            empty() { this.children = []; return this; },
            attr() { return this; },
            css() { return this; },
            prop() { return this; },
            on(event, handler) { this.handlers[event] = handler; return this; },
            find() { return this.children.find(child => child.markup?.startsWith('<span')); },
        };
        if (markup.startsWith('<button')) buttons.push(element);
        return element;
    };
    const context = vm.createContext({
        $, translate: value => value,
        t: (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ''), ''),
        POPUP_TYPE: { TEXT: 1 }, default_avatar: 'default.png',
        getThumbnailUrl: () => 'avatar.png',
        toastr: { success() {}, error() {} },
        getCharacters: async () => {}, printCharacters: async () => {},
        callGenericPopup: element => {
            container = element;
            hiddenWhileLoading = !container.children[1].visible;
            return Promise.resolve();
        },
        getCatalogCharacters: async () => {
            if (loadFails) throw new Error('Load failed');
            return entries;
        },
        retrieveCatalogCharacter: async () => {
            if (retrieveFails) throw new Error('Retrieval failed');
        },
    });
    await vm.runInContext(source.slice(start, end) + '\nshowCharacterCatalog()', context);
    assert.equal(hiddenWhileLoading, true);
    assert.equal(container.children[0].value, 'The Catalog');
    return { summary: container.children[1], buttons };
}

test('catalog summary counts installed entries and updates after retrieval', async () => {
    const { summary, buttons } = await openCatalog([
        { publishedFilename: 'one.png', alreadyInstalled: true },
        { publishedFilename: 'two.png', alreadyInstalled: false },
    ]);
    assert.equal(summary.visible, true);
    assert.equal(summary.value, 'Bots: 2 total · 1 downloaded');
    await buttons[1].handlers.click();
    assert.equal(summary.value, 'Bots: 2 total · 2 downloaded');
});

test('failed retrieval leaves catalog counts unchanged', async () => {
    const { summary, buttons } = await openCatalog([
        { publishedFilename: 'one.png', alreadyInstalled: false },
    ], { retrieveFails: true });
    await buttons[0].handlers.click();
    assert.equal(summary.value, 'Bots: 1 total · 0 downloaded');
});

test('empty catalogs show zero counts and load errors keep the summary hidden', async () => {
    const empty = await openCatalog([]);
    assert.equal(empty.summary.visible, true);
    assert.equal(empty.summary.value, 'Bots: 0 total · 0 downloaded');
    const failed = await openCatalog([], { loadFails: true });
    assert.equal(failed.summary.visible, false);
});
