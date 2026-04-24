import { displayPastChats, getRequestHeaders, importCharacterChat } from '../script.js';
import { importGroupChat } from './group-chats.js';
import { t } from './i18n.js';
import { callGenericPopup, POPUP_TYPE, Popup } from './popup.js';
import { sortMoments, timestampToMoment, getFileExtension } from './utils.js';

class ManageChatsBackupsBrowser {
    /** @type {HTMLButtonElement} */
    #buttonElement;
    /** @type {HTMLElement} */
    #buttonChevronIcon;
    /** @type {HTMLDivElement} */
    #backupsListElement;
    /** @type {AbortController} */
    #loadingAbortController = null;
    /** @type {boolean} */
    #isOpen = false;
    /** @type {string} */
    #ownerKey = '';
    /** @type {{ ownerContext: object, avatarUrl: string, characterName: string, groupId: string | null, isGroup: boolean } | null} */
    #ownerDetails = null;

    #normalizeOwnerDetails(ownerDetails) {
        if (!ownerDetails?.ownerContext) {
            return null;
        }

        return {
            ownerContext: ownerDetails.ownerContext,
            avatarUrl: ownerDetails.avatarUrl || '',
            characterName: ownerDetails.characterName || '',
            groupId: ownerDetails.groupId ? String(ownerDetails.groupId) : null,
            isGroup: Boolean(ownerDetails.isGroup),
        };
    }

    #getOwnerKey(ownerDetails) {
        if (!ownerDetails?.ownerContext) {
            return '';
        }

        return ownerDetails.isGroup
            ? String(ownerDetails.groupId || '').trim()
            : String(ownerDetails.avatarUrl || '').replace(/\.png$/i, '').trim();
    }

    #setVisible(visible) {
        if (this.#buttonElement) {
            this.#buttonElement.hidden = !visible;
        }

        if (this.#backupsListElement && !visible) {
            this.#backupsListElement.hidden = true;
        }
    }

    #setListContent(content) {
        if (!this.#backupsListElement) {
            return;
        }

        this.#backupsListElement.innerHTML = '';
        if (content instanceof Node) {
            this.#backupsListElement.appendChild(content);
        }
    }

    #renderInfoText(backup) {
        const timestamp = timestampToMoment(backup.last_mes).format('lll');
        const count = Number(backup.chat_items) || 0;
        const messageLabel = `${count} message${count === 1 ? '' : 's'}`;
        return `${timestamp} (${backup.file_size}, ${messageLabel})`;
    }

    #createStatusElement(text) {
        const element = document.createElement('div');
        element.classList.add('chatBackupsListStatus');
        element.textContent = text;
        return element;
    }

    async #downloadBackup(name) {
        const response = await fetch('/api/backups/chat/download', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            throw new Error(`Failed to download backup: ${response.status}`);
        }

        return response;
    }

    async viewBackup(name) {
        try {
            const response = await this.#downloadBackup(name);
            const fileText = await response.text();
            const parsedLines = [];

            for (const line of fileText.split('\n')) {
                if (!line.trim()) {
                    continue;
                }

                try {
                    const lineData = JSON.parse(line);
                    if (lineData?.mes !== undefined) {
                        parsedLines.push(lineData);
                    }
                } catch {
                    parsedLines.length = 0;
                    break;
                }
            }

            const textArea = document.createElement('textarea');
            textArea.classList.add('text_pole', 'monospace', 'textarea_compact', 'margin0', 'height100p');
            textArea.readOnly = true;
            textArea.value = parsedLines.length > 0
                ? parsedLines.map((lineData) => {
                    const sender = lineData.name || lineData.role || t`Unknown`;
                    const timestamp = lineData.send_date ? ` [${timestampToMoment(lineData.send_date).format('lll')}]` : '';
                    return `${sender}${timestamp}\n${lineData.mes ?? ''}`;
                }).join('\n\n\n')
                : fileText;

            await callGenericPopup(textArea, POPUP_TYPE.TEXT, '', {
                allowVerticalScrolling: true,
                large: true,
                wide: true,
            });
        } catch (error) {
            console.error('Failed to view chat backup:', error);
            toastr.error(t`Failed to open chat backup.`);
        }
    }

    async restoreBackup(name) {
        if (!this.#ownerDetails?.ownerContext) {
            return;
        }

        try {
            const ownerDetails = this.#ownerDetails;
            const response = await this.#downloadBackup(name);
            const blob = await response.blob();
            const file = new File([blob], name, { type: 'application/octet-stream' });
            const extension = getFileExtension(file);

            if (extension !== 'jsonl') {
                toastr.warning(t`Only JSONL chat backups can be restored.`);
                return;
            }

            const context = globalThis.SillyTavern?.getContext?.();
            const formData = new FormData();
            formData.set('file_type', extension);
            formData.set('avatar', file);
            formData.set('avatar_url', ownerDetails.avatarUrl || '');
            formData.set('user_name', context?.name1 || 'User');
            formData.set('character_name', ownerDetails.characterName || context?.name2 || '');

            const importedFileNames = ownerDetails.isGroup
                ? await importGroupChat(formData, { refresh: false, groupId: ownerDetails.groupId })
                : await importCharacterChat(formData, { refresh: false });

            if (importedFileNames.length === 0) {
                toastr.error(t`Failed to restore chat backup.`);
                return;
            }

            toastr.success(t`Successfully imported ${importedFileNames.length} chat(s).`);
            await displayPastChats(importedFileNames, ownerDetails.ownerContext);
        } catch (error) {
            console.error('Failed to restore chat backup:', error);
            toastr.error(t`Failed to restore chat backup.`);
        }
    }

    async deleteBackup(name) {
        const confirmed = await Popup.show.confirm(t`Delete backup?`, t`This will permanently delete the backup file. This cannot be undone.`);
        if (!confirmed) {
            return false;
        }

        try {
            const response = await fetch('/api/backups/chat/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ name }),
            });

            if (!response.ok) {
                throw new Error(`Failed to delete backup: ${response.status}`);
            }

            toastr.success(t`Backup deleted.`);
            return true;
        } catch (error) {
            console.error('Failed to delete chat backup:', error);
            toastr.error(t`Failed to delete chat backup.`);
            return false;
        }
    }

    async loadBackupsIntoList(signal) {
        if (!this.#backupsListElement || !this.#ownerKey) {
            return;
        }

        this.#setListContent(this.#createStatusElement(t`Loading backups...`));

        try {
            const response = await fetch('/api/backups/chat/list', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ owner_key: this.#ownerKey }),
                signal,
            });

            if (!response.ok) {
                throw new Error(`Failed to list backups: ${response.status}`);
            }

            const backups = await response.json();
            if (signal.aborted) {
                return;
            }

            this.#backupsListElement.innerHTML = '';

            const sortedBackups = Array.isArray(backups)
                ? backups.sort((a, b) => sortMoments(timestampToMoment(a.last_mes), timestampToMoment(b.last_mes)))
                : [];

            if (sortedBackups.length === 0) {
                this.#setListContent(this.#createStatusElement(t`No backups found for this chat owner.`));
                return;
            }

            for (const backup of sortedBackups) {
                const listItem = document.createElement('div');
                listItem.classList.add('chatBackupsListItem');

                const backupName = document.createElement('div');
                backupName.classList.add('chatBackupsListItemName');
                backupName.textContent = backup.file_name;

                const backupInfo = document.createElement('div');
                backupInfo.classList.add('chatBackupsListItemInfo');
                backupInfo.textContent = this.#renderInfoText(backup);

                const actionsList = document.createElement('div');
                actionsList.classList.add('chatBackupsListItemActions');

                const viewButton = document.createElement('div');
                viewButton.classList.add('right_menu_button', 'fa-solid', 'fa-eye');
                viewButton.title = t`View backup`;
                viewButton.addEventListener('click', async () => {
                    await this.viewBackup(backup.file_name);
                });

                const restoreButton = document.createElement('div');
                restoreButton.classList.add('right_menu_button', 'fa-solid', 'fa-rotate-left');
                restoreButton.title = t`Restore backup`;
                restoreButton.addEventListener('click', async () => {
                    await this.restoreBackup(backup.file_name);
                });

                const deleteButton = document.createElement('div');
                deleteButton.classList.add('right_menu_button', 'fa-solid', 'fa-trash');
                deleteButton.title = t`Delete backup`;
                deleteButton.addEventListener('click', async () => {
                    const deleted = await this.deleteBackup(backup.file_name);
                    if (!deleted) {
                        return;
                    }

                    listItem.remove();
                    if (!this.#backupsListElement?.children.length) {
                        this.#setListContent(this.#createStatusElement(t`No backups found for this chat owner.`));
                    }
                });

                actionsList.appendChild(viewButton);
                actionsList.appendChild(restoreButton);
                actionsList.appendChild(deleteButton);

                listItem.appendChild(backupName);
                listItem.appendChild(backupInfo);
                listItem.appendChild(actionsList);
                this.#backupsListElement.appendChild(listItem);
            }
        } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') {
                return;
            }

            console.error('Failed to load chat backups:', error);
            this.#setListContent(this.#createStatusElement(t`Could not load backups.`));
        }
    }

    closeBackups() {
        this.#isOpen = false;

        if (this.#buttonChevronIcon) {
            this.#buttonChevronIcon.classList.remove('fa-chevron-up');
            this.#buttonChevronIcon.classList.add('fa-chevron-down');
        }

        if (this.#backupsListElement) {
            this.#backupsListElement.classList.remove('open');
            this.#backupsListElement.hidden = true;
            this.#backupsListElement.innerHTML = '';
        }

        if (this.#loadingAbortController) {
            this.#loadingAbortController.abort();
            this.#loadingAbortController = null;
        }
    }

    openBackups() {
        if (!this.#ownerKey || !this.#backupsListElement) {
            return;
        }

        this.#isOpen = true;

        if (this.#buttonChevronIcon) {
            this.#buttonChevronIcon.classList.remove('fa-chevron-down');
            this.#buttonChevronIcon.classList.add('fa-chevron-up');
        }

        this.#backupsListElement.hidden = false;
        this.#backupsListElement.classList.add('open');

        if (this.#loadingAbortController) {
            this.#loadingAbortController.abort();
        }

        this.#loadingAbortController = new AbortController();
        void this.loadBackupsIntoList(this.#loadingAbortController.signal);
    }

    renderButton() {
        if (this.#buttonElement) {
            return;
        }

        const sibling = document.getElementById('select_chat_search');
        if (!sibling?.parentNode) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.hidden = true;
        button.classList.add('menu_button', 'menu_button_icon', 'manageChatsBackupsButton');

        const icon = document.createElement('i');
        icon.classList.add('fa-solid', 'fa-box-open');

        const label = document.createElement('span');
        label.textContent = t`Backups`;
        label.title = t`Browse chat backups`;

        const chevron = document.createElement('i');
        chevron.classList.add('fa-solid', 'fa-chevron-down', 'fa-sm');

        button.appendChild(icon);
        button.appendChild(label);
        button.appendChild(chevron);
        button.addEventListener('click', () => {
            if (!this.#ownerKey) {
                return;
            }

            if (this.#isOpen) {
                this.closeBackups();
            } else {
                this.openBackups();
            }
        });

        sibling.parentNode.insertBefore(button, sibling);
        this.#buttonElement = button;
        this.#buttonChevronIcon = chevron;
    }

    renderBackupsList() {
        if (this.#backupsListElement) {
            return;
        }

        const sibling = document.getElementById('select_chat_div');
        if (!sibling?.parentNode) {
            return;
        }

        const list = document.createElement('div');
        list.hidden = true;
        list.classList.add('chatBackupsList');
        sibling.parentNode.insertBefore(list, sibling);
        this.#backupsListElement = list;
    }

    sync({ enabled = false, ownerDetails = null } = {}) {
        this.renderButton();
        this.renderBackupsList();

        const normalizedOwnerDetails = enabled ? this.#normalizeOwnerDetails(ownerDetails) : null;
        const nextOwnerKey = normalizedOwnerDetails ? this.#getOwnerKey(normalizedOwnerDetails) : '';
        const ownerChanged = nextOwnerKey !== this.#ownerKey;

        this.#ownerDetails = normalizedOwnerDetails;
        this.#ownerKey = nextOwnerKey;

        if (!normalizedOwnerDetails || !nextOwnerKey) {
            this.closeBackups();
            this.#setVisible(false);
            return;
        }

        this.#setVisible(true);

        if (ownerChanged && this.#isOpen) {
            this.closeBackups();
            this.openBackups();
        }
    }
}

const manageChatsBackupsBrowser = new ManageChatsBackupsBrowser();

export function syncManageChatsBackupsBrowser({ enabled = false, ownerDetails = null } = {}) {
    manageChatsBackupsBrowser.sync({ enabled, ownerDetails });
}
