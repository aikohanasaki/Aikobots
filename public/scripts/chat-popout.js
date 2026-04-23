import { characters, getRequestHeaders, getCurrentChatId, renderDetachedMessage, this_chid } from '../script.js';
import { selected_group } from './group-chats.js';

const READER_BATCH_SIZE = 50;
const READER_THRESHOLD = 25;
const READER_INITIAL_BATCH_SIZE = 20;

function buildReaderContext() {
    if (selected_group) {
        const chatId = getCurrentChatId();
        return chatId ? { type: 'group', chatId } : null;
    }

    const character = characters?.[Number(this_chid)];
    if (!character?.chat || !character?.avatar) {
        return null;
    }

    return {
        type: 'character',
        avatarUrl: character.avatar,
        fileName: character.chat,
        characterName: character.name,
    };
}

async function fetchReaderChunk(context, { rangeStart = null, count = READER_BATCH_SIZE } = {}) {
    if (!context) {
        throw new Error('Reader context is not available.');
    }

    if (context.type === 'group') {
        const payload = {
            id: context.chatId,
            chunked: true,
            count,
            ...(Number.isFinite(Number(rangeStart)) ? { range_start: Number(rangeStart) } : {}),
        };
        const response = await fetch('/api/chats/group/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error('Failed to load group chat chunk.');
        }

        return await response.json();
    }

    const payload = {
        ch_name: context.characterName,
        file_name: context.fileName,
        avatar_url: context.avatarUrl,
        chunked: true,
        count,
        display_count: count,
        buffer_max: Math.max(count, READER_BATCH_SIZE),
        ...(Number.isFinite(Number(rangeStart)) ? { range_start: Number(rangeStart) } : {}),
    };
    const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error('Failed to load chat chunk.');
    }

    return await response.json();
}

async function renderReaderChunkHtml(messages = [], loadedRangeStart = 0) {
    const htmlParts = [];

    for (let index = 0; index < messages.length; index++) {
        const absoluteId = loadedRangeStart + index;
        const rendered = renderDetachedMessage(messages[index], absoluteId);
        htmlParts.push(rendered.prop('outerHTML'));
    }

    return htmlParts.join('');
}

async function loadReaderChunk(context, { rangeStart = null, count = READER_BATCH_SIZE } = {}) {
    const payload = await fetchReaderChunk(context, { rangeStart, count });
    const loadedRangeStart = Number(payload?.loadedRangeStart) || 0;
    const html = await renderReaderChunkHtml(Array.isArray(payload?.messages) ? payload.messages : [], loadedRangeStart);

    return {
        totalMessages: Number(payload?.totalMessages) || 0,
        loadedRangeStart,
        loadedRangeEnd: Number(payload?.loadedRangeEnd) || (loadedRangeStart - 1),
        html,
    };
}

function getPopupAssetUrls() {
    const toAbsoluteUrl = (path) => new URL(path, window.location.href).href;
    return [
        toAbsoluteUrl('style.css'),
        toAbsoluteUrl('css/chat-popout.css'),
        toAbsoluteUrl('css/bright.min.css'),
        toAbsoluteUrl('css/fontawesome.min.css'),
        toAbsoluteUrl('css/solid.min.css'),
        toAbsoluteUrl('css/loader.css'),
    ];
}

function getChatPopoutThemeVariables() {
    const themeVariables = new Map();

    for (const element of [document.documentElement, document.body]) {
        if (!(element instanceof HTMLElement)) {
            continue;
        }

        const styles = getComputedStyle(element);
        for (const property of Array.from(styles)) {
            if (!property.startsWith('--')) {
                continue;
            }

            const value = styles.getPropertyValue(property).trim();
            if (value) {
                themeVariables.set(property, value);
            }
        }
    }

    return themeVariables;
}

function getChatPopoutColorScheme() {
    const background = getComputedStyle(document.documentElement)
        .getPropertyValue('--SmartThemeBlurTintColor')
        .trim();
    const match = background.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);

    if (!match) {
        return 'dark';
    }

    const [red, green, blue] = match.slice(1).map(Number);
    const luminance = ((red * 299) + (green * 587) + (blue * 114)) / 1000;
    return luminance >= 140 ? 'light' : 'dark';
}

function buildChatPopoutHtml({ focusMessageId = null, context = null } = {}) {
    const stylesheets = getPopupAssetUrls()
        .map(url => `<link rel="stylesheet" href="${url}">`)
        .join('');
    const normalizedFocusMessageId = Number.isInteger(Number(focusMessageId)) ? Number(focusMessageId) : null;
    const serializedContext = JSON.stringify(context ?? null).replace(/</g, '\\u003c');
    const colorScheme = getChatPopoutColorScheme();
    const bodyClasses = ['chat-popout'];

    if (document.body?.classList.contains('no-blur')) {
        bodyClasses.push('no-blur');
    }

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Chat Log</title>
    ${stylesheets}
    <style>
        :root {
            color-scheme: ${colorScheme};
        }
    </style>
</head>
<body class="${bodyClasses.join(' ')}">
    <div class="chat-popout-shell">
        <main class="chat-popout-log">
            <div id="chat-popout-loading" class="chat-popout-loading" data-hidden="false" data-mode="initial" aria-live="polite">
                <div class="loader-shell">
                    <div class="loader-icon-wrap">
                        <i class="loader-spinner fa-solid fa-circle-notch"></i>
                    </div>
                    <div class="loader-copy" id="chat-popout-loading-text">Loading chat…</div>
                </div>
            </div>
            <div id="chat"></div>
        </main>
        <footer class="chat-popout-end" id="chat-popout-end" data-hidden="true">
            <strong>End of chat log</strong>
            Close this window to return to the main chat.
        </footer>
    </div>
    <script>
        (() => {
            const root = document.querySelector('.chat-popout-log');
            const focusMessageId = ${normalizedFocusMessageId === null ? 'null' : normalizedFocusMessageId};
            const context = ${serializedContext};
            const batchSize = ${READER_BATCH_SIZE};
            const initialBatchSize = ${READER_INITIAL_BATCH_SIZE};
            const threshold = ${READER_THRESHOLD};
            const chat = document.getElementById('chat');
            const loading = document.getElementById('chat-popout-loading');
            const loadingText = document.getElementById('chat-popout-loading-text');
            const footer = document.getElementById('chat-popout-end');
            const state = {
                totalMessages: 0,
                loadedStart: null,
                loadedEnd: null,
                initialLoading: true,
                loadError: '',
                statusMessage: 'Loading chat…',
                loadingBefore: false,
                loadingAfter: false,
            };
            if (!root) {
                return;
            }

            const setLoadingState = ({ text = '', mode = 'initial', visible = true } = {}) => {
                if (loadingText) {
                    loadingText.textContent = text;
                }

                if (loading) {
                    loading.dataset.mode = mode;
                    loading.dataset.hidden = visible ? 'false' : 'true';
                }
            };

            const syncLoadingState = ({ text = '' } = {}) => {
                if (text) {
                    state.statusMessage = text;
                }

                if (state.loadError) {
                    setLoadingState({ text: state.loadError, mode: 'initial', visible: true });
                    return;
                }

                if (state.initialLoading) {
                    setLoadingState({ text: state.statusMessage || 'Loading chat…', mode: 'initial', visible: true });
                    return;
                }

                if (state.loadingBefore || state.loadingAfter) {
                    setLoadingState({ text: state.statusMessage || 'Loading messages…', mode: 'incremental', visible: true });
                    return;
                }

                setLoadingState({ visible: false });
            };

            if (!window.opener || window.opener.closed || !window.opener.ChatPopout?.loadChunk) {
                state.loadError = 'The main app window is not available.';
                syncLoadingState();
                return;
            }

            const setLoadingText = (text) => {
                syncLoadingState({ text });
            };

            const maybeToggleFooter = () => {
                if (!footer) {
                    return;
                }
                const atEnd = Number.isInteger(state.loadedEnd) && state.loadedEnd >= state.totalMessages - 1;
                footer.dataset.hidden = atEnd ? 'false' : 'true';
            };

            const wireMessageUi = () => {
                root.querySelectorAll('.mes_buttons > *, .extraMesButtons > *').forEach((action) => {
                    if (!(action instanceof HTMLElement)) {
                        return;
                    }

                    const keepAction = action.classList.contains('mes_copy') || action.classList.contains('mes_edit') || action.classList.contains('extraMesButtons');
                    if (!keepAction) {
                        action.remove();
                    }
                });

                root.querySelectorAll('.extraMesButtons').forEach((container) => {
                    if (!(container instanceof HTMLElement)) {
                        return;
                    }

                    const remainingActions = container.querySelector('.mes_copy, .mes_edit');
                    if (!remainingActions) {
                        container.remove();
                    }
                });

                root.querySelectorAll('.mes_text').forEach((messageText) => {
                    if (!(messageText instanceof HTMLElement)) {
                        return;
                    }
                    messageText.contentEditable = 'false';
                    messageText.dataset.chatPopoutEditing = 'false';
                    messageText.addEventListener('blur', () => stopEditing(messageText));
                    messageText.addEventListener('keydown', (event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            stopEditing(messageText);
                        }
                    });
                });
            };

            const highlightFocusMessage = () => {
                root.querySelectorAll('.chat-popout-target').forEach((element) => element.classList.remove('chat-popout-target'));
                if (!Number.isInteger(focusMessageId)) {
                    return;
                }

                const target = root.querySelector(\`.mes[mesid="\${focusMessageId}"]\`);
                if (target instanceof HTMLElement) {
                    target.classList.add('chat-popout-target');
                }
            };

            const scrollFocusIntoView = () => {
                if (!Number.isInteger(focusMessageId)) {
                    return;
                }
                const target = root.querySelector(\`.mes[mesid="\${focusMessageId}"]\`);
                if (target instanceof HTMLElement) {
                    requestAnimationFrame(() => {
                        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    });
                }
            };

            const copyMessageText = async (text) => {
                try {
                    await navigator.clipboard.writeText(text);
                } catch {
                    const helper = document.createElement('textarea');
                    helper.value = text;
                    helper.setAttribute('readonly', 'readonly');
                    helper.style.position = 'absolute';
                    helper.style.left = '-9999px';
                    document.body.appendChild(helper);
                    helper.select();
                    document.execCommand('copy');
                    helper.remove();
                }
            };

            const stopEditing = (messageText) => {
                messageText.contentEditable = 'false';
                messageText.dataset.chatPopoutEditing = 'false';
                messageText.blur();
            };

            const insertChunk = (chunk, direction) => {
                if (!(chat instanceof HTMLElement)) {
                    return;
                }

                if (!chunk?.html) {
                    state.totalMessages = chunk?.totalMessages ?? state.totalMessages;
                    maybeToggleFooter();
                    return;
                }

                if (direction === 'before') {
                    const previousHeight = chat.scrollHeight;
                    chat.insertAdjacentHTML('afterbegin', chunk.html);
                    const newHeight = chat.scrollHeight;
                    root.scrollTop += newHeight - previousHeight;
                    state.loadedStart = chunk.loadedRangeStart;
                    state.loadedEnd = state.loadedEnd === null ? chunk.loadedRangeEnd : state.loadedEnd;
                } else {
                    chat.insertAdjacentHTML('beforeend', chunk.html);
                    state.loadedStart = state.loadedStart === null ? chunk.loadedRangeStart : state.loadedStart;
                    state.loadedEnd = chunk.loadedRangeEnd;
                }

                state.totalMessages = chunk.totalMessages;
                wireMessageUi();
                highlightFocusMessage();
                maybeToggleFooter();
            };

            const loadMoreAfter = async () => {
                if (state.loadingAfter || !Number.isInteger(state.loadedEnd) || state.loadedEnd >= state.totalMessages - 1) {
                    return;
                }

                state.loadingAfter = true;
                state.loadError = '';
                setLoadingText('Loading more messages…');

                try {
                    const chunk = await window.opener.ChatPopout.loadChunk(context, {
                        rangeStart: state.loadedEnd + 1,
                        count: batchSize,
                    });
                    insertChunk(chunk, 'after');
                } catch (error) {
                    console.error('[Chat Popout] Failed to load later messages.', error);
                    state.loadError = error?.message || 'Failed to load more messages.';
                } finally {
                    state.loadingAfter = false;
                    state.statusMessage = '';
                    syncLoadingState();
                }
            };

            const loadMoreBefore = async () => {
                if (state.loadingBefore || !Number.isInteger(state.loadedStart) || state.loadedStart <= 0) {
                    return;
                }

                state.loadingBefore = true;
                state.loadError = '';
                setLoadingText('Loading earlier messages…');

                try {
                    const nextStart = Math.max(0, state.loadedStart - batchSize);
                    const chunk = await window.opener.ChatPopout.loadChunk(context, {
                        rangeStart: nextStart,
                        count: state.loadedStart - nextStart,
                    });
                    insertChunk(chunk, 'before');
                } catch (error) {
                    console.error('[Chat Popout] Failed to load earlier messages.', error);
                    state.loadError = error?.message || 'Failed to load earlier messages.';
                } finally {
                    state.loadingBefore = false;
                    state.statusMessage = '';
                    syncLoadingState();
                }
            };

            const maybeLoadMore = () => {
                if (!(chat instanceof HTMLElement)) {
                    return;
                }

                const messages = Array.from(chat.querySelectorAll('.mes'));
                if (!messages.length) {
                    return;
                }

                const afterTrigger = messages[Math.max(0, messages.length - threshold)];
                if (afterTrigger instanceof HTMLElement) {
                    const rect = afterTrigger.getBoundingClientRect();
                    if (rect.top <= window.innerHeight) {
                        void loadMoreAfter();
                    }
                }

                const beforeTrigger = messages[Math.min(messages.length - 1, threshold - 1)];
                if (beforeTrigger instanceof HTMLElement) {
                    const rect = beforeTrigger.getBoundingClientRect();
                    if (rect.bottom >= 0) {
                        void loadMoreBefore();
                    }
                }
            };

            root.addEventListener('pointerup', async (event) => {
                const copyButton = event.target.closest('.mes_copy');
                if (copyButton) {
                    const message = copyButton.closest('.mes');
                    const text = message?.querySelector('.mes_text')?.innerText ?? '';
                    await copyMessageText(text.trim());
                    return;
                }

                const editButton = event.target.closest('.mes_edit');
                if (editButton) {
                    const messageText = editButton.closest('.mes')?.querySelector('.mes_text');
                    if (!(messageText instanceof HTMLElement)) {
                        return;
                    }

                    messageText.contentEditable = 'plaintext-only';
                    messageText.dataset.chatPopoutEditing = 'true';
                    messageText.focus();

                    const selection = window.getSelection();
                    if (!selection) {
                        return;
                    }

                    const range = document.createRange();
                    range.selectNodeContents(messageText);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            });

            root.addEventListener('scroll', () => {
                maybeLoadMore();
            }, { passive: true });

            const loadInitial = async () => {
                try {
                    state.loadError = '';
                    const initialStart = Number.isInteger(focusMessageId)
                        ? Math.max(0, focusMessageId - Math.floor(initialBatchSize / 2))
                        : null;
                    const chunk = await window.opener.ChatPopout.loadChunk(context, {
                        rangeStart: initialStart,
                        count: Number.isInteger(focusMessageId) ? initialBatchSize : batchSize,
                    });
                    insertChunk(chunk, 'after');
                    scrollFocusIntoView();
                    maybeLoadMore();
                } catch (error) {
                    console.error('[Chat Popout] Failed to initialize reader.', error);
                    state.loadError = error?.message || 'Failed to load chat.';
                } finally {
                    state.initialLoading = false;
                    state.statusMessage = '';
                    syncLoadingState();
                }
            };

            void loadInitial();
        })();
    </script>
</body>
</html>`;
}

export function openChatPopoutWindow({ focusMessageId = null } = {}) {
    const context = buildReaderContext();
    if (!context) {
        toastr.error('Chat log is not available right now.');
        return null;
    }

    const themeVariables = getChatPopoutThemeVariables();
    const popup = window.open('', 'core-chat-popout', 'popup=yes,width=960,height=900,resizable=yes,scrollbars=yes');
    if (!popup) {
        toastr.error('The chat popout was blocked by the browser.');
        return null;
    }

    popup.document.open();
    popup.document.write(buildChatPopoutHtml({ focusMessageId, context }));
    popup.document.close();
    for (const [property, value] of themeVariables.entries()) {
        popup.document.documentElement.style.setProperty(property, value);
    }
    popup.focus();
    return popup;
}

globalThis.ChatPopout = {
    ...(globalThis.ChatPopout ?? {}),
    openWindow: openChatPopoutWindow,
    loadChunk: loadReaderChunk,
};
