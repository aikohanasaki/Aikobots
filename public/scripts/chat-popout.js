import { chatElement } from '../script.js';

function getPopupAssetUrls() {
    const toAbsoluteUrl = (path) => new URL(path, window.location.href).href;
    return [
        toAbsoluteUrl('style.css'),
        toAbsoluteUrl('css/bright.min.css'),
        toAbsoluteUrl('css/fontawesome.min.css'),
        toAbsoluteUrl('css/solid.min.css'),
    ];
}

function buildChatPopoutHtml(chatHtml) {
    const stylesheets = getPopupAssetUrls()
        .map(url => `<link rel="stylesheet" href="${url}">`)
        .join('');

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
    </style>
</head>
<body class="chat-popout">
    <div class="chat-popout-shell">
        <main class="chat-popout-log">
            ${chatHtml}
        </main>
        <footer class="chat-popout-end">
            <strong>End of chat log</strong>
            Close this window to return to the main chat.
        </footer>
    </div>
    <script>
        (() => {
            const root = document.querySelector('.chat-popout-log');
            if (!root) {
                return;
            }

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

            root.querySelectorAll('.mes_text').forEach((messageText) => {
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
        })();
    </script>
</body>
</html>`;
}

export function openChatPopoutWindow() {
    const sourceChat = chatElement.get(0);
    if (!(sourceChat instanceof HTMLElement)) {
        toastr.error('Chat log is not available right now.');
        return null;
    }

    const chatSnapshot = sourceChat.cloneNode(true);
    if (!(chatSnapshot instanceof HTMLElement)) {
        toastr.error('Failed to copy the current chat log.');
        return null;
    }

    chatSnapshot.querySelectorAll('#show_more_messages, #show_newer_messages').forEach(element => element.remove());

    const popup = window.open('', 'core-chat-popout', 'popup=yes,width=960,height=900,resizable=yes,scrollbars=yes');
    if (!popup) {
        toastr.error('The chat popout was blocked by the browser.');
        return null;
    }

    popup.document.open();
    popup.document.write(buildChatPopoutHtml(chatSnapshot.outerHTML));
    popup.document.close();
    popup.focus();
    return popup;
}

globalThis.ChatPopout = {
    ...(globalThis.ChatPopout ?? {}),
    openWindow: openChatPopoutWindow,
};
