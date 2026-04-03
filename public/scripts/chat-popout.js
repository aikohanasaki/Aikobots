import { characters, chat, getRequestHeaders, getCurrentChatId, renderDetachedMessage, this_chid } from '../script.js';
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
        const existingMessage = chat[absoluteId];

        if (!existingMessage) {
            chat[absoluteId] = messages[index];
        }

        const rendered = await renderDetachedMessage(messages[index], absoluteId);
        htmlParts.push(rendered.prop('outerHTML'));

        if (!existingMessage) {
            delete chat[absoluteId];
        }
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
        toAbsoluteUrl('css/bright.min.css'),
        toAbsoluteUrl('css/fontawesome.min.css'),
        toAbsoluteUrl('css/solid.min.css'),
    ];
}

function buildChatPopoutHtml({ focusMessageId = null, context = null } = {}) {
    const stylesheets = getPopupAssetUrls()
        .map(url => `<link rel="stylesheet" href="${url}">`)
        .join('');
    const normalizedFocusMessageId = Number.isInteger(Number(focusMessageId)) ? Number(focusMessageId) : null;
    const serializedContext = JSON.stringify(context ?? null).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Chat Log</title>
    ${stylesheets}
    <style>
        :root {
            color-scheme: dark;
        }

        html, body {
            margin: 0;
            min-height: 100%;
            background: rgb(24, 24, 26);
            color: rgb(235, 235, 235);
            font-family: "Noto Sans", sans-serif;
        }

        body.chat-popout {
            overflow: hidden;
        }

        .chat-popout-shell {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .chat-popout-log {
            flex: 1 1 auto;
            overflow: auto;
            padding: 16px;
        }

        .chat-popout-log > #chat {
            max-width: 960px;
            width: 100%;
            margin: 0 auto;
        }

        .chat-popout-loading {
            max-width: 960px;
            margin: 0 auto 16px;
            opacity: 0.8;
            font-size: 0.95rem;
        }

        .chat-popout-end {
            flex: 0 0 auto;
            padding: 14px 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(0, 0, 0, 0.35);
            text-align: center;
            font-size: 0.95rem;
        }

        .chat-popout-end strong {
            display: block;
            margin-bottom: 4px;
            font-size: 1rem;
        }

        .chat-popout-log .swipe_left,
        .chat-popout-log .swipe_right,
        .chat-popout-log .del_checkbox,
        .chat-popout-log .mes_prompt,
        .chat-popout-log .extraMesButtonsHint,
        .chat-popout-log .mes_edit_buttons,
        .chat-popout-log .code-copy,
        .chat-popout-log .mes_reasoning_actions,
        .chat-popout-log #show_more_messages,
        .chat-popout-log #show_newer_messages {
            display: none !important;
        }

        .chat-popout-log .mes_buttons {
            display: inline-flex !important;
            gap: 8px;
        }

        .chat-popout-log .mes_buttons > :not(.mes_edit):not(.mes_copy):not(.extraMesButtons) {
            display: none !important;
        }

        .chat-popout-log .extraMesButtons {
            display: contents !important;
        }

        .chat-popout-log .extraMesButtons > :not(.mes_edit):not(.mes_copy) {
            display: none !important;
        }

        .chat-popout-log .mes_copy,
        .chat-popout-log .mes_edit {
            display: inline-flex !important;
        }

        .chat-popout-log .mes_text[data-chat-popout-editing="true"] {
            outline: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.04);
            padding: 8px;
        }

        .chat-popout-log #chat {
            overflow: visible !important;
            height: auto !important;
        }

        .chat-popout-target {
            outline: 1px solid rgba(255, 255, 255, 0.35);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.06);
        }

        .chat-popout-end[data-hidden="true"] {
            display: none;
        }
    </style>
</head>
<body class="chat-popout">
    <div class="chat-popout-shell">
        <main class="chat-popout-log">
            <div id="chat-popout-loading" class="chat-popout-loading">Loading chat…</div>
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
            const footer = document.getElementById('chat-popout-end');
            const state = {
                totalMessages: 0,
                loadedStart: null,
                loadedEnd: null,
                loadingBefore: false,
                loadingAfter: false,
            };
            if (!root) {
                return;
            }

            if (!window.opener || window.opener.closed || !window.opener.ChatPopout?.loadChunk) {
                if (loading) {
                    loading.textContent = 'The main app window is not available.';
                }
                return;
            }

            const setLoadingText = (text) => {
                if (loading) {
                    loading.textContent = text;
                }
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
                setLoadingText('Loading more messages…');

                try {
                    const chunk = await window.opener.ChatPopout.loadChunk(context, {
                        rangeStart: state.loadedEnd + 1,
                        count: batchSize,
                    });
                    insertChunk(chunk, 'after');
                } finally {
                    state.loadingAfter = false;
                    setLoadingText('');
                }
            };

            const loadMoreBefore = async () => {
                if (state.loadingBefore || !Number.isInteger(state.loadedStart) || state.loadedStart <= 0) {
                    return;
                }

                state.loadingBefore = true;
                setLoadingText('Loading earlier messages…');

                try {
                    const nextStart = Math.max(0, state.loadedStart - batchSize);
                    const chunk = await window.opener.ChatPopout.loadChunk(context, {
                        rangeStart: nextStart,
                        count: state.loadedStart - nextStart,
                    });
                    insertChunk(chunk, 'before');
                } finally {
                    state.loadingBefore = false;
                    setLoadingText('');
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
                    const initialStart = Number.isInteger(focusMessageId)
                        ? Math.max(0, focusMessageId - Math.floor(initialBatchSize / 2))
                        : null;
                    const chunk = await window.opener.ChatPopout.loadChunk(context, {
                        rangeStart: initialStart,
                        count: Number.isInteger(focusMessageId) ? initialBatchSize : batchSize,
                    });
                    insertChunk(chunk, 'after');
                    setLoadingText('');
                    scrollFocusIntoView();
                    maybeLoadMore();
                } catch (error) {
                    console.error('[Chat Popout] Failed to initialize reader.', error);
                    setLoadingText(error?.message || 'Failed to load chat.');
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

    const popup = window.open('', 'core-chat-popout', 'popup=yes,width=960,height=900,resizable=yes,scrollbars=yes');
    if (!popup) {
        toastr.error('The chat popout was blocked by the browser.');
        return null;
    }

    popup.document.open();
    popup.document.write(buildChatPopoutHtml({ focusMessageId, context }));
    popup.document.close();
    popup.focus();
    return popup;
}

globalThis.ChatPopout = {
    ...(globalThis.ChatPopout ?? {}),
    openWindow: openChatPopoutWindow,
    loadChunk: loadReaderChunk,
};
