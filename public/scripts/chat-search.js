/**
 * Fetches chat summaries from the shared Manage Chats search endpoint.
 * @param {{ query?: string, avatarUrl?: string|null, groupId?: string|null, requestHeaders: HeadersInit, fetchImpl?: typeof fetch }} options
 * @returns {Promise<Array<object>>}
 */
export async function fetchChatSearchResults({
    query = '',
    avatarUrl = null,
    groupId = null,
    requestHeaders,
    fetchImpl = globalThis.fetch,
}) {
    const response = await fetchImpl('/api/chats/search', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
            query,
            avatar_url: avatarUrl,
            group_id: groupId,
        }),
    });

    if (!response.ok) {
        throw new Error('Chat search failed.');
    }

    const results = await response.json();
    if (!Array.isArray(results)) {
        throw new Error('Chat search returned an invalid response.');
    }

    return results;
}

/** Finds literal, case-insensitive matches in current message text, excluding alternate swipes and metadata. */
export function findChatMessages(messages, query) {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return messages.flatMap((message, index) => typeof message?.mes === 'string' && message.mes.toLowerCase().includes(term)
        ? [{ index, name: String(message.name ?? ''), text: message.mes }]
        : []);
}

/** Returns a 40-word preview while preserving the original message text. */
export function getChatMessagePreview(text, maxWords = 40) {
    const value = String(text ?? '');
    if (!value) return { text: '', truncated: false };
    const segmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;
    if (segmenter) {
        let wordCount = 0;
        let end = value.length;
        for (const segment of segmenter.segment(value)) {
            if (!segment.isWordLike) continue;
            wordCount++;
            if (wordCount > maxWords) {
                end = segment.index;
                break;
            }
        }
        return { text: value.slice(0, end).trimEnd(), truncated: end < value.length };
    }
    const words = [...value.matchAll(/\S+/gu)];
    if (words.length <= maxWords) return { text: value, truncated: false };
    return { text: value.slice(0, words[maxWords].index).trimEnd(), truncated: true };
}

/** Reads a selection in bounded requests without weakening its revision check. */
export async function readSelectedChatMessages(request, selection, signal) {
    const messages = [];
    for (let offset = 0; offset < selection.messages.length; offset += 500) {
        const page = await request('read-selected-messages', {
            revision: selection.revision, messages: selection.messages.slice(offset, offset + 500),
        }, signal);
        messages.push(...page.messages);
    }
    return messages.sort((a, b) => a.index - b.index);
}

/** Preserves Find's literal match highlighting without interpreting message HTML. */
function appendHighlightedChatText(container, text, query) {
    const value = String(text || '');
    const term = String(query || '').trim();
    if (!term) { container.textContent = value; return; }
    const matcher = new RegExp(term.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'), 'giu');
    let lastIndex = 0;
    for (const match of value.matchAll(matcher)) {
        container.append(document.createTextNode(value.slice(lastIndex, match.index)));
        const mark = document.createElement('mark');
        mark.textContent = match[0];
        container.append(mark);
        lastIndex = match.index + match[0].length;
    }
    container.append(document.createTextNode(value.slice(lastIndex)));
}

/** Opens the shared, read-only Find/Extract picker; dependencies keep it independently testable. */
export async function showChatMessagePicker({ Popup, popupType, translate: tr, request, prepare, isCurrent, signal, query = '', initialSelection = null, acceptLabel }) {
    const element = (tag, text = '', className = '') => {
        const node = document.createElement(tag);
        node.textContent = text;
        node.className = className;
        return node;
    };
    const button = (text, action) => {
        const node = element('button', text, 'menu_button');
        node.type = 'button';
        node.addEventListener('click', action);
        return node;
    };
    const content = element('div', '', 'chat-extract-picker');
    const input = element('input', '', 'text_pole');
    input.type = 'search';
    input.maxLength = 1000;
    input.value = initialSelection?.query || query;
    input.placeholder = tr('Type a term or phrase', 'ChatExtract_Phrase');
    input.setAttribute('aria-label', tr('Type a term or phrase', 'ChatExtract_Phrase'));
    const hidden = element('input');
    hidden.type = 'checkbox';
    hidden.checked = initialSelection?.hiddenOnly === true;
    const hiddenLabel = element('label', '', 'checkbox_label');
    hiddenLabel.append(hidden, element('span', tr('Hidden only', 'ChatExtract_HiddenOnly')));
    const status = element('p');
    status.setAttribute('role', 'status');
    const selectionStatus = element('p');
    selectionStatus.setAttribute('role', 'status');
    const results = element('div', '', 'chat-find-results');
    const selected = new Map();
    const rows = new Map();
    let revision = initialSelection?.revision;
    let cursor = null;
    let finished = false;
    let busy = false;
    let closed = false;
    let stale = false;
    let controller = new AbortController();
    let accepted = null;
    let timer;
    const current = () => !closed && !signal?.aborted && isCurrent();
    const identity = message => ({ index: message.index, uuid: message.uuid, hash: message.hash });
    const updateSelection = () => {
        selectionStatus.textContent = tr('Selected messages: {{count}}', 'ChatExtract_SelectedCount').replace('{{count}}', String(selected.size));
        accept.disabled = busy || stale || !selected.size || !current();
        more.disabled = busy || stale || finished || !revision || !current();
        selectLoaded.disabled = busy || stale || !rows.size || !current();
        clear.disabled = busy;
        for (const row of rows.values()) row.checkbox.disabled = busy || stale;
    };
    const showError = error => {
        if (!current() || error?.name === 'AbortError') return;
        stale = true;
        status.textContent = error?.code === 'unfinished_edit'
            ? tr('Finish or cancel the message edit before searching.', 'ChatExtract_UnfinishedEdit')
            : error?.code === 'save_failed'
                ? tr('Chat changes could not be saved. Resolve the save error before searching.', 'ChatExtract_SaveFailed')
                : error?.status === 409
                    ? tr('Chat changed. Search again to refresh the results.', 'ChatExtract_Stale')
                    : tr('Could not read messages. Search again to retry.', 'ChatExtract_Failed');
        updateSelection();
    };
    const read = async (endpoint, payload, activeSignal = controller.signal) => {
        if (!current() || activeSignal.aborted) throw new DOMException('Aborted', 'AbortError');
        const data = await request(endpoint, payload, activeSignal);
        if (!current() || activeSignal.aborted) throw new DOMException('Aborted', 'AbortError');
        return data;
    };
    const addRow = message => {
        if (rows.has(message.index)) return;
        const container = element('div', '', 'chat-extract-result');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = busy || stale;
        checkbox.checked = selected.has(message.index);
        checkbox.setAttribute('aria-label', `${tr('Select message', 'ChatExtract_SelectMessage')} ${message.index}`);
        checkbox.addEventListener('change', () => {
            if (stale || !current()) { checkbox.checked = selected.has(message.index); return; }
            if (checkbox.checked) selected.set(message.index, message);
            else selected.delete(message.index);
            updateSelection();
        });
        const details = element('details', '', 'chat-find-result');
        const summary = element('summary');
        const title = element('strong', `#${message.index} · ${message.name}${message.is_system ? ` · ${tr('Hidden', 'ChatExtract_Hidden')}` : ''}`);
        summary.append(title, element('span', message.preview || getChatMessagePreview(message.mes).text));
        const fullText = element('p', '', 'chat-find-result-text');
        const activeSignal = controller.signal;
        let loading = false;
        let loaded = false;
        details.addEventListener('toggle', async () => {
            if (!details.open || loaded || loading || stale) return;
            loading = true;
            try {
                const data = await read('read-selected-messages', { revision, messages: [identity(message)] }, activeSignal);
                appendHighlightedChatText(fullText, data.messages[0].mes, input.value);
                loaded = true;
            } catch (error) { if (!activeSignal.aborted) showError(error); }
            finally { loading = false; }
        });
        const neighbors = element('div', '', 'buttons_block gap10px');
        for (const [direction, label] of [['before', tr('Previous message', 'ChatExtract_Previous')], ['after', tr('Next message', 'ChatExtract_Next')]]) {
            const neighborButton = button(label, async () => {
                neighborButton.disabled = true;
                try {
                    const data = await read('read-selected-messages', { revision, messages: [identity(message)], neighbor: direction }, activeSignal);
                    for (const adjacent of data.messages) addRow(adjacent);
                    updateSelection();
                } catch (error) { if (!activeSignal.aborted) showError(error); }
            });
            neighbors.append(neighborButton);
        }
        details.append(summary, fullText, neighbors);
        container.append(checkbox, details);
        rows.set(message.index, { message, container, checkbox });
        const following = [...rows.keys()].filter(index => index > message.index).sort((a, b) => a - b)[0];
        results.insertBefore(container, following === undefined ? null : rows.get(following).container);
    };
    const loadPage = async (reset = false) => {
        if (!current() || (!reset && (busy || finished))) return;
        if (reset) {
            controller.abort();
            controller = new AbortController();
            revision = undefined;
            cursor = null;
            finished = false;
            stale = false;
            selected.clear();
            rows.clear();
            results.replaceChildren();
        }
        const activeSignal = controller.signal;
        const phrase = input.value.trim();
        if (!phrase) { busy = false; status.textContent = tr('Type a term or phrase', 'ChatExtract_Phrase'); updateSelection(); return; }
        busy = true;
        updateSelection();
        status.textContent = tr('Searching chat history…', 'ChatExtract_Searching');
        try {
            await prepare();
            let remaining = 50;
            while (remaining > 0 && !finished) {
                const data = await read('find-messages', { query: phrase, hiddenOnly: hidden.checked, revision, cursor, limit: remaining }, activeSignal);
                revision = data.revision;
                cursor = data.nextCursor;
                finished = cursor === null;
                for (const message of data.matches) addRow(message);
                remaining -= data.matches.length;
            }
            status.textContent = rows.size ? tr('Loaded messages: {{count}}', 'ChatExtract_LoadedCount').replace('{{count}}', String(rows.size)) : tr('No matching messages.');
        } catch (error) { if (!activeSignal.aborted) showError(error); }
        finally {
            if (!activeSignal.aborted) { busy = false; updateSelection(); }
        }
    };
    const search = button(tr('Search'), () => { clearTimeout(timer); void loadPage(true); });
    const more = button(tr('Load more', 'ChatExtract_LoadMore'), () => { void loadPage(); });
    const selectLoaded = button(tr('Select loaded results', 'ChatExtract_SelectLoaded'), () => {
        for (const { message, checkbox } of rows.values()) { selected.set(message.index, message); checkbox.checked = true; }
        updateSelection();
    });
    const clear = button(tr('Clear selection', 'ChatExtract_ClearSelection'), () => {
        selected.clear();
        for (const row of rows.values()) row.checkbox.checked = false;
        updateSelection();
    });
    const accept = button(acceptLabel, async () => {
        busy = true;
        updateSelection();
        const activeSignal = controller.signal;
        const selection = { query: input.value.trim(), hiddenOnly: hidden.checked, revision, messages: [...selected.values()].map(identity) };
        const selectedRows = [...selected.values()];
        try {
            await prepare();
            await readSelectedChatMessages(read, selection, activeSignal);
            if (activeSignal.aborted || !current()) return;
            accepted = { ...selection, rows: selectedRows };
            await popup.completeAffirmative();
        } catch (error) { if (!activeSignal.aborted) showError(error); }
        finally { if (!activeSignal.aborted) { busy = false; updateSelection(); } }
    });
    const resetSearch = () => {
        clearTimeout(timer);
        controller.abort();
        selected.clear();
        rows.clear();
        results.replaceChildren();
        revision = undefined;
        stale = false;
        busy = false;
        updateSelection();
        timer = setTimeout(() => { void loadPage(true); }, 250);
    };
    input.addEventListener('input', resetSearch);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); void loadPage(true); }
    });
    hidden.addEventListener('change', resetSearch);
    const controls = element('div', '', 'buttons_block gap10px');
    controls.append(search, selectLoaded, clear, more, accept);
    content.append(element('h3', tr('Find in chat')), input, hiddenLabel, controls, status, selectionStatus, results);
    const abort = () => { controller.abort(); void popup.completeCancelled(); };
    const popup = new Popup(content, popupType, '', {
        okButton: false, cancelButton: tr('Close'), wider: true, allowVerticalScrolling: true, leftAlign: true,
        onClose: () => { closed = true; clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort); },
        onOpen: async () => {
            input.focus();
            if (initialSelection) {
                const activeSignal = controller.signal;
                busy = true;
                updateSelection();
                try {
                    await prepare();
                    await readSelectedChatMessages(read, initialSelection, activeSignal);
                    if (activeSignal.aborted || !current()) return;
                    for (const message of initialSelection.rows) { selected.set(message.index, message); addRow(message); }
                } catch (error) { if (!activeSignal.aborted) showError(error); }
                finally { if (!activeSignal.aborted) { busy = false; updateSelection(); } }
            } else if (input.value.trim()) await loadPage(true);
        },
    });
    signal?.addEventListener('abort', abort, { once: true });
    updateSelection();
    await popup.show();
    return accepted;
}
