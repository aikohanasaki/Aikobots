export const TOAST_HISTORY_LIMIT = 200;

const TOAST_LEVELS = Object.freeze(['info', 'success', 'warning', 'error']);
const CAPTURE_MARKER = Symbol('aikobotsToastHistoryCapture');
const EXCEPTIONS_KEY = 'toastExceptions';

function normalizeText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n');
}

/** Extracts inert plain text, using the same representation before display and in history. */
export function getToastText(value, escapeHtml, documentRef = globalThis.document) {
    if (!value) return '';
    if (escapeHtml) return normalizeText(value);
    if (value.jquery) return value.toArray().map(node => getToastText(node, false, documentRef)).join('');
    if (value.nodeType && value.nodeType !== 1) return normalizeText(value.textContent);
    const template = documentRef.createElement('template');
    template.innerHTML = value.nodeType === 1 ? value.outerHTML : String(value);
    template.content.querySelectorAll('script, style, template, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
    template.content.querySelectorAll('[style]').forEach(node => {
        if (node.style.display === 'none' || node.style.visibility === 'hidden') node.remove();
    });
    template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    return normalizeText(template.content.textContent);
}

/** Copies only validated matching fields and action flags, never originating payloads. */
function validateRule(rule) {
    if (!rule || !TOAST_LEVELS.includes(rule.level)
        || typeof rule.title !== 'string' || typeof rule.message !== 'string'
        || !['exact', 'contains', 'any'].includes(rule.mode)
        || typeof rule.suppress !== 'boolean' || typeof rule.skipHistory !== 'boolean'
        || (rule.mode === 'contains' && !rule.message.trim())) {
        throw new Error('Invalid toast exception');
    }
    return {
        level: rule.level, title: normalizeText(rule.title),
        message: rule.mode === 'any' ? '' : normalizeText(rule.message),
        mode: rule.mode, suppress: rule.suppress, skipHistory: rule.skipHistory,
    };
}

/**
 * Holds the current tab's bounded notification history and toast exceptions.
 */
export class ToastHistoryStore {
    constructor(limit = TOAST_HISTORY_LIMIT) {
        this.limit = Math.max(1, Math.trunc(Number(limit)) || TOAST_HISTORY_LIMIT);
        this.entries = [];
        this.exceptions = new Map();
        this.storage = null;
        this.nextRuleId = 1;
        this.listeners = new Set();
        this.nextId = 1;
    }

    /**
     * Records only the display-safe fields used by notification history.
     * @param {object} entry Candidate history entry.
     * @returns {object|null} The stored entry, or null when skipped.
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

        if (this.getActions(safeEntry).skipHistory) {
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
     * Clears all recorded notifications without changing exceptions.
     */
    clear() {
        if (this.entries.length === 0) {
            return;
        }

        this.entries.length = 0;
        this.notify();
    }

    /** Loads pinned exceptions once account storage is ready; session rules remain local. */
    initializePersistence(storage) {
        if (this.storage) return;
        this.storage = storage;
        try {
            const saved = JSON.parse(storage.getItem(EXCEPTIONS_KEY) || 'null');
            if (saved?.version === 1 && Array.isArray(saved.rules)) {
                for (const candidate of saved.rules) {
                    try {
                        const rule = validateRule(candidate);
                        const id = this.nextRuleId++;
                        this.exceptions.set(id, { ...rule, id, pinned: true });
                    } catch { /* Ignore invalid preferences without logging their text. */ }
                }
            }
        } catch { /* A malformed preference must not prevent startup. */ }
        this.notify();
    }

    /** Combines actions from every matching exception. */
    getActions(entry) {
        const actions = { suppress: false, skipHistory: false };
        for (const rule of this.exceptions.values()) {
            if (rule.level !== entry.level || rule.title !== normalizeText(entry.title)) continue;
            const message = normalizeText(entry.message);
            if (rule.mode === 'exact' && rule.message !== message) continue;
            if (rule.mode === 'contains' && !message.includes(rule.message)) continue;
            actions.suppress ||= rule.suppress;
            actions.skipHistory ||= rule.skipHistory;
        }
        return actions;
    }

    /** Finds the exact rule controlled by a history entry, independent of broader rules. */
    getExactRule(entry) {
        const rule = [...this.exceptions.values()].find(rule => rule.mode === 'exact'
            && rule.level === entry.level && rule.title === normalizeText(entry.title)
            && rule.message === normalizeText(entry.message));
        return rule ? { ...rule } : null;
    }

    /** Creates or updates an exception; pinning requires initialized account storage. */
    saveRule(candidate) {
        const rule = validateRule(candidate);
        const pinned = candidate.pinned === true;
        if (pinned && !this.storage) throw new Error('Account settings are not ready');
        const id = candidate.id ?? this.nextRuleId++;
        if (candidate.id !== undefined && !this.exceptions.has(id)) throw new Error('Unknown toast exception');
        const previous = this.exceptions.get(id);
        this.exceptions.set(id, { ...rule, id, pinned });
        if (pinned || previous?.pinned) this.persist();
        this.notify();
        return id;
    }

    /** Changes one exact-match action without changing overlapping broader rules. */
    toggleExact(entry, action) {
        if (!['suppress', 'skipHistory'].includes(action)) throw new Error('Invalid toast action');
        const rule = this.getExactRule(entry) ?? {
            level: entry.level, title: entry.title, message: entry.message,
            mode: 'exact', suppress: false, skipHistory: false, pinned: false,
        };
        rule[action] = !rule[action];
        this.saveRule(rule);
    }

    /** Removes an exception from this tab and, when pinned, account settings. */
    deleteRule(id) {
        const rule = this.exceptions.get(id);
        if (!this.exceptions.delete(id)) return;
        if (rule.pinned) this.persist();
        this.notify();
    }

    /** Persists only explicitly pinned matching preferences. */
    persist() {
        const rules = [...this.exceptions.values()].filter(rule => rule.pinned).map(validateRule);
        this.storage.setItem(EXCEPTIONS_KEY, JSON.stringify({ version: 1, rules }));
    }

    /**
     * Returns a detached snapshot suitable for rendering.
     * @returns {{entries: object[], exceptions: object[], counts: Record<string, number>}} Current state.
     */
    getSnapshot() {
        const counts = Object.fromEntries(TOAST_LEVELS.map(level => [level, 0]));
        const entries = this.entries.map(entry => {
            counts[entry.level]++;
            return { ...entry, timestamp: new Date(entry.timestamp.getTime()) };
        });
        const exceptions = [...this.exceptions.values()].map(entry => ({ ...entry }));
        return { entries, exceptions, counts };
    }

    /**
     * Subscribes to history and exception changes.
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
 * @param {Document} [options.documentRef] Document used for inert text extraction.
 * @param {JQueryStatic} [options.jquery] Factory for a suppressed notification's empty handle.
 * @returns {{installed: boolean, store: ToastHistoryStore}} Installation result.
 */
export function installToastHistoryCapture({ toastr, store, now = () => new Date(), documentRef = globalThis.document, jquery = globalThis.jQuery }) {
    if (toastr[CAPTURE_MARKER]) {
        return { installed: false, store: toastr[CAPTURE_MARKER] };
    }

    for (const level of TOAST_LEVELS) {
        const original = toastr[level];
        if (typeof original !== 'function') {
            continue;
        }

        toastr[level] = function (...args) {
            let entry;
            try {
                const escapeHtml = args[2]?.escapeHtml ?? toastr.options?.escapeHtml ?? false;
                entry = {
                    level, title: getToastText(args[1], escapeHtml, documentRef),
                    message: getToastText(args[0], escapeHtml, documentRef), timestamp: now(),
                };
            } catch { /* Unreadable input must not change the original notification behavior. */ }
            if (entry && store.getActions(entry).suppress) {
                try {
                    store.record(entry);
                } catch { /* Recording failures must not interrupt the notifying operation. */ }
                return jquery();
            }
            const toast = Reflect.apply(original, this, args);
            try {
                if (toast && entry) {
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

    const emptyIcon = createIcon(documentRef, 'info');
    trigger.append(emptyIcon);
    const updateTrigger = ({ entries, counts, exceptions }) => {
        const total = entries.length;
        trigger.hidden = total === 0 && exceptions.length === 0;
        emptyIcon.hidden = total > 0;
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

    const actionLabels = {
        suppress: translate('Suppress'),
        skipHistory: translate('Skip History'),
    };
    const actionTips = {
        suppress: translate('Do not show matching popup notifications. They still appear in history unless Skip History is enabled.'),
        skipHistory: translate('Do not save matching notifications in history. Popups still appear unless Suppress is enabled.'),
    };
    const statusText = actions => actions.suppress && actions.skipHistory
        ? translate('Hidden from popups and history')
        : actions.suppress ? translate('History only')
            : actions.skipHistory ? translate('Popups only') : '';

    const renderExceptionManager = (root) => {
        const { exceptions } = store.getSnapshot();
        const heading = documentRef.createElement('h3');
        heading.textContent = translate('Manage toast exceptions');
        const explanation = documentRef.createElement('p');
        explanation.textContent = translate('Matches are case-sensitive and language-specific. Severity and title must match exactly. Unpinned exceptions last until reload.');
        const list = documentRef.createElement('div');
        list.classList.add('toast-history-suppression-list');

        if (exceptions.length === 0) {
            const empty = documentRef.createElement('p');
            empty.classList.add('toast-history-empty');
            empty.textContent = translate('No toast exceptions in this tab.');
            list.append(empty);
        } else {
            for (const exception of exceptions) {
                let rule = exception;
                const row = documentRef.createElement('div');
                row.classList.add('toast-history-suppression-row', `toast-history-${rule.level}`);

                const copy = documentRef.createElement('div');
                copy.classList.add('toast-history-suppression-copy');
                const severity = documentRef.createElement('strong');
                severity.textContent = levelLabels[rule.level]();
                copy.append(severity);
                const title = documentRef.createElement('div');
                title.classList.add('toast-history-title');
                title.textContent = `${translate('Title')}: ${rule.title || translate('(empty title)')}`;
                copy.append(title);
                const form = documentRef.createElement('form');
                form.classList.add('toast-exception-matcher');
                const modeLabel = documentRef.createElement('label');
                modeLabel.textContent = translate('Message matching');
                const mode = documentRef.createElement('select');
                mode.classList.add('text_pole');
                for (const [value, label] of [
                    ['exact', translate('Exact text')], ['contains', translate('Contains text')], ['any', translate('Any message')],
                ]) {
                    const option = documentRef.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    mode.append(option);
                }
                mode.value = rule.mode;
                modeLabel.append(mode);
                const messageLabel = documentRef.createElement('label');
                messageLabel.textContent = translate('Message text');
                const message = documentRef.createElement('textarea');
                message.classList.add('text_pole');
                message.rows = 2;
                message.value = rule.message;
                messageLabel.append(message);
                const save = documentRef.createElement('button');
                save.type = 'submit';
                save.classList.add('menu_button');
                save.textContent = translate('Save matching rule');
                const validate = () => {
                    message.disabled = mode.value === 'any';
                    message.setCustomValidity(mode.value === 'contains' && !message.value.trim()
                        ? translate('Enter text to match.') : '');
                };
                mode.addEventListener('change', validate);
                message.addEventListener('input', validate);
                validate();
                form.append(modeLabel, messageLabel, save);
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    validate();
                    if (!form.reportValidity()) return;
                    rule = { ...rule, mode: mode.value, message: message.value };
                    store.saveRule(rule);
                });
                copy.append(form);
                const actions = documentRef.createElement('div');
                actions.classList.add('toast-exception-actions');
                const status = documentRef.createElement('div');
                status.classList.add('toast-exception-status');
                status.setAttribute('aria-live', 'polite');
                status.textContent = statusText(rule);
                for (const action of ['suppress', 'skipHistory']) {
                    const label = documentRef.createElement('label');
                    label.title = actionTips[action];
                    const input = documentRef.createElement('input');
                    input.type = 'checkbox';
                    input.checked = rule[action];
                    input.setAttribute('aria-description', actionTips[action]);
                    input.addEventListener('change', () => {
                        rule = { ...rule, [action]: input.checked };
                        store.saveRule(rule);
                        status.textContent = statusText(rule);
                    });
                    label.append(input, actionLabels[action]);
                    actions.append(label);
                }
                const pin = documentRef.createElement('button');
                pin.type = 'button';
                pin.classList.add('menu_button', 'toast-history-suppression-toggle');
                const pinIcon = documentRef.createElement('i');
                pinIcon.classList.add('fa-solid', 'fa-thumbtack');
                pinIcon.setAttribute('aria-hidden', 'true');
                pin.append(pinIcon);
                const refreshPin = () => {
                    pin.disabled = !store.storage;
                    pin.setAttribute('aria-pressed', String(rule.pinned));
                    pin.setAttribute('aria-label', rule.pinned ? translate('Unpin') : translate('Pin'));
                    pin.title = rule.pinned
                        ? translate('Keep this exception only in this tab until reload.')
                        : translate('Save this exception to your account across reloads and devices.');
                    pin.setAttribute('aria-description', pin.title);
                };
                refreshPin();
                pin.addEventListener('click', () => {
                    rule = { ...rule, pinned: !rule.pinned };
                    store.saveRule(rule);
                    refreshPin();
                });
                actions.append(pin);
                copy.append(actions, status);

                const remove = documentRef.createElement('button');
                remove.type = 'button';
                remove.classList.add('menu_button', 'toast-history-suppression-remove');
                remove.title = translate('Delete exception');
                remove.setAttribute('aria-label', translate('Delete exception'));
                const removeIcon = documentRef.createElement('i');
                removeIcon.classList.add('fa-solid', 'fa-trash-can');
                removeIcon.setAttribute('aria-hidden', 'true');
                remove.append(removeIcon);
                remove.addEventListener('click', () => {
                    store.deleteRule(rule.id);
                    renderExceptionManager(root);
                    (root.querySelector('select') ?? root.querySelector('h3'))?.focus();
                });

                row.append(copy, remove);
                list.append(row);
            }
        }

        heading.tabIndex = -1;
        root.replaceChildren(heading, explanation, list);
    };

    const openSuppressions = async () => {
        const content = documentRef.createElement('div');
        content.classList.add('toast-history-suppressions');
        renderExceptionManager(content);
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
            suppressed.classList.add('toast-exception-status');
            body.append(header, message, suppressed);

            const controls = documentRef.createElement('div');
            controls.classList.add('toast-exception-actions');
            const toggles = {};
            for (const action of ['suppress', 'skipHistory']) {
                const toggle = documentRef.createElement('button');
                toggle.type = 'button';
                toggle.classList.add('menu_button', 'toast-history-suppression-toggle');
                toggle.textContent = actionLabels[action];
                toggle.title = actionTips[action];
                toggle.setAttribute('aria-description', actionTips[action]);
                toggle.addEventListener('click', () => store.toggleExact(entry, action));
                controls.append(toggle);
                toggles[action] = toggle;
            }
            body.append(controls);
            row.append(icon, body);
            content.append(row);
            renderedRows.push({ entry, suppressed, toggles });
        }

        const refreshSuppressionState = () => {
            for (const { entry, suppressed, toggles } of renderedRows) {
                const exact = store.getExactRule(entry);
                const actions = store.getActions(entry);
                suppressed.textContent = statusText(actions);
                suppressed.title = translate('Effective behavior includes all matching exceptions. Edit broader rules in Manage toast exceptions.');
                for (const action of ['suppress', 'skipHistory']) {
                    toggles[action].setAttribute('aria-pressed', String(Boolean(exact?.[action])));
                }
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
                text: translate('Manage toast exceptions'),
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
        helpString: translate('Manage toast exceptions'),
    }));

    return { store, openHistory, openSuppressions };
}
