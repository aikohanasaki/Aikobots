import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { resolveSystemChromiumPath } from '../scripts/browser-path.mjs';

import {
    ToastHistoryStore,
    installToastHistoryCapture,
} from '../public/scripts/notification-history.js';

function createRenderedToast(title, message) {
    const nodes = {
        '.toast-title': title === null ? null : { innerText: title },
        '.toast-message': message === null ? null : { innerText: message },
    };
    return [{ querySelector: selector => nodes[selector] ?? null }];
}

function createEntry(level, title, message, timestamp = new Date('2026-08-30T12:00:00.000Z')) {
    return { level, title, message, timestamp };
}

describe('notification history store', () => {
    it('defaults to the fixed 200-entry session cap', () => {
        const store = new ToastHistoryStore();
        for (let index = 0; index <= 200; index++) {
            store.record(createEntry('info', '', String(index)));
        }

        const snapshot = store.getSnapshot();
        expect(snapshot.entries).toHaveLength(200);
        expect(snapshot.entries[0].message).toBe('1');
        expect(snapshot.entries.at(-1).message).toBe('200');
    });

    it('keeps chronological entries, severity counts, and only the newest bounded records', () => {
        const store = new ToastHistoryStore(4);
        store.record(createEntry('info', 'One', 'First'));
        store.record(createEntry('success', 'Two', 'Second'));
        store.record(createEntry('warning', 'Three', 'Third'));
        store.record(createEntry('error', 'Four', 'Fourth'));
        store.record(createEntry('info', 'Five', 'Fifth'));

        const snapshot = store.getSnapshot();
        expect(snapshot.entries.map(entry => entry.message)).toEqual(['Second', 'Third', 'Fourth', 'Fifth']);
        expect(snapshot.counts).toEqual({ info: 1, success: 1, warning: 1, error: 1 });
    });

    it('skips exact severity, title, and message matches until allowed again', () => {
        const store = new ToastHistoryStore();
        const target = createEntry('warning', 'Connection', 'Try again');
        store.record(target);
        store.toggleExact(target, 'skipHistory');

        expect(store.getActions(target).skipHistory).toBe(true);
        expect(store.record(target)).toBeNull();
        expect(store.record({ ...target, title: 'Different title' })).not.toBeNull();
        expect(store.record({ ...target, message: 'Different message' })).not.toBeNull();
        expect(store.record({ ...target, level: 'error' })).not.toBeNull();
        expect(store.getSnapshot().entries[0].message).toBe('Try again');

        store.toggleExact(target, 'skipHistory');
        expect(store.getActions(target).skipHistory).toBe(false);
        expect(store.record(target)).not.toBeNull();
    });

    it('clears history without clearing session exceptions', () => {
        const store = new ToastHistoryStore();
        const target = createEntry('error', 'Failed', 'No changes saved');
        store.record(target);
        store.toggleExact(target, 'suppress');
        store.clear();

        const snapshot = store.getSnapshot();
        expect(snapshot.entries).toEqual([]);
        expect(snapshot.exceptions).toEqual([expect.objectContaining({ level: 'error', title: 'Failed', message: 'No changes saved', suppress: true })]);
        expect(snapshot.counts).toEqual({ info: 0, success: 0, warning: 0, error: 0 });
    });

    it('copies display fields and discards callback-bearing options', () => {
        const store = new ToastHistoryStore();
        const onclick = jest.fn();
        store.record({
            ...createEntry('info', 'Details', 'Open the report'),
            options: { onclick },
            onclick,
            toast: { onclick },
        });

        const [stored] = store.getSnapshot().entries;
        expect(stored).toEqual(expect.objectContaining({ level: 'info', title: 'Details', message: 'Open the report' }));
        expect(stored).not.toHaveProperty('options');
        expect(stored).not.toHaveProperty('onclick');
        expect(stored).not.toHaveProperty('toast');
        expect(onclick).not.toHaveBeenCalled();
    });
});

describe('notification history capture', () => {
    it.each([[false, false], [true, false], [false, true], [true, true]])(
        'handles suppress=%s and skipHistory=%s independently', (suppress, skipHistory) => {
            const store = new ToastHistoryStore();
            const target = createEntry('warning', '', 'Changed\r\ncount');
            store.saveRule({ ...target, mode: 'exact', suppress, skipHistory });
            const popup = {};
            const original = jest.fn(() => popup);
            const toastr = { warning: original, options: { escapeHtml: true } };
            const emptyCollection = { length: 0 };
            const jquery = jest.fn(() => emptyCollection);
            installToastHistoryCapture({ toastr, store, jquery });
            expect(toastr.warning('Changed\ncount')).toBe(suppress ? emptyCollection : popup);
            expect(original).toHaveBeenCalledTimes(suppress ? 0 : 1);
            expect(store.getSnapshot().entries).toHaveLength(skipHistory ? 0 : 1);
        },
    );
    it('preserves toastr arguments and return values while capturing escaped plain text', () => {
        const renderedToast = createRenderedToast('Saved', 'Character updated');
        const originalInfo = jest.fn(() => renderedToast);
        const toastr = {
            info: originalInfo,
            success: jest.fn(() => createRenderedToast('', 'Success')),
            warning: jest.fn(() => createRenderedToast('', 'Warning')),
            error: jest.fn(() => createRenderedToast('', 'Error')),
        };
        const store = new ToastHistoryStore();
        const options = { onclick: jest.fn(), escapeHtml: true };
        installToastHistoryCapture({
            toastr,
            store,
            now: () => new Date('2026-08-30T13:00:00.000Z'),
        });

        const result = toastr.info('<b>Character updated</b>', 'Saved', options);

        expect(result).toBe(renderedToast);
        expect(originalInfo).toHaveBeenCalledWith('<b>Character updated</b>', 'Saved', options);
        expect(store.getSnapshot().entries).toEqual([{
            id: 1,
            level: 'info',
            title: 'Saved',
            message: '<b>Character updated</b>',
            timestamp: new Date('2026-08-30T13:00:00.000Z'),
        }]);
        expect(options.onclick).not.toHaveBeenCalled();
    });

    it('does not capture a notification toastr declines to create', () => {
        const toastr = {
            options: { escapeHtml: true },
            info: jest.fn(() => undefined),
            success: jest.fn(() => undefined),
            warning: jest.fn(() => undefined),
            error: jest.fn(() => undefined),
        };
        const store = new ToastHistoryStore();
        installToastHistoryCapture({ toastr, store });

        expect(toastr.warning('Duplicate')).toBeUndefined();
        expect(store.getSnapshot().entries).toEqual([]);
    });

    it('installs only once and keeps the original store', () => {
        const toastr = {
            options: { escapeHtml: true },
            info: jest.fn(() => createRenderedToast('', 'Info')),
            success: jest.fn(() => createRenderedToast('', 'Success')),
            warning: jest.fn(() => createRenderedToast('', 'Warning')),
            error: jest.fn(() => createRenderedToast('', 'Error')),
        };
        const firstStore = new ToastHistoryStore();
        const secondStore = new ToastHistoryStore();

        expect(installToastHistoryCapture({ toastr, store: firstStore }).installed).toBe(true);
        const secondInstall = installToastHistoryCapture({ toastr, store: secondStore });
        toastr.error('Failed');

        expect(secondInstall).toEqual({ installed: false, store: firstStore });
        expect(firstStore.getSnapshot().counts.error).toBe(1);
        expect(secondStore.getSnapshot().entries).toEqual([]);
    });
});

describe('toast exceptions', () => {
    const target = createEntry('info', 'STMB', 'Applied 2 updates');
    const rule = { ...target, mode: 'exact', suppress: true, skipHistory: false };

    it('combines overlapping exact, contains, and any-message rules with case-sensitive scope', () => {
        const store = new ToastHistoryStore();
        store.saveRule({ ...rule, mode: 'contains', message: 'Applied ' });
        store.saveRule({ ...rule, mode: 'any', suppress: false, skipHistory: true });
        expect(store.getActions({ ...target, message: 'Applied 30 updates' })).toEqual({ suppress: true, skipHistory: true });
        expect(store.getActions({ ...target, message: 'applied 30 updates' })).toEqual({ suppress: false, skipHistory: true });
        expect(store.getActions({ ...target, title: 'Other' })).toEqual({ suppress: false, skipHistory: false });
        expect(store.getActions({ ...target, level: 'warning' })).toEqual({ suppress: false, skipHistory: false });
        store.toggleExact(target, 'suppress');
        store.toggleExact(target, 'suppress');
        expect(store.getExactRule(target).suppress).toBe(false);
        expect(store.getActions(target).suppress).toBe(true);
        expect(() => store.saveRule({ ...rule, mode: 'contains', message: '  ' })).toThrow('Invalid toast exception');
    });

    it('pins only validated preferences, restores them, and removes persistence on unpin or delete', () => {
        let saved;
        const storage = { getItem: () => saved, setItem: jest.fn((_key, value) => { saved = value; }) };
        const store = new ToastHistoryStore();
        store.initializePersistence(storage);
        const id = store.saveRule(rule);
        expect(storage.setItem).not.toHaveBeenCalled();
        store.saveRule({ ...rule, id, pinned: true, payload: { private: true }, onclick: () => {} });
        expect(JSON.parse(saved)).toEqual({ version: 1, rules: [{ level: 'info', title: 'STMB', message: 'Applied 2 updates', mode: 'exact', suppress: true, skipHistory: false }] });
        const reloaded = new ToastHistoryStore();
        reloaded.initializePersistence(storage);
        reloaded.initializePersistence(storage);
        expect(reloaded.getSnapshot().exceptions).toHaveLength(1);
        expect(reloaded.getActions(target).suppress).toBe(true);
        store.saveRule({ ...rule, id, pinned: false });
        expect(store.getActions(target).suppress).toBe(true);
        expect(JSON.parse(saved).rules).toEqual([]);
        const unpinnedReload = new ToastHistoryStore();
        unpinnedReload.initializePersistence(storage);
        expect(unpinnedReload.getSnapshot().exceptions).toEqual([]);
        store.saveRule({ ...rule, id, pinned: true });
        store.deleteRule(id);
        expect(JSON.parse(saved).rules).toEqual([]);
        expect(store.getActions(target).suppress).toBe(false);
    });

    it('ignores malformed settings and invalid rules without losing valid preferences', () => {
        for (const value of ['{', JSON.stringify({ version: 2, rules: [rule] }), JSON.stringify({ version: 1, rules: {} })]) {
            const store = new ToastHistoryStore();
            store.initializePersistence({ getItem: () => value });
            expect(store.getSnapshot().exceptions).toEqual([]);
        }
        const store = new ToastHistoryStore();
        store.initializePersistence({ getItem: () => JSON.stringify({ version: 1, rules: [null, { ...rule, suppress: 'true' }, { ...rule, mode: 'contains', message: '' }, rule] }) });
        expect(store.getSnapshot().exceptions).toHaveLength(1);
    });
});

describe('toast exceptions in the browser', () => {
    let browser;
    let page;
    beforeAll(async () => {
        browser = await chromium.launch({ executablePath: resolveSystemChromiumPath() || undefined });
    });
    afterAll(async () => { await browser?.close(); });
    afterEach(async () => { await page?.close(); });
    beforeEach(async () => {
        page = await browser.newPage();
        await page.setContent('<div id="top-settings-holder"></div>');
        await page.addScriptTag({ path: 'public/lib/jquery-3.5.1.min.js' });
        await page.addScriptTag({ path: 'public/lib/toastr.min.js' });
        const source = await fs.readFile(new URL('../public/scripts/notification-history.js', import.meta.url), 'utf8');
        await page.evaluate(async source => {
            const module = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
            window.historyModule = module;
            window.store = new module.ToastHistoryStore();
            window.toastr.options = { escapeHtml: true, timeOut: 0, showDuration: 0, hideDuration: 0 };
            module.installToastHistoryCapture({ toastr: window.toastr, store: window.store });
        }, source);
    });

    it('extracts inert text consistently and suppressed handles cannot clear other toasts', async () => {
        const result = await page.evaluate(() => {
            const { store, toastr, historyModule, jQuery } = window;
            const existing = toastr.info('Keep visible', 'Other');
            toastr.success('<b>Applied</b><br>2 &amp; 3', 'STMB', { escapeHtml: false });
            const entry = store.getSnapshot().entries.at(-1);
            store.toggleExact(entry, 'suppress');
            let shown = false;
            const handle = toastr.success('<b>Applied</b><br>2 &amp; 3', 'STMB', { escapeHtml: false, onShown: () => { shown = true; } });
            handle.find('.toast-message').on('click', () => {}).remove();
            toastr.clear(handle);
            toastr.remove(handle);
            const element = document.createElement('b');
            element.innerHTML = 'Owned node<span hidden>Hidden text</span>';
            document.body.append(element);
            const nodeText = historyModule.getToastText(element, false);
            const collectionText = historyModule.getToastText(jQuery(element), false);
            const escaped = historyModule.getToastText('<b>literal</b>', true);
            const inert = historyModule.getToastText('<script>window.executed = true</script><img src="invalid" onerror="window.executed=true">Safe', false);
            return {
                message: entry.message, records: store.getSnapshot().entries.filter(e => e.title === 'STMB').length,
                popups: document.querySelectorAll('.toast-success').length,
                handleLength: handle.length, shown, existingConnected: existing[0].isConnected,
                nodeText, collectionText, nodeConnected: element.isConnected, escaped, inert, executed: Boolean(window.executed),
            };
        });
        expect(result).toEqual({
            message: 'Applied\n2 & 3', records: 2, popups: 1, handleLength: 0, shown: false, existingConnected: true,
            nodeText: 'Owned node', collectionText: 'Owned node', nodeConnected: true,
            escaped: '<b>literal</b>', inert: 'Safe', executed: false,
        });
    });

    it('edits, pins, unpins and deletes exceptions with accessible controls and empty history', async () => {
        await page.evaluate(() => {
            const { store, historyModule } = window;
            window.savedPreference = null;
            store.initializePersistence({
                getItem: () => window.savedPreference,
                setItem: (_key, value) => { window.savedPreference = value; },
            });
            window.popups = [];
            class Popup {
                constructor(content, _type, _value, options) {
                    this.content = content;
                    this.options = options;
                    window.popups.push(this);
                }
                show() {
                    document.body.append(this.content);
                    return new Promise(resolve => { this.resolve = resolve; });
                }
            }
            window.ui = historyModule.initToastHistoryUi({
                store, documentRef: document, Popup, POPUP_TYPE: { TEXT: 1 }, POPUP_RESULT: { AFFIRMATIVE: 1 },
                SlashCommand: { fromProps: props => props },
                SlashCommandParser: { addCommandObject: command => { window.command = command; } },
                translate: value => value,
            });
            window.toastr.info('Applied 2 updates', 'STMB');
            void window.ui.openHistory();
        });
        const suppress = page.getByRole('button', { name: 'Suppress', exact: true });
        expect(await suppress.getAttribute('title')).toContain('Do not show matching popup');
        await suppress.focus();
        await page.keyboard.press('Space');
        expect(await suppress.getAttribute('aria-pressed')).toBe('true');
        const skip = page.getByRole('button', { name: 'Skip History', exact: true });
        expect(await skip.getAttribute('title')).toContain('Do not save matching');
        await skip.click();
        expect(await page.locator('.toast-history-list .toast-exception-status').textContent()).toBe('Hidden from popups and history');
        await page.evaluate(() => window.command.callback());
        expect(await page.locator('.toast-history-suppressions h3').textContent()).toBe('Manage toast exceptions');
        await page.getByLabel('Message matching').selectOption('contains');
        await page.getByLabel('Message text').fill('');
        await page.getByRole('button', { name: 'Save matching rule' }).click();
        expect(await page.getByLabel('Message text').evaluate(node => node.validity.valid)).toBe(false);
        await page.getByLabel('Message text').fill('Applied ');
        await page.getByRole('button', { name: 'Save matching rule' }).click();
        expect(await page.evaluate(() => window.store.getActions({ level: 'info', title: 'STMB', message: 'Applied 50 updates' }))).toEqual({ suppress: true, skipHistory: true });
        const pin = page.getByRole('button', { name: 'Pin', exact: true });
        expect(await pin.getAttribute('title')).toContain('across reloads and devices');
        await pin.click();
        expect(await page.evaluate(() => JSON.parse(window.savedPreference).rules.length)).toBe(1);
        await page.getByRole('button', { name: 'Unpin', exact: true }).click();
        expect(await page.evaluate(() => JSON.parse(window.savedPreference).rules.length)).toBe(0);
        await page.getByRole('button', { name: 'Pin', exact: true }).click();
        await page.evaluate(() => window.store.clear());
        expect(await page.locator('#toast-history-trigger').isVisible()).toBe(true);
        await page.getByRole('button', { name: 'Delete exception' }).click();
        expect(await page.evaluate(() => JSON.parse(window.savedPreference).rules.length)).toBe(0);
        expect(await page.locator('#toast-history-trigger').isVisible()).toBe(false);
        expect(await page.locator('.toast-history-suppressions').textContent()).toContain('No toast exceptions in this tab.');
    });
});
