import {
    characters,
    this_chid,
    openCharacterChat,
    openManageChatsOwnerChat,
    openManageChatsOrphanCharacterChat,
    chat_metadata,
    getRequestHeaders,
    getThumbnailUrl,
    getCharacters,
    chat,
    saveChatConditional,
    saveItemizedPrompts,
    getTotalChatMessages,
    isChatMessageLoaded,
    jumpToMessageWindow,
    hasActiveMessageEditSession,
    isHistoricalChatMessage,
    handleManageChatsBulkRowClick,
    getCurrentChatId,
    getChatSaveRevision,
    getChatSaveSessionId,
    CHAT_SAVE_RESULT,
} from '../script.js';
import { saveMetadataDebounced } from './extensions.js';
import { humanizedDateTime } from './RossAscends-mods.js';
import { openChatPopoutWindow } from './chat-popout.js';
import {
    DEFAULT_AUTO_MODE_DELAY,
    group_activation_strategy,
    group_generation_mode,
    groups,
    openGroupById,
    openGroupChat,
    saveGroupBookmarkChat,
    selected_group,
} from './group-chats.js';
import { getLastMessageId } from './macros.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from './slash-commands/SlashCommandArgument.js';
import { commonEnumProviders } from './slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';
import { createTagMapFromList } from './tags.js';
import { renderTemplateAsync } from './templates.js';
import { t, translate } from './i18n.js';
import { AIKOBOTS_MESSAGE_UUID_KEY, AIKOBOTS_SWIPE_UUID_KEY } from './chat-identities.js';

import {
    getUniqueName,
    isTrueBoolean,
    uuidv4,
} from './utils.js';
import { event_types, eventSource } from './events.js';

const bookmarkNameToken = 'Checkpoint #';
const MAX_NAMED_BOOKMARKS = 75;
const LARGE_JUMP_BOOKMARK_THRESHOLD = 500;

let currentNamedBookmarksPopup = null;
let namedBookmarksSortAscending = true;
let currentNamedBookmarks = [];

async function chooseStmbChatCopyMode(kind) {
    const { getStmbChatCopyLockContext, hasStmbChatCopyBindings, isStmbChatCopyEnabled } = await import('./stmb.js');
    if (!isStmbChatCopyEnabled()) {
        return { copyMemoryBooks: false, prompted: false };
    }
    const lockContext = getStmbChatCopyLockContext();
    if (!hasStmbChatCopyBindings(chat_metadata, lockContext)) {
        const hasLocks = lockContext.soloMemoryBookLocked || lockContext.lockedCharacterBindingKeys.length > 0;
        return { copyMemoryBooks: Boolean(hasLocks), prompted: false };
    }

    const isCheckpoint = kind === 'checkpoint';
    const content = '<p data-i18n="Choose whether to copy the Memory Books bound to this chat.">Choose whether to copy the Memory Books bound to this chat.</p>';
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: isCheckpoint
            ? translate('Create checkpoint and copy Memory Books')
            : translate('Branch chat and copy Memory Books'),
        cancelButton: isCheckpoint
            ? translate('Create checkpoint only')
            : translate('Branch chat only'),
        customButtons: [{
            text: translate('Cancel'),
            result: POPUP_RESULT.CANCELLED,
            appendAtEnd: true,
        }],
        defaultResult: POPUP_RESULT.AFFIRMATIVE,
    });
    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) return { copyMemoryBooks: true, prompted: true };
    if (result === POPUP_RESULT.NEGATIVE) return { copyMemoryBooks: false, prompted: true };
    return null;
}

async function confirmStmbChatOnlyFallback(kind, message) {
    const isCheckpoint = kind === 'checkpoint';
    const result = await Popup.show.confirm(
        isCheckpoint ? translate('Checkpoint Memory Book copy failed') : translate('Branch Memory Book copy failed'),
        `<p>${String(message || translate('Memory Books could not be copied.'))}</p>`,
        {
            okButton: isCheckpoint ? translate('Create checkpoint only') : translate('Branch chat only'),
            cancelButton: translate('Cancel'),
        },
    );
    return result === POPUP_RESULT.AFFIRMATIVE;
}

function showCopiedDerivedEntriesNotice() {
    toastr.warning(
        translate('Copied Side Prompt, Topical Clip, or Clip entries may include information from later messages. Recreate those entries for this chat.'),
        'STMB',
        { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true, closeButton: true },
    );
}

function getSelectedSwipeUuid(message, requestedSwipeId = null) {
    const swipeId = requestedSwipeId === null ? Number(message?.swipe_id) : Number(requestedSwipeId);
    return Number.isInteger(swipeId) ? String(message?.swipe_info?.[swipeId]?.[AIKOBOTS_SWIPE_UUID_KEY] || '') : '';
}

async function saveDirectChatCopy({ name, mesId, metadata, kind, copyMemoryBooks, stmbCopyLockContext = null, swipeId = null, operationId = uuidv4() }) {
    const sourceChatId = getCurrentChatId();
    const character = characters[this_chid];
    const message = chat[mesId];
    if (!sourceChatId || !character?.avatar) {
        return { ok: false, error: 'source_chat_not_found' };
    }

    const saveResult = await saveChatConditional();
    if (saveResult !== CHAT_SAVE_RESULT.SAVED) {
        return { ok: false, error: 'source_chat_save_failed' };
    }

    const response = await fetch('/api/chats/save-prefix', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: character.avatar,
            source_file: sourceChatId,
            target_file: name,
            prefix_end_id: mesId,
            header_overrides: { chat_metadata: metadata },
            copy_kind: kind,
            copy_memory_books: copyMemoryBooks,
            solo_memory_book_locked: stmbCopyLockContext?.soloMemoryBookLocked === true,
            locked_character_binding_keys: stmbCopyLockContext?.lockedCharacterBindingKeys || [],
            selected_message_uuid: message?.[AIKOBOTS_MESSAGE_UUID_KEY] || undefined,
            selected_swipe_uuid: getSelectedSwipeUuid(message, swipeId) || undefined,
            base_revision: getChatSaveRevision(),
            save_session_id: getChatSaveSessionId(),
            operation_id: operationId,
        }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, ...data } : { ok: false, ...data };
}

function getSafeStmbCopyFailureMessage(errorCode) {
    return errorCode === 'stmb_copy_ambiguous_legacy'
        ? translate('This Memory Book cannot be copied safely at the selected message. Nothing was created. Create the chat copy without Memory Books or cancel.')
        : translate('Memory Books cannot be copied for this chat. Nothing was created. Create the chat copy without Memory Books or cancel.');
}

async function runBookmarkChatCopy({ name, mesId, metadata, kind, copyMemoryBooks, swipeId = null }) {
    const stmbCopyLockContext = copyMemoryBooks
        ? (await import('./stmb.js')).getStmbChatCopyLockContext()
        : null;
    const run = async (includeMemoryBooks, operationId) => selected_group
        ? await saveGroupBookmarkChat(selected_group, name, metadata, mesId, {
            copyKind: kind,
            copyMemoryBooks: includeMemoryBooks,
            stmbCopyLockContext,
            swipeId,
            operationId,
        })
        : await saveDirectChatCopy({
            name,
            mesId,
            metadata,
            kind,
            copyMemoryBooks: includeMemoryBooks,
            stmbCopyLockContext,
            swipeId,
            operationId,
        });

    const safeRun = async includeMemoryBooks => {
        const operationId = uuidv4();
        try {
            return await run(includeMemoryBooks, operationId);
        } catch {
            try {
                return await run(includeMemoryBooks, operationId);
            } catch {
                return { ok: false, error: 'chat_copy_request_failed' };
            }
        }
    };

    let result = await safeRun(copyMemoryBooks);
    if (!result.ok && copyMemoryBooks && String(result.error || '').startsWith('stmb_copy_')) {
        const chatOnly = await confirmStmbChatOnlyFallback(kind, getSafeStmbCopyFailureMessage(result.error));
        if (!chatOnly) return null;
        result = await safeRun(false);
    }
    if (!result.ok) return result;
    if (copyMemoryBooks && result.has_derived_entries === true) showCopiedDerivedEntriesNotice();
    return result;
}

function hasActiveChatContext() {
    return selected_group || this_chid !== undefined;
}

function normalizeNamedBookmarkEntry(entry) {
    const messageNum = Number(entry?.messageNum);
    const title = String(entry?.title ?? '').trim();

    if (!Number.isInteger(messageNum) || messageNum < 0 || !title) {
        return null;
    }

    return { messageNum, title };
}

function dedupeNamedBookmarks(bookmarks) {
    const seen = new Set();
    return bookmarks.filter(bookmark => {
        const key = `${bookmark.messageNum}\u0000${bookmark.title}`;
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function getNamedBookmarks() {
    const bookmarks = Array.isArray(chat_metadata?.bookmarks) ? chat_metadata.bookmarks : [];
    return dedupeNamedBookmarks(bookmarks.map(normalizeNamedBookmarkEntry).filter(Boolean));
}

function setNamedBookmarks(bookmarks) {
    const normalized = dedupeNamedBookmarks(bookmarks
        .map(normalizeNamedBookmarkEntry)
        .filter(Boolean))
        .sort((a, b) => a.messageNum - b.messageNum);

    chat_metadata.bookmarks = normalized;
    saveMetadataDebounced();
    return normalized;
}

function sortNamedBookmarks(bookmarks, ascending = namedBookmarksSortAscending) {
    return bookmarks.sort((a, b) => ascending ? a.messageNum - b.messageNum : b.messageNum - a.messageNum);
}

function getNamedBookmarkLoadStatus(messageNum) {
    const renderedMessages = $('#chat').children('.mes');
    const firstDisplayedMessageId = Number(renderedMessages.first().attr('mesid'));
    const lastDisplayedMessageId = Number(renderedMessages.last().attr('mesid'));
    if (renderedMessages.length
        && Number.isFinite(firstDisplayedMessageId)
        && Number.isFinite(lastDisplayedMessageId)
        && messageNum >= firstDisplayedMessageId
        && messageNum <= lastDisplayedMessageId) {
        return {
            indicator: '🟢',
            tooltip: 'Message is visible in the current chat window.',
        };
    }

    if (isChatMessageLoaded(messageNum)) {
        return {
            indicator: '🟡',
            tooltip: 'Message is loaded but not visible in the current chat window.',
        };
    }

    if (!renderedMessages.length) {
        return {
            indicator: '🔴',
            tooltip: 'Message requires loading a historical chunk.',
        };
    }

    const nearestDisplayedMessageId = Number.isFinite(firstDisplayedMessageId) && messageNum < firstDisplayedMessageId
        ? firstDisplayedMessageId
        : lastDisplayedMessageId;
    const distance = Math.abs(messageNum - nearestDisplayedMessageId);

    if (distance >= LARGE_JUMP_BOOKMARK_THRESHOLD) {
        return {
            indicator: '🔴',
            tooltip: `Requires a larger jump of ${distance} messages.`,
        };
    }

    return {
        indicator: '🟡',
        tooltip: `Requires a jump of ${distance} messages.`,
    };
}

async function renderNamedBookmarksManager() {
    const bookmarks = sortNamedBookmarks(getNamedBookmarks(), namedBookmarksSortAscending)
        .map(bookmark => ({
            ...bookmark,
            loadStatus: getNamedBookmarkLoadStatus(bookmark.messageNum),
        }));

    currentNamedBookmarks = bookmarks;

    return await renderTemplateAsync('namedBookmarksManager', {
        bookmarks,
        maxBookmarks: MAX_NAMED_BOOKMARKS,
        sortAscending: namedBookmarksSortAscending,
    });
}

async function refreshNamedBookmarksPopup() {
    if (!currentNamedBookmarksPopup || !currentNamedBookmarksPopup.dlg.hasAttribute('open')) {
        return;
    }

    const content = await renderNamedBookmarksManager();
    if (!content) {
        return;
    }

    currentNamedBookmarksPopup.content.innerHTML = content;
    currentNamedBookmarksPopup.dlg.classList.add('wide_dialogue_popup', 'large_dialogue_popup', 'vertical_scrolling_dialogue_popup');
    currentNamedBookmarksPopup.content.style.overflowY = 'auto';
}

async function showNamedBookmarksPopup() {
    if (!hasActiveChatContext()) {
        toastr.info(translate('No character selected.'), translate('Bookmarks'));
        return;
    }

    if (currentNamedBookmarksPopup?.dlg?.hasAttribute('open')) {
        await refreshNamedBookmarksPopup();
        return;
    }

    const content = await renderNamedBookmarksManager();
    if (!content) {
        return;
    }

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: t`Close`,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        customButtons: [{
            text: t`Refresh`,
            classes: ['menu_button_icon'],
            action: () => refreshNamedBookmarksPopup(),
        }],
        onClose: () => {
            currentNamedBookmarksPopup = null;
            currentNamedBookmarks = [];
        },
    });

    currentNamedBookmarksPopup = popup;
    popup.content.addEventListener('click', onNamedBookmarksPopupClick);
    await popup.show();
}

async function showNamedBookmarkEditorPopup({ header, messageNum = '', title = '', okButton = 'Save' } = {}) {
    const content = await renderTemplateAsync('namedBookmarkEditor', {
        header,
        messageNum,
        title,
    });
    if (!content) {
        return null;
    }

    let editorValue = null;
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton,
        cancelButton: t`Cancel`,
        onOpen: (popup) => {
            popup.dlg.querySelector('#named_bookmark_title')?.focus();
        },
        onClosing: (popup) => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            const popupDialog = $(popup.dlg);
            const nextMessageNum = Number(popupDialog.find('#named_bookmark_message').val());
            const nextTitle = String(popupDialog.find('#named_bookmark_title').val() ?? '').trim();

            if (!Number.isInteger(nextMessageNum) || nextMessageNum < 0) {
                toastr.error(translate('Invalid message number'), translate('Bookmarks'));
                return false;
            }

            if (nextMessageNum >= getTotalChatMessages()) {
                toastr.error(translate('Message number does not exist'), translate('Bookmarks'));
                return false;
            }

            if (!nextTitle) {
                toastr.error(translate('Title is required'), translate('Bookmarks'));
                return false;
            }

            editorValue = {
                messageNum: nextMessageNum,
                title: nextTitle,
            };
            return true;
        },
    });

    const result = await popup.show();
    return result === POPUP_RESULT.AFFIRMATIVE ? editorValue : null;
}

async function createNamedBookmark(messageNum, title) {
    if (!hasActiveChatContext()) {
        return { success: false, error: 'No character selected.' };
    }

    if (!chat.length) {
        return { success: false, error: 'No messages available to bookmark.' };
    }

    if (!Number.isInteger(messageNum) || messageNum < 0) {
        return { success: false, error: 'Invalid message number.' };
    }

    if (messageNum >= getTotalChatMessages()) {
        return { success: false, error: 'Message number does not exist.' };
    }

    const normalizedTitle = String(title ?? '').trim();
    if (!normalizedTitle) {
        return { success: false, error: 'Title is required.' };
    }

    const bookmarks = getNamedBookmarks();
    if (bookmarks.some(bookmark => bookmark.messageNum === messageNum && bookmark.title === normalizedTitle)) {
        return { success: false, error: 'An identical bookmark already exists.' };
    }

    if (bookmarks.length >= MAX_NAMED_BOOKMARKS) {
        return { success: false, error: `Maximum ${MAX_NAMED_BOOKMARKS} bookmarks reached.` };
    }

    const bookmark = { messageNum, title: normalizedTitle };
    setNamedBookmarks([...bookmarks, bookmark]);

    return { success: true, bookmark };
}

async function updateNamedBookmark(originalMessageNum, originalTitle, nextMessageNum, nextTitle) {
    const bookmarks = getNamedBookmarks();
    const bookmarkIndex = bookmarks.findIndex(bookmark => bookmark.messageNum === originalMessageNum && bookmark.title === originalTitle);
    if (bookmarkIndex === -1) {
        return { success: false, error: 'Bookmark not found.' };
    }

    if (!Number.isInteger(nextMessageNum) || nextMessageNum < 0) {
        return { success: false, error: 'Invalid message number.' };
    }

    if (nextMessageNum >= getTotalChatMessages()) {
        return { success: false, error: 'Message number does not exist.' };
    }

    const normalizedTitle = String(nextTitle ?? '').trim();
    if (!normalizedTitle) {
        return { success: false, error: 'Title is required.' };
    }

    const duplicateIndex = bookmarks.findIndex((bookmark, index) =>
        index !== bookmarkIndex
        && bookmark.messageNum === nextMessageNum
        && bookmark.title === normalizedTitle,
    );
    if (duplicateIndex !== -1) {
        return { success: false, error: 'An identical bookmark already exists.' };
    }

    bookmarks[bookmarkIndex] = {
        messageNum: nextMessageNum,
        title: normalizedTitle,
    };
    setNamedBookmarks(bookmarks);

    return { success: true };
}

async function deleteNamedBookmark(messageNum, title) {
    const bookmarks = getNamedBookmarks();
    const bookmarkIndex = bookmarks.findIndex(bookmark => bookmark.messageNum === messageNum && bookmark.title === title);
    if (bookmarkIndex === -1) {
        return { success: false, error: 'Bookmark not found.' };
    }

    bookmarks.splice(bookmarkIndex, 1);
    setNamedBookmarks(bookmarks);

    return { success: true };
}

async function navigateToNamedBookmark(messageNum) {
    if (!Number.isInteger(messageNum) || messageNum < 0 || messageNum >= getTotalChatMessages()) {
        toastr.error(t`Bookmark points to deleted message ${messageNum}`, translate('Bookmarks'));
        return false;
    }

    const popup = openChatPopoutWindow({ focusMessageId: messageNum });
    return Boolean(popup);
}

async function promptCreateNamedBookmark(messageNum = chat.length - 1) {
    if (!chat.length) {
        toastr.error(translate('No messages available to bookmark.'), translate('Bookmarks'));
        return null;
    }

    const bookmark = await showNamedBookmarkEditorPopup({
        header: t`Create Bookmark`,
        messageNum,
        okButton: t`Create`,
    });
    if (!bookmark) {
        return null;
    }

    const result = await createNamedBookmark(bookmark.messageNum, bookmark.title);
    if (!result.success) {
        toastr.error(result.error, translate('Bookmarks'));
        return null;
    }

    await refreshNamedBookmarksPopup();
    toastr.success(t`Bookmark "${result.bookmark.title}" created`, translate('Bookmarks'));
    return result.bookmark;
}

async function promptEditNamedBookmark(index) {
    const bookmark = currentNamedBookmarks[index];
    if (!bookmark) {
        toastr.error(translate('Bookmark not found.'), translate('Bookmarks'));
        return;
    }

    const nextBookmark = await showNamedBookmarkEditorPopup({
        header: t`Edit Bookmark`,
        messageNum: bookmark.messageNum,
        title: bookmark.title,
        okButton: t`Save`,
    });
    if (!nextBookmark) {
        return;
    }

    const result = await updateNamedBookmark(bookmark.messageNum, bookmark.title, nextBookmark.messageNum, nextBookmark.title);
    if (!result.success) {
        toastr.error(result.error, translate('Bookmarks'));
        return;
    }

    await refreshNamedBookmarksPopup();
    toastr.success(t`Bookmark "${nextBookmark.title}" updated`, translate('Bookmarks'));
}

async function promptDeleteNamedBookmark(index) {
    const bookmark = currentNamedBookmarks[index];
    if (!bookmark) {
        toastr.error(translate('Bookmark not found.'), translate('Bookmarks'));
        return;
    }

    const confirmation = await Popup.show.confirm(t`Delete Bookmark`, t`Delete bookmark "${bookmark.messageNum} - ${bookmark.title}"?`);
    if (!confirmation) {
        return;
    }

    const result = await deleteNamedBookmark(bookmark.messageNum, bookmark.title);
    if (!result.success) {
        toastr.error(result.error, translate('Bookmarks'));
        return;
    }

    await refreshNamedBookmarksPopup();
    toastr.success(t`Bookmark "${bookmark.title}" deleted`, translate('Bookmarks'));
}

async function onNamedBookmarksPopupClick(event) {
    if (!(event.target instanceof Element)) {
        return;
    }

    const popoutButton = event.target.closest('#named-bookmarks-popout');
    if (popoutButton) {
        event.preventDefault();
        openChatPopoutWindow();
        return;
    }

    const sortButton = event.target.closest('#named-bookmarks-sort-toggle');
    if (sortButton) {
        event.preventDefault();
        namedBookmarksSortAscending = !namedBookmarksSortAscending;
        await refreshNamedBookmarksPopup();
        return;
    }

    const createButton = event.target.closest('#named-bookmarks-create');
    if (createButton) {
        event.preventDefault();
        await promptCreateNamedBookmark();
        return;
    }

    const editButton = event.target.closest('.named-bookmark-edit');
    if (editButton instanceof HTMLElement) {
        event.preventDefault();
        await promptEditNamedBookmark(Number(editButton.dataset.index));
        return;
    }

    const deleteButton = event.target.closest('.named-bookmark-delete');
    if (deleteButton instanceof HTMLElement) {
        event.preventDefault();
        await promptDeleteNamedBookmark(Number(deleteButton.dataset.index));
        return;
    }

    const bookmarkBody = event.target.closest('.named-bookmark-main');
    if (bookmarkBody instanceof HTMLElement) {
        event.preventDefault();
        const bookmark = currentNamedBookmarks[Number(bookmarkBody.dataset.index)];
        if (bookmark) {
            await navigateToNamedBookmark(bookmark.messageNum);
        }
    }
}

/**
 * Gets the names of existing chats for the current character or group.
 * @returns {Promise<string[]>} - Returns a promise that resolves to an array of existing chat names.
 */
async function getExistingChatNames() {
    if (selected_group) {
        const group = groups.find(x => x.id == selected_group);
        if (group && Array.isArray(group.chats)) {
            return [...group.chats];
        }

        return [];
    }

    if (this_chid === undefined) {
        return [];
    }

    const character = characters[this_chid];
    if (!character) {
        return [];
    }

    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ avatar_url: character.avatar, simple: true }),
    });

    if (response.ok) {
        const data = await response.json();
        const chats = Object.values(data).map(x => x.file_name.replace(/\.(jsonl|sqlite)$/i, ''));
        return [...chats];
    }

    return [];
}

async function getBookmarkName({ isReplace = false, forceName = null } = {}) {
    const chatNames = await getExistingChatNames();

    const body = await renderTemplateAsync('createCheckpoint', { isReplace: isReplace });
    let name = forceName ?? await Popup.show.input(t`Create Checkpoint`, body);
    // Special handling for confirmed empty input (=> auto-generate name)
    if (name === '') {
        for (let i = chatNames.length; i < 1000; i++) {
            name = bookmarkNameToken + i;
            if (!chatNames.includes(name)) {
                break;
            }
        }
    }
    if (!name) {
        return null;
    }

    return `${name} - ${humanizedDateTime()}`;
}

function getMainChatName() {
    if (chat_metadata) {
        if (chat_metadata['main_chat']) {
            return chat_metadata['main_chat'];
        }
        // groups didn't support bookmarks before chat metadata was introduced
        else if (selected_group) {
            return null;
        }
        else if (characters[this_chid].chat && characters[this_chid].chat.includes(bookmarkNameToken)) {
            const tokenIndex = characters[this_chid].chat.lastIndexOf(bookmarkNameToken);
            chat_metadata['main_chat'] = characters[this_chid].chat.substring(0, tokenIndex).trim();
            return chat_metadata['main_chat'];
        }
    }
    return null;
}

export function showBookmarksButtons() {
    try {
        if (selected_group) {
            $('#option_convert_to_group').hide();
        } else {
            $('#option_convert_to_group').show();
        }

        if (chat_metadata['main_chat']) {
            // In bookmark chat
            $('#option_back_to_main').show();
            $('#option_new_bookmark').show();
        } else if (!selected_group && !characters[this_chid].chat) {
            // No chat recorded on character
            $('#option_back_to_main').hide();
            $('#option_new_bookmark').hide();
        } else {
            // In main chat
            $('#option_back_to_main').hide();
            $('#option_new_bookmark').show();
        }
    }
    catch {
        $('#option_back_to_main').hide();
        $('#option_new_bookmark').hide();
        $('#option_convert_to_group').hide();
    }
}

async function saveBookmarkMenu() {
    if (!chat.length) {
        toastr.warning(translate('The chat is empty.'), translate('Checkpoint creation failed'));
        return;
    }

    return await createNewBookmark(chat.length - 1);
}

// Export is used by Timelines extension. Do not remove.
export async function createBranch(mesId, { swipeId = null } = {}) {
    if (hasActiveMessageEditSession()) {
        toastr.warning(t`Finish or cancel the current edit before creating a branch.`);
        return;
    }

    if (!chat.length) {
        toastr.warning(translate('The chat is empty.'), translate('Branch creation failed'));
        return;
    }

    if (mesId < 0 || mesId >= getTotalChatMessages()) {
        toastr.warning(translate('Invalid message ID.'), translate('Branch creation failed'));
        return;
    }

    const selectedSwipeId = swipeId === null ? null : Number(swipeId);
    if (selectedSwipeId !== null && !Number.isInteger(selectedSwipeId)) {
        toastr.warning(translate('Invalid swipe ID.'), translate('Branch creation failed'));
        return;
    }

    if (isHistoricalChatMessage(mesId)) {
        await jumpToMessageWindow(mesId, 1);
        if (!isChatMessageLoaded(mesId)) {
            return null;
        }
    }

    const lastMes = chat[mesId];
    if (selectedSwipeId !== null && (!Array.isArray(lastMes?.swipes) || selectedSwipeId < 0 || selectedSwipeId >= lastMes.swipes.length)) {
        toastr.warning(translate('Invalid swipe ID.'), translate('Branch creation failed'));
        return;
    }

    const copyChoice = await chooseStmbChatCopyMode('branch');
    if (!copyChoice) return null;

    const mainChat = selected_group ? groups?.find(x => x.id == selected_group)?.chat_id : characters[this_chid].chat;
    const newMetadata = { main_chat: mainChat };
    let name = `Branch #${mesId} - ${humanizedDateTime()}`;

    // append to branches list if it exists
    // otherwise create it
    if (typeof lastMes.extra !== 'object') {
        lastMes.extra = {};
    }
    if (typeof lastMes.extra['branches'] !== 'object') {
        lastMes.extra['branches'] = [];
    }
    lastMes.extra['branches'].push(name);
    const result = await runBookmarkChatCopy({
        name,
        mesId,
        metadata: newMetadata,
        kind: 'branch',
        copyMemoryBooks: copyChoice.copyMemoryBooks,
        swipeId: selectedSwipeId,
    });
    if (!result?.ok) {
        lastMes.extra.branches = lastMes.extra.branches.filter(branchName => branchName !== name);
        await saveChatConditional();
        toastr.warning(translate('Could not create the branch chat.'), translate('Branch creation failed'));
        return null;
    }
    return name;
}

/**
 * Creates a new bookmark for a message.
 *
 * @param {number} mesId - The ID of the message.
 * @param {Object} [options={}] - Optional parameters.
 * @param {string?} [options.forceName=null] - The name to force for the bookmark.
 * @returns {Promise<string?>} - A promise that resolves to the bookmark name when the bookmark is created.
 */
export async function createNewBookmark(mesId, { forceName = null } = {}) {
    if (this_chid === undefined && !selected_group) {
        toastr.info(translate('No character selected.'), translate('Create Checkpoint'));
        return null;
    }
    if (!chat.length) {
        toastr.warning(translate('The chat is empty.'), translate('Create Checkpoint'));
        return null;
    }
    if (isHistoricalChatMessage(mesId)) {
        await jumpToMessageWindow(mesId, 1);
        if (!isChatMessageLoaded(mesId)) {
            return null;
        }
    }
    if (!chat[mesId]) {
        toastr.warning(translate('Invalid message ID.'), translate('Create Checkpoint'));
        return null;
    }

    const lastMes = chat[mesId];

    if (typeof lastMes.extra !== 'object') {
        lastMes.extra = {};
    }

    const isReplace = lastMes.extra.bookmark_link;

    let name = await getBookmarkName({ isReplace: isReplace, forceName: forceName });
    if (!name) {
        return null;
    }

    const copyChoice = await chooseStmbChatCopyMode('checkpoint');
    if (!copyChoice) return null;

    const mainChat = selected_group ? groups?.find(x => x.id == selected_group)?.chat_id : characters[this_chid].chat;
    const newMetadata = { main_chat: mainChat };
    const previousBookmarkLink = lastMes.extra.bookmark_link;
    lastMes.extra['bookmark_link'] = name;
    const result = await runBookmarkChatCopy({
        name,
        mesId,
        metadata: newMetadata,
        kind: 'checkpoint',
        copyMemoryBooks: copyChoice.copyMemoryBooks,
    });
    if (!result?.ok) {
        if (previousBookmarkLink) lastMes.extra.bookmark_link = previousBookmarkLink;
        else delete lastMes.extra.bookmark_link;
        await saveChatConditional();
        toastr.warning(translate('Could not create the checkpoint chat.'), translate('Checkpoint creation failed'));
        return null;
    }

    await saveItemizedPrompts(name);

    const mes = $(`.mes[mesid="${mesId}"]`);
    updateBookmarkDisplay(mes, name);

    await eventSource.emit(event_types.CHECKPOINT_CREATED, { mesId, fileName: name });
    toastr.success(translate('Click the flag icon next to the message to open the checkpoint chat.'), translate('Create Checkpoint'), { timeOut: 10000 });
    return name;
}


/**
 * Updates the display of the bookmark on a chat message.
 * @param {JQuery<HTMLElement>} mes - The message element
 * @param {string?} [newBookmarkLink=null] - The new bookmark link (optional)
 */
export function updateBookmarkDisplay(mes, newBookmarkLink = null) {
    newBookmarkLink && mes.attr('bookmark_link', newBookmarkLink);
    const bookmarkFlag = mes.find('.mes_bookmark');
    bookmarkFlag.attr('title', t`Checkpoint\n${mes.attr('bookmark_link')}\n\n${bookmarkFlag.data('tooltip')}`);
}

async function backToMainChat() {
    const mainChatName = getMainChatName();
    const allChats = await getExistingChatNames();

    if (allChats.includes(mainChatName)) {
        if (selected_group) {
            await openGroupChat(selected_group, mainChatName);
        } else {
            await openCharacterChat(mainChatName);
        }
        return mainChatName;
    }

    return null;
}

export async function convertSoloToGroupChat() {
    if (selected_group) {
        console.log('Already in group. No need for conversion');
        return;
    }

    if (this_chid === undefined) {
        console.log('Need to have a character selected');
        return;
    }

    const confirm = await Popup.show.confirm(t`Convert to group chat`, t`Are you sure you want to convert this chat to a group chat?` + '<br />' + t`This cannot be reverted.`);
    if (!confirm) {
        return;
    }

    const saveResult = await saveChatConditional();
    if (saveResult !== CHAT_SAVE_RESULT.SAVED) {
        toastr.warning(t`Save the current chat before converting it to a group chat.`, t`Convert to group chat`);
        return;
    }

    const character = characters[this_chid];
    const sourceChatId = getCurrentChatId();
    if (!sourceChatId) {
        toastr.error(t`Current chat could not be resolved.`, t`Convert to group chat`);
        return;
    }

    // Populate group required fields
    const name = getUniqueName(`Group: ${character.name}`, y => groups.findIndex(x => x.name === y) !== -1);
    const avatar = getThumbnailUrl('avatar', character.avatar);
    const chatName = humanizedDateTime();
    const chats = [chatName];
    const members = [character.avatar];
    const favChecked = character.fav || character.fav == 'true';
    /** @type {any} */
    const metadata = Object.assign({}, chat_metadata);
    delete metadata.main_chat;

    const createGroupResponse = await fetch('/api/groups/create', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            name: name,
            members: members,
            avatar_url: avatar,
            allow_self_responses: false,
            activation_strategy: group_activation_strategy.NATURAL,
            disabled_members: [],
            fav: favChecked,
            chat_id: chatName,
            chats: chats,
            hideMutedSprites: false,
            generation_mode: group_generation_mode.SWAP,
            auto_mode_delay: DEFAULT_AUTO_MODE_DELAY,
        }),
    });

    if (!createGroupResponse.ok) {
        console.error('Group creation unsuccessful');
        return;
    }

    const group = await createGroupResponse.json();

    const createChatResponse = await fetch('/api/chats/group/create-from-direct', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            id: chatName,
            avatar_url: character.avatar,
            file_name: sourceChatId,
            character_name: character.name,
            chat_metadata: metadata,
        }),
    });

    if (!createChatResponse.ok) {
        console.error('Group chat creation unsuccessful');
        let rollbackOk = false;
        try {
            const rollbackResponse = await fetch('/api/groups/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: group.id }),
            });
            rollbackOk = rollbackResponse.ok;
        } catch (error) {
            console.error('Failed to roll back group created during solo chat conversion', error);
        }

        if (!rollbackOk) {
            console.error('Failed to roll back group created during solo chat conversion', { groupId: group.id });
            toastr.error(t`Group chat creation failed. The empty group could not be removed automatically.`, t`Convert to group chat`);
        } else {
            toastr.error(t`Group chat creation failed. The empty group was removed.`, t`Convert to group chat`);
        }
        return;
    }

    // Convert tags list and assign to group
    createTagMapFromList('#tagList', group.id);

    // Update chars list
    await getCharacters();

    // Click on the freshly selected group to open it
    await openGroupById(group.id);

    toastr.success(t`The chat has been successfully converted!`);
}

/**
 * Creates a new branch from the message with the given ID
 * @param {number} mesId Message ID
 * @param {{swipeId?: number|null}} [options={}] Branch options
 * @returns {Promise<string?>} Branch file name
 */
export async function branchChat(mesId, { swipeId = null } = {}) {
    if (this_chid === undefined && !selected_group) {
        toastr.info(translate('No character selected.'), translate('Create Branch'));
        return null;
    }

    const fileName = await createBranch(mesId, { swipeId });
    if (!fileName) {
        return null;
    }
    await eventSource.emit(event_types.BRANCH_CREATED, { mesId, fileName });
    await saveItemizedPrompts(fileName);

    if (selected_group) {
        await openGroupChat(selected_group, fileName);
    } else {
        await openCharacterChat(fileName);
    }

    return fileName;
}

function registerBookmarksSlashCommands() {
    /**
     * Validates a message ID.
     *
     * @param {number} mesId - The message ID to validate.
     * @param {string} context - The context of the slash command. Will be used as the title of any toasts.
     * @param {Object} [options={}] - Optional validation parameters.
     * @param {boolean} [options.requireLoaded=true] - Whether the message must already be loaded in chat.
     * @returns {boolean} - Returns true if the message ID is valid, otherwise false.
     */
    function validateMessageId(mesId, context, { requireLoaded = true } = {}) {
        if (!Number.isInteger(mesId)) {
            toastr.warning(translate('Invalid message ID was provided'), context);
            return false;
        }
        if (mesId < 0 || mesId >= getTotalChatMessages()) {
            toastr.warning(t`Message for id ${mesId} not found`, context);
            return false;
        }
        if (!requireLoaded) {
            return true;
        }
        if (!chat[mesId]) {
            toastr.warning(t`Message for id ${mesId} not found`, context);
            return false;
        }
        return true;
    }

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'branch-create',
        returns: 'Name of the new branch',
        callback: async (args, text) => {
            const mesId = Number(args.mesId ?? text ?? getLastMessageId());
            if (!validateMessageId(mesId, 'Create Branch', { requireLoaded: false })) return '';

            const branchName = await branchChat(mesId);
            return branchName ?? '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message ID',
                typeList: [ARGUMENT_TYPE.NUMBER],
                enumProvider: commonEnumProviders.messages(),
            }),
        ],
        helpString: `
        <div data-i18n="Create a new branch from the selected message. If no message id is provided, will use the last message.">
            Create a new branch from the selected message. If no message id is provided, will use the last message.
        </div>
        <div>
            Creating a branch will automatically choose a name for the branch.<br />
            After creating the branch, the branch chat will be automatically opened.
        </div>
        <div>
            Use Checkpoints and <code>/checkpoint-create</code> instead if you do not want to jump to the new chat.
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'bookmarkset',
        callback: async (_, text) => {
            const args = String(text ?? '').trim().split(/\s+/);

            if (args.length < 2) {
                toastr.error(translate('Usage: /bookmarkset <message_number> <title>'), translate('Bookmarks'));
                return '';
            }

            const messageNum = Number(args.shift());
            if (!validateMessageId(messageNum, 'Bookmarks', { requireLoaded: false })) return '';

            const title = args.join(' ').trim();
            const result = await createNamedBookmark(messageNum, title);
            if (!result.success) {
                toastr.error(result.error, translate('Bookmarks'));
                return '';
            }

            toastr.success(t`Bookmark "${result.bookmark.title}" created`, translate('Bookmarks'));
            await refreshNamedBookmarksPopup();
            return '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'message number and title',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: `
        <div data-i18n="Create a named bookmark for a specific message.">
            Create a named bookmark for a specific message.
        </div>
        <div>
            <strong data-i18n="Example:">Example:</strong> <pre><code>/bookmarkset 42 Important reveal</code></pre>
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'bookmarklist',
        callback: async () => {
            await showNamedBookmarksPopup();
            return '';
        },
        helpString: `
        <div data-i18n="Open the bookmarks manager for the current chat.">
            Open the bookmarks manager for the current chat.
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'bookmarkgo',
        callback: async (_, text) => {
            const query = String(text ?? '').trim();
            if (!query) {
                toastr.error(translate('Usage: /bookmarkgo <title_or_message_number>'), translate('Bookmarks'));
                return '';
            }

            const bookmarks = getNamedBookmarks();
            if (!bookmarks.length) {
                toastr.error(translate('No bookmarks found.'), translate('Bookmarks'));
                return '';
            }

            let bookmark = null;
            const messageNum = Number(query);
            if (Number.isInteger(messageNum)) {
                bookmark = bookmarks.find(entry => entry.messageNum === messageNum) ?? null;
            }

            if (!bookmark) {
                const normalizedQuery = query.toLowerCase();
                bookmark = bookmarks.find(entry => entry.title.toLowerCase().includes(normalizedQuery)) ?? null;
            }

            if (!bookmark) {
                toastr.error(t`Bookmark not found: ${query}`, translate('Bookmarks'));
                return '';
            }

            await navigateToNamedBookmark(bookmark.messageNum);
            return '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'bookmark title or message number',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: `
        <div data-i18n="Jump to a bookmark by message number or title match.">
            Jump to a bookmark by message number or title match.
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'bookmark-import',
        callback: async (args, text) => {
            const json = String(text ?? '').trim();
            if (!json) {
                toastr.error(translate('Usage: /bookmark-import mode=overwrite [{"messageNum":5,"title":"Title"}]'), translate('Bookmarks'));
                return '';
            }

            try {
                const parsed = JSON.parse(json);
                if (!Array.isArray(parsed)) {
                    toastr.error(translate('Must be an array of bookmarks.'), translate('Bookmarks'));
                    return '';
                }

                const mode = String(args.mode ?? 'overwrite').toLowerCase() === 'merge' ? 'merge' : 'overwrite';
                const existingBookmarks = mode === 'merge' ? getNamedBookmarks() : [];
                const maxMessageCount = getTotalChatMessages();
                const normalizedBookmarks = parsed
                    .map(normalizeNamedBookmarkEntry)
                    .filter(bookmark => bookmark && bookmark.messageNum < maxMessageCount);
                const dedupedBookmarks = dedupeNamedBookmarks([...existingBookmarks, ...normalizedBookmarks]);
                const importedBookmarks = dedupedBookmarks
                    .slice(0, MAX_NAMED_BOOKMARKS);
                const invalidCount = parsed.length - normalizedBookmarks.length;
                const duplicateCount = existingBookmarks.length + normalizedBookmarks.length - dedupedBookmarks.length;
                const truncatedCount = dedupedBookmarks.length - importedBookmarks.length;

                setNamedBookmarks(importedBookmarks);

                if (invalidCount > 0) {
                    toastr.warning(t`${invalidCount} imported bookmark${invalidCount === 1 ? '' : 's'} ${invalidCount === 1 ? 'was' : 'were'} skipped due to invalid format.`, translate('Bookmarks'));
                }

                if (duplicateCount > 0) {
                    toastr.warning(t`${duplicateCount} duplicate bookmark${duplicateCount === 1 ? '' : 's'} ${duplicateCount === 1 ? 'was' : 'were'} skipped during import.`, translate('Bookmarks'));
                }

                if (truncatedCount > 0) {
                    toastr.warning(t`Truncated import by ${truncatedCount} bookmark${truncatedCount === 1 ? '' : 's'} due to the ${MAX_NAMED_BOOKMARKS} bookmark limit.`, translate('Bookmarks'));
                }

                const appliedCount = mode === 'merge'
                    ? Math.max(importedBookmarks.length - existingBookmarks.length, 0)
                    : importedBookmarks.length;
                toastr.success(t`${mode === 'merge' ? 'Merged' : 'Imported'} ${appliedCount} bookmark${appliedCount === 1 ? '' : 's'}.`, translate('Bookmarks'));
                await refreshNamedBookmarksPopup();
            } catch {
                toastr.error(translate('Invalid JSON format.'), translate('Bookmarks'));
            }

            return '';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'mode',
                description: 'Whether to overwrite existing bookmarks or merge imported bookmarks into them',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: ['overwrite', 'merge'],
                defaultValue: 'overwrite',
                forceEnum: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'JSON array of bookmarks',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: `
        <div data-i18n="Import named bookmarks from a JSON array.">
            Import named bookmarks from a JSON array.
        </div>
        <div>
            By default this replaces the current bookmark list. Use <code>mode=merge</code> to append imported bookmarks instead.
        </div>
        <div>
            Imports are capped at <code>${MAX_NAMED_BOOKMARKS}</code> bookmarks total, and invalid entries are skipped.
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'checkpoint-create',
        returns: 'Name of the new checkpoint',
        callback: async (args, text) => {
            const mesId = Number(args.mesId ?? getLastMessageId());
            if (!validateMessageId(mesId, 'Create Checkpoint', { requireLoaded: false })) return '';

            if (typeof text !== 'string') {
                toastr.warning(translate('Checkpoint name must be a string or empty'), translate('Create Checkpoint'));
                return '';
            }

            const checkPointName = await createNewBookmark(mesId, { forceName: text });
            return checkPointName ?? '';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'mesId',
                description: 'Message ID',
                typeList: [ARGUMENT_TYPE.NUMBER],
                enumProvider: commonEnumProviders.messages(),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Checkpoint name',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
        helpString: `
        <div>
            Create a new checkpoint for the selected message with the provided name. If no message id is provided, will use the last message.<br />
            Leave the checkpoint name empty to auto-generate one.
        </div>
        <div>
            A created checkpoint will be permanently linked with the message.<br />
            If a checkpoint already exists, the link to it will be overwritten.<br />
            After creating the checkpoint, the checkpoint chat can be opened with the checkpoint flag,
            using the <code>/go</code> command with the checkpoint name or the <code>/checkpoint-go</code> command on the message.
        </div>
        <div>
            Use Branches and <code>/branch-create</code> instead if you do want to jump to the new chat.
        </div>
        <div>
            <strong data-i18n="Example:">Example:</strong>
            <ul>
                <li>
                    <pre><code>/checkpoint-create mes={{lastCharMessage}} Checkpoint for char reply | /setvar key=rememberCheckpoint {{pipe}}</code></pre>
                    Will create a new checkpoint to the latest message of the current character, and save it as a local variable for future use.
                </li>
            </ul>
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'checkpoint-go',
        returns: 'Name of the checkpoint',
        callback: async (args, text) => {
            const mesId = Number(args.mesId ?? text ?? getLastMessageId());
            if (!validateMessageId(mesId, 'Open Checkpoint')) return '';

            const checkPointName = chat[mesId].extra?.bookmark_link;
            if (!checkPointName) {
                toastr.warning(translate('No checkpoint is linked to the selected message'), translate('Open Checkpoint'));
                return '';
            }

            if (selected_group) {
                await openGroupChat(selected_group, checkPointName);
            } else {
                await openCharacterChat(checkPointName);
            }

            return checkPointName;
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message ID',
                typeList: [ARGUMENT_TYPE.NUMBER],
                enumProvider: commonEnumProviders.messages(),
            }),
        ],
        helpString: `
        <div data-i18n="Open the checkpoint linked to the selected message. If no message id is provided, will use the last message.">
            Open the checkpoint linked to the selected message. If no message id is provided, will use the last message.
        </div>
        <div>
            Use <code>/checkpoint-get</code> if you want to make sure that the selected message has a checkpoint.
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'checkpoint-exit',
        returns: 'The name of the chat exited to. Returns an empty string if not in a checkpoint chat.',
        callback: async () => {
            const mainChat = await backToMainChat();
            return mainChat ?? '';
        },
        helpString: 'Exit the checkpoint chat.<br />If not in a checkpoint chat, returns empty string.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'checkpoint-parent',
        returns: 'Name of the parent chat for this checkpoint',
        callback: async () => {
            const mainChatName = getMainChatName();
            return mainChatName ?? '';
        },
        helpString: 'Get the name of the parent chat for this checkpoint.<br />If not in a checkpoint chat, returns empty string.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'checkpoint-get',
        returns: 'Name of the chat',
        callback: async (args, text) => {
            const mesId = Number(args.mesId ?? text ?? getLastMessageId());
            if (!validateMessageId(mesId, 'Get Checkpoint')) return '';

            const checkPointName = chat[mesId].extra?.bookmark_link;
            return checkPointName ?? '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message ID',
                typeList: [ARGUMENT_TYPE.NUMBER],
                enumProvider: commonEnumProviders.messages(),
            }),
        ],
        helpString: `
        <div>
            Get the name of the checkpoint linked to the selected message. If no message id is provided, will use the last message.<br />
            If no checkpoint is linked, the result will be empty.
        </div>`,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'checkpoint-list',
        returns: 'JSON array of all existing checkpoints in this chat, as an array',
        /** @param {{links?: string}} args @returns {Promise<string>} */
        callback: async (args, _) => {
            const result = Object.entries(chat)
                .filter(([_, message]) => message.extra?.bookmark_link)
                .map(([mesId, message]) => isTrueBoolean(args.links) ? message.extra.bookmark_link : Number(mesId));
            return JSON.stringify(result);
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'links',
                description: 'Get a list of all links / chat names of the checkpoints, instead of the message ids',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                enumList: commonEnumProviders.boolean('trueFalse')(),
                defaultValue: 'false',
            }),
        ],
        helpString: `
        <div data-i18n="List all existing checkpoints in this chat.">
            List all existing checkpoints in this chat.
        </div>
        <div>
            Returns a list of all message ids that have a checkpoint, or all checkpoint links if <code>links</code> is set to <code>true</code>.<br />
            The value will be a JSON array.
        </div>`,
    }));
}

export function initBookmarks() {
    $('#option_new_bookmark').on('click', saveBookmarkMenu);
    $(document).on('click', '#option_manage_bookmarks', showNamedBookmarksPopup);
    $('#option_back_to_main').on('click', backToMainChat);
    $('#option_convert_to_group').on('click', convertSoloToGroupChat);

    $(document).on('click', '.select_chat_block, .mes_bookmark', async function (e) {
        // If shift is held down, we are not following the bookmark, but creating a new one
        const mes = $(this).closest('.mes');
        if (e.shiftKey && mes.length) {
            const selectedMesId = mes.attr('mesid');
            await createNewBookmark(Number(selectedMesId));
            return;
        }

        if (handleManageChatsBulkRowClick(this, e)) {
            return;
        }

        const fileName = $(this).hasClass('mes_bookmark')
            ? $(this).closest('.mes').attr('bookmark_link')
            : $(this).attr('file_name').replace(/\.(jsonl|sqlite)$/i, '');

        if (!fileName) {
            return;
        }

        const rowType = $(this).attr('data-manage-chats-row-type') || $(this).closest('[data-manage-chats-row-type]').attr('data-manage-chats-row-type');
        const orphanKey = $(this).attr('data-orphan-key') || $(this).closest('[data-orphan-key]').attr('data-orphan-key');
        const ownerType = $(this).attr('data-owner-type') || $(this).closest('[data-owner-type]').attr('data-owner-type');
        const ownerId = $(this).attr('data-owner-id') || $(this).closest('[data-owner-id]').attr('data-owner-id');
        if (rowType === 'orphan-character' && orphanKey) {
            await openManageChatsOrphanCharacterChat(orphanKey, fileName);
        } else if (ownerType && ownerId) {
            await openManageChatsOwnerChat({ type: ownerType, id: ownerId }, fileName);
        } else if (selected_group) {
            await openGroupChat(selected_group, fileName);
        } else {
            await openCharacterChat(fileName);
        }

        $('#shadow_select_chat_popup').css('display', 'none');
    });

    $(document).on('click', '.mes_create_bookmark', async function () {
        const mesId = $(this).closest('.mes').attr('mesid');
        if (mesId !== undefined) {
            await createNewBookmark(Number(mesId));
        }
    });

    $(document).on('click', '.mes_add_bookmark', async function () {
        const mesId = $(this).closest('.mes').attr('mesid');
        if (mesId !== undefined) {
            await promptCreateNamedBookmark(Number(mesId));
        }
    });

    $(document).on('click', '.mes_create_branch', async function () {
        const mesId = $(this).closest('.mes').attr('mesid');
        if (mesId !== undefined) {
            await branchChat(Number(mesId));
        }
    });

    registerBookmarksSlashCommands();
}
