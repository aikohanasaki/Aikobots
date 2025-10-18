import {
    addOneMessage,
    characters,
    chat,
    deleteCharacterChatByName,
    displayVersion,
    doNewChat,
    event_types,
    eventSource,
    getCharacters,
    getCurrentChatId,
    getRequestHeaders,
    getSystemMessageByType,
    getThumbnailUrl,
    is_send_press,
    neutralCharacterName,
    newAssistantChat,
    openCharacterChat,
    printCharactersDebounced,
    renameGroupOrCharacterChat,
    saveSettingsDebounced,
    selectCharacterById,
    setActiveCharacter,
    setActiveGroup,
    system_avatar,
    system_message_types,
    this_chid,
    unshallowCharacter,
    updateRemoteChatName,
} from '../script.js';
import { deleteGroupChatByName, getGroupAvatar, groups, is_group_generating, openGroupById, openGroupChat } from './group-chats.js';
import { t } from './i18n.js';
import { callGenericPopup, POPUP_TYPE } from './popup.js';
import { getMessageTimeStamp } from './RossAscends-mods.js';
import { renderTemplateAsync } from './templates.js';
import { accountStorage } from './util/AccountStorage.js';
import { sortMoments, timestampToMoment } from './utils.js';

const assistantAvatarKey = 'assistant';
const defaultAssistantAvatar = 'default_Assistant.png';

const DEFAULT_DISPLAYED = 3;
const MAX_DISPLAYED = 15;

export function getPermanentAssistantAvatar() {
    const assistantAvatar = accountStorage.getItem(assistantAvatarKey);
    if (assistantAvatar === null) {
        return defaultAssistantAvatar;
    }

    const character = characters.find(x => x.avatar === assistantAvatar);
    if (character === undefined) {
        accountStorage.removeItem(assistantAvatarKey);
        return defaultAssistantAvatar;
    }

    return assistantAvatar;
}

/**
 * Opens a welcome screen if no chat is currently active.
 * @param {object} param Additional parameters
 * @param {boolean} [param.force] If true, forces clearing of the welcome screen.
 * @param {boolean} [param.expand] If true, expands the recent chats section.
 * @returns {Promise<void>}
 */
export async function openWelcomeScreen({ force = false, expand = false } = {}) {
    const currentChatId = getCurrentChatId();
    if (currentChatId !== undefined || (chat.length > 0 && !force)) {
        return;
    }

    const recentChats = await getRecentChats();
    const chatAfterFetch = getCurrentChatId();
    if (chatAfterFetch !== currentChatId) {
        console.debug('Chat changed while fetching recent chats.');
        return;
    }

    if (chatAfterFetch === undefined && force) {
        console.debug('Forcing welcome screen open.');
        chat.splice(0, chat.length);
        $('#chat').empty();
    }

    await sendWelcomePanel(recentChats, expand);
    await unshallowPermanentAssistant();
    sendAssistantMessage();
    sendWelcomePrompt();
}

/**
 * Makes sure the assistant character has all data loaded.
 * @returns {Promise<void>}
 */
async function unshallowPermanentAssistant() {
    const assistantAvatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === assistantAvatar);
    if (characterId === -1) {
        return;
    }

    await unshallowCharacter(String(characterId));
}

function sendAssistantMessage() {
    const currentAssistantAvatar = getPermanentAssistantAvatar();
    const character = characters.find(x => x.avatar === currentAssistantAvatar);
    const name = character ? character.name : neutralCharacterName;
    const avatar = character ? getThumbnailUrl('avatar', character.avatar) : system_avatar;

    const message = {
        name: name,
        force_avatar: avatar,
        mes: t`# 🎉 __**Welcome to Aikobots!**__ 🎉` + '\n\n' + t`We're glad you're here. If you ever need help, head to the #help-911 channel in our Discord server.`  + '\n\n' + t`**Now that you're here:**` + '\n' + t`1️⃣ Download the latest Aikobots preset ([right click HERE and choose "Save As"](presets/Aikobots.json))` + '\n' + t`2️⃣ Click :fa-sliders: in the top menu bar and click :fa-file-import: next to Chat Completion Presets to import Aikobots.json` + '\n' + t`3️⃣ Connect to an API (click :fa-plug: in the top menu bar)` + '\n' + t`4️⃣ Create a persona for yourself (click :fa-face-smile: in the top menu bar)` + '\n' + t`5️⃣ Choose a character to play with! (click :fa-address-card: in the top menu bar)`  + '\n\n' + '\n\n' + t`**If you can't decide who to play with:**` + '\n' + t`💘 Try the [Character Archetype Matching Quiz](https://www.aikobots.com/archetypes-quiz.html)` + '\n' + t`📇 Check out the [Character Roll Call](https://www.aikobots.com/rollcall.html) for compatibility quizzes` + '\n' + t`🐢 Talk to Carl (turtle holding a strawberry) and ask him for recommendations!` + '\n' + t`💬 Talk to Okia if you want to do some analysis!` + '\n\n' + '\n\n' + t`**For commands, be sure to take a look at:**` + `\n` + t`📜 [List of all Aikobots Commands](https://www.aikobots.com/commands.html)` + `\n` + t`🛰️ [LaDS-Specific Commands](https://www.aikobots.com/ladscommands.html)` + `\n` + t`🧠 [Memory Helpers](https://www.aikobots.com/cmd-memory.html) (not needed if you use the Create Memory function)` + '\n***\n' + t`💡 **PS:** Set any character as your welcome page assistant from their "More..." menu.`,
        is_system: false,
        is_user: false,
        send_date: getMessageTimeStamp(),
        extra: {
            type: system_message_types.ASSISTANT_MESSAGE,
        },
    };

    chat.push(message);
    addOneMessage(message, { scroll: false });
    postProcessAssistantIcons();
}
 
function postProcessAssistantIcons() {
    try {
        const chatElement = document.getElementById('chat');
        if (!chatElement || !chatElement.lastElementChild) return;
        // Only process the most recently inserted message (this assistant message)
        replaceIconTokensInElement(chatElement.lastElementChild);
    } catch (e) {
        console.warn('Icon token post-process failed:', e);
    }
}
 
function replaceIconTokensInElement(root) {
    const TOKEN_REGEX = /:fa-([a-z0-9-]+):/gi;
    // Collect matching text nodes first to avoid walker invalidation during replacement
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        const value = node.nodeValue || '';
        if (TOKEN_REGEX.test(value)) {
            textNodes.push(node);
        }
        TOKEN_REGEX.lastIndex = 0; // reset due to global regex
    }
 
    for (const textNode of textNodes) {
        const text = textNode.nodeValue || '';
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        TOKEN_REGEX.lastIndex = 0;
        while ((match = TOKEN_REGEX.exec(text)) !== null) {
            const before = text.slice(lastIndex, match.index);
            if (before) frag.appendChild(document.createTextNode(before));
            const iconName = match[1];
            frag.appendChild(createFaIcon(iconName));
            lastIndex = TOKEN_REGEX.lastIndex;
        }
        const after = text.slice(lastIndex);
        if (after) frag.appendChild(document.createTextNode(after));
        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(frag, textNode);
        }
    }
}
 
function createFaIcon(name) {
    const i = document.createElement('i');
    i.classList.add('fa-solid', `fa-${name}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
}
 
function sendWelcomePrompt() {
    const message = getSystemMessageByType(system_message_types.WELCOME_PROMPT);
    chat.push(message);
    addOneMessage(message, { scroll: false });
}

/**
 * Sends the welcome panel to the chat.
 * @param {RecentChat[]} chats List of recent chats
 * @param {boolean} [expand=false] If true, expands the recent chats section
 */
async function sendWelcomePanel(chats, expand = false) {
    try {
        const chatElement = document.getElementById('chat');
        const sendTextArea = document.getElementById('send_textarea');
        if (!chatElement) {
            console.error('Chat element not found');
            return;
        }
        const templateData = {
            chats,
            empty: !chats.length,
            version: displayVersion,
            more: chats.some(chat => chat.hidden),
        };
        const template = await renderTemplateAsync('welcomePanel', templateData);
        const fragment = document.createRange().createContextualFragment(template);
        fragment.querySelectorAll('.welcomePanel').forEach((root) => {
            const recentHiddenClass = 'recentHidden';
            const recentHiddenKey = 'WelcomePage_RecentChatsHidden';
            if (accountStorage.getItem(recentHiddenKey) === 'true') {
                root.classList.add(recentHiddenClass);
            }
            root.querySelectorAll('.showRecentChats').forEach((button) => {
                button.addEventListener('click', () => {
                    root.classList.remove(recentHiddenClass);
                    accountStorage.setItem(recentHiddenKey, 'false');
                });
            });
            root.querySelectorAll('.hideRecentChats').forEach((button) => {
                button.addEventListener('click', () => {
                    root.classList.add(recentHiddenClass);
                    accountStorage.setItem(recentHiddenKey, 'true');
                });
            });
        });
        fragment.querySelectorAll('.recentChat').forEach((item) => {
            item.addEventListener('click', () => {
                const avatarId = item.getAttribute('data-avatar');
                const groupId = item.getAttribute('data-group');
                const fileName = item.getAttribute('data-file');
                if (avatarId && fileName) {
                    void openRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void openRecentGroupChat(groupId, fileName);
                }
            });
        });
        const hiddenChats = fragment.querySelectorAll('.recentChat.hidden');
        fragment.querySelectorAll('button.showMoreChats').forEach((button) => {
            const showRecentChatsTitle = t`Show more recent chats`;
            const hideRecentChatsTitle = t`Show less recent chats`;

            button.setAttribute('title', showRecentChatsTitle);
            button.addEventListener('click', () => {
                const rotate = button.classList.contains('rotated');
                hiddenChats.forEach((chatItem) => {
                    chatItem.classList.toggle('hidden', rotate);
                });
                button.classList.toggle('rotated', !rotate);
                button.setAttribute('title', rotate ? showRecentChatsTitle : hideRecentChatsTitle);
            });
        });
        fragment.querySelectorAll('button.openTemporaryChat').forEach((button) => {
            button.addEventListener('click', async () => {
                await newAssistantChat({ temporary: true });
                if (sendTextArea instanceof HTMLTextAreaElement) {
                    sendTextArea.focus();
                }
            });
        });
        fragment.querySelectorAll('.recentChat.group').forEach((groupChat) => {
            const groupId = groupChat.getAttribute('data-group');
            const group = groups.find(x => x.id === groupId);
            if (group) {
                const avatar = groupChat.querySelector('.avatar');
                if (!avatar) {
                    return;
                }
                const groupAvatar = getGroupAvatar(group);
                $(avatar).replaceWith(groupAvatar);
            }
        });
        fragment.querySelectorAll('.recentChat .renameChat').forEach((renameButton) => {
            renameButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatItem = renameButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                if (avatarId && fileName) {
                    void renameRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void renameRecentGroupChat(groupId, fileName);
                }
            });
        });
        fragment.querySelectorAll('.recentChat .deleteChat').forEach((deleteButton) => {
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatItem = deleteButton.closest('.recentChat');
                if (!chatItem) {
                    return;
                }
                const avatarId = chatItem.getAttribute('data-avatar');
                const groupId = chatItem.getAttribute('data-group');
                const fileName = chatItem.getAttribute('data-file');
                if (avatarId && fileName) {
                    void deleteRecentCharacterChat(avatarId, fileName);
                }
                if (groupId && fileName) {
                    void deleteRecentGroupChat(groupId, fileName);
                }
            });
        });
        chatElement.append(fragment.firstChild);
        if (expand) {
            chatElement.querySelectorAll('button.showMoreChats').forEach((button) => {
                if (button instanceof HTMLButtonElement) {
                    button.click();
                }
            });
        }
    } catch (error) {
        console.error('Welcome screen error:', error);
    }
}

/**
 * Opens a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function openRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }

    try {
        await selectCharacterById(characterId);
        setActiveCharacter(avatarId);
        saveSettingsDebounced();
        const currentChatId = getCurrentChatId();
        if (currentChatId === fileName) {
            console.debug(`Chat ${fileName} is already open.`);
            return;
        }
        await openCharacterChat(fileName);
    } catch (error) {
        console.error('Error opening recent chat:', error);
        toastr.error(t`Failed to open recent chat. See console for details.`);
    }
}

/**
 * Opens a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function openRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }

    try {
        await openGroupById(groupId);
        setActiveGroup(groupId);
        saveSettingsDebounced();
        const currentChatId = getCurrentChatId();
        if (currentChatId === fileName) {
            console.debug(`Chat ${fileName} is already open.`);
            return;
        }
        await openGroupChat(groupId, fileName);
    } catch (error) {
        console.error('Error opening recent group chat:', error);
        toastr.error(t`Failed to open recent group chat. See console for details.`);
    }
}

/**
 * Renames a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function renameRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }
    try {
        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, fileName);
        if (!newName || typeof newName !== 'string' || newName === fileName) {
            console.log('No new name provided, aborting');
            return;
        }
        await renameGroupOrCharacterChat({
            characterId: String(characterId),
            oldFileName: fileName,
            newFileName: newName,
            loader: false,
        });
        await updateRemoteChatName(characterId, newName);
        await refreshWelcomeScreen();
        toastr.success(t`Chat renamed.`);
    } catch (error) {
        console.error('Error renaming recent character chat:', error);
        toastr.error(t`Failed to rename recent chat. See console for details.`);
    }
}

/**
 * Renames a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function renameRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }
    try {
        const popupText = await renderTemplateAsync('chatRename');
        const newName = await callGenericPopup(popupText, POPUP_TYPE.INPUT, fileName);
        if (!newName || newName === fileName) {
            console.log('No new name provided, aborting');
            return;
        }
        await renameGroupOrCharacterChat({
            groupId: String(groupId),
            oldFileName: fileName,
            newFileName: String(newName),
            loader: false,
        });
        await refreshWelcomeScreen();
        toastr.success(t`Group chat renamed.`);
    } catch (error) {
        console.error('Error renaming recent group chat:', error);
        toastr.error(t`Failed to rename recent group chat. See console for details.`);
    }
}

/**
 * Deletes a recent character chat.
 * @param {string} avatarId Avatar file name
 * @param {string} fileName Chat file name
 */
async function deleteRecentCharacterChat(avatarId, fileName) {
    const characterId = characters.findIndex(x => x.avatar === avatarId);
    if (characterId === -1) {
        console.error(`Character not found for avatar ID: ${avatarId}`);
        return;
    }
    try {
        const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            console.log('Deletion cancelled by user');
            return;
        }
        await deleteCharacterChatByName(String(characterId), fileName);
        await refreshWelcomeScreen();
        toastr.success(t`Chat deleted.`);
    } catch (error) {
        console.error('Error deleting recent character chat:', error);
        toastr.error(t`Failed to delete recent chat. See console for details.`);
    }
}

/**
 * Deletes a recent group chat.
 * @param {string} groupId Group ID
 * @param {string} fileName Chat file name
 */
async function deleteRecentGroupChat(groupId, fileName) {
    const group = groups.find(x => x.id === groupId);
    if (!group) {
        console.error(`Group not found for ID: ${groupId}`);
        return;
    }
    try {
        const confirm = await callGenericPopup(t`Delete the Chat File?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            console.log('Deletion cancelled by user');
            return;
        }
        await deleteGroupChatByName(groupId, fileName);
        await refreshWelcomeScreen();
        toastr.success(t`Group chat deleted.`);
    } catch (error) {
        console.error('Error deleting recent group chat:', error);
        toastr.error(t`Failed to delete recent group chat. See console for details.`);
    }
}

/**
 * Reopens the welcome screen and restores the scroll position.
 * @returns {Promise<void>}
 */
async function refreshWelcomeScreen() {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        console.error('Chat element not found');
        return;
    }

    const scrollTop = chatElement.scrollTop;
    const scrollHeight = chatElement.scrollHeight;
    const expand = chatElement.querySelectorAll('button.showMoreChats.rotated').length > 0;

    await openWelcomeScreen({ force: true, expand });

    // Restore scroll position
    chatElement.scrollTop = scrollTop + (chatElement.scrollHeight - scrollHeight);
}

/**
 * Gets the list of recent chats from the server.
 * @returns {Promise<RecentChat[]>} List of recent chats
 *
 * @typedef {object} RecentChat
 * @property {string} file_name Name of the chat file
 * @property {string} chat_name Name of the chat (without extension)
 * @property {string} file_size Size of the chat file
 * @property {number} chat_items Number of items in the chat
 * @property {string} mes Last message content
 * @property {string} last_mes Timestamp of the last message
 * @property {string} avatar Avatar URL
 * @property {string} char_thumbnail Thumbnail URL
 * @property {string} char_name Character or group name
 * @property {string} date_short Date in short format
 * @property {string} date_long Date in long format
 * @property {string} group Group ID (if applicable)
 * @property {boolean} is_group Indicates if the chat is a group chat
 * @property {boolean} hidden Chat will be hidden by default
 */
async function getRecentChats() {
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ max: MAX_DISPLAYED }),
    });

    if (!response.ok) {
        console.warn('Failed to fetch recent character chats');
        return [];
    }

    /** @type {RecentChat[]} */
    const data = await response.json();

    data.sort((a, b) => sortMoments(timestampToMoment(a.last_mes), timestampToMoment(b.last_mes)))
        .map(chat => ({ chat, character: characters.find(x => x.avatar === chat.avatar), group: groups.find(x => x.id === chat.group) }))
        .filter(t => t.character || t.group)
        .forEach(({ chat, character, group }, index) => {
            const chatTimestamp = timestampToMoment(chat.last_mes);
            chat.char_name = character?.name || group?.name || '';
            chat.date_short = chatTimestamp.format('l');
            chat.date_long = chatTimestamp.format('LL LT');
            chat.chat_name = chat.file_name.replace('.jsonl', '');
            chat.char_thumbnail = character ? getThumbnailUrl('avatar', character.avatar) : system_avatar;
            chat.is_group = !!group;
            chat.hidden = index >= DEFAULT_DISPLAYED;
            chat.avatar = chat.avatar || '';
            chat.group = chat.group || '';
        });

    return data;
}

export async function openPermanentAssistantChat({ tryCreate = true, created = false } = {}) {
    const avatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === avatar);
    if (characterId === -1) {
        if (!tryCreate) {
            console.error(`Character not found for avatar ID: ${avatar}. Cannot create.`);
            return;
        }

        try {
            console.log(`Character not found for avatar ID: ${avatar}. Creating new assistant.`);
            await createPermanentAssistant();
            return openPermanentAssistantChat({ tryCreate: false, created: true });
        }
        catch (error) {
            console.error('Error creating permanent assistant:', error);
            toastr.error(t`Failed to create ${neutralCharacterName}. See console for details.`);
            return;
        }
    }

    try {
        await selectCharacterById(characterId);
        if (!created) {
            await doNewChat({ deleteCurrentChat: false });
        }
        console.log(`Opened permanent assistant chat for ${neutralCharacterName}.`, getCurrentChatId());
    } catch (error) {
        console.error('Error opening permanent assistant chat:', error);
        toastr.error(t`Failed to open permanent assistant chat. See console for details.`);
    }
}

async function createPermanentAssistant() {
    if (is_group_generating || is_send_press) {
        throw new Error(t`Cannot create while generating.`);
    }

    const formData = new FormData();
    formData.append('ch_name', neutralCharacterName);
    formData.append('file_name', defaultAssistantAvatar.replace('.png', ''));
    formData.append('creator_notes', t`Automatically created character. Feel free to edit.`);

    try {
        const avatarResponse = await fetch(system_avatar);
        const avatarBlob = await avatarResponse.blob();
        formData.append('avatar', avatarBlob, defaultAssistantAvatar);
    } catch (error) {
        console.warn('Error fetching system avatar. Fallback image will be used.', error);
    }

    const fetchResult = await fetch('/api/characters/create', {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
        body: formData,
        cache: 'no-cache',
    });

    if (!fetchResult.ok) {
        throw new Error(t`Creation request did not succeed.`);
    }

    await getCharacters();
}

export async function openPermanentAssistantCard() {
    const avatar = getPermanentAssistantAvatar();
    const characterId = characters.findIndex(x => x.avatar === avatar);
    if (characterId === -1) {
        toastr.info(t`Assistant not found. Try sending a chat message.`);
        return;
    }

    await selectCharacterById(characterId);
}

/**
 * Assigns a character as the assistant.
 * @param {string?} characterId Character ID
 */
export function assignCharacterAsAssistant(characterId) {
    if (characterId === undefined) {
        return;
    }
    /** @type {import('./char-data.js').v1CharData} */
    const character = characters[characterId];
    if (!character) {
        return;
    }

    const currentAssistantAvatar = getPermanentAssistantAvatar();
    if (currentAssistantAvatar === character.avatar) {
        if (character.avatar === defaultAssistantAvatar) {
            toastr.info(t`${character.name} is a system assistant. Choose another character.`);
            return;
        }

        toastr.info(t`${character.name} is no longer your assistant.`);
        accountStorage.removeItem(assistantAvatarKey);
        return;
    }

    accountStorage.setItem(assistantAvatarKey, character.avatar);
    printCharactersDebounced();
    toastr.success(t`Set ${character.name} as your assistant.`);
}

export function initWelcomeScreen() {
    const events = [event_types.CHAT_CHANGED, event_types.APP_READY];
    for (const event of events) {
        eventSource.makeFirst(event, openWelcomeScreen);
    }

    eventSource.on(event_types.CHARACTER_MANAGEMENT_DROPDOWN, (target) => {
        if (target !== 'set_as_assistant') {
            return;
        }
        assignCharacterAsAssistant(this_chid);
    });

    eventSource.on(event_types.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        if (oldAvatar === getPermanentAssistantAvatar()) {
            accountStorage.setItem(assistantAvatarKey, newAvatar);
        }
    });
}
