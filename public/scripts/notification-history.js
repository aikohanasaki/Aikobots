export const TOAST_HISTORY_LIMIT = 200;

const TOAST_LEVELS = Object.freeze(['info', 'success', 'warning', 'error']);
const CAPTURE_MARKER = Symbol('aikobotsToastHistoryCapture');

function normalizeText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n');
}

function getEntryKey(entry) {
    return JSON.stringify([
        normalizeText(entry?.level),
        normalizeText(entry?.title),
        normalizeText(entry?.message),
    ]);
}

function readRenderedText(element) {
    if (!element) {
        return '';
    }

    const visibleText = typeof element.innerText === 'string' ? element.innerText : element.textContent;
    return normalizeText(visibleText);
}

function extractToastEntry(level, toast, timestamp) {
    const element = toast?.[0] ?? toast?.get?.(0);
    if (!element || typeof element.querySelector !== 'function') {
        return null;
    }

    return {
        level,
        title: readRenderedText(element.querySelector('.toast-title')),
        message: readRenderedText(element.querySelector('.toast-message')),
        timestamp,
    };
}

/**
 * Holds the current tab's bounded notification history and suppression list.
 */
export class ToastHistoryStore {
    constructor(limit = TOAST_HISTORY_LIMIT) {
        this.limit = Math.max(1, Math.trunc(Number(limit)) || TOAST_HISTORY_LIMIT);
        this.entries = [];
        this.suppressions = new Map();
        this.listeners = new Set();
        this.nextId = 1;
    }

    /**
     * Records only the display-safe fields used by notification history.
     * @param {object} entry Candidate history entry.
     * @returns {object|null} The stored entry, or null when suppressed.
     */
    record(entry) {
        const level = normalizeText(entry?.level);
        if (!TOAST_LEVELS.includes(level)) {
            return null;
        }

        const safeEntry = {
            id: this.nextId++,
            level,
            title: normalizeText(entry?.title),
            message: normalizeText(entry?.message),
            timestamp: entry?.timestamp instanceof Date && Number.isFinite(entry.timestamp.getTime())
                ? new Date(entry.timestamp.getTime())
                : new Date(),
        };

        if (this.isSuppressed(safeEntry)) {
            return null;
        }

        this.entries.push(safeEntry);
        if (this.entries.length > this.limit) {
            this.entries.splice(0, this.entries.length - this.limit);
        }
        this.notify();
        return { ...safeEntry, timestamp: new Date(safeEntry.timestamp.getTime()) };
    }

    /**
     * Clears all recorded notifications without changing suppressions.
     */
    clear() {
        if (this.entries.length === 0) {
            return;
        }

        this.entries.length = 0;
        this.notify();
    }

    /**
     * Suppresses future entries matching the same severity, title, and message.
     * @param {object} entry Notification identity to suppress.
     */
    suppress(entry) {
        const suppression = {
            level: normalizeText(entry?.level),
            title: normalizeText(entry?.title),
            message: normalizeText(entry?.message),
        };
        const key = getEntryKey(suppression);
        if (this.suppressions.has(key)) {
            return;
        }

        this.suppressions.set(key, suppression);
        this.notify();
    }

    /**
     * Removes a matching session suppression.
     * @param {object} entry Notification identity to allow again.
     */
    unsuppress(entry) {
        if (this.suppressions.delete(getEntryKey(entry))) {
            this.notify();
        }
    }

    /**
     * Tests whether an entry is excluded from future history.
     * @param {object} entry Notification identity to test.
     * @returns {boolean} Whether the entry is suppressed.
     */
    isSuppressed(entry) {
        return this.suppressions.has(getEntryKey(entry));
    }

    /**
     * Returns a detached snapshot suitable for rendering.
     * @returns {{entries: object[], suppressions: object[], counts: Record<string, number>}} Current state.
     */
    getSnapshot() {
        const counts = Object.fromEntries(TOAST_LEVELS.map(level => [level, 0]));
        const entries = this.entries.map(entry => {
            counts[entry.level]++;
            return { ...entry, timestamp: new Date(entry.timestamp.getTime()) };
        });
        const suppressions = [...this.suppressions.values()].map(entry => ({ ...entry }));
        return { entries, suppressions, counts };
    }

    /**
     * Subscribes to history and suppression changes.
     * @param {(snapshot: ReturnType<ToastHistoryStore['getSnapshot']>) => void} listener Change handler.
     * @returns {() => void} Unsubscribe callback.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }

    notify() {
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
}

/**
 * Wraps Toastr's four creation methods while preserving their behavior and return values.
 * @param {object} options Capture dependencies.
 * @param {object} options.toastr Toastr instance to wrap.
 * @param {ToastHistoryStore} options.store Destination history store.
 * @param {() => Date} [options.now] Timestamp provider.
 * @returns {{installed: boolean, store: ToastHistoryStore}} Installation result.
 */
export function installToastHistoryCapture({ toastr, store, now = () => new Date() }) {
    if (toastr[CAPTURE_MARKER]) {
        return { installed: false, store: toastr[CAPTURE_MARKER] };
    }

    for (const level of TOAST_LEVELS) {
        const original = toastr[level];
        if (typeof original !== 'function') {
            continue;
        }

        toastr[level] = function (...args) {
            const toast = Reflect.apply(original, this, args);
            try {
                const entry = extractToastEntry(level, toast, now());
                if (entry) {
                    store.record(entry);
                }
            } catch {
                // History is best-effort and must never change notification behavior.
            }
            return toast;
        };
    }

    Object.defineProperty(toastr, CAPTURE_MARKER, {
        value: store,
        configurable: false,
        enumerable: false,
        writable: false,
    });
    return { installed: true, store };
}

function createIcon(documentRef, level) {
    const icons = {
        info: 'fa-circle-info',
        success: 'fa-circle-check',
        warning: 'fa-triangle-exclamation',
        error: 'fa-circle-exclamation',
    };
    const icon = documentRef.createElement('i');
    icon.classList.add('fa-solid', 'fa-fw', icons[level]);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

/**
 * Builds the accessible top-bar and popup surfaces for a captured history store.
 * @param {object} options UI dependencies.
 * @returns {{store: ToastHistoryStore, openHistory: () => Promise<void>, openSuppressions: () => Promise<void>}|null} UI controller.
 */
export function initToastHistoryUi({
    store,
    documentRef,
    Popup,
    POPUP_RESULT,
    POPUP_TYPE,
    SlashCommand,
    SlashCommandParser,
    translate,
}) {
    const host = documentRef?.getElementById('top-settings-holder');
    if (!host || host.querySelector('#toast-history-trigger')) {
        return null;
    }

    const levelLabels = {
        info: () => translate('Notification level info'),
        success: () => translate('Notification level success'),
        warning: () => translate('Notification level warning'),
        error: () => translate('Notification level error'),
    };
    const trigger = documentRef.createElement('button');
    trigger.id = 'toast-history-trigger';
    trigger.type = 'button';
    trigger.classList.add('toast-history-trigger');
    trigger.hidden = true;

    const indicators = {};
    for (const level of TOAST_LEVELS) {
        const indicator = documentRef.createElement('span');
        indicator.classList.add('toast-history-indicator', `toast-history-${level}`);
        indicator.append(createIcon(documentRef, level));
        const count = documentRef.createElement('span');
        count.classList.add('toast-history-count');
        indicator.append(count);
        trigger.append(indicator);
        indicators[level] = { indicator, count };
    }
    host.prepend(trigger);

    const updateTrigger = ({ entries, counts }) => {
        const total = entries.length;
        trigger.hidden = total === 0;
        const summary = [
            translate('Notification history'),
            `${translate('Total')}: ${total}`,
            ...TOAST_LEVELS.filter(level => counts[level] > 0).map(level => `${levelLabels[level]()}: ${counts[level]}`),
        ].join('. ');
        trigger.title = summary;
        trigger.setAttribute('aria-label', summary);

        for (const level of TOAST_LEVELS) {
            indicators[level].count.textContent = String(counts[level]);
            indicators[level].indicator.hidden = counts[level] === 0;
        }
    };
    store.subscribe(updateTrigger);

    const renderSuppressionManager = (root) => {
        const { suppressions } = store.getSnapshot();
        const heading = documentRef.createElement('h3');
        heading.textContent = translate('Manage suppressed notifications');
        const list = documentRef.createElement('div');
        list.classList.add('toast-history-suppression-list');

        if (suppressions.length === 0) {
            const empty = documentRef.createElement('p');
            empty.classList.add('toast-history-empty');
            empty.textContent = translate('No notifications are suppressed in this tab.');
            list.append(empty);
        } else {
            for (const suppression of suppressions) {
                const row = documentRef.createElement('div');
                row.classList.add('toast-history-suppression-row', `toast-history-${suppression.level}`);

                const copy = documentRef.createElement('div');
                copy.classList.add('toast-history-suppression-copy');
                const severity = documentRef.createElement('strong');
                severity.textContent = levelLabels[suppression.level]?.() ?? suppression.level;
                copy.append(severity);
                if (suppression.title) {
                    const title = documentRef.createElement('div');
                    title.classList.add('toast-history-title');
                    title.textContent = suppression.title;
                    copy.append(title);
                }
                const message = documentRef.createElement('div');
                message.classList.add('toast-history-message');
                message.textContent = suppression.message;
                copy.append(message);

                const remove = documentRef.createElement('button');
                remove.type = 'button';
                remove.classList.add('menu_button', 'toast-history-suppression-remove');
                remove.title = translate('Remove suppression');
                remove.setAttribute('aria-label', translate('Remove suppression'));
                const removeIcon = documentRef.createElement('i');
                removeIcon.classList.add('fa-solid', 'fa-trash-can');
                removeIcon.setAttribute('aria-hidden', 'true');
                remove.append(removeIcon);
                remove.addEventListener('click', () => {
                    store.unsuppress(suppression);
                    renderSuppressionManager(root);
                });

                row.append(copy, remove);
                list.append(row);
            }
        }

        root.replaceChildren(heading, list);
    };

    const openSuppressions = async () => {
        const content = documentRef.createElement('div');
        content.classList.add('toast-history-suppressions');
        renderSuppressionManager(content);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: translate('Close'),
            wider: true,
            allowVerticalScrolling: true,
            leftAlign: true,
        });
        await popup.show();
    };

    const openHistory = async () => {
        const snapshot = store.getSnapshot();
        const content = documentRef.createElement('div');
        content.classList.add('toast-history-list');
        const heading = documentRef.createElement('h3');
        heading.textContent = translate('Notification history');
        content.append(heading);

        if (snapshot.entries.length === 0) {
            const empty = documentRef.createElement('p');
            empty.classList.add('toast-history-empty');
            empty.textContent = translate('No notifications have been recorded in this tab.');
            content.append(empty);
        }

        const renderedRows = [];
        for (const entry of snapshot.entries.toReversed()) {
            const row = documentRef.createElement('article');
            row.classList.add('toast-history-entry', `toast-history-${entry.level}`);

            const icon = createIcon(documentRef, entry.level);
            icon.classList.add('toast-history-entry-icon');
            const body = documentRef.createElement('div');
            body.classList.add('toast-history-entry-body');
            const header = documentRef.createElement('div');
            header.classList.add('toast-history-entry-header');
            const title = documentRef.createElement('strong');
            title.textContent = entry.title || levelLabels[entry.level]();
            const timestamp = documentRef.createElement('time');
            timestamp.dateTime = entry.timestamp.toISOString();
            timestamp.textContent = entry.timestamp.toLocaleString();
            header.append(title, timestamp);
            const message = documentRef.createElement('div');
            message.classList.add('toast-history-message');
            message.textContent = entry.message;
            const suppressed = documentRef.createElement('div');
            suppressed.classList.add('toast-history-suppressed-label');
            suppressed.textContent = translate('Suppressed from future history');
            body.append(header, message, suppressed);

            const toggle = documentRef.createElement('button');
            toggle.type = 'button';
            toggle.classList.add('menu_button', 'toast-history-suppression-toggle');
            toggle.append(createIcon(documentRef, 'error'));
            toggle.firstElementChild.className = 'fa-solid fa-ban';
            toggle.addEventListener('click', () => {
                if (store.isSuppressed(entry)) {
                    store.unsuppress(entry);
                } else {
                    store.suppress(entry);
                }
            });

            row.append(icon, body, toggle);
            content.append(row);
            renderedRows.push({ entry, row, toggle });
        }

        const refreshSuppressionState = () => {
            for (const { entry, row, toggle } of renderedRows) {
                const isSuppressed = store.isSuppressed(entry);
                row.classList.toggle('toast-history-entry-suppressed', isSuppressed);
                toggle.setAttribute('aria-pressed', String(isSuppressed));
                const label = isSuppressed
                    ? translate('Allow matching notifications in history')
                    : translate('Hide matching notifications from history');
                toggle.title = label;
                toggle.setAttribute('aria-label', label);
            }
        };
        const unsubscribe = store.subscribe(refreshSuppressionState);

        const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: translate('Clear'),
            cancelButton: translate('Close'),
            wider: true,
            allowVerticalScrolling: true,
            leftAlign: true,
            customButtons: [{
                text: translate('Manage suppressed notifications'),
                action: () => void openSuppressions(),
            }],
            onClose: unsubscribe,
        });
        const result = await popup.show();
        if (result === POPUP_RESULT.AFFIRMATIVE) {
            store.clear();
        }
    };

    trigger.addEventListener('click', () => void openHistory());
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'toasthistory-blocks',
        callback: () => {
            void openSuppressions();
            return '';
        },
        helpString: translate('Manage notifications excluded from notification history.'),
    }));

    return { store, openHistory, openSuppressions };
}
