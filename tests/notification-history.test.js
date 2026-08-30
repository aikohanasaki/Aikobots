import { describe, expect, it, jest } from '@jest/globals';

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

    it('suppresses exact severity, title, and message matches until allowed again', () => {
        const store = new ToastHistoryStore();
        const target = createEntry('warning', 'Connection', 'Try again');
        store.record(target);
        store.suppress(target);

        expect(store.isSuppressed(target)).toBe(true);
        expect(store.record(target)).toBeNull();
        expect(store.record({ ...target, title: 'Different title' })).not.toBeNull();
        expect(store.record({ ...target, message: 'Different message' })).not.toBeNull();
        expect(store.record({ ...target, level: 'error' })).not.toBeNull();
        expect(store.getSnapshot().entries[0].message).toBe('Try again');

        store.unsuppress(target);
        expect(store.isSuppressed(target)).toBe(false);
        expect(store.record(target)).not.toBeNull();
    });

    it('clears history without clearing session suppressions', () => {
        const store = new ToastHistoryStore();
        const target = createEntry('error', 'Failed', 'No changes saved');
        store.record(target);
        store.suppress(target);
        store.clear();

        const snapshot = store.getSnapshot();
        expect(snapshot.entries).toEqual([]);
        expect(snapshot.suppressions).toEqual([{ level: 'error', title: 'Failed', message: 'No changes saved' }]);
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
    it('preserves toastr arguments and return values while capturing rendered plain text', () => {
        const renderedToast = createRenderedToast('Saved', 'Character updated');
        const originalInfo = jest.fn(() => renderedToast);
        const toastr = {
            info: originalInfo,
            success: jest.fn(() => createRenderedToast('', 'Success')),
            warning: jest.fn(() => createRenderedToast('', 'Warning')),
            error: jest.fn(() => createRenderedToast('', 'Error')),
        };
        const store = new ToastHistoryStore();
        const options = { onclick: jest.fn(), escapeHtml: false };
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
            message: 'Character updated',
            timestamp: new Date('2026-08-30T13:00:00.000Z'),
        }]);
        expect(options.onclick).not.toHaveBeenCalled();
    });

    it('does not capture a notification toastr declines to create', () => {
        const toastr = {
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
